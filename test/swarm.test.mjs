// /swarm: plan the work for the board, approve it, workers do it, a look-only reviewer checks it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { runCommand, runPhoneCommand } from '../src/commands.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { LOOKING, Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import { swarmPlanPrompt, swarmRunPrompt } from '../src/swarm.mjs';
import { TOOL_BY_NAME } from '../src/tools.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-swarm-'));

function context() {
  const said = [];
  const ui = new Proxy({}, { get: (_, key) => (key === 'notice' || key === 'warn' ? (text) => said.push(text) : key === 'c' ? new Proxy({}, { get: () => (x) => String(x) }) : key === 'screen' ? undefined : () => {}) });
  const permissions = new Permissions({ mode: 'ask', cwd: tmp(), ask: null });
  const agent = { swarm: null };
  return { said, permissions, agent, ctx: { agent, ui, term: null, config: { ...DEFAULTS }, permissions, session: null, hub: null } };
}

test('/swarm <goal> plans in plan mode; /swarm go approves it with the swarm steps; /swarm off cancels', async () => {
  const { said, permissions, agent, ctx } = context();

  assert.equal((await runCommand('/swarm', ctx))?.prompt, undefined);
  assert.match(said.at(-1), /\/swarm <goal> plans big work/);
  assert.equal((await runCommand('/swarm go', ctx))?.prompt, undefined, 'nothing planned: nothing starts');
  assert.match(said.at(-1), /No swarm plan to approve/);

  const planned = await runCommand('/swarm add dark mode to the settings page', ctx);
  assert.deepEqual(planned, { prompt: swarmPlanPrompt('add dark mode to the settings page'), label: '/swarm add dark mode to the settings page' });
  assert.equal(permissions.planning, true, 'planning changes nothing');
  assert.deepEqual(agent.swarm, { goal: 'add dark mode to the settings page' });
  assert.match(planned.prompt, /^Plan this work for a team of workers on the task board: add dark mode/);
  assert.match(planned.prompt, /Do not put the tasks on the board or start anyone yet/);
  await runCommand('/swarm', ctx);
  assert.match(said.at(-1), /Planning a swarm for: add dark mode/);

  const run = await runCommand('/swarm go', ctx);
  assert.deepEqual(run, { prompt: swarmRunPrompt('add dark mode to the settings page'), label: '/swarm go' });
  assert.equal(permissions.planning, false);
  assert.equal(permissions.mode, 'ask', 'the work asks as it did before');
  assert.equal(agent.swarm, null);
  for (const step of [/board tool's action "add"/, /`workers` set to the planned number/, /`look_only: true`/, /what nobody checked/]) assert.match(run.prompt, step);
  assert.equal((await runCommand('/swarm go', ctx))?.prompt, undefined, 'approved once only');

  // /plan go approves a swarm's plan the swarm's way; a plain plan stays a plain plan.
  await runCommand('/swarm fix the flaky tests', ctx);
  assert.deepEqual(await runCommand('/plan go', ctx), { prompt: swarmRunPrompt('fix the flaky tests'), label: '/swarm go' });
  await runCommand('/plan', ctx);
  assert.deepEqual(await runCommand('/plan go', ctx), { prompt: 'The plan is approved. Carry it out now.' });

  // Cancelling, either way, leaves nothing behind.
  await runCommand('/swarm go faster', ctx);
  assert.deepEqual(agent.swarm, { goal: 'go faster' }, '"go" with more words is a goal');
  await runCommand('/swarm off', ctx);
  assert.deepEqual([agent.swarm, permissions.planning], [null, false]);
  await runCommand('/swarm rename things', ctx);
  await runCommand('/plan off', ctx);
  assert.deepEqual([agent.swarm, permissions.planning], [null, false]);
  assert.equal((await runCommand('/plan go', ctx))?.prompt, undefined);

  // The same from the phone.
  assert.equal((await runPhoneCommand('/swarm tidy the docs', ctx)).prompt, swarmPlanPrompt('tidy the docs'));
  assert.equal((await runPhoneCommand('/swarm go', ctx)).prompt, swarmRunPrompt('tidy the docs'));
});

test('the phone: /swarm, /swarm go and /board are in its / menu, /board shows the board, /help names it', async () => {
  const app = fs.readFileSync(new URL('../remote-server/public/app.js', import.meta.url), 'utf8');
  assert.match(app, /name: '\/swarm', about: [^\n]*run: fill\('\/swarm'\)/, '/swarm waits for the goal to be typed');
  assert.match(app, /name: '\/swarm go', about: [^\n]*run: run\('\/swarm go'\)/);
  assert.match(app, /name: '\/board', about: [^\n]*run: run\('\/board'\)/);

  const { Board } = await import('../src/board.mjs');
  const shown = [];
  const ui = new Proxy({}, { get: (_, key) => (key === 'notice' || key === 'line' ? (text) => shown.push(text) : key === 'c' ? new Proxy({}, { get: () => (x) => String(x) }) : () => {}) });
  const agent = { board: new Board() };
  const ctx = { agent, ui, term: null, config: { ...DEFAULTS }, permissions: new Permissions({ mode: 'ask', cwd: tmp(), ask: null }), session: null, hub: null };
  await runPhoneCommand('/board', ctx);
  assert.match(shown.at(-1), /The board is empty/);
  agent.board.add([{ title: 'write the schema' }], 'lead');
  await runPhoneCommand('/board', ctx);
  assert.ok(shown.some((text) => /t1 write the schema/.test(text)), 'the task reaches the phone');

  shown.length = 0;
  await runPhoneCommand('/help', ctx);
  for (const name of ['/swarm', '/board']) assert.ok(shown.some((text) => text.trim().startsWith(name)), `${name} is in the phone's /help`);
});

test('task look_only: the reviewer cannot change anything, even in auto mode, and the lead can again after', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'one\n');
  const requests = [];
  const call = (name, args) => [{ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } }, { done: true }];
  const say = (content) => [{ message: { content }, done: true, prompt_eval_count: 10, eval_count: 5 }];
  const replies = [
    call('task', { description: 'review the change', prompt: 'Review a.txt.', look_only: true }), // lead
    call('read_file', { path: 'a.txt' }), // reviewer: reading is fine
    call('write_file', { path: 'b.txt', content: 'sneaky\n' }), // reviewer: refused
    call('bash', { command: 'echo x > c.txt' }), // reviewer: refused
    say('a.txt says one; nothing else is wrong.'), // reviewer's report
    call('write_file', { path: 'a.txt', content: 'two\n' }), // lead, after the review
    say('Done.'),
  ];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(replies.shift().map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const config = { ...DEFAULTS, host: `http://127.0.0.1:${server.address().port}`, review: false, checkpoints: false, bundledSkills: false };
  const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'c' ? new Proxy({}, { get: () => (x) => String(x) }) : () => {}) });
  const permissions = new Permissions({ mode: 'auto', cwd, ask: null });
  const agent = new Agent({ config, ui, permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });
  try {
    await agent.runTurn('change a.txt, then have it reviewed');
  } finally {
    server.close();
  }
  assert.equal(replies.length, 0, 'every scripted reply was used');
  const toolReplies = (request) => request.messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.match(toolReplies(requests[2]).at(-1), /one/, 'the reviewer read the file');
  assert.equal(toolReplies(requests[3]).at(-1), LOOKING);
  assert.equal(toolReplies(requests[4]).at(-1), LOOKING);
  assert.equal(fs.existsSync(path.join(cwd, 'b.txt')), false);
  assert.equal(fs.existsSync(path.join(cwd, 'c.txt')), false);
  assert.match(toolReplies(requests[5]).at(-1), /nothing else is wrong/, 'the lead got the report');
  assert.equal(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8'), 'two\n', 'the lead writes again once the review is over');
  assert.equal(permissions.lookOnly, null);
});

test('task look_only takes no worktree', async () => {
  await assert.rejects(TOOL_BY_NAME.get('task').run({ prompt: 'review', look_only: true, isolation: 'worktree' }, { delegate: async () => 'x' }), /needs no worktree/);
  let opts;
  await TOOL_BY_NAME.get('task').run({ prompt: 'review', look_only: true }, { delegate: async (p, l, a, o) => ((opts = o), 'ok') });
  assert.deepEqual(opts, { isolation: null, lookOnly: true });
});
