---
name: retro
description: Run a weekly or sprint retrospective from git history, PRs and tickets - what shipped, what slowed us, patterns, and a few concrete actions; also a short standup mode (yesterday/today/blockers). Use for "retro", "weekly review", "what did we ship", "standup update", "sprint summary".
---

# Retro and standup

## When to use
- **Retro mode** at the end of a week, sprint or milestone, when the team (or a solo developer) wants to see what actually happened and change one or two things.
- **Standup mode** for a short daily status: what got done since the last update, what's next, and what's blocking.

Don't use it for performance reviews of individuals. Retros are about the system of work, not about ranking people. Don't present it as a precise productivity measurement, either. Commit counts and line counts are weak signals.

## Gather first
- **The window.** Default to the last 7 days for a retro and since the last working day for a standup. Confirm if the user implies otherwise ("this sprint").
- **Whose work.** The whole repo, one author (`git config user.email` for "my standup"), or a team.
- **Sources available.** Git is always there. `gh` may give PRs, reviews and issues. A ticket tracker export or CLI may exist. Ask before relying on anything that needs credentials you don't have.

## Collect the evidence
- Commits: `git log --since=<date> --no-merges --pretty='%h %an %ad %s' --date=short` on the default branch, plus open feature branches if relevant.
- Merged and open PRs, with how long each took from opening to merge and how many review rounds it had (`gh pr list --state merged --search "merged:>=<date>"`).
- Reverts, hotfixes and follow-up "fix" commits that touch the same files soon after a merge. These point to quality gaps.
- CI: failure rate on the default branch, and flaky tests that were re-run.
- Tickets: closed, carried over, and added mid-period (scope churn).
- Hotspots: files changed most often (`git log --name-only` then count). Frequent churn in one file can point to a design problem.

## Retro procedure
1. **Summarise what shipped** in user-facing terms, grouped by theme, not as a commit list. Link the PRs.
2. **Note what didn't ship** that was planned, and why, if the evidence shows it (blocked review, scope grew, bug interrupt).
3. **Find patterns, with evidence for each.** Examples to look for:
   - PRs waiting days for a first review.
   - Large PRs that took many rounds.
   - Repeated fixes in the same area.
   - Weekend or late-night bursts before a deadline.
   - Work started but not finished, and context switching across too many threads.
   - Tests added versus code changed.
   State each as an observation backed by numbers or links, not a judgment.
4. **Call out what went well** with the same rigour. Retros that are only complaints stop being run.
5. **Propose two or three actions.** Each one specific, owned and checkable by next retro ("cap PR size at roughly N files; split otherwise", "add a test for the parser before touching it again"). Check whether last retro's actions were done, if a previous retro exists.
6. **Mark the limits.** Pair work, design time, reviews and incidents often don't show in git. Ask the user to fill in what the data can't see.

## Standup procedure
1. Collect the commits, PRs opened, reviewed and merged, and ticket moves since the last working day.
2. Write three short sections: **Done** (outcomes, not commit messages), **Next** (from open branches, assigned tickets, or what the user says), and **Blockers** (waiting on review, on decisions, or on other people).
3. Keep it to a handful of bullets. A standup is read in thirty seconds.

## Pitfalls
- Treating lines of code or commit counts as productivity.
- Naming and blaming individuals in a shared document.
- Inventing causes the data doesn't show. Say "possible" and ask.
- Squash-merge histories hide individual commits, so count PRs instead.
- Bots (dependency updaters) inflate the numbers. Filter them out.

## Report
For a retro, give the shipped summary first, then patterns with evidence, then wins, then the proposed actions, and finally what the data could not show. For a standup, give the three sections only, ready to paste.
