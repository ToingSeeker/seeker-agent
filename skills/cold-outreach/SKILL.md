---
name: cold-outreach
description: Build a targeted prospect list and write respectful cold email or DM sequences that comply with anti-spam and privacy law (CAN-SPAM, GDPR basics). Use for "cold email", "outbound sequence", "find leads", "prospect list", "sales outreach", "write a DM to prospects".
---

# Cold Outreach

## When to use
Use for first contact with people who have not opted in: B2B sales outreach, partnership asks, recruiting, PR pitches. Do not use for emailing your own subscribers or customers (see `email-sequences`). Do not help with bulk unsolicited messaging to consumers, purchased lists of personal emails, scraping private data, or evading spam filters — decline those parts and explain why.

Not legal advice. Anti-spam and privacy law varies by country; for regulated industries or large-volume programmes, have the user check with a qualified lawyer.

## Gather first
- **Offer and proof**: what you sell, the specific problem it solves, and any credible evidence (named customers if public, measurable results the user can stand behind).
- **Ideal customer profile**: company type, size, region, signals that suggest the problem exists right now (hiring for a role, new funding, a tech they use, a recent launch).
- **Persona**: which role feels the pain and which role buys.
- **Recipient jurisdictions**: this determines the legal basis (see below).
- **Sending setup**: domain, volume the user plans, channel (email, LinkedIn, X, etc.).

## Procedure

### 1. Build the list
1. Turn the profile into explicit, checkable criteria. Prefer *trigger signals* (something changed recently) over static firmographics.
2. Find companies from public sources: company websites, job boards, public directories, press releases, open-source contributor pages, conference speaker lists. Use web search and fetching if available; respect robots.txt and site terms.
3. For each company, identify the relevant role from public information. Use business contact details only; do not guess or harvest personal addresses.
4. Record per row: company, person, role, source URL, the trigger you found, and one specific observation you could open with. A row without a real observation is a weak lead — keep it out or mark it low priority.
5. Verify, don't invent. Never fabricate names, titles or emails. Mark unverified fields as such.
6. Start small (tens, not thousands) so you learn before scaling.

### 2. Check the legal basis
- **US (CAN-SPAM)**: commercial email is allowed without prior consent but must have accurate headers and sender identity, a non-deceptive subject, a physical postal address, a clear way to opt out, and opt-outs honoured promptly.
- **EU/UK (GDPR + ePrivacy/PECR)**: B2B outreach to work addresses generally relies on legitimate interest; you must be able to justify relevance, tell people where you got their data, and offer an easy objection. Rules for individual/sole-trader addresses are stricter and vary by country.
- **Canada (CASL)**: stricter; generally needs consent, with limited exceptions such as conspicuously published business addresses relevant to the person's role.
- Everywhere: keep a suppression list and never re-contact someone who opted out.

### 3. Write the sequence
A typical sequence is a first message plus two to three follow-ups spaced several days apart, then stop. Each message:
- **Opens with them**: the observation from the list, connected to a problem it implies. Personalisation must be relevant, not decorative ("saw you went to X university" is noise).
- **States the problem and one line of proof** in plain words.
- **Makes one small ask**: a question they can answer in a sentence, or permission to send something. Not "30 minutes this week" in the first touch unless the context earns it.
- **Is short**: readable on a phone without scrolling. No attachments or tracking-heavy images in first contact.
- **Has an honest subject line**: lowercase and specific beats clever; no fake "Re:".
Follow-ups add something new each time (a different angle, a resource, a relevant example), not "just bumping this". The last one closes the loop politely and says you will not follow up again.
For DMs, be even shorter, and check each platform's rules on automation; many prohibit it.

### 4. Protect deliverability and reputation
- Send from a properly authenticated domain (SPF, DKIM, DMARC) — check with `dig TXT` if the user wants verification.
- Ramp volume slowly; avoid link shorteners and spammy phrasing.
- Watch bounce and complaint rates; pause if they rise.

## Quality bar
Before delivering, check each message: would a busy recipient understand why they got it within one line? Is every claim true and supportable? Is there exactly one ask? Would the sender be comfortable if it were forwarded publicly?

## Deliver
Lead with the summary: list size, criteria used, and sequence length. Then the list (CSV or table with sources), the sequence copy with variables marked, the compliance notes for the target jurisdictions, and what to measure (reply rate and positive-reply rate, not opens). State which contacts are verified and which are not. Never send messages, upload contacts to a tool, or connect to an inbox without explicit confirmation from the user.
