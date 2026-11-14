---
name: debug
description: Systematic debugging - reproduce the failure, isolate it, form and test hypotheses, fix the root cause, and prove it with a regression test. Use for "this is broken", "why does this fail", an error message or stack trace, "it worked yesterday", "flaky test".
---

# Debug

## When to use
Use this for any defect where the cause isn't already obvious: crashes, wrong output, hangs, flaky tests, "works locally, fails in CI or prod", regressions after a change. If the fix is a one-character typo that's visible in the error, just fix it. Use this procedure when the first guess fails.

## Gather first
- **The exact symptom.** Get the full error text and stack trace, the actual vs. expected output, and when it started. Ask the user only for what you can't get yourself.
- **The environment**: versions (runtime, dependencies, OS), config and env vars, and which data or account triggers it.
- **What changed.** Check recent commits (`git log`, `git diff` against the last known-good state), dependency updates, config changes, deploys.
- **Logs** around the failure time, if the failure happens somewhere you can read.

## Procedure
1. **Reproduce.** Get a reliable, ideally fast, reproduction: a failing test, a script, a curl command, or a sequence of steps. Run it and see the failure yourself. If you can't reproduce it, don't guess-fix. Collect more evidence: add logging, capture inputs, and compare the environments that fail with those that don't. For flaky failures, loop the test many times and record the failure rate, so you can later show it dropped to zero.
2. **Shrink it.** Cut the reproduction down to the smallest input and code path that still fails. Every piece you remove without losing the failure narrows the search.
3. **Isolate.** Find the boundary between correct and incorrect state:
   - **Bisect history**: if it used to work, `git bisect` with the repro as the test finds the breaking commit mechanically.
   - **Bisect the data path**: print or assert intermediate values at the midpoint of the pipeline, then halve again.
   - **Diff environments**: compare versions, env vars, locale and time zone, file system case sensitivity, and concurrency between where it works and where it fails.
   - Read the code at the boundary carefully. Don't skim.
4. **Hypothesise explicitly.** Write each hypothesis down along with the observation that would confirm or kill it, then run that check. Change one variable at a time. Keep a short log of what you tried and what you saw, so you don't loop. If several hypotheses die, step back and re-check assumptions you treated as facts ("this function is definitely called", "the config is loaded").
5. **Find the root cause, not just the trigger.** Ask why the bad state was possible at all. A null check at the crash site often hides a producer that shouldn't emit null. Fix at the source unless there's a reason not to, and if there is, note it.
6. **Write the regression test first.** Turn the reproduction into an automated test at the lowest level that captures the bug. Run it and watch it fail for the right reason.
7. **Fix minimally.** Make the smallest change that addresses the root cause. Avoid unrelated refactors in the same change.
8. **Prove it.**
   - The new test passes.
   - The original reproduction no longer fails.
   - The full relevant suite still passes.
   - For flaky bugs, the loop runs clean many times.
   - Remove temporary logging and debug code.
9. **Look for siblings.** Search the codebase for the same pattern elsewhere and fix or report those instances.

## Common root-cause families to check
- State: stale caches, shared mutable globals, test pollution between cases, or leftover database rows.
- Concurrency: races, missing awaits, non-atomic updates, or event ordering assumptions.
- Boundaries: off-by-one errors, empty collections, time zones and DST, float precision, encoding.
- Environment: missing or different env vars, version drift, path or case differences, network or DNS, permissions.
- Contract drift: an API, schema or dependency changed shape and a consumer wasn't updated.
- Build artefacts: stale compiled output, caches, or a different entry point than you think is running.

## Pitfalls
- Changing several things at once, so you can't tell which one mattered.
- Declaring victory because the symptom disappeared once. Intermittent bugs do that.
- Retrying or adding timeouts to paper over a race.
- Trusting a log line without confirming the code that printed it is the code that's running.

## Report
Lead with the root cause in one or two sentences and the fix. Then give: how it was reproduced, the evidence that pinned the cause, the regression test added, what was run to verify (commands and results), any related instances found, and anything not verified, such as "could not reproduce on the production dataset".
