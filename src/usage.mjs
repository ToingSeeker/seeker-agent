// How many tokens SEEKER has used, kept on this machine only.
//
// The ledger lives in ~/.seeker/usage.json (SEEKER_HOME moves it), next to the settings — never
// in a project folder and never in this repository, so nobody who clones the code sees a number.
// It holds counts per calendar day and a running total; no prompt, no file name, no project name.
//
// Every reply of a model is added here, whichever provider gave it and whether SEEKER runs in a
// terminal or is driven from the phone. Counting starts the first time this file is written:
// what was used before that was never recorded, and is not guessed at.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';

export const USAGE_FILE = path.join(HOME_DIR, 'usage.json');
const KEEP_DAYS = 400; // days listed one by one; older ones stay in the total
// input   everything sent to the model, whatever it was billed as
// cached  the part of input the provider read from its cache
// written the part of input the provider wrote to its cache (billed above plain input, where it is reported)
// known   the part of input that came from replies whose provider reports cache figures at all:
//         a share of cached input is only meaningful against this, not against all input
const blank = () => ({ input: 0, cached: 0, output: 0, replies: 0, written: 0, known: 0 });
const whole = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** The local calendar day, as 2026-11-15: "today" is the user's day, not UTC's. */
export function dayOf(at = Date.now()) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clean(counts) {
  const input = whole(counts?.input);
  const cached = Math.min(whole(counts?.cached), input);
  // A ledger written before `known` existed: where cache reads were counted, the provider reported them.
  const known = counts?.known === undefined ? (cached > 0 ? input : 0) : Math.min(whole(counts.known), input);
  return { input, cached, output: whole(counts?.output), replies: whole(counts?.replies), written: Math.min(whole(counts?.written), input - cached), known: Math.max(known, cached) };
}

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
 * Adds one reply of a model. `input` is everything sent to it (`cached` is the part of that read
 * from the provider's cache, where the provider says); `output` is what it wrote.
 * Counting must never break a turn: a ledger that cannot be written is skipped.
 */
export function recordUsage({ input = 0, cached, written = 0, output = 0 } = {}, { file = USAGE_FILE, now = Date.now() } = {}) {
  const add = { input: whole(input), cached: Math.min(whole(cached), whole(input)), output: whole(output) };
  add.written = Math.min(whole(written), add.input - add.cached);
  // A provider that says nothing about its cache has not said "nothing was cached".
  add.known = cached === undefined ? 0 : add.input;
  if (!add.input && !add.output) return false;
  try {
    // Read just before writing: another SEEKER (a terminal beside the phone's) may have added to it.
    const ledger = readUsage(file);
    ledger.since ??= now;
    const day = (ledger.days[dayOf(now)] ??= blank());
    for (const counts of [day, ledger.total]) {
      counts.input += add.input;
      counts.cached += add.cached;
      counts.written += add.written;
      counts.known += add.known;
      counts.output += add.output;
      counts.replies += 1;
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
