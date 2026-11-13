// Shell hooks: commands of the user's own that run at fixed points — before and
// after a tool call, before a message goes to the model, when a session starts
// or ends — and can veto or adjust what happens.
//
// Config (~/.seeker/config.json):
//   "hooks": { "pre_tool_call": [{ "matcher": "bash|write_file", "command": "~/bin/guard.sh", "timeout": 60, "fail_closed": false }] }
//
// A hook gets one line of JSON on stdin and may print one JSON object:
//   pre_tool_call  {"action":"block","message":"…"}  or  {"action":"modify","args":{…}}   (exit code 2 also blocks)
//   pre_llm_call   {"action":"block","message":"…"}  or  {"context":"text added to the message"}
// Other events are observe-only. A hook runs only after the user has approved that exact command.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';

export const EVENTS = ['pre_tool_call', 'post_tool_call', 'pre_llm_call', 'post_llm_call', 'on_session_start', 'on_session_end'];
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 300;
const ALLOWLIST = () => path.join(HOME_DIR, 'hooks-allowlist.json');

/** Splits a command line into words the way a shell would for plain quoting; no expansion of any kind. */
export function splitCommand(command) {
  const words = [];
  let word = null;
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      word ??= '';
    } else if (ch === '\\' && i + 1 < command.length) word = (word ?? '') + command[++i];
    else if (/\s/.test(ch)) {
      if (word !== null) words.push(word);
      word = null;
    } else word = (word ?? '') + ch;
  }
  if (word !== null) words.push(word);
  return words.map((w, i) => (i === 0 && (w === '~' || w.startsWith('~/')) ? path.join(os.homedir(), w.slice(1)) : w));
}

/** The hooks in config, with entries that cannot work left out: { event, command, matcher, timeoutMs, failClosed }. */
export function configuredHooks(config) {
  const found = [];
  for (const [event, entries] of Object.entries(config.hooks ?? {})) {
    if (!EVENTS.includes(event) || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry.command !== 'string' || !entry.command.trim()) continue;
      const seconds = Math.min(MAX_TIMEOUT_S, Math.max(1, Number(entry.timeout) || DEFAULT_TIMEOUT_S));
      found.push({ event, command: entry.command.trim(), matcher: typeof entry.matcher === 'string' ? entry.matcher : null, timeoutMs: seconds * 1000, failClosed: event === 'pre_tool_call' && Boolean(entry.fail_closed ?? entry.failClosed) });
    }
  }
  return found;
}

function readAllowlist() {
  try {
    const data = JSON.parse(fs.readFileSync(ALLOWLIST(), 'utf8'));
    return Array.isArray(data.approvals) ? data.approvals : [];
  } catch {
    return [];
  }
}

export const isApproved = (hook) => readAllowlist().some((a) => a.event === hook.event && a.command === hook.command);

/** Records the user's approval of one hook; it is keyed on the exact event and command line. */
export function approve(hook) {
  const approvals = readAllowlist().filter((a) => !(a.event === hook.event && a.command === hook.command));
  approvals.push({ event: hook.event, command: hook.command, approved_at: new Date().toISOString() });
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(ALLOWLIST(), `${JSON.stringify({ approvals }, null, 1)}\n`, { mode: 0o600 });
}

function matches(hook, toolName) {
  if (!hook.matcher || !toolName) return true;
  try {
    return new RegExp(`^(?:${hook.matcher})$`).test(toolName);
  } catch {
    return hook.matcher === toolName; // not a valid pattern: compared as plain text
  }
}

function execute(hook, payload) {
  return new Promise((resolve) => {
    const [cmd, ...args] = splitCommand(hook.command);
    if (!cmd) return resolve({ error: 'empty command' });
    let child;
    try {
      child = spawn(cmd, args, { cwd: payload.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ error: err.message });
    }
    let out = '';
    let err = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (out.length < 200_000 ? (out += d) : null));
    child.stderr.on('data', (d) => (err.length < 20_000 ? (err += d) : null));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, hook.timeoutMs);
    child.on('error', (e) => (clearTimeout(timer), resolve({ error: e.message })));
    child.on('close', (code) => (clearTimeout(timer), resolve(timedOut ? { error: `timed out after ${hook.timeoutMs / 1000}s` } : { code, out: out.trim(), err: err.trim() })));
    // A hook that exits without reading its input must not crash SEEKER.
    child.stdin.on('error', () => {});
    child.stdin.end(`${JSON.stringify(payload, (_, v) => (typeof v === 'bigint' || typeof v === 'function' ? String(v) : v))}\n`);
  });
}

function parse(out) {
  if (!out) return {};
  try {
    const data = JSON.parse(out);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export class Hooks {
  /** @param {{ config: object, cwd: string, sessionId?: string, warn?: (text: string) => void }} opts */
  constructor({ config, cwd, sessionId = '', warn = () => {} }) {
    this.all = configuredHooks(config);
    this.cwd = cwd;
    this.sessionId = sessionId;
    this.warn = warn;
    this.warned = new Set();
  }

  /** Hooks waiting for the user's approval. */
  get unapproved() {
    return this.all.filter((h) => !isApproved(h));
  }

  /**
   * Runs every approved hook for an event, in config order.
   * @param {string} event
   * @param {{ toolName?: string, toolInput?: object, extra?: object }} [detail]
   * @returns {Promise<{ block?: string, args?: object, context?: string }>} for pre_tool_call a block or changed arguments; for pre_llm_call a block or added context
   */
  async run(event, { toolName = null, toolInput = null, extra = {} } = {}) {
    const result = {};
    let args = toolInput;
    for (const hook of this.all) {
      if (hook.event !== event || !matches(hook, toolName)) continue;
      if (!isApproved(hook)) {
        if (!this.warned.has(hook.command)) this.warn(`hook not run (not approved yet — review it with /hooks): ${hook.command}`);
        this.warned.add(hook.command);
        continue;
      }
      const payload = { hook_event_name: event, tool_name: toolName, tool_input: args, session_id: this.sessionId, cwd: this.cwd, extra };
      const done = await execute(hook, payload);
      const data = done.error ? null : parse(done.out);
      const blocking = event === 'pre_tool_call' || event === 'pre_llm_call';
      if (done.error || data === null) {
        const why = done.error ?? 'its output was not JSON';
        if (hook.failClosed) return { block: `hook ${hook.command} failed closed: ${why}` };
        this.warn(`hook ${hook.command} ${done.error ? `failed: ${why}` : 'printed something that is not JSON; ignored'}`);
        continue;
      }
      const action = data.action ?? data.decision;
      if (blocking && (action === 'block' || (event === 'pre_tool_call' && done.code === 2))) {
        return { block: String(data.message ?? data.reason ?? done.err.slice(0, 400) ?? '') || 'Blocked by shell hook.' };
      }
      if (done.code !== 0) {
        if (hook.failClosed && !action) return { block: `hook ${hook.command} failed closed: exit code ${done.code}` };
        this.warn(`hook ${hook.command} exited with code ${done.code}`);
      }
      if (event === 'pre_tool_call' && action === 'modify') {
        const changed = data.args ?? data.tool_input;
        if (changed && typeof changed === 'object') {
          args = { ...args, ...changed };
          result.args = args;
        }
      }
      if (event === 'pre_llm_call' && typeof data.context === 'string' && data.context.trim()) result.context = [result.context, data.context.trim()].filter(Boolean).join('\n\n');
    }
    return result;
  }
}
