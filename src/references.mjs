// Context references: `@file:src/app.js`, `@file:src/app.js:10-40`, `@folder:src`,
// `@diff`, `@staged`, `@git:3` and `@url:https://…` in a message have their
// content attached below it, so the model starts with the material instead of
// spending steps fetching it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHARS_PER_TOKEN = 3.5;
// Attachments above this share of the context are refused; above the soft share they are flagged.
const HARD_SHARE = 0.5;
const SOFT_SHARE = 0.25;
const MAX_FOLDER_ENTRIES = 200;
const MAX_GIT_COMMITS = 10;
const MAX_REFERENCES = 16;
const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', '__pycache__', '.cache']);

// A reference is `@kind:value` or the bare words `@diff` / `@staged`. It must not follow a
// word character or a slash, so e-mail addresses and `npm i @scope/pkg` are left alone.
const REFERENCE = /(?<![\w/@])@(?:(diff|staged)(?![\w:/-]|\.\w)|(file|folder|git|url):((?:`[^`\n]+`|"[^"\n]+"|'[^'\n]+')(?::\d+(?:-\d+)?)?|[^\s`"']+))/g;

// Never attached, however the path is written: credentials and keys.
const SENSITIVE_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure', path.join('.config', 'gh'), path.join('.config', 'gcloud')];
const SENSITIVE_HOME_FILES = ['.bashrc', '.zshrc', '.profile', '.bash_profile', '.zprofile', '.netrc', '.pgpass', '.npmrc', '.pypirc'];
const SENSITIVE_NAMES = [/^\.env(\..+)?$/, /^\.netrc$/, /^\.pgpass$/, /^\.pypirc$/, /^id_(rsa|dsa|ecdsa|ed25519)/, /\.(pem|key|p12|pfx|keystore)$/i];

export function isSensitivePath(file) {
  const full = path.resolve(file);
  const home = os.homedir();
  if (SENSITIVE_DIRS.some((dir) => full === path.join(home, dir) || full.startsWith(path.join(home, dir) + path.sep))) return true;
  if (SENSITIVE_HOME_FILES.some((name) => full === path.join(home, name))) return true;
  const name = path.basename(full);
  if (/^\.env\.(example|sample|template)$/.test(name)) return false;
  return SENSITIVE_NAMES.some((re) => re.test(name));
}

const realPath = (file) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
};

/** A path named in a reference, which must stay inside the working folder. */
function resolveInside(cwd, value) {
  const root = path.resolve(cwd);
  const full = path.resolve(root, value === '~' || value.startsWith('~/') ? path.join(os.homedir(), value.slice(1)) : value);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('path is outside the working folder');
  if (isSensitivePath(full)) throw new Error('holds credentials, so it is not attached');
  // A link inside the folder must not lead out of it.
  const real = realPath(full);
  const realRoot = realPath(root);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('path is outside the working folder');
  if (isSensitivePath(real)) throw new Error('holds credentials, so it is not attached');
  return full;
}

/** The references in `text`: { raw, kind, value, start, end } with `start`/`end` a 1-based line range for files. */
export function parseReferences(text) {
  const found = [];
  for (const m of text.matchAll(REFERENCE)) {
    if (m[1]) {
      found.push({ raw: m[0], kind: m[1], value: '' });
      continue;
    }
    let value = m[3];
    let raw = m[0];
    let range = null;
    const quoted = /^([`"'])(.*)\1(?::(\d+)(?:-(\d+))?)?$/.exec(value);
    if (quoted) {
      value = quoted[2];
      if (quoted[3]) range = [Number(quoted[3]), Number(quoted[4] ?? quoted[3])];
    } else {
      // Punctuation that ends the sentence is not part of the path, nor is a bracket that was never opened.
      let trimmed = value.replace(/[,.;!?]+$/, '');
      for (const [open, close] of ['()', '[]', '{}']) {
        while (trimmed.endsWith(close) && trimmed.split(close).length > trimmed.split(open).length) trimmed = trimmed.slice(0, -1).replace(/[,.;!?]+$/, '');
      }
      raw = raw.slice(0, raw.length - (value.length - trimmed.length));
      value = trimmed;
    }
    if (!value) continue;
    const ref = { raw, kind: m[2], value };
    if (ref.kind === 'file') {
      const tail = range ? null : /^(.*?):(\d+)(?:-(\d+))?$/.exec(value);
      if (tail) [ref.value, range] = [tail[1], [Number(tail[2]), Number(tail[3] ?? tail[2])]];
      if (range) [ref.start, ref.end] = range;
    }
    found.push(ref);
  }
  return found;
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out.length < 2_000_000 ? (out += d) : null));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, out: '', err: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out, err: err.trim() });
    });
  });
}

const fence = (text) => (text.includes('```') ? '````' : '```');
const tokensOf = (text) => Math.ceil(text.length / CHARS_PER_TOKEN);
const kb = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function tree(dir, depth = 3) {
  const lines = [];
  const walk = (at, prefix, level) => {
    let entries;
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (lines.length >= MAX_FOLDER_ENTRIES) return;
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        if (!IGNORED.has(entry.name) && level < depth) walk(path.join(at, entry.name), `${prefix}  `, level + 1);
      } else lines.push(`${prefix}${entry.name}`);
    }
  };
  walk(dir, '', 1);
  return lines;
}

async function expandOne(ref, { cwd, fetchPage, signal, contextLimit }) {
  if (ref.kind === 'file') {
    const file = resolveInside(cwd, ref.value);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat) throw new Error('file not found');
    if (stat.isDirectory()) throw new Error('is a folder — use @folder:');
    const shown = path.relative(cwd, file) || file;
    const handle = fs.openSync(file, 'r');
    const start = Buffer.alloc(4096);
    const read = fs.readSync(handle, start, 0, 4096, 0);
    fs.closeSync(handle);
    if (start.subarray(0, read).includes(0)) {
      return { stub: true, text: `📎 ${ref.raw} (binary file, ${kb(stat.size)}) — not inlined as text. It is on disk at \`${shown}\`. Use your tools to work with it (read or convert it, extract its text, or look at it if it is an image); do not tell the user the file type is unsupported.` };
    }
    // A whole file larger than the budget is pointed at rather than pasted in.
    if (!ref.start && stat.size / CHARS_PER_TOKEN > contextLimit * HARD_SHARE) {
      return { stub: true, text: `📎 ${ref.raw} (text file, approximately ${Math.ceil(stat.size / CHARS_PER_TOKEN).toLocaleString('en-US')} tokens, ${kb(stat.size)}) — too large to inline safely. It is on disk at \`${shown}\`. Use read_file with a narrow line range, or grep, to inspect only the relevant parts; do not load the entire file into context.` };
    }
    if (stat.size > 20_000_000) throw new Error('is too large to read');
    let lines = fs.readFileSync(file, 'utf8').split('\n');
    if (ref.start) {
      const from = Math.max(1, ref.start);
      lines = lines.slice(from - 1, Math.max(from, ref.end));
    }
    const body = lines.join('\n').replace(/\n$/, '');
    const lang = path.extname(file).slice(1);
    return { text: `📄 ${ref.raw} (${tokensOf(body).toLocaleString('en-US')} tokens)\n${fence(body)}${lang}\n${body}\n${fence(body)}` };
  }
  if (ref.kind === 'folder') {
    const dir = resolveInside(cwd, ref.value);
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error('folder not found');
    const lines = tree(dir);
    const listing = `${lines.join('\n') || '(empty)'}${lines.length >= MAX_FOLDER_ENTRIES ? '\n- ...' : ''}`;
    return { text: `📁 ${ref.raw} (${tokensOf(listing).toLocaleString('en-US')} tokens)\n${listing}` };
  }
  if (ref.kind === 'diff' || ref.kind === 'staged' || ref.kind === 'git') {
    let args;
    if (ref.kind === 'diff') args = ['diff'];
    else if (ref.kind === 'staged') args = ['diff', '--staged'];
    else {
      if (!/^\d+$/.test(ref.value)) throw new Error('needs a number of commits, e.g. @git:3');
      args = ['log', `-${Math.min(MAX_GIT_COMMITS, Math.max(1, Number(ref.value)))}`, '-p'];
    }
    const result = await run('git', args, cwd);
    if (!result.ok) throw new Error(result.err.split('\n')[0] || 'git failed');
    const body = result.out.trimEnd() || '(no changes)';
    return { text: `🧾 git ${args.join(' ')} (${tokensOf(body).toLocaleString('en-US')} tokens)\n${fence(body)}diff\n${body}\n${fence(body)}` };
  }
  // url
  if (!/^https?:\/\//i.test(ref.value)) throw new Error('needs an http(s) address');
  if (!fetchPage) throw new Error('cannot be fetched here');
  const page = await fetchPage(ref.value, signal);
  return { text: `🌐 ${ref.raw} (${tokensOf(page.text).toLocaleString('en-US')} tokens)\n${page.text}` };
}

/**
 * Expands the references in a message. The `@` words stay in the text; what they point to is
 * attached below it.
 * @param {string} text
 * @param {{ cwd: string, contextLimit: number, fetchPage?: Function, signal?: AbortSignal }} opts
 * @returns {Promise<{ text: string, attached: string[], warnings: string[] }>} `text` is the message to send
 */
export async function expandReferences(text, opts) {
  const refs = parseReferences(text);
  if (!refs.length) return { text, attached: [], warnings: [] };
  const warnings = [];
  const blocks = [];
  const attached = [];
  const seen = new Set();
  for (const ref of refs) {
    if (seen.has(ref.raw)) continue;
    seen.add(ref.raw);
    if (seen.size > MAX_REFERENCES) {
      warnings.push(`${ref.raw}: not expanded (maximum ${MAX_REFERENCES} @-references per message)`);
      continue;
    }
    try {
      blocks.push(await expandOne(ref, opts));
      attached.push(ref.raw);
    } catch (err) {
      warnings.push(`${ref.raw}: ${err.message}`);
    }
  }

  const tokens = blocks.filter((b) => !b.stub).reduce((n, b) => n + tokensOf(b.text), 0);
  const hard = Math.max(1, Math.floor(opts.contextLimit * HARD_SHARE));
  const soft = Math.floor(opts.contextLimit * SOFT_SHARE);
  const n = (value) => value.toLocaleString('en-US');
  if (tokens > hard) {
    return { text, attached: [], warnings: [...warnings, `@ context injection refused: ${n(tokens)} tokens exceeds the 50% hard limit (${n(hard)}). Name fewer files or a line range (@file:path:10-80).`] };
  }
  if (tokens > soft) warnings.push(`@ context injection warning: ${n(tokens)} tokens exceeds the 25% soft limit (${n(soft)}).`);

  const parts = [text];
  if (warnings.length) parts.push(`--- Notes on the attachments ---\n${warnings.map((w) => `- ${w}`).join('\n')}`);
  if (blocks.length) parts.push(`--- Attached ---\n\n${blocks.map((b) => b.text).join('\n\n')}`);
  return { text: parts.join('\n\n').trim(), attached, warnings };
}
