// Drives the real agent loop against a scripted stand-in for Ollama's /api/chat.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';

const silentUi = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : () => {}) });

/** Each request is answered with the next scripted list of NDJSON chunks. */
async function fakeOllama(replies) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      const chunks = replies.shift() ?? [{ message: { content: 'out of script' }, done: true }];
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(chunks.map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { host: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

const call = (name, args) => ({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } });
const done = (content, extra = {}) => ({ message: { content }, done: true, prompt_eval_count: 100, eval_count: 20, ...extra });

function makeAgent(host, cwd, { mode = 'auto', ask = null, numCtx = 32768 } = {}) {
  const config = { ...DEFAULTS, host, numCtx };
  const permissions = new Permissions({ mode, cwd, ask });
  const provider = createProvider('ollama', config);
  return new Agent({ config, ui: silentUi, permissions, provider, info: { tools: true, thinking: true, context: null }, cwd });
}

test('runs tool calls and feeds the results back until the model answers', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-agent-'));
  const ollama = await fakeOllama([
    [call('write_file', { path: 'hello.txt', content: 'hi\n' }), { done: true, prompt_eval_count: 50, eval_count: 5 }],
    [call('bash', { command: 'cat hello.txt' }), { done: true }],
    [{ message: { thinking: 'hmm' } }, done('Selesai.')],
  ]);
  const agent = makeAgent(ollama.host, cwd);
  await agent.runTurn('buat hello.txt');
  ollama.close();

  assert.equal(fs.readFileSync(path.join(cwd, 'hello.txt'), 'utf8'), 'hi\n');
  assert.deepEqual(agent.messages.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
  assert.match(agent.messages[2].content, /^Created .*hello\.txt/);
  assert.equal(agent.messages[4].content, 'hi');
  assert.equal(agent.messages[5].content, 'Selesai.');
  assert.equal(agent.usedTokens, 120);

  const [first, , third] = ollama.requests;
  assert.equal(first.messages[0].role, 'system');
  assert.ok(first.tools.some((t) => t.function.name === 'edit_file'));
  assert.equal(first.think, true);
  assert.equal(first.options.num_ctx, 32768);
  assert.equal(third.messages.at(-1).role, 'tool', 'tool results are sent back');
});

test('a declined or unknown tool call is reported to the model, not executed', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-agent-'));
  const ollama = await fakeOllama([
    [call('bash', { command: 'touch nope.txt' }), call('teleport', {}), { done: true }],
    [done('ok')],
  ]);
  const agent = makeAgent(ollama.host, cwd, { mode: 'ask', ask: async () => 'pakai cara lain' });
  await agent.runTurn('x');
  ollama.close();

  assert.equal(fs.existsSync(path.join(cwd, 'nope.txt')), false);
  assert.match(agent.messages[2].content, /declined.*pakai cara lain/);
  assert.match(agent.messages[3].content, /unknown tool "teleport"/);
});

test('a failing tool returns its error and the server error ends the turn cleanly', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-agent-'));
  const ollama = await fakeOllama([
    [call('edit_file', { path: 'missing.txt', old_string: 'a', new_string: 'b' }), { done: true }],
    [{ error: 'model ran out of memory' }],
  ]);
  const agent = makeAgent(ollama.host, cwd);
  await agent.runTurn('x');
  ollama.close();

  assert.match(agent.messages[2].content, /^Error: File not found/);
  assert.equal(agent.busy, false);
  assert.equal(agent.messages.at(-1).role, 'tool', 'history stays valid after the failure');
});

test('a full context is summarised: the request survives word for word and recent messages are kept', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-agent-'));
  const ollama = await fakeOllama([[done('SUMMARY: exports are foo and bar')], [done('lanjut')]]);
  const agent = makeAgent(ollama.host, cwd, { numCtx: 4096 });
  agent.messages = [
    { role: 'user', content: 'lama' },
    { role: 'assistant', content: 'y'.repeat(20_000) },
    { role: 'assistant', content: 'recent note', blocks: [{ type: 'thinking' }] },
  ];
  await agent.runTurn('list the exports');
  ollama.close();

  const [summaryRequest] = ollama.requests;
  assert.equal(summaryRequest.tools, undefined, 'the summary request offers no tools');
  assert.match(summaryRequest.messages.at(-1).content, /Copy them exactly[\s\S]*<request>\nlist the exports\n<\/request>/, 'the summariser is told the task');
  assert.equal(summaryRequest.messages.some((m) => m.content === 'recent note'), false, 'recent messages are not summarised away');

  assert.deepEqual(agent.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.match(agent.messages[0].content, /SUMMARY: exports are foo and bar[\s\S]*Never fill a gap from memory or by guessing/);
  assert.deepEqual(agent.messages[1], { role: 'assistant', content: 'recent note' }, 'kept as written, minus replayed reasoning');
  assert.equal(agent.messages[2].content, 'list the exports');
  assert.equal(agent.messages[3].content, 'lanjut');
});

test('when nothing recent fits, the summary carries the request and a turn that keeps overflowing is stopped', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-agent-'));
  fs.writeFileSync(path.join(cwd, 'big.txt'), 'line of text\n'.repeat(3000));
  // Every reply reads the big file again, so the context refills after each summary.
  const read = () => [call('read_file', { path: 'big.txt' }), { done: true }];
  const ollama = await fakeOllama([read(), [done('S1')], read(), [done('S2')], read(), [done('S3')], read(), [done('never reached')]]);
  const agent = makeAgent(ollama.host, cwd, { numCtx: 2048 });
  const warnings = [];
  agent.ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'warn' ? (t) => warnings.push(t) : () => {}) });
  await agent.runTurn('count the lines in big.txt');
  ollama.close();

  const summaries = ollama.requests.filter((r) => !r.tools);
  assert.equal(summaries.length, 3, 'summarised three times, then gave up');
  for (const request of summaries) {
    // System prompt first, summary instructions last; what lies between is the history, cut to its budget
    // (2000 characters is the floor, used here because this test's context is smaller than the system prompt).
    const chars = request.messages.slice(1, -1).reduce((n, m) => n + JSON.stringify(m).length, 0);
    assert.ok(chars <= 2000, `the history handed to the summariser is cut to fit (${chars} characters: ${request.messages.slice(1, -1).map((m) => `${m.role} ${JSON.stringify(m).length}`).join(', ')})`);
    assert.ok(request.messages.some((m) => m.role === 'tool' && m.content.includes('characters omitted')), 'oversized output is cut, not dropped');
  }
  assert.match(warnings.join('\n'), /needs more context than the model has/);
  const first = agent.messages[0];
  assert.equal(first.compacted, true);
  assert.match(first.content, /<request>\ncount the lines in big\.txt\n<\/request>/, 'the task is still there, word for word');
  assert.equal(agent.busy, false);
});

test('an empty summary still replaces the history instead of letting the context overflow', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-agent-'));
  const ollama = await fakeOllama([[done('')], [done('ok')]]);
  const agent = makeAgent(ollama.host, cwd, { numCtx: 4096 });
  agent.messages = [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'y'.repeat(40_000) }];
  await agent.runTurn('do the thing');
  ollama.close();
  assert.match(agent.messages[0].content, /No summary could be written/);
  assert.equal(agent.messages.some((m) => m.content.length > 30_000), false, 'the oversized history is gone');
  assert.equal(agent.messages.at(-1).content, 'ok');
});

test('an image named in a message, or read by the model, reaches a vision model — and never a model without vision', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-agent-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(path.join(cwd, 'shot.png'), png);
  fs.writeFileSync(path.join(cwd, 'other.png'), png);
  const data = png.toString('base64');
  const ollama = await fakeOllama([[call('read_file', { path: 'other.png' }), { done: true }], [done('Two screenshots.')], [done('I cannot see it.')]]);
  const agent = makeAgent(ollama.host, cwd);
  agent.setModel('vision-model', { tools: true, thinking: false, vision: true, context: null });
  await agent.runTurn('what is in shot.png?');

  const [first, second] = ollama.requests;
  assert.deepEqual(first.messages[1].images, [data], 'the named file is attached to the user message');
  assert.equal(first.messages[1].content, 'what is in shot.png?');
  // The picture the tool read follows the tool result, in a user message.
  assert.deepEqual(second.messages.slice(-2).map((m) => m.role), ['tool', 'user']);
  assert.equal(second.messages.at(-2).images, undefined);
  assert.deepEqual(second.messages.at(-1).images, [data]);
  // A megabyte of base64 must not be mistaken for a full context.
  assert.ok(agent.contextTokens() < 10_000);

  // After switching to a model without vision the pictures stay behind, with a note in their place.
  agent.setModel('text-model', { tools: true, thinking: false, vision: false, context: null });
  await agent.runTurn('and other.png?');
  ollama.close();
  const third = ollama.requests[2];
  assert.ok(third.messages.every((m) => !m.images), 'no image is sent');
  assert.match(third.messages[1].content, /image shot\.png: not shown/);
  assert.equal(third.messages.at(-1).content, 'and other.png?');
});
