---
name: conversion-optimization
description: Diagnose why a page, form, or flow is not converting and propose fixes as hypotheses ranked by impact and confidence, including popups/modals that do not annoy. Use for "CRO", "improve conversion", "why aren't people signing up/buying", "optimise this landing page", "add a popup".
---

# Conversion Optimization

## When to use
- A landing page, pricing page, checkout, lead form, or demo request flow underperforms.
- The user wants an exit-intent popup, email capture, or promo modal.

For signup and first-run activation specifically, see signup-onboarding. For in-app upgrade prompts,
see paywall-upgrade.

## Gather first
- The conversion goal and how it is measured (event name, thank-you page, backend record).
- Current numbers if available: traffic by source and device, conversion rate, where people drop off.
  If there is no data, say so; the analysis becomes a heuristic review and confidence drops.
- Who arrives and from where: an ad, search query, email, or referral sets their expectation.
- Access to the page: the live URL and/or the code that renders it.

## Procedure

### 1. Verify measurement
Before changing anything, check that the conversion event fires once, at the right moment, on all
devices. Trigger it yourself in a test environment and look for it. Broken tracking is a common and
cheap-to-find cause of "low conversion".

### 2. Walk the flow as the visitor
Open the page on a narrow mobile viewport and on desktop (a headless browser if available; otherwise
read the rendered markup and say what you could not see). From the visitor's arrival point, note:
- Relevance: does the first screen match the ad, query, or link they clicked?
- Clarity: within a few seconds, can they tell what this is, who it is for, and what to do next?
- Motivation: are the benefits and proof strong enough for the size of the ask?
- Friction: form length, required fields, account creation before value, slow loading, layout shift,
  errors, unclear pricing, surprise costs late in checkout.
- Anxiety: missing trust signals near the action (security, refunds, privacy, real reviews, contact
  options).
- Distraction: competing calls to action, navigation leaks, autoplaying media.

### 3. Find the leak
Use funnel data to locate the step with the biggest drop. Pair it with qualitative evidence: session
recordings, form analytics, support questions, or user surveys if available. Fix the largest leak
first, not the most visible cosmetic issue.

### 4. Write hypotheses
For each issue: "Because we observed (evidence), changing (element) for (audience) will improve
(metric)." Score each on impact (how many visitors it touches and how much), confidence (strength of
evidence), and effort. Rank by the combination and show your scoring.

### 5. Recommend fixes
Common high-leverage moves, applied only when the evidence points there:
- Rewrite the headline to match the traffic source's promise.
- Remove optional form fields; defer what can be asked later; use correct input types and autofill.
- Put proof next to the action.
- Show the price, or what happens after clicking.
- Make error messages specific and keep entered data on failure.
- Speed up the first screen.

### 6. Popups and modals, done well
- Trigger on a signal of intent or completion (scroll depth, time engaged, exit intent on desktop,
  after a finished task), not the moment someone lands.
- Offer something useful in return and say exactly what they will get.
- Easy, visible dismissal; respect it with a frequency cap and remember it.
- On mobile, avoid full-screen interstitials that cover content; prefer a small banner or slide-in.
- Do not show it to people who already converted. Keep keyboard focus inside an open modal, close on
  Escape, and return focus afterwards.
- No guilt-trip dismiss links.

### 7. Test properly
- A/B test when traffic is enough to reach a meaningful result in reasonable time; otherwise ship clear
  fixes and compare before/after, noting the weaker evidence.
- Fix the primary metric, sample size, and duration before starting; do not stop early on a good day.
- Watch guardrail metrics (refunds, lead quality, churn) so a "win" does not bring worse customers.

## Pitfalls
- Copying tactics from other sites without evidence they fit.
- Dark patterns: fake urgency, hidden costs, pre-checked upsells, confirmshaming. They damage trust and
  may be unlawful.
- Testing tiny changes on low traffic and reading noise as a result.
- Claiming uplift you did not measure.

## Deliver
Lead with the biggest leak and the fix you would ship first. Then the ranked hypothesis table (issue,
evidence, change, impact, confidence, effort), a test plan, and implementation notes. State what you
observed directly, what came from data, and what is judgement. Ask before deploying changes or starting
experiments on live traffic.
