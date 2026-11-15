// What keeps a long session from costing more than it has to: a smaller review, pictures of past
// turns let go, an earlier summary, a model of their own for helpers, and the cache settings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS, SETTINGS } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider, withoutReasoning } from '../src/providers.mjs';
import { reviewReplay } from '../src/review.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-sv-'));
const quietUi = (warnings = []) => new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'warn' ? (text) => warnings.push(text) : () => {}) });

/** A scripted stand-in for Ollama. Chat requests get the next reply; a model named "missing" does not exist. */
async function fakeOllama(replies) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const sent = body ? JSON.parse(body) : {};
      if (req.url === '/api/show') {
        if (sent.model === 'missing') return res.writeHead(404).end(JSON.stringify({ error: 'model not found' }));
        return res.end(JSON.stringify({ capabilities: ['completion', 'tools'] }));
      }
      requests.push(sent);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end((replies.shift() ?? [{ message: { content: 'out of script' }, done: true }]).map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { host: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}
const call = (name, args) => ({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } });
const done = (content) => ({ message: { content }, done: true, prompt_eval_count: 10, eval_count: 5 });

function makeAgent(host, cwd, extra = {}, warnings = []) {
  const config = { ...DEFAULTS, host, review: false, ...extra };
  const permissions = new Permissions({ mode: 'auto', cwd, ask: null });
  return new Agent({ config, ui: quietUi(warnings), permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, vision: true, context: null }, cwd });
}

const picture = { name: 'shot.png', mime: 'image/png', data: 'AAAA' };
const thought = { type: 'thinking', thinking: '', signature: 'sig' };

test('a review reads the recent part of the conversation, cut down, and always opens on a request', () => {
  const long = 'x'.repeat(20_000);
  const history = [
    { role: 'user', content: 'first request' },
    { role: 'assistant', content: `done ${'z'.repeat(1000)}`, blocks: [thought] },
    { role: 'user', content: 'second request', images: [picture] },
    { role: 'assistant', content: '', tool_calls: [{ id: 'a', function: { name: 'bash', arguments: { command: 'ls' } } }], blocks: [thought] },
    { role: 'tool', tool_call_id: 'a', content: long, images: [picture] },
    { role: 'assistant', content: 'all listed' },
  ];
  const all = reviewReplay(history, 100_000);
  assert.equal(all.length, history.length);
  assert.ok(all.every((m) => !m.blocks && !m.images), 'no replayed reasoning and no pictures');
  assert.match(all[2].content, /second request\n\[image shot\.png: was shown here\]/);
  assert.ok(all[4].content.length < 1500 && /characters omitted/.test(all[4].content), 'long tool output keeps its start and end');

  // Too small for both turns: the older one goes, and what is left starts with the user.
  const recent = reviewReplay(history, 1000, { each: 200 });
  assert.equal(recent.length, 4);
  assert.equal(recent[0].content.startsWith('second request'), true);
  assert.equal(recent.at(-1).content, 'all listed');

  // One turn longer than the room: its request, then its end — never a tool result without its call.
  const steps = [{ role: 'user', content: 'do a lot' }];
  for (let i = 0; i < 40; i++) steps.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, function: { name: 'bash', arguments: { command: `step ${i}` } } }] }, { role: 'tool', tool_call_id: `c${i}`, content: `output ${i} ${'y'.repeat(600)}` });
  steps.push({ role: 'assistant', content: 'finished' });
  const tail = reviewReplay(steps, 4000);
  assert.equal(tail[0].content, 'do a lot');
  assert.notEqual(tail[1].role, 'tool');
  assert.equal(tail.at(-1).content, 'finished');
  assert.ok(JSON.stringify(tail).length <= 4000);
  assert.deepEqual(reviewReplay([{ role: 'assistant', content: 'hello' }], 4000), []);
});

test('pictures of past turns leave the history only once the cache has run out, and take later reasoning with them', () => {
  const agent = makeAgent('http://127.0.0.1:9', tmp());
  const history = () => [
    { role: 'user', content: 'look at this', images: [picture] },
    { role: 'assistant', content: 'seen', blocks: [thought, { type: 'text', text: 'seen' }] },
    { role: 'user', content: 'and now?' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'r', function: { name: 'read_file', arguments: { path: 'b.png' } } }], blocks: [thought, { type: 'tool_use', id: 'r', name: 'read_file', input: { path: 'b.png' } }] },
    { role: 'tool', tool_call_id: 'r', content: 'b.png', images: [picture] },
    { role: 'assistant', content: 'both seen', blocks: [thought] },
  ];

  agent.messages = history();
  agent.lastRequestAt = Date.now();
  assert.equal(agent.dropPastImages(), 0, 'the conversation is still cached: changing it would cost more than the pictures');
  assert.equal(agent.messages[0].images.length, 1);

  agent.lastRequestAt = Date.now() - 6 * 60_000;
  assert.equal(agent.dropPastImages(), 2);
  assert.ok(agent.messages.every((m) => !m.images));
  assert.match(agent.messages[0].content, /look at this\n\[image shot\.png: removed after its turn to save context\]/);
  assert.deepEqual(agent.messages[1].blocks, [{ type: 'text', text: 'seen' }], 'reasoning after a changed message is not sent back');
  assert.equal(agent.messages[3].blocks.length, 1);
  assert.equal(agent.messages[3].blocks[0].type, 'tool_use');
  assert.equal('blocks' in agent.messages[5], false, 'a reply that was only reasoning falls back to its text');
  assert.equal(agent.dropPastImages(), 0, 'nothing left to remove');

  // Reasoning written before the first picture is untouched.
  agent.messages = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello', blocks: [thought] }, ...history()];
  agent.lastRequestAt = undefined; // a resumed session: nothing is cached
  assert.equal(agent.dropPastImages(), 2);
  assert.deepEqual(agent.messages[1].blocks, [thought]);
});

test('a new message drops the pictures of earlier turns when the cache is cold, and keeps its own', async () => {
  const cwd = tmp();
  const ollama = await fakeOllama([[done('I see it.')], [done('Still here.')], [done('Gone now.')]]);
  const agent = makeAgent(ollama.host, cwd);
  await agent.runTurn('what is this?', { images: [picture] });
  assert.equal(ollama.requests[0].messages.at(-1).images?.length, 1, 'the picture goes with its own message');
  await agent.runTurn('thanks');
  assert.equal(agent.messages[0].images?.length, 1, 'sent again while the conversation is cached');
  agent.lastRequestAt = Date.now() - 10 * 60_000;
  await agent.runTurn('one more thing');
  ollama.close();
  assert.equal(agent.messages[0].images, undefined);
  assert.equal(ollama.requests[2].messages.some((m) => m.images?.length), false);
});

test('the conversation is summarised at compactAt even when the window is far larger', () => {
  const agent = makeAgent('http://127.0.0.1:9', tmp());
  agent.info = { ...agent.info, context: 1_000_000 };
  agent.provider = { ...agent.provider, kind: 'openai' };
  assert.equal(agent.contextLimit(), 1_000_000);
  assert.equal(agent.compactCeiling(), 300_000);
  agent.config.compactAt = 0;
  assert.equal(agent.compactCeiling(), 800_000, '0: only when the window is nearly full');
  agent.config.compactAt = 500_000;
  agent.info = { ...agent.info, context: 200_000 };
  assert.equal(agent.compactCeiling(), 160_000, 'a small window still summarises before it is full');
});

test('helpers run on subagentModel when it is set, and on the own model when it cannot be used', async () => {
  const cwd = tmp();
  const script = () => [[call('task', { description: 'look', prompt: 'Report.' }), { done: true }], [done('Report: fine.')], [done('It is fine.')]];

  let ollama = await fakeOllama(script());
  let agent = makeAgent(ollama.host, cwd, { subagentModel: 'tiny:1b' });
  await agent.runTurn('check');
  ollama.close();
  assert.deepEqual(ollama.requests.map((r) => r.model), [DEFAULTS.model, 'tiny:1b', DEFAULTS.model], 'only the helper changes model');

  ollama = await fakeOllama(script());
  agent = makeAgent(ollama.host, cwd, { subagentModel: 'ollama:tiny:1b' });
  await agent.runTurn('check');
  ollama.close();
  assert.equal(ollama.requests[1].model, 'tiny:1b', 'a provider can be named in front');

  ollama = await fakeOllama(script());
  agent = makeAgent(ollama.host, cwd);
  await agent.runTurn('check');
  ollama.close();
  assert.equal(ollama.requests[1].model, DEFAULTS.model, 'unset: the same model');

  const warnings = [];
  ollama = await fakeOllama([...script(), [call('task', { description: 'again', prompt: 'Report.' }), { done: true }], [done('Report: fine.')], [done('Fine again.')]]);
  agent = makeAgent(ollama.host, cwd, { subagentModel: 'missing' }, warnings);
  await agent.runTurn('check');
  await agent.runTurn('check again');
  ollama.close();
  assert.equal(ollama.requests[1].model, DEFAULTS.model);
  assert.equal(warnings.filter((w) => /subagentModel "missing" cannot be used/.test(w)).length, 1, 'said once, not at every helper');
});

test('replayed reasoning can be taken out of a Claude history, and the new settings read their values', () => {
  const messages = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [thought, { type: 'text', text: 'hello' }] },
    { role: 'assistant', content: [{ type: 'redacted_thinking', data: 'x' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
  ];
  assert.deepEqual(withoutReasoning(messages), [messages[0], { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }, messages[3]]);

  assert.equal(SETTINGS.cacheTtl.parse('1h'), '1h');
  assert.equal(SETTINGS.cacheTtl.parse('24h'), undefined, 'the provider offers five minutes or an hour');
  assert.equal(SETTINGS.compactAt.parse('0'), 0);
  assert.equal(SETTINGS.subagentModel.parse('claude-haiku-5-5'), 'claude-haiku-5-5');
  assert.equal(SETTINGS.subagentModel.parse('same'), '');
  assert.deepEqual([DEFAULTS.cacheTtl, DEFAULTS.compactAt, DEFAULTS.subagentModel], ['1h', 300_000, '']);
});

test('every on/off setting can be switched in the /config list', async () => {
  const { CHOICES } = await import('../src/menu.mjs');
  const switches = Object.keys(SETTINGS).filter((key) => typeof DEFAULTS[key] === 'boolean');
  assert.ok(switches.includes('autoLearn') && switches.includes('review'));
  for (const key of switches) assert.deepEqual(CHOICES[key], [true, false], key);
  for (const [key, values] of Object.entries(CHOICES)) for (const value of values) assert.notEqual(SETTINGS[key].parse(String(value)), undefined, `${key} ${value}`);
});
