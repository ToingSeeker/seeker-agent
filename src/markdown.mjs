// Streaming markdown → ANSI. Tokens are printed as they arrive, so this is a
// character-level state machine; only the first few characters of each line are
// held back, to tell a heading / bullet / code fence apart from plain text.

const RESET = '\x1b[0m';
const BOLD_ON = '\x1b[1m';
const BOLD_OFF = '\x1b[22m';
const CODE_ON = '\x1b[38;5;222m';
const CODE_OFF = '\x1b[39m';
const DIM = '\x1b[2m';
const HEADING = '\x1b[1m\x1b[38;5;80m';

export class MdStream {
  /** @param {(s: string) => void} write  @param {boolean} enabled false = pass text through untouched */
  constructor(write, enabled = true) {
    this.write = write;
    this.enabled = enabled;
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
      this.out += CODE_ON + held;
      if (newlineNow) {
        this.out += `${RESET}\n`;
        this.atLineStart = true;
      }
      return;
    }

    let rest = held;
    if (/^#{1,6}\s/.test(text)) {
      this.out += HEADING;
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
      this.out += this.inCode ? CODE_ON : CODE_OFF;
      return;
    }
    if (ch === '*' && !this.inCode) {
      this.star = true;
      return;
    }
    this.out += ch;
  }
}
