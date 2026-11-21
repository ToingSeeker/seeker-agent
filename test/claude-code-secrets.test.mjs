// With the Claude Code provider, Claude Code's own tools (Read, Bash, Edit, Grep) run without
// SEEKER's tools. A PreToolUse hook refuses SEEKER's key files and turns other secret files into a
// question; a PostToolUse hook takes secret files' lines out of folder searches.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { filterSearch, secretGuard, secretTouched, claudeCodeProvider } from '../src/claude-code.mjs';
import { DEFAULTS, HOME_DIR } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-cc-secrets-'));
const silentUi = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : () => {}) });
const pre = (tool_name, tool_input, cwd) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd });
const decision = (out) => out.hookSpecificOutput?.permissionDecision ?? 'none';

test('claude-code secrets: the files each of Claude Code\'s tools would touch are recognised', () => {
  const cwd = project();
  assert.deepEqual(secretTouched('Read', { file_path: path.join(cwd, '.env') }, cwd)?.kind, 'sensitive');
  assert.equal(secretTouched('Read', { file_path: path.join(HOME_DIR, 'config.json') }, cwd)?.kind, 'seeker');
  assert.equal(secretTouched('Edit', { file_path: path.join(HOME_DIR, 'push.json') }, cwd)?.kind, 'seeker');
  assert.equal(secretTouched('Write', { file_path: '.env.local' }, cwd)?.kind, 'sensitive', 'relative paths resolve against the project');
  assert.equal(secretTouched('Grep', { pattern: 'x', path: '.env' }, cwd)?.kind, 'sensitive');
  assert.equal(secretTouched('Bash', { command: 'cat .env' }, cwd)?.kind, 'sensitive');
  assert.equal(secretTouched('Bash', { command: `head ${path.join(HOME_DIR, 'config.json')}` }, cwd)?.kind, 'seeker');
  assert.equal(secretTouched('Read', { file_path: path.join(cwd, 'app.js') }, cwd), null);
  assert.equal(secretTouched('Read', { file_path: path.join(cwd, '.env.example') }, cwd), null);
  assert.equal(secretTouched('Grep', { pattern: 'x' }, cwd), null, 'a folder search is left to the result filter');
  assert.equal(secretTouched('WebFetch', { url: 'https://example.com' }, cwd), null);
});

test('claude-code secrets: the PreToolUse guard refuses SEEKER key files and asks about other secrets', async () => {
  const cwd = project();
  const guard = secretGuard(cwd);
  const refused = await guard(pre('Read', { file_path: path.join(HOME_DIR, 'config.json') }, cwd));
  assert.equal(decision(refused), 'deny');
  assert.match(refused.hookSpecificOutput.permissionDecisionReason, /SEEKER's own key files/);
  assert.equal(decision(await guard(pre('Bash', { command: `cat ${path.join(HOME_DIR, 'remote.sock.key')}` }, cwd))), 'deny');
  const asked = await guard(pre('Read', { file_path: path.join(cwd, '.env') }, cwd));
  assert.equal(decision(asked), 'ask');
  assert.match(asked.hookSpecificOutput.permissionDecisionReason, /\.env looks like it holds secrets/);
  assert.equal(decision(await guard(pre('Bash', { command: 'cat ~/.ssh/id_ed25519' }, cwd))), 'ask');
  assert.deepEqual(await guard(pre('Read', { file_path: path.join(cwd, 'app.js') }, cwd)), {}, 'ordinary calls are left to Claude Code');
  // A check that breaks does not wave the call through.
  const broken = { get command() { throw new Error('boom'); } };
  assert.equal(decision(await guard(pre('Bash', broken, cwd))), 'ask');
});

test('claude-code secrets: folder searches lose the lines that came from secret files', () => {
  const cwd = project();
  const bash = filterSearch('Bash', { stdout: './.env:2:OPENAI_API_KEY=sk-x\na.txt:1:hello\n.env.example:1:KEY=\nsrc/b.js:4:const key = 1', stderr: '' }, cwd);
  assert.equal(bash.stdout, 'a.txt:1:hello\n.env.example:1:KEY=\nsrc/b.js:4:const key = 1\n(lines from files that hold secrets were left out)');
  // Output that is not a search keeps everything, even a bare file name.
  assert.equal(filterSearch('Bash', { stdout: '.env\na.txt\nError: nothing here', stderr: '' }, cwd), null);
  assert.equal(filterSearch('Bash', { stdout: '', stderr: '' }, cwd), null);

  const grep = filterSearch('Grep', { mode: 'content', numFiles: 0, filenames: [], content: '.env:1:TOKEN=abc\napp.js:3:token' }, cwd);
  assert.equal(grep.content, 'app.js:3:token\n(lines from files that hold secrets were left out)');
  const names = filterSearch('Grep', { mode: 'files_with_matches', numFiles: 2, filenames: [path.join(cwd, '.env'), path.join(cwd, 'app.js')] }, cwd);
  assert.deepEqual(names.filenames, [path.join(cwd, 'app.js')]);
  assert.equal(names.numFiles, 1);
  assert.equal(filterSearch('Grep', { mode: 'files_with_matches', numFiles: 1, filenames: ['app.js'] }, cwd), null);
  assert.equal(filterSearch('Read', { stdout: '.env:1:x' }, cwd), null);
});

test('claude-code secrets: every query is started with both hooks', async () => {
  let options = null;
  const query = ({ prompt, options: given }) =>
    (async function* () {
      options = given;
      await prompt[Symbol.asyncIterator]().next();
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 's', usage: {} };
    })();
  const provider = claudeCodeProvider({ id: 'claude-code', kind: 'claude-code', ownTools: true }, { ...DEFAULTS, providers: {} }, { query });
  const cwd = project();
  for await (const _ of provider.chat({ model: 'default', system: 'S', messages: [{ role: 'user', content: 'hi' }], cwd }));
  assert.equal(options.hooks.PreToolUse.length, 1);
  assert.equal(options.hooks.PreToolUse[0].matcher, undefined, 'the guard sees every tool');
  assert.equal(decision(await options.hooks.PreToolUse[0].hooks[0](pre('Read', { file_path: path.join(HOME_DIR, 'config.json') }, cwd))), 'deny');
  assert.match('Bash', new RegExp(`^(${options.hooks.PostToolUse[0].matcher})$`));
  assert.match('Grep', new RegExp(`^(${options.hooks.PostToolUse[0].matcher})$`));
});

test('claude-code secrets: a Read the guard turned into a question is asked even in --yolo, with no "always"', async () => {
  const cwd = project();
  const questions = [];
  const permissions = new Permissions({ mode: 'auto', cwd, ask: async (q) => (questions.push(q), 'n') });
  const verdicts = [];
  // Stands in for Claude Code: after the guard said "ask", the approval request reaches SEEKER.
  const provider = {
    id: 'claude-code',
    kind: 'claude-code',
    label: 'Claude Code',
    ownTools: true,
    async *chat({ hooks }) {
      verdicts.push(await hooks.permission({ id: 't1', name: 'Read', input: { file_path: path.join(cwd, '.env') } }));
      verdicts.push(await hooks.permission({ id: 't2', name: 'Read', input: { file_path: path.join(cwd, 'app.js') } }));
      yield { message: { content: 'done' }, done: true, prompt_eval_count: 10, eval_count: 2 };
    },
  };
  const config = { ...DEFAULTS, bundledSkills: false };
  const agent = new Agent({ config, ui: silentUi, permissions, provider, info: { tools: true, thinking: false, context: 200000 }, cwd });
  await agent.runTurn('read the env');
  assert.equal(questions.length, 1, 'only the secret file is asked about');
  assert.match(questions[0].warning, /\.env looks like it holds secrets/);
  assert.equal(questions[0].always, null);
  assert.equal(verdicts[0].ok, false);
  assert.equal(verdicts[1].ok, true);
});
