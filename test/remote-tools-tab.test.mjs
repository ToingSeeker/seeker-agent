// The phone's Tools tab: which kind a tool step is, which filters are offered, and which steps each leaves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { filterLabel, filterTools, toolFilters } from '../remote-server/public/tools.js';

const step = (doing, state = 'done') => ({ kind: 'tool', doing, state });
const STEPS = [step('Reading'), step('Editing'), step('Running'), step('Running', 'failed'), step('Writing'), step('Searching for'), step('Running', 'running'), step('Fetching')];

test('each filter leaves the steps of its kind, in order', () => {
  assert.equal(filterTools(STEPS, 'all').length, STEPS.length);
  assert.deepEqual(filterTools(STEPS, 'edits').map((t) => t.doing), ['Editing', 'Writing']);
  assert.deepEqual(filterTools(STEPS, 'commands').map((t) => t.state), ['done', 'failed', 'running']);
  assert.deepEqual(filterTools(STEPS, 'reads').map((t) => t.doing), ['Reading', 'Searching for']);
  assert.deepEqual(filterTools(STEPS, 'failed'), [STEPS[3]]);
  assert.equal(filterTools(STEPS, 'nonsense').length, STEPS.length, 'an unknown filter leaves them all');
  assert.equal(filterLabel('nonsense'), 'All');
});

test('a filter that holds nothing is not offered, unless it is the one chosen', () => {
  const clean = STEPS.filter((t) => t.state !== 'failed');
  assert.deepEqual(toolFilters(clean).map((f) => f.id), ['all', 'edits', 'commands', 'reads']);
  // Chosen while there was a failure: it stays, with nothing in it, so it can be switched back.
  const kept = toolFilters(clean, 'failed');
  assert.deepEqual(kept.map((f) => [f.id, f.count, f.active]).find((f) => f[0] === 'failed'), ['failed', 0, true]);
  assert.deepEqual(toolFilters([]).map((f) => [f.id, f.count]), [['all', 0]]);
  assert.deepEqual(toolFilters(STEPS).map((f) => [f.id, f.count]), [['all', 8], ['failed', 1], ['edits', 2], ['commands', 3], ['reads', 2]]);
});

test('the verbs the filters know are the verbs the tools are announced with', () => {
  // Both engines must keep using these words, or a step drops out of its filter without a sound.
  const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const announced = new Set([...`${read('tools.mjs')}\n${read('external-tools.mjs')}`.matchAll(/verbs: \['([^']+)'/g)].map((m) => m[1]));
  for (const doing of ['Editing', 'Writing', 'Running', 'Reading', 'Finding', 'Searching for']) assert.ok(announced.has(doing), `${doing} is still announced`);
});
