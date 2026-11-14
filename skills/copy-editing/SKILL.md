---
name: copy-editing
description: Edit existing marketing or product copy in focused passes - clarity, specificity, proof, voice, length - showing before/after and the reason for each change, without rewriting what already works. Use for "edit this copy", "tighten this", "proofread my landing page", "make this clearer".
---

# Copy Editing

## When to use
- Copy exists and is roughly right, but is wordy, vague, inconsistent, or unconvincing.
- A final review before publishing.

If the core message or audience is wrong, editing will not save it; recommend a rewrite with the
copywriting skill and explain why.

## Gather first
- The copy itself, and where it lives (file, CMS export, doc). If it is in a codebase, find every place
  the strings appear, including i18n files.
- The goal of the page and the intended reader.
- Voice and style rules: a style guide, brand glossary, or the tone of the best existing pages.
- Constraints: character limits, legal wording that must not change, terms that are product names or
  identifiers and must stay exactly as they are.
Ask only for what you cannot infer.

## Procedure
Work in separate passes. Mixing them leads to rewriting everything and losing the author's voice.

### Pass 1: Clarity
- Can a reader state the main point after reading the first sentence or headline? If not, move the
  point up.
- Replace jargon and internal terms with the reader's words.
- Split sentences that carry more than one idea. Fix ambiguous pronouns.
- Prefer active voice when the actor matters.

### Pass 2: Specificity
- Swap abstract claims for concrete outcomes, numbers, examples, or mechanisms the user can support.
- Where a specific is needed but unknown, insert a marked placeholder and list it; do not invent one.
- Cut empty intensifiers and filler adjectives.

### Pass 3: Proof and credibility
- Each strong claim should have support nearby: a customer quote, a figure, a demo, a guarantee.
- Remove or soften claims that cannot be supported, and flag any that may need legal review
  (comparisons, guarantees, health or financial outcomes).

### Pass 4: Voice and consistency
- One tone throughout; match the style guide or the best existing pages.
- Consistent terminology: one name per feature, consistent capitalisation, the same spelling variant.
- Calls to action phrased the same way for the same action.

### Pass 5: Length and flow
- Cut what the reader does not need for the decision at hand. Shorter is better only when nothing
  important is lost.
- Check the order: does each section answer the question the previous one raised?
- Fit layout limits; buttons and headings often have tight space.

### Pass 6: Mechanics
Spelling, grammar, punctuation, numbers and units, broken links, and text that is duplicated across
components.

## How to present edits
- Show each meaningful change as before / after / reason. Group trivial mechanical fixes into one list.
- Keep the author's voice. Edit the fewest words that achieve the improvement.
- Mark changes as required (errors, false or risky claims) versus suggested (style), so the user can
  accept selectively.
- For long documents, return a fully edited version plus the change log.

## Applying edits in code
- Edit strings where they live; update every locale only if you can translate accurately, otherwise
  flag the other locales as out of date.
- Do not change keys, slugs, IDs, URLs, or anything that looks like prose but is used as an identifier.
- Run the build or tests, and view the rendered page if possible to confirm nothing overflows or
  breaks. Say plainly if you could not view it.

## Pitfalls
- Rewriting instead of editing.
- Making everything shorter until it loses meaning or warmth.
- Introducing claims the author did not make.
- Fixing one instance of a term and leaving its other uses inconsistent.

## Deliver
Lead with the two or three edits that matter most. Then the change log (before / after / reason,
required vs suggested), the edited copy, open placeholders, and what you verified (build, render) and
what you did not. Do not publish without approval.
