// Text measuring and wrapping for strings that carry ANSI colour codes.

export const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const TOKEN = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|[\s\S]/gu;
const SGR = /^\x1b\[[0-9;]*m$/;
const SGR_RESET = /^\x1b\[0?m$/;
const RESET = '\x1b[0m';

/** Terminal columns a character occupies: 0 for combining marks, 2 for CJK and emoji. */
export function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || cp === 0x200b || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2;
  return 1;
}

export function visibleLength(s) {
  let width = 0;
  for (const ch of String(s).replace(ANSI, '')) width += charWidth(ch);
  return width;
}

export const padEnd = (s, width) => s + ' '.repeat(Math.max(0, width - visibleLength(s)));
/** Shortens plain text (no colour codes) to `width`, keeping the start. */
export const truncate = (plain, width) => (plain.length <= width ? plain : width > 1 ? `${plain.slice(0, width - 1)}…` : '');
/** Shortens plain text to `width`, keeping the end — for paths. */
export const truncateStart = (plain, width) => (plain.length <= width ? plain : width > 1 ? `…${plain.slice(plain.length - width + 1)}` : '');

/** The colour codes still in effect at the end of `line`. */
export function activeSgr(line) {
  let active = '';
  for (const [token] of line.matchAll(TOKEN)) {
    if (SGR.test(token)) active = SGR_RESET.test(token) ? '' : active + token;
  }
  return active;
}

/**
 * Splits one line into rows no wider than `width`, breaking at a space where
 * it can. Colours in effect at a break are closed and reopened on the next row.
 */
export function wrapAnsi(line, width) {
  const rows = [];
  let tokens = [];
  let used = 0;
  let active = '';
  const text = (list) => list.map((t) => t.s).join('');

  for (const [s] of line.matchAll(TOKEN)) {
    if (s.length > 1 && s[0] === '\x1b') {
      if (SGR.test(s)) active = SGR_RESET.test(s) ? '' : active + s;
      tokens.push({ s, w: 0, active });
      continue;
    }
    const w = charWidth(s);
    if (used + w > width && used > 0) {
      let rest = [];
      if (s !== ' ') {
        let at = -1;
        for (let i = tokens.length - 1; i > 0; i--) {
          if (tokens[i].s === ' ') {
            at = i;
            break;
          }
        }
        // Only break at a space that leaves something on this row.
        if (at > 0 && tokens.slice(0, at).some((t) => t.w > 0 && t.s !== ' ')) {
          rest = tokens.slice(at + 1);
          tokens = tokens.slice(0, at);
        }
      }
      const carry = tokens.at(-1)?.active ?? '';
      rows.push(text(tokens) + (carry ? RESET : ''));
      tokens = carry ? [{ s: carry, w: 0, active: carry }, ...rest] : rest;
      used = rest.reduce((n, t) => n + t.w, 0);
      if (s === ' ') continue;
    }
    tokens.push({ s, w, active });
    used += w;
  }
  rows.push(text(tokens));
  return rows;
}

/** Cuts a row to `width` columns, keeping its colour codes intact. */
export function clipAnsi(row, width) {
  if (visibleLength(row) <= width) return row;
  let out = '';
  let used = 0;
  for (const [s] of row.matchAll(TOKEN)) {
    if (s.length > 1 && s[0] === '\x1b') {
      out += s;
      continue;
    }
    const w = charWidth(s);
    if (used + w > width) break;
    out += s;
    used += w;
  }
  return out + RESET;
}

/**
 * Wraps `text` into rows of at most `width` characters and locates the cursor.
 * @returns {{ rows: string[], starts: number[], cursorRow: number, cursorCol: number }}
 */
export function layout(text, cursor, width) {
  const rows = [];
  const starts = [];
  let cursorRow = 0;
  let cursorCol = 0;
  let offset = 0;
  for (const line of text.split('\n')) {
    let at = 0;
    do {
      const chunk = line.slice(at, at + width);
      const start = offset + at;
      const isLast = at + width >= line.length;
      if (cursor >= start && (cursor < start + chunk.length || (isLast && cursor === start + chunk.length))) {
        cursorRow = rows.length;
        cursorCol = cursor - start;
      }
      rows.push(chunk);
      starts.push(start);
      at += width;
    } while (at < line.length);
    offset += line.length + 1;
  }
  return { rows, starts, cursorRow, cursorCol };
}
