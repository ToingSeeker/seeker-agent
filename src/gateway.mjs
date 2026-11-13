// `seeker gateway`: SEEKER reached through a chat app. Each chat is its own
// conversation with its own agent, working in the folder the gateway was
// started in. Platforms live in src/platforms/ and are loaded only when they
// are configured.
//
// Config (~/.seeker/config.json), or the tokens from the environment:
//   "gateway": {
//     "telegram": { "token": "…", "allow": ["123456789"] },          TELEGRAM_BOT_TOKEN
//     "discord":  { "token": "…", "allow": ["2233445566778899"] },   DISCORD_BOT_TOKEN
//     "slack":    { "botToken": "xoxb-…", "appToken": "xapp-…", "allow": ["U012ABCDEF"] }   SLACK_BOT_TOKEN, SLACK_APP_TOKEN
//   }
//
// Nobody is let in by default: only the user ids in `allow` are answered, and a
// stranger is told their own id so the owner can add it. Edits and commands are
// asked about in the chat, exactly as in the terminal; "run without asking" is
// never available from a chat, because a phone can be lost or borrowed.
import { Agent } from './agent.mjs';
import { Permissions } from './permissions.mjs';
import { createProvider } from './providers.mjs';
import { Session } from './session.mjs';

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const TYPING_EVERY_MS = 4500;
const MAX_STEPS_SHOWN = 12;

const PLATFORMS = {
  telegram: { module: './platforms/telegram.mjs', env: { token: 'TELEGRAM_BOT_TOKEN' }, needs: ['token'] },
  discord: { module: './platforms/discord.mjs', env: { token: 'DISCORD_BOT_TOKEN' }, needs: ['token'] },
  slack: { module: './platforms/slack.mjs', env: { botToken: 'SLACK_BOT_TOKEN', appToken: 'SLACK_APP_TOKEN' }, needs: ['botToken', 'appToken'] },
};

const HELP = `SEEKER — send a message and I work on it in the project folder.
/new     start a fresh conversation
/stop    stop what I am doing
/status  model, folder and whether I am busy
Before I edit a file or run a command I ask here; answer y, n or say what to do instead.`;

/** The platforms that have what they need, with their settings: [{ name, settings, allow }]. */
export function configuredPlatforms(config, env = process.env) {
  const found = [];
  for (const [name, spec] of Object.entries(PLATFORMS)) {
    const own = config.gateway?.[name] ?? {};
    const settings = { ...own };
    for (const [key, variable] of Object.entries(spec.env)) settings[key] = own[key] || env[variable] || '';
    if (!spec.needs.every((key) => settings[key])) continue;
    found.push({ name, settings, allow: new Set((Array.isArray(own.allow) ? own.allow : []).map(String)) });
  }
  return found;
}

/** Cuts a long answer into pieces a platform accepts, at a line break where there is one. */
export function splitMessage(text, limit) {
  const parts = [];
  let rest = String(text).trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

const answerOf = (text) => {
  const lower = text.trim().toLowerCase();
  if (['y', 'yes', 'ya', 'iya', 'ok', 'oke'].includes(lower)) return 'y';
  if (['a', 'always', 'selalu'].includes(lower)) return 'a';
  if (['n', 'no', 'tidak', 'g', 'ga', 'gak', 'nggak'].includes(lower)) return 'n';
  return text.trim();
};

/** What the agent does, gathered as plain text for one chat reply. */
function chatUi() {
  const plain = new Proxy({}, { get: () => (text) => text });
  const state = { answer: '', steps: [], notes: [], current: '', diff: '' };
  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const handlers = {
    c: plain,
    answerStream: () => ({ push: (text) => (state.answer += text), flush() {} }),
    toolStart: (doing, _done, summary) => {
      state.current = `${doing} ${clean(summary).slice(0, 160)}`.trim();
      state.diff = '';
    },
    diff: ({ removed = [], added = [], more = 0 }) => {
      const lines = [...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].slice(0, 16);
      state.diff = `${lines.join('\n')}${more ? `\n… ${more} more lines` : ''}`;
    },
    toolDone: () => state.steps.push(`✓ ${state.current}`),
    toolFail: (why) => state.steps.push(`✖ ${state.current} — ${clean(why).slice(0, 160)}`),
    warn: (text) => state.notes.push(clean(text)),
    error: (text) => state.notes.push(clean(text)),
  };
  const ui = new Proxy(handlers, { get: (target, key) => (key in target ? target[key] : key === 'tool' ? null : () => {}) });
  return { ui, state };
}

export class Gateway {
  /**
   * @param {object} opts
   * @param {object} opts.config
   * @param {string} opts.cwd                 the folder every chat works in
   * @param {object} opts.info                what the model can do
   * @param {{ name: string, adapter: object, allow: Set<string> }[]} opts.platforms
   * @param {() => object[]} [opts.tools]     extra tools (MCP servers)
   * @param {(line: string) => void} [opts.log]
   */
  constructor({ config, cwd, info, platforms, tools = () => [], log = () => {} }) {
    Object.assign(this, { config, cwd, info, platforms, tools, log });
    this.chats = new Map();
    this.told = new Set(); // strangers who were already given their id
  }

  /** Runs every platform until stop(); a platform that cannot start is reported and the others carry on. */
  async start() {
    await Promise.all(
      this.platforms.map(async (platform) => {
        try {
          await platform.adapter.start((message) => this.receive(platform, message).catch((err) => this.log(`${platform.name} · error: ${err.message}`)));
        } catch (err) {
          this.log(`${platform.name} · stopped: ${err.message}`);
        }
      }),
    );
  }

  stop() {
    for (const chat of this.chats.values()) {
      chat.waiting?.(null);
      chat.agent.interrupt();
    }
    for (const platform of this.platforms) platform.adapter.stop();
  }

  #chat(platform, id) {
    const key = `${platform.name}:${id}`;
    let chat = this.chats.get(key);
    if (chat) return chat;
    const { ui, state } = chatUi();
    const say = (text) => this.#send(platform, id, text);
    chat = { key, ui, state, waiting: null, owner: null };
    /** Sends a question and resolves with the next message of the person the turn belongs to. */
    const question = (text) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => chat.waiting?.(null), APPROVAL_TIMEOUT_MS);
        timer.unref?.();
        chat.waiting = (reply) => {
          clearTimeout(timer);
          chat.waiting = null;
          resolve(reply);
        };
        say(text).catch(() => chat.waiting?.(null));
      });
    const ask = async ({ warning, always }) => {
      const what = [state.current, state.diff, warning ? `⚠ ${warning}` : ''].filter(Boolean).join('\n');
      const reply = await question(`${what}\n\nAllow?  y = yes${always ? ` · a = ${always}` : ''} · n = no · or say what to do instead`);
      return reply === null ? null : answerOf(reply);
    };
    // Always asks: a chat never gets the "run without asking" mode, whatever the setting is.
    const permissions = new Permissions({ mode: 'ask', cwd: this.cwd, ask, autoLearn: this.config.autoLearn });
    const agent = new Agent({ config: this.config, ui, permissions, provider: createProvider(this.config.provider, this.config), info: this.info, cwd: this.cwd });
    agent.setExtraTools(this.tools());
    agent.session = new Session(this.cwd);
    agent.hooks.askUser = async ({ question: text, options }) => {
      const list = Array.isArray(options) && options.length ? `\n${options.map((o, i) => `${i + 1}. ${typeof o === 'string' ? o : (o.label ?? '')}`).join('\n')}` : '';
      const reply = await question(`❓ ${text}${list}`);
      const picked = reply !== null && /^\d+$/.test(reply.trim()) ? options?.[Number(reply.trim()) - 1] : null;
      return picked ? (typeof picked === 'string' ? picked : (picked.label ?? reply)) : reply;
    };
    chat.agent = agent;
    this.chats.set(key, chat);
    return chat;
  }

  async #send(platform, id, text) {
    for (const part of splitMessage(text, platform.adapter.limit)) await platform.adapter.send(id, part);
  }

  /** @param {{ chat: string, user: string, userName?: string, text: string }} message */
  async receive(platform, { chat: id, user, userName = '', text }) {
    const say = (reply) => this.#send(platform, id, reply);
    if (!platform.allow.has(String(user))) {
      const who = `${platform.name}:${user}`;
      if (this.told.has(who)) return;
      this.told.add(who);
      this.log(`${platform.name} · refused ${userName || 'someone'} (id ${user}), who is not on the allow list`);
      return say(`This is a private SEEKER. Your ${platform.name} id is ${user} — its owner can let you in by adding it to gateway.${platform.name}.allow in ~/.seeker/config.json.`);
    }
    const body = text.trim();
    if (!body) return;
    const chat = this.#chat(platform, id);
    const command = /^\/([a-z]+)(?:@\S+)?\s*$/i.exec(body)?.[1]?.toLowerCase();

    if (command === 'stop') {
      if (!chat.agent.busy) return say('Nothing is running.');
      chat.waiting?.(null);
      chat.agent.interrupt();
      return;
    }
    if (chat.waiting) {
      // Only the person whose turn it is may answer its questions.
      if (String(user) !== chat.owner) return say('Waiting for an answer from the person who asked for this.');
      return chat.waiting(body);
    }
    if (command === 'start' || command === 'help') return say(HELP);
    if (command === 'status') return say(`${this.config.model} via ${chat.agent.provider.label}\nFolder: ${this.cwd}\n${chat.agent.busy ? 'Working.' : 'Idle.'} ${chat.agent.messages.length} messages in this conversation.`);
    if (chat.agent.busy) return say('Still working on the last message — send /stop to interrupt it.');
    if (command === 'new') {
      chat.agent.messages = [];
      chat.agent.session.startNew();
      return say('Started a fresh conversation.');
    }

    chat.owner = String(user);
    Object.assign(chat.state, { answer: '', steps: [], notes: [], current: '', diff: '' });
    this.log(`${platform.name} · ${userName || user}: ${body.replace(/\s+/g, ' ').slice(0, 80)}`);
    const typing = platform.adapter.typing ? setInterval(() => platform.adapter.typing(id).catch(() => {}), TYPING_EVERY_MS) : null;
    platform.adapter.typing?.(id).catch(() => {});
    try {
      await chat.agent.runTurn(body, { references: true });
      chat.agent.session.save(chat.agent.messages, chat.agent.model);
    } catch (err) {
      chat.state.notes.push(err.message);
    } finally {
      clearInterval(typing);
    }
    const { steps, notes, answer } = chat.state;
    const shown = steps.length > MAX_STEPS_SHOWN ? [`… ${steps.length - MAX_STEPS_SHOWN} earlier steps`, ...steps.slice(-MAX_STEPS_SHOWN)] : steps;
    const reply = [shown.join('\n'), answer.trim(), notes.join('\n'), chat.agent.interrupted ? '(stopped)' : ''].filter(Boolean).join('\n\n');
    await say(reply || '(no answer)');
  }
}

/** Builds the gateway for the platforms the config names; null when none is set up. */
export async function createGateway({ config, cwd, info, tools, log, env = process.env, adapterOptions = {} }) {
  const platforms = [];
  for (const { name, settings, allow } of configuredPlatforms(config, env)) {
    const { default: create } = await import(PLATFORMS[name].module);
    platforms.push({ name, allow, adapter: create({ ...settings, ...adapterOptions, log: (line) => log?.(`${name} · ${line}`) }) });
    if (!allow.size) log?.(`${name} · nobody is on the allow list yet: message the bot once and it will tell you your id`);
  }
  return platforms.length ? new Gateway({ config, cwd, info, platforms, tools, log }) : null;
}
