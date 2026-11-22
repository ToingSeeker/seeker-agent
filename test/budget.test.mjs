// swarmBudget: what helpers spend is counted per helper, and past the budget they are stopped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { Board } from '../src/board.mjs';
import { addSpent, blankSpent, budgetSetting, describeSpent, overBudget, parseBudget, replyCost } from '../src/budget.mjs';
import { DEFAULTS, SETTINGS } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-budget-'));

test('swarmBudget is read as tokens or dollars, and anything else is refused', () => {
  assert.deepEqual(parseBudget('500k'), { tokens: 500_000 });
  assert.deepEqual(parseBudget('2M'), { tokens: 2_000_000 });
  assert.deepEqual(parseBudget('800,000'), { tokens: 800_000 });
  assert.deepEqual(parseBudget('$2'), { usd: 2 });
  assert.deepEqual(parseBudget('0.5usd'), { usd: 0.5 });
  for (const off of ['', 'off', 'none', '0']) assert.equal(parseBudget(off), null);
  for (const bad of ['lots', '10', '$0', '-5k']) assert.equal(parseBudget(bad), undefined, bad);
  assert.equal(SETTINGS.swarmBudget.parse('1.5m'), '1.5m');
  assert.equal(SETTINGS.swarmBudget.parse('$3'), '$3.00');
  assert.equal(SETTINGS.swarmBudget.parse('off'), '');
  assert.equal(SETTINGS.swarmBudget.parse('soon'), undefined);
  assert.equal(budgetSetting('2usd'), '$2.00');
  assert.equal(DEFAULTS.swarmBudget, '', 'no limit unless the user sets one');
});

test('a reply is priced where its price is known, free on a local model, and unpriced otherwise', () => {
  // Anthropic list price: 50k new input at $2/M, 50k cached at $0.1/M, 2k output at $10/M.
  assert.deepEqual(replyCost({ input: 100_000, cached: 50_000, output: 2_000 }, { provider: 'anthropic', model: 'claude-sonnet-5-5' }), { tokens: 102_000, usd: 0.125 });
  assert.deepEqual(replyCost({ input: 1000, output: 20, cost: 0.01 }, { provider: 'openrouter', model: 'any' }), { tokens: 1020, usd: 0.01 }, 'a stated charge is used as it is');
  assert.deepEqual(replyCost({ input: 1000, output: 20 }, { provider: 'ollama', model: 'qwen', local: true }), { tokens: 1020, usd: 0 });
  assert.deepEqual(replyCost({ input: 1000, output: 20 }, { provider: 'openai', model: 'unknown-model' }), { tokens: 1020, usd: null });
  // A reply that used several models (Claude Code's sub-agents) has a price only if each of them has one.
  assert.equal(replyCost({ input: 2000, output: 40, models: [{ model: 'claude-haiku-5-5', input: 1000, cached: 0, output: 20 }, { model: 'mystery', input: 1000, output: 20 }] }, { provider: 'claude-code', model: 'claude-opus-5-5' }).usd, null);

  const total = blankSpent();
  addSpent(total, { tokens: 1000, usd: 0.5 });
  addSpent(total, { tokens: 3000, usd: null });
  assert.deepEqual(total, { tokens: 4000, usd: 0.5, unpriced: 3000 });
  assert.equal(describeSpent(total), '4k tokens, ≈$0.500, 3k of them unpriced');
  assert.equal(describeSpent({ tokens: 1200, usd: 0, unpriced: 1200 }), '1.2k tokens');
  assert.equal(overBudget(total, { tokens: 4000 }), true);
  assert.equal(overBudget(total, { usd: 1 }), false, 'a dollar budget counts only what has a price');
  assert.equal(overBudget(total, null), false);
});

/** A stand-in for Ollama: replies in order, each with the token counts given. */
async function fakeModel(replies) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      requests.push(JSON.parse(body));
      const next = replies.shift();
      res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(next.map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, requests, host: `http://127.0.0.1:${server.address().port}` };
}
const call = (name, args, tokens = [10, 5]) => [{ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } }, { done: true, prompt_eval_count: tokens[0], eval_count: tokens[1] }];
const say = (content, tokens = [10, 5]) => [{ message: { content }, done: true, prompt_eval_count: tokens[0], eval_count: tokens[1] }];

function lead(host, cwd, extra = {}) {
  const config = { ...DEFAULTS, host, review: false, checkpoints: false, bundledSkills: false, ...extra };
  const warned = [];
  const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'c' ? new Proxy({}, { get: () => (x) => String(x) }) : key === 'warn' ? (t) => warned.push(t) : () => {}) });
  const permissions = new Permissions({ mode: 'auto', cwd, ask: null });
  const agent = new Agent({ config, ui, permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });
  return { agent, warned };
}

test('past swarmBudget the helpers stop, no new one starts, and the lead still answers with what was done', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'one\n');
  const replies = [
    call('task', { tasks: [{ description: 'first', prompt: 'Read a.txt.' }, { description: 'second', prompt: 'Read it again.' }] }), // lead
    call('read_file', { path: 'a.txt' }, [400, 100]), // helper 1: 500 tokens
    call('read_file', { path: 'a.txt' }, [500, 100]), // helper 1: 1100 in all — past the 1k budget
    call('task', { prompt: 'One more look.' }), // lead tries again: refused
    say('Stopped at the budget: helper 1 read a.txt; helper 2 never started.'), // lead's answer
    // The next message has a budget of its own.
    call('task', { prompt: 'Read a.txt.' }),
    say('a.txt says one.', [100, 50]),
    say('Done.'),
  ];
  const { server, requests, host } = await fakeModel(replies);
  const { agent, warned } = lead(host, cwd, { swarmBudget: '1k', maxHelpers: 1 });
  agent.board = new Board();
  try {
    await agent.runTurn('read a.txt twice with helpers');
    const tools = agent.messages.filter((m) => m.role === 'tool');
    const delegated = tools[0].content;
    assert.match(delegated, /## Helper 1: first — stopped · 1\.1k tokens/);
    assert.match(delegated, /## Helper 2: second — not started/);
    assert.match(delegated, /## Budget\nThe helpers' budget for this message ran out: they used 1\.1k tokens of the 1k allowed/);
    assert.match(tools[1].content, /budget for this message ran out[\s\S]*Answer with what is done instead/);
    assert.equal(agent.messages.at(-1).content, 'Stopped at the budget: helper 1 read a.txt; helper 2 never started.');
    assert.equal(warned.length, 1, 'the user is told once');
    assert.deepEqual(agent.helperSpent, { tokens: 1100, usd: 0, unpriced: 0 }, 'a local model costs nothing');

    await agent.runTurn('once more');
    assert.equal(agent.budgetStop, null, 'a new message starts with nothing spent');
    assert.match(agent.messages.filter((m) => m.role === 'tool').at(-1).content, /a\.txt says one\.\n\n\(This helper used 150 tokens\.\)/);
    assert.equal(replies.length, 0);
  } finally {
    server.close();
  }
  assert.equal(requests.length, 8);
});

test('a worker stopped by the budget leaves its task failed with the reason, and the rest unstarted', async () => {
  const cwd = tmp();
  const replies = [
    call('board', { action: 'add', tasks: [{ id: 'a', title: 'first' }, { id: 'b', title: 'second', depends_on: ['a'] }] }),
    call('task', { workers: 1 }),
    call('board', { action: 'next' }), // the worker takes "a"
    call('glob', { pattern: '*' }, [900, 200]), // and, working on it, passes the 1k budget
    say('The budget ran out during task a.'),
  ];
  const { server, host } = await fakeModel(replies);
  const { agent } = lead(host, cwd, { swarmBudget: '1k' });
  try {
    await agent.runTurn('do a then b with a worker');
  } finally {
    server.close();
  }
  const [a, b] = agent.board.tasks;
  assert.equal(a.status, 'failed');
  assert.match(a.result, /budget ran out/);
  assert.equal(agent.board.statusOf(b), 'blocked');
  const output = agent.messages.filter((m) => m.role === 'tool').at(-1).content;
  assert.match(output, /## Worker 1 — stopped · 1\.1k tokens/);
  assert.match(output, /## Budget/);
});
