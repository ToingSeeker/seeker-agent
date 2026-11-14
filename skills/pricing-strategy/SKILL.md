---
name: pricing-strategy
description: Design pricing and packaging — value metric, tiers, anchoring, discounts and offers, pricing-page structure, and changing prices safely for existing customers. Use for "how should I price this", "pricing tiers", "raise prices", "discount strategy", "pricing page", "freemium or trial".
---

# Pricing Strategy

## When to use
Use for setting initial prices, restructuring plans, adding a tier, raising prices, designing a launch or seasonal offer, or reviewing a pricing page. This is business guidance, not financial, tax or legal advice; price-display rules, consumer-protection law, and tax inclusion vary by jurisdiction — have the user confirm with a qualified adviser where it matters.

## Gather first
- **Costs**: variable cost per customer or unit (hosting, AI tokens, payment fees, support time). Price must clear this with margin at every tier, including heavy users.
- **Value**: what outcome customers get and roughly what it is worth to them (time saved, revenue earned, cost avoided). Customer interviews and sales notes beat guesses.
- **Alternatives**: what customers would do instead — competitors, spreadsheets, hiring someone, doing nothing — and what those cost.
- **Segments**: who buys, how usage and willingness to pay differ between them.
- **Current data** if any: conversion by plan, plan mix, churn by plan, discount frequency, upgrade paths. If billing data or code is local, read it rather than asking.

## Procedure
1. **Choose the value metric** — the unit you charge on. A good one grows as the customer gets more value, is easy to understand and predict, and is hard to game. Candidates: seats, usage (requests, records, minutes), outcomes (transactions processed), or a flat price per workspace. Test candidates against real customers: does the heaviest-value customer pay the most? Does a small customer get a fair entry point?
2. **Design packaging.** Usually two to four plans. Differentiate on what each segment truly needs: limits on the value metric, features that matter to bigger buyers (permissions, audit logs, SSO, priority support, compliance), and service level. Keep the entry plan genuinely useful; gate on scale and sophistication, not on basic usefulness. Decide free plan vs. free trial vs. neither based on whether the product shows value quickly and how cheap free users are to serve.
3. **Set price points.** Triangulate:
   - Value: capture a fraction of the value delivered.
   - Alternatives: positioned deliberately relative to them.
   - Cost floor: margin at expected and at heavy usage.
   For research, structured willingness-to-pay surveys (e.g. Van Westendorp-style questions) and conjoint-style trade-off studies give directional ranges; treat results as inputs, not answers.
4. **Use anchoring honestly.** A higher tier makes the middle one look reasonable; annual billing shown as a monthly equivalent with a clear saving; an "enterprise / contact us" option signals the ceiling. Only show reference prices ("was X") that were genuinely charged — fake reference pricing is illegal in many places.
5. **Design offers and discounts with rules.** Decide in advance: who qualifies (new customers, annual prepay, nonprofits, education), how long it lasts, whether it renews at the discount, and the maximum anyone can give. Prefer adding value (extra months, onboarding, bonus usage) over cutting price. Time-limited offers must actually end. Constant discounting resets what customers believe the price is.
6. **Change prices safely.**
   - New customers first; measure conversion and revenue per visitor, not conversion alone.
   - Existing customers: decide grandfathering (forever, for a period, or migrate with notice). Give clear, advance notice, explain what they get, and offer a path such as locking in annual at the old rate. Check contracts and terms for notice requirements.
   - A/B testing prices on the same page is possible but carries fairness and trust risks if customers discover different prices; consider testing by time period, geography, or new-segment page instead, and be prepared to honour the lower price.
   - Before changing, record the baseline metrics so you can compare.
7. **Review the pricing page.** Plans compared side by side, the recommended plan clear, the value metric explained in plain words, a short FAQ for objections (cancellation, overages, refunds, taxes), and no surprise fees at checkout.

## Pitfalls
- Pricing by cost-plus only, leaving value on the table, or by competitor-copying without knowing their economics.
- Too many plans or a value metric customers cannot predict (bill shock).
- Unlimited plans on usage that has real marginal cost.
- Hiding the price when the buyer expects self-serve.

## Deliver
Lead with the recommendation: value metric, plan structure with prices, and the reasoning in a few lines. Then a plan comparison table, margin check per tier (show your arithmetic and assumptions), offer/discount rules, a rollout and communication plan for changes, and the metrics to watch. Clearly separate data you computed from estimates. Do not change prices in billing systems or notify customers without explicit approval.
