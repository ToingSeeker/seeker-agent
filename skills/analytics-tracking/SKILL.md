---
name: analytics-tracking
description: Design and implement a tracking plan — the decisions it serves, events, properties, naming, identity, consent, code, and QA that proves the data is right. Use for "tracking plan", "add analytics", "event tracking", "set up GA4/PostHog/Mixpanel", "our data is wrong", "UTM".
---

# Analytics Tracking

## When to use
Use when adding analytics to a product or site, cleaning up inconsistent events, instrumenting a new feature, or checking that reported numbers are trustworthy. The method is tool-agnostic; GA4, PostHog, Mixpanel, Amplitude, Segment, Plausible or a home-grown events table all work as examples — use whatever the project already has.

## Gather first
- **Questions the data must answer**: e.g. "where do trial users drop out of onboarding?", "which channel brings customers who stay?". Tracking without questions produces noise.
- **What exists**: search the code for analytics calls (`track(`, `gtag(`, `capture(`, `analytics.`, `dataLayer`) and list current events and their properties. Read any existing tracking plan.
- **Stack**: client-side, server-side, mobile; where users are identified (login, signup); where payments are confirmed.
- **Privacy requirements**: regions served, consent banner, what data must never be sent (passwords, payment details, health data, free-text fields that may contain personal data).

## Procedure
1. **Start from decisions.** For each key question, write the metric that answers it and the events needed to compute it. Usually this yields a funnel (acquisition → activation → engagement → conversion → retention) with a handful of critical events. Fewer, well-defined events beat hundreds of vague ones.
2. **Set naming conventions** and apply them everywhere:
   - One pattern, e.g. `object_action` in past tense: `project_created`, `invite_sent`, `subscription_started`.
   - One case style (snake_case is common) for events and properties.
   - No dynamic values in event names (`clicked_button_42` is wrong; use a property).
   - Prefer semantic events (`checkout_completed`) over UI-level ones (`blue_button_clicked`); add UI detail as properties.
3. **Define each event in the plan** with: name, description, trigger (exact moment it fires), where it fires (client or server), properties with type, allowed values and whether required, and the question it serves. Business-critical events — signup, purchase, subscription changes — should fire server-side from the source of truth, because client events are lost to ad blockers and closed tabs.
4. **Handle identity.** Anonymous ID before login, user ID after; call the identify/alias step once at signup/login so pre- and post-login activity joins up. For B2B, attach an account/company group ID too. Never use email or other direct personal data as the user ID if a stable internal ID exists.
5. **Handle attribution.** Capture UTM parameters and referrer on landing, persist them through signup, and store first-touch (and optionally last-touch) on the user record. Define a UTM naming convention (lowercase, fixed list of sources and mediums) so reports don't split `Email`/`email`/`e-mail`.
6. **Respect consent and privacy.** Load non-essential tracking only after consent where required (EU/UK and others), honour opt-outs, strip personal data from properties and URLs (query strings often leak emails and tokens), set data retention. Document what is collected and why.
7. **Implement.** Put tracking behind a small wrapper module with typed event definitions so names and properties are checked in one place rather than scattered string literals. Add the events, keep business logic unchanged, and add unit tests that the wrapper is called with the expected payloads on the key paths.
8. **QA the data.** This is the step most often skipped.
   - Run the app and perform each tracked action; watch the network requests or the tool's debug/live view and confirm each event fires once, with the right properties and types.
   - Check edge cases: double clicks, page reloads, back button, failed actions (no success event on failure), logged-out vs. logged-in.
   - Reconcile counts: events vs. backend records (e.g. `subscription_started` count vs. subscriptions in the database for the same period). Large gaps mean loss or duplication.
   - Re-check after deploy in production.
9. **Maintain.** Keep the tracking plan file in the repo next to the code; update it in the same change that adds or alters an event. Deprecate events explicitly instead of silently reusing names.

## Pitfalls
- Tracking everything "just in case" and trusting none of it.
- Renaming events and breaking historical comparisons without a migration note.
- Client-only revenue tracking.
- Personal data in event properties or page URLs.
- Declaring tracking done without watching events arrive.

## Deliver
Lead with the summary: the questions covered, number of events, and whether implementation and QA are done. Then the tracking plan (table or a version-controlled YAML/JSON/Markdown file), naming conventions, identity and attribution rules, consent notes, code changes, and a QA log listing each event and whether it was verified firing — be explicit about anything checked only locally or not at all. Do not create accounts in third-party tools, add new tracking vendors, or ship to production without the user's confirmation.
