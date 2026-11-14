// The token ledger: counted per day on this machine, and nowhere a clone of the code could carry it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spentOf } from '../src/claude-code.mjs';
import { HOME_DIR } from '../src/config.mjs';
import { USAGE_FILE, dayOf, readUsage, recordUsage, usageSummary } from '../src/usage.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scratch = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-usage-')), 'usage.json');
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('usage: every reply is added to its day and to the running total', () => {
  const file = scratch();
  assert.deepEqual(readUsage(file), { since: null, total: { input: 0, cached: 0, output: 0, replies: 0 }, days: {} }, 'nothing counted yet');
  assert.equal(recordUsage({ input: 1000, cached: 800, output: 50 }, { file, now: at(2026, 11, 14, 23) }), true);
  recordUsage({ input: 200, output: 20 }, { file, now: at(2026, 11, 15, 0) });
  recordUsage({ input: 300.4, output: 30 }, { file, now: at(2026, 11, 15, 9) });
  const ledger = readUsage(file);
  assert.equal(ledger.since, at(2026, 11, 14, 23), 'counting began with the first reply');
  assert.deepEqual(ledger.days, { '2026-11-14': { input: 1000, cached: 800, output: 50, replies: 1 }, '2026-11-15': { input: 500, cached: 0, output: 50, replies: 2 } });
  assert.deepEqual(ledger.total, { input: 1500, cached: 800, output: 100, replies: 3 });
  assert.equal(dayOf(at(2026, 1, 5, 0)), '2026-01-05', 'the day is the local calendar day');
});

test('usage: a reply with no count, or a ledger that cannot be written, changes nothing and breaks nothing', () => {
  const file = scratch();
  assert.equal(recordUsage({}, { file }), false);
  assert.equal(recordUsage({ input: -5, output: NaN }, { file }), false);
  assert.equal(fs.existsSync(file), false, 'no file for nothing');
  recordUsage({ input: 10, cached: 99, output: 1 }, { file });
  assert.equal(readUsage(file).total.cached, 10, 'the cached part cannot exceed what was sent');
  fs.writeFileSync(file, 'not json');
  assert.equal(readUsage(file).total.input, 0, 'a damaged file reads as empty');
  assert.equal(recordUsage({ input: 1, output: 1 }, { file }), true, 'and is replaced by a good one');
  const blocked = path.join(path.dirname(file), 'a-file');
  fs.writeFileSync(blocked, '');
  assert.equal(recordUsage({ input: 1, output: 1 }, { file: path.join(blocked, 'usage.json') }), false, 'counting never throws into a turn');
});

test('usage: the summary is today, the last seven days and the total', () => {
  const file = scratch();
  recordUsage({ input: 100, output: 10 }, { file, now: at(2026, 10, 1) });
  recordUsage({ input: 40, output: 4 }, { file, now: at(2026, 11, 13) });
  recordUsage({ input: 7, output: 3 }, { file, now: at(2026, 11, 15) });
  const summary = usageSummary({ file, now: at(2026, 11, 15, 18) });
  assert.deepEqual(summary.today, { day: '2026-11-15', input: 7, cached: 0, output: 3, replies: 1 });
  assert.deepEqual(summary.week.map((d) => [d.day, d.input + d.output]), [['2026-11-15', 10], ['2026-11-14', 0], ['2026-11-13', 44], ['2026-11-12', 0], ['2026-11-11', 0], ['2026-11-10', 0], ['2026-11-09', 0]]);
  assert.deepEqual(summary.total, { input: 147, cached: 0, output: 17, replies: 3 }, 'the total keeps what the week no longer shows');
  assert.equal(summary.since, at(2026, 10, 1));
  // A new day starts at zero without anything being written.
  assert.equal(usageSummary({ file, now: at(2026, 11, 16, 1) }).today.input, 0);
  // Only numbers leave the ledger.
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /[a-zA-Z]{12,}/, 'no prompt, path or project name is stored');
});

test('usage: Claude Code turns are counted with their cache reads named', () => {
  assert.deepEqual(spentOf({ input_tokens: 12, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500, output_tokens: 340 }), { input: 9512, cached: 9000, output: 340 });
  assert.deepEqual(spentOf(), { input: 0, cached: 0, output: 0 });
});

test('usage: the ledger is kept outside the code, where a clone cannot carry it', () => {
  assert.equal(USAGE_FILE, path.join(HOME_DIR, 'usage.json'), 'in the settings folder');
  assert.ok(!USAGE_FILE.startsWith(REPO + path.sep), 'not inside the repository');
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n');
  assert.deepEqual(tracked.filter((f) => /(^|\/)usage\.json$/.test(f)), [], 'no ledger is tracked');
  assert.equal(execFileSync('git', ['check-ignore', 'usage.json'], { cwd: REPO, encoding: 'utf8' }).trim(), 'usage.json', 'and one dropped here by mistake would be ignored');
});
