// Token usage split by provider and model: each reply goes to the model that gave it, Claude Code's
// running per-model totals become per-reply amounts, and what was counted before the split existed
// stays apart as "not attributed" instead of being shared out among the models.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { claudeCodeProvider, spentByModel } from '../src/claude-code.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { readUsage, recordUsage, usageSummary } from '../src/usage.mjs';
import { byModel, modelName, view } from '../remote-server/public/usage.js';

const scratch = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-um-')), 'usage.json');
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('usage by model: each reply is added to its provider and model, on the day and in the total', () => {
  const file = scratch();
  const now = at(2026, 11, 21);
  recordUsage({ input: 1000, cached: 900, written: 50, output: 40 }, { file, now, provider: 'claude-code', model: 'claude-opus-5-5' });
  recordUsage({ input: 300, output: 20 }, { file, now, provider: 'ollama', model: 'qwen3:8b', local: true });
  recordUsage({ input: 200, cached: 100, output: 10 }, { file, now, provider: 'claude-code', model: 'claude-opus-5-5' });
  const { total, days } = readUsage(file);
  assert.deepEqual(total.by, {
    'claude-code': { 'claude-opus-5-5': { input: 1200, cached: 1000, output: 50, replies: 2, written: 50, known: 1200 } },
    ollama: { 'qwen3:8b': { input: 300, cached: 0, output: 20, replies: 1, written: 0, known: 0, local: true } },
  });
  assert.deepEqual(days['2026-11-21'].by, total.by, 'the day holds the same split');
  assert.equal(total.split, 3, 'every reply went into the split');
  assert.equal(total.input, 1500, 'the totals are kept as before');
});

test('usage by model: a reply that used several models counts once for each, and the total is their sum', () => {
  const file = scratch();
  const models = [
    { model: 'claude-opus-5-5', input: 5000, cached: 4000, written: 500, output: 200 },
    { model: 'claude-haiku-5-5', input: 800, cached: 0, written: 0, output: 30 },
  ];
  recordUsage({ input: 5800, cached: 4000, written: 500, output: 230, models }, { file, provider: 'claude-code', model: 'default', models });
  const { total } = readUsage(file);
  assert.deepEqual(Object.keys(total.by['claude-code']).sort(), ['claude-haiku-5-5', 'claude-opus-5-5'], 'the alias the user picked is not a model');
  assert.equal(total.by['claude-code']['claude-haiku-5-5'].replies, 1);
  assert.equal(total.by['claude-code']['claude-opus-5-5'].replies, 1);
  assert.deepEqual([total.replies, total.split], [1, 1], 'still one reply of SEEKER');
});

test('usage by model: without a provider nothing is split, and names cannot reach into the object', () => {
  const file = scratch();
  recordUsage({ input: 10, output: 1 }, { file });
  assert.equal(readUsage(file).total.by, undefined);
  recordUsage({ input: 10, output: 1 }, { file, provider: '__proto__', model: 'x' });
  assert.equal(readUsage(file).total.by, undefined, 'a reserved name is not a provider');
  recordUsage({ input: 10, output: 1 }, { file, provider: 'openai', model: '__proto__' });
  assert.deepEqual(Object.keys(readUsage(file).total.by.openai), [''], 'a reserved model name reads as not recorded');
  assert.equal({}.input, undefined, 'Object.prototype is untouched');
  // A damaged split on disk is dropped, the counts around it are kept.
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.total.by.openai[''] = 'junk';
  raw.total.by.bad = 7;
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(readUsage(file).total.by, undefined);
  assert.equal(readUsage(file).total.input, 30);
});

test('usage by model: Claude Code running totals become what each reply added', () => {
  const first = { 'claude-opus-5-5': { inputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 16_000, outputTokens: 20 } };
  assert.deepEqual(spentByModel(first), [{ model: 'claude-opus-5-5', input: 16_010, cached: 0, written: 16_000, output: 20 }]);
  // A resumed session reports the earlier turns again: only the difference is this reply's.
  const second = {
    'claude-opus-5-5': { inputTokens: 12, cacheReadInputTokens: 11_000, cacheCreationInputTokens: 20_000, outputTokens: 26 },
    'claude-haiku-5-5': { inputTokens: 700, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 9 },
  };
  assert.deepEqual(spentByModel(second, first), [
    { model: 'claude-opus-5-5', input: 15_002, cached: 11_000, written: 4000, output: 6 },
    { model: 'claude-haiku-5-5', input: 700, cached: 0, written: 0, output: 9 },
  ]);
  assert.deepEqual(spentByModel(second, second), [], 'nothing new, nothing counted');
  // A total that went down was reset (a cleared session): what it shows now is all new.
  const cleared = { 'claude-opus-5-5': { inputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 100, outputTokens: 3 } };
  assert.deepEqual(spentByModel(cleared, second), [{ model: 'claude-opus-5-5', input: 105, cached: 0, written: 100, output: 3 }]);
  assert.deepEqual(spentByModel(undefined), []);
});

test('usage by model: the Claude Code provider reports per-model spend across a resumed session', async () => {
  const totals = [
    { 'claude-opus-5-5': { inputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 1000, outputTokens: 50 } },
    {
      'claude-opus-5-5': { inputTokens: 20, cacheReadInputTokens: 900, cacheCreationInputTokens: 1200, outputTokens: 80 },
      'claude-haiku-5-5': { inputTokens: 300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 5 },
    },
  ];
  let call = 0;
  const query = () =>
    (async function* () {
      const modelUsage = totals[call++];
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 's', usage: { input_tokens: 1, output_tokens: 1 }, modelUsage };
    })();
  const def = { id: 'claude-code', label: 'Claude Code', kind: 'claude-code', context: 200000, ownTools: true };
  const provider = claudeCodeProvider(def, { ...DEFAULTS, providers: {} }, { query });
  const last = async (messages) => {
    let done;
    for await (const chunk of provider.chat({ model: 'opus', system: 'S', messages, cwd: os.tmpdir() })) if (chunk.done) done = chunk;
    return done.spent;
  };
  const messages = [{ role: 'user', content: 'one' }];
  const one = await last(messages);
  assert.deepEqual(one, { input: 1010, cached: 0, written: 1000, output: 50, models: [{ model: 'claude-opus-5-5', input: 1010, cached: 0, written: 1000, output: 50 }] });
  messages.push({ role: 'assistant', content: 'ok' }, { role: 'user', content: 'two' });
  const two = await last(messages);
  assert.deepEqual(two.models, [
    { model: 'claude-opus-5-5', input: 1110, cached: 900, written: 200, output: 30 },
    { model: 'claude-haiku-5-5', input: 300, cached: 0, written: 0, output: 5 },
  ]);
  assert.deepEqual([two.input, two.output], [1410, 35], 'the reply is the sum of its models, sub-agents included');
});

test('usage by model: the view splits a range, and keeps counts from before the split apart', () => {
  const file = scratch();
  // Counted before the split existed: in the totals, in no model.
  recordUsage({ input: 7000, cached: 6000, output: 100 }, { file, now: at(2026, 11, 15) });
  recordUsage({ input: 1000, cached: 500, output: 50 }, { file, now: at(2026, 11, 21, 9) });
  // From then on, per model.
  recordUsage({ input: 900, cached: 800, output: 100 }, { file, now: at(2026, 11, 21, 10), provider: 'claude-code', model: 'claude-opus-5-5' });
  recordUsage({ input: 400, output: 100 }, { file, now: at(2026, 11, 21, 11), provider: 'ollama', model: 'qwen3:8b', local: true });
  const usage = usageSummary({ file, now: at(2026, 11, 21, 18) });

  const all = view(usage, { range: 'all', now: at(2026, 11, 21, 18) }).models;
  assert.equal(all.total, 9650);
  assert.deepEqual(all.models.map((m) => [m.provider, m.model, m.counts.total, m.local]), [['claude-code', 'claude-opus-5-5', 1000, false], ['ollama', 'qwen3:8b', 500, true]]);
  assert.deepEqual([all.unattributed.counts.total, all.unattributed.counts.replies, all.unattributed.counts.cachedInput], [8150, 2, 6500]);
  const shares = all.models.reduce((n, m) => n + m.share, all.unattributed.share);
  assert.ok(Math.abs(shares - 1) < 1e-12, 'the parts of the bar add up to the whole');
  assert.equal(all.models[1].counts.cacheRatio, null, 'a provider that does not report its cache gets no share');

  // A range sees only its own days: seen from Nov 25, the last 7 days no longer hold Nov 15.
  const later = usageSummary({ file, now: at(2026, 11, 25, 18) });
  const week = view(later, { range: '7', now: at(2026, 11, 25, 18) }).models;
  assert.deepEqual([week.total, week.unattributed.counts.total, week.models.length], [2550, 1050, 2]);
  const today = byModel([usage.today]);
  assert.deepEqual([today.unattributed.counts.total, today.unattributed.counts.replies], [1050, 1], 'the day the split began keeps its earlier reply apart');
  assert.equal(byModel([]).unattributed, null);
  assert.equal(modelName(''), 'Model not recorded');
});

test('usage by model: a Mac that sends no split shows it all as not attributed', () => {
  const usage = { since: 1, sinceDay: '2026-11-15', today: { day: '2026-11-21', input: 10, output: 5, replies: 1 }, days: [{ day: '2026-11-21', input: 10, output: 5, replies: 1 }], total: { input: 10, output: 5, replies: 1 } };
  const v = view(usage, { range: '7', now: Date.UTC(2026, 10, 21, 12) });
  assert.deepEqual([v.models.models.length, v.models.unattributed.counts.total, v.models.unattributed.share], [0, 15, 1]);
});
