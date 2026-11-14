---
name: email-sequences
description: Design automated lifecycle or drip email sequences (welcome, onboarding, trial-to-paid, nurture, re-engagement) with triggers, timing, branching, exit rules, copy for every email and metrics. Use for "write a drip campaign", "onboarding emails", "nurture sequence".
---

# Email Sequences

## When to use
Use when someone needs a series of automated emails that fire from a user's behaviour or a point in their lifecycle: after signup, during a trial, after a purchase, when activity drops. Do not use for a one-off newsletter or announcement (that is a single send), or for emails to people who never opted in (see `cold-outreach`).

## Gather first
- **The single outcome** the sequence exists to produce (activate a key feature, convert trial to paid, book a call, repurchase). One sequence, one outcome.
- **Who enters**: the entry event and any filters (plan, segment, source).
- **What the product can detect**: which events exist so emails can react to behaviour, not just the calendar. Search the code or tracking plan for event names if available.
- **Sending tool and its limits**: can it branch on events? delay by business days? suppress across sequences? If unknown, design for simple time delays plus one or two event checks.
- **Voice and sender**: a person's name or the brand, reply-to that a human reads.
- **Existing emails**: read them before writing new ones so you don't contradict them or double-send.

## Procedure
1. **Write the goal as a metric.** E.g. "percentage of new signups who complete setup within 7 days". This becomes the success measure and the exit condition.
2. **Map the path to the goal.** List the 2–5 steps a person must take to reach it and where people currently stall. Each email should target one stall point.
3. **Define entry, exit and suppression.**
   - Entry: the triggering event, deduplicated so a user cannot enter twice in parallel.
   - Exit: reaching the goal ends the sequence immediately. Also exit on unsubscribe, account deletion, upgrade, or entering a higher-priority sequence.
   - Suppression: a global cap on marketing emails per person per week, and a rule for which sequence wins when two overlap.
4. **Set the cadence.** Front-load: intent is highest right after the trigger, so the first email usually goes immediately, the next within a day or two, then widen the gaps. Keep length proportional to the decision; a short onboarding run often needs 4–7 emails, a long B2B nurture can run longer at lower frequency. Treat these as starting points to test, not rules.
5. **Add branches only where behaviour changes the right message.** Typical branch: "did they do step X?" yes → skip ahead / congratulate and point to step Y; no → help with step X. More than two or three branches gets untestable; prefer exit-and-re-enter.
6. **Write each email** with one job and one primary call to action. For every email specify:
   - Send condition (delay + any event check)
   - Subject line plus one alternative to test, and preview text that complements rather than repeats the subject
   - Body: open on the reader's situation, give something useful (a tip, an answer, a proof point), then the single ask
   - CTA text and destination (deep link to the exact screen, not the homepage)
   - Plain-text version or confirmation the tool generates one
7. **Handle compliance.** Every marketing email needs a working unsubscribe link and the sender's physical postal address where law requires it (e.g. CAN-SPAM in the US). Transactional emails (receipts, password resets) are separate and must not carry promotional content that changes their classification. Only email people who consented where consent is required (GDPR/ePrivacy in the EU/UK, CASL in Canada).
8. **Define measurement.** Per email: delivered, open (directional only — privacy features inflate it), click, unsubscribe, spam complaint. Per sequence: goal conversion rate versus a holdout group that receives nothing, and time to goal. Without a holdout you cannot tell whether the emails caused anything.

## Quality bar
- Each email would still make sense if it were the only one the person read.
- No email asks for more than one thing.
- Copy names the reader's problem before the product's features.
- Subject lines are honest about the content; no fake "Re:" or "Fwd:".
- Timing respects time zones where the tool allows.
- Links, merge fields and fallbacks (what happens when `first_name` is empty) are specified.

## Pitfalls
- Calendar-only sequences that keep pitching after the user already converted. Always exit on goal.
- Overlapping sequences sending three emails on the same day.
- Judging success by open rate.
- Long welcome emails that try to explain the whole product.
- Discounts in email two that train people to wait for a discount.

## Deliver
Lead with a one-paragraph summary: goal metric, entry and exit rules, number of emails and total duration. Then:
1. A flow outline (text diagram or table: email number, timing, condition, purpose).
2. Full copy for each email.
3. Measurement plan including the holdout.
4. Open questions for the user (sender name, available events, discount policy).

Do not load emails into a sending tool or send tests to real recipients without explicit confirmation. State plainly that copy and timing are untested hypotheses and which assumptions (events available, tool branching) you could not verify.
