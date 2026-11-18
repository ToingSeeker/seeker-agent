// The full-screen layout: a header pinned to the top, the conversation in the
// middle, and the input box with its bars pinned to the bottom.
//
// It runs on the terminal's alternate screen, like a full-screen app: the header and the input box
// stay where they are while the conversation is scrolled — with the mouse wheel or PageUp and
// PageDown — inside SEEKER. The terminal's own scrollback is not used while it runs, so the pinned
// rows never end up in the middle of it. When SEEKER closes, the conversation is printed to the
// normal screen, where the terminal's scrollback keeps it. Only rows that differ from what is
// already on screen are repainted.
import { activeSgr, clipAnsi, layout, padEnd, truncate, visibleLength, wrapAnsi } from './text.mjs';

const MAX_INPUT_ROWS = 8;
// Conversation rows kept to scroll back through; older ones are let go.
const MAX_HISTORY = 20_000;
// The terminal sends the mouse wheel as escape codes once asked (1000), in the form that has no limit on size (1006).
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1000l\x1b[?1006l';
// Anything but colour codes would move the cursor and break the layout.
const NON_SGR = /\x1b\[[0-9;?]*[A-LN-Za-ln-z]|\x1b\][^\x07]*\x07|\x1b[^[\]]/g;
// A small face that moves (see avatarMark in ui.mjs): a private-use character that names it, then spaces
// that keep its width, so wrapping and widths are right before it is drawn in at each repaint.
const AVATAR = /[\uE000-\uE007] {10}/g;

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
    this.rows = []; // finished conversation rows, oldest first
    this.top = null; // the first row shown while scrolled back; null while following the newest
    this.partial = ''; // the line still being written
    this.live = []; // temporary rows under the conversation (spinner, menus)
    this.painted = [];
    this.started = false;
    // Draws a small face from its private-use character; set by the UI.
    this.avatar = null;
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
    // The shell's screen is kept as it is and comes back when SEEKER closes.
    this.out.write(`\x1b[?1049h${MOUSE_ON}\x1b[2J`);
    this.started = true;
    this.painted = [];
    this.out.on('resize', this.onResize);
    // However SEEKER ends, the terminal is given back as it was, with the conversation on it.
    this.onExit = () => this.close();
    process.on('exit', this.onExit);
    this.render();
  }

  /** Gives the terminal back and prints the conversation there, so its scrollback keeps it. */
  close() {
    if (!this.started) return;
    this.out.off('resize', this.onResize);
    process.off('exit', this.onExit);
    this.live = [];
    this.footer.input = null;
    const width = this.width;
    const transcript = [...this.header(width), ...this.#all().map((row) => this.#faces(row))].map((row) => `${clipAnsi(row, width)}\x1b[0m\n`).join('');
    this.out.write(`${MOUSE_OFF}\x1b[0m\x1b[?1049l${transcript}\x1b[?25h`);
    this.started = false;
  }

  /** Every conversation row, the unfinished line and the live rows, as they would be shown. */
  #all() {
    const partial = visibleLength(this.partial) ? wrapAnsi(this.partial, this.width) : [];
    return [...this.rows, ...partial, ...this.live];
  }

  /** A row with its faces drawn in. */
  #faces(row) {
    if (!/[\uE000-\uE007]/.test(row)) return row;
    return row.replace(AVATAR, (cell) => this.avatar?.(cell.charCodeAt(0) - 0xe000) ?? ' '.repeat(cell.length));
  }

  /** Moves the view `lines` rows back (positive) or forward (negative). At the newest rows it follows again. */
  scrollBy(lines) {
    if (!this.started) return;
    const { body } = this.#frame();
    const bottom = Math.max(0, this.#all().length - body);
    const to = Math.min(bottom, Math.max(0, (this.top ?? bottom) - lines));
    this.top = to >= bottom ? null : to;
    this.render();
  }

  /** Back to the newest rows. */
  scrollToBottom() {
    if (this.top === null) return;
    this.top = null;
    this.render();
  }

  /** Rows a page of PageUp or PageDown moves. */
  get page() {
    return Math.max(1, this.#frame().body - 2);
  }

  /** Adds text to the conversation. A line is finished by its newline. */
  append(text) {
    const clean = String(text).replace(/\r/g, '').replace(/\t/g, '    ').replace(NON_SGR, '');
    let current = this.partial;
    clean.split('\n').forEach((segment, i) => {
      if (i > 0) {
        this.rows.push(...wrapAnsi(current, this.width));
        if (this.rows.length > MAX_HISTORY) {
          const drop = this.rows.length - MAX_HISTORY;
          this.rows.splice(0, drop);
          if (this.top !== null) this.top = Math.max(0, this.top - drop);
        }
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
    // The brand colour marks the box that is taking typing; while the agent works the border is quiet.
    const edge = footer.input ? c.accent : c.dim;
    const border = (l, r) => edge(`${l}${'─'.repeat(width - 2)}${r}`);
    const row = (mark, body) => `${edge('│')} ${mark} ${padEnd(body, inner)} ${edge('│')}`;
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
    const hintsAt = rows.length;
    rows.push(footer.hints(width, footer.exitArmed));
    rows.push(c.dim('─'.repeat(width)));
    rows.push(footer.status(width));
    return { rows, cursor, hintsAt };
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
    const all = this.#all();
    const bottom = Math.max(0, all.length - body);
    if (this.top !== null && this.top >= bottom) this.top = null;
    const first = this.top ?? bottom;
    const visible = all.slice(first, first + body).map((row) => this.#faces(row));
    const rows = [...footer.rows];
    // Scrolled back, the hint row says so, and how to come back.
    if (this.top !== null) {
      const below = all.length - first - visible.length;
      const long = ` ↑ ${below} newer lines below · PageDown or scroll down to return`;
      rows[footer.hintsAt] = this.c.accent(visibleLength(long) <= width ? long : ` ↑ ${below} newer below · PageDown`);
    }

    let out = '\x1b[?25l';
    const frame = [...header, ...visible, ...new Array(body - visible.length).fill(''), ...rows].slice(0, height);
    for (let i = 0; i < frame.length; i++) {
      if (frame[i] === this.painted[i]) continue;
      out += `\x1b[${i + 1};1H${clipAnsi(frame[i], width)}\x1b[0m\x1b[K`;
      this.painted[i] = frame[i];
    }

    if (footer.cursor) out += `\x1b[${footerTop + footer.cursor.row + 1};${footer.cursor.col + 1}H\x1b[?25h`;
    this.out.write(out);
  }
}
