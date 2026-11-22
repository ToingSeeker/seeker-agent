// A place of its own for a helper that changes files: a git worktree on a new branch, made from
// the project's last commit. Helpers that write side by side cannot overwrite one another there,
// and nothing they do reaches the user's folder until the user merges it.
//
//   ~/.seeker/worktrees/<repo>-<id>   the copy, checked out on branch seeker/<label>-<id>
//
// When the helper is done, a copy it left unchanged is removed with its branch. A changed one is
// kept as it is (nothing is committed for the helper), and the parent is told where it is, what
// changed and how to look at it.
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { HOME_DIR } from './config.mjs';

const run = promisify(execFile);
const MAX_STAT_LINES = 40;

export const worktreesDir = () => path.join(HOME_DIR, 'worktrees');

async function git(cwd, args) {
  const { stdout } = await run('git', args, { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

const slug = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '') || 'task';

/**
 * Makes a worktree for a helper working in `cwd`. Throws an Error that says why when `cwd` is not
 * in a git repository or the repository has no commit to start from.
 * @returns {Promise<{ root: string, dir: string, cwd: string, branch: string, base: string, parentDirty: boolean }>}
 */
export async function createWorktree(cwd, label) {
  let root;
  try {
    root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    throw new Error('isolation "worktree" needs the working folder to be in a git repository; this one is not. Leave "isolation" out, or keep helpers that write to separate files.');
  }
  let base;
  try {
    base = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  } catch {
    throw new Error('isolation "worktree" starts from the last commit, and this repository has none yet.');
  }
  const id = crypto.randomBytes(3).toString('hex');
  const branch = `seeker/${slug(label)}-${id}`;
  const dir = path.join(worktreesDir(), `${slug(path.basename(root))}-${id}`);
  fs.mkdirSync(worktreesDir(), { recursive: true });
  await git(root, ['worktree', 'add', '--quiet', '-b', branch, dir, base]);
  // A helper started from a subfolder works in the same subfolder of its copy.
  const sub = path.relative(fs.realpathSync(root), fs.realpathSync(cwd));
  const parentDirty = (await git(root, ['status', '--porcelain'])).trim() !== '';
  return { root, dir, cwd: sub && !sub.startsWith('..') ? path.join(dir, sub) : dir, branch, base, parentDirty };
}

/**
 * Removes the worktree and its branch if the helper changed nothing; keeps it otherwise.
 * @returns {Promise<{ kept: boolean, dir: string, branch: string, commits: number, stat: string, untracked: string[] }>}
 */
export async function finishWorktree(wt) {
  const { root, dir, branch, base } = wt;
  let status = '';
  let commits = 0;
  try {
    status = await git(dir, ['status', '--porcelain', '--untracked-files=all']);
    commits = Number((await git(dir, ['rev-list', '--count', `${base}..HEAD`])).trim()) || 0;
  } catch {
    // The copy is gone or broken: nothing to report and nothing safe to remove.
    return { kept: false, dir, branch, commits: 0, stat: '', untracked: [] };
  }
  if (!status.trim() && !commits) {
    try {
      await git(root, ['worktree', 'remove', '--force', dir]);
      await git(root, ['branch', '-D', branch]);
    } catch {}
    return { kept: false, dir, branch, commits: 0, stat: '', untracked: [] };
  }
  const untracked = status
    .split('\n')
    .filter((l) => l.startsWith('?? '))
    .map((l) => l.slice(3));
  let stat = '';
  try {
    stat = (await git(dir, ['diff', '--stat', base])).trimEnd();
  } catch {}
  const lines = stat.split('\n');
  if (lines.length > MAX_STAT_LINES) stat = [...lines.slice(0, MAX_STAT_LINES - 1), `… ${lines.length - MAX_STAT_LINES} more lines`, lines.at(-1)].join('\n');
  return { kept: true, dir, branch, commits, stat, untracked };
}

/** What a helper is told before its task: where it is, and what it does not have. */
export function worktreeBrief(wt) {
  return `You are working in an isolated copy of the project: a git worktree at ${wt.dir} on branch ${wt.branch}, made from the last commit. Make your changes there; never write to ${wt.root}. Files that git does not track (dependencies such as node_modules, .env files, build output) are not in this copy: install or create what you need here, and say so in your report. Do not commit, push or merge unless your task says to.\n\n`;
}

/** What the parent is told after the report: whether anything changed, and where to find it. */
export function worktreeNote(wt, finished) {
  if (!finished.kept) return '\n\n[Isolated worktree: the helper changed nothing, so it was removed.]';
  const parts = [`[Isolated worktree kept: ${finished.dir} on branch ${finished.branch}. None of this is in ${wt.root} yet.`];
  if (finished.commits) parts.push(`${finished.commits} commit(s) made on the branch.`);
  if (finished.stat) parts.push(`Changed against the starting commit:\n${finished.stat}`);
  if (finished.untracked.length) parts.push(`New files:\n${finished.untracked.slice(0, MAX_STAT_LINES).join('\n')}${finished.untracked.length > MAX_STAT_LINES ? `\n… ${finished.untracked.length - MAX_STAT_LINES} more` : ''}`);
  parts.push(`Look at it with \`git -C ${finished.dir} diff\`. Bringing it into ${wt.root} (merge, cherry-pick or copy) is for the user to approve; remove it afterwards with \`git -C ${wt.root} worktree remove ${finished.dir}\` and \`git -C ${wt.root} branch -D ${finished.branch}\`.`);
  if (wt.parentDirty) parts.push(`${wt.root} had uncommitted changes when the copy was made; they are not in the copy.`);
  return `\n\n${parts.join('\n')}]`;
}
