---
name: spec-writing
description: Turn a vague idea or request into a buildable spec or PRD - problem, users, goals and non-goals, scope, user flows, acceptance criteria, risks, open questions. Use for "write a spec", "PRD for", "scope this feature", "turn this into requirements", "what exactly should we build".
---

# Spec writing

## When to use
Use this when there's an idea, a customer request or a one-line ticket, and someone needs to know exactly what to build and how to tell when it's done. Don't use it for a technical design of an already-agreed feature (that's a design doc), or for reviewing an existing plan (use `plan-review`).

## Gather first
- **The trigger.** Who asked, what they said verbatim, and what pain they described. Requests usually arrive as solutions ("add a CSV export"). Find the underlying need ("finance reconciles monthly in a spreadsheet").
- **Current behaviour.** Read the relevant code and screens, so the spec describes a change from what really exists.
- **Constraints.** Deadline, platforms, compliance, dependencies on other teams.
- **Ask only what you can't infer.** Batch the questions, offer likely answers as options, and proceed with clearly marked assumptions when the user prefers speed.

## Procedure
1. **Write the problem statement first**, in two or three sentences: who is affected, what they're trying to do, what goes wrong today, and what it costs them. If you can't write it, stop and ask. Everything else depends on it.
2. **Name the users and the primary job.** One primary persona or role. Secondary ones only if they change requirements.
3. **Set goals and non-goals.** Goals are outcomes, ideally measurable ("a manager can approve a request without leaving the notification"). Non-goals are explicit exclusions that someone will otherwise assume are included. Non-goals prevent most scope fights.
4. **Define the scope.**
   - Describe the main flow as numbered steps from the user's point of view.
   - Then cover the edge cases: empty data, errors, permissions, concurrency, limits, and what happens to existing data.
   - Mark each requirement as must, should or later, so the first version stays small.
5. **Write acceptance criteria that can be tested.** Use concrete given/when/then statements, or plain checklists, specific enough that two people would agree whether it passes. Include at least one failure-path criterion per flow. Avoid "fast", "intuitive" and "robust" unless you quantify them.
6. **Add success measures.** How we'll know after launch that it worked: a metric, a support-ticket trend, a user action. Note if instrumentation is needed.
7. **List risks, dependencies and open questions.** Each open question has an owner and a "needed by" point. Separate the unknowns that block the build from those that can be decided during it.
8. **Sketch the implementation only as far as it de-risks the spec.** That means affected areas, data changes, and rough size. Leave the detailed design to the builders unless asked.
9. **Review your own draft** against the codebase. Check every flow is possible with the existing data model, or flagged as needing changes. Remove anything that crept beyond the goals.

## Quality bar
- A developer could start building from it, and a tester could write test cases from it, without a meeting.
- Every must-have maps to at least one acceptance criterion.
- Assumptions are labelled as assumptions.
- Short. Aim for something read in ten minutes, and push detail into appendices if needed.

## Pitfalls
- Specifying the UI pixel by pixel while leaving the behaviour vague.
- Copying the requester's proposed solution without testing it against the problem.
- No non-goals, so scope creeps through "while we're at it".
- Acceptance criteria that restate requirements instead of describing observable outcomes.
- Inventing metrics baselines. If the current number is unknown, say so and propose how to measure it.

## Deliver
Save the spec where the project keeps such documents (ask if there's no convention), or return it inline. In the report, lead with the one-paragraph problem and the proposed first-version scope. Then list the assumptions you made and the open questions that need the user's decision before building.
