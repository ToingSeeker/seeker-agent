---
name: support-triage
description: Triage customer support tickets: categorise, set priority, route to an owner, find duplicates, and build an escalation package engineering can act on. Use for "triage these tickets", "what's urgent in the queue", "is this a bug", "escalate this to engineering", "write up this issue for devs".
---

# Support Ticket Triage and Escalation

Triage decides three things fast: what is this, how urgent is it, and who owns it next. Escalation turns a customer's description into something an engineer can reproduce without a second round of questions.

Use for a single ticket or a batch (an export, a pasted list, a folder of emails). For writing the actual reply to the customer, use `support-response`.

## What to gather first

- The tickets themselves, including customer plan/tier and timestamps if available.
- The team's priority scheme and routing rules, if any. If none, use the defaults below and say so.
- Known-issue list, status page, or recent incident notes, so you can link duplicates.
- For escalation: access to the product logs, repo, or a test account if the user permits reproducing.

## Default priority scheme

Priority is impact times urgency, not how angry the message sounds.

- **P1 urgent**: service down or data loss/corruption, security exposure, payments failing, many customers affected, no workaround.
- **P2 high**: a core workflow broken for one customer or a feature broken for many, with a painful or no workaround; contractual deadlines at risk.
- **P3 normal**: a defect with a reasonable workaround, or a how-to question blocking someone's work.
- **P4 low**: cosmetic issues, feature requests, general feedback.

Raise priority one level for signals like regulatory exposure or a stated imminent deadline; do not raise it for tone alone. Anything mentioning a possible security or privacy breach goes to whoever owns security immediately, regardless of other scoring.

## Triage procedure

1. Read each ticket fully, including earlier replies in the thread. Customers often state the real problem in the third message.
2. Categorise: bug, how-to/usage, account/billing, access/login, feature request, data request (export, deletion), security/privacy, outage report, other. One primary category per ticket.
3. Extract the essentials: what they were trying to do, what happened instead, when it started, scope (one user, account-wide, everyone), environment (browser, OS, app version, region), and any error text verbatim.
4. Check for duplicates and clusters: same error text, same feature, same time window. Group them. Several reports within a short window about the same feature suggest an incident, not individual bugs; flag that prominently.
5. Assign priority with a one-line reason.
6. Route: support can resolve, needs engineering, needs billing/finance, needs account owner, needs security. State what the next owner must do.
7. Note what is missing and draft the one clarifying question that would unblock it, if needed.

## Escalation package for engineering

Write it so an engineer who has never seen the ticket can start work.

- **Title**: symptom plus where, e.g. "Export to CSV times out for workspaces with large histories".
- **Impact**: who is affected, how many accounts/tickets, business consequence, workaround if any.
- **Steps to reproduce**: numbered, minimal, with exact inputs. Mark whether you reproduced it yourself, and how. If you could not reproduce, say so and say what you tried.
- **Expected vs actual** behaviour.
- **Evidence**: verbatim error messages, request IDs, timestamps with timezone, screenshots referenced by the customer, relevant log lines. Remove personal data that the engineer does not need (passwords, payment details, unrelated contact info).
- **Environment**: version, platform, account identifiers needed for lookup.
- **Linked tickets** and first-seen time.
- **What support has already tried.**
- **Ask**: what you need from engineering and by when, tied to priority.

If you have repository access, search the code for the error string or the feature to suggest likely areas, labelled as a lead, not a diagnosis.

## Pitfalls

- Do not treat feature requests as bugs or vice versa; misrouting costs a day.
- Do not promise a fix or a timeline to the customer in triage notes that might be forwarded.
- Do not close a ticket as a duplicate without linking the one it duplicates.
- Do not post in the tracker, reply to customers, or page anyone without the user's approval; draft and hand over.

## Deliverable

Lead with anything P1 or any suspected incident cluster. Then a table: ticket, category, priority + reason, owner, next action, duplicate-of. Then any escalation packages in full. End with what you reproduced or verified yourself versus what is taken from the customer's account.
