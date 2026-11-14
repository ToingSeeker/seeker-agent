---
name: product-launch
description: Plan a product or feature launch — sizing the launch tier, audience and message, channels, assets, timeline, day-of runbook and post-launch follow-up. Use for "launch plan", "go-to-market", "announce a feature", "launch on Product Hunt", "release announcement", "GTM checklist".
---

# Product Launch

## When to use
Use when something new is about to reach users: a product, major feature, pricing change, rebrand, or re-launch. Not for ongoing campaigns with no release moment (use `paid-ads`, `social-media`, or `email-sequences`).

## Gather first
- **What is launching** and, in one sentence, what a user can now do that they could not before. If the code is local, read the changelog, PRs or feature flags to get the facts right.
- **Who it is for**: existing customers, a new segment, developers, press?
- **Launch goal as a number**: signups, activations of the feature, upgrades, waitlist size, press mentions. Vanity reach is not a goal.
- **Readiness**: is it shippable, documented, supported? Who handles support on the day?
- **Hard dates and constraints**: events, competitor moves, holidays, code freeze.
- **Owned audience**: email list size, social followers, community, in-app reach.

## Procedure
1. **Pick the launch tier.** Match effort to impact so the team doesn't treat every release as a big launch:
   - *Major*: new product or change that alters positioning — full plan, multiple channels, external outreach, several weeks of prep.
   - *Medium*: significant feature for an existing audience — blog/changelog, email, social, in-app, sales enablement.
   - *Minor*: improvements and fixes — changelog entry, in-app note, perhaps one social post.
2. **Write the message before the assets.** One positioning statement (for whom, what problem, why now, why this over alternatives), three supporting points with proof, and the single call to action. Every asset derives from this so the story is consistent.
3. **Choose channels in three groups.**
   - *Owned* (you control it): email, in-app messages, website, blog, changelog, docs, community.
   - *Earned/borrowed* (other people's audiences): partners, creators, press, podcasts, launch directories and communities. Each has its own rules — read them.
   - *Paid* (optional): only with budget and approval; see `paid-ads`.
   Prioritise owned channels; they are where existing users actually are.
4. **List assets with owners and deadlines.** Typically: landing page or updated page, announcement post, email(s), social posts, demo video or GIF, screenshots, docs and help articles, FAQ for support, sales/partner brief, press note if major, in-app announcement. Mark which are blocking.
5. **Build the timeline backwards from launch day.**
   - *Weeks before*: finalise message, start teaser or waitlist if useful, line up partners and press under embargo, prepare assets.
   - *Week before*: internal briefing, support FAQ ready, final QA in a production-like environment, tracking verified (`analytics-tracking`), all links checked.
   - *Day before*: freeze; schedule but do not send; confirm owners and rollback plan.
   Consider a staged rollout (internal → beta → everyone) to catch problems before the big announcement.
6. **Write the day-of runbook.** Ordered, timed steps with an owner each: flip the flag / deploy, verify in production, publish page, send emails, post socially, notify partners, monitor errors and support queue, respond to comments. Include a stop condition: what problems pause the announcement.
7. **Plan follow-up.** Launch day is the start. Over the following weeks: reply to every comment and question, share customer reactions and early results, publish a deeper piece (tutorial, case study), email users who haven't tried it, and run a short retro comparing results with the goal.

## Pitfalls
- Announcing before the feature works in production for real users.
- Spreading thin across every channel; better to do three well.
- Treating launch directories and communities as spam targets — vote rings and fake accounts violate their rules and backfire.
- No support plan, so the launch spike becomes a backlog of angry tickets.
- Measuring traffic instead of the goal metric.

## Deliver
Lead with the plan summary: tier, goal metric, launch date, top channels. Then the message doc, channel plan, asset list (asset, owner, due, status), backwards timeline, day-of runbook, and follow-up plan. Draft copy for key assets if asked. Flag unknowns that are the user's decision (date, budget, embargo). Never publish, send, deploy or contact press or partners without explicit confirmation.
