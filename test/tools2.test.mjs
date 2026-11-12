// The tools added after the first set: background processes, web search parsing,
// asking the user, helper agents and MCP servers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { McpHub, readServers, resultText, wrapTool } from '../src/mcp.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import { TOOL_BY_NAME, parseSearchResults, stopAllProcesses } from '../src/tools.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-t2-'));
const run = (name, args, ctx = {}) => TOOL_BY_NAME.get(name).run(args, { cwd: os.tmpdir(), state: {}, ...ctx });
const quietUi = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : () => {}) });

test('a background process can be started, read and stopped', async () => {
  const started = await run('bash', { command: 'echo ready; sleep 30', background: true });
  const id = /process (p\d+)/.exec(started.output)[1];
  assert.match(started.output, /It is running\.[\s\S]*Output so far:\nready/);
  assert.match((await run('process_output', { id })).output, /still running\.\n\n\(no new output\)/);
  assert.match((await run('process_stop', { id })).output, /was stopped/);
  const after = await run('process_output', { id, wait: 5 });
  assert.match(after.output, /exited with code/);
  await assert.rejects(run('process_output', { id: 'p999' }), /No background process "p999"/);

  const quick = await run('bash', { command: 'echo done; exit 3', background: 'true' });
  assert.match(quick.output, /already exited with code 3[\s\S]*done/);
  stopAllProcesses();
});

test('search results are read from the results page, unwrapping redirect links and skipping adverts', () => {
  const html = `
    <div class="result results_links results_links_deep web-result">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fapi%2Freadline.html&amp;rut=abc">Readline | <b>Node.js</b> Documentation</a>
      <a class="result__snippet" href="x">The <b>readline</b> module &amp; its events.</a>
    </div>
    <div class="result results_links results_links_deep result--ad">
      <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Buy things</a>
    </div>
    <div class="result results_links results_links_deep web-result">
      <a class="result__a" href="https://example.com/a?b=1&amp;c=2">Plain link</a>
    </div>`;
  assert.deepEqual(parseSearchResults(html), [
    { title: 'Readline | Node.js Documentation', url: 'https://nodejs.org/api/readline.html', snippet: 'The readline module & its events.' },
    { title: 'Plain link', url: 'https://example.com/a?b=1&c=2', snippet: '' },
  ]);
  assert.deepEqual(parseSearchResults('<html>blocked</html>'), []);
});

test('ask_user passes the question on, and says so when nobody can answer', async () => {
  const asked = [];
  const askUser = async (q) => (asked.push(q), 'Postgres');
  const answered = await run('ask_user', { question: 'Which database?', options: '["Postgres","MySQL"]' }, { askUser });
  assert.deepEqual(asked, [{ question: 'Which database?', options: ['Postgres', 'MySQL'] }]);
  assert.equal(answered.output, 'The user answered: Postgres');
  assert.match((await run('ask_user', { question: 'x?' }, { askUser: async () => null })).output, /did not answer/);
  assert.match(await run('ask_user', { question: 'x?' }), /No user is available/);
});

/** A scripted stand-in for Ollama: each request gets the next reply. */
async function fakeOllama(replies) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end((replies.shift() ?? [{ message: { content: 'out of script' }, done: true }]).map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { host: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}
const call = (name, args) => ({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } });
const done = (content) => ({ message: { content }, done: true, prompt_eval_count: 10, eval_count: 5 });

function makeAgent(host, cwd) {
  const config = { ...DEFAULTS, host };
  const permissions = new Permissions({ mode: 'auto', cwd, ask: null });
  return new Agent({ config, ui: quietUi, permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });
}

test('the task tool runs a helper with its own conversation and returns only its report', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'the secret is 42\n');
  const ollama = await fakeOllama([
    [call('task', { description: 'find the secret', prompt: 'Read notes.txt and report the secret.' }), { done: true }],
    [call('read_file', { path: 'notes.txt' }), { done: true }], // the helper's first step
    [done('The secret is 42.')], // the helper's report
    [done('It is 42.')], // the main agent's answer
  ]);
  const agent = makeAgent(ollama.host, cwd);
  await agent.runTurn('what is the secret?');
  ollama.close();

  assert.deepEqual(agent.messages.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant']);
  assert.equal(agent.messages[2].content, 'The secret is 42.', 'only the report comes back, not the file the helper read');
  assert.equal(agent.messages[3].content, 'It is 42.');

  const helperRequest = ollama.requests[1];
  assert.deepEqual(helperRequest.messages.map((m) => m.role), ['system', 'user'], 'the helper starts from nothing');
  assert.equal(helperRequest.messages[1].content, 'Read notes.txt and report the secret.');
  const offered = helperRequest.tools.map((t) => t.function.name);
  assert.ok(offered.includes('read_file') && !offered.includes('task') && !offered.includes('ask_user'), 'a helper cannot start helpers or question the user');
  assert.ok(ollama.requests[0].tools.some((t) => t.function.name === 'task'));
});

test('MCP: server tools are wrapped, offered to the model and called through the server', async () => {
  const calls = [];
  // Stand-ins for the MCP SDK's client and transports.
  class Client {
    async connect(transport) {
      this.transport = transport;
      if (transport.options.command === 'broken') throw new Error('spawn broken ENOENT');
    }
    async listTools() {
      return { tools: [{ name: 'browser.navigate', description: 'Open a page', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }, { name: 'ping' }] };
    }
    async callTool(request) {
      calls.push(request);
      if (request.name === 'ping') return { isError: true, content: [{ type: 'text', text: 'pong failed' }] };
      return { content: [{ type: 'text', text: `opened ${request.arguments.url}` }, { type: 'image', mimeType: 'image/png', data: 'x' }] };
    }
    async close() {
      this.onclose?.();
    }
  }
  class StdioClientTransport {
    constructor(options) {
      this.options = options;
    }
  }
  const changes = [];
  const hub = new McpHub({
    servers: { web: { command: 'node', args: ['server.js'] }, off: { command: 'x', disabled: true }, bad: { command: 'broken' } },
    onChange: (tools) => changes.push(tools.map((t) => t.name)),
    sdk: { Client, StdioClientTransport, StreamableHTTPClientTransport: StdioClientTransport },
  });
  await hub.connectAll();

  assert.deepEqual(hub.status().map((s) => [s.name, s.status, s.tools]), [['web', 'ready', 2], ['off', 'disabled', 0], ['bad', 'failed', 0]]);
  assert.match(hub.status()[2].error, /ENOENT/);
  const [navigate, ping] = hub.tools();
  assert.equal(navigate.name, 'mcp__web__browser_navigate', 'names are made safe for every provider');
  assert.equal(navigate.risk, 'other', 'each server tool is approved by name');
  assert.deepEqual(ping.parameters, { type: 'object', properties: {} });

  const result = await navigate.run({ url: 'https://x.dev' }, {});
  assert.equal(result.output, 'opened https://x.dev\n[image image/png — not shown]');
  assert.deepEqual(calls[0], { name: 'browser.navigate', arguments: { url: 'https://x.dev' } }, 'called by its real name');
  await assert.rejects(ping.run({}, {}), /pong failed/);

  await hub.disconnect('web');
  assert.deepEqual(hub.tools(), []);
  assert.deepEqual(changes.at(-1), []);

  assert.equal(resultText({ content: [] }), '(no output)');
  assert.equal(wrapTool('s', { name: 't', description: 'd'.repeat(900) }, async () => ({})).description.length, 601);
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.seeker'));
  fs.writeFileSync(path.join(dir, '.seeker/mcp.json'), JSON.stringify({ mcpServers: { web: { url: 'https://project/mcp' }, db: { command: 'db' } } }));
  assert.deepEqual(Object.keys(readServers({ mcpServers: { web: { command: 'user' } } }, dir)), ['web', 'db']);
  assert.equal(readServers({ mcpServers: { web: { command: 'user' } } }, dir).web.url, 'https://project/mcp', 'the project entry wins');
});

test('MCP tools reach the model and run through the agent loop with approval by name', async () => {
  const cwd = tmp();
  const ollama = await fakeOllama([[call('mcp__web__open', { url: 'https://x.dev' }), { done: true }], [done('opened')]]);
  const agent = makeAgent(ollama.host, cwd);
  const ran = [];
  agent.setExtraTools([wrapTool('web', { name: 'open', description: 'Open', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }, async (name, args) => (ran.push([name, args]), { content: [{ type: 'text', text: 'page text' }] }))]);
  await agent.runTurn('open it');
  ollama.close();
  assert.ok(ollama.requests[0].tools.some((t) => t.function.name === 'mcp__web__open'));
  assert.deepEqual(ran, [['open', { url: 'https://x.dev' }]]);
  assert.equal(agent.messages[2].content, 'page text');

  // Without --yolo and with nobody to ask, a server tool is refused rather than run.
  const strict = new Permissions({ mode: 'ask', cwd, ask: null });
  assert.equal((await strict.check(agent.tools().find((t) => t.name === 'mcp__web__open'), {})).ok, false);
});
