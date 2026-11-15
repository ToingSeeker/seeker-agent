// `seeker -p … --output json`: a script gets the answer and what was done as JSON on stdout.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OUTPUT_FORMATS, attachJson } from '../src/json-output.mjs';

const BIN = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'bin', 'seeker.mjs');

/** A scripted stand-in for Ollama. */
async function fakeOllama(replies) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3.5:27b', size: 1e9 }] }));
      if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'tools'] }));
      if (req.url !== '/api/chat') return res.end(JSON.stringify({ version: '0.0.0' }));
      const reply = replies.shift() ?? [{ message: { content: 'out of script' }, done: true }];
      // A reply of 'broken' is a model server that fails: the run must say so, not hang or pretend.
      if (reply === 'broken') return res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'the model crashed' }));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(reply.map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { host: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
const call = (name, args) => ({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } });
const done = (content) => ({ message: { content }, done: true, prompt_eval_count: 120, eval_count: 30 });

/** Runs the real command line with a scratch home and returns what it wrote and how it ended. */
function seeker(args, { host, cwd }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-json-home-'));
  fs.mkdirSync(path.join(home, '.seeker'));
  fs.writeFileSync(path.join(home, '.seeker', 'config.json'), JSON.stringify({ host, review: false, checkpoints: false }));
  return new Promise((resolve) => {
    const env = { ...process.env, HOME: home, NO_COLOR: '1' };
    delete env.SEEKER_HOME;
    delete env.NODE_TEST_CONTEXT; // or the child takes itself for a test file of this run and never ends
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('--output json: one object on stdout with the answer, the steps and the tokens; the activity stays on stderr', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-json-'));
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'the answer is 42\n');
  const ollama = await fakeOllama([[call('read_file', { path: 'notes.txt' }), { done: true }], [call('write_file', { path: 'out.txt', content: 'x' }), { done: true }], [done('It says **42**.')]]);
  const run = await seeker(['-p', 'what does notes.txt say?', '--json'], { host: ollama.host, cwd });
  ollama.close();

  const lines = run.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `stdout is exactly one line of JSON: ${run.stdout}`);
  const result = JSON.parse(lines[0]);
  assert.deepEqual([result.type, result.ok, result.result, result.error, result.interrupted], ['result', true, 'It says **42**.', null, false]);
  assert.deepEqual([result.model, result.provider], ['qwen3.5:27b', 'ollama']);
  assert.deepEqual(result.steps.map((s) => [s.action, s.ok]), [['Reading notes.txt', true], ['Writing out.txt', false]], 'what was done, and that the write was not allowed with nobody there to ask');
  assert.match(result.steps[1].note, /not run/);
  assert.equal(fs.existsSync(path.join(cwd, 'out.txt')), false);
  assert.deepEqual(result.usage, { input_tokens: 120, output_tokens: 30, counted_by_provider: true });
  assert.ok(result.duration_ms >= 0);
  assert.equal(run.code, 0);
  assert.match(run.stderr, /Read notes\.txt/, 'the readable activity is still shown, on stderr');
  assert.doesNotMatch(run.stdout, /Read notes\.txt/);
});

test('--output stream-json: an object per line as things happen, the result last; a failed run exits 1', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-json-'));
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'a\n');
  const ollama = await fakeOllama([[call('read_file', { path: 'a.txt' }), { done: true }], [done('Done.')]]);
  const run = await seeker(['-p', 'read a.txt', '--output', 'stream-json'], { host: ollama.host, cwd });
  ollama.close();
  const events = run.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.type), ['start', 'step', 'step', 'text', 'result']);
  assert.deepEqual([events[0].model, events[0].provider, fs.realpathSync(events[0].cwd)], ['qwen3.5:27b', 'ollama', fs.realpathSync(cwd)]);
  assert.deepEqual([events[1].status, events[2].status, events[2].action], ['started', 'done', 'Reading a.txt']);
  assert.equal(events.at(-1).result, 'Done.');

  // The model fails in the middle of the run: the result says so, and the exit code is not zero.
  const failing = await fakeOllama(['broken']);
  const dead = await seeker(['-p', 'hello', '--json'], { host: failing.host, cwd });
  failing.close();
  assert.equal(dead.code, 1);
  const failed = JSON.parse(dead.stdout.trim().split('\n').at(-1));
  assert.deepEqual([failed.ok, failed.result], [false, '']);
  assert.match(failed.error, /crashed|500/);
  assert.doesNotMatch(dead.stdout.trim(), /^(?!\{)/m, 'nothing but JSON ever reaches stdout');

  const bad = await seeker(['-p', 'x', '--output', 'yaml'], { host: failing.host, cwd });
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /--output is one of: text, json, stream-json/);
  assert.deepEqual(OUTPUT_FORMATS, ['text', 'json', 'stream-json']);
});

test('json output: an error in the turn makes the result not ok and is named', () => {
  const calls = [];
  const ui = { answerStream: () => ({ push() {}, flush() {} }), toolStart: () => calls.push('start'), toolDone: () => calls.push('done'), toolFail: () => calls.push('fail'), warn: () => calls.push('warn'), error: () => calls.push('error') };
  const written = [];
  const finish = attachJson(ui, { write: (l) => written.push(l) });
  ui.toolStart('Running', 'Ran', 'npm test');
  ui.toolFail('exit 1');
  ui.warn('  ⚠ something to know');
  ui.error('  Error: the provider is down');
  const out = ui.answerStream();
  out.push('partial');
  const result = finish({ messages: [], interrupted: false, model: 'm', provider: { id: 'p' }, usage: { totalInput: 0, totalOutput: 0, known: false } });
  assert.deepEqual(calls, ['start', 'fail', 'warn', 'error'], 'the screen still gets everything');
  assert.deepEqual([result.ok, result.error, result.result], [false, 'the provider is down', 'partial']);
  assert.deepEqual(result.steps, [{ action: 'Running npm test', ok: false, note: 'exit 1' }]);
  assert.deepEqual(result.warnings, ['⚠ something to know']);
  assert.equal(written.length, 1, 'without streaming, only the result is written');
  assert.equal(attachJson({ ...ui }, { write() {} })({ messages: [], interrupted: true, model: 'm', provider: { id: 'p' }, usage: {} }).ok, false, 'an interrupted run is not ok');
});
