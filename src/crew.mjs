// The helpers at work for the message SEEKER is answering, as the user sees them: a panel above the
// input box in the terminal, and a card in the phone's timeline with a stop button for each.
//
// Both are drawn from the lead agent's `crew` (src/agent.mjs): who each helper is, what it is on (a
// worker's task on the board), how it ended, and what it has spent (src/budget.mjs).
import { describeBudget, describeSpent, parseBudget } from './budget.mjs';
import { truncate } from './text.mjs';

const MAX_ROWS = 6;
const MARK = { running: '◐', completed: '✓' };

const seconds = (entry, now) => Math.max(0, Math.round(((entry.endedAt ?? now) - entry.startedAt) / 1000));
const duration = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

/** What a helper is on: a worker's task on the board, else the job it was given. */
function doing(entry, board) {
  const task = board?.tasks.find((t) => t.status === 'active' && t.owner === entry.name);
  return task ? `${task.id} ${task.title}` : entry.description;
}

/** Whether there is anything to show: helpers have run during the message being answered. */
export const crewShown = (agent) => Boolean(agent?.crew?.length) && (Boolean(agent.controller) || agent.crew.some((e) => e.status === 'running'));

/** The panel rows for the terminal; none when no helper has run in this message. */
export function crewRows(agent, width, c, now = Date.now()) {
  if (!crewShown(agent)) return [];
  const crew = agent.crew;
  const running = crew.filter((e) => e.status === 'running').length;
  const budget = parseBudget(agent.config?.swarmBudget);
  const head = [`helpers: ${running} running, ${crew.length - running} finished`, describeSpent(agent.helperSpent)];
  if (budget) head.push(`budget ${describeBudget(budget)}`);
  const rows = [`  ${c.dim(truncate(head.join(' · '), width - 2))}`];
  // Running helpers first, then the most recent of the finished ones.
  const shown = [...crew.filter((e) => e.status === 'running'), ...crew.filter((e) => e.status !== 'running').reverse()].slice(0, MAX_ROWS);
  for (const entry of shown) {
    const mark = entry.status === 'running' ? c.accent(MARK.running) : entry.status === 'completed' ? c.green(MARK.completed) : c.yellow('!');
    const state = entry.status === 'running' ? '' : ` ${entry.status}`;
    const tail = ` · ${describeSpent(entry.spent)} · ${duration(seconds(entry, now))}${state}`;
    const name = `${entry.name} `;
    const room = Math.max(8, width - 6 - name.length - tail.length);
    rows.push(`  ${mark} ${c.bold(name)}${truncate(doing(entry, agent.board), room)}${c.dim(tail)}`);
  }
  if (crew.length > shown.length) rows.push(`  ${c.dim(`… ${crew.length - shown.length} more`)}`);
  return rows;
}

/** The crew as the phone gets it, in the workspace summary; null when there is nothing to show. */
export function crewMeta(agent, now = Date.now()) {
  if (!crewShown(agent)) return null;
  const budget = parseBudget(agent.config?.swarmBudget);
  return {
    spent: describeSpent(agent.helperSpent),
    budget: budget ? describeBudget(budget) : null,
    stopped: agent.budgetStop ?? null,
    helpers: agent.crew.map((e) => ({ id: e.id, name: e.name, doing: doing(e, agent.board), status: e.status, spent: describeSpent(e.spent), seconds: seconds(e, now) })),
  };
}
