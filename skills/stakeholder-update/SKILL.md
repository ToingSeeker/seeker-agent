---
name: stakeholder-update
description: Write weekly or monthly status updates and roadmap updates for stakeholders: what changed, progress against plan, risks, decisions and asks. Use for "write a status update", "weekly update", "update leadership", "roadmap update", "project status report", "tell stakeholders we're slipping".
---

# Stakeholder Updates

A status update exists so readers can decide whether to act. If nobody would do anything differently after reading it, it is too long or it is hiding something.

Use for recurring project or team updates (weekly, monthly), roadmap changes, and one-off updates when plans change. Not for incident communications in progress; those need their own cadence and owner.

## What to gather first

- Audience: executives, cross-functional partners, customers, board, or the team. Each needs a different depth.
- The previous update, so you report changes rather than repeat the baseline.
- Source material: issue tracker or project board export, merged PRs or git log for the period (if engineering work), milestone dates, metrics, meeting notes. Gather these yourself where you have access.
- The plan or roadmap being reported against.
- Decisions the user needs from readers.

## Procedure

1. **Establish what changed since the last update.** Compare against the previous update and the plan: completed, started, slipped, re-scoped, newly learned. Pull facts from the tracker or repo rather than memory.
2. **Set the overall status honestly.** Use a simple scale such as on track / at risk / off track, defined by whether the next committed date will be met. Status is about the outcome, not effort. If it changed since last time, say so and why.
3. **Write the headline.** One or two sentences that would suffice if the reader stopped there: status, the most important change, and any ask.
4. **Progress.** A few bullets of outcomes, written as results ("customers can now export reports") rather than activity ("worked on exports"). Link to evidence where readers can go deeper.
5. **Risks and issues.** For each: what could go wrong or has gone wrong, impact on dates or scope, what is being done, and whether help is needed. Raise risks early; an at-risk flag two weeks early is worth far more than an off-track flag on the due date.
6. **Decisions and asks.** Specific, with a deadline and named decider: "Need approval by Friday to drop feature X from the March release, or the date moves two weeks."
7. **Next period.** What will be done by the next update, so readers can hold the team to it.
8. **Metrics** if relevant: a small number, the same each time, with trend direction and a one-line interpretation.

## Roadmap updates

- State what changed in the roadmap and why: new information, changed priorities, capacity, dependencies.
- Show before and after for affected items (timeframe, scope).
- Explain trade-offs explicitly: what was moved down so something else could move up.
- Prefer timeframes (now / next / later, or quarters) over exact dates for anything beyond the near term, and label confidence.
- Call out commitments made to customers or other teams that are affected, and who will tell them.

## Tailoring by audience

- **Executives**: headline, status, asks, top risks. Short enough to read in a minute; details linked.
- **Partner teams**: dependencies, dates that affect them, interface changes.
- **Team**: more detail, recognition of contributions, what is next.
- **Customers**: only what affects them, no internal names or blame, no dates you are not confident in.

## Pitfalls

- Watermelon reporting: green outside, red inside. If you would be uncomfortable defending the status colour, change it.
- Burying bad news in the middle of the update.
- Listing every task; readers want outcomes and exceptions.
- Inventing progress or metrics. If data is missing, say "not measured this period".
- Jargon and ticket numbers without explanation for non-team readers.

## Deliverable

Produce the update ready to paste (email, chat, or doc), in this order: headline with status, progress, risks, asks/decisions, next period, optional metrics. Keep a weekly update to roughly what fits on one screen. After the draft, note which facts came from the tracker/repo versus the user's input and anything you could not confirm. Do not post or send it; the user does.
