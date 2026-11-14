---
name: data-exploration
description: Profile an unfamiliar dataset before analysing it: shape, column types, missing values, distributions, keys and duplicates, joins, and data-quality problems. Use for "explore this CSV", "what's in this table", "profile the data", "check data quality", "is this data clean".
---

# Data Exploration

## When to use

First contact with a dataset: a file, a database table, an export, an API dump. Also before any analysis whose conclusions depend on data you have not inspected. Not a substitute for answering the user's actual question; it is the step that makes the answer trustworthy.

## Gather first

- Where the data came from and how it was produced (export, log, survey, scrape). Ask if the user knows; the generating process explains most oddities.
- What one row represents (the grain). Write this down in a sentence; if you cannot, that is your first finding.
- Expected size, time range, and any known caveats.
- The question it is meant to answer, so the profile can focus on the columns that matter.

## Tools

Use what is available: pandas or polars in Python, DuckDB (excellent for querying CSV/Parquet directly with SQL), the database's own SQL client, or `csvkit`/`awk` for quick looks. For large files, sample or query in place rather than loading everything into memory. Keep queries read-only against live databases.

## Procedure

1. **Open safely.** Peek at the raw first lines before parsing: delimiter, quoting, encoding, header row, footer junk. Parse with explicit options rather than trusting auto-detection.
2. **Shape.** Row and column counts. Compare with what the user expected; a mismatch means truncation, duplicated exports or parse errors.
3. **Types.** For each column, the stored type versus the semantic type (a numeric-looking ID is a label, a date stored as text needs parsing). Note columns that failed to parse and why.
4. **Completeness.** Null count and rate per column. Also look for disguised missing values: empty strings, "N/A", "null", "-", 0, -1, 1900-01-01, 9999. Check whether missingness clusters in time or by category.
5. **Distributions.**
   - Numeric: min, max, mean, median, quartiles, standard deviation, count of zeros and negatives. Look at a histogram or quantiles, not only the mean.
   - Categorical: number of distinct values, top values with counts, rare values, spelling and case variants of the same thing.
   - Dates: range, gaps, future dates, suspicious spikes (often batch loads or defaults), time zone.
   - Text: lengths, encoding glitches, leading or trailing whitespace.
6. **Keys and duplicates.** Test candidate primary keys for uniqueness. Count exact duplicate rows and duplicates on the key. Decide which are real repeats and which are errors, and ask the user when it is genuinely their call.
7. **Relationships.** For multiple tables, check join keys: match rates in both directions, orphan rows, and whether a join would fan out (one-to-many where one-to-one was assumed).
8. **Consistency rules.** Check domain logic: end after start, totals equal the sum of parts, percentages within 0–100, ages plausible, statuses consistent with timestamps.
9. **Outliers.** Flag extreme values and inspect the actual rows. Distinguish errors (unit mix-ups, typos) from real but rare events. Do not delete either silently.
10. **Write down findings** as you go, with counts, so they can be reproduced.

## Quality bar

- Every claim in the profile has a number behind it, produced by code you ran.
- Make cleaning decisions explicitly and reversibly: keep the raw data untouched, write cleaning steps as a script, and log what each step removed or changed.
- Distinguish "the data says" from "I assume". Unknown grain, unknown units and unknown time zones are findings, not footnotes.
- Do not over-profile. Twenty columns of identical summary output helps nobody; highlight what is surprising or decision-relevant.

## Pitfalls

- Auto-parsed dates swapping day and month.
- Float IDs losing precision or leading zeros.
- Summary statistics that mix currencies, units or time zones.
- Treating a sample as the whole: say when you sampled and how.
- Silently dropping rows with nulls, which biases everything afterwards.

## Deliver

Start with a short verdict: what the data is (grain, size, period) and whether it is fit for the intended use. Then:
- a compact table per important column (type, null %, distinct count, range or top values);
- the quality issues ranked by impact, each with a count and an example;
- recommended cleaning steps and open questions for the user.

Save the profiling script alongside the data so it can be re-run, and say which checks you did not do (for example, columns skipped or a sampled rather than full scan).
