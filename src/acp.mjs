// `seeker acp`: SEEKER as an agent inside an editor that speaks the Agent Client
// Protocol (Zed and others). The editor starts this process and the two talk
// JSON-RPC 2.0 over stdin/stdout, one JSON object per line. The editor shows
// the answer, the tool steps and the permission questions in its own interface.
//
// Implemented: initialize, authenticate (nothing to do), session/new,
// session/prompt, session/cancel; towards the editor: session/update and
// session/request_permission. Protocol version 1.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Agent } from './agent.mjs';
import { VERSION } from './config.mjs';
import { Permissions } from './permissions.mjs';
import { createProvider } from './providers.mjs';
import { Session } from './session.mjs';

export const PROTOCOL_VERSION = 1;
const MAX_EMBEDDED_CHARS = 200_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const KINDS = [
  [/^(Reading|Loading skill|Checking process)/, 'read'],
  [/^(Writing|Editing)/, 'edit'],
  [/^(Running|Stopping process)/, 'execute'],
  [/^(Searching the web|Fetching)/, 'fetch'],
  [/^(Searching|Finding|Listing)/, 'search'],
  [/^(Updating plan|Delegating)/, 'think'],
];
const kindOf = (doing) => KINDS.find(([pattern]) => pattern.test(doing))?.[1] ?? 'other';
const textBlock = (text) => ({ type: 'text', text });
const asContent = (text) => [{ type: 'content', content: textBlock(text) }];

/** The message and pictures in an editor's prompt, which is a list of content blocks. */
export function readPrompt(blocks, cwd) {
  const parts = [];
  const images = [];
  const local = (uri) => {
    try {
      const file = uri.startsWith('file:') ? fileURLToPath(uri) : uri;
      const rel = path.relative(cwd, file);
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
    } catch {
      return uri;
    }
  };
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block?.type === 'resource_link' && block.uri) parts.push(`[The user points at this file: ${local(String(block.uri))}]`);
    else if (block?.type === 'resource' && typeof block.resource?.text === 'string') {
      const text = block.resource.text;
      const shown = text.length > MAX_EMBEDDED_CHARS ? `${text.slice(0, MAX_EMBEDDED_CHARS)}\n… [${text.length - MAX_EMBEDDED_CHARS} more characters not shown]` : text;
      parts.push(`📄 ${local(String(block.resource.uri ?? 'attachment'))}\n\`\`\`\n${shown}\n\`\`\``);
    } else if (block?.type === 'image' && IMAGE_TYPES.has(block.mimeType) && typeof block.data === 'string') {
      images.push({ name: `image-${images.length + 1}`, mime: block.mimeType, data: block.data });
    }
  }
  return { text: parts.join('\n\n'), images };
}

/**
 * @param {object} opts
 * @param {object} opts.config
 * @param {object} [opts.info]                       what the model can do, if already known
 * @param {import('node:stream').Readable} opts.input
 * @param {import('node:stream').Writable} opts.output
 * @param {(line: string) => void} [opts.log]        never stdout: that carries the protocol
 * @returns {Promise<void>} when the editor closes the connection
 */
export function runAcp({ config, info = null, input, output, log = () => {} }) {
  const sessions = new Map();
  const waiting = new Map(); // our requests to the editor that have no answer yet
  let nextId = 1;
  let described = info;

  const write = (message) => output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const notify = (method, params) => write({ method, params });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = `seeker-${nextId++}`;
      waiting.set(id, resolve);
      write({ id, method, params });
    });
  const fault = (code, message) => Object.assign(new Error(message), { code });

  /** A stand-in for the terminal interface that reports to the editor instead. */
  function editorUi(sessionId) {
    const update = (body) => notify('session/update', { sessionId, update: body });
    const plain = new Proxy({}, { get: () => (text) => text });
    const state = { call: null, title: '' };
    const say = (text) => update({ sessionUpdate: 'agent_message_chunk', content: textBlock(text) });
    const handlers = {
      c: plain,
      answerStream: () => ({ push: say, flush() {} }),
      thinkChunk: (text) => update({ sessionUpdate: 'agent_thought_chunk', content: textBlock(String(text)) }),
      toolStart: (doing, _done, summary) => {
        state.call = `call-${crypto.randomBytes(6).toString('hex')}`;
        state.title = `${doing} ${String(summary ?? '').replace(/\s+/g, ' ').slice(0, 200)}`.trim();
        update({ sessionUpdate: 'tool_call', toolCallId: state.call, title: state.title, kind: kindOf(doing), status: 'pending' });
      },
      diff: ({ removed = [], added = [], more = 0 }) => {
        if (!state.call) return;
        const text = [...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].join('\n') + (more ? `\n… ${more} more lines` : '');
        update({ sessionUpdate: 'tool_call_update', toolCallId: state.call, content: asContent(text) });
      },
      toolRunning: () => state.call && update({ sessionUpdate: 'tool_call_update', toolCallId: state.call, status: 'in_progress' }),
      toolDone: (note, display) => {
        if (!state.call) return;
        const text = [note, display].filter((t) => typeof t === 'string' && t.trim()).join('\n');
        update({ sessionUpdate: 'tool_call_update', toolCallId: state.call, status: 'completed', ...(text ? { content: asContent(text) } : {}) });
        state.call = null;
      },
      toolFail: (why) => {
        if (!state.call) return;
        update({ sessionUpdate: 'tool_call_update', toolCallId: state.call, status: 'failed', content: asContent(String(why)) });
        state.call = null;
      },
      warn: (text) => say(`\n${String(text).trim()}\n`),
      error: (text) => say(`\n${String(text).trim()}\n`),
    };
    const ui = new Proxy(handlers, { get: (target, key) => (key in target ? target[key] : key === 'tool' ? null : () => {}) });
    return { ui, state };
  }

  async function newSession({ cwd }) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw fault(-32602, "'cwd' must be the absolute path of an existing folder.");
    const provider = createProvider(config.provider, config);
    described ??= await provider.describe(config.model);
    const sessionId = crypto.randomUUID();
    const { ui, state } = editorUi(sessionId);
    // The editor shows the question; its answer is one of the options offered here.
    const ask = async ({ tool, args, warning, always }) => {
      // The title is a one-line label; the whole of what would run goes along uncut, as text and as the raw input.
      const full = tool?.summary ? `${tool.verbs?.[0] ?? tool.name} ${tool.summary(args ?? {})}`.trim() : state.title;
      const toolCall = { toolCallId: state.call ?? `call-${crypto.randomBytes(6).toString('hex')}`, title: warning ? `${state.title} — ⚠ ${warning}` : state.title, content: asContent(warning ? `${full}\n\n⚠ ${warning}` : full), rawInput: args ?? {} };
      const options = [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, ...(always ? [{ optionId: 'always', name: always[0].toUpperCase() + always.slice(1), kind: 'allow_always' }] : []), { optionId: 'reject', name: 'Reject', kind: 'reject_once' }];
      const reply = await request('session/request_permission', { sessionId, toolCall, options });
      const outcome = reply?.result?.outcome;
      if (outcome?.outcome !== 'selected') return null;
      return outcome.optionId === 'allow' ? 'y' : outcome.optionId === 'always' ? 'a' : 'n';
    };
    const agent = new Agent({ config, ui, permissions: new Permissions({ mode: config.permissionMode, cwd, ask, autoLearn: config.autoLearn }), provider, info: described, cwd });
    // The protocol has no place for a question in the middle of a turn; the agent ends its turn with the question instead.
    agent.withheld = new Set(['ask_user']);
    agent.session = new Session(cwd);
    sessions.set(sessionId, { agent, cwd });
    log(`session ${sessionId.slice(0, 8)} · ${cwd}`);
    return { sessionId };
  }

  async function prompt({ sessionId, prompt: blocks }) {
    const session = sessions.get(sessionId);
    if (!session) throw fault(-32602, `No session "${sessionId}".`);
    if (session.agent.busy) throw fault(-32600, 'This session is still answering the previous prompt.');
    const { text, images } = readPrompt(blocks, session.cwd);
    if (!text && !images.length) throw fault(-32602, 'The prompt has nothing in it that SEEKER can read.');
    await session.agent.runTurn(text, { images, references: true });
    session.agent.session.save(session.agent.messages, session.agent.model);
    return { stopReason: session.agent.interrupted ? 'cancelled' : 'end_turn' };
  }

  const methods = {
    initialize: async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false, promptCapabilities: { image: true, audio: false, embeddedContext: true } },
      authMethods: [],
      agentInfo: { name: 'seeker', title: 'SEEKER', version: VERSION },
    }),
    authenticate: async () => ({}),
    'session/new': newSession,
    'session/prompt': prompt,
  };

  function receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return write({ id: null, error: { code: -32700, message: 'Not valid JSON.' } });
    }
    if (!message || typeof message !== 'object') return;
    // An answer to one of our own requests.
    if (message.method === undefined) return waiting.get(message.id)?.(message), waiting.delete(message.id);
    const { id, method, params = {} } = message;
    if (method === 'session/cancel') {
      sessions.get(params.sessionId)?.agent.interrupt();
      return;
    }
    if (id === undefined) return; // other notifications need no answer
    const handler = methods[method];
    if (!handler) return write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    handler(params).then(
      (result) => write({ id, result }),
      (err) => {
        log(`${method} failed: ${err.message}`);
        write({ id, error: { code: err.code ?? -32603, message: err.message } });
      },
    );
  }

  return new Promise((resolve) => {
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    lines.on('line', (line) => line.trim() && receive(line));
    lines.on('close', () => {
      // The editor is gone: nothing can be asked or shown any more.
      for (const answer of waiting.values()) answer(null);
      for (const { agent } of sessions.values()) agent.interrupt();
      resolve();
    });
  });
}
