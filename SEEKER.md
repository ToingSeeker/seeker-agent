# SEEKER (seeker-agent)

A coding agent for the terminal. Runs locally on Ollama by default; `/model` switches to another local
server, a cloud provider, or the Claude Code engine (via the Claude Agent SDK). Also offers
`seeker serve` (OpenAI-compatible API), `seeker gateway` (Telegram/Discord/Slack), `seeker acp`
(editors such as Zed) and `seeker remote` (phone control through a self-hosted relay).
Public repo, Apache-2.0.

## Stack
- Plain Node ESM (`"type": "module"`, `.mjs` files), Node >= 22. No build step, no TypeScript:
  the files in `src/` are what runs.
- Runtime deps (only these three): `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`,
  `@modelcontextprotocol/sdk`. Open an issue / ask before adding another.
- `.npmrc` sets `omit=optional` so the Agent SDK's bundled ~320 MB binary is not installed;
  the Claude Code provider uses the `claude` already on the machine.
- `remote-server/` is a separate zero-dependency relay (Node >= 20, `node server.mjs`) with the
  phone PWA in `remote-server/public/`.

## Commands
```
npm install
npm link                                     # installs `seeker` (bin/seeker.mjs)
npm test                                     # node --test, offline, 172 tests
SEEKER_HOME=/tmp/seeker-dev node bin/seeker.mjs   # manual try-out without touching ~/.seeker
SEEKER_REMOTE_AUTH=<value> node remote-server/server.mjs   # relay locally
```
There is no build or lint script. CI (`.github/workflows/test.yml`) runs `npm ci && npm test` on
ubuntu-latest and macos-latest with Node 22 for pushes to main and every PR.

## Layout
```
bin/seeker.mjs      entry: calls main() from src/cli.mjs
src/                all agent code (README "How it works" maps each file to its job)
  cli.mjs           args, startup, interactive loop
  agent.mjs         model -> tool -> result loop, compaction
  tools.mjs         built-in tools (each has a risk: read/write/exec/net/other)
  permissions.mjs   what runs freely vs. asks
  prompt.mjs        system prompt: instructions, memory, skills sections
  providers.mjs     provider list + adapters; claude-code.mjs for the Claude Code engine
  config.mjs        ~/.seeker/config.json; DEFAULTS + SETTINGS (the /config menu)
  skills.mjs        skill discovery (bundled, user, project, plugin)
  commands.mjs      slash commands; menu.mjs pickers; ui/screen/input/markdown = TUI
  platforms/        telegram, discord, slack, socket for the gateway
skills/<name>/SKILL.md   90 bundled skills (frontmatter: name, description)
test/*.test.mjs     node:test suites, one per area
remote-server/      relay server.mjs + public/ phone app (app.js, sw.js, manifest)
docs/               README screenshots
```

## Conventions seen in the code
- ESM imports with `node:` prefixes (`node:fs`, `node:path`, `node:test`, `node:assert/strict`).
- Most `src/` files (41 of 44) open with a comment block explaining the module's purpose and layout; JSDoc `/** */`
  one-liners on exported functions.
- Tests use `node:test` + `assert/strict`, build fixtures in `fs.mkdtempSync(os.tmpdir() ...)`,
  and never touch the real `~/.seeker`: under `node --test` `config.mjs` swaps `HOME_DIR` for a
  scratch folder unless `SEEKER_HOME` is set. Model servers, relay and push are faked in-test.
- Provider adapters all yield Ollama's streaming chunk shape
  (`{ message: { content, thinking, tool_calls }, done }`); the agent loop knows only that shape.
- New settings go in `config.mjs` DEFAULTS and SETTINGS (e.g. `bundledSkills`).
- Bundled skills load first with source `'bundled'`; a user skill of the same name replaces one.
  Tests with scripted model replies and small contexts set `bundledSkills: false`.
- Docs exist in English and Indonesian (`README.md`, `README.id.md`): update both.
- One change per PR, tests with the change, and say in the PR what UI (terminal/phone) was not
  checked. Changes to permissions, remote encryption or the relay need a test proving they hold.
- Bundled skills must stay generic: no private project names, paths or secrets (public repo).
