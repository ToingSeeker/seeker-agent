---
name: ux-copy
description: Write or improve interface microcopy: button labels, error messages, empty states, confirmations, tooltips, onboarding hints and notifications. Use for "rewrite this error message", "better button text", "empty state copy", "UX writing", "make the wording clearer".
---

# UX Copy

Interface text is part of the interface. Good microcopy tells people where they are, what will happen, and what to do next, in as few words as that takes.

## When to use

- Writing labels, errors, empty states, dialogs, toasts, tooltips, onboarding or settings descriptions.
- Reviewing existing UI text for clarity and consistency.
- Translating developer-facing messages ("Error 422") into user-facing ones.

Not for long-form marketing copy or brand voice definition (see `brand-identity`), though the voice it defines should be applied here.

## Gather first

1. The product's voice if documented; otherwise infer it from existing copy and match it.
2. The audience and their context: expert or first-time, calm or stressed (payments, health, errors), mobile or desktop.
3. The exact moment: what the user just did, what the system knows, what they can do next.
4. Constraints: character limits, localisation (text expands in many languages), legal or compliance wording that must stay verbatim.
5. Search the codebase for existing strings and terminology so new copy uses the same words for the same things.

## Principles

- **Clear before clever.** Humour only where nothing is at stake.
- **Say what happens.** Labels are verbs naming the outcome: "Delete project", "Send invoice", not "OK" or "Submit".
- **Front-load.** Put the important words first; people scan.
- **One term per concept.** If it is a "workspace" in navigation, it is never a "team" in a dialog.
- **Talk to the user**, in plain words, active voice, present tense. Avoid internal jargon and system names.
- **Be specific.** "Password must be at least 12 characters" beats "Invalid password".
- **Do not blame.** "We couldn't find that page" rather than "You entered a wrong URL".
- **Sentence case** for UI text unless the product convention differs.

## Patterns by type

**Buttons and links** — verb plus object, two to four words. Paired buttons describe their outcomes ("Discard changes" / "Keep editing"), not "Yes/No". Link text makes sense out of context; never "click here".

**Error messages** — what happened, why if known and useful, how to fix it. Put the message next to the problem. Keep the user's input. For system failures, say whether retrying will help and whether anything was lost. Never show raw stack traces or codes alone; a reference code can accompany a human sentence for support.

**Empty states** — explain what will appear here and give the next action. Distinguish first use ("No invoices yet — create your first one"), no results ("No matches for 'abc'. Try a shorter search"), and cleared ("All caught up").

**Confirmations for destructive actions** — name the thing and the consequence ("Delete 'Q3 report'? This removes it for everyone and can't be undone."). The confirm button repeats the action verb. Consider undo instead of a dialog when reversal is possible.

**Success and toasts** — short, past tense, with an action if relevant ("Invoice sent. View"). Do not announce trivial successes.

**Forms** — labels are nouns, always visible. Helper text explains format or why you ask, before the user errs. Mark optional or required consistently.

**Onboarding and hints** — one idea at a time, tied to what the user is doing now. Let people skip. Don't explain what the UI already makes obvious.

**Loading and progress** — say what is happening if it takes more than a moment; give progress for long tasks.

## Procedure

1. Collect every string in scope with its context (screen, trigger, component). A table works well.
2. For each, identify the user's question at that moment and whether the text answers it.
3. Draft a replacement; offer two options only where the choice is genuinely about tone.
4. Check length in the real component: render it, including narrow screens and a longer-language estimate (allow roughly a third more width as a rule of thumb).
5. Check consistency across the set: terms, capitalisation, punctuation, tone.
6. Apply the changes where strings live (i18n files if present, so translations keys stay intact; flag new keys that translators need).

## Pitfalls

- Changing legal, pricing or compliance wording without approval.
- Editing a string key used in several places with different meanings.
- Error copy that promises a cause the code cannot know.
- Exclamation marks and apologies on every message.

## Deliver

Lead with a before/after list of the changed strings and their locations. Note terminology decisions made, strings left unchanged on purpose, any that need legal or product sign-off, and whether you saw the new text rendered in the UI or only edited source.
