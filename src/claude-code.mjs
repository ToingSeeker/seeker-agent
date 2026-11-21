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
//
// Claude Code runs some tools without asking (reading or searching inside the project, commands it
// judges read-only), so the approval question alone does not see them. A PreToolUse hook sees
// every call: SEEKER's own key files are refused there, and other secret files (src/secrets.mjs)
// turn the call into a question, which reaches SEEKER's prompt like any other.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SEEKER_SECRET } from './permissions.mjs';
import { secretInCommand, secretKind } from './secrets.mjs';

// How long a reply waits, after Claude Code's answer, for commands it left running in the background
// (providers.claude-code.backgroundWait, in ms); and for it to go on once the last of them is done.
const BACKGROUND_WAIT = 30 * 60_000;
const QUIET_AFTER_TASK = 30_000;

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

// The input that names the file each of Claude Code's file tools works on.
const FILE_INPUT = { Read: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path', Grep: 'path' };
const expandHome = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);

/** The secret file one of Claude Code's tool calls would touch: `{ kind, file }`, or null. */
export function secretTouched(name, input, cwd) {
  if (name === 'Bash') return secretInCommand(input?.command, cwd);
  const value = input?.[FILE_INPUT[name]];
  if (typeof value !== 'string' || !value) return null;
  const file = path.resolve(cwd, expandHome(value));
  const kind = secretKind(file);
  return kind ? { kind, file } : null;
}

const decide = (permissionDecision, permissionDecisionReason) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
});

/** The PreToolUse hook: refuses SEEKER's key files, asks about other secret files, leaves the rest alone. */
export function secretGuard(cwd) {
  return async (event) => {
    try {
      const secret = secretTouched(event.tool_name, event.tool_input, event.cwd || cwd);
      if (!secret) return {};
      if (secret.kind === 'seeker') return decide('deny', SEEKER_SECRET);
      return decide('ask', `${path.basename(secret.file)} looks like it holds secrets (keys, passwords).`);
    } catch {
      // A check that failed must not let the call through unseen.
      return decide('ask', 'SEEKER could not check this call for secret files.');
    }
  };
}

// A search result line names its file first: `path:12:text`, `path:text`, `path:3` (counts).
const LINE_FILE = /^([^:\n]+):/;
const LEFT_OUT = '(lines from files that hold secrets were left out)';

/** `text` without the search-result lines that come from secret files; null when none did. */
export function withoutSecretLines(text, cwd) {
  if (typeof text !== 'string' || !text) return null;
  const lines = text.split('\n');
  const kept = lines.filter((line) => {
    const file = line.match(LINE_FILE)?.[1];
    return !(file && secretKind(path.resolve(cwd, expandHome(file.trim()))));
  });
  return kept.length === lines.length ? null : `${kept.join('\n')}\n${LEFT_OUT}`;
}

/**
 * A tool's result without the lines a folder search took from secret files, or null when there
 * was nothing to take out. A search (`grep -rn x .` in Bash, or the Grep tool where Claude Code
 * has one) reads hidden files too, so it can reach a .env that the guard never saw named.
 */
export function filterSearch(name, output, cwd) {
  if (!output || typeof output !== 'object') return null;
  if (name === 'Bash') {
    const stdout = withoutSecretLines(output.stdout, cwd);
    return stdout === null ? null : { ...output, stdout };
  }
  if (name !== 'Grep') return null;
  const secret = (f) => typeof f === 'string' && Boolean(secretKind(path.resolve(cwd, f)));
  const filenames = Array.isArray(output.filenames) ? output.filenames.filter((f) => !secret(f)) : output.filenames;
  const content = withoutSecretLines(output.content, cwd);
  const dropped = (output.filenames?.length ?? 0) !== (filenames?.length ?? 0);
  if (content === null && !dropped) return null;
  return { ...output, filenames, numFiles: filenames?.length ?? output.numFiles, content: content ?? output.content };
}

/** The PostToolUse hook: search results lose their secret files' lines before the model sees them. */
export function searchFilter(cwd) {
  return async (event) => {
    try {
      const updated = filterSearch(event.tool_name, event.tool_response, event.cwd || cwd);
      return updated ? { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: updated } } : {};
    } catch {
      return {};
    }
  };
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

    // The prompt goes in as a stream that stays open until Claude Code is really done. Given as plain text,
    // the SDK closes Claude Code's input at the first result, and a command it left running in the background
    // (a CI watch, a long build) then wakes it to a turn whose every approval fails with "Stream closed".
    let closeInput;
    const inputDone = new Promise((resolve) => (closeInput = resolve));
    const input = (async function* () {
      yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null };
      await inputDone;
    })();
    const background = new Set(); // tasks Claude Code started that have not reported back
    let waitTimer = null;
    const waitFor = (ms) => {
      clearTimeout(waitTimer);
      waitTimer = setTimeout(closeInput, ms);
      waitTimer.unref?.();
    };

    const controller = new AbortController();
    const onAbort = () => (closeInput(), controller.abort());
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
      // Every tool call, asked about or not, is checked for secret files first (see the top of this file).
      hooks: {
        PreToolUse: [{ hooks: [secretGuard(cwd)] }],
        PostToolUse: [{ matcher: 'Bash|Grep', hooks: [searchFilter(cwd)] }],
      },
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
    let separated = null;
    try {
      for await (const event of query({ prompt: input, options })) {
        if (event.type === 'result') {
          result = event; // its usage counts the whole run so far
          // Done, unless something it started is still running: then it is woken when that finishes.
          if (!background.size || event.is_error) closeInput();
          else waitFor(settings().backgroundWait ?? BACKGROUND_WAIT);
          continue;
        }
        if (event.type === 'system' && event.subtype === 'task_started') background.add(event.task_id);
        if (event.type === 'system' && event.subtype === 'task_notification') {
          background.delete(event.task_id);
          // It normally goes on with a new turn; if it does not, the reply is over.
          if (result && !background.size) waitFor(QUIET_AFTER_TASK);
        }
        if (result && (event.type === 'stream_event' || event.type === 'assistant')) {
          clearTimeout(waitTimer);
          // A turn after a result: set apart from what was said before.
          if (separated !== result && event.type === 'stream_event' && event.event?.type === 'message_start' && !event.parent_tool_use_id) {
            separated = result;
            yield { message: { content: '\n\n' } };
          }
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
      clearTimeout(waitTimer);
      closeInput();
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
  const written = usage.cache_creation_input_tokens ?? 0;
  return { input: (usage.input_tokens ?? 0) + cached + written, cached, written, output: usage.output_tokens ?? 0 };
}
