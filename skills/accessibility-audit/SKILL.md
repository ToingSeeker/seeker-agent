---
name: accessibility-audit
description: WCAG 2.2 AA audit of a page or component: keyboard access, focus, contrast, semantics, accessible names, screen-reader behaviour, motion and zoom, with fixes. Use for "accessibility check", "a11y audit", "is this WCAG compliant", "screen reader support", "keyboard navigation".
---

# Accessibility Audit

Find and fix barriers that stop people using a UI with a keyboard, screen reader, magnification, voice control or reduced motion. Target WCAG 2.2 level AA unless the user names another standard.

This is a technical review, not legal advice or a certification. If the user needs a conformance statement for legal or procurement purposes, recommend an audit by a qualified accessibility specialist and testing with disabled users.

## When to use

- Before shipping a page, form, or component.
- The user asks about accessibility, WCAG, keyboard or screen-reader support.
- After a redesign that changed colours, focus styles or custom controls.

## Gather first

1. Scope: which pages, components and flows (sign-up, checkout, search, dialogs).
2. How to run the app and reach those screens.
3. Available tooling. Automated checkers (e.g. axe-core or Lighthouse, if installed) catch only part of the problems; plan for manual checks regardless.
4. Framework and component library, since many issues come from one shared component.

## Procedure

### 1. Automated pass
Run whatever checker is available against each screen and save the results. Treat them as leads to confirm, not as the audit.

### 2. Keyboard
Using only the keyboard:
- Every interactive element can be reached with Tab and operated with Enter/Space/arrow keys as its role expects.
- Tab order follows visual and logical order; no traps (except a modal, which must trap focus while open and return it to the trigger on close; Escape closes it).
- Focus is always visible, with enough contrast, and not hidden behind sticky headers (2.2 "focus not obscured").
- A skip link or landmarks let users bypass repeated navigation.
- Custom widgets (menus, tabs, comboboxes, sliders) follow the expected keyboard pattern for their role.

### 3. Semantics and names
- Use native elements first: `button` for actions, `a` with `href` for navigation, real `label` for inputs, `table` for tabular data.
- One `h1`, headings in a logical order, landmarks (`header`, `nav`, `main`, `footer`).
- Every control has an accessible name that matches or contains its visible label. Icon-only buttons need a name.
- Images: meaningful ones get alt text that conveys purpose; decorative ones get empty alt.
- ARIA only where native HTML cannot express it, and correctly: wrong ARIA is worse than none.
- Page `lang` set; page titles unique and descriptive.

### 4. Forms and errors
- Labels persist (placeholder is not a label); required fields indicated in text, not only colour.
- Errors identified in text, linked to their field, announced (live region or focus move), and say how to fix.
- Do not ask users to re-enter information already provided in the same flow; do not rely on cognitive tests for authentication without an alternative.

### 5. Visual
- Contrast: 4.5:1 for normal text, 3:1 for large text, and 3:1 for UI component boundaries, icons and focus indicators. Check every theme.
- Colour is never the only way information is conveyed.
- Works at 200% zoom and reflows at 320 CSS px wide without horizontal scrolling (except content like maps or data tables).
- Text spacing can be increased without content being clipped.
- Pointer targets at least 24×24 CSS px or with enough spacing (2.2); dragging actions have a single-pointer alternative.

### 6. Motion, time and media
- Respect `prefers-reduced-motion`; nothing flashes more than three times a second.
- Auto-playing or moving content can be paused; timeouts can be extended.
- Video has captions; audio has transcripts.

### 7. Screen reader spot check
If a screen reader is available (VoiceOver, NVDA, Orca), walk the main flow: headings list, landmarks, form labels, dynamic updates announced. If not available, say so and inspect the accessibility tree instead (browser devtools or a headless browser's accessibility snapshot).

### 8. Fix and re-test
Fix at the shared component where possible. Re-run the automated checker and repeat the manual checks for the fixed items.

## Report format

For each issue: the WCAG success criterion (number and name), where it occurs, who it affects, severity (blocks a task / makes it hard / minor), the fix, and status (fixed or open). Group by component when the same root cause appears in many places.

## Pitfalls

- Declaring compliance from an automated score.
- `div` with click handlers instead of buttons.
- Removing focus outlines without a replacement.
- `aria-label` that contradicts the visible label.
- Hiding content with `display: none` that should stay available to screen readers, or vice versa.

## Deliver

Lead with the verdict for the audited scope and counts by severity. List fixes made, then open issues. State clearly which checks were automated, which were manual, which assistive technologies were actually used, and what was not tested.
