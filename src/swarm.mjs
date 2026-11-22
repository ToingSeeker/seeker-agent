// /swarm <goal>: big work done by a team, in four steps the user can follow.
//
//   1. Plan.    Plan mode goes on and SEEKER looks around, then proposes the work as tasks for the
//               board (what each is, which wait for which), how many workers, and whether they
//               work in worktrees. Nothing is changed or run; the user reads the plan.
//   2. Work.    /swarm go (or /plan go) approves it: SEEKER puts the tasks on the board and starts
//               the workers, who take ready tasks until none are left (src/board.mjs).
//   3. Review.  One helper that may only look reads what the workers did against the goal and
//               reports what is wrong, most severe first.
//   4. Report.  SEEKER checks what matters itself and tells the user what was done, what failed,
//               what the reviewer found and what nobody checked.
//
// The steps are instructions to the model, not code that drives it: the approval is plan mode's,
// the work is the board's, and the reviewer's "only look" is enforced by the task tool's look_only.
import { MAX_TASKS } from './board.mjs';
import { MAX_HELPERS } from './tools.mjs';

/** What the model is asked to do first: look, and propose the plan for the board. */
export function swarmPlanPrompt(goal) {
  return `Plan this work for a team of workers on the task board: ${goal}

Look at what you need first, with the read-only tools. Then answer with the plan, and stop:
- The tasks, in order, as they will go on the board: for each an id (t1, t2, …), a one-line title, the detail a worker needs (a worker knows nothing of this conversation: name the files, the approach and how to check it), and depends_on with the ids of earlier tasks that must be done first. At most ${MAX_TASKS} tasks; make each one a piece a single worker can finish and check.
- How many workers (1 to ${MAX_HELPERS}, usually 2 or 3): no more than the tasks that can run at the same time.
- Whether the workers use isolation "worktree". Use it when two of them may change files at the same time; leave it out when a task needs files another task changes, since a worktree sees only the last commit.
- What the reviewer will check, and how you will verify the result yourself (tests, a build, a command).

Do not put the tasks on the board or start anyone yet: the user approves the plan first.`;
}

/** What the model is told once the user approves: carry the plan out, step by step. */
export function swarmRunPrompt(goal) {
  return `The swarm plan is approved. Carry it out for the goal: ${goal}

1. Put the tasks on the board as planned, with the board tool's action "add". If the board still holds tasks from earlier work, "clear" it first.
2. Start the workers with the task tool: \`workers\` set to the planned number, \`isolation\` as planned, and in \`prompt\` what every worker must know (the goal, the project's conventions, what not to touch).
3. When they are done, start one reviewer with the task tool: one \`prompt\` and \`look_only: true\`. Tell it the goal, the tasks with their results, and where the changes are (the files, or the worktree branches the reports name, to read with git diff). Ask it to find what is wrong or missing against the goal and report each problem with file and line, most severe first, and to say plainly when it found nothing.
4. Check what matters yourself: run the tests or the build you planned, and read what the reviewer flagged. Fix what is clearly wrong and small; leave bigger problems for the user.
5. Answer with: each task and what came of it (done, failed, blocked), what the reviewer found, what you verified and how, what nobody checked, and — if worktrees were used — the branches holding the changes, which the user merges.

Worker and reviewer reports are self-reports: do not repeat a claim as fact before you have checked it.`;
}

/** Shown with /swarm on its own. */
export const SWARM_HELP = '  /swarm <goal> plans big work for a team: SEEKER proposes tasks for the board and changes nothing.\n  /swarm go approves the plan: workers do the tasks, a reviewer checks them, SEEKER reports. /swarm off cancels.';
