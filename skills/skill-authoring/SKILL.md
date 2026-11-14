---
name: skill-authoring
description: Write or improve an agent skill - a SKILL.md whose description triggers on the right requests, a lean procedural body, tested on real prompts; or capture a workflow that just worked. Use for "make a skill", "turn this into a skill", "improve this skill", "is there a skill for".
---

# Skill authoring

## When to use
- Use this when a task recurs and the agent keeps needing the same instructions, conventions or gotchas.
- Use it when a workflow just succeeded and should be repeatable ("save this as a skill").
- Use it when an existing skill triggers at the wrong times, or produces weak results.

Don't write a skill for a one-off task, or for something the model already does well without help. A skill that adds nothing still costs context and selection accuracy.

**Finding before writing:** search the installed and bundled skills first (list the skills directory, grep descriptions for the task's keywords). Extending a close match beats adding a near-duplicate. Only install third-party skills after reading them. They are instructions the agent will follow, so review them like code, including the licence.

## Format
A folder named after the skill (lowercase-kebab) containing `SKILL.md`:

```
---
name: <folder-name>
description: <what it does + when to use it, with phrases users actually say>
---
# Title
<body>
```

Add extra files (reference tables, scripts, templates) only when they're genuinely needed. Link them relatively from the body so they load on demand.

## The description does the triggering
The model decides whether to load a skill mostly from its description. Write it to:
- State the outcome in the first clause.
- Include the trigger phrases a user would type ("write a runbook", "why is this query slow").
- Disambiguate from neighbouring skills ("not for X; use Y").
- Stay within the length the host allows.
Avoid vague verbs ("helps with", "handles") and internal jargon.

## Writing the body
1. **Start from real transcripts.** Collect two or three actual runs of the task: what the agent did, where it went wrong, and what the user corrected. The skill should encode those corrections. Generic best practice the model already knows is padding.
2. **Use this shape:** when to use (and not) → what to gather first → ordered procedure → quality bar and pitfalls → what to deliver and how to report it.
3. **Be imperative and specific.** "Run the typecheck command from CI, not the build" beats "ensure quality". Explain *why* for non-obvious rules, so the model can generalise instead of pattern-matching.
4. **Make verification part of the procedure.** Say what to run to prove the work is done, and require reporting what wasn't verified.
5. **Gate actions that go outward.** Deploys, messages, purchases and deletions need explicit confirmation steps.
6. **Keep it portable.** Describe actions ("search the code for…") rather than one tool's exact syntax, unless the skill is tool-specific. Name optional tools as examples, and don't require paid services.
7. **Keep it lean.** If a section doesn't change behaviour, cut it. Long skills dilute the important lines.

## Testing
1. Write five to ten realistic prompts. Some should trigger the skill, and some near-misses should not.
2. Check **triggering**: in a fresh session, does the agent load the skill for the positives and leave it alone for the negatives? Adjust the description.
3. Check **behaviour**: run the positives with the skill, and where practical without it. Compare the outputs against what a good result looks like. If the skill doesn't make a visible difference, rethink or drop it.
4. Read the agent's actual steps, not just the final answer. Skills often fail by being skimmed, so move the critical rule higher, or make it shorter.
5. Re-test after every substantive edit.

## Improving an existing skill
- Read it fully and find the failures it caused (transcripts, user complaints).
- Prefer the smallest edit that fixes the observed failure. Sharpen a line, reorder, or add a pitfall before restructuring.
- Remove stale instructions: renamed commands, tools that no longer exist, rules for problems now fixed in code.
- Watch for drift between the description and the body's actual scope.

## Pitfalls
- Secrets, personal data or machine-specific paths baked into a shared skill.
- Copying another skill's text whose licence doesn't allow it. Rewrite from your own understanding.
- Several overlapping skills competing for the same trigger.

## Report
Give the path of the skill written or changed and its final description, the test prompts used with their trigger and behaviour results, and the known gaps.
