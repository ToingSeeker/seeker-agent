# SEEKER

**English** · [Bahasa Indonesia](README.id.md)

A coding agent for the terminal. Out of the box it runs entirely on your machine on top of
[Ollama](https://ollama.com); `/model` switches it to another local server or to a cloud model.
Plain Node, no build step.

![A session: the request, each tool step with its approval, and the answer](docs/tui-session.png)

<details>
<summary>The <code>/model</code> picker</summary>

![The `/model` picker](docs/tui-model.png)

</details>

<details>
<summary>The list of commands behind <code>/</code></summary>

![The list of commands and skills, with one highlighted](docs/tui-commands.png)

</details>

<details>
<summary>The phone app (<code>seeker remote</code>)</summary>

![The phone app: Home, the list of sessions, and a session waiting for approval](docs/remote.png)

</details>

<sub>Captured from the real interface. The projects are made up for the pictures and the model replies are scripted.</sub>

```
seeker                       # interactive session in this folder
seeker "fix the login bug"   # start with a first message
seeker -c                    # continue the last conversation in this folder
seeker -p "explain the repo" # answer once and exit; can be piped
seeker --yolo                # no permission prompts (dangerous commands are still asked about)
```

Inside a session: `/init`, `/model`, `/key`, `/resume`, `/paste`, `/config`, `/skills`, `/mcp`, `/clear`, `/compact`,
`/status`, `/think`, `/yolo`, `/help`, `/exit`, and `!command`.
Type `/` for the list of commands and skills: ↑↓ move through it, Tab completes the highlighted one, Enter runs it,
Esc closes the list. Typing narrows it (`/rev` also finds `/code-review`). Alt+Enter starts a new line; with no list
open, ↑↓ walk through earlier messages.
The robot in the header blinks and looks around. In the conversation, a small face on one row marks who speaks, as in the
phone app: the robot's `>_<` screen and SEEKER, or a person's face and YOU; both blink. `/config` → `animation`
turns that off.

SEEKER fills the terminal window like an app: the header stays at the top and the message box at the bottom
while the conversation scrolls between them. Scroll with the mouse wheel or PageUp and PageDown; while you are
reading further up, new output does not move the view, and the bar under the message box says how much is
below. Sending a message, or a question from SEEKER, brings you back to the end. SEEKER takes the mouse for the
wheel, so a plain drag does not select text: hold Fn while you drag in macOS Terminal, or Option in iTerm2 (Shift in
most Linux terminals), then copy as usual. In Terminal, View → Allow Mouse Reporting (⌘R) also gives the mouse back
until you turn it on again; the wheel then no longer scrolls the conversation. Only what is on screen can be
selected. When SEEKER quits, the conversation is printed to the terminal, where its own scrollback keeps it.

## Images

Name an image file in your message and the model sees the image, not just its path:

```
› why does the header look wrong in ~/Desktop/shot.png
› /paste what is this error?        # sends the image on the clipboard, e.g. a screenshot
```

Dragging a file into the terminal works too. The message box shows it by a short name, `[image.png]`,
`[video.mp4]` or `[file.pdf]`, and the model gets its full path when you send; Backspace removes the whole
name. The model can also open an image
itself with `read_file`. PNG, JPEG, GIF and WebP, up to 3.7 MB each.

The model has to support vision; `/status` says whether the current one does. With Ollama that is read
from the model itself. If it cannot see images, SEEKER says so instead of sending a path the model would
have to guess about.

From the phone app, the picture button next to the message box attaches up to four photos or screenshots.
They are made smaller on the phone, then encrypted like everything else it sends. (An existing relay has
to be deployed again once to get the updated app.)

It works the other way too: when the agent opens an image with `read_file` (a screenshot it just took, a
photo in a zip it unpacked), the phone shows a preview under that step. The preview is made on the Mac
(with `sips` on macOS; elsewhere only an image already small enough is shown) and is encrypted like the
rest. Only the six latest previews of a project are kept when the phone reloads; older steps keep the
file's name.

Tap a preview (or the name of an older one) to fetch the whole picture from the Mac and save it with
**Save**: on a phone that opens the share sheet, where "Save Image" is. The phone names the step, never
a path, so only pictures a tool step already showed can be fetched. The picture goes through the relay
encrypted, beside the event log rather than in it, and is held there for ten minutes. A file over 2 MB
is sent as a smaller JPEG on macOS and refused elsewhere.

### Videos and other whole files

The same button takes a video too, and `/file` sends any file as it is. A video or file is not shown to
the model: it is sent whole, in encrypted 2 MB pieces, and saved on the Mac in `~/Downloads/SEEKER/`
(never over a file already there). The message goes to the agent once the file has arrived, with where
it was saved, so the agent can work on it. Keep the phone app open while it uploads; the bar under the
message box shows how far it is. Up to four files of at most 300 MB each per message.

Every file shows as a card: a badge for its kind (ZIP, PDF, MP4, …), the name cut in the middle so the
extension stays, its size and folder. Tap a file waiting in the message box to check it before it goes:
pictures, videos, sound, PDFs and text open, and a zip shows the files inside it; **Remove** takes it
off the message. After sending, the files sit under your message as cards (↑, cyan) in place of the list
of paths the agent reads. Tap one to fetch it back from the Mac and check what arrived, with its place
on the Mac and a **Copy** button. Only files in `~/Downloads/SEEKER/` can be fetched back this way. Text
is always shown as text, never run as a page. Photos sent with a message are kept there too, so a tap on
one under your message opens the whole picture (one sent before this opens as its small preview).

A file or picture fetched from the Mac once is kept on the phone (in the app's own storage, up to
300 MB, the oldest dropped first), so opening it again needs no second download. Its preview says
**Saved on this phone** only once the file reads back from that storage; if the phone refuses the space
it says so, and **Save** still works. A file at the same path with another size is fetched
afresh. **Settings → Files kept on this phone** lists what is kept: tap one to open it, **×** to remove
it, or **Remove all**; unpairing removes them too. This is the app's own storage, not Photos or Files
(open one and tap **Save** for those), and iOS may clear it when the phone runs short of space. What is
kept is the decrypted file: the app lock hides it but does not encrypt it.

When an answer names a file that exists on the Mac (a video, audio, a picture, a PDF, a zip or `.srt`,
written as a path, `~/…` or relative to the project), the phone shows it under the answer as a card;
several are grouped under **GENERATED FILES** with their count and total size. On macOS each card
carries a small picture made by Quick Look (a PDF's first page, a frame of a video, the photo) and a
video its length, read from the file's own header; elsewhere the card shows the kind of file instead.
The round button on a card saves the file on the phone without opening it: a ring fills with the bytes
that have arrived (tap it to cancel), then a check; tap the check to share it. A file gone from the Mac
shows a warning instead. Tapping the rest of the card opens the preview: a picture whole (**Fullscreen**
to pinch, double-tap and drag), a PDF in the page, a video with the phone's own player (never
autoplaying, stopped when the sheet closes), and the folder it is in on the Mac, which opens its full
path, type, size and date. **Save to Photos** (a picture or video) or **Save to Files** (anything else)
opens the share sheet, where one more tap on "Save Image", "Save Video" or "Save to Files" finishes it: a
web app cannot write to Photos on its own. The share button at the top opens the same sheet for AirDrop
and other apps. Without a share sheet (a desktop browser) the button is **Download**. A PDF is framed only when its first bytes say PDF. As with pictures, the phone names the answer,
never a path. Each piece is sealed together with its file and its place in it, so the relay cannot swap
or reorder them, and it is deleted from the relay as soon as the other side has taken it. The relay
holds at most 40 MB in each direction at a time and tells the sender to wait beyond that. The Mac gives
up on a transfer when nothing has moved for two minutes. An existing relay has to be deployed again for
this.

## Install

Needs Node ≥ 22. For local use, also Ollama and a model that supports tool calling.

```
git clone https://github.com/ToingSeeker/seeker-agent.git
cd seeker-agent
npm install
npm link                     # installs the `seeker` command
ollama pull qwen3.5:27b      # or any other tool-calling model
```

`.npmrc` sets `omit=optional` so the Claude Agent SDK's bundled binary (about 320 MB) is not
downloaded; the Claude Code provider uses the `claude` already installed on your machine.

`seeker doctor` checks what SEEKER needs on this machine — Node, git, the installed packages, who can read the
settings file, whether the chosen provider answers or has its key, the relay and the remote daemon — and says
how to fix what is missing. It changes nothing and prints no key.

## Models and providers

`/model` picks where the model runs, then one of the models that provider lists at that moment:

| Kind | Providers |
| --- | --- |
| Local | Ollama, LM Studio, llama.cpp server |
| Through Claude Code | **Claude Code** — the Claude Code you are already logged in to works as a full agent with its own tools (Read, Edit, Bash, …), no API key. SEEKER shows what it does and asks before an edit or command runs |
| Cloud | Anthropic (Claude), OpenAI, Google Gemini, xAI Grok, DeepSeek, Mistral, Moonshot Kimi, Groq, Cerebras, Together AI, Fireworks AI, OpenRouter |
| Your own | any OpenAI-compatible endpoint — add `"providers": { "name": { "baseUrl": "https://…/v1" } }` to the config |

API keys are typed in with `/key` (stored in `~/.seeker/config.json`, readable by the owner only) or taken
from the environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, …). From the command line:
`seeker --provider openai -m <model>`.

With a cloud provider, your messages and the contents of files SEEKER reads are sent to that provider;
the header changes from `LOCAL • PRIVATE` to `CLOUD • <NAME>`.

## Permissions

Reading is free. Edits, shell commands and network access ask first; "always" answers are remembered as
rules. A short list of harmless shell commands runs without asking, and commands matching the dangerous
patterns are asked about even with `--yolo`.

**Plan mode.** `/plan` (or `seeker --plan`) has SEEKER look first and answer with a plan: the steps, the files
each touches, how the result will be checked. Reading, searching and the harmless shell commands still run;
edits, other commands and saving memory are refused without asking you, also with `--yolo`. `/plan go`
approves the plan and starts the work under your usual approval rules; `/plan off` leaves plan mode. The
status bar shows `PLAN` while it is on. It works from the phone as well.

**Sandbox (macOS and Linux).** `/sandbox on` runs the shell commands SEEKER starts under the system's own
sandbox — Seatbelt on macOS, bubblewrap (`bwrap`) on Linux. They read as usual and write only in the project,
the temporary folders and the package caches (`~/.npm`, `~/.cache`, `~/Library/Caches`, …). SEEKER's own
settings file, which holds API keys, cannot be read by them. A worktree's history outside the folder stays
writable, so commits work. They reach no network beyond this machine: a test that talks to `127.0.0.1` works,
`npm install` and `git push` do not until you allow them with `/config sandboxNetwork on`.
`/config sandboxWrite <path>,<path>` allows more folders. Approvals are asked exactly as before; the sandbox
is a second guard, not a replacement. It does not cover a provider that runs its own tools (Claude Code) or
the `!commands` you type yourself. On a machine without one (Windows, or Linux without bubblewrap),
switching it on is refused, and a config that has it on makes shell commands fail rather than run unguarded.

**In a container or on another machine.** `/backend` chooses where the shell commands SEEKER starts run.
`/backend docker:node:22` (any image) runs each one in a fresh container of that image. The project's git
repository, or the folder itself outside one, is mounted at the same path, so the command and SEEKER's file
tools see the same files. Nothing else of this machine is visible to it: not your home folder, your keys or
your environment variables. With `/sandbox on` and the network not allowed, the container has no network
either. Something installed outside the project is gone with the container; pick an image that has your
tools. In a git worktree, whose history lives outside the folder, git does not work inside the container.
Your home folder is never mounted, even when it is itself a git repository, nor a folder holding SEEKER's
settings: started there, `docker:` refuses to run.
`/backend ssh:me@build-box` runs each command on another machine, in `~/seeker/<project>-<hash>` there, or
in a folder you name: `ssh:me@build-box:work/app`. Before every command the project is copied there with
rsync, removing what you removed here; after it, what the command changed is copied back, and nothing here is
ever removed by that. `node_modules`, `.venv`, `venv`, `__pycache__`, `.next`, `target` and `.DS_Store` are
left out both ways, so the other machine keeps the packages it built for itself; change the list with
`/config backendExclude dist,*.log` (`default` or `none`). Everything else in the project is copied,
`.env` included, so use a machine that is yours. SEEKER logs in with your ssh key and never waits at a
password prompt; rsync has to be on both machines. Stopping a command stops it there as well.
With `/sandbox on` and the network not allowed, `ssh:` refuses to run: that limit cannot be enforced on
another machine.
Either way `/backend` checks that Docker answers or the login works before it switches; approvals are asked
exactly as before, and `/backend local` brings the commands back. The `!commands` you type and a provider that
runs its own tools (Claude Code) stay on this machine. `/status` shows where commands run.

## Instructions, memory and skills

- `SEEKER.md` in a project — project instructions; `/init` writes one. Without it: every `AGENTS.md` from the
  repository root down to the working folder, else `CLAUDE.md`, else `.cursorrules` and `.cursor/rules/*.mdc`.
  An instruction file deeper in the tree (`packages/api/AGENTS.md`) is handed to the model the first time it
  works in that folder. A file that reads like a prompt injection is not loaded.
- `~/.seeker/SEEKER.md` — rules that apply in every project.
- `~/.seeker/usage.json` — how many tokens SEEKER has used: counts per day and a running total, nothing else.
  It stays on this machine and is shown on the phone's Home: the total, new and cached input, output, a
  chart of the days and their history. A day before counting began is shown as not recorded, never as zero.
- `~/.seeker/memory/` — notes from earlier sessions; `MEMORY.md` is the index (one line per note).
  `~/.seeker/memory/projects/<folder>/` holds notes for one project.
- `skills/` in this repository — skills that ship with SEEKER (engineering, design, data, SEO, marketing,
  business operations), written for SEEKER and licensed with it. A skill of yours with the same name replaces
  one; `/config bundledSkills off` hides them all.
- `~/.seeker/skills/<name>/SKILL.md` and `.seeker/skills/<name>/SKILL.md` — skills, called as `/name`.
  Plugin skills live in `~/.seeker/plugins/<plugin>/skills/…` and are called as `/plugin:name`.
- **A skill with a list to choose from** offers it to tick when you call it with nothing after it: `/effects`
  shows its effects, ↑↓ move, Space ticks, Ctrl+A ticks all that are listed, typing filters, Enter sends. On
  the phone the same list opens as a sheet with a filter and "Select all". What you tick reaches the skill as
  if you had typed `/effects orbit, spotlight`. A skill has such a list when its folder holds a
  `choices.json` (`["a", "b"]` or `[{ "value": "a", "description": "…" }]`), when its frontmatter has
  `choices: a, b, c`, or when it says its command takes a name (`/effects <name>`) and lists at least six of
  them in a table with each name in code.
- MCP servers: `mcpServers` in the config or `.seeker/mcp.json`; manage them with `/mcp`. A server defined by a
  project file is a command somebody else wrote: it is listed but not started until you approve it in `/mcp`,
  and again if its entry changes.

Only the memory index goes into the system prompt, capped at 20% of the context window. When the
conversation reaches 80% of the window, or 300,000 tokens if that comes first, it is summarised, keeping the
most recent part and your request word for word.

### Keeping the cost of a long session down

`/context` shows what fills the conversation, part by part (instructions, tool definitions, your messages,
replies, tool results, pictures) and how far it is from being summarised. `/usage` shows the tokens used:
the total, new and cached input, output, and the last seven days. Both work from the phone.

Every step sends the whole conversation to the model again, so a long session is paid for many times over.
Change these with `/config <name> <value>`:

- `compactAt` (300000) — summarise at this many tokens even when the model's window is larger. `0` waits
  until the window is nearly full.
- `effort` (empty) — how hard an Anthropic model works on a reply: `low`, `medium`, `high`, `xhigh` or `max`;
  also `/effort <level>`. Lower is cheaper and faster. Empty keeps the model's own default. It is sent only
  to models that have the setting, and a level a model does not offer becomes the nearest lower one.
  Changing it makes the provider read the conversation without its cache once.
- `subagentModel` (empty) — the model helper agents (the `task` tool) and the look back after a reply run
  on: a model of the provider in use (`claude-haiku-5-5`), or `provider:model`. Empty, or `same`: the model of
  the conversation.
- `cacheTtl` (`1h`) — how long Anthropic keeps the conversation cached between requests: `5m` or `1h`, the
  two it offers. An hour costs more to write and survives a pause — reading an answer, an approval that
  waits for you. `5m` is cheaper if you never stop for longer than that.

Pictures from earlier turns are taken out of the conversation once the cache has run out, or when it is
summarised. Sooner would cost more than it saves: a changed conversation is read at full price from the
change onward. The look back after a reply reads only the recent part of the conversation, cut down.

## Learning across sessions

SEEKER keeps what it learns, so the next session starts knowing it.

- **Memory it writes itself.** With its `memory` tool SEEKER saves short facts into three small stores:
  who you are (`~/.seeker/memories/USER.md`, 1,375 characters), what holds in every project
  (`MEMORY.md`, 2,200) and what holds in this folder (`projects/<folder>.md`, 2,200). All of them go into
  the system prompt of later sessions. The budget is hard: when a store is full, stale entries are replaced.
  Text that reads like an instruction, or that contains a secret, is refused. `/memory` shows the stores;
  say "remember that …" or "forget …" to change them.
- **Skills it writes itself.** After working out a procedure SEEKER can record it as a skill with
  `skill_manage`, and fix a skill it found to be wrong. `/curator` lists these. One that goes unused for
  14 days is marked stale, after 30 days it is moved to `~/.seeker/skills/.archive`. Skills you installed
  yourself are never touched.
- **A look back after a reply.** Every tenth message, or after a long run of tool steps, a helper with only
  the memory and skill tools reviews the conversation while you read the answer, and saves what is worth
  keeping. It is dropped the moment you type again. Switch it off with `/config review off`.
- **You decide what is kept.** What is saved is read back as context in every later session, so saving
  asks first, showing the text; answer "always" to stop being asked for that session, or set
  `/config autoLearn on` to never be asked. The look back after a reply saves only what you have allowed
  this way. Skills are written only inside `~/.seeker/skills`, never through a link or into a project.
- **Past conversations.** `session_search` lets SEEKER search and read earlier sessions from every folder,
  so "what did we decide about the webhook last week?" does not need you to repeat it.

## Attaching context with @

Put any of these in a message and its content is attached, so the model starts with it:

| Reference | Attaches |
| --- | --- |
| `@file:src/app.js` | the file |
| `@file:src/app.js:10-40` | lines 10 to 40 |
| `@folder:src` | a listing of the folder (`@file:` naming a folder lists it too) |
| `@diff` · `@staged` | unstaged / staged git changes |
| `@git:3` | the last 3 commits, with their changes |
| `@url:https://…` | the page as text |

Paths stay inside the working folder and credential files are never attached. Attachments over a quarter
of the context are flagged; over half, they are refused.

## In a script

`seeker -p "<message>"` answers once and exits: the answer on stdout, the activity on stderr. For a script
that needs more than the text, `--output json` (or `--json`) prints one object when the run is over:

```
seeker -p "does the build pass? run it" --json | jq '{ok, result}'
```

```json
{"type":"result","ok":true,"result":"…the answer…","error":null,"interrupted":false,
 "model":"qwen3.5:27b","provider":"ollama",
 "steps":[{"action":"Running npm run build","ok":true,"note":"exit 0"}],
 "warnings":[],"usage":{"input_tokens":7500,"output_tokens":96,"counted_by_provider":true},"duration_ms":4170}
```

`--output stream-json` prints one object per line as things happen (`start`, `step`, `text`, `warning`,
`error`) and the same result object last. With either, stdout carries nothing but JSON, and the exit code is
1 when the run failed or was interrupted. Nobody is there to approve anything in `-p`, so edits and commands
that would ask are not run and show up as steps with `"ok": false`; add `--yolo` to let them run.

## Reviewing a change

`/review` has SEEKER read a change and report what is wrong with it, most severe first, each with its file
and line and a case where it goes wrong. Nothing is changed: for that turn, edits and commands that change
something are refused whatever the approval mode is, also with `--yolo`.

| Command | Reviews |
| --- | --- |
| `/review` | everything changed since the last commit, staged or not, and new files |
| `/review staged` | what is staged |
| `/review commit <sha>` | one commit |
| `/review main` | what this branch adds on top of `main` (any branch or ref) |

Words after that say what to look at: `/review staged error handling`. It works from the phone too. A change
too large to hand over whole is given in part, and SEEKER reads the files for the rest. If you have a skill of
your own named `review`, `/review` runs that instead.

## Undoing changes

Before the first change of a message — a file written or edited, or a shell command that can destroy files —
SEEKER snapshots the folder. `/rollback` lists the snapshots, `/rollback 2` restores the second-newest,
`/rollback 2 src/app.js` one file from it, and `/rollback diff 2` shows what changed since. A rollback is
itself snapshotted first, so it can be undone.

Restoring the whole folder also takes the conversation back, to before the message that led to the change:
the model no longer remembers work that is no longer on disk. Undoing that rollback gives the conversation
back with the files. `/rollback 2 --files` restores the files and leaves the conversation as it is, and
restoring a single file never touches it. A checkpoint from an earlier session, or from before the
conversation was summarised, restores the files only and tells the model so.

Snapshots live in a separate git repository under `~/.seeker/checkpoints`; nothing is written into the
project's own `.git`. `node_modules`, build output, `.env` files and files over 10 MB are left out, and so
are not restored. Switch it off with `--no-checkpoints` or `/config checkpoints off`.

## Working on its own

- **`/goal <what to achieve>`** — SEEKER keeps going, message after message, until a judge (the same model, asked
  separately) finds the goal done. It stops after 20 turns, when it is blocked and needs you, or when you press
  Ctrl+C. `/goal pause`, `/goal resume`, `/goal clear`.
- **`/loop 5m <prompt>`** re-runs a prompt every five minutes; **`/loop <prompt>`** lets SEEKER pace itself (it
  looks less often while nothing changes). `--times N` and `--until <condition>` end it; so does the model saying
  the task is finished. `/loop stop`.
- **`/heartbeat every 10m <instruction>`** re-enters the session with that instruction whenever it is idle.
- **Scheduled jobs.** Ask in plain words ("every weekday at 9, summarise the open pull requests") and SEEKER
  creates a job with its `cronjob_manage` tool, after asking you. A job runs in a fresh session of its own: it may
  read and run harmless commands, changes files only if you allowed that for the job, and never runs a risky
  command. Replies are kept in `~/.seeker/cron/output` and shown in the open session (or pushed to your phone by
  `seeker remote`). Jobs run while SEEKER is open; to run them with nothing open, have the system scheduler call
  `seeker cron tick` every minute. `/cron` lists, pauses and removes them.
- **Several helpers at once.** The `task` tool can hand out up to 20 jobs in one call, each to a helper agent
  with a context of its own. `/config maxHelpers <n>` says how many run side by side (1 to 20, default 20);
  the others wait their turn, and the reports come back in the order the jobs were given. Approval questions
  are put one at a time. Every helper fills a context of its own, so twenty cost about twenty times one:
  lower `maxHelpers` for a local model or a provider with tight rate limits. `/config subagentModel <model>` runs them on a
  cheaper model than the conversation.

- **Agents of your own.** A helper can be given a role, and optionally a model and a set of tools, in a file:
  `~/.seeker/agents/<name>.md` (yours, in every project) or `.seeker/agents/<name>.md` (this project's; one of
  the same name replaces yours).

  ```
  ---
  name: reviewer
  description: Reads a change and reports bugs, most severe first
  model: claude-haiku-5-5        # optional: a model on the provider in use, or provider:model
  tools: read_file, grep, glob   # optional: the only tools it gets
  ---
  You review code. Report what is wrong, with file and line. Do not fix anything.
  ```

  SEEKER is told which agents exist and hands work to one through its `task` tool ("have the reviewer look at
  this change"). The agent starts with an empty context, its role as instructions, and only the tools listed.
  Without `model` it runs where helpers run (`subagentModel`). A project's file may pick a model but not
  another provider; a file that reads like a prompt injection is not loaded. `/agents` lists them.

These three (`/goal`, `/loop`, `/heartbeat`) live with the session: they end when you quit.

## As a backend for other apps

`seeker serve` offers SEEKER as an OpenAI-compatible API (`/v1/chat/completions`, streaming or not, and
`/v1/models`), so a chat frontend such as Open WebUI or a script using the `openai` package can use it, with
SEEKER's tools doing the work in the folder it was started in:

```
SEEKER_API_KEY=$(openssl rand -hex 24) seeker serve          # http://127.0.0.1:8642/v1
```

It listens on this machine only and every request needs the key. Nobody is there to approve anything, so a
request can read files and run harmless commands but not change anything; `"apiServer": { "allowChanges": true }`
in the config lets requests edit files and run ordinary commands. Risky commands are refused either way.

## In a chat app

`seeker gateway` answers in Telegram, Discord or Slack. Each chat is its own conversation, working in the folder
the gateway was started in. Nothing has to be reachable from the internet: SEEKER connects out to the chat service.

```json
"gateway": {
  "telegram": { "token": "123456:ABC…", "allow": ["123456789"] },
  "discord":  { "token": "…", "allow": ["223344556677889900"] },
  "slack":    { "botToken": "xoxb-…", "appToken": "xapp-…", "allow": ["U012ABCDEF"] }
}
```

Set up only the ones you use; the tokens can also come from `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`,
`SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`.

- **Telegram:** make a bot with @BotFather and use its token.
- **Discord:** make an application with a bot, invite it to your server, and use the bot token. No privileged intent
  is needed.
- **Slack:** make an app with Socket Mode on, an app-level token (`connections:write`), the bot scopes `chat:write`,
  `im:history` and `app_mentions:read`, and the events `message.im` and `app_mention`.

Nobody is let in by default. Only the user ids in `allow` get an answer; anyone else is told their own id once, so
to find yours, message the bot and copy the id it replies with. In a group or channel the bot answers only when it is
mentioned. Before SEEKER edits a file or runs a command it asks in the chat (`y`, `n`, or say what to do instead),
and "run without asking" is never available from a chat. `/new` starts a fresh conversation, `/stop` interrupts,
`/status` shows the model and folder.

## In an editor

`seeker acp` runs SEEKER as an agent inside an editor that speaks the
[Agent Client Protocol](https://agentclientprotocol.com), such as Zed. The editor starts the process itself and
shows the answer, the tool steps and the permission questions in its own panel. In Zed's settings:

```json
"agent_servers": { "SEEKER": { "type": "custom", "command": "seeker", "args": ["acp"] } }
```

It uses the provider, model and permission setting from `~/.seeker/config.json`. Sessions are not reloaded by the
editor yet, and MCP servers passed by the editor are ignored (SEEKER's own `/mcp` servers are not started either).

## Hooks

Commands of your own that run at fixed points and can veto or adjust what happens. In `~/.seeker/config.json`:

```json
{ "hooks": { "pre_tool_call": [{ "matcher": "bash|write_file", "command": "~/bin/guard.sh", "timeout": 60 }] } }
```

Events: `pre_tool_call`, `post_tool_call`, `pre_llm_call`, `post_llm_call`, `on_session_start`, `on_session_end`,
and six that only tell a hook what happened: `on_approval_request` (SEEKER is waiting for your answer — a place
for a sound or a notification), `pre_compact` and `post_compact` (the conversation is summarised),
`subagent_start` and `subagent_stop` (a helper, with its report), and `on_error` (a turn failed).
A hook gets one line of JSON on stdin (`hook_event_name`, `tool_name`, `tool_input`, `cwd`, …). A `pre_tool_call`
hook may print `{"action":"block","message":"…"}` (or exit with code 2) to stop the call, or
`{"action":"modify","args":{…}}` to change its arguments; a `pre_llm_call` hook may block the message or print
`{"context":"…"}` to add to it. A hook that fails does not stop the work unless it has `"fail_closed": true`.
No hook runs until you have approved that exact command in `/hooks`.

## Mods

Hooks change what SEEKER does from outside; a mod changes SEEKER itself. It is a folder of your own in
`~/.seeker/mods/` whose `mod.mjs` (JavaScript, with any files of its own beside it) can add:

- **a slash command**, listed with the others as you type `/`;
- **a segment in the row under the status bar** (the git branch, a deploy's state, a price);
- **a panel**: a few rows above the input box that stay there and update;
- **a toast**: a short line in the conversation;
- **handlers on the same events as hooks**, run inside SEEKER: a `pre_tool_call` handler can stop a call or change
  its arguments, a `pre_llm_call` handler can hold a message back or add to it.

```js
// ~/.seeker/mods/guard/mod.mjs
export default function (seeker) {
  seeker.command('hello', 'Say hello', (arg) => seeker.toast(`Hello ${arg || 'there'}`)); // return text to send it as a message
  seeker.status(() => seeker.colors.accent(`● ${seeker.model}`));
  let ticks = 0;
  seeker.every(5000, () => ticks++); // redraws after each tick
  seeker.panel(() => [`  guard · ${ticks} ticks`]);
  seeker.on('pre_tool_call', ({ tool, args }) => {
    if (tool === 'bash' && /git\s+push\b.*--force/.test(args.command ?? '')) return { block: 'No force pushes.' };
  });
}
```

`/mods new <name>` writes one to start from. A mod runs with your full user rights, so none runs until you approve
it in `/mods`, and the approval is for every file in its folder as they were then, `node_modules` included: if
any of them changes, it stops until you approve it again. A symlink in a mod's folder (or a symlinked folder) is
refused, since what it points to could change without the folder changing. `/mods` also turns one off or reloads it; `/mods reload` reloads them all. A mod cannot
take one of SEEKER's own command names, a mod that throws is skipped with a warning, and its command runs from the
phone only if it was added with `{ phone: true }`. Mods run in the interactive terminal, not in `-p` or
`seeker remote`. What a status segment or panel returns is drawn on every redraw, so work it out in `every` and
return what it found.

## Editing video

The bundled `video-editing` skill (`/video-editing`, or just ask: "cut this to the first 20 seconds and make it
9:16") edits video files you already have. It comes with a Python script on top of ffmpeg, one command per
edit: trim, join clips, reframe for vertical or square, change speed, cut out silences, burn in captions or a
title, level or replace the sound, add music under speech, make a GIF, compress to a size. Each edit writes a
new file and never the one it was given, and reports the result's length, size and resolution so SEEKER can
check it; it then looks at frames of the result before telling you it is done.

It needs `ffmpeg` and `python3`; captions and titles also need Pillow (`pip install pillow`). Drag the file
into the terminal to name it. For planning a video from a brief, there is the `video-production` skill.

## Reading and checking files

`read_file` also reads PDFs (needs `pdftotext`), Word and OpenDocument files, `.xlsx`, notebooks and SQLite
databases as text. After `write_file` or `edit_file`, JavaScript, JSON, Python, shell, Ruby and PHP files are
checked for syntax, and a file that does not parse is reported with the result.

## Backup models and several API keys

In `~/.seeker/config.json`:

```json
{
  "fallback": [
    { "provider": "openrouter", "model": "anthropic/claude-sonnet-5.5" },
    { "provider": "ollama", "model": "qwen3.5:27b" }
  ],
  "providers": { "openai": { "apiKeys": ["sk-…", "sk-…"], "keyStrategy": "fill_first" } }
}
```

When the chosen model is rate limited, out of credit, rejects the key or is down, SEEKER first moves to the
provider's next API key, then waits and retries, then moves down the `fallback` list, and says so. Your own
model is tried again on a later message. A request that is simply wrong (too long, malformed) is not sent
elsewhere. `keyStrategy` is `fill_first` (default), `round_robin`, `least_used` or `random`; `/status` shows
the chain.

## Remote control from a phone

![The phone app: Home, the list of sessions, and a session waiting for approval](docs/remote.png)

`seeker remote` runs the agent on your computer and connects it to a relay (`remote-server/`, a
dependency-free Node server you deploy yourself, for example on Railway). The phone opens the web app
served by that relay.

Every user runs their own relay. A relay knows one access token and serves one computer; there is no
shared or public relay, and no account to sign up for. It is a single Node file with no dependencies and
no database, so the smallest plan of any host is enough.

### Set it up

**1. Create your secret.** On the computer where SEEKER is installed:

```
seeker remote --setup
```

It prints one line to copy:

```
SEEKER_REMOTE_AUTH=<64 hex characters>
```

This is a hash of your access token. It lets the relay recognise your devices and is safe to hand to a
host; it cannot be used to read or send anything. The secret itself stays in `~/.seeker/config.json`.

**2. Deploy the relay.** Deploy the folder `remote-server/` (not the whole repository) with that variable set.

On [Railway](https://railway.com), with its CLI installed and `railway login` done:

```
cd remote-server
railway init                                   # create a new project
railway up                                     # first deploy; creates the service
railway variable set "SEEKER_REMOTE_AUTH=<the value from step 1>"  # redeploys with it
railway domain                                 # gives the service a public https address
```

On any other host (Render, Fly.io, a VPS, …) the relay needs:

| | |
| --- | --- |
| Start command | `node server.mjs`, in `remote-server/` |
| Node | 20 or newer |
| `SEEKER_REMOTE_AUTH` | the value from step 1 |
| `PORT` | the port to listen on; most hosts set it for you (default 8787) |
| Address | public and **https** — the phone app and its notifications do not work over plain http |
| Health check | `GET /healthz` answers `{"ok":true}` |
| Proxy | must not buffer responses (the relay streams events) or cut idle connections short |
| `SEEKER_TRUST_PROXY=1` | only behind a proxy that sets `x-forwarded-for` itself; Railway is detected automatically |

Check it: `https://<your-relay>/healthz` shows `{"ok":true}`, and `https://<your-relay>/` shows the SEEKER sign-in page.

**3. Tell SEEKER where the relay is.**

```
seeker remote --url https://<your-relay>
```

**4. Pair your phone.**

```
seeker remote --setup
```

This time it prints a link that ends in `#k=…`. Open it on your phone (on macOS it is also copied to the
clipboard). The link holds your secret: anyone who has it can see your sessions and approve commands on
your computer, so do not post it, screenshot it, or send it over a channel you do not trust.

On iPhone, use Share → **Add to Home Screen** and open SEEKER from there; on Android, the browser menu →
**Install app** (or Add to Home screen).
Then turn on notifications in the app's Settings tab.

**5. Start it.**

```
seeker remote                          # the current folder
seeker remote ~/project-a ~/project-b  # several projects, one workspace each
```

Leave it running; the phone shows the computer as online. The computer has to stay on, and on macOS it is
kept awake while `seeker remote` runs. Stop it with Ctrl+C.

### What the phone shows

- **Home → Control Center** — what the agent is doing now (or, when nothing runs, how the latest task ended),
  the connected computer with its state and the measured round trip, the last 24 hours (projects that were
  active and tool runs, counted from the conversations themselves), the tokens used today — tap it for the
  last seven days and the total since counting began — and
  `/init` `/model` `/resume`.
- **Home → Projects** — the open projects in one list, with search (name, folder, branch), sorting and a
  filter for terminal sessions. Under **On your Mac**, the project folders found in your home folder open
  with one tap. The **+** opens a folder by its path, or makes a new one for a new project. A new folder can
  only be made inside your home folder, and never in a hidden one.
- **Quick switcher** — the two-arrow button at the top right of Home, Sessions and Settings opens a sheet with
  every session, the ones that need you first, what each is doing, and how many are running (the number on
  the button). Tap one to go there; nothing else is stopped by switching. *Queued instructions* lists what
  waits in every session, to remove or resume. What you were typing stays with the session you typed it in.
- **Sessions** — every open project as one compact row: its name, the latest instruction, a small status pill
  (Executing, Approval needed, Queued, Failed, Stopped, Completed, Idle), the model, tool runs and when it was
  last active. Search by project, instruction or model; filter by status (the counts are live); sort by
  activity, name or status. The session you opened last is marked in amber.
- **A session** — what the agent is doing right now (thinking, running a tool, writing, waiting for you,
  finished, failed or stopped), every step as it happens with its output, and context, tokens and tool
  counts as the computer reports them. Stop, Review, Resume and Retry appear only when they apply. The title
  and the Activity / Tools / Metrics tabs stay in place while the conversation scrolls, and each tab keeps
  the place you were reading.
- **Sending while it works** — a message sent while the agent is busy asks where it should go. *Queue next*
  keeps it on the computer (`~/.seeker/queue.json`) and runs it when the current task has completed, in the
  order sent. *Steer current task* hands it to the running task, which reads it before its next step; that
  works with Ollama and the API providers, not with Claude Code, which runs a whole task in one request and
  is offered Queue only. After a task that was stopped or failed, and after `seeker remote` is restarted,
  nothing waiting starts by itself: the queue is paused until you resume it. Pictures cannot be queued, and
  a session typed in a terminal has no queue.
- **Approvals** — each command and each file change waits here. A change is shown as a diff with line
  numbers; a command the safety patterns flag is marked dangerous. One request is one command or one file.
- **Settings** — connection, model, and which notifications this phone gets: finished tasks, approvals
  and questions, errors. Everything `/config` holds is here too: thinking, whether to ask for approval,
  context window, steps per message, how long a model stays in memory, the Ollama address, and the two
  terminal display settings. A cloud provider's API key can be entered here; it is stored on the computer
  and never sent back. A setting takes effect at once for projects opened from the phone; a `seeker`
  already running in a terminal keeps what it started with.

Nothing on these screens is estimated on the phone. A number the computer has not reported shows as “—”.

### A session you are typing in the terminal

While `seeker remote` is running, a plain `seeker` started in a terminal on the same computer joins it by
itself and shows on the phone as a *terminal session*. Nothing has to be set up; if `seeker remote` is not
running, the terminal works exactly as before.

- **A picture from the phone** — send a screenshot with no text and its path is put into the message you are
  typing in the terminal, as if you had dragged the file in. Finish the sentence and press Enter.
- **A message from the phone** — one with words runs as a turn of its own when the terminal is free. What
  you had half typed is back in the box afterwards. `!` shell lines are not run from the phone.
- **Commands and skills from the phone** — `/status`, `/compact`, `/skills`, `/memory`, `/cron`, `/goal`,
  `/loop`, `/help` and any `/<skill>` run as they would typed in the terminal (in a project opened from the
  phone too). Settings (`/yolo`, `/think`, `/config`) change only projects opened from the phone, and are saved
  like the Settings tab; a terminal session's own settings are changed in that terminal. What needs a picker or
  must not come from a lost phone stays in the terminal: `/hooks`, `/mods`, `/mcp`, `/rollback`, `/key`, `/paste`,
  `/exit`; and in a terminal session, `/resume`.
- **Continuing a saved conversation** — in a project opened from the phone, `/resume` (also in the `/` menu and
  on the home screen) lists that folder's saved conversations, newest first; tap one to continue it, with its
  transcript back on the phone. After a restart (`/restart`, or `seeker remote` started again) each project
  carries on with the conversation it had, instead of opening empty.
- **Approvals** — asked in both places; the first answer decides and the other one closes.
- **Moving a conversation from the phone to the terminal** — `cd` into the project and run `seeker -c` (or
  `/resume` and pick it). The phone's copy closes, its transcript moves to the terminal session, and a phone
  that had it open follows it there, so there is one conversation and nothing overwrites anything. If the
  phone is still working on it (or has instructions queued), it keeps its copy and the terminal goes on in a
  separate one; run `seeker -c` again once the phone has finished.
- **Not from the phone** — a new conversation, another model, and closing the session are done in the
  terminal. A session started with `--yolo` takes tasks from the phone only when that phone has its app lock on
  (Settings → App lock), since they run without asking. The phone says whether its lock is on; that is a
  reminder for the app, not a check the Mac can verify: what keeps others out is the pairing secret.

### Later

- **New phone:** run `seeker remote --setup` again and open the link on it.
- **Restarting it (after an update):** send `/restart` from a project in the app. The new code is checked
  first (if it does not load, the running one is kept and the app says why), a new `seeker remote` starts on
  its own, and the old one stops once it has; the app reconnects by itself. It waits while another project is
  still working. Do not ask the agent to restart it with a command: the agent runs inside `seeker remote`, so
  it would end itself and the command with it. Such a command is refused, whatever the approval mode.
- **Lost phone, or the link leaked:** delete `"secret"` under `"remote"` in `~/.seeker/config.json`, run
  `seeker remote --setup`, put the new `SEEKER_REMOTE_AUTH` on the relay, and pair your phones again. The old
  link stops working as soon as the relay has the new value.
- **Updating the relay:** pull the repository and deploy `remote-server/` again (`railway up`). Nothing is
  stored on it, so nothing is lost.
- **Trying it locally first:** `SEEKER_REMOTE_AUTH=<value> node remote-server/server.mjs`, then
  `seeker remote --url http://localhost:8787`. Plain http is accepted for `localhost` only.

### How it is protected

- The computer only makes outbound connections; no port is opened.
- Conversation and commands are encrypted between phone and computer (AES-256-GCM). The relay holds only
  a hash of the access token (`SEEKER_REMOTE_AUTH`) and can neither read nor forge anything.
- Edits and commands need approval on the phone unless you switch that off (in `/config`, or in the phone's
  Settings). Even then, risky commands and files outside the project folder are still asked about.
- The relay stores nothing on disk; after a restart the computer sends its state again.
- Wrong tokens are locked out per address. On Railway the caller's address is read from `x-forwarded-for`;
  behind another proxy that sets that header itself, set `SEEKER_TRUST_PROXY=1`. Without a proxy leave it unset.
- Push notifications (approval needed, question from the model, task finished) go straight from the
  computer to the phone's push service with Web Push encryption (`src/webpush.mjs`); the relay is not
  involved. Turn them on in the app's Settings. On iPhone the app must first be added with
  Share → Add to Home Screen.
- App lock (Settings → App lock): Face ID, with a 6-digit PIN as the backup, asked for when the app opens
  or has gone unused for 1, 5, 15 or 60 minutes. It lives on the phone only: the PIN is kept as a salted
  PBKDF2 hash, Face ID is a passkey for this site that must report the user as verified. Three wrong PINs
  within 10 minutes unpair the phone (its pairing, lock and kept files are removed, and the Mac sends a
  notification); pairing again with `seeker remote --setup` is the way back. A forgotten PIN means pairing
  again too. The lock
  hides the screens; it does not encrypt what the app keeps on the phone, and push notifications still show
  their text on the lock screen.

Developed on macOS. The pairing-link copy and the keep-awake helper are macOS-only; everything else is
plain Node.

## How it works

| File | What it does |
| --- | --- |
| `src/cli.mjs` | arguments, startup, interactive loop |
| `src/agent.mjs` | the agent loop: model → tool → result → model, plus context compaction |
| `src/tools.mjs` | `read_file` `write_file` `edit_file` `bash` (also in the background) `process_output` `process_stop` `glob` `grep` `list_dir` `web_fetch` `web_search` `ask_user` `task` `skill` `memory` `session_search` `skill_manage` `cronjob_manage` `todo_write` |
| `src/permissions.mjs` | what runs freely and what asks first |
| `src/prompt.mjs` | system prompt, project instructions, memory and skill sections |
| `src/providers.mjs` | provider list and adapters: Ollama, OpenAI-compatible, Anthropic (SDK) |
| `src/claude-code.mjs`, `src/external-tools.mjs` | the Claude Code provider through the Claude Agent SDK; display and permission class of its tools |
| `src/ollama.mjs`, `src/http.mjs` | Ollama streaming client and basic HTTP |
| `src/mcp.mjs` | MCP servers: extra tools named `mcp__<server>__<tool>` |
| `src/skills.mjs` | skill discovery and loading |
| `src/memory.mjs`, `src/review.mjs` | the stores SEEKER writes itself, the scan that keeps instructions and secrets out, the look back after a reply |
| `src/skill-manage.mjs` | skills SEEKER writes and patches, how often each is used, the curator |
| `src/session-search.mjs` | searching and reading earlier conversations |
| `src/context-files.mjs`, `src/references.mjs` | project instruction files and `@` references |
| `src/checkpoints.mjs` | snapshots before a change, `/rollback` |
| `src/failover.mjs` | API key rotation, retries and backup providers |
| `src/autonomy.mjs` | `/goal`, `/loop` and `/heartbeat` |
| `src/cron.mjs`, `src/cron-runner.mjs` | scheduled jobs: schedules, the job store, running a due job |
| `src/hooks.mjs` | the user's shell hooks and their approval |
| `src/mods.mjs` | the user's mods: loading, approval, their commands, status row, panels and handlers |
| `src/gateway.mjs`, `src/platforms/` | `seeker gateway`: Telegram, Discord and Slack |
| `src/acp.mjs` | `seeker acp`: the Agent Client Protocol for editors |
| `src/api-server.mjs` | `seeker serve`: the OpenAI-compatible API |
| `src/lint.mjs`, `src/extract.mjs` | syntax check after a write; documents read as text |
| `src/remote.mjs`, `src/webpush.mjs`, `remote-server/` | remote control: daemon on the computer, push notifications, relay and phone web app |
| `src/session.mjs`, `src/config.mjs` | saved conversations (`~/.seeker/sessions/`) and settings (`~/.seeker/config.json`) |
| `src/commands.mjs`, `src/menu.mjs` | slash commands, the `/config` menu, the `/model` and `/resume` pickers |
| `src/ui.mjs`, `src/markdown.mjs`, `src/text.mjs` | rendering: header, panels, tool-step tree, status bar; measuring and wrapping coloured text |
| `src/highlight.mjs` | code in colour (keywords, strings, calls, numbers, types, comments) in diffs and code blocks, by the file's language or the block's tag |
| `src/theme.mjs` | the one palette for the terminal and the phone app (amber brand, blue tool at work, purple thinking, green done, red failed); written as 24-bit, 256 or 16 colours depending on the terminal, none with `NO_COLOR` |
| `src/images.mjs` | images in a conversation: finding the files a message names, loading them, the clipboard, previews and whole pictures for the phone, the Quick Look picture on a file card |
| `src/transfer.mjs` | whole files between the phone and the Mac: encrypted pieces through the relay, the inbox, the files an answer offers for download and what their cards show (a video's length, when it changed) |
| `src/mascot.mjs` | the robot and the wordmark in the header, and the robot and person by each message, drawn as pixels, with their animation |
| `src/screen.mjs`, `src/input.mjs` | full-screen layout on the alternate screen (header pinned on top, input box at the bottom, the conversation scrolled inside SEEKER) and the input editor |

What changed from version to version is in [CHANGELOG.md](CHANGELOG.md).

## Tests

```
npm test
```

The tests run offline and in a scratch home folder of their own. When trying things by hand, use
`SEEKER_HOME=/tmp/some-folder seeker` so your real configuration and history are left alone.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security problems are reported privately, see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
