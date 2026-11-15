import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { Hooks, approve, configuredHooks, isApproved, splitCommand } from '../src/hooks.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-hooks-')));
/** A hook script that prints `reply` (given the JSON it was sent as $1's content in `seen.json`). */
function script(name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\ncat > "${path.join(dir, `${name}.seen`)}"\n${body}\n`, { mode: 0o755 });
  return file;
}
const seen = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.seen`), 'utf8'));

test('a command line is split like a shell would, with nothing expanded', () => {
  assert.deepEqual(splitCommand(`/bin/guard --mode "strict mode" 'a b' c\\ d $HOME`), ['/bin/guard', '--mode', 'strict mode', 'a b', 'c d', '$HOME']);
  assert.equal(splitCommand('~/bin/x.sh')[0], path.join(os.homedir(), 'bin/x.sh'));
  const config = { hooks: { pre_tool_call: [{ matcher: 'bash', command: 'a', timeout: 9999, fail_closed: true }, { command: '' }], not_an_event: [{ command: 'b' }], post_tool_call: [{ command: 'c', fail_closed: true }] } };
  assert.deepEqual(configuredHooks(config), [
    { event: 'pre_tool_call', command: 'a', matcher: 'bash', timeoutMs: 300_000, failClosed: true },
    { event: 'post_tool_call', command: 'c', matcher: null, timeoutMs: 60_000, failClosed: false },
  ]);
});

test('a hook does not run until that exact command is approved', async () => {
  const guard = script('guard', 'echo \'{"action":"block","message":"no shell today"}\'');
  const config = { hooks: { pre_tool_call: [{ matcher: 'bash', command: guard }] } };
  const warnings = [];
  const hooks = new Hooks({ config, cwd: dir, warn: (w) => warnings.push(w) });
  assert.equal(hooks.unapproved.length, 1);
  assert.deepEqual(await hooks.run('pre_tool_call', { toolName: 'bash', toolInput: { command: 'ls' } }), {});
  assert.match(warnings[0], /not approved yet/);
  assert.equal(fs.existsSync(path.join(dir, 'guard.seen')), false);

  approve(hooks.all[0]);
  assert.equal(isApproved(hooks.all[0]), true);
  assert.equal(isApproved({ ...hooks.all[0], command: `${guard} --other` }), false, 'a changed command needs approval again');
  assert.deepEqual(await hooks.run('pre_tool_call', { toolName: 'bash', toolInput: { command: 'ls' } }), { block: 'no shell today' });
  assert.deepEqual(await hooks.run('pre_tool_call', { toolName: 'read_file', toolInput: {} }), {}, 'the matcher limits it to bash');
  const sent = seen('guard');
  assert.deepEqual([sent.hook_event_name, sent.tool_name, sent.tool_input, sent.cwd], ['pre_tool_call', 'bash', { command: 'ls' }, dir]);
});

test('a hook can change arguments, add context, block by exit code, and fail open or closed', async () => {
  const run = async (event, entry, detail) => {
    const hooks = new Hooks({ config: { hooks: { [event]: [entry] } }, cwd: dir, warn: () => {} });
    approve(hooks.all[0]);
    return hooks.run(event, detail);
  };
  const call = { toolName: 'bash', toolInput: { command: 'npm test', timeout: 5 } };
  assert.deepEqual(await run('pre_tool_call', { command: script('modify', 'echo \'{"action":"modify","args":{"timeout":60}}\'') }, call), { args: { command: 'npm test', timeout: 60 } });
  assert.deepEqual(await run('pre_tool_call', { command: script('exit2', 'echo "not in this repo" >&2; exit 2') }, call), { block: 'not in this repo' });
  assert.deepEqual(await run('pre_llm_call', { command: script('ctx', 'echo \'{"context":"Branch: main"}\'') }, {}), { context: 'Branch: main' });
  assert.deepEqual(await run('pre_tool_call', { command: script('garbage', 'echo not json') }, call), {}, 'a broken hook does not stop the work');
  assert.match((await run('pre_tool_call', { command: script('garbage2', 'echo not json'), fail_closed: true }, call)).block, /failed closed: its output was not JSON/);
  assert.match((await run('pre_tool_call', { command: path.join(dir, 'missing.sh'), fail_closed: true }, call)).block, /failed closed/);
  assert.match((await run('pre_tool_call', { command: script('slow', 'sleep 5'), timeout: 1, fail_closed: true }, call)).block, /timed out after 1s/);
  assert.deepEqual(await run('post_tool_call', { command: script('observer', 'echo \'{"action":"block"}\'') }, call), {}, 'only the "pre" events can block');
});

test('in the agent loop a hook can veto a tool call and add to a message', async () => {
  const requests = [];
  const replies = [[{ message: { content: '', tool_calls: [{ function: { name: 'bash', arguments: { command: 'touch made.txt' } } }] } }, { done: true }], [{ message: { content: 'ok' }, done: true }]];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(replies.shift().map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-hooked-')));
  const config = { ...DEFAULTS, host: `http://127.0.0.1:${server.address().port}`, review: false, checkpoints: false, hooks: { pre_tool_call: [{ matcher: 'bash', command: script('veto', 'echo \'{"decision":"block","reason":"shell is off"}\'') }], pre_llm_call: [{ command: script('branch', 'echo \'{"context":"[git branch: main]"}\'') }] } };
  const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : () => {}) });
  const agent = new Agent({ config, ui, permissions: new Permissions({ mode: 'auto', cwd, ask: null }), provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });
  agent.shellHooks = new Hooks({ config, cwd });
  for (const hook of agent.shellHooks.all) approve(hook);
  await agent.runTurn('buat file');
  server.close();
  assert.equal(requests[0].messages[1].content, 'buat file\n\n[git branch: main]');
  assert.equal(fs.existsSync(path.join(cwd, 'made.txt')), false);
  assert.match(agent.messages[2].content, /^Blocked by the user's hook: shell is off/);
});

test('the observe-only events tell a hook about helpers, summaries, errors and approval requests', async () => {
  const { EVENTS } = await import('../src/hooks.mjs');
  assert.deepEqual(EVENTS.slice(6), ['on_approval_request', 'pre_compact', 'post_compact', 'subagent_start', 'subagent_stop', 'on_error']);
  const names = ['on_approval_request', 'pre_compact', 'post_compact', 'subagent_start', 'subagent_stop', 'on_error'];
  // One script per event; each keeps what it was sent. What it prints must change nothing.
  const config = { hooks: Object.fromEntries(names.map((n) => [n, [{ command: script(n, 'echo \'{"action":"block","message":"ignored"}\'') }]])) };
  const hooks = new Hooks({ config, cwd: dir, warn: () => {} });
  hooks.all.forEach(approve);
  const until = async (name) => {
    // The file exists a moment before it is written: wait for what it was sent to be whole.
    for (let i = 0; i < 150; i++) {
      try {
        return seen(name);
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    return seen(name);
  };

  const replies = [
    [{ message: { content: '', tool_calls: [{ function: { name: 'task', arguments: { description: 'look around', prompt: 'Report.' } } }] } }, { done: true }],
    [{ message: { content: 'All fine.' }, done: true, prompt_eval_count: 5, eval_count: 2 }], // the helper
    [{ message: { content: 'The helper says all is fine.' }, done: true, prompt_eval_count: 5, eval_count: 2 }],
    [{ message: { content: 'A summary of what happened.' }, done: true }], // the summariser
    'broken',
  ];
  const server = http.createServer((req, res) => {
    req.resume().on('end', () => {
      const reply = replies.shift();
      if (reply === 'broken') return res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'the model crashed' }));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(reply.map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const cfg = { ...DEFAULTS, host: `http://127.0.0.1:${server.address().port}`, review: false, checkpoints: false };
  const quiet = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'c' ? new Proxy({}, { get: () => (x) => String(x) }) : () => {}) });
  const permissions = new Permissions({ mode: 'auto', cwd: dir, ask: null });
  const agent = new Agent({ config: cfg, ui: quiet, permissions, provider: createProvider('ollama', cfg), info: { tools: true, thinking: false, context: null }, cwd: dir });
  agent.shellHooks = hooks;

  await agent.runTurn('have a helper look around');
  const started = await until('subagent_start');
  assert.deepEqual([started.hook_event_name, started.extra.agent, started.extra.description], ['subagent_start', null, 'look around']);
  const stopped = await until('subagent_stop');
  assert.deepEqual([stopped.extra.status, stopped.extra.report], ['completed', 'All fine.']);
  assert.equal(agent.messages.at(-1).content, 'The helper says all is fine.', 'what a hook prints for these events stops nothing');

  assert.equal(await agent.compact(), true);
  const before = await until('pre_compact');
  assert.ok(before.extra.tokens > 0 && before.extra.mid_task === false);
  assert.ok((await until('post_compact')).extra.tokens > 0);

  await agent.runTurn('and again');
  server.close();
  assert.match((await until('on_error')).extra.message, /crashed|500/);

  // Being asked: the hook hears of it while the question is still open.
  const asked = [];
  const asking = new Permissions({ mode: 'ask', cwd: dir, ask: async (q) => (asked.push(q.tool.name), 'y') });
  asking.onAsk = (tool, args, warning) => hooks.run('on_approval_request', { toolName: tool.name, extra: { summary: args.command, warning: warning ?? null } });
  const { TOOL_BY_NAME } = await import('../src/tools.mjs');
  assert.deepEqual(await asking.check(TOOL_BY_NAME.get('bash'), { command: 'npm install' }), { ok: true });
  const request = await until('on_approval_request');
  assert.deepEqual([request.tool_name, request.extra.summary, asked], ['bash', 'npm install', ['bash']]);
  // Nothing is said when nothing is asked.
  fs.rmSync(path.join(dir, 'on_approval_request.seen'));
  await asking.check(TOOL_BY_NAME.get('read_file'), { path: 'a' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.existsSync(path.join(dir, 'on_approval_request.seen')), false);
});
