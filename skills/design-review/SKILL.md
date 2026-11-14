---
name: design-review
description: Visual QA of a built UI: hierarchy, spacing, alignment, consistency, interaction states and responsive behaviour, then fix and re-check on the rendered page. Use for "review the design", "does this look right", "polish this page", "visual QA", "design critique".
---

# Design Review

Review what users actually see, not what the code says they should see. A passing build and green tests prove nothing about layout. The core loop is: render, look, note, fix, render again.

## When to use

- A feature's UI is built and needs polish before shipping.
- The user asks for a critique, visual QA, or "does this look right".
- After a restyle or design-system migration, to catch regressions.

Not for: choosing a direction from scratch (`frontend-design`) or a formal WCAG audit (`accessibility-audit`), though obvious accessibility defects should be noted here too.

## Gather first

1. Which pages, components and flows are in scope, and the viewport sizes that matter.
2. How to run the app locally, and any login or seed data needed to reach the screens.
3. The intended design if one exists: mockups, a design system, brand guidance. Without one, judge against internal consistency and general practice.
4. A way to see the page: a headless browser (e.g. Playwright, if installed) for screenshots, or ask the user for screenshots if nothing can render.

## Procedure

### 1. Capture the current state
Start the app and screenshot each in-scope screen at roughly three widths (phone, tablet, desktop). Capture key states too: empty, loading, error, long content, many items, hover and focus. If you cannot render a screen, record that; do not review it from code alone and present the result as visual.

### 2. Review in passes
Do separate passes; mixing them makes you miss things.

- **Hierarchy**: what does the eye land on first, second, third? Is that the right order for the screen's job? Is there one clear primary action?
- **Layout and alignment**: shared edges, consistent gutters, nothing a few pixels off. Content width sensible on wide screens.
- **Spacing**: values come from one scale; related items grouped; no cramped or floating elements.
- **Typography**: limited sizes and weights, consistent heading levels, readable line length and height, no orphaned single words in headlines where avoidable, no truncation that hides meaning.
- **Colour and contrast**: accent used sparingly and meaningfully; semantic colours used only for meaning; text legible.
- **Consistency**: the same thing looks the same everywhere (buttons, cards, icons, radii, shadows, date formats).
- **States**: hover, focus-visible, active, disabled, loading, empty, error and success all exist and look intentional.
- **Responsive**: no horizontal scroll, touch targets comfortably large, nav usable on phones, images not distorted, tables handled.
- **Content**: realistic copy and data; check the longest name, the biggest number, the missing avatar.

### 3. Write findings
For each issue: where (screen, element), what is wrong, why it matters, and the proposed fix. Rate severity:
- **Blocker** — broken, unreadable, or misleading.
- **Major** — noticeably hurts clarity or trust.
- **Minor** — polish.

Lead with what works well in a sentence or two so the user knows what not to change.

### 4. Fix
Fix in the code at the source: a token, a shared component, a layout primitive. Avoid page-specific overrides that hide a systemic problem. Ask before changes that alter brand, content or behaviour.

### 5. Re-check
Re-render the same screens at the same widths and compare against the earlier captures. Confirm each fix and look for regressions elsewhere that share the changed component.

## Pitfalls

- Reviewing only the happy path with perfect demo data.
- Reviewing only desktop.
- Fixing one instance of a pattern that appears on ten screens.
- Subjective taste presented as a defect; label preferences as such.
- Claiming something "looks good" without having rendered it.

## Deliver

Lead with the overall verdict and the count of blockers/majors/minors. Then the findings list, grouped by screen, marked fixed or open. Attach or reference the before/after screenshots. End with what you verified by rendering and what you could not see (screens behind auth you could not reach, states you could not trigger, real devices you did not test).
