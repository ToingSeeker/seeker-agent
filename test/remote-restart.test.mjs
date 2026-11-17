// /restart from the phone, and an agent inside `seeker remote` that must not stop it: one asked to restart it
// with a shell command killed itself, and the command that was to start the new one died with it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRelay } from '../remote-server/server.mjs';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { Permissions, stopsDaemon } from '../src/permissions.mjs';
import { buildSystemPrompt } from '../src/prompt.mjs';
import { createProvider } from '../src/providers.mjs';
import { RemoteDaemon, deriveKeys, processGone, respawnDaemon, seal, unseal } from '../src/remote.mjs';

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

test('an agent inside seeker remote cannot stop it, whatever the approval mode; other commands are unaffected', async () => {
  const pid = 4242;
  for (const command of ['kill -INT 4242', 'kill -INT $(pgrep -f "seeker remote")', 'pkill -f "seeker remote"', 'pkill -f seeker', 'killall node', 'cd ~/seeker && git pull && kill -INT 4242 && nohup seeker remote &']) {
    assert.equal(stopsDaemon(command, pid), true, command);
  }
  for (const command of ['kill 42420', 'pkill -f "http.server 8799"', 'npm test', 'echo seeker remote', 'kill %1']) {
    assert.equal(stopsDaemon(command, pid), false, command);
  }
  const bash = { name: 'bash', risk: 'exec' };
  const inside = new Permissions({ mode: 'auto', cwd: '/w', ask: async () => 'y', daemonPid: pid });
  const refused = await inside.check(bash, { command: 'pkill -f "seeker remote"' });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /\/restart/);
  assert.equal((await inside.check(bash, { command: 'npm test' })).ok, true);
  // Claude Code's own Bash is checked the same way (its command arrives as `command`).
  assert.equal((await inside.check({ name: 'Bash', risk: 'exec' }, { command: 'kill -TERM 4242' })).ok, false);
  // In a terminal session this guard is not in the way: it is asked about like any risky command.
  let asked = 0;
  const terminal = new Permissions({ mode: 'ask', cwd: '/w', ask: async () => (asked++, 'y') });
  assert.equal((await terminal.check(bash, { command: 'pkill -f "seeker remote"' })).ok, true);
  assert.equal(asked, 1);

  // And the model is told, both as SEEKER's own model and as Claude Code's engine.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-restart-prompt-'));
  for (const provider of [{ label: 'Ollama', local: true }, { label: 'Claude Code', ownTools: true }]) {
    assert.match(buildSystemPrompt({ cwd, model: 'm', provider, remote: true }).prompt, /Never stop, kill or restart it[\s\S]*\/restart/);
    assert.doesNotMatch(buildSystemPrompt({ cwd, model: 'm', provider }).prompt, /seeker remote/);
  }
});

test('the process that replaces seeker remote is checked before it starts, then runs on its own and waits for the old one', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-respawn-'));
  const marker = path.join(dir, 'started.json');
  // A stand-in for bin/seeker.mjs: answers --version, and otherwise writes down how it was started.
  const script = path.join(dir, 'seeker.mjs');
  fs.writeFileSync(script, `import fs from 'node:fs';
if (process.argv[2] === '--version') { console.log('9.9.9'); process.exit(0); }
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ args: process.argv.slice(2), replaces: process.env.SEEKER_REPLACES }));`);
  const pid = respawnDaemon({ argv: [process.execPath, script, 'remote'], pid: 777 });
  assert.ok(pid > 0);
  const started = JSON.parse(await until(() => fs.existsSync(marker) && fs.readFileSync(marker, 'utf8')));
  assert.deepEqual(started, { args: ['remote'], replaces: '777' });

  // Code that does not load (a bad pull) is not started, and says why.
  const broken = path.join(dir, 'broken.mjs');
  fs.writeFileSync(broken, 'this is not javascript (');
  assert.throws(() => respawnDaemon({ argv: [process.execPath, broken, 'remote'], pid: 777 }), /does not start, so the running one was kept: .*SyntaxError/);

  // The new one waits for the old to be gone.
  const old = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  t.after(() => old.kill());
  assert.equal(await processGone(old.pid, 300), false);
  setTimeout(() => old.kill(), 200);
  assert.equal(await processGone(old.pid, 5000), true);
});

test('remote: /restart from the phone starts the replacement and then stops; refused while another project works or when the new code is broken', async (t) => {
  const one = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-restart-a-'));
  const two = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-restart-b-'));
  const secret = 'a-long-secret-for-restarting-the-daemon-safely';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  const config = { ...DEFAULTS, host: 'http://127.0.0.1:9', remote: { url, secret } };
  const build = async (folder, ui, asker) => ({
    agent: new Agent({ config, ui, permissions: new Permissions({ mode: 'ask', cwd: folder, ask: asker }), provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd: folder }),
    session: { save() {}, startNew() {} },
  });
  let respawns = 0;
  let broken = false;
  const respawn = () => {
    if (broken) throw new Error('The new version does not start, so the running one was kept: SyntaxError: Unexpected token');
    respawns += 1;
    return 4321;
  };
  const daemon = new RemoteDaemon({ config, folders: [one, two], build, remember: false, link: null, respawn });
  let quits = 0;
  daemon.quit = async () => {
    quits += 1;
    await daemon.stop();
  };
  const running = daemon.start();
  t.after(async () => {
    await daemon.stop();
    await running;
    relay.close();
    relay.closeAllConnections();
  });

  // The phone, reduced to what this needs: its commands, and the toasts and transcript lines that come back.
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
  const send = (type, fields) => fetch(`${url}/api/command`, { method: 'POST', headers, body: JSON.stringify({ c: seal(key, { id: `r${++n}`, at: Date.now(), type, ...fields }) }) });
  const snapshot = await until(() => events.findLast((e) => e.t === 'snapshot' && e.workspaces.length === 2));
  const [a, b] = snapshot.workspaces.map((w) => w.id);
  const said = (pattern) => events.some((e) => e.t === 'item' && pattern.test(e.item.text ?? ''));

  // Another project at work: nothing is restarted.
  daemon.workspaces.get(b).status = 'working';
  await send('message', { ws: a, text: '/restart' });
  await until(() => said(/still working\. Let it finish or stop it/));
  assert.equal(respawns, 0);
  daemon.workspaces.get(b).status = 'idle';

  // New code that does not load: the running one is kept, and the phone is told why.
  broken = true;
  await send('message', { ws: a, text: '/restart' });
  await until(() => said(/does not start, so the running one was kept/));
  assert.equal(respawns, 0);
  assert.equal(daemon.restarting, false);
  broken = false;

  // Otherwise: the replacement is started, the phone is told, and only then does this one stop.
  await send('message', { ws: a, text: '/restart' });
  await until(() => said(/Restarting SEEKER remote/));
  assert.equal(respawns, 1);
  assert.equal(quits, 0, 'the answer reaches the phone before the connection goes');
  await until(() => quits === 1, 4000);
  assert.equal(daemon.running, false);
});

test('remote: a message tells a terminal session whether the phone has its app lock on, and a lockout reaches the Mac', async (t) => {
  const { TerminalLink, terminalId } = await import('../src/link.mjs');
  const { Workspace } = await import('../src/remote.mjs');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-lockflag-'));
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-')), 'l.sock');
  const secret = 'a-long-secret-for-the-app-lock-flag-and-lockout';
  const relay = createRelay({ authHash: deriveKeys(secret).authHash });
  const url = await listen(relay);
  const config = { ...DEFAULTS, host: 'http://127.0.0.1:9', remote: { url, secret } };
  const logs = [];
  const daemon = new RemoteDaemon({ config, folders: [], build: async () => ({}), remember: false, link, log: (l) => logs.push(l) });
  const notified = [];
  daemon.notify = async (payload, kind) => (notified.push({ payload, kind }), 0);
  const running = daemon.start();
  const got = [];
  const port = new TerminalLink({ file: link, info: { tools: true }, retry: 50, onMessage: (m) => got.push(m) });
  const mirror = new Workspace(port, cwd, { id: terminalId(cwd), terminal: true });
  const agent = new Agent({ config, ui: mirror.ui, permissions: new Permissions({ mode: 'auto', cwd, ask: null }), provider: createProvider('ollama', config), info: { tools: true }, cwd });
  port.build = async () => ({ agent, session: { save() {}, startNew() {} } });
  await mirror.open();
  port.start(() => ({ ...mirror.meta(), items: mirror.items }));
  t.after(async () => {
    port.close();
    await daemon.stop();
    await running;
    relay.close();
    relay.closeAllConnections();
  });
  const { key, token } = deriveKeys(secret);
  let n = 0;
  const send = (type, fields) => fetch(`${url}/api/command`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ c: seal(key, { id: `l${++n}`, at: Date.now(), type, ...fields }) }) });
  await until(() => daemon.workspaces.has(mirror.id));

  await send('message', { ws: mirror.id, text: 'from a locked phone', locked: true });
  await send('message', { ws: mirror.id, text: 'from an unlocked one' });
  await until(() => got.length === 2);
  assert.deepEqual(got.map((m) => [m.text, m.locked]), [['from a locked phone', true], ['from an unlocked one', false]]);

  await send('lockout', {});
  await until(() => notified.length === 1);
  assert.match(notified[0].payload.title, /locked out/);
  assert.equal(notified[0].kind, 'error');
  assert.ok(logs.some((l) => /3 wrong PINs/.test(l)));
});
