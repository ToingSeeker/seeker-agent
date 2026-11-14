---
name: churn-retention
description: Reduce churn — find where and why customers leave, design the cancel flow and save offers, recover failed payments (dunning), run win-back, and track risk signals. Use for "reduce churn", "cancel flow", "save offer", "failed payments", "dunning", "win-back", "retention".
---

# Churn and Retention

## When to use
Use for subscription or repeat-purchase businesses losing customers. Covers voluntary churn (people choose to leave) and involuntary churn (payments fail). Not for acquisition problems. Any customer-facing change (emails, flows, offers) needs the user's approval before going live.

## Gather first
- **Churn numbers**: monthly customer churn and revenue churn, split by plan, tenure, acquisition channel, and voluntary vs. involuntary. If billing data or a database is accessible, compute these yourself and show the query.
- **Reasons**: existing cancellation survey answers, support tickets, sales notes. Read raw text, not just the summary.
- **Usage data**: what active, retained customers do that churned ones didn't.
- **Billing system capabilities**: retries, card updater, pause, plan downgrade, coupon support. Check the code or docs before designing something it cannot do.
- **Constraints**: consumer law on cancellation (several jurisdictions require cancelling to be as easy as signing up, and prohibit obstructive flows), and which offers the business can afford.

## Procedure
1. **Find where churn concentrates.** Cohort retention curves by signup month show whether churn is early (onboarding/fit problem) or steady (value or competition problem). Segment by plan and channel; often one segment drives most of it. Fix the biggest bucket first.
2. **Fix involuntary churn first** — it is usually the cheapest win because these customers did not decide to leave.
   - Before failure: notify before card expiry, enable automatic card updating if the processor supports it, offer backup payment methods.
   - Retries: spread retries over days, not minutes, avoiding obvious failure times; follow the processor's guidance for decline codes that should not be retried.
   - Dunning messages: a short series over the grace period — clear, friendly, a one-click link to update payment, stating what happens and when. In-app banners for logged-in users.
   - Grace period: keep access for a short window rather than locking immediately.
3. **Design the cancellation flow.**
   - Ask one short question about why they are leaving (single choice + optional text). Keep it optional and quick.
   - Respond to the reason: too expensive → downgrade or pause or a time-limited discount; not using it → pause, or help getting value; missing feature → say if it is coming, or point to a workaround; switching to a competitor → ask what decided it; temporary need ended → pause.
   - Show one relevant offer, not a gauntlet of screens. Cancelling must remain clear and completable in the same session; confirm cancellation explicitly and tell them when access ends.
   - Make offers rules-based and limited (e.g. one save discount per customer per year) so they don't become a habit to game.
4. **Add proactive retention using leading indicators.** Define risk signals from data: falling logins or core actions, a key user leaving the account, failed onboarding milestones, support tickets with negative sentiment, approaching renewal with low usage, downgrades. Combine into a simple score you can explain. Trigger actions: in-app help, an email from a human for high-value accounts, a check-in before renewal. Validate that the score actually predicts churn on past data before relying on it.
5. **Run win-back.** For cancelled customers, a small number of messages spaced out over weeks or months: what has changed since they left (features, fixes tied to their stated reason), and a simple way to return with data intact if you keep it. Respect unsubscribes and data-retention promises.
6. **Measure.** Save rate from the cancel flow (and how many saved customers churn later anyway), recovery rate of failed payments, churn by cohort before vs. after, net revenue retention. Use a control group or a before/after comparison with seasonality in mind; state limitations.

## Pitfalls
- Dark patterns: hidden cancel buttons, forced phone calls, guilt-tripping copy. They breach law in many places and damage reputation.
- Treating all churn as one problem.
- Discounting everyone who clicks cancel, which trains customers.
- Measuring save rate without checking whether saved customers stay.

## Deliver
Lead with the diagnosis: where churn concentrates and the top two or three causes, backed by numbers you computed (state the source and query). Then prioritised fixes with expected effort, the cancel-flow spec with copy, dunning schedule and messages, risk signals and actions, win-back messages, and the measurement plan. State what you inferred vs. verified from data. Do not enable flows, send messages or apply discounts without explicit approval.
