// Persistent memory the agent writes itself: small, bounded stores of facts that
// are put into the system prompt of every later session: entries separated by "§", a hard
// character budget per store, batched all-or-nothing updates, and a scan that
// keeps instructions and secrets out of text that will be read as context.
//
//   ~/.seeker/memories/MEMORY.md             notes about the environment (all projects)
//   ~/.seeker/memories/USER.md               who the user is
//   ~/.seeker/memories/projects/<folder>.md  notes about one project folder
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR, projectSlug } from './config.mjs';

export const ENTRY_DELIMITER = '\n§\n';
export const MEMORIES_DIR = path.join(HOME_DIR, 'memories');
// A turn that fails to fit its facts this many times stops trying; the fact can be saved later.
const MAX_FAILURES_PER_TURN = 3;

export const STORES = {
  memory: { limit: 2200, title: 'MEMORY (your personal notes)', file: () => path.join(MEMORIES_DIR, 'MEMORY.md'), label: 'MEMORY.md' },
  user: { limit: 1375, title: 'USER PROFILE (who the user is)', file: () => path.join(MEMORIES_DIR, 'USER.md'), label: 'USER.md' },
  project: { limit: 2200, title: 'PROJECT NOTES (this folder)', file: (cwd) => path.join(MEMORIES_DIR, 'projects', `${projectSlug(cwd)}.md`), label: 'project notes' },
};

// ── Threat scan ────────────────────────────────────────────────────────────
// Memory is read back as part of the system prompt, so a saved "fact" that is
// really an instruction, or that carries a secret, is refused.

const INVISIBLE = /[​-‍⁠⁢-⁤﻿‪-‮⁦-⁩]/;
const THREATS = [
  ['prompt_injection', /ignore\s+(?:\w+\s+){0,8}(previous|all|above|prior)\s+(?:\w+\s+){0,8}instructions/i],
  ['disregard_rules', /disregard\s+(?:\w+\s+){0,6}(your|all|any|the)\s+(?:\w+\s+){0,6}(instructions|rules|guidelines)/i],
  ['sys_prompt_override', /(new|updated|revised)\s+system\s+prompt|system\s+prompt\s+override/i],
  ['bypass_restrictions', /(bypass|circumvent|disable|turn\s+off)\s+(?:\w+\s+){0,6}(restrictions|safety|guardrails|filters|approval|permission)/i],
  ['role_hijack', /you\s+are\s+now\s+(?:\w+\s+){0,6}(an?|the)\s+\w+|from\s+now\s+on\s+you\s+(are|will\s+act)/i],
  ['deception_hide', /do\s+not\s+(tell|inform|mention\s+to|reveal\s+to)\s+the\s+user/i],
  ['leak_system_prompt', /(reveal|print|output|repeat|show)\s+(?:\w+\s+){0,6}system\s+prompt/i],
  ['html_comment_injection', /<!--[\s\S]{0,400}(ignore|instruction|system|override)[\s\S]{0,400}-->/i],
  ['exfil_curl', /(curl|wget)\s+[^\n]{0,2048}\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b/i],
  ['read_secrets', /cat\s+[^\n]{0,2048}(\.env\b|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i],
  ['send_to_url', /(send|post|upload|transmit)\s+[^\n]{0,2048}\s+(to|at)\s+https?:\/\//i],
  ['ssh_backdoor', /authorized_keys/i],
  ['agent_config_mod', /\.seeker\/config\.json|\.seeker\/SEEKER\.md/i],
  // A value written out in full; the name of an environment variable (SHOUTY_SNAKE) is not a secret.
  ['hardcoded_secret', /(?:api[_-]?key|token|secret|password)\s*[=:]\s*["']?([A-Za-z0-9+/=_-]{20,})/i, (m) => !/^[A-Z][A-Z0-9_]+$/.test(m[1])],
  ['hardcoded_secret', /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/],
];

// Patterns about secrets and config paths: right for memory, wrong for a project's own
// instruction file, which may well explain where its .env lives.
const STRICT_ONLY = new Set(['exfil_curl', 'read_secrets', 'send_to_url', 'ssh_backdoor', 'agent_config_mod', 'hardcoded_secret']);

/**
 * The id of the first threat pattern `text` matches, or null.
 * @param {'strict'|'context'} scope  'strict' for text the agent stores itself; 'context' for files a project brings along
 */
export function scanThreats(text, scope = 'strict') {
  const sample = String(text).slice(0, 65_536).normalize('NFKC');
  if (INVISIBLE.test(String(text).replace(/^\uFEFF/, ''))) return 'invisible_unicode';
  for (const [id, pattern, confirm] of THREATS) {
    if (scope === 'context' && STRICT_ONLY.has(id) && id !== 'exfil_curl') continue;
    const match = pattern.exec(sample);
    if (match && (!confirm || confirm(match))) return id;
  }
  return null;
}

// ── Store ──────────────────────────────────────────────────────────────────

export const parseEntries = (text) => [...new Set(text.replace(/^﻿/, '').split(ENTRY_DELIMITER).map((e) => e.trim()).filter(Boolean))];
const size = (entries) => entries.join(ENTRY_DELIMITER).length;

export function readStore(target, cwd) {
  try {
    return parseEntries(fs.readFileSync(STORES[target].file(cwd), 'utf8'));
  } catch {
    return [];
  }
}

function writeStore(target, cwd, entries) {
  const file = STORES[target].file(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, entries.length ? `${entries.join(ENTRY_DELIMITER)}\n` : '', { mode: 0o600 });
  fs.renameSync(temp, file);
}

export const usage = (target, entries) => {
  const { limit } = STORES[target];
  const used = size(entries);
  return `${Math.round((used / limit) * 100)}% — ${used.toLocaleString('en-US')}/${limit.toLocaleString('en-US')} chars`;
};

// Curly quotes, the various dashes and runs of whitespace are folded, so text a model re-typed still matches.
const fold = (text) => text.replace(/[‘’“”`"]/g, "'").replace(/[‐-―−]/g, '-').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();

/** Indexes of the entries `oldText` refers to: a whole-entry match, else a substring, else a folded substring. */
function findEntries(entries, oldText) {
  const exact = entries.flatMap((e, i) => (e === oldText.trim() ? [i] : []));
  if (exact.length) return exact;
  const inside = entries.flatMap((e, i) => (e.includes(oldText) ? [i] : []));
  if (inside.length) return inside;
  const wanted = fold(oldText);
  return wanted ? entries.flatMap((e, i) => (fold(e).includes(wanted) ? [i] : [])) : [];
}

function closest(entries, text) {
  const words = new Set(fold(text).toLowerCase().split(' ').filter((w) => w.length > 2));
  if (!words.size) return [];
  return entries
    .map((entry) => ({ entry, share: fold(entry).toLowerCase().split(' ').filter((w) => words.has(w)).length / words.size }))
    .filter((x) => x.share >= 0.3)
    .sort((a, b) => b.share - a.share)
    .slice(0, 3)
    .map((x) => x.entry);
}

class Refused extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.extra = extra;
  }
}

/** Applies one operation to a copy of the entries. Throws Refused with the reason. */
function applyOne(entries, op, index) {
  const at = `operations[${index}]`;
  const action = String(op?.action ?? '').toLowerCase();
  const content = typeof (op.content ?? op.new_text) === 'string' ? (op.content ?? op.new_text).trim() : '';
  const oldText = typeof op.old_text === 'string' ? op.old_text.trim() : '';

  if (action === 'replace') {
    throw new Refused("'replace' is not available; use 'patch'. old_text is the exact span to change and content is its new text; the rest of the entry is kept. To rewrite a whole entry, set old_text to the whole entry. Nothing was written.");
  }
  if (!['add', 'patch', 'remove'].includes(action)) throw new Refused(`${at}: action must be add, patch or remove.`);

  if (action === 'add') {
    if (!content) throw new Refused(`${at}: 'add' needs content.`);
    if (content.includes('§')) throw new Refused(`${at}: an entry may not contain the "§" character; it separates entries.`);
    const threat = scanThreats(content);
    if (threat) throw new Refused(`Blocked: content matches threat pattern '${threat}'. Content is injected into the system prompt and must not contain injection or exfiltration payloads.`);
    if (entries.includes(content)) return { entries, note: 'Entry already exists (no duplicate added).' };
    return { entries: [...entries, content] };
  }

  if (!oldText) throw new Refused(`${at}: '${action}' needs old_text — text from the entry to ${action === 'patch' ? 'change' : 'delete'}.`);
  const matches = findEntries(entries, oldText);
  if (!matches.length) throw new Refused(`${at}: no entry contains that old_text. Nothing was written.`, { closest_entries: closest(entries, oldText) });
  if (matches.length > 1) throw new Refused(`${at}: old_text matches ${matches.length} different entries. Quote more of the one you mean.`, { matching_entries: matches.map((i) => entries[i]) });
  const target = matches[0];

  if (action === 'remove') return { entries: entries.filter((_, i) => i !== target) };

  if (!content && op.content === undefined && op.new_text === undefined) throw new Refused(`${at}: 'patch' needs content — the text that replaces old_text.`);
  const entry = entries[target];
  const span = entry.includes(oldText) ? oldText : entry === oldText ? oldText : null;
  let next;
  if (span !== null) {
    if (entry.split(span).length - 1 > 1) throw new Refused(`${at}: old_text occurs more than once in that entry. Quote a longer span, or the whole entry.`);
    next = entry.replace(span, () => content);
  } else {
    // Matched only after folding quotes and spaces: the whole entry is replaced rather than guessing the span.
    next = content;
  }
  next = next.trim();
  if (!next) throw new Refused(`${at}: the patch would leave the entry empty. Use 'remove' to delete an entry.`);
  if (next === entry) throw new Refused(`${at}: the patch changes nothing.`);
  if (next.includes('§')) throw new Refused(`${at}: an entry may not contain the "§" character.`);
  const threat = scanThreats(next);
  if (threat) throw new Refused(`Blocked: content matches threat pattern '${threat}'. Content is injected into the system prompt and must not contain injection or exfiltration payloads.`);
  return { entries: entries.map((e, i) => (i === target ? next : e)) };
}

/**
 * Applies a batch of operations to one store, all or nothing. The character budget is
 * checked on the final result only, so one call can remove stale entries and add new ones.
 * @param {object} args  { target, operations } — or a single { target, action, content, old_text }
 * @param {{ cwd: string, turn?: { memoryFailures?: number }, addOnly?: boolean }} ctx
 * @returns {object} what the model is told (JSON-serialisable)
 */
export function updateMemory(args, { cwd, turn = {}, addOnly = false }) {
  const target = String(args.target ?? 'memory').toLowerCase();
  const store = STORES[target];
  if (!store) return { success: false, error: "target must be 'memory', 'user' or 'project'." };

  let operations = args.operations;
  if (typeof operations === 'string') {
    try {
      operations = JSON.parse(operations);
    } catch {
      operations = null;
    }
  }
  if (!Array.isArray(operations) && args.action) operations = [{ action: args.action, content: args.content ?? args.new_text, old_text: args.old_text }];
  if (!Array.isArray(operations) || !operations.length) return { success: false, error: "Pass 'operations': an array of { action: add|patch|remove, content?, old_text? }." };

  if ((turn.memoryFailures ?? 0) > MAX_FAILURES_PER_TURN) {
    return { success: false, done: true, error: `Memory consolidation failed ${turn.memoryFailures} times this turn. Stop retrying memory calls — leave memory unchanged for now and continue with your reply to the user. The fact can be saved in a later turn.` };
  }
  const fail = (error, extra = {}) => {
    turn.memoryFailures = (turn.memoryFailures ?? 0) + 1;
    return { success: false, error, ...extra };
  };
  if (addOnly && operations.some((op) => String(op?.action).toLowerCase() !== 'add')) {
    return fail("This unattended review may only 'add' entries; changing or removing existing memory is left to a turn the user can see.");
  }

  const before = readStore(target, cwd);
  let entries = before;
  const notes = [];
  try {
    operations.forEach((op, i) => {
      const result = applyOne(entries, op ?? {}, i);
      entries = result.entries;
      if (result.note) notes.push(result.note);
    });
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    return fail(err.message, err.extra);
  }

  const used = size(entries);
  const grew = used > size(before);
  if (used > store.limit && grew) {
    const over = used - store.limit;
    return fail(
      `Memory at ${size(before).toLocaleString('en-US')}/${store.limit.toLocaleString('en-US')} chars; this change would exceed the limit by ${over.toLocaleString('en-US')} chars. Retry as ONE 'operations' batch that removes or shortens (patch) stale entries from current_entries below to free at least ${over.toLocaleString('en-US')} chars AND adds this entry — the limit is checked only on the batch result.`,
      { current_entries: before, usage: usage(target, before) },
    );
  }
  if (before.length && !entries.length && operations.length > 1) return fail('This batch would empty the store. Remove entries one call at a time if that is really intended.');

  const changed = entries.length !== before.length || entries.some((e, i) => e !== before[i]);
  if (changed) writeStore(target, cwd, entries);
  turn.memoryWrites = (turn.memoryWrites ?? 0) + (changed ? 1 : 0);
  return {
    success: true,
    done: true,
    target,
    usage: usage(target, entries),
    entry_count: entries.length,
    message: notes.join(' ') || (changed ? 'Saved.' : 'Nothing changed.'),
    note: 'Write saved. This update is complete — do not repeat it. It appears in the system prompt from the next session on.',
  };
}

// ── System prompt ──────────────────────────────────────────────────────────

const RULE = '═'.repeat(46);

/**
 * The stores as they go into the system prompt. Taken once when a session starts: what is
 * written during the session reaches disk at once but the prompt only in the next session.
 * @returns {{ text: string, count: number } | null}
 */
export function memoryBlocks(cwd) {
  const blocks = [];
  let count = 0;
  for (const target of ['user', 'memory', 'project']) {
    const entries = readStore(target, cwd);
    if (!entries.length) continue;
    count += entries.length;
    // An entry that would act as an instruction is shown as blocked rather than read out.
    const shown = entries.map((entry) => {
      const threat = scanThreats(entry);
      return threat ? `[Withheld: an entry in ${STORES[target].label} matched the pattern '${threat}'. Remove the original with the memory tool (action remove, target '${target}').]` : entry;
    });
    blocks.push(`${RULE}\n${STORES[target].title} [${usage(target, entries)}]\n${RULE}\n${shown.join(ENTRY_DELIMITER)}`);
  }
  return blocks.length ? { text: blocks.join('\n\n'), count } : null;
}

export const MEMORY_GUIDANCE = `Some of what you learn is kept between sessions and shown to you at the start of each one. The memory tool says what may go there. Start with skills: what you learn while doing a job — the way to do it, what goes wrong, how the user wants that kind of work done — belongs in the skill for that job (skill_manage), which is only loaded when the job comes up. Memory is for the few facts that matter in every session whatever the task: who the user is, how the environment is set up, conventions that have no task of their own. Its room is limited, so when it is full, merge or replace entries that are out of date instead of giving up on the save. Phrase an entry as a fact, not as an order to yourself: "The user likes short answers" is right, "Always answer briefly" is wrong, because an order read back in a later session can overrule what the user asks for then. What will be out of date within a week is left to the session history; ways of working go in skills.`;

export const SESSION_SEARCH_GUIDANCE = `If the user mentions an earlier conversation, or earlier sessions probably hold something that matters here, look it up with session_search instead of asking the user to say it again.`;
