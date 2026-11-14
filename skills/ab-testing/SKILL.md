---
name: ab-testing
description: Design and analyse an A/B or split test - hypothesis, primary metric, sample size and power, run length, guardrails, readout. Use for "set up an experiment", "how many users do I need", "is this test significant", "should we ship variant B".
---

# A/B Testing

## When to use
- Someone wants to know whether a change (copy, pricing page, onboarding step, algorithm) causes a better outcome.
- An existing test needs a sanity check or a readout.

When not to use: traffic is too small to detect any plausible effect (say so and suggest qualitative research, a before/after with caveats, or a bigger change); the change is a bug fix or legal requirement (just ship it); the outcome takes months to observe and no leading indicator exists.

## Gather first
- The change and the reason anyone expects it to help (evidence, not hope).
- The decision the test will drive, and who makes it.
- Baseline rate or mean for the primary metric, and its variance if continuous. Pull it from real data; do not guess.
- Weekly eligible traffic at the point of exposure, not site-wide traffic.
- How assignment works today (feature flag library, server-side bucketing, a testing tool) and where events are logged.

## Procedure
1. **Write the hypothesis in one sentence**: "Because <evidence>, changing <X> for <audience> will move <metric> in <direction>." If you cannot fill in the evidence, flag the test as exploratory.
2. **Pick one primary metric** that the change can plausibly move and that matters to the business. Define numerator, denominator, attribution window, and the unit of analysis. The unit of randomisation should match the unit of analysis (usually user, not session or pageview).
3. **Choose guardrails**: two to four metrics that must not get worse (revenue per user, refund rate, latency, error rate, unsubscribe rate). Decide in advance what degradation would block shipping.
4. **Set the minimum detectable effect** as the smallest lift worth the cost of shipping and maintaining the change. Not the lift you hope for.
5. **Compute sample size** with a standard power calculation (two-sided, alpha 0.05 and power 0.8 are common defaults; state whatever you use). Write a short script in python or node rather than eyeballing it, and show the inputs. Convert to duration: required users per arm divided by eligible users per arm per day. Round up to whole weeks so weekday/weekend cycles are balanced.
6. **If the duration is unreasonable**, say so and offer options: a larger MDE, a more sensitive metric earlier in the funnel, variance reduction using a pre-period covariate (CUPED-style), fewer arms, or not testing.
7. **Specify the setup**: arms and traffic split, eligibility rules, exposure point (log assignment where the user actually sees the difference), exclusions (internal staff, bots), start date and fixed stop date. Write this into a short plan document before launch.
8. **Pre-launch checks**: run an A/A or at least verify both arms render, events fire once per exposure, and assignment is sticky across sessions and devices where possible.
9. **During the run**: monitor guardrails and data health only. Do not stop for a "winning" result before the planned sample unless you designed a sequential test with corrected boundaries.
10. **Analyse**:
    - First check sample ratio mismatch: compare observed arm sizes to the planned split with a chi-square test. A significant mismatch means the assignment or logging is broken; do not interpret the results until it is explained.
    - Report the effect as an absolute and relative difference with a confidence interval, plus the p-value. The interval matters more than the verdict.
    - Check guardrails against their thresholds.
    - Segment cuts (device, new vs returning, country) are for generating hypotheses, not for rescuing a flat test. Correct for multiple comparisons if you report them as findings.
11. **Decide** using the rule written before launch: ship, don't ship, or iterate. A non-significant result is "no detectable effect at this size", not "no effect".

## Common mistakes
- **Peeking**: checking repeatedly and stopping at the first significant reading inflates false positives far above the nominal rate. Fix the horizon or use a sequential method.
- **SRM ignored**: an uneven split is a symptom of redirects, bot filtering, crashes in one arm, or late assignment.
- **Novelty and primacy effects**: early lift that fades. Look at the effect by week.
- **Too many metrics**: with twenty metrics one will be "significant" by chance.
- **Wrong unit**: randomising by session but counting users double-counts and narrows intervals falsely.
- **Interference**: users in different arms sharing a marketplace, inventory, or social feed contaminate each other; consider cluster or time-based designs.
- **Running during anomalies**: big promotions, outages, or holidays make the result unrepresentative.
- **Shipping a loser because a segment won**: that is a new hypothesis, test it.

## Deliver
- **Plan** (before launch): hypothesis, primary metric definition, guardrails with thresholds, MDE, sample size with the calculation inputs, duration, split, exposure point, stop date, decision rule.
- **Readout** (after): lead with the decision and the effect with its interval. Then SRM check result, guardrails, data quality notes, and what was not verified (for example "event deduplication not checked against raw logs"). Attach the script used for the numbers so they can be re-run.

Never present a projected revenue impact as certain; give the range implied by the confidence interval and state the assumptions.
