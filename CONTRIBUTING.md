# Contributing to SEEKER

Thanks for helping. Issues and pull requests are welcome in English or Indonesian.

## Setup

```
git clone https://github.com/ToingSeeker/seeker-agent.git
cd seeker-agent
npm install
npm test
```

Node 22 or newer. There is no build step: the files in `src/` are what runs.

While trying things by hand, point SEEKER at a scratch home so your real configuration,
sessions and memory are left alone:

```
SEEKER_HOME=/tmp/seeker-dev node bin/seeker.mjs
```

## Ground rules

- **Plain Node, few dependencies.** The only runtime dependencies are the Anthropic SDK, the
  Claude Agent SDK and the MCP SDK. The relay in `remote-server/` has none. Please open an
  issue before adding one.
- **Tests come with the change.** `npm test` runs offline: model servers, the relay and push
  services are faked inside the tests. A test must never touch the real `~/.seeker`; use
  `SEEKER_HOME`.
- **Say what you could not test.** The terminal UI and the phone app cannot be fully covered
  by `node --test`. If you changed them, say in the pull request what you looked at
  (terminal, phone, browser) and what you did not.
- **One change per pull request**, with the reason in the description.

## Where things are

The table under "How it works" in the [README](README.md) maps every file to its job. Common
starting points:

| To add | Look at |
| --- | --- |
| a model provider | `src/providers.mjs` — OpenAI-compatible ones are a single entry in the list |
| a tool | `src/tools.mjs` — give it a `risk` (`read`, `write`, `exec`, `net`, `other`) so permissions apply |
| a slash command | `src/commands.mjs` |
| something in the phone app | `remote-server/public/app.js` and the matching command in `src/remote.mjs` |

Every provider adapter yields the same chunk shape as Ollama's streaming API
(`{ message: { content, thinking, tool_calls }, done, … }`); the agent loop only knows that shape.

## Security

Anything that weakens the permission prompt, the remote-control encryption or the relay's
"cannot read anything" property needs a test that shows it still holds. Vulnerabilities are
reported privately — see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is released under the [MIT License](LICENSE).
