// The Sessions list: what each row says, and which rows are shown in what order.
// Plain data in, plain data out — no DOM — so the same code runs in the page and in the tests.
// Every value comes from what the Mac reported for a workspace; nothing is filled in here.

/** The states a session can be listed under, in the order "Status" sorts them: what needs the user first. */
export const STATUSES = {
  approval: { label: 'Approval needed', filter: 'Approval', tone: 'primary', live: true },
  running: { label: 'Executing', filter: 'Running', tone: 'execution', live: true },
  queued: { label: 'Queued', filter: 'Queued', tone: 'warning' },
  failed: { label: 'Failed', filter: 'Failed', tone: 'danger' },
  stopped: { label: 'Stopped', filter: 'Stopped', tone: 'muted' },
  completed: { label: 'Completed', filter: 'Completed', tone: 'success' },
  idle: { label: 'Idle', filter: 'Idle', tone: 'muted' },
};
const ORDER = Object.keys(STATUSES);

/** Filters offered even when no session is in that state; the others appear once one is. */
const ALWAYS = ['running', 'completed', 'idle'];

export const SORTS = [
  ['recent', 'Last activity, newest first'],
  ['oldest', 'Last activity, oldest first'],
  ['name', 'Project name'],
  ['status', 'Status'],
];

export function statusOf({ meta, queue }) {
  if (meta.status === 'approval') return 'approval';
  if (meta.status === 'working') return 'running';
  // Instructions that wait while nothing runs: the queue is paused until the user resumes it.
  if (queue?.items?.length) return 'queued';
  return ['failed', 'stopped', 'completed'].includes(meta.outcome) ? meta.outcome : 'idle';
}

const lastUser = (items) => {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'user' && items[i].text) return items[i];
  return null;
};

/** One row of the list. `tools` is null when the Mac has not counted them, and is then left out. */
export function describe(ws) {
  const { meta, items = [] } = ws;
  const asked = lastUser(items);
  const counted = typeof meta.tools?.total === 'number' ? meta.tools.total : items.length ? items.filter((i) => i.kind === 'tool').length : null;
  return {
    id: meta.id,
    name: meta.name ?? '',
    path: meta.path ?? '',
    status: statusOf(ws),
    task: asked ? asked.text.replace(/\s+/g, ' ').trim() : '',
    model: meta.model ?? '',
    tools: counted,
    at: meta.lastAt ?? items.at(-1)?.at ?? 0,
  };
}

/** Every word typed must appear somewhere in the project, its folder, the latest instruction, the model or the id. */
export function matches(row, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [row.name, row.path, row.task, row.model, row.id].join('\n').toLowerCase();
  return words.every((word) => text.includes(word));
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const COMPARE = {
  recent: (a, b) => b.at - a.at || byName(a, b),
  oldest: (a, b) => a.at - b.at || byName(a, b),
  name: byName,
  status: (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.at - a.at || byName(a, b),
};

export const sorted = (rows, sort) => [...rows].sort(COMPARE[sort] ?? COMPARE.recent);

/** How many sessions are in each state, counted over everything the search left in. */
export function counts(rows) {
  const out = { all: rows.length };
  for (const key of ORDER) out[key] = 0;
  for (const row of rows) out[row.status] += 1;
  return out;
}

/** The filter chips to draw: All, the usual three, and any other state that has a session (or is selected). */
export function filters(count, selected) {
  return [['all', 'All', count.all], ...ORDER.filter((key) => ALWAYS.includes(key) || count[key] > 0 || key === selected).map((key) => [key, STATUSES[key].filter, count[key]])];
}

/** What the list shows for this search, filter and order — and the counts for the chips. */
export function view(workspaces, { query = '', filter = 'all', sort = 'recent' } = {}) {
  const found = workspaces.map(describe).filter((row) => matches(row, query));
  const count = counts(found);
  return { rows: sorted(filter === 'all' ? found : found.filter((row) => row.status === filter), sort), count, total: workspaces.length };
}

/** "Just now", "1m ago", "12h ago", "Yesterday", "3d ago". Empty when the session has never been used. */
export function since(at, now = Date.now()) {
  if (!at) return '';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return 'Yesterday';
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ── the quick switcher: every session at a glance, the ones that need the user first ──

/** Waiting for the user, then working, then waiting instructions, then how the last task ended. */
const SWITCH_ORDER = ['approval', 'running', 'queued', 'completed', 'failed', 'stopped', 'idle'];
export const SWITCH_LIMIT = 8; // rows in the sheet; the Sessions screen has the rest

/**
 * What the switcher shows. `up` is whether the Mac is connected right now: when it is not, a
 * session that was working is not called running, and nothing is counted as running.
 *   running  — sessions with a task executing now (one waiting for approval is not executing);
 *   queued   — instructions waiting, over all sessions.
 */
export function switcher(workspaces, { up = true } = {}) {
  const rows = workspaces.map((ws) => {
    const status = statusOf(ws);
    const live = Boolean(STATUSES[status].live);
    const waiting = ws.queue?.items?.length ?? 0;
    const thinking = status === 'running' && ws.meta.phase === 'thinking';
    return {
      id: ws.meta.id,
      name: ws.meta.name ?? '',
      branch: ws.meta.branch ?? '',
      provider: ws.meta.provider ?? '',
      terminal: Boolean(ws.meta.terminal),
      status,
      // The word and colour on the row. Thinking is the model reasoning; an unconfirmed state says so.
      label: live && !up ? 'Disconnected' : thinking ? 'Thinking' : status === 'running' ? 'Running' : STATUSES[status].label,
      tone: live && !up ? 'muted' : thinking ? 'reasoning' : STATUSES[status].tone,
      live: live && up,
      doing: status === 'running' && up ? String(ws.meta.activity ?? '').replace(/\s+/g, ' ').trim() : '',
      waiting,
      at: ws.meta.lastAt ?? ws.items?.at(-1)?.at ?? 0,
    };
  });
  rows.sort((a, b) => SWITCH_ORDER.indexOf(a.status) - SWITCH_ORDER.indexOf(b.status) || b.at - a.at || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    rows: rows.slice(0, SWITCH_LIMIT),
    more: Math.max(0, rows.length - SWITCH_LIMIT),
    sessions: rows.length,
    running: up ? rows.filter((r) => r.status === 'running').length : 0,
    queued: rows.reduce((sum, r) => sum + r.waiting, 0),
  };
}

/** The waiting instructions of every session that has some, in the switcher's order. */
export function queues(workspaces) {
  return workspaces
    .filter((ws) => ws.queue?.items?.length)
    .map((ws) => ({ id: ws.meta.id, name: ws.meta.name ?? '', paused: ws.queue.paused ?? null, busy: ws.meta.status !== 'idle', items: ws.queue.items.map(({ id, text }) => ({ id, text })) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1));
}
