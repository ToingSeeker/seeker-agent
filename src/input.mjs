// Keyboard input. SEEKER reads raw key presses and runs its own line editor;
// what is being typed is shown in the input box that the Screen pins to the
// bottom of the window.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { HOME_DIR } from './config.mjs';
import { compactDropped } from './images.mjs';
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

    // What is typed passes through here first: the mouse wheel arrives as escape codes, which are
    // taken out and turned into scrolling before the rest is read as keys.
    this.input = new PassThrough();
    readline.emitKeypressEvents(this.input);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const decoder = new StringDecoder('utf8');
    let held = '';
    this.onData = (chunk) => {
      let text = held + decoder.write(chunk);
      held = '';
      // A mouse report cut off at the end of a read waits for the rest of it.
      const cut = /\x1b\[<[\d;]*$/.exec(text);
      if (cut) [text, held] = [text.slice(0, cut.index), cut[0]];
      text = text.replace(/\x1b\[<(\d+);\d+;\d+[Mm]/g, (_, button) => (this.#mouse(Number(button)), ''));
      if (text) this.input.write(text);
    };
    process.stdin.on('data', this.onData);
    this.listener = (text, key) => this.#dispatch(text, key ?? {});
    this.input.on('keypress', this.listener);
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
    this.input.off('keypress', this.listener);
    process.stdin.off('data', this.onData);
    process.stdin.pause();
    this.out.write('\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?25h');
  }

  #dispatch(text, key) {
    if (this.handler) return this.handler(text, key);
    // Nothing is reading: the agent is working. Ctrl+C stops it, and the conversation can be scrolled.
    if (key.ctrl && key.name === 'c') this.onInterrupt?.();
    else this.scrollKey(key);
  }

  /** The mouse wheel scrolls the conversation; clicks and the rest of the mouse are let go. */
  #mouse(button) {
    if (!(button & 64) || button & 128) return;
    this.screen?.scrollBy((button & 1) === 0 ? 3 : -3);
  }

  /** PageUp and PageDown scroll the conversation a page. Returns whether the key was one of them. */
  scrollKey(key) {
    if (!this.screen || (key.name !== 'pageup' && key.name !== 'pagedown')) return false;
    this.screen.scrollBy(key.name === 'pageup' ? this.screen.page : -this.screen.page);
    return true;
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

  /**
   * Ends a waiting readInput so something scheduled can run — but only while the box is empty:
   * a message being typed is never taken away. Returns whether the prompt was woken.
   */
  wake() {
    if (!this.reading || this.reading.text()) return false;
    this.woken = true;
    this.cancelWait();
    return true;
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
      fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
      // Owner only: a line typed or pasted here can be a key.
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history), { mode: 0o600 });
      fs.chmodSync(HISTORY_FILE, 0o600);
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
  #edit({ draw, width, multiline, useHistory, complete, onCtrlC, initial = '', expose = null, picker = null }) {
    const state = { text: initial, cursor: initial.length };
    let result = null;
    let pasting = false;
    let pasteFrom = 0;
    // Files dragged in show as a short name ([image.png]); what was dragged goes back in their place when the message is sent.
    const dropped = new Map(); // short name → the path as the terminal typed it
    const expand = (text) => {
      for (const [token, written] of dropped) text = text.split(token).join(written);
      return text;
    };
    const compact = (from, to) => {
      if (!multiline) return;
      const found = compactDropped(state.text.slice(from, to), process.cwd(), new Set(dropped.keys()));
      if (!found) return;
      for (const { token, written } of found.files) dropped.set(token, written);
      state.text = state.text.slice(0, from) + found.text + state.text.slice(to);
      state.cursor = from + found.text.length;
    };
    // A short name is taken out whole, not a letter at a time.
    const tokenBefore = () => [...dropped.keys()].find((t) => state.text.slice(0, state.cursor).endsWith(t));
    const tokenAfter = () => [...dropped.keys()].find((t) => state.text.startsWith(t, state.cursor));
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

    const recalled = () => historyAt !== this.history.length;
    const onKey = (key) => {
      const { name, text } = key;
      // The list of commands under the box takes the keys that move in it and choose from it.
      const picked = pasting ? null : picker?.key(key, state.text, recalled());
      if (picked) {
        if (picked.replace !== undefined) replace(picked.replace);
        if (picked.submit) {
          result = expand(state.text);
          this.shown = { text: result, as: state.text };
          return true;
        }
        draw(state, recalled());
        return false;
      }
      if (name === 'paste-start') {
        pasting = true;
        pasteFrom = state.cursor;
      } else if (name === 'paste-end') {
        pasting = false;
        // A drag from the file manager arrives as a paste of the file's path.
        if (state.cursor > pasteFrom) compact(pasteFrom, state.cursor);
      }
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
          result = expand(state.text);
          this.shown = { text: result, as: state.text };
          return true;
        }
      } else if (name === 'backspace' && key.meta) {
        const from = wordStart(state.text, state.cursor);
        state.text = state.text.slice(0, from) + state.text.slice(state.cursor);
        state.cursor = from;
      } else if (name === 'backspace' && tokenBefore()) {
        const token = tokenBefore();
        state.text = state.text.slice(0, state.cursor - token.length) + state.text.slice(state.cursor);
        state.cursor -= token.length;
      } else if (name === 'backspace') {
        if (state.cursor > 0) {
          state.text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor);
          state.cursor--;
        }
      } else if (name === 'delete') state.text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + (tokenAfter()?.length ?? 1));
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
      else if (this.scrollKey(key)) return false;
      else return false;
      draw(state, recalled());
      return false;
    };

    // Lets text arrive from somewhere other than the keyboard while this is being typed.
    // A picture sent from the phone is put in as its path, and shown short like a dragged one.
    expose?.({
      text: () => expand(state.text),
      insert: (s) => {
        const from = state.cursor;
        insert(s);
        compact(from, state.cursor);
        draw(state);
      },
    });
    draw(state);
    return this.captureKeys(onKey).then(() => result);
  }

  /**
   * Reads one message in the input box.
   * @param {object} opts
   * @param {string} opts.placeholder
   * @param {(view: object) => string[]} [opts.suggest]   rows shown under the box, for the picker's view
   * @param {import('./picker.mjs').Picker} [opts.picker]   the list of commands the arrow keys move in
   * @param {(text: string) => string|null} [opts.complete]
   * @returns {Promise<string|object|null>} null = the user wants to leave; '' = nothing typed (or woken by wake()); an object = what inject() was given
   */
  async readInput({ placeholder, suggest, complete, picker }) {
    let exitArmedAt = 0;
    const armed = () => Date.now() - exitArmedAt < 2000;
    const draw = (state, recalled = false) => {
      this.screen.setFooter({ input: { ...state, placeholder }, suggestions: (picker && suggest?.(picker.view(state.text, recalled))) ?? [], exitArmed: armed() });
    };
    this.woken = false;
    const text = await this.#edit({
      draw,
      width: () => Math.max(10, this.screen.width - 6),
      multiline: true,
      useHistory: true,
      complete,
      picker,
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
    // What was just sent is followed: the view goes back to the newest rows.
    this.screen?.scrollToBottom();
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
    // Woken by a schedule rather than ended by the user: an empty message, which the caller reads as "look for due work".
    if (text === null && this.woken && !this.closed) return '';
    return text;
  }

  /** How `text`, just sent from the message box, was shown there: with the short names of the files dragged in. */
  shownAs(text) {
    return this.shown?.text === text ? this.shown.as : text;
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
    // A question is answered where it can be seen.
    this.screen?.scrollToBottom();
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
