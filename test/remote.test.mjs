// Remote control end to end: the relay, the Mac-side daemon driving a real agent
// loop (against a scripted model), and a stand-in for the phone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRelay } from '../remote-server/server.mjs';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import crypto from 'node:crypto';
import { RemoteDaemon, deriveKeys, seal, unseal } from '../src/remote.mjs';
import { createVapidKeys, encryptPayload, sendPush, vapidHeader } from '../src/webpush.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out waiting');
};

async function fakeOllama(replies) {
  const server = http.createServer((req, res) => {
    req.resume().on('end', () => {
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'small:1b', size: 1e9 }, { name: 'big:30b', size: 2e10 }] }));
      if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'tools'] }));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end((replies.shift() ?? [{ message: { content: 'out of script' }, done: true }]).map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  return { host: await listen(server), close: () => (server.close(), server.closeAllConnections()) };
}
const call = (name, args) => ({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } });
const done = (content) => ({ message: { content }, done: true, prompt_eval_count: 10, eval_count: 5 });

/** What the phone app does, in Node: read the encrypted log, keep state, send encrypted commands. */
async function phone(url, secret) {
  const { token, key } = deriveKeys(secret);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const state = { online: false, events: [], workspaces: new Map(), approvals: [], replies: [], device: null };
  const abort = new AbortController();
  const res = await fetch(`${url}/api/stream?since=0`, { headers, signal: abort.signal });
  assert.equal(res.status, 200);
  (async () => {
    let buffer = '';
    const decoder = new TextDecoder();
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (name === 'agent') state.online = JSON.parse(data).online;
          if (name !== 'entry') continue;
          const event = unseal(key, JSON.parse(data).c);
          state.events.push(event);
          if (event.t === 'snapshot') {
            state.device = event.device;
            state.workspaces = new Map(event.workspaces.map((w) => [w.id, w]));
            state.approvals = event.approvals;
          } else if (event.t === 'ws') state.workspaces.set(event.ws.id, { ...(state.workspaces.get(event.ws.id) ?? { items: [] }), ...event.ws });
          else if (event.t === 'item') state.workspaces.get(event.ws).items.push(event.item);
          else if (event.t === 'patch') {
            const item = state.workspaces.get(event.ws).items.find((i) => i.id === event.id);
            Object.assign(item, event.patch ?? {});
            if (event.append) item.text += event.append;
          } else if (event.t === 'approval') state.approvals.push(event.approval);
          else if (event.t === 'approval_done') state.approvals = state.approvals.filter((a) => a.id !== event.id);
          else if (['toast', 'providers', 'models'].includes(event.t)) state.replies.push(event);
        }
      }
    } catch {}
  })();
  let n = 0;
  const send = (type, fields = {}, overrides = {}) =>
    fetch(`${url}/api/command`, { method: 'POST', headers, body: JSON.stringify({ c: seal(overrides.key ?? key, { id: `c${++n}`, at: Date.now(), type, ...fields, ...overrides.fields }) }) });
  return { state, send, close: () => abort.abort(), headers };
}

test('remote control: a message from the phone runs the agent, an edit waits for approval, and the relay sees only ciphertext', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-remote-'));
  const secret = 'test-secret-that-is-long-enough-123456';
  const { authHash } = deriveKeys(secret);

  const relay = createRelay({ authHash });
  const url = await listen(relay);
  const ollama = await fakeOllama([
    [call('write_file', { path: 'hello.txt', content: 'hi from the phone\n' }), { done: true }],
    [{ message: { content: 'Created ' } }, { message: { content: 'hello.txt.' } }, done('')],
    [call('bash', { command: 'rm -rf build' }), { done: true }],
    [done('Left it alone.')],
  ]);
  const config = { ...DEFAULTS, host: ollama.host, remote: { url, secret } };
  const build = async (folder, ui, asker) => ({
    agent: new Agent({ config, ui, permissions: new Permissions({ mode: 'ask', cwd: folder, ask: asker }), provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd: folder }),
    session: { save() {}, startNew() {} },
  });
  const logs = [];
  const daemon = new RemoteDaemon({ config, folders: [cwd], build, log: (l) => logs.push(l), remember: false });
  const running = daemon.start();

  const me = await phone(url, secret);
  await until(() => me.state.online && me.state.device && me.state.workspaces.size === 1);
  const [ws] = [...me.state.workspaces.values()];
  assert.equal(ws.name, path.basename(cwd));
  assert.equal(ws.status, 'idle');

  // ── a task that edits a file ──
  assert.equal((await me.send('message', { ws: ws.id, text: 'create hello.txt' })).status, 200);
  const approval = await until(() => me.state.approvals[0]);
  assert.equal(approval.title, 'Apply this change?');
  assert.equal(approval.summary, 'hello.txt');
  assert.deepEqual(approval.diff.added, ['hi from the phone', '']);
  assert.equal(me.state.workspaces.get(ws.id).status, 'approval');
  assert.equal(fs.existsSync(path.join(cwd, 'hello.txt')), false, 'nothing is written before the phone says yes');

  await me.send('approve', { id_approval: approval.id, decision: 'allow' });
  await until(() => me.state.workspaces.get(ws.id).status === 'idle' && me.state.approvals.length === 0);
  assert.equal(fs.readFileSync(path.join(cwd, 'hello.txt'), 'utf8'), 'hi from the phone\n');
  const items = me.state.workspaces.get(ws.id).items;
  assert.deepEqual(items.map((i) => i.kind), ['user', 'tool', 'assistant']);
  assert.equal(items[0].text, 'create hello.txt');
  assert.deepEqual([items[1].state, items[1].done, items[1].summary], ['done', 'Wrote', 'hello.txt']);
  assert.equal(items[2].text, 'Created hello.txt.', 'the answer streamed in pieces arrives whole');

  // ── a risky command, refused from the phone with an instruction ──
  await me.send('message', { ws: ws.id, text: 'clean up' });
  const risky = await until(() => me.state.approvals[0]);
  assert.equal(risky.title, 'Run this command?');
  assert.equal(risky.summary, 'rm -rf build');
  assert.match(risky.warning, /risky/);
  assert.equal(risky.always, null, 'a risky command is never offered "always allow"');
  await me.send('approve', { id_approval: risky.id, decision: 'deny', note: 'leave build alone' });
  await until(() => me.state.workspaces.get(ws.id).status === 'idle');
  const after = me.state.workspaces.get(ws.id).items;
  assert.equal(after.at(-2).state, 'failed');
  assert.equal(after.at(-1).text, 'Left it alone.');

  // ── what must not work ──
  const { key } = deriveKeys(secret);
  const replay = seal(key, { id: 'c1', at: Date.now(), type: 'message', ws: ws.id, text: 'again' });
  await fetch(`${url}/api/command`, { method: 'POST', headers: me.headers, body: JSON.stringify({ c: replay }) });
  const old = seal(key, { id: 'old', at: Date.now() - 3_600_000, type: 'message', ws: ws.id, text: 'late' });
  await fetch(`${url}/api/command`, { method: 'POST', headers: me.headers, body: JSON.stringify({ c: old }) });
  // Someone who took over the relay knows the token's hash but not the encryption key.
  const forged = seal(deriveKeys('some-other-secret-entirely-000000000').key, { id: 'x', at: Date.now(), type: 'message', ws: ws.id, text: 'rm everything' });
  await fetch(`${url}/api/command`, { method: 'POST', headers: me.headers, body: JSON.stringify({ c: forged }) });
  await until(() => logs.filter((l) => /ignored/.test(l)).length === 3);
  assert.equal(me.state.workspaces.get(ws.id).items.length, after.length, 'replayed, stale and forged commands did nothing');
  assert.equal(me.state.workspaces.get(ws.id).status, 'idle');

  // The relay's own view of the conversation is unreadable.
  const peek = new AbortController();
  const stream = await fetch(`${url}/api/stream?since=0`, { headers: me.headers, signal: peek.signal });
  let seen = '';
  const reader = stream.body.getReader();
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += new TextDecoder().decode(value);
      }
    } catch {}
  })();
  await new Promise((r) => setTimeout(r, 200));
  peek.abort();
  await pump;
  assert.ok(seen.includes('event: entry'));
  for (const word of ['hello.txt', 'hi from the phone', 'rm -rf', path.basename(cwd)]) assert.equal(seen.includes(word), false, `"${word}" must not be visible to the relay`);

  me.close();
  await daemon.stop();
  await running;
  relay.close();
  relay.closeAllConnections();
  ollama.close();
});

test('relay: wrong tokens are refused and locked out; a restarted relay is resynchronised', async (t) => {
  const { token, authHash } = deriveKeys('another-long-secret-for-the-relay-test');
  const relay = createRelay({ authHash });
  const url = await listen(relay);
  t.after(() => {
    relay.close();
    relay.closeAllConnections();
  });
  const good = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  assert.equal((await fetch(`${url}/healthz`)).status, 200);
  assert.equal((await fetch(`${url}/`)).status, 200);
  assert.equal((await fetch(`${url}/../server.mjs`)).status, 404);
  assert.equal((await fetch(`${url}/api/stream`)).status, 401);
  assert.equal((await fetch(`${url}/api/command`, { method: 'POST', headers: good, body: JSON.stringify({ c: 'x' }) })).status, 503, 'no Mac connected');

  // The log: a snapshot drops what came before it.
  const post = (events) => fetch(`${url}/agent/events`, { method: 'POST', headers: good, body: JSON.stringify({ events }) }).then((r) => r.json());
  await post([{ c: 'a' }, { c: 'b' }]);
  assert.deepEqual(await post([{ c: 'snap', snapshot: true }, { c: 'c' }]), { seq: 4 });
  // Collects what the stream sends in its first moments, then hangs up.
  const read = async (since) => {
    const abort = new AbortController();
    const res = await fetch(`${url}/api/stream?since=${since}`, { headers: good, signal: abort.signal });
    let text = '';
    const reader = res.body.getReader();
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
        }
      } catch {}
    })();
    await new Promise((r) => setTimeout(r, 150));
    abort.abort();
    await pump;
    return { reset: text.includes('event: reset'), entries: [...text.matchAll(/"seq":(\d+),"c":"([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`) };
  };
  assert.deepEqual(await read(0), { reset: true, entries: ['3:snap', '4:c'] });
  assert.deepEqual(await read(3), { reset: false, entries: ['4:c'] });
  assert.deepEqual(await read(1), { reset: true, entries: ['3:snap', '4:c'] }, 'a phone that fell behind starts over from the snapshot');
  assert.deepEqual(await read(99), { reset: true, entries: ['3:snap', '4:c'] }, 'a phone ahead of a restarted relay starts over');

  // Ten wrong attempts (one was made above, without a token) lock the caller out — even with the right token afterwards.
  for (let i = 0; i < 9; i++) assert.equal((await fetch(`${url}/api/stream`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${url}/api/stream`, { headers: good })).status, 429);

  assert.throws(() => createRelay({ authHash: 'short' }), /SEEKER_REMOTE_AUTH/);
});

test('daemon: a snapshot queued while an earlier send is still in flight is not lost', async () => {
  const secret = 'yet-another-long-secret-for-the-queue-test';
  const { key } = deriveKeys(secret);
  const received = [];
  let release;
  const first = new Promise((resolve) => (release = resolve));
  // A relay that is slow to answer the first POST, like a real network.
  const slow = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', async () => {
      if (req.url === '/agent/events') {
        const events = JSON.parse(body).events;
        if (!received.length) await first;
        received.push(...events.map((e) => ({ ...unseal(key, e.c), snapshot: e.snapshot })));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  const url = await listen(slow);
  const daemon = new RemoteDaemon({ config: { ...DEFAULTS, remote: { url, secret } }, folders: [], build: async () => ({}), remember: false });
  daemon.running = true;
  daemon.send({ t: 'toast', text: 'early' }); // goes out and waits for the slow relay
  await new Promise((r) => setTimeout(r, 50));
  daemon.send(daemon.snapshot(), { snapshot: true }); // replaces the queue meanwhile
  release();
  await until(() => received.length === 2);
  assert.deepEqual(received.map((e) => [e.t, e.snapshot]), [['toast', false], ['snapshot', true]]);
  daemon.running = false;
  slow.close();
  slow.closeAllConnections();
});

test('web push: encryption matches the standard’s worked example, and the sender token verifies', () => {
  // RFC 8291, Appendix A — with the sender key and salt pinned, the output must be byte-identical.
  const subscription = { keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };
  const body = encryptPayload(subscription, 'When I grow up, I want to be a watermelon', { senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.equal(body.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  assert.notEqual(encryptPayload(subscription, 'x').toString('hex'), encryptPayload(subscription, 'x').toString('hex'), 'normally every message uses a fresh key and salt');

  const vapid = createVapidKeys();
  const header = vapidHeader('https://fcm.googleapis.com/fcm/send/abc', vapid, 'https://relay.example');
  const [, token, key] = /^vapid t=(.+), k=(.+)$/.exec(header);
  assert.equal(key, vapid.publicKey);
  const [head, claims, signature] = token.split('.');
  const point = Buffer.from(vapid.publicKey, 'base64url');
  const publicKey = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  const payload = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(payload.aud, 'https://fcm.googleapis.com');
  assert.equal(payload.sub, 'https://relay.example');
  assert.ok(payload.exp > Date.now() / 1000 && payload.exp < Date.now() / 1000 + 24 * 3600);
});

test('web push: only real push services are contacted', async () => {
  const vapid = createVapidKeys();
  const keys = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/push', 'https://fcm.googleapis.com.evil.example/x', 'not a url', 'http://127.0.0.1:1/x']) {
    assert.deepEqual(await sendPush({ endpoint, keys }, { title: 'x' }, vapid, { subject: 'https://r' }), { ok: false, status: 0, gone: true }, endpoint);
  }
});

test('remote: questions from the model, switching model, and notifications reach the phone', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-remote-'));
  const secret = 'a-third-long-secret-for-the-feature-test-1';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  const ollama = await fakeOllama([
    [call('ask_user', { question: 'Which database?', options: ['Postgres', 'MySQL'] }), { done: true }],
    [done('Using Postgres.')],
    [call('bash', { command: 'npm test' }), { done: true }],
    [done('Tests pass.')],
  ]);
  // A stand-in for the phone's push service: records what it is sent.
  const pushes = [];
  const pushService = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      pushes.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(req.url === '/gone' ? 410 : 201);
      res.end();
    });
  });
  const pushUrl = await listen(pushService);
  let daemon;
  t.after(async () => {
    await daemon?.stop();
    for (const server of [relay, pushService]) {
      server.close();
      server.closeAllConnections();
    }
    ollama.close();
  });
  // The browser's side of a subscription.
  const browser = crypto.createECDH('prime256v1');
  browser.generateKeys();
  const auth = crypto.randomBytes(16);
  const subscription = { endpoint: `${pushUrl}/phone`, keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const readPush = ({ body }) => {
    const salt = body.subarray(0, 16);
    const senderPublic = body.subarray(21, 21 + body[20]);
    const ikm = hmac(hmac(auth, browser.computeSecret(senderPublic)), Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), senderPublic, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const key = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
    const sealed = body.subarray(21 + body[20]);
    const decipher = crypto.createDecipheriv('aes-128-gcm', key, nonce);
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const text = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
    return JSON.parse(text.subarray(0, text.length - 1).toString());
  };

  const config = { ...DEFAULTS, host: ollama.host, model: 'small:1b', remote: { url, secret } };
  const build = async (folder, ui, asker, info) => ({
    agent: new Agent({ config, ui, permissions: new Permissions({ mode: 'ask', cwd: folder, ask: asker }), provider: createProvider(config.provider, config), info, cwd: folder }),
    session: { save() {}, startNew() {} },
  });
  daemon = new RemoteDaemon({ config, folders: [cwd], build, info: { tools: true, thinking: false, context: null }, remember: false, push: { anyHost: true, finishedAfter: 0 } });
  const running = daemon.start();
  const me = await phone(url, secret);
  t.after(() => me.close());
  await until(() => me.state.online && me.state.device && me.state.workspaces.size === 1);
  const [ws] = [...me.state.workspaces.values()];
  assert.ok(me.state.device.vapid.length > 80, 'the phone is given the public key to subscribe with');
  assert.equal(me.state.device.phones, 0);

  // ── notifications ──
  await me.send('push_subscribe', { subscription });
  await until(() => pushes.length === 1 && me.state.device.phones === 1);
  assert.deepEqual(readPush(pushes[0]), { title: 'SEEKER', body: 'Notifications are on for this phone.', url: '/', tag: 'hello' });
  assert.equal(pushes[0].headers['content-encoding'], 'aes128gcm');
  assert.match(pushes[0].headers.authorization, /^vapid t=.+, k=/);
  assert.equal(pushes[0].body.includes('Notifications'), false, 'the push service sees only ciphertext');

  // ── the model asks a question ──
  await me.send('message', { ws: ws.id, text: 'set up the database' });
  const question = await until(() => me.state.approvals[0]);
  assert.deepEqual([question.kind, question.title, question.options], ['question', 'Which database?', ['Postgres', 'MySQL']]);
  await until(() => pushes.length === 2);
  assert.deepEqual(readPush(pushes[1]), { title: `${ws.name}: Seeker has a question`, body: 'Which database?', url: `/#v=review:${question.id}`, tag: question.id });
  await me.send('answer', { id_approval: question.id, answer: 'Postgres' });
  await until(() => me.state.workspaces.get(ws.id).status === 'idle' && me.state.approvals.length === 0);
  assert.equal(me.state.workspaces.get(ws.id).items.at(-1).text, 'Using Postgres.');
  await until(() => pushes.length === 3);
  assert.deepEqual(readPush(pushes[2]), { title: `${ws.name}: finished`, body: 'Using Postgres.', url: `/#v=session:${ws.id}`, tag: `done-${ws.id}` });

  // ── an approval also notifies ──
  await me.send('message', { ws: ws.id, text: 'run the tests' });
  const approval = await until(() => me.state.approvals[0]);
  await until(() => pushes.length === 4);
  assert.deepEqual(readPush(pushes[3]), { title: `${ws.name}: Run this command?`, body: 'Running npm test', url: `/#v=review:${approval.id}`, tag: approval.id });

  // ── the model cannot be switched while work is going on, and can be once it is idle ──
  await me.send('model', { provider: 'ollama', model: 'big:30b' });
  await until(() => me.state.replies.some((r) => r.t === 'toast' && /still working/.test(r.text)));
  await me.send('approve', { id_approval: approval.id, decision: 'deny' });
  await until(() => me.state.workspaces.get(ws.id).status === 'idle');

  await me.send('providers');
  const providers = (await until(() => me.state.replies.find((r) => r.t === 'providers'))).list;
  assert.deepEqual(providers.find((p) => p.id === 'ollama'), { id: 'ollama', label: 'Ollama', local: true, ready: true, active: true });
  assert.equal(providers.find((p) => p.id === 'openai').ready, Boolean(process.env.OPENAI_API_KEY), 'a provider without a key cannot be picked from the phone');
  await me.send('models', { provider: 'ollama' });
  const models = await until(() => me.state.replies.find((r) => r.t === 'models'));
  assert.deepEqual(models.models, [{ name: 'small:1b', hint: '1.0 GB' }, { name: 'big:30b', hint: '20.0 GB' }]);
  assert.equal(models.active, 'small:1b');
  await me.send('model', { provider: 'ollama', model: 'big:30b' });
  await until(() => me.state.workspaces.get(ws.id).model === 'big:30b');
  await until(() => me.state.replies.some((r) => r.t === 'toast' && r.text === 'Model: big:30b via Ollama'));
  await until(() => me.state.device.model === 'big:30b');
  await me.send('model', { provider: 'nope', model: 'x' });
  await until(() => me.state.replies.some((r) => r.t === 'toast' && /Unknown provider/.test(r.text)));

  // ── a phone that removed the app is forgotten ──
  await me.send('push_subscribe', { subscription: { ...subscription, endpoint: `${pushUrl}/gone` } });
  await until(() => me.state.replies.filter((r) => /Notifications are on|not accepted/.test(r.text ?? '')).length === 2);
  assert.deepEqual(daemon.subscriptions.map((s) => new URL(s.endpoint).pathname), ['/phone']);
  await daemon.stop();
  await running;
});
