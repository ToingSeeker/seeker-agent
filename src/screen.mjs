// The full-screen layout: a header pinned to the top, the conversation in the
// middle, and the input box with its bars pinned to the bottom.
//
// It runs on the normal screen, not the alternate one, so the terminal's own
// scrollback, mouse wheel and text selection keep working. A conversation row
// that has to leave the middle area is first written onto the top screen row
// and the whole screen is scrolled by one line, which is what moves a row into
// scrollback; the header is then painted back over it. Only rows that differ
// from what is already on screen are repainted.
import { activeSgr, clipAnsi, layout, padEnd, truncate, visibleLength, wrapAnsi } from './text.mjs';

const MAX_INPUT_ROWS = 8;
// Anything but colour codes would move the cursor and break the layout.
const NON_SGR = /\x1b\[[0-9;?]*[A-LN-Za-ln-z]|\x1b\][^\x07]*\x07|\x1b[^[\]]/g;

export class Screen {
  /**
   * @param {object} opts
   * @param {(width: number) => string[]} opts.header   rows pinned to the top
   * @param {object} opts.colors                        the UI palette
   * @param {NodeJS.WriteStream} [opts.out]
   */
  constructor({ header, colors, out = process.stdout }) {
    this.out = out;
    this.header = header;
    this.c = colors;
    this.rows = []; // finished conversation rows not yet in scrollback
    this.partial = ''; // the line still being written
    this.live = []; // temporary rows under the conversation (spinner, menus)
    this.painted = [];
    this.started = false;
    this.footer = {
      input: null, // { text, cursor, placeholder } while the user can type
      idle: '',
      suggestions: [],
      exitArmed: false,
      hints: () => '',
      status: () => '',
    };
    this.onResize = () => {
      this.painted = [];
      this.render();
    };
  }

  get width() {
    return Math.max(20, (this.out.columns || 100) - 1);
  }

  get height() {
    return this.out.rows || 40;
  }

  start() {
    // Scroll whatever the shell left on screen into scrollback, then take over.
    this.out.write(`\x1b[${this.height};1H${'\n'.repeat(this.height)}`);
    this.started = true;
    this.painted = [];
    this.out.on('resize', this.onResize);
    this.render();
  }

  /** Leaves the conversation on screen, clears the input area and parks the cursor there. */
  close() {
    if (!this.started) return;
    this.out.off('resize', this.onResize);
    this.live = [];
    this.footer.input = null;
    const { footerTop, footerRows } = this.#frame();
    let out = '';
    for (let i = 0; i < footerRows; i++) out += `\x1b[${footerTop + i + 1};1H\x1b[0m\x1b[K`;
    this.out.write(`${out}\x1b[${footerTop + 1};1H\x1b[?25h`);
    this.started = false;
  }

  /** Adds text to the conversation. A line is finished by its newline. */
  append(text) {
    const clean = String(text).replace(/\r/g, '').replace(/\t/g, '    ').replace(NON_SGR, '');
    let current = this.partial;
    clean.split('\n').forEach((segment, i) => {
      if (i > 0) {
        this.rows.push(...wrapAnsi(current, this.width));
        // A colour left open carries over to the next line.
        current = activeSgr(current);
      }
      current += segment;
    });
    this.partial = current;
    this.render();
  }

  setLive(lines) {
    this.live = lines;
    this.render();
  }

  setFooter(patch) {
    Object.assign(this.footer, patch);
    this.render();
  }

  #footer(width) {
    const { c, footer } = this;
    const inner = Math.max(10, width - 6);
    const border = (l, r) => c.accent(`${l}${'─'.repeat(width - 2)}${r}`);
    const row = (mark, body) => `${c.accent('│')} ${mark} ${padEnd(body, inner)} ${c.accent('│')}`;
    const rows = ['', border('╭', '╮')];
    let cursor = null;

    if (footer.input) {
      const { cursor: at, placeholder, mask } = footer.input;
      // A secret (an API key) is typed blind.
      const text = mask ? '•'.repeat(footer.input.text.length) : footer.input.text;
      const l = layout(text, at, inner);
      const first = Math.max(0, Math.min(l.cursorRow - MAX_INPUT_ROWS + 1, l.rows.length - MAX_INPUT_ROWS));
      const shown = l.rows.slice(first, first + MAX_INPUT_ROWS);
      shown.forEach((line, i) => {
        const body = text === '' ? c.dim(truncate(placeholder, inner)) : line;
        rows.push(row(first + i === 0 ? c.accent('›') : ' ', body));
      });
      const before = l.rows[l.cursorRow].slice(0, l.cursorCol);
      cursor = { row: 2 + l.cursorRow - first, col: 4 + visibleLength(before) };
    } else {
      rows.push(row(c.dim('›'), c.dim(truncate(footer.idle, inner))));
    }

    rows.push(border('╰', '╯'));
    for (const s of footer.suggestions) rows.push(clipAnsi(s, width));
    rows.push(footer.hints(width, footer.exitArmed));
    rows.push(c.dim('─'.repeat(width)));
    rows.push(footer.status(width));
    return { rows, cursor };
  }

  #frame() {
    const width = this.width;
    const height = this.height;
    const footer = this.#footer(width);
    // On a short window the conversation matters more than the logo.
    const header = height >= footer.rows.length + 12 ? this.header(width) : [];
    const body = Math.max(1, height - header.length - footer.rows.length);
    return { width, height, header, footer, body, footerTop: header.length + body, footerRows: footer.rows.length };
  }

  render() {
    if (!this.started) return;
    const { width, height, header, footer, body, footerTop } = this.#frame();
    const partial = visibleLength(this.partial) ? wrapAnsi(this.partial, width) : [];
    let out = '\x1b[?25l';

    // Rows that no longer fit go to scrollback, oldest first.
    let overflow = this.rows.length + partial.length + this.live.length - body;
    while (overflow > 0 && this.rows.length) {
      out += `\x1b[1;1H${clipAnsi(this.rows.shift(), width)}\x1b[0m\x1b[K\x1b[${height};1H\n`;
      this.painted.shift();
      this.painted.push('');
      overflow--;
    }

    const visible = [...this.rows, ...partial, ...this.live].slice(-body);
    const frame = [...header, ...visible, ...new Array(body - visible.length).fill(''), ...footer.rows].slice(0, height);
    for (let i = 0; i < frame.length; i++) {
      if (frame[i] === this.painted[i]) continue;
      out += `\x1b[${i + 1};1H${clipAnsi(frame[i], width)}\x1b[0m\x1b[K`;
      this.painted[i] = frame[i];
    }

    if (footer.cursor) out += `\x1b[${footerTop + footer.cursor.row + 1};${footer.cursor.col + 1}H\x1b[?25h`;
    this.out.write(out);
  }
}
