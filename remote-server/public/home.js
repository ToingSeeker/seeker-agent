// Home: the Control Center (what the agent is doing, the connection, the last 24 hours) and the
// Workspace Explorer (the open projects, and the folders on the Mac that can be opened).
// Plain data in, plain data out — no DOM — so the page and the tests run the same code.
// Every value comes from what the Mac reported; what it did not report is left out, never guessed.
import { STATUSES, statusOf } from './sessions.js';

const DAY = 24 * 60 * 60 * 1000;
const ORDER = Object.keys(STATUSES);
const lastOf = (items, test) => {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return items[i];
  return null;
};
const when = (ws) => ws.meta.lastAt ?? ws.items?.at(-1)?.at ?? 0;

/** Model text as one plain line: no fences, headings, list marks, emphasis or link syntax. The original is untouched. */
export function preview(text, max = 220) {
  const plain = String(text ?? '')
    .replace(/```[^\n]*\n?([\s\S]*?)(```|$)/g, ' $1 ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S(?:[^*_\n]*\S)?)[*_](?=\s|[.,;:!?]|$)/g, '$1$2')
    .replace(/^\s*\|?[-:| ]{3,}\|?\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/**
 * The session Home puts up front. One that is working (an approval first) is "current"; otherwise the
 * one used last is "recent". A session that has finished is never shown as current.
 */
export function current(workspaces) {
  const busy = workspaces.filter((w) => w.meta.status === 'approval' || w.meta.status === 'working');
  const rank = (w) => (w.meta.status === 'approval' ? 1 : 0);
  const pick = (list) => [...list].sort((a, b) => rank(b) - rank(a) || when(b) - when(a) || (a.meta.id < b.meta.id ? -1 : 1))[0];
  if (busy.length) return { ws: pick(busy), live: true };
  const used = workspaces.filter((w) => w.meta.outcome || w.items?.length);
  return used.length ? { ws: pick(used), live: false } : null;
}

/** What to say under the project's name: what it is doing now, or how the last task ended. */
export function summary(ws) {
  const { meta, items = [] } = ws;
  const status = statusOf(ws);
  if (status === 'approval') return 'Waiting for your approval.';
  if (status === 'running') return meta.activity ? preview(meta.activity) : '';
  if (status === 'failed') {
    const error = lastOf(items, (i) => i.kind === 'notice' && i.level === 'error');
    if (error?.text) return preview(error.text);
  }
  const answer = lastOf(items, (i) => i.kind === 'assistant' && i.text);
  if (answer) return preview(answer.text);
  const asked = lastOf(items, (i) => i.kind === 'user' && i.text);
  return asked ? preview(asked.text) : '';
}

/**
 * The link to the Mac, in one word. `everLinked` tells a first connection from one that dropped.
 * Only a Mac that is connected right now is called online.
 */
export function connection({ linked, online, everLinked }) {
  if (linked && online) return { key: 'online', label: 'Online', tone: 'success' };
  if (linked) return { key: 'offline', label: 'Offline', tone: 'danger' };
  return everLinked ? { key: 'reconnecting', label: 'Reconnecting', tone: 'warning' } : { key: 'connecting', label: 'Connecting', tone: 'warning' };
}

/**
 * The last 24 hours, counted from the conversations themselves:
 *   sessions  — projects where anything happened;
 *   tools     — tool runs that started (`toolsMore` when a long conversation no longer holds them all);
 *   completed — projects whose latest task ended completed.
 */
export function activity(workspaces, now = Date.now()) {
  const from = now - DAY;
  const out = { sessions: 0, tools: 0, toolsMore: false, completed: 0 };
  for (const ws of workspaces) {
    const items = ws.items ?? [];
    const recent = items.filter((i) => i.at >= from);
    if (recent.length || when(ws) >= from) out.sessions += 1;
    out.tools += recent.filter((i) => i.kind === 'tool').length;
    // The Mac keeps only the latest part of a long conversation. If what is held starts inside the
    // window and the Mac has counted more tool runs than are held, some of them cannot be seen here.
    const held = items.filter((i) => i.kind === 'tool').length;
    if (items.length && items[0].at >= from && typeof ws.meta.tools?.total === 'number' && ws.meta.tools.total > held) out.toolsMore = true;
    if (ws.meta.outcome === 'completed' && ws.meta.status === 'idle' && when(ws) >= from) out.completed += 1;
  }
  return out;
}

// ── Workspace Explorer ──

export const WORKSPACE_SORTS = [
  ['recent', 'Recently active'],
  ['az', 'Name A–Z'],
  ['za', 'Name Z–A'],
  ['status', 'Status'],
];
export const SOURCES = [
  ['all', 'All workspaces'],
  ['remote', 'Opened for the phone'],
  ['terminal', 'Terminal sessions'],
];

const words = (query) => String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const has = (text, query) => {
  const lower = text.toLowerCase();
  return words(query).every((word) => lower.includes(word));
};
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const COMPARE = {
  recent: (a, b) => b.at - a.at || byName(a, b),
  az: byName,
  za: (a, b) => byName(b, a),
  status: (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.at - a.at || byName(a, b),
};

/** The open projects, searched by name, folder and branch, from one source, in one order. */
export function workspaces(list, { query = '', sort = 'recent', source = 'all' } = {}) {
  return list
    .map((ws) => ({ id: ws.meta.id, name: ws.meta.name ?? '', path: ws.meta.path ?? '', branch: ws.meta.branch ?? '', terminal: Boolean(ws.meta.terminal), status: statusOf(ws), at: when(ws) }))
    .filter((row) => source === 'all' || (source === 'terminal') === row.terminal)
    .filter((row) => has([row.name, row.path, row.branch].join('\n'), query))
    .sort(COMPARE[sort] ?? COMPARE.recent);
}

/** Folders the Mac found that are not open yet. `total` is how many there are before the search. */
export function localFolders(folders, list, query = '') {
  const opened = new Set(list.map((ws) => ws.meta.path));
  const rest = [...new Set(folders)].filter((folder) => !opened.has(folder));
  return { total: rest.length, rows: rest.filter((folder) => has(folder, query)).map((folder) => ({ path: folder, name: folder.replace(/\/+$/, '').split('/').pop() || folder })) };
}
