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
