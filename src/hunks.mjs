// What an edit changes, line by line, for the terminal: which lines go, which come, the lines
// around them, and the number each has in the file. No drawing here.

const LCS_CELLS = 250_000; // above this the lines between the common start and end are shown as one block

/** The steps from `before` to `after`: ' ' a line kept, '-' a line removed, '+' a line added. */
export function lineDiff(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endA = before.length;
  let endB = after.length;
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) (endA--, endB--);
  const a = before.slice(start, endA);
  const b = after.slice(start, endB);
  const kept = (lines) => lines.map((text) => ({ kind: ' ', text }));
  const middle = [];
  if (a.length * b.length > LCS_CELLS) {
    middle.push(...a.map((text) => ({ kind: '-', text })), ...b.map((text) => ({ kind: '+', text })));
  } else {
    // Longest common subsequence, filled from the end so the walk below runs forward.
    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) (middle.push({ kind: ' ', text: a[i] }), i++, j++);
      else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) middle.push({ kind: '-', text: a[i++] });
      else middle.push({ kind: '+', text: b[j++] });
    }
  }
  return [...kept(before.slice(0, start)), ...middle, ...kept(before.slice(endA))];
}

/**
 * The rows to show for a change: every changed line with `context` unchanged lines around it,
 * numbered as in the file (a removed line by its old number, the others by their new one).
 * `{ gap: true }` stands for unchanged lines left out between two changes. At most `limit` rows;
 * `hidden` is how many changed lines did not fit.
 * @param {string[]} before  the lines as they are
 * @param {string[]} after   the lines as they will be
 * @param {{ first?: number, context?: number, limit?: number }} [opts]  `first`: the file's number of the first line given
 */
export function hunkRows(before, after, { first = 1, context = 3, limit = 40 } = {}) {
  const steps = lineDiff(before, after);
  let was = first;
  let now = first;
  const numbered = steps.map((step) => ({ ...step, n: step.kind === '-' ? was++ : (step.kind === ' ' && was++, now++) }));
  const near = new Uint8Array(numbered.length);
  numbered.forEach((step, i) => {
    if (step.kind !== ' ') for (let k = Math.max(0, i - context); k <= Math.min(numbered.length - 1, i + context); k++) near[k] = 1;
  });
  const rows = [];
  let hidden = 0;
  let last = -1;
  numbered.forEach((step, i) => {
    if (!near[i]) return;
    if (rows.length >= limit) return void (step.kind !== ' ' && hidden++);
    if (last >= 0 && i > last + 1) rows.push({ gap: true });
    rows.push(step);
    last = i;
  });
  return { rows, hidden, added: steps.filter((s) => s.kind === '+').length, removed: steps.filter((s) => s.kind === '-').length };
}
