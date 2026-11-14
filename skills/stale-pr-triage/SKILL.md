---
name: stale-pr-triage
description: Bring an old pull request onto the current base branch and decide whether to modernize it, rework it from scratch, or close it - with evidence. Use for "revive this PR", "is this old PR still worth merging", "rebase this stale branch", "clean up old PRs".
---

# Stale PR triage

## When to use
Use this for a pull request or branch that has sat for weeks or months while the base moved on. You're answering one question with evidence: is this still worth landing, and what's the cheapest honest path? Don't use it for a fresh PR that just needs review (use a code review), or for work in progress the author is actively pushing to.

## Gather first
- **The PR itself.** Title, description, linked issue, review comments, CI history and the author. Read with `gh pr view <n> --comments` and `gh pr diff <n>`.
- **The base.** How far it has moved: `git log --oneline <merge-base>..origin/main | wc -l`, and which files changed under the PR's feet.
- **Whether the problem still exists.** Check whether the issue was fixed some other way since, whether the feature was dropped, and whether the code it touches was deleted or rewritten.
- **Ownership.** Whose PR it is. Closing or force-pushing someone else's branch is a social act. Confirm with the user before doing either.

## Procedure
1. **Restate the intent** in one or two sentences, from the description and diff. If you can't, that alone is a signal toward closing.
2. **Check relevance on current main.** Reproduce the original bug or missing behaviour on main if you can. If main already behaves correctly, the PR's purpose is gone.
3. **Work on a copy.** Create a local branch from the PR head, or a separate worktree, so the original stays untouched. Rebase or merge onto the current base. Record the conflicts: how many files, and whether they're mechanical (renames, formatting, moved imports) or semantic (the logic the PR changes was itself changed).
4. **Run the checks** on the updated branch: build, typecheck, tests. Compare against main's baseline so you only count new failures.
5. **Re-review the diff against today's code.** Look for APIs it calls that are now deprecated, patterns the codebase has since abandoned, duplicates of helpers that now exist, migrations numbered against an old sequence, and dependency versions that have since been bumped.
6. **Decide**, using these rough guides:
   - **Modernize.** The intent still matters, conflicts were mostly mechanical, and it passes checks after small fixes. Push the update (to your own branch, or with the owner's agreement) and request review.
   - **Rework.** The intent still matters, but the code it touches was rewritten, or the approach no longer fits. Start a fresh branch from main that reuses the idea and tests, not the diff. Credit the original author, and link the old PR.
   - **Close.** The problem is solved elsewhere, the feature was dropped, nobody can state the intent, or the cost now exceeds the value. Write a polite closing comment explaining why and what superseded it.
7. **Confirm before acting outward.** Force-pushing, commenting, closing and opening PRs are visible to others. Show the user the decision, the evidence and the exact comment text first, unless they pre-authorised it.

## Quality bar
- The decision rests on something you ran or read, not on the PR's age.
- Conflicts were resolved by understanding both sides, not by taking "ours" or "theirs" wholesale.
- Tests the PR added still test something meaningful after the rebase.
- Nothing from the old branch lands on main without passing today's checks.

## Pitfalls
- A clean rebase can still be semantically wrong, for example when a function it calls changed meaning. Run things.
- Lockfile conflicts: regenerate the lockfile from the current base rather than hand-merging it.
- Migrations: renumber them against the current sequence, and check they don't collide with ones already applied.
- Closing a contributor's PR without explanation costs goodwill. Always say why, and thank them.

## Report
Lead with the verdict (modernize, rework or close) and a one-line reason. Then give the conflict summary, the check results on the updated branch, what changed in the base that matters, the actions taken or proposed (with branch and PR links), and anything you could not verify.
