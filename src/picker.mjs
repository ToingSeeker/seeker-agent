// The list under the input box while a /command is being typed: which entries match, which one
// is highlighted, and what the arrow keys, Tab, Enter and Esc do to it. No drawing here.

export class Picker {
  /**
   * @param {(text: string) => any[][]} items  the entries for what is typed; each starts with its value ("/model")
   * @param {number} [size]  rows shown at once
   */
  constructor(items, size = 8) {
    this.items = items;
    this.size = size;
    this.index = 0;
    this.text = null;
    this.closed = null; // the text Esc was pressed on; typing anything else opens the list again
  }

  /** The entries for `text`. None while an earlier message is being recalled, or after Esc. */
  #list(text, recalled) {
    if (recalled || text === this.closed) return [];
    if (text !== this.text) {
      this.text = text;
      this.index = 0;
      this.closed = null;
    }
    const list = this.items(text);
    if (this.index >= list.length) this.index = 0;
    return list;
  }

  /**
   * What a key does while the list is open. Returns null when the key is not the list's (the
   * editor handles it), `{}` when it only moved the highlight, `{ replace }` to put text in the
   * box, and `{ replace, submit: true }` to send it.
   */
  key(key, text, recalled = false) {
    const list = this.#list(text, recalled);
    if (!list.length || key.ctrl || key.meta) return null;
    const chosen = list[this.index][0];
    if (key.name === 'up') this.index = (this.index - 1 + list.length) % list.length;
    else if (key.name === 'down') this.index = (this.index + 1) % list.length;
    else if (key.name === 'pageup') this.index = Math.max(0, this.index - this.size);
    else if (key.name === 'pagedown') this.index = Math.min(list.length - 1, this.index + this.size);
    else if (key.name === 'escape') this.closed = text;
    else if (key.name === 'tab') return { replace: `${chosen} ` };
    else if (key.name === 'return' && !key.shift) return { replace: chosen, submit: true };
    else return null;
    return {};
  }

  /** The rows to draw: a window of the entries around the highlighted one, and how many lie outside it. */
  view(text, recalled = false) {
    const list = this.#list(text, recalled);
    const start = Math.max(0, Math.min(this.index - Math.floor(this.size / 2), list.length - this.size));
    const rows = list.slice(start, start + this.size);
    return { rows, selected: this.index - start, index: this.index, total: list.length, above: start, below: Math.max(0, list.length - start - rows.length) };
  }
}
