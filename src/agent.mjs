// The agent loop: send the conversation to the model, run whatever tools it
// asks for, feed the results back, repeat until it answers without a tool call.
import { MAX_HELPERS, TOOLS, ToolError, clip, toolSpecs, validateArgs } from './tools.mjs';
import path from 'node:path';
import { describeExternal } from './external-tools.mjs';
import { SubdirectoryHints } from './context-files.mjs';
import { decide, fallbackChain, reasonText } from './failover.mjs';
import { PLAN_NOTE } from './permissions.mjs';
import { findSecrets, keyHint, redactSecrets } from './secrets.mjs';
import { buildSystemPrompt } from './prompt.mjs';
import { createProvider, keyPool, providerDefs } from './providers.mjs';
import { loadSkills } from './skills.mjs';
import { backendOf } from './backend.mjs';
import { loadAgents, roleText } from './agents.mjs';
import { recordUsage } from './usage.mjs';
import { MAX_IMAGES_PER_MESSAGE, draggedFilesIn, imagePathsIn, kilobytes, loadImage, messageChars, saveImages, withoutImages } from './images.mjs';

// The answers offered when a typed message holds an API key (see #checkKeys).
export const MASK_KEYS = 'Mask the key';
export const SEND_KEYS = 'Send it as it is';
export const CANCEL_SEND = "Don't send";

const CHARS_PER_TOKEN = 3.5;
const COMPACT_AT = 0.8;

// Share of the context the newest messages may keep, word for word, across a summary.
const KEEP_RECENT = 0.3;
// How full the summariser's own context may get; the rest is room for the summary it writes.
const SUMMARY_FILL = 0.7;
// A turn that needs summarising this often is working on more than the context can hold.
const MAX_COMPACTIONS_PER_TURN = 3;
// How long a provider keeps a conversation cached when it does not say (most keep it about this long).
const CACHE_MINUTES = 5;
// Below this many tokens of context (and always on a local model), tools with a short description send that one.
const COMPACT_TOOLS_BELOW = 64_000;

// Helpers a single `task` call may run side by side.
export const MAX_PARALLEL_HELPERS = 3;

// The unattended review after a turn (see #review): how often, and what it may use.
const MEMORY_REVIEW_EVERY_TURNS = 10;
const SKILL_REVIEW_EVERY_STEPS = 10;
const REVIEW_STEPS = 16;
// The most of the conversation a review reads. It is sent in a form no cache holds, at full price.
const REVIEW_REPLAY_TOKENS = 24_000;
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
    this.externalAsks = Promise.resolve(); // approvals for a provider's own tools, one after another
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
    // Helpers with a role of their own (src/agents.mjs). A helper has none: it cannot start another.
    this.agents = this.config.agents === false ? [] : loadAgents(this.cwd);
    const { prompt, instructionFiles, contextFiles } = buildSystemPrompt({ cwd: this.cwd, model, skills: this.skills, skillDirs: this.config.skillDirs, agents: this.agents, provider, contextLimit: this.contextLimit(), backend: this.#backend(), remote: Boolean(this.permissions?.daemonPid) });
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

  /** Where shell commands run: null for this machine. */
  #backend() {
    try {
      return backendOf(this.config, this.cwd);
    } catch (err) {
      return { kind: 'invalid', error: err.message };
    }
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
    // Nor is the model's replayed reasoning: it is only accepted in the conversation as it was.
    messages = messages.map(({ blocks, ...m }) => withoutImages(m, 'was shown here'));
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

  /** The size at which the conversation is summarised: most of the window, or the `compactAt` setting if that is less. */
  compactCeiling() {
    const full = this.contextLimit() * COMPACT_AT;
    const set = Number(this.config.compactAt);
    return set > 0 ? Math.min(full, set) : full;
  }

  /** Whether the provider's cache of this conversation has run out (or was never written). */
  #cacheCold(now = Date.now()) {
    const minutes = this.provider.kind === 'anthropic' ? (this.config.cacheTtl === '5m' ? 5 : 60) : CACHE_MINUTES;
    return !this.lastRequestAt || now - this.lastRequestAt > minutes * 60_000;
  }

  /**
   * Takes the pictures of earlier turns out of the history: a screenshot that was looked at and
   * acted on is otherwise sent again with every step. Done only when the provider's cache has run
   * out anyway — changing the history while it is cached would make the provider read all that
   * follows at full price, which costs more than the pictures do.
   * @returns {number} how many pictures were removed
   */
  dropPastImages({ force = false } = {}) {
    const first = this.messages.findIndex((m) => m.images?.length);
    if (first < 0 || (!force && !this.#cacheCold())) return 0;
    let removed = 0;
    this.messages = this.messages.map((m, i) => {
      if (i < first) return m;
      removed += m.images?.length ?? 0;
      const plain = withoutImages(m, 'removed after its turn to save context');
      if (!plain.blocks) return plain;
      // Reasoning written after a changed message is not accepted back; the text and tool calls are.
      const blocks = plain.blocks.filter((b) => b?.type !== 'thinking' && b?.type !== 'redacted_thinking');
      const { blocks: _, ...rest } = plain;
      return blocks.length ? { ...rest, blocks } : rest;
    });
    return removed;
  }

  /**
   * The model helper agents and the review run on: the `subagentModel` setting, or the
   * conversation's own. A setting that cannot be used is reported once and the own model is used.
   */
  async #helperTarget(wanted = String(this.config.subagentModel ?? '').trim(), { what = 'subagentModel', sameProvider = false } = {}) {
    const own = { provider: this.provider, model: this.model, info: this.info };
    if (!wanted) return own;
    const key = `${this.provider.id}\n${wanted}\n${sameProvider}`;
    this.helperTargets ??= new Map();
    if (this.helperTargets.has(key)) return this.helperTargets.get(key);
    let target = own;
    try {
      const split = wanted.indexOf(':');
      const named = split > 0 && providerDefs(this.config).some((p) => p.id === wanted.slice(0, split));
      // A project's file may pick a model, not send the work to another provider: where the
      // conversation's text goes is the user's choice.
      if (named && sameProvider && wanted.slice(0, split) !== this.provider.id) throw new Error(`it names another provider, which only an agent in ~/.seeker/agents may do`);
      const provider = named ? createProvider(wanted.slice(0, split), this.config) : this.provider;
      const model = named ? wanted.slice(split + 1) : wanted;
      if (provider.id !== this.provider.id || model !== this.model) target = { provider, model, info: await provider.describe(model) };
    } catch (err) {
      const fallback = what === 'subagentModel' ? own : await this.#helperTarget();
      this.ui.warn(`  ⚠ ${what} "${wanted}" cannot be used (${String(err.message ?? err).split('\n')[0]}); it runs on ${fallback.model}.`);
      target = fallback;
    }
    this.helperTargets.set(key, target);
    return target;
  }

  /** Tells the user's hooks about something that happened. Never waits for them and never fails because of one. */
  #observe(event, extra = {}, toolName = null) {
    const hooks = (this.parent ?? this).shellHooks;
    if (!hooks || this.review) return;
    hooks.run(event, { toolName, extra }).catch(() => {});
  }

  /** The agent of that name, as the task tool was asked for it. */
  #agentNamed(name) {
    if (name == null || name === '') return null;
    const found = this.agents.find((a) => a.name === String(name).trim().toLowerCase());
    if (!found) throw new ToolError(this.agents.length ? `No agent named "${name}". Available: ${this.agents.map((a) => a.name).join(', ')}. Leave "agent" out for a general helper.` : `No agent named "${name}": none are defined. Leave "agent" out for a general helper.`);
    return found;
  }

  /** Where a helper runs: on its agent's own model if the file names one, else where helpers run. */
  #targetFor(role) {
    return role?.model ? this.#helperTarget(role.model, { what: `The model of agent ${role.name}`, sameProvider: role.source === 'project' }) : this.#helperTarget();
  }

  /** Gives a helper its role: the instructions, and only the tools the role lists. */
  #applyRole(helper, role) {
    if (!role) return;
    helper.system = `${helper.system}\n\n${roleText(role)}`;
    if (role.tools) for (const tool of helper.tools()) if (!role.tools.includes(tool.name)) helper.withheld.add(tool.name);
  }

  /**
   * What fills the context, part by part, in tokens. The parts are estimates from their size in
   * characters; when the model's own count of the last request is higher than their sum, the
   * difference is listed as such instead of being hidden.
   */
  contextBreakdown() {
    const tokens = (chars) => Math.ceil(chars / CHARS_PER_TOKEN);
    this.#estimateTokens(); // refreshes the size of the tool definitions
    const size = { summary: 0, user: 0, assistant: 0, tool: 0, images: 0 };
    for (const m of this.messages) {
      const all = messageChars(m);
      const { images, ...rest } = m;
      const text = images?.length ? JSON.stringify(rest).length : all;
      size.images += all - text;
      size[m.compacted ? 'summary' : (m.role in size ? m.role : 'user')] += text;
    }
    const parts = [
      { key: 'system', label: 'Instructions, memory and skills', tokens: tokens(this.system.length) },
      { key: 'tools', label: 'Tool definitions', tokens: this.caps.tools && !this.provider.ownTools ? tokens(this.toolSize?.chars ?? 0) : 0 },
      { key: 'summary', label: 'Summary of the earlier conversation', tokens: tokens(size.summary) },
      { key: 'user', label: 'Your messages', tokens: tokens(size.user) },
      { key: 'assistant', label: 'Replies and tool calls', tokens: tokens(size.assistant) },
      { key: 'tool', label: 'Tool results', tokens: tokens(size.tool) },
      { key: 'images', label: 'Pictures', tokens: tokens(size.images) },
    ];
    const estimated = parts.reduce((n, p) => n + p.tokens, 0);
    const used = this.contextTokens();
    if (used > estimated) parts.push({ key: 'uncounted', label: "Counted by the model, not by these estimates", tokens: used - estimated });
    return { limit: this.contextLimit(), ceiling: Math.round(this.compactCeiling()), used: Math.max(used, estimated), messages: this.messages.length, parts: parts.filter((p) => p.tokens > 0) };
  }

  /** Tokens in play for the next request: the model's own count, or our estimate if history grew since. */
  contextTokens() {
    return Math.max(this.usedTokens, this.#estimateTokens());
  }

  #request(messages, { tools, think, signal }) {
    this.lastRequestAt = Date.now();
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
      const entry = { about, row: null };
      this.external.set(id, entry);
      ui.toolStart(about.verbs[0], about.verbs[1], about.summary);
      // A change that needed no approval is still shown: what the file loses and gains, line by line.
      if (about.diff) {
        entry.row = ui.tool;
        ui.diff(about.diff);
        ui.toolRunning();
      }
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
  /**
   * A provider that runs its own tools may ask about several at once (parallel tool calls). They are put to the
   * user one at a time, each with its own row and diff on screen: asked together, the phone showed one card's
   * details for another, an answer to one closed the others, and the session stayed "waiting for approval".
   * One asked after the turn was stopped is refused without asking; one an "always" answer now covers goes through.
   */
  #externalPermission(request) {
    const asked = this.externalAsks.then(() => {
      if (this.controller?.signal.aborted) return { ok: false, reason: 'The user interrupted before answering.' };
      return this.#askExternal(request);
    });
    this.externalAsks = asked.catch(() => {});
    return asked;
  }

  async #askExternal({ id, name, input }) {
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
   * its own empty conversation and the same tools and approval rules (and model, unless
   * `subagentModel` names another); its
   * steps appear in the tree, its thinking and answer text do not.
   */
  async #delegate(prompt, label, agentName) {
    const { ui } = this;
    const role = this.#agentNamed(agentName);
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
    const on = await this.#targetFor(role);
    const helper = new Agent({ config: { ...this.config, agents: false, model: on.model, maxSteps: Math.min(this.config.maxSteps, 30) }, ui: quiet, permissions: this.permissions, provider: on.provider, info: on.info, cwd: this.cwd });
    helper.extraTools = this.extraTools;
    // A helper never gets a tool its parent was denied (API server, scheduled job), and does not write memory, skills or jobs.
    helper.withheld = new Set([...this.withheld, 'task', 'ask_user', 'memory', 'skill_manage', 'cronjob_manage']);
    helper.parent = this;
    helper.shellHooks = this.shellHooks;
    helper.allowReview = false; // the conversation that learns is the user's, not a helper's
    this.#applyRole(helper, role);
    this.helper = helper;
    this.#observe('subagent_start', { agent: role?.name ?? null, description: label });
    try {
      await helper.runTurn(prompt);
    } finally {
      this.helper = null;
    }
    const report = [...helper.messages].reverse().find((m) => m.role === 'assistant' && m.content?.trim())?.content ?? '';
    this.#observe('subagent_stop', { agent: role?.name ?? null, description: label, status: helper.interrupted ? 'interrupted' : 'completed', report: report.slice(0, 4000) });
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
    // Every name is checked before any helper starts: one wrong name should not leave the others running.
    const roles = tasks.map((task) => this.#agentNamed(task.agent));
    const run = async (task, index) => {
      const role = roles[index];
      const on = await this.#targetFor(role);
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
      const helper = new Agent({ config: { ...this.config, agents: false, model: on.model, maxSteps: Math.min(this.config.maxSteps, 30) }, ui: quiet, permissions, provider: on.provider, info: on.info, cwd: this.cwd });
      helper.extraTools = this.extraTools;
      helper.withheld = new Set([...this.withheld, 'task', 'ask_user', 'memory', 'skill_manage', 'cronjob_manage']);
      helper.parent = this;
      helper.shellHooks = this.shellHooks;
      helper.allowReview = false;
      this.#applyRole(helper, role);
      this.helpers.add(helper);
      this.#observe('subagent_start', { agent: role?.name ?? null, description: task.description });
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
      this.#observe('subagent_stop', { agent: role?.name ?? null, description: task.description, status, report: report.slice(0, 4000) });
      ui.toolLine(`${status === 'completed' ? ui.c.green('✓') : ui.c.yellow('!')} ${tag} ${status} in ${Math.round((Date.now() - started) / 1000)}s — ${task.description}`);
      return { description: task.description, status: report ? status : status === 'completed' ? 'failed' : status, report };
    };
    // As many at once as `maxHelpers` allows; the rest start as places come free. The reports
    // come back in the order the tasks were given, whichever finished first.
    const atOnce = Math.max(1, Math.min(MAX_HELPERS, Math.floor(Number(this.config.maxHelpers)) || MAX_HELPERS, tasks.length));
    if (atOnce < tasks.length) ui.toolLine(ui.c.dim(`${tasks.length} helpers, ${atOnce} at a time`));
    const results = new Array(tasks.length);
    let next = 0;
    const worker = async () => {
      while (next < tasks.length && !this.controller?.signal.aborted) {
        const index = next++;
        results[index] = await run(tasks[index], index);
      }
    };
    await Promise.all(Array.from({ length: atOnce }, worker));
    // A task the user interrupted before it could start is said to be that, not left out.
    for (let i = 0; i < tasks.length; i++) results[i] ??= { description: tasks[i].description, status: 'interrupted', report: '' };
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
      // Shell commands run under the sandbox when it is switched on (macOS).
      sandbox: this.config.sandbox ? { write: this.config.sandboxWrite ?? [], network: this.config.sandboxNetwork === true } : null,
      // Or in a container or on another machine (src/backend.mjs); a malformed setting stops the command with its reason.
      backend: this.#backend(),
      vision: this.caps.vision,
      askUser: this.withheld.has('ask_user') ? null : this.hooks.askUser,
      delegate: this.withheld.has('task') ? null : (prompt, label, agent) => this.#delegate(prompt, label, agent),
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
      ui.toolDone(result.note, result.display, result.displayLines, result.images);
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
      const id = await checkpoints.snapshot(this.cwd, `before ${tool.name}: ${String(tool.summary(args) ?? '').slice(0, 80)}`);
      // The message that led to this change remembers the snapshot, so /rollback can take the
      // conversation back to before it as well. A helper's change belongs to the message it works for.
      const asked = (this.parent ?? this).turn?.message;
      if (id && asked && !asked.checkpoint) asked.checkpoint = id;
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
    const { reviewPrompt, reviewOutcome, reviewReplay } = await import('./review.mjs');
    const on = await this.#helperTarget();
    const silent = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'c' ? this.ui.c : () => {}) });
    const helper = new Agent({ config: { ...this.config, agents: false, model: on.model, maxSteps: REVIEW_STEPS, checkpoints: false }, ui: silent, permissions: unattended, provider: on.provider, info: on.info, cwd: this.cwd });
    helper.review = true;
    helper.parent = this;
    if (on.model === this.model) helper.system = this.system;
    helper.withheld = new Set(TOOLS.map((t) => t.name).filter((name) => !REVIEW_TOOLS.has(name) || (name === 'memory' && !(memory && mayLearn('memory'))) || (name === 'skill_manage' && !mayLearn('skill_manage'))));
    // The recent part of the conversation, without pictures or replayed reasoning and with long tool
    // output cut short: a review is sent apart from the conversation's cache, so its size is its price.
    const replay = reviewReplay(this.messages, Math.min(REVIEW_REPLAY_TOKENS, helper.contextLimit() * 0.5) * CHARS_PER_TOKEN);
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
    if (!this.parent) this.#observe('pre_compact', { tokens: this.contextTokens(), mid_task: midTask });
    const controller = this.controller ?? new AbortController();

    // The newest messages stay as they are; only what came before them is summarised.
    const room = (this.compactCeiling() / COMPACT_AT) * KEEP_RECENT * CHARS_PER_TOKEN;
    let cut = this.messages.length;
    let size = 0;
    while (cut > 0 && size + messageChars(this.messages[cut - 1]) <= room) size += messageChars(this.messages[--cut]);
    // A tool result cannot open the kept part: it belongs to the call just before it.
    while (cut < this.messages.length && this.messages[cut].role === 'tool') cut++;
    if (cut < 2) cut = this.messages.length; // nothing worth summarising would be left out — summarise it all
    const older = this.messages.slice(0, cut);
    // Replayed reasoning is only valid in an unedited history, and pictures of turns that are over are not carried across.
    const current = this.messages.findLastIndex((m) => m.role === 'user');
    const recent = this.messages.slice(cut).map(({ blocks, ...message }, i) => (cut + i < current ? withoutImages(message, 'removed after its turn to save context') : message));

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
    if (!this.parent) this.#observe('post_compact', { tokens: this.#estimateTokens() });
    return true;
  }

  /**
   * A message the user typed that holds an API key: before it leaves the Mac for a cloud model, the
   * user chooses to mask the key, send it as it is, or not send it. Returns the text to send, or null
   * for "don't send". With a model on this Mac, or nobody to ask (`seeker serve`, cron), the text
   * goes unchanged.
   */
  async #checkKeys(text) {
    const keys = findSecrets(text);
    if (!keys.length || !this.hooks.askUser) return text;
    // Ollama runs on this Mac, except its cloud models (`gpt-oss:120b-cloud`), which it forwards to ollama.com.
    if (this.provider.local && !/[-:]cloud\b/.test(this.model ?? '')) return text;
    const named = keys.slice(0, 3).map(keyHint).join(', ');
    const question = `Your message holds what looks like ${keys.length > 1 ? `${keys.length} API keys` : 'an API key'} (${named}). Sent as it is, the key goes to ${this.provider.label}, and stays in this conversation's history.`;
    const options = [MASK_KEYS, SEND_KEYS, CANCEL_SEND];
    const answer = await this.hooks.askUser({ question, options, other: false });
    if (answer === SEND_KEYS) return text;
    if (answer === MASK_KEYS) return redactSecrets(text);
    return null;
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
    if (references && !this.review && !this.parent) {
      const checked = await this.#checkKeys(userText);
      if (checked === null) {
        this.controller = null;
        ui.warn('  ⚠ Not sent: the message held an API key. Send it again without the key, or choose to mask it.');
        return;
      }
      userText = checked;
    }
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
    if (this.permissions?.planning && !this.review && !this.parent) message.content += `\n\n${PLAN_NOTE}`;
    if (!this.review && !this.parent) {
      const dragged = draggedFilesIn(userText, this.cwd);
      if (dragged.length) message.content += `\n\n[The file${dragged.length > 1 ? 's' : ''} named above, as plain path${dragged.length > 1 ? 's' : ''} to open: ${dragged.join(' · ')}]`;
    }
    if (!this.review) this.dropPastImages();
    if (this.newSkills.length && !this.provider.ownTools) {
      const fresh = this.skills.filter((s) => this.newSkills.includes(s.name));
      if (fresh.length) message.content += `\n\n[Skills added since this session started, not yet in your skill list — load one with the skill tool when it fits: ${fresh.map((s) => `${s.name} (${s.description})`).join('; ')}]`;
      this.newSkills = [];
    }
    this.messages.push(message);
    this.turn.message = message;
    if (!this.review) this.turnsSinceMemory++;
    ui.turnStart();
    let compactions = 0;
    // A turn that may only look (/review): tools that change something are refused until it ends.
    const lookOnly = this.lookOnlyNext ?? null;
    this.lookOnlyNext = null;
    if (lookOnly && this.permissions) this.permissions.lookOnly = lookOnly;
    try {
      for (let step = 0; ; step++) {
        if (step >= this.config.maxSteps) {
          ui.warn(`  Stopped after ${this.config.maxSteps} steps. Say "continue" to keep going.`);
          break;
        }
        if (this.contextTokens() > this.compactCeiling()) {
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
        if (!this.parent) this.#observe('on_error', { message: String(err.message ?? err).slice(0, 2000) });
      }
    } finally {
      if (lookOnly && this.permissions) this.permissions.lookOnly = null;
      this.controller = null;
      ui.ensureNewline();
    }
    if (this.shellHooks && !this.review && !this.parent && !signal.aborted) this.shellHooks.run('post_llm_call', { extra: { response: this.messages.at(-1)?.content ?? '' } }).catch(() => {});
    if (this.permissions?.planning && !this.review && !this.parent && !signal.aborted) ui.notice('  Plan mode: nothing was changed. /plan go carries the plan out · /plan off leaves plan mode.');
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
