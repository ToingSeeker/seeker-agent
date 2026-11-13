import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApiServer } from '../src/api-server.mjs';
import { DEFAULTS } from '../src/config.mjs';

const KEY = 'test-key-0123456789abcdef';

async function fakeOllama(replies) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end((replies.shift() ?? [{ message: { content: 'out of script' }, done: true }]).map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { host: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

async function start(replies, extra = {}) {
  const ollama = await fakeOllama(replies);
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-api-')));
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'the answer is 42\n');
  const config = { ...DEFAULTS, host: ollama.host, provider: 'ollama', model: 'm1', ...extra };
  const server = createApiServer({ config, key: KEY, cwd, info: { tools: true, thinking: false, context: null } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, key = KEY) => fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { ollama, cwd, base, post, close: () => (server.close(), ollama.close()) };
}
const call = (name, args) => ({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } });
const done = (content) => ({ message: { content }, done: true, prompt_eval_count: 30, eval_count: 5 });

test('every request needs the key, and a short key is refused at start', async () => {
  assert.throws(() => createApiServer({ config: DEFAULTS, key: 'short', cwd: '/' }), /at least 16 characters/);
  assert.throws(() => createApiServer({ config: DEFAULTS, key: undefined, cwd: '/' }), /needs a key/);
  const api = await start([]);
  assert.equal((await api.post({ messages: [{ role: 'user', content: 'hi' }] }, null)).status, 401);
  assert.equal((await api.post({ messages: [{ role: 'user', content: 'hi' }] }, 'wrong-key-0123456789')).status, 401);
  assert.equal((await fetch(`${api.base}/v1/models`)).status, 401);
  assert.deepEqual((await (await fetch(`${api.base}/health`)).json()).status, 'ok');
  const models = await (await fetch(`${api.base}/v1/models`, { headers: { authorization: `Bearer ${KEY}` } })).json();
  assert.equal(models.data[0].id, 'seeker/m1');
  assert.equal((await api.post('{not json')).status, 400);
  assert.equal((await api.post({ messages: [{ role: 'assistant', content: 'x' }] })).status, 400);
  assert.equal((await fetch(`${api.base}/v1/embeddings`, { method: 'POST', headers: { authorization: `Bearer ${KEY}` } })).status, 404);
  assert.equal(api.ollama.requests.length, 0, 'nothing reached the model');
  api.close();
});

test('a request is answered with the tools doing the work, and the earlier turns are carried along', async () => {
  const api = await start([[call('read_file', { path: 'notes.txt' }), { done: true }], [done('It says 42.')]]);
  const res = await api.post({
    model: 'anything',
    messages: [
      { role: 'system', content: 'Answer in one sentence.' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hi.' },
      { role: 'user', content: [{ type: 'text', text: 'what does notes.txt say?' }] },
    ],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'chat.completion');
  assert.equal(body.model, 'seeker/m1');
  assert.equal(body.choices[0].message.content, '`⚙ Reading notes.txt`\nIt says 42.');
  assert.equal(body.choices[0].finish_reason, 'stop');
  const sent = api.ollama.requests[0].messages;
  assert.deepEqual(sent.slice(1).map((m) => [m.role, m.content]), [['user', 'hello'], ['assistant', 'Hi.'], ['user', 'what does notes.txt say?']]);
  const tools = api.ollama.requests[0].tools.map((t) => t.function.name);
  for (const withheld of ['ask_user', 'memory', 'skill_manage', 'cronjob_manage']) assert.ok(!tools.includes(withheld), withheld);
  api.close();
});

test('a stream arrives as OpenAI chunks; the application\'s own instructions ride with the first message', async () => {
  const api = await start([[{ message: { content: 'Halo' } }, { message: { content: ' dunia' } }, done('')]]);
  const res = await api.post({ stream: true, messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'sapa aku' }] });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const events = (await res.text()).split('\n\n').filter(Boolean).map((e) => e.replace(/^data: /, ''));
  assert.equal(events.at(-1), '[DONE]');
  const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
  assert.deepEqual(chunks[0].choices[0].delta, { role: 'assistant' });
  assert.equal(chunks.map((c) => c.choices[0].delta.content ?? '').join(''), 'Halo dunia');
  assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop');
  assert.ok(chunks.every((c) => c.object === 'chat.completion.chunk' && c.id === chunks[0].id));
  assert.equal(api.ollama.requests[0].messages[1].content, '[Instructions from the application you are being used through]\nBe brief.\n\nsapa aku');
  api.close();
});

test('requests cannot change files unless that is switched on, and never run risky commands', async () => {
  const write = call('write_file', { path: 'made.txt', content: 'x' });
  const readOnly = await start([[write, { done: true }], [done('could not')]]);
  await readOnly.post({ messages: [{ role: 'user', content: 'write a file' }] });
  assert.equal(fs.existsSync(path.join(readOnly.cwd, 'made.txt')), false);
  assert.match(readOnly.ollama.requests[1].messages.at(-1).content, /Permission denied/);
  readOnly.close();

  const open = await start([[write, { done: true }], [call('bash', { command: 'rm -rf build' }), { done: true }], [done('done')]], { apiServer: { allowChanges: true } });
  await open.post({ messages: [{ role: 'user', content: 'write a file, then clean up' }] });
  assert.equal(fs.readFileSync(path.join(open.cwd, 'made.txt'), 'utf8'), 'x');
  assert.match(open.ollama.requests[2].messages.at(-1).content, /Permission denied/, 'a risky command still has nobody to approve it');
  open.close();
});
