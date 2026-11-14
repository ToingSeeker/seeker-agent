// Remote control end to end: the relay, the Mac-side daemon driving a real agent
// loop (against a scripted model), and a stand-in for the phone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRelay } from '../remote-server/server.mjs';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS, VERSION } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import crypto from 'node:crypto';
import { RemoteDaemon, Workspace, deriveKeys, newProjectFolder, seal, unseal } from '../src/remote.mjs';
import { TerminalLink, teeUi, terminalId } from '../src/link.mjs';
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
          else if (event.t === 'queue') state.workspaces.get(event.ws).queue = event.queue;
          else if (['toast', 'providers', 'models', 'sent'].includes(event.t)) state.replies.push(event);
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

test('relay: the lockout cannot be sidestepped by sending a made-up x-forwarded-for', async (t) => {
  const { authHash } = deriveKeys('yet-another-long-secret-for-lockout-test');
  const relays = [createRelay({ authHash }), createRelay({ authHash, trustProxy: true })];
  t.after(() => relays.forEach((relay) => (relay.close(), relay.closeAllConnections())));
  const attempt = (url, i) => fetch(`${url}/api/command`, { method: 'POST', headers: { authorization: 'Bearer wrong', 'x-forwarded-for': `203.0.113.${i}` }, body: '{}' }).then((r) => r.status);

  const direct = await listen(relays[0]);
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push(await attempt(direct, i));
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.deepEqual(statuses.slice(10), [429, 429], 'counted by the connection, whatever the header says');

  // Behind a proxy that sets the header itself, each caller is counted separately.
  const proxied = await listen(relays[1]);
  for (let i = 0; i < 12; i++) assert.equal(await attempt(proxied, i), 401);

  // A full table never drops a live record; addresses that do not fit are counted as one.
  const small = createRelay({ authHash, trustProxy: true, maxTracked: 3 });
  relays.push(small);
  const full = await listen(small);
  for (let n = 0; n < 9; n++) assert.equal(await attempt(full, 1), 401);
  for (let i = 2; i <= 3; i++) assert.equal(await attempt(full, i), 401);
  for (let i = 10; i < 20; i++) assert.equal(await attempt(full, i), 401);
  assert.equal(await attempt(full, 99), 429, 'the eleventh unknown address is refused');
  const { token } = deriveKeys('yet-another-long-secret-for-lockout-test');
  const owner = await fetch(`${full}/api/command`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.200', 'content-type': 'application/json' }, body: '{}' });
  assert.notEqual(owner.status, 429, 'the right token from a new address still gets in');
  assert.notEqual(owner.status, 401);
  assert.equal(await attempt(full, 1), 401, 'the first address was not forgotten: this is its tenth failure');
  assert.equal(await attempt(full, 1), 429);
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
  assert.deepEqual(providers.find((p) => p.id === 'ollama'), { id: 'ollama', label: 'Ollama', local: true, ready: true, active: true, key: null });
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

test('remote control: pictures sent from the phone reach the model, and what is not a picture is refused', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-remote-'));
  const secret = 'test-secret-that-is-long-enough-123456';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  const asked = [];
  const model = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk)).on('end', () => {
      if (req.url === '/api/chat') asked.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(JSON.stringify(done('A red square.')));
    });
  });
  const host = await listen(model);
  const config = { ...DEFAULTS, host, remote: { url, secret } };
  const agents = [];
  const build = async (folder, ui, asker) => {
    const agent = new Agent({ config, ui, permissions: new Permissions({ mode: 'ask', cwd: folder, ask: asker }), provider: createProvider('ollama', config), info: { tools: true, thinking: false, vision: true, context: null }, cwd: folder });
    agents.push(agent);
    return { agent, session: { save() {}, startNew() {} } };
  };
  const daemon = new RemoteDaemon({ config, folders: [cwd], build, remember: false });
  const running = daemon.start();
  const me = await phone(url, secret);
  await until(() => me.state.online && me.state.workspaces.size === 1);
  const [ws] = [...me.state.workspaces.values()];
  assert.equal(ws.vision, true, 'the phone is told whether the model can see images');

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]).toString('base64');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 3)]).toString('base64');
  // No text at all: the picture is the message. The name is whatever the phone says, so it is cleaned.
  await me.send('message', { ws: ws.id, text: '', images: [{ name: '../../<b>shot</b>.png', data: png, thumb: jpeg }] });
  await until(() => me.state.workspaces.get(ws.id).items.some((i) => i.kind === 'assistant' && i.text === 'A red square.'));
  const sent = asked[0].messages.at(-1);
  assert.equal(sent.content, 'Look at this image.');
  assert.deepEqual(sent.images, [png], 'the model gets the picture itself');
  const shown = me.state.workspaces.get(ws.id).items[0];
  assert.deepEqual(shown.images, [{ name: 'b.png', mime: 'image/jpeg', thumb: jpeg }], 'the transcript keeps the small preview, not the picture');
  await until(() => me.state.workspaces.get(ws.id).status === 'idle');

  // Text dressed up as a picture, and more pictures than allowed, never reach the model.
  await me.send('message', { ws: ws.id, text: 'see', images: [{ name: 'x.png', data: Buffer.from('<script>alert(1)</script>').toString('base64') }] });
  await until(() => me.state.replies.some((r) => r.t === 'toast' && /x\.png is not a PNG, JPEG, GIF or WebP image/.test(r.text)));
  await me.send('message', { ws: ws.id, text: 'see', images: Array.from({ length: 5 }, () => ({ name: 'a.png', data: png })) });
  await until(() => me.state.replies.some((r) => r.t === 'toast' && /at most 4 images/.test(r.text)));
  assert.equal(asked.length, 1);

  // A model without vision is not handed the picture; the user is told why.
  agents[0].caps.vision = false;
  await me.send('message', { ws: ws.id, text: 'and this?', images: [{ name: 'two.png', data: png }] });
  await until(() => asked.length === 2);
  assert.equal(asked[1].messages.at(-1).images, undefined);
  await until(() => me.state.workspaces.get(ws.id).items.some((i) => i.kind === 'notice' && /cannot see images, so two\.png was not attached/.test(i.text)));
  await until(() => me.state.workspaces.get(ws.id).status === 'idle');

  me.close();
  await daemon.stop();
  await running;
  relay.close();
  relay.closeAllConnections();
  model.close();
  model.closeAllConnections();
});

test('remote: the phone is told what the agent is doing, how the turn ended, and what it cost', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-remote-'));
  const secret = 'a-fourth-long-secret-for-the-status-test-1';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  // The model: asks for a file, answers, breaks, then never answers at all.
  const script = [[call('write_file', { path: 'notes.txt', content: 'one\ntwo' }), { done: true }], [done('Written.')], 'broken', 'silent'];
  const model = http.createServer((req, res) => {
    req.resume().on('end', () => {
      const next = script.shift();
      if (next === 'silent') return;
      if (next === 'broken') return res.writeHead(500).end(JSON.stringify({ error: 'the model fell over' }));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(next.map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  const pushes = [];
  const pushService = http.createServer((req, res) => {
    req.resume().on('end', () => {
      pushes.push(req.url);
      res.writeHead(201).end();
    });
  });
  const config = { ...DEFAULTS, host: await listen(model), remote: { url, secret } };
  const build = async (folder, ui, asker, info) => ({
    agent: new Agent({ config, ui, permissions: new Permissions({ mode: 'ask', cwd: folder, ask: asker }), provider: createProvider('ollama', config), info, cwd: folder }),
    session: { save() {}, startNew() {} },
  });
  const daemon = new RemoteDaemon({ config, folders: [cwd], build, info: { tools: true, thinking: false, context: null }, remember: false, push: { anyHost: true, finishedAfter: 0 } });
  const running = daemon.start();
  const me = await phone(url, secret);
  t.after(async () => {
    me.close();
    await daemon.stop();
    for (const server of [relay, model, pushService]) {
      server.close();
      server.closeAllConnections();
    }
  });
  await until(() => me.state.online && me.state.device && me.state.workspaces.size === 1);
  const [{ id }] = [...me.state.workspaces.values()];
  const meta = () => me.state.workspaces.get(id);
  const seen = (check) => me.state.events.some((e) => e.t === 'ws' && check(e.ws));
  assert.equal(me.state.device.version, VERSION);
  assert.deepEqual([meta().phase, meta().outcome, meta().tokens, meta().tools], [null, null, null, { total: 0, failed: 0, running: null }], 'before anything ran, nothing is claimed');

  // This phone wants approvals and errors, but not "finished".
  const browser = crypto.createECDH('prime256v1');
  browser.generateKeys();
  const subscription = { endpoint: `${await listen(pushService)}/phone`, keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  await me.send('push_subscribe', { subscription, prefs: { done: false } });
  await until(() => pushes.length === 1);
  assert.deepEqual(daemon.subscriptions[0].prefs, { done: false, approval: true, error: true });

  // ── a turn that needs approval and then finishes ──
  await me.send('message', { ws: id, text: 'write notes' });
  const approval = await until(() => me.state.approvals[0]);
  assert.ok(seen((w) => w.status === 'working' && w.phase === 'thinking'), 'waiting for the model is reported as thinking');
  assert.ok(seen((w) => w.phase === 'executing' && w.tools.running === 'Writing notes.txt'), 'a tool in progress is reported as executing, and named');
  assert.deepEqual([meta().status, approval.kind, approval.tool], ['approval', 'write', 'write_file']);
  assert.deepEqual([approval.diff.line, approval.diff.counts], [1, { added: 2, removed: 0 }], 'the reviewer is told where the change starts and how big it is');
  await until(() => pushes.length === 2);

  // The round trip can be timed: a ping comes straight back with the same id.
  await me.send('ping');
  const pong = await until(() => me.state.events.find((e) => e.t === 'pong'));
  assert.match(pong.id, /^c\d+$/);

  await me.send('approve', { id_approval: approval.id, decision: 'allow' });
  await until(() => meta().status === 'idle');
  assert.ok(seen((w) => w.phase === 'responding'), 'the answer being written is reported too');
  assert.equal(meta().outcome, 'completed');
  assert.deepEqual(meta().tools, { total: 1, failed: 0, running: null });
  assert.deepEqual(meta().tokens, { input: 10, output: 5, totalInput: 10, totalOutput: 5 }, 'tokens are the provider’s own count');
  assert.equal(pushes.length, 2, 'no "finished" notification for a phone that switched those off');

  // An answer for a request that is gone is refused out loud, not dropped.
  await me.send('approve', { id_approval: approval.id, decision: 'allow' });
  await until(() => me.state.replies.some((r) => r.t === 'toast' && r.text === 'That request was already answered.'));

  // ── a turn that fails ──
  await me.send('message', { ws: id, text: 'and again' });
  await until(() => meta().status === 'idle' && meta().outcome === 'failed');
  assert.match(meta().items.at(-1).text, /the model fell over/);
  await until(() => pushes.length === 3);

  // Switching a kind off takes effect on the Mac, which is what sends them.
  await me.send('push_prefs', { endpoint: subscription.endpoint, prefs: { done: false, error: false } });
  await until(() => me.state.events.some((e) => e.t === 'push_prefs' && e.prefs.error === false));
  await me.send('push_prefs', { endpoint: 'https://example.invalid/nobody', prefs: {} });
  await until(() => me.state.replies.some((r) => r.t === 'toast' && /not on for this phone/.test(r.text)));

  // ── a turn that is stopped ──
  await me.send('message', { ws: id, text: 'take your time' });
  await until(() => meta().status === 'working');
  await me.send('stop', { ws: id });
  await until(() => meta().status === 'idle');
  assert.equal(meta().outcome, 'stopped');
  assert.equal(pushes.length, 3, 'a stopped turn notifies nobody');

  // A new conversation starts the counts again.
  await me.send('new', { ws: id });
  await until(() => meta().tools.total === 0 && meta().tokens === null && meta().outcome === null);
  await daemon.stop();
  await running;
});

test('remote: instructions sent while the agent works are steered into the task or wait their turn, and a stop pauses the queue', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-remote-'));
  const queueFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-queue-')), 'queue.json');
  const secret = 'a-long-secret-for-the-instruction-queue-test';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  // The model answers only when the test lets it, so a turn can be held open.
  const asked = []; // { messages, answer(text) }
  const model = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      asked.push({
        messages: JSON.parse(body).messages,
        answer: (text) => {
          res.writeHead(200, { 'content-type': 'application/x-ndjson' });
          res.end(JSON.stringify(done(text)));
        },
      });
    });
  });
  const config = { ...DEFAULTS, host: await listen(model), review: false, remote: { url, secret } };
  const build = async (folder, ui, asker, info) => ({
    agent: new Agent({ config, ui, permissions: new Permissions({ mode: 'ask', cwd: folder, ask: asker }), provider: createProvider('ollama', config), info, cwd: folder }),
    session: { save() {}, startNew() {} },
  });
  const options = { config, folders: [cwd], build, info: { tools: true, thinking: false, context: null }, remember: false, queueFile };
  const daemon = new RemoteDaemon(options);
  const running = daemon.start();
  const me = await phone(url, secret);
  t.after(async () => {
    me.close();
    await daemon.stop();
    for (const server of [relay, model]) {
      server.close();
      server.closeAllConnections();
    }
  });
  await until(() => me.state.online && [...me.state.workspaces.values()][0]?.queue);
  const [{ id }] = [...me.state.workspaces.values()];
  const meta = () => me.state.workspaces.get(id);
  const ack = (key) => until(() => me.state.replies.find((r) => r.t === 'sent' && r.key === key));
  const lastUser = (request) => request.messages.filter((m) => m.role === 'user').at(-1).content;
  assert.deepEqual(meta().can, { queue: true, steer: true, stop: true }, 'the phone is told what this conversation can take while it works');
  assert.deepEqual(meta().queue, { items: [], paused: null });

  // ── while the first task runs: one instruction waits, one is steered in ──
  await me.send('message', { ws: id, text: 'first' });
  await until(() => asked.length === 1 && meta().status === 'working');
  const turn = meta().turn;
  assert.match(turn, /^[0-9a-f]{8}$/);
  await me.send('instruct', { ws: id, text: 'second', mode: 'queue', key: 'k-second' });
  assert.equal((await ack('k-second')).as, 'queued');
  // Sent twice (a retry after a lost reply): answered again, queued once.
  await me.send('instruct', { ws: id, text: 'second', mode: 'queue', key: 'k-second' });
  await until(() => me.state.replies.filter((r) => r.key === 'k-second').length === 2);
  assert.deepEqual(meta().queue.items.map((i) => i.text), ['second']);
  assert.deepEqual(JSON.parse(fs.readFileSync(queueFile, 'utf8'))[id].items.map((i) => i.text), ['second'], 'what waits is on disk, not only in memory');
  // A daemon started now finds it, and does not run it by itself.
  assert.deepEqual(new RemoteDaemon({ ...options, folders: [] }).queueView(id), { items: meta().queue.items, paused: 'restart' });

  await me.send('instruct', { ws: id, text: 'use tabs', mode: 'steer', key: 'k-steer' });
  assert.equal((await ack('k-steer')).as, 'steered');
  assert.equal(asked.length, 1, 'steering does not start a new request by itself');
  asked[0].answer('First.');
  // The turn does not end with an instruction still held: the model is asked again, with it.
  await until(() => asked.length === 2);
  assert.match(lastUser(asked[1]), /use tabs/);
  assert.equal(meta().turn, turn, 'it is still the same task');
  asked[1].answer('With tabs.');
  // That task completed, so the one that waited starts by itself.
  await until(() => asked.length === 3);
  assert.equal(lastUser(asked[2]), 'second');
  await until(() => meta().queue.items.length === 0);
  assert.equal(meta().queue.paused, null);
  assert.equal(fs.readFileSync(queueFile, 'utf8').includes('second'), false, 'it left the file before it started, so a restart cannot run it again');
  asked[2].answer('Second.');
  await until(() => meta().status === 'idle');
  assert.deepEqual(meta().items.filter((i) => i.kind === 'user').map((i) => [i.text, i.via ?? null]), [['first', null], ['use tabs', 'steer'], ['second', 'queue']]);
  assert.equal(asked.length, 3);

  // ── a stop ends only the task it names, and what waits does not start after it ──
  await me.send('message', { ws: id, text: 'third' });
  await until(() => asked.length === 4 && meta().status === 'working');
  await me.send('instruct', { ws: id, text: 'fourth', mode: 'queue', key: 'k-fourth' });
  await me.send('instruct', { ws: id, text: 'held', mode: 'steer', key: 'k-held' });
  await ack('k-held');
  await me.send('stop', { ws: id, turn });
  await me.send('ping');
  await until(() => me.state.events.some((e) => e.t === 'pong'));
  assert.equal(meta().status, 'working', 'a stop pressed for an earlier task stops nothing');
  await me.send('stop', { ws: id, turn: meta().turn });
  await until(() => meta().status === 'idle');
  assert.ok(me.state.events.some((e) => e.t === 'ws' && e.ws.stopping === true), 'the phone is told the stop was taken before the task has ended');
  assert.equal(meta().outcome, 'stopped');
  // The steered instruction never reached the model: it is kept, ahead of what was already waiting.
  await until(() => meta().queue.paused === 'stopped');
  assert.deepEqual(meta().queue.items.map((i) => i.text), ['held', 'fourth']);
  assert.match(meta().items.at(-1).text, /queue is paused because the task was stopped/);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(asked.length, 4, 'nothing started by itself after the stop');

  // Removing one, then resuming: the rest runs in order.
  await me.send('queue_remove', { ws: id, item: meta().queue.items[0].id });
  await until(() => meta().queue.items.length === 1);
  await me.send('queue_resume', { ws: id });
  await until(() => asked.length === 5);
  assert.equal(lastUser(asked[4]), 'fourth');
  asked[4].answer('Fourth.');
  await until(() => meta().status === 'idle' && meta().outcome === 'completed' && meta().queue.items.length === 0);
  assert.equal(meta().queue.paused, null);

  // Sent as queued just as the task ended: with nothing else waiting it simply starts.
  await me.send('instruct', { ws: id, text: 'fifth', mode: 'queue', key: 'k-fifth' });
  assert.equal((await ack('k-fifth')).as, 'started');
  await until(() => asked.length === 6);
  // Nothing can be steered into a task that is not running, and an empty instruction is refused.
  asked[5].answer('Fifth.');
  await until(() => meta().status === 'idle');
  await me.send('instruct', { ws: id, text: 'too late', mode: 'steer', key: 'k-late' });
  assert.match((await ack('k-late')).error, /Nothing is running/);
  await me.send('instruct', { ws: id, text: '  ', mode: 'queue', key: 'k-empty' });
  assert.match((await ack('k-empty')).error, /nothing to send/);
  await daemon.stop();
  await running;
});

test('remote: a new project folder is made only inside the home folder, never hidden, never through a link out of it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-home-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-outside-'));
  newProjectFolder(path.join(home, 'shop', 'web'), home);
  assert.ok(fs.statSync(path.join(home, 'shop', 'web')).isDirectory());
  assert.throws(() => newProjectFolder(home, home), /inside your home folder/);
  assert.throws(() => newProjectFolder(path.join(outside, 'x'), home), /inside your home folder/);
  assert.throws(() => newProjectFolder(path.join(home, '..', 'x'), home), /inside your home folder/);
  assert.throws(() => newProjectFolder(path.join(home, '.ssh', 'x'), home), /hidden/);
  assert.throws(() => newProjectFolder(path.join(home, 'a', '.git'), home), /hidden/);
  assert.throws(() => newProjectFolder(path.join(home, 'a', 'b', 'c', 'd', 'e'), home), /too many/);
  assert.throws(() => newProjectFolder(path.join(home, 'bad\nname'), home), /cannot be used/);
  fs.symlinkSync(outside, path.join(home, 'link'));
  assert.throws(() => newProjectFolder(path.join(home, 'link', 'x'), home), /inside your home folder/);
  assert.equal(fs.existsSync(path.join(outside, 'x')), false);
  fs.writeFileSync(path.join(home, 'file'), '');
  assert.throws(() => newProjectFolder(path.join(home, 'file', 'x'), home), /a file, not a folder/);
});

test('remote: the phone can make a new project folder and is taken to it; a missing folder is not made unless asked', async (t) => {
  const secret = 'a-fifth-long-secret-for-the-new-folder-test';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  const config = { ...DEFAULTS, host: 'http://127.0.0.1:9', remote: { url, secret } };
  const build = async (folder, ui, asker, info) => ({
    agent: new Agent({ config, ui, permissions: new Permissions({ mode: 'ask', cwd: folder, ask: asker }), provider: createProvider('ollama', config), info, cwd: folder }),
    session: { save() {}, startNew() {} },
  });
  const daemon = new RemoteDaemon({ config, folders: [], build, info: { tools: true, thinking: false, context: null }, remember: false });
  const running = daemon.start();
  const me = await phone(url, secret);
  const name = `seeker-new-${crypto.randomBytes(4).toString('hex')}`;
  const made = path.join(os.homedir(), name);
  t.after(async () => {
    me.close();
    await daemon.stop();
    await running;
    relay.close();
    relay.closeAllConnections();
    fs.rmSync(made, { recursive: true, force: true });
  });
  await until(() => me.state.online);

  await me.send('open', { path: `~/${name}` });
  await until(() => me.state.replies.some((r) => r.t === 'toast' && /No such folder/.test(r.text)));
  assert.equal(fs.existsSync(made), false);

  await me.send('open', { path: `~/${name}`, create: true });
  await until(() => me.state.events.some((e) => e.t === 'opened'));
  const opened = me.state.events.find((e) => e.t === 'opened');
  assert.ok(fs.statSync(made).isDirectory());
  assert.equal(opened.created, true);
  assert.equal(me.state.workspaces.get(opened.id).path, `~/${name}`);

  await me.send('open', { path: '~/.ssh/evil', create: true });
  await until(() => me.state.replies.some((r) => r.t === 'toast' && /hidden/.test(r.text)));
  assert.equal(fs.existsSync(path.join(os.homedir(), '.ssh', 'evil')), false);
});

test('remote: a session running in a terminal joins the daemon, shows on the phone, and takes messages and approvals from it', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-term-'));
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-')), 'l.sock');
  const secret = 'a-sixth-long-secret-for-the-terminal-link-1';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  const ollama = await fakeOllama([
    [call('write_file', { path: 'a.txt', content: 'one' }), { done: true }],
    [done('Written.')],
    [call('write_file', { path: 'b.txt', content: 'two' }), { done: true }],
    [done('Also written.')],
  ]);
  const config = { ...DEFAULTS, host: ollama.host, remote: { url, secret } };
  const daemon = new RemoteDaemon({ config, folders: [], build: async () => ({}), info: null, remember: false, link });
  const running = daemon.start();
  const me = await phone(url, secret);

  // The terminal's side, as cli.mjs puts it together, with a stand-in for the screen.
  const shown = [];
  const screen = new Proxy({ c: new Proxy({}, { get: () => (x) => String(x) }) }, { get: (o, k) => o[k] ?? (k === 'answerStream' ? () => ({ push: (x) => shown.push(x), flush() {} }) : (...a) => shown.push([k, ...a])) });
  const got = [];
  const port = new TerminalLink({ file: link, info: { tools: true, thinking: false, context: null }, retry: 50, onMessage: (m) => got.push(m) });
  const mirror = new Workspace(port, cwd, { id: terminalId(cwd), terminal: true });
  let phoneAsker;
  let typed = null; // resolves the question open "in the terminal"
  const here = () => new Promise((resolve) => (typed = resolve));
  const ask = async (request) => {
    const first = await Promise.race([here().then((a) => ({ a, by: 'terminal' })), phoneAsker(request).then((a) => ({ a, by: 'phone' }))]);
    if (first.by === 'terminal') port.withdraw();
    return first.a;
  };
  const agent = new Agent({ config, ui: teeUi(screen, mirror.ui), permissions: new Permissions({ mode: 'ask', cwd, ask }), provider: createProvider('ollama', config), info: port.info, cwd });
  port.build = async (_c, _u, asker) => ((phoneAsker = asker), { agent, session: { save() {}, startNew() {} } });
  await mirror.open();
  port.start(() => ({ ...mirror.meta(), items: mirror.items }));
  t.after(async () => {
    me.close();
    port.close();
    await daemon.stop();
    await running;
    relay.close();
    relay.closeAllConnections();
    ollama.close();
  });

  await until(() => me.state.workspaces.has(mirror.id));
  assert.equal(me.state.workspaces.get(mirror.id).terminal, true);

  // The socket and its key are closed to other users, and a caller without the key is turned away.
  assert.equal(fs.statSync(link).mode & 0o077, 0);
  assert.equal(fs.statSync(`${link}.key`).mode & 0o077, 0);
  const stranger = net.connect(link);
  await new Promise((resolve) => stranger.once('connect', resolve));
  stranger.write(`${JSON.stringify({ t: 'hello', key: 'x'.repeat(48), ws: { id: 'abcdef0123', status: 'idle', name: 'evil' } })}\n`);
  await new Promise((resolve) => stranger.once('close', resolve));
  assert.equal(me.state.workspaces.has('abcdef0123'), false);

  // A turn typed in the terminal: the phone follows it and may answer its approval.
  const turn = mirror.run('write a');
  await until(() => me.state.approvals.length === 1);
  assert.equal(me.state.approvals[0].ws, mirror.id);
  assert.equal(me.state.workspaces.get(mirror.id).status, 'approval');
  await me.send('approve', { id_approval: me.state.approvals[0].id, decision: 'allow' });
  await turn;
  assert.equal(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8'), 'one');
  await until(() => me.state.workspaces.get(mirror.id).outcome === 'completed');
  const seen = me.state.workspaces.get(mirror.id).items;
  assert.ok(seen.some((i) => i.kind === 'user' && i.text === 'write a'));
  assert.ok(seen.some((i) => i.kind === 'assistant' && /Written/.test(i.text)));
  assert.ok(shown.some((x) => Array.isArray(x) && x[0] === 'toolStart'), 'the terminal still shows everything itself');

  // Answered in the terminal instead: the request leaves the phone.
  const second = mirror.run('write b');
  await until(() => me.state.approvals.length === 1);
  typed('y');
  await second;
  assert.equal(fs.readFileSync(path.join(cwd, 'b.txt'), 'utf8'), 'two');
  await until(() => me.state.approvals.length === 0);

  // A message from the phone is handed to the terminal, which decides what to do with it.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');
  await me.send('message', { ws: mirror.id, text: '', images: [{ name: 'shot.png', data: png }] });
  await until(() => got.length === 1);
  assert.equal(got[0].text, '');
  assert.equal(got[0].images[0].mime, 'image/png');
  await me.send('message', { ws: mirror.id, text: 'hello', images: [{ name: 'x.png', data: 'bm90IGFuIGltYWdl' }] });
  await until(() => me.state.replies.some((r) => r.t === 'toast' && /not a PNG/.test(r.text)));
  assert.equal(got.length, 1, 'what is not a picture never reaches the terminal');

  // What only the daemon's own projects can do is refused, and the terminal leaving removes it.
  await me.send('new', { ws: mirror.id });
  await until(() => me.state.replies.some((r) => r.t === 'toast' && /runs in a terminal/.test(r.text)));
  port.close();
  await until(() => !me.state.workspaces.has(mirror.id));
});

test('remote: the phone changes the settings /config holds, they take effect at once, and an API key is stored but never sent back', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-config-'));
  const secret = 'a-seventh-long-secret-for-the-settings-test';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  const ollama = await fakeOllama([
    [call('write_file', { path: 'a.txt', content: 'one' }), { done: true }],
    [done('Written.')],
    [call('write_file', { path: 'b.txt', content: 'two' }), { done: true }],
    [done('Also written.')],
  ]);
  // The replies are scripted and the context is cut to 8k below; the shipped skills' list would push the
  // prompt past the compaction mark, and the summary would eat one of the scripted replies.
  const config = { ...DEFAULTS, host: ollama.host, remote: { url, secret }, bundledSkills: false };
  const build = async (folder, ui, asker, info) => ({
    agent: new Agent({ config, ui, permissions: new Permissions({ mode: config.permissionMode, cwd: folder, ask: asker }), provider: createProvider('ollama', config), info, cwd: folder }),
    session: { save() {}, startNew() {} },
  });
  const daemon = new RemoteDaemon({ config, folders: [cwd], build, info: { tools: true, thinking: false, context: null }, remember: false });
  const running = daemon.start();
  const me = await phone(url, secret);
  t.after(async () => {
    me.close();
    await daemon.stop();
    await running;
    relay.close();
    relay.closeAllConnections();
    ollama.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  await until(() => me.state.device?.settings);
  const toasted = (pattern) => until(() => me.state.replies.some((r) => r.t === 'toast' && pattern.test(r.text)));
  const [ws] = [...me.state.workspaces.keys()];
  assert.deepEqual(me.state.device.settings, { think: true, showThinking: true, animation: true, permissionMode: 'ask', maxSteps: 60, keepAlive: '30m', host: ollama.host, ollama: true, context: 32768 });

  // Plain settings: parsed as /config parses them, and reported back.
  await me.send('config', { key: 'think', value: 'false' });
  await me.send('config', { key: 'numCtx', value: '8192' });
  await me.send('config', { key: 'maxSteps', value: '12' });
  await until(() => me.state.device.settings.maxSteps === 12);
  assert.equal(config.think, false);
  assert.equal(config.numCtx, 8192);
  assert.equal(me.state.device.settings.context, 8192);
  assert.equal(me.state.workspaces.get(ws).limit, 8192);

  // What is not a setting, or not a valid value, changes nothing.
  await me.send('config', { key: 'numCtx', value: '12' });
  await toasted(/Not a valid value for numCtx/);
  for (const key of ['remote', 'providers', 'model', '__proto__', 'constructor']) await me.send('config', { key, value: 'x' });
  await until(() => me.state.replies.filter((r) => r.t === 'toast' && /Unknown setting/.test(r.text)).length === 5);
  assert.equal(config.numCtx, 8192);
  assert.equal(config.remote.secret, secret);
  assert.equal(config.model, DEFAULTS.model);

  // Asking first: the edit waits for the phone.
  await me.send('message', { ws, text: 'write a' });
  await until(() => me.state.approvals.length === 1);
  assert.equal(fs.existsSync(path.join(cwd, 'a.txt')), false);
  await me.send('approve', { id_approval: me.state.approvals[0].id, decision: 'allow' });
  await until(() => me.state.workspaces.get(ws).status === 'idle' && fs.existsSync(path.join(cwd, 'a.txt')));

  // Switched to automatic from the phone: the next edit runs without a request.
  await me.send('config', { key: 'permissionMode', value: 'auto' });
  await until(() => me.state.device.settings.permissionMode === 'auto');
  await me.send('message', { ws, text: 'write b' });
  await until(() => fs.existsSync(path.join(cwd, 'b.txt')) && me.state.workspaces.get(ws).status === 'idle');
  assert.equal(me.state.approvals.length, 0);

  // An API key: kept on the Mac, its presence reported, its text never sent anywhere.
  const apiKey = 'sk-test-0123456789abcdefghijklmnop';
  await me.send('key', { provider: 'openai', key: apiKey });
  await toasted(/OpenAI key saved/);
  assert.equal(config.providers.openai.apiKey, apiKey);
  await me.send('providers');
  await until(() => me.state.replies.some((r) => r.t === 'providers'));
  const list = me.state.replies.findLast((r) => r.t === 'providers').list;
  assert.equal(list.find((p) => p.id === 'openai').key, process.env.OPENAI_API_KEY ? 'env' : 'set');
  assert.equal(list.find((p) => p.id === 'ollama').key, null);
  await me.send('sync');
  await until(() => me.state.events.filter((e) => e.t === 'snapshot').length >= 2);
  assert.equal(JSON.stringify(me.state.events).includes(apiKey), false);

  await me.send('key', { provider: 'ollama', key: apiKey });
  await toasted(/does not take an API key/);
  await me.send('key', { provider: 'openai', key: 'has a space in it' });
  await toasted(/does not look like an API key/);
  assert.equal(config.providers.openai.apiKey, apiKey);
});

test('remote: /commands and /skills typed on the phone run on the Mac, not as messages for the model', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-slash-'));
  fs.mkdirSync(path.join(cwd, '.seeker/skills/greet'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.seeker/skills/greet/SKILL.md'), '---\nname: greet\ndescription: Say hello to someone\n---\n\nGreet the person warmly.\n');
  const secret = 'an-eighth-long-secret-for-the-slash-test-1';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  const ollama = await fakeOllama([[done('Hello, Bob!')], [call('write_file', { path: 'y.txt', content: 'yolo' }), { done: true }], [done('Written.')], [done('A path, not a command.')]]);
  const config = { ...DEFAULTS, host: ollama.host, remote: { url, secret }, bundledSkills: false };
  const build = async (folder, ui, asker, info) => ({
    agent: new Agent({ config, ui, permissions: new Permissions({ mode: config.permissionMode, cwd: folder, ask: asker }), provider: createProvider('ollama', config), info, cwd: folder }),
    session: { save() {}, startNew() {} },
  });
  const daemon = new RemoteDaemon({ config, folders: [cwd], build, info: { tools: true, thinking: false, context: null }, remember: false });
  const running = daemon.start();
  const me = await phone(url, secret);
  t.after(async () => {
    me.close();
    await daemon.stop();
    await running;
    relay.close();
    relay.closeAllConnections();
    ollama.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  await until(() => me.state.device?.settings && me.state.workspaces.size === 1);
  const [ws] = [...me.state.workspaces.keys()];
  const items = () => me.state.workspaces.get(ws).items;
  const agent = daemon.workspaces.get(ws).agent;
  const said = (pattern) => until(() => items().some((i) => i.kind === 'notice' && pattern.test(i.text)));
  const idle = () => until(() => me.state.workspaces.get(ws).status === 'idle');

  // A command prints its output into the transcript; the model is not asked anything.
  await me.send('message', { ws, text: '/status' });
  await said(/approval\s+ask first/);
  await idle();
  assert.equal(agent.messages.length, 0);
  assert.ok(items().some((i) => i.kind === 'user' && i.text === '/status'));

  // A skill becomes the message, as in the terminal; the transcript shows what was typed, not the skill's body.
  await me.send('message', { ws, text: '/greet Bob' });
  await until(() => items().some((i) => i.kind === 'assistant' && /Hello, Bob/.test(i.text)));
  await idle();
  assert.match(agent.messages[0].content, /Greet the person warmly/);
  assert.match(agent.messages[0].content, /Bob/);
  assert.equal(items().some((i) => i.kind === 'user' && /Greet the person/.test(i.text)), false);

  // /yolo is the approval switch of the settings tab: saved, in force at once, and the edit runs without a request.
  await me.send('message', { ws, text: '/yolo' });
  await until(() => me.state.device.settings.permissionMode === 'auto');
  assert.equal(agent.permissions.mode, 'auto');
  await me.send('message', { ws, text: 'write y' });
  await until(() => fs.existsSync(path.join(cwd, 'y.txt')));
  await idle();
  assert.equal(me.state.approvals.length, 0);
  await me.send('message', { ws, text: '/config permissionMode ask' });
  await until(() => me.state.device.settings.permissionMode === 'ask');
  await me.send('message', { ws, text: '/config numCtx 12' });
  await said(/Not a valid value for numCtx/);

  // What needs the terminal, or must not come from a phone, is refused there and then.
  for (const text of ['/hooks', '/mcp', '/rollback 1', '/exit']) {
    await me.send('message', { ws, text });
    await said(new RegExp(`/${text.slice(1).split(' ')[0]} works only in the terminal`));
  }
  await me.send('message', { ws, text: '/nosuchskill' });
  await said(/Unknown command: \/nosuchskill/);
  await me.send('message', { ws, text: '/skills greet' });
  await said(/1 skill matching "greet"[\s\S]*\/greet/);

  // A message that starts with a path is still a message.
  await me.send('message', { ws, text: '/tmp/shot.png what is this' });
  await until(() => items().some((i) => i.kind === 'assistant' && /A path/.test(i.text)));
  assert.equal(agent.messages.filter((m) => m.role === 'user').length, 3);
});

test('remote: in a session that runs in a terminal, the phone cannot change its settings', async () => {
  const { runPhoneCommand } = await import('../src/commands.mjs');
  const notes = [];
  const ui = { c: new Proxy({}, { get: () => (s) => String(s) }), notice: (x) => notes.push(['notice', x]), warn: (x) => notes.push(['warn', x]), line: (x) => notes.push(['line', x]) };
  const permissions = { mode: 'ask' };
  const config = { ...DEFAULTS };
  let configured = 0;
  const ctx = { agent: { skills: [], caps: {}, model: 'm' }, ui, term: null, config, permissions, terminal: true, configure: () => configured++ };
  for (const text of ['/yolo', '/config permissionMode auto', '/think']) await runPhoneCommand(text, ctx);
  assert.equal(permissions.mode, 'ask');
  assert.equal(configured, 0);
  assert.equal(notes.filter(([kind, x]) => kind === 'warn' && /runs in a terminal/.test(x)).length, 3);
});

test('phone transcript: parallel provider tools each end on their own row, and an interrupted one is not left running', async () => {
  const { claudeCodeProvider } = await import('../src/claude-code.mjs');
  const { WebUI } = await import('../src/remote.mjs');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-parallel-'));
  let breakAfterStart = false;
  // Claude Code starting three tools in one message and reporting them back out of order.
  const query = () =>
    (async function* () {
      const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
      const result = (id, content) => ({ type: 'tool_result', tool_use_id: id, is_error: false, content });
      yield {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { content: [use('t1', 'Bash', { command: 'sleep 1' }), use('t2', 'Read', { file_path: `${cwd}/a.png` }), use('t3', 'Read', { file_path: `${cwd}/b.png` })] },
      };
      if (breakAfterStart) throw new Error('Stream closed');
      yield { type: 'user', parent_tool_use_id: null, message: { content: [result('t2', 'x'), result('t1', 'ok'), result('t3', 'y')] } };
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 's', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  const def = { id: 'claude-code', label: 'Claude Code', kind: 'claude-code', context: 200000, ownTools: true };
  const config = { ...DEFAULTS, bundledSkills: false, providers: {} };
  const items = new Map();
  const ui = new WebUI((e) => {
    if (e.t === 'item') items.set(e.item.id, { ...e.item });
    else if (e.t === 'patch' && items.has(e.id)) Object.assign(items.get(e.id), e.patch ?? {});
  });
  const agent = new Agent({ config, ui, permissions: new Permissions({ mode: 'auto', cwd }), provider: claudeCodeProvider(def, config, { query }), info: { tools: true, thinking: true, context: null }, cwd });
  const rows = () => [...items.values()].filter((i) => i.kind === 'tool').map((i) => `${i.state} ${i.doing} ${i.summary}`);

  await agent.runTurn('look');
  assert.deepEqual(rows(), ['done Running sleep 1', 'done Reading a.png', 'done Reading b.png'], 'one row per tool, none left running');

  items.clear();
  breakAfterStart = true;
  await agent.runTurn('again').catch(() => {});
  assert.deepEqual(rows(), ['failed Running sleep 1', 'failed Reading a.png', 'failed Reading b.png']);
  assert.ok([...items.values()].filter((i) => i.kind === 'tool').every((i) => i.note === 'interrupted'));
});
