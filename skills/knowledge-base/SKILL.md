---
name: knowledge-base
description: Create and maintain a Markdown knowledge base or Obsidian vault that people and agents can search: structure, frontmatter, links, index notes, and hygiene (orphans, broken links, stale notes). Use for "start a knowledge base", "add this to my notes", "organise my vault".
---

# Knowledge Base

## When to use

Starting a collection of Markdown notes, adding or updating entries, or reorganising and cleaning an existing one, including an Obsidian vault. Not for project documentation that belongs next to code (README, docs/ folders follow the project's conventions).

## Gather first

- Location of the knowledge base, and whether it is a git repo or synced (Obsidian sync, cloud folder). Read any existing conventions file or index note before changing anything.
- Who uses it: one person, a team, agents, or all three. Agents need predictable structure and frontmatter; humans need good titles and navigation.
- For an existing vault: its current folder layout, tag style, link style (`[[wikilinks]]` or Markdown links), and plugins relied on (Dataview queries, templates). Do not break what works.

## Structure for a new knowledge base

Keep it shallow and boring:
- A root `README.md` or `index.md` explaining purpose, layout and conventions, and linking to the main hub notes.
- A few top-level folders by kind of note, not by date, for example `topics/`, `projects/`, `people/` (only if appropriate), `references/`, `journal/` or `inbox/`. Add folders only when a group of notes actually exists.
- One idea or entity per note. Short notes with links beat long notes that mix subjects.
- File names: lowercase-kebab or human titles, chosen once and used consistently; avoid characters that break on other systems (`: ? * / \ | < > "`).

## Note format

Start each note with YAML frontmatter, then a level-one title and a one- or two-sentence summary that would let a reader (or a search result) decide whether the note is relevant:

- `title`, `type` (topic, project, reference, decision, how-to), `tags`, `created`, `updated`, and optionally `status`, `source`, `aliases`.
- Keep a fixed, small vocabulary for `type` and `status`; document it in the README.
- Dates in ISO format (YYYY-MM-DD).
- Put sources as links next to the claims they support.

## Linking and navigation

- Link generously but meaningfully: when a note mentions another concept that has a note, link it. In Obsidian, use the vault's existing link style.
- Create hub notes (often called maps of content) for areas with many notes: a curated list with one line of context per link, not an automatic dump.
- Prefer links and a small set of tags over deep folder nesting. Tags for cross-cutting facets (status, kind); links for relationships.
- When renaming or moving notes, update every link that points to them. Search for the old name, including aliases and links with heading anchors.

## Adding or updating content

1. Search the knowledge base first (filename and full text) for an existing note on the subject. Update it rather than creating a duplicate.
2. Write the summary first, then details. Record the date and source of facts that can go stale.
3. When new information contradicts an existing note, correct the note and keep a short dated line about what changed if history matters; do not leave both versions standing.
4. Link the new note from at least one hub or related note so it is reachable.
5. Bump `updated` in frontmatter.

## Hygiene pass

Run these checks with scripts (grep, a small Python or Node walker) rather than by eye, and report findings before making bulk changes:
- **Orphans:** notes with no inbound links.
- **Broken links:** links to notes or headings that do not exist.
- **Duplicates and near-duplicates:** similar titles or heavily overlapping content; propose merges.
- **Frontmatter problems:** missing required fields, invalid YAML, inconsistent tag spellings or casing.
- **Stale notes:** `updated` older than a threshold for note types that go stale; flag rather than delete.
- **Empty or stub notes:** fill, merge, or remove with the user's agreement.

Bulk renames, moves, merges and deletions change a lot at once: show the plan, get confirmation, and make sure there is a backup or version control first.

## Pitfalls

- Never store secrets (passwords, API keys, tokens) in notes; they get synced and shared.
- Do not rewrite a user's personal writing style or voice while "cleaning up".
- Over-structuring early: elaborate taxonomies that nobody maintains. Start small.
- Obsidian-specific syntax (embeds, callouts, Dataview) does not render elsewhere; keep plain Markdown for notes that agents or other tools must read.

## Deliver

Lead with what changed: notes created or updated (paths), links added, and hygiene results with counts. List proposed changes still awaiting the user's decision, and state what was verified (for example, a link check re-run showing zero broken links) and what was not.
