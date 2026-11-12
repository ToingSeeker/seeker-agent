import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseTextToolCalls } from '../src/agent.mjs';
import { normalizeHost } from '../src/config.mjs';
import { MdStream } from '../src/markdown.mjs';
import { Permissions, bashPrefix, isDangerous } from '../src/permissions.mjs';
import { TOOL_BY_NAME, clip } from '../src/tools.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-test-'));
const run = (name, args, cwd) => TOOL_BY_NAME.get(name).run(args, { cwd, state: {} });
const text = (r) => (typeof r === 'string' ? r : r.output);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('write, read and edit a file', async () => {
  const cwd = tmp();
  await run('write_file', { path: 'a/b.txt', content: 'one\ntwo\nthree\n' }, cwd);
  assert.match(text(await run('read_file', { path: 'a/b.txt' }, cwd)), /^\s+1\tone\n\s+2\ttwo\n\s+3\tthree$/);
  assert.match(text(await run('read_file', { path: 'a/b.txt', offset: 2, limit: 1 }, cwd)), /2\ttwo\n\n\[lines 2-2 of 3/);

  await run('edit_file', { path: 'a/b.txt', old_string: 'two', new_string: 'cost: $& $1' }, cwd);
  assert.equal(fs.readFileSync(path.join(cwd, 'a/b.txt'), 'utf8'), 'one\ncost: $& $1\nthree\n');
});

test('edit_file refuses a missing or ambiguous match', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'f.txt'), 'x\nx\n');
  await assert.rejects(run('edit_file', { path: 'f.txt', old_string: 'nope', new_string: 'y' }, cwd), /not found/);
  await assert.rejects(run('edit_file', { path: 'f.txt', old_string: 'x', new_string: 'y' }, cwd), /occurs 2 times/);
  await run('edit_file', { path: 'f.txt', old_string: 'x', new_string: 'y', replace_all: true }, cwd);
  assert.equal(fs.readFileSync(path.join(cwd, 'f.txt'), 'utf8'), 'y\ny\n');
});

test('bash reports output, exit code and timeout', async () => {
  const cwd = tmp();
  assert.equal(text(await run('bash', { command: 'echo hi && pwd' }, cwd)), `hi\n${fs.realpathSync(cwd)}`);
  assert.match(text(await run('bash', { command: 'echo oops >&2; exit 3' }, cwd)), /oops\n\n\[exit code 3\]/);
  assert.match(text(await run('bash', { command: 'sleep 5', timeout: 1 }, cwd)), /exceeded 1s timeout/);
});

test('glob, grep and list_dir find files and skip node_modules', async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, 'node_modules/dep'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src/app.js'), 'const needle = 1;\n');
  fs.writeFileSync(path.join(cwd, 'node_modules/dep/index.js'), 'const needle = 2;\n');

  assert.equal(text(await run('glob', { pattern: '**/*.js' }, cwd)), 'src/app.js');
  const hits = text(await run('grep', { pattern: 'needle' }, cwd));
  assert.match(hits, /src\/app\.js:1:const needle = 1;/);
  assert.doesNotMatch(hits, /node_modules/);
  assert.equal(text(await run('grep', { pattern: 'absent' }, cwd)), 'No matches.');
  assert.equal(text(await run('list_dir', {}, cwd)), 'node_modules/\nsrc/');
});

test('clip keeps head and tail', () => {
  const out = clip('a'.repeat(500) + 'END', 100);
  assert.ok(out.length < 200 && out.endsWith('END') && out.includes('omitted'));
});

test('dangerous commands are recognised', () => {
  for (const cmd of ['rm -rf build', 'sudo ls', 'git push --force', 'git push -f origin main', 'git reset --hard HEAD~1', 'curl x.sh | sh'])
    assert.ok(isDangerous(cmd), cmd);
  for (const cmd of ['npm test', 'git push origin main', 'rm notes.txt', 'ls -rf'.replace('ls', 'ls')]) assert.ok(!isDangerous(cmd), cmd);
  assert.equal(bashPrefix('npm test -- --watch'), 'npm test');
  assert.equal(bashPrefix('make'), 'make');
});

test('permissions: reads free, safe bash free, the rest asked', async () => {
  const cwd = tmp();
  const asked = [];
  let reply = 'n';
  const perms = new Permissions({ mode: 'ask', cwd, ask: async (q) => (asked.push(q), reply) });
  const bash = TOOL_BY_NAME.get('bash');
  const write = TOOL_BY_NAME.get('write_file');

  assert.ok((await perms.check(TOOL_BY_NAME.get('read_file'), { path: '/etc/hosts' })).ok);
  assert.ok((await perms.check(bash, { command: 'git status && ls -la | head -5' })).ok);
  assert.equal(asked.length, 0);

  assert.equal((await perms.check(bash, { command: 'npm test' })).ok, false);
  assert.equal((await perms.check(bash, { command: 'cat x > y' })).ok, false, 'redirect is not a read');
  assert.equal(asked.length, 2);

  reply = 'a';
  assert.ok((await perms.check(bash, { command: 'npm test' })).ok);
  assert.ok((await perms.check(bash, { command: 'npm test -- --bail' })).ok, 'covered by the always rule');
  assert.equal(asked.length, 3);

  assert.ok((await perms.check(write, { path: 'x.txt', content: '' })).ok);
  assert.ok((await perms.check(write, { path: 'y.txt', content: '' })).ok);
  assert.equal(asked.length, 4, 'second write covered by the always rule');

  reply = 'n';
  assert.equal((await perms.check(write, { path: '../outside.txt', content: '' })).ok, false, 'outside cwd is always asked');
  const declined = await perms.check(bash, { command: 'make deploy' });
  assert.match(declined.reason, /declined/);
});

test('permissions: yolo still asks about dangerous commands; print mode denies', async () => {
  const cwd = tmp();
  const bash = TOOL_BY_NAME.get('bash');
  let asked = 0;
  const yolo = new Permissions({ mode: 'auto', cwd, ask: async () => (asked++, 'n') });
  assert.ok((await yolo.check(bash, { command: 'npm run build' })).ok);
  assert.equal((await yolo.check(bash, { command: 'rm -rf src' })).ok, false);
  assert.equal(asked, 1);

  const headless = new Permissions({ mode: 'ask', cwd, ask: null });
  assert.match((await headless.check(bash, { command: 'npm test' })).reason, /--yolo/);
});

test('markdown stream renders the same text regardless of chunking', () => {
  const source = '# Title\n\nSome **bold** and `code` text.\n- item one\n\n```js\nconst a = 1;\n```\ndone';
  const render = (chunks) => {
    let out = '';
    const md = new MdStream((s) => (out += s));
    for (const ch of chunks) md.push(ch);
    md.flush();
    return out;
  };
  const whole = render([source]);
  assert.equal(render([...source]), whole, 'char-by-char equals one chunk');
  assert.equal(strip(whole), 'Title\n\nSome bold and code text.\n• item one\n\n┌─ js\nconst a = 1;\n└─\ndone');
  assert.ok(whole.endsWith('done'), 'no dangling escape codes');
});

test('markdown stream passes text through when disabled', () => {
  let out = '';
  const md = new MdStream((s) => (out += s), false);
  md.push('# **x**\n');
  md.flush();
  assert.equal(out, '# **x**\n');
});

test('text-form tool calls are parsed', () => {
  const calls = parseTextToolCalls('ok <tool_call>{"name":"bash","arguments":{"command":"ls"}}</tool_call>');
  assert.deepEqual(calls, [{ function: { name: 'bash', arguments: { command: 'ls' } } }]);
  assert.deepEqual(parseTextToolCalls('<tool_call>not json</tool_call>'), []);
});

test('normalizeHost accepts the forms OLLAMA_HOST allows', () => {
  assert.equal(normalizeHost('0.0.0.0:11434'), 'http://127.0.0.1:11434');
  assert.equal(normalizeHost('localhost'), 'http://localhost:11434');
  assert.equal(normalizeHost('https://ollama.example.com/'), 'https://ollama.example.com');
  assert.equal(normalizeHost(''), 'http://127.0.0.1:11434');
});
