# Changelog

What changed in SEEKER, newest first. Versions follow the number in `package.json`.

## Unreleased

- **Sandbox for shell commands (macOS).** `/sandbox on` runs the commands SEEKER starts under Seatbelt:
  they write only in the project, the temporary folders and the package caches, and cannot read SEEKER's
  settings file. `sandboxWrite` allows more folders; `sandboxNetwork off` cuts the network.

## 0.2.0 — 2026-11-15

The first tagged version. It gathers what was built since the version number was first set to 0.1.0, which
was never tagged. The theme of the last stretch: an agent that can be trusted with daily work.

### Working with the agent

- **Plan mode.** `/plan` (or `seeker --plan`) has SEEKER look first and answer with a plan. Reading still
  runs; edits and commands that change something are refused, also with `--yolo`, until `/plan go`.
- **`/rollback` takes the conversation back with the files**, to before the message that led to the change.
  Undoing the rollback gives both back. `--files` keeps the conversation.
- **`/effort`** sets how hard an Anthropic model works on a reply (`low` to `max`), sent only to models that
  have the setting.
- **`/context`** shows what fills the conversation, part by part; **`/usage`** shows the tokens used.
- **`seeker doctor`** checks what SEEKER needs on this machine and says how to fix what is missing.
- A file dragged into the terminal is a message, not a `/command`; a PDF's plain path is given to the model.

### The terminal

- An edit is shown as numbered lines with the lines around it, added on green and removed on red — for
  SEEKER's own edits and for those made by Claude Code's tools, also when no approval is asked.
- The `/` list is moved through with the arrow keys; Tab completes, Enter runs, Esc closes.
- Every on/off setting can be switched in the `/config` list.

### Cost

- A ledger of token use on this machine (`~/.seeker/usage.json`): per day, with cached input, cache writes
  and model replies. Nothing but numbers, and never in the repository.
- `compactAt` summarises a conversation at 300,000 tokens even in a larger window; `subagentModel` runs
  helpers and the review on a cheaper model; `cacheTtl` keeps Anthropic's cache for an hour.
- The look back after a reply reads only the recent part of the conversation.
- Pictures of past turns leave the conversation once the cache has run out, or when it is summarised.

### The phone app (`seeker remote`)

- Home as a control center with a workspace explorer; Sessions as a list with search, filters and sorting;
  a quick switcher for sessions; a session's title and tabs that stay put.
- Send while the agent works: steer it or queue the next instruction.
- Token usage as an analytics panel: totals, the share of cached input, a chart of the days, a history.
  A day before counting began is shown as not recorded, never as zero.
- A file change is shown as numbered lines, as in the terminal. Pictures the agent opens are previewed.
- The Approvals list uses the same rows as Sessions.

### Fixed

- A second `seeker remote` on the same machine took the relay's connection from the first once a second.
  It now refuses to start.
- A request refused because replayed reasoning no longer matches the history is sent once more without it.
- Phone tool rows stayed open when a provider ran tools in parallel.

### Known limits

- The phone app has not been checked on every device; much of it was verified in a desktop browser at phone
  widths.
- The one-hour cache and `/effort` were tested against a stand-in server, not the live Anthropic API.
- There is no sandbox for shell commands. Approval rules and plan mode are the guard.

## 0.1.0

Never tagged. The agent, its tools and permissions, providers, memory and skills, checkpoints, scheduled
jobs, the chat gateway, the editor protocol, the API server and the first phone app.
