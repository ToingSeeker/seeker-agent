// `seeker doctor`: looks at what SEEKER needs on this machine and says what is wrong and how to
// put it right. It reads and probes; it changes nothing and prints no key, token or secret.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { HOME_DIR, VERSION, configPath } from './config.mjs';
import { LINK_FILE } from './link.mjs';
import { needsKey, providerDefs } from './providers.mjs';
import { USAGE_FILE } from './usage.mjs';

const NODE_MAJOR = 22;

/** What the checks ask of the machine. Each can be replaced, so the checks are tested without one. */
export const PROBES = {
  nodeVersion: () => process.versions.node,
  /** Whether a program is on the PATH. */
  has: (program) => new Promise((resolve) => execFile(process.platform === 'win32' ? 'where' : 'which', [program], (err) => resolve(!err))),
  /** The file's permission bits, or null when it does not exist. */
  mode: (file) => {
    try {
      return fs.statSync(file).mode & 0o777;
    } catch {
      return null;
    }
  },
  /** { ok, status, json } for a GET that answers within a few seconds; { ok: false, error } otherwise. */
  get: async (url) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      let json = null;
      try {
        json = await res.json();
      } catch {}
      return { ok: res.status < 500, status: res.status, json };
    } catch (err) {
      return { ok: false, error: err.cause?.code ?? err.name ?? 'no answer' };
    }
  },
  /** Whether something answers on the daemon's socket. */
  listening: (file) =>
    new Promise((resolve) => {
      const probe = net.connect(file);
      probe.once('connect', () => (probe.destroy(), resolve(true)));
      probe.once('error', () => resolve(false));
    }),
  resolves: (name) => {
    try {
      import.meta.resolve(name);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Every check, in the order it is shown.
 * @returns {Promise<{ level: 'ok'|'warn'|'fail'|'info', name: string, detail: string, fix?: string }[]>}
 */
export async function diagnose({ config, probes = PROBES, files = { config: configPath(), usage: USAGE_FILE, link: LINK_FILE, home: HOME_DIR } } = {}) {
  const out = [];
  const say = (level, name, detail, fix) => out.push({ level, name, detail, ...(fix ? { fix } : {}) });

  const node = probes.nodeVersion();
  if (Number(node.split('.')[0]) >= NODE_MAJOR) say('ok', 'Node', `v${node}`);
  else say('fail', 'Node', `v${node} is too old`, `SEEKER needs Node ${NODE_MAJOR} or newer.`);

  if (await probes.has('git')) say('ok', 'git', 'found: checkpoints, /rollback and @diff work');
  else say('warn', 'git', 'not found', 'Without git there are no checkpoints, so /rollback cannot undo a change.');

  const missing = ['@anthropic-ai/sdk', '@modelcontextprotocol/sdk', '@anthropic-ai/claude-agent-sdk'].filter((name) => !probes.resolves(name));
  if (missing.length) say('warn', 'Packages', `not installed: ${missing.join(', ')}`, 'Run `npm install` in the seeker folder. Local models work without them; Claude and MCP servers do not.');
  else say('ok', 'Packages', 'installed');

  // The settings file holds API keys: only its owner should be able to read it.
  const configMode = probes.mode(files.config);
  if (configMode == null) say('info', 'Settings', 'no settings file yet: the defaults are in use');
  else if (configMode & 0o077) say('warn', 'Settings', `${files.config} can be read by other users of this machine`, `chmod 600 ${files.config}`);
  else say('ok', 'Settings', files.config);

  // The provider the next session will start on.
  const def = providerDefs(config).find((p) => p.id === config.provider);
  if (!def) say('fail', 'Provider', `"${config.provider}" is not a provider SEEKER knows`, 'Choose one with /model.');
  else if (def.kind === 'ollama') {
    const tags = await probes.get(`${config.host}/api/tags`);
    const models = (tags.json?.models ?? []).map((m) => m.name);
    if (!tags.ok) say('fail', 'Provider', `Ollama does not answer at ${config.host}`, 'Start it with `ollama serve`, or choose another provider with /model.');
    else if (!models.includes(config.model)) say('fail', 'Provider', `Ollama runs, but the model ${config.model} is not installed`, `ollama pull ${config.model}  (or choose another with /model)`);
    else say('ok', 'Provider', `Ollama at ${config.host}, model ${config.model}`);
  } else if (def.local) {
    const up = await probes.get(`${config.providers?.[def.id]?.baseUrl ?? def.baseUrl}/models`);
    if (up.ok) say('ok', 'Provider', `${def.label} answers`);
    else say('fail', 'Provider', `${def.label} does not answer`, 'Start its server, or choose another provider with /model.');
  } else if (needsKey(def, config)) say('fail', 'Provider', `${def.label} has no API key`, 'Enter one with /key, or set its environment variable.');
  else say('ok', 'Provider', `${def.label}, model ${config.model} (the key is set; it is not tried here)`);

  const unknown = (config.fallback ?? []).filter((f) => !providerDefs(config).some((p) => p.id === f.provider)).map((f) => f.provider);
  if (unknown.length) say('warn', 'Backup models', `unknown provider in "fallback": ${[...new Set(unknown)].join(', ')}`, 'Fix the name in the settings file, or remove the entry.');
  else if (config.fallback?.length) say('ok', 'Backup models', `${config.fallback.length} configured`);

  // The phone: a relay to reach, and at most one daemon on this machine.
  const relay = config.remote?.url;
  if (!relay) say('info', 'Remote', 'not set up (seeker remote --setup)');
  else {
    const page = await probes.get(relay);
    if (page.ok) say('ok', 'Relay', `${relay} answers`);
    else say('fail', 'Relay', `${relay} does not answer (${page.error ?? `HTTP ${page.status}`})`, 'Check that the relay is deployed and the address in the settings is right.');
    if (await probes.listening(files.link)) say('ok', 'Remote daemon', 'running on this machine');
    else say('info', 'Remote daemon', 'not running: start it with `seeker remote`');
  }

  const usageMode = probes.mode(files.usage);
  if (usageMode != null && usageMode & 0o077) say('warn', 'Token ledger', `${files.usage} can be read by other users of this machine`, `chmod 600 ${files.usage}`);

  if (!(await probes.has('pdftotext'))) say('info', 'PDF reading', 'pdftotext is not installed: read_file cannot read PDFs (brew install poppler)');
  return out;
}

const MARK = { ok: '✓', warn: '⚠', fail: '✗', info: '·' };

/** The report as lines of text. `paint` colours a mark by its level; without it the text is plain. */
export function report(results, paint = (level, text) => text) {
  const lines = [`SEEKER v${VERSION} — ${path.basename(HOME_DIR) === '.seeker' ? '~/.seeker' : HOME_DIR}`, ''];
  const wide = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    lines.push(`  ${paint(r.level, MARK[r.level])} ${r.name.padEnd(wide)}  ${r.detail}`);
    if (r.fix) lines.push(`    ${' '.repeat(wide)}  → ${r.fix}`);
  }
  const fails = results.filter((r) => r.level === 'fail').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  lines.push('', fails ? `${fails} problem${fails === 1 ? '' : 's'} to fix${warns ? `, ${warns} to look at` : ''}.` : warns ? `Nothing is broken; ${warns} thing${warns === 1 ? '' : 's'} to look at.` : 'Everything SEEKER needs is in place.');
  return lines;
}
