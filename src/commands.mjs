// Slash commands for the interactive prompt.
import { saveClipboardImage } from './images.mjs';
import { SETTINGS, saveConfig, saveProviderConfig } from './config.mjs';
import { isConnectionRefused } from './http.mjs';
import { serverFingerprint } from './mcp.mjs';
import { configMenu, pickList } from './menu.mjs';
import { apiKey, createProvider, keyPool, needsKey, providerDefs } from './providers.mjs';
import { renderSkill } from './skills.mjs';
import { contextSize, kilo } from './ui.mjs';

const INIT_PROMPT = `Explore this project (list the root, read the README and the main manifest/config files, look at the folder structure) and then write a SEEKER.md file in the working directory. It should give a future coding session what it needs: what the project is, the tech stack, how to install / run / test / build it (exact commands), the folder layout, and conventions or gotchas visible in the code. Keep it under 80 lines and include only what you verified.`;

export const COMMANDS = [
  ['/init', 'Set up project context (writes SEEKER.md)'],
  ['/model', 'Switch provider and model (local or cloud)'],
  ['/key', 'Set the API key for a cloud provider'],
  ['/resume', 'Continue a saved session'],
  ['/rollback', 'Undo file changes: restore a checkpoint taken before SEEKER edited (/rollback diff 2, /rollback 2 src/app.js)'],
  ['/goal', 'Set a goal SEEKER keeps working on until it is done (/goal pause · resume · clear)'],
  ['/loop', 'Re-run a prompt: /loop 5m check the deploy · /loop <prompt> paces itself (--times N, --until …)'],
  ['/heartbeat', 'Re-enter this session when idle: /heartbeat every 10m <instruction>'],
  ['/cron', 'Scheduled jobs: list them, pause, resume or remove one'],
  ['/hooks', 'Your shell hooks: see them and approve one to let it run'],
  ['/memory', 'Show what SEEKER remembers across sessions'],
  ['/curator', 'Skills SEEKER wrote itself: usage, tidy up now, pin one'],
  ['/paste', 'Send the image on the clipboard (a screenshot), with an optional message'],
  ['/config', 'Open settings'],
  ['/skills', 'List skills — run one with /<name>'],
  ['/mcp', 'Tool servers (browser, PDF, …): see them, switch one on or off'],
  ['/clear', 'Start a new conversation'],
  ['/compact', 'Summarise the conversation to free up context'],
  ['/status', 'Show model and context usage'],
  ['/agents', 'Agents of your own: helpers with a role, a model and a set of tools'],
  ['/sandbox', 'Run shell commands in a sandbox that writes only in the project (macOS): on · off'],
  ['/effort', 'How hard the model works on a reply: low … max (Anthropic models)'],
  ['/context', 'What fills the context: instructions, tools, messages, tool results'],
  ['/usage', 'Tokens used: total, new and cached input, output, the last 7 days'],
  ['/think', 'Toggle thinking mode'],
  ['/yolo', 'Toggle running edits and commands without asking'],
  ['/plan', 'Plan first: SEEKER looks and proposes, changes nothing (/plan go carries it out · /plan off)'],
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
  const typed = text.toLowerCase();
  // The name itself first, then names that begin with what is typed, then names that contain it.
  const rank = ([name]) => (name === typed ? 0 : name.startsWith(typed) ? 1 : typed.length > 2 && name.includes(typed.slice(1)) ? 2 : 3);
  return all
    .map((entry, at) => [rank(entry), at, entry])
    .filter(([r]) => r < 3)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([, , entry]) => entry);
}

/** Makes `model` on `provider` the active one, now and for the next start. */
export async function switchModel(provider, model, { agent, config }) {
  const info = await provider.describe(model);
  agent.setModel(model, info, provider);
  agent.primary = null; // a model chosen by hand ends any stand-in by a backup
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
  if (key === 'autoLearn') permissions.autoLearn = value;
  if (key === 'showThinking') ui.showThinking = value;
  if (key === 'animation') {
    ui.animation = value;
    ui.startMascot();
    ui.screen?.render();
  }
}

const ago = (date) => {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};

/**
 * /rollback            choose a checkpoint from a list
 * /rollback 2          restore the second-newest checkpoint
 * /rollback 2 src/a.js restore one file from it
 * /rollback diff 2     show what changed since it
 */
async function rollback(given, { agent, ui, term }) {
  const { c } = ui;
  // --files: restore the files and leave the conversation as it is.
  const keepChat = given.includes('--files');
  const words = given.filter((w) => w !== '--files');
  if (agent.config.checkpoints === false) return ui.notice('  Checkpoints are off ("checkpoints": false in ~/.seeker/config.json).');
  const checkpoints = await import('./checkpoints.mjs');
  const all = await checkpoints.list(agent.cwd);
  if (!all.length) return ui.notice('  No checkpoints for this folder yet. One is taken before SEEKER first changes a file in a message.');
  const numbered = (word) => (/^\d+$/.test(word ?? '') && all[Number(word) - 1]) || null;
  const describe = (cp) => `${ago(cp.when)}${cp.files ? ` · ${cp.files} file${cp.files > 1 ? 's' : ''} +${cp.added} −${cp.removed}` : ''}`;

  if (words[0] === 'diff') {
    const cp = numbered(words[1]);
    if (!cp) return ui.warn(`  /rollback diff <number> — there are ${all.length} checkpoints`);
    const changes = await checkpoints.diff(agent.cwd, cp.id);
    if (!changes?.stat) return ui.notice(`  Nothing has changed since checkpoint ${words[1]} (${cp.reason}).`);
    ui.line(`  ${c.dim(`Since checkpoint ${words[1]} — ${cp.reason} (${ago(cp.when)}):`)}`);
    ui.line(changes.stat.split('\n').map((l) => `  ${l}`).join('\n'));
    const lines = changes.text.split('\n');
    ui.line(lines.slice(0, 80).map((l) => (l.startsWith('+') ? c.green(l) : l.startsWith('-') ? c.red(l) : c.dim(l))).join('\n'));
    if (lines.length > 80) ui.line(c.dim(`  … ${lines.length - 80} more lines`));
    return;
  }

  let cp = numbered(words[0]);
  const file = cp ? words.slice(1).join(' ') || null : null;
  if (!cp) {
    if (words.length) return ui.warn(`  /rollback <number> [file] — there are ${all.length} checkpoints; /rollback alone lists them. Add --files to keep the conversation.`);
    const at = await pickList({ term, ui, title: 'Restore the folder to how it was…', items: all.map((x, i) => ({ label: `${i + 1}. ${x.reason}`, hint: describe(x) })) });
    if (at === -1) return;
    cp = all[at];
  }
  const result = await checkpoints.restore(agent.cwd, cp.id, file);
  if (!result.ok) return ui.warn(`  ${result.error}`);
  ui.notice(`  ↩ Restored ${file ?? 'the folder'} to checkpoint ${cp.short} (${cp.reason}, ${ago(cp.when)}).${result.removed.length ? ` Removed ${result.removed.length} file${result.removed.length > 1 ? 's' : ''} created since.` : ''}`);
  if (result.saved) ui.notice('  The state from just before this rollback is now the newest checkpoint, so it can be undone with /rollback 1.');

  // Undoing a rollback gives back the part of the conversation that rollback took away.
  if (!file && agent.rewound?.id === cp.id) {
    agent.messages.push(...agent.rewound.messages);
    ui.notice(`  The conversation is back as well (${agent.rewound.messages.length} message${agent.rewound.messages.length === 1 ? '' : 's'}).`);
    agent.rewound = null;
    agent.usedTokens = 0;
    return;
  }
  // The whole folder went back to before a message: so does the conversation, to before that message,
  // unless it was asked to stay. The model then no longer remembers changes that no longer exist.
  const at = file || keepChat ? -1 : agent.messages.findLastIndex((m) => m.role === 'user' && m.checkpoint === cp.id);
  if (at >= 0) {
    const removed = agent.messages.splice(at);
    agent.rewound = result.saved ? { id: result.saved, messages: removed } : null;
    agent.usedTokens = 0;
    const asked = removed[0].content.replace(/\s+/g, ' ').trim();
    ui.notice(`  The conversation went back too, to before "${asked.length > 60 ? `${asked.slice(0, 60)}…` : asked}" (${removed.length} message${removed.length === 1 ? '' : 's'}). /rollback ${cp ? all.indexOf(cp) + 1 : ''} --files keeps the conversation.`);
    return;
  }
  // The model still believes what it read and wrote after that point; it is told otherwise.
  if (agent.messages.length) {
    agent.messages.push(
      { role: 'user', content: `[The user rolled ${file ? `the file ${file}` : 'the working folder'} back to a checkpoint taken ${ago(cp.when)} ("${cp.reason}"). Changes made to ${file ? 'it' : 'files'} after that point are no longer on disk. Read a file again before relying on what you remember of it.]` },
      { role: 'assistant', content: 'Understood. I will re-read files before relying on their earlier contents.' },
    );
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
      ui.line(`  ${c.dim('approval')} ${permissions.planning ? 'plan mode: nothing is changed until /plan go' : permissions.mode === 'auto' ? 'automatic (YOLO)' : 'ask first'}`);
      {
        const { fallbackChain } = await import('./failover.mjs');
        const chain = fallbackChain(config);
        const keys = ['openai', 'anthropic'].includes(agent.provider.kind) ? keyPool(agent.provider, config).summary() : null;
        if (keys?.total > 1) ui.line(`  ${c.dim('api keys')} ${keys.total}${keys.resting ? ` (${keys.resting} resting after being turned away)` : ''}`);
        ui.line(`  ${c.dim('fallback')} ${chain.length ? chain.map((f) => `${f.model} via ${f.provider}`).join(' → ') : c.dim('none — add "fallback" to ~/.seeker/config.json')}`);
        if (agent.primary) ui.line(`  ${c.dim('        ')} ${c.yellow(`standing in for ${agent.primary.model} via ${agent.primary.provider.label}`)}`);
        ui.line(`  ${c.dim('undo    ')} ${config.checkpoints === false ? 'checkpoints off' : 'checkpoints on (/rollback)'}`);
        ui.line(`  ${c.dim('sandbox ')} ${config.sandbox ? 'on: shell commands write only in the project' : 'off'}`);
      }
      return;
    }

    case 'think':
      if (!agent.caps.thinking) return ui.warn(`  ${agent.model} has no thinking mode`);
      await apply('think', !config.think);
      ui.notice(`  Thinking mode ${config.think ? 'on' : 'off'}.`);
      return;

    case 'agents': {
      const { AGENTS_DIR, loadAgents, projectAgentsDir } = await import('./agents.mjs');
      // Read again, so a file added just now can be used by name. The instructions the model already has are
      // left as they are: rewriting them mid-conversation would throw away what the provider has cached.
      agent.agents = loadAgents(agent.cwd);
      if (!agent.agents.length) {
        ui.notice(`  No agents yet. An agent is a file: ${AGENTS_DIR}/<name>.md (yours) or ${projectAgentsDir(agent.cwd)}/<name>.md (this project's).`);
        return ui.notice('  It starts with ---, then name:, description:, optionally model: and tools:, then ---, then the helper\'s instructions. See the README.');
      }
      const wide = Math.max(...agent.agents.map((a) => a.name.length));
      for (const a of agent.agents) {
        ui.line(`  ${c.accent(a.name.padEnd(wide))}  ${a.description}`);
        ui.line(`  ${' '.repeat(wide)}  ${c.dim([a.source === 'project' ? 'this project' : 'yours', a.model ? `model ${a.model}` : 'the model helpers run on', a.tools ? `tools: ${a.tools.join(', ')}` : 'all tools a helper has'].join(' · '))}`);
      }
      ui.line(`  ${c.dim('SEEKER hands work to one through its task tool. Ask for it by name: "have the reviewer look at this change".')}`);
      return;
    }

    case 'sandbox': {
      const { sandboxAvailable, writablePlaces } = await import('./sandbox.mjs');
      const word = (rest[0] ?? '').toLowerCase();
      if (word === 'on' || word === 'off') {
        if (word === 'on' && !sandboxAvailable()) return ui.warn('  The sandbox needs macOS; on this machine shell commands cannot be sandboxed.');
        await apply('sandbox', word === 'on');
        return ui.notice(word === 'on' ? '  Sandbox on: shell commands write only in the project, the temporary folders and the package caches. Approvals are asked as before.' : '  Sandbox off: shell commands run with your own access.');
      }
      if (word) return ui.warn('  /sandbox on | off');
      ui.line(`  ${c.dim('sandbox')} ${config.sandbox ? 'on' : 'off'}${sandboxAvailable() ? '' : c.yellow(' — not available on this machine (needs macOS)')}`);
      if (config.sandbox && sandboxAvailable()) {
        ui.line(`  ${c.dim('network')} ${config.sandboxNetwork === false ? 'cut off' : 'allowed'}`);
        ui.line(`  ${c.dim('writes ')} ${writablePlaces(agent.cwd, { write: config.sandboxWrite ?? [] }).join('\n          ')}`);
      }
      ui.line(`  ${c.dim('It covers the shell commands SEEKER starts — not the tools of a provider that runs its own (Claude Code), and not your own !commands.')}`);
      return;
    }

    case 'effort': {
      const levels = agent.info?.effort ?? [];
      const said = (level) => level || 'the model\'s default';
      if (!arg) {
        ui.line(`  ${c.dim('effort ')} ${said(config.effort)}`);
        ui.line(`  ${c.dim(levels.length ? `${agent.model} takes: ${levels.join(', ')}. /effort <level> sets it, /effort default clears it.` : `${agent.model} has no effort setting; it applies to Anthropic models that offer one.`)}`);
        return;
      }
      const value = SETTINGS.effort.parse(arg);
      if (value === undefined) return ui.warn('  /effort low | medium | high | xhigh | max | default');
      await apply('effort', value);
      ui.notice(`  Effort: ${said(value)}.`);
      if (value && !levels.length) ui.warn(`  ${agent.model} has no effort setting, so nothing changes until a model that has one is chosen.`);
      else if (value && !levels.includes(value)) ui.warn(`  ${agent.model} does not offer "${value}"; the nearest lower level it has is used.`);
      // The level is part of the request the provider caches against.
      if (levels.length && agent.messages.length) ui.notice('  The next message is read by the provider without its cache, once.');
      return;
    }

    case 'context': {
      const b = agent.contextBreakdown();
      const share = (n) => `${((n / b.limit) * 100).toFixed(n / b.limit < 0.1 ? 1 : 0)}%`;
      const wide = Math.max(...b.parts.map((p) => p.label.length));
      ui.line(`  ${c.bold(`${kilo(b.used)} of ${contextSize(b.limit)} tokens`)} ${c.dim(`(${share(b.used)}) · ${b.messages} message${b.messages === 1 ? '' : 's'}`)}`);
      for (const p of b.parts) {
        const cells = Math.max(p.tokens ? 1 : 0, Math.round((p.tokens / b.limit) * 30));
        ui.line(`  ${p.label.padEnd(wide)}  ${kilo(p.tokens).padStart(7)}  ${share(p.tokens).padStart(5)}  ${c.accent('█'.repeat(cells))}`);
      }
      const free = Math.max(0, b.limit - b.used);
      ui.line(`  ${c.dim(`${'Free'.padEnd(wide)}  ${kilo(free).padStart(7)}  ${share(free).padStart(5)}`)}`);
      ui.line(`  ${c.dim(b.used >= b.ceiling ? `Over ${kilo(b.ceiling)}: the conversation is summarised at the next step.` : `Summarised at ${kilo(b.ceiling)} tokens (${kilo(b.ceiling - b.used)} to go). /compact does it now.`)}`);
      ui.line(`  ${c.dim('Sizes are estimates from the text; the total uses the model\'s own count when it has one.')}`);
      return;
    }

    case 'usage': {
      const { usageSummary } = await import('./usage.mjs');
      const { view, compact, percent, dayLabel } = await import('../remote-server/public/usage.js');
      const v = view(usageSummary(), { range: '7' });
      if (v.empty) return ui.notice('  No token usage recorded yet. Counts appear after the first reply of a model.');
      const t = v.lifetime;
      ui.line(`  ${c.bold(`${compact(t.total)} tokens`)} ${c.dim(`(${t.total.toLocaleString()})${v.sinceDay ? ` since ${v.sinceDay}` : ''}`)}`);
      ui.line(`  ${c.dim('new input   ')} ${compact(t.newInput).padStart(8)}`);
      ui.line(`  ${c.dim('cached input')} ${(t.cacheRatio == null ? '—' : compact(t.cachedInput)).padStart(8)}  ${c.dim(t.cacheRatio == null ? 'not reported by the provider' : `${percent(t.cacheRatio)} of input${t.partial ? ' that reports its cache' : ''}`)}`);
      if (t.written) ui.line(`  ${c.dim('cache writes')} ${compact(t.written).padStart(8)}  ${c.dim('part of new input')}`);
      ui.line(`  ${c.dim('output      ')} ${compact(t.output).padStart(8)}`);
      ui.line(`  ${c.dim('replies     ')} ${t.replies.toLocaleString().padStart(8)}`);
      ui.line('');
      const top = Math.max(1, ...v.days.map((d) => d.counts?.total ?? 0));
      for (const d of [...v.days].reverse()) {
        const label = dayLabel(d.day, v.today).padEnd(12);
        if (d.coverage === 'unavailable') ui.line(`  ${c.dim(`${label} not recorded`)}`);
        else ui.line(`  ${label} ${compact(d.counts.total).padStart(8)}  ${c.accent('█'.repeat(d.counts.total ? Math.max(1, Math.round((d.counts.total / top) * 24)) : 0))}`);
      }
      ui.line(`  ${c.dim('Counted on this machine (~/.seeker/usage.json). Token counts are not charges.')}`);
      return;
    }

    case 'plan': {
      const word = (rest[0] ?? '').toLowerCase();
      if (['go', 'run', 'approve', 'yes'].includes(word)) {
        if (!permissions.planning) return ui.notice('  Plan mode is off. /plan turns it on.');
        permissions.planning = false;
        ui.notice('  Plan approved: SEEKER carries it out now, asking as usual.');
        return { prompt: 'The plan is approved. Carry it out now.' };
      }
      permissions.planning = word === 'off' ? false : word === 'on' ? true : !permissions.planning;
      ui.notice(permissions.planning ? '  Plan mode on: SEEKER looks and proposes; nothing is changed or run. /plan go carries the plan out, /plan off leaves.' : '  Plan mode off.');
      ui.screen?.render();
      return;
    }

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
      import('./skill-manage.mjs').then((m) => m.recordUse(picked.name), () => {});
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

    case 'goal':
    case 'loop':
    case 'proactive':
    case 'hb':
    case 'heartbeat': {
      if (!ctx.autonomy) return ui.warn(`  /${name} works in an interactive session.`);
      const auto = await ctx.autonomy();
      const kind = name.toLowerCase();
      const out = kind === 'goal' ? auto.goalCommand(arg) : kind === 'loop' || kind === 'proactive' ? auto.loopCommand(arg) : auto.heartbeatCommand(arg);
      for (const line of out.lines) ui.notice(`  ${line}`);
      return out.prompt ? { prompt: out.prompt, label: out.label } : undefined;
    }

    case 'cron': {
      const cron = await import('./cron.mjs');
      const [action, id] = rest;
      if (['pause', 'resume', 'remove'].includes(action)) {
        const out = cron.manageJobs({ action, job_id: id }, { cwd: agent.cwd });
        return out.success ? ui.notice(`  Job ${id} ${action === 'remove' ? 'removed' : `${action}d`}.`) : ui.warn(`  ${out.error}`);
      }
      const jobs = cron.readJobs();
      if (!jobs.length) return ui.line(`  ${c.dim('No scheduled jobs. Ask for one in plain words: "every weekday at 9, check the open pull requests and summarise them".')}`);
      for (const j of jobs) {
        ui.line(`  ${c.accent(j.id)}  ${j.name}`);
        ui.line(`    ${c.dim(`${j.schedule.display} · ${j.state}${j.next_run_at ? ` · next ${new Date(j.next_run_at).toLocaleString()}` : ''} · ran ${j.repeat.completed}×${j.last_status === 'error' ? ` · last run failed: ${j.last_error}` : ''}${j.allow_changes ? ' · may change files' : ' · read-only'}`)}`);
      }
      ui.line(`  ${c.dim('/cron pause <id> · /cron resume <id> · /cron remove <id> · replies are kept in ~/.seeker/cron/output')}`);
      return;
    }

    case 'hooks': {
      const hooks = await import('./hooks.mjs');
      const all = hooks.configuredHooks(config);
      if (!all.length) {
        ui.line(`  ${c.dim('No shell hooks are configured. In ~/.seeker/config.json:')}`);
        ui.line('    "hooks": { "pre_tool_call": [{ "matcher": "bash", "command": "~/bin/guard.sh" }] }');
        ui.line(`  ${c.dim(`Events: ${hooks.EVENTS.join(', ')}. A hook gets JSON on stdin; pre_tool_call may answer {"action":"block","message":"…"}.`)}`);
        return;
      }
      const at = await pickList({ term, ui, title: 'Shell hooks — Enter approves one', items: all.map((h) => ({ label: `${h.event}${h.matcher ? ` [${h.matcher}]` : ''}  ${h.command}`, hint: hooks.isApproved(h) ? 'approved' : 'NOT approved — does not run' })) });
      if (at === -1 || hooks.isApproved(all[at])) return;
      ui.line(`  ${c.yellow('This command will run on your behalf, with your full user rights, every time the event happens:')}`);
      ui.line(`    ${all[at].command}`);
      const choice = await pickList({ term, ui, title: 'Allow this hook to run?', items: [{ label: 'No' }, { label: 'Yes, approve it' }] });
      if (choice !== 1) return ui.notice('  Left unapproved.');
      hooks.approve(all[at]);
      return ui.notice('  Approved. It runs from now on.');
    }

    case 'undo':
    case 'rollback':
      return rollback(rest, ctx);

    case 'memory': {
      const { STORES, readStore, usage } = await import('./memory.mjs');
      let any = false;
      for (const target of ['user', 'memory', 'project']) {
        const entries = readStore(target, agent.cwd);
        if (!entries.length) continue;
        any = true;
        ui.line(`  ${c.accent(STORES[target].title)} ${c.dim(`[${usage(target, entries)}]`)}`);
        for (const entry of entries) ui.line(`    ${c.dim('·')} ${entry.replace(/\n/g, '\n      ')}`);
      }
      if (!any) ui.line(`  ${c.dim('Nothing remembered yet. SEEKER saves durable facts with its memory tool as you work; tell it "remember that …" to save one now.')}`);
      else ui.line(`  ${c.dim(`Files: ${STORES.memory.file().replace(/[^/]+$/, '')} — edit them by hand, or ask SEEKER to forget something.`)}`);
      return;
    }

    case 'curator': {
      const { agentSkills, curate, setPinned } = await import('./skill-manage.mjs');
      const [action, target] = rest;
      if (action === 'pin' || action === 'unpin') {
        if (!target) return ui.warn(`  /curator ${action} <skill name>`);
        setPinned(target.toLowerCase(), action === 'pin');
        return ui.notice(`  ${target} ${action === 'pin' ? 'pinned: it will not be retired or deleted' : 'unpinned'}.`);
      }
      if (action === 'run') {
        const report = curate();
        agent.reload();
        return ui.notice(`  Curator: ${report.archived.length} archived${report.archived.length ? ` (${report.archived.join(', ')})` : ''}, ${report.stale.length} marked stale, ${report.reactivated.length} active again.`);
      }
      const own = agentSkills();
      if (!own.length) return ui.line(`  ${c.dim('SEEKER has not written any skills yet. It records a workflow as a skill after working one out; skills you installed yourself are never touched by the curator.')}`);
      for (const s of own) ui.line(`  ${c.accent(s.name.padEnd(28))} ${s.state.padEnd(8)} ${c.dim(`used ${s.uses}× · patched ${s.patches}×${s.pinned ? ' · pinned' : ''}`)}`);
      ui.line(`  ${c.dim('Unused for 14 days → stale; 30 days → moved to ~/.seeker/skills/.archive. /curator run · /curator pin <name>')}`);
      return;
    }

    default: {
      const skill = agent.skills.find((s) => s.name === name.toLowerCase());
      if (skill) import('./skill-manage.mjs').then((m) => m.recordUse(skill.name), () => {});
      if (skill) return { prompt: renderSkill(skill, arg), label: `/${skill.name}${arg ? ` ${arg}` : ''}` };
      ui.warn(`  Unknown command: /${name} — type /help`);
    }
  }
}

// ── Typed on the phone ──────────────────────────────────────────────────────
//
// The phone has no picker and no hidden prompt, so what needs one is done on its own screens
// (/model, /new, the settings tab). And a phone may be lost or borrowed: nothing here approves
// code to run (shell hooks, a project's MCP server), restores files, runs a shell line or quits.

/** A /command or /skill, not a message that merely starts with a path such as /Users/me/shot.png. */
export const isSlashCommand = (text) => /^\/[^\s/]+(\s|$)/.test(text);

export const PHONE_COMMANDS = [
  ['/yolo', 'Toggle running edits and commands without asking'],
  ['/plan', 'Plan first, change nothing: /plan · /plan go carries it out · /plan off'],
  ['/status', 'Show model, context and approval mode'],
  ['/context', 'What fills the context, part by part'],
  ['/usage', 'Tokens used: total, cached share, the last 7 days'],
  ['/compact', 'Summarise the conversation to free up context'],
  ['/think', 'Toggle thinking mode'],
  ['/config', '/config <setting> <value> — e.g. /config permissionMode auto'],
  ['/skills', 'List skills (/skills <word> filters) — run one with /<name>'],
  ['/memory', 'Show what SEEKER remembers across sessions'],
  ['/cron', 'Scheduled jobs: list them, pause, resume or remove one'],
  ['/goal', 'Set a goal SEEKER keeps working on until it is done'],
  ['/loop', 'Re-run a prompt: /loop 5m check the deploy'],
  ['/heartbeat', 'Re-enter this session when idle: /heartbeat every 10m <instruction>'],
  ['/help', 'Show the commands that work from the phone'],
];

const PHONE_SAFE = new Set(['init', 'status', 'compact', 'memory', 'cron', 'goal', 'loop', 'proactive', 'hb', 'heartbeat', 'plan', 'context', 'usage', 'agents']);
const PHONE_SETTINGS = new Set(['yolo', 'think', 'config', 'configure', 'settings', 'ctx']);
const PHONE_ELSEWHERE = {
  model: 'Type /model on its own: the app opens its model list.',
  provider: 'Type /model on its own: the app opens its model list.',
  key: 'API keys are entered in the app: Settings → model.',
  new: 'Type /new on its own.',
  clear: 'Type /new on its own.',
};
const BUILT_IN = new Set(['help', '?', 'exit', 'quit', 'q', 'clear', 'new', 'compact', 'ctx', 'status', 'think', 'yolo', 'plan', 'context', 'usage', 'effort', 'sandbox', 'agents', 'init', 'paste', 'provider', 'model', 'key', 'resume', 'mcp', 'skill', 'skills', 'configure', 'settings', 'config', 'goal', 'loop', 'proactive', 'hb', 'heartbeat', 'cron', 'hooks', 'undo', 'rollback', 'memory', 'curator']);

/**
 * A /command or /skill typed on the phone. Returns what runCommand returns (`prompt`: run it as a message).
 * @param {object} ctx  as for runCommand, with `term` null, plus:
 *   `terminal`  the conversation belongs to a terminal on the Mac: its settings are changed there, not here;
 *   `configure(key, raw)`  saves a /config setting for every project opened from the phone.
 */
export async function runPhoneCommand(input, ctx) {
  const { agent, ui, config, permissions } = ctx;
  const [word = '', ...rest] = input.slice(1).trim().split(/\s+/);
  const name = word.toLowerCase();
  const arg = rest.join(' ');

  if (!BUILT_IN.has(name) || PHONE_SAFE.has(name)) return runCommand(input, { ...ctx, term: null });
  if (name === 'help' || name === '?') {
    for (const [cmd, text] of PHONE_COMMANDS) ui.notice(`  ${cmd.padEnd(11)} ${text}`);
    return ui.notice('  /<skill> runs a skill, e.g. /code-review. /init, /model, /new, /stop and /image are in the app’s / menu.');
  }
  if (name === 'skill' || name === 'skills') {
    agent.reload();
    const words = arg.toLowerCase().split(/\s+/).filter(Boolean);
    const found = agent.skills.filter((s) => words.every((w) => `${s.name} ${s.description}`.toLowerCase().includes(w)));
    if (!found.length) return ui.notice(words.length ? `  No skill matches "${arg}".` : '  No skills yet.');
    const shown = found.slice(0, 60);
    ui.notice(`  ${found.length} skill${found.length > 1 ? 's' : ''}${words.length ? ` matching "${arg}"` : ''} — run one with /<name>:\n${shown.map((s) => `  /${s.name}`).join('\n')}${found.length > shown.length ? `\n  … ${found.length - shown.length} more; narrow it with /skills <word>` : ''}`);
    return;
  }
  if (PHONE_ELSEWHERE[name]) return ui.notice(`  ${PHONE_ELSEWHERE[name]}`);
  if (PHONE_SETTINGS.has(name)) {
    if (name === 'ctx' && !arg) return runCommand('/status', { ...ctx, term: null });
    if (ctx.terminal) return ui.warn(`  This conversation runs in a terminal on your Mac; /${name} is changed there.`);
    if (!ctx.configure) return ui.warn(`  /${name} cannot be changed from here.`);
    if (name === 'yolo') {
      const mode = permissions.mode === 'auto' ? 'ask' : 'auto';
      ctx.configure('permissionMode', mode);
      return ui.notice(
        mode === 'auto'
          ? '  YOLO on for the projects opened from the phone, and saved: edits and commands run without asking (risky commands are still confirmed).'
          : '  YOLO off: SEEKER asks before editing files or running commands.',
      );
    }
    if (name === 'think') {
      if (!agent.caps.thinking) return ui.warn(`  ${agent.model} has no thinking mode`);
      ctx.configure('think', String(!config.think));
      return ui.notice(`  Thinking mode ${config.think ? 'on' : 'off'}.`);
    }
    const [key, ...valueParts] = name === 'ctx' ? ['numCtx', arg] : rest;
    if (!key || !valueParts.length) return ui.notice(`  /config <setting> <value>. Settings: ${Object.keys(SETTINGS).filter((k) => k !== 'model').join(', ')}. The app’s Settings tab has them too.`);
    if (key === 'model') return ui.notice(`  ${PHONE_ELSEWHERE.model}`);
    ctx.configure(key, valueParts.join(' '));
    return ui.notice(`  ${key} = ${valueParts.join(' ')} (saved)`);
  }
  ui.warn(`  /${name} works only in the terminal on your Mac.`);
}
