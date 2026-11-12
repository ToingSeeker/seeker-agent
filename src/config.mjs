import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const VERSION = '0.1.0';
export const HOME_DIR = process.env.SEEKER_HOME || path.join(os.homedir(), '.seeker');
const CONFIG_FILE = path.join(HOME_DIR, 'config.json');

export const DEFAULTS = {
  provider: 'ollama',
  model: 'qwen3.5:27b',
  // Per-provider settings: { apiKey, model, baseUrl, contextWindow }. An entry with a
  // baseUrl whose id is not built in becomes a custom OpenAI-compatible provider.
  providers: {},
  host: 'http://127.0.0.1:11434',
  // Ollama's own default context is far too small for agent work.
  numCtx: 32768,
  think: true,
  showThinking: true,
  permissionMode: 'ask', // 'ask' | 'auto'
  maxSteps: 60,
  keepAlive: '30m',
  // Extra folders to load skills from, besides ~/.seeker/skills and <project>/.seeker/skills.
  skillDirs: [],
  // MCP servers that add tools, as in Claude Code: { name: { command, args, env } | { url, headers }, disabled? }.
  mcpServers: {},
};

/** Settings `/config` may change, with how to read each from text. Returns undefined when the text is invalid. */
const bool = (v) => ({ true: true, on: true, yes: true, ya: true, false: false, off: false, no: false, tidak: false })[v.toLowerCase()];
const int = (min) => (v) => (/^\d+$/.test(v) && Number(v) >= min ? Number(v) : undefined);
export const SETTINGS = {
  model: { parse: (v) => v, help: 'default Ollama model' },
  numCtx: { parse: int(2048), help: 'context window in tokens (min 2048)' },
  think: { parse: bool, help: 'let the model reason before answering' },
  showThinking: { parse: bool, help: 'show that reasoning on screen' },
  permissionMode: { parse: (v) => (['ask', 'auto'].includes(v) ? v : undefined), help: 'ask before edits and commands, or run them' },
  maxSteps: { parse: int(1), help: 'tool steps allowed per message' },
  keepAlive: { parse: (v) => v, help: 'how long the model stays in memory' },
  host: {
    parse: (v) => {
      try {
        return /\s/.test(v) ? undefined : normalizeHost(v);
      } catch {
        return undefined;
      }
    },
    help: 'Ollama server address',
  },
};

export const configPath = () => CONFIG_FILE;

/** Accepts the loose forms OLLAMA_HOST allows ("0.0.0.0:11434", "localhost"). */
export function normalizeHost(host) {
  if (!host) return DEFAULTS.host;
  let h = String(host).trim();
  if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
  const url = new URL(h);
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  if (!url.port && url.protocol === 'http:') url.port = '11434';
  return url.origin;
}

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function loadConfig() {
  const config = { ...DEFAULTS, ...readFile() };
  if (process.env.OLLAMA_HOST) config.host = process.env.OLLAMA_HOST;
  if (process.env.SEEKER_MODEL) config.model = process.env.SEEKER_MODEL;
  config.host = normalizeHost(config.host);
  return config;
}

/** Persists only the given keys, leaving the rest of the file as it was. */
export function saveConfig(patch) {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const next = { ...readFile(), ...patch };
  // The file can hold API keys, so only the owner may read it.
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(CONFIG_FILE, 0o600);
}

/** Updates one provider's entry, in memory and on disk. A value of `undefined` removes that key. */
export function saveProviderConfig(config, id, patch) {
  const entry = { ...(config.providers?.[id] ?? {}), ...patch };
  for (const key of Object.keys(entry)) if (entry[key] === undefined) delete entry[key];
  config.providers = { ...(config.providers ?? {}), [id]: entry };
  saveConfig({ providers: { ...(readFile().providers ?? {}), [id]: entry } });
}
