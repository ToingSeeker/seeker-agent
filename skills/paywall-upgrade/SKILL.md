---
name: paywall-upgrade
description: Design in-app upgrade moments - paywall screens, feature gates, usage limits, trial-to-paid prompts - that convert by showing value at the right time while staying honest and easy to dismiss. Use for "paywall", "upgrade prompt", "trial conversion", "freemium limits", "upsell screen".
---

# Paywalls and Upgrade Prompts

## When to use
- Adding or redesigning a paywall, plan-gated feature, usage limit, or trial expiry flow.
- Free-to-paid or trial-to-paid conversion is low.

Not for: the public pricing page (conversion-optimization) or deciding prices themselves, which is a
business decision for the user. You can lay out options and trade-offs.

## Gather first
- The plans, what each includes, prices, and billing intervals. Read the code that enforces
  entitlements so recommendations match reality.
- Where users currently hit limits or gates, and what happens when they do.
- Data if available: how many free users hit each gate, conversion per gate, trial length, when in the
  trial people convert or churn.
- Platform rules: app-store in-app purchase rules if this is a mobile app, and local consumer law on
  auto-renewal and cancellation. Flag these for the user to confirm; this is not legal advice.

## Procedure

### 1. Find the value moments
Upgrades convert best right after the user has experienced value and wants more of it: hitting a usage
limit on something they use, trying to share or export their work, needing a feature their task
requires. List the candidate moments in the product and rank them by how often they occur and how
clearly the paid plan solves the user's immediate problem.

### 2. Choose the gate type per moment
- Hard gate: the feature is unavailable; explain what it does and offer the upgrade.
- Soft limit: allow a little over, or warn as the limit approaches, so the user is not blocked mid-task.
- Preview: show the result partially or blurred, or let them try it once.
- Reverse trial: start with paid features and step down, so users see what they would lose.
Never block a user from accessing or exporting data they already created; that turns an upgrade prompt
into a hostage situation.

### 3. Design the screen
- Headline tied to what the user just tried to do ("Export to PDF is on Pro"), not a generic "Upgrade
  now".
- The specific benefit for this moment first, then other plan highlights briefly.
- Clear price, billing interval, what happens at renewal, and how to cancel.
- One primary action, an obvious way to dismiss, and a way to compare plans.
- Social proof only if real.
- For trials: show days left and what will change at the end, and remind before charging.

### 4. Respect the user
- Do not interrupt the same user repeatedly; cap frequency and remember dismissals.
- Never interrupt a critical task (saving, payment, editing) with a prompt.
- Cancellation must be as easy as signing up. No disguised ads, fake countdowns, or pre-selected
  add-ons.
- Make free plan limits visible before users hit them, for example a usage meter.

### 5. Implement safely
- Enforce entitlements on the server. A hidden button is not a paywall; client-only checks can be
  bypassed.
- After purchase, unlock immediately, return the user to the action they were attempting, and handle
  webhook delays (show a pending state rather than a failure).
- Handle the edge cases: downgrade with data over the new limit, failed renewal, refunds, plan changes
  mid-cycle, team seats.
- Track events: gate shown, dismissed, upgrade started, completed, by gate location.
- Test each gate with a free account, a trial account, and a paid account. Use the payment provider's
  test mode; never run real charges without the user's approval.

### 6. Measure
Compare conversion per gate and overall paid conversion, and watch guardrails: refunds, early churn,
support complaints, free-user retention. A prompt that converts but drives free users away may be a net
loss.

## Pitfalls
- Upgrade prompts on first launch before any value.
- Generic prompts that do not mention what the user was trying to do.
- Paywalls enforced only in the UI.
- Hiding the price until after the user commits.
- Assuming app-store rules allow linking to web checkout; check current guidelines.

## Deliver
Lead with the best two or three upgrade moments and the gate type for each. Then screen copy and layout,
frequency rules, implementation notes (server enforcement, post-purchase flow, edge cases), events to
track, and what you tested with which account types. Note anything needing legal or platform-policy
confirmation. Do not change live prices or billing settings without explicit approval.
