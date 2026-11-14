// Runs scheduled jobs (see cron.mjs): each in a fresh session of its own, with
// nobody to ask, so it may read freely but changes files only if the job was
// created with that allowed, and never runs a risky command.
import fs from 'node:fs';
import { Agent } from './agent.mjs';
import { isSilent, jobPrompt, readJobs, recordRun, takeDueJobs } from './cron.mjs';
import { Permissions } from './permissions.mjs';
import { createProvider } from './providers.mjs';
import { loadSkills } from './skills.mjs';

// What a job's session never gets: it must not schedule more jobs, wait for an answer, or
// write to memory and skills with nobody there to see it.
const WITHHELD = ['cronjob_manage', 'ask_user', 'memory', 'skill_manage'];

/**
 * Runs one job to completion.
 * @returns {Promise<{ job: object, reply: string, error: string|null, silent: boolean, file: string }>}
 */
export async function runJob(job, { config, info, now = new Date() }) {
  const errors = [];
  const quiet = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'error' ? (text) => errors.push(String(text).trim()) : key === 'c' ? new Proxy({}, { get: () => (t) => t }) : () => {}) });
  let reply = '';
  let error = null;
  try {
    if (!fs.existsSync(job.workdir)) throw new Error(`its folder ${job.workdir} no longer exists`);
    // 'auto' still asks about risky commands, and with nobody to ask, those are refused.
    const permissions = new Permissions({ mode: job.allow_changes ? 'auto' : 'ask', cwd: job.workdir, ask: null });
    const provider = createProvider(config.provider, config);
    const agent = new Agent({ config: { ...config, review: false }, ui: quiet, permissions, provider, info: info ?? (await provider.describe(config.model)), cwd: job.workdir });
    agent.allowReview = false;
    agent.withheld = new Set(WITHHELD);
    const skills = loadSkills(job.workdir, config.skillDirs, { bundled: config.bundledSkills !== false });
    await agent.runTurn(jobPrompt(job, now, (name) => skills.find((s) => s.name === name)?.body ?? null));
    reply = ([...agent.messages].reverse().find((m) => m.role === 'assistant' && m.content?.trim())?.content ?? '').trim();
    if (errors.length) error = errors.join('; ').replace(/^Error:\s*/, '');
    else if (!reply) error = 'the model returned nothing';
  } catch (err) {
    error = err.message;
  }
  const file = recordRun(job, { reply, error, now });
  // A failed run is always reported; a quiet success is not.
  return { job, reply, error, silent: !error && isSilent(reply), file };
}

/**
 * Runs every job that is due, one after another, handing each result to `deliver`.
 * @param {{ config: object, info?: object, deliver?: (result: object) => void, now?: Date }} opts
 * @returns {Promise<object[]>} the results
 */
export async function tick({ config, info, deliver = () => {}, now = new Date() }) {
  const results = [];
  for (const job of takeDueJobs(now)) {
    const result = await runJob(job, { config, info, now });
    results.push(result);
    try {
      deliver(result);
    } catch {}
  }
  return results;
}

/** Runs one job now, outside its schedule. */
export async function runNow(jobId, opts) {
  const job = readJobs().find((j) => j.id === jobId);
  if (!job) return null;
  return runJob(job, opts);
}
