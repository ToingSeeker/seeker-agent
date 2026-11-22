// Helpers in isolated git worktrees (src/worktree.mjs and the task tool's `isolation`).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import { TOOL_BY_NAME } from '../src/tools.mjs';
import { createWorktree, finishWorktree, worktreeNote, worktreesDir } from '../src/worktree.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
const branches = (repo) => git(repo, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean);

/** A repository with one commit, holding app.txt and src/x.txt. */
function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-wt-')));
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'app.txt'), 'one\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/x.txt'), 'x\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  return dir;
}

test('an unchanged worktree is removed with its branch', async () => {
  const dir = repo();
  const wt = await createWorktree(dir, 'Look Around!');
  assert.ok(wt.dir.startsWith(worktreesDir()), 'copies live under ~/.seeker/worktrees, not in the project');
  assert.match(wt.branch, /^seeker\/look-around-[0-9a-f]{6}$/);
  assert.equal(fs.readFileSync(path.join(wt.dir, 'app.txt'), 'utf8'), 'one\n');
  assert.equal(wt.parentDirty, false);
  assert.ok(branches(dir).includes(wt.branch));

  const finished = await finishWorktree(wt);
  assert.equal(finished.kept, false);
  assert.equal(fs.existsSync(wt.dir), false);
  assert.deepEqual(branches(dir), ['main']);
  assert.match(worktreeNote(wt, finished), /changed nothing, so it was removed/);
});

test('a changed worktree is kept, and the note says what changed and where', async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'app.txt'), 'local edit\n'); // uncommitted in the folder
  const wt = await createWorktree(path.join(dir, 'src'), 'edit');
  assert.equal(wt.cwd, path.join(wt.dir, 'src'), 'started from a subfolder, it works in the same subfolder of its copy');
  assert.equal(wt.parentDirty, true);
  assert.equal(fs.readFileSync(path.join(wt.dir, 'app.txt'), 'utf8'), 'one\n', 'the copy starts from the commit, not the uncommitted edit');

  fs.writeFileSync(path.join(wt.dir, 'app.txt'), 'two\n');
  fs.writeFileSync(path.join(wt.dir, 'new.txt'), 'n\n');
  const finished = await finishWorktree(wt);
  assert.equal(finished.kept, true);
  assert.ok(fs.existsSync(wt.dir));
  assert.match(finished.stat, /app\.txt/);
  assert.deepEqual(finished.untracked, ['new.txt']);
  const note = worktreeNote(wt, finished);
  assert.match(note, new RegExp(`kept: ${wt.dir} on branch ${wt.branch}`));
  assert.match(note, /New files:\nnew\.txt/);
  assert.match(note, /for the user to approve/);
  assert.match(note, /had uncommitted changes/);
  assert.equal(fs.readFileSync(path.join(dir, 'app.txt'), 'utf8'), 'local edit\n', "the user's folder is untouched");

  // A helper that committed on its branch, leaving a clean tree, is kept too.
  const wt2 = await createWorktree(dir, 'commit');
  fs.writeFileSync(path.join(wt2.dir, 'c.txt'), 'c\n');
  git(wt2.dir, 'add', '.');
  git(wt2.dir, 'commit', '-q', '-m', 'helper');
  const f2 = await finishWorktree(wt2);
  assert.equal(f2.kept, true);
  assert.equal(f2.commits, 1);
  assert.match(f2.stat, /c\.txt/);
});

test('isolation needs a git repository with a commit', async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-wt-plain-'));
  await assert.rejects(createWorktree(plain, 'x'), /needs the working folder to be in a git repository/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-wt-empty-'));
  git(empty, 'init', '-q');
  await assert.rejects(createWorktree(empty, 'x'), /has none yet/);
});

test('the task tool rejects an isolation it does not know', async () => {
  const task = TOOL_BY_NAME.get('task');
  await assert.rejects(task.run({ prompt: 'p', isolation: 'docker' }, { delegate: async () => '' }), /must be "worktree" or left out/);
});

/** A scripted stand-in for Ollama: each request gets the next reply. */
async function fakeOllama(replies) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end((replies.shift() ?? [{ message: { content: 'out of script' }, done: true }]).map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { host: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}
const call = (name, args) => ({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } });
const done = (content) => ({ message: { content }, done: true, prompt_eval_count: 10, eval_count: 5 });
const plain = (s) => s;
const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'c' ? { dim: plain, green: plain, yellow: plain } : () => {}) });

function makeAgent(host, cwd, extra = {}) {
  const config = { ...DEFAULTS, host, bundledSkills: false, ...extra };
  const permissions = new Permissions({ mode: 'auto', cwd, ask: null });
  return new Agent({ config, ui, permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });
}

test('a helper with isolation "worktree" writes in its own copy, not in the folder', async () => {
  const dir = repo();
  const ollama = await fakeOllama([
    [call('task', { description: 'change app', prompt: 'Change app.txt to say two.', isolation: 'worktree' }), { done: true }],
    [call('write_file', { path: 'app.txt', content: 'two\n' }), { done: true }],
    [call('write_file', { path: path.join(dir, 'app.txt'), content: 'escaped\n' }), { done: true }],
    [done('Changed app.txt.')],
    [done('Done.')],
  ]);
  const agent = makeAgent(ollama.host, dir);
  await agent.runTurn('change the app');
  ollama.close();

  assert.equal(fs.readFileSync(path.join(dir, 'app.txt'), 'utf8'), 'one\n', 'the folder is untouched');
  const helperFirst = ollama.requests[1].messages[1].content;
  assert.match(helperFirst, /isolated copy of the project: a git worktree at /);
  assert.match(helperFirst, /Change app\.txt to say two\.$/);
  // A write to the user's folder from inside the copy is outside the helper's working folder,
  // so it is asked about even in auto mode, and refused with nobody to ask.
  const escaped = ollama.requests[3].messages.find((m) => m.role === 'tool' && /Permission denied/.test(m.content));
  assert.ok(escaped, 'the write to the original folder was refused');

  const result = agent.messages.find((m) => m.role === 'tool').content;
  assert.match(result, /^Changed app\.txt\.\n\n\[Isolated worktree kept: /);
  const kept = /kept: (\S+) on branch (\S+)\./.exec(result);
  assert.equal(fs.readFileSync(path.join(kept[1], 'app.txt'), 'utf8'), 'two\n');
  assert.ok(branches(dir).includes(kept[2]));
});

test('parallel helpers in worktrees cannot overwrite each other; one that changed nothing leaves no trace', async () => {
  const dir = repo();
  const ollama = await fakeOllama([
    [
      call('task', {
        tasks: [
          { description: 'write a', prompt: 'Write A.', isolation: 'worktree' },
          { description: 'write b', prompt: 'Write B.', isolation: 'worktree' },
          { description: 'just look', prompt: 'Look.', isolation: 'worktree' },
        ],
      }),
      { done: true },
    ],
    [call('write_file', { path: 'app.txt', content: 'A\n' }), { done: true }],
    [done('Wrote A.')],
    [call('write_file', { path: 'app.txt', content: 'B\n' }), { done: true }],
    [done('Wrote B.')],
    [done('Nothing to change.')],
    [done('Done.')],
  ]);
  // One at a time, so the scripted replies arrive in order; each still has its own copy.
  const agent = makeAgent(ollama.host, dir, { maxHelpers: 1 });
  await agent.runTurn('write both');
  ollama.close();

  const result = agent.messages.find((m) => m.role === 'tool').content;
  const kept = [...result.matchAll(/kept: (\S+) on branch (\S+)\./g)];
  assert.equal(kept.length, 2);
  assert.equal(fs.readFileSync(path.join(kept[0][1], 'app.txt'), 'utf8'), 'A\n');
  assert.equal(fs.readFileSync(path.join(kept[1][1], 'app.txt'), 'utf8'), 'B\n');
  assert.match(result, /## Helper 3: just look — completed\nNothing to change\.\n\n\[Isolated worktree: the helper changed nothing, so it was removed\.\]/);
  assert.equal(branches(dir).length, 3, 'main and the two kept branches; the unchanged one was deleted');
  assert.equal(fs.readFileSync(path.join(dir, 'app.txt'), 'utf8'), 'one\n');
});
