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
  for (const mode of ['ask', 'auto']) {
    const permissions = new Permissions({ mode, cwd, ask: async (q) => (asked.push(q.tool.name), 'y') });
    permissions.planning = true;
    assert.deepEqual(await permissions.check(tool('read_file'), { path: 'a.js' }), { ok: true });
    assert.deepEqual(await permissions.check(tool('grep'), { pattern: 'x' }), { ok: true });
    assert.deepEqual(await permissions.check(tool('bash'), { command: 'ls -la && git status' }), { ok: true });
    for (const [name, args] of [['write_file', { path: 'a.js', content: 'x' }], ['edit_file', { path: 'a.js', old_string: 'a', new_string: 'b' }], ['bash', { command: 'npm install' }], ['bash', { command: 'rm -rf dist' }], ['bash', { command: 'ls && touch x' }], ['memory', { action: 'add', target: 'memory', content: 'x' }]]) {
      assert.deepEqual(await permissions.check(tool(name), args), { ok: false, reason: PLANNING }, `${mode}: ${name} ${JSON.stringify(args)}`);
    }
  }
  assert.deepEqual(asked, [], 'the user is not asked about what plan mode refuses — not even in --yolo');

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
