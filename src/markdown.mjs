// Streaming markdown → ANSI. Tokens are printed as they arrive, so this is a
// character-level state machine; only the first few characters of each line are
// held back, to tell a heading / bullet / code fence apart from plain text.
import { sgr, terminalCodes } from './theme.mjs';

const RESET = '\x1b[0m';
const BOLD_ON = '\x1b[1m';
const BOLD_OFF = '\x1b[22m';
const CODE_OFF = '\x1b[39m';
const DIM = '\x1b[2m';
// Inline code is a cool tint, so it does not read as the brand colour the headings use.
const CODE_TINT = '#9CC2FF';

export class MdStream {
  /**
   * @param {(s: string) => void} write
   * @param {boolean | number} enabled false or 0 = pass text through untouched; a number is the terminal's colour depth (true = 256)
   */
  constructor(write, enabled = true) {
    const depth = enabled === true ? 8 : Number(enabled) || 0;
    this.write = write;
    this.enabled = depth > 0;
    this.heading = `\x1b[${terminalCodes(depth).accentBold}m`;
    this.codeOn = `\x1b[${depth >= 8 ? sgr(CODE_TINT, depth) : '36'}m`;
    this.out = '';
    this.atLineStart = true;
    this.hold = '';
    this.inFence = false;
    this.inCode = false;
    this.bold = false;
    this.star = false;
    this.styled = false;
  }

  push(text) {
    if (!this.enabled) return this.write(text);
    for (const ch of text) this.#char(ch);
    this.#drain();
  }

  flush() {
    if (!this.enabled) return;
    if (this.hold) this.#startLine(this.hold, false);
    if (this.star) this.out += '*';
    if (this.styled || this.bold || this.inCode || this.inFence) this.out += RESET;
    this.star = this.bold = this.inCode = this.styled = false;
    this.#drain();
  }

  #drain() {
    if (this.out) this.write(this.out);
    this.out = '';
  }

  #char(ch) {
    if (this.atLineStart) {
      if (ch === '\n') return this.#startLine(this.hold, true);
      this.hold += ch;
      const text = this.hold.trimStart();
      // A fence line is held whole so its language tag can be shown.
      if (text.length >= 4 && !text.startsWith('```')) this.#startLine(this.hold, false);
      return;
    }
    if (this.inFence) {
      if (ch === '\n') {
        this.out += `${RESET}\n`;
        this.atLineStart = true;
      } else this.out += ch;
      return;
    }
    if (ch === '\n') return this.#endLine();
    this.#inline(ch);
  }

  #startLine(held, newlineNow) {
    this.atLineStart = false;
    this.hold = '';
    const text = held.trimStart();
    const indent = held.slice(0, held.length - text.length);

    if (text.startsWith('```')) {
      this.inFence = !this.inFence;
      const label = this.inFence ? `┌─ ${text.slice(3).trim()}`.trimEnd() : '└─';
      this.out += `${DIM}${indent}${label}${RESET}\n`;
      this.atLineStart = true;
      return;
    }
    if (this.inFence) {
      this.out += this.codeOn + held;
      if (newlineNow) {
        this.out += `${RESET}\n`;
        this.atLineStart = true;
      }
      return;
    }

    let rest = held;
    if (/^#{1,6}\s/.test(text)) {
      this.out += this.heading;
      this.styled = true;
      rest = text.replace(/^#{1,6}\s+/, '');
    } else if (/^[-*]\s/.test(text)) {
      rest = `${indent}• ${text.slice(2)}`;
    }
    for (const ch of rest) this.#inline(ch);
    if (newlineNow) this.#endLine();
  }

  #endLine() {
    if (this.star) this.out += '*';
    if (this.styled || this.bold || this.inCode) this.out += RESET;
    this.star = this.bold = this.inCode = this.styled = false;
    this.out += '\n';
    this.atLineStart = true;
  }

  #inline(ch) {
    if (this.star) {
      this.star = false;
      if (ch === '*') {
        this.bold = !this.bold;
        this.out += this.bold ? BOLD_ON : BOLD_OFF;
        return;
      }
      this.out += '*';
    }
    if (ch === '`') {
      this.inCode = !this.inCode;
      this.out += this.inCode ? this.codeOn : CODE_OFF;
      return;
    }
    if (ch === '*' && !this.inCode) {
      this.star = true;
      return;
    }
    this.out += ch;
  }
}
