// MCP (Model Context Protocol) servers: programs that offer extra tools — a
// browser, a PDF reader, a database. Each configured server is started, asked
// for its tools, and those tools are offered to the model as
// `mcp__<server>__<tool>` next to SEEKER's own.
//
// Servers come from `mcpServers` in ~/.seeker/config.json and from
// `.seeker/mcp.json` in the project, in the same shape Claude Code uses:
//   { "command": "npx", "args": ["@playwright/mcp@latest"], "env": {…} }   a local program
//   { "url": "https://…/mcp", "headers": { "Authorization": "Bearer …" } }  a remote server
// `"disabled": true` keeps an entry without starting it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { VERSION } from './config.mjs';
import { ToolError } from './tools.mjs';

const CONNECT_TIMEOUT = 45_000;
const CALL_TIMEOUT = 180_000;
const MAX_DESCRIPTION = 600;

const safe = (name) => String(name).replace(/[^a-zA-Z0-9_-]/g, '_');

/** Text of a tool result, which is a list of content blocks. */
export function resultText(result) {
  const parts = (result?.content ?? []).map((block) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'resource' && block.resource?.text) return block.resource.text;
    return `[${block.type}${block.mimeType ? ` ${block.mimeType}` : ''} — not shown]`;
  });
  if (!parts.length && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
  return parts.join('\n') || '(no output)';
}

/** Turns one server's tool into the shape SEEKER's own tools have. */
export function wrapTool(server, tool, call) {
  const name = `mcp__${safe(server)}__${safe(tool.name)}`;
  const description = (tool.description ?? tool.title ?? tool.name).trim();
  return {
    name,
    // Nothing is known about what a server's tool does, so each is approved by name.
    risk: 'other',
    description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}…` : description,
    parameters: tool.inputSchema?.type === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
    verbs: ['Calling', 'Called'],
    summary: (args) => {
      const text = JSON.stringify(args ?? {});
      return `${server} · ${tool.name}${text === '{}' ? '' : ` ${text}`}`;
    },
    async run(args, { signal }) {
      let result;
      try {
        result = await call(tool.name, args ?? {}, signal);
      } catch (err) {
        throw new ToolError(`${server}: ${err.message}`);
      }
      const text = resultText(result);
      if (result?.isError) throw new ToolError(text);
      return { output: text, display: text, displayLines: 3 };
    },
  };
}

/** Identifies one project server entry as the user saw it: any change to what it runs gives a new value. */
export function serverFingerprint(cwd, name, entry) {
  const { command, args, env, cwd: dir, url, headers } = entry;
  return crypto.createHash('sha256').update(JSON.stringify([path.resolve(cwd), name, command, args, env, dir, url, headers])).digest('hex');
}

/**
 * Server entries from the user's config and the project's file. The user's own entry wins on a clash.
 *
 * A project file arrives with the project — a cloned repository, a downloaded archive — so its entries
 * are commands somebody else wrote. They are listed but marked `untrusted`, and never started, until the
 * user has approved that exact entry in that folder (`trustedMcp` in the user's config; see /mcp).
 */
export function readServers(config, cwd) {
  let project = {};
  try {
    const file = JSON.parse(fs.readFileSync(path.join(cwd, '.seeker', 'mcp.json'), 'utf8'));
    project = file.mcpServers ?? file;
  } catch {}
  const trusted = new Set(config.trustedMcp ?? []);
  const servers = {};
  for (const [name, entry] of Object.entries(project ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    servers[name] = { ...entry, source: 'project', untrusted: !trusted.has(serverFingerprint(cwd, name, entry)) };
  }
  return { ...servers, ...(config.mcpServers ?? {}) };
}

export class McpHub {
  /**
   * @param {object} opts
   * @param {Record<string, object>} opts.servers
   * @param {(tools: object[]) => void} opts.onChange  called whenever the set of available tools changes
   * @param {object} [opts.sdk]  the MCP SDK pieces, replaceable in tests
   */
  constructor({ servers, onChange = () => {}, sdk = null }) {
    this.onChange = onChange;
    this.sdk = sdk;
    this.servers = new Map(); // name → { config, status, error, tools, client }
    for (const [name, config] of Object.entries(servers)) {
      this.servers.set(name, { config, status: config.untrusted ? 'untrusted' : config.disabled ? 'disabled' : 'idle', error: null, tools: [], client: null });
    }
  }

  async #load() {
    if (this.sdk) return this.sdk;
    try {
      const [{ Client }, { StdioClientTransport }, { StreamableHTTPClientTransport }] = await Promise.all([
        import('@modelcontextprotocol/sdk/client/index.js'),
        import('@modelcontextprotocol/sdk/client/stdio.js'),
        import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
      ]);
      this.sdk = { Client, StdioClientTransport, StreamableHTTPClientTransport };
    } catch {
      throw new Error('MCP servers need the MCP SDK: run `npm install` in the seeker folder.');
    }
    return this.sdk;
  }

  tools() {
    return [...this.servers.values()].flatMap((s) => (s.status === 'ready' ? s.tools : []));
  }

  status() {
    return [...this.servers.entries()].map(([name, s]) => ({ name, status: s.status, error: s.error, tools: s.tools.length, config: s.config }));
  }

  async connect(name) {
    const server = this.servers.get(name);
    if (!server) throw new Error(`No MCP server named "${name}"`);
    if (server.config.untrusted) throw new Error(`MCP server "${name}" comes from this project and has not been approved`);
    await this.disconnect(name);
    server.status = 'starting';
    server.error = null;
    try {
      const { Client, StdioClientTransport, StreamableHTTPClientTransport } = await this.#load();
      const { config } = server;
      const transport = config.url
        ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } })
        : new StdioClientTransport({ command: config.command, args: config.args ?? [], env: { ...process.env, ...(config.env ?? {}) }, cwd: config.cwd, stderr: 'ignore' });
      const client = new Client({ name: 'seeker', version: VERSION });
      await client.connect(transport, { timeout: CONNECT_TIMEOUT });
      const { tools = [] } = await client.listTools(undefined, { timeout: CONNECT_TIMEOUT });
      server.client = client;
      server.tools = tools.map((tool) =>
        wrapTool(name, tool, (toolName, args, signal) => client.callTool({ name: toolName, arguments: args }, undefined, { signal, timeout: CALL_TIMEOUT })),
      );
      server.status = 'ready';
      // A server that dies later simply takes its tools with it.
      client.onclose = () => {
        if (server.client !== client) return;
        server.status = 'stopped';
        server.client = null;
        this.onChange(this.tools());
      };
    } catch (err) {
      server.status = 'failed';
      server.error = /401|403|unauthori[sz]ed/i.test(err.message) ? `${err.message} — this server needs a sign-in SEEKER cannot do; give it an API key in "headers" if it accepts one` : err.message;
      server.tools = [];
    }
    this.onChange(this.tools());
    return server.status;
  }

  async disconnect(name) {
    const server = this.servers.get(name);
    if (!server?.client) return;
    const { client } = server;
    server.client = null;
    server.tools = [];
    await client.close().catch(() => {});
    this.onChange(this.tools());
  }

  /** Starts every server that is switched on and trusted, all at once. Never throws: failures are recorded per server. */
  async connectAll() {
    const names = [...this.servers.entries()].filter(([, s]) => s.status !== 'disabled' && s.status !== 'untrusted').map(([name]) => name);
    await Promise.all(names.map((name) => this.connect(name)));
  }

  async closeAll() {
    await Promise.all([...this.servers.keys()].map((name) => this.disconnect(name)));
  }
}
