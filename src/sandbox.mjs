// The sandbox for shell commands: a command the model runs is started under the system's own
// sandbox — Seatbelt (`sandbox-exec`) on macOS, bubblewrap (`bwrap`) on Linux. It reads as usual and
// writes only where its work belongs: the project, temporary folders and the package caches. Unless
// it is allowed, it has no network beyond this machine. It is one more guard beside the approval
// rules, not instead of them: a command still asks first where it would have asked.
//
// What it does not cover: tools that are not shell commands (SEEKER's own file tools are kept off
// secret files by the permission check, src/secrets.mjs), a provider's own tools (Claude Code runs its Bash itself), and the
// `!command` lines you type yourself.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seekerSecretFiles } from './secrets.mjs';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

let bwrap; // undefined: not looked for yet; null: not usable; a path: usable
/** bubblewrap, if it is installed and this system lets it make a sandbox (some forbid unprivileged ones). */
function bwrapPath() {
  if (bwrap === undefined) {
    bwrap = null;
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      const candidate = path.join(dir, 'bwrap');
      if (!dir || !fs.existsSync(candidate)) continue;
      try {
        execFileSync(candidate, ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '/bin/sh', '-c', 'true'], { stdio: 'ignore', timeout: 5000 });
        bwrap = candidate;
      } catch {}
      break;
    }
  }
  return bwrap;
}

let privateNet; // whether bubblewrap can give a command a network of its own here
/** Run as root, or inside some containers, bubblewrap cannot set up a private network. */
function bwrapCanCutNetwork() {
  if (privateNet === undefined) {
    try {
      execFileSync(bwrapPath(), ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-net', '/bin/sh', '-c', 'true'], { stdio: 'ignore', timeout: 5000 });
      privateNet = true;
    } catch {
      privateNet = false;
    }
  }
  return privateNet;
}

/** Which sandbox this machine has: 'seatbelt', 'bwrap', or null for none. */
export function sandboxKind(platform = process.platform) {
  if (platform === 'darwin') return fs.existsSync(SANDBOX_EXEC) ? 'seatbelt' : null;
  if (platform === 'linux') return bwrapPath() ? 'bwrap' : null;
  return null;
}

/** Whether this machine can sandbox a command at all. */
export const sandboxAvailable = (platform = process.platform) => sandboxKind(platform) !== null;
export const NO_SANDBOX = 'this machine has none (it needs macOS, or Linux with bubblewrap installed and allowed to run)';

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

// What a command has no business reading: the settings file holds API keys, the key file opens the daemon.
const secretFiles = seekerSecretFiles;

/** The Seatbelt profile for a command started in `cwd`. Later rules win over earlier ones. */
export function sandboxProfile(cwd, { write = [], network = false } = {}) {
  const secrets = secretFiles();
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${writablePlaces(cwd, { write }).map((p) => `(subpath ${quoted(p)})`).join(' ')})`,
    `(deny file-read* ${secrets.map((p) => `(literal ${quoted(p)})`).join(' ')})`,
    // Cut off from the network, a command still reaches this machine itself: a test that starts a
    // server on 127.0.0.1 and talks to it must go on working.
    network ? null : '(deny network*)',
    network ? null : '(allow network-outbound (remote ip "localhost:*") (remote unix-socket))',
    network ? null : '(allow network-inbound (local ip "localhost:*") (local unix-socket))',
    network ? null : '(allow network-bind (local ip "localhost:*") (local unix-socket))',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The bubblewrap arguments for a command started in `cwd`: the whole system read-only, the
 * writable places bound over it, the secrets replaced by an empty file, and — unless the network
 * is allowed — a network of its own that holds nothing but this machine's loopback.
 */
export function bwrapArgs(cwd, { write = [], network = false } = {}) {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc'];
  // /dev is made fresh above; the other places are the real ones. One that does not exist is skipped.
  for (const place of writablePlaces(cwd, { write })) if (!['/dev', '/private/tmp', '/private/var/folders'].includes(place)) args.push('--bind-try', place, place);
  args.push('--bind-try', '/tmp', '/tmp', '--bind-try', '/var/tmp', '/var/tmp');
  for (const secret of secretFiles()) if (fs.existsSync(secret)) args.push('--ro-bind', '/dev/null', secret);
  if (!network) args.push('--unshare-net');
  args.push('--die-with-parent', '--chdir', real(cwd));
  return args;
}

/**
 * How to start `command`: under the sandbox when it is switched on, plainly when it is off.
 * @param {{ write?: string[], network?: boolean } | null} sandbox  null: switched off
 * @returns {{ cmd: string, argv: string[], sandboxed: boolean }}
 * @throws when the sandbox is on and this machine has none: running unguarded would break the promise made.
 */
export function shellCommand(shell, command, cwd, sandbox, platform = process.platform) {
  if (!sandbox) return { cmd: shell, argv: ['-c', command], sandboxed: false };
  const kind = sandboxKind(platform);
  if (kind === 'seatbelt') return { cmd: SANDBOX_EXEC, argv: ['-p', sandboxProfile(cwd, sandbox), shell, '-c', command], sandboxed: true };
  if (kind === 'bwrap') {
    // Running with the network open when it was to be closed would break the promise made, so this is refused too.
    if (!sandbox.network && !bwrapCanCutNetwork()) throw new Error('The sandbox cannot cut a command off from the network on this machine (bubblewrap cannot make a private network when SEEKER runs as root, or inside some containers). Allow the network with `/config sandboxNetwork on`, or run SEEKER as an ordinary user.');
    return { cmd: bwrapPath(), argv: [...bwrapArgs(cwd, sandbox), shell, '-c', command], sandboxed: true };
  }
  throw new Error(`The sandbox is switched on, but ${NO_SANDBOX}. Switch it off with \`/sandbox off\` to run commands without it.`);
}

/** Added to a command's output when the sandbox is what stopped it, so the model does not retry blindly. */
export const SANDBOX_HINT = '[The sandbox stopped this: a write outside the project, the temporary folders and the package caches; a read of SEEKER\'s own settings; or, unless the network is allowed, a connection beyond this machine. Work inside the project, or tell the user what it needs: they can allow a folder with `/config sandboxWrite <path>`, allow the network with `/config sandboxNetwork on`, or switch the sandbox off with `/sandbox off`.]';
export const blockedBySandbox = (output) => /operation not permitted|read-only file system|sandbox-exec: |bwrap: |deny\(1\) file-write|network is unreachable|could not resolve host|temporary failure in name resolution|getaddrinfo (ENOTFOUND|EAI_AGAIN)/i.test(output);
