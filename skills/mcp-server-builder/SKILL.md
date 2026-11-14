---
name: mcp-server-builder
description: Build a good Model Context Protocol (MCP) server - tool design around user tasks, tight input schemas, useful errors, auth and secrets, pagination, and testing with a real client. Use for "build an MCP server", "expose this API to the agent", "add MCP tools", "my MCP tool isn't being used right".
---

# MCP server builder

## When to use
Use this when you're wrapping an API, database, internal service or local capability so that LLM agents can use it through MCP, or when you're fixing a server whose tools the model misuses or ignores. Don't use it when a plain CLI or script the agent can already run would do. An MCP server is worth it when several agents or clients need the same capability with structured inputs.

## Gather first
- **The tasks.** What will users ask the agent to do with it? List five or ten realistic requests. Tools are designed from these, not from the API's endpoint list.
- **The underlying API.** Auth method, rate limits, pagination, error formats, and which operations are destructive.
- **Transport and runtime.** Local stdio, for a single user on their machine, or remote over HTTP, for shared or hosted use. Use the official SDK for the language the team maintains (TypeScript and Python SDKs exist). Check the current spec and SDK docs rather than relying on memory, because the protocol evolves.
- **Where secrets come from.** Environment variables or an OAuth flow, never hard-coded and never passed as tool arguments.

## Designing tools
- **Task-shaped, not endpoint-shaped.** One `find_customer` that searches by name, email or id beats three thin wrappers. Combine calls the agent would always chain anyway. But keep destructive actions as separate, clearly named tools.
- **Names** are verbs plus objects, consistent, and prefixed if several servers will coexist (`tracker_create_issue`).
- **Descriptions** say what the tool does, when to use it versus its siblings, and what it returns. The model chooses tools from these words. Put real usage hints there, not marketing.
- **Input schemas** are strict. Use required versus optional fields, enums for closed sets, formats and ranges, and descriptions on every field with an example value. Fewer parameters is better, and defaults should be sensible.
- **Outputs** are concise and decision-ready. Return the fields an agent needs, not the raw upstream payload. Offer a detail level or field selection for big objects. Include ids the next call will need.
- **Large results:** paginate with a cursor and a clear "more available" signal, cap the response size, and support filtering server-side.
- **Annotations:** mark read-only, destructive and idempotent tools where the SDK supports hints, so clients can ask for confirmation appropriately.

## Errors
Errors are instructions for the model's next attempt. Say what was wrong and how to fix it ("`status` must be one of open, closed; got 'done'"). Distinguish errors the caller can fix (validation, not found) from upstream failures (rate limited, so retry after N seconds). Never leak stack traces, tokens or internal hostnames.

## Security
- Validate every input, even though a model produced it. Treat content fetched from the outside world as untrusted, because it can carry prompt injection back into the agent.
- Use least-privilege credentials, and scope tokens to what the tools need.
- For HTTP transport: authenticate requests, validate Origin where relevant, and bind local servers to localhost.
- Rate-limit expensive or destructive tools, and log calls without logging secrets.

## Procedure
1. Write the task list and map it to a tool list. Review it for overlap and gaps before coding.
2. Scaffold with the official SDK and get one read-only tool working end to end.
3. Implement the remaining tools with shared helpers for auth, pagination and error mapping.
4. **Test at three levels.** Unit tests for input validation and error mapping, with the upstream mocked. Protocol-level tests with an inspector tool (e.g. the MCP Inspector, if available) to check that the schemas list and calls round-trip. And a **real agent session**: give an agent the realistic requests from step 1, and watch which tools it picks and whether it recovers from errors.
5. Tighten the descriptions and schemas based on where the agent went wrong. This loop usually matters more than the code.
6. Document the install and config: the command, the env vars, an example client configuration block, and the list of tools.

## Pitfalls
- Exposing dozens of thin tools, which crowds the context and confuses selection.
- Returning huge JSON blobs that burn context.
- Tools with side effects named like reads.
- Writing logs to stdout in a stdio server. That corrupts the protocol stream, so log to stderr.

## Report
Lead with the tool list (name and one-line purpose) and how to run the server. Then give the test results at each level, the agent-session observations and the fixes made, the auth setup, and what was not tested (e.g. destructive tools against a live account).
