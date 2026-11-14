---
name: web-animation
description: Add motion to web UIs with CSS transitions/keyframes, the Web Animations API, scroll-driven effects and 3D scenes in three.js, keeping it smooth, purposeful and reduced-motion safe. Use for "animate this", "add transitions", "page motion", "three.js scene", "scroll animation", "janky animation".
---

# Web Animation

Motion should explain what changed, direct attention, or give feedback. Done well it is barely noticed; done badly it slows people down, drains batteries and makes some users ill.

## When to use

- UI transitions: menus, dialogs, toasts, list changes, page transitions, button feedback.
- Scroll-linked or entrance effects on marketing pages.
- 3D or WebGL scenes with three.js.
- Fixing animation that stutters.

## Gather first

1. What the motion is for. If there is no purpose, recommend not adding it.
2. Stack: plain CSS, a framework, or an existing animation library in the repo (search package.json). Use what is already there before adding a dependency.
3. Target devices: low-end phones change the budget.
4. Any motion spec from design (durations, easings) or design-system motion tokens.

## Choosing the tool

- **CSS transitions** for state changes between two values (hover, open/closed).
- **CSS keyframes** for self-contained loops or entrances.
- **Web Animations API** (`element.animate`) when JavaScript must start, reverse, chain or await animations.
- **View Transitions API** for page or large layout transitions where supported, with a plain fallback.
- **Scroll-driven animations** (CSS `animation-timeline`) where supported; otherwise IntersectionObserver to toggle classes. Avoid scroll event handlers that do layout work.
- **three.js** for real 3D. Do not use WebGL for effects CSS can do.
- An animation library only for complex orchestration, physics-like springs or layout animation the platform cannot do easily.

## Performance rules

- Animate `transform` and `opacity`. Animating width, height, top, left, margin or box-shadow triggers layout or paint each frame.
- Use `will-change` sparingly and only during the animation.
- Avoid reading layout (e.g. `getBoundingClientRect`) and writing styles in the same frame repeatedly; batch reads then writes.
- Use `requestAnimationFrame` for JS-driven loops, never timers.
- Measure: use the browser's performance panel or a headless browser trace to look for long frames, and test with CPU throttling.

## Timing and easing (rules of thumb)

- Small UI feedback: about 100–200 ms. Panels and dialogs: about 200–300 ms. Large page transitions: up to about 400–500 ms.
- Ease-out for things entering, ease-in for things leaving, ease-in-out for things moving on screen.
- Exits slightly faster than entrances.
- Stagger lists lightly; long staggers make users wait.
- Define durations and easings as tokens and reuse them.

## Reduced motion and accessibility

- Respect `prefers-reduced-motion: reduce`: replace movement with fades or instant changes, stop parallax, autoplaying loops and large zooms.
- Nothing flashes more than three times per second.
- Provide a pause control for any motion that lasts more than a few seconds.
- Do not move focus or content under the user's pointer unexpectedly; keep focus management correct when dialogs animate in and out.

## three.js essentials

- Set up renderer, scene, camera; cap device pixel ratio (around 2) to protect weaker GPUs; resize on container size changes.
- Drive animation with `renderer.setAnimationLoop` and a clock delta so speed is frame-rate independent.
- Use `AnimationMixer` for clips from glTF models; prefer compressed glTF (Draco or Meshopt) and compressed textures for size.
- Keep draw calls low: merge static geometry, use instancing for repeats, limit real-time shadows and post-processing.
- Pause rendering when the canvas is off-screen or the tab is hidden; dispose geometries, materials and textures when tearing down (important in SPA route changes).
- Provide a static fallback image for no-WebGL and reduced-motion users, and lazy-load the 3D bundle.

## Procedure

1. Write down each animation: trigger, property, duration, easing, reduced-motion behaviour.
2. Implement with the lightest tool that works.
3. Run it and watch it at normal speed and slowed down (devtools animation panel), on desktop and an emulated phone with CPU throttling.
4. Toggle reduced-motion emulation and confirm the alternative.
5. Record a trace if anything stutters and fix the cause (layout thrash, oversized textures, too many draw calls).

## Deliver

Lead with what now animates and why. List durations/easings used and the reduced-motion behaviour. State what you observed running (browsers, throttling, frame rate seen) and what you did not test, such as real low-end devices or Safari.
