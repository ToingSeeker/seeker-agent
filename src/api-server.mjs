// `seeker serve`: SEEKER behind an OpenAI-compatible HTTP API, so any chat
// frontend that speaks that format (Open WebUI, LibreChat, a script with the
// openai package) can use it as its backend — with SEEKER's tools, memory and
// skills doing the work in the folder it was started in.
//
//   POST /v1/chat/completions   (stream or not)      GET /v1/models      GET /health
//
// It listens on this machine only and every request needs the key. Nobody is
// there to approve anything, so by default a request can read and run harmless
// commands but not change files; `"apiServer": { "allowChanges": true }` lets
// it edit and run ordinary commands. Risky commands are refused either way.
import crypto from 'node:crypto';
import http from 'node:http';
import { Agent } from './agent.mjs';
import { VERSION } from './config.mjs';
import { Permissions } from './permissions.mjs';
import { createProvider } from './providers.mjs';

const MAX_BODY_BYTES = 10 * 1024 * 1024;
export const DEFAULT_PORT = 8642;

const sameKey = (given, wanted) => {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(wanted)).digest();
  return crypto.timingSafeEqual(a, b);
};

/** The text of an OpenAI message, whose content may be a string or a list of parts. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (part?.type === 'text' ? part.text : '')).join('');
}

/** Pictures sent as data: URLs, in SEEKER's own shape. Remote image URLs are not fetched. */
function imagesOf(content) {
  if (!Array.isArray(content)) return [];
  const images = [];
  for (const part of content) {
    const url = part?.type === 'image_url' ? (part.image_url?.url ?? '') : '';
    const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (m) images.push({ name: `image-${images.length + 1}`, mime: m[1], data: m[2] });
  }
  return images;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('The request is larger than 10 MB.'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * A stand-in for the terminal interface that turns what the agent does into text:
 * the answer as it is written, and one short line per tool step.
 */
function streamingUi(emit) {
  const plain = new Proxy({}, { get: () => (text) => text });
  let current = '';
  const handlers = {
    c: plain,
    answerStream: () => ({ push: (text) => emit(text), flush() {} }),
    toolStart: (doing, done, summary) => {
      current = `${doing} ${String(summary ?? '').replace(/\s+/g, ' ').slice(0, 120)}`.trim();
    },
    toolRunning: () => emit(`\n\`⚙ ${current}\`\n`),
    toolFail: (why) => emit(`\n\`✖ ${current} — ${String(why).replace(/\s+/g, ' ').slice(0, 160)}\`\n`),
    warn: (text) => emit(`\n${String(text).trim()}\n`),
    error: (text) => emit(`\n${String(text).trim()}\n`),
  };
  return new Proxy(handlers, { get: (target, key) => (key in target ? target[key] : key === 'tool' ? null : () => {}) });
}

/**
 * @param {object} opts
 * @param {object} opts.config
 * @param {string} opts.key      the bearer key every request must carry
 * @param {string} opts.cwd      the folder requests work in
 * @param {object} [opts.info]   what the model can do, if already known
 * @param {(line: string) => void} [opts.log]
 * @returns {http.Server} not yet listening
 */
export function createApiServer({ config, key, cwd, info = null, log = () => {} }) {
  if (!key || String(key).length < 16) throw new Error('The API server needs a key of at least 16 characters (SEEKER_API_KEY, or apiServer.key in the config).');
  const allowChanges = config.apiServer?.allowChanges === true;
  const modelId = `seeker/${config.model}`;
  let described = info;

  const json = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };
  const fail = (res, status, message, type = 'invalid_request_error') => json(res, status, { error: { message, type } });

  async function complete(req, res) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return fail(res, err.status ?? 400, err.status ? err.message : 'The request body is not valid JSON.');
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const last = messages.at(-1);
    if (!last || last.role !== 'user') return fail(res, 400, "'messages' must end with a user message.");

    const provider = createProvider(config.provider, config);
    described ??= await provider.describe(config.model);
    // 'auto' still asks about risky commands, and with nobody to ask, those are refused.
    const permissions = new Permissions({ mode: allowChanges ? 'auto' : 'ask', cwd, ask: null });
    const stream = body.stream === true;
    const id = `chatcmpl-${crypto.randomBytes(12).toString('hex')}`;
    const created = Math.floor(Date.now() / 1000);
    let text = '';
    const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: modelId, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const emit = (piece) => {
      text += piece;
      if (stream && !res.writableEnded) res.write(chunk({ content: piece }));
    };

    const agent = new Agent({ config: { ...config, review: false }, ui: streamingUi(emit), permissions, provider, info: described, cwd });
    agent.allowReview = false;
    // A frontend cannot answer a question mid-reply, and what it sends must not become lasting memory or a schedule.
    agent.withheld = new Set(['ask_user', 'memory', 'skill_manage', 'cronjob_manage']);
    // The frontend keeps the conversation; each request brings it along. Its own system prompt rides with the first message.
    const system = messages.filter((m) => m.role === 'system' || m.role === 'developer').map((m) => textOf(m.content)).filter(Boolean).join('\n\n');
    agent.messages = messages
      .slice(0, -1)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: textOf(m.content) }))
      .filter((m) => m.content);
    const prompt = `${system && !agent.messages.length ? `[Instructions from the application you are being used through]\n${system}\n\n` : ''}${textOf(last.content)}`;

    if (stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(chunk({ role: 'assistant' }));
    }
    // The frontend going away stops the work.
    res.on('close', () => !res.writableFinished && agent.interrupt());
    log(`request · ${messages.length} message${messages.length > 1 ? 's' : ''}${stream ? ' · stream' : ''}`);
    await agent.runTurn(prompt, { images: imagesOf(last.content) });

    const prompt_tokens = agent.usedTokens;
    if (stream) {
      if (!res.writableEnded) res.end(`${chunk({}, 'stop')}data: [DONE]\n\n`);
      return;
    }
    json(res, 200, { id, object: 'chat.completion', created, model: modelId, choices: [{ index: 0, message: { role: 'assistant', content: text.trim() }, finish_reason: 'stop' }], usage: { prompt_tokens, completion_tokens: 0, total_tokens: prompt_tokens } });
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok', version: VERSION });
    const given = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!sameKey(given, key)) return fail(res, 401, 'Missing or wrong API key.', 'authentication_error');
    if (req.method === 'GET' && url.pathname === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: modelId, object: 'model', created: 0, owned_by: 'seeker' }] });
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      return complete(req, res).catch((err) => {
        log(`error · ${err.message}`);
        if (!res.headersSent) fail(res, 500, err.message, 'server_error');
        else if (!res.writableEnded) res.end();
      });
    }
    fail(res, 404, `No such endpoint: ${req.method} ${url.pathname}`);
  });
}
