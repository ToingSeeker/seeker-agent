---
name: diagrams
description: Turn a description or a codebase into a clear diagram - Mermaid first (flowchart, sequence, ER, state, class, architecture), rendered to SVG/PNG if a renderer is available. Use for "draw a diagram", "visualize this flow", "architecture diagram", "sequence diagram of this request", "ER diagram".
---

# Diagrams

## When to use
Use this when a structure or flow is easier to see than to read: system architecture, a request's path through services, a state machine, a data model, a deployment topology, or a decision process. Don't use it for quantitative data (that's a chart, see `data-visualization`), or for a diagram that would just restate a three-item list.

## Gather first
- **The question the diagram answers**, for example "how does a webhook reach the database?" or "what tables relate to orders?". One diagram answers one question.
- **The audience.** New engineers need context and labels, while experts need precision and less clutter.
- **The source of truth.** For code-derived diagrams, read the actual code: entry points, imports, route handlers, queue producers and consumers, schema or migration files. Don't draw from file names alone.
- **Where it will live.** A Markdown file (most code hosts render Mermaid natively), docs, or a slide. This decides the output format.

## Choose the diagram type
- **Flowchart:** processes, decisions, pipelines.
- **Sequence:** interactions over time between components, such as API calls, auth handshakes and retries.
- **Entity-relationship:** tables, keys and cardinality.
- **State:** lifecycles with explicit transitions (an order, a payment, a job).
- **Class or module:** static structure and dependencies.
- **Architecture or deployment:** services, data stores, external systems and trust boundaries. Use a flowchart with subgraphs when no dedicated syntax is available.

## Procedure
1. **List the elements and relationships in plain text first**: the nodes, the edges and their labels. For code, cite the file each element came from. This step catches misunderstandings before any drawing.
2. **Cut ruthlessly.** Keep only what serves the question. As a rule of thumb, a diagram past about 15 to 20 nodes should be split into an overview plus detail diagrams.
3. **Write the Mermaid source.**
   - Use readable node ids and human labels.
   - Label the edges with verbs or the data passed.
   - Group with subgraphs for boundaries (service, network, tenant).
   - Choose the direction (`LR` for pipelines, `TD` for hierarchies).
   - Quote labels that contain special characters.
4. **Validate it.** If a renderer is available (e.g. the Mermaid CLI `mmdc`, through `npx` if node is installed), render to SVG or PNG and fix any parse errors. Look at the output. Check that the layout is readable, edges don't tangle needlessly and the text isn't tiny. Reorder declarations or split the diagram if needed.
5. **Without a renderer**, check the syntax carefully against the Mermaid docs for that diagram type, keep to widely supported features, and say the rendering was not verified.
6. **Add a short caption or legend**: what the diagram shows, what it omits, and the date or commit it reflects. Code-derived diagrams go stale, so the commit matters.
7. **Other formats** only on request or when the destination needs them. PlantUML, Graphviz DOT and diagrams-as-code libraries are fine alternatives if installed. For a hand-editable whiteboard file, export from the rendered SVG or offer the Mermaid source for import.

## Quality bar
- Someone unfamiliar can answer the diagram's question from it in under a minute.
- Every arrow has a clear direction and meaning, using consistent notation (e.g. solid for sync calls, dashed for async).
- External systems, data stores and trust boundaries are visually distinct.
- Each element matches something real in the code or the description. Nothing is invented to "complete" the picture. Mark uncertain parts as such.

## Pitfalls
- Drawing everything. A diagram of the whole repo communicates nothing.
- Unlabelled arrows.
- Mixing abstraction levels (a function next to a cloud region).
- Colour as the only carrier of meaning.
- Mermaid syntax that one renderer accepts and another rejects. Check against the target, such as the code host's version.

## Deliver
Put the Mermaid source in a fenced `mermaid` block (or a `.mmd` file), plus rendered SVG and PNG files if a renderer was available, saved next to the docs they belong to. In the report, give the file paths, what the diagram covers and omits, its sources (files read), and whether rendering was verified.
