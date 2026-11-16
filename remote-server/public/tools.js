// A session's Tools tab: which kind a tool step is, and which steps a filter leaves.
// Plain data in, plain data out — no DOM — so the same code runs in the page and in the tests.
// A step's kind is read from the verb it was announced with (src/tools.mjs and, for the
// Claude Code engine, src/external-tools.mjs); both name the same work with the same verbs.

const KINDS = {
  edits: ['Editing', 'Writing'],
  commands: ['Running', 'Stopping process', 'Checking process'],
  reads: ['Reading', 'Finding', 'Searching for', 'Listing'],
};

/** The filters, in the order they are offered. */
export const TOOL_FILTERS = [
  ['all', 'All', () => true],
  ['failed', 'Failed', (t) => t.state === 'failed'],
  ['edits', 'Edits', (t) => KINDS.edits.includes(t.doing)],
  ['commands', 'Commands', (t) => KINDS.commands.includes(t.doing)],
  ['reads', 'Reads', (t) => KINDS.reads.includes(t.doing)],
];

/**
 * The filters to show for these tool steps, each with how many steps it holds. One that holds none
 * is left out — except "All", and the one chosen, so the choice never disappears from under the finger.
 */
export function toolFilters(tools, chosen = 'all') {
  return TOOL_FILTERS.map(([id, label, test]) => ({ id, label, count: tools.filter(test).length, active: id === chosen })).filter((f) => f.id === 'all' || f.count > 0 || f.active);
}

/** The steps the chosen filter leaves, in the order they happened. An unknown filter leaves them all. */
export function filterTools(tools, chosen = 'all') {
  const [, , test] = TOOL_FILTERS.find(([id]) => id === chosen) ?? TOOL_FILTERS[0];
  return tools.filter(test);
}

/** The filter's name, for the line shown when it leaves nothing. */
export const filterLabel = (chosen) => (TOOL_FILTERS.find(([id]) => id === chosen) ?? TOOL_FILTERS[0])[1];
