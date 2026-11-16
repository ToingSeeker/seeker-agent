// Where the model's shell commands run: the setting, the commands built for Docker and ssh, and the bash
// tool really running through them. ssh is played by a stand-in that runs the command on this machine in a
// folder that acts as the other machine's home, so rsync really copies the project there and back. The
// Docker check runs where Docker answers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HOME_DIR, SETTINGS } from '../src/config.mjs';
import { DEFAULT_EXCLUDE, LOCAL, backendCommand, backendOf, describeBackend, parseBackend, parseExclude, rsyncArgs } from '../src/backend.mjs';
import { buildSystemPrompt } from '../src/prompt.mjs';
import { TOOL_BY_NAME } from '../src/tools.mjs';

const tmp = (name = 'seeker-be-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name)));
const bash = (args, ctx) => TOOL_BY_NAME.get('bash').run(args, { state: {}, ...ctx });
const has = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore', timeout: 15_000 }).status === 0;

test('backend: the setting takes local, docker:<image> and ssh:<host>[:<folder>], and nothing that could become an option or a second command', () => {
  for (const v of ['', 'local', 'off', 'default']) assert.equal(parseBackend(v), LOCAL);
  assert.equal(parseBackend('docker:node:22'), 'docker:node:22');
  assert.equal(parseBackend('docker:ghcr.io/me/img@sha256:abc'), 'docker:ghcr.io/me/img@sha256:abc');
  assert.equal(parseBackend('ssh:build-box'), 'ssh:build-box');
  assert.equal(parseBackend('ssh:me@10.0.0.2:work/app'), 'ssh:me@10.0.0.2:work/app');
  assert.equal(parseBackend('ssh:box:/srv/app'), 'ssh:box:/srv/app');
  for (const bad of ['docker:', 'docker:a b', 'docker:x;rm -rf ~', 'ssh:-oProxyCommand=x', 'ssh:box:../up', 'ssh:box:a b', "ssh:box:it's", 'ssh:', 'kubernetes:x', 'docker:$(id)']) {
    assert.equal(parseBackend(bad), undefined, bad);
  }
  assert.equal(SETTINGS.backend.parse('docker:alpine'), 'docker:alpine');
  assert.equal(SETTINGS.backend.parse('nonsense'), undefined);

  assert.deepEqual(parseExclude('default'), DEFAULT_EXCLUDE);
  assert.deepEqual(parseExclude('none'), []);
  assert.deepEqual(parseExclude('dist, *.log'), ['dist', '*.log']);
  assert.equal(parseExclude('--delete-excluded'), undefined);
  assert.equal(parseExclude("a';b"), undefined);
});

test('backend: Docker gets the repository mounted at the same path, no network when the sandbox says so, and a name to stop it by', () => {
  const repo = tmp();
  fs.mkdirSync(path.join(repo, '.git'));
  const cwd = path.join(repo, 'pkg');
  fs.mkdirSync(cwd);
  assert.equal(backendOf({ backend: 'local' }, cwd), null);
  assert.equal(backendOf({}, cwd), null);
  assert.throws(() => backendOf({ backend: 'docker:a b' }, cwd), /not one SEEKER understands/);

  const open = backendOf({ backend: 'docker:node:22' }, cwd);
  assert.deepEqual(open, { kind: 'docker', image: 'node:22', network: true, root: repo });
  const { cmd, argv } = backendCommand(open, 'npm test', cwd, { platform: 'darwin' });
  assert.equal(cmd, 'docker');
  assert.deepEqual(argv.slice(0, 3), ['run', '--rm', '--init']);
  assert.equal(argv[argv.indexOf('-v') + 1], `${repo}:${repo}`);
  assert.equal(argv[argv.indexOf('-w') + 1], cwd);
  assert.match(argv[argv.indexOf('--name') + 1], /^seeker-\d+-\d+-[0-9a-f]{6}$/);
  assert.deepEqual(argv.slice(-4), ['node:22', 'sh', '-c', 'npm test']);
  assert.ok(!argv.includes('--network'));
  assert.ok(!argv.includes('-u'), 'Docker Desktop maps the owner itself');

  const closed = backendOf({ backend: 'docker:node:22', sandbox: true }, cwd);
  assert.equal(closed.network, false);
  const linux = backendCommand(closed, 'true', cwd, { platform: 'linux' }).argv;
  assert.equal(linux[linux.indexOf('--network') + 1], 'none');
  assert.ok(linux.includes('-u'), 'on Linux files it writes stay the user’s');
  assert.equal(backendOf({ backend: 'docker:x', sandbox: true, sandboxNetwork: true }, cwd).network, true);
});

test('backend: ssh copies the project there with deletions, back without them, leaving the excluded folders out both ways', () => {
  const cwd = tmp();
  const b = backendOf({ backend: 'ssh:me@box' }, cwd);
  assert.equal(b.host, 'me@box');
  assert.match(b.dir, /^seeker\/seeker-be-[^/]+-[0-9a-f]{8}$/);
  assert.deepEqual(b.exclude, DEFAULT_EXCLUDE);
  assert.equal(backendOf({ backend: 'ssh:box:srv/app', backendExclude: ['dist'] }, cwd).dir, 'srv/app');

  const push = rsyncArgs({ ...b, dir: 'w/app', exclude: ['node_modules'] }, cwd, 'push');
  assert.ok(push.includes('--delete'));
  assert.deepEqual(push.slice(-2), [`${cwd}/`, 'me@box:w/app/']);
  assert.ok(push.includes("--rsync-path=mkdir -p 'w/app' && rsync"));
  const pull = rsyncArgs({ ...b, dir: 'w/app', exclude: ['node_modules'] }, cwd, 'pull');
  assert.ok(!pull.includes('--delete'), 'copying back never removes anything here');
  assert.deepEqual(pull.slice(-2), ['me@box:w/app/', `${cwd}/`]);
  for (const args of [push, pull]) assert.equal(args[args.indexOf('--exclude') + 1], 'node_modules');

  const { cmd, argv } = backendCommand(b, "echo 'it''s'", cwd);
  assert.equal(cmd, 'ssh');
  assert.ok(argv.includes('BatchMode=yes'), 'never stops at a password prompt');
  assert.equal(argv.at(-2), 'me@box');
  assert.match(argv.at(-1), /cd 'seeker\/.+' \|\| exit 1/);
  assert.ok(argv.at(-1).includes(`'echo '\\''it'\\'''\\''s'\\'''`), 'the command reaches the other shell as one quoted word');
});

test('backend: the model is told where its commands run', () => {
  const cwd = tmp();
  const plain = buildSystemPrompt({ cwd, model: 'm' }).prompt;
  assert.ok(!plain.includes('bash runs'));
  const docker = buildSystemPrompt({ cwd, model: 'm', backend: backendOf({ backend: 'docker:python:3.12' }, cwd) }).prompt;
  assert.match(docker, /bash runs in a Docker container of python:3\.12/);
  const ssh = buildSystemPrompt({ cwd, model: 'm', backend: backendOf({ backend: 'ssh:box:app' }, cwd) }).prompt;
  assert.match(ssh, /bash runs on box, in its folder app/);
  assert.match(describeBackend(null), /this machine/);
});

test('backend: a malformed setting stops the command with its reason instead of running it here', async () => {
  const cwd = tmp();
  await assert.rejects(bash({ command: 'touch ran' }, { cwd, backend: { kind: 'invalid', error: 'The backend setting "x" is not one SEEKER understands' } }), /not one SEEKER understands/);
  assert.ok(!fs.existsSync(path.join(cwd, 'ran')));
});

const rsyncHere = has('rsync', ['--version']);
test('backend: through ssh the project is copied there, the command runs there, and what it changed comes back', { skip: !rsyncHere && 'needs rsync' }, async (t) => {
  const cwd = tmp('seeker-be-proj-');
  const home = tmp('seeker-be-remote-');
  const bin = tmp('seeker-be-bin-');
  const log = path.join(bin, 'hosts.log');
  // The stand-in for ssh: drops the options, notes the host, and runs the command in the "remote" home.
  fs.writeFileSync(
    path.join(bin, 'ssh'),
    `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) shift 2;; -*) shift;; *) break;; esac; done\necho "$1" >> '${log}'\nshift\ncd '${home}' || exit 1\nexec sh -c "$*"\n`,
    { mode: 0o755 },
  );
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  t.after(() => (process.env.PATH = saved));

  fs.writeFileSync(path.join(cwd, 'a.txt'), 'from here\n');
  fs.mkdirSync(path.join(cwd, 'node_modules'));
  fs.writeFileSync(path.join(cwd, 'node_modules', 'big.js'), 'x');
  const backend = backendOf({ backend: 'ssh:me@box:work/app' }, cwd);

  const r = await bash({ command: 'pwd; cat a.txt; ls; echo made there > b.txt' }, { cwd, backend });
  const there = path.join(home, 'work', 'app');
  assert.match(r.output, new RegExp(`${there.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`), r.output);
  assert.match(r.output, /from here/);
  assert.ok(!/node_modules/.test(r.output), 'the excluded folder is not copied there');
  assert.equal(fs.readFileSync(path.join(cwd, 'b.txt'), 'utf8'), 'made there\n', 'what the command made came back');
  assert.ok(fs.readFileSync(log, 'utf8').split('\n').every((h) => !h || h === 'me@box'));

  // Removed here: removed there before the next command; something only there is never removed here.
  fs.rmSync(path.join(cwd, 'a.txt'));
  fs.mkdirSync(path.join(there, 'node_modules'));
  fs.writeFileSync(path.join(there, 'node_modules', 'linux.js'), 'y');
  const r2 = await bash({ command: 'ls; ls node_modules' }, { cwd, backend });
  assert.ok(!/a\.txt/.test(r2.output), r2.output);
  assert.match(r2.output, /linux\.js/, 'the other machine keeps its own installed packages');
  assert.ok(fs.existsSync(path.join(cwd, 'node_modules', 'big.js')));
  assert.ok(!fs.existsSync(path.join(cwd, 'node_modules', 'linux.js')), 'nor are they copied back');

  // Stopping the command stops it there, and the run still ends.
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 1500);
  const started = Date.now();
  const r3 = await bash({ command: 'sleep 30; echo late > late.txt' }, { cwd, backend, signal: ac.signal });
  assert.match(r3.output, /interrupted/);
  assert.ok(Date.now() - started < 15_000);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok(!fs.existsSync(path.join(there, 'late.txt')));

  // A copy that fails stops the command before it runs.
  const broken = { ...backend, host: 'me@box', dir: 'work/app' };
  fs.writeFileSync(path.join(bin, 'rsync'), '#!/bin/sh\necho "connection refused" >&2\nexit 12\n', { mode: 0o755 });
  await assert.rejects(bash({ command: 'echo ran > ran.txt' }, { cwd, backend: broken }), /copying the project to me@box failed \(rsync exit 12\): connection refused.*not run/);
  assert.ok(!fs.existsSync(path.join(there, 'ran.txt')));
});

const docker = has('docker', ['version', '--format', '{{.Server.Version}}']) && has('docker', ['image', 'inspect', 'alpine:3.20']);
test('backend: a command really runs in a container that sees the project and nothing else here', { skip: !docker && 'needs Docker with the alpine:3.20 image' }, async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'hi\n');
  const backend = backendOf({ backend: 'docker:alpine:3.20' }, cwd);
  const r = await bash({ command: `cat a.txt; echo made > b.txt; uname -s; ls ${JSON.stringify(os.homedir())} 2>&1` }, { cwd, backend });
  assert.match(r.output, /hi\nLinux\n/);
  assert.match(r.output, /No such file or directory/, 'the home folder of this machine is not there');
  assert.equal(fs.readFileSync(path.join(cwd, 'b.txt'), 'utf8'), 'made\n');

  const ac = new AbortController();
  setTimeout(() => ac.abort(), 2000);
  const r2 = await bash({ command: 'sleep 60' }, { cwd, backend, signal: ac.signal });
  assert.match(r2.output, /interrupted/);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const left = spawnSync('docker', ['ps', '--filter', `name=^seeker-${process.pid}-`, '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(left, '', 'the stopped container is gone');
});

test('backend: /backend shows where commands run, refuses a bad value, and switches only after the check passes', async (t) => {
  const { runCommand } = await import('../src/commands.mjs');
  const { DEFAULTS } = await import('../src/config.mjs');
  const { Permissions } = await import('../src/permissions.mjs');
  const said = [];
  const ui = { c: new Proxy({}, { get: () => (x) => String(x) }), line: (x) => void said.push(x), notice: (x) => void said.push(x), warn: (x) => void said.push(x) };
  let reloaded = 0;
  const agent = { cwd: tmp(), reload: () => void reloaded++ };
  const config = { ...DEFAULTS };
  const run = (input) => runCommand(input, { agent, ui, config, permissions: new Permissions({ mode: 'ask', cwd: os.tmpdir(), ask: null }), session: null, hub: null });

  await run('/backend');
  assert.match(said.join('\n'), /backend local[\s\S]*runs on this machine/);
  said.length = 0;
  await run('/backend docker:a;b');
  assert.match(said.join('\n'), /\/backend local \| docker:<image>/);
  assert.equal(config.backend, 'local');

  // The ssh stand-in turns every login away, so nothing is switched.
  const bin = tmp('seeker-be-bin-');
  fs.writeFileSync(path.join(bin, 'ssh'), '#!/bin/sh\necho "Permission denied (publickey)." >&2\nexit 255\n', { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  t.after(() => (process.env.PATH = saved));
  said.length = 0;
  await run('/backend ssh:me@box');
  if (rsyncHere) assert.match(said.join('\n'), /Not switched: me@box: Permission denied \(publickey\)\. \(SEEKER logs in with a key/);
  assert.equal(config.backend, 'local');
  assert.equal(reloaded, 0);

  said.length = 0;
  await run('/backend local');
  assert.equal(config.backend, 'local');
  assert.equal(reloaded, 1, 'the model is told again where its commands run');
});

test('backend: Docker never mounts the home folder or SEEKER\'s settings, even when the home folder is a git repository', (t) => {
  const home = tmp('seeker-be-home-');
  const saved = process.env.HOME;
  process.env.HOME = home;
  t.after(() => (process.env.HOME = saved));
  fs.mkdirSync(path.join(home, '.git'));
  const project = path.join(home, 'work', 'app');
  fs.mkdirSync(project, { recursive: true });
  assert.equal(backendOf({ backend: 'docker:alpine' }, project).root, project, 'the repository at home is not mounted');
  fs.mkdirSync(path.join(home, 'work', '.git'));
  assert.equal(backendOf({ backend: 'docker:alpine' }, project).root, path.join(home, 'work'), 'a repository below home is');
  assert.throws(() => backendOf({ backend: 'docker:alpine' }, home), /your whole home folder/);
  assert.throws(() => backendOf({ backend: 'docker:alpine' }, path.dirname(HOME_DIR)), /SEEKER's settings and API keys/);
});

test('backend: ssh refuses to run when the sandbox promises no network, instead of breaking that promise there', async () => {
  const cwd = tmp();
  assert.throws(() => backendOf({ backend: 'ssh:box', sandbox: true }, cwd), /cannot be enforced on another machine/);
  assert.equal(backendOf({ backend: 'ssh:box', sandbox: true, sandboxNetwork: true }, cwd).kind, 'ssh');
  await assert.rejects(bash({ command: 'touch ran' }, { cwd, backend: { kind: 'invalid', error: 'cannot be enforced on another machine' } }), /cannot be enforced/);
});

test('backend: a home folder reached through a link is still recognised and not mounted', (t) => {
  const home = tmp('seeker-be-home-');
  const link = path.join(tmp('seeker-be-link-'), 'home');
  fs.symlinkSync(home, link);
  const saved = process.env.HOME;
  process.env.HOME = link;
  t.after(() => (process.env.HOME = saved));
  fs.mkdirSync(path.join(home, '.git'));
  fs.mkdirSync(path.join(home, 'app'));
  assert.equal(backendOf({ backend: 'docker:alpine' }, path.join(home, 'app')).root, path.join(home, 'app'));
  assert.throws(() => backendOf({ backend: 'docker:alpine' }, home), /your whole home folder/);
});
