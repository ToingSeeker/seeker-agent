---
name: testing-strategy
description: Decide what to test at which level (unit, integration, end-to-end, contract), write a focused test plan, and implement the first high-value tests. Also prune low-value tests. Use for "how should we test this", "test plan", "what tests do we need", "our tests are slow/flaky".
---

# Testing strategy

## When to use
Use this when starting tests for a feature or an untested codebase, when the existing suite is slow, flaky or not catching bugs, or before a risky change that needs a safety net. The goal is confidence per unit of effort, not a coverage number.

## Gather first
- **What the system does and what failure would cost.** Money, data, auth and core flows deserve the most protection.
- **The existing setup**: test runner, folder conventions, fixtures and factories, how the database and external services are handled in tests, CI configuration, current run time and flakiness.
- **The current suite's state.** Run it and record pass, fail and skip counts and the duration.
- **Known bug history**: recent incidents and regressions show where tests were missing.

## Choosing the level
For each behaviour, choose the cheapest test that would catch a realistic bug:
- **Unit**: pure logic with many input combinations (calculations, parsers, validation, state machines). Fast, so cover the edge cases here.
- **Integration**: code meeting a real boundary: database queries and transactions, HTTP handlers through the framework, serialisation, the auth middleware. Many costly bugs live here, so prefer a real or embedded database over mocks when it's practical.
- **Contract**: the agreed shape between services, or between client and API, so either side notices drift.
- **End-to-end**: a few critical user journeys through the real UI and stack. They're slow and brittle, so keep them few and focused on flows whose breakage is unacceptable.
- **Property-based or fuzz**: parsers, serialisers and anything with invariants ("encode then decode returns the input").

Mock only what you don't own or can't run cheaply: third-party APIs, the clock, randomness. Over-mocking produces tests that pass while the real integration fails.

## Procedure
1. **Inventory the risks.** List the behaviours and failure modes for the target, then rank them by likelihood times impact.
2. **Map each risk to a level** using the guide above. Note what's deliberately not tested, and why.
3. **Write the plan.** A short document or PR section covering:
   - scope
   - the risks and the test level for each
   - the data and fixture approach
   - how external dependencies are handled
   - CI placement: what runs on every push and what runs nightly
   - exit criteria
4. **Make the infrastructure solid first.** Tests need deterministic setup and teardown, isolated data per test, a frozen or injected clock, seeded randomness, and no ordering dependence. Flakiness usually comes from shared state, real time, or network calls.
5. **Implement the first tests:**
   - the highest-risk behaviours
   - one end-to-end smoke test of the core journey
   - regression tests for known past bugs

   Follow the project's conventions and name each test for the behaviour it checks. Give each one assertions that would fail if the code were wrong. Check this by temporarily breaking the code (or mutating a condition) and seeing the test fail.
6. **Prune the suite** if it's bloated. Look for duplicates, tests that assert nothing meaningful, tests coupled to implementation details that break on every refactor, and test-only hooks kept alive in production code. Delete or consolidate them, with a reason recorded for each.
7. **Run everything** and record the new counts and duration. Run any new tests several times to check stability.

## Quality bar
- Tests check behaviour through public interfaces, not private internals.
- Each test fails for one clear reason, and its failure message tells you what broke.
- Test data is built in the test or by small factories. Avoid giant shared fixtures.
- The suite is fast enough that people run it. When it isn't, split it into fast and slow tiers rather than skipping tests.

## Pitfalls
- Chasing coverage percentage with trivial tests.
- Snapshot tests nobody reads, approved blindly on every change.
- Sleeping for fixed durations instead of waiting for a condition.
- Testing against production services or real customer data.

## Report
Lead with the plan summary: the top risks and the level chosen for each. Then list the tests written (files and what they cover), the suite results before and after (counts and duration), anything pruned and why, and the gaps left for later.
