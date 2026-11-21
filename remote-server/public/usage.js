// Token usage as the phone shows it: totals, how the input divides, a day-by-day series and the
// numbers on the chart's axis. Plain data in, plain data out — no DOM — so the page and the tests
// run the same code. Every count comes from the ledger the Mac keeps; the one estimate is the cost:
// at Anthropic list price for Claude (PRICES below), and for providers that bill per token the charge
// the Mac recorded reply by reply (chargeOf). Shown only where there is a price, always labelled as such.
//
// How the counts fit together (see src/usage.mjs on the Mac):
//   input    everything sent to the model: new input + cached input
//   cached   the part of input read from the provider's cache
//   written  the part of new input the provider wrote to its cache (reported by some providers)
//   known    the part of input from replies whose provider reports cache figures at all
//   nanoUsd  what replies of per-token providers were charged, in billionths of a dollar
//   costed   the tokens (input + output) of the replies that nanoUsd covers
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
    out.push({ day, coverage: used ? 'recorded' : tracked ? 'zero' : 'unavailable', partial: day === sinceDay, counts: used ? breakdown(counts) : tracked ? breakdown({}) : null, cost: used ? costOfSets([counts]) : tracked ? { usd: 0, charged: 0, unpriced: 0 } : null });
  }
  return out;
}

/** The counts of a range added up, from the days that have any. Null when no day of it was tracked. */
export function periodTotal(days) {
  const tracked = days.filter((d) => d.counts);
  if (!tracked.length) return null;
  const sum = (key) => tracked.reduce((n, d) => n + d.counts[key], 0);
  // Days without use add $0, but only days that used something priced make the range "priced".
  const priced = tracked.filter((d) => d.coverage === 'recorded' && d.cost?.usd != null);
  const cost = { usd: priced.length ? priced.reduce((n, d) => n + d.cost.usd, 0) : null, charged: priced.reduce((n, d) => n + (d.cost.charged ?? 0), 0), unpriced: tracked.reduce((n, d) => n + (d.cost?.unpriced ?? 0), 0) };
  return { total: sum('total'), newInput: sum('newInput'), cachedInput: sum('cachedInput'), output: sum('output'), replies: sum('replies'), cost };
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

const COUNT_KEYS = ['input', 'cached', 'output', 'replies', 'written', 'known', 'nanoUsd', 'costed'];
export const MODEL_SLOTS = 4; // models drawn in their own colour; the rest fold into "Other models"

/**
 * The counts of a range split by provider and model, largest first. Each set of counts the Mac sends
 * may carry `by` ({ provider: { model: counts } }); what a set holds beyond its `by` was counted before
 * the split existed and comes back as `unattributed`, never shared out among the models.
 * Each row: { provider, model, local, counts, share, usd, unpriced }; `share` is of the range's total tokens.
 */
export function byModel(sets) {
  const rows = new Map();
  const rest = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]));
  let total = 0;
  for (const set of sets) {
    if (!set) continue;
    const left = Object.fromEntries(COUNT_KEYS.map((k) => [k, whole(set[k])]));
    total += whole(set.input) + whole(set.output);
    for (const [provider, models] of Object.entries(set.by ?? {})) {
      for (const [model, c] of Object.entries(models ?? {})) {
        const key = JSON.stringify([provider, model]);
        const row = rows.get(key) ?? { provider, model, local: false, raw: Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) };
        for (const k of COUNT_KEYS) row.raw[k] += whole(c?.[k]);
        // A reply that used several models counts once for each of them, so replies are not taken off the remainder.
        for (const k of COUNT_KEYS) if (k !== 'replies') left[k] -= whole(c?.[k]);
        row.local ||= c?.local === true;
        rows.set(key, row);
      }
    }
    left.replies = Math.max(0, whole(set.replies) - (set.by ? whole(set.split) : 0));
    for (const k of COUNT_KEYS) rest[k] += Math.max(0, left[k]);
  }
  const share = (b) => (total > 0 ? b.total / total : 0);
  const models = [...rows.values()]
    .map(({ provider, model, local, raw }) => ({ provider, model, local, raw, counts: breakdown(raw) }))
    .filter((r) => r.counts.total > 0)
    .map((r) => ({ ...r, share: share(r.counts), ...costParts(r.provider, r.model, r.raw, r.local) }))
    .sort((a, b) => b.counts.total - a.counts.total || a.model.localeCompare(b.model));
  const unattributed = breakdown(rest);
  return { models, unattributed: unattributed.total > 0 ? { counts: unattributed, share: share(unattributed) } : null, total };
}

// What the tokens would cost at Anthropic's list prices, in USD per million tokens:
// [input, 5-minute cache write, cache read, output]. From platform.claude.com/docs/en/about-claude/pricing
// as read on PRICES_AS_OF. A Claude subscription is not billed per token, so this is "what it would cost
// on the API", never a bill. Claude Haiku 5.5 is listed at its price for prompts up to 100K tokens: the
// ledger keeps no per-request prompt size, so longer prompts are under-priced.
export const PRICES_AS_OF = '2026-11-22';
const PRICES = {
  'claude-fable-5-2': [8, 10, 0.2, 40],
  'claude-mythos-5-2': [8, 10, 0.2, 40],
  'claude-fable-5-1': [10, 12.5, 0.25, 50],
  'claude-mythos-5-1': [10, 12.5, 0.25, 50],
  'claude-fable-5': [10, 12.5, 1, 50],
  'claude-mythos-5': [10, 12.5, 1, 50],
  'claude-opus-5-5': [4, 5, 0.2, 20],
  'claude-opus-5': [5, 6.25, 0.5, 25],
  'claude-opus-4-8': [5, 6.25, 0.5, 25],
  'claude-opus-4-7': [5, 6.25, 0.5, 25],
  'claude-opus-4-6': [5, 6.25, 0.5, 25],
  'claude-opus-4-5': [5, 6.25, 0.5, 25],
  'claude-sonnet-5-5': [2, 2.5, 0.1, 10],
  'claude-sonnet-5': [2, 2.5, 0.2, 10],
  'claude-sonnet-4-6': [3, 3.75, 0.3, 15],
  'claude-sonnet-4-5': [3, 3.75, 0.3, 15],
  'claude-haiku-5-5': [0.1, 0.125, 0.01, 0.5],
  'claude-haiku-4-5': [1, 1.25, 0.1, 5],
};
// Providers that bill at Anthropic's own prices. The same model through another provider (OpenRouter,
// a cloud platform) is priced by that provider, so it is left unpriced rather than guessed.
const ANTHROPIC_PRICED = new Set(['claude-code', 'anthropic']);
// Claude Code runs on a subscription: its amounts compare with the API, they are not charged. Every other
// provider that is not local bills per token, so its amounts estimate a real charge.
export const charged = (provider) => provider !== 'claude-code';

/** The list price of a model, or null. "claude-opus-5-5[1m]" and a dated "...-20260101" name the same model. */
export function priceOf(provider, model) {
  if (!ANTHROPIC_PRICED.has(provider) || typeof model !== 'string') return null;
  const id = model.toLowerCase().replace(/\[.*\]$/, '').replace(/-\d{8}$/, '');
  return PRICES[id] ?? null;
}

// Providers that charge per token, priced when each reply is counted (by chargeOf below) because their
// price depends on the hour. USD per million tokens: [cache miss input, cache hit input, output] at the
// full (peak) rate. From api-docs.deepseek.com/quick_start/pricing as read on PRICES_AS_OF. Off-peak is
// half the peak rate; peak is 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday. DeepSeek also makes
// Chinese public holidays off-peak, which this does not know, so on those days the estimate is high.
const API_PRICES = {
  deepseek: {
    'deepseek-v4-pro': [1.32, 0.044, 3.96],
    'deepseek-flash': [0.3, 0.006, 1.2],
    'deepseek-v4-flash': [0.3, 0.006, 1.2], // retired name, served and billed as deepseek-flash
  },
};

/** True when `at` falls in DeepSeek's peak hours. */
export function deepseekPeak(at) {
  const d = new Date(at);
  const weekday = d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
  const hour = d.getUTCHours();
  return weekday && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

/**
 * What one reply of a per-token provider was charged, in USD, or null when that is not known. A charge the
 * provider stated (`spent.cost`) is used as it is. Otherwise the reply is priced from API_PRICES at the
 * moment `at`; that needs the provider to have said how much input it read from cache (`spent.cached`),
 * because a cache hit costs a fraction of a miss and guessing either way would be wrong.
 */
export function chargeOf(provider, model, spent = {}, at = Date.now()) {
  if (Number.isFinite(spent.cost) && spent.cost >= 0) return spent.cost;
  const price = API_PRICES[provider]?.[typeof model === 'string' ? model.toLowerCase() : ''];
  if (!price || !Number.isFinite(spent.cached)) return null;
  const input = whole(spent.input);
  const hit = Math.min(whole(spent.cached), input);
  const [miss, read, output] = price;
  const rate = provider === 'deepseek' && !deepseekPeak(at) ? 0.5 : 1;
  return (((input - hit) * miss + hit * read + whole(spent.output) * output) / 1e6) * rate;
}

// The ledger keeps charges in billionths of a dollar, so they stay whole numbers and a cheap reply is not rounded away.
export const NANO = 1e9;

/**
 * One model's cost: `usd` (null when nothing of it has a price) and `unpriced`, the tokens left out.
 * Local models cost 0. Charges recorded reply by reply (`nanoUsd`, over `costed` tokens) are used as they
 * are; the rest is priced at Anthropic list price where the model has one, and left out otherwise.
 * Cache writes are priced at the 5-minute rate (the ledger does not say which duration was written; 1-hour
 * writes bill higher), so the figure is a floor for them.
 */
export function costParts(provider, model, counts, local = false) {
  const b = breakdown(counts);
  if (local) return { usd: 0, unpriced: 0 };
  const costed = Math.min(whole(counts?.costed), b.total);
  let usd = costed > 0 ? whole(counts?.nanoUsd) / NANO : null;
  let unpriced = b.total - costed;
  const price = priceOf(provider, model);
  if (price && unpriced > 0 && costed === 0) {
    const [input, write, read, output] = price;
    usd = ((b.newInput - b.written) * input + b.written * write + b.cachedInput * read + b.output * output) / 1e6;
    unpriced = 0;
  }
  return { usd, unpriced };
}

/** The cost of one model's counts in USD, or null when it has no price. See costParts. */
export const costOf = (provider, model, counts, local = false) => costParts(provider, model, counts, local).usd;

/**
 * What a list of sets of counts would cost: `usd` over what has a price; `charged`, the part of it from
 * providers that bill per token (the rest compares a subscription with API prices); and `unpriced`, the
 * tokens of models without a price (and of counts made before the split by model), left out, not guessed.
 * `usd` is null when nothing could be priced.
 */
export function costOfSets(sets) {
  const { models, unattributed } = byModel(sets);
  let usd = null;
  let paid = 0;
  let unpriced = unattributed?.counts.total ?? 0;
  for (const m of models) {
    unpriced += m.unpriced;
    if (m.usd == null) continue;
    usd = (usd ?? 0) + m.usd;
    if (charged(m.provider)) paid += m.usd;
  }
  return { usd, charged: paid, unpriced };
}

/** What a model's amount is: an estimated charge (per-token providers) or a comparison with API prices (Claude Code). */
export const costKind = (provider) => (charged(provider) ? 'est. charge' : 'at API prices');

/** The part of a total that providers bill for, said after the total: "" when there is none, or when it is all of it. */
export const chargedPart = (cost) => (cost?.charged > 0 && cost.usd - cost.charged > 1e-9 ? `${approx(cost.charged)} of it estimated charges from API providers` : '');

/** "$0.42", "$12.34", "$1,234". Under a cent says so rather than "$0.00". */
export function dollars(usd) {
  if (usd == null) return '—';
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return usd >= 1000 ? `$${Math.round(usd).toLocaleString('en-US')}` : `$${usd.toFixed(2)}`;
}

/** An amount at list price as shown: "≈ $12.35", or "<$0.01", which is already approximate. */
export const approx = (usd) => (usd > 0 && usd < 0.01 ? dollars(usd) : `≈ ${dollars(usd)}`);

/** The models of a range: the lifetime total for "all", the recorded days of the range otherwise. */
function modelsOf(usage, range, days) {
  if (range === 'all') return byModel([usage?.total]);
  const recorded = new Map((usage?.days ?? usage?.week ?? []).map((d) => [d.day, d]));
  return byModel(days.map((d) => recorded.get(d.day)));
}

/** A model's share of the range: a sliver that rounds to 0.0% still says it was used. */
export const sharePercent = (share) => (share > 0 && share < 0.0005 ? '<0.1%' : percent(share));

/** "claude-opus-5-5" as it reads in a list; a model that was not recorded says so. */
export const modelName = (model) => model || 'Model not recorded';

/** Everything the sheet draws for one range. */
export function view(usage, { range = '7', now = Date.now() } = {}) {
  const { today, sinceDay } = anchors(usage, now);
  const days = series(usage, range, now);
  const top = Math.max(0, ...days.map((d) => d.counts?.total ?? 0));
  return { today, sinceDay, lifetime: breakdown(usage?.total), lifetimeCost: costOfSets([usage?.total]), days, period: periodTotal(days), models: modelsOf(usage, range, days), ticks: axis(top), empty: !usage?.total || breakdown(usage.total).total === 0 };
}
