// Skills the agent writes and maintains itself — its procedural memory — plus
// the record of how often each skill is used and the curator that retires the
// ones nobody uses.
//
//   ~/.seeker/skills/<name>/SKILL.md      a skill (with references/, templates/, scripts/, assets/)
//   ~/.seeker/skills/.usage.json          per-skill counters and who created it
//   ~/.seeker/skills/.archive/<name>/     skills the curator retired (restorable by moving back)
//   ~/.seeker/skills/.curator.json        when the curator last ran
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';
import { scanThreats } from './memory.mjs';
import { parseSkillFile } from './skills.mjs';

export const SKILLS_DIR = path.join(HOME_DIR, 'skills');
const USAGE_FILE = () => path.join(SKILLS_DIR, '.usage.json');
const ARCHIVE_DIR = () => path.join(SKILLS_DIR, '.archive');
const CURATOR_FILE = () => path.join(SKILLS_DIR, '.curator.json');

const VALID_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_NAME = 64;
// The skill list in the prompt gives each description one short line.
export const MAX_NEW_DESCRIPTION = 120;
const MAX_DESCRIPTION = 1024;
const MAX_SKILL_CHARS = 100_000;
const MAX_FILE_BYTES = 1024 * 1024;
const SUPPORT_DIRS = ['references', 'templates', 'scripts', 'assets'];

// Curator defaults: checked weekly, stale after 14 unused days, archived after 30.
export const CURATOR = { intervalHours: 168, staleAfterDays: 14, archiveAfterDays: 30 };

class Refused extends Error {}

// ── Usage record ───────────────────────────────────────────────────────────

export function readUsage() {
  try {
    const data = JSON.parse(fs.readFileSync(USAGE_FILE(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeUsage(usage) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const temp = `${USAGE_FILE()}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(usage, null, 1)}\n`);
  fs.renameSync(temp, USAGE_FILE());
}

const blank = () => ({ use_count: 0, patch_count: 0, last_used_at: null, last_patched_at: null, created_at: null, state: 'active', pinned: false, created_by: null });

/** Counts one use of a skill (loaded by the model or run by the user). Never throws. */
export function recordUse(name, now = new Date()) {
  try {
    const usage = readUsage();
    const record = (usage[name] ??= blank());
    record.use_count++;
    record.last_used_at = now.toISOString();
    // A skill that is used again is no longer stale.
    if (record.state === 'stale') record.state = 'active';
    writeUsage(usage);
  } catch {}
}

function recordWrite(usage, name, { created = null, now = new Date() } = {}) {
  const record = (usage[name] ??= blank());
  if (created) {
    record.created_at = now.toISOString();
    record.created_by = created;
  } else {
    record.patch_count++;
    record.last_patched_at = now.toISOString();
  }
  if (record.state === 'stale') record.state = 'active';
}

// ── Validation ─────────────────────────────────────────────────────────────

function checkName(name) {
  if (typeof name !== 'string' || !name) throw new Refused("every operation needs 'name': the skill it applies to.");
  if (name.length > MAX_NAME || !VALID_NAME.test(name)) throw new Refused(`"${name}" is not a valid skill name: lowercase letters, digits, hyphens, dots and underscores, starting with a letter or digit, at most ${MAX_NAME} characters.`);
  return name;
}

/** Checks a whole SKILL.md. `previous` is the description it had before, which is exempt from the short-description rule. */
function checkSkillFile(content, name, previous = null) {
  if (typeof content !== 'string' || !content.trim()) throw new Refused('the SKILL.md content is empty.');
  if (content.length > MAX_SKILL_CHARS) throw new Refused(`SKILL.md is ${content.length.toLocaleString('en-US')} characters; the limit is ${MAX_SKILL_CHARS.toLocaleString('en-US')}. Move detail into references/ files.`);
  if (!/^---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/.test(content)) throw new Refused('SKILL.md must start with YAML frontmatter between two "---" lines, holding `name` and `description`.');
  const { meta, body } = parseSkillFile(content);
  if (!meta.name || !meta.description) throw new Refused('the frontmatter must have both `name` and `description`.');
  if (meta.name.trim().toLowerCase() !== name) throw new Refused(`the frontmatter says name: ${meta.name}, but the operation is for "${name}". They must be the same.`);
  if (meta.description.length > MAX_DESCRIPTION) throw new Refused(`the description is ${meta.description.length} characters; the hard limit is ${MAX_DESCRIPTION}.`);
  if (meta.description !== previous && meta.description.length > MAX_NEW_DESCRIPTION) {
    throw new Refused(`the description is ${meta.description.length} characters; keep it within ${MAX_NEW_DESCRIPTION} ("Use when <trigger>. <behaviour>."). It is the one line shown in the skill list.`);
  }
  if (!body.trim()) throw new Refused('SKILL.md has frontmatter but no instructions after it.');
  const threat = scanThreats(content);
  // A skill may legitimately mention keys and config paths; only instruction-hijacking text is refused.
  if (threat && !['hardcoded_secret', 'agent_config_mod', 'ssh_backdoor', 'read_secrets'].includes(threat)) throw new Refused(`Blocked: content matches threat pattern '${threat}'. A skill is read as instructions and must not carry injection payloads.`);
  return meta;
}

/** A skill's support files are read by the agent as well, so they get the same scan as SKILL.md. */
function checkSupportFile(content) {
  const threat = scanThreats(content);
  if (threat && !['hardcoded_secret', 'agent_config_mod', 'ssh_backdoor', 'read_secrets'].includes(threat)) throw new Refused(`Blocked: content matches threat pattern '${threat}'. A skill's files are read as instructions and must not carry injection payloads.`);
}

const realPath = (file) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
};

/** True when `dir` is a real folder (not a link) inside ~/.seeker/skills: the only skills this tool may change. */
function isOwnSkillDir(dir) {
  const root = realPath(SKILLS_DIR);
  const real = realPath(dir);
  if (!root || !real || !real.startsWith(root + path.sep)) return false;
  return !fs.lstatSync(dir).isSymbolicLink();
}

function supportPath(dir, filePath) {
  if (typeof filePath !== 'string' || !filePath) throw new Refused("'file_path' is required.");
  const parts = filePath.split('/');
  if (path.isAbsolute(filePath) || parts.includes('..') || parts.includes('.') || parts.includes('') || !SUPPORT_DIRS.includes(parts[0]) || parts.length < 2) {
    throw new Refused(`file_path must be relative to the skill's own folder and start with ${SUPPORT_DIRS.map((d) => `${d}/`).join(', ')} — e.g. 'references/api.md'.`);
  }
  // No part of the path may be a link: a link inside a skill must not turn a write here into a write elsewhere.
  const root = realPath(dir);
  let at = dir;
  for (const part of parts) {
    at = path.join(at, part);
    const stat = fs.lstatSync(at, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink()) throw new Refused(`${filePath} goes through a link; files are only written inside the skill's own folder.`);
  }
  const parent = realPath(path.dirname(at)) ?? realPath(dir);
  if (!root || !parent || (parent !== root && !parent.startsWith(root + path.sep))) throw new Refused(`${filePath} is outside the skill's own folder.`);
  return path.join(dir, ...parts);
}

const lint = (content) => {
  const warnings = [];
  if (content.length > 24_000) warnings.push('oversized-body: SKILL.md is long; move detail into references/ files so it loads only when needed.');
  if (/\b(PR|pull request|issue)\s*#\d+|\b20\d\d-\d\d-\d\d\b/i.test(parseSkillFile(content).body)) warnings.push('incident-log-shape: the body names dates or PR numbers. Write lessons, not logs: the rule and why, without the story of when it was learned.');
  return warnings;
};

// ── Operations ─────────────────────────────────────────────────────────────

/**
 * Applies a batch of skill operations, all or nothing: if any one fails, every skill the
 * batch touched is put back as it was.
 * @param {object} args  { operations: [{ action, name, … }] }
 * @param {{ skills: object[], review?: boolean }} ctx  `skills` = every skill now loaded; `review` = the unattended review is calling
 * @returns {object} what the model is told
 */
export function manageSkills(args, { skills = [], review = false } = {}) {
  let operations = args.operations;
  if (typeof operations === 'string') {
    try {
      operations = JSON.parse(operations);
    } catch {
      operations = null;
    }
  }
  if (!Array.isArray(operations) && args.action) operations = [args];
  if (!Array.isArray(operations) || !operations.length) return { success: false, error: "Pass 'operations': an array of { action, name, … }. A single change is an array of one." };
  if (operations.some((op) => op?.action === 'delete') && operations.length > 1) return { success: false, error: "'delete' must be the only operation in its call." };

  // Where each skill lives now; a skill created earlier in this batch is found here too.
  // Only skills in ~/.seeker/skills itself: a project's own skills are that project's files, and a linked
  // skill folder belongs to whatever it links to.
  const dirs = new Map(skills.filter((s) => path.basename(s.file) === 'SKILL.md' && isOwnSkillDir(s.dir) && !fs.lstatSync(s.file).isSymbolicLink()).map((s) => [s.name, s.dir]));
  const usage = readUsage();
  const backups = new Map(); // dir → temp copy, or null when the folder did not exist
  const backup = (dir) => {
    if (backups.has(dir)) return;
    if (fs.existsSync(dir)) {
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-skill-'));
      fs.cpSync(dir, copy, { recursive: true });
      backups.set(dir, copy);
    } else backups.set(dir, null);
  };
  const rollback = () => {
    for (const [dir, copy] of backups) {
      fs.rmSync(dir, { recursive: true, force: true });
      if (copy) fs.cpSync(copy, dir, { recursive: true });
    }
  };
  const cleanup = () => {
    for (const copy of backups.values()) if (copy) fs.rmSync(copy, { recursive: true, force: true });
  };

  const done = [];
  const warnings = [];
  const created = [];
  try {
    operations.forEach((op, i) => {
      const at = `operations[${i}]`;
      try {
        const action = String(op?.action ?? '').toLowerCase();
        const name = checkName(op?.name);
        const existing = dirs.get(name);
        const record = usage[name];

        if (action === 'create') {
          if (existing || skills.some((s) => s.name === name)) throw new Refused(`a skill named "${name}" already exists. Use 'patch' to change it, or pick another name.`);
          checkSkillFile(op.content, name);
          const dir = path.join(SKILLS_DIR, name);
          if (fs.existsSync(dir)) throw new Refused(`the folder ${dir} already exists.`);
          backup(dir);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'SKILL.md'), op.content.endsWith('\n') ? op.content : `${op.content}\n`);
          dirs.set(name, dir);
          recordWrite(usage, name, { created: review ? 'agent' : 'learn' });
          warnings.push(...lint(op.content).map((w) => `${name}: ${w}`));
          created.push(name);
          done.push(`created ${name}`);
          return;
        }

        if (!existing) throw new Refused(`there is no skill named "${name}" that can be changed here (only skills in ~/.seeker/skills; project, plugin and linked skills are read-only). Available: ${[...dirs.keys()].slice(0, 40).join(', ') || '(none)'}.`);
        if (record?.locked) throw new Refused(`"${name}" is locked; the user has protected it from changes.`);
        const file = path.join(existing, 'SKILL.md');

        if (action === 'patch' || action === 'edit') {
          const target = op.file_path ? supportPath(existing, op.file_path) : file;
          const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
          let next;
          if (typeof op.old_string === 'string') {
            if (current === null) throw new Refused(`${op.file_path} does not exist in "${name}".`);
            if (typeof op.new_string !== 'string') throw new Refused("'patch' with old_string needs new_string (an empty string deletes the match).");
            if (!op.old_string) throw new Refused('old_string is empty.');
            const count = current.split(op.old_string).length - 1;
            if (!count) throw new Refused(`old_string was not found in ${op.file_path ?? 'SKILL.md'} of "${name}". Read the file again and copy the text exactly.`);
            if (count > 1 && !op.replace_all) throw new Refused(`old_string occurs ${count} times. Add surrounding lines to make it unique, or set replace_all.`);
            next = current.split(op.old_string).join(op.new_string);
            if (!op.replace_all) next = current.replace(op.old_string, () => op.new_string);
          } else if (typeof op.content === 'string') {
            if (op.file_path) throw new Refused("to replace a support file use 'write_file'.");
            next = op.content;
          } else throw new Refused("'patch' needs old_string + new_string (a targeted fix — preferred), or content (replaces the whole SKILL.md).");
          if (next === current) throw new Refused('the patch changes nothing.');
          if (target === file) checkSkillFile(next, name, current ? parseSkillFile(current).meta.description : null);
          else {
            if (Buffer.byteLength(next) > MAX_FILE_BYTES) throw new Refused('a support file may be at most 1 MiB.');
            checkSupportFile(next);
          }
          backup(existing);
          fs.writeFileSync(target, next);
          recordWrite(usage, name);
          if (target === file) warnings.push(...lint(next).map((w) => `${name}: ${w}`));
          done.push(`patched ${name}${op.file_path ? `/${op.file_path}` : ''}`);
          return;
        }

        if (action === 'write_file') {
          const target = supportPath(existing, op.file_path);
          if (typeof op.file_content !== 'string') throw new Refused("'write_file' needs file_content.");
          if (Buffer.byteLength(op.file_content) > MAX_FILE_BYTES) throw new Refused('a support file may be at most 1 MiB.');
          checkSupportFile(op.file_content);
          backup(existing);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, op.file_content);
          recordWrite(usage, name);
          done.push(`wrote ${name}/${op.file_path}`);
          return;
        }

        if (action === 'remove_file') {
          const target = supportPath(existing, op.file_path);
          if (!fs.existsSync(target)) throw new Refused(`${op.file_path} does not exist in "${name}".`);
          backup(existing);
          fs.rmSync(target, { recursive: true });
          recordWrite(usage, name);
          done.push(`removed ${name}/${op.file_path}`);
          return;
        }

        if (action === 'delete') {
          if (record?.pinned) throw new Refused(`"${name}" is pinned and cannot be deleted.`);
          if (review) throw new Refused('Never delete a skill in this review. Leave it; the curator retires unused skills.');
          // Retired rather than destroyed: it can be moved back from the archive.
          archive(name, existing, usage);
          dirs.delete(name);
          done.push(`deleted ${name} (kept in ${path.join(ARCHIVE_DIR(), name)})`);
          return;
        }

        throw new Refused("action must be one of create, patch, write_file, remove_file, delete.");
      } catch (err) {
        if (err instanceof Refused) throw new Refused(`${at}: ${err.message}`);
        throw err;
      }
    });
  } catch (err) {
    rollback();
    cleanup();
    if (err instanceof Refused) return { success: false, error: `${err.message} Nothing was changed.` };
    return { success: false, error: `${err.message}. Nothing was changed.` };
  }
  cleanup();
  writeUsage(usage);
  const result = { success: true, done, created };
  if (warnings.length) result.lint_warnings = warnings;
  if (created.length) result.note = 'New skills can be loaded with the skill tool at once; they are listed in the system prompt from the next session on.';
  return result;
}

// ── Curator ────────────────────────────────────────────────────────────────

function archive(name, dir, usage, now = new Date()) {
  fs.mkdirSync(ARCHIVE_DIR(), { recursive: true });
  let target = path.join(ARCHIVE_DIR(), name);
  if (fs.existsSync(target)) target = `${target}-${now.toISOString().replace(/[:.]/g, '-')}`;
  fs.renameSync(dir, target);
  const record = (usage[name] ??= blank());
  record.state = 'archived';
  record.archived_at = now.toISOString();
}

const lastActivity = (record) => [record.last_used_at, record.last_patched_at].filter(Boolean).sort().at(-1) ?? null;

/**
 * Retires skills nobody uses. Only skills the agent created itself are ever touched — those
 * the user wrote or installed are theirs. A skill unused for `staleAfterDays` is marked stale;
 * one unused for `archiveAfterDays` is moved to the archive.
 * @returns {{ stale: string[], archived: string[], reactivated: string[] }}
 */
export function curate({ now = new Date(), staleAfterDays = CURATOR.staleAfterDays, archiveAfterDays = CURATOR.archiveAfterDays } = {}) {
  const usage = readUsage();
  const report = { stale: [], archived: [], reactivated: [] };
  const day = 86_400_000;
  for (const [name, record] of Object.entries(usage)) {
    if (!['agent', 'learn'].includes(record.created_by) || record.pinned || record.locked || record.state === 'archived') continue;
    const dir = path.join(SKILLS_DIR, name);
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
    const anchor = lastActivity(record) ?? record.created_at;
    if (!anchor) continue;
    const idleDays = (now.getTime() - Date.parse(anchor)) / day;
    if (idleDays >= archiveAfterDays) {
      archive(name, dir, usage, now);
      report.archived.push(name);
    } else if (idleDays >= staleAfterDays) {
      if (record.state !== 'stale') {
        record.state = 'stale';
        report.stale.push(name);
      }
    } else if (record.state === 'stale') {
      record.state = 'active';
      report.reactivated.push(name);
    }
  }
  if (report.stale.length || report.archived.length || report.reactivated.length) writeUsage(usage);
  return report;
}

/**
 * Runs the curator if it is due (at most once per `intervalHours`). The very first check only
 * starts the clock, so nothing is archived the day this feature first appears.
 * @returns the report, or null when it was not due
 */
export function curateIfDue({ now = new Date(), intervalHours = CURATOR.intervalHours } = {}) {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(CURATOR_FILE(), 'utf8'));
  } catch {}
  const last = Date.parse(state.last_run_at ?? '');
  const save = (extra = {}) => {
    try {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      fs.writeFileSync(CURATOR_FILE(), `${JSON.stringify({ last_run_at: now.toISOString(), ...extra })}\n`);
    } catch {}
  };
  if (Number.isNaN(last)) {
    save();
    return null;
  }
  if (now.getTime() - last < intervalHours * 3_600_000) return null;
  const report = curate({ now });
  save({ last_report: report });
  return report;
}

/** For /skills and /curator: the agent-made skills and how they stand. */
export function agentSkills() {
  return Object.entries(readUsage())
    .filter(([, r]) => ['agent', 'learn'].includes(r.created_by))
    .map(([name, r]) => ({ name, state: r.state, uses: r.use_count, patches: r.patch_count, lastActivity: lastActivity(r) ?? r.created_at, pinned: Boolean(r.pinned) }));
}

/** Pins or unpins a skill so the curator and `delete` leave it alone. */
export function setPinned(name, pinned) {
  const usage = readUsage();
  (usage[name] ??= blank()).pinned = pinned;
  writeUsage(usage);
}
