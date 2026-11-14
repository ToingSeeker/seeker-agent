---
name: statistical-analysis
description: Choose and run the right statistical test or model, check its assumptions, and report effect sizes and uncertainty honestly; also QA an analysis before it is shared. Use for "is this difference significant", "A/B test results", "run a regression", "what drives X", "check my analysis".
---

# Statistical Analysis

## When to use

Questions about whether a difference, trend or relationship is real and how big it is: comparing groups, A/B tests, correlations, regressions, forecasts, before-and-after comparisons. Also for reviewing someone else's analysis before it goes to a decision-maker.

Not professional advice for clinical, legal, regulatory or safety-critical decisions. For those, or when the stakes are high and the design is complex (clinical trials, survival analysis, causal claims from observational data feeding a major decision), recommend review by a qualified statistician.

## Gather first

- The decision the result will inform, stated plainly. This sets how much uncertainty is acceptable.
- The unit of analysis and how observations were collected: random sample, experiment with randomisation, observational log, convenience sample.
- Whether the hypothesis and metric were fixed before looking at the data. If not, treat the work as exploratory.
- Sample sizes per group, and whether observations are independent (repeated users, clustered stores, time series).
- Profile the data first (see the data-exploration skill if available).

## Choose the method

Reason from the question and the data, not from habit:
- **Compare two groups:** numeric outcome → Welch's t-test (does not assume equal variances); heavily skewed or ordinal → Mann–Whitney or a bootstrap of the difference. Binary outcome → difference in proportions with a confidence interval, or a chi-square/Fisher exact test for small counts.
- **Paired or before/after on the same units:** paired t-test or Wilcoxon signed-rank.
- **More than two groups:** ANOVA or Kruskal–Wallis, then planned comparisons with a multiple-testing correction.
- **Relationship between variables:** scatter plot first; Pearson for linear, Spearman for monotonic; regression when you need to adjust for other variables.
- **Outcome type drives the regression:** linear for continuous, logistic for binary, Poisson or negative binomial for counts.
- **Repeated or clustered data:** mixed-effects models or cluster-robust standard errors; ordinary tests will overstate certainty.
- **Time series:** account for trend, seasonality and autocorrelation; do not run plain regressions on autocorrelated series and trust the p-values.
- **When unsure of distributional assumptions:** bootstrap confidence intervals are a robust default.

Use established libraries (scipy, statsmodels, R if installed) rather than hand-coding formulas.

## Procedure

1. State the hypothesis, metric and test in a sentence before running anything.
2. Plot the data: distributions per group, scatter, or series over time. Many wrong conclusions are visible in one chart.
3. Check assumptions: independence, rough normality of residuals or of the sampling distribution, equal variances where assumed, linearity, influential points. Switch method when an assumption clearly fails, and say so.
4. Run the analysis in a script, with the random seed set where randomness is involved.
5. Compute the **effect size** in meaningful units (the difference in conversion rate, revenue per user, an odds ratio) with a **confidence interval**. The p-value is secondary.
6. Consider practical significance: is the effect large enough to matter for the decision?
7. Run sensitivity checks: with and without outliers, an alternative test, a different reasonable time window. Report if conclusions change.
8. Correct for multiple comparisons when testing many metrics or segments, or label the results as exploratory.

## Validating an analysis (yours or someone else's)

- Re-derive headline numbers independently from raw data.
- Check denominators, filters, joins that duplicate rows, and time windows that differ between groups.
- Look for survivorship and selection bias, Simpson's paradox (a trend reversing within segments), regression to the mean, and peeking (stopping an A/B test when it first looks significant).
- Ask whether a causal claim is justified by the design. Correlation from observational data supports "associated with", not "caused".
- Confirm charts match the numbers in the text.

## Pitfalls

- "Not significant" does not mean "no effect"; it may mean too little data. Report the interval.
- p-hacking: slicing segments until something is significant. Pre-specify or disclose.
- Using means for heavily skewed data such as revenue or latency without also showing medians or quantiles.
- Ignoring that the same user appears many times.
- Over-precise reporting: give sensible significant figures.

## Deliver

Lead with the answer in plain language, including direction, size and uncertainty (e.g. "B converts about 1.2 points higher, 95% CI 0.3 to 2.1"). Then give the method and why it was chosen, assumption checks and their results, sensitivity checks, limitations, and the script path. Say clearly what was not checked and whether the result is confirmatory or exploratory.
