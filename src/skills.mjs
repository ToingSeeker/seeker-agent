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
      meta[key] = /^[>|][+-]?$/.test(value) ? '' : value.replace(/^(['"])(.*)\1$/, '$2');
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
    return { name, description: meta.description || body.split('\n')[0].replace(/^#+\s*/, ''), body, file, dir: path.dirname(file), source };
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
