---
name: compliance-check
description: Check a feature, campaign, or initiative for regulatory issues (privacy, consumer protection, marketing law) and list what needs a lawyer. Use for "is this compliant", "privacy check this feature", "can we email these users", "GDPR concerns", "is this ad claim ok". Not legal advice.
---

# Compliance Check

The goal is to spot regulatory issues early, while they are cheap to fix, and to hand a lawyer a precise list of questions instead of a vague worry.

**This is not legal advice.** Laws differ by country, state, and sector and change often. Use this to find issues and prepare questions; a qualified lawyer must confirm the conclusions before launch for anything flagged as needing counsel. Do not publish, launch, send campaigns, or change production settings based on this review without the user's explicit approval.

## When to use (and not)

Use when planning or reviewing: a new feature that collects or uses personal data, a sign-up or checkout flow, a marketing campaign or claim, pricing and subscription mechanics, analytics/tracking changes, AI features that process user content, data sharing with vendors. Not for responding to a regulator, a breach notification decision, or active litigation; those need counsel immediately.

## What to gather first

- A description of the initiative: what it does, who uses it, what data it touches, how it is marketed. Read the spec, PR, or code if available.
- Where users and the business are located, and where data is stored and processed.
- Audience: consumers or businesses; any minors; any vulnerable groups.
- Sector: health, finance, education, children's services, and similar sectors carry extra rules.
- Existing privacy policy, terms, cookie/consent setup, and vendor list.

## Procedure

1. **Map the data.** For the initiative, list each personal data element, its source, purpose, where it is stored, who it is shared with (including vendors and AI providers), retention, and whether it is sensitive (health, biometrics, precise location, financial, children's data, government IDs). If code is available, search it for what is actually collected and sent; the code beats the spec.
2. **Identify applicable regimes.** Based on location and sector, list the families of law likely in play, e.g. comprehensive privacy laws (such as GDPR-style regimes, US state privacy laws, or the user's national data protection law), e-privacy/cookie rules, consumer protection, e-commerce and distance-selling rules, electronic marketing rules, accessibility, and sector rules. Mark each as "likely applies", "may apply", or "probably not", with the reason. Do not assert specific legal requirements you have not verified; search for current official guidance where needed and cite it.
3. **Check privacy and data protection:**
   - Is there a lawful basis or valid consent for each purpose? Is consent freely given, specific, and as easy to withdraw as to give?
   - Is the use consistent with what the privacy notice tells people?
   - Data minimisation: is anything collected that the feature does not need?
   - User rights: can data be accessed, exported, corrected, deleted?
   - Vendors: data processing terms in place; cross-border transfers.
   - Security and retention: proportionate protection and a deletion schedule.
   - Automated decisions or profiling with significant effects on people.
4. **Check consumer protection and pricing:**
   - Total price and recurring charges shown clearly before purchase.
   - Subscriptions: clear renewal terms, reminder practices, and cancellation as easy as sign-up.
   - Refund and withdrawal rights where required.
   - No dark patterns: pre-ticked boxes, confirm-shaming, hidden costs, fake urgency or scarcity.
5. **Check marketing and advertising:**
   - Claims are true, substantiated, and not misleading by omission; comparative claims are fair and provable.
   - Reviews and testimonials are genuine; endorsements and paid relationships are disclosed.
   - Email/SMS/messaging: consent or a valid exemption, sender identification, working unsubscribe.
   - Promotions, contests, and "free" offers follow the applicable rules.
6. **Rate each finding**: blocker (do not launch until resolved), fix before launch, improve soon, or note.
7. **Recommend fixes** in product terms: a copy change, a consent step, removing a field, a settings toggle, a vendor agreement.

## Needs a lawyer

Always route to counsel: sensitive or children's data; new jurisdictions; cross-border transfers without an established mechanism; health, financial, or other regulated claims; automated decisions affecting people's access to services, work, or credit; any finding rated blocker; anything where the user is unsure whether an exemption applies.

## Pitfalls

- Treating one country's rules as universal.
- Reviewing only the spec when the code collects more.
- Approving marketing claims without seeing the evidence behind them.
- Inventing article numbers, fine amounts, or deadlines. Cite only what you checked in an official or reputable source, with the date.

## Deliverable

Lead with the verdict: no material issues found, fixable issues, or blockers, and the top items. Then: data map, applicable regimes with confidence, findings table (area, issue, severity, recommended fix), and a numbered "questions for counsel" list. End by stating what you examined (spec, code, copy) and what you did not, plus the not-legal-advice note.
