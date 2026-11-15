// /review: has SEEKER read a change and report what is wrong with it, without changing anything.
// This file gathers the change from git and writes the request; the turn that follows runs with
// only the tools that look.
import { execFile } from 'node:child_process';

const MAX_DIFF = 60_000; // characters of diff handed over; a larger change is read from the files

const git = (cwd, args) =>
  new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 20_000 }, (err, stdout) => resolve(err ? null : stdout));
  });

/**
 * What `/review <words>` is about.
 *   (nothing)          what has changed since the last commit, staged or not, and new files
 *   staged             what is staged
 *   commit <sha>       one commit
 *   <branch or ref>    what this branch adds on top of it
 * Words that are none of these are a thing to pay attention to: "/review error handling".
 * @returns {Promise<{ error: string } | { label: string, diff: string, untracked: string[], focus: string }>}
 */
export async function reviewTarget(cwd, words = []) {
  if ((await git(cwd, ['rev-parse', '--is-inside-work-tree']))?.trim() !== 'true') return { error: 'This folder is not a git repository, so there is no change to review. Name the files instead: "review src/app.js".' };
  const [first = '', ...rest] = words;
  let label;
  let diff;
  let untracked = [];
  let focus = words;
  if (first === 'staged') {
    [label, diff, focus] = ['the staged changes', await git(cwd, ['diff', '--cached']), rest];
  } else if (first === 'commit') {
    const sha = rest[0] ?? 'HEAD';
    const shown = await git(cwd, ['show', '--format=commit %h%n%s%n', sha]);
    if (shown == null) return { error: `There is no commit "${sha}".` };
    [label, diff, focus] = [`commit ${sha}`, shown, rest.slice(1)];
  } else if (first && (await git(cwd, ['rev-parse', '--verify', '--quiet', `${first}^{commit}`])) != null) {
    [label, diff, focus] = [`what this branch adds on top of ${first}`, await git(cwd, ['diff', `${first}...HEAD`]), rest];
  } else {
    const hasHead = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])) != null;
    label = 'the changes since the last commit';
    diff = hasHead ? await git(cwd, ['diff', 'HEAD']) : await git(cwd, ['diff', '--cached']);
    untracked = ((await git(cwd, ['ls-files', '--others', '--exclude-standard'])) ?? '').split('\n').filter(Boolean);
  }
  if (diff == null) return { error: 'git could not produce the change.' };
  if (!diff.trim() && !untracked.length) return { error: `Nothing to review in ${label}: there is no difference.` };
  return { label, diff, untracked, focus: focus.join(' ').trim() };
}

/** The message the review turn starts from. */
export function reviewPrompt({ label, diff, untracked, focus }) {
  const cut = diff.length > MAX_DIFF;
  const shown = cut ? diff.slice(0, MAX_DIFF) : diff;
  const parts = [
    `Review ${label}. Find what is wrong with it; do not change anything.`,
    `Report defects that would matter to someone using or maintaining this code: wrong results, crashes, lost or corrupted data, security holes, broken error handling, a test that no longer tests what it claims. For each one give the file and line, what is wrong, and a concrete case where it goes wrong (the input or state, and what happens). Put the most severe first. Leave out style, naming and things you would merely have written differently.`,
    `Read the surrounding code before you call something a defect: a line that looks wrong alone is often right in its place. Say which findings you confirmed by reading or running something and which you only suspect. If you find nothing wrong, say so plainly, and say what you looked at.`,
    `This turn can only look: reading, searching and commands that change nothing run; edits and other commands are refused. Do not try to fix what you find.`,
  ];
  if (focus) parts.push(`The user asks you to look especially at: ${focus}`);
  if (shown.trim()) parts.push(`The change${cut ? ` (the first ${MAX_DIFF} of ${diff.length} characters; read the files themselves for the rest)` : ''}:\n\n\`\`\`diff\n${shown.trimEnd()}\n\`\`\``);
  if (untracked.length) parts.push(`New files that git does not track yet, to read in full:\n${untracked.slice(0, 40).map((f) => `- ${f}`).join('\n')}${untracked.length > 40 ? `\n- … and ${untracked.length - 40} more` : ''}`);
  return parts.join('\n\n');
}

/** What a tool that changes something is told during a review. */
export const REVIEWING = 'Not run: this is a review, which only looks. Report what you found instead of changing it; the user decides what to fix.';
