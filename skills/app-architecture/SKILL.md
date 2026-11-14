---
name: app-architecture
description: Design a multi-screen app top-down before pixels: users and jobs, information architecture, navigation, user flows, screen inventory and per-screen states, plus a handoff spec. Use for "plan the app structure", "design the screens", "user flows", "sitemap", "IA", "handoff spec".
---

# App Architecture (UX)

Most broken apps are broken in structure, not styling: features nobody can find, flows that dead-end, screens with no empty or error state. Decide the structure first, then design screens.

## When to use

- A new app or a major new area with several screens.
- An existing app whose navigation has grown confusing.
- Preparing a spec that someone else (or a later session) will implement.

Not for styling a single screen (`frontend-design`) or reviewing a built UI (`design-review`).

## Gather first

Ask only what you cannot infer, and propose defaults where you can.
1. **Users**: the main roles (e.g. customer, staff, admin) and what each is trying to get done.
2. **Jobs**: the top tasks per role, ranked by frequency and importance.
3. **Objects**: the core things in the domain (orders, projects, messages) and how they relate.
4. **Platform and constraints**: web, mobile, desktop; offline needs; permissions; existing screens and routes if the code already exists (read the router).

## Procedure

### 1. Object model
List the domain objects, their key attributes, relationships, and the actions each role can take on each object. Good navigation usually falls out of this: objects become sections, actions become buttons.

### 2. Information architecture
- Group content into a small number of top-level sections named in the users' words, not the database's.
- Decide navigation pattern by platform and section count: tabs or bottom bar for a few peers on mobile; sidebar for many sections or deep tools; top nav for content sites.
- Draw the sitemap as an indented list or a Mermaid diagram with routes. Note where each object's list and detail views live.
- Keep important tasks within a couple of steps of the entry point; put rare settings deeper.
- Separate roles cleanly: decide whether admins get a separate area or extra controls in the same views.

### 3. Flows
For each top task, write the flow: entry point, steps, decisions, success end, and every failure branch (validation error, network error, no permission, empty data, cancelled midway). A Mermaid flowchart or numbered steps is enough. Check that every branch ends somewhere useful; dead ends are the most common defect.

Include the unglamorous flows: first run and onboarding, sign-in and recovery, empty account, deleting things, undo, notifications bringing the user back in.

### 4. Screen inventory
One row per screen: route, purpose, role(s), the data it shows, primary action, secondary actions, and where it links to. Merge screens that do the same job; split screens doing two unrelated jobs.

### 5. States per screen
For each screen define: loading, empty (first use vs. no results), partial data, error (recoverable and not), no permission, offline if relevant, and success feedback. Also the extremes: a single item, thousands of items, very long text.

### 6. Low-fidelity layout
Only now sketch layouts: the content blocks in priority order and the primary action's position. Text wireframes or simple HTML boxes are fine. Validate them against the flows before styling.

### 7. Handoff spec
For implementation, write per screen: route, components used, data needed and its source, interactions and their results, validation rules, states, analytics events if any, accessibility notes (focus order, announcements), and open questions. Reference the design system tokens and components rather than raw values.

## Quality bar

- Every top task has a flow with all failure branches resolved.
- Every screen has a reason to exist and defined states.
- Terminology is consistent across navigation, screens and copy.
- Permissions are explicit: who can see and do what on each screen.
- Nothing in the spec needs the reader to guess.

## Pitfalls

- Mirroring the database or org chart in navigation.
- Designing only the happy path.
- Hiding the main task behind a dashboard of vanity widgets.
- Adding a settings toggle instead of making a decision.
- Starting with high-fidelity visuals, which makes structural feedback harder to give.

## Deliver

Lead with the sitemap and the list of top flows. Then the screen inventory, states, and handoff notes, written to a file in the repo if the user wants it kept (ask where). Flag open decisions that belong to the user (pricing gates, roles, legal content) rather than deciding them silently, and state which parts were checked against existing code and which are proposals.
