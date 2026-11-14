---
name: risk-assessment
description: Build a likelihood x impact risk register for a project, vendor, or change, with mitigations, owners, and triggers; includes vendor due-diligence review. Use for "risk assessment", "what could go wrong", "risk register", "assess this vendor", "is this migration risky", "pre-mortem".
---

# Risk Assessment

A risk assessment is useful when it changes what people do: a mitigation gets funded, a check gets added, a decision gets made with eyes open. A long list of generic risks that nobody owns is decoration.

Use for projects, launches, migrations and infrastructure changes, vendor selection or renewal, and process changes. For live incidents, act first and assess later. For legal or regulatory specifics, pair this with `compliance-check` and qualified counsel.

## What to gather first

- What is being assessed and the decision it informs (go/no-go, which vendor, how much contingency).
- Scope and timeline; what success looks like.
- Constraints and appetite: what the organisation can tolerate (downtime, cost overrun, data exposure).
- Material to read: plans, architecture docs, the change/PR, vendor documents (security questionnaire, certifications, contract, SLA), past incident notes.
- People who know where the bodies are buried; ask the user who to consult rather than guessing.

## Procedure

1. **Identify risks.** Combine approaches so you do not only list the obvious:
   - **Pre-mortem**: assume it failed six months from now; write the most plausible stories of why.
   - **Category sweep**: technical, security, data, operational, people/key-person, schedule, cost, vendor/dependency, legal/compliance, reputational.
   - **Change analysis**: for a technical change, read the actual diff or plan and ask what each piece could break, including rollback.
   Write each risk as cause, event, consequence: "Because the migration locks the orders table, checkout may fail during the window, losing sales and support load."
2. **Score.** Use a simple scale, e.g. 1 to 5 for likelihood and impact, with written anchors agreed for this assessment (what a 5 impact means in money, time, or customers). Score = likelihood x impact. Scores are judgment; record the reasoning in one line so others can challenge it. Do not present scores as measured probabilities.
3. **Prioritise.** Sort by score, but also flag low-likelihood, catastrophic-impact risks separately; multiplying can hide them.
4. **Choose a response for each significant risk:** avoid (change the plan), reduce (lower likelihood or impact), transfer (insurance, contract terms), or accept (explicitly, by someone with authority).
5. **Define mitigations concretely.** Each has an action, an owner (a role or named person the user confirms), a due date, and the expected residual score afterwards.
6. **Add triggers.** Early-warning signals that a risk is materialising (a metric, a missed milestone, a vendor behaviour) and the contingency plan if it fires.
7. **Review cadence.** When the register will be revisited and what events force a review.

## Vendor review

Add these to the register when assessing a third party:

- **Criticality**: what breaks if they disappear tomorrow; is there an exit path and data export?
- **Security and privacy**: what data they receive; certifications or audit reports they can provide (read them rather than accepting the claim); breach history from public sources; subprocessors.
- **Operational**: SLA terms and remedies, support quality, status history.
- **Financial and continuity**: company stability signals, concentration risk if many systems depend on them.
- **Contract**: liability, termination, price-increase terms, data return/deletion (use `contract-review` for depth).
- **Lock-in and switching cost.**
Separate facts verified from documents from claims made by the vendor's sales material.

## Pitfalls

- Generic risks ("project may be delayed") without a cause. Rewrite until they are specific to this situation.
- Mitigations that are wishes ("be careful"). Every mitigation is an action someone can complete.
- Owners who were never asked. Mark proposed owners as proposed.
- False precision: decimals on subjective scores, or invented failure statistics. If you cite a rate, cite its source.
- Ignoring the risks of not doing the change.

## Deliverable

Lead with the conclusion: overall risk level, the top three risks, and a recommendation (proceed / proceed with conditions / do not proceed / need more information). Then the register as a table: ID, risk (cause-event-consequence), likelihood, impact, score, response, mitigation, owner, due date, trigger, residual score. Then accepted risks with who accepts them, and the review date. Finish with what you verified from documents or code, what is the user's or vendor's assertion, and open questions. Do not contact vendors or circulate the register without the user's approval.
