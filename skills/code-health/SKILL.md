---
name: code-health
description: Survey a codebase's health and technical debt - tests, types, dependencies, complexity, duplication, hotspots - rank items by cost and risk, and propose an incremental paydown plan. Use for "tech debt audit", "how healthy is this codebase", "what should we refactor", "code quality".
---

# Code health and tech debt

## When to use
Use this for a whole-repo or whole-module assessment, to decide where cleanup effort pays off. It produces a ranked list and a plan. It doesn't start a big refactor. For a single PR use `code-review`. For security issues use `security-audit`; note any you spot here and hand them over.

## Gather first
- **The repo's shape**: languages, size (file counts by type), entry points, how it's built and tested, its age, and how many people contribute (`git shortlog -sn`).
- **The checks the project has**: linter, typechecker, test runner, coverage. Note which command really typechecks.
- **What hurts the team today.** Ask the user briefly what's slow, scary or frequently broken. That pain anchors the ranking.

## Procedure
1. **Run the existing signals** and record the raw results, without fixing anything:
   - typecheck error count and lint error count, by rule if useful
   - test suite: pass, fail and skip counts, duration, flakiness if you can rerun it
   - coverage, if configured
   - build time and warnings
2. **Dependencies.** List outdated packages (major versions behind), deprecated or abandoned ones, known vulnerabilities from the ecosystem's audit tool, duplicate packages that do the same job, and a runtime version that's out of support.
3. **Hotspots.** Combine *change frequency* (`git log --format= --name-only` counted by file over a recent window) with *size or complexity* (line count, function length, nesting depth). Files that are large and change often are where debt costs the most. Also look for files that always change together but live far apart, which signals hidden coupling.
4. **Structural smells**, sampled in the hotspots:
   - god modules
   - circular imports
   - copy-pasted logic
   - dead code and unused exports
   - stringly-typed data
   - error handling that swallows failures
   - configuration scattered across files
   - layering violations, such as UI code querying the database
5. **Test health.** Look for:
   - critical paths with no tests
   - tests that assert nothing meaningful
   - slow or flaky tests
   - heavy mocking that tests the mocks
   - duplicate tests
   - test-only code kept alive in production paths
6. **Operational debt.** Look for missing or stale docs for setup and deploy, manual release steps, absent health checks or alerts, and TODO, FIXME and HACK comments. Count them and sample the oldest.
7. **Rank every item.** Score it on:
   - **Impact**: how much it slows work, or how likely it is to cause a defect or incident.
   - **Risk if ignored**: security, data loss, a version going out of support.
   - **Effort**: small, medium or large.

   Put high-impact, low-effort items first. Large items need a clear payoff and should be split into steps.
8. **Build the plan.** Group the work into increments that can each ship independently, keep the system working, and come with their own verification. Typical order: put a safety net around the hotspot (tests, types), then refactor it, then remove dead code. Suggest guardrails that stop debt returning, such as a lint rule, a CI check, or a budget.

## Quality bar
- Every finding cites evidence: a command output, a `file:line`, a count. Don't characterise code you haven't opened.
- Separate measured facts from judgement calls.
- Respect deliberate choices. Code that looks odd may be load-bearing. Check history and comments before calling it debt, and flag "verify before removing" where unsure.
- Don't propose a rewrite unless incremental change is clearly impossible, and say why.

## Pitfalls
- Ranking by what's ugly rather than by what costs time or risk.
- Recommending dependency upgrades without checking for breaking changes and runtime compatibility.
- Treating coverage percentage as quality.
- Mass-renaming identifiers whose values are stored or external (slugs, event names, database values). These break silently.

## Report
Start with a short health summary: the top three issues and why they matter. Then give a table of signals with their numbers, the ranked debt list (item, evidence, impact, risk, effort), and the phased paydown plan with the first step ready to start. Close with what wasn't assessed.
