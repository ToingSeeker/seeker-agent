---
name: support-response
description: Draft a clear, empathetic customer support reply, and turn a resolved issue into a reusable knowledge-base article. Use for "reply to this customer", "draft a response", "how do I tell them no", "write a help article from this ticket", "add this fix to the KB".
---

# Support Responses and Knowledge-Base Articles

A good reply solves the problem in one message when possible, and leaves the customer knowing exactly what happens next when it is not. A good KB article means nobody has to write that reply again.

Use for individual replies (including hard ones: refusals, outages, mistakes on our side) and for converting a solved ticket into a help article. For deciding priority or escalating to engineering, use `support-triage`. For organising a whole help centre, a broader knowledge-base skill may fit better.

## What to gather first

- The full ticket thread, not just the latest message.
- The facts: what the actual cause and fix are, what is confirmed vs suspected, any timeline engineering has committed to.
- Policy constraints: refund rules, SLAs, what support is allowed to offer.
- Brand voice or existing replies to match, if available.
- For a KB article: the resolution, the product version it applies to, and existing articles on the same topic (search the docs folder or help centre before writing a duplicate).

## Reply procedure

1. Identify what the customer actually needs: an answer, an action taken, a decision, or acknowledgement. Some messages contain several questions; list them so none is missed.
2. Decide the outcome before writing: solved, needs info from them, escalated, or declined.
3. Structure the reply:
   - Open by addressing their issue directly. One sentence of acknowledgement is enough; skip scripted empathy.
   - Give the answer or fix. Use numbered steps for anything with more than two actions, and name buttons and menus exactly as they appear.
   - State what happens next and who acts: "I've passed this to our engineers; I'll update you by Thursday" only if that commitment is real.
   - Close with one clear invitation to reply if something does not work.
4. Match register to the customer and the stakes. Shorter for simple questions, more careful for billing disputes or data concerns.
5. Re-read as the customer: is any jargon unexplained? Does it answer every question they asked? Could any sentence be read as blaming them?

### Hard replies

- **Saying no**: state the decision plainly early, give the real reason briefly, and offer the nearest thing you can do. Do not hide the no in paragraph three.
- **Our mistake**: own it in plain words, say what was fixed, and what you are doing for them. Do not over-explain internals.
- **Ongoing incident**: say what is affected, that the team is working on it, when the next update will come, and any workaround. Never guess a resolution time.
- **Angry customer**: respond to the substance, not the tone. Do not mirror heat or grovel.

Never invent policy, discounts, refunds, credits, or timelines. If the right answer depends on a decision the user has not made, put a clearly marked placeholder and ask.

## Knowledge-base article procedure

1. Confirm the issue is likely to recur: more than one ticket, or a common setup. One-off account problems do not need articles.
2. Choose the article type: how-to (task), troubleshooting (symptom to fix), or explanation (concept/policy).
3. Write the title the way customers describe the problem, e.g. "Invoice download shows a blank page", not internal names.
4. Body for troubleshooting: the symptom as the user sees it, who it affects, the cause in a sentence of plain language, the fix as numbered steps, how to confirm it worked, and what to do if it did not (contact path, what info to include).
5. Body for how-to: prerequisites, steps, expected result, common variations.
6. Strip anything specific to the original customer: names, account IDs, screenshots containing their data.
7. Add search terms customers might use, including exact error messages.
8. Note the product version and date so the article can be reviewed when the product changes.

## Pitfalls

- Pasting internal notes or engineer comments into a customer reply.
- Promising a fix date engineering has not committed to.
- Writing a KB article for a workaround that will be obsolete next week without saying so.
- Steps that were never actually walked through. If you can, verify steps against the product or docs; if you cannot, say the steps are unverified.

## Deliverable

For a reply: the ready-to-send draft first, then a short note listing any assumptions, placeholders, and facts you could not confirm. Never send it yourself; the user sends it.

For an article: the full article in Markdown, followed by suggested tags/search terms, which existing articles it overlaps with, and whether the steps were verified.
