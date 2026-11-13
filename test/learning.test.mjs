// The agent loop with the learning features switched on: checkpoints,
// @ references, folder instructions, skills written mid-session and the unattended review.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { list } from '../src/checkpoints.mjs';
import { DEFAULTS, HOME_DIR } from '../src/config.mjs';
import { readStore } from '../src/memory.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import { runCommand } from '../src/commands.mjs';
import { TOOL_BY_NAME } from '../src/tools.mjs';

const said = [];
const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : ['notice', 'warn', 'error', 'line'].includes(key) ? (text) => said.push(String(text)) : key === 'c' ? new Proxy({}, { get: () => (t) => t }) : () => {}) });

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
const project = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-learn-')));

function makeAgent(host, cwd, extra = {}) {
  const config = { ...DEFAULTS, host, review: false, ...extra };
  return new Agent({ config, ui, permissions: new Permissions({ mode: 'auto', cwd, ask: null }), provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });
}

test('the folder is snapshotted before the first change of a message, and /rollback restores it', async () => {
  const cwd = project();
  fs.writeFileSync(path.join(cwd, 'app.js'), 'original\n');
  const ollama = await fakeOllama([
    [call('read_file', { path: 'app.js' }), { done: true }],
    [call('write_file', { path: 'app.js', content: 'rewritten\n' }), { done: true }],
    [call('bash', { command: 'echo more > extra.txt' }), { done: true }],
    [done('ok')],
  ]);
  const agent = makeAgent(ollama.host, cwd);
  await agent.runTurn('rewrite app.js');
  ollama.close();
  assert.equal(fs.readFileSync(path.join(cwd, 'app.js'), 'utf8'), 'rewritten\n');
  const taken = await list(cwd);
  assert.equal(taken.length, 1, 'one snapshot per message, taken before the first change');
  assert.match(taken[0].reason, /^before write_file: app\.js/);

  said.length = 0;
  await runCommand('/rollback 1', { agent, ui, term: null, config: agent.config, permissions: agent.permissions, session: null, hub: null });
  assert.equal(fs.readFileSync(path.join(cwd, 'app.js'), 'utf8'), 'original\n');
  assert.equal(fs.existsSync(path.join(cwd, 'extra.txt')), false);
  assert.ok(said.some((line) => /Restored the folder to checkpoint/.test(line)));
  assert.match(agent.messages.at(-2).content, /rolled the working folder back/);

  // A read-only message takes no snapshot; with checkpoints off, neither does a write.
  const quiet = await fakeOllama([[call('bash', { command: 'ls' }), { done: true }], [done('ok')], [call('write_file', { path: 'b.txt', content: 'x' }), { done: true }], [done('ok')]]);
  const other = project();
  await makeAgent(quiet.host, other).runTurn('look');
  assert.equal((await list(other)).length, 0);
  await makeAgent(quiet.host, other, { checkpoints: false }).runTurn('write');
  quiet.close();
  assert.equal((await list(other)).length, 0);
});

test('@ references are attached to the message, and folder instructions to the first tool result there', async () => {
  const cwd = project();
  fs.mkdirSync(path.join(cwd, '.git'));
  fs.mkdirSync(path.join(cwd, 'api'));
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'line one\nline two\n');
  fs.writeFileSync(path.join(cwd, 'api/AGENTS.md'), 'api: migrations replay on deploy');
  fs.writeFileSync(path.join(cwd, 'api/server.js'), 'listen()\n');
  const ollama = await fakeOllama([[call('read_file', { path: 'api/server.js' }), { done: true }], [done('ok')]]);
  const agent = makeAgent(ollama.host, cwd);
  said.length = 0;
  await agent.runTurn('ringkas @file:notes.txt:2 dan @file:missing.txt', { references: true });
  ollama.close();
  const sent = ollama.requests[0].messages[1].content;
  assert.match(sent, /^ringkas @file:notes\.txt:2 dan @file:missing\.txt\n\n--- Context Warnings ---\n- @file:missing\.txt: file not found\n\n--- Attached Context ---\n\n📄 @file:notes\.txt:2 [^\n]*\n```txt\nline two\n```$/);
  assert.ok(said.some((line) => /attached @file:notes\.txt:2/.test(line)));
  const result = agent.messages.find((m) => m.role === 'tool').content;
  assert.match(result, /listen\(\)\n\n\[Subdirectory context discovered: api\/AGENTS\.md\]\napi: migrations replay on deploy$/);
});

test('a skill written mid-session can be loaded at once and is announced with the next message', async () => {
  const cwd = project();
  const skill = '---\nname: csv-exports\ndescription: Use when exporting CSV. Quote every field.\n---\n\nAlways quote fields.\n';
  const ollama = await fakeOllama([
    [call('skill_manage', { operations: [{ action: 'create', name: 'csv-exports', content: skill }] }), { done: true }],
    [call('skill', { name: 'csv-exports' }), { done: true }],
    [done('saved')],
    [done('ok')],
  ]);
  const agent = makeAgent(ollama.host, cwd);
  const before = agent.system;
  await agent.runTurn('simpan caranya sebagai skill');
  assert.match(agent.messages[2].content, /"success": true/);
  assert.match(agent.messages[4].content, /^Skill "csv-exports"/);
  assert.equal(agent.system, before, 'the system prompt is not rebuilt mid-session');
  await agent.runTurn('lanjut');
  ollama.close();
  assert.match(ollama.requests[3].messages.at(-1).content, /^lanjut\n\n\[Skills added since this session started[^\]]*csv-exports \(Use when exporting CSV\. Quote every field\.\)\]$/);
  fs.rmSync(path.join(HOME_DIR, 'skills'), { recursive: true, force: true });
});

test('after a reply an unattended review saves what is worth keeping, with only the memory and skill tools', async () => {
  const cwd = project();
  fs.rmSync(path.join(HOME_DIR, 'memories'), { recursive: true, force: true });
  const ollama = await fakeOllama([
    [done('Baik, saya akan selalu menjawab singkat.')],
    // The review: it tries a forbidden tool, then saves a fact.
    [call('bash', { command: 'touch hacked.txt' }), { done: true }],
    [call('memory', { target: 'user', operations: [{ action: 'add', content: 'Prefers short answers; said "from now on".' }] }), { done: true }],
    [done('Saved.')],
  ]);
  const agent = makeAgent(ollama.host, cwd, { review: true, memoryReviewEvery: 1 });
  said.length = 0;
  await agent.runTurn('mulai sekarang jawab singkat saja');
  await agent.reviewing;
  ollama.close();

  assert.deepEqual(readStore('user', cwd), ['Prefers short answers; said "from now on".']);
  assert.equal(fs.existsSync(path.join(cwd, 'hacked.txt')), false);
  assert.equal(agent.messages.length, 2, 'the review leaves the conversation itself untouched');
  assert.ok(said.some((line) => /learned from this conversation — remembered a fact \(user\)/.test(line)));
  const review = ollama.requests[1];
  assert.deepEqual(review.tools.map((t) => t.function.name).sort(), ['glob', 'grep', 'memory', 'read_file', 'skill', 'skill_manage']);
  assert.match(review.messages.at(-1).content, /^Review the conversation above and consider saving to memory/);
  assert.equal(review.messages[0].content, ollama.requests[0].messages[0].content, 'the review reuses the same system prompt');
  assert.equal(agent.turnsSinceMemory, 0);

  // Nothing is reviewed when it is switched off, or in a one-shot run.
  const off = await fakeOllama([[done('a')], [done('b')]]);
  const plain = makeAgent(off.host, cwd, { review: false, memoryReviewEvery: 1 });
  await plain.runTurn('x');
  await plain.reviewing;
  const oneShot = makeAgent(off.host, cwd, { review: true, memoryReviewEvery: 1 });
  oneShot.allowReview = false;
  await oneShot.runTurn('x');
  await oneShot.reviewing;
  off.close();
  assert.equal(off.requests.length, 2);
});

test('saving memory or a skill asks first, and an unattended review saves nothing the user has not allowed', async () => {
  const cwd = project();
  fs.rmSync(path.join(HOME_DIR, 'memories'), { recursive: true, force: true });
  const asked = [];
  const remember = call('memory', { target: 'user', operations: [{ action: 'add', content: 'Uses pnpm.' }] });
  const ollama = await fakeOllama([[remember, { done: true }], [done('not saved')], [remember, { done: true }], [done('saved')], [done('ok')], [done('Nothing to save.')]]);
  const config = { ...DEFAULTS, host: ollama.host, review: true, memoryReviewEvery: 1 };
  const permissions = new Permissions({ mode: 'ask', cwd, ask: async (q) => (asked.push(q), asked.length === 1 ? 'n' : 'a') });
  const agent = new Agent({ config, ui, permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });

  await agent.runTurn('ingat aku pakai pnpm');
  await agent.reviewing;
  assert.deepEqual(readStore('user', cwd), [], 'declined: nothing is saved');
  assert.match(agent.messages[2].content, /declined/);
  assert.equal(asked[0].always, 'always allow memory this session');
  assert.equal(ollama.requests.length, 2, 'no review ran: memory was not allowed without asking');

  await agent.runTurn('ya, simpan');
  await agent.reviewing;
  assert.deepEqual(readStore('user', cwd), ['Uses pnpm.']);
  assert.equal(asked.length, 2);
  assert.equal(ollama.requests.length, 4, 'a message that saved to memory itself is not reviewed again');
  // "always" was answered, so from here on the review may save too.
  await agent.runTurn('lanjut');
  await agent.reviewing;
  ollama.close();
  assert.equal(ollama.requests.length, 6);
  assert.deepEqual(ollama.requests[5].tools.map((t) => t.function.name).sort(), ['glob', 'grep', 'memory', 'read_file', 'skill'], 'skills were not allowed, so that tool is withheld');

  assert.equal(new Permissions({ mode: 'ask', cwd, ask: null, autoLearn: true }).mayLearn('skill_manage'), true);
  assert.equal((await new Permissions({ mode: 'ask', cwd, ask: null }).check({ name: 'memory', risk: 'learn' }, {})).ok, false, 'a one-shot run cannot be asked, so it does not save');
});

test('several helpers run side by side and each report comes back', async () => {
  const cwd = project();
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'alpha\n');
  fs.writeFileSync(path.join(cwd, 'b.txt'), 'beta\n');
  // The server answers by what it is asked, since the two helpers' requests arrive in any order.
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const request = JSON.parse(body);
      requests.push(request);
      const first = request.messages[1].content;
      const last = request.messages.at(-1);
      let chunks;
      if (first === 'bandingkan dua file') chunks = last.role === 'tool' ? [done('Keduanya berbeda.')] : [call('task', { tasks: [{ description: 'read a', prompt: 'Read a.txt and report its content.' }, { description: 'read b', prompt: 'Read b.txt and report its content.' }] }), { done: true }];
      else if (last.role === 'tool') chunks = [done(`It says: ${last.content.split('\t')[1]}`)];
      else chunks = [call('read_file', { path: first.includes('a.txt') ? 'a.txt' : 'b.txt' }), { done: true }];
      // The first helper is the slower one, to show the order of the reports does not depend on speed.
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.end(chunks.map((c) => JSON.stringify(c)).join('\n'));
      }, first.includes('a.txt') ? 60 : 5);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const agent = makeAgent(`http://127.0.0.1:${server.address().port}`, cwd);
  await agent.runTurn('bandingkan dua file');
  server.close();
  const report = agent.messages.find((m) => m.role === 'tool').content;
  assert.equal(report, '## Helper 1: read a — completed\nIt says: alpha\n\n## Helper 2: read b — completed\nIt says: beta');
  assert.equal(agent.messages.at(-1).content, 'Keduanya berbeda.');
  const helperTools = requests.find((r) => r.messages[1].content.includes('a.txt')).tools.map((t) => t.function.name);
  for (const withheld of ['task', 'ask_user', 'memory', 'skill_manage', 'cronjob_manage']) assert.ok(!helperTools.includes(withheld), withheld);
  assert.equal(agent.helpers.size, 0);

  const tooMany = await TOOL_BY_NAME.get('task').run({ tasks: [1, 2, 3, 4].map((n) => ({ prompt: `job ${n}` })) }, { delegateMany: async () => [] }).catch((e) => e.message);
  assert.match(tooMany, /At most 3 helpers/);
});

test('@ references are expanded only when the caller says the user typed the text', async () => {
  const cwd = project();
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'private line\n');
  const ollama = await fakeOllama([[done('ok')]]);
  await makeAgent(ollama.host, cwd).runTurn('read @file:notes.txt');
  ollama.close();
  assert.equal(ollama.requests[0].messages[1].content, 'read @file:notes.txt');
});

test('a helper never gets a tool its parent was denied', async () => {
  const cwd = project();
  const ollama = await fakeOllama([[call('task', { prompt: 'look around', description: 'look' }), { done: true }], [done('nothing')], [done('ok')]]);
  const agent = makeAgent(ollama.host, cwd);
  agent.withheld = new Set(['bash', 'write_file']);
  await agent.runTurn('go');
  ollama.close();
  const offered = ollama.requests[1].tools.map((t) => t.function.name);
  for (const name of ['bash', 'write_file', 'task', 'memory', 'skill_manage', 'cronjob_manage']) assert.ok(!offered.includes(name), name);
  assert.ok(offered.includes('read_file'));
});
