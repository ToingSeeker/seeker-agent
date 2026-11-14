---
name: frontend-design
description: Give a web UI a deliberate aesthetic direction (typography, colour, layout, motion) instead of generic AI-default styling. Use for "make this look good", "design a landing page", "this UI looks bland/generic", "restyle this", "give it personality".
---

# Frontend Design

Turn a working-but-forgettable interface into one that looks chosen. The goal is not more decoration; it is a small number of strong, consistent decisions that fit the product and its users.

## When to use

- Building a new page, landing page, dashboard or component set where visual quality matters.
- The user says the UI looks generic, templated, "AI-made", or bland.
- Restyling an existing screen without changing what it does.

Not for: building a token system from scratch (use `design-system`), auditing a finished UI for defects (use `design-review`), or accessibility compliance (use `accessibility-audit`). Everything here must still pass those.

## Gather first

1. **Who and what**: the product, its audience, and the one job this screen does. A trading terminal, a children's app and a law firm site want opposite things.
2. **Existing constraints**: brand colours, fonts, a design system or component library already in the repo. Search for tokens, theme files, Tailwind config, CSS custom properties. Never silently replace an established brand.
3. **Stack**: framework, styling approach (CSS modules, utility classes, CSS-in-JS), whether fonts can be self-hosted.
4. **References**: if the user has examples they like, ask for them once. If not, propose a direction yourself rather than asking open-ended questions.

## Procedure

### 1. Commit to a direction
Before touching code, state the direction in two or three sentences: mood, a reference point, and what will be distinctive. Possible directions: editorial and calm with a serif display face; dense utilitarian tool with a monospace accent; warm and tactile with rounded shapes and paper tones. Pick one. Blending three is how interfaces end up generic.

### 2. Typography
- At most two families: one for display, one for text (or one family at different weights). Choose for character and legibility, not because it is the framework default.
- Define a type scale with clear steps (a ratio of roughly 1.2–1.33 is a common start) and use only those sizes.
- Body text: line length of roughly 60–75 characters, line height around 1.5; headings tighter.
- Create hierarchy with size, weight and spacing before reaching for colour.

### 3. Colour
- Start with a neutral ramp (page, surface, border, three text levels), then one primary accent and at most one secondary. Semantic colours (success, warning, danger) mean something and are used only for that.
- Nudge neutrals slightly toward the accent's hue so the palette feels related.
- Keep the accent scarce: it marks the most important action or state on screen.
- Check contrast while choosing, not afterwards (WCAG AA: 4.5:1 body text, 3:1 large text and UI boundaries).

### 4. Layout and spacing
- One spacing scale (4- or 8-based is typical) and nothing outside it.
- Establish a grid and shared alignment edges. Asymmetry is fine when deliberate.
- Group with space: related items close, unrelated items apart. Prefer spacing over boxes and borders.
- Design the narrow viewport as a first-class layout, not a squashed desktop.

### 5. Detail and motion
- One radius family, one elevation logic, one icon set with consistent stroke weight.
- Motion explains change (enter, exit, reorder, feedback), stays short (roughly 150–300 ms for UI), and honours `prefers-reduced-motion`. See `web-animation`.

### 6. Build, then look
Implement through variables or tokens, never scattered literals. Run the app and look at the rendered result at desktop and mobile widths; take screenshots if a browser tool is available. Adjust from what you see, not from what the code implies.

## Generic-default tells

- Purple-to-blue gradients, glowing blobs and frosted glass applied by reflex.
- Every section is a centred heading plus three identical icon cards.
- Emoji standing in for icons; rocket-and-sparkle imagery.
- Gradient text on every heading, shadows on everything, every corner pill-rounded.
- System font plus one random accent, no type scale.
- Ornament that carries no information and competes with content.

Each of these can be right in context. The problem is using them without a reason.

## Quality bar

- Someone could describe the direction in one sentence after seeing the page.
- A squint test shows the headline and primary action first.
- Values come from a small token set; no stray hex codes or one-off pixel values.
- Interactive and data states exist: hover, focus-visible, active, disabled, loading, empty, error.
- Contrast meets AA, focus is visible, layout survives 320 px width and 200% zoom.

## Deliver

Lead with the direction chosen and what changed. List files touched and tokens introduced. State exactly which pages and widths you rendered and checked, and which you did not. If fonts or assets carry licence terms or need a network fetch, say so.
