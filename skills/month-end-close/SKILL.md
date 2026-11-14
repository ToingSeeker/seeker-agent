---
name: month-end-close
description: Run a month-end close: build the checklist, prepare journal entries with support, reconcile balance-sheet accounts, and review results before sign-off. Use for "month-end close", "close the books", "draft accrual entries", "reconcile this account", "bank doesn't match". Not professional advice.
---

# Month-End Close

A close is finished when every balance-sheet account is supported, every adjusting entry has evidence, and someone has reviewed the result. Speed comes from a repeatable checklist, not from skipping steps.

**This is not accounting, tax, or audit advice.** It helps organise and prepare work. A qualified accountant should review entries and treatment decisions, and must be involved for anything listed under "Escalate" below. Never post entries to a live ledger, file anything, or move money without explicit user approval.

## When to use (and not)

Use for small and mid-sized businesses closing monthly, preparing entries and reconciliations from exports (bank statements, ledger/trial balance, AR/AP ageing, payroll reports). Not for preparing tax returns, statutory audit opinions, or group consolidations with complex intercompany elimination; recommend a professional there.

## What to gather first

- Period being closed, accounting basis (cash or accrual), currency, and fiscal calendar.
- Trial balance or general ledger export for the period and the prior period.
- Bank and card statements; payment processor payouts if relevant.
- Subledgers: AR ageing, AP ageing, fixed asset register, inventory, payroll summary.
- Prior month's close checklist and adjusting entries, so recurring items are not missed.
- Materiality threshold the user is comfortable with for investigating differences.

## Procedure

### 1. Build the checklist
List every task with owner, due day relative to period end, and status. Typical order: cut-off of sales and purchases; bank and card reconciliations; AR and AP review; payroll and benefits; accruals and prepaids; fixed assets and depreciation; inventory (if any); revenue recognition review (deferred revenue); intercompany or owner transactions; tax liabilities accrued (sales tax/VAT, payroll taxes); trial balance review; flux review; sign-off. Carry forward last month's tasks and add anything new.

### 2. Reconcile
For each balance-sheet account, compare the ledger balance to an independent source (statement, subledger, schedule).

- Start from the prior reconciled balance, not from scratch.
- Match transactions by amount and date; then investigate the unmatched ones in both directions.
- Classify each reconciling item: timing (outstanding cheque, deposit in transit), error to correct, or unknown to investigate.
- A reconciliation is complete only when the unexplained difference is zero or explicitly accepted as immaterial by the user.
- Old reconciling items that carry month after month are a warning sign; list their age.

If working with CSV exports, write a small script to do the matching and keep it with the workpapers so the result is reproducible. Show the totals so the user can tie them out.

### 3. Prepare journal entries
Each entry needs:

- Date, accounts, debits and credits that balance.
- A description a stranger could understand.
- Support: the calculation, the source document, and the reason (e.g. "accrue utilities: invoice not received; estimate based on prior three months").
- Whether it reverses next period (most accruals do).

Common entries: expense accruals, prepaid amortisation, depreciation, deferred revenue release, payroll accruals, corrections found during reconciliation. Present entries as a proposal; the user or their accountant approves and posts.

### 4. Review
- Compare each P&L and balance-sheet line to prior month and same month last year if available. Explain every movement over the materiality threshold with a cause, not a restatement of the number.
- Check sign anomalies: negative cash, credit balances in receivables, debit balances in payables.
- Confirm suspense or "ask my accountant" accounts are cleared or explained.
- Tie the trial balance: total debits equal credits; retained earnings rolled correctly.

## Escalate to a qualified accountant when

- Revenue recognition is unclear (multi-element contracts, refunds, long-term projects).
- Tax treatment or filing obligations are involved.
- A difference cannot be explained, or suggests error or fraud.
- Equity, loans, leases, foreign currency revaluation, or capitalisation decisions arise.
- The figures will be relied on by lenders, investors, or regulators.

## Pitfalls

- Plugging a difference to make a reconciliation balance. Never do this; leave it visible.
- Duplicate accruals because last month's did not reverse.
- Using the bank balance as proof that the ledger is right.
- Silent assumptions. Every estimate states its basis.

## Deliverable

Lead with close status: done, or what blocks it. Then the checklist with status, reconciliation summaries (ledger balance, source balance, reconciling items, unexplained difference), proposed journal entries with support, and the flux review. End with what you verified by calculation, what relies on the user's data as given, which items need an accountant, and a reminder that nothing has been posted.
