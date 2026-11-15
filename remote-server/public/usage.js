// Token usage as the phone shows it: totals, how the input divides, a day-by-day series and the
// numbers on the chart's axis. Plain data in, plain data out — no DOM — so the page and the tests
// run the same code. Every figure comes from the ledger the Mac keeps; nothing is estimated here.
//
// How the counts fit together (see src/usage.mjs on the Mac):
//   input    everything sent to the model: new input + cached input
//   cached   the part of input read from the provider's cache
//   written  the part of new input the provider wrote to its cache (reported by some providers)
//   known    the part of input from replies whose provider reports cache figures at all
//   total    input + output — cached input is inside input and is never added a second time

const DAY = 86_400_000;
const MAX_DAYS = 400; // as many as the Mac keeps day by day

/** 950 → "950", 1 250 → "1.3K", 523 600 → "523.6K", 84 914 359 → "84.9M". */
export function compact(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v < 1000) return String(v);
  for (const [size, unit] of [[1e3, 'K'], [1e6, 'M'], [1e9, 'B']]) {
    const shown = Math.round((v / size) * 10) / 10;
    if (shown < 1000 || unit === 'B') return `${shown.toFixed(1)}${unit}`;
  }
}

const whole = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * One set of counts, divided for display. `cacheRatio` is the share of input read from cache,
 * measured only over input whose provider reports cache figures; it is null when no such input
 * exists, because "not reported" is not "nothing was cached".
 */
export function breakdown(counts) {
  const input = whole(counts?.input);
  const cached = Math.min(whole(counts?.cached), input);
  const output = whole(counts?.output);
  // Counts sent by a Mac that does not send `known` yet: cache reads were reported if any were counted.
  const known = Math.max(cached, Math.min(input, counts?.known === undefined ? (cached > 0 ? input : 0) : whole(counts.known)));
  return {
    total: input + output,
    newInput: input - cached,
    cachedInput: cached,
    written: Math.min(whole(counts?.written), input - cached),
    output,
    replies: whole(counts?.replies),
    measuredInput: known,
    cacheRatio: known > 0 ? cached / known : null,
    newRatio: known > 0 ? (known - cached) / known : null,
    // True when some input came from a provider that says nothing about its cache.
    partial: known > 0 && known < input,
  };
}

/** "92.2%". One decimal, so the two parts of the input bar add up to 100 within rounding. */
export const percent = (ratio) => (ratio == null ? '—' : `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`);

// Days are calendar days of the Mac, written 2026-11-15. They are moved about as dates at UTC
// midnight, so no time zone of the phone can shift one into its neighbour.
const stamp = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const dayAt = (ms) => new Date(ms).toISOString().slice(0, 10);
export const shiftDay = (day, by) => dayAt(stamp(day) + by * DAY);
export const daysBetween = (from, to) => Math.round((stamp(to) - stamp(from)) / DAY);

export const RANGES = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['all', 'All tracked time'],
];

/** The day counting began and the Mac's today, from what it sent. An older Mac sends neither by name. */
function anchors(usage, now) {
  const today = usage?.today?.day ?? dayAt(now - new Date(now).getTimezoneOffset() * 60_000);
  let sinceDay = usage?.sinceDay ?? null;
  if (!sinceDay && usage?.since) sinceDay = dayAt(usage.since - new Date(usage.since).getTimezoneOffset() * 60_000);
  return { today, sinceDay: sinceDay && sinceDay > today ? today : sinceDay };
}

/**
 * The days of a range, oldest first. Each says what is known about it:
 *   recorded     the ledger has counts for it
 *   zero         counting was on and nothing was used — a real 0
 *   unavailable  before counting began: unknown, never shown as 0
 * `partial` marks the day counting began, which holds only what came after that moment.
 */
export function series(usage, range = '7', now = Date.now()) {
  const { today, sinceDay } = anchors(usage, now);
  const recorded = new Map((usage?.days ?? usage?.week ?? []).map((d) => [d.day, d]));
  const length = range === 'all' ? Math.min(MAX_DAYS, sinceDay ? daysBetween(sinceDay, today) + 1 : 1) : Number(range) || 7;
  const out = [];
  for (let back = length - 1; back >= 0; back--) {
    const day = shiftDay(today, -back);
    const counts = recorded.get(day);
    const used = counts && (counts.input > 0 || counts.output > 0);
    const tracked = sinceDay != null && day >= sinceDay;
    out.push({ day, coverage: used ? 'recorded' : tracked ? 'zero' : 'unavailable', partial: day === sinceDay, counts: used ? breakdown(counts) : tracked ? breakdown({}) : null });
  }
  return out;
}

/** The counts of a range added up, from the days that have any. Null when no day of it was tracked. */
export function periodTotal(days) {
  const tracked = days.filter((d) => d.counts);
  if (!tracked.length) return null;
  const sum = (key) => tracked.reduce((n, d) => n + d.counts[key], 0);
  return { total: sum('total'), newInput: sum('newInput'), cachedInput: sum('cachedInput'), output: sum('output'), replies: sum('replies') };
}

/** Round numbers for the chart's axis: 0 and four steps up to at least `max`. */
export function axis(max) {
  if (!(max > 0)) return [0, 1, 2, 3, 4];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s * 4 >= max);
  return [0, 1, 2, 3, 4].map((i) => i * step);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Nov 15". */
export const shortDay = (day) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
/** "Today", "Yesterday", then "Fri, Nov 13" (with the year once it is not this one). */
export function dayLabel(day, today) {
  const back = daysBetween(day, today);
  if (back === 0) return 'Today';
  if (back === 1) return 'Yesterday';
  return `${WEEKDAYS[new Date(stamp(day)).getUTCDay()]}, ${shortDay(day)}${day.slice(0, 4) === today.slice(0, 4) ? '' : `, ${day.slice(0, 4)}`}`;
}
/** "Nov 15, 2026". */
export const fullDay = (day) => `${shortDay(day)}, ${day.slice(0, 4)}`;

/** Which days of the chart get a label under them, so the labels never run into each other. */
export function labelled(count, room = 7) {
  const every = Math.max(1, Math.ceil(count / room));
  return (index) => (count - 1 - index) % every === 0;
}

/** Everything the sheet draws for one range. */
export function view(usage, { range = '7', now = Date.now() } = {}) {
  const { today, sinceDay } = anchors(usage, now);
  const days = series(usage, range, now);
  const top = Math.max(0, ...days.map((d) => d.counts?.total ?? 0));
  return { today, sinceDay, lifetime: breakdown(usage?.total), days, period: periodTotal(days), ticks: axis(top), empty: !usage?.total || breakdown(usage.total).total === 0 };
}
