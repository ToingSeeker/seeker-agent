---
name: incident-response
description: Run a production incident - assess severity, mitigate before root-causing, keep stakeholders updated, keep a timeline, and write a blameless postmortem. Use for "production is down", "we have an incident", "users can't log in", "write the postmortem", "status update".
---

# Incident response

## When to use
Use this when something in production is broken or degraded for real users, or when writing up an incident afterwards. For a bug with no live user impact, use `debug` instead. During an incident the priority order is: stop the harm, restore service, understand the cause. Speed matters, but so does not making it worse. Get the user's explicit confirmation before any production-changing action: rollback, restart, scaling, a config change, or a data fix.

## Gather first (fast, minutes, not hours)
- **The symptom from the user's point of view**: what's broken, for whom, and since when.
- **Blast radius**: all users or some, one region or feature or tenant, and whether data is being lost or corrupted.
- **What changed recently**: deploys, config, migrations, dependency or provider incidents, traffic spikes, certificate or domain expiry.
- **Your access**: logs, metrics, the deploy history, the provider status page.

## Severity
Pick a level quickly and revise it as you learn more. As a rule of thumb:
- **SEV1**: a core service is down or data is being lost or exposed, for many users.
- **SEV2**: a major feature is broken or performance is badly degraded, or a subset of users is fully blocked.
- **SEV3**: a minor feature is broken, or a workaround exists.

Suspected data exposure or security compromise is always top severity and has extra obligations. Flag that the user may need legal, privacy or security people involved. This skill isn't legal advice.

## Procedure
1. **Open a timeline** immediately, in a scratch file or the incident channel. Log every observation and action with a UTC timestamp. You'll need it later, and memory is unreliable under pressure.
2. **Mitigate first.** Look for the fastest safe way to restore service, even if it doesn't fix the cause:
   - roll back the last deploy
   - turn off the feature flag
   - fail over, or scale up
   - block the abusive traffic
   - put up a maintenance page
   - pause the job that's corrupting data

   Propose the option with its expected effect and risk, get confirmation, execute, then verify that service actually recovered by checking the health endpoint, logs and metrics against normal.
3. **Contain data damage.** If data is being corrupted, stopping the writer comes before everything else. Snapshot the current state before attempting any repair.
4. **Communicate** on a regular cadence: an update when the incident is declared, then every so often even if there's no news, then at resolution. Each update covers what's affected, current status, what's being done, and when the next update comes. Say only what's known, and mark guesses as guesses. Draft customer-facing status text for the user to approve. Don't publish it yourself.
5. **Diagnose** once the bleeding has stopped. Use the `debug` procedure: reproduce, isolate, and find the root cause and the contributing factors. Preserve the evidence (logs, the failing request, metrics screenshots) before it rotates away.
6. **Fix properly.** Make the real fix through the normal review path, with a regression test. Undo any temporary mitigations deliberately, not by accident.
7. **Declare resolved** only after the metrics have stayed back at baseline for a reasonable period and the affected flows have been verified.

## Blameless postmortem
Write it within a few days while the details are fresh. Cover:
- **Summary**: what happened, impact (duration, users or requests affected, data impact), and severity.
- **Timeline**: detection, escalation, mitigation and resolution, with timestamps. Include the time to detect and the time to mitigate.
- **Root cause and contributing factors**: the technical chain, plus why the safeguards (tests, review, alerts, staged rollout) didn't catch it. Use "five whys" thinking, but stop at actionable causes.
- **What went well** and **what was hard**.
- **Action items**, each with an owner and a priority. Favour ones that prevent a whole class of failure (an alert, a guard, a test, a runbook) over "be more careful".

Write about systems and decisions, never about individuals' failings. People acted reasonably on the information they had. The question is why the system made the wrong action easy.

## Pitfalls
- Root-causing for an hour while users stay down.
- Making several changes at once during mitigation, so you can't tell which one helped.
- Going silent with stakeholders.
- Declaring resolved on the first green check.
- Postmortem actions with no owner, which never happen.

## Report
During the incident: give current status, severity, impact, the mitigation applied and whether it was verified, and the next step. After it: provide the postmortem document and the list of action items, and note any facts still unconfirmed.
