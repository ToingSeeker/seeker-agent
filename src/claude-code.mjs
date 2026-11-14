// "Claude Code" as a provider: the Claude Code already installed and signed in
// on this machine does the work — with its own tools (Read, Edit, Bash, …) —
// and SEEKER is its screen. No API key is involved.
//
// It runs through the official Claude Agent SDK, which starts the local
// `claude` program and reports everything it does. Whenever Claude Code wants
// to do something that needs approval (edit a file, run a command), the SDK
// asks here first, and the question is put to the user in SEEKER's own prompt.
//
// One Claude Code session is kept per conversation and resumed for each new
// message, so earlier turns are not sent again.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const MODELS = [
  { name: 'default', title: 'whatever Claude Code is set to use' },
  { name: 'fable', title: 'most capable' },
  { name: 'opus', title: 'latest Opus' },
  { name: 'sonnet', title: 'latest Sonnet' },
  { name: 'haiku', title: 'fastest' },
];

/** Text of a tool result, which arrives as a string or as content blocks. */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n');
}

/** A whole conversation as one prompt, for starting a session in the middle of one. */
export function renderTranscript(messages) {
  const turns = messages.filter((m) => m.role !== 'tool' && m.content);
  if (turns.length === 1 && turns[0].role === 'user') return turns[0].content;
  const text = turns.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n\n');
  return `This conversation is already under way. Here it is so far:\n\n${text}\n\nContinue from here: respond to the last user message.`;
}

/**
 * @param {object} def     the registry entry
 * @param {object} config
 * @param {{ query?: Function }} [deps]  the SDK's `query`, replaceable in tests
 */
export function claudeCodeProvider(def, config, deps = {}) {
  const settings = () => config.providers?.[def.id] ?? {};
  let session = null; // { id, system, model, seen: message[] }
  let executable = null;

  /** The user's own `claude`, so the SDK does not need to ship a second copy. */
  function findClaude() {
    if (executable) return executable;
    const named = settings().command ?? 'claude';
    const found = named.includes('/') ? named : spawnSync('which', [named], { encoding: 'utf8' }).stdout.trim();
    if (!found || !fs.existsSync(found)) {
      throw new Error('Claude Code is not installed (the `claude` command was not found). Install it, run `claude` once to sign in, then try again.');
    }
    executable = fs.realpathSync(found);
    return executable;
  }

  async function loadQuery() {
    if (deps.query) return deps.query;
    try {
      return (await import('@anthropic-ai/claude-agent-sdk')).query;
    } catch {
      throw new Error('The Claude Code provider needs the Claude Agent SDK: run `npm install` in the seeker folder.');
    }
  }

  async function* chat({ model, system, messages, signal, hooks = {}, cwd = process.cwd() }) {
    const query = await loadQuery();
    // The session can be continued only if it holds exactly the history we have, minus what is new.
    const continues =
      session &&
      session.system === system &&
      session.model === model &&
      messages.length > session.seen.length &&
      session.seen.every((m, i) => messages[i] === m);
    const prompt = continues
      ? messages.slice(session.seen.length).filter((m) => m.role === 'user').map((m) => m.content).join('\n\n')
      : renderTranscript(messages);

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const env = { ...process.env };
    // Set when SEEKER itself was started from inside Claude Code; the child must not think it is nested.
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    let stderr = '';
    const options = {
      cwd,
      env,
      abortController: controller,
      includePartialMessages: true,
      pathToClaudeCodeExecutable: deps.query ? undefined : findClaude(),
      // Claude Code keeps its own instructions and tools; SEEKER only adds its notes on top.
      systemPrompt: { type: 'preset', preset: 'claude_code', append: system },
      // Which of the user's Claude Code settings (CLAUDE.md, MCP servers, hooks, allow rules) to load.
      settingSources: settings().settingSources ?? [],
      stderr: (data) => (stderr += data),
      // Called before anything that needs approval; the answer comes from SEEKER's prompt.
      canUseTool: async (name, input, info) => {
        const verdict = hooks.permission
          ? await hooks.permission({ id: info.toolUseID, name, input })
          : { ok: false, reason: 'Permission denied: nobody is available to approve this action.' };
        return verdict.ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: verdict.reason };
      },
    };
    if (model && model !== 'default') options.model = model;
    if (continues) options.resume = session.id;

    const started = Date.now();
    let result = null;
    let usage = null;
    try {
      for await (const event of query({ prompt, options })) {
        if (event.type === 'result') {
          result = event;
          continue;
        }
        // Work done by a sub-agent is reported through the call that started it.
        if (event.parent_tool_use_id) continue;
        if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
          const { delta } = event.event;
          if (delta.type === 'text_delta' && delta.text) yield { message: { content: delta.text } };
          else if (delta.type === 'thinking_delta' && delta.thinking) yield { message: { thinking: delta.thinking } };
        } else if (event.type === 'assistant') {
          usage = event.message?.usage ?? usage;
          for (const block of event.message?.content ?? []) {
            if (block.type === 'tool_use') yield { activity: { kind: 'start', id: block.id, name: block.name, input: block.input ?? {} } };
          }
        } else if (event.type === 'user' && Array.isArray(event.message?.content)) {
          for (const block of event.message.content) {
            if (block.type === 'tool_result') {
              yield { activity: { kind: 'end', id: block.tool_use_id, ok: !block.is_error, output: resultText(block.content) } };
            }
          }
        }
      }
    } catch (err) {
      session = null;
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const detail = stderr.trim().split('\n').at(-1);
      throw new Error(`Claude Code: ${err.message}${detail ? ` (${detail})` : ''}`);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    if (!result) {
      session = null;
      throw new Error('Claude Code stopped without finishing its reply.');
    }
    if (result.is_error) {
      session = null;
      throw new Error(`Claude Code: ${result.result || (result.errors ?? []).join('; ') || result.subtype || 'the request failed'}`);
    }
    session = { id: result.session_id, system, model, seen: [...messages] };
    // The last model call's own count is the size of the conversation; the result's total adds up every step.
    const counted = usage ?? result.usage ?? {};
    const output = result.usage?.output_tokens ?? counted.output_tokens ?? 0;
    yield {
      message: {},
      done: true,
      prompt_eval_count: (counted.input_tokens ?? 0) + (counted.cache_read_input_tokens ?? 0) + (counted.cache_creation_input_tokens ?? 0),
      eval_count: counted.output_tokens ?? 0,
      eval_duration: output ? ((Date.now() - started) * 1e6 * (counted.output_tokens ?? 0)) / output : 0,
      // For the usage ledger: every step of this turn, not only the last one.
      spent: spentOf(result.usage ?? counted),
    };
  }

  return {
    ...def,
    async listModels() {
      findClaude();
      return MODELS;
    },
    describe: async () => ({ tools: true, thinking: true, context: def.context }),
    chat,
  };
}

/** Anthropic's usage block as ledger counts: everything sent (cache reads included, and named), and what was written. */
export function spentOf(usage = {}) {
  const cached = usage.cache_read_input_tokens ?? 0;
  return { input: (usage.input_tokens ?? 0) + cached + (usage.cache_creation_input_tokens ?? 0), cached, output: usage.output_tokens ?? 0 };
}
