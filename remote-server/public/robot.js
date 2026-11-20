// The robot's moods and the number on the app's icon.
// Plain data in, plain data out — no DOM — so the page and the tests run the same code.
// Every mood comes from what the Mac reported for a workspace; none is made up here.

/** What the robot can show, with the word said beside it. */
export const MOODS = {
  idle: 'Idle',
  thinking: 'Thinking',
  coding: 'Coding',
  executing: 'Executing',
  awaiting_approval: 'Awaiting approval',
  success: 'Completed',
  error: 'Failed',
  disconnected: 'Disconnected',
};

/** How long a finished task is celebrated after it ended. Later the robot is idle again. */
export const SUCCESS_FOR = 8_000;
/** The shortest time a mood stays on screen, so quick steps do not make the robot flicker. */
export const HOLD = 700;

// Tools that change files: the robot is coding while one of them runs. The rest is executing.
const CODING = /^(Writing|Editing)\b/;

/**
 * The robot's mood for one workspace. `up`: the phone hears the Mac right now. Without the Mac
 * nothing about the agent can be confirmed, so the robot says disconnected, not stopped.
 */
export function mood(ws, { up = true, now = Date.now() } = {}) {
  if (!up) return 'disconnected';
  const meta = ws?.meta;
  if (!meta) return 'idle';
  if (meta.status === 'approval') return 'awaiting_approval';
  if (meta.status === 'working') {
    if (meta.phase === 'thinking' || meta.phase === 'responding') return 'thinking';
    return CODING.test(meta.tools?.running ?? '') ? 'coding' : 'executing';
  }
  if (meta.outcome === 'failed') return 'error';
  if (meta.outcome === 'completed' && meta.lastAt && now - meta.lastAt < SUCCESS_FOR) return 'success';
  return 'idle';
}

/**
 * Keeps a mood on screen for at least HOLD before the next one replaces it. Waiting for the user and
 * losing the Mac are shown at once: those are never held back.
 */
export class Steady {
  #shown = new Map(); // key → { mood, at }

  /** What to show now for `key`, and when to look again (`at`, or null when nothing is pending). */
  next(key, wanted, now = Date.now()) {
    const shown = this.#shown.get(key);
    const urgent = wanted === 'awaiting_approval' || wanted === 'disconnected';
    if (!shown || shown.mood === wanted || urgent || now - shown.at >= HOLD) {
      if (shown?.mood !== wanted) this.#shown.set(key, { mood: wanted, at: now });
      return { mood: wanted, at: null };
    }
    return { mood: shown.mood, at: shown.at + HOLD };
  }
}

/**
 * The number for the app's icon: requests waiting for an answer, and conversations whose ending the
 * phone was notified of and has not opened since (the Mac keeps that mark). Never running work.
 */
export function badgeCount({ approvals = [], workspaces = [] }) {
  return approvals.length + workspaces.filter((ws) => !ws.meta?.terminal && ws.meta?.unread).length;
}
