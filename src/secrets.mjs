// Files that hold secrets, and key-shaped text. Two kinds of file:
//   - SEEKER's own (the settings with the API keys, the daemon's key, the push subscriptions): the
//     agent never reads them, whatever the mode. Nothing it is asked to do needs them.
//   - Other secrets (.env, private keys, ~/.ssh, cloud credentials): read only with the user's yes,
//     asked even in --yolo mode, because what is read goes to the model provider.
// Matching a shell command is a best effort; the sandbox (src/sandbox.mjs) is the boundary there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    // A file that does not exist yet: its folder may still be a link (/tmp → /private/tmp on macOS).
    try {
      return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return path.resolve(p);
    }
  }
};
const expand = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);

const SEEKER_FILES = ['config.json', 'remote.sock.key', 'push.json'];

/** SEEKER's own secret files, with links resolved. */
export const seekerSecretFiles = () => SEEKER_FILES.map((name) => real(path.join(HOME_DIR, name)));

// By name, wherever they are. Examples and templates of an env file are meant to be read.
const SENSITIVE_NAME = /^(\.env(\..+)?|.+\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)|\.netrc|\.pgpass|\.git-credentials)$/i;
const HARMLESS_NAME = /^\.env\.(example|sample|template|dist|defaults)$/i;
// In the home folder only: a project's own .npmrc is usually settings, the one in ~ holds the token.
const HOME_NAMES = new Set(['.npmrc', '.pypirc']);
// Folders under ~ that are credentials as a whole.
const HOME_DIRS = ['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', path.join('.config', 'gcloud'), path.join('.config', 'gh')];

/**
 * What kind of secret `file` is: 'seeker' for SEEKER's own key files, 'sensitive' for other
 * credentials, or null for an ordinary file. `file` should be absolute.
 */
export function secretKind(file) {
  const full = real(file);
  if (seekerSecretFiles().includes(full)) return 'seeker';
  const name = path.basename(full);
  if (SENSITIVE_NAME.test(name) && !HARMLESS_NAME.test(name)) return 'sensitive';
  const home = real(os.homedir());
  if (HOME_NAMES.has(name) && path.dirname(full) === home) return 'sensitive';
  if (HOME_DIRS.some((dir) => full.startsWith(`${path.join(home, dir)}${path.sep}`))) return 'sensitive';
  return null;
}

const globToRegex = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
// Names a glob such as `.env*` or `*.pem` is tried against.
const SAMPLE_NAMES = ['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', 'server.pem', 'server.key', '.netrc', '.git-credentials'];

/**
 * The first secret file a shell command names: `{ kind, file }`, or null. A best effort that reads
 * the words of the command as paths: `cat .env`, `head ~/.seeker/config.json`, `cat ~/.ssh/*`.
 */
export function secretInCommand(command, cwd) {
  const text = String(command ?? '').replace(/\$\{?HOME\}?/g, os.homedir());
  const words = text.split(/[\s'"`;|&<>()=,]+/).filter(Boolean);
  const seeker = seekerSecretFiles();
  // `cd ~/.seeker && cat config.json`: the bare name, said in a command that also names SEEKER's folder.
  const namesHome = text.includes(path.basename(HOME_DIR)) || text.includes(HOME_DIR);
  for (const word of words) {
    if (namesHome && SEEKER_FILES.includes(word)) return { kind: 'seeker', file: path.join(HOME_DIR, word) };
    const file = path.resolve(cwd, expand(word));
    if (/[*?]/.test(word)) {
      const pattern = globToRegex(file);
      const hit = seeker.find((f) => pattern.test(f) || pattern.test(path.join(HOME_DIR, path.basename(f))));
      if (hit) return { kind: 'seeker', file: hit };
      const dir = path.dirname(file);
      const sample = SAMPLE_NAMES.map((n) => path.join(dir, n)).find((f) => pattern.test(f) && secretKind(f));
      if (sample) return { kind: secretKind(sample), file };
      if (secretKind(path.join(dir, 'x'))) return { kind: 'sensitive', file }; // inside ~/.ssh and the like
      continue;
    }
    const kind = secretKind(file);
    if (kind) return { kind, file };
  }
  return null;
}

// Key-shaped text: provider and platform keys by their prefix, and `key=value` with a long value.
const KEY_PATTERNS = [
  /\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,})/g,
  /\b((?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,})/g,
  /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{20,})/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(AIza[0-9A-Za-z_-]{30,})/g,
  /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
  /\b((?:api[_-]?key|token|secret|password)\s*[=:]\s*["']?)([A-Za-z0-9+/_-]{20,})/gi,
];

/** `text` with key-shaped values replaced by a short marker; for logs, which are kept in plain text. */
export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const pattern of KEY_PATTERNS) {
    // One group: the key itself, kept to its first four characters. Two: a `name=` prefix, then the value.
    out = out.replace(pattern, (match, a, b) => (typeof b === 'string' ? `${a}[redacted]` : `${a.slice(0, 4)}…[redacted]`));
  }
  return out;
}
