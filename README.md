# SEEKER

**English** · [Bahasa Indonesia](README.id.md)

A coding agent for the terminal. Out of the box it runs entirely on your machine on top of
[Ollama](https://ollama.com); `/model` switches it to another local server or to a cloud model.
Plain Node, no build step.

```
seeker                       # interactive session in this folder
seeker "fix the login bug"   # start with a first message
seeker -c                    # continue the last conversation in this folder
seeker -p "explain the repo" # answer once and exit; can be piped
seeker --yolo                # no permission prompts (dangerous commands are still asked about)
```

Inside a session: `/init`, `/model`, `/key`, `/resume`, `/config`, `/skills`, `/mcp`, `/clear`, `/compact`,
`/status`, `/think`, `/yolo`, `/help`, `/exit`, and `!command`.
Type `/` for command suggestions, Tab to complete, Alt+Enter for a new line, ↑↓ for message history.

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

## Instructions, memory and skills

- `SEEKER.md` in a project (then `AGENTS.md`, then `CLAUDE.md`) — project instructions. `/init` writes one.
- `~/.seeker/SEEKER.md` — rules that apply in every project.
- `~/.seeker/memory/` — notes from earlier sessions; `MEMORY.md` is the index (one line per note).
  `~/.seeker/memory/projects/<folder>/` holds notes for one project.
- `~/.seeker/skills/<name>/SKILL.md` and `.seeker/skills/<name>/SKILL.md` — skills, called as `/name`.
  Plugin skills live in `~/.seeker/plugins/<plugin>/skills/…` and are called as `/plugin:name`.
- MCP servers: `mcpServers` in the config or `.seeker/mcp.json`; manage them with `/mcp`. A server defined by a
  project file is a command somebody else wrote: it is listed but not started until you approve it in `/mcp`,
  and again if its entry changes.

Only the memory index goes into the system prompt, capped at 20% of the context window. When the
conversation reaches 80% of the window it is summarised, keeping the most recent part and your request word for word.

## Remote control from a phone

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

### Later

- **New phone:** run `seeker remote --setup` again and open the link on it.
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
- Edits and commands always need approval on the phone; there is no permission-free mode over remote.
- The relay stores nothing on disk; after a restart the computer sends its state again.
- Wrong tokens are locked out per address. On Railway the caller's address is read from `x-forwarded-for`;
  behind another proxy that sets that header itself, set `SEEKER_TRUST_PROXY=1`. Without a proxy leave it unset.
- Push notifications (approval needed, question from the model, task finished) go straight from the
  computer to the phone's push service with Web Push encryption (`src/webpush.mjs`); the relay is not
  involved. Turn them on in the app's Settings. On iPhone the app must first be added with
  Share → Add to Home Screen.
- From the phone you can also switch model and answer questions the model asks.

Developed on macOS. The pairing-link copy and the keep-awake helper are macOS-only; everything else is
plain Node.

## How it works

| File | What it does |
| --- | --- |
| `src/cli.mjs` | arguments, startup, interactive loop |
| `src/agent.mjs` | the agent loop: model → tool → result → model, plus context compaction |
| `src/tools.mjs` | `read_file` `write_file` `edit_file` `bash` (also in the background) `process_output` `process_stop` `glob` `grep` `list_dir` `web_fetch` `web_search` `ask_user` `task` `skill` `todo_write` |
| `src/permissions.mjs` | what runs freely and what asks first |
| `src/prompt.mjs` | system prompt, project instructions, memory and skill sections |
| `src/providers.mjs` | provider list and adapters: Ollama, OpenAI-compatible, Anthropic (SDK) |
| `src/claude-code.mjs`, `src/external-tools.mjs` | the Claude Code provider through the Claude Agent SDK; display and permission class of its tools |
| `src/ollama.mjs`, `src/http.mjs` | Ollama streaming client and basic HTTP |
| `src/mcp.mjs` | MCP servers: extra tools named `mcp__<server>__<tool>` |
| `src/skills.mjs` | skill discovery and loading |
| `src/remote.mjs`, `src/webpush.mjs`, `remote-server/` | remote control: daemon on the computer, push notifications, relay and phone web app |
| `src/session.mjs`, `src/config.mjs` | saved conversations (`~/.seeker/sessions/`) and settings (`~/.seeker/config.json`) |
| `src/commands.mjs`, `src/menu.mjs` | slash commands, the `/config` menu, the `/model` and `/resume` pickers |
| `src/ui.mjs`, `src/markdown.mjs`, `src/text.mjs` | rendering: header, panels, tool-step tree, status bar; measuring and wrapping coloured text |
| `src/screen.mjs`, `src/input.mjs` | full-screen layout (header pinned on top, input box at the bottom) and the input editor |

## Tests

```
npm test
```

The tests run offline. When trying things by hand, use `SEEKER_HOME=/tmp/some-folder seeker` so your real
configuration and history are left alone.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security problems are reported privately, see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
