// Remote control: `seeker remote` keeps agents running on this machine and
// lets their owner work with them from a phone, through a small relay server
// (see remote-server/) that the owner hosts.
//
// This process only makes outgoing connections to the relay — nothing listens
// on this machine. Everything sent either way is encrypted with a key derived
// from a secret that exists only here and on the phone; the relay is given
// just the hash of an access token and cannot read or forge anything.
// Edits and commands still need approval, which is asked for on the phone.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME_DIR, VERSION, saveConfig, saveProviderConfig } from './config.mjs';
import { receivedImages } from './images.mjs';
import { LINK_FILE, listenLink, readLines, sameKey, writeLine } from './link.mjs';
import { createProvider, needsKey, providerDefs } from './providers.mjs';
import { ANSI } from './text.mjs';
import { contextSize, gitInfo, tildify } from './ui.mjs';
import { createVapidKeys, sendPush } from './webpush.mjs';

const plain = (text) => String(text ?? '').replace(ANSI, '');
const MAX_ITEMS = 400; // transcript entries kept per workspace
const SNAPSHOT_EVERY = 400; // events between full snapshots, which let the relay drop older ones
const COMMAND_MAX_AGE = 5 * 60 * 1000;
const NOTIFY_FINISHED_AFTER = 30_000; // a turn shorter than this ends without a notification

// ── Keys and encryption ────────────────────────────────────────────────────

/** From the one shared secret: the token that opens the relay, and the key that hides the content from it. */
export function deriveKeys(secret) {
  const derive = (label) => crypto.createHmac('sha256', secret).update(label).digest();
  const token = derive('seeker-remote-auth-v1').toString('hex');
  return { token, key: derive('seeker-remote-enc-v1'), authHash: crypto.createHash('sha256').update(token).digest('hex') };
}

/** AES-256-GCM; output is base64 of nonce ‖ ciphertext ‖ tag, the layout the browser's WebCrypto uses too. */
export function seal(key, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
}

/** Throws if the text was not sealed with this key or was altered on the way. */
export function unseal(key, text) {
  const raw = Buffer.from(text, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8'));
}

// ── What the agent "draws on" when its user is on a phone ───────────────────

/**
 * Stands in for the terminal UI. Instead of printing, it reports transcript
 * items — the user's message, the answer as it streams, each tool step — to
 * `emit`, which sends them to the phone.
 */
export class WebUI {
  constructor(emit) {
    this.emit = emit;
    this.c = new Proxy({}, { get: () => (s) => String(s) });
    this.showThinking = false;
    this.tool = null;
    this.count = 0;
    this.answer = null; // { id, pending } — the assistant message being streamed
    this.timer = null;
    this.failed = false; // an error was shown since the turn began
    this.onStep = () => {};
  }

  /** What the agent is doing right now: `phase` is thinking | executing | responding. */
  #activity(phase, text) {
    this.emit({ t: 'activity', phase, text });
  }

  #item(item) {
    const full = { id: `i${++this.count}`, at: Date.now(), ...item };
    this.emit({ t: 'item', item: full });
    return full;
  }

  /** `images` are the pictures sent with the message: their names, and a small preview where there is one. */
  user(text, images = []) {
    this.#item(images.length ? { kind: 'user', text, images } : { kind: 'user', text });
  }

  turnStart() {
    this.failed = false;
    this.#flushAnswer();
    this.answer = null;
    this.tool = null;
  }

  answerStart() {
    // Each reply of the model is its own message, even within one turn.
    this.#flushAnswer();
    this.answer = null;
  }

  answerStream() {
    return {
      push: (text) => {
        if (!this.answer) {
          this.answer = { id: this.#item({ kind: 'assistant', text: '' }).id, pending: '' };
          this.#activity('responding', 'Writing the answer');
        }
        this.answer.pending += text;
        // Tokens arrive many times a second; they are sent on in small batches.
        this.timer ??= setTimeout(() => this.#flushAnswer(), 250);
      },
      flush: () => this.#flushAnswer(),
    };
  }

  #flushAnswer() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.answer?.pending) return;
    this.emit({ t: 'patch', id: this.answer.id, append: this.answer.pending });
    this.answer.pending = '';
  }

  toolStart(doing, done, summary = '') {
    this.#flushAnswer();
    const text = plain(summary).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 400);
    // The same step can be announced twice (once to ask approval, once when it starts).
    if (this.tool && !this.tool.finished && this.tool.doing === doing && this.tool.summary === text) return;
    const item = this.#item({ kind: 'tool', state: 'running', doing, done, summary: text });
    this.tool = { id: item.id, doing, done, summary: text, open: false, finished: false, diff: null };
    this.#activity('executing', `${doing} ${text}`.trim());
  }

  toolOpen() {
    if (this.tool) this.tool.open = true;
  }

  diff(diff) {
    if (!this.tool) return;
    this.tool.diff = diff;
    this.emit({ t: 'patch', id: this.tool.id, patch: { diff } });
  }

  toolLine() {}

  toolRunning() {
    if (this.tool) this.emit({ t: 'patch', id: this.tool.id, patch: { state: 'running' } });
  }

  toolDone(note, display, maxLines = 4) {
    if (!this.tool) return;
    const output = String(display ?? '').split('\n').filter((l) => l.trim()).slice(0, Math.max(maxLines, 12)).map((l) => l.slice(0, 300));
    this.emit({ t: 'patch', id: this.tool.id, patch: { state: 'done', note: note ?? '', output } });
    this.tool.finished = true;
    this.tool = null;
    this.onStep();
  }

  toolFail(message) {
    if (!this.tool) return;
    this.emit({ t: 'patch', id: this.tool.id, patch: { state: 'failed', note: plain(message).split('\n')[0] } });
    this.tool.finished = true;
    this.tool = null;
    this.onStep();
  }

  notice(text) {
    this.#item({ kind: 'notice', level: 'info', text: plain(text).trim() });
  }

  warn(text) {
    this.#item({ kind: 'notice', level: 'warn', text: plain(text).trim() });
  }

  error(text) {
    this.failed = true;
    this.#item({ kind: 'notice', level: 'error', text: plain(text).trim() });
  }

  startSpinner(label) {
    // The spinner runs while the model has been asked and nothing has come back yet.
    this.#activity('thinking', plain(label));
  }

  // Parts of the terminal interface with no meaning here.
  stopSpinner() {}
  ensureNewline() {}
  thinkStart() {
    this.#activity('thinking', 'Thinking');
  }
  thinkChunk() {}
  thinkEnd() {}
}

// ── One project folder with its own agent ───────────────────────────────────

const TITLES = { exec: 'Run this command?', write: 'Apply this change?', net: 'Open this address?', other: 'Use this tool?' };

export class Workspace {
  /**
   * @param {object} daemon  the RemoteDaemon, or for a session running in a terminal the TerminalLink that leads to one
   * @param {{ id?: string, terminal?: boolean }} [opts]  `terminal`: the conversation is typed in a terminal on this machine
   */
  constructor(daemon, cwd, { id = null, terminal = false } = {}) {
    this.daemon = daemon;
    this.cwd = cwd;
    this.terminal = terminal;
    this.id = id ?? crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 10);
    this.name = path.basename(cwd) || cwd;
    this.items = [];
    this.status = 'idle'; // idle | working | approval
    this.activity = '';
    this.phase = null; // thinking | executing | responding, while working
    this.outcome = null; // how the last turn ended: completed | failed | stopped
    this.stopped = false;
    this.tools = { total: 0, failed: 0 };
    this.startedAt = null; // when the turn in progress began
    this.lastAt = null; // when anything last happened here
    this.ui = new WebUI((event) => this.#report(event));
    this.ui.onStep = () => this.touch();
  }

  /** Keeps a copy of the transcript (so a snapshot can be sent at any time) and passes the event on. */
  #report(event) {
    this.lastAt = Date.now();
    if (event.t === 'item') {
      if (event.item.kind === 'tool') this.tools.total += 1;
      this.items.push(event.item);
      if (this.items.length > MAX_ITEMS) this.items.shift();
    } else if (event.t === 'patch') {
      const item = this.items.find((i) => i.id === event.id);
      if (event.patch?.state === 'failed') this.tools.failed += 1;
      if (item) {
        Object.assign(item, event.patch ?? {});
        if (event.append) item.text = (item.text ?? '') + event.append;
      }
    } else if (event.t === 'activity') {
      this.activity = event.text;
      this.phase = event.phase ?? null;
      return this.touch();
    }
    this.daemon.send({ ...event, ws: this.id });
  }

  async open() {
    const built = await this.daemon.build(this.cwd, this.ui, (request) => this.#approval(request), this.daemon.info);
    this.agent = built.agent;
    this.session = built.session;
    this.agent.hooks.askUser = (request) => this.#question(request);
    this.git = gitInfo(this.cwd);
  }

  meta() {
    const { agent } = this;
    const todos = agent.state.todos ?? [];
    const done = todos.filter((t) => t.status === 'completed').length;
    const current = todos.find((t) => t.status === 'in_progress')?.content ?? '';
    return {
      id: this.id,
      name: this.name,
      path: tildify(this.cwd),
      branch: this.git?.branch ?? '',
      status: this.status,
      phase: this.status === 'working' ? this.phase : null,
      outcome: this.status === 'idle' ? this.outcome : null,
      activity: this.status === 'idle' ? '' : this.activity,
      startedAt: this.status === 'idle' ? null : this.startedAt,
      lastAt: this.lastAt,
      tools: { ...this.tools, running: this.status === 'idle' || !this.ui.tool ? null : `${this.ui.tool.doing} ${this.ui.tool.summary}`.trim() },
      // Counted by the provider; null until it has reported once.
      tokens: agent.usage.known ? { input: agent.usage.input, output: agent.usage.output, totalInput: agent.usage.totalInput, totalOutput: agent.usage.totalOutput } : null,
      model: agent.model,
      provider: agent.provider.label,
      local: Boolean(agent.provider.local),
      used: agent.contextTokens(),
      limit: agent.contextLimit(),
      vision: Boolean(agent.caps.vision || agent.provider.ownTools),
      progress: todos.length ? { done, total: todos.length, current } : null,
      ...(this.terminal ? { terminal: true } : {}),
    };
  }

  /** Tells the phone this workspace's summary changed. */
  touch() {
    this.daemon.send({ t: 'ws', ws: this.meta() });
  }

  /** Put to the user on the phone; resolves with 'y' | 'a' | 'n' | their written instruction | null. */
  async #approval({ tool, warning, always }) {
    const current = this.ui.tool;
    const kind = TITLES[tool.risk] ? tool.risk : 'other';
    const approval = {
      id: crypto.randomBytes(6).toString('hex'),
      ws: this.id,
      wsName: this.name,
      kind,
      tool: tool.name,
      title: TITLES[kind],
      doing: current?.doing ?? tool.name,
      summary: current?.summary ?? '',
      cwd: tildify(this.cwd),
      diff: current?.diff ?? null,
      warning: warning ?? null,
      always: always ? plain(always) : null,
      at: Date.now(),
    };
    const before = this.status;
    this.status = 'approval';
    this.touch();
    const answer = await this.daemon.ask(approval);
    this.status = before;
    this.touch();
    return answer;
  }

  /** The model's own question to the user; resolves with their answer, or null if they stopped the turn. */
  async #question({ question, options }) {
    const before = this.status;
    this.status = 'approval';
    this.touch();
    const answer = await this.daemon.ask({
      id: crypto.randomBytes(6).toString('hex'),
      ws: this.id,
      wsName: this.name,
      kind: 'question',
      title: question,
      options: options ?? [],
      cwd: tildify(this.cwd),
      at: Date.now(),
    });
    this.status = before;
    this.touch();
    return answer;
  }

  /** @param {ReturnType<typeof receivedImages>} images  pictures the phone sent with the message */
  async run(text, images = []) {
    if (this.status !== 'idle') return;
    const started = Date.now();
    this.status = 'working';
    this.activity = 'Starting';
    this.phase = 'thinking';
    this.outcome = null;
    this.stopped = false;
    this.startedAt = started;
    // The transcript keeps the small previews only; the pictures themselves go to the model.
    this.ui.user(text, images.map(({ name, thumb }) => ({ name, mime: thumb?.mime ?? null, thumb: thumb?.data ?? null })));
    this.touch();
    try {
      await this.agent.runTurn(text, { images });
      this.ui.answerStream().flush();
      this.session.save(this.agent.messages, this.agent.model);
    } finally {
      this.status = 'idle';
      this.activity = '';
      this.phase = null;
      this.outcome = this.stopped ? 'stopped' : this.ui.failed ? 'failed' : 'completed';
      this.touch();
    }
    const url = `/#v=session:${this.id}`;
    if (this.outcome === 'failed') {
      const error = [...this.items].reverse().find((i) => i.kind === 'notice' && i.level === 'error');
      this.daemon.notify({ title: `${this.name}: failed`, body: (error?.text ?? 'The task ended with an error.').replace(/\s+/g, ' ').slice(0, 160), url, tag: `done-${this.id}` }, 'error');
    } else if (this.outcome === 'completed' && Date.now() - started >= this.daemon.notifyAfter) {
      const last = [...this.items].reverse().find((i) => i.kind === 'assistant' && i.text);
      this.daemon.notify({ title: `${this.name}: finished`, body: (last?.text ?? 'The task has ended.').replace(/\s+/g, ' ').slice(0, 160), url, tag: `done-${this.id}` }, 'done');
    }
  }

  stop() {
    if (this.status !== 'idle') this.stopped = true;
    this.agent.interrupt();
  }

  reset() {
    this.agent.messages = [];
    this.agent.state.todos = [];
    this.agent.usedTokens = 0;
    this.agent.usage = { input: 0, output: 0, totalInput: 0, totalOutput: 0, known: false };
    this.session.startNew();
    this.items = [];
    this.tools = { total: 0, failed: 0 };
    this.outcome = null;
  }
}

/**
 * A session that runs in a terminal on this machine and joined over the local link.
 * The daemon does not own its agent: it keeps a copy of what the terminal reports,
 * so a snapshot can include it, and passes on what the phone sends.
 */
class LinkedWorkspace {
  constructor(socket, ws) {
    this.linked = true;
    this.socket = socket;
    this.id = ws.id;
    this.items = Array.isArray(ws.items) ? ws.items.slice(-MAX_ITEMS) : [];
    this.#keep(ws);
  }

  #keep({ items, ...meta }) {
    this.last = { ...meta, id: this.id, terminal: true };
    this.name = String(meta.name ?? 'terminal');
  }

  get status() {
    return this.last.status;
  }

  meta() {
    return this.last;
  }

  /** Applies an event the terminal sent to the copy kept here. */
  track(event) {
    if (event.t === 'ws' && event.ws) this.#keep(event.ws);
    else if (event.t === 'item' && event.item) {
      this.items.push(event.item);
      if (this.items.length > MAX_ITEMS) this.items.shift();
    } else if (event.t === 'patch') {
      const item = this.items.find((i) => i.id === event.id);
      if (!item) return;
      Object.assign(item, event.patch ?? {});
      if (event.append) item.text = (item.text ?? '') + event.append;
    }
  }

  message(text, images) {
    writeLine(this.socket, { t: 'message', text, images });
  }

  stop() {
    writeLine(this.socket, { t: 'stop' });
  }
}

/** Where a folder named on the phone is: `~` is the home folder, and a bare name is inside it. */
const folderPath = (folder) => path.resolve(os.homedir(), folder === '~' || folder.startsWith('~/') ? path.join(os.homedir(), folder.slice(1)) : folder);

/**
 * Makes a folder for a new project, asked for from the phone. Only inside the
 * home folder, and never in or as a hidden folder: a phone must not be able to
 * write into ~/.ssh or anywhere outside what the user thinks of as their projects.
 * @throws {Error} with a message fit to show as it is
 */
export function newProjectFolder(cwd, home = os.homedir()) {
  const parts = path.relative(home, cwd).split(path.sep);
  if (!parts[0] || parts[0] === '..' || path.isAbsolute(parts[0])) throw new Error('A new project folder has to be inside your home folder.');
  if (parts.length > 4) throw new Error('That is too many folders deep for a new project.');
  for (const part of parts) {
    if (part.startsWith('.')) throw new Error('A new project folder cannot be hidden or inside a hidden folder.');
    if (part.length > 100 || /[\u0000-\u001f\u007f\\:]/.test(part)) throw new Error(`"${part.slice(0, 40)}" cannot be used as a folder name.`);
  }
  // The part of the path that exists already may be a link leading somewhere else.
  let existing = path.dirname(cwd);
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = fs.realpathSync(existing);
  const inside = path.relative(fs.realpathSync(home), real);
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('A new project folder has to be inside your home folder.');
  if (!fs.statSync(real).isDirectory()) throw new Error(`${path.basename(existing)} is a file, not a folder.`);
  fs.mkdirSync(cwd, { recursive: true });
}

// ── The daemon ─────────────────────────────────────────────────────────────

/** Which kinds of notification a phone wants; everything is on unless it was switched off. */
const pushPrefs = (prefs) => ({ done: prefs?.done !== false, approval: prefs?.approval !== false, error: prefs?.error !== false });

/** Folders in the home directory that look like projects, to offer on the phone. */
function projectFolders() {
  const home = os.homedir();
  try {
    return fs
      .readdirSync(home, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .filter((e) => ['.git', 'package.json', 'pyproject.toml', 'SEEKER.md', 'AGENTS.md', 'CLAUDE.md'].some((f) => fs.existsSync(path.join(home, e.name, f))))
      .map((e) => `~/${e.name}`)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .slice(0, 60);
  } catch {
    return [];
  }
}

export class RemoteDaemon {
  /**
   * @param {object} opts
   * @param {object} opts.config   needs config.remote.{ url, secret }
   * @param {string[]} opts.folders  workspaces to open at start
   * @param {(cwd: string, ui: WebUI, asker: Function) => Promise<{ agent, session }>} opts.build
   * @param {(line: string) => void} [opts.log]
   */
  constructor({ config, folders, build, info = null, log = () => {}, remember = true, push = {}, link = remember ? LINK_FILE : null }) {
    this.linkFile = link; // where sessions running in a terminal join; null = they cannot
    this.linkServer = null;
    this.remember = remember; // false in tests, so they never touch the user's settings
    this.info = info; // what the current model can do; replaced when the model is switched from the phone
    this.notifyAfter = push.finishedAfter ?? NOTIFY_FINISHED_AFTER;
    this.pushAnyHost = Boolean(push.anyHost);
    this.pushFile = remember ? path.join(HOME_DIR, 'push.json') : null;
    this.subscriptions = [];
    try {
      if (this.pushFile) this.subscriptions = JSON.parse(fs.readFileSync(this.pushFile, 'utf8'));
    } catch {}
    // The identity pushes are signed with. It never leaves this machine; phones get only the public half.
    if (!config.remote.vapid) {
      config.remote = { ...config.remote, vapid: createVapidKeys() };
      if (remember) saveConfig({ remote: config.remote });
    }
    this.config = config;
    this.url = String(config.remote.url).replace(/\/+$/, '');
    this.keys = deriveKeys(config.remote.secret);
    this.build = build;
    this.log = log;
    this.folders = folders;
    this.workspaces = new Map();
    this.approvals = new Map(); // id → { approval, resolve }
    this.outbox = [];
    this.sending = false;
    this.sinceSnapshot = 0;
    this.seen = new Set(); // ids of commands already carried out
    this.running = false;
    this.stream = null;
  }

  #headers() {
    return { authorization: `Bearer ${this.keys.token}`, 'content-type': 'application/json' };
  }

  // ── to the phone ──
  snapshot() {
    return {
      t: 'snapshot',
      device: { name: os.hostname().replace(/\.local$/, ''), at: Date.now(), version: VERSION, vapid: this.config.remote.vapid.publicKey, phones: this.subscriptions.length, provider: this.config.provider, model: this.config.model },
      workspaces: [...this.workspaces.values()].map((w) => ({ ...w.meta(), items: w.items })),
      approvals: [...this.approvals.values()].map((a) => a.approval),
      folders: projectFolders(),
    };
  }

  send(event, { snapshot = false } = {}) {
    if (snapshot) {
      this.outbox = []; // a snapshot already contains everything still waiting to go out
      this.sinceSnapshot = 0;
    } else if (++this.sinceSnapshot >= SNAPSHOT_EVERY) {
      return this.send(this.snapshot(), { snapshot: true });
    }
    this.outbox.push({ c: seal(this.keys.key, event), snapshot });
    this.#drain();
  }

  async #drain() {
    if (this.sending) return;
    this.sending = true;
    let failing = false;
    try {
      while (this.outbox.length && this.running) {
        const batch = this.outbox.slice(0, 50);
        try {
          const res = await fetch(`${this.url}/agent/events`, { method: 'POST', headers: this.#headers(), body: JSON.stringify({ events: batch }), signal: AbortSignal.timeout(20_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          // Remove exactly what was sent: while it was on its way, a snapshot may have replaced the queue.
          const sent = new Set(batch);
          this.outbox = this.outbox.filter((entry) => !sent.has(entry));
          failing = false;
        } catch (err) {
          if (!failing) this.log(`relay: could not send (${err.cause?.code ?? err.message}) — will retry`);
          failing = true;
          // Offline for now. What is waiting is replaced by a snapshot once the relay is reachable again.
          if (this.outbox.length > 500) this.outbox = [];
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (!this.outbox.some((e) => e.snapshot)) {
            this.outbox = [{ c: seal(this.keys.key, this.snapshot()), snapshot: true }];
            this.sinceSnapshot = 0;
          }
        }
      }
    } finally {
      this.sending = false;
    }
  }

  #saveSubscriptions() {
    if (!this.pushFile) return;
    try {
      fs.writeFileSync(this.pushFile, JSON.stringify(this.subscriptions, null, 2), { mode: 0o600 });
    } catch {}
  }

  /**
   * Sends a notification to every paired phone that asked for this kind. Returns how many were accepted.
   * @param {'approval' | 'done' | 'error' | null} [kind]  null reaches every phone (tests, greetings)
   */
  async notify(payload, kind = null) {
    const wanted = this.subscriptions.filter((s) => !kind || s.prefs?.[kind] !== false);
    if (!wanted.length) return 0;
    const results = await Promise.all(
      wanted.map((subscription) => sendPush(subscription, payload, this.config.remote.vapid, { subject: this.url, anyHost: this.pushAnyHost }).then((result) => ({ subscription, ...result }))),
    );
    // A phone that removed the app, or revoked the permission, is forgotten.
    const gone = results.filter((r) => r.gone).map((r) => r.subscription.endpoint);
    if (gone.length) {
      this.subscriptions = this.subscriptions.filter((s) => !gone.includes(s.endpoint));
      this.#saveSubscriptions();
    }
    const failed = results.filter((r) => !r.ok && !r.gone);
    if (failed.length) this.log(`push: ${failed.length} notification(s) not accepted (status ${failed.map((r) => r.status).join(', ')})`);
    return results.filter((r) => r.ok).length;
  }

  /** Shows an approval (or a question from the model) on the phone and waits for the answer. */
  ask(approval) {
    return new Promise((resolve) => {
      this.approvals.set(approval.id, { approval, resolve });
      this.send({ t: 'approval', approval });
      const question = approval.kind === 'question';
      const what = question ? approval.title : `${approval.doing} ${approval.summary}`;
      this.log(`${question ? 'question' : 'approval needed'} in ${approval.wsName}: ${what}`.slice(0, 110));
      this.notify({ title: `${approval.wsName}: ${question ? 'Seeker has a question' : approval.title}`, body: what.replace(/\s+/g, ' ').slice(0, 160), url: `/#v=review:${approval.id}`, tag: approval.id }, 'approval');
    });
  }

  /** Makes `model` on `providerId` the model of every open workspace, now and for the next start. */
  async #switchModel(providerId, model) {
    const busy = [...this.workspaces.values()].find((w) => !w.linked && w.status !== 'idle');
    if (busy) throw new Error(`${busy.name} is still working. Stop it before switching model.`);
    const first = createProvider(providerId, this.config);
    const info = await first.describe(model); // fails here if the model or the provider is not usable
    this.info = info;
    this.config.provider = providerId;
    this.config.model = model;
    if (this.remember) {
      saveConfig({ provider: providerId, model });
      saveProviderConfig(this.config, providerId, { model });
    }
    for (const workspace of this.workspaces.values()) {
      if (workspace.linked) continue; // a terminal session chooses its own model, in the terminal
      // Each workspace gets its own provider object: some keep a session per conversation.
      workspace.agent.setModel(model, info, createProvider(providerId, this.config));
      workspace.agent.usedTokens = 0;
      workspace.agent.lastStats = null;
    }
    return first.label;
  }

  #settle(id, answer) {
    const entry = this.approvals.get(id);
    if (!entry) return false;
    this.approvals.delete(id);
    this.send({ t: 'approval_done', id });
    entry.resolve(answer);
    return true;
  }

  /** An answer from the phone. One for a request that is gone (answered already, or the turn was stopped) is said so. */
  #answer(id, answer) {
    if (!this.#settle(id, answer)) this.send({ t: 'toast', text: 'That request was already answered.' });
  }

  // ── workspaces ──
  async openWorkspace(folder, { create = false } = {}) {
    const cwd = folderPath(folder);
    if (create && !fs.existsSync(cwd)) newProjectFolder(cwd);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`No such folder: ${folder}`);
    const existing = [...this.workspaces.values()].find((w) => !w.linked && w.cwd === cwd);
    if (existing) return existing;
    const workspace = new Workspace(this, cwd);
    await workspace.open();
    this.workspaces.set(workspace.id, workspace);
    this.#remember();
    workspace.touch();
    return workspace;
  }

  #remember() {
    if (!this.remember) return;
    this.config.remote = { ...this.config.remote, workspaces: [...this.workspaces.values()].filter((w) => !w.linked).map((w) => w.cwd) };
    saveConfig({ remote: this.config.remote });
  }

  // ── from the phone ──
  async #command(sealed) {
    let command;
    try {
      command = unseal(this.keys.key, sealed);
    } catch {
      return this.log('ignored a command that was not encrypted with our key');
    }
    // A captured command must not work when replayed later, or twice.
    if (typeof command.id !== 'string' || this.seen.has(command.id) || Math.abs(Date.now() - Number(command.at)) > COMMAND_MAX_AGE) return this.log('ignored a stale or repeated command');
    this.seen.add(command.id);
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));

    const workspace = this.workspaces.get(command.ws);
    try {
      switch (command.type) {
        case 'sync':
          return this.send(this.snapshot(), { snapshot: true });
        case 'message': {
          if (!workspace) return;
          const images = receivedImages(command.images);
          if (workspace.linked) {
            // The terminal decides what to do with it: it knows whether someone is typing there.
            const said = typeof command.text === 'string' ? command.text.trim() : '';
            if (!said && !images.length) return;
            this.log(`${workspace.name} (terminal) ← ${said ? said.split('\n')[0].slice(0, 70) : `${images.length} image${images.length > 1 ? 's' : ''}`}`);
            return workspace.message(said, images);
          }
          const text = (typeof command.text === 'string' ? command.text.trim() : '') || (images.length ? `Look at ${images.length > 1 ? 'these images' : 'this image'}.` : '');
          if (!text) return;
          if (workspace.status !== 'idle') return this.send({ t: 'toast', text: `${workspace.name} is still working. Stop it first.` });
          this.log(`${workspace.name} ← ${text.split('\n')[0].slice(0, 70)}${images.length ? ` (+${images.length} image${images.length > 1 ? 's' : ''})` : ''}`);
          workspace.run(text, images).catch((err) => this.log(`error in ${workspace.name}: ${err.message}`));
          return;
        }
        case 'stop':
          if (!workspace) return;
          workspace.stop();
          // Anything it was waiting on is answered "no" so the turn can end.
          for (const [id, entry] of this.approvals) if (entry.approval.ws === workspace.id) this.#settle(id, null);
          return;
        case 'approve': {
          const answer = command.decision === 'allow' ? 'y' : command.decision === 'always' ? 'a' : String(command.note ?? '').trim() || 'n';
          return this.#answer(command.id_approval, answer);
        }
        case 'answer':
          return this.#answer(command.id_approval, String(command.answer ?? '').trim() || null);
        case 'ping':
          // Echoed straight back, so the phone can time the whole path: phone → relay → here → relay → phone.
          return this.send({ t: 'pong', id: command.id });
        case 'providers':
          return this.send({
            t: 'providers',
            list: providerDefs(this.config).map((d) => ({ id: d.id, label: d.label, local: Boolean(d.local), ready: !needsKey(d, this.config), active: d.id === this.config.provider })),
          });
        case 'models': {
          const provider = createProvider(String(command.provider), this.config);
          const models = await provider.listModels();
          const active = provider.id === this.config.provider ? this.config.model : (this.config.providers?.[provider.id]?.model ?? null);
          return this.send({
            t: 'models',
            provider: provider.id,
            label: provider.label,
            active,
            models: models.slice(0, 500).map((m) => ({ name: m.name, hint: [m.title, m.size ? `${(m.size / 1e9).toFixed(1)} GB` : null, m.context ? `${contextSize(m.context)} context` : null].filter(Boolean).join(' · ') })),
          });
        }
        case 'model': {
          const label = await this.#switchModel(String(command.provider), String(command.model));
          this.log(`model switched to ${command.model} via ${label}`);
          this.send(this.snapshot(), { snapshot: true });
          return this.send({ t: 'toast', text: `Model: ${command.model} via ${label}` });
        }
        case 'push_subscribe': {
          const sub = command.subscription;
          if (typeof sub?.endpoint !== 'string' || typeof sub?.keys?.p256dh !== 'string' || typeof sub?.keys?.auth !== 'string') return;
          this.subscriptions = [...this.subscriptions.filter((s) => s.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, prefs: pushPrefs(command.prefs), added: Date.now() }].slice(-10);
          this.#saveSubscriptions();
          this.log('a phone turned notifications on');
          const sent = await this.notify({ title: 'SEEKER', body: 'Notifications are on for this phone.', url: '/', tag: 'hello' });
          this.send(this.snapshot(), { snapshot: true });
          return this.send({ t: 'toast', text: sent ? 'Notifications are on. A test was sent.' : 'Saved, but the test notification was not accepted.' });
        }
        case 'push_prefs': {
          const subscription = this.subscriptions.find((s) => s.endpoint === command.endpoint);
          if (!subscription) return this.send({ t: 'toast', text: 'Notifications are not on for this phone.' });
          subscription.prefs = pushPrefs(command.prefs);
          this.#saveSubscriptions();
          return this.send({ t: 'push_prefs', endpoint: subscription.endpoint, prefs: subscription.prefs });
        }
        case 'push_unsubscribe':
          this.subscriptions = this.subscriptions.filter((s) => s.endpoint !== command.endpoint);
          this.#saveSubscriptions();
          return this.send(this.snapshot(), { snapshot: true });
        case 'push_test': {
          const sent = await this.notify({ title: 'SEEKER', body: 'Test notification from your Mac.', url: '/', tag: 'test' });
          return this.send({ t: 'toast', text: sent ? `Sent to ${sent} phone(s).` : 'No phone accepted it. Turn notifications on first.' });
        }
        case 'new':
          if (workspace?.linked) return this.send({ t: 'toast', text: 'This conversation runs in a terminal on your Mac. Start a new one there.' });
          if (!workspace || workspace.status !== 'idle') return;
          workspace.reset();
          return this.send(this.snapshot(), { snapshot: true });
        case 'open': {
          const before = new Set(this.workspaces.keys());
          const create = command.create === true;
          const made = create && !fs.existsSync(folderPath(String(command.path ?? '')));
          const opened = await this.openWorkspace(String(command.path ?? ''), { create });
          this.log(`${made ? 'created and opened' : 'opened'} ${opened.cwd}`);
          await this.send(this.snapshot(), { snapshot: true });
          // Lets the phone that asked go straight to it.
          return this.send({ t: 'opened', id: opened.id, created: made, fresh: !before.has(opened.id) });
        }
        case 'close':
          if (workspace?.linked) return this.send({ t: 'toast', text: 'This conversation runs in a terminal on your Mac. It leaves the list when that terminal is closed.' });
          if (!workspace || workspace.status !== 'idle') return;
          workspace.session.save(workspace.agent.messages, workspace.agent.model);
          this.workspaces.delete(workspace.id);
          this.#remember();
          return this.send(this.snapshot(), { snapshot: true });
        default:
          return;
      }
    } catch (err) {
      this.send({ t: 'toast', text: err.message });
    }
  }

  // ── sessions running in a terminal on this machine ──
  async #serveLink() {
    if (!this.linkFile) return;
    try {
      this.linkServer = await listenLink(this.linkFile, (socket) => this.#joined(socket));
      if (!this.linkServer) this.log('another `seeker remote` is already taking terminal sessions; this one will not');
    } catch (err) {
      this.log(`terminal sessions cannot join (${err.code ?? err.message})`);
    }
  }

  #joined(socket) {
    let workspace = null;
    socket.on('error', () => {});
    readLines(socket, (message) => {
      if (message.t === 'hello') {
        const ws = message.ws;
        if (!sameKey(message.key, this.linkServer?.key)) return socket.destroy();
        if (workspace || typeof ws?.id !== 'string' || !/^[a-f0-9]{10}$/.test(ws.id) || this.workspaces.has(ws.id) || typeof ws.status !== 'string') return socket.destroy();
        workspace = new LinkedWorkspace(socket, ws);
        this.workspaces.set(workspace.id, workspace);
        this.log(`terminal session joined: ${workspace.name}`);
        return this.send(this.snapshot(), { snapshot: true });
      }
      if (!workspace) return socket.destroy();
      if (message.t === 'send' && message.event && typeof message.event === 'object') {
        const event = message.event;
        // A terminal speaks for itself only.
        if (event.t === 'toast') return this.send({ t: 'toast', text: String(event.text ?? '').slice(0, 300) });
        if (event.t === 'ws') {
          workspace.track(event);
          return this.send({ t: 'ws', ws: workspace.meta() });
        }
        if (event.t !== 'item' && event.t !== 'patch') return;
        workspace.track(event);
        return this.send({ ...event, ws: workspace.id });
      }
      if (message.t === 'ask' && typeof message.approval?.id === 'string' && !this.approvals.has(message.approval.id)) {
        const approval = { ...message.approval, ws: workspace.id, wsName: workspace.name };
        return this.ask(approval).then((answer) => writeLine(socket, { t: 'answer', id: approval.id, answer }));
      }
      if (message.t === 'unask' && this.approvals.get(message.id)?.approval.ws === workspace.id) return this.#settle(message.id, null);
      if (message.t === 'notify' && message.payload && typeof message.payload === 'object') return this.notify(message.payload, typeof message.kind === 'string' ? message.kind : undefined);
    });
    socket.once('close', () => {
      if (!workspace) return;
      for (const [id, entry] of this.approvals) if (entry.approval.ws === workspace.id) this.#settle(id, null);
      this.workspaces.delete(workspace.id);
      this.log(`terminal session left: ${workspace.name}`);
      if (this.running) this.send(this.snapshot(), { snapshot: true });
    });
  }

  /** Runs until stop(): keeps the command stream to the relay open, reconnecting when it drops. */
  async start() {
    this.running = true;
    await this.#serveLink();
    for (const folder of this.folders) {
      await this.openWorkspace(folder).catch((err) => this.log(`skipped ${folder}: ${err.message}`));
    }
    let wait = 1000;
    while (this.running) {
      this.stream = new AbortController();
      try {
        const res = await fetch(`${this.url}/agent/stream`, { headers: this.#headers(), signal: this.stream.signal });
        if (res.status === 401) throw Object.assign(new Error('The relay rejected this machine. Check that SEEKER_REMOTE_AUTH on the relay is the value from `seeker remote --setup`.'), { fatal: true });
        if (res.status === 429) throw Object.assign(new Error('The relay has locked this address out after wrong attempts. Wait 15 minutes.'), { fatal: true });
        if (!res.ok) throw new Error(`relay answered HTTP ${res.status}`);
        this.log('connected to the relay');
        wait = 1000;
        this.send(this.snapshot(), { snapshot: true });
        let buffer = '';
        const decoder = new TextDecoder();
        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (/^event: command$/m.test(block) && data) await this.#command(JSON.parse(data).c);
          }
        }
        throw new Error('the connection closed');
      } catch (err) {
        if (!this.running) break;
        if (err.fatal) throw err;
        this.log(`relay: ${err.cause?.code ?? err.message} — reconnecting in ${Math.round(wait / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, wait));
        wait = Math.min(wait * 2, 30_000);
      }
    }
  }

  async stop() {
    if (!this.running) return;
    for (const workspace of this.workspaces.values()) {
      if (workspace.linked) {
        workspace.socket.destroy(); // the terminal carries on by itself
        continue;
      }
      workspace.stop();
      workspace.session.save(workspace.agent.messages, workspace.agent.model);
    }
    this.linkServer?.close();
    if (this.linkServer && this.linkFile) for (const file of [this.linkFile, `${this.linkFile}.key`]) fs.rmSync(file, { force: true });
    for (const id of [...this.approvals.keys()]) this.#settle(id, null);
    this.running = false;
    this.stream?.abort();
  }
}

/** Keeps the Mac from idle-sleeping for as long as this process lives. */
export function stayAwake() {
  if (process.platform !== 'darwin') return;
  const child = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/** Creates the shared secret if there is none yet, and returns what the relay and the phone each need. */
export function remoteCredentials(config) {
  if (!config.remote?.secret) {
    config.remote = { ...(config.remote ?? {}), secret: crypto.randomBytes(32).toString('base64url') };
    saveConfig({ remote: config.remote });
  }
  const { authHash } = deriveKeys(config.remote.secret);
  const url = config.remote.url ? String(config.remote.url).replace(/\/+$/, '') : null;
  return { authHash, url, phoneLink: url ? `${url}/#k=${config.remote.secret}` : null };
}
