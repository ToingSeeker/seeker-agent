import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { expandReferences, isSensitivePath, parseReferences } from '../src/references.mjs';

const project = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-ref-')));

test('references are recognised; e-mail addresses and scoped packages are not', () => {
  const refs = parseReferences('lihat @file:src/a.js:10-20, lalu (@folder:src) dan @diff. a@b.com npm i @scope/pkg @file:"my file.txt":3 @url:https://x.dev/a?b=1. @git:3 @staged');
  assert.deepEqual(
    refs.map((r) => [r.kind, r.value, r.start ?? null, r.end ?? null]),
    [
      ['file', 'src/a.js', 10, 20],
      ['folder', 'src', null, null],
      ['diff', '', null, null],
      ['file', 'my file.txt', 3, 3],
      ['url', 'https://x.dev/a?b=1', null, null],
      ['git', '3', null, null],
      ['staged', '', null, null],
    ],
  );
  assert.equal(refs[0].raw, '@file:src/a.js:10-20', 'the comma after it is not part of the reference');
});

test('a file, a line range and a folder are attached under the message', async () => {
  const cwd = project();
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.writeFileSync(path.join(cwd, 'src/a.js'), 'one\ntwo\nthree\nfour\n');
  const out = await expandReferences('jelaskan @file:src/a.js:2-3 dan @folder:src', { cwd, contextLimit: 32_768 });
  assert.deepEqual(out.attached, ['@file:src/a.js:2-3', '@folder:src']);
  assert.ok(out.text.startsWith('jelaskan @file:src/a.js:2-3 dan @folder:src\n\n--- Attached ---'));
  assert.match(out.text, /```js\ntwo\nthree\n```/);
  assert.doesNotMatch(out.text, /one|four/);
  assert.match(out.text, /📁 @folder:src[^\n]*\na\.js/);
});

test('paths outside the folder and credential files are refused with a warning', async () => {
  const cwd = project();
  fs.writeFileSync(path.join(cwd, '.env'), 'TOKEN=abc\n');
  fs.symlinkSync(os.tmpdir(), path.join(cwd, 'escape'));
  const out = await expandReferences('@file:../x.txt @file:.env @file:/etc/hosts @folder:escape @file:nope.txt', { cwd, contextLimit: 32_768 });
  assert.deepEqual(out.attached, []);
  assert.equal(out.warnings.length, 5);
  assert.match(out.text, /--- Notes on the attachments ---/);
  assert.doesNotMatch(out.text, /TOKEN=abc/);
  assert.match(out.warnings[0], /outside the working folder/);
  assert.match(out.warnings[1], /credentials/);
  assert.match(out.warnings[3], /outside the working folder/);
  assert.ok(isSensitivePath(path.join(os.homedir(), '.ssh/id_ed25519')));
  assert.equal(isSensitivePath(path.join(cwd, '.env.example')), false);
});

test('a file too large for the context becomes a pointer, and too much in total is refused', async () => {
  const cwd = project();
  fs.writeFileSync(path.join(cwd, 'big.txt'), 'x'.repeat(40_000));
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'a'.repeat(9_000));
  fs.writeFileSync(path.join(cwd, 'b.txt'), 'b'.repeat(9_000));
  const stub = await expandReferences('@file:big.txt', { cwd, contextLimit: 8_000 });
  assert.match(stub.text, /too large to inline safely/);
  assert.doesNotMatch(stub.text, /xxxxxxxx/);

  const refused = await expandReferences('@file:a.txt @file:b.txt', { cwd, contextLimit: 8_000 });
  assert.equal(refused.text, '@file:a.txt @file:b.txt');
  assert.match(refused.warnings.at(-1), /refused: .* exceeds the 50% hard limit/);

  const soft = await expandReferences('@file:a.txt', { cwd, contextLimit: 8_000 });
  assert.match(soft.warnings[0], /25% soft limit/);
  assert.match(soft.text, /aaaa/);
});

test('@diff, @staged and @git read from git; @url goes through the given fetcher', async () => {
  const cwd = project();
  const git = (...args) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'v1\n');
  git('add', '.');
  git('commit', '-qm', 'first commit');
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'v2\n');
  const out = await expandReferences('@diff @git:1 @url:https://example.test/doc', {
    cwd,
    contextLimit: 32_768,
    fetchPage: async (url) => ({ status: 200, url, text: 'page text' }),
  });
  assert.match(out.text, /🧾 git diff[^\n]*\n```diff\n[\s\S]*\+v2/);
  assert.match(out.text, /first commit/);
  assert.match(out.text, /🌐 @url:https:\/\/example\.test\/doc[^\n]*\npage text/);
});
