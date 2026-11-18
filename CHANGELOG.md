# Changelog

What changed in SEEKER, newest first. Versions follow the number in `package.json`.

## Unreleased

- **The terminal conversation marks who speaks with the phone app's faces.** SEEKER's answers start with the
  pixel robot (the one in the header) and SEEKER; your messages with the pixel person and YOU, in cyan. They move
  as on the phone: the robot blinks and glances, the person blinks and nods, unless `/config` → `animation` is off. Only on the full screen: print mode (`-p`) and pipes keep the
  plain `✧ SEEKER` and `›` marks.

- **Claude Code can still ask for approval after a command it left running in the background.** When Claude
  Code (as the engine) started something in the background, such as a CI watch or a long build, and finished its
  answer, it was woken again when that ended, but by then its input had been closed. Every step that needed
  approval failed with "Tool permission request failed: AbortError: Stream closed". The reply now stays open
  until those commands are done (30 minutes at most, `providers.claude-code.backgroundWait`), and what it
  says when woken follows in the same reply.

- **Three wrong PINs within 10 minutes unpair the phone.** The app lock used to make each try wait longer
  after five wrong PINs. Now the third wrong PIN within ten minutes tells the Mac (which sends a
  notification), then removes the pairing, the lock and the files kept on that phone; pairing again is the
  way back. The PIN pad says how many tries are left.
- **A terminal session started with `--yolo` takes tasks from the phone** when the phone has its app lock on.
  Before, it took none, since a lost phone could have started work that runs without asking.

- **A file dragged into the terminal shows by a short name.** Instead of its whole escaped path, the message
  box shows `[image.png]`, `[video.mp4]` or `[file.pdf]` (a second one of a kind is numbered), and so does the
  conversation once it is sent; the model still gets the full path. Backspace removes the name whole. Only a
  paste that is nothing but files is shortened, and a picture sent from the phone shows the same way.

- **Saved conversations can be continued from the phone, and survive a restart.** `/resume` in a project
  opened from the phone (also in the `/` menu, and the home screen's /resume button, which only opened the
  session list before) lists that folder's saved conversations to tap; the one picked comes back with its
  transcript and goes on in its own file. After `/restart` or a new `seeker remote`, each project continues the
  conversation it had instead of opening empty.

- **`/restart` restarts SEEKER remote safely from the phone.** It checks that the code on disk loads, starts
  a new `seeker remote` as a process of its own that waits for the old one to stop, and then stops the old
  one; the app reconnects by itself. Asking the agent to restart it with a shell command used to kill the
  agent and that command with it, leaving the Mac offline. An agent inside `seeker remote` is now told so,
  and a command that would stop it (kill, pkill or killall of seeker remote, of its process id, or of every
  node or seeker process) is refused in every approval mode, Claude Code's own Bash included.

- **Bundled skills open without a YAML error on GitHub.** 22 skills had a description with a colon followed by
  a space, which strict YAML readers take as a second key; GitHub showed "Error in user YAML" above them. They
  are quoted now, SEEKER reads quoted values as YAML does (`''` and `\"` included), and a test keeps it so.

- **Approvals asked at the same moment are put to you one at a time.** When Claude Code ran several tools
  side by side, every one of them asked at once: the phone showed several cards, answering two or three made
  the rest disappear, and the session stayed waiting for an approval that was no longer listed. Now each is
  asked after the one before is answered, with its own command or diff on the card, and an "always" answer
  covers the ones still waiting. Stopping the task refuses those still waiting without asking.

- **A conversation started on the phone moves cleanly to the terminal.** `seeker -c` (or `/resume`) in a
  terminal on the Mac closes the phone's copy of that conversation, moves its transcript to the terminal
  session, and takes a phone that had it open there. Before, both copies stayed open and each saved over the
  other. One still at work on the phone stays there, and the terminal continues in a separate file.

- **Shell commands can run in a Docker container or on another machine.** `/backend docker:<image>` runs
  each command in a fresh container with the project mounted at the same path and nothing else of this
  machine visible; `/backend ssh:<host>[:<folder>]` runs it on another machine, copying the project there
  with rsync before the command and what it changed back after it. `/backend` checks the connection before
  switching, approvals are unchanged, and stopping a command stops it there too.

- **The terminal interface keeps its header and message box in place while you scroll.** It now runs on
  the alternate screen and scrolls the conversation itself (mouse wheel, PageUp, PageDown); before, scrolling
  the terminal back moved the header and the message box down with everything else. Selecting text takes
  Shift (Option in Terminal and iTerm2) while dragging. When SEEKER quits, the conversation is printed to the
  terminal for its scrollback.

- **A skill with a list to choose from offers it to tick.** `/effects` with nothing after it shows its
  effects as a list: tick with Space in the terminal (Ctrl+A for all, type to filter), or in a sheet on the
  phone. What is ticked becomes the skill's arguments.
  It also works when files are sent along with the command, and in a terminal session shown on the phone.
- **On the phone, `/skills` opens a list of the skills to search and tap, and `/config` the settings**,
  each with its value and the values it can take, changed with a tap. The context size (`numCtx`) is offered
  only for an Ollama model; for a cloud model a tap there would have capped its context.

## 0.4.0 — 2026-11-16

Closing gaps found by comparing SEEKER with other terminal agents, and two things to do with video.

### Guards

- **The sandbox works on Linux**, with bubblewrap (`bwrap`), under the same rules as on macOS.
- **A sandboxed command no longer reaches the network** beyond this machine unless `sandboxNetwork` is on.
  This is a change for anyone who already had the sandbox on: `npm install` and `git push` inside it now
  need `/config sandboxNetwork on`. A server on `127.0.0.1` still works.
- **`/review`** reads a change from git — since the last commit, staged, one commit, or against a branch —
  and reports what is wrong with it. The turn can only look: edits and commands that change something are
  refused, also with `--yolo`. A skill of your own named `review` is run in its place.

### Automation

- **`seeker -p … --output json`** (or `--json`) prints the answer, the steps, the token counts and whether
  the run succeeded as one JSON object; `stream-json` prints an object per line as things happen. The exit
  code is 1 when the run failed.
- **Six more hook events**, all observe-only: `on_approval_request`, `pre_compact`, `post_compact`,
  `subagent_start`, `subagent_stop`, `on_error`.
- **Up to 20 helpers.** One `task` call may hand out 20 jobs (it was 3). `maxHelpers` says how many run
  side by side; the rest wait their turn.

### Video and files

- **Video editing.** A bundled `video-editing` skill with a Python script on top of ffmpeg: trim, join,
  reframe, change speed, cut out silences, burn in captions or a title, level or replace the sound, add music,
  make a GIF, compress to a size. Each edit writes a new file and reports what it made.
- **Files and videos between the phone and the Mac.** They travel encrypted through the relay in chunks:
  up to four files per message, at most 300 MB each.

### Known limits

- The Linux sandbox was tried on Debian in a container, as an ordinary user. Other distributions were not
  tried, and run as root it cannot cut off the network: there, commands are refused until `sandboxNetwork`
  is on. Windows has no sandbox.
- `/review`, twenty helpers at once and the video skill were tested against a scripted model. The quality
  of a review's findings, behaviour under a provider's real rate limits, and the video skill driven by a
  model were not observed.
- The video script was run on clips made for the purpose, not on real footage (rotated phone video, long
  files, variable frame rate). It does not transcribe speech.
- A compiled Python file went in with the video skill and was removed in the next change; it remains in the
  history of `main`.

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
