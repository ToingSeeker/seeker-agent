---
name: llm-eval-plan
description: Design an eval for an LLM feature, prompt change or model choice before spending money - hypotheses, dataset, metrics and bars, baselines and decoys, stop rules, a tiny priced pilot. Use for "which model should we use", "eval this prompt", "benchmark models", "is the new prompt better".
---

# LLM evaluation plan

## When to use
Use this before running anything that costs real money or time against models: choosing between models, comparing prompts, validating a RAG or agent change, or deciding whether a cheaper model is good enough. The point is to decide what "better" means *before* seeing the results, so you don't rationalise whatever comes out. Don't use it for a one-off "try this prompt and see". Just try it.

## Gather first
- **The decision this eval informs.** For example, "switch the summariser to model X if quality holds and cost drops". No decision means no eval.
- **The task as users experience it.** Real inputs, the expected outputs, and what failure looks like (wrong facts, bad format, refusal, too slow, too costly).
- **Budget and constraints.** Maximum spend, latency targets, data that can't leave the environment, and rate limits.
- **Existing data.** Logs, past tickets, labelled examples, user feedback. Real traffic beats invented cases. Strip personal data before using it.

## Procedure
1. **Write the hypotheses** as falsifiable statements. For example: "Prompt B reduces format errors versus A without lowering answer accuracy by more than a small, pre-stated margin."
2. **Build the dataset.**
   - Sample from real usage, stratified by the case types that matter.
   - Add deliberately hard cases: long inputs, ambiguity, adversarial phrasing, other languages, and empty or malformed input.
   - Keep a held-out split you don't look at while iterating on prompts.
   - Size it to the decision. A pilot can be a handful of items, and the real run needs enough items to distinguish the arms on the cases you care about.
3. **Choose the metrics and bars.**
   - Prefer deterministic checks (exact match, schema validity, test passes, citation present) over judgement where you can.
   - Where judgement is needed, write a rubric with concrete anchors and spot-check the judge against human labels.
   - Record cost per item and latency alongside quality.
   - Set the pass/fail bar and the minimum meaningful difference now.
4. **Define the arms and the controls.**
   - Include the current production setup as a baseline.
   - Add **decoys**: a deliberately weak arm (e.g. a trivial prompt or a much smaller model) that should lose. If it doesn't lose, the metric or the judge is broken.
   - Randomise the order, and blind the judge to which arm produced which output.
5. **Write the stop rules.** Spend caps, and early-stop conditions (e.g. a hard failure rate on the pilot above a threshold, or the decoy winning). Also decide what result leads to which decision, including "inconclusive, so keep current".
6. **Dry-run at zero cost.** Run the harness end to end against a stub or cached responses. This proves the parsing, scoring and reporting work before any paid call.
7. **Run a small priced pilot.** A few items per arm. Report the actual cost and latency per item, project the full-run cost, and check the scores look sane. Get the user's approval before the full run if the projected spend is material.
8. **Run, then analyse against the pre-registered bars.** Look at per-category results and at individual failures, not just averages. Report variance. With sampling, run repeats or use temperature 0 where appropriate.

## Pitfalls
- Tuning prompts on the same items you report results on.
- LLM-as-judge preferring longer answers, or its own model family. Calibrate against humans, and swap the position order.
- Benchmarks or public leaderboards standing in for your task. They rarely transfer.
- Ignoring cost and latency until after the quality winner is chosen.
- Declaring a winner on a difference smaller than run-to-run noise.

## Deliver
A short plan document: the decision, the hypotheses, a dataset description and its location, the metrics and bars, the arms (including baseline and decoy), the stop rules, the dry-run result, and the pilot cost table with a projected total. When results exist, lead with the decision they support, then the evidence, the caveats, and what was not tested.
