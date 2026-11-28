// Plan mode: SEEKER looks and proposes, and nothing is changed or run until the plan is approved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { runCommand, runPhoneCommand } from '../src/commands.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { PLANNING, PLAN_NOTE, Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import { TOOL_BY_NAME } from '../src/tools.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-plan-'));
const tool = (name) => TOOL_BY_NAME.get(name);

test('plan mode: reading and commands that only look still run; anything that changes something waits', async () => {
  const cwd = tmp();
  const asked = [];
  for (const mode of ['ask', 'auto', 'full']) {
    const permissions = new Permissions({ mode, cwd, ask: async (q) => (asked.push(q.tool.name), 'y') });
    permissions.planning = true;
    assert.deepEqual(await permissions.check(tool('read_file'), { path: 'a.js' }), { ok: true });
    assert.deepEqual(await permissions.check(tool('grep'), { pattern: 'x' }), { ok: true });
    assert.deepEqual(await permissions.check(tool('bash'), { command: 'ls -la && git status' }), { ok: true });
    for (const [name, args] of [['write_file', { path: 'a.js', content: 'x' }], ['edit_file', { path: 'a.js', old_string: 'a', new_string: 'b' }], ['bash', { command: 'npm install' }], ['bash', { command: 'rm -rf dist' }], ['bash', { command: 'ls && touch x' }], ['memory', { action: 'add', target: 'memory', content: 'x' }]]) {
      assert.deepEqual(await permissions.check(tool(name), args), { ok: false, reason: PLANNING }, `${mode}: ${name} ${JSON.stringify(args)}`);
    }
  }
  assert.deepEqual(asked, [], 'the user is not asked about what plan mode refuses — not even in --yolo or full access');

  // Leaving plan mode gives the usual rules back, unchanged.
  const permissions = new Permissions({ mode: 'ask', cwd, ask: async (q) => (asked.push(q.tool.name), 'y') });
  permissions.planning = true;
  permissions.planning = false;
  assert.deepEqual(await permissions.check(tool('write_file'), { path: 'a.js', content: 'x' }), { ok: true });
  assert.deepEqual(asked, ['write_file']);
});

test('plan mode: /plan turns it on and off, and /plan go approves the plan and sets the work going', async () => {
  const said = [];
  const ui = new Proxy({}, { get: (_, key) => (key === 'notice' || key === 'warn' ? (text) => said.push(text) : key === 'c' ? new Proxy({}, { get: () => (x) => String(x) }) : key === 'screen' ? undefined : () => {}) });
  const permissions = new Permissions({ mode: 'ask', cwd: tmp(), ask: null });
  const ctx = { agent: {}, ui, term: null, config: { ...DEFAULTS }, permissions, session: null, hub: null };

  assert.equal((await runCommand('/plan go', ctx))?.prompt, undefined, 'nothing to approve: no work is started');
  assert.match(said.at(-1), /Plan mode is off/);
  await runCommand('/plan', ctx);
  assert.equal(permissions.planning, true);
  assert.match(said.at(-1), /Plan mode on/);
  await runCommand('/plan on', ctx);
  assert.equal(permissions.planning, true, 'on twice is still on');
  assert.deepEqual(await runCommand('/plan go', ctx), { prompt: 'The plan is approved. Carry it out now.' });
  assert.equal(permissions.planning, false);
  assert.equal(permissions.mode, 'ask', 'carrying it out asks as it did before');
  await runCommand('/plan', ctx);
  await runCommand('/plan off', ctx);
  assert.equal(permissions.planning, false);
  // The same from the phone.
  await runPhoneCommand('/plan', ctx);
  assert.equal(permissions.planning, true);
  assert.deepEqual(await runPhoneCommand('/plan go', ctx), { prompt: 'The plan is approved. Carry it out now.' });
});

test('plan mode: the model is told with each message, its changes are refused, and the turn ends with what to do next', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'one\n');
  const requests = [];
  const replies = [
    [{ message: { content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.txt' } } }] } }, { done: true }],
    [{ message: { content: '', tool_calls: [{ function: { name: 'write_file', arguments: { path: 'a.txt', content: 'two\n' } } }] } }, { done: true }],
    [{ message: { content: 'Plan: 1. change a.txt to say two.' }, done: true, prompt_eval_count: 10, eval_count: 5 }],
    [{ message: { content: '', tool_calls: [{ function: { name: 'write_file', arguments: { path: 'a.txt', content: 'two\n' } } }] } }, { done: true }],
    [{ message: { content: 'Done.' }, done: true, prompt_eval_count: 10, eval_count: 5 }],
  ];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(replies.shift().map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const config = { ...DEFAULTS, host: `http://127.0.0.1:${server.address().port}`, review: false, checkpoints: false };
  const said = [];
  const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'notice' ? (text) => said.push(text) : () => {}) });
  const permissions = new Permissions({ mode: 'auto', cwd, ask: null });
  permissions.planning = true;
  const agent = new Agent({ config, ui, permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });

  await agent.runTurn('make a.txt say two');
  assert.ok(requests[0].messages.at(-1).content.endsWith(PLAN_NOTE));
  assert.equal(agent.messages.find((m) => m.role === 'tool' && m.tool_name === 'write_file').content, PLANNING);
  assert.equal(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8'), 'one\n', 'nothing was changed');
  assert.match(said.at(-1), /\/plan go carries the plan out/);

  permissions.planning = false;
  await agent.runTurn('The plan is approved. Carry it out now.');
  server.close();
  assert.equal(requests.at(-2).messages.at(-1).content, 'The plan is approved. Carry it out now.', 'no plan note once it is approved');
  assert.equal(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8'), 'two\n');
});

test('plan mode: a mockup may be written into the mockups folder, and nowhere else', async () => {
  const cwd = tmp();
  const mockups = path.join(tmp(), 'mockups');
  const asked = [];
  for (const mode of ['ask', 'auto', 'full']) {
    const permissions = new Permissions({ mode, cwd, ask: async (q) => (asked.push(q.tool.name), 'y'), mockups });
    permissions.planning = true;
    // The folder need not exist yet; a file in a folder inside it is fine too.
    assert.deepEqual(await permissions.check(tool('write_file'), { path: path.join(mockups, 'home.html'), content: '<p>x</p>' }), { ok: true }, mode);
    assert.deepEqual(await permissions.check(tool('write_file'), { path: path.join(mockups, 'v2', 'card.svg'), content: '<svg/>' }), { ok: true }, mode);
    fs.mkdirSync(mockups, { recursive: true });
    fs.writeFileSync(path.join(mockups, 'home.html'), '<p>x</p>');
    assert.deepEqual(await permissions.check(tool('edit_file'), { path: path.join(mockups, 'home.html'), old_string: 'x', new_string: 'y' }), { ok: true }, mode);
    // Everything else is still refused: the project, a way out of the folder, the folder itself, commands.
    for (const args of [{ path: 'a.html', content: 'x' }, { path: path.join(mockups, '..', 'escape.html'), content: 'x' }, { path: mockups, content: 'x' }]) {
      assert.deepEqual(await permissions.check(tool('write_file'), args), { ok: false, reason: PLANNING }, `${mode}: ${args.path}`);
    }
    assert.deepEqual(await permissions.check(tool('bash'), { command: `open ${path.join(mockups, 'home.html')}` }), { ok: false, reason: PLANNING });
  }
  assert.deepEqual(asked, [], 'a mockup is written without asking');

  // A link inside the folder that leads into the project does not let a write through.
  fs.symlinkSync(cwd, path.join(mockups, 'project'));
  const permissions = new Permissions({ mode: 'full', cwd, ask: null, mockups });
  permissions.planning = true;
  assert.deepEqual(await permissions.check(tool('write_file'), { path: path.join(mockups, 'project', 'a.js'), content: 'x' }), { ok: false, reason: PLANNING });
  // A look-only helper gets no such exception, and outside plan mode the usual rules apply.
  permissions.lookOnly = 'look only';
  assert.equal((await permissions.check(tool('write_file'), { path: path.join(mockups, 'b.html'), content: 'x' })).ok, false);
  permissions.lookOnly = null;
  const plain = new Permissions({ mode: 'ask', cwd, ask: async (q) => (asked.push(q.warning), 'n'), mockups });
  assert.equal((await plain.check(tool('write_file'), { path: path.join(mockups, 'c.html'), content: 'x' })).ok, false);
  assert.match(String(asked.at(-1)), /outside the working folder/);
});

test('plan mode: Claude Code may read a file the phone sent, outside the project', async () => {
  const { describeExternal } = await import('../src/external-tools.mjs');
  const cwd = tmp();
  const sent = path.join(tmp(), 'brief.md');
  fs.writeFileSync(sent, '# brief\n');
  const permissions = new Permissions({ mode: 'ask', cwd, ask: null });
  permissions.planning = true;
  // As the agent judges a Claude Code tool it is asked about (agent.mjs #askExternal).
  const judge = (name, input) => {
    const about = describeExternal(name, input, cwd);
    const target = path.resolve(cwd, about.path ?? '.');
    return permissions.check({ name, risk: about.risk ?? 'other', targetPath: () => target }, {}, { cwd });
  };
  assert.deepEqual(await judge('Read', { file_path: sent }), { ok: true });
  assert.deepEqual(await judge('Grep', { pattern: 'brief', path: path.dirname(sent) }), { ok: true });
  assert.deepEqual(await judge('Glob', { pattern: '*.md', path: path.dirname(sent) }), { ok: true });
  assert.deepEqual(await judge('Write', { file_path: path.join(cwd, 'a.js'), content: 'x' }), { ok: false, reason: PLANNING });
});
