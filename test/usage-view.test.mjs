// Token usage as the phone shows it: totals that reconcile, a share of cached input that is only
// stated where it is known, and days that are never called zero when they were not recorded.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { RANGES, axis, breakdown, compact, dayLabel, daysBetween, fullDay, labelled, percent, periodTotal, series, shiftDay, shortDay, view } from '../remote-server/public/usage.js';
import { recordUsage, usageSummary } from '../src/usage.mjs';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const scratch = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-uv-')), 'usage.json');

test('usage view: numbers are shortened the same way everywhere', () => {
  assert.deepEqual([950, 1250, 523_600, 6_600_000, 84_914_359, 999_960, 2_400_000_000].map(compact), ['950', '1.3K', '523.6K', '6.6M', '84.9M', '1.0M', '2.4B']);
  assert.deepEqual([0, -5, NaN, undefined].map(compact), ['0', '0', '0', '0']);
  assert.equal(percent(0.9216), '92.2%');
  assert.equal(percent(null), '—');
});

test('usage view: the parts add up to the total, and cached input is never counted twice', () => {
  const b = breakdown({ input: 84_390_759, cached: 77_800_000, output: 523_600, replies: 462, written: 1_200_000, known: 84_390_759 });
  assert.equal(b.total, 84_914_359, 'input already holds the cached part');
  assert.equal(b.newInput + b.cachedInput + b.output, b.total);
  assert.deepEqual([b.newInput, b.cachedInput, b.output, b.replies, b.written], [6_590_759, 77_800_000, 523_600, 462, 1_200_000]);
  assert.ok(Math.abs(b.cacheRatio + b.newRatio - 1) < 1e-12, 'the two parts of the input bar share one denominator');
  assert.equal(percent(b.cacheRatio), '92.2%');
  assert.equal(percent(b.newRatio), '7.8%');
  // Counts far past 32 bits stay exact.
  assert.equal(breakdown({ input: 9_000_000_000_000, cached: 1, output: 7, known: 9_000_000_000_000 }).total, 9_000_000_000_007);
});

test('usage view: a share of cached input is stated only where the provider reports its cache', () => {
  const silent = breakdown({ input: 5000, cached: 0, output: 100, known: 0 });
  assert.deepEqual([silent.cacheRatio, silent.newRatio, silent.measuredInput], [null, null, 0], 'not reported is not 0%');
  assert.deepEqual([breakdown({}).cacheRatio, breakdown({}).total], [null, 0], 'nothing sent: no ratio to divide');
  const none = breakdown({ input: 5000, cached: 0, output: 100, known: 5000 });
  assert.equal(none.cacheRatio, 0, 'a provider that reports its cache and read nothing from it is a real 0%');
  // Two providers in one ledger: the share is measured over the input that can be measured.
  const mixed = breakdown({ input: 10_000, cached: 3000, output: 0, known: 4000 });
  assert.deepEqual([mixed.cacheRatio, mixed.partial, mixed.newInput], [0.75, true, 7000]);
  // A Mac that does not send `known` yet.
  assert.equal(breakdown({ input: 1000, cached: 900, output: 1 }).cacheRatio, 0.9);
  assert.equal(breakdown({ input: 1000, cached: 0, output: 1 }).cacheRatio, null);
});

test('usage view: a day before counting began is unavailable, a tracked day without use is a real zero', () => {
  const file = scratch();
  recordUsage({ input: 1000, cached: 800, output: 50 }, { file, now: at(2026, 11, 12, 15) });
  recordUsage({ input: 400, cached: 100, output: 20 }, { file, now: at(2026, 11, 15, 9) });
  const usage = usageSummary({ file, now: at(2026, 11, 15, 18) });
  assert.equal(usage.sinceDay, '2026-11-12');
  assert.deepEqual(usage.days.map((d) => d.day), ['2026-11-12', '2026-11-15']);

  const week = series(usage, '7');
  assert.deepEqual(week.map((d) => [d.day.slice(8), d.coverage]), [['09', 'unavailable'], ['10', 'unavailable'], ['11', 'unavailable'], ['12', 'recorded'], ['13', 'zero'], ['14', 'zero'], ['15', 'recorded']]);
  assert.equal(week[0].counts, null, 'no number is given for a day that was not recorded');
  assert.equal(week[4].counts.total, 0);
  assert.deepEqual([week[3].partial, week[6].partial], [true, false], 'the day counting began holds only part of it');
  assert.equal(week[3].counts.total, 1050);

  // Recorded without a provider: counted, but with nothing to price, so no amount rather than $0.
  assert.deepEqual(periodTotal(week), { total: 1470, newInput: 500, cachedInput: 900, output: 70, replies: 2, cost: { usd: null, unpriced: 1470 } });
  assert.equal(periodTotal(week.slice(0, 3)), null, 'a range that was never tracked has no total, not a total of 0');
  assert.equal(series(usage, '30').length, 30);
  assert.deepEqual(series(usage, 'all').map((d) => d.day), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'], 'all tracked time starts the day counting began');

  const v = view(usage, { range: '7' });
  assert.deepEqual([v.today, v.sinceDay, v.empty, v.lifetime.total, v.ticks.at(-1) >= 1050], ['2026-11-15', '2026-11-12', false, 1470, true]);
  assert.equal(v.lifetime.total, periodTotal(series(usage, 'all')).total, 'the lifetime total is the sum of its days');
  assert.equal(view({ since: null, sinceDay: null, today: { day: '2026-11-15' }, total: {}, days: [] }).empty, true);
  assert.equal(view(null).empty, true);
});

test('usage view: days are the Mac\'s calendar days, whatever the phone\'s clock says', () => {
  const file = scratch();
  // One reply just before midnight and one just after: two days, as the Mac saw them.
  recordUsage({ input: 10, output: 1 }, { file, now: at(2026, 11, 14, 23) });
  recordUsage({ input: 20, output: 2 }, { file, now: at(2026, 11, 15, 0) });
  const usage = usageSummary({ file, now: at(2026, 11, 15, 0) });
  // The phone's own clock is hours away (another day, even): the series still ends on the Mac's today.
  for (const phoneNow of [at(2026, 11, 13, 3), at(2026, 11, 16, 22)]) {
    const days = series(usage, '7', phoneNow);
    assert.equal(days.at(-1).day, '2026-11-15');
    assert.deepEqual(days.slice(-2).map((d) => d.counts.total), [11, 22]);
  }
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-11-09', '2026-11-15'), 6);
});

test('usage view: an older Mac that sends only the week is still read, with the same rules', () => {
  const week = ['15', '14', '13', '12', '11', '10', '09'].map((d, i) => ({ day: `2026-11-${d}`, input: i === 0 ? 900 : 0, cached: i === 0 ? 800 : 0, output: i === 0 ? 100 : 0, replies: i === 0 ? 3 : 0 }));
  const old = { since: at(2026, 11, 15, 7), today: week[0], week, total: { input: 900, cached: 800, output: 100, replies: 3 } };
  const days = series(old, '7', at(2026, 11, 15, 20));
  assert.deepEqual(days.map((d) => d.coverage), ['unavailable', 'unavailable', 'unavailable', 'unavailable', 'unavailable', 'unavailable', 'recorded']);
  assert.equal(percent(view(old).lifetime.cacheRatio), '88.9%');
});

test('usage view: the chart has round numbers on its axis and labels that fit', () => {
  assert.deepEqual(axis(84_914_359), [0, 25_000_000, 50_000_000, 75_000_000, 100_000_000]);
  assert.deepEqual(axis(1050), [0, 500, 1000, 1500, 2000]);
  assert.deepEqual(axis(7), [0, 2, 4, 6, 8]);
  assert.deepEqual(axis(0), [0, 1, 2, 3, 4], 'nothing to show still has an axis');
  for (const max of [1, 3, 99, 4321, 5_000_000, 123_456_789]) assert.ok(axis(max).at(-1) >= max, `the axis reaches ${max}`);
  const seven = labelled(7);
  assert.equal([0, 1, 2, 3, 4, 5, 6].filter(seven).length, 7);
  const month = labelled(30);
  const shown = Array.from({ length: 30 }, (_, i) => i).filter(month);
  assert.ok(shown.length <= 7 && shown.includes(29), 'at most seven labels, and always the newest day');
  assert.deepEqual([shortDay('2026-11-09'), fullDay('2026-11-15')], ['Nov 9', 'Nov 15, 2026']);
  assert.deepEqual(['2026-11-15', '2026-11-14', '2026-11-13', '2025-12-31'].map((d) => dayLabel(d, '2026-11-15')), ['Today', 'Yesterday', 'Fri, Nov 13', 'Wed, Dec 31, 2025']);
  assert.deepEqual(RANGES.map(([id]) => id), ['7', '30', 'all']);
});

test('usage ledger: cache writes and what the provider reports are kept, and an older ledger is still read', () => {
  const file = scratch();
  recordUsage({ input: 1000, cached: 600, written: 300, output: 10 }, { file, now: at(2026, 11, 15) });
  recordUsage({ input: 500, output: 5 }, { file, now: at(2026, 11, 15) }); // a provider that says nothing about its cache
  const { total } = usageSummary({ file, now: at(2026, 11, 15) });
  assert.deepEqual(total, { input: 1500, cached: 600, output: 15, replies: 2, written: 300, known: 1000 });
  recordUsage({ input: 100, cached: 0, written: 999, output: 1 }, { file, now: at(2026, 11, 15) });
  assert.equal(usageSummary({ file, now: at(2026, 11, 15) }).total.written, 400, 'what was written cannot exceed the new input');
  // A ledger from before these fields existed.
  const old = scratch();
  fs.writeFileSync(old, JSON.stringify({ since: at(2026, 11, 15), total: { input: 900, cached: 800, output: 100, replies: 3 }, days: { '2026-11-15': { input: 900, cached: 800, output: 100, replies: 3 } } }));
  assert.deepEqual(usageSummary({ file: old, now: at(2026, 11, 15) }).total, { input: 900, cached: 800, output: 100, replies: 3, written: 0, known: 900 });
  recordUsage({ input: 100, cached: 50, output: 1 }, { file: old, now: at(2026, 11, 15) });
  assert.deepEqual(usageSummary({ file: old, now: at(2026, 11, 15) }).total, { input: 1000, cached: 850, output: 101, replies: 4, written: 0, known: 1000 });
});
