// The sandbox for shell commands: on macOS a command the model runs is started under Seatbelt
// (`sandbox-exec`), which lets it read as usual and write only where its work belongs — the project,
// temporary folders and the package caches. It is one more guard beside the approval rules, not
// instead of them: a command still asks first where it would have asked.
//
// What it does not cover: tools that are not shell commands (SEEKER's own file tools stay inside the
// project by their own check), a provider's own tools (Claude Code runs its Bash itself), and the
// `!command` lines you type yourself.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

/** Whether this machine can sandbox a command at all. */
export const sandboxAvailable = (platform = process.platform) => platform === 'darwin' && fs.existsSync(SANDBOX_EXEC);

// Places a build or an install writes outside the project. Without them `npm install` fails in the sandbox.
const CACHES = ['.npm', '.cache', '.pnpm-store', '.yarn', '.bun/install/cache', '.cargo/registry', '.cargo/git', 'go/pkg/mod', '.gradle', '.m2', 'Library/Caches'];

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const expand = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);
const quoted = (p) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const gitDirs = new Map();
/** Where git keeps this folder's history when that is outside it (a worktree, a submodule): commits must still work. */
function gitDirOutside(cwd) {
  if (!gitDirs.has(cwd)) {
    let dir = null;
    try {
      const out = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
      const inside = !path.relative(cwd, out).startsWith('..');
      if (out && !inside) dir = real(out);
    } catch {}
    gitDirs.set(cwd, dir);
  }
  return gitDirs.get(cwd);
}

/** The folders a sandboxed command may write to. */
export function writablePlaces(cwd, { write = [] } = {}) {
  const home = os.homedir();
  const places = [real(cwd), '/private/tmp', '/private/var/folders', real(os.tmpdir()), '/dev', ...CACHES.map((c) => path.join(home, c)), ...write.map((w) => real(path.resolve(cwd, expand(String(w)))))];
  const git = gitDirOutside(real(cwd));
  if (git) places.push(git);
  return [...new Set(places)];
}

/** The Seatbelt profile for a command started in `cwd`. Later rules win over earlier ones. */
export function sandboxProfile(cwd, { write = [], network = true } = {}) {
  // What a command has no business reading: the settings file holds API keys, the key file opens the daemon.
  const secrets = [path.join(HOME_DIR, 'config.json'), path.join(HOME_DIR, 'remote.sock.key'), path.join(HOME_DIR, 'push.json')].map(real);
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${writablePlaces(cwd, { write }).map((p) => `(subpath ${quoted(p)})`).join(' ')})`,
    `(deny file-read* ${secrets.map((p) => `(literal ${quoted(p)})`).join(' ')})`,
    network ? null : '(deny network*)',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * How to start `command`: under the sandbox when it is switched on, plainly when it is off.
 * @param {{ write?: string[], network?: boolean } | null} sandbox  null: switched off
 * @returns {{ cmd: string, argv: string[], sandboxed: boolean }}
 * @throws when the sandbox is on and this machine has none: running unguarded would break the promise made.
 */
export function shellCommand(shell, command, cwd, sandbox, platform = process.platform) {
  if (!sandbox) return { cmd: shell, argv: ['-c', command], sandboxed: false };
  if (!sandboxAvailable(platform)) throw new Error('The sandbox is switched on, but this machine has none (it needs macOS). Switch it off with `/sandbox off` to run commands without it.');
  return { cmd: SANDBOX_EXEC, argv: ['-p', sandboxProfile(cwd, sandbox), shell, '-c', command], sandboxed: true };
}

/** Added to a command's output when the sandbox is what stopped it, so the model does not retry blindly. */
export const SANDBOX_HINT = '[The sandbox stopped a write outside the project, the temporary folders and the package caches, or a read of SEEKER\'s own settings. Work inside the project, or tell the user what it needs: they can allow a folder with `/config sandboxWrite <path>` or switch the sandbox off with `/sandbox off`.]';
export const blockedBySandbox = (output) => /operation not permitted|sandbox-exec: |deny\(1\) file-write/i.test(output);
