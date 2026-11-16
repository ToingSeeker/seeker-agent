// Where the shell commands the model starts run. By default on this machine ('local'). Two others:
//
//   docker:<image>         every command in a fresh container of that image. The project folder (the git
//                          repository it is in, if any) is mounted at the same path, so SEEKER's file tools
//                          and the command see the same files; nothing else of this machine is visible.
//   ssh:<host>[:<folder>]  every command on another machine. The project is copied there before the
//                          command (rsync, removing what was removed here) and what the command changed is
//                          copied back after it. <folder> is on that machine, relative to its home unless it
//                          starts with /; without one it is seeker/<project>-<hash>.
//
// The file tools (read, write, edit, grep) keep working on this machine's copy either way, and approvals are
// asked exactly as before. Only the user's own config sets this: a project cannot send its files elsewhere.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';

export const LOCAL = 'local';
// Built or installed per machine, and large: left out of the copy both ways. node_modules built on a Mac does
// not run on Linux anyway; the other machine installs its own.
export const DEFAULT_EXCLUDE = ['node_modules', '.venv', 'venv', '__pycache__', '.next', 'target', '.DS_Store'];

const IMAGE = /^[a-z0-9][a-z0-9._\/:@-]{0,254}$/i;
const HOST = /^[a-z0-9_][a-z0-9._@-]{0,252}$/i; // an ssh config alias, host, or user@host; never an option
const FOLDER = /^[a-z0-9._\/-]{1,255}$/i;
const PATTERN = /^[^\s'"`$\\;|&<>]{1,100}$/;

/** Reads the setting from text. Returns undefined when it is not one of the forms above. */
export function parseBackend(text) {
  const v = String(text ?? '').trim();
  if (['', 'local', 'off', 'none', 'default', '-'].includes(v.toLowerCase())) return LOCAL;
  const docker = /^docker:(.+)$/i.exec(v);
  if (docker) return IMAGE.test(docker[1]) ? `docker:${docker[1]}` : undefined;
  const ssh = /^ssh:([^:]+)(?::(.+))?$/i.exec(v);
  if (ssh) {
    const [, host, folder] = ssh;
    if (!HOST.test(host)) return undefined;
    if (folder !== undefined && (!FOLDER.test(folder) || folder.split('/').includes('..'))) return undefined;
    return folder ? `ssh:${host}:${folder}` : `ssh:${host}`;
  }
  return undefined;
}

/** The exclude patterns from text: a comma-separated list, "default" for the usual ones, "none" for none. */
export function parseExclude(text) {
  const v = String(text ?? '').trim();
  if (['', 'default'].includes(v.toLowerCase())) return [...DEFAULT_EXCLUDE];
  if (['none', 'off', '-'].includes(v.toLowerCase())) return [];
  const list = v.split(',').map((p) => p.trim()).filter(Boolean);
  return list.every((p) => PATTERN.test(p) && !p.startsWith('-')) ? list : undefined;
}

/** The backend the config asks for: null to run on this machine, else { kind, … }. Throws on a malformed setting. */
export function backendOf(config, cwd) {
  const value = parseBackend(config.backend ?? LOCAL);
  if (value === undefined) throw new Error(`The backend setting "${config.backend}" is not one SEEKER understands: use local, docker:<image> or ssh:<host>[:<folder>].`);
  if (value === LOCAL) return null;
  // The sandbox setting keeps its meaning: switched on without the network, the command gets none.
  const network = !(config.sandbox && config.sandboxNetwork !== true);
  if (value.startsWith('docker:')) {
    const root = mountRoot(cwd);
    // Mounting a folder that holds SEEKER's settings (API keys) or the whole home folder would hand them to the command.
    if (holds(root, HOME_DIR) || holds(root, os.homedir())) throw new Error(`Docker would have to mount ${root}, which holds ${holds(root, HOME_DIR) ? "SEEKER's settings and API keys" : 'your whole home folder'}. Open SEEKER in a project folder to use docker:.`);
    return { kind: 'docker', image: value.slice(7), network, root };
  }
  // The sandbox's promise of no network cannot be kept on another machine, so it is not broken silently.
  if (!network) throw new Error('The sandbox is on without the network, and that cannot be enforced on another machine. Allow the network with `/config sandboxNetwork on`, switch the sandbox off, or use docker:.');
  const [, host, folder] = /^ssh:([^:]+)(?::(.+))?$/.exec(value);
  const exclude = Array.isArray(config.backendExclude) ? config.backendExclude : DEFAULT_EXCLUDE;
  return { kind: 'ssh', host, dir: folder ?? defaultFolder(cwd), exclude, network };
}

/** One line for the system prompt and /status: where commands run. */
export function describeBackend(backend) {
  if (!backend) return 'this machine';
  if (backend.kind === 'docker') return `a Docker container of ${backend.image} (fresh for each command; only ${backend.root} is shared with this machine, at the same path${backend.network ? '' : '; no network'})`;
  return `${backend.host}, in its folder ${backend.dir}: a copy of the project synced there before each command and back after it (left out both ways: ${backend.exclude.join(', ') || 'nothing'})`;
}

/** Whether folder `outer` is `inner` or one of the folders it is in. */
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
// Compared as real paths: a home folder reached through a link (/tmp and /private/tmp on macOS) is still home.
const holds = (outer, inner) => {
  const rel = path.relative(real(outer), real(inner));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * The git repository the folder is in, so git works inside the container; else the folder itself. The walk
 * stops below the home folder: a home folder that is itself a repository must not be mounted whole.
 */
function mountRoot(cwd) {
  const home = path.resolve(os.homedir());
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (holds(dir, home) || holds(dir, HOME_DIR)) return cwd;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (dir === path.dirname(dir)) return cwd;
  }
}

const defaultFolder = (cwd) => {
  const name = path.basename(cwd).replace(/[^a-z0-9._-]+/gi, '-').replace(/^[-.]+/, '') || 'project';
  return `seeker/${name}-${crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`;
};

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30'];
let runs = 0;

/**
 * How to start one command there.
 * @returns {{ cmd, argv, before: () => Promise<string>, after: () => Promise<string>, kill: () => void }}
 *   before/after return '' or a line about what went wrong, added to the command's output.
 */
export function backendCommand(backend, command, cwd, { platform = process.platform } = {}) {
  if (backend.kind === 'invalid') throw new Error(backend.error);
  const tag = `seeker-${process.pid}-${++runs}-${crypto.randomBytes(3).toString('hex')}`;
  if (backend.kind === 'docker') {
    // A command in a folder outside the mounted one would see an empty path; the working folder is always inside it.
    const user = platform === 'linux' && process.getuid ? ['-u', `${process.getuid()}:${process.getgid()}`, '-e', 'HOME=/tmp'] : [];
    const argv = [
      'run', '--rm', '--init', '--name', tag,
      '-v', `${backend.root}:${backend.root}`, '-w', cwd,
      '-e', 'CI=1', '-e', 'PAGER=cat', '-e', 'GIT_PAGER=cat', '-e', 'GIT_TERMINAL_PROMPT=0',
      ...user,
      ...(backend.network ? [] : ['--network', 'none']),
      backend.image, 'sh', '-c', command,
    ];
    return { cmd: 'docker', argv, before: async () => '', after: async () => '', kill: () => detach('docker', ['rm', '-f', tag]) };
  }
  // On the other machine: its own process group (setsid where there is one), so stopping it stops all it started.
  const dir = backend.dir;
  const script = [
    `mkdir -p ${quote(dir)} && cd ${quote(dir)} || exit 1`,
    'export CI=1 PAGER=cat GIT_PAGER=cat GIT_TERMINAL_PROMPT=0',
    `if command -v setsid >/dev/null 2>&1; then exec setsid sh -c ${quote(command)} ${tag}; else exec sh -c ${quote(command)} ${tag}; fi`,
  ].join('; ');
  // '[s]eeker-…' matches the command's own line but not this one, which holds the pattern, not the tag.
  const match = `'[${tag[0]}]${tag.slice(1)}'`;
  const killScript = `p=$(pgrep -f ${match} | head -n 1); [ -n "$p" ] && kill -KILL -- -"$p" 2>/dev/null; pkill -KILL -f ${match}; true`;
  return {
    cmd: 'ssh',
    argv: [...SSH_OPTIONS, backend.host, script],
    before: () => sync(backend, cwd, 'push'),
    after: () => sync(backend, cwd, 'pull'),
    kill: () => detach('ssh', [...SSH_OPTIONS, backend.host, killScript]),
  };
}

function detach(cmd, argv) {
  try {
    const child = spawn(cmd, argv, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

/** rsync arguments for one direction. Push removes there what was removed here; pull never removes anything here. */
export function rsyncArgs(backend, cwd, direction) {
  const remote = `${backend.host}:${backend.dir.replace(/\/+$/, '')}/`;
  const local = `${cwd.replace(/\/+$/, '')}/`;
  const excludes = backend.exclude.flatMap((p) => ['--exclude', p]);
  const ssh = ['-e', `ssh ${SSH_OPTIONS.join(' ')}`];
  return direction === 'push'
    ? ['-az', '--delete', ...excludes, ...ssh, `--rsync-path=mkdir -p ${quote(backend.dir)} && rsync`, local, remote]
    : ['-az', ...excludes, ...ssh, remote, local];
}

// Two commands running side by side (helper agents) must not copy at the same time.
const queues = new Map();
function sync(backend, cwd, direction) {
  const key = `${backend.host}:${backend.dir}`;
  const run = (queues.get(key) ?? Promise.resolve()).then(() => rsync(rsyncArgs(backend, cwd, direction)));
  queues.set(key, run.catch(() => {}));
  return run.then(
    ({ code, output }) => (code === 0 ? '' : `[copying the project ${direction === 'push' ? `to ${backend.host}` : `back from ${backend.host}`} failed (rsync exit ${code}): ${output.trim().split('\n').slice(-3).join(' ')}]`),
    (err) => `[could not copy the project ${direction === 'push' ? 'there' : 'back'}: ${err.message}]`,
  );
}

function rsync(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn('rsync', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000);
    child.on('error', (err) => (clearTimeout(timer), reject(err)));
    child.on('close', (code) => (clearTimeout(timer), resolve({ code, output })));
  });
}

/** Whether the backend can be reached: Docker answering, or the host taking a key-based login with rsync on both ends. */
export function checkBackend(backend) {
  const probe = (cmd, argv) =>
    new Promise((resolve) => {
      const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
      child.on('error', (err) => (clearTimeout(timer), resolve({ ok: false, output: err.code === 'ENOENT' ? `${cmd} is not installed` : err.message })));
      child.on('close', (code) => (clearTimeout(timer), resolve({ ok: code === 0, output: output.trim() })));
    });
  if (backend.kind === 'docker') return probe('docker', ['version', '--format', '{{.Server.Version}}']).then((r) => (r.ok ? { ok: true, detail: `Docker ${r.output}` } : { ok: false, detail: `Docker does not answer: ${r.output.split('\n').at(-1)}` }));
  return probe('rsync', ['--version']).then(async (local) => {
    if (!local.ok) return { ok: false, detail: 'rsync is not installed on this machine' };
    const r = await probe('ssh', [...SSH_OPTIONS, backend.host, 'command -v rsync >/dev/null || { echo "rsync is not installed there"; exit 3; }; uname -sm']);
    return r.ok ? { ok: true, detail: `${backend.host}: ${r.output}` } : { ok: false, detail: `${backend.host}: ${r.output.split('\n').at(-1) || 'no answer'} (SEEKER logs in with a key, without a password prompt)` };
  });
}
