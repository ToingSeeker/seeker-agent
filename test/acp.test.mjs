// `seeker acp` spoken to the way an editor would: JSON-RPC lines in, JSON-RPC lines out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { PROTOCOL_VERSION, readPrompt, runAcp } from '../src/acp.mjs';
import { DEFAULTS } from '../src/config.mjs';

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
const done = (content) => ({ message: { content }, done: true, prompt_eval_count: 100, eval_count: 20 });
const project = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-acp-')));

/** An editor: sends requests, collects what comes back. */
function editor(host) {
  const input = new PassThrough();
  const output = new PassThrough();
  const received = [];
  let buffer = '';
  const waiters = [];
  output.on('data', (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      received.push(JSON.parse(buffer.slice(0, at)));
      buffer = buffer.slice(at + 1);
    }
    for (const w of [...waiters]) w();
  });
  const config = { ...DEFAULTS, host, review: false, checkpoints: false, permissionMode: 'ask' };
  const closed = runAcp({ config, info: { tools: true, thinking: false, context: null }, input, output });
  let nextId = 1;
  const send = (message) => input.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const find = (check) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting')), 4000);
      const look = () => {
        const hit = received.find(check);
        if (!hit) return;
        clearTimeout(timer);
        waiters.splice(waiters.indexOf(look), 1);
        resolve(hit);
      };
      waiters.push(look);
      look();
    });
  const request = (method, params) => {
    const id = nextId++;
    send({ id, method, params });
    return find((m) => m.id === id && m.method === undefined);
  };
  return { send, request, find, received, close: () => (input.end(), closed) };
}

test('a prompt is read from its content blocks', () => {
  const cwd = '/work/app';
  const { text, images } = readPrompt(
    [
      { type: 'text', text: 'explain this' },
      { type: 'resource_link', uri: 'file:///work/app/src/a.js', name: 'a.js' },
      { type: 'resource', resource: { uri: 'file:///work/app/notes.md', text: 'hello' } },
      { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      { type: 'image', mimeType: 'image/svg+xml', data: 'BBBB' },
      { type: 'audio', mimeType: 'audio/wav', data: 'CCCC' },
    ],
    cwd,
  );
  assert.equal(text, 'explain this\n\n[The user points at this file: src/a.js]\n\n📄 notes.md\n```\nhello\n```');
  assert.deepEqual(images, [{ name: 'image-1', mime: 'image/png', data: 'AAAA' }]);
});

test('initialize, a session, and a turn whose edit the editor approves', async () => {
  const cwd = project();
  const ollama = await fakeOllama([[call('write_file', { path: 'a.txt', content: 'one\n' }), { done: true }], [{ message: { content: 'Written.' } }, done('')]]);
  const ed = editor(ollama.host);

  const hello = await ed.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  assert.equal(hello.result.protocolVersion, PROTOCOL_VERSION);
  assert.deepEqual(hello.result.agentCapabilities, { loadSession: false, promptCapabilities: { image: true, audio: false, embeddedContext: true } });
  assert.equal(hello.result.agentInfo.name, 'seeker');

  assert.equal((await ed.request('session/new', { cwd: 'relative/path', mcpServers: [] })).error.code, -32602);
  const { sessionId } = (await ed.request('session/new', { cwd, mcpServers: [] })).result;
  assert.match(sessionId, /^[0-9a-f-]{36}$/);

  const turn = ed.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'buat a.txt' }] });
  const asked = await ed.find((m) => m.method === 'session/request_permission');
  assert.equal(asked.params.sessionId, sessionId);
  assert.match(asked.params.toolCall.title, /^Writing a\.txt/);
  assert.deepEqual(asked.params.options.map((o) => [o.optionId, o.kind]), [['allow', 'allow_once'], ['always', 'allow_always'], ['reject', 'reject_once']]);
  assert.equal(fs.existsSync(path.join(cwd, 'a.txt')), false, 'nothing is written before the editor answers');
  ed.send({ id: asked.id, result: { outcome: { outcome: 'selected', optionId: 'allow' } } });

  assert.deepEqual((await turn).result, { stopReason: 'end_turn' });
  assert.equal(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8'), 'one\n');
  const updates = ed.received.filter((m) => m.method === 'session/update').map((m) => m.params.update);
  const started = updates.find((u) => u.sessionUpdate === 'tool_call');
  assert.deepEqual([started.kind, started.status, started.toolCallId], ['edit', 'pending', asked.params.toolCall.toolCallId]);
  assert.deepEqual(updates.filter((u) => u.sessionUpdate === 'tool_call_update' && u.status).map((u) => u.status), ['in_progress', 'completed']);
  assert.equal(updates.filter((u) => u.sessionUpdate === 'agent_message_chunk').map((u) => u.content.text).join(''), 'Written.');

  assert.equal((await ed.request('session/load', { sessionId, cwd, mcpServers: [] })).error.code, -32601);
  assert.equal((await ed.request('session/prompt', { sessionId: 'nope', prompt: [{ type: 'text', text: 'x' }] })).error.code, -32602);
  ollama.close();
  await ed.close();
});

test('a rejected or cancelled permission leaves the file alone, and session/cancel ends the turn as cancelled', async () => {
  const cwd = project();
  const ollama = await fakeOllama([[call('write_file', { path: 'a.txt', content: 'one\n' }), { done: true }], [done('Left alone.')], [call('write_file', { path: 'b.txt', content: 'two\n' }), { done: true }]]);
  const ed = editor(ollama.host);
  await ed.request('initialize', { protocolVersion: 1 });
  const { sessionId } = (await ed.request('session/new', { cwd, mcpServers: [] })).result;

  const first = ed.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'buat a.txt' }] });
  const asked = await ed.find((m) => m.method === 'session/request_permission');
  ed.send({ id: asked.id, result: { outcome: { outcome: 'selected', optionId: 'reject' } } });
  assert.deepEqual((await first).result, { stopReason: 'end_turn' });
  assert.equal(fs.existsSync(path.join(cwd, 'a.txt')), false);

  const second = ed.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'buat b.txt' }] });
  const again = await ed.find((m) => m.method === 'session/request_permission' && m.id !== asked.id);
  ed.send({ method: 'session/cancel', params: { sessionId } });
  ed.send({ id: again.id, result: { outcome: { outcome: 'cancelled' } } });
  assert.deepEqual((await second).result, { stopReason: 'cancelled' });
  assert.equal(fs.existsSync(path.join(cwd, 'b.txt')), false);
  ollama.close();
  await ed.close();
});

test('the permission request carries the whole command and the raw input', async () => {
  const cwd = project();
  const command = `echo start ${'x'.repeat(400)}\nrm -rf build`;
  const ollama = await fakeOllama([[call('bash', { command }), { done: true }], [done('Not run.')]]);
  const ed = editor(ollama.host);
  await ed.request('initialize', { protocolVersion: 1 });
  const { sessionId } = (await ed.request('session/new', { cwd, mcpServers: [] })).result;
  const turn = ed.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'bersihkan' }] });
  const asked = await ed.find((m) => m.method === 'session/request_permission');
  assert.equal(asked.params.toolCall.rawInput.command, command);
  assert.ok(asked.params.toolCall.content[0].content.text.includes(command));
  ed.send({ id: asked.id, result: { outcome: { outcome: 'selected', optionId: 'reject' } } });
  await turn;
  ollama.close();
  await ed.close();
});
