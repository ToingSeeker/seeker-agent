// Scheduled tasks: prompts that run by themselves at a time or on a rhythm,
// each in a fresh session, with the reply kept on disk and shown to the user.
// This file is the
// schedule arithmetic and the job store; running a job is the caller's part.
//
//   ~/.seeker/cron/jobs.json               the jobs
//   ~/.seeker/cron/output/<id>/<time>.md   what each run answered
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';
import { scanThreats } from './memory.mjs';

export const CRON_DIR = path.join(HOME_DIR, 'cron');
const JOBS_FILE = () => path.join(CRON_DIR, 'jobs.json');
const LOCK_FILE = () => path.join(CRON_DIR, '.tick.lock');
// A lock older than this was left by a process that died mid-tick.
const STALE_LOCK_MS = 10 * 60 * 1000;
const MAX_JOBS = 50;

const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export const CRON_HINT = `[IMPORTANT: You are running as a scheduled cron job. DELIVERY: Your final response will be automatically delivered to the user — just produce your report/output as your final response and the system handles the rest. SILENT: If there is genuinely nothing new to report, respond with exactly "[SILENT]" (nothing else) to suppress delivery. [SILENT] is a literal ASCII control token — never translate or rephrase it, whatever language the rest of your answer uses. Never combine [SILENT] with content — either report your findings normally, or say [SILENT] and nothing more. You cannot ask questions: nobody is there to answer. RECURSION: This is a run of an EXISTING scheduled job — execute the task now. NEVER create or update a cron job because of recurring or future-schedule language in the task prompt below; treat phrasing like "each Monday" or "every day at 9" as context for this run, not as a request to schedule another job.]`;

// ── Schedules ──────────────────────────────────────────────────────────────

/** One cron field as the set of values it allows, or null if it is not valid. */
function field(text, min, max, names = {}) {
  const allowed = new Set();
  for (const part of text.toLowerCase().split(',')) {
    const m = /^(\*|[a-z]+|\d+)(?:-([a-z]+|\d+))?(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const value = (v) => (v in names ? names[v] : /^\d+$/.test(v) ? Number(v) : NaN);
    // In the weekday field Sunday may be written 0 or 7, so "5-7" is Friday to Sunday.
    const top = max === 6 ? 7 : max;
    const from = m[1] === '*' ? min : value(m[1]);
    const to = m[1] === '*' ? max : m[2] !== undefined ? value(m[2]) : m[3] ? max : from;
    const step = m[3] ? Number(m[3]) : 1;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > top || from > to || step < 1) return null;
    for (let v = from; v <= to; v += step) allowed.add(max === 6 ? v % 7 : v);
  }
  return allowed;
}

/** A five-field cron expression, parsed; null if it is not one. */
export function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = field(parts[0], 0, 59);
  const hour = field(parts[1], 0, 23);
  const day = field(parts[2], 1, 31);
  const month = field(parts[3], 1, 12, MONTHS);
  const weekday = field(parts[4], 0, 6, DAYS);
  if (!minute || !hour || !day || !month || !weekday) return null;
  return { minute, hour, day, month, weekday, dayAny: parts[2] === '*', weekdayAny: parts[4] === '*' };
}

/** The first time after `from` that a cron expression matches (local time), or null. */
export function nextCron(expr, from) {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  if (!c) return null;
  const t = new Date(from);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  const limit = t.getTime() + 5 * 366 * 86_400_000;
  while (t.getTime() < limit) {
    if (!c.month.has(t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    // As in cron: with both a day of the month and a weekday given, either one matching is enough.
    const dayOk = c.day.has(t.getDate());
    const weekdayOk = c.weekday.has(t.getDay());
    const matches = c.dayAny && c.weekdayAny ? true : c.dayAny ? weekdayOk : c.weekdayAny ? dayOk : dayOk || weekdayOk;
    if (!matches) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!c.hour.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!c.minute.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1);
      continue;
    }
    return t;
  }
  return null;
}

/** "30m", "2 hours", "day", "1h30m" → minutes; null if it is not a duration. Seconds are not accepted. */
function minutes(text) {
  const compound = /^(?:(\d+)\s*h)(?:\s*(\d+)\s*m)$/i.exec(text.trim());
  if (compound) return Number(compound[1]) * 60 + Number(compound[2]);
  const m = /^(\d*)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)$/i.exec(text.trim());
  if (!m) return null;
  const n = m[1] === '' ? 1 : Number(m[1]);
  const unit = m[2].toLowerCase();
  const scale = unit.startsWith('m') ? 1 : unit.startsWith('h') ? 60 : unit.startsWith('d') ? 1440 : 10_080;
  return n > 0 ? n * scale : null;
}

/** "9am", "9:30pm", "14:00", "7", "noon", "midnight" → [hour, minute]; null if it is not a time. */
function clock(text) {
  const t = text.trim().toLowerCase();
  if (t === 'noon' || t === 'midday') return [12, 0];
  if (t === 'midnight') return [0, 0];
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (m[3] === 'pm' && hour < 12) hour += 12;
  if (m[3] === 'am' && hour === 12) hour = 0;
  return hour <= 23 && minute <= 59 ? [hour, minute] : null;
}

/**
 * Reads a schedule as people write it.
 *   "every 2h", "30m", "every day"         → repeats on an interval
 *   "in 30m"                               → once, that far from now
 *   "2026-12-01T09:00"                     → once, at that time
 *   "every monday 9am", "weekdays at 9am", "daily at 7:30" → repeats on those days
 *   "0 9 * * 1-5"                          → cron syntax
 * @returns {{ kind: 'once', runAt: string, display: string } | { kind: 'interval', minutes: number, display: string } | { kind: 'cron', expr: string, display: string } | null}
 */
export function parseSchedule(text, now = new Date()) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // Days and a time: "every monday 9am", "weekdays at 9", "mon,wed,fri 14:00", "daily at noon".
  const natural = /^(?:every\s+)?((?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:,|and|&)?\s*)+|day|daily|weekdays?|weekends?)\s+(?:at\s+)?(.+)$/.exec(lower);
  if (natural) {
    const time = clock(natural[2]);
    if (time) {
      const which = natural[1].trim();
      const days = /^(day|daily)$/.test(which) ? '*' : /^weekdays?$/.test(which) ? '1-5' : /^weekends?$/.test(which) ? '0,6' : [...new Set(which.match(/mon|tue|wed|thu|fri|sat|sun/g).map((d) => DAYS[d]))].sort().join(',');
      return { kind: 'cron', expr: `${time[1]} ${time[0]} * * ${days}`, display: raw };
    }
  }
  if (lower.startsWith('every ')) {
    const every = minutes(lower.slice(6));
    return every ? { kind: 'interval', minutes: every, display: `every ${every}m` } : null;
  }
  if (raw.split(/\s+/).length === 5 && parseCron(raw)) return { kind: 'cron', expr: raw, display: raw };
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) || /\dT\d/.test(raw)) {
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? null : { kind: 'once', runAt: at.toISOString(), display: `once at ${raw}` };
  }
  if (lower.startsWith('in ')) {
    const wait = minutes(lower.slice(3));
    return wait ? { kind: 'once', runAt: new Date(now.getTime() + wait * 60_000).toISOString(), display: `once in ${lower.slice(3).trim()}` } : null;
  }
  const bare = minutes(lower);
  return bare ? { kind: 'interval', minutes: bare, display: `every ${bare}m` } : null;
}

/** When a job with this schedule next runs after `from`, as an ISO string; null when it never will. */
export function nextRun(schedule, from = new Date()) {
  if (schedule.kind === 'once') return new Date(schedule.runAt).getTime() > from.getTime() ? schedule.runAt : null;
  if (schedule.kind === 'interval') return new Date(from.getTime() + schedule.minutes * 60_000).toISOString();
  return nextCron(schedule.expr, from)?.toISOString() ?? null;
}

// ── Store ──────────────────────────────────────────────────────────────────

export function readJobs() {
  try {
    const data = JSON.parse(fs.readFileSync(JOBS_FILE(), 'utf8'));
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    return [];
  }
}

function writeJobs(jobs) {
  fs.mkdirSync(CRON_DIR, { recursive: true });
  const temp = `${JOBS_FILE()}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ jobs, updated_at: new Date().toISOString() }, null, 1)}\n`, { mode: 0o600 });
  fs.renameSync(temp, JOBS_FILE());
}

/** True when there is at least one job that could come due; a cheap check for whoever runs the ticker. */
export const hasJobs = () => fs.existsSync(JOBS_FILE()) && readJobs().some((j) => j.enabled);

const publicJob = (j) => ({ job_id: j.id, name: j.name, schedule: j.schedule.display, state: j.state, next_run_at: j.next_run_at, last_run_at: j.last_run_at, last_status: j.last_status, runs: j.repeat.completed, repeat: j.repeat.times ?? 'forever', workdir: j.workdir, may_change_files: j.allow_changes, prompt: j.prompt.length > 200 ? `${j.prompt.slice(0, 200)}…` : j.prompt });

function checkPrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) return "'prompt' is required: the full, self-contained instructions for the job.";
  const threat = scanThreats(prompt) ?? (/\brm\s+-rf\s+\/(\s|$)/.test(prompt) ? 'destructive_command' : /\/etc\/sudoers|\bvisudo\b/.test(prompt) ? 'sudoers' : null);
  // A job's prompt may name its own config or keys by variable; what is refused is injection and exfiltration.
  if (threat && !['agent_config_mod', 'hardcoded_secret'].includes(threat)) return `Blocked: prompt matches threat pattern '${threat}'. Cron prompts must not contain injection or exfiltration payloads.`;
  return null;
}

/**
 * The cronjob_manage tool: create, list, update, pause, resume and remove jobs.
 * ('run' is handled by the caller, which knows how to run one.)
 * @param {object} args
 * @param {{ cwd: string, now?: Date }} ctx
 */
export function manageJobs(args, { cwd, now = new Date() }) {
  const action = String(args.action ?? '').toLowerCase();
  const jobs = readJobs();
  if (action === 'list') return { success: true, jobs: jobs.map(publicJob), count: jobs.length };

  if (action === 'create') {
    const problem = checkPrompt(args.prompt);
    if (problem) return { success: false, error: problem };
    const schedule = parseSchedule(args.schedule, now);
    if (!schedule) return { success: false, error: "'schedule' was not understood. Forms: 'every 2h' or '30m' (repeats), 'in 30m' (once), 'every monday 9am' / 'weekdays at 9am' / 'daily at 7:30', cron syntax '0 9 * * *', or an ISO time '2026-12-01T09:00'." };
    const next = nextRun(schedule, now);
    if (!next) return { success: false, error: 'That time is already in the past.' };
    if (jobs.length >= MAX_JOBS) return { success: false, error: `There are already ${MAX_JOBS} jobs. Remove one first.` };
    const times = Number(args.repeat);
    const job = {
      id: crypto.randomBytes(6).toString('hex'),
      name: String(args.name ?? '').trim() || args.prompt.trim().replace(/\s+/g, ' ').slice(0, 50),
      prompt: args.prompt.trim(),
      skills: Array.isArray(args.skills) ? args.skills.map(String).slice(0, 5) : [],
      schedule,
      repeat: { times: Number.isInteger(times) && times > 0 ? times : schedule.kind === 'once' ? 1 : null, completed: 0 },
      enabled: true,
      state: 'scheduled',
      workdir: cwd,
      allow_changes: args.allow_changes === true || args.allow_changes === 'true',
      created_at: now.toISOString(),
      next_run_at: next,
      last_run_at: null,
      last_status: null,
      last_error: null,
    };
    writeJobs([...jobs, job]);
    return { success: true, job: publicJob(job), note: 'The job runs while SEEKER is open (a session or `seeker remote`), or when `seeker cron tick` is run by the system scheduler.' };
  }

  const job = jobs.find((j) => j.id === args.job_id);
  if (!job) return { success: false, error: `No job with id "${args.job_id ?? ''}". List the jobs first — never guess an id.`, jobs: jobs.map((j) => ({ job_id: j.id, name: j.name })) };

  if (action === 'remove') {
    writeJobs(jobs.filter((j) => j !== job));
    return { success: true, removed: job.name };
  }
  if (action === 'pause') {
    Object.assign(job, { enabled: false, state: 'paused' });
  } else if (action === 'resume') {
    const next = nextRun(job.schedule, now);
    if (!next) return { success: false, error: 'This one-off job is in the past; update its schedule to run it again.' };
    Object.assign(job, { enabled: true, state: 'scheduled', next_run_at: next });
  } else if (action === 'update') {
    if (args.prompt !== undefined) {
      const problem = checkPrompt(args.prompt);
      if (problem) return { success: false, error: problem };
      job.prompt = args.prompt.trim();
    }
    if (args.schedule !== undefined) {
      const schedule = parseSchedule(args.schedule, now);
      const next = schedule && nextRun(schedule, now);
      if (!next) return { success: false, error: "'schedule' was not understood, or is in the past." };
      Object.assign(job, { schedule, next_run_at: next });
      if (schedule.kind === 'once') job.repeat = { times: 1, completed: 0 };
    }
    if (args.name !== undefined) job.name = String(args.name).trim() || job.name;
    if (args.allow_changes !== undefined) job.allow_changes = args.allow_changes === true || args.allow_changes === 'true';
    if (Array.isArray(args.skills)) job.skills = args.skills.map(String).slice(0, 5);
  } else {
    return { success: false, error: "action must be one of create, list, update, pause, resume, remove, run." };
  }
  writeJobs(jobs);
  return { success: true, job: publicJob(job) };
}

// ── Ticking ────────────────────────────────────────────────────────────────

/**
 * Takes the jobs that are due and moves each one's next run on BEFORE it is run, so a job that
 * crashes or a second process ticking at the same moment cannot run it twice. A job missed while
 * nothing was running fires once, however many times it was missed.
 * @returns {object[]} the due jobs (empty when another process holds the tick)
 */
export function takeDueJobs(now = new Date()) {
  if (!fs.existsSync(JOBS_FILE())) return [];
  let lock;
  try {
    fs.mkdirSync(CRON_DIR, { recursive: true });
    const stale = fs.statSync(LOCK_FILE(), { throwIfNoEntry: false });
    if (stale && now.getTime() - stale.mtimeMs > STALE_LOCK_MS) fs.rmSync(LOCK_FILE(), { force: true });
    lock = fs.openSync(LOCK_FILE(), 'wx');
  } catch {
    return [];
  }
  try {
    const jobs = readJobs();
    const due = jobs.filter((j) => j.enabled && j.next_run_at && Date.parse(j.next_run_at) <= now.getTime());
    for (const job of due) {
      job.repeat.completed++;
      job.last_run_at = now.toISOString();
      const more = job.repeat.times === null || job.repeat.completed < job.repeat.times;
      const next = more ? nextRun(job.schedule, now) : null;
      if (next) job.next_run_at = next;
      else Object.assign(job, { enabled: false, state: 'completed', next_run_at: null });
    }
    if (due.length) writeJobs(jobs);
    return due.map((j) => structuredClone(j));
  } finally {
    fs.closeSync(lock);
    fs.rmSync(LOCK_FILE(), { force: true });
  }
}

/** The whole prompt a job is run with. `skillText(name)` gives a skill's instructions, or null. */
export function jobPrompt(job, now = new Date(), skillText = () => null) {
  const stamp = now.toLocaleString('en-GB', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const skills = job.skills
    .map((name) => [name, skillText(name)])
    .filter(([, text]) => text)
    .map(([name, text]) => `[IMPORTANT: The user has attached the "${name}" skill to this job. Its full content is below; follow it.]\n\n${text}`);
  return [...skills, `${CRON_HINT}\n\n[CURRENT RUN TIME: ${stamp}]\n\n${job.prompt}`].join('\n\n');
}

/** True when a reply asks not to be delivered: [SILENT] as the whole reply or as its first or last line. */
export function isSilent(reply) {
  const lines = String(reply).trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const token = (line) => /^(\[silent\]|silent|no_reply|no reply)$/i.test(line ?? '');
  return !lines.length || token(lines[0]) || token(lines.at(-1));
}

/** Saves a run's reply and status. Returns the file the reply was written to. */
export function recordRun(job, { reply, error = null, now = new Date() }) {
  const dir = path.join(CRON_DIR, 'output', job.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${now.toISOString().replace(/[:.]/g, '-')}.md`);
  fs.writeFileSync(file, `# ${job.name}\n\n${now.toISOString()} · ${error ? `failed: ${error}` : 'ok'}\n\n${reply || '(no reply)'}\n`);
  const jobs = readJobs();
  const stored = jobs.find((j) => j.id === job.id);
  if (stored) {
    Object.assign(stored, { last_status: error ? 'error' : 'ok', last_error: error });
    writeJobs(jobs);
  }
  return file;
}

/** A reply as it is shown to the user. */
export const delivered = (job, reply) => `Cronjob Response: ${job.name}\n-------------\n\n${reply.trim()}`;
