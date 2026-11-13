// Where the model runs. Each provider lists its models, describes one, and
// streams a chat — always yielding chunks in Ollama's shape, so the agent loop
// does not care which service is behind it.
//
// Four kinds cover everything:
//   ollama     Ollama's native API (local)
//   openai     any OpenAI-compatible /chat/completions endpoint, local or cloud
//   anthropic  Claude, through the official SDK
//   claude-code  Claude, through the `claude` command signed in on this machine (see claude-code.mjs)
import { HttpError, errorText, lines, open, readAll, requestJson } from './http.mjs';
import { claudeCodeProvider } from './claude-code.mjs';
import * as ollama from './ollama.mjs';
import { hoistToolImages } from './images.mjs';

export const PROVIDERS = [
  { id: 'ollama', label: 'Ollama', kind: 'ollama', local: true },
  { id: 'lmstudio', label: 'LM Studio', kind: 'openai', local: true, baseUrl: 'http://127.0.0.1:1234/v1' },
  { id: 'llamacpp', label: 'llama.cpp server', kind: 'openai', local: true, baseUrl: 'http://127.0.0.1:8080/v1' },
  { id: 'claude-code', label: 'Claude Code', kind: 'claude-code', context: 200_000, defaultModel: 'default', ownTools: true },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', env: 'ANTHROPIC_API_KEY', context: 200_000, defaultModel: 'claude-opus-5-5' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  { id: 'google', label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY', context: 1_000_000 },
  { id: 'xai', label: 'xAI Grok', kind: 'openai', baseUrl: 'https://api.x.ai/v1', env: 'XAI_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY', context: 64_000 },
  { id: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY' },
  { id: 'moonshot', label: 'Moonshot Kimi', kind: 'openai', baseUrl: 'https://api.moonshot.ai/v1', env: 'MOONSHOT_API_KEY' },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY' },
  { id: 'cerebras', label: 'Cerebras', kind: 'openai', baseUrl: 'https://api.cerebras.ai/v1', env: 'CEREBRAS_API_KEY' },
  { id: 'together', label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1', env: 'TOGETHER_API_KEY' },
  { id: 'fireworks', label: 'Fireworks AI', kind: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1', env: 'FIREWORKS_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY' },
];

const DEFAULT_CONTEXT = 128_000;
// /models also lists things that cannot hold a conversation.
const NOT_CHAT = /embed|whisper|tts|dall-e|image|audio|moderation|rerank|transcri|realtime|speech|guard|sora|veo|imagen|aqa/i;
// Models that take server-side refusal fallback; without it a declined request simply stops.
const CLAUDE_FALLBACK = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const CLAUDE_MAX_OUTPUT = 64_000;

/** Built-in providers plus any the user defined in config (`providers.<id>.baseUrl`). */
export function providerDefs(config) {
  const known = new Set(PROVIDERS.map((p) => p.id));
  const custom = Object.entries(config.providers ?? {})
    .filter(([id, p]) => !known.has(id) && p?.baseUrl)
    .map(([id, p]) => ({ id, label: p.label ?? id, kind: 'openai', baseUrl: p.baseUrl, local: /\/\/(127\.0\.0\.1|localhost)[:/]/.test(p.baseUrl), custom: true }));
  return [...PROVIDERS, ...custom];
}

export function apiKey(def, config) {
  return (def.env && process.env[def.env]) || config.providers?.[def.id]?.apiKey || null;
}

/** Local servers need no key; Claude can also sign in through `ant auth login`, so a missing key is not fatal there. */
export const needsKey = (def, config) => def.kind === 'openai' && !def.local && !apiKey(def, config);

// ── History conversion ─────────────────────────────────────────────────────
// Conversations are kept in Ollama's shape: assistant.tool_calls[] with an
// object `arguments`, and tool results as { role: 'tool', tool_call_id }.

export function toOpenAIMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of hoistToolImages(messages)) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || null };
      if (m.tool_calls?.length) {
        msg.tool_calls = m.tool_calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments ?? {}) },
        }));
      }
      out.push(msg);
    } else if (m.images?.length) {
      const pictures = m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }));
      out.push({ role: 'user', content: [{ type: 'text', text: m.content }, ...pictures] });
    } else out.push({ role: 'user', content: m.content });
  }
  return out;
}

/** Ollama's own shape, with each image reduced to its base64 text and tool images moved to a user message. */
export function toOllamaMessages(system, messages) {
  return [{ role: 'system', content: system }, ...hoistToolImages(messages).map((m) => (m.images?.length ? { ...m, images: m.images.map((i) => i.data) } : m))];
}

const claudeImage = (i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } });

export function toClaudeMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const result = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      if (m.images?.length) result.content = [{ type: 'text', text: m.content }, ...m.images.map(claudeImage)];
      if (m.content.startsWith('Error:')) result.is_error = true;
      // All results of one assistant turn belong in a single user message.
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(result);
      else out.push({ role: 'user', content: [result] });
    } else if (m.role === 'assistant') {
      // `blocks` is Claude's own reply, kept verbatim so its thinking blocks go back unchanged.
      let content = m.blocks;
      if (!content) {
        content = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const c of m.tool_calls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.function.name, input: c.function.arguments ?? {} });
      }
      if (content.length) out.push({ role: 'assistant', content });
    } else if (m.images?.length) out.push({ role: 'user', content: [...m.images.map(claudeImage), { type: 'text', text: m.content }] });
    else out.push({ role: 'user', content: m.content });
  }
  return out;
}

// ── Ollama ─────────────────────────────────────────────────────────────────

function ollamaProvider(def, config) {
  return {
    ...def,
    listModels: () => ollama.listModels(config.host),
    async describe(model) {
      const caps = await ollama.capabilities(config.host, model);
      return { tools: caps.includes('tools'), thinking: caps.includes('thinking'), vision: caps.includes('vision'), context: null };
    },
    chat: ({ model, system, messages, tools, think, signal }) =>
      ollama.chatStream({
        host: config.host,
        model,
        messages: toOllamaMessages(system, messages),
        tools,
        think,
        options: { num_ctx: config.numCtx },
        keepAlive: config.keepAlive,
        signal,
      }),
  };
}

// ── OpenAI-compatible ──────────────────────────────────────────────────────

function openaiProvider(def, config) {
  const base = (config.providers?.[def.id]?.baseUrl ?? def.baseUrl).replace(/\/+$/, '');
  const headers = () => {
    const key = apiKey(def, config);
    return key ? { authorization: `Bearer ${key}` } : {};
  };
  const fail = (status, text) => {
    const message = errorText(text);
    const hint = status === 401 || status === 403 || /api key/i.test(message) ? ' — check the API key (/key)' : '';
    return new HttpError(`${def.label}: ${message}${hint}`, status);
  };
  let catalogue = null;

  async function* chat({ model, system, messages, tools, signal }) {
    const body = { model, messages: toOpenAIMessages(system, messages), stream: true, stream_options: { include_usage: true } };
    if (tools?.length) body.tools = tools;
    let res = await open(`${base}/chat/completions`, { method: 'POST', body, headers: headers(), signal });
    if (res.statusCode === 400 || res.statusCode === 422) {
      // Some servers reject the usage option; everything else still works without it.
      const text = await readAll(res);
      if (!/stream_options|include_usage/i.test(text)) throw fail(res.statusCode, text);
      delete body.stream_options;
      res = await open(`${base}/chat/completions`, { method: 'POST', body, headers: headers(), signal });
    }
    if (res.statusCode >= 400) throw fail(res.statusCode, await readAll(res));

    const calls = []; // tool calls arrive in fragments, keyed by index
    let usage = null;
    const started = Date.now();
    for await (const line of lines(res)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') break;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.error) throw new HttpError(`${def.label}: ${event.error.message ?? JSON.stringify(event.error)}`);
      if (event.usage) usage = event.usage;
      const delta = event.choices?.[0]?.delta;
      if (!delta) continue;
      const thinking = delta.reasoning_content ?? delta.reasoning;
      if (typeof thinking === 'string' && thinking) yield { message: { thinking } };
      if (typeof delta.content === 'string' && delta.content) yield { message: { content: delta.content } };
      for (const part of delta.tool_calls ?? []) {
        const call = (calls[part.index ?? 0] ??= { id: '', name: '', args: '' });
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.args += part.function.arguments;
      }
    }

    const toolCalls = calls.filter(Boolean).map((c) => {
      let args;
      try {
        args = c.args ? JSON.parse(c.args) : {};
      } catch {
        args = { INVALID_JSON: c.args };
      }
      return { id: c.id, function: { name: c.name, arguments: args } };
    });
    const output = usage?.completion_tokens ?? 0;
    yield {
      message: toolCalls.length ? { tool_calls: toolCalls } : {},
      done: true,
      prompt_eval_count: usage?.prompt_tokens ?? 0,
      eval_count: output,
      eval_duration: output ? (Date.now() - started) * 1e6 : 0,
    };
  }

  return {
    ...def,
    async listModels() {
      let body;
      try {
        body = await requestJson(`${base}/models`, { headers: headers() });
      } catch (err) {
        throw err instanceof HttpError ? fail(err.status, err.message) : err;
      }
      catalogue = (body.data ?? body.models ?? [])
        // OpenRouter says what a model takes in; most services do not.
        .map((m) => {
          const takes = m.architecture?.input_modalities;
          return { name: m.id ?? m.name, context: m.context_length ?? m.context_window ?? null, ...(Array.isArray(takes) ? { vision: takes.includes('image') } : {}) };
        })
        .filter((m) => m.name && !NOT_CHAT.test(m.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      return catalogue;
    },
    async describe(model) {
      // These APIs do not say whether a model can call tools or see images, so it is assumed and the request decides.
      const known = catalogue?.find((m) => m.name === model);
      return { tools: true, thinking: false, vision: known?.vision ?? true, context: known?.context ?? def.context ?? DEFAULT_CONTEXT };
    },
    chat,
  };
}

// ── Anthropic (Claude) ─────────────────────────────────────────────────────

function anthropicProvider(def, config) {
  let sdk = null;
  let client = null;
  const details = new Map();

  async function connect() {
    if (client) return client;
    try {
      sdk = (await import('@anthropic-ai/sdk')).default;
    } catch {
      throw new Error('Claude needs the Anthropic SDK: run `npm install` in the seeker folder.');
    }
    const key = apiKey(def, config);
    // Without a key the SDK falls back to its own sources (ANTHROPIC_AUTH_TOKEN, an `ant auth login` profile).
    const baseURL = config.providers?.[def.id]?.baseUrl; // only for a gateway in front of the API
    client = new sdk({ ...(key ? { apiKey: key } : {}), ...(baseURL ? { baseURL } : {}) });
    return client;
  }

  /** Turns the SDK's typed errors into one readable line. */
  function explain(err) {
    if (!sdk || !(err instanceof sdk.APIError)) return err;
    if (err instanceof sdk.AuthenticationError) return new Error('Anthropic: the API key was rejected — set a new one with /key');
    if (err instanceof sdk.PermissionDeniedError) return new Error(`Anthropic: this key may not use that model (${err.message})`);
    if (err instanceof sdk.NotFoundError) return new Error(`Anthropic: model not found (${err.message})`);
    if (err instanceof sdk.RateLimitError) return new Error('Anthropic: rate limited — wait a moment and try again');
    if (err instanceof sdk.APIConnectionError) return new Error(`Anthropic: could not connect (${err.message})`);
    return new Error(`Anthropic: ${err.status ?? ''} ${err.message}`.replace(/\s+/g, ' '));
  }

  async function info(model) {
    if (!details.has(model)) {
      const c = await connect();
      try {
        details.set(model, await c.models.retrieve(model));
      } catch (err) {
        throw explain(err);
      }
    }
    return details.get(model);
  }

  async function* chat({ model, system, messages, tools, signal }) {
    const c = await connect();
    const meta = await info(model);
    const params = {
      model,
      max_tokens: Math.min(CLAUDE_MAX_OUTPUT, meta.max_tokens ?? CLAUDE_MAX_OUTPUT),
      system,
      messages: toClaudeMessages(messages),
      cache_control: { type: 'ephemeral' },
    };
    if (tools?.length) {
      // Eager streaming sends large inputs (file contents) as they are written instead of in one burst.
      params.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
        eager_input_streaming: true,
      }));
    }
    // Reasoning is hidden by default on current models; ask for the readable summary.
    if (meta.capabilities?.thinking?.types?.adaptive?.supported) params.thinking = { type: 'adaptive', display: 'summarized' };

    for (let attempt = 0; ; attempt++) {
      const stream = CLAUDE_FALLBACK.has(model)
        ? c.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
        : c.messages.stream(params, { signal });
      const started = Date.now();
      let message;
      try {
        for await (const event of stream) {
          if (event.type !== 'content_block_delta') continue;
          if (event.delta.type === 'text_delta') yield { message: { content: event.delta.text } };
          else if (event.delta.type === 'thinking_delta') yield { message: { thinking: event.delta.thinking } };
        }
        message = await stream.finalMessage();
      } catch (err) {
        if (signal?.aborted || err instanceof sdk.APIError) throw explain(err);
        // With eager streaming a tool input can arrive as unparseable JSON; that turn is simply asked again.
        if (attempt >= 2) throw new Error('Anthropic: the model kept sending a tool call that could not be read');
        continue;
      }

      const toolUses = message.content.filter((b) => b.type === 'tool_use');
      if (message.stop_reason === 'refusal') {
        const category = message.stop_details?.category;
        throw new Error(`Claude declined this request${category ? ` (${category})` : ''}. Rephrase it, or switch model with /model.`);
      }
      // An input cut off at the output limit can still parse as a smaller valid object — never run it.
      if (message.stop_reason === 'max_tokens' && toolUses.length) {
        throw new Error('Anthropic: the reply hit the output limit in the middle of a tool call. Ask for the work in smaller steps.');
      }

      const usage = message.usage ?? {};
      const output = usage.output_tokens ?? 0;
      yield {
        message: {
          tool_calls: toolUses.map((b) => ({ id: b.id, function: { name: b.name, arguments: b.input ?? {} } })),
          blocks: message.content,
        },
        done: true,
        prompt_eval_count: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        eval_count: output,
        eval_duration: output ? (Date.now() - started) * 1e6 : 0,
      };
      return;
    }
  }

  return {
    ...def,
    async listModels() {
      const c = await connect();
      const models = [];
      try {
        for await (const m of c.models.list()) {
          details.set(m.id, m);
          models.push({ name: m.id, context: m.max_input_tokens ?? null, title: m.display_name });
        }
      } catch (err) {
        throw explain(err);
      }
      return models;
    },
    async describe(model) {
      const meta = await info(model);
      return { tools: true, thinking: Boolean(meta.capabilities?.thinking?.supported), vision: meta.capabilities?.image_input?.supported ?? true, context: meta.max_input_tokens ?? def.context };
    },
    chat,
  };
}

/** @returns the provider `id` ready to use, or throws if there is no such provider. */
export function createProvider(id, config) {
  const def = providerDefs(config).find((p) => p.id === id);
  if (!def) throw new Error(`Unknown provider "${id}". Available: ${providerDefs(config).map((p) => p.id).join(', ')}`);
  if (def.kind === 'ollama') return ollamaProvider(def, config);
  if (def.kind === 'anthropic') return anthropicProvider(def, config);
  if (def.kind === 'claude-code') return claudeCodeProvider(def, config);
  return openaiProvider(def, config);
}
