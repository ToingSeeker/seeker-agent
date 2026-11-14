// The agent loop: send the conversation to the model, run whatever tools it
// asks for, feed the results back, repeat until it answers without a tool call.
import { TOOLS, ToolError, clip, toolSpecs, validateArgs } from './tools.mjs';
import path from 'node:path';
import { describeExternal } from './external-tools.mjs';
import { SubdirectoryHints } from './context-files.mjs';
import { decide, fallbackChain, reasonText } from './failover.mjs';
import { buildSystemPrompt } from './prompt.mjs';
import { createProvider, keyPool } from './providers.mjs';
import { loadSkills } from './skills.mjs';
import { recordUsage } from './usage.mjs';
import { MAX_IMAGES_PER_MESSAGE, imagePathsIn, kilobytes, loadImage, messageChars, saveImages, withoutImages } from './images.mjs';

const CHARS_PER_TOKEN = 3.5;
const COMPACT_AT = 0.8;

// Share of the context the newest messages may keep, word for word, across a summary.
const KEEP_RECENT = 0.3;
// How full the summariser's own context may get; the rest is room for the summary it writes.
const SUMMARY_FILL = 0.7;
// A turn that needs summarising this often is working on more than the context can hold.
const MAX_COMPACTIONS_PER_TURN = 3;
// Below this many tokens of context (and always on a local model), tools with a short description send that one.
const COMPACT_TOOLS_BELOW = 64_000;

// Helpers a single `task` call may run side by side.
export const MAX_PARALLEL_HELPERS = 3;

// The unattended review after a turn (see #review): how often, and what it may use.
const MEMORY_REVIEW_EVERY_TURNS = 10;
const SKILL_REVIEW_EVERY_STEPS = 10;
const REVIEW_STEPS = 16;
const REVIEW_TOOLS = new Set(['memory', 'skill_manage', 'skill', 'read_file', 'grep', 'glob']);
// A message naming one of these has material to attach (see references.mjs).
const HAS_REFERENCE = /(?<![\w/@])@(?:diff\b|staged\b|file:|folder:|git:|url:)/;

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

const compactPrompt = (task) => `Summarise the conversation above so the work can continue without it. Everything above will be deleted: file contents and command output will no longer be visible, only what you write now.

Write, in plain text:
1. What the user asked for, and any preferences or constraints they stated.
2. Facts already gathered that the remaining work depends on. Copy them exactly — names of functions, classes, files and settings, values, error messages, line numbers. This is the most important part: a fact left out has to be looked up again, and a fact written vaguely ("the file exports several functions") is useless.
3. What has been done so far — files created or changed (with paths) and what changed in each, commands run and what they showed, errors still unresolved.
4. What remains to be done, in order.

${task ? `The task in hand, in the user's words, so you know which facts matter:\n<request>\n${task}\n</request>\n\n` : ''}Do not call tools. Do not start on the remaining work — only write the summary.`;

const AFTER_COMPACT = `File contents and command output from before this point are gone. Work from the facts in the summary; if something you need is not in it, read the file or run the command again. Never fill a gap from memory or by guessing.`;

/** Some local models print the call as text instead of using the tool-call channel. */
export function parseTextToolCalls(content) {
  const calls = [];
  for (const m of content.matchAll(/<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g)) {
    try {
      const call = JSON.parse(m[1]);
      if (typeof call.name === 'string') calls.push({ function: { name: call.name, arguments: call.arguments ?? call.parameters ?? {} } });
    } catch {}
  }
  return calls;
}

export class Agent {
  /**
   * @param {object} opts
   * @param {object} opts.provider  from createProvider()
   * @param {{ tools: boolean, thinking: boolean, context: number|null }} opts.info  what the model can do
   */
  constructor({ config, ui, permissions, provider, info, cwd }) {
    this.config = config;
    this.ui = ui;
    this.permissions = permissions;
    this.cwd = cwd;
    this.messages = [];
    this.state = { todos: [] };
    this.controller = null;
    this.usedTokens = 0;
    this.lastStats = null;
    // Tokens as the provider counted them: the last request, and everything since the conversation began.
    this.usage = { input: 0, output: 0, totalInput: 0, totalOutput: 0, known: false };
    // Tools a provider is running itself, by call id: { about, row } where `row` is its line on screen.
    this.external = new Map();
    // Tools from outside SEEKER (MCP servers), added and removed while it runs.
    this.extraTools = [];
    // Names of tools this agent may not use (a helper agent cannot start helpers or question the user).
    this.withheld = new Set();
    // Set by the interface: askUser({ question, options }) → answer | null.
    this.hooks = {};
    this.helper = null;
    // Helpers running side by side (see #delegateMany).
    this.helpers = new Set();
    this.steers = []; // instructions sent while a turn runs, waiting for its next step
    // The conversation's file on disk, set by the interface; session_search leaves it out of its results.
    this.session = null;
    // Per-message scratch space for tools (a checkpoint taken, memory attempts that failed).
    this.turn = {};
    // Skills written during this session: named to the model with the next message, since the prompt is not rebuilt.
    this.newSkills = [];
    // The unattended review: counters towards the next one, the one running now, and whether this agent is one.
    this.turnsSinceMemory = 0;
    this.stepsSinceSkill = 0;
    this.reviewer = null;
    this.review = false;
    this.allowReview = true;
    // The user's shell hooks (hooks.mjs), set by the interface when any are configured.
    this.shellHooks = null;
    // While a backup model is standing in: { provider, model, info, until } of the one to go back to.
    this.primary = null;
    this.setModel(config.model, info, provider);
  }

  setModel(model, info, provider = this.provider) {
    this.model = model;
    this.provider = provider;
    this.info = info;
    this.caps = { tools: Boolean(info.tools), thinking: Boolean(info.thinking), vision: Boolean(info.vision) };
    this.skills = loadSkills(this.cwd, this.config.skillDirs, { bundled: this.config.bundledSkills !== false });
    const { prompt, instructionFiles, contextFiles } = buildSystemPrompt({ cwd: this.cwd, model, skills: this.skills, skillDirs: this.config.skillDirs, provider, contextLimit: this.contextLimit() });
    this.system = prompt;
    this.instructionFiles = instructionFiles;
    this.hints = new SubdirectoryHints(this.cwd, contextFiles);
    this.toolSize = null;
  }

  /** The tool definitions as this model is sent them. */
  #specs() {
    // A local model reads its prompt at tens of tokens a second, so every definition it is sent costs time as well as room.
    return toolSpecs(this.tools(), { compact: Boolean(this.provider.local) || this.contextLimit() < COMPACT_TOOLS_BELOW });
  }

  /** Re-reads skills and instruction files from disk. */
  reload() {
    this.setModel(this.model, this.info);
  }

  /** Tokens the current model can take in. Ollama's is a setting; cloud models report or imply theirs. */
  contextLimit() {
    if (this.provider.kind === 'ollama') return this.config.numCtx;
    return this.config.providers?.[this.provider.id]?.contextWindow ?? this.info.context ?? this.provider.context ?? 128_000;
  }

  /** Every tool on offer right now. */
  tools() {
    return [...TOOLS, ...this.extraTools].filter((t) => !this.withheld.has(t.name));
  }

  setExtraTools(tools) {
    this.extraTools = tools;
  }

  /**
   * Whether an instruction can be handed to the model while a turn is running. It can where this loop asks the
   * model again after every step. A provider that runs its own tools works through the whole turn in one
   * request, so there is no step between which to put it.
   */
  get canSteer() {
    return Boolean(this.caps.tools) && !this.provider.ownTools;
  }

  /**
   * Holds an instruction for the turn in progress; the model reads it before its next step.
   * @param {() => void} [onDelivered]  called when it is put in front of the model
   * @returns {boolean} false when it cannot be taken: no turn is running, or this provider cannot be steered
   */
  steer(text, onDelivered = () => {}) {
    if (!this.controller || this.controller.signal.aborted || !this.canSteer) return false;
    this.steers.push({ text, onDelivered });
    return true;
  }

  /** Instructions that were held for a turn and never reached the model, because it was stopped or failed first. */
  takeSteers() {
    return this.steers.splice(0).map((s) => s.text);
  }

  /** Puts what is held in front of the model. True if there was anything. */
  #deliverSteers() {
    if (!this.steers.length) return false;
    for (const { text, onDelivered } of this.steers.splice(0)) {
      this.messages.push({ role: 'user', content: `[Sent by the user while you were working — take it into account from here on]\n${text}` });
      onDelivered();
    }
    return true;
  }

  interrupt() {
    this.helper?.interrupt();
    for (const helper of this.helpers) helper.interrupt();
    this.interrupted = true;
    this.controller?.abort();
  }

  get busy() {
    return this.controller !== null;
  }

  #estimateTokens() {
    // The tool definitions travel with every request too.
    let tools = 0;
    if (this.caps.tools && !this.provider.ownTools) {
      const list = this.tools();
      if (this.toolSize?.count !== list.length) this.toolSize = { count: list.length, chars: JSON.stringify(this.#specs()).length };
      tools = this.toolSize.chars;
    }
    const chars = this.system.length + tools + this.messages.reduce((n, m) => n + messageChars(m), 0);
    return Math.ceil(chars / CHARS_PER_TOKEN);
  }

  /**
   * The messages to hand to the summariser, cut down until they fit its context.
   * A request larger than the context is truncated from the start by the server,
   * which is exactly where the user's request sits.
   */
  #fitForSummary(messages, promptChars) {
    const budget = Math.max(2000, this.contextLimit() * SUMMARY_FILL * CHARS_PER_TOKEN - this.system.length - promptChars);
    const size = (list) => list.reduce((n, m) => n + JSON.stringify(m).length, 0);
    // A summary is text about text; the pictures themselves are not sent along.
    messages = messages.map((m) => withoutImages(m, 'was shown here'));
    if (size(messages) <= budget) return messages;
    // Tool output is the bulk; each result keeps its start and end.
    const results = messages.filter((m) => m.role === 'tool').length || 1;
    const fixed = size(messages.filter((m) => m.role !== 'tool'));
    // 200 characters per result are set aside for its JSON wrapping and the "omitted" marker.
    let each = Math.max(300, Math.floor((budget - fixed) / results) - 200);
    const cut = () => messages.map((m) => (m.role === 'tool' ? { ...m, content: clip(m.content, each) } : m));
    let fitted = cut();
    // Sizes are measured as JSON, where a newline or quote counts double, so a first cut can still be over.
    while (each > 300 && size(fitted) > budget) {
      each = Math.max(300, Math.floor(each * 0.85));
      fitted = cut();
    }
    // Still too big (a long chat rather than big outputs): let go of the oldest messages.
    while (fitted.length > 2 && size(fitted) > budget) fitted = fitted.slice(1);
    while (fitted.length && fitted[0].role === 'tool') fitted = fitted.slice(1);
    return fitted;
  }

  /** Tokens in play for the next request: the model's own count, or our estimate if history grew since. */
  contextTokens() {
    return Math.max(this.usedTokens, this.#estimateTokens());
  }

  #request(messages, { tools, think, signal }) {
    return this.provider.chat({
      model: this.model,
      system: this.system,
      // Pictures already in the history are kept from a model that cannot take them (after a /model switch).
      messages: this.caps.vision ? messages : messages.map((m) => withoutImages(m, 'not shown, the current model cannot see images')),
      // A provider that brings its own tools (Claude Code) is not offered SEEKER's as well.
      tools: tools && this.caps.tools && !this.provider.ownTools ? this.#specs() : undefined,
      think: this.caps.thinking ? think : undefined,
      signal,
      cwd: this.cwd,
      hooks: { permission: (request) => this.#externalPermission(request) },
    });
  }

  /**
   * One model reply. A request that fails before any of the answer was shown is recovered
   * where possible: another API key, a wait and retry, or a backup provider (see failover.mjs).
   */
  async #streamOnce(signal) {
    for (let attempt = 0; ; ) {
      try {
        return await this.#streamAttempt(signal);
      } catch (err) {
        // Text already on screen cannot be taken back, so that reply is not silently started over.
        if (signal.aborted || err.partial) throw err;
        const move = await this.#recover(err, attempt, signal);
        if (!move || signal.aborted) throw err;
        attempt = move === 'retry' ? attempt + 1 : 0;
      }
    }
  }

  /** @returns {Promise<'retry'|'rotate'|'fallback'|null>} what was done about a failed request, or null if nothing can be */
  async #recover(err, attempt, signal) {
    const { ui } = this;
    const pooled = this.provider.kind === 'openai' || this.provider.kind === 'anthropic';
    const pool = pooled ? keyPool(this.provider, this.config) : null;
    const primary = this.primary ?? { provider: this.provider, model: this.model };
    const chain = fallbackChain(this.config).filter((f) => !(f.provider === primary.provider.id && f.model === primary.model));
    const tried = (this.turn.fallbacksTried ??= new Set());
    const candidates = chain.filter((f) => !tried.has(`${f.provider}/${f.model}`) && !(f.provider === this.provider.id && f.model === this.model));
    const move = decide({ err, attempt, pool, hasFallback: candidates.length > 0, local: Boolean(this.provider.local) });
    const why = reasonText(move.kind);

    if (move.action === 'retry') {
      ui.notice(`  ⏳ ${this.provider.label} ${why} — retrying in ${Math.max(1, Math.round(move.delayMs / 1000))}s (attempt ${attempt + 1})`);
      await sleep(move.delayMs, signal);
      return 'retry';
    }
    if (move.action === 'rotate') {
      ui.notice(`  ⚿ ${this.provider.label} ${why} for this API key — switching to the next one`);
      return 'rotate';
    }
    if (move.action !== 'fallback') return null;

    for (const next of candidates) {
      tried.add(`${next.provider}/${next.model}`);
      try {
        const provider = createProvider(next.provider, this.config);
        const info = await provider.describe(next.model);
        const from = `${this.model} via ${this.provider.label}`;
        if (!this.primary) {
          // A throttled or empty account is left alone for a while; anything else is tried again next message.
          const rest = move.kind === 'rate_limit' || move.kind === 'billing' ? Math.min(60_000 * 2 ** (this.primaryBackoffs = (this.primaryBackoffs ?? 0) + 1), 4 * 3_600_000) : 0;
          this.primary = { provider: this.provider, model: this.model, info: this.info, until: Date.now() + rest };
        }
        this.setModel(next.model, info, provider);
        this.usedTokens = 0;
        ui.warn(`  ⚠ Model fallback: ${from} unavailable (${why}); using ${next.model} via ${provider.label}.`);
        return 'fallback';
      } catch (failure) {
        ui.notice(`  (backup ${next.model} via ${next.provider} could not be used: ${failure.message})`);
      }
    }
    return null;
  }

  /** At the start of a message: go back to the user's own model if a backup was standing in and its rest is over. */
  #restorePrimary() {
    if (!this.primary || Date.now() < this.primary.until) return;
    const { provider, model, info } = this.primary;
    const backup = `${this.model} via ${this.provider.label}`;
    this.primary = null;
    this.setModel(model, info, provider);
    this.usedTokens = 0;
    this.ui.notice(`  ✓ Primary model restored: ${model} via ${provider.label}; fallback ${backup} is no longer active.`);
  }

  async #streamAttempt(signal) {
    const { ui } = this;
    const answer = ui.answerStream();
    let content = '';
    let phase = null;
    let blocks = null;
    const toolCalls = [];
    ui.startSpinner(this.usedTokens || this.provider.kind !== 'ollama' ? 'Working' : 'Loading model', undefined, 'purple');
    try {
      for await (const chunk of this.#request(this.messages, { tools: true, think: this.config.think, signal })) {
        if (chunk.activity) {
          if (phase === 'think') ui.thinkEnd();
          phase = 'tool';
          this.#externalActivity(chunk.activity);
          continue;
        }
        const msg = chunk.message || {};
        if (msg.thinking) {
          if (phase !== 'think') {
            ui.thinkStart();
            phase = 'think';
          }
          ui.thinkChunk(msg.thinking);
        }
        if (msg.content) {
          if (phase === 'think') ui.thinkEnd();
          if (phase !== 'content') ui.answerStart();
          phase = 'content';
          content += msg.content;
          answer.push(msg.content);
        }
        if (msg.tool_calls?.length) toolCalls.push(...msg.tool_calls);
        if (msg.blocks) blocks = msg.blocks;
        if (chunk.done) {
          this.usedTokens = (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0);
          if (chunk.prompt_eval_count || chunk.eval_count) {
            const input = chunk.prompt_eval_count || 0;
            const output = chunk.eval_count || 0;
            this.usage = { input, output, totalInput: this.usage.totalInput + input, totalOutput: this.usage.totalOutput + output, known: true };
            // The ledger on this machine. A provider that ran several steps in one reply says what they added up to.
            recordUsage(chunk.spent ?? { input, output });
          }
          this.lastStats = {
            tokensPerSecond: chunk.eval_duration ? (chunk.eval_count / chunk.eval_duration) * 1e9 : 0,
          };
        }
      }
    } catch (err) {
      err.partial = content;
      throw err;
    } finally {
      ui.stopSpinner();
      if (phase === 'think') ui.thinkEnd();
      answer.flush();
      // A provider's own tool that never reported back (the stream broke, the turn was stopped) would otherwise stay "running".
      for (const { about, finished } of this.external.values()) {
        if (finished) continue;
        ui.toolStart(about.verbs[0], about.verbs[1], about.summary);
        ui.toolFail('interrupted');
      }
      this.external.clear();
    }
    if (!toolCalls.length && content.includes('<tool_call>')) toolCalls.push(...parseTextToolCalls(content));
    // Every call needs an id so its result can be matched to it, whichever provider reads the history next.
    for (const call of toolCalls) call.id ||= `call_${(this.callCount = (this.callCount ?? 0) + 1)}_${Date.now().toString(36)}`;
    return { content, toolCalls, blocks };
  }

  /** Shows a tool the provider runs itself: a spinner when it starts, a finished line when it ends. */
  #externalActivity({ kind, id, name, input, ok, output }) {
    const { ui } = this;
    if (kind === 'start') {
      if (this.external.has(id)) return; // already on screen because approval was asked
      const about = describeExternal(name, input, this.cwd);
      this.external.set(id, { about, row: null });
      ui.toolStart(about.verbs[0], about.verbs[1], about.summary);
      return;
    }
    const entry = this.external.get(id);
    if (!entry || entry.finished) return;
    const { about } = entry;
    // Several tools can run at once, so the line may no longer be the current one.
    if (!entry.row || ui.tool !== entry.row) ui.toolStart(about.verbs[0], about.verbs[1], about.summary);
    if (ok) ui.toolDone(about.note?.(output), about.display?.(output), about.displayLines);
    else ui.toolFail(output.trim() || 'failed');
    this.external.delete(id);
    ui.startSpinner('Working', undefined, 'purple');
  }

  /** Asked by a provider before one of its own tools does something that needs approval. */
  async #externalPermission({ id, name, input }) {
    const { ui } = this;
    const about = describeExternal(name, input, this.cwd);
    const entry = { about, row: null };
    this.external.set(id, entry);
    ui.toolStart(about.verbs[0], about.verbs[1], about.summary);
    entry.row = ui.tool;
    if (about.diff) ui.diff(about.diff);
    const tool = { name, risk: about.risk ?? 'other', targetPath: () => path.resolve(this.cwd, about.path ?? '.') };
    const verdict = await this.permissions.check(tool, { command: about.command, url: about.url });
    if (!verdict.ok) {
      ui.toolFail('not run');
      entry.finished = true;
      return verdict;
    }
    ui.toolRunning();
    return verdict;
  }

  /**
   * Runs a helper agent on `prompt` and returns its final report. The helper has
   * its own empty conversation and the same model, tools and approval rules; its
   * steps appear in the tree, its thinking and answer text do not.
   */
  async #delegate(prompt, label) {
    const { ui } = this;
    ui.toolOpen(); // keep the "Delegating …" line; the helper's steps follow under it
    const pass = new Set(['toolStart', 'toolOpen', 'toolRunning', 'toolDone', 'toolFail', 'toolLine', 'diff', 'startSpinner', 'stopSpinner', 'warn', 'error', 'ensureNewline']);
    const quiet = new Proxy(
      {},
      {
        get: (_, key) => {
          if (key === 'answerStream') return () => ({ push() {}, flush() {} });
          if (key === 'tool') return ui.tool;
          if (key === 'c') return ui.c;
          return pass.has(key) ? (...args) => ui[key](...args) : () => {};
        },
      },
    );
    const helper = new Agent({ config: { ...this.config, maxSteps: Math.min(this.config.maxSteps, 30) }, ui: quiet, permissions: this.permissions, provider: this.provider, info: this.info, cwd: this.cwd });
    helper.extraTools = this.extraTools;
    // A helper never gets a tool its parent was denied (API server, scheduled job), and does not write memory, skills or jobs.
    helper.withheld = new Set([...this.withheld, 'task', 'ask_user', 'memory', 'skill_manage', 'cronjob_manage']);
    helper.parent = this;
    helper.shellHooks = this.shellHooks;
    helper.allowReview = false; // the conversation that learns is the user's, not a helper's
    this.helper = helper;
    try {
      await helper.runTurn(prompt);
    } finally {
      this.helper = null;
    }
    const report = [...helper.messages].reverse().find((m) => m.role === 'assistant' && m.content?.trim())?.content ?? '';
    // The helper's lines replaced this one as the current step; restore it so it can be closed.
    ui.toolStart('Delegating', 'Delegated', label);
    return report.trim();
  }

  /**
   * Runs several helpers side by side, each on its own task with its own empty conversation.
   * Their steps are not drawn as a tree (the lines would interleave); each reports one line when
   * it does something that changes the machine and one when it is done. Approval questions are
   * put one at a time.
   * @param {{ description: string, prompt: string }[]} tasks
   * @returns {Promise<{ description: string, status: 'completed'|'interrupted'|'failed', report: string }[]>}
   */
  async #delegateMany(tasks) {
    const { ui } = this;
    ui.toolOpen();
    let queue = Promise.resolve();
    const run = async (task, index) => {
      const tag = `helper ${index + 1}`;
      const quiet = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'c' ? ui.c : key === 'error' || key === 'warn' ? (text) => ui.toolLine(ui.c.dim(`${tag}: ${String(text).trim()}`)) : () => {}) });
      // One question on screen at a time, and it says whose it is.
      const permissions = {
        mayLearn: () => false,
        check: (tool, args) => {
          if (tool.risk === 'read') return Promise.resolve({ ok: true });
          const asked = queue.then(() => {
            ui.toolLine(`${ui.c.dim(`${tag}:`)} ${tool.verbs?.[0] ?? tool.name} ${String(tool.summary?.(args) ?? '').slice(0, 120)}`);
            return this.permissions.check(tool, args);
          });
          queue = asked.catch(() => {});
          return asked;
        },
      };
      const helper = new Agent({ config: { ...this.config, maxSteps: Math.min(this.config.maxSteps, 30) }, ui: quiet, permissions, provider: this.provider, info: this.info, cwd: this.cwd });
      helper.extraTools = this.extraTools;
      helper.withheld = new Set([...this.withheld, 'task', 'ask_user', 'memory', 'skill_manage', 'cronjob_manage']);
      helper.parent = this;
      helper.shellHooks = this.shellHooks;
      helper.allowReview = false;
      this.helpers.add(helper);
      const started = Date.now();
      let status = 'completed';
      try {
        await helper.runTurn(task.prompt);
        if (helper.interrupted) status = 'interrupted';
      } catch {
        status = 'failed';
      } finally {
        this.helpers.delete(helper);
      }
      const report = ([...helper.messages].reverse().find((m) => m.role === 'assistant' && m.content?.trim())?.content ?? '').trim();
      ui.toolLine(`${status === 'completed' ? ui.c.green('✓') : ui.c.yellow('!')} ${tag} ${status} in ${Math.round((Date.now() - started) / 1000)}s — ${task.description}`);
      return { description: task.description, status: report ? status : status === 'completed' ? 'failed' : status, report };
    };
    const results = await Promise.all(tasks.map(run));
    ui.toolStart('Delegating', 'Delegated', `${tasks.length} tasks in parallel`);
    return results;
  }

  async #runTool(call, signal) {
    const { ui } = this;
    const name = call.function?.name ?? '';
    let args = call.function?.arguments ?? {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    const available = this.tools();
    const tool = available.find((t) => t.name === name);
    if (!tool) {
      ui.toolStart('Calling', 'Called', name || '?');
      ui.toolFail('unknown tool');
      return `Error: unknown tool "${name}". Available tools: ${available.map((t) => t.name).join(', ')}.`;
    }
    const ctx = {
      cwd: this.cwd,
      signal,
      state: this.state,
      skills: this.skills,
      vision: this.caps.vision,
      askUser: this.withheld.has('ask_user') ? null : this.hooks.askUser,
      delegate: this.withheld.has('task') ? null : (prompt, label) => this.#delegate(prompt, label),
      delegateMany: this.withheld.has('task') ? null : (tasks) => this.#delegateMany(tasks),
      turn: this.turn,
      review: this.review,
      cronRun: this.hooks.cronRun ?? null,
      cronChanged: this.hooks.cronChanged ?? null,
      sessionFile: (this.parent ?? this).session?.file ?? null,
      skillsChanged: (created) => (this.parent ?? this).#skillsChanged(created),
    };
    ui.toolStart(tool.verbs[0], tool.verbs[1], tool.summary(args));
    const invalid = validateArgs(tool, args);
    if (invalid) {
      ui.toolFail(invalid);
      return `Error: ${invalid}. Call ${name} again with valid arguments.`;
    }
    try {
      if (this.shellHooks) {
        // The user's own hook sees the call first: it may veto it or adjust its arguments.
        const hooked = await this.shellHooks.run('pre_tool_call', { toolName: name, toolInput: args, extra: { tool_call_id: call.id } });
        if (hooked.block) {
          ui.toolFail('blocked by a hook');
          return `Blocked by the user's hook: ${hooked.block} Do not retry it unchanged.`;
        }
        if (hooked.args) args = hooked.args;
      }
      if (tool.preview) ui.diff(tool.preview(args, ctx));
      const verdict = await this.permissions.check(tool, args);
      if (!verdict.ok) {
        ui.toolFail('not run');
        return verdict.reason;
      }
      ui.toolRunning();
      await this.#checkpoint(tool, args);
      const result = await tool.run(args, ctx);
      this.shellHooks?.run('post_tool_call', { toolName: name, toolInput: args, extra: { tool_call_id: call.id, result: String(result.output ?? '').slice(0, 4000) } }).catch(() => {});
      if (name === 'memory') this.turnsSinceMemory = 0;
      if (name === 'skill_manage') this.stepsSinceSkill = 0;
      const maxChars = Math.min(24_000, Math.floor(this.contextLimit() * 0.25 * CHARS_PER_TOKEN));
      ui.toolDone(result.note, result.display, result.displayLines);
      // Instructions kept in the folder this call first worked in come along with its result.
      const output = clip(result.output, maxChars) + this.hints.collect(name, args);
      return result.images?.length ? { content: output, images: result.images } : output;
    } catch (err) {
      const message = err instanceof ToolError ? err.message : `${err.name}: ${err.message}`;
      ui.toolFail(message);
      return `Error: ${message}`;
    }
  }

  /**
   * Records the working folder before the first change of a message — a file written or edited,
   * or a shell command that can destroy files — so /rollback can undo it.
   */
  async #checkpoint(tool, args) {
    if (this.config.checkpoints === false || this.turn.checkpointed) return;
    if (tool.risk !== 'write' && tool.name !== 'bash') return;
    try {
      const checkpoints = await import('./checkpoints.mjs');
      if (tool.risk !== 'write' && !checkpoints.isDestructiveCommand(String(args.command ?? ''))) return;
      this.turn.checkpointed = true;
      await checkpoints.snapshot(this.cwd, `before ${tool.name}: ${String(tool.summary(args) ?? '').slice(0, 80)}`);
    } catch {
      // A snapshot that cannot be taken never stops the work.
    }
  }

  /** After skill_manage changed something: the skill tool sees it at once; the model is told with the next message. */
  #skillsChanged(created = []) {
    this.skills = loadSkills(this.cwd, this.config.skillDirs, { bundled: this.config.bundledSkills !== false });
    this.newSkills.push(...created);
    this.stepsSinceSkill = 0;
  }

  /**
   * The unattended review: after a reply, a helper with the same conversation and only the memory
   * and skill tools decides whether anything in it is worth keeping. It runs while the user reads
   * the answer and is dropped the moment they send the next message.
   */
  async #reviewTurn() {
    const memory = this.turnsSinceMemory >= (this.config.memoryReviewEvery ?? MEMORY_REVIEW_EVERY_TURNS);
    const skills = this.stepsSinceSkill >= (this.config.skillReviewEvery ?? SKILL_REVIEW_EVERY_STEPS);
    if (!memory && !skills) return;
    if (!this.allowReview || this.review || this.config.review === false || !this.caps.tools || this.provider.ownTools) return;
    // Nobody is watching this pass, so it may only save what the user has already agreed may be
    // saved without asking (autoLearn, --yolo, or "always" for that tool in this session).
    const mayLearn = (name) => Boolean(this.permissions.mayLearn?.(name));
    if (!(memory && mayLearn('memory')) && !(skills && mayLearn('skill_manage'))) return;
    const unattended = { check: async (tool) => (tool.risk === 'read' || mayLearn(tool.name) ? { ok: true } : { ok: false, reason: 'Not allowed in an unattended review.' }) };
    const { reviewPrompt, reviewOutcome } = await import('./review.mjs');
    const silent = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'c' ? this.ui.c : () => {}) });
    const helper = new Agent({ config: { ...this.config, maxSteps: REVIEW_STEPS, checkpoints: false }, ui: silent, permissions: unattended, provider: this.provider, info: this.info, cwd: this.cwd });
    helper.review = true;
    helper.parent = this;
    helper.system = this.system; // the same prompt, so a provider's cache of it is reused
    helper.withheld = new Set(TOOLS.map((t) => t.name).filter((name) => !REVIEW_TOOLS.has(name) || (name === 'memory' && !(memory && mayLearn('memory'))) || (name === 'skill_manage' && !mayLearn('skill_manage'))));
    // The conversation as it stands, without pictures; a long one is replayed from its recent part only.
    let replay = this.messages.map(({ blocks, ...m }) => withoutImages(m, 'was shown here'));
    const room = this.contextLimit() * 0.5 * CHARS_PER_TOKEN;
    while (replay.length > 2 && replay.reduce((n, m) => n + messageChars(m), 0) > room) replay = replay.slice(1);
    while (replay.length && replay[0].role !== 'user') replay = replay.slice(1);
    if (!replay.length) return;
    helper.messages = replay;
    const before = replay.length;
    this.reviewer = helper;
    try {
      await helper.runTurn(reviewPrompt({ memory: memory && mayLearn('memory'), skills: skills && mayLearn('skill_manage') }));
    } finally {
      if (this.reviewer === helper) this.reviewer = null;
    }
    if (helper.interrupted) return; // the counters stay as they are; the next reply tries again
    if (memory) this.turnsSinceMemory = 0;
    if (skills) this.stepsSinceSkill = 0;
    const learned = reviewOutcome(helper.messages.slice(before));
    if (learned) this.ui.notice(`  ✎ ${learned}`);
  }

  /**
   * One reply from the model to a question of SEEKER's own (a judge's verdict, a title), outside the
   * conversation: no history, no tools, no thinking.
   * @returns {Promise<string>}
   */
  async ask(system, user, { signal } = {}) {
    let text = '';
    const stream = this.provider.chat({ model: this.model, system, messages: [{ role: 'user', content: user }], tools: undefined, think: this.caps.thinking ? false : undefined, signal, cwd: this.cwd, hooks: {} });
    for await (const chunk of stream) text += chunk.message?.content || '';
    return text;
  }

  /** Replaces the history with a model-written summary. Returns false if there was nothing to do. */
  async compact({ midTask = false } = {}) {
    if (this.messages.length < 2) return false;
    const { ui } = this;
    const controller = this.controller ?? new AbortController();

    // The newest messages stay as they are; only what came before them is summarised.
    const room = this.contextLimit() * KEEP_RECENT * CHARS_PER_TOKEN;
    let cut = this.messages.length;
    let size = 0;
    while (cut > 0 && size + messageChars(this.messages[cut - 1]) <= room) size += messageChars(this.messages[--cut]);
    // A tool result cannot open the kept part: it belongs to the call just before it.
    while (cut < this.messages.length && this.messages[cut].role === 'tool') cut++;
    if (cut < 2) cut = this.messages.length; // nothing worth summarising would be left out — summarise it all
    const older = this.messages.slice(0, cut);
    const recent = this.messages.slice(cut).map(({ blocks, ...message }) => message); // replayed reasoning is only valid in an unedited history

    // The newest real request; after an earlier summary it is the one that summary carried along.
    const latest = [...this.messages].reverse().find((m) => m.role === 'user');
    const task = (latest?.compacted ? latest.task : latest?.content) ?? '';
    ui.startSpinner('Summarising the conversation', undefined, 'purple');
    let summary = '';
    try {
      const prompt = compactPrompt(task);
      const request = [...this.#fitForSummary(older, prompt.length), { role: 'user', content: prompt }];
      for await (const chunk of this.#request(request, { tools: false, think: false, signal: controller.signal })) {
        summary += chunk.message?.content || '';
      }
    } finally {
      ui.stopSpinner();
    }
    // The history is replaced even if no summary came back: carrying on with a context that
    // overflows would silently drop the oldest text, the user's request first.
    if (!summary.trim()) summary = '(No summary could be written. Nothing is known about the earlier steps beyond the request below.)';

    // The request itself is carried over word for word, so the task survives a weak summary.
    const request = task && !recent.some((m) => m.content === task) ? `\n\nThe user's request, word for word:\n<request>\n${task}\n</request>` : '';
    const note = `[The earlier conversation was replaced by this summary to save context.]\n\n${summary.trim()}${request}\n\n${AFTER_COMPACT}`;
    const head = { role: 'user', content: midTask && !recent.length ? `${note}\n\nContinue the task from where it stopped.` : note, compacted: true, task };
    this.messages = recent.length || midTask ? [head, ...recent] : [head, { role: 'assistant', content: 'Understood. I have the context and am ready to continue.' }];
    this.usedTokens = 0;
    ui.notice(`  ✂ conversation summarised (now ~${Math.round(this.#estimateTokens() / 100) / 10}k tokens)`);
    return true;
  }

  /**
   * The images of a user message, added to it so the model sees them: the image files the text
   * names, and those that came with it from another device (`sent`).
   */
  #attachImages(message, sent) {
    const { ui } = this;
    if (this.provider.ownTools) {
      // Claude Code opens files with its own tools, so it is handed files.
      if (!sent.length) return;
      try {
        const files = saveImages(sent);
        message.content += `\n\nAttached image${files.length > 1 ? 's' : ''}, to be read with your own tools:\n${files.join('\n')}`;
      } catch (err) {
        ui.warn(`  ⚠ The attached image${sent.length > 1 ? 's' : ''} could not be saved: ${err.message}.`);
      }
      return;
    }
    const files = imagePathsIn(message.content, this.cwd);
    if (!files.length && !sent.length) return;
    if (!this.caps.vision) {
      const what = files.length + sent.length > 1 ? 'the images were' : `${sent[0]?.name ?? path.basename(files[0])} was`;
      ui.warn(`  ⚠ ${this.model} cannot see images, so ${what} not attached. Switch to a vision model with /model.`);
      return;
    }
    const images = sent.map(({ name, mime, data }) => ({ name, mime, data }));
    for (const file of files) {
      try {
        const { bytes, ...image } = loadImage(file);
        images.push(image);
        ui.notice(`  ▣ attached ${image.name} (${kilobytes(bytes)})`);
      } catch (err) {
        ui.warn(`  ⚠ ${err.message}.`);
      }
    }
    if (images.length) message.images = images.slice(0, MAX_IMAGES_PER_MESSAGE);
  }

  /**
   * Runs one user message to completion. Never throws: failures are shown and the history stays valid.
   * @param {string} userText
   * @param {{ images?: { name: string, mime: string, data: string }[], references?: boolean }} [extra]  images sent along with the text;
   *   `references` expands @file:/@url:… and is only for text the user typed — a prompt written by a model, a job or an API client
   *   must not be able to read files or fetch pages without the usual approval.
   */
  async runTurn(userText, { images: sent = [], references = false } = {}) {
    const { ui } = this;
    // The model is the user's again: a review still running from the last reply is dropped.
    this.reviewer?.interrupt();
    this.controller = new AbortController();
    this.interrupted = false;
    const { signal } = this.controller;
    this.turn = {};
    this.#restorePrimary();
    const message = { role: 'user', content: userText };
    if (this.shellHooks && !this.review && !this.parent) {
      const hooked = await this.shellHooks.run('pre_llm_call', { extra: { user_message: userText } });
      if (hooked.block) {
        this.controller = null;
        ui.warn(`  ⚠ Not sent — blocked by your hook: ${hooked.block}`);
        return;
      }
      if (hooked.context) message.content += `\n\n${hooked.context}`;
    }
    if (references && HAS_REFERENCE.test(userText)) await this.#attachReferences(message, signal);
    this.#attachImages(message, sent);
    if (this.newSkills.length && !this.provider.ownTools) {
      const fresh = this.skills.filter((s) => this.newSkills.includes(s.name));
      if (fresh.length) message.content += `\n\n[Skills added since this session started, not yet in your skill list — load one with the skill tool when it fits: ${fresh.map((s) => `${s.name} (${s.description})`).join('; ')}]`;
      this.newSkills = [];
    }
    this.messages.push(message);
    if (!this.review) this.turnsSinceMemory++;
    ui.turnStart();
    let compactions = 0;
    try {
      for (let step = 0; ; step++) {
        if (step >= this.config.maxSteps) {
          ui.warn(`  Stopped after ${this.config.maxSteps} steps. Say "continue" to keep going.`);
          break;
        }
        if (this.contextTokens() > this.contextLimit() * COMPACT_AT) {
          if (compactions >= MAX_COMPACTIONS_PER_TURN) {
            ui.warn('  This task needs more context than the model has: it filled up again right after being summarised.\n  Raise the context with /ctx, switch to a larger model with /model, or ask for the work in smaller parts.');
            break;
          }
          if (await this.compact({ midTask: true })) compactions++;
        }

        this.#deliverSteers();
        const { content, toolCalls, blocks } = await this.#streamOnce(signal);
        this.stepsSinceSkill++;
        const message = { role: 'assistant', content };
        if (toolCalls.length) message.tool_calls = toolCalls;
        if (blocks) message.blocks = blocks;
        this.messages.push(message);

        if (!toolCalls.length) {
          // An instruction that arrived while the model was writing its last words is answered before the turn ends.
          if (this.steers.length && !signal.aborted) continue;
          if (!content.trim()) ui.notice('  (the model returned nothing — try again or rephrase)');
          break;
        }
        for (const call of toolCalls) {
          const result = signal.aborted ? 'Not run: the user interrupted.' : await this.#runTool(call, signal);
          const output = typeof result === 'string' ? { content: result } : result;
          this.messages.push({ role: 'tool', tool_name: call.function?.name ?? '', tool_call_id: call.id, ...output });
        }
        if (signal.aborted) break;
      }
      if (signal.aborted) ui.warn('  ⏹ cancelled');
    } catch (err) {
      if (signal.aborted) {
        if (err.partial) this.messages.push({ role: 'assistant', content: `${err.partial}\n[interrupted by the user]` });
        ui.warn('  ⏹ cancelled');
      } else {
        ui.error(`  Error: ${err.message}`);
      }
    } finally {
      this.controller = null;
      ui.ensureNewline();
    }
    if (this.shellHooks && !this.review && !this.parent && !signal.aborted) this.shellHooks.run('post_llm_call', { extra: { response: this.messages.at(-1)?.content ?? '' } }).catch(() => {});
    // Not awaited: the user has their answer and can type; the review works behind it.
    if (!signal.aborted) this.reviewing = this.#reviewTurn().catch(() => {});
  }

  /** Attaches what the `@file:` / `@diff` / `@url:` words in a message point to. */
  async #attachReferences(message, signal) {
    const { ui } = this;
    try {
      const { expandReferences } = await import('./references.mjs');
      const { fetchPage } = await import('./tools.mjs');
      const result = await expandReferences(message.content, { cwd: this.cwd, contextLimit: this.contextLimit(), fetchPage, signal });
      message.content = result.text;
      if (result.attached.length) ui.notice(`  ▣ attached ${result.attached.join(' ')}`);
      for (const warning of result.warnings) ui.warn(`  ⚠ ${warning}`);
    } catch (err) {
      ui.warn(`  ⚠ The @ references could not be attached: ${err.message}`);
    }
  }
}
