// Slash commands for the interactive prompt.
import { saveClipboardImage } from './images.mjs';
import { SETTINGS, saveConfig, saveProviderConfig } from './config.mjs';
import { isConnectionRefused } from './http.mjs';
import { serverFingerprint } from './mcp.mjs';
import { configMenu, pickList } from './menu.mjs';
import { apiKey, createProvider, needsKey, providerDefs } from './providers.mjs';
import { renderSkill } from './skills.mjs';
import { contextSize, kilo } from './ui.mjs';

const INIT_PROMPT = `Explore this project (list the root, read the README and the main manifest/config files, look at the folder structure) and then write a SEEKER.md file in the working directory. It should give a future coding session what it needs: what the project is, the tech stack, how to install / run / test / build it (exact commands), the folder layout, and conventions or gotchas visible in the code. Keep it under 80 lines and include only what you verified.`;

export const COMMANDS = [
  ['/init', 'Set up project context (writes SEEKER.md)'],
  ['/model', 'Switch provider and model (local or cloud)'],
  ['/key', 'Set the API key for a cloud provider'],
  ['/resume', 'Continue a saved session'],
  ['/paste', 'Send the image on the clipboard (a screenshot), with an optional message'],
  ['/config', 'Open settings'],
  ['/skills', 'List skills — run one with /<name>'],
  ['/mcp', 'Tool servers (browser, PDF, …): see them, switch one on or off'],
  ['/clear', 'Start a new conversation'],
  ['/compact', 'Summarise the conversation to free up context'],
  ['/status', 'Show model and context usage'],
  ['/think', 'Toggle thinking mode'],
  ['/yolo', 'Toggle running edits and commands without asking'],
  ['/help', 'Show this help'],
  ['/exit', 'Quit'],
];

const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;

export function resolveModel(name, models) {
  return models.find((m) => m.name === name) ?? models.find((m) => m.name.split(':')[0] === name) ?? null;
}

/** Commands and skills whose name starts with what has been typed so far. */
export function matchCommands(text, skills) {
  if (!/^\/\S*$/.test(text)) return [];
  const all = [...COMMANDS, ...skills.map((s) => [`/${s.name}`, s.description])];
  return all.filter(([name]) => name.startsWith(text.toLowerCase()));
}

/** Makes `model` on `provider` the active one, now and for the next start. */
export async function switchModel(provider, model, { agent, config }) {
  const info = await provider.describe(model);
  agent.setModel(model, info, provider);
  agent.usedTokens = 0;
  agent.lastStats = null;
  config.provider = provider.id;
  config.model = model;
  saveConfig({ provider: provider.id, model });
  saveProviderConfig(config, provider.id, { model });
}

/** Asks for a provider's API key (typed hidden) and stores it. Returns false if the user backed out. */
async function askKey(def, { term, ui, config }) {
  if (def.env && process.env[def.env]) ui.notice(`  ${def.env} is set in your shell and takes priority over a stored key.`);
  const key = await term.ask(`Paste your ${def.label} API key (hidden) — empty to cancel`, { mask: true });
  if (!key) return false;
  saveProviderConfig(config, def.id, { apiKey: key });
  ui.notice(`  ${def.label} key saved to ~/.seeker/config.json (readable only by you).`);
  return true;
}

function providerStatus(def, { agent, config }) {
  const where = def.local ? 'local' : 'cloud';
  if (def.id === agent.provider.id) return `${where} · active`;
  if (def.local) return where;
  if (def.kind === 'claude-code') return `${where} · your Claude Code login and its own tools, no key`;
  if (apiKey(def, config)) return `${where} · key set`;
  return def.kind === 'anthropic' ? `${where} · needs a key (or \`ant auth login\`)` : `${where} · needs an API key`;
}

/** The /model flow: pick a provider, give its key if it needs one, pick one of the models it lists. */
async function chooseModel(ctx) {
  const { agent, ui, term, config } = ctx;
  const defs = providerDefs(config);
  const at = await pickList({
    term,
    ui,
    title: 'Where should the model run?',
    items: defs.map((d) => ({ label: d.label, hint: providerStatus(d, ctx) })),
    initial: defs.findIndex((d) => d.id === agent.provider.id),
  });
  if (at === -1) return;
  const def = defs[at];
  if (needsKey(def, config) && !(await askKey(def, ctx))) return;

  const provider = def.id === agent.provider.id ? agent.provider : createProvider(def.id, config);
  let models;
  ui.startSpinner(`Asking ${def.label} for its models`);
  try {
    models = await provider.listModels();
  } catch (err) {
    ui.stopSpinner();
    if (isConnectionRefused(err)) return ui.warn(`  ${def.label} is not running at ${config.providers?.[def.id]?.baseUrl ?? def.baseUrl ?? config.host}.`);
    return ui.warn(`  ${err.message}${def.local ? '' : '\n  Set or replace the key with /key.'}`);
  }
  ui.stopSpinner();
  if (!models.length) return ui.warn(`  ${def.label} lists no chat models.`);

  const saved = def.id === agent.provider.id ? agent.model : (config.providers?.[def.id]?.model ?? def.defaultModel);
  const index = await pickList({
    term,
    ui,
    title: `${def.label} — ${models.length} model${models.length > 1 ? 's' : ''}`,
    items: models.map((m) => ({
      label: m.name,
      hint: [m.title, m.size ? `${(m.size / 1e9).toFixed(1)} GB` : null, m.context ? `${contextSize(m.context)} context` : null, m.name === agent.model && def.id === agent.provider.id ? 'active' : null]
        .filter(Boolean)
        .join(' · '),
    })),
    initial: Math.max(0, models.findIndex((m) => m.name === saved)),
    filter: models.length > 10,
  });
  if (index === -1) return;
  await switchModel(provider, models[index].name, ctx);
  ui.notice(`  Model: ${models[index].name} via ${def.label}`);
  const servers = def.kind === 'claude-code' ? 'Anthropic, through your Claude Code login and its usage limits' : `${def.label}'s servers`;
  if (!def.local) ui.warn(`  Your messages and the files SEEKER reads are now sent to ${servers}.`);
  if (!agent.caps.tools) ui.warn('  ⚠ This model cannot call tools — it can only chat.');
}

/** Saves one setting and pushes it into the running session. */
export async function applySetting(key, value, ctx) {
  const { agent, ui, config, permissions } = ctx;
  if (key === 'model') {
    await switchModel(agent.provider, value, ctx);
    if (!agent.caps.tools) throw new Error(`${value} is active but cannot call tools (chat only)`);
    return;
  }
  config[key] = value;
  saveConfig({ [key]: value });
  if (key === 'permissionMode') permissions.mode = value;
  if (key === 'showThinking') ui.showThinking = value;
  if (key === 'animation') {
    ui.animation = value;
    ui.startMascot();
    ui.screen?.render();
  }
}

/**
 * @returns {Promise<'exit' | { prompt: string, label?: string } | void>} `prompt` means: run this as the next user message.
 */
export async function runCommand(input, ctx) {
  const { agent, ui, term, config, permissions, session, hub } = ctx;
  const [name, ...rest] = input.slice(1).trim().split(/\s+/);
  const arg = rest.join(' ');
  const { c } = ui;
  const apply = (k, v) => applySetting(k, v, ctx);

  switch (name.toLowerCase()) {
    case 'help':
    case '?':
      for (const [cmd, text] of COMMANDS) ui.line(`  ${c.accent(cmd.padEnd(12))} ${text}`);
      ui.line(`  ${c.accent('!command'.padEnd(12))} Run a shell command yourself`);
      ui.line(`\n  ${c.dim('Alt+Enter (or a trailing \\) starts a new line · ↑↓ recalls earlier messages · Tab completes a command')}`);
      return;

    case 'exit':
    case 'quit':
    case 'q':
      return 'exit';

    case 'clear':
    case 'new':
      agent.messages = [];
      agent.state.todos = [];
      agent.usedTokens = 0;
      session.startNew();
      ui.notice('  Started a new conversation.');
      return;

    case 'compact':
      if (!(await agent.compact())) ui.notice('  Nothing to summarise yet.');
      return;

    case 'ctx':
    case 'status': {
      if (arg) {
        const n = SETTINGS.numCtx.parse(arg);
        if (n === undefined) return ui.warn('  /ctx needs a token count of at least 2048');
        if (agent.provider.kind === 'ollama') await apply('numCtx', n);
        else saveProviderConfig(config, agent.provider.id, { contextWindow: n });
      }
      const used = agent.contextTokens();
      const limit = agent.contextLimit();
      ui.line(`  ${c.dim('provider')} ${agent.provider.label} ${c.dim(agent.provider.local ? '(local)' : '(cloud)')}`);
      ui.line(`  ${c.dim('model   ')} ${agent.model}`);
      ui.line(`  ${c.dim('context ')} ${kilo(used)} / ${contextSize(limit)} tokens (${Math.round((used / limit) * 100)}%)`);
      ui.line(`  ${c.dim('thinking')} ${config.think && agent.caps.thinking ? 'on' : 'off'}`);
      ui.line(`  ${c.dim('images  ')} ${agent.provider.ownTools || agent.caps.vision ? 'yes' : 'no, this model cannot see images'}`);
      ui.line(`  ${c.dim('approval')} ${permissions.mode === 'auto' ? 'automatic (YOLO)' : 'ask first'}`);
      return;
    }

    case 'think':
      if (!agent.caps.thinking) return ui.warn(`  ${agent.model} has no thinking mode`);
      await apply('think', !config.think);
      ui.notice(`  Thinking mode ${config.think ? 'on' : 'off'}.`);
      return;

    case 'yolo':
      permissions.mode = permissions.mode === 'auto' ? 'ask' : 'auto';
      ui.notice(
        permissions.mode === 'auto'
          ? '  YOLO on: edits and commands run without asking (risky commands are still confirmed).'
          : '  YOLO off: SEEKER asks before editing files or running commands.',
      );
      return;

    case 'init':
      return { prompt: INIT_PROMPT, label: '/init' };

    case 'paste': {
      let file;
      try {
        file = saveClipboardImage();
      } catch (err) {
        return ui.warn(`  ${err.message}`);
      }
      return { prompt: `${arg || 'Look at this image.'} "${file}"` };
    }

    case 'provider':
    case 'model': {
      if (!arg) return chooseModel(ctx);
      const models = await agent.provider.listModels();
      const picked = resolveModel(arg, models);
      if (!picked) {
        const hint = agent.provider.kind === 'ollama' ? `run: ollama pull ${arg}` : 'type /model to pick from the list';
        return ui.warn(`  "${arg}" is not a model on ${agent.provider.label} — ${hint}`);
      }
      try {
        await apply('model', picked.name);
        ui.notice(`  Model: ${picked.name} via ${agent.provider.label}`);
      } catch (err) {
        ui.warn(`  ⚠ ${err.message}`);
      }
      return;
    }

    case 'key': {
      const defs = providerDefs(config).filter((d) => !d.local && d.kind !== 'claude-code');
      const at = await pickList({
        term,
        ui,
        title: 'Set an API key for…',
        items: defs.map((d) => ({ label: d.label, hint: apiKey(d, config) ? 'key set — will be replaced' : `no key${d.env ? ` (or export ${d.env})` : ''}` })),
        initial: Math.max(0, defs.findIndex((d) => d.id === agent.provider.id)),
      });
      if (at !== -1) await askKey(defs[at], ctx);
      return;
    }

    case 'resume': {
      const saved = session.list();
      if (!saved.length) return ui.notice('  No saved sessions for this folder yet.');
      const index = await pickList({
        term,
        ui,
        title: 'Continue a session',
        items: saved.map((s) => ({ label: s.preview, hint: `${s.when} · ${s.count} messages` })),
      });
      if (index === -1) return;
      const messages = session.load(saved[index].file);
      if (!messages) return ui.warn('  That session could not be read.');
      agent.messages = messages;
      agent.usedTokens = 0;
      ui.notice(`  Resumed: ${saved[index].preview} (${messages.length} messages)`);
      return;
    }

    case 'mcp': {
      const servers = hub.status();
      if (!servers.length) {
        ui.line(`  ${c.dim('No MCP servers are set up. Add them under "mcpServers" in ~/.seeker/config.json (or .seeker/mcp.json in a project):')}`);
        ui.line('    "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] }');
        return;
      }
      if (agent.provider.ownTools) ui.notice(`  ${agent.provider.label} runs its own tools; these servers are used with the other providers.`);
      const describe = (s) => (s.status === 'ready' ? `on · ${s.tools} tools` : s.status === 'failed' ? `failed · ${s.error}` : s.status === 'disabled' ? 'off' : s.status === 'untrusted' ? 'from this project · not approved' : s.status);
      const at = await pickList({ term, ui, title: 'Tool servers — Enter switches one on or off', items: servers.map((s) => ({ label: s.name, hint: describe(s) })) });
      if (at === -1) return;
      const { name, status } = servers[at];
      const entry = hub.servers.get(name);
      const turnOn = status !== 'ready';
      if (entry.config.untrusted) {
        // Show exactly what would run before anything does.
        const { command, args = [], env, url } = entry.config;
        ui.line(`  ${c.dim(`${name} is defined by this project (.seeker/mcp.json), not by you. Starting it runs:`)}`);
        ui.line(`    ${url ? url : [command, ...args].join(' ')}`);
        if (env && Object.keys(env).length) ui.line(`    ${c.dim(`with ${Object.keys(env).join(', ')} set`)}`);
        const choice = await pickList({ term, ui, title: `Trust ${name} in this folder?`, items: [{ label: 'No, leave it off' }, { label: 'Yes, start it now and from now on' }] });
        if (choice !== 1) return ui.notice(`  ${name} left off.`);
        const { untrusted, ...rest } = entry.config;
        config.trustedMcp = [...new Set([...(config.trustedMcp ?? []), serverFingerprint(agent.cwd, name, rest)])];
        saveConfig({ trustedMcp: config.trustedMcp });
        entry.config = rest;
      }
      // Remembered for next time, but only for servers that come from the user's own config.
      if (config.mcpServers?.[name]) {
        const { disabled, ...rest } = config.mcpServers[name];
        config.mcpServers = { ...config.mcpServers, [name]: turnOn ? rest : { ...rest, disabled: true } };
        saveConfig({ mcpServers: config.mcpServers });
        entry.config = config.mcpServers[name];
      }
      if (!turnOn) {
        await hub.disconnect(name);
        entry.status = 'disabled';
        return ui.notice(`  ${name} switched off.`);
      }
      ui.startSpinner(`Starting ${name}`);
      const result = await hub.connect(name);
      ui.stopSpinner();
      if (result === 'ready') ui.notice(`  ${name} is on: ${entry.tools.length} tools, named mcp__${name}__…`);
      else ui.warn(`  ${name} could not start: ${entry.error}`);
      return;
    }

    case 'skill':
    case 'skills': {
      agent.reload();
      if (!agent.skills.length) {
        ui.line(`  ${c.dim('No skills yet. Create one:')}`);
        ui.line(`    ~/.seeker/skills/<name>/SKILL.md      ${c.dim('available in every project')}`);
        ui.line(`    .seeker/skills/<name>/SKILL.md        ${c.dim('this project only')}`);
        ui.line(`  ${c.dim('The file needs `name` and `description` frontmatter, then the instructions.')}`);
        return;
      }
      const at = await pickList({
        term,
        ui,
        title: `Skills — ${agent.skills.length}`,
        items: agent.skills.map((s) => ({ label: `/${s.name}`, hint: s.description })),
        filter: agent.skills.length > 10,
      });
      if (at === -1) return;
      const picked = agent.skills[at];
      ui.notice(`  Running /${picked.name}`);
      return { prompt: renderSkill(picked, arg), label: `/${picked.name}` };
    }

    case 'configure':
    case 'settings':
    case 'config': {
      const [key, ...valueParts] = rest;
      if (!key) {
        const modelNames = await agent.provider.listModels().then((list) => list.map((m) => m.name), () => [agent.model]);
        await configMenu({ term, ui, config, modelNames, apply });
        return;
      }
      const setting = SETTINGS[key];
      if (!setting) return ui.warn(`  Unknown setting: ${key} — type /config to open the menu`);
      if (key === 'model') return runCommand(`/model ${valueParts.join(' ')}`, ctx);
      const value = setting.parse(valueParts.join(' '));
      if (value === undefined) return ui.warn(`  Not a valid value for ${key} (${setting.help})`);
      await apply(key, value);
      ui.notice(`  ${key} = ${value} (saved)`);
      return;
    }

    default: {
      const skill = agent.skills.find((s) => s.name === name.toLowerCase());
      if (skill) return { prompt: renderSkill(skill, arg), label: `/${skill.name}${arg ? ` ${arg}` : ''}` };
      ui.warn(`  Unknown command: /${name} — type /help`);
    }
  }
}
