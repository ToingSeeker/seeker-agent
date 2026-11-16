// Skills are reusable instructions the model loads on demand. Only each
// skill's name and one-line description sit in the system prompt; the body is
// read when the model calls the `skill` tool or the user types /<name>.
//
// Layout (same as Claude Code, so skills can be copied over as-is):
//   <dir>/<name>/SKILL.md     or     <dir>/<name>.md
// Plugins keep their skills together under a namespace, as `plugin:skill`:
//   ~/.seeker/plugins/<plugin>/skills/<name>/SKILL.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME_DIR } from './config.mjs';

/** A YAML scalar written in quotes, as it reads: '' inside single quotes is one quote, \" and \\ inside double quotes are escapes. */
const unquote = (value) => {
  if (/^'.*'$/.test(value) && value.length > 1) return value.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(value) && value.length > 1) return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
  return value;
};

/** Parses the small YAML subset skills use: `key: value`, with folded / indented continuation lines. */
export function parseSkillFile(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text.trim() };
  const meta = {};
  let key = null;
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (field) {
      key = field[1];
      const value = field[2].trim();
      meta[key] = /^[>|][+-]?$/.test(value) ? '' : unquote(value);
    } else if (key && /^\s+\S/.test(line)) {
      meta[key] = `${meta[key]} ${line.trim()}`.trim();
    }
  }
  return { meta, body: match[2].trim() };
}

function readSkill(file, fallbackName, source, namespace = '') {
  try {
    const { meta, body } = parseSkillFile(fs.readFileSync(file, 'utf8'));
    if (!body) return null;
    const own = String(meta.name || fallbackName).trim().toLowerCase().replace(/\s+/g, '-');
    const name = namespace && !own.startsWith(`${namespace}:`) ? `${namespace}:${own}` : own;
    return { name, description: meta.description || body.split('\n')[0].replace(/^#+\s*/, ''), body, file, dir: path.dirname(file), source, ...(meta.choices ? { choices: meta.choices } : {}) };
  } catch {
    return null;
  }
}

function scan(dir, source, namespace = '', depth = 1) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    // statSync so a symlinked skill folder (e.g. into ~/.claude/skills) works too.
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full, { throwIfNoEntry: false })?.isDirectory());
    let skill = null;
    if (isDir) {
      skill = readSkill(path.join(full, 'SKILL.md'), entry.name, source, namespace);
      // Some plugins sort their skills into sub-folders (skills/<area>/<name>/SKILL.md).
      if (!skill && depth > 1) skills.push(...scan(full, source, namespace, depth - 1));
    }
    else if (entry.name.endsWith('.md')) skill = readSkill(full, entry.name.slice(0, -3), source, namespace);
    if (skill) skills.push(skill);
  }
  return skills;
}

const expand = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);

/** The skills that ship with SEEKER, in the repository's own skills/ folder. */
export const BUNDLED_SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');

/** Later sources win on a name clash: bundled, plugins, extra dirs, then ~/.seeker/skills, then the project's own. */
export function loadSkills(cwd, extraDirs = [], { bundled = true, bundledDir = BUNDLED_SKILLS_DIR } = {}) {
  const byName = new Map();
  // SEEKER's own skills come first, so any skill the user installs under the same name replaces it.
  if (bundled && bundledDir) for (const skill of scan(bundledDir, 'bundled')) byName.set(skill.name, skill);
  // Plugins first, so a skill of the user's own with the same name would win.
  let plugins = [];
  try {
    plugins = fs.readdirSync(path.join(HOME_DIR, 'plugins')).filter((name) => !name.startsWith('.'));
  } catch {}
  for (const plugin of plugins) {
    for (const skill of scan(path.join(HOME_DIR, 'plugins', plugin, 'skills'), 'plugin', plugin.toLowerCase(), 2)) byName.set(skill.name, skill);
  }
  const sources = [
    ...extraDirs.map((d) => [path.resolve(cwd, expand(String(d))), 'extra']),
    [path.join(HOME_DIR, 'skills'), 'user'],
    [path.join(cwd, '.seeker', 'skills'), 'project'],
  ];
  for (const [dir, source] of sources) for (const skill of scan(dir, source)) byName.set(skill.name, skill);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** What the model receives when a skill is loaded. */
export function renderSkill(skill, args = '') {
  const extra = args.trim() ? `\n\nArguments from the user: ${args.trim()}` : '';
  return `Skill "${skill.name}" (files that belong to it are in ${skill.dir}). Follow these instructions:\n\n${skill.body}${extra}`;
}

const MAX_CHOICES = 200;
/** A description short enough for a list row; one that is cut ends on a whole word and says so. */
const brief = (text, max = 160) => (text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, '')}…`);
const plain = (cell) => cell.replace(/`([^`]*)`/g, '$1').replace(/\*\*|__/g, '').replace(/\\\|/g, '|').trim();

/** The cells of one markdown table row. A `\|` inside a cell is not a divider. */
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());

/** The first table in `body` that lists things by a code-formatted name: [{ value, description }]. */
function choicesFromTable(body) {
  const lines = body.split('\n');
  for (let i = 0; i + 2 < lines.length; i++) {
    if (!lines[i].trim().startsWith('|') || !/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) || !lines[i + 1].includes('-')) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(cells(lines[j]));
    if (rows.length < 4) continue;
    const width = Math.max(...rows.map((r) => r.length));
    // The column where (nearly) every row holds exactly one `name`.
    const named = Array.from({ length: width }, (_, col) => col).find((col) => rows.filter((r) => /^`[^`\s][^`]*`$/.test(r[col] ?? '')).length >= rows.length * 0.9);
    if (named === undefined) continue;
    return rows.filter((r) => /^`[^`]+`$/.test(r[named] ?? '')).map((r) => ({ value: r[named].slice(1, -1), description: plain(r[named + 1] ?? r[named - 1] ?? '') }));
  }
  return [];
}

/**
 * The things a skill lets the user choose between, when it has such a list — so `/skill` with
 * nothing after it can offer them to tick instead of expecting their names to be remembered.
 * Taken, in this order, from:
 *   `choices.json` in the skill's folder: ["a", "b"] or [{ "value": "a", "description": "…" }]
 *   `choices: a, b, c` in the skill's frontmatter
 *   a table in the skill whose rows are each named in code (| `orbit` | Reels circle your head |), if the
 *   skill says its command takes one of them (`/effects <name>`) and there are at least six
 * @returns {{ value: string, description: string }[]}  empty when the skill has no such list
 */
export function skillChoices(skill) {
  if (!skill) return [];
  if (skill.choiceList) return skill.choiceList;
  let found = [];
  try {
    const listed = JSON.parse(fs.readFileSync(path.join(skill.dir, 'choices.json'), 'utf8'));
    if (Array.isArray(listed)) found = listed.map((c) => (typeof c === 'string' ? { value: c, description: '' } : { value: String(c?.value ?? ''), description: String(c?.description ?? c?.label ?? '') }));
  } catch {}
  if (!found.length && skill.choices) found = String(skill.choices).split(',').map((value) => ({ value: value.trim(), description: '' }));
  // A table alone proves little: many skills have one of commands or parameters. It counts as a list to
  // choose from only when the skill itself says its command takes one of them (`/effects <name>`) and the
  // list is long enough that nobody is expected to know it by heart.
  const own = String(skill.name ?? '').split(':').pop();
  if (!found.length && (skill.body ?? '').includes(`/${own} <`)) {
    const listed = choicesFromTable(skill.body);
    if (listed.length >= 6) found = listed;
  }
  const seen = new Set();
  skill.choiceList = found.filter((c) => c.value && c.value.length <= 80 && !/[\n,]/.test(c.value) && !seen.has(c.value) && seen.add(c.value)).slice(0, MAX_CHOICES).map((c) => ({ value: c.value, description: brief(c.description.replace(/\s+/g, ' ')) }));
  return skill.choiceList;
}
