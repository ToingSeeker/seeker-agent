// Project context files: the instructions a project keeps for coding agents
// (SEEKER.md, AGENTS.md, CLAUDE.md, .cursorrules). One kind of file
// wins, AGENTS.md is read from the repository root down to the working folder,
// long files keep their head and tail, a file that reads like a prompt
// injection is not loaded, and instruction files deeper in the tree are picked
// up when the agent first works in their folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanThreats } from './memory.mjs';

const CHARS_PER_TOKEN = 3.5;
const SEEKER_NAMES = ['SEEKER.md', '.seeker.md'];
const AGENTS_NAMES = ['AGENTS.override.md', 'AGENTS.md', 'agents.md'];
const CLAUDE_NAMES = ['CLAUDE.md', 'claude.md'];
const HINT_NAMES = [...AGENTS_NAMES, ...CLAUDE_NAMES, '.cursorrules'];
const HINT_CAP = 32_000;
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.cache', 'target', 'vendor']);

/** How many characters of instruction files a model with this context can afford: 6% of it, within bounds. */
export const contextFileCap = (contextLimit) => Math.min(200_000, Math.max(12_000, Math.floor((contextLimit ?? 0) * CHARS_PER_TOKEN * 0.06)));

function read(file) {
  try {
    // realpath: the same file must not be read twice under two spellings (AGENTS.md / agents.md on macOS).
    const real = fs.realpathSync(file);
    if (!fs.statSync(real).isFile()) return null;
    const text = fs.readFileSync(real, 'utf8').replace(/^﻿/, '').trim();
    return text ? { real, text } : null;
  } catch {
    return null;
  }
}

/** The repository root above `cwd`, or null. The home folder and above are never treated as a project. */
export function gitRoot(cwd) {
  const home = os.homedir();
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (dir === home || dir === path.dirname(dir)) return null;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
  }
}

/**
 * Keeps the first 70% and last 20% of the budget and says what was left out, by heading,
 * so the model knows what to go and read.
 */
export function truncateContext(text, name, file, cap) {
  if (text.length <= cap) return text;
  const head = Math.floor(cap * 0.7);
  const tail = Math.floor(cap * 0.2);
  const middle = text.slice(head, text.length - tail);
  const headings = [];
  let fenced = false;
  for (const line of middle.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && /^#{1,6}\s+\S/.test(line)) headings.push(line.replace(/^#+\s+/, '').trim());
  }
  const omitted = headings.length ? ` Sections left out: ${headings.slice(0, 15).join('; ')}${headings.length > 15 ? '; ...' : ''}.` : '';
  return `${text.slice(0, head)}\n\n[${name} is too long to show whole: its first ${head} and last ${tail} of ${text.length} characters are here, the middle is left out.${omitted} The whole file can be read with read_file: ${file}]\n\n${text.slice(-tail)}`;
}

/** A project file's text as it may be loaded: blocked if it reads like an injection, otherwise cut to size. */
function vetted(text, label, file, cap) {
  const threat = scanThreats(text, 'context');
  if (threat) return `[Not loaded: ${label} reads like an attempt to slip instructions to the agent (${threat}).]`;
  return truncateContext(text, label, file, cap);
}

const stripFrontmatter = (text) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();

/**
 * The instruction files that apply in `cwd`. The first kind that exists wins:
 *   1. SEEKER.md — the nearest one from `cwd` up to the repository root
 *   2. AGENTS.md — every one from the repository root down to `cwd`
 *   3. CLAUDE.md in `cwd`
 *   4. .cursorrules and .cursor/rules/*.mdc in `cwd`
 * @returns {{ file: string, text: string, real?: string }[]} `file` is the label shown to the user and the model
 */
export function discoverContextFiles(cwd, contextLimit) {
  const cap = contextFileCap(contextLimit);
  const root = gitRoot(cwd);
  const chain = []; // root … cwd
  if (root) for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    chain.unshift(dir);
    if (dir === root) break;
  }
  else chain.push(path.resolve(cwd));
  const label = (file) => path.relative(cwd, file) || path.basename(file);

  for (const dir of [...chain].reverse()) {
    for (const name of SEEKER_NAMES) {
      const found = read(path.join(dir, name));
      if (found) {
        const file = path.join(dir, name);
        return [{ file: label(file), real: found.real, text: vetted(stripFrontmatter(found.text), label(file), file, cap) }];
      }
    }
  }

  const agents = [];
  const seenText = new Set();
  for (const dir of chain) {
    for (const name of AGENTS_NAMES) {
      const found = read(path.join(dir, name));
      if (!found) continue;
      if (!seenText.has(found.text)) {
        seenText.add(found.text);
        const file = path.join(dir, name);
        agents.push({ file: label(file), real: found.real, text: vetted(found.text, label(file), file, cap), path: file });
      }
      break;
    }
  }
  if (agents.length) {
    // The chain shares one budget; the folder nearest the work is the last to be cut.
    let room = cap;
    for (const entry of [...agents].reverse()) {
      entry.text = truncateContext(entry.text, entry.file, entry.path, Math.max(2000, room));
      room -= entry.text.length;
    }
    return agents.map(({ path: _path, ...entry }) => entry);
  }

  for (const name of CLAUDE_NAMES) {
    const found = read(path.join(cwd, name));
    if (found) return [{ file: name, real: found.real, text: vetted(found.text, name, path.join(cwd, name), cap) }];
  }

  const rules = [];
  const cursorrules = read(path.join(cwd, '.cursorrules'));
  if (cursorrules) rules.push(cursorrules.text);
  try {
    for (const name of fs.readdirSync(path.join(cwd, '.cursor', 'rules')).filter((n) => n.endsWith('.mdc')).sort()) {
      const found = read(path.join(cwd, '.cursor', 'rules', name));
      if (found) rules.push(found.text);
    }
  } catch {}
  if (rules.length) return [{ file: '.cursorrules', text: vetted(rules.join('\n\n'), '.cursorrules', path.join(cwd, '.cursorrules'), cap) }];
  return [];
}

/**
 * Instruction files further down the tree, found as the agent starts working there.
 * A monorepo's `packages/api/AGENTS.md` is not in the system prompt; it is handed over with
 * the result of the first tool call that touches `packages/api`.
 */
export class SubdirectoryHints {
  /** @param {string} cwd  @param {string[]} loaded  real paths of the files already in the system prompt */
  constructor(cwd, loaded = []) {
    this.cwd = path.resolve(cwd);
    this.seenDirs = new Set([this.cwd]);
    this.seenFiles = new Set(loaded);
    const home = os.homedir();
    // In the home folder every tool call would wander into some unrelated project.
    this.disabled = this.cwd === home || this.cwd === path.dirname(this.cwd) || home.startsWith(this.cwd + path.sep);
  }

  /** The folders a tool call works in, judged from its path arguments and, for a command, from `cd` and path-like words. */
  #dirsOf(name, args) {
    const paths = [args?.path, args?.file_path, args?.workdir].filter((p) => typeof p === 'string' && p);
    if (name === 'bash' && typeof args?.command === 'string') {
      for (const segment of args.command.split(/&&|\|\||;|\|/)) {
        const words = segment.trim().split(/\s+/);
        if (['cd', 'pushd'].includes(words[0]) && words[1]) paths.push(words[1]);
        for (const word of words.slice(1)) {
          if (word.startsWith('-') || /^[a-z]+:\/\//i.test(word) || word.startsWith('git@') || /[`$*?<>(){}"']/.test(word)) continue;
          if (word.includes('/')) paths.push(word);
        }
      }
    }
    const dirs = [];
    for (const p of paths) {
      const full = path.resolve(this.cwd, p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
      const stat = fs.statSync(full, { throwIfNoEntry: false });
      dirs.push(stat?.isDirectory() ? full : path.dirname(full));
    }
    return dirs;
  }

  /**
   * Text to append to a tool result, or '' when the call uncovered nothing new.
   * @param {string} name  the tool
   * @param {object} args  its arguments
   */
  collect(name, args) {
    if (this.disabled) return '';
    const found = [];
    for (const start of this.#dirsOf(name, args)) {
      let dir = start;
      for (let up = 0; up <= 5; up++, dir = path.dirname(dir)) {
        if (this.seenDirs.has(dir) || !dir.startsWith(this.cwd + path.sep)) break;
        this.seenDirs.add(dir);
        if (path.relative(this.cwd, dir).split(path.sep).some((part) => SKIPPED_DIRS.has(part))) continue;
        for (const hint of HINT_NAMES) {
          const file = path.join(dir, hint);
          const loaded = read(file);
          if (!loaded) continue;
          // A link may not lead out of the project, and the same file is never handed over twice.
          if (!loaded.real.startsWith(fs.realpathSync(this.cwd) + path.sep) || this.seenFiles.has(loaded.real)) break;
          this.seenFiles.add(loaded.real);
          const rel = path.relative(this.cwd, file);
          found.push(`[Instructions kept in this folder: ${rel}]\n${vetted(loaded.text, rel, file, HINT_CAP)}`);
          break;
        }
      }
    }
    return found.length ? `\n\n${found.join('\n\n')}` : '';
  }
}
