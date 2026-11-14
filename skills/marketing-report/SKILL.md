---
name: marketing-report
description: Write a marketing performance report - metrics against targets, trends, wins and misses, likely causes, and next actions - from exported data or analytics. Use for "monthly marketing report", "campaign results", "how did we do this quarter", "performance review", "channel report".
---

# Marketing Performance Report

## When to use
- Regular (weekly, monthly, quarterly) reporting to a team, leadership, or a client.
- A campaign or launch retrospective.

When not to use: the data is missing or broken - fix tracking or report the gap instead of filling it with estimates presented as fact.

## Gather first
- The period, the comparison period(s) (previous period, same period last year), and the audience of the report.
- Targets or goals set for the period. Without targets, compare to trend and say so.
- Data: exports (CSV), analytics or ad platform reports, CRM pipeline, revenue data. Note the source and extraction date of each.
- Context: launches, campaigns, price changes, outages, holidays, tracking changes in the period.

## Procedure
1. **Define the metrics** before computing. For each: name, definition, source, and whether it is an outcome (revenue, pipeline, signups, retained customers), a driver (traffic, conversion rate, CTR, cost per click), or a health check (deliverability, site speed). Lead the report with outcomes.
2. **Load and clean the data.** Use a script (python or node) or spreadsheet formulas you can show, not mental arithmetic. Check for duplicate rows, missing days, currency and timezone mismatches, and changed definitions between periods. Reconcile totals across sources where they overlap (ad platform conversions versus CRM signups will differ; explain the difference rather than picking the flattering one).
3. **Compute** actual versus target, change versus the comparison period (absolute and percent), and blended efficiency (cost per acquisition, return on spend) where cost data exists. Avoid percentages on tiny bases; give the counts.
4. **Look at trends**, not just totals: weekly or daily series, so one-off spikes and slow declines are visible. If a chart helps, keep it simple and labelled.
5. **Identify wins and misses.** For each notable movement, decompose it: which channel, campaign, segment, or funnel step drove it? Volume or rate? A rise in signups from more traffic at a lower rate tells a different story than steady traffic converting better.
6. **Explain causes carefully.** Separate what the data shows from what you suspect. Use language like "coincides with" unless there was a controlled test. Check for external explanations (seasonality, tracking changes, a competitor event) before crediting a campaign.
7. **Recommend actions.** Each one tied to a finding, with an owner and an expected effect: scale, fix, stop, or test. Keep it to a few that matter.
8. **Note data issues** that limit confidence and what would fix them.

## Quality bar
- A busy reader gets the point from the first five lines.
- Every number can be traced to a source and a calculation.
- Bad news is reported as plainly as good news.
- No vanity metrics without a link to outcomes.
- Consistent definitions period to period; if a definition changed, flag it.
- Targets are not silently moved.

## Report structure
1. **Summary**: overall status against goals in two or three sentences, the biggest win, the biggest miss, the main recommendation.
2. **Scorecard**: a table of key metrics - actual, target, previous period, change, status.
3. **Channel and campaign detail**: only what explains the scorecard.
4. **Wins and misses with causes**, marked as verified or hypothesised.
5. **Next actions** with owners and dates.
6. **Data notes**: sources, extraction dates, known gaps, definition changes.

## Deliver
The report as a markdown document (or the format asked for), plus the script or workbook used for the numbers so it can be re-run next period. In your reply, lead with the headline result, then state which numbers were computed from source data and which were taken as given or could not be verified. Do not send the report to stakeholders without the user's approval.
