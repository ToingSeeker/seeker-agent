// Talk mode from the phone: a spoken conversation that turns plan mode on, so nothing is changed until Run
// (/plan go, tapped) — and spoken words are never run as a command. Relay, daemon and a scripted model, as in
// remote.test.mjs; the phone is a stand-in that reads the sealed log and sends sealed commands.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRelay } from '../remote-server/server.mjs';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { Permissions, TALK_NOTE, TALK_PLAN_NOTE, PLAN_NOTE } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import { RemoteDaemon, deriveKeys, seal, unseal } from '../src/remote.mjs';

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
const call = (name, args) => ({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } });
const done = (content) => ({ message: { content }, done: true, prompt_eval_count: 10, eval_count: 5 });

async function phone(url, secret) {
  const { token, key } = deriveKeys(secret);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const state = { online: false, workspaces: new Map(), approvals: [], toasts: [] };
  const abort = new AbortController();
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
          const name = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (name === 'agent') state.online = JSON.parse(data).online;
          if (name !== 'entry') continue;
          const event = unseal(key, JSON.parse(data).c);
          if (event.t === 'snapshot') {
            state.workspaces = new Map(event.workspaces.map((w) => [w.id, w]));
            state.approvals = event.approvals;
            // The whole summary, as the app takes it: a flag left out (planning, talk) is off.
          } else if (event.t === 'ws') state.workspaces.set(event.ws.id, { items: state.workspaces.get(event.ws.id)?.items ?? [], ...event.ws });
          else if (event.t === 'item') state.workspaces.get(event.ws).items.push(event.item);
          else if (event.t === 'approval') state.approvals.push(event.approval);
          else if (event.t === 'approval_done') state.approvals = state.approvals.filter((a) => a.id !== event.id);
          else if (event.t === 'toast') state.toasts.push(event.text);
        }
      }
    } catch {}
  })();
  let n = 0;
  const send = (type, fields = {}) => fetch(`${url}/api/command`, { method: 'POST', headers, body: JSON.stringify({ c: seal(key, { id: `c${++n}`, at: Date.now(), type, ...fields }) }) });
  return { state, send, close: () => abort.abort() };
}

async function setup(replies, { planning = false } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-talk-'));
  const secret = 'test-secret-that-is-long-enough-123456';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  const asked = [];
  const model = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk)).on('end', () => {
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'tools'] }));
      if (req.url === '/api/chat') asked.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end((replies.shift() ?? [done('out of script')]).map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  const host = await listen(model);
  const config = { ...DEFAULTS, host, bundledSkills: false, remote: { url, secret } };
  const build = async (folder, ui, asker) => {
    const permissions = new Permissions({ mode: 'ask', cwd: folder, ask: asker });
    permissions.planning = planning;
    return { agent: new Agent({ config, ui, permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd: folder }), session: { save() {}, startNew() {} } };
  };
  const daemon = new RemoteDaemon({ config, folders: [cwd], build, remember: false });
  const running = daemon.start();
  const me = await phone(url, secret);
  await until(() => me.state.online && me.state.workspaces.size === 1);
  const [ws] = [...me.state.workspaces.values()];
  const meta = () => me.state.workspaces.get(ws.id);
  const close = async () => {
    me.close();
    await daemon.stop();
    await running;
    relay.close();
    relay.closeAllConnections();
    model.close();
    model.closeAllConnections();
  };
  return { cwd, me, ws, meta, asked, daemon, close };
}

const lastUser = (body) => body.messages.filter((m) => m.role === 'user').at(-1).content;

test('talk mode: a discussion in plan mode — spoken words are never a command, and nothing changes until Run', async () => {
  const { cwd, me, ws, meta, asked, close } = await setup([
    // Spoken: the model tries to write anyway; plan mode refuses it without asking.
    [call('write_file', { path: 'spoken.txt', content: 'no\n' }), { done: true }],
    [done('We can talk it through first.')],
    // Run: the plan is carried out, and the edit asks for an approval like any other.
    [call('write_file', { path: 'run.txt', content: 'yes\n' }), { done: true }],
    [done('Left it alone.')],
  ]);
  try {
    await me.send('talk', { ws: ws.id, on: true });
    await until(() => meta().talk && meta().planning);

    // "slash plan go", heard as /plan go: run as words to the model, so plan mode stays on.
    await me.send('message', { ws: ws.id, text: '/plan go', spoken: true });
    await until(() => asked.length === 2 && meta().status === 'idle');
    const said = lastUser(asked[0]);
    assert.match(said, /^\/plan go/, 'the words reach the model as they were said');
    assert.ok(said.includes(TALK_NOTE) && said.includes(TALK_PLAN_NOTE), 'with the talk notes');
    assert.ok(!said.includes(PLAN_NOTE), 'not the note that asks for a plan with every reply');
    assert.equal(meta().planning, true, 'a spoken "/plan go" does not leave plan mode');
    assert.equal(fs.existsSync(path.join(cwd, 'spoken.txt')), false, 'and the edit was refused');
    assert.equal(me.state.approvals.length, 0, 'refused outright, not asked about');
    const mine = meta().items.find((i) => i.kind === 'user');
    assert.equal(mine.via, 'voice', 'the conversation marks it as spoken');
    assert.ok(!meta().items.some((i) => i.kind === 'notice' && /\/plan go carries/.test(i.text ?? '')), 'no /plan hint in talk mode: the phone shows Run');

    // Run, tapped: /plan go as a command. Plan mode ends, and the edit waits for a tap like any other.
    await me.send('message', { ws: ws.id, text: '/plan go' });
    const approval = await until(() => me.state.approvals[0]);
    assert.equal(meta().planning, undefined, 'plan mode is off once Run was tapped');
    assert.equal(approval.kind, 'write');
    // Talk on in the middle of the run (the phone listening again too early) must not bring plan mode back
    // halfway through the plan: it waits for the project to be idle.
    await me.send('talk', { ws: ws.id, on: true });
    await me.send('ping', {});
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(meta().planning, undefined, 'plan mode stays off while the plan is carried out');
    await me.send('approve', { id_approval: approval.id, decision: 'deny' });
    await until(() => asked.length === 4 && meta().status === 'idle');
    assert.equal(fs.existsSync(path.join(cwd, 'run.txt')), false, 'the denied edit was not made');
    assert.ok(lastUser(asked[2]).includes(TALK_NOTE) && !lastUser(asked[2]).includes(TALK_PLAN_NOTE), 'still talking, no longer planning');

    // Talking on after a run starts as a discussion again; Done puts plan mode back as it was (off).
    await me.send('talk', { ws: ws.id, on: true });
    await until(() => meta().planning === true);
    await me.send('talk', { ws: ws.id, on: false });
    await until(() => !meta().talk);
    assert.equal(meta().planning, undefined, 'plan mode was off before talk began, so it is off again');
  } finally {
    await close();
  }
});

test('talk mode: plan mode that was on before talk began stays on after it; a typed /command still runs as one', async () => {
  const { me, ws, meta, close } = await setup([], { planning: true });
  try {
    await me.send('talk', { ws: ws.id, on: true });
    await until(() => meta().talk);
    await me.send('talk', { ws: ws.id, on: false });
    await until(() => !meta().talk);
    assert.equal(meta().planning, true);
    // Not spoken: /plan off is a command, as it always was.
    await me.send('message', { ws: ws.id, text: '/plan off' });
    await until(() => meta().planning === undefined && meta().status === 'idle');
  } finally {
    await close();
  }
});

test('talk mode: only for a project the phone opened, not one that does not exist', async () => {
  const { me, close } = await setup([]);
  try {
    await me.send('talk', { ws: 'nope', on: true });
    await until(() => me.state.toasts.some((t) => /Talk mode works/.test(t)));
  } finally {
    await close();
  }
});
