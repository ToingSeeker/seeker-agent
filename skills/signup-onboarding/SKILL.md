---
name: signup-onboarding
description: Reduce signup friction and get new users to first value fast: define the activation moment, audit signup and first-run step by step, ship fixes (fewer fields, deferred setup, empty states, checklists). Use for "signup conversion", "onboarding", "activation", "users sign up then leave".
---

# Signup and Onboarding

## When to use
- Many visitors start signup but few finish.
- Many users sign up but never do the thing that makes the product useful.
- Designing the first-run experience for a new product or feature.

Not for: the marketing page before signup (conversion-optimization) or upgrade prompts
(paywall-upgrade).

## Gather first
- What the product does, and what a successful new user has done by the end of their first week.
- The current flow: read the routes and components from signup to the first meaningful action, or walk
  it in a browser with a test account.
- Data if available: funnel by step, time to first key action, retention split by whether users reached
  it.
- Who signs up: self-serve individuals, invited teammates, or admins setting up for a team. They need
  different paths.

## Procedure

### 1. Define activation
Pick the earliest action that reliably predicts a user sticking around, for example creating a first
project and inviting a teammate, or connecting a data source and seeing a result. If retention data
exists, check which early actions correlate with retention. If not, choose by reasoning about value,
label it a hypothesis, and make sure the event is tracked so it can be checked later.

### 2. Map the path
List every step and field between "clicked sign up" and "activated": screens, required inputs,
confirmation emails, permissions, integrations, waits. Count them. For each, ask whether the user needs
it now to reach value, and mark it keep, defer, automate, or remove.

### 3. Fix signup friction
- Ask only for what is needed to create the account. Name, company, role, and phone can usually wait
  or be inferred.
- Offer the sign-in options this audience actually uses; keep email as a fallback.
- Use correct input types, autofill, a show-password toggle, and inline validation that says how to fix
  the problem. Never wipe the form on error.
- If email verification is required, let users continue while it is pending where security allows, and
  make resending easy.
- For an existing account, offer sign-in or reset, while considering whether revealing that an email is
  registered matters for this product.
- Test on a phone-sized screen.

### 4. Design first run around activation
- Land users where they can act immediately, not on a blank dashboard.
- Empty states explain what belongs there and give one obvious action, ideally with sample data or a
  template to start from.
- A short, dismissible checklist toward activation helps when setup has several steps.
- Ask segmentation questions only if the answers change what the user sees next.
- Defer heavy setup (integrations, invites, billing) until the user has felt value, unless that setup
  is the value.
- Prefer contextual hints at the moment of need over a long upfront product tour.

### 5. Bring people back
For users who stall, send a small number of helpful, behaviour-triggered messages (email or in-app)
pointing at the next step toward activation, and stop once they activate. Respect consent and
unsubscribe rules.

### 6. Verify
- Walk the full flow with a fresh test account on desktop and mobile after changes.
- Confirm analytics events fire for each step and for activation.
- Run existing tests; add tests for any validation logic you changed.
- Plan a before/after comparison of step completion and activation over comparable periods.

## Pitfalls
- Raising signup completion while activation falls, for example by removing a step that was qualifying
  users.
- Long welcome tours that users skip.
- Requesting permissions (notifications, location, contacts) before the user understands why.
- Treating invited users like new self-serve signups.
- Claiming improvements before data has accumulated.

## Deliver
Lead with the activation definition and the single biggest blocker on the path to it. Then the step
map with keep/defer/automate/remove decisions, prioritised changes, what you implemented (files) and how
you verified it, and the metrics to watch. Be explicit about which parts of the flow you walked yourself
and which you only read in code. Ask before changing anything that sends emails to real users.
