// Continuing a saved conversation from the phone (/resume), and a project carrying on with its conversation
// when SEEKER remote is restarted, instead of opening empty.
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
import { RemoteDaemon, deriveKeys, seal, transcriptOf, unseal } from '../src/remote.mjs';
import { Session } from '../src/session.mjs';

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

test('a saved conversation becomes the phone transcript: what was said and each step taken', () => {
  const items = transcriptOf([
    { role: 'system', content: 'ignored' },
    { role: 'user', content: 'fix the bug' },
    { role: 'assistant', content: 'Looking.', tool_calls: [{ function: { name: 'bash', arguments: '{"command":"npm test"}' } }, { function: { name: 'MysteryTool', arguments: {} } }] },
    { role: 'tool', content: 'ok' },
    { role: 'assistant', content: 'Fixed.' },
  ]);
  assert.deepEqual(
    items.map((i) => [i.kind, i.text ?? `${i.done} ${i.summary}`.trim()]),
    [['user', 'fix the bug'], ['assistant', 'Looking.'], ['tool', 'Ran npm test'], ['tool', 'MysteryTool'], ['assistant', 'Fixed.']],
  );
  assert.ok(items.every((i) => i.id.startsWith('h')), 'ids that never collide with the live ones');
});

test('remote: /resume lists the saved conversations to tap and continues one; a restart carries on with it', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-resume-'));
  const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-resume-store-')), 'conversations.json');
  const secret = 'a-long-secret-for-continuing-saved-conversations';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  const seen = []; // what the model was sent, request by request
  const replies = ['One.', 'Two.', 'Three.'];
  const ollama = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c)).on('end', () => {
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'small:1b', size: 1e9 }] }));
      if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'tools'] }));
      seen.push(JSON.parse(body).messages.filter((m) => m.role === 'user').map((m) => m.content));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(JSON.stringify({ message: { content: replies.shift() ?? 'out of script' }, done: true, prompt_eval_count: 10, eval_count: 5 }));
    });
  });
  const config = { ...DEFAULTS, host: await listen(ollama), remote: { url, secret } };
  const build = async (folder, ui, asker) => {
    const agent = new Agent({ config, ui, permissions: new Permissions({ mode: 'ask', cwd: folder, ask: asker }), provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd: folder });
    agent.session = new Session(folder);
    return { agent, session: agent.session };
  };
  const start = () => {
    const daemon = new RemoteDaemon({ config, folders: [cwd], build, remember: false, link: null, conversationsFile: store });
    return { daemon, running: daemon.start() };
  };
  let { daemon, running } = start();
  t.after(async () => {
    await daemon.stop();
    await running;
    relay.close();
    relay.closeAllConnections();
    ollama.close();
    ollama.closeAllConnections();
  });

  const { token, key } = deriveKeys(secret);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const events = [];
  const abort = new AbortController();
  t.after(() => abort.abort());
  const res = await fetch(`${url}/api/stream?since=0`, { headers, signal: abort.signal });
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
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (/^event: entry$/m.test(block) && data) events.push(unseal(key, JSON.parse(data).c));
        }
      }
    } catch {}
  })();
  let n = 0;
  const send = (type, fields) => fetch(`${url}/api/command`, { method: 'POST', headers, body: JSON.stringify({ c: seal(key, { id: `q${++n}`, at: Date.now(), type, ...fields }) }) });
  const lastSnapshot = () => events.findLast((e) => e.t === 'snapshot' && e.workspaces.length === 1);
  const { id } = (await until(lastSnapshot)).workspaces[0];
  // Waited for after what started it is seen (a model request, a line in the transcript).
  const idle = () => until(() => daemon.workspaces.get(id)?.status === 'idle');

  // Two conversations: one, then /new and another.
  await send('message', { ws: id, text: 'first task' });
  await until(() => seen.length === 1);
  await idle();
  await send('new', { ws: id });
  await until(() => daemon.workspaces.get(id).agent.messages.length === 0);
  await send('message', { ws: id, text: 'second task' });
  await until(() => seen.length === 2);
  await idle();
  assert.deepEqual(seen[1], ['second task'], 'the new conversation starts empty');

  // /resume on its own: the saved ones, newest first, to tap.
  await send('message', { ws: id, text: '/resume' });
  const list = await until(() => events.find((e) => e.t === 'choose' && e.mode === 'send'));
  assert.equal(list.ws, id);
  assert.deepEqual(list.items.map((i) => i.value), ['resume 1', 'resume 2']);
  assert.match(list.items[0].description, /^open now · second task/);
  assert.match(list.items[1].description, /^first task — .* · 2 messages$/);

  // A tap sends /resume 2: the phone gets that conversation back, and the model continues it.
  await send('message', { ws: id, text: '/resume 2' });
  const back = await until(() => {
    const ws = lastSnapshot()?.workspaces[0];
    return ws?.items.some((i) => i.kind === 'user' && i.text === 'first task') && ws;
  });
  assert.ok(back.items.some((i) => i.kind === 'assistant' && i.text === 'One.'));
  assert.ok(!back.items.some((i) => i.text === 'second task'));
  await until(() => events.some((e) => e.t === 'item' && /Continuing: first task \(2 messages\)/.test(e.item.text ?? '')));
  await idle();
  await send('message', { ws: id, text: 'and then' });
  await until(() => seen.length === 3);
  await idle();
  assert.deepEqual(seen[2], ['first task', 'and then']);
  const firstFile = new Session(cwd).list().find((s) => s.preview === 'first task').file;
  assert.equal(JSON.parse(fs.readFileSync(firstFile, 'utf8')).messages.length, 4, 'it goes on in its own file');

  // SEEKER remote restarted: the project opens with that same conversation, not an empty one.
  await daemon.stop();
  await running;
  ({ daemon, running } = start());
  const after = await until(() => {
    const ws = lastSnapshot()?.workspaces[0];
    return ws?.items.some((i) => i.text === 'and then') && ws;
  });
  assert.ok(after.items.some((i) => i.text === 'first task'));
  assert.equal(daemon.workspaces.get(id).agent.messages.length, 4);
  assert.equal(daemon.workspaces.get(id).session.file, firstFile);

  // In a session that runs in a terminal, /resume is the terminal's.
  const { runPhoneCommand } = await import('../src/commands.mjs');
  const said = [];
  const ui = new Proxy({}, { get: (_, k) => (k === 'c' ? new Proxy({}, { get: () => (x) => x }) : (text) => said.push([k, text])) });
  await runPhoneCommand('/resume', { agent: daemon.workspaces.get(id).agent, ui, config, permissions: null, session: new Session(cwd), terminal: true });
  assert.match(said[0][1], /runs in a terminal/);
});
