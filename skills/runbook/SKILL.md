---
name: runbook
description: Write operational runbooks and process docs that someone unfamiliar can follow under pressure: triggers, prerequisites, exact steps, verification, rollback, escalation. Use for "write a runbook", "document this process", "on-call playbook", "how do we restore the database", "SOP for X".
---

# Runbooks and Process Docs

The test of a runbook is simple: can a competent person who has never done this task, woken at 3am, follow it to a correct result without asking anyone? Write for that person.

Use for operational procedures (deploys, restores, failovers, rotating credentials, responding to an alert) and for recurring business processes (onboarding a customer, monthly billing run, access requests). Not for architecture explanations or design decisions; those belong in design docs that the runbook can link to.

## What to gather first

- The task and its trigger: what alert, request, or schedule causes someone to run it.
- How it is done today: ask the person who does it, read existing notes, shell history, scripts, CI config, and infrastructure code. Search the repo for the commands and config involved.
- Systems, access, and permissions required.
- What can go wrong and what has gone wrong before (past incident notes help a lot).
- Who to escalate to and how to reach them (roles, not personal phone numbers in the doc, unless the team's practice is otherwise).

## Procedure

1. **Define scope.** One runbook, one task. If the procedure branches heavily, split it and link between them.
2. **Write the header:**
   - Purpose (one sentence) and when to use it; also when **not** to use it.
   - Trigger: the exact alert name or request that starts it.
   - Expected duration and impact (downtime? customer-visible?).
   - Required access and tools, and how to check you have them before starting.
   - Owner and last-verified date.
3. **Write the steps.**
   - Numbered, one action per step.
   - Exact commands in code blocks, copy-pasteable, with placeholders clearly marked (e.g. `<ENVIRONMENT>`) and an explanation of where to find each value.
   - After each meaningful step, a check: what output or state proves it worked, and what to do if it did not.
   - Mark dangerous steps visibly (data deletion, production changes, anything irreversible) and say what to confirm before running them.
   - Decision points as explicit conditions: "If the replica lag is above the threshold in the dashboard, go to step 9; otherwise continue."
   - Avoid relying on knowledge in someone's head: no "restart the usual way".
4. **Verification.** How to confirm the whole task succeeded from the user's perspective, not just that commands exited cleanly.
5. **Rollback.** How to undo, the point of no return, and what to do if rollback fails.
6. **Escalation.** When to stop and call for help (time limits, specific symptoms), who to call, and what information to bring.
7. **Communication.** Who needs to be told before, during, and after (status page, customer support, stakeholders), with a short template if useful.
8. **Business process docs** use the same skeleton with roles instead of commands: who does each step, inputs, outputs, tools, deadlines, and handoffs. A simple flow (numbered steps or a small diagram) helps when several people are involved.

## Test it

A runbook that has never been executed is a guess. Where safe:

- Run read-only steps and checks yourself to confirm the commands and output are accurate.
- Never run destructive or production-changing steps to test the doc without explicit approval; prefer a staging environment or a dry-run flag.
- Ask someone unfamiliar with the task to walk through it and note every point they hesitated.
- Record which steps were verified and when, in the doc itself.

## Quality bar

- No secrets in the document; reference where they are stored.
- No undefined acronyms or internal nicknames without explanation.
- Every external dependency (dashboard, console, script) is named with how to reach it.
- Short sentences; imperative verbs; one idea per line.
- Kept close to the system it describes (e.g. in the repo's docs folder) so it is updated with changes.

## Pitfalls

- Writing the happy path only. The runbook is mostly needed when things are not happy.
- Steps that depend on the current directory, shell, or environment without saying so.
- Commands copied from history that include one-off values.
- Stale runbooks: include a last-verified date and a review trigger (e.g. when the related system changes).

## Deliverable

Write the runbook as a Markdown file where the user wants it (ask if there is no obvious docs location). Report: the file path, a one-line summary of the procedure, which steps you verified by running (and the result), which are unverified, and open questions for the task owner.
