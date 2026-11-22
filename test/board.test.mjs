// The task board the agent shares with its workers (src/board.mjs, the board tool, task `workers`).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.SEEKER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-board-home-'));
const { Agent } = await import('../src/agent.mjs');
const { Board, MAX_TASKS } = await import('../src/board.mjs');
const { runCommand } = await import('../src/commands.mjs');
const { DEFAULTS } = await import('../src/config.mjs');
const { Permissions } = await import('../src/permissions.mjs');
const { createProvider } = await import('../src/providers.mjs');
const { TOOL_BY_NAME } = await import('../src/tools.mjs');

const tick = () => new Promise((r) => setImmediate(r));

test('tasks may only wait for tasks added before them, and ids are given when left out', () => {
  const board = new Board();
  assert.deepEqual(board.add([{ title: 'schema' }, { title: 'api', depends_on: ['t1'] }, { id: 'ui', title: 'screen', depends_on: 't2' }], 'lead'), ['t1', 't2', 'ui']);
  assert.throws(() => board.add([{ title: 'x', depends_on: ['later'] }, { id: 'later', title: 'y' }], 'lead'), /not on the board before it/);
  assert.throws(() => board.add([{ id: 'ui', title: 'again' }], 'lead'), /already a task "ui"/);
  assert.throws(() => board.add([{ detail: 'no title' }], 'lead'), /needs a "title"/);
  assert.equal(board.tasks.length, 3, 'a call that fails adds nothing');
  assert.throws(() => board.add(Array.from({ length: MAX_TASKS }, (_, i) => ({ title: `n${i}` })), 'lead'), /at most 50 tasks/);
});

test('a worker waits for the task it depends on, then gets its result with it', async () => {
  const board = new Board();
  board.add([{ title: 'schema' }, { title: 'api', depends_on: ['t1'] }], 'lead');
  board.note('lead', 'use snake_case');
  const first = await board.next('worker 1');
  assert.equal(first.id, 't1');

  let second = null;
  const waiting = board.next('worker 2').then((t) => (second = t));
  await tick();
  assert.equal(second, null, 't2 is not ready while t1 is being worked on');
  assert.throws(() => board.finish('t1', 'worker 2', true, 'x'), /worker 1's, not yours/);
  assert.throws(() => board.finish('t1', 'worker 1', true, ''), /Say in "result"/);
  board.finish('t1', 'worker 1', true, 'Added users table.');
  await waiting;
  assert.equal(second.id, 't2');
  assert.equal(second.owner, 'worker 2');
  const brief = board.brief(second);
  assert.match(brief, /^Task t2: api/);
  assert.match(brief, /Result of t1 \(schema\), by worker 1:\nAdded users table\./);
  assert.match(brief, /Notes on the board:\n- lead: use snake_case/);

  assert.equal(await board.next('worker 1'), null, 'nothing left once the last task is taken');
});

test('a failed task blocks what waits for it, and nothing is waited for in vain', async () => {
  const board = new Board();
  board.add([{ title: 'a' }, { title: 'b', depends_on: ['t1'] }, { title: 'c', depends_on: ['t2'] }, { title: 'd' }], 'lead');
  await board.next('w1');
  const other = board.next('w2'); // takes d
  assert.equal((await other).id, 't4');
  let after = 'waiting';
  const waiting = board.next('w2').then((t) => (after = t));
  await tick();
  assert.equal(after, 'waiting');
  board.finish('t1', 'w1', false, 'The build is broken.');
  await waiting;
  assert.equal(after, null, 'b and c can never start, so the waiting worker is let go');
  assert.equal(board.statusOf(board.tasks[1]), 'blocked');
  assert.equal(board.statusOf(board.tasks[2]), 'blocked', 'blocked through a blocked task too');
  assert.deepEqual(board.counts(), { pending: 0, active: 1, done: 0, failed: 1, blocked: 2 });

  board.release('w2', 'w2 stopped.');
  assert.equal(board.tasks[3].status, 'failed', 'a stopped worker leaves no task half-taken');
  assert.equal(board.tasks[3].result, 'w2 stopped.');
});

test('a waiting worker stops when its turn is interrupted', async () => {
  const board = new Board();
  board.add([{ title: 'a' }, { title: 'b', depends_on: ['t1'] }], 'lead');
  await board.next('w1');
  const controller = new AbortController();
  const waiting = board.next('w2', controller.signal);
  controller.abort();
  assert.equal(await waiting, null);
  assert.equal(board.waiting.size, 0);
});

test('the board tool: the lead adds and lists, only workers take tasks', async () => {
  const tool = TOOL_BY_NAME.get('board');
  const board = new Board();
  const lead = { board, boardActor: null };
  const added = await tool.run({ action: 'add', tasks: JSON.stringify([{ title: 'one' }, { title: 'two', depends_on: ['t1'] }]) }, lead);
  assert.match(added.output, /^Added t1, t2\./);
  assert.match(added.display, /☐ t2 two \(after t1\)/);
  await assert.rejects(tool.run({ action: 'next' }, lead), /Workers take tasks/);
  const worker = { board, boardActor: 'worker 1' };
  assert.match((await tool.run({ action: 'next' }, worker)).output, /^Task t1: one/);
  assert.match((await tool.run({ action: 'done', id: 't1', result: 'did it' }, worker)).output, /t1 marked done/);
  await assert.rejects(tool.run({ action: 'clear' }, worker), /Only the lead/);
  await assert.rejects(tool.run({ action: 'done', id: 't9', result: 'x' }, worker), /No task "t9"/);
  assert.match((await tool.run({ action: 'list' }, lead)).output, /☑ t1 one — worker 1\n {4}did it/);
  await assert.rejects(tool.run({ action: 'fly' }, lead), /"action" must be/);
  await assert.rejects(TOOL_BY_NAME.get('task').run({ workers: 2 }, { board: new Board(), delegateMany: async () => [] }), /no task a worker could take/);
  await assert.rejects(TOOL_BY_NAME.get('task').run({ workers: 2 }, { board, delegateMany: null }), /A helper cannot start workers/);
});

/**
 * A stand-in for Ollama that plays the lead and every worker by what it is sent, so workers that
 * run side by side each get the right next step whatever order their requests arrive in.
 */
async function fakeModel({ lazy = false } = {}) {
  const finished = [];
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      const sent = JSON.parse(body);
      requests.push(sent);
      const first = sent.messages.find((m) => m.role === 'user')?.content ?? '';
      const last = sent.messages.at(-1);
      const reply = (...chunks) => res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(chunks.map((c) => JSON.stringify(c)).join('\n'));
      const call = (name, args) => reply({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } }, { done: true });
      const done = (content) => reply({ message: { content }, done: true, prompt_eval_count: 10, eval_count: 5 });
      if (first.startsWith('You are worker')) {
        if (last.role === 'user') return call('board', { action: 'next' });
        const took = /^Task (t\d+): (.*)/.exec(last.content);
        if (took) {
          if (lazy) return done('I am stopping here.');
          return setTimeout(() => {
            finished.push(took[1]);
            call('board', { action: 'done', id: took[1], result: `${took[2]} finished` });
          }, 30);
        }
        if (/marked done/.test(last.content)) return call('board', { action: 'next' });
        return done('Worked through the board.');
      }
      if (last.role === 'user') return call('board', { action: 'add', tasks: [{ title: 'schema' }, { title: 'api', depends_on: ['t1'] }, { title: 'docs' }] });
      if (/^Added/.test(last.content)) return call('task', { workers: 2, prompt: 'Keep it small.' });
      return done('All done.');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { host: `http://127.0.0.1:${server.address().port}`, finished, requests, close: () => server.close() };
}

function makeAgent(host, lines = []) {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-board-')));
  const plain = new Proxy({}, { get: () => (x) => String(x) });
  const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'c' ? plain : key === 'screen' ? undefined : key === 'line' || key === 'notice' ? (t) => void lines.push(String(t)) : () => {}) });
  const config = { ...DEFAULTS, host, review: false, checkpoints: false, bundledSkills: false };
  const permissions = new Permissions({ mode: 'auto', cwd, ask: null });
  return { agent: new Agent({ config, ui, permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd }), ui, config, permissions };
}

test('workers started by the task tool take every task, in dependency order, side by side', async () => {
  const model = await fakeModel();
  const lines = [];
  const { agent, ui, config, permissions } = makeAgent(model.host, lines);
  await agent.runTurn('build it');
  model.close();

  assert.deepEqual(agent.board.tasks.map((t) => t.status), ['done', 'done', 'done']);
  assert.ok(model.finished.indexOf('t1') < model.finished.indexOf('t2'), 'api waited for schema');
  const workerStarts = model.requests.filter((r) => r.messages.length === 2 && r.messages[1].content.startsWith('You are worker'));
  assert.equal(workerStarts.length, 2);
  assert.match(workerStarts[0].messages[1].content, /Instructions from the lead for every worker:\nKeep it small\.$/);
  const apiBrief = model.requests.flatMap((r) => r.messages).find((m) => m.role === 'tool' && /^Task t2: api/.test(m.content));
  assert.match(apiBrief.content, /Result of t1 \(schema\), by worker \d:\nschema finished/);

  const result = agent.messages.find((m) => m.role === 'tool' && /## Worker 1/.test(m.content)).content;
  assert.match(result, /## Worker 1 — completed · 15 tokens\nWorked through the board\./);
  assert.match(result, /## The board now\n3 task\(s\): 3 done/);
  assert.equal(agent.messages.at(-1).content, 'All done.');

  await runCommand('/board', { agent, ui, term: null, config, permissions, session: null, hub: null });
  assert.match(lines.join('\n'), /3 done[\s\S]*☑ t2 api \(after t1\) — worker \d/);
});

test('a worker that stops without closing its task leaves it failed, not taken forever', async () => {
  const model = await fakeModel({ lazy: true });
  const { agent } = makeAgent(model.host);
  await agent.runTurn('build it');
  model.close();
  const [schema, api, docs] = agent.board.tasks;
  assert.equal(schema.status, 'failed');
  assert.match(schema.result, /stopped without closing this task/);
  assert.equal(agent.board.statusOf(api), 'blocked');
  assert.equal(docs.status, 'failed');
});
