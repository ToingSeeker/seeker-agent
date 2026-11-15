// The sandbox for shell commands: what a sandboxed command may write, and that the bash tool
// really runs under it. The checks that start a real sandbox run where there is one: macOS, and
// Linux with bubblewrap.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SETTINGS } from '../src/config.mjs';
import { SANDBOX_HINT, blockedBySandbox, bwrapArgs, sandboxAvailable, sandboxKind, sandboxProfile, shellCommand, writablePlaces } from '../src/sandbox.mjs';
import { TOOL_BY_NAME, stopAllProcesses } from '../src/tools.mjs';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-sb-')));
const real = sandboxAvailable();
const skip = !real && 'needs a sandbox (macOS, or Linux with bubblewrap)';
const bash = (args, ctx) => TOOL_BY_NAME.get('bash').run(args, { state: {}, ...ctx });

test('sandbox: the profile lets a command write in the project, the temporary folders and the caches, and nowhere else', () => {
  const cwd = tmp();
  const places = writablePlaces(cwd, { write: ['~/extra', 'build out'] });
  assert.equal(places[0], cwd);
  for (const p of ['/private/tmp', '/dev', path.join(os.homedir(), '.npm'), path.join(os.homedir(), 'extra'), path.join(cwd, 'build out')]) assert.ok(places.includes(p), p);
  assert.ok(!places.includes(os.homedir()), 'not the home folder itself');

  const profile = sandboxProfile(cwd, { write: ['he said "hi"'] });
  const lines = profile.split('\n');
  assert.deepEqual(lines.slice(0, 3), ['(version 1)', '(allow default)', '(deny file-write*)']);
  assert.ok(lines[3].startsWith('(allow file-write* ') && lines[3].includes(`(subpath "${cwd}")`));
  assert.ok(lines[3].includes('he said \\"hi\\"'), 'a path cannot break out of its quotes');
  assert.match(lines[4], /^\(deny file-read\* .*config\.json/);
  assert.equal(lines[5], '(deny network*)', 'no network beyond this machine unless it is allowed');
  assert.deepEqual(lines.slice(6).map((l) => l.split(' ')[1]), ['network-outbound', 'network-inbound', 'network-bind'], 'this machine itself stays reachable');
  assert.ok(lines.slice(6).every((l) => /localhost:\*/.test(l) && !/\(allow network\*/.test(l)));
  assert.equal(sandboxProfile(cwd, { network: true }).split('\n').length, 5);

  // The same rules as bubblewrap arguments: everything read-only, the writable places bound over it.
  const args = bwrapArgs(cwd, { write: ['build out'] });
  assert.deepEqual(args.slice(0, 7), ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc']);
  const bound = args.flatMap((a, i) => (a === '--bind-try' ? [args[i + 1]] : []));
  assert.ok(bound.includes(cwd) && bound.includes(path.join(cwd, 'build out')) && bound.includes('/tmp'));
  assert.ok(!bound.includes('/') && !bound.includes(os.homedir()));
  assert.ok(args.includes('--unshare-net'));
  assert.ok(!bwrapArgs(cwd, { network: true }).includes('--unshare-net'));
  assert.deepEqual(args.slice(-3), ['--die-with-parent', '--chdir', cwd]);
});

test('sandbox: off runs the shell plainly; on where there is none refuses instead of running unguarded', () => {
  assert.deepEqual(shellCommand('/bin/sh', 'ls', '/tmp', null), { cmd: '/bin/sh', argv: ['-c', 'ls'], sandboxed: false });
  assert.throws(() => shellCommand('/bin/sh', 'ls', '/tmp', { write: [] }, 'win32'), /this machine has none/);
  assert.equal(sandboxKind('win32'), null);
  assert.equal(blockedBySandbox('touch: cannot touch \'/x\': Read-only file system'), true);
  assert.equal(blockedBySandbox('sh: /x: Operation not permitted'), true);
  assert.equal(blockedBySandbox('all good'), false);
  assert.equal(SETTINGS.sandbox.parse('on'), true);
  assert.deepEqual(SETTINGS.sandboxWrite.parse('~/a, /b'), ['~/a', '/b']);
  assert.deepEqual(SETTINGS.sandboxWrite.parse('none'), []);
});

test('sandbox: a command writes inside the project and is stopped outside it', { skip }, async (t) => {
  const cwd = tmp();
  // Somewhere that is neither the project nor a temporary folder (in a test run, HOME itself is one).
  const outside = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), `.sandbox-probe-${process.pid}`);
  t.after(() => fs.rmSync(outside, { force: true }));
  const sandbox = { write: [], network: true };

  const inside = await bash({ command: 'echo hello > in.txt && cat in.txt && echo t > "$TMPDIR/seeker-sb-probe" && rm "$TMPDIR/seeker-sb-probe"' }, { cwd, sandbox });
  assert.match(inside.output, /^hello/);
  assert.equal(fs.readFileSync(path.join(cwd, 'in.txt'), 'utf8'), 'hello\n');

  const blocked = await bash({ command: `echo x > ${JSON.stringify(outside)}` }, { cwd, sandbox });
  assert.equal(fs.existsSync(outside), false, 'nothing was written outside the project');
  assert.match(blocked.output, /operation not permitted|read-only file system/i);
  assert.ok(blocked.output.includes(SANDBOX_HINT), 'the model is told what stopped it');
  // Reading stays as it was.
  assert.match((await bash({ command: 'ls / | head -1' }, { cwd, sandbox })).output, /\S/);
  // The same command with the sandbox off is not stopped (and cleans up after itself).
  const free = await bash({ command: `echo x > ${JSON.stringify(outside)} && rm ${JSON.stringify(outside)} && echo done` }, { cwd });
  assert.match(free.output, /done/);

  // A folder the user allowed is writable; a background process is sandboxed too.
  const extra = tmp();
  await bash({ command: `echo y > ${JSON.stringify(path.join(extra, 'ok.txt'))}` }, { cwd, sandbox: { write: [extra], network: true } });
  assert.equal(fs.readFileSync(path.join(extra, 'ok.txt'), 'utf8'), 'y\n');
  const started = await bash({ command: `echo z > ${JSON.stringify(outside)}; echo finished`, background: true }, { cwd, sandbox });
  assert.match(started.output, /operation not permitted|read-only file system/i);
  assert.equal(fs.existsSync(outside), false);
  stopAllProcesses();
});

test('sandbox: git still commits in a worktree, whose history lives outside the folder', { skip }, async () => {
  const repo = tmp();
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'first');
  const tree = path.join(tmp(), 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', 'side', tree);
  const cwd = fs.realpathSync(tree);
  const made = await bash({ command: 'echo b > b.txt && git add -A && git -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false commit -q -m second && git log --oneline | wc -l' }, { cwd, sandbox: { write: [], network: true } });
  assert.match(made.output, /^\s*2\b/, made.output);
});

test('sandbox: without the network a command still reaches this machine, and nothing beyond it', { skip }, async () => {
  const cwd = tmp();
  // A server on this machine, started and called by the command itself, the way a test suite does.
  const local = `node -e "const h=require('http');const s=h.createServer((q,r)=>r.end('pong')).listen(0,'127.0.0.1',()=>h.get('http://127.0.0.1:'+s.address().port,(r)=>{let b='';r.on('data',(d)=>b+=d).on('end',()=>{console.log('local',b);s.close()})}))"`;
  const away = `node -e "require('net').connect({host:'1.1.1.1',port:443,timeout:4000}).on('connect',function(){console.log('reached');this.destroy()}).on('timeout',function(){console.log('blocked: timeout');this.destroy()}).on('error',(e)=>console.log('blocked:',e.code))"`;
  const off = { write: [], network: false };
  assert.match((await bash({ command: local }, { cwd, sandbox: off })).output, /local pong/);
  assert.match((await bash({ command: away, timeout: 20 }, { cwd, sandbox: off })).output, /blocked/);
});
