// The helpers' panel and phone card (src/crew.mjs), and stopping one helper without the rest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { Board } from '../src/board.mjs';
import { crewMeta, crewRows } from '../src/crew.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';

const plain = new Proxy({}, { get: () => (x) => String(x) });

test('the panel shows each helper, what it is on, what it spent and how it ended; nothing when none ran', () => {
  const board = new Board();
  board.add([{ id: 'schema', title: 'write the schema' }], 'lead');
  board.tasks[0].status = 'active';
  board.tasks[0].owner = 'worker 1';
  const now = 100_000;
  const agent = {
    controller: {},
    config: { swarmBudget: '1m' },
    board,
    helperSpent: { tokens: 15_000, usd: 0, unpriced: 0 },
    budgetStop: null,
    crew: [
      { id: 'h1', name: 'worker 1', description: 'worker 1', status: 'running', spent: { tokens: 12_000, usd: 0, unpriced: 0 }, startedAt: now - 75_000, endedAt: null },
      { id: 'h2', name: 'worker 2', description: 'worker 2', status: 'stopped by you', spent: { tokens: 3_000, usd: 0, unpriced: 0 }, startedAt: now - 20_000, endedAt: now - 5_000 },
    ],
  };
  const rows = crewRows(agent, 120, plain, now);
  assert.deepEqual(rows, [
    '  helpers: 1 running, 1 finished · 15k tokens · budget 1m',
    '  ◐ worker 1 schema write the schema · 12k tokens · 1m 15s',
    '  ! worker 2 worker 2 · 3k tokens · 15s stopped by you',
  ]);
  for (const row of crewRows(agent, 40, plain, now)) assert.ok(row.length <= 60, `kept short on a narrow terminal: ${row}`);

  assert.deepEqual(crewMeta(agent, now), {
    spent: '15k tokens',
    budget: '1m',
    stopped: null,
    helpers: [
      { id: 'h1', name: 'worker 1', doing: 'schema write the schema', status: 'running', spent: '12k tokens', seconds: 75 },
      { id: 'h2', name: 'worker 2', doing: 'worker 2', status: 'stopped by you', spent: '3k tokens', seconds: 15 },
    ],
  });

  // Once the message is answered and no helper runs, the panel and the card go.
  agent.controller = null;
  agent.crew[0].status = 'completed';
  assert.deepEqual(crewRows(agent, 120, plain, now), []);
  assert.equal(crewMeta(agent, now), null);
  assert.deepEqual(crewRows({ crew: [], controller: {} }, 120, plain), []);
});

test('stopping one helper leaves the other and the lead working, and its report says it was stopped', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-crew-'));
  const requests = [];
  let slowStarted;
  const slowSeen = new Promise((resolve) => (slowStarted = resolve));
  const leadReplies = [
    [{ message: { content: '', tool_calls: [{ function: { name: 'task', arguments: { tasks: [{ description: 'slow job', prompt: 'SLOW: take your time.' }, { description: 'fast job', prompt: 'FAST: answer at once.' }] } } }] } }, { done: true, prompt_eval_count: 10, eval_count: 5 }],
    [{ message: { content: 'One helper was stopped; the other finished.' }, done: true, prompt_eval_count: 10, eval_count: 5 }],
  ];
  let release;
  const fastMayAnswer = new Promise((resolve) => (release = resolve));
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', async () => {
      const sent = JSON.parse(body);
      requests.push(sent);
      const last = sent.messages.at(-1)?.content ?? '';
      const reply = (chunks) => res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(chunks.map((c) => JSON.stringify(c)).join('\n'));
      if (last.includes('SLOW:')) {
        // Never answers: it stays at work until it is stopped.
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(`${JSON.stringify({ message: { content: 'thinking…' } })}\n`);
        slowStarted();
        return;
      }
      if (last.includes('FAST:')) {
        await fastMayAnswer;
        return reply([{ message: { content: 'Fast job done.' }, done: true, prompt_eval_count: 100, eval_count: 20 }]);
      }
      reply(leadReplies.shift());
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const config = { ...DEFAULTS, host: `http://127.0.0.1:${server.address().port}`, review: false, checkpoints: false, bundledSkills: false, maxHelpers: 2 };
  const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'c' ? plain : () => {}) });
  const agent = new Agent({ config, ui, permissions: new Permissions({ mode: 'auto', cwd, ask: null }), provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });
  let changes = 0;
  agent.onCrew = () => changes++;

  const turn = agent.runTurn('do the slow job and the fast job');
  await slowSeen;
  const slow = agent.crew.find((e) => e.description === 'slow job');
  assert.equal(slow.status, 'running');
  assert.equal(crewMeta(agent).helpers.length, 2, 'both show on the phone while they work');
  assert.equal(agent.stopHelper('nope'), false);
  assert.equal(agent.stopHelper(slow.id), true);
  release();
  await turn;
  server.closeAllConnections?.();
  server.close();

  assert.equal(slow.status, 'stopped by you');
  assert.equal(agent.crew.find((e) => e.description === 'fast job').status, 'completed');
  assert.equal(agent.stopHelper(slow.id), false, 'a helper that has finished cannot be stopped again');
  const output = agent.messages.find((m) => m.role === 'tool').content;
  assert.match(output, /## Helper 1: slow job — stopped by the user/);
  assert.match(output, /## Helper 2: fast job — completed · 120 tokens\nFast job done\./);
  assert.equal(agent.messages.at(-1).content, 'One helper was stopped; the other finished.', 'the lead went on and answered');
  assert.equal(agent.interrupted, false, 'the lead itself was not stopped');
  assert.ok(changes >= 4, 'the display heard of every start, reply and end');
});
