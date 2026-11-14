---
name: context-handoff
description: Save the current working context - goal, state, decisions, open questions, next steps - to a file, and restore it in a later session; also record durable project learnings. Use for "save context", "write a handoff", "pick up where we left off", "resume", "remember this for next time".
---

# Context handoff

## When to use
- **Save** when a session is ending mid-task, the context window is filling, work is being handed to another person or agent, or the user says "save where we are".
- **Restore** at the start of a session that continues earlier work ("resume", "where were we").
- **Learn** when you discover something durable about the project that future sessions would otherwise rediscover the hard way: a gotcha, a convention, a command that actually typechecks.

Don't use a handoff file as a task tracker for the current session (use the todo list), and don't stuff it with transcripts.

## Where it lives
Use the project's existing convention if there is one, such as a `HANDOFF.md`, a `.notes/` folder, or the agent's memory tool. Otherwise, create a single file outside version control, or ask whether it should be committed. Never write handoff notes into a directory where they will be published or deployed. Never include secrets, tokens or credentials. Refer to where they're stored instead.

## Saving
1. **Gather facts, not impressions.** Current branch and commit (`git branch --show-current`, `git log -1 --oneline`). Uncommitted changes (`git status --short`). Whether anything is running (dev servers, background jobs). The results of the last test and build run.
2. **Write the handoff** in this order, keeping it short enough to read in a minute:
   - **Goal.** What we're trying to achieve, and why, in one or two sentences.
   - **State.** What's done, what's half-done (name the files), and what's untouched. Distinguish verified from assumed.
   - **Decisions.** Choices made and the reason for each, especially rejected alternatives, so the next session doesn't relitigate them.
   - **Open questions and blockers.** What's waiting on the user or on someone external.
   - **Next steps.** An ordered list, with the very next action concrete enough to start immediately ("run X and check Y").
   - **Pointers.** Key files, commands, PR or issue numbers, and the last error message verbatim if one is unresolved.
3. **Date it**, and overwrite or archive the previous handoff rather than appending forever. A stale handoff misleads.
4. **Tell the user** where it was saved and what it says, in two lines.

## Restoring
1. **Read the handoff**, then **verify it against reality** before acting. Does the branch exist? Is the commit the same? Are there new commits since, from teammates or CI bots? Is the "half-done" file still in that state? Are the open PRs still open?
2. **Report the deltas.** If reality moved on, say so. Don't resume a plan built on a world that changed.
3. **Re-run the cheapest check** (tests or build) to re-establish a baseline.
4. **Confirm the next step** with the user if the handoff is more than a day or two old or anything diverged. Otherwise proceed.

## Learnings
- Record only what is **non-obvious, durable and verified**. "The build doesn't typecheck; use `npm run check`" qualifies. "Fixed a typo in header" does not.
- One fact per entry: the rule, why it matters, and how you found out. Keep each to a few lines.
- Before adding, search the existing learnings. Update or replace an entry rather than duplicating it, and delete ones that became false.
- Don't record things already obvious from the code or README. Fix the README instead.

## Pitfalls
- Writing what you *intended* to do as if it were done. Mark the status honestly.
- Handoffs that are a diary. The next reader needs the state, not the story.
- Trusting a restored handoff blindly. It's a hypothesis about the world.
- Leaking personal data or secrets into notes that might be shared.

## Report
For a save, give the file path, plus the goal and next step in one line each. For a restore, give a short summary of the saved state, what differs from reality now, and the next action you propose or are taking.
