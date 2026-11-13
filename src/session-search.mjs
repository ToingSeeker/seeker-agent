// Search and read past conversations, so the agent can recall what was done in
// an earlier session instead of asking the user to repeat it. SEEKER keeps one
// JSON file per conversation, so this scans those files directly — no database, and nothing to keep in sync.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';

const SESSIONS_DIR = path.join(HOME_DIR, 'sessions');
// The newest conversations are searched; older ones than this are out of reach.
const MAX_FILES = 600;
const MAX_FILE_BYTES = 30_000_000;
const BOOKEND = 3;
const BOOKEND_CHARS = 1200;
const WINDOW_CHARS = 4000;
const READ_CHARS = 2000;
const SNIPPET_RADIUS = 160;

/** Every saved conversation, newest first: { id, file, mtime }. The id is `<folder>/<name>`. */
export function sessionFiles(dir = SESSIONS_DIR) {
  const found = [];
  let folders = [];
  try {
    folders = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
  for (const folder of folders) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(dir, folder.name)).filter((n) => n.endsWith('.json'));
    } catch {}
    for (const name of names) {
      const file = path.join(dir, folder.name, name);
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (stat && stat.size <= MAX_FILE_BYTES) found.push({ id: `${folder.name}/${name.slice(0, -5)}`, file, mtime: stat.mtimeMs });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES);
}

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data.messages) ? data : null;
  } catch {
    return null;
  }
}

/** The text of one message as it is searched and shown: its words, plus the tools it called. */
function textOf(m) {
  const calls = (m.tool_calls ?? []).map((c) => `[called ${c.function?.name ?? '?'} ${JSON.stringify(c.function?.arguments ?? {})}]`).join(' ');
  return [typeof m.content === 'string' ? m.content : '', calls].filter(Boolean).join(' ').trim();
}

const cap = (text, max) => (text.length > max ? `${text.slice(0, max)}… [${text.length - max} more characters]` : text);
const shown = (m, i, max) => ({ index: i, role: m.role === 'tool' ? `tool:${m.tool_name ?? ''}` : m.role, text: cap(textOf(m), max) });

/**
 * Reads a query into groups of terms: terms in a group must all be present, and any group
 * may match ("alpha beta OR gamma" = (alpha AND beta) OR gamma). Quoted phrases stay whole,
 * `-word` or `NOT word` excludes, and `deploy*` matches a prefix.
 */
export function parseQuery(query) {
  const groups = [[]];
  const exclude = [];
  let negate = false;
  for (const m of String(query).matchAll(/"([^"]+)"|(\S+)/g)) {
    const phrase = m[1];
    let word = m[2];
    if (!phrase) {
      if (word === 'OR') {
        if (groups.at(-1).length) groups.push([]);
        continue;
      }
      if (word === 'AND') continue;
      if (word === 'NOT') {
        negate = true;
        continue;
      }
      if (word.startsWith('-') && word.length > 1) {
        negate = true;
        word = word.slice(1);
      }
    }
    const term = (phrase ?? word.replace(/\*$/, '')).toLowerCase();
    if (!term) continue;
    if (negate) exclude.push(term);
    else groups.at(-1).push(term);
    negate = false;
  }
  return { groups: groups.filter((g) => g.length), exclude };
}

/** A date given as ISO text or as "7d" / "24h" / "2w" ago. */
function parseWhen(value) {
  if (!value) return null;
  const relative = /^(\d+)\s*([hdw])$/i.exec(String(value).trim());
  if (relative) return Date.now() - Number(relative[1]) * { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[relative[2].toLowerCase()];
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

const titleOf = (data) => (data.messages.find((m) => m.role === 'user' && !m.compacted)?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(untitled)';
const meta = (entry, data) => ({ session_id: entry.id, when: new Date(data.savedAt ?? entry.mtime).toISOString(), folder: data.cwd ?? null, model: data.model ?? null, title: titleOf(data), message_count: data.messages.length });

function snippet(text, terms) {
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return cap(text, SNIPPET_RADIUS * 2);
  const from = Math.max(0, at - SNIPPET_RADIUS);
  const to = Math.min(text.length, at + SNIPPET_RADIUS);
  return `${from > 0 ? '...' : ''}${text.slice(from, to).replace(/\s+/g, ' ')}${to < text.length ? '...' : ''}`;
}

function discover({ query, limit, sort, detail, after, before, roles, exclude: skipIds, currentFile, dir }) {
  const { groups, exclude } = parseQuery(query);
  if (!groups.length) return { success: false, error: 'The query has no search terms.' };
  const from = parseWhen(after);
  const until = parseWhen(before);
  const hits = [];
  let searched = 0;
  for (const entry of sessionFiles(dir)) {
    if (entry.file === currentFile || skipIds.has(entry.id)) continue;
    if ((from && entry.mtime < from) || (until && entry.mtime > until)) continue;
    searched++;
    // A cheap look at the raw file first: most conversations do not mention the terms at all.
    let raw;
    try {
      raw = fs.readFileSync(entry.file, 'utf8').toLowerCase();
    } catch {
      continue;
    }
    if (!groups.some((g) => g.every((t) => raw.includes(t)))) continue;
    const data = load(entry.file);
    if (!data) continue;
    let best = null;
    let score = 0;
    data.messages.forEach((m, i) => {
      const role = m.role === 'tool' ? 'tool' : m.role;
      if (!roles.has(role) || m.compacted) return;
      const text = textOf(m).toLowerCase();
      if (!text || exclude.some((t) => text.includes(t))) return;
      const group = groups.find((g) => g.every((t) => text.includes(t)));
      if (!group) return;
      // More mentions in a shorter message rank higher, as BM25 would have it.
      const count = group.reduce((n, t) => n + (text.split(t).length - 1), 0);
      const points = count / Math.log2(8 + text.length / 200);
      score += points;
      if (!best || points > best.points) best = { index: i, points, terms: group };
    });
    if (best) hits.push({ entry, data, best, score });
  }
  if (!hits.length) {
    return { success: true, results: [], sessions_searched: searched, message: 'No matching sessions found. All terms must appear in one message by default — broaden with OR (`alpha OR beta`), exact-match with quoted phrases, exclude with NOT, or prefix-match with `deploy*`.' };
  }
  if (sort === 'newest') hits.sort((a, b) => b.entry.mtime - a.entry.mtime);
  else if (sort === 'oldest') hits.sort((a, b) => a.entry.mtime - b.entry.mtime);
  else hits.sort((a, b) => b.score - a.score || b.entry.mtime - a.entry.mtime);

  const results = hits.slice(0, limit).map(({ entry, data, best }, rank) => {
    const { messages } = data;
    const hit = messages[best.index];
    const result = { ...meta(entry, data), matched_role: hit.role, match_message_index: best.index, snippet: snippet(textOf(hit), best.terms) };
    // Only the best match is opened up in full; the rest say where to look.
    if (rank === 0 || detail === 'full') {
      const real = messages.map((m, i) => [m, i]).filter(([m]) => !m.compacted);
      result.bookend_start = real.slice(0, BOOKEND).map(([m, i]) => shown(m, i, BOOKEND_CHARS));
      result.messages = messages.map((m, i) => [m, i]).slice(Math.max(0, best.index - 5), best.index + 6).map(([m, i]) => shown(m, i, WINDOW_CHARS));
      result.bookend_end = real.slice(-BOOKEND).map(([m, i]) => shown(m, i, BOOKEND_CHARS));
      result.detail = 'full';
    } else {
      result.messages = [shown(hit, best.index, WINDOW_CHARS)];
      result.detail = 'anchor';
    }
    result.messages_before = best.index;
    result.messages_after = messages.length - best.index - 1;
    return result;
  });
  return { success: true, results, sessions_searched: searched, hint: 'To read more of one, call session_search with its session_id (and around_message_index to scroll).' };
}

function find(id, dir) {
  const wanted = String(id).replace(/\.json$/, '');
  return sessionFiles(dir).find((e) => e.id === wanted || e.id.endsWith(`/${wanted}`)) ?? null;
}

/**
 * The tool's four shapes, picked by which arguments are given:
 *   query                              discovery: the best matching conversations
 *   session_id                         read one conversation (its start and its end)
 *   session_id + around_message_index  scroll: a window of messages around one
 *   (nothing)                          browse the most recent conversations
 * @param {object} args
 * @param {{ currentFile?: string|null, dir?: string }} ctx
 */
export function searchSessions(args, { currentFile = null, dir = SESSIONS_DIR } = {}) {
  const limit = Math.min(10, Math.max(1, Number(args.limit) || (args.query ? 3 : 10)));

  if (args.session_id) {
    const entry = find(args.session_id, dir);
    const data = entry && load(entry.file);
    if (!data) return { success: false, error: `No saved session "${args.session_id}". Call session_search with no arguments to list recent ones.` };
    const { messages } = data;
    if (args.around_message_index !== undefined && args.around_message_index !== null) {
      const around = Math.min(messages.length - 1, Math.max(0, Number(args.around_message_index) || 0));
      const window = Math.min(20, Math.max(1, Number(args.window) || 5));
      const from = Math.max(0, around - window);
      const to = Math.min(messages.length, around + window + 1);
      return {
        success: true,
        ...meta(entry, data),
        messages: messages.slice(from, to).map((m, i) => shown(m, from + i, WINDOW_CHARS)),
        messages_before: from,
        messages_after: messages.length - to,
        hint: 'Scroll forward: call again with around_message_index = the LAST index shown; backward: the FIRST index shown.',
      };
    }
    const head = messages.slice(0, 20).map((m, i) => shown(m, i, READ_CHARS));
    const tailFrom = Math.max(20, messages.length - 10);
    const tail = messages.slice(tailFrom).map((m, i) => shown(m, tailFrom + i, READ_CHARS));
    return { success: true, ...meta(entry, data), messages: [...head, ...tail], omitted_in_the_middle: Math.max(0, tailFrom - 20), hint: 'To see the omitted part, pass around_message_index.' };
  }

  if (typeof args.query === 'string' && args.query.trim()) {
    const roles = new Set(String(args.role_filter || 'user,assistant').split(',').map((r) => r.trim().toLowerCase()).filter(Boolean));
    const exclude = new Set((Array.isArray(args.exclude_session_ids) ? args.exclude_session_ids : []).slice(0, 20).map(String));
    return discover({ query: args.query, limit, sort: args.sort, detail: args.detail, after: args.after, before: args.before, roles, exclude, currentFile, dir });
  }

  const recent = [];
  for (const entry of sessionFiles(dir)) {
    if (entry.file === currentFile) continue;
    const data = load(entry.file);
    if (data?.messages.length) recent.push(meta(entry, data));
    if (recent.length >= limit) break;
  }
  return { success: true, recent_sessions: recent, hint: 'Pass a query to search, or a session_id to read one.' };
}
