import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// The module reads SEEKER_HOME when it is first imported.
process.env.SEEKER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-home-'));
const { diff, list, restore, shadowDir, snapshot, unsuitable } = await import('../src/checkpoints.mjs');

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-cp-'));
const write = (dir, name, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
};
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('a snapshot is taken outside the project and restores edited, deleted and created files', async () => {
  const cwd = project();
  write(cwd, 'a.txt', 'one\n');
  write(cwd, 'src/b.txt', 'two\n');
  const first = await snapshot(cwd, 'before edit_file a.txt');
  assert.match(first, /^[0-9a-f]{40}$/);
  assert.equal(fs.existsSync(path.join(cwd, '.git')), false, 'nothing is written into the project');
  assert.ok(shadowDir(cwd).startsWith(process.env.SEEKER_HOME));

  write(cwd, 'a.txt', 'changed\n');
  fs.rmSync(path.join(cwd, 'src/b.txt'));
  write(cwd, 'new.txt', 'made later\n');

  const result = await restore(cwd, first);
  assert.equal(result.ok, true);
  assert.equal(read(cwd, 'a.txt'), 'one\n');
  assert.equal(read(cwd, 'src/b.txt'), 'two\n');
  assert.equal(fs.existsSync(path.join(cwd, 'new.txt')), false, 'a file created after the snapshot is removed');
  assert.deepEqual(result.removed, ['new.txt']);

  // The rollback itself can be undone.
  const undo = await restore(cwd, result.saved);
  assert.equal(undo.ok, true);
  assert.equal(read(cwd, 'a.txt'), 'changed\n');
  assert.equal(read(cwd, 'new.txt'), 'made later\n');
  assert.equal(fs.existsSync(path.join(cwd, 'src/b.txt')), false);
});

test('an unchanged folder is not snapshotted twice, and the list is newest first', async () => {
  const cwd = project();
  write(cwd, 'a.txt', '1\n');
  const first = await snapshot(cwd, 'first');
  assert.equal(await snapshot(cwd, 'again'), first);
  write(cwd, 'a.txt', '2\n');
  const second = await snapshot(cwd, 'second');
  assert.notEqual(second, first);
  const all = await list(cwd);
  assert.deepEqual(all.map((s) => s.reason), ['second', 'first']);
  assert.equal(all[0].id, second);
  assert.ok(all[0].when instanceof Date && !Number.isNaN(all[0].when.getTime()));
});

test('one file can be restored on its own, and a diff shows what changed since', async () => {
  const cwd = project();
  write(cwd, 'a.txt', 'a1\n');
  write(cwd, 'b.txt', 'b1\n');
  const id = await snapshot(cwd, 'start');
  write(cwd, 'a.txt', 'a2\n');
  write(cwd, 'b.txt', 'b2\n');

  const changes = await diff(cwd, id);
  assert.match(changes.stat, /a\.txt/);
  assert.match(changes.text, /\+a2/);

  assert.equal((await restore(cwd, id, 'a.txt')).ok, true);
  assert.equal(read(cwd, 'a.txt'), 'a1\n');
  assert.equal(read(cwd, 'b.txt'), 'b2\n', 'the other file is left alone');

  assert.equal((await restore(cwd, id, '../outside.txt')).ok, false);
  assert.equal((await restore(cwd, 'deadbeef')).ok, false);
});

test('secrets and dependency folders stay out of a snapshot; home and root are refused', async () => {
  const cwd = project();
  write(cwd, 'app.js', 'x\n');
  write(cwd, '.env', 'TOKEN=secret\n');
  write(cwd, 'node_modules/pkg/index.js', 'y\n');
  const id = await snapshot(cwd, 'start');
  fs.rmSync(path.join(cwd, '.env'));
  fs.rmSync(path.join(cwd, 'node_modules'), { recursive: true });
  await restore(cwd, id);
  assert.equal(fs.existsSync(path.join(cwd, '.env')), false, '.env was never recorded');
  assert.equal(fs.existsSync(path.join(cwd, 'node_modules')), false);

  assert.ok(unsuitable(os.homedir()));
  assert.ok(unsuitable('/'));
  assert.equal(await snapshot('/', 'x'), null);
});

test('destructive shell commands are recognised; read-only ones are not', async () => {
  const { isDestructiveCommand } = await import('../src/checkpoints.mjs');
  for (const cmd of ['rm -rf build', 'mv a b', 'sed -i s/a/b/ f', 'echo x > f.txt', 'npm test && git checkout .', 'git reset --hard']) assert.equal(isDestructiveCommand(cmd), true, cmd);
  for (const cmd of ['ls -la', 'npm test 2>&1', 'cat f >> log.txt', 'grep -rn foo . 2>/dev/null', 'git status']) assert.equal(isDestructiveCommand(cmd), false, cmd);
});
