// How many tokens SEEKER has used, kept on this machine only.
//
// The ledger lives in ~/.seeker/usage.json (SEEKER_HOME moves it), next to the settings — never
// in a project folder and never in this repository, so nobody who clones the code sees a number.
// It holds counts per calendar day and a running total; no prompt, no file name, no project name.
// Each set of counts may also hold `by`, the same counts split by provider and model:
//   by: { 'claude-code': { 'claude-opus-5-5': counts, ... }, ollama: { 'qwen3:8b': { ...counts, local: true } } }
// `split` counts the replies that went into `by`. A model of '' means the provider is known and the
// model was not recorded. Counts made before the split existed are in the totals and in no `by`: the
// phone shows that remainder as "not attributed".
//
// Every reply of a model is added here, whichever provider gave it and whether SEEKER runs in a
// terminal or is driven from the phone. Counting starts the first time this file is written:
// what was used before that was never recorded, and is not guessed at.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';
import { NANO, chargeOf } from '../remote-server/public/usage.js';

export const USAGE_FILE = path.join(HOME_DIR, 'usage.json');
const KEEP_DAYS = 400; // days listed one by one; older ones stay in the total
// input   everything sent to the model, whatever it was billed as
// cached  the part of input the provider read from its cache
// written the part of input the provider wrote to its cache (billed above plain input, where it is reported)
// known   the part of input that came from replies whose provider reports cache figures at all:
//         a share of cached input is only meaningful against this, not against all input
// nanoUsd what replies of providers that bill per token were charged, in billionths of a dollar: the
//         charge the provider stated, or its price at the hour of the reply (chargeOf)
// costed  the tokens (input + output) of the replies nanoUsd covers; the rest has no charge on record
//         (both are left out of counts that have no charge on record)
const blank = () => ({ input: 0, cached: 0, output: 0, replies: 0, written: 0, known: 0 });
const whole = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** The local calendar day, as 2026-11-15: "today" is the user's day, not UTC's. */
export function dayOf(at = Date.now()) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const NAME = 120; // longest provider or model name kept; nothing longer is a name

function tally(raw) {
  const input = whole(raw?.input);
  const cached = Math.min(whole(raw?.cached), input);
  // A ledger written before `known` existed: where cache reads were counted, the provider reported them.
  const known = raw?.known === undefined ? (cached > 0 ? input : 0) : Math.min(whole(raw.known), input);
  const output = whole(raw?.output);
  return { input, cached, output, replies: whole(raw?.replies), written: Math.min(whole(raw?.written), input - cached), known: Math.max(known, cached), ...charge(raw, input + output) };
}

/** The charge fields of a set of counts, or nothing when it has no charge on record. */
function charge(raw, tokens) {
  const costed = Math.min(whole(raw?.costed), tokens);
  return costed > 0 ? { nanoUsd: whole(raw.nanoUsd), costed } : {};
}

function clean(raw) {
  const out = tally(raw);
  const by = {};
  for (const [provider, models] of Object.entries(raw?.by ?? {})) {
    if (!provider || name(provider) !== provider || !models || typeof models !== 'object') continue;
    for (const [model, c] of Object.entries(models)) {
      if (name(model) !== model || !c || typeof c !== 'object') continue;
      (by[provider] ??= {})[model] = { ...tally(c), ...(c.local === true ? { local: true } : {}) };
    }
  }
  if (Object.keys(by).length) {
    out.by = by;
    out.split = Math.min(whole(raw.split), out.replies); // replies that were split into `by`
  }
  return out;
}

// Names become keys of plain objects, so the few that would reach into Object's own machinery are dropped.
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const name = (v) => (typeof v === 'string' && !RESERVED.has(v.trim()) ? v.trim().slice(0, NAME) : '');

/** The ledger as it is on disk. A missing or damaged file reads as "nothing counted yet". */
export function readUsage(file = USAGE_FILE) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const days = {};
    for (const [day, counts] of Object.entries(raw.days ?? {})) if (/^\d{4}-\d{2}-\d{2}$/.test(day)) days[day] = clean(counts);
    return { since: typeof raw.since === 'number' ? raw.since : null, total: clean(raw.total), days };
  } catch {
    return { since: null, total: blank(), days: {} };
  }
}

/**
 * One reply's counts, cleaned: `known` is the input whose provider said anything about its cache.
 * `usd` is what the reply was charged, where that is known (null otherwise).
 */
function addition({ input = 0, cached, written = 0, output = 0 } = {}, usd = null) {
  const add = { input: whole(input), cached: Math.min(whole(cached), whole(input)), output: whole(output) };
  add.written = Math.min(whole(written), add.input - add.cached);
  // A provider that says nothing about its cache has not said "nothing was cached".
  add.known = cached === undefined ? 0 : add.input;
  const priced = Number.isFinite(usd) && usd >= 0;
  add.nanoUsd = priced ? whole(usd * NANO) : 0;
  add.costed = priced ? add.input + add.output : 0;
  return add;
}

function addTo(target, add) {
  for (const key of ['input', 'cached', 'written', 'known', 'output']) target[key] += add[key];
  if (add.costed) for (const key of ['nanoUsd', 'costed']) target[key] = (target[key] ?? 0) + add[key];
  target.replies += 1;
}

/**
 * Adds one reply of a model. `input` is everything sent to it (`cached` is the part of that read
 * from the provider's cache, where the provider says); `output` is what it wrote.
 * `provider` and `model` say whose reply it was; `models` lists each model's own share when one
 * reply used several (Claude Code's sub-agents), and then the reply counts once for each of them.
 * A reply of a provider that bills per token is priced now, at the hour it was made (chargeOf): its
 * charge is kept with the counts, so a later change of price does not rewrite what was spent.
 * Counting must never break a turn: a ledger that cannot be written is skipped.
 */
export function recordUsage(spent = {}, { file = USAGE_FILE, now = Date.now(), provider, model, local = false, models } = {}) {
  const who = name(provider);
  const price = (m) => (who && !local ? chargeOf(who, name(m.model), m, now) : null);
  const add = addition(spent, models?.length ? null : price({ ...spent, model }));
  if (!add.input && !add.output) return false;
  const parts = !who ? [] : (models?.length ? models : [{ ...spent, model }]).map((m) => ({ model: name(m.model), add: addition(m, price(m)) })).filter((m) => m.add.input || m.add.output);
  // Several models in one reply: the reply's charge is what its models' charges add up to.
  if (models?.length) for (const key of ['nanoUsd', 'costed']) add[key] = parts.reduce((n, p) => n + p.add[key], 0);
  try {
    // Read just before writing: another SEEKER (a terminal beside the phone's) may have added to it.
    const ledger = readUsage(file);
    ledger.since ??= now;
    const day = (ledger.days[dayOf(now)] ??= blank());
    for (const counts of [day, ledger.total]) {
      addTo(counts, add);
      if (parts.length) counts.split = (counts.split ?? 0) + 1;
      for (const part of parts) {
        const slot = ((counts.by ??= {})[who] ??= {})[part.model] ??= blank();
        if (local) slot.local = true;
        addTo(slot, part.add);
      }
    }
    const kept = Object.keys(ledger.days).sort().slice(-KEEP_DAYS);
    ledger.days = Object.fromEntries(kept.map((key) => [key, ledger.days[key]]));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(ledger)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the phone is shown: today, the last seven days (today first), everything since counting
 * began, and every day that has a record (`days`, oldest first). Days are this machine's calendar
 * days; `sinceDay` is the day counting began, so the phone never has to convert a time zone.
 */
export function usageSummary({ file = USAGE_FILE, now = Date.now() } = {}) {
  const ledger = readUsage(file);
  const week = [];
  const at = new Date(now);
  for (let back = 0; back < 7; back++) {
    const day = dayOf(new Date(at.getFullYear(), at.getMonth(), at.getDate() - back).getTime());
    week.push({ day, ...(ledger.days[day] ?? blank()) });
  }
  const days = Object.keys(ledger.days).sort().map((day) => ({ day, ...ledger.days[day] }));
  return { since: ledger.since, sinceDay: ledger.since ? dayOf(ledger.since) : null, today: week[0], week, total: ledger.total, days };
}
