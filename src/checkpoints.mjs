// Checkpoints: a snapshot of the working folder taken before SEEKER changes it,
// so `/rollback` can put the files back. The snapshots live in a "shadow" git repository
// under ~/.seeker/checkpoints, addressed through GIT_DIR and GIT_WORK_TREE, so
// nothing is ever written into the project's own .git.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';

// A folder with more files than this is not a project; snapshotting it would stall every turn.
const MAX_FILES = 50_000;
const GIT_TIMEOUT_MS = 30_000;
const KEEP = 20;
// A single file larger than this is left out of snapshots (and so is not restored by a rollback).
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Never snapshotted, whatever the project's own .gitignore says: bulky, rebuildable, or secret.
const EXCLUDES = [
  'node_modules/', 'dist/', 'build/', 'target/', 'out/', '.next/', '.nuxt/', '__pycache__/', '*.pyc', '*.pyo',
  '.cache/', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', 'coverage/', '.coverage', '.venv/', 'venv/', 'env/',
  '.git/', '.hg/', '.svn/', '.worktrees/',
  '*.so', '*.dylib', '*.dll', '*.o', '*.a', '*.jar', '*.class', '*.exe', '*.obj',
  '*.mp4', '*.mov', '*.mkv', '*.webm', '*.zip', '*.tar', '*.tar.gz', '*.tgz', '*.7z', '*.rar', '*.iso',
  '.env', '.env.*', '*.pem', '*.key', 'id_rsa*', '.DS_Store', 'Thumbs.db', '*.log',
];

export const shadowDir = (cwd) => path.join(HOME_DIR, 'checkpoints', crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 16));

/** Folders that are never snapshotted: the home folder and the filesystem root hold far more than a project. */
export function unsuitable(cwd) {
  const dir = path.resolve(cwd);
  if (dir === path.parse(dir).root) return 'the filesystem root is not a project folder';
  if (dir === os.homedir()) return 'the home folder is not a project folder';
  return null;
}

function git(cwd, args) {
  const dir = shadowDir(cwd);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_DIR: dir,
    GIT_WORK_TREE: path.resolve(cwd),
    GIT_INDEX_FILE: path.join(dir, 'index'),
    // The user's own git settings (signing, hooks, global ignores, templates) must not reach in here.
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'seeker',
    GIT_AUTHOR_EMAIL: 'seeker@localhost',
    GIT_COMMITTER_NAME: 'seeker',
    GIT_COMMITTER_EMAIL: 'seeker@localhost',
  };
  return new Promise((resolve) => {
    const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.quotepath=false', ...args], { cwd: path.resolve(cwd), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), GIT_TIMEOUT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, out: '', err: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out, err: err.trim() });
    });
  });
}

async function ensureRepo(cwd) {
  const dir = shadowDir(cwd);
  if (fs.existsSync(path.join(dir, 'HEAD'))) return true;
  fs.mkdirSync(dir, { recursive: true });
  const made = await git(cwd, ['init', '--quiet']);
  if (!made.ok) return false;
  fs.mkdirSync(path.join(dir, 'info'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'info', 'exclude'), `${EXCLUDES.join('\n')}\n`);
  // Says which folder these snapshots belong to; the folder name itself is only a hash.
  fs.writeFileSync(path.join(dir, 'SEEKER_WORKDIR'), `${path.resolve(cwd)}\n`);
  return true;
}

/**
 * Records the folder as it is now. Returns the snapshot's id, or null when there was nothing
 * to record or the folder cannot be snapshotted. Never throws: a failed snapshot must not stop the work.
 * @param {string} cwd
 * @param {string} reason  shown in /rollback, e.g. "before edit_file src/app.js"
 */
export async function snapshot(cwd, reason) {
  try {
    if (unsuitable(cwd) || !(await ensureRepo(cwd))) return null;
    const files = await git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    if (!files.ok) return null;
    const names = files.out.split('\0').filter(Boolean);
    if (names.length > MAX_FILES) return null;
    const root = path.resolve(cwd);
    const oversize = names.filter((name) => (fs.statSync(path.join(root, name), { throwIfNoEntry: false })?.size ?? 0) > MAX_FILE_BYTES);
    if (!(await git(cwd, ['add', '--all', '--', '.', ...oversize.map((name) => `:(exclude,literal)${name}`)])).ok) return null;
    // One that was small in an earlier snapshot and has grown since is taken out of the index again.
    if (oversize.length) await git(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...oversize.map((name) => `:(literal)${name}`)]);
    const head = await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    if (head.ok) {
      // Nothing changed since the last snapshot: that one already holds this state.
      const same = await git(cwd, ['diff', '--cached', '--quiet', 'HEAD']);
      if (same.ok) return head.out.trim();
    }
    const made = await git(cwd, ['commit', '--quiet', '--allow-empty', '--no-verify', '-m', String(reason || 'checkpoint').replace(/\s+/g, ' ').slice(0, 200)]);
    if (!made.ok) return null;
    const id = (await git(cwd, ['rev-parse', 'HEAD'])).out.trim();
    return id || null;
  } catch {
    return null;
  }
}

/** The newest snapshots, newest first: { id, short, when: Date, reason, files, added, removed }. */
export async function list(cwd, limit = KEEP) {
  if (!fs.existsSync(path.join(shadowDir(cwd), 'HEAD'))) return [];
  const log = await git(cwd, ['log', `--max-count=${limit}`, '--format=%x01%H%x02%cI%x02%s', '--shortstat']);
  if (!log.ok) return [];
  return log.out
    .split('\x01')
    .filter((entry) => entry.trim())
    .map((entry) => {
      const [line, ...rest] = entry.split('\n');
      const [id, when, reason] = line.split('\x02');
      const stat = rest.join(' ');
      const number = (re) => Number(re.exec(stat)?.[1] ?? 0);
      return { id, short: id.slice(0, 8), when: new Date(when), reason, files: number(/(\d+) files? changed/), added: number(/(\d+) insertions?/), removed: number(/(\d+) deletions?/) };
    });
}

/** What changed between a snapshot and the folder as it is now, as a unified diff (capped). */
export async function diff(cwd, id, { maxChars = 20_000 } = {}) {
  await git(cwd, ['add', '--all']);
  const stat = await git(cwd, ['diff', '--cached', '--stat', id]);
  const full = await git(cwd, ['diff', '--cached', id]);
  if (!stat.ok) return null;
  const text = full.out.length > maxChars ? `${full.out.slice(0, maxChars)}\n… [diff cut at ${maxChars} characters]` : full.out;
  return { stat: stat.out.trimEnd(), text };
}

/**
 * Puts the folder (or one file) back to how a snapshot recorded it. The current state is
 * snapshotted first, so a rollback can itself be rolled back.
 * @returns {Promise<{ ok: true, restored: string, saved: string|null, removed: string[] } | { ok: false, error: string }>}
 */
export async function restore(cwd, id, file = null) {
  const known = await git(cwd, ['cat-file', '-e', `${id}^{commit}`]);
  if (!known.ok) return { ok: false, error: `No checkpoint "${id}".` };
  const saved = await snapshot(cwd, `before rollback to ${id.slice(0, 8)}`);
  const root = path.resolve(cwd);

  if (file) {
    const target = path.relative(root, path.resolve(root, file));
    if (!target || target.startsWith('..') || path.isAbsolute(target)) return { ok: false, error: 'That file is outside the working folder.' };
    const had = await git(cwd, ['cat-file', '-e', `${id}:${target}`]);
    if (!had.ok) return { ok: false, error: `${target} did not exist in checkpoint ${id.slice(0, 8)}.` };
    const back = await git(cwd, ['checkout', id, '--', target]);
    return back.ok ? { ok: true, restored: id, saved, removed: [] } : { ok: false, error: back.err || 'git could not restore the file' };
  }

  // Files created after the snapshot are not touched by a checkout; they are removed here so the
  // folder matches the snapshot. They remain in the snapshot just taken.
  const created = saved ? await git(cwd, ['diff', '--name-only', '--diff-filter=A', '-z', id, saved]) : { ok: false, out: '' };
  const back = await git(cwd, ['checkout', id, '--', '.']);
  if (!back.ok) return { ok: false, error: back.err || 'git could not restore the files' };
  const removed = [];
  for (const name of created.ok ? created.out.split('\0').filter(Boolean) : []) {
    const full = path.resolve(root, name);
    if (!full.startsWith(root + path.sep)) continue;
    try {
      fs.rmSync(full);
      removed.push(name);
    } catch {}
  }
  return { ok: true, restored: id, saved, removed };
}

// Shell commands that can destroy or overwrite files: a snapshot is taken before one runs.
const DESTRUCTIVE = /(?:^|\s|&&|\|\||;|`)(?:rm\s|rmdir\s|cp\s|install\s|mv\s|sed\s+-i|truncate\s|dd\s|shred\s|git\s+(?:reset|clean|checkout|restore|stash)\s)/;
const OVERWRITE = /[^>]>[^>]|^>[^>]/;
export const isDestructiveCommand = (command) => DESTRUCTIVE.test(command) || OVERWRITE.test(command.replace(/\d?>&\d|\d?>\s*\/dev\/null/g, ''));

/** Removes the snapshots of folders that have not been snapshotted for `days`. Returns how many were removed. */
export function prune(days = 30, now = Date.now()) {
  const base = path.join(HOME_DIR, 'checkpoints');
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f]{16}$/.test(entry.name)) continue;
    const dir = path.join(base, entry.name);
    const touched = Math.max(...['HEAD', 'index', 'logs/HEAD'].map((f) => fs.statSync(path.join(dir, f), { throwIfNoEntry: false })?.mtimeMs ?? 0));
    if (touched && now - touched > days * 86_400_000) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
