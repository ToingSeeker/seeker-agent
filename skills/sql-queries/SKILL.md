---
name: sql-queries
description: Write correct, fast SQL for the dialect in use - read the schema first, build in testable CTE steps, check results, read EXPLAIN plans, make writes safe with transactions. Use for "write a query", "why is this query slow", "SQL for", "translate this to Postgres/BigQuery", "update these rows".
---

# SQL queries

## When to use
Use this to turn a data question into SQL, optimise a slow query, port SQL between dialects, or run data changes (UPDATE, DELETE, backfills) safely. For exploratory analysis of an unfamiliar dataset, start with `data-exploration` if available. For schema migrations in an app, follow the project's migration tooling rather than ad-hoc DDL.

## Gather first
- **The dialect and version.** PostgreSQL, MySQL, SQLite, SQL Server, BigQuery, Snowflake and so on. Check the connection string, ORM config or driver. Functions, date handling, quoting and `LIMIT` syntax differ.
- **The real schema.** List the tables and columns from the database itself (`information_schema`, `\d table` in psql, `DESCRIBE`) or from migrations or ORM models. Note the primary and foreign keys, nullability, indexes, types (especially timestamps with or without time zones, and money as numeric versus float) and soft-delete flags.
- **Grain and definitions.** What one row of the answer represents, and what each business term means ("active user", "revenue": gross or net, refunds included?). Ask when a definition changes the answer.
- **Environment.** Is this production, a replica or a dev copy? Read-only access is the default posture.

## Writing a query
1. **State the output's grain and columns** before writing.
2. **Build with CTEs, step by step**: filter, then join, then aggregate, then shape the output. Run each step with a `LIMIT` and look at the rows. Checking intermediate counts catches most bugs.
3. **Join deliberately.**
   - Know each join's cardinality. Before and after a join, compare `count(*)` and `count(distinct key)`, because fan-out silently inflates sums.
   - Use `LEFT JOIN` when missing matches must survive, and put the filters on the right-hand table in the `ON` clause, not the `WHERE` clause.
4. **Handle NULLs explicitly.** Remember that `NOT IN` with NULLs returns nothing (prefer `NOT EXISTS`), and that `COUNT(col)` skips NULLs. Use `COALESCE` only where a default is truly meant.
5. **Handle time carefully.** Use half-open ranges (`>= start AND < end`), state the time zone used for day boundaries, and remember that rows near midnight are often where it goes wrong.
6. **Sanity-check the result.** Compare totals against a known figure, spot-check a few rows by hand, and look for duplicates on what should be the key. Sorted output and explicit column names make review easier.
7. **Parameterise.** In application code, never concatenate user input into SQL. Use bound parameters.

## Performance
1. Get the plan: `EXPLAIN` (or `EXPLAIN ANALYZE` on Postgres and MySQL; it executes the query, so be careful with writes and heavy queries in production). Warehouses show bytes scanned in their query profile.
2. Look for full scans on large tables where a selective filter exists, row estimates far off from actuals (stale statistics), nested loops over big inputs, sorts and hashes spilling to disk, and functions wrapped around indexed columns that defeat the index.
3. Fixes, roughly in order of preference:
   - Filter earlier, and select fewer columns.
   - Rewrite the predicates so they can use an index (`col >= x` rather than `date(col) = x`).
   - Add or adjust an index that matches the filter and join columns (a schema change, so propose it rather than applying it to production).
   - Pre-aggregate.
   - In warehouses, use partition and cluster pruning.
4. Re-measure after each change, and report before and after timings or bytes scanned.

## Safe writes
1. Write the `SELECT` with the same `WHERE` first. Check the row count and sample rows.
2. Confirm with the user before modifying production data, showing the count and the statement.
3. Wrap the change in a transaction where the engine supports it, and verify the affected-row count matches before `COMMIT`. Add a `LIMIT`, or batch large updates, to avoid long locks.
4. Keep a way back: a backup of the affected rows (`CREATE TABLE ... AS SELECT`), or a reverse statement.
5. Make backfills idempotent, so re-running them is harmless.

## Pitfalls
- `SELECT *` in production code.
- `DISTINCT` used to hide a fan-out bug.
- Integer division truncating ratios.
- Float columns for money.
- Dialect-specific functions copied across engines unchanged.
- Trusting ORM-generated SQL without looking at it.

## Report
Lead with the query and the answer it produced, if it was run. Then give the assumptions and definitions used, the checks performed (row counts, spot checks, totals), the plan findings and timings for optimisation work, and for writes the exact rows affected and how to undo them. Say plainly if the query was not executed against real data.
