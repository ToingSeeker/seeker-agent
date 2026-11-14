---
name: referral-programs
description: Design, implement and measure customer referral or affiliate programs — incentive structure, share moments, tracking and attribution, payout rules, fraud controls and terms. Use for "referral program", "refer a friend", "affiliate program", "invite rewards", "partner commissions".
---

# Referral Programs

## When to use
Use when existing customers or partners could bring in new customers and you want to reward that. Two flavours:
- **Customer referral**: users invite friends/colleagues; typically a reward on both sides; volume of small referrals.
- **Affiliate**: creators, publishers or partners promote for a commission; fewer, larger sources; more like a sales channel.
Decide which before designing. Referral programs only amplify a product people already recommend; if customers are not satisfied, fix that first.

Payouts, tax reporting for paid affiliates, and promotion rules vary by country. This is not legal or tax advice; have the user confirm terms with a qualified adviser.

## Gather first
- **Unit economics**: average first-year revenue or margin per customer and current acquisition cost. The reward budget must fit inside this.
- **Natural sharing**: do customers already recommend it? Where (word of mouth, teams, social)? Survey or support data helps.
- **Product context**: is the product better with others (collaboration) or solo? Collaborative products can reward with usage/credits; solo ones need value-based rewards.
- **Tech stack**: how signups and payments work, whether the codebase already has invite or coupon features. Search the code before building new.

## Procedure
1. **Choose incentives.**
   - Two-sided rewards (both referrer and new customer get something) usually feel fairer and convert better than one-sided.
   - Reward type: account credit, free time, extra usage, feature unlock, cash or gift card, or donation. Credits and product value cost less and attract genuine users; cash attracts more fraud.
   - Affiliates: percentage or fixed commission, one-time or recurring for a limited period, with a cookie/attribution window stated clearly.
   - Pay on a meaningful event (paid conversion, after refund window), not on signup.
   - Set caps per referrer per period.
2. **Place share moments** where satisfaction peaks: after a success moment in the product, after positive feedback or a high rating, after an achievement, in the account area, in receipts. Make sharing one step: a personal link, copy button, pre-written message the user can edit.
3. **Build tracking and attribution.**
   - Unique referral code or link per referrer; store the referral on the new account at signup (persist the code through the signup flow — query param → cookie/local storage → account record).
   - Record events: link created, link visited, signup with referral, qualifying conversion, reward issued, reward reversed.
   - Decide rules for conflicts: last click vs. first click, self-referral, code applied after signup, existing customers.
   - Make reward issuance idempotent and reversible on refund or chargeback.
   - Add tests for the attribution path and reward logic, and run them.
4. **Fraud controls.** Block self-referrals (same payment method, device, email pattern, IP cluster — use signals proportionately and mind privacy), require the qualifying paid event, hold rewards until refund windows pass, cap rewards, flag outliers for manual review, and forbid brand-keyword bidding and coupon-site spam for affiliates in the terms.
5. **Write terms.** Eligibility, what qualifies, reward amount and timing, caps, expiry, prohibited behaviour, right to reverse fraudulent rewards, how changes are notified. Affiliates must disclose the relationship when promoting (advertising law in many countries requires it); put that in the terms.
6. **Launch and promote.** Announce to existing happy customers first; add in-product entry points; brief support on common questions.
7. **Measure.** Share of users who share, invites per sharer, referral conversion rate, referred customers' retention and value vs. other channels, cost per referred customer including rewards, fraud/reversal rate. Revisit incentives after enough data.

## Pitfalls
- Rewards larger than the margin on the customer.
- Paying on signup; invites fake accounts.
- A buried program page nobody finds.
- Attribution lost in the signup flow because the code isn't persisted.
- Changing rewards without honouring earned ones.

## Deliver
Lead with the recommended program design: type, rewards on each side, qualifying event, and the cost per acquired customer it implies (show the arithmetic). Then share-moment placements, the tracking/data model and events, fraud rules, draft terms, launch steps, and metrics. If you implemented code, say which tests you ran and their results, and what remains untested (e.g. real payment refunds). Do not launch, email customers, or issue real rewards without explicit approval.
