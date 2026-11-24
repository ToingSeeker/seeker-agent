// The bundled crypto-market-analysis skill: its script computes the indicators the report quotes.
// These tests check the math on made-up candles and never touch the network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSkills } from '../src/skills.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(REPO, 'skills', 'crypto-market-analysis', 'scripts', 'market.mjs');
const m = await import(SCRIPT);

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const candle = (i, c, spread = 1) => ({ t: i * 86_400_000, o: c, h: c + spread, l: c - spread, c, v: 100 });

test('crypto-market-analysis: the skill ships with SEEKER and names its script', () => {
  const skill = loadSkills(os.tmpdir(), []).find((s) => s.name === 'crypto-market-analysis');
  assert.equal(skill?.source, 'bundled');
  assert.ok(fs.existsSync(path.join(skill.dir, 'scripts', 'market.mjs')));
  assert.match(skill.body, /scripts\/market\.mjs/);
  for (const command of ['ta', 'derivs', 'fundamentals', 'sentiment', 'macro', 'all']) assert.ok(skill.body.includes(`\`${command}`) || skill.body.includes(` ${command} `), `the instructions cover ${command}`);
  assert.match(skill.description, /technical/i);
  assert.match(skill.description, /fundamental/i);
  assert.match(skill.description, /macro/i);
});

test('crypto-market-analysis: moving averages, RSI and MACD on known series', () => {
  const flat = Array(60).fill(10);
  assert.equal(m.ema(flat, 20).at(-1), 10);
  assert.equal(m.ema(flat, 20)[18], null, 'no value before the period is filled');
  assert.deepEqual(m.sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  near(m.ema([1, 2, 3, 4], 3).at(-1), 3, 1e-12); // seed SMA(1,2,3)=2, then 4*0.5+2*0.5

  const up = Array.from({ length: 40 }, (_, i) => 100 + i);
  assert.equal(m.rsi(up).at(-1), 100);
  const down = up.toReversed();
  assert.equal(m.rsi(down).at(-1), 0);
  const zigzag = Array.from({ length: 60 }, (_, i) => (i % 2 ? 101 : 100));
  near(m.rsi(zigzag).at(-1), 50, 2);

  const mc = m.macd(flat);
  assert.equal(mc.line.at(-1), 0);
  assert.equal(mc.hist.at(-1), 0);
  const mu = m.macd(up);
  assert.ok(mu.line.at(-1) > 0, 'a rising series has a positive MACD line');
});

test('crypto-market-analysis: ATR, Bollinger, correlation', () => {
  const cs = Array.from({ length: 30 }, (_, i) => candle(i, 50, 2));
  near(m.atr(cs).at(-1), 4);
  const bb = m.bollinger(Array(25).fill(7)).at(-1);
  assert.deepEqual([bb.mid, bb.upper, bb.lower, bb.widthPct], [7, 7, 7, 0]);
  near(m.correlation([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  near(m.correlation([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  assert.equal(m.correlation([1, 2], [1, 2]), null);
});

test('crypto-market-analysis: swings, level clusters and structure', () => {
  // Two rising waves: peaks at i=5 (110) and i=15 (120), troughs at i=10 (95) and i=20 (100).
  const path_ = [100, 102, 104, 106, 108, 110, 107, 104, 101, 98, 95, 100, 105, 110, 115, 120, 116, 112, 108, 104, 100, 103, 106, 109];
  const cs = path_.map((c, i) => candle(i, c, 0.5));
  const sw = m.swings(cs);
  assert.deepEqual(sw.highs.map((s) => s.i), [5, 15]);
  assert.deepEqual(sw.lows.map((s) => s.i), [10, 20]);
  assert.match(m.structure(sw), /higher highs \+ higher lows/);
  assert.match(m.structure({ highs: [{ price: 2 }, { price: 1 }], lows: [{ price: 2 }, { price: 1 }] }), /lower highs \+ lower lows/);
  assert.match(m.structure({ highs: [], lows: [] }), /unclear/);

  assert.deepEqual(m.clusterLevels([100, 100.5, 110, 200], 1).map((l) => [l.price, l.touches]), [[100.25, 2], [110, 1], [200, 1]]);
});

test('crypto-market-analysis: summarize reads an uptrend as one', () => {
  const cs = Array.from({ length: 260 }, (_, i) => candle(i, 100 + i * 0.5 + (i % 7) * 0.8, 1));
  const s = m.summarize(cs);
  assert.match(s.ema.stack, /bullish stack/);
  assert.ok(s.rsi14 > 50);
  assert.ok(s.priceVsEma50Pct > 0);
  assert.deepEqual(Object.keys(s.ema), ['13', '21', '50', 'stack']);
  assert.equal(s.candles, 260);
  for (const l of s.support) assert.ok(l.price < s.close);
  for (const l of s.resistance) assert.ok(l.price > s.close);
  assert.equal(s.volume.upDownRatio20 > 1, true, 'a rising series puts its volume on up closes');
  assert.equal(s.volume.obvTrend20, 'rising');
  assert.ok(s.stoch.k >= 0 && s.stoch.k <= 100);
  assert.equal(m.summarize(cs.slice(0, 40)).ema.stack, 'not enough history for EMA50');
});

test('crypto-market-analysis: stochastic, OBV and the volume profile', () => {
  // Close at the top of a rising range reads 100; at the bottom of a falling one, 0.
  const up = Array.from({ length: 30 }, (_, i) => ({ t: i, o: 100 + i, h: 100 + i, l: 99 + i, c: 100 + i, v: 10 }));
  const su = m.stochastic(up);
  assert.equal(su.k[14], null, 'no %K before period + smoothing');
  near(su.k.at(-1), 100);
  near(su.d.at(-1), 100);
  const down = up.map((c, i) => ({ ...c, h: 200 - i + 1, l: 200 - i, c: 200 - i }));
  near(m.stochastic(down).k.at(-1), 0);
  const flat = Array.from({ length: 20 }, (_, i) => candle(i, 50, 0));
  assert.equal(m.stochastic(flat).k.at(-1), 50, 'a flat window reads 50');

  const cs = [candle(0, 10), { ...candle(1, 11), v: 5 }, { ...candle(2, 9), v: 3 }, { ...candle(3, 9), v: 7 }];
  assert.deepEqual(m.obv(cs), [0, 5, 2, 2]);

  const mixed = Array.from({ length: 25 }, (_, i) => ({ ...candle(i, i % 2 ? 101 : 100), v: i % 2 ? 30 : 10, tb: i % 2 ? 20 : 4 }));
  const vp = m.volumeProfile(mixed);
  assert.equal(vp.upDownRatio20, 3, 'up closes carry 30, down closes 10');
  assert.equal(vp.lastVsAvg20, round2(10 / 20));
  near(vp.takerBuyPct20, (10 * 20 + 10 * 4) / (10 * 30 + 10 * 10) * 100, 0.01);
  assert.equal(m.volumeProfile(mixed.map(({ tb, ...c }) => c)).takerBuyPct20, null, 'no taker data, no taker share');
});
const round2 = (x) => Math.round(x * 100) / 100;

test('crypto-market-analysis: symbols become exchange pairs', () => {
  assert.equal(m.pair('btc'), 'BTCUSDT');
  assert.equal(m.pair('SOL/USDT'), 'SOLUSDT');
  assert.equal(m.pair('ETHBTC'), 'ETHBTC');
  assert.equal(m.pair('eth-usdc'), 'ETHUSDC');
  assert.throws(() => m.pair(''), /symbol/);
});

test('crypto-market-analysis: a bad command prints the usage', async () => {
  await assert.rejects(m.run(['nope']), /usage: market\.mjs/);
  await assert.rejects(m.run(['fundamentals']), /CoinGecko id/);
});
