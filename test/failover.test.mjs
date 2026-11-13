import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { KeyPool, backoffMs, classify, decide, fallbackChain, retryAfterMs } from '../src/failover.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';

const fail = (status, message = 'x', extra = {}) => Object.assign(new Error(message), { status, ...extra });

test('failed requests are sorted by what can be done about them', () => {
  assert.equal(classify(fail(429)), 'rate_limit');
  assert.equal(classify(fail(429, 'You exceeded your current quota, please check your plan and billing')), 'billing');
  assert.equal(classify(fail(402)), 'billing');
  assert.equal(classify(fail(401)), 'auth');
  assert.equal(classify(fail(403, 'Forbidden')), 'auth');
  assert.equal(classify(fail(404, 'model not found')), 'not_found');
  assert.equal(classify(fail(503)), 'overloaded');
  assert.equal(classify(fail(529, 'Overloaded')), 'overloaded');
  assert.equal(classify(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), 'network');
  assert.equal(classify(fail(400, 'context length exceeded')), 'fatal');
  assert.equal(classify(new Error('something odd')), 'fatal');
  assert.equal(retryAfterMs(fail(429, 'Rate limit reached. Please try again in 12.5s.')), 12_500);
  assert.equal(retryAfterMs(fail(429, 'x', { retryAfter: '30' })), 30_000);
  assert.equal(retryAfterMs(fail(429, 'retry after 3 hours')), 600_000, 'a long wait is capped');
  assert.equal(retryAfterMs(fail(429, 'slow down')), null);
  assert.ok(backoffMs(0) >= 2000 && backoffMs(0) <= 3000);
  assert.ok(backoffMs(10) <= 90_000);
});

test('a key the service turned away rests and the next takes over', () => {
  let now = 1_000_000;
  const pool = new KeyPool(['a', 'b', 'a', ''], 'fill_first', () => now);
  assert.equal(pool.size, 2);
  assert.equal(pool.pick(), 'a');
  assert.equal(pool.pick(), 'a', 'fill_first stays on one key');
  assert.equal(pool.rest('rate_limit', fail(429)), true);
  assert.equal(pool.pick(), 'b');
  assert.equal(pool.rest('billing', fail(402)), false, 'no key is left');
  assert.equal(pool.pick(), null);
  assert.deepEqual(pool.summary(), { total: 2, resting: 2 });
  now += 61 * 60 * 1000;
  assert.equal(pool.pick(), 'a', 'the rest is over after an hour');

  const turns = new KeyPool(['a', 'b', 'c'], 'round_robin', () => now);
  assert.deepEqual([turns.pick(), turns.pick(), turns.pick(), turns.pick()], ['a', 'b', 'c', 'a']);
  const sole = new KeyPool(['only'], 'fill_first', () => now);
  sole.pick();
  sole.rest('rate_limit', fail(429));
  now += 61_000;
  assert.equal(sole.pick(), 'only', 'the only key is never benched for long');
});

test('the next move: rotate a key, wait, fall back, or give up', () => {
  const pool = () => {
    const p = new KeyPool(['a', 'b']);
    p.pick();
    return p;
  };
  assert.equal(decide({ err: fail(429), attempt: 0, pool: pool(), hasFallback: true }).action, 'retry', 'a first 429 on a pooled key is retried once');
  assert.equal(decide({ err: fail(429), attempt: 1, pool: pool(), hasFallback: true }).action, 'rotate');
  assert.equal(decide({ err: fail(402), attempt: 0, pool: pool(), hasFallback: true }).action, 'rotate');
  assert.equal(decide({ err: fail(429), attempt: 0, pool: null, hasFallback: true }).action, 'fallback', 'no other key: the backup is used at once');
  assert.equal(decide({ err: fail(429), attempt: 0, pool: null, hasFallback: false }).action, 'retry');
  assert.equal(decide({ err: fail(429, 'try again in 2 hours'), attempt: 0, pool: null, hasFallback: false }).action, 'fail', 'too long to sit and wait');
  assert.equal(decide({ err: fail(402), attempt: 0, pool: null, hasFallback: false }).action, 'fail');
  assert.equal(decide({ err: fail(401), attempt: 0, pool: null, hasFallback: true }).action, 'fallback');
  assert.equal(decide({ err: fail(503), attempt: 0, pool: null, hasFallback: true }).action, 'retry');
  assert.equal(decide({ err: fail(503), attempt: 2, pool: null, hasFallback: true }).action, 'fallback');
  assert.equal(decide({ err: fail(503), attempt: 3, pool: null, hasFallback: false }).action, 'fail');
  assert.equal(decide({ err: fail(404, 'model not found'), attempt: 0, pool: null, hasFallback: true }).action, 'fallback');
  assert.equal(decide({ err: fail(400, 'bad request'), attempt: 0, pool: null, hasFallback: true }).action, 'fail');
  assert.deepEqual(fallbackChain({ fallback: [{ provider: 'ollama', model: 'q' }, { provider: 'x' }, null] }), [{ provider: 'ollama', model: 'q' }]);
  assert.deepEqual(fallbackChain({ fallback: { provider: 'ollama', model: 'q' } }), [{ provider: 'ollama', model: 'q' }]);
});

// ── The agent loop against scripted servers ────────────────────────────────

const notices = [];
const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'notice' || key === 'warn' || key === 'error' ? (text) => notices.push(text) : () => {}) });

/** An OpenAI-compatible server: each request is answered by the next entry, { status, body } or a reply text. */
async function fakeOpenAI(script) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ key: req.headers.authorization, url: req.url });
      const next = script.shift() ?? 'out of script';
      if (typeof next === 'object') {
        res.writeHead(next.status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: next.message ?? 'nope' } }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: next } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, seen, close: () => server.close() };
}

function agentOn(config, id, model) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-failover-'));
  const provider = createProvider(id, config);
  return new Agent({ config: { ...config, model }, ui, permissions: new Permissions({ mode: 'auto', cwd, ask: null }), provider, info: { tools: true, thinking: false, context: 64_000 }, cwd });
}

test('a rejected API key is rested and the next key answers', async () => {
  const main = await fakeOpenAI([{ status: 401, message: 'Incorrect API key provided' }, 'halo']);
  const config = { ...DEFAULTS, review: false, checkpoints: false, providers: { main: { baseUrl: main.url, apiKeys: ['sk-bad', 'sk-good'] } } };
  const agent = agentOn(config, 'main', 'm1');
  notices.length = 0;
  await agent.runTurn('hi');
  main.close();
  assert.equal(agent.messages.at(-1).content, 'halo');
  assert.deepEqual(main.seen.map((r) => r.key), ['Bearer sk-bad', 'Bearer sk-good']);
  assert.ok(notices.some((n) => /switching to the next one/.test(n)));
});

test('an out-of-credit provider falls back to the backup, and the primary returns on a later message', async () => {
  const main = await fakeOpenAI([{ status: 402, message: 'Insufficient credits' }, 'primary again']);
  const backup = await fakeOpenAI(['from the backup']);
  const config = {
    ...DEFAULTS,
    review: false,
    checkpoints: false,
    providers: { main: { baseUrl: main.url, apiKey: 'sk-1' }, spare: { baseUrl: backup.url, apiKey: 'sk-2' } },
    fallback: [{ provider: 'spare', model: 'b1' }],
  };
  const agent = agentOn(config, 'main', 'm1');
  notices.length = 0;
  await agent.runTurn('hi');
  assert.equal(agent.messages.at(-1).content, 'from the backup');
  assert.equal(agent.model, 'b1');
  assert.equal(agent.provider.id, 'spare');
  assert.equal(agent.primary.model, 'm1');
  assert.ok(notices.some((n) => /Model fallback: m1 via main unavailable \(is out of credit\); using b1 via spare/.test(n)));

  // Still resting: the backup keeps the conversation.
  backup.seen.length = 0;
  await agent.runTurn('again');
  assert.equal(agent.provider.id, 'spare');
  // Once the rest is over the user's own model is back.
  agent.primary.until = Date.now() - 1;
  await agent.runTurn('and again');
  assert.equal(agent.provider.id, 'main');
  assert.equal(agent.model, 'm1');
  assert.equal(agent.messages.at(-1).content, 'primary again');
  assert.equal(agent.primary, null);
  assert.ok(notices.some((n) => /Primary model restored: m1 via main/.test(n)));
  main.close();
  backup.close();
});

test('a request that is simply wrong is not retried or sent elsewhere', async () => {
  const main = await fakeOpenAI([{ status: 400, message: 'messages: too long' }]);
  const backup = await fakeOpenAI([]);
  const config = { ...DEFAULTS, review: false, checkpoints: false, providers: { main: { baseUrl: main.url, apiKey: 'k' }, spare: { baseUrl: backup.url, apiKey: 'k' } }, fallback: [{ provider: 'spare', model: 'b1' }] };
  const agent = agentOn(config, 'main', 'm1');
  notices.length = 0;
  await agent.runTurn('hi');
  main.close();
  backup.close();
  assert.equal(main.seen.length, 1);
  assert.equal(backup.seen.length, 0);
  assert.ok(notices.some((n) => /Error: main: messages: too long/.test(n)));
});
