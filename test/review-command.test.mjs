// /review: the change is read from git, and the turn that reviews it can only look.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { REVIEWING, reviewPrompt, reviewTarget } from '../src/code-review.mjs';
import { runCommand } from '../src/commands.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import { TOOL_BY_NAME } from '../src/tools.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' }).toString();
function repo() {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-review-')));
  git(cwd, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(cwd, 'a.js'), 'export const add = (a, b) => a + b;\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'first');
  return cwd;
}

test('/review reads the right change from git for each way of asking', async () => {
  const cwd = repo();
  assert.match((await reviewTarget(cwd, [])).error, /Nothing to review in the changes since the last commit/);

  fs.writeFileSync(path.join(cwd, 'a.js'), 'export const add = (a, b) => a - b;\n');
  fs.writeFileSync(path.join(cwd, 'new.js'), 'export const x = 1;\n');
  const working = await reviewTarget(cwd, []);
  assert.equal(working.label, 'the changes since the last commit');
  assert.match(working.diff, /-export const add = \(a, b\) => a \+ b;\n\+export const add = \(a, b\) => a - b;/);
  assert.deepEqual(working.untracked, ['new.js'], 'a file git does not track yet is named, to be read');

  assert.match((await reviewTarget(cwd, ['staged'])).error, /Nothing to review in the staged changes/);
  git(cwd, 'add', 'a.js');
  assert.match((await reviewTarget(cwd, ['staged'])).diff, /a - b/);

  git(cwd, 'checkout', '-q', '-b', 'feature');
  git(cwd, 'commit', '-q', '-m', 'subtract');
  const sha = git(cwd, 'rev-parse', '--short', 'HEAD').trim();
  const branch = await reviewTarget(cwd, ['main', 'error', 'handling']);
  assert.deepEqual([branch.label, branch.focus], ['what this branch adds on top of main', 'error handling']);
  assert.match(branch.diff, /a - b/);
  const one = await reviewTarget(cwd, ['commit', sha]);
  assert.equal(one.label, `commit ${sha}`);
  assert.match(one.diff, /subtract[\s\S]*a - b/);
  assert.match((await reviewTarget(cwd, ['commit', 'nope'])).error, /There is no commit "nope"/);
  // Words that name no change are what to look at, in the change since the last commit.
  const focused = await reviewTarget(cwd, ['the', 'null', 'checks']);
  assert.deepEqual([focused.label, focused.focus], ['the changes since the last commit', 'the null checks']);
  assert.match((await reviewTarget(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-nogit-')), [])).error, /not a git repository/);
});

test('/review asks for defects with a case that shows each, and hands over a large change in part', () => {
  const prompt = reviewPrompt({ label: 'the staged changes', diff: '+const a = 1;\n', untracked: ['n.js'], focus: 'races' });
  assert.match(prompt, /^Review the staged changes\. Find what is wrong with it; do not change anything\./);
  assert.match(prompt, /a concrete case where it goes wrong/);
  assert.match(prompt, /look especially at: races/);
  assert.match(prompt, /```diff\n\+const a = 1;\n```/);
  assert.match(prompt, /New files that git does not track yet, to read in full:\n- n\.js/);
  const big = reviewPrompt({ label: 'x', diff: `+${'y'.repeat(80_000)}`, untracked: [], focus: '' });
  assert.ok(big.length < 64_000);
  assert.match(big, /the first 60000 of 80001 characters; read the files themselves for the rest/);
});

test('/review: the turn can only look, even with approvals off, and the next turn is free again', async () => {
  const cwd = repo();
  fs.writeFileSync(path.join(cwd, 'a.js'), 'export const add = (a, b) => a - b;\n');
  const requests = [];
  const call = (name, args) => ({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } });
  const done = (content) => ({ message: { content }, done: true, prompt_eval_count: 10, eval_count: 5 });
  const replies = [
    [call('read_file', { path: 'a.js' }), { done: true }],
    [call('edit_file', { path: 'a.js', old_string: 'a - b', new_string: 'a + b' }), { done: true }],
    [call('bash', { command: 'git checkout a.js' }), { done: true }],
    [done('a.js:1 subtracts where the name says add.')],
    [call('edit_file', { path: 'a.js', old_string: 'a - b', new_string: 'a + b' }), { done: true }],
    [done('Fixed.')],
  ];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(replies.shift().map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const said = [];
  const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'screen' ? undefined : key === 'c' ? new Proxy({}, { get: () => (x) => String(x) }) : key === 'notice' ? (t) => void said.push(t) : () => {}) });
  const config = { ...DEFAULTS, host: `http://127.0.0.1:${server.address().port}`, review: false, checkpoints: false };
  const permissions = new Permissions({ mode: 'auto', cwd, ask: null });
  const agent = new Agent({ config, ui, permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });

  const result = await runCommand('/review', { agent, ui, term: null, config, permissions, session: null, hub: null });
  assert.match(said.at(-1), /Reviewing the changes since the last commit: 2 changed lines\. Nothing will be changed\./);
  assert.match(result.prompt, /^Review the changes since the last commit\./);
  await agent.runTurn(result.prompt);
  const refused = agent.messages.filter((m) => m.role === 'tool').map((m) => [m.tool_name, m.content === REVIEWING]);
  assert.deepEqual(refused, [['read_file', false], ['edit_file', true], ['bash', true]], 'reading ran; the edit and the command that would undo the change did not');
  assert.equal(fs.readFileSync(path.join(cwd, 'a.js'), 'utf8'), 'export const add = (a, b) => a - b;\n', 'the change under review is untouched');
  assert.equal(permissions.lookOnly, null, 'the guard ends with the turn');

  await agent.runTurn('fix it');
  server.close();
  assert.equal(fs.readFileSync(path.join(cwd, 'a.js'), 'utf8'), 'export const add = (a, b) => a + b;\n');

  // A command that only looks is still allowed during a review.
  permissions.lookOnly = REVIEWING;
  assert.deepEqual(await permissions.check(TOOL_BY_NAME.get('bash'), { command: 'git status' }), { ok: true });
  assert.deepEqual(await permissions.check(TOOL_BY_NAME.get('write_file'), { path: 'x', content: 'y' }), { ok: false, reason: REVIEWING });
});

test('/review: a skill of your own named review is run in its place', async () => {
  const cwd = repo();
  const said = [];
  const ui = new Proxy({}, { get: (_, key) => (key === 'screen' ? undefined : key === 'c' ? new Proxy({}, { get: () => (x) => String(x) }) : (t) => void said.push(t)) });
  const agent = { cwd, skills: [{ name: 'review', description: 'my review', body: 'My own checklist.', dir: '/x', source: 'user' }] };
  const mine = await runCommand('/review staged', { agent, ui, term: null, config: { ...DEFAULTS }, permissions: new Permissions({ mode: 'ask', cwd, ask: null }), session: null, hub: null });
  assert.match(mine.prompt, /^Skill "review"[\s\S]*My own checklist\.[\s\S]*Arguments from the user: staged$/);
  assert.equal(agent.lookOnlyNext, undefined, 'the skill decides what it does; the look-only turn belongs to the built-in review');
  // One that ships with SEEKER does not replace the command.
  agent.skills = [{ name: 'review', description: 'bundled', body: 'Bundled.', dir: '/x', source: 'bundled' }];
  fs.writeFileSync(path.join(cwd, 'a.js'), 'changed\n');
  const builtin = await runCommand('/review', { agent, ui, term: null, config: { ...DEFAULTS }, permissions: new Permissions({ mode: 'ask', cwd, ask: null }), session: null, hub: null });
  assert.match(builtin.prompt, /^Review the changes since the last commit\./);
  assert.equal(agent.lookOnlyNext, REVIEWING);
});
