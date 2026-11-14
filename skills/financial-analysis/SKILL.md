---
name: financial-analysis
description: Build and interpret financial statements, budget vs actual and variance drivers, and a cash-flow snapshot for a small business. Use for "make a P&L", "balance sheet", "why are we over budget", "variance analysis", "how much runway do we have", "cash flow forecast". Not professional advice.
---

# Financial Analysis for a Small Business

The aim is a set of numbers the owner trusts and understands: what happened, why it differs from the plan, and how much cash is left to act on.

**This is not financial, accounting, tax, or investment advice.** The output is analysis for the user's own decisions. Involve a qualified accountant or financial adviser before relying on it for lending, investment, tax, legal filings, or decisions that put the business at material risk. Never move money, submit filings, or send reports to third parties without explicit approval.

## When to use (and not)

Use for: producing an income statement, balance sheet, and cash-flow statement from a ledger or transaction export; budget vs actual reviews; explaining variances; short-term cash forecasts and runway. Not for audited statements, valuation for a transaction, or tax planning; recommend a professional. For closing the books first, use `month-end-close`.

## What to gather first

- Data: trial balance or GL export, bank transactions, budget file, prior periods for comparison.
- Basis (cash or accrual) and the period(s) to cover.
- Chart of accounts or how categories map to statement lines.
- For cash: current bank balances, known upcoming large payments and receipts, payment terms with customers and suppliers, loan schedules.
- What decision the analysis supports (hiring, pricing, a loan application, cutting cost). This shapes what to emphasise.

## Procedure

### 1. Validate the data
Before any analysis: check totals tie to the source, debits equal credits, no duplicate imports, periods are complete, and uncategorised transactions are small. Report problems first. Do the calculations with a script or spreadsheet formulas, not mental arithmetic, and keep the script so results are reproducible.

### 2. Financial statements
- **Income statement**: revenue, cost of sales, gross profit, operating expenses grouped meaningfully, operating profit, other items, net profit. Show gross and net margin.
- **Balance sheet**: assets, liabilities, equity; confirm it balances. Point out working-capital items (receivables, inventory, payables).
- **Cash-flow statement**: operating, investing, financing. Reconcile opening to closing cash. Explain gaps between profit and cash (e.g. customers paying late, inventory build-up, loan repayments).
- Present comparison columns (prior period, same period last year) where data allows.

### 3. Budget vs actual and variance drivers
1. Line up budget and actual by the same categories and period.
2. Compute variance in amount and percentage; mark favourable/unfavourable correctly (higher revenue is favourable; higher cost is not).
3. Focus on material variances, using a threshold the user agrees with.
4. For each, decompose into drivers where possible:
   - Revenue: volume vs price vs mix.
   - Costs: rate vs usage, one-off vs recurring, timing (spent in a different month than planned) vs real overspend.
5. Explain causes in business terms backed by transactions ("two unplanned contractor invoices"), not restatements of the number.
6. Say whether each variance is likely to persist, and what it means for the full-year outcome.

### 4. Cash-flow snapshot and runway
1. Start from actual cash on hand today.
2. Project weekly (for the next one to three months) or monthly (longer): expected receipts by customer and timing, committed payments (payroll, rent, loan, tax, suppliers).
3. Use real payment behaviour, not invoice due dates, if history shows customers pay late.
4. Show the lowest projected balance and when it happens. Runway is cash divided by average net monthly burn; show the calculation and its sensitivity.
5. Run at least a base case and a cautious case (e.g. slower collections, a lost customer). State the assumptions of each.
6. Suggest levers with their effect: chasing receivables, timing of discretionary spend, payment terms. Present them as options, not instructions.

## Pitfalls

- Mixing cash and accrual numbers in the same comparison.
- Treating a timing difference as a saving.
- Fabricating benchmarks or "typical" industry margins. Only cite comparisons from a named source the user can check.
- Forecasts with false precision; round sensibly and show ranges.

## Deliverable

Lead with the answer to the user's question in two or three sentences (e.g. "Net profit is below budget mainly because of X; cash stays positive until month Y in the cautious case"). Then statements or tables, variance commentary, cash projection with assumptions. Finish with data-quality caveats, what was calculated vs assumed, and the points where an accountant or adviser should review.
