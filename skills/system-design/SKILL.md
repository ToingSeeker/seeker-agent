---
name: system-design
description: Design a system, service or major feature - clarify requirements, sketch components and data flow, weigh alternatives and trade-offs, and record the decision as an ADR. Use for "design a system for", "how should we architect", "X vs Y", "write an ADR", "review this design".
---

# System design and architecture decisions

## When to use
Use this for new services, major features that cross components, technology choices (one queue vs. another, SQL vs. a document store, monolith vs. split), and reviews of a proposed design. For a small local change, just write the code. A design is only useful if it changes what gets built, so keep it as light as the decision allows.

## Gather first
Ask for what you can't infer, and infer what you can from the codebase first:
- **Functional requirements**: the core use cases and who the actors are.
- **Non-functional requirements**: expected scale (requests, data volume, growth) as rough orders of magnitude, latency targets, availability needs, consistency needs (what must never be wrong), security and compliance constraints, and budget.
- **Constraints**: the existing stack and infrastructure, the team's skills, the deadline, and things that can't change.
- **The current system**, if it exists. Read the relevant code, schema and deploy config, so the design fits what's real.

If requirements are unclear, state your assumptions explicitly and confirm the ones that change the design.

## Procedure
1. **Frame the problem** in a few sentences: what it must do, what it must not do, and what success looks like. Also list the non-goals.
2. **Do rough numbers.** Back-of-envelope estimates of the storage, throughput and peak load the design must handle. These decide whether simple options are enough. They usually are.
3. **Start with the simplest design that could work,** usually one service, one relational database and a background job runner. Add components only when a requirement forces them. Draw the components and the data flow in text (a list or a mermaid diagram).
4. **Design the data model.** Cover the entities, ownership, the access patterns that drive indexing, the source of truth for each piece of data, consistency boundaries (what must be transactional), retention and deletion, and how the schema will evolve.
5. **Define the interfaces**: APIs, events and contracts between components. Cover their idempotency, versioning, pagination, and error semantics.
6. **Walk through failure modes.** For each dependency, ask what happens if it's slow, down, or returns garbage. Plan timeouts, retries with backoff, idempotency keys, dead-letter handling, graceful degradation, and what the user sees. Then cover data loss and recovery: backups, replay, reconciliation.
7. **Cover cross-cutting concerns:**
   - authentication, authorization and tenancy
   - secrets
   - observability: logs, metrics, traces, alerts on symptoms users feel
   - deployment and rollback
   - migrations
   - cost
8. **Compare real alternatives.** For each decision that matters, present two or three viable options and evaluate them on the requirements that matter here: complexity, operational burden, cost, fit with the team, scaling headroom, and lock-in. Make the trade-off explicit. Every option gives something up.
9. **Recommend** one option per decision, with the reasoning, the risks, and the signals that would make you revisit it.
10. **Plan the delivery path**: an incremental rollout, what to build first to retire the biggest risk, and what can be deferred.

## Recording decisions (ADR)
When a decision is made, write a short Architecture Decision Record. Use the project's ADR folder and numbering if one exists. Otherwise propose a location, such as `docs/adr/NNNN-short-title.md`. Contents:
- title, date, status (proposed, accepted, superseded)
- **context**: the forces and constraints at the time
- **decision**: what was chosen, in a sentence or two
- **alternatives considered**, and why each was rejected
- **consequences**: what becomes easier, what becomes harder, and the follow-up work

ADRs are immutable history. To change a decision, write a new ADR that supersedes the old one.

## Pitfalls
- Designing for imagined scale. Distributed systems carry real operational cost.
- Picking technology first and requirements second.
- Ignoring the migration from the current system.
- Leaving consistency semantics vague ("eventually it syncs").
- Presenting one option as if there were no trade-off.
- Inventing benchmark figures. Label estimates as estimates, and suggest a quick spike to measure what matters.

## Report
Lead with the recommendation and its main trade-off. Then give the design: requirements and assumptions, the estimates, the components and data flow, the data model, the interfaces, the failure handling, and the alternatives compared. Close with open questions for the user and the ADR, drafted or written.
