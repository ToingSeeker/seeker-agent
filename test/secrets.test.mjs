// Files that hold secrets: SEEKER's own are refused in every mode, other credentials are asked about
// even in --yolo mode, a folder search leaves their lines out, and logs mask key-shaped text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HOME_DIR, secureHomeDir } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { redactSecrets, secretInCommand, secretKind } from '../src/secrets.mjs';
import { Session } from '../src/session.mjs';
import { TOOLS } from '../src/tools.mjs';

const tool = (name) => TOOLS.find((t) => t.name === name);
const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-secrets-'));
const FAKE_KEY = 'sk-FAKE0000000000000000000000000000';

/** A permission check whose asker records the question and answers `answer`. */
function checker(mode, cwd, answer = 'y') {
  const asked = [];
  const permissions = new Permissions({ mode, cwd, ask: async (q) => (asked.push(q), answer) });
  return { permissions, asked };
}

test('secrets: SEEKER key files, credentials and ordinary files are told apart', () => {
  const cwd = project();
  assert.equal(secretKind(path.join(HOME_DIR, 'config.json')), 'seeker');
  assert.equal(secretKind(path.join(HOME_DIR, 'remote.sock.key')), 'seeker');
  assert.equal(secretKind(path.join(HOME_DIR, 'push.json')), 'seeker');
  for (const name of ['.env', '.env.local', '.env.production', 'server.pem', 'tls.key', 'id_rsa', 'id_ed25519', '.netrc', '.git-credentials']) {
    assert.equal(secretKind(path.join(cwd, name)), 'sensitive', name);
  }
  assert.equal(secretKind(path.join(os.homedir(), '.ssh', 'config')), 'sensitive');
  assert.equal(secretKind(path.join(os.homedir(), '.aws', 'credentials')), 'sensitive');
  assert.equal(secretKind(path.join(os.homedir(), '.npmrc')), 'sensitive');
  for (const name of ['.env.example', '.env.sample', 'id_rsa.pub', 'config.json', '.npmrc', 'app.js', 'keys.md']) {
    assert.equal(secretKind(path.join(cwd, name)), null, name);
  }
});

test('secrets: SEEKER key files are refused in every mode, for reading, writing and shell commands', async () => {
  const cwd = project();
  const config = path.join(HOME_DIR, 'config.json');
  for (const mode of ['ask', 'auto']) {
    const { permissions, asked } = checker(mode, cwd);
    for (const [t, args] of [
      [tool('read_file'), { path: config }],
      [tool('grep'), { pattern: 'apiKey', path: config }],
      [tool('write_file'), { path: config, content: '{}' }],
      [tool('edit_file'), { path: config, old_string: 'a', new_string: 'b' }],
      [tool('bash'), { command: `cat ${config}` }],
      [tool('bash'), { command: `cd ${HOME_DIR} && cat config.json` }],
      [tool('bash'), { command: `head ${path.join(HOME_DIR, '*.json')}` }],
    ]) {
      const verdict = await permissions.check(t, args);
      assert.equal(verdict.ok, false, `${mode}: ${t.name} ${JSON.stringify(args)}`);
      assert.match(verdict.reason, /SEEKER's own key files/);
    }
    assert.equal(asked.length, 0, 'refused without asking');
  }
});

test('secrets: reading a credential file is asked about even in --yolo mode, ordinary files are not', async () => {
  const cwd = project();
  fs.writeFileSync(path.join(cwd, '.env'), `OPENAI_API_KEY=${FAKE_KEY}\n`);
  fs.writeFileSync(path.join(cwd, 'app.js'), 'export const x = 1;\n');

  const { permissions, asked } = checker('auto', cwd, 'n');
  assert.deepEqual(await permissions.check(tool('read_file'), { path: 'app.js' }), { ok: true });
  assert.deepEqual(await permissions.check(tool('bash'), { command: 'cat app.js' }), { ok: true });
  assert.equal(asked.length, 0);

  for (const [t, args] of [
    [tool('read_file'), { path: '.env' }],
    [tool('grep'), { pattern: 'KEY', path: '.env' }],
    [tool('bash'), { command: 'cat .env' }],
    [tool('bash'), { command: 'cat .env*' }],
    [tool('bash'), { command: 'cat ~/.ssh/id_ed25519' }],
    [tool('bash'), { command: 'tail $HOME/.aws/credentials' }],
  ]) {
    const verdict = await permissions.check(t, args);
    assert.equal(verdict.ok, false, `${t.name} ${JSON.stringify(args)} was declined`);
  }
  assert.equal(asked.length, 6, 'each one was asked about');
  for (const q of asked) {
    assert.match(q.warning, /holds secrets/);
    assert.equal(q.always, null, 'no "always" answer for a secret');
  }

  // Said yes to, it is read.
  const yes = checker('auto', cwd, 'y');
  assert.deepEqual(await yes.permissions.check(tool('read_file'), { path: '.env' }), { ok: true });
});

test('secrets: with nobody to ask, a credential file is refused; plan mode asks instead of running cat .env', async () => {
  const cwd = project();
  const alone = new Permissions({ mode: 'auto', cwd, ask: null });
  const verdict = await alone.check(tool('read_file'), { path: '.env' });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /holds secrets/);
  assert.deepEqual(await alone.check(tool('read_file'), { path: 'README.md' }), { ok: true });

  const { permissions, asked } = checker('ask', cwd, 'n');
  permissions.planning = true;
  assert.equal((await permissions.check(tool('bash'), { command: 'cat .env' })).ok, false);
  assert.equal(asked.length, 1);
  assert.deepEqual(await permissions.check(tool('bash'), { command: 'ls' }), { ok: true });
});

test('secrets: a folder search leaves out the lines of files that hold secrets', async () => {
  const cwd = project();
  fs.writeFileSync(path.join(cwd, '.env'), `API_KEY=${FAKE_KEY}\n`);
  fs.writeFileSync(path.join(cwd, 'deploy.pem'), 'API_KEY in a pem\n');
  fs.writeFileSync(path.join(cwd, 'app.js'), 'const API_KEY = process.env.API_KEY;\n');
  const result = await tool('grep').run({ pattern: 'API_KEY', path: '.' }, { cwd, signal: undefined });
  assert.match(result.output, /app\.js/);
  assert.doesNotMatch(result.output, /sk-FAKE|deploy\.pem:|\.env:/);
  assert.match(result.output, /left out/);
});

test('secrets: commands that only mention ordinary files find nothing', () => {
  const cwd = project();
  for (const command of ['npm test', 'cat package.json', 'git status', 'echo .envrc-like', 'ls src/*.mjs', 'node --env-file=.env.example app.js']) {
    assert.equal(secretInCommand(command, cwd), null, command);
  }
});

test('secrets: key-shaped text is masked in log lines, the rest is kept', () => {
  const line = `orfy ← deploy with OPENAI_API_KEY=${FAKE_KEY} and ghp_${'a'.repeat(36)} AKIAABCDEFGHIJKLMNOP`;
  const out = redactSecrets(line);
  assert.doesNotMatch(out, /FAKE0000|aaaaaaaaaaaaaaaa|ABCDEFGHIJKLMNOP/);
  assert.match(out, /^orfy ← deploy with OPENAI_API_KEY=/);
  assert.equal(redactSecrets('npm test passed in 3s'), 'npm test passed in 3s');
  assert.equal(redactSecrets('password: short'), 'password: short');
});

test('secrets: SEEKER\'s folder and saved conversations are private to the owner', () => {
  fs.chmodSync(HOME_DIR, 0o755);
  secureHomeDir();
  assert.equal(fs.statSync(HOME_DIR).mode & 0o777, 0o700);

  const session = new Session(project());
  session.save([{ role: 'user', content: `my key is ${FAKE_KEY}` }], 'test');
  assert.equal(fs.statSync(session.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(session.file)).mode & 0o077, 0);
});
