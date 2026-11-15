# Changelog

What changed in SEEKER, newest first. Versions follow the number in `package.json`.

## Unreleased

- **Up to 20 helpers.** One `task` call may hand out 20 jobs (it was 3). `maxHelpers` says how many run
  side by side; the rest wait their turn.
- **Six more hook events**, all observe-only: `on_approval_request`, `pre_compact`, `post_compact`,
  `subagent_start`, `subagent_stop`, `on_error`.
- **`seeker -p … --output json`** (or `--json`) prints the answer, the steps, the token counts and whether
  the run succeeded as one JSON object; `stream-json` prints an object per line as things happen.
- **`/review`** reads a change from git — since the last commit, staged, one commit, or against a branch —
  and reports what is wrong with it. The turn can only look: edits and commands that change something are
  refused, also with `--yolo`.
- **The sandbox works on Linux**, with bubblewrap (`bwrap`), under the same rules as on macOS.
- **A sandboxed command no longer reaches the network** beyond this machine unless `sandboxNetwork` is on.
  This is a change for anyone who already had the sandbox on: `npm install` and `git push` inside it now
  need `/config sandboxNetwork on`. A server on `127.0.0.1` still works.

- **Video editing.** A bundled `video-editing` skill with a Python script on top of ffmpeg: trim, join,
  reframe, change speed, cut out silences, burn in captions or a title, level or replace the sound, add music,
  make a GIF, compress to a size. Each edit writes a new file and reports what it made.

## 0.3.0 — 2026-11-15

Two guards and helpers that were put off from 0.2.0.

- **Sandbox for shell commands (macOS).** `/sandbox on` runs the commands SEEKER starts under Seatbelt:
  they read as usual and write only in the project, the temporary folders and the package caches, and
  cannot read SEEKER's settings file. A worktree's history outside the folder stays writable.
  `sandboxWrite` allows more folders; `sandboxNetwork off` cuts the network. Approvals are asked as before.
  Off by default.
- **Agents of your own.** A file in `~/.seeker/agents` or `.seeker/agents` gives a helper a role, and
  optionally its own model and set of tools. The `task` tool hands work to one by name; `/agents` lists
  them. A project's file may pick a model but not another provider.

### Known limits

- The sandbox covers the shell commands SEEKER starts. It does not cover a provider that runs its own tools
  (Claude Code) or the `!commands` you type, and there is none on Linux or Windows: there, switching it on
  is refused.
- `sandbox-exec` is marked deprecated by Apple; it works on the macOS this was tried on (27.2).
- Agents were tested against a scripted model. Whether a model picks the right agent unprompted was not
  observed.
- The limits listed for 0.2.0 still hold, except the one about there being no sandbox.

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
