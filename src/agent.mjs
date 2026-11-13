// The agent loop: send the conversation to the model, run whatever tools it
// asks for, feed the results back, repeat until it answers without a tool call.
import { TOOLS, ToolError, clip, toolSpecs, validateArgs } from './tools.mjs';
import path from 'node:path';
import { describeExternal } from './external-tools.mjs';
import { buildSystemPrompt } from './prompt.mjs';
import { loadSkills } from './skills.mjs';
import { imagePathsIn, kilobytes, loadImage, messageChars, withoutImages } from './images.mjs';

const CHARS_PER_TOKEN = 3.5;
const COMPACT_AT = 0.8;

// Share of the context the newest messages may keep, word for word, across a summary.
const KEEP_RECENT = 0.3;
// How full the summariser's own context may get; the rest is room for the summary it writes.
const SUMMARY_FILL = 0.7;
// A turn that needs summarising this often is working on more than the context can hold.
const MAX_COMPACTIONS_PER_TURN = 3;

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
    // Tools a provider is running itself, by call id: { about, row } where `row` is its line on screen.
    this.external = new Map();
    // Tools from outside SEEKER (MCP servers), added and removed while it runs.
    this.extraTools = [];
    // Names of tools this agent may not use (a helper agent cannot start helpers or question the user).
    this.withheld = new Set();
    // Set by the interface: askUser({ question, options }) → answer | null.
    this.hooks = {};
    this.helper = null;
    this.setModel(config.model, info, provider);
  }

  setModel(model, info, provider = this.provider) {
    this.model = model;
    this.provider = provider;
    this.info = info;
    this.caps = { tools: Boolean(info.tools), thinking: Boolean(info.thinking), vision: Boolean(info.vision) };
    this.skills = loadSkills(this.cwd, this.config.skillDirs);
    const { prompt, instructionFiles } = buildSystemPrompt({ cwd: this.cwd, model, skills: this.skills, provider, contextLimit: this.contextLimit() });
    this.system = prompt;
    this.instructionFiles = instructionFiles;
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

  interrupt() {
    this.helper?.interrupt();
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
      if (this.toolSize?.count !== list.length) this.toolSize = { count: list.length, chars: JSON.stringify(toolSpecs(list)).length };
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
      tools: tools && this.caps.tools && !this.provider.ownTools ? toolSpecs(this.tools()) : undefined,
      think: this.caps.thinking ? think : undefined,
      signal,
      cwd: this.cwd,
      hooks: { permission: (request) => this.#externalPermission(request) },
    });
  }

  async #streamOnce(signal) {
    const { ui } = this;
    const answer = ui.answerStream();
    let content = '';
    let phase = null;
    let blocks = null;
    const toolCalls = [];
    ui.startSpinner(this.usedTokens || this.provider.kind !== 'ollama' ? 'Working' : 'Loading model');
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
    ui.startSpinner('Working');
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
    helper.withheld = new Set(['task', 'ask_user']);
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
    };
    ui.toolStart(tool.verbs[0], tool.verbs[1], tool.summary(args));
    const invalid = validateArgs(tool, args);
    if (invalid) {
      ui.toolFail(invalid);
      return `Error: ${invalid}. Call ${name} again with valid arguments.`;
    }
    try {
      if (tool.preview) ui.diff(tool.preview(args, ctx));
      const verdict = await this.permissions.check(tool, args);
      if (!verdict.ok) {
        ui.toolFail('not run');
        return verdict.reason;
      }
      ui.toolRunning();
      const result = await tool.run(args, ctx);
      const maxChars = Math.min(24_000, Math.floor(this.contextLimit() * 0.25 * CHARS_PER_TOKEN));
      ui.toolDone(result.note, result.display, result.displayLines);
      const output = clip(result.output, maxChars);
      return result.images?.length ? { content: output, images: result.images } : output;
    } catch (err) {
      const message = err instanceof ToolError ? err.message : `${err.name}: ${err.message}`;
      ui.toolFail(message);
      return `Error: ${message}`;
    }
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
    ui.startSpinner('Summarising the conversation');
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

  /** The image files named in a user message, loaded so the model sees them and not just their paths. */
  #attachImages(text) {
    // Claude Code opens files with its own tools.
    if (this.provider.ownTools) return [];
    const files = imagePathsIn(text, this.cwd);
    if (!files.length) return [];
    const { ui } = this;
    if (!this.caps.vision) {
      ui.warn(`  ⚠ ${this.model} cannot see images, so ${files.length > 1 ? 'these files were' : path.basename(files[0]) + ' was'} not attached. Switch to a vision model with /model.`);
      return [];
    }
    const images = [];
    for (const file of files) {
      try {
        const { bytes, ...image } = loadImage(file);
        images.push(image);
        ui.notice(`  ▣ attached ${image.name} (${kilobytes(bytes)})`);
      } catch (err) {
        ui.warn(`  ⚠ ${err.message}.`);
      }
    }
    return images;
  }

  /** Runs one user message to completion. Never throws: failures are shown and the history stays valid. */
  async runTurn(userText) {
    const { ui } = this;
    this.controller = new AbortController();
    const { signal } = this.controller;
    const message = { role: 'user', content: userText };
    const images = this.#attachImages(userText);
    if (images.length) message.images = images;
    this.messages.push(message);
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

        const { content, toolCalls, blocks } = await this.#streamOnce(signal);
        const message = { role: 'assistant', content };
        if (toolCalls.length) message.tool_calls = toolCalls;
        if (blocks) message.blocks = blocks;
        this.messages.push(message);

        if (!toolCalls.length) {
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
  }
}
