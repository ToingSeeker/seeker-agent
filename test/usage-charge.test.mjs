// What providers that bill per token charged: the cache reads they report, the cost OpenRouter states,
// DeepSeek's price at the hour of the reply, kept in the ledger reply by reply and never guessed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { chargeOf, chargedPart, costOfSets, costParts, deepseekPeak } from '../remote-server/public/usage.js';
import { openAISpent } from '../src/providers.mjs';
import { readUsage, recordUsage } from '../src/usage.mjs';

const scratch = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-ch-')), 'usage.json');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const MONDAY = (h) => Date.UTC(2026, 10, 23, h); // 2026-11-23 is a Monday
const SATURDAY = (h) => Date.UTC(2026, 10, 21, h);

test('usage charge: an OpenAI-style usage block names its cache reads, and only OpenRouter states a cost', () => {
  assert.deepEqual(openAISpent({ prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 }), { input: 100, output: 5, cached: 80 }, 'DeepSeek');
  assert.deepEqual(openAISpent({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 } }), { input: 100, output: 5, cached: 0 }, 'OpenAI: 0 reported is a real 0');
  assert.deepEqual(openAISpent({ prompt_tokens: 100, completion_tokens: 5 }), { input: 100, output: 5 }, 'not reported stays unknown');
  assert.deepEqual(openAISpent({ prompt_tokens: 10, completion_tokens: 1, cost: 0.0021 }, { withCost: true }), { input: 10, output: 1, cost: 0.0021 });
  assert.equal(openAISpent({ prompt_tokens: 10, completion_tokens: 1, cost: 0.0021 }).cost, undefined, "another server's cost is in no known unit");
});

test('usage charge: DeepSeek is priced at the hour of the reply, half outside peak hours', () => {
  assert.equal(deepseekPeak(MONDAY(2)), true);
  assert.equal(deepseekPeak(MONDAY(4)), false, '04:00 UTC is off-peak');
  assert.equal(deepseekPeak(MONDAY(9)), true);
  assert.equal(deepseekPeak(SATURDAY(2)), false, 'weekends are off-peak all day');
  // deepseek-v4-pro at peak: $1.32 miss, $0.044 hit, $3.96 output per million.
  const spent = { input: 1_000_000, cached: 800_000, output: 100_000 };
  const peak = 0.2 * 1.32 + 0.8 * 0.044 + 0.1 * 3.96;
  near(chargeOf('deepseek', 'deepseek-v4-pro', spent, MONDAY(2)), peak);
  near(chargeOf('deepseek', 'deepseek-v4-pro', spent, SATURDAY(2)), peak / 2);
  near(chargeOf('deepseek', 'deepseek-v4-flash', spent, MONDAY(2)), chargeOf('deepseek', 'deepseek-flash', spent, MONDAY(2)), 'the retired name bills as Flash');
});

test('usage charge: nothing is guessed — no cache figure, an unknown model or another provider has no charge', () => {
  assert.equal(chargeOf('deepseek', 'deepseek-v4-pro', { input: 1000, output: 10 }, MONDAY(2)), null, 'without cache reads a miss and a hit cannot be told apart');
  assert.equal(chargeOf('deepseek', 'deepseek-chat', { input: 1000, cached: 0, output: 10 }), null);
  assert.equal(chargeOf('openai', 'gpt-5', { input: 1000, cached: 0, output: 10 }), null);
  assert.equal(chargeOf('openrouter', 'anything', { input: 1000, output: 10, cost: 0.5 }), 0.5, 'a stated cost is used as it is');
});

test('usage charge: the ledger keeps each reply charge, so the cost does not move when prices do', () => {
  const file = scratch();
  recordUsage({ input: 1_000_000, cached: 800_000, output: 100_000 }, { file, now: MONDAY(2), provider: 'deepseek', model: 'deepseek-v4-pro' });
  recordUsage({ input: 1_000_000, cached: 800_000, output: 100_000 }, { file, now: SATURDAY(2), provider: 'deepseek', model: 'deepseek-v4-pro' });
  recordUsage({ input: 500, output: 50 }, { file, now: SATURDAY(3), provider: 'deepseek', model: 'deepseek-v4-pro' }); // no cache figure: uncharged
  recordUsage({ input: 10, output: 1, cost: 0.0042 }, { file, now: SATURDAY(4), provider: 'openrouter', model: 'some/model' });
  recordUsage({ input: 10, output: 1 }, { file, now: SATURDAY(5), provider: 'ollama', model: 'qwen3:8b', local: true });
  const { total } = readUsage(file);
  const peak = 0.2 * 1.32 + 0.8 * 0.044 + 0.1 * 3.96;
  const ds = total.by.deepseek['deepseek-v4-pro'];
  assert.equal(ds.costed, 2 * 1_100_000, 'only the two replies with a charge');
  near(ds.nanoUsd / 1e9, peak * 1.5);
  assert.deepEqual(total.by.ollama['qwen3:8b'], { input: 10, cached: 0, output: 1, replies: 1, written: 0, known: 0, local: true }, 'no charge fields where there is no charge');

  near(costParts('deepseek', 'deepseek-v4-pro', ds).usd, peak * 1.5);
  assert.equal(costParts('deepseek', 'deepseek-v4-pro', ds).unpriced, 550, 'the uncharged reply is left out, not guessed');
  const cost = costOfSets([total]);
  near(cost.usd, peak * 1.5 + 0.0042);
  near(cost.charged, cost.usd);
  assert.equal(cost.unpriced, 550);
});

test('usage charge: Claude Code stays a comparison and the total says which part is charged', () => {
  const file = scratch();
  recordUsage({ input: 1_000_000, cached: 0, output: 0 }, { file, provider: 'claude-code', model: 'claude-opus-5-5' }); // $4 at list price
  recordUsage({ input: 10, output: 1, cost: 0.5 }, { file, provider: 'openrouter', model: 'x/y' });
  const { total } = readUsage(file);
  assert.equal(total.by['claude-code']['claude-opus-5-5'].costed, undefined, 'a subscription is not charged per reply');
  const cost = costOfSets([total]);
  near(cost.usd, 4.5);
  near(cost.charged, 0.5);
  assert.equal(chargedPart(cost), '≈ $0.50 of it estimated charges from API providers');
  assert.equal(chargedPart({ usd: 0.5, charged: 0.5 }), '', 'nothing to split out when all of it is charged');
});
