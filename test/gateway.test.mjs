// The chat gateway and its platforms, against a scripted model and scripted chat services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULTS } from '../src/config.mjs';
import { Gateway, configuredPlatforms, splitMessage } from '../src/gateway.mjs';
import discord from '../src/platforms/discord.mjs';
import slack from '../src/platforms/slack.mjs';
import telegram from '../src/platforms/telegram.mjs';

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
const project = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-gateway-')));
const until = async (check, ms = 4000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** A chat platform that only records what was sent. */
function fakePlatform(allow = ['7']) {
  const sent = [];
  return { name: 'telegram', allow: new Set(allow), sent, adapter: { limit: 4000, start: async () => {}, stop() {}, send: async (chat, text) => sent.push({ chat, text }) } };
}
function makeGateway(host, cwd, platform) {
  const config = { ...DEFAULTS, host, review: false, checkpoints: false };
  return new Gateway({ config, cwd, info: { tools: true, thinking: false, context: null }, platforms: [platform] });
}

test('only configured platforms are started, with tokens from the config or the environment', () => {
  assert.deepEqual(configuredPlatforms({}, {}), []);
  const found = configuredPlatforms({ gateway: { telegram: { allow: [42] }, slack: { botToken: 'xoxb-1' } } }, { TELEGRAM_BOT_TOKEN: 't', SLACK_APP_TOKEN: '' });
  assert.deepEqual(found.map((p) => p.name), ['telegram'], 'slack lacks its app token');
  assert.equal(found[0].settings.token, 't');
  assert.deepEqual([...found[0].allow], ['42']);
});

test('long answers are cut at line breaks', () => {
  assert.deepEqual(splitMessage('short', 10), ['short']);
  const parts = splitMessage(`${'a'.repeat(30)}\n${'b'.repeat(30)}\n${'c'.repeat(30)}`, 70);
  assert.deepEqual(parts, [`${'a'.repeat(30)}\n${'b'.repeat(30)}`, 'c'.repeat(30)]);
  assert.ok(splitMessage('x'.repeat(250), 100).every((p) => p.length <= 100));
});

test('a stranger is refused and told their id once; someone on the list gets an answer', async () => {
  const cwd = project();
  const ollama = await fakeOllama([[done('Halo.')]]);
  const platform = fakePlatform();
  const gateway = makeGateway(ollama.host, cwd, platform);
  await gateway.receive(platform, { chat: 'c1', user: '99', text: 'hi' });
  await gateway.receive(platform, { chat: 'c1', user: '99', text: 'hi again' });
  assert.equal(platform.sent.length, 1);
  assert.match(platform.sent[0].text, /Your telegram id is 99/);
  assert.equal(ollama.requests.length, 0, 'the model never saw the stranger');

  await gateway.receive(platform, { chat: 'c1', user: '7', text: 'halo' });
  ollama.close();
  assert.equal(platform.sent.at(-1).text, 'Halo.');
});

test('an edit is asked about in the chat and done only after a yes; "auto" is never used', async () => {
  const cwd = project();
  const ollama = await fakeOllama([[call('write_file', { path: 'a.txt', content: 'one\n' }), { done: true }], [done('Written.')], [call('write_file', { path: 'b.txt', content: 'two\n' }), { done: true }], [done('Left alone.')]]);
  const platform = fakePlatform();
  const gateway = makeGateway(ollama.host, cwd, platform);
  gateway.config.permissionMode = 'auto';

  const first = gateway.receive(platform, { chat: 'c1', user: '7', text: 'buat a.txt' });
  const question = await until(() => platform.sent.find((m) => /Allow\?/.test(m.text)));
  assert.match(question.text, /^Writing a\.txt/);
  assert.equal(fs.existsSync(path.join(cwd, 'a.txt')), false, 'nothing is written before the answer');
  // Someone else on the list cannot answer for the person who asked.
  platform.allow.add('8');
  await gateway.receive(platform, { chat: 'c1', user: '8', text: 'y' });
  assert.equal(fs.existsSync(path.join(cwd, 'a.txt')), false);
  await gateway.receive(platform, { chat: 'c1', user: '7', text: 'y' });
  await first;
  assert.equal(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8'), 'one\n');
  assert.match(platform.sent.at(-1).text, /^✓ Writing a\.txt[^\n]*\n\nWritten\.$/);

  const second = gateway.receive(platform, { chat: 'c1', user: '7', text: 'buat b.txt' });
  await until(() => platform.sent.filter((m) => /Allow\?/.test(m.text)).length === 2);
  await gateway.receive(platform, { chat: 'c1', user: '7', text: 'n' });
  await second;
  ollama.close();
  assert.equal(fs.existsSync(path.join(cwd, 'b.txt')), false);
});

test('/status, /new and a message during a turn', async () => {
  const cwd = project();
  const ollama = await fakeOllama([[done('satu')], [done('dua')]]);
  const platform = fakePlatform();
  const gateway = makeGateway(ollama.host, cwd, platform);
  await gateway.receive(platform, { chat: 'c1', user: '7', text: 'pertama' });
  await gateway.receive(platform, { chat: 'c1', user: '7', text: '/status' });
  assert.match(platform.sent.at(-1).text, /Idle\. 2 messages/);
  await gateway.receive(platform, { chat: 'c1', user: '7', text: '/new' });
  await gateway.receive(platform, { chat: 'c1', user: '7', text: 'kedua' });
  ollama.close();
  assert.equal(ollama.requests[1].messages.filter((m) => m.role === 'user').length, 1, 'the fresh conversation starts empty');
  await gateway.receive(platform, { chat: 'c1', user: '7', text: '/stop' });
  assert.equal(platform.sent.at(-1).text, 'Nothing is running.');
});

test('telegram: polls for messages, answers only when addressed in a group, and never quotes its token', async () => {
  const calls = [];
  const updates = [
    [
      { update_id: 5, message: { text: 'halo', chat: { id: 11, type: 'private' }, from: { id: 7, username: 'ana' } } },
      { update_id: 6, message: { text: 'not for the bot', chat: { id: -20, type: 'group' }, from: { id: 7 } } },
      { update_id: 7, message: { text: '@seekerbot cek build', chat: { id: -20, type: 'group' }, from: { id: 7, first_name: 'Ana' } } },
    ],
  ];
  let adapter;
  const fetch = async (url, init) => {
    const method = url.split('/').pop();
    const body = JSON.parse(init.body);
    calls.push({ method, body });
    if (method === 'getMe') return { status: 200, json: async () => ({ ok: true, result: { id: 1, username: 'seekerbot' } }) };
    if (method === 'getUpdates') {
      const next = updates.shift();
      if (!next) adapter.stop();
      return { status: 200, json: async () => ({ ok: true, result: next ?? [] }) };
    }
    if (method === 'sendMessage' && body.chat_id === 'bad') return { status: 400, json: async () => ({ ok: false, description: 'chat not found' }) };
    return { status: 200, json: async () => ({ ok: true, result: {} }) };
  };
  adapter = telegram({ token: 'SECRET-TOKEN', fetch });
  const got = [];
  await adapter.start((m) => got.push(m));
  assert.deepEqual(got, [
    { chat: '11', user: '7', userName: 'ana', text: 'halo' },
    { chat: '-20', user: '7', userName: 'Ana', text: 'cek build' },
  ]);
  assert.equal(calls.filter((c) => c.method === 'getUpdates')[1].body.offset, 8, 'handled updates are not asked for again');
  await assert.rejects(adapter.send('bad', 'x'), (err) => /chat not found/.test(err.message) && !err.message.includes('SECRET-TOKEN'));
});

/** A WebSocket that the test drives by hand. */
function fakeSockets() {
  const sockets = [];
  class Socket {
    constructor(url) {
      Object.assign(this, { url, readyState: 1, sent: [], listeners: {} });
      sockets.push(this);
    }
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      for (const fn of this.listeners.close ?? []) fn({});
    }
    deliver(data) {
      for (const fn of this.listeners.message ?? []) fn({ data: JSON.stringify(data) });
    }
  }
  return { Socket, sockets };
}

test('discord: identifies, answers direct messages and mentions only, and reconnects when told to', async () => {
  const { Socket, sockets } = fakeSockets();
  const posts = [];
  const fetch = async (url, init) => {
    if (url.endsWith('/gateway/bot')) return { ok: true, status: 200, json: async () => ({ url: 'wss://gw.example' }) };
    posts.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const adapter = discord({ token: 'tok', fetch, WebSocket: Socket, reconnectMs: 5 });
  const got = [];
  const running = adapter.start((m) => got.push(m));
  const first = await until(() => sockets[0]);
  assert.equal(first.url, 'wss://gw.example/?v=10&encoding=json');
  first.deliver({ op: 10, d: { heartbeat_interval: 60_000 } });
  assert.deepEqual([first.sent[0].op, first.sent[0].d.token, first.sent[0].d.intents], [2, 'tok', 4609]);
  first.deliver({ op: 0, t: 'READY', s: 1, d: { user: { id: '500', username: 'seeker' } } });
  first.deliver({ op: 0, t: 'MESSAGE_CREATE', s: 2, d: { channel_id: '900', content: 'halo', author: { id: '7', username: 'ana' } } });
  first.deliver({ op: 0, t: 'MESSAGE_CREATE', s: 3, d: { channel_id: '901', guild_id: '1', content: 'chatting', author: { id: '7' } } });
  first.deliver({ op: 0, t: 'MESSAGE_CREATE', s: 4, d: { channel_id: '901', guild_id: '1', content: '<@500> cek build', author: { id: '7', username: 'ana' } } });
  first.deliver({ op: 0, t: 'MESSAGE_CREATE', s: 5, d: { channel_id: '900', content: 'from a bot', author: { id: '8', bot: true } } });
  assert.deepEqual(got, [
    { chat: '900', user: '7', userName: 'ana', text: 'halo' },
    { chat: '901', user: '7', userName: 'ana', text: 'cek build' },
  ]);
  await adapter.send('900', '@everyone hi');
  assert.deepEqual(posts[0], { url: 'https://discord.com/api/v10/channels/900/messages', auth: 'Bot tok', body: { content: '@everyone hi', allowed_mentions: { parse: [] } } });

  first.deliver({ op: 7 });
  await until(() => sockets[1]);
  adapter.stop();
  await running;
});

test('slack: acknowledges every event, answers direct messages and mentions only', async () => {
  const { Socket, sockets } = fakeSockets();
  const calls = [];
  const fetch = async (url, init) => {
    const method = url.split('/').pop();
    calls.push({ method, auth: init.headers.authorization, body: JSON.parse(init.body) });
    if (method === 'auth.test') return { status: 200, json: async () => ({ ok: true, user_id: 'UBOT' }) };
    if (method === 'apps.connections.open') return { status: 200, json: async () => ({ ok: true, url: 'wss://slack.example/link' }) };
    return { status: 200, json: async () => ({ ok: true }) };
  };
  const adapter = slack({ botToken: 'xoxb-1', appToken: 'xapp-1', fetch, WebSocket: Socket, reconnectMs: 5 });
  const got = [];
  const running = adapter.start((m) => got.push(m));
  const socket = await until(() => sockets[0]);
  assert.equal(calls.find((c) => c.method === 'apps.connections.open').auth, 'Bearer xapp-1');
  const event = (id, body) => socket.deliver({ type: 'events_api', envelope_id: id, payload: { event: body } });
  event('e1', { type: 'message', channel_type: 'im', channel: 'D1', user: 'U7', text: 'halo' });
  event('e2', { type: 'message', channel_type: 'channel', channel: 'C1', user: 'U7', text: 'chatting' });
  event('e3', { type: 'app_mention', channel: 'C1', user: 'U7', text: '<@UBOT> cek build' });
  event('e4', { type: 'message', channel_type: 'im', channel: 'D1', user: 'U7', text: 'edited', subtype: 'message_changed' });
  assert.deepEqual(socket.sent, [{ envelope_id: 'e1' }, { envelope_id: 'e2' }, { envelope_id: 'e3' }, { envelope_id: 'e4' }]);
  assert.deepEqual(got, [
    { chat: 'D1', user: 'U7', text: 'halo' },
    { chat: 'C1', user: 'U7', text: 'cek build' },
  ]);
  await adapter.send('D1', 'hi');
  assert.deepEqual(calls.at(-1), { method: 'chat.postMessage', auth: 'Bearer xoxb-1', body: { channel: 'D1', text: 'hi', unfurl_links: false } });
  adapter.stop();
  await running;
});

test('the approval question carries the whole command, however long, with its line breaks', async () => {
  const cwd = project();
  const command = `echo start ${'x'.repeat(400)}\nrm -rf build`;
  const ollama = await fakeOllama([[call('bash', { command }), { done: true }], [done('Not run.')]]);
  const platform = fakePlatform();
  const gateway = makeGateway(ollama.host, cwd, platform);
  const turn = gateway.receive(platform, { chat: 'c1', user: '7', text: 'bersihkan' });
  const question = await until(() => platform.sent.find((m) => /Allow\?/.test(m.text)));
  assert.ok(question.text.includes(command), 'nothing of the command is cut or flattened');
  await gateway.receive(platform, { chat: 'c1', user: '7', text: 'n' });
  await turn;
  ollama.close();
});
