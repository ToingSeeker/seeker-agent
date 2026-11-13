// Keyboard input. SEEKER reads raw key presses and runs its own line editor;
// what is being typed is shown in the input box that the Screen pins to the
// bottom of the window.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { HOME_DIR } from './config.mjs';
import { layout } from './text.mjs';

export { layout };

const HISTORY_FILE = path.join(HOME_DIR, 'history.json');
const HISTORY_MAX = 200;
// What terminals with extended keyboard reporting send for Shift+Enter.
const SHIFT_ENTER = new Set(['\x1b[27;2;13~', '\x1b[13;2u']);

const isPrintable = (text, key) =>
  Boolean(text) && !key.ctrl && !key.meta && !text.startsWith('\x1b') && text.charCodeAt(0) >= 32 && text.charCodeAt(0) !== 127;

/** Index of the start of the word before `cursor`. */
function wordStart(text, cursor) {
  let i = cursor;
  while (i > 0 && /\s/.test(text[i - 1])) i--;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return i;
}

function wordEnd(text, cursor) {
  let i = cursor;
  while (i < text.length && /\s/.test(text[i])) i++;
  while (i < text.length && !/\s/.test(text[i])) i++;
  return i;
}

export class Terminal {
  constructor(ui, screen) {
    this.ui = ui;
    this.screen = screen;
    this.out = process.stdout;
    this.handler = null;
    this.endCapture = null;
    this.onInterrupt = null;
    this.restored = false;
    this.reading = null; // the message box, while a message is being typed in it
    this.draft = ''; // text waiting to be in the box the next time it opens
    this.injected = undefined;
    this.history = [];
    try {
      const saved = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (Array.isArray(saved)) this.history = saved.filter((h) => typeof h === 'string');
    } catch {}

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    this.listener = (text, key) => this.#dispatch(text, key ?? {});
    process.stdin.on('keypress', this.listener);
    // Input ending (the terminal went away) cancels the current read and every later one.
    this.closed = false;
    process.stdin.on('end', () => {
      this.closed = true;
      this.endCapture?.();
    });
    // Bracketed paste: the terminal marks pasted text, so a pasted newline
    // can be told apart from the user pressing Enter.
    this.out.write('\x1b[?2004h');
    process.on('exit', () => this.restore());
  }

  /** Puts the terminal back the way the shell expects it. */
  restore() {
    if (this.restored) return;
    this.restored = true;
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.off('keypress', this.listener);
    process.stdin.pause();
    this.out.write('\x1b[?2004l\x1b[?25h');
  }

  #dispatch(text, key) {
    if (this.handler) return this.handler(text, key);
    // Nothing is reading: the agent is working, and only Ctrl+C means anything.
    if (key.ctrl && key.name === 'c') this.onInterrupt?.();
  }

  /**
   * Hands key presses to `onKey`, one at a time, until it returns true.
   */
  captureKeys(onKey) {
    return new Promise((resolve) => {
      if (this.closed) return resolve();
      let busy = false;
      const end = () => {
        this.handler = null;
        this.endCapture = null;
        resolve();
      };
      this.endCapture = end;
      const waiting = [];
      const handle = (text, key) => {
        // Keys that arrive while an async handler runs wait their turn; several
        // can land in one read, e.g. a held-down arrow key.
        if (busy) return waiting.push([text, key]);
        let result;
        try {
          result = onKey({ ...key, name: key.name ?? text, text });
        } catch {
          return end();
        }
        if (result instanceof Promise) {
          busy = true;
          result.then(
            (finished) => {
              busy = false;
              if (finished) return this.handler === handle && end();
              while (waiting.length && !busy && this.handler === handle) handle(...waiting.shift());
            },
            () => end(),
          );
        } else if (result) end();
      };
      this.handler = handle;
    });
  }

  /** Unblocks a pending read as if input had ended. */
  cancelWait() {
    this.endCapture?.();
  }

  #remember(text) {
    if (!text.trim() || this.history.at(-1) === text) return;
    this.history.push(text);
    if (this.history.length > HISTORY_MAX) this.history = this.history.slice(-HISTORY_MAX);
    try {
      fs.mkdirSync(HOME_DIR, { recursive: true });
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history));
    } catch {}
  }

  /**
   * The editing core shared by the boxed prompt and one-line questions.
   * @param {object} opts
   * @param {(state: {text: string, cursor: number}) => void} opts.draw
   * @param {() => number} opts.width      characters per row
   * @param {boolean} opts.multiline
   * @param {boolean} opts.useHistory
   * @param {(text: string) => string|null} [opts.complete]  Tab completion
   * @param {(state: object) => 'clear'|'cancel'|'ignore'} opts.onCtrlC
   * @returns {Promise<string|null>} the text, or null if cancelled
   */
  #edit({ draw, width, multiline, useHistory, complete, onCtrlC, initial = '', expose = null }) {
    const state = { text: initial, cursor: initial.length };
    let result = null;
    let pasting = false;
    let historyAt = this.history.length;
    let draft = '';

    const insert = (s) => {
      state.text = state.text.slice(0, state.cursor) + s + state.text.slice(state.cursor);
      state.cursor += s.length;
    };
    const replace = (text) => {
      state.text = text;
      state.cursor = text.length;
    };
    const browse = (direction) => {
      if (!useHistory) return;
      const next = historyAt + direction;
      if (next < 0 || next > this.history.length) return;
      if (historyAt === this.history.length) draft = state.text;
      historyAt = next;
      replace(historyAt === this.history.length ? draft : this.history[historyAt]);
    };
    const vertical = (direction) => {
      const l = layout(state.text, state.cursor, width());
      const row = l.cursorRow + direction;
      if (row < 0 || row >= l.rows.length) return browse(direction);
      state.cursor = l.starts[row] + Math.min(l.cursorCol, l.rows[row].length);
    };

    const onKey = (key) => {
      const { name, text } = key;
      if (name === 'paste-start') pasting = true;
      else if (name === 'paste-end') pasting = false;
      else if (pasting && (name === 'return' || name === 'enter')) insert(multiline ? '\n' : ' ');
      else if (key.ctrl && name === 'c') {
        const action = onCtrlC(state);
        if (action === 'cancel') return true;
        if (action === 'clear') replace('');
      } else if (key.ctrl && name === 'd') {
        if (!state.text) return true;
        state.text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1);
      } else if (multiline && ((name === 'return' && (key.meta || key.shift)) || name === 'enter' || SHIFT_ENTER.has(key.sequence))) insert('\n');
      else if (name === 'return') {
        // A trailing backslash continues onto a new line, as in a shell.
        if (multiline && state.text.slice(0, state.cursor).endsWith('\\')) {
          state.text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor);
          state.cursor--;
          insert('\n');
        } else {
          result = state.text;
          return true;
        }
      } else if (name === 'backspace' && key.meta) {
        const from = wordStart(state.text, state.cursor);
        state.text = state.text.slice(0, from) + state.text.slice(state.cursor);
        state.cursor = from;
      } else if (name === 'backspace') {
        if (state.cursor > 0) {
          state.text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor);
          state.cursor--;
        }
      } else if (name === 'delete') state.text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1);
      else if ((name === 'left' && key.meta) || (key.meta && name === 'b')) state.cursor = wordStart(state.text, state.cursor);
      else if ((name === 'right' && key.meta) || (key.meta && name === 'f')) state.cursor = wordEnd(state.text, state.cursor);
      else if (name === 'left') state.cursor = Math.max(0, state.cursor - 1);
      else if (name === 'right') state.cursor = Math.min(state.text.length, state.cursor + 1);
      else if (name === 'up') vertical(-1);
      else if (name === 'down') vertical(1);
      else if (name === 'home' || (key.ctrl && name === 'a')) state.cursor = state.text.lastIndexOf('\n', state.cursor - 1) + 1;
      else if (name === 'end' || (key.ctrl && name === 'e')) {
        const nl = state.text.indexOf('\n', state.cursor);
        state.cursor = nl === -1 ? state.text.length : nl;
      } else if (key.ctrl && name === 'u') replace('');
      else if (key.ctrl && name === 'k') state.text = state.text.slice(0, state.cursor);
      else if (key.ctrl && name === 'w') {
        const from = wordStart(state.text, state.cursor);
        state.text = state.text.slice(0, from) + state.text.slice(state.cursor);
        state.cursor = from;
      } else if (name === 'tab') {
        const completed = pasting ? null : complete?.(state.text);
        if (completed) replace(completed);
        else if (pasting) insert('  ');
      } else if (isPrintable(text, key)) insert(text);
      else return false;
      draw(state);
      return false;
    };

    // Lets text arrive from somewhere other than the keyboard while this is being typed.
    expose?.({ text: () => state.text, insert: (s) => (insert(s), draw(state)) });
    draw(state);
    return this.captureKeys(onKey).then(() => result);
  }

  /**
   * Reads one message in the input box.
   * @param {object} opts
   * @param {string} opts.placeholder
   * @param {(text: string) => string[]} [opts.suggest]   rows shown under the box
   * @param {(text: string) => string|null} [opts.complete]
   * @returns {Promise<string|object|null>} null = the user wants to leave; an object = what inject() was given
   */
  async readInput({ placeholder, suggest, complete }) {
    let exitArmedAt = 0;
    const armed = () => Date.now() - exitArmedAt < 2000;
    const draw = (state) => {
      this.screen.setFooter({ input: { ...state, placeholder }, suggestions: suggest?.(state.text) ?? [], exitArmed: armed() });
    };
    const text = await this.#edit({
      draw,
      width: () => Math.max(10, this.screen.width - 6),
      multiline: true,
      useHistory: true,
      complete,
      initial: this.draft,
      expose: (box) => (this.reading = box),
      onCtrlC: (state) => {
        if (state.text) return 'clear';
        if (armed()) return 'cancel';
        exitArmedAt = Date.now();
        return 'ignore';
      },
    });
    const typed = this.reading?.text() ?? '';
    this.reading = null;
    this.draft = '';
    this.screen.setFooter({ input: null, suggestions: [], exitArmed: false });
    if (this.injected !== undefined) {
      const value = this.injected;
      this.injected = undefined;
      // What was being typed is not lost: it is back in the box when this turn is over.
      this.draft = typed;
      return value;
    }
    if (text !== null) this.#remember(text);
    return text;
  }

  /** Puts text into the message box as if typed: now if it is open, otherwise the next time it opens. */
  typeIn(text) {
    if (this.reading) this.reading.insert(text);
    else this.draft += text;
  }

  /**
   * Ends the read in progress and makes readInput return `value` instead of what was typed.
   * @returns {boolean} false when no message is being typed right now
   */
  inject(value) {
    if (!this.reading || this.closed) return false;
    this.injected = value;
    this.cancelWait();
    return true;
  }

  /**
   * A one-line answer, typed in the same input box with `placeholder` as the cue.
   * Returns the trimmed answer, or null on Ctrl+C (which also interrupts the agent).
   */
  async ask(placeholder, { mask = false } = {}) {
    let interrupted = false;
    const text = await this.#edit({
      draw: (state) => this.screen.setFooter({ input: { ...state, placeholder, mask }, suggestions: [] }),
      width: () => Math.max(10, this.screen.width - 6),
      multiline: false,
      useHistory: false,
      onCtrlC: () => {
        interrupted = true;
        return 'cancel';
      },
    });
    this.screen.setFooter({ input: null });
    if (interrupted) this.onInterrupt?.();
    return text === null ? null : text.trim();
  }
}
