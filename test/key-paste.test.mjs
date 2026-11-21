// An API key pasted into a message: asked about before it leaves the Mac for a cloud model, hidden
// in phone notifications, and refused by the memory store in all the shapes the log redactor knows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent, CANCEL_SEND, MASK_KEYS, SEND_KEYS } from '../src/agent.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { scanThreats } from '../src/memory.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import { RemoteDaemon } from '../src/remote.mjs';
import { findSecrets } from '../src/secrets.mjs';

// Built from parts, so no file in the repo holds a string a secret scanner would take for a real key.
const FAKE = {
  openai: `sk-proj-${'A1b2'.repeat(6)}`,
  stripe: `sk_${'live'}_${'Z9y8'.repeat(5)}`,
  githubPat: `github_${'pat'}_${'Q7w6'.repeat(9)}`,
  google: `AI${'za'}${'Sy0x'.repeat(9)}`,
  jwt: `eyJ${'hbGciOiJIUzI1'}.${'eyJzdWIiOiIxMjM0'}.${'c2lnbmF0dXJlX19f'}`,
};

const silentUi = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : () => {}) });

async function fakeOllama() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(JSON.stringify({ message: { content: 'ok' }, done: true }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { host: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

/** An agent on Ollama whose answer to SEEKER's questions is `answer`; a `-cloud` model leaves the Mac. */
function makeAgent(host, { model = 'gpt-oss:120b-cloud', answer = MASK_KEYS } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-keypaste-'));
  const config = { ...DEFAULTS, host, model, bundledSkills: false };
  const agent = new Agent({ config, ui: silentUi, permissions: new Permissions({ mode: 'auto', cwd, ask: null }), provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });
  const asked = [];
  agent.hooks.askUser = async (request) => (asked.push(request), answer);
  return { agent, asked };
}

const lastUser = (request) => request.messages.filter((m) => m.role === 'user').at(-1).content;

test('key paste: every key shape is found, and variable names are not keys', () => {
  for (const [name, key] of Object.entries(FAKE)) assert.deepEqual(findSecrets(`use ${key} please`), [key], name);
  assert.deepEqual(findSecrets(`api_key=${'k3y'.repeat(8)}`), ['k3y'.repeat(8)]);
  assert.deepEqual(findSecrets('set token: GITHUB_PERSONAL_ACCESS_TOKEN in the env'), []);
  assert.deepEqual(findSecrets('npm test passed; see sk-short and AIza'), []);
});

test('key paste: memory refuses the newer key shapes too, but not an environment variable name', () => {
  for (const [name, key] of Object.entries(FAKE)) assert.equal(scanThreats(`The key is ${key}`), 'hardcoded_secret', name);
  assert.equal(scanThreats('Deploys read token: GITHUB_PERSONAL_ACCESS_TOKEN from Railway'), null);
  assert.equal(scanThreats('User prefers short replies in Indonesian.'), null);
});

test('key paste: for a cloud model the user chooses, and "mask" sends the message without the key', async (t) => {
  const ollama = await fakeOllama();
  t.after(ollama.close);
  const { agent, asked } = makeAgent(ollama.host);
  await agent.runTurn(`set this key in .env: ${FAKE.openai}`, { references: true });

  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].options, [MASK_KEYS, SEND_KEYS, CANCEL_SEND]);
  assert.equal(asked[0].other, false);
  assert.match(asked[0].question, /sk-p…/);
  assert.ok(!asked[0].question.includes(FAKE.openai), 'the question itself does not repeat the key');
  const sent = lastUser(ollama.requests[0]);
  assert.ok(!sent.includes(FAKE.openai));
  assert.match(sent, /set this key in \.env: sk-p…\[redacted\]/);
  assert.ok(!JSON.stringify(agent.messages).includes(FAKE.openai), 'nor is it kept in the conversation');
});

test('key paste: "send it as it is" sends the key, "don\'t send" sends nothing', async (t) => {
  const ollama = await fakeOllama();
  t.after(ollama.close);
  const send = makeAgent(ollama.host, { answer: SEND_KEYS });
  await send.agent.runTurn(`key ${FAKE.stripe}`, { references: true });
  assert.ok(lastUser(ollama.requests[0]).includes(FAKE.stripe));

  for (const answer of [CANCEL_SEND, null, 'something typed']) {
    const cancel = makeAgent(ollama.host, { answer });
    await cancel.agent.runTurn(`key ${FAKE.stripe}`, { references: true });
    assert.equal(cancel.agent.messages.length, 0, String(answer));
  }
  assert.equal(ollama.requests.length, 1, 'only the turn the user chose to send reached the model');
});

test('key paste: no question for a model on this Mac, a message nobody typed, or a run with nobody to ask', async (t) => {
  const ollama = await fakeOllama();
  t.after(ollama.close);
  const local = makeAgent(ollama.host, { model: 'qwen3:8b' });
  await local.agent.runTurn(`key ${FAKE.google}`, { references: true });
  const untyped = makeAgent(ollama.host);
  await untyped.agent.runTurn(`a goal step that quotes ${FAKE.google}`);
  const unattended = makeAgent(ollama.host);
  unattended.agent.hooks.askUser = undefined;
  await unattended.agent.runTurn(`key ${FAKE.google}`, { references: true });

  assert.equal(local.asked.length + untyped.asked.length, 0);
  assert.equal(ollama.requests.length, 3);
  for (const request of ollama.requests) assert.ok(lastUser(request).includes(FAKE.google));
});

test('key paste: a phone notification never shows a key, even one cut at the length limit', async () => {
  const daemon = new RemoteDaemon({ config: { ...DEFAULTS, remote: { url: 'http://127.0.0.1:9', secret: 'x'.repeat(40) } }, folders: [], build: async () => ({}), remember: false, log: () => {} });
  const notified = [];
  daemon.notify = async (payload) => (notified.push(payload), 0);
  daemon.send = () => {};
  // The key starts near the 160-character cut, so what is left of it after the cut is too short to recognise.
  const summary = `${'x'.repeat(115)} curl -H "Authorization: Bearer ${FAKE.openai}" https://api.example.com`;
  daemon.ask({ id: 'a1', ws: 'w', wsName: 'demo', kind: 'exec', title: 'Run a command', doing: 'Run', summary, cwd: '~', at: Date.now() });
  assert.equal(notified.length, 1);
  assert.ok(!notified[0].body.includes(FAKE.openai.slice(0, 10)), notified[0].body);
  assert.match(notified[0].body, /Bearer sk-p…\[red/, 'masked first, then cut');
});
