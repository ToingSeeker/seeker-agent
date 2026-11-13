// Work that carries on without the user typing each step: a standing goal the
// agent keeps working towards (/goal), a prompt that re-runs on an interval or at
// its own pace (/loop), and an instruction that re-enters the session whenever it
// is idle (/heartbeat). The state lives with the running session.
import crypto from 'node:crypto';

export const GOAL_MAX_TURNS = 20;
const JUDGE_RESPONSE_CHARS = 4000;
const JUDGE_GOAL_CHARS = 2000;
const MAX_PARSE_FAILURES = 3;
const MAX_WAIT_MS = 30 * 60 * 1000;

const LOOP_MIN_INTERVAL_S = 30;
const LOOP_MAX_TICKS = 100;
const SELF_PACED_FLOOR_S = 60;
const SELF_PACED_CEILING_S = 900;
const HEARTBEAT_MIN_INTERVAL_S = 60;

const JUDGE_SYSTEM = `You decide whether an agent that works by itself has reached the goal its user set. You are given the goal and the agent's latest reply. Be strict, and answer with one of four verdicts.

done — the goal has been reached. The reply either says plainly that the work is finished or shows the finished result. The result has to exist: a reply that only explains why the goal is out of reach is "blocked".

blocked — the goal cannot be reached as it is written, or the agent cannot go on without the user. This covers a goal that is impossible or outside what the agent can do, an agent that declines to invent a result that cannot be real, and a next step that needs the user's input. Say in the reason what is in the way. If it is an error the agent ran into (an HTTP status, a failed API call, sign-in or token), copy the error text into the reason word for word. A goal that was reached is never "blocked".

wait — the goal has not been reached and the right next move is to let time pass: the agent reports a rate limit, a back-off, or that it is waiting a set time for a build, a deploy or a background process. Give the number of seconds in "wait_for_seconds". Work being left over is not a reason to wait.

continue — the goal has not been reached and the agent can take a definite next step now. Choose this when you are unsure.

Answer with one JSON object on a single line and nothing else, in one of these forms:
{"verdict": "done", "reason": "<one sentence>"}
{"verdict": "blocked", "reason": "<one sentence>"}
{"verdict": "continue", "reason": "<one sentence>"}
{"verdict": "wait", "wait_for_seconds": <int>, "reason": "<one sentence>"}`;

const judgeUser = (goal, response, now) =>
  `Goal:\n${goal.slice(0, JUDGE_GOAL_CHARS)}\n\nThe agent's latest reply:\n${response.slice(-JUDGE_RESPONSE_CHARS)}\n\nTime now: ${now.toISOString()}\n\nWhich verdict: done, blocked, continue or wait?`;

const continuation = (goal) => `[Carrying on with the goal you were given]
Goal: ${goal}

Take the next definite step towards it. When the goal is reached, say so plainly and stop. When you cannot go on without the user, say what you need and stop.`;

const loopWakeup = ({ tick, cadence, prompt, until }) =>
  until
    ? `[/loop wakeup #${tick}${cadence}]
Recurring task: ${prompt}
Stop condition: ${until}

The user's /loop started this turn automatically. Do the task now and look at things as they are at this moment: read files, processes and services again instead of relying on what an earlier round found. Keep the report short: what you found or did this round, with evidence of where the stop condition stands.
Once the stop condition holds, or the task no longer makes sense, say so and put LOOP_COMPLETE alone on the last line of your reply. That ends the loop.`
    : `[/loop wakeup #${tick}${cadence}]
Recurring task: ${prompt}

The user's /loop started this turn automatically. Do the task now and look at things as they are at this moment: read files, processes and services again instead of relying on what an earlier round found. Keep the report short: what you found or did this round.
Once the task is finished, no longer makes sense, or what you were watching has ended, say so and put LOOP_COMPLETE alone on the last line of your reply. That ends the loop.`;

const heartbeatPrompt = (interval, prompt) => `[Heartbeat: a standing instruction that comes back every ${interval}]
${prompt}

If this instruction gives you nothing real to do or report at the moment, say in a line that nothing changed and stop. Do not make up work.`;

/** Reads the judge's reply: the first JSON object in it. Anything unreadable is null. */
export function parseVerdict(text) {
  const found = /\{[\s\S]*?\}/.exec(String(text).replace(/```(?:json)?/g, ''));
  if (!found) return null;
  let data;
  try {
    data = JSON.parse(found[0]);
  } catch {
    return null;
  }
  // The older shape { done: true|false } is still understood.
  let verdict = typeof data.verdict === 'string' ? data.verdict.toLowerCase() : typeof data.done === 'boolean' ? (data.done ? 'done' : 'continue') : null;
  if (!verdict) return null;
  if (!['done', 'blocked', 'continue', 'wait'].includes(verdict)) verdict = 'continue';
  const seconds = Number(data.wait_for_seconds);
  return { verdict, reason: String(data.reason ?? '').trim(), seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
}

/** "30s", "5m", "2h", "1h30m" → seconds; anything else (a bare number included) is null. */
export function parseLoopInterval(word) {
  const m = /^(?=\d)(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(word ?? '');
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : null;
}

/** "10m", "2 hours", "every 90s", "1.5h", "1d" at the start of `text` → { seconds, rest }; null if there is none. */
export function parseHeartbeatInterval(text) {
  const m = /^(?:every\s+)?(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)(?:\s+|$)/i.exec(text.trim());
  if (!m) return null;
  const unit = m[2].toLowerCase();
  const scale = unit.startsWith('s') ? 1 : unit.startsWith('m') ? 60 : unit.startsWith('h') ? 3600 : 86_400;
  return { seconds: Math.round(Number(m[1]) * scale), rest: text.trim().slice(m[0].length).trim() };
}

export const duration = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return [h ? `${h}h` : '', m ? `${m}m` : '', s || (!h && !m) ? `${s}s` : ''].join('');
};

/** A reply reduced to what would differ if anything had really changed: times, dates and durations are taken out. */
const digest = (text) =>
  crypto
    .createHash('sha256')
    .update(text.toLowerCase().replace(/\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?|\d+(\.\d+)?\s*(ms|s|sec|seconds?|m|min|minutes?|h|hours?)\b/g, '').replace(/\s+/g, ' ').trim())
    .digest('hex');

export class Autonomy {
  /**
   * @param {object} opts
   * @param {(system: string, user: string) => Promise<string>} opts.ask  one model reply, no tools
   * @param {() => number} [opts.now]
   * @param {object} [opts.config]  { goalMaxTurns, loopMaxTicks }
   */
  constructor({ ask, now = () => Date.now(), config = {} }) {
    this.ask = ask;
    this.now = now;
    this.config = config;
    this.goal = null;
    this.loop = null;
    this.heartbeat = null;
  }

  /** True while anything here may want a turn by itself; the interface polls only then. */
  get active() {
    return Boolean((this.goal?.status === 'active' && this.goal.parkedUntil) || this.loop?.status === 'active' || this.heartbeat?.status === 'active');
  }

  async #judge(goal, response) {
    let reply;
    try {
      reply = await this.ask(JUDGE_SYSTEM, judgeUser(goal, response, new Date(this.now())));
    } catch {
      return { verdict: 'continue', reason: 'the judge could not be reached', failed: true };
    }
    // A judge that cannot be understood must not end the work: it counts as "continue".
    return parseVerdict(reply) ?? { verdict: 'continue', reason: 'the judge reply could not be read', failed: true };
  }

  // ── /goal ────────────────────────────────────────────────────────────────

  /**
   * @param {string} arg  what followed "/goal"
   * @returns {{ lines: string[], prompt?: string, label?: string }} `prompt` = run this as the next message
   */
  goalCommand(arg) {
    const text = arg.trim();
    const verb = text.split(/\s+/)[0]?.toLowerCase() ?? '';
    const g = this.goal;
    if (!text || verb === 'status' || verb === 'show') {
      if (!g || g.status === 'cleared') return { lines: ['No goal is set. /goal <what to achieve> sets one; SEEKER then keeps working, message after message, until a judge finds it done.'] };
      const state = g.status === 'active' ? (g.parkedUntil ? `waiting ${duration(Math.max(0, (g.parkedUntil - this.now()) / 1000))}` : 'active') : g.status === 'paused' ? `paused${g.pausedReason ? ` (${g.pausedReason})` : ''}` : g.status;
      return { lines: [`Goal: ${g.text}`, `${state} · ${g.turnsUsed}/${g.maxTurns} turns${g.lastReason ? ` · last verdict: ${g.lastReason}` : ''}`, '/goal pause · /goal resume · /goal clear'] };
    }
    if (['pause'].includes(verb) && text === verb) {
      if (!g || g.status !== 'active') return { lines: ['There is no active goal to pause.'] };
      Object.assign(g, { status: 'paused', pausedReason: 'paused by you', parkedUntil: null });
      return { lines: ['⏸ Goal paused. /goal resume to keep going.'] };
    }
    if (['resume', 'continue', 'unpause'].includes(verb) && text === verb) {
      if (!g || !['paused', 'active'].includes(g.status)) return { lines: ['There is no goal to resume.'] };
      Object.assign(g, { status: 'active', turnsUsed: 0, pausedReason: null, parkedUntil: null, parseFailures: 0 });
      return { lines: [`↻ Resuming the goal (${g.maxTurns} more turns).`], prompt: continuation(g.text), label: '/goal resume' };
    }
    if (['clear', 'stop', 'done'].includes(verb) && text === verb) {
      if (!g) return { lines: ['No goal is set.'] };
      this.goal = null;
      return { lines: ['Goal cleared.'] };
    }
    // "/goal -- pause the server" sets a goal that happens to start with a control word.
    const goalText = text.replace(/^--\s+/, '');
    this.goal = { text: goalText, status: 'active', turnsUsed: 0, maxTurns: this.config.goalMaxTurns ?? GOAL_MAX_TURNS, lastReason: null, pausedReason: null, parkedUntil: null, parseFailures: 0 };
    return { lines: [`⊙ Goal set (up to ${this.goal.maxTurns} turns): ${goalText}`], prompt: goalText, label: `/goal ${goalText}` };
  }

  /**
   * Called after every message while a goal is active: judges the reply and says what follows.
   * @param {{ interrupted: boolean, response: string }} turn
   * @returns {Promise<{ lines: string[], prompt?: string, label?: string }>}
   */
  async afterTurn({ interrupted, response }) {
    const g = this.goal;
    if (!g || g.status !== 'active') return { lines: [] };
    if (interrupted) {
      Object.assign(g, { status: 'paused', pausedReason: 'you interrupted', parkedUntil: null });
      return { lines: ['⏸ Goal paused — you interrupted. /goal resume to keep going, /goal clear to drop it.'] };
    }
    if (!response.trim()) return { lines: [] };
    g.turnsUsed++;
    const verdict = await this.#judge(g.text, response);
    g.lastReason = verdict.reason || null;
    if (verdict.failed) {
      if (++g.parseFailures >= MAX_PARSE_FAILURES) {
        Object.assign(g, { status: 'paused', pausedReason: 'the judge could not be read' });
        return { lines: [`⏸ Goal paused — the judge's verdict could not be read ${MAX_PARSE_FAILURES} times in a row. /goal resume to keep going.`] };
      }
    } else g.parseFailures = 0;

    if (verdict.verdict === 'done') {
      g.status = 'done';
      return { lines: [`✓ Goal achieved: ${verdict.reason}`] };
    }
    if (verdict.verdict === 'blocked') {
      Object.assign(g, { status: 'paused', pausedReason: 'blocked' });
      return { lines: [`⏸ Goal judged unachievable — paused: ${verdict.reason} Re-scope with /goal <text>, or override with /goal resume.`] };
    }
    if (verdict.verdict === 'wait') {
      const ms = Math.min(MAX_WAIT_MS, (verdict.seconds ?? 60) * 1000);
      g.parkedUntil = this.now() + ms;
      g.turnsUsed--; // waiting does not use up the budget
      return { lines: [`⏳ Goal parked for ${duration(ms / 1000)}: ${verdict.reason}`] };
    }
    if (g.turnsUsed >= g.maxTurns) {
      Object.assign(g, { status: 'paused', pausedReason: 'turn budget used' });
      return { lines: [`⏸ Goal paused — ${g.turnsUsed}/${g.maxTurns} turns used. Use /goal resume to keep going, or /goal clear to stop.`] };
    }
    return { lines: [`↻ Goal not reached yet (${g.turnsUsed}/${g.maxTurns}): ${verdict.reason}`], prompt: continuation(g.text), label: '↻ goal' };
  }

  // ── /loop ────────────────────────────────────────────────────────────────

  /** @returns {{ lines: string[] }} */
  loopCommand(arg) {
    const text = arg.trim();
    const l = this.loop;
    if (!text || text === 'status') {
      if (!l) return { lines: ['No loop is set. /loop 5m <prompt> re-runs a prompt every 5 minutes; /loop <prompt> lets SEEKER pace itself.', 'Options: --times N · --until <condition>. /loop stop ends it.'] };
      const next = l.status === 'active' ? `next in ${duration(Math.max(0, (l.nextDueAt - this.now()) / 1000))}` : l.status;
      return { lines: [`Loop (${l.mode === 'interval' ? `every ${duration(l.intervalSeconds)}` : 'self-paced'}): ${l.prompt}`, `${next} · ${l.ticksFired} tick${l.ticksFired === 1 ? '' : 's'} so far${l.until ? ` · until: ${l.until}` : ''}`] };
    }
    if (text === 'pause') {
      if (l?.status !== 'active') return { lines: ['There is no running loop to pause.'] };
      Object.assign(l, { status: 'paused', pausedReason: 'paused by you' });
      return { lines: ['⏸ Loop paused. /loop resume to continue.'] };
    }
    if (text === 'resume') {
      if (l?.status !== 'paused') return { lines: ['There is no paused loop.'] };
      Object.assign(l, { status: 'active', pausedReason: null, nextDueAt: this.now() + Math.min(l.currentDelay, 5) * 1000, ticksFired: l.ticksFired >= l.maxTicks ? 0 : l.ticksFired });
      return { lines: ['↻ Loop resumed.'] };
    }
    if (['stop', 'clear', 'cancel', 'off'].includes(text)) {
      this.loop = null;
      return { lines: [l ? 'Loop stopped.' : 'No loop is set.'] };
    }

    let rest = text.replace(/^every\s+/i, '');
    let until = null;
    const untilAt = rest.search(/(^|\s)--until\s/);
    if (untilAt !== -1) {
      until = rest.slice(untilAt).replace(/^\s*--until\s+/, '').trim();
      rest = rest.slice(0, untilAt).trim();
    }
    let times = null;
    rest = rest.replace(/(^|\s)--times\s+(\d+)(?=\s|$)/, (_, lead, n) => ((times = Number(n)), lead)).trim();
    const [first, ...others] = rest.split(/\s+/);
    let interval = parseLoopInterval(first);
    const prompt = (interval === null ? rest : others.join(' ')).trim();
    if (!prompt) return { lines: ['/loop needs a prompt, e.g. /loop 5m check whether the deploy has finished'] };
    const lines = [];
    if (interval !== null && interval < LOOP_MIN_INTERVAL_S) {
      lines.push(`  (the shortest interval is ${LOOP_MIN_INTERVAL_S}s; using that)`);
      interval = LOOP_MIN_INTERVAL_S;
    }
    this.loop = {
      prompt,
      status: 'active',
      mode: interval === null ? 'self_paced' : 'interval',
      intervalSeconds: interval,
      currentDelay: interval ?? SELF_PACED_FLOOR_S,
      times,
      until,
      maxTicks: this.config.loopMaxTicks ?? LOOP_MAX_TICKS,
      ticksFired: 0,
      nextDueAt: this.now(), // the first run is at once
      awaiting: false,
      lastDigest: null,
      pausedReason: null,
    };
    lines.unshift(`↻ Loop set (${interval === null ? 'self-paced' : `every ${duration(interval)}`}${times ? `, ${times} times` : ''}${until ? `, until: ${until}` : ''}): ${prompt}`);
    return { lines };
  }

  // ── /heartbeat ───────────────────────────────────────────────────────────

  /** @returns {{ lines: string[] }} */
  heartbeatCommand(arg) {
    const text = arg.trim();
    const h = this.heartbeat;
    if (!text || text === 'status') {
      if (!h) return { lines: ['No heartbeat is set. /heartbeat every 10m <instruction> re-enters this session with that instruction whenever it is idle.'] };
      return { lines: [`Heartbeat (every ${duration(h.intervalSeconds)}): ${h.prompt}`, `${h.status} · fired ${h.fireCount} time${h.fireCount === 1 ? '' : 's'}`] };
    }
    if (text === 'pause') {
      if (h?.status !== 'active') return { lines: ['There is no running heartbeat.'] };
      h.status = 'paused';
      return { lines: ['⏸ Heartbeat paused.'] };
    }
    if (text === 'resume') {
      if (h?.status !== 'paused') return { lines: ['There is no paused heartbeat.'] };
      Object.assign(h, { status: 'active', lastFiredAt: this.now() });
      return { lines: ['♥ Heartbeat resumed.'] };
    }
    if (['clear', 'stop', 'off'].includes(text)) {
      this.heartbeat = null;
      return { lines: [h ? 'Heartbeat stopped.' : 'No heartbeat is set.'] };
    }
    const parsed = parseHeartbeatInterval(text);
    if (!parsed || !parsed.rest) return { lines: ['/heartbeat every <interval> <instruction>, e.g. /heartbeat every 10m check the deployment'] };
    if (parsed.seconds < HEARTBEAT_MIN_INTERVAL_S) return { lines: [`The shortest heartbeat is ${HEARTBEAT_MIN_INTERVAL_S}s.`] };
    this.heartbeat = { prompt: parsed.rest, intervalSeconds: parsed.seconds, status: 'active', createdAt: this.now(), lastFiredAt: null, fireCount: 0 };
    return { lines: [`♥ Heartbeat set (every ${duration(parsed.seconds)}): ${parsed.rest}`] };
  }

  // ── Scheduling ───────────────────────────────────────────────────────────

  /** Whether something is due now, without starting it. */
  hasDue() {
    const now = this.now();
    const g = this.goal;
    if (g?.status === 'active' && g.parkedUntil && now >= g.parkedUntil) return true;
    // A goal being worked on has the session; the loop waits its turn.
    const goalBusy = g?.status === 'active' && !g.parkedUntil;
    const l = this.loop;
    if (!goalBusy && l?.status === 'active' && !l.awaiting && now >= l.nextDueAt) return true;
    const h = this.heartbeat;
    return Boolean(h?.status === 'active' && now - (h.lastFiredAt ?? h.createdAt) >= h.intervalSeconds * 1000);
  }

  /**
   * Starts whatever is due, to be called only when the session is idle.
   * @returns {{ kind: 'goal'|'loop'|'heartbeat', prompt: string, label: string } | null}
   */
  takeDue() {
    if (!this.hasDue()) return null;
    const now = this.now();
    const g = this.goal;
    if (g?.status === 'active' && g.parkedUntil && now >= g.parkedUntil) {
      g.parkedUntil = null;
      return { kind: 'goal', prompt: continuation(g.text), label: '↻ goal (the wait is over)' };
    }
    const l = this.loop;
    if (l?.status === 'active' && !l.awaiting && now >= l.nextDueAt && !(g?.status === 'active' && !g.parkedUntil)) {
      l.ticksFired++;
      l.awaiting = true;
      l.nextDueAt = now + l.currentDelay * 1000;
      const cadence = l.mode === 'interval' ? `, every ${duration(l.intervalSeconds)}` : ', self-paced';
      // A slash command is run as typed, e.g. /loop 10m /compact.
      const prompt = l.prompt.startsWith('/') ? l.prompt : loopWakeup({ tick: l.ticksFired, cadence, prompt: l.prompt, until: l.until });
      return { kind: 'loop', prompt, label: `↻ loop #${l.ticksFired}: ${l.prompt}` };
    }
    const h = this.heartbeat;
    // Ticks missed while the session was busy collapse into this one.
    h.lastFiredAt = now;
    h.fireCount++;
    return { kind: 'heartbeat', prompt: heartbeatPrompt(duration(h.intervalSeconds), h.prompt), label: `♥ heartbeat: ${h.prompt}` };
  }

  /**
   * Called when a loop's wakeup message has been answered: decides whether it goes on.
   * @returns {Promise<string[]>} lines to show
   */
  async completeLoopTick({ interrupted, response }) {
    const l = this.loop;
    if (!l) return [];
    l.awaiting = false;
    if (interrupted) {
      Object.assign(l, { status: 'paused', pausedReason: 'you interrupted' });
      return ['⏸ Loop paused — you interrupted. /loop resume to continue, /loop stop to end it.'];
    }
    const finish = (why) => {
      this.loop = null;
      return [`✓ Loop finished after ${l.ticksFired} tick${l.ticksFired === 1 ? '' : 's'} — ${why}.`];
    };
    if (/^\s*LOOP_COMPLETE\s*[.!]?\s*$/im.test(response)) return finish('task complete');
    if (l.until && response.trim()) {
      const verdict = await this.#judge(l.until, response);
      if (verdict.verdict === 'done') return finish(`stop condition met: ${verdict.reason}`);
      if (verdict.verdict === 'blocked') {
        Object.assign(l, { status: 'paused', pausedReason: 'blocked' });
        return [`⏸ Loop paused — blocked: ${verdict.reason} /loop resume to continue.`];
      }
    }
    if (l.times && l.ticksFired >= l.times) return finish(`ran ${l.times} time${l.times === 1 ? '' : 's'}`);
    if (l.maxTicks && l.ticksFired >= l.maxTicks) {
      Object.assign(l, { status: 'paused', pausedReason: 'tick limit' });
      return [`⏸ Loop paused — ${l.ticksFired}/${l.maxTicks} ticks used. /loop resume to keep going.`];
    }
    if (l.mode === 'self_paced') {
      // The same answer again means nothing is happening: look less often. A new answer resets the pace.
      const now = digest(response);
      l.currentDelay = now === l.lastDigest ? Math.min(Math.max(l.currentDelay, SELF_PACED_FLOOR_S) * 2, SELF_PACED_CEILING_S) : SELF_PACED_FLOOR_S;
      l.lastDigest = now;
    }
    // The next tick is counted from the end of this one, so a long answer does not make ticks pile up.
    l.nextDueAt = this.now() + l.currentDelay * 1000;
    return [];
  }
}
