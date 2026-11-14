---
name: ship
description: Take a finished change to a reviewable pull request - run the checks, self-review the diff, keep the branch clean (cut from main, only intended commits), write the PR description. Use for "ship this", "open a PR", "get this ready for review", "make a pull request".
---

# Ship a change as a pull request

## When to use
Use this when the code is written and believed to work, and the next step is a PR someone else will review. Don't use it to finish half-done work. If the feature is still incomplete, say so and stop. Merging and deploying are separate steps (see `deploy-check`). Do not merge unless the user explicitly asks.

## Gather first
- The repository's default branch (`main`, `master`, `trunk`). Check with `git symbolic-ref refs/remotes/origin/HEAD` or `gh repo view --json defaultBranchRef`. Don't guess.
- How the project checks itself. Look in the README, CONTRIBUTING, CI workflow files, `package.json` scripts, `Makefile`, `pyproject.toml`. Note which command really typechecks and which only builds. Many builds skip type checking.
- Whether the project has a PR template, a changelog policy, or a commit message convention. Look at recent merged PRs and `git log`.
- What the change is supposed to do, in one sentence. If you can't write that sentence, the PR isn't ready.

## Procedure
1. **Check where you are.** Run `git status` and `git branch --show-current`. If you're on the default branch, create a feature branch before committing anything. If you're on some other feature branch, ask whether this work belongs there. Branching off an unrelated branch is how unreviewed work slips into a PR.
2. **Start from fresh main.** Fetch the remote. If the branch wasn't cut from the current default branch, rebase onto it, or cherry-pick the intended commits onto a new branch cut from it. Resolve conflicts deliberately and re-run checks afterwards.
3. **Audit the commit range.** Run `git log --oneline origin/main..HEAD` and `git diff --stat origin/main...HEAD`. Every commit and every file must belong to this change. Remove anything that doesn't: stray debug files, lockfile churn from an unrelated install, generated artefacts, editor config, secrets, large binaries. Never stage with a blanket `git add -A` in a directory you haven't inspected.
4. **Run the checks the CI will run.** Run lint, typecheck, unit tests, and build, in that order, so the cheap ones fail first. If the codebase already had failures before your change, compare against the default branch. The bar is "no new failures", and you must say which ones existed before. Fix your failures. Never skip or delete a test to get green.
5. **Add or update tests.** A behaviour change without a test needs a reason, written in the PR. A bug fix should come with a test that fails without the fix.
6. **Self-review the full diff** as if someone else wrote it. Use the `code-review` skill's approach. Look for logic errors, unhandled errors, missing edge cases, leftover TODOs and console logs, accidental API changes, migrations that aren't safe to re-run or roll back, and secrets. Fix what you find, then re-run the checks you affected.
7. **Exercise the change for real** where possible. Run the CLI command, hit the endpoint, open the page. Tests and builds can't see rendering or wiring mistakes. If you couldn't exercise it, record that.
8. **Tidy the history** to match the project's convention: squash fixups, write commit messages in the imperative, and explain *why* in the body when it isn't obvious.
9. **Confirm before going outward.** Pushing and creating a PR are visible to others. Unless the user already asked for a PR, show the branch name, the commit list and the draft description, then ask. Then push with upstream tracking and create the PR, as a draft if work remains or CI is expected to need iteration.
10. **Watch CI** once it starts. If a check fails, read the log, fix it, and push again. Don't re-run a flaky check repeatedly without saying it's flaky.

## Writing the PR description
- **What and why** in two or three sentences, leading with the user-visible effect.
- **How**: the approach and any non-obvious decisions or alternatives you rejected.
- **Risk**: what could break, migrations, config or env changes, feature flags, and how to roll back.
- **Testing**: the exact commands run and their results, plus manual verification. Be explicit about what was *not* verified.
- Linked issues, and screenshots for UI changes.
- Keep it honest and short. Reviewers distrust padded descriptions.

## Pitfalls
- A PR that bundles a refactor with a behaviour change is hard to review. Split it when practical.
- A green check is not proof the feature works. It only proves what the checks cover.
- Force-pushing a shared branch rewrites other people's base. Use `--force-with-lease`, and only on your own branch.
- Check that "merged" means merged into the default branch. With stacked PRs, a merge can land on the parent branch instead.

## Report
Lead with the PR link (or the ready-to-push branch if you didn't push). Then give the commit count, the checks run with their results, what was exercised manually, known pre-existing failures, and anything left for the reviewer to decide.
