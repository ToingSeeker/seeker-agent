// What the tokens would cost at list price: each kind of token at its own rate, only models with a
// published Anthropic price, and nothing guessed for the rest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { approx, costOf, costOfSets, dollars, priceOf, view } from '../remote-server/public/usage.js';
import { recordUsage, usageSummary } from '../src/usage.mjs';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const scratch = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-uc-')), 'usage.json');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('usage cost: new input, cache writes, cache reads and output are each priced at their own rate', () => {
  // Opus 5.5: $4 input, $5 5-minute write, $0.20 read, $20 output per million.
  const counts = { input: 10_000_000, cached: 8_000_000, written: 1_000_000, output: 500_000, known: 10_000_000 };
  near(costOf('claude-code', 'claude-opus-5-5', counts), 1 * 4 + 1 * 5 + 8 * 0.2 + 0.5 * 20);
  // Sonnet 5.5 reads its cache at $0.10, not the usual tenth of input.
  near(costOf('anthropic', 'claude-sonnet-5-5', { input: 1_000_000, cached: 1_000_000, known: 1_000_000 }), 0.1);
});

test('usage cost: only Anthropic-billed providers are priced, and a model with no price is not guessed', () => {
  assert.deepEqual(priceOf('claude-code', 'claude-opus-5-5[1m]'), priceOf('claude-code', 'claude-opus-5-5'), 'a context suffix names the same model');
  assert.deepEqual(priceOf('anthropic', 'claude-haiku-4-5-20251001'), priceOf('anthropic', 'claude-haiku-4-5'), 'and so does a date');
  assert.equal(priceOf('openrouter', 'claude-opus-5-5'), null, 'another provider sets its own price');
  assert.equal(priceOf('claude-code', 'default'), null);
  assert.equal(priceOf('claude-code', ''), null, 'a model that was not recorded has no price');
  assert.equal(costOf('deepseek', 'deepseek-chat', { input: 1000, output: 10 }), null);
  assert.equal(costOf('ollama', 'qwen3:8b', { input: 1000, output: 10 }, true), 0, 'a local model costs nothing');
});

test('usage cost: a set sums its priced models and says how many tokens it left out', () => {
  const set = {
    input: 3_000_000,
    output: 0,
    replies: 3,
    split: 2,
    by: {
      'claude-code': { 'claude-opus-5-5': { input: 1_000_000, output: 0 } },
      deepseek: { 'deepseek-chat': { input: 1_000_000, output: 0 } },
    },
  };
  const cost = costOfSets([set]);
  near(cost.usd, 4);
  assert.equal(cost.unpriced, 2_000_000, 'deepseek plus the million counted before the split');
  assert.deepEqual(costOfSets([{ input: 5, output: 5 }]), { usd: null, charged: 0, unpriced: 10 }, 'nothing priced is not $0');
});

test('usage cost: the view prices the lifetime, the range and each day from the same ledger', () => {
  const file = scratch();
  recordUsage({ input: 2_000_000, cached: 1_000_000, output: 100_000 }, { file, now: at(2026, 11, 19), provider: 'claude-code', model: 'claude-opus-5-5' });
  recordUsage({ input: 1_000_000, cached: 0, output: 0 }, { file, now: at(2026, 11, 21), provider: 'claude-code', model: 'claude-haiku-5-5' });
  const v = view(usageSummary({ file, now: at(2026, 11, 21, 18) }), { range: '7', now: at(2026, 11, 21, 18) });
  const opus = 1 * 4 + 1 * 0.2 + 0.1 * 20;
  const haiku = 1 * 0.1;
  near(v.days.find((d) => d.day === '2026-11-19').cost.usd, opus);
  near(v.days.find((d) => d.day === '2026-11-21').cost.usd, haiku);
  near(v.period.cost.usd, opus + haiku);
  near(v.lifetimeCost.usd, opus + haiku);
  assert.equal(v.days.find((d) => d.day === '2026-11-20').cost.usd, 0, 'a tracked day without use cost nothing');
  assert.equal(v.days.find((d) => d.day === '2026-11-15').cost, null, 'a day before counting began has no cost, not $0');
  near(v.models.models.find((m) => m.model === 'claude-opus-5-5').usd, opus);
});

test('usage cost: amounts read plainly', () => {
  assert.deepEqual([null, 0, 0.004, 0.42, 12.345, 1234.4].map(dollars), ['—', '$0.00', '<$0.01', '$0.42', '$12.35', '$1,234']);
  assert.deepEqual([12.345, 0.004].map(approx), ['≈ $12.35', '<$0.01'], 'a sliver is not marked approximate twice');
});
