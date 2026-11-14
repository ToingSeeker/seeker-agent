---
name: deploy-check
description: Pre-deploy readiness checklist and post-deploy canary watch - CI, migrations, config, health checks, logs, error rates, and a rollback plan decided in advance. Use for "is this safe to deploy", "deploy checklist", "watch the deploy", "did the release go OK".
---

# Deploy check

## When to use
Use this right before shipping to a shared environment (staging or production), and for the first stretch after a deploy goes live. The deploy itself is an outward-facing action: never trigger, promote or roll back without the user's explicit go-ahead for that specific action. This skill prepares and observes. The user decides.

## Gather first
- **What's being deployed**: the commit or tag, and the diff since the currently running version. Find out what's actually running now, rather than assuming it's the last merge.
- **How deploys happen here**: auto-deploy on merge, a CLI, or a pipeline. Also find out how a rollback is done and how long it takes.
- **Where to observe**: the health endpoint, the log command, any metrics or error-tracking dashboard, and the main user-facing URLs.
- **Who should know**, if the team announces deploys.

## Pre-deploy checklist
Work through each item and record pass, fail or not applicable, with evidence.

1. **Build and CI** are green on the exact commit being deployed, not just a parent commit. Any check that typechecks separately from the build has run.
2. **Diff review.** Nothing unintended is in the range. For risky areas (auth, payments, data deletion), confirm they were reviewed.
3. **Database migrations:**
   - Backward compatible with the currently running code, because during the rollout old and new code run together.
   - Safe to re-run if the runner replays them.
   - No long locks on big tables.
   - Destructive steps (drop, rename) deferred to a later release.
   - A backup or snapshot exists if data could be lost.
4. **Config and secrets.** New env vars are set in the target environment *before* the code that reads them ships. The code fails loudly, not silently, when one is missing.
5. **Dependencies.** Lockfile changes are intended. Runtime version requirements match the target environment's runtime: a package can demand a newer Node or Python than production runs.
6. **Feature flags.** Risky behaviour sits behind a flag where possible, with known default states.
7. **Health check.** The app exposes a health endpoint that touches its real dependencies, and the platform uses it to gate traffic.
8. **Rollback plan**, written down before deploying. State the command or button, the expected time, what happens to migrations already applied, and the trigger condition: what you'll observe that means "roll back now".
9. **Baseline.** Record the current error rate, latency and key log patterns, so "after" has something to compare against.
10. **Timing.** Check that this isn't a peak-traffic moment and that someone can watch for the next while.

If any item fails, stop and report it before the deploy, with the fix.

## Post-deploy canary watch
1. **Confirm the new version is live.** Check the deploy status, then the version or commit reported by the app or its headers. A "successful" build can still crash-loop at boot. Look for repeated restarts.
2. **Health.** Poll the health endpoint and the key pages. Check status and content, not just status.
3. **Logs.** Tail application logs for new error signatures, stack traces, migration failures and boot warnings. Compare them with the baseline, not with zero.
4. **Metrics,** if available: error rate, latency percentiles, throughput, queue depth, and resource use against the baseline.
5. **Smoke-test the critical flows** touched by the change. Use the `qa-web` approach for anything user-facing.
6. **Keep watching.** Check intensively for the first minutes, then periodically. Some failures only appear on scheduled jobs, cache expiry or the first real traffic of a given kind.
7. **If a rollback trigger fires,** report immediately with the evidence and recommend rolling back. Don't stack a hot-fix on top of a broken deploy unless the user chooses that. Get confirmation before executing either.

## Pitfalls
- Deploying code that reads a new env var before the var exists.
- A migration and code change that only work in one order.
- Declaring success at "deploy finished" without checking the running process.
- Reading the logs of a different deployment or replica than the new one.
- Rollback plans that ignore already-applied data changes.

## Report
Before the deploy: give a go or no-go verdict with the checklist results and blocking items. After the deploy: say whether the new version is confirmed live and healthy, the canary findings against the baseline, any anomalies with log excerpts, and the watch duration. State explicitly what wasn't observable, e.g. "no metrics access, so judged from logs and health checks only".
