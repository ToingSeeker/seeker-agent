---
name: design-system
description: Build or tidy a design system: token layers (primitive, semantic, component), type/space/colour scales, component specs, and audits for hardcoded values. Use for "set up design tokens", "create a design system", "theme support", "find hardcoded colours", "make styles consistent".
---

# Design System

A design system is the set of decisions that lets many screens look like one product. In code it is mostly tokens plus components that consume only tokens. This skill sets that up, or brings an existing codebase back into line.

## When to use

- Starting a product and wanting consistent styling from day one.
- Adding theming (dark mode, white-label, high contrast).
- Styles have drifted: many near-identical greys, ad-hoc spacing, components restyled per page.
- The user asks to audit hardcoded values.

Not for choosing an aesthetic from nothing (use `frontend-design` first, then encode the result here).

## Gather first

1. Search the repo for what already exists: CSS custom properties, theme objects, Tailwind or similar config, design-token JSON, a component library folder. Extend what is there; do not start a parallel system.
2. Find the styling mechanism and how themes would switch (class or data attribute on the root, media query, runtime context).
3. Identify the components that matter most (buttons, inputs, cards, navigation, tables, dialogs).
4. Ask the user only for genuine decisions: brand colours and fonts if none exist, and which themes must be supported.

## Token architecture

Use three layers. Each layer may only reference the one below it.

1. **Primitive** — raw values with no meaning: `blue-500`, `gray-100`, `space-4`, `radius-2`, `font-size-300`. These form the palette and scales.
2. **Semantic** — purpose-named aliases: `color-bg-surface`, `color-text-muted`, `color-border-default`, `color-action-primary`, `color-status-danger`, `space-inset-card`. Components and pages use these. Themes are implemented by remapping this layer, never by editing components.
3. **Component** (optional, only where needed) — `button-primary-bg`, `input-border-focus`. Add these when a component needs to vary independently of the semantic layer, for example for white-label theming.

Naming: pick one pattern (category–property–variant–state) and stick to it. Name by role, not appearance: `text-muted`, not `text-gray`.

## Scales

- **Colour**: for each hue, a ramp of roughly 10 steps from near-white to near-black, perceptually even (building ramps in OKLCH helps). Neutrals get their own ramp. Verify contrast for the semantic pairs actually used (text on surface, text on accent, border on surface) in every theme.
- **Type**: a modular scale with named steps, each step defining size, line height, weight and letter spacing together.
- **Space**: one scale (4- or 8-based is typical) used for padding, gaps and margins.
- **Radius, border width, elevation (shadows), z-index, motion durations and easings**: small named sets each.
- **Breakpoints**: a few named widths, used consistently.

## Component specs

For each core component, write down (in code comments, stories or a short doc next to the component):
- anatomy (parts), variants and sizes;
- states: default, hover, focus-visible, active, disabled, loading, error, selected where relevant;
- which tokens each part uses;
- accessibility contract: role, keyboard behaviour, required labels.

Build components to accept variants through props, not through callers overriding styles.

## Procedure

1. Inventory current values: grep for hex/rgb/hsl colours, raw pixel or rem values in style code, inline styles, arbitrary utility values. Count duplicates and near-duplicates.
2. Cluster them into the scales above; collapse near-duplicates (several almost-identical greys become one step).
3. Write the primitive and semantic tokens in the project's native format.
4. Migrate the highest-traffic components first, then pages. Keep each change visually equivalent unless the user approved a visual change.
5. Add a theme only by remapping semantic tokens; render both themes to check.
6. Guard against regression: a lint rule, a stylelint config, or a simple grep check in CI that flags raw colour literals outside the token files.
7. Run the build and tests, then open the app and compare key screens before and after.

## Auditing hardcoded values

Report: file, line, the literal, the closest existing token, and whether it is an exact match or a judgement call. Separate safe mechanical replacements from ones that will change appearance, and get approval before applying the latter.

## Pitfalls

- Components referencing primitives directly; theming then needs edits everywhere.
- Semantic names that encode a colour (`bg-blue`), which break on the first rebrand.
- Too many tokens nobody can remember; prefer fewer, well-named ones.
- Dark mode made by inverting the light ramp; it needs its own surface and elevation logic.
- Two token systems coexisting with partial overlap. Pick one and migrate.

## Deliver

Lead with the token structure and where it lives. Summarise what was migrated, what remains (with counts), and how regressions are prevented. State which screens and themes you actually rendered and compared, and which you only changed in code.
