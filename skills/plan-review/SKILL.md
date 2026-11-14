---
name: plan-review
description: Stress-test a plan before building - product/scope, engineering (architecture, failure modes, data, tests), design/UX and developer-experience lenses - ending with explicit decisions. Use for "review my plan", "poke holes in this", "is this the right approach", "sanity check before I build".
---

# Plan review

## When to use
Use this when a plan, design doc, RFC, ticket breakdown or "here's what I'm about to build" exists, and building it would cost real time. The goal is to find the expensive mistakes while they're still cheap. It isn't for reviewing finished code (use a code review), or for turning a vague idea into a plan in the first place (use `spec-writing`).

## Gather first
- **The plan itself.** Read all of it. If it's only in the user's head, ask for the goal, the users, and the rough approach in a few sentences.
- **The codebase it lands in.** The modules it touches, existing patterns, data models, and how deploys and migrations work. A plan that ignores existing code is the most common failure.
- **Constraints.** Deadline, team size, budget, what is fixed versus negotiable.
- **Which lenses matter.** Skip the design lens for a backend migration and the DX lens for an internal UI. Say which you skipped and why.

## The lenses
Work through each relevant lens and note findings as you go. Ask, don't just list topics.

**Product and scope**
- What problem, for whom, and how will we know it worked? Is there a measurable signal?
- Is this the smallest version that tests the core bet? What could be cut and still deliver the value?
- What's the strongest argument for not doing this at all, or for buying or reusing instead of building?
- Is there a hidden second project inside, like a migration, a new permission model or a billing change?

**Engineering**
- Data: new tables or fields, ownership, migrations and their reversibility, backfills, and where the data lives in multi-tenant systems.
- Failure modes: what happens when each dependency is slow, down or returns garbage? Retries, idempotency, timeouts, partial failure, duplicate events, clock and timezone issues.
- Concurrency and scale: race conditions, locks, the hot path, and expected volume with a margin.
- Security and privacy: authn/authz at every new entry point, input trust boundaries, secrets, and PII handling.
- Rollout: feature flag, backwards compatibility during deploy, rollback path, and observability (what log or metric tells us it's broken).
- Tests: what proves it works, at which level, and which part is hardest to test.

**Design and UX** (if users see it)
- The primary flow in steps. Empty, loading, error and success states. Mobile and small screens. Accessibility basics.
- Does it match existing patterns in the product, or invent new ones without reason?

**Developer experience** (if developers consume it: API, SDK, CLI, internal platform)
- Time to first success. Naming. Error messages that say what to do next. Defaults. Docs and examples. How breaking changes are versioned and communicated.

## Procedure
1. Restate the plan in three to five sentences and confirm you understood it. Misreadings make the rest worthless.
2. Run the lenses. For each finding, record **severity** (blocks the plan / should change / nice to have), the **evidence** (a file, a constraint, a scenario), and a **suggested alternative**.
3. Check for overreach and underreach: the parts that are gold-plated, and the parts hand-waved as "we'll handle it later" that will actually hurt.
4. Separate decisions that are yours to recommend from those that are truly the user's (strategy, priorities, risk appetite). Ask about the latter, offering options, not open-ended questions.
5. Converge. Don't leave a pile of concerns. Produce a decision list.

## Pitfalls
- Reviewing in the abstract without reading the code the plan touches.
- Treating every concern as equally important. Rank them ruthlessly.
- Rewriting the plan into your own preferred design when the original is acceptable.
- Asking the user a dozen questions they've already answered in the plan.

## Report
Lead with a verdict: proceed, proceed with changes, or rethink. Then list the decisions, each with the choice, the reason, and the owner if not you. Then the blocking issues, the recommended changes, the open questions for the user, and the lenses skipped. Keep the full findings below the summary.
