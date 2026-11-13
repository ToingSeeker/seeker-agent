// The tools SEEKER can call. Each one declares a `risk` that the permission
// layer keys off: 'read' runs freely, 'write' / 'exec' / 'net' need approval.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import dns from 'node:dns';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { renderSkill } from './skills.mjs';

import { imageType, kilobytes, loadImage } from './images.mjs';

export class ToolError extends Error {}

/** The address as 16 bytes, or null if it is not an IPv6 address. */
function ipv6Bytes(address) {
  let text = address.split('%')[0];
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) text = `${dotted[1]}${((+dotted[2] << 8) | +dotted[3]).toString(16)}:${((+dotted[4] << 8) | +dotted[5]).toString(16)}`;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255]);
}

/** True for loopback, private, link-local and other addresses that only mean something inside a network. */
export function isInternalAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const bytes = ipv6Bytes(address);
  if (!bytes) return true; // not an address we can read: treated as internal
  const starts = (...prefix) => prefix.every((byte, i) => bytes[i] === byte);
  const v4 = (at) => isInternalAddress(bytes.slice(at, at + 4).join('.'));
  // Forms that carry an IPv4 address are judged by it: ::a.b.c.d (which covers :: and ::1),
  // ::ffff:a.b.c.d, 64:ff9b::a.b.c.d (NAT64) and 2002:AABB:CCDD:: (6to4).
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return true;
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 255 && bytes[11] === 255) return v4(12);
  if (starts(0, 0x64, 0xff, 0x9b)) return v4(12);
  if (starts(0x20, 0x02)) return v4(2);
  // Unique-local fc00::/7, link-local fe80::/10 and site-local fec0::/10, multicast ff00::/8.
  return (bytes[0] & 0xfe) === 0xfc || (bytes[0] === 0xfe && bytes[1] >= 0x80) || bytes[0] === 0xff;
}

/**
 * A DNS lookup for http(s).request that refuses internal addresses. Used as the request's own
 * lookup, so the address that is checked is the address that is connected to: a name cannot
 * answer "public" when asked and "127.0.0.1" a moment later.
 */
export function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const found = Array.isArray(address) ? address : [{ address, family }];
    if (!found.length || found.some((entry) => isInternalAddress(entry.address))) {
      return callback(new Error(`${hostname} is an address inside this machine or network`));
    }
    callback(null, address, family);
  });
}

const MAX_FETCH_BYTES = 5_000_000;

/** One GET, redirects not followed. `publicOnly` refuses a host that is, or resolves to, an internal address. */
function httpGet(url, { signal, headers, publicOnly }) {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (publicOnly && (net.isIP(host) ? isInternalAddress(host) : /(^|\.)localhost$/i.test(host))) {
      return reject(new Error(`${url.host} is an address inside this machine or network`));
    }
    const request = (url.protocol === 'https:' ? https : http).request(
      url,
      { headers: { ...headers, 'accept-encoding': 'gzip, deflate, br' }, signal, lookup: publicOnly ? publicLookup : undefined },
      (res) => {
        const encoding = res.headers['content-encoding'];
        const body = encoding === 'gzip' ? res.pipe(zlib.createGunzip()) : encoding === 'deflate' ? res.pipe(zlib.createInflate()) : encoding === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
        const chunks = [];
        let size = 0;
        const finish = () => resolve({ status: res.statusCode, location: res.headers.location ?? null, type: res.headers['content-type'] || '', text: Buffer.concat(chunks).toString('utf8') });
        body.on('data', (chunk) => {
          chunks.push(chunk);
          size += chunk.length;
          // Enough for any page worth reading; the rest is dropped rather than held in memory.
          if (size > MAX_FETCH_BYTES) {
            request.destroy();
            finish();
          }
        });
        body.on('end', finish);
        body.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

const MAX_OUTPUT = 24_000;
// Files read_file hands to extract.mjs instead of showing as text.
const DOCUMENT_LIKE = /\.(ipynb|docx?|rtf|odt|pdf|xlsx|db|sqlite3?)$/i;
const MAX_LINE = 400;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', '__pycache__', '.cache']);

/** Keeps the head and tail of long output: errors usually sit at the end. */
export function clip(text, max = MAX_OUTPUT) {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.6));
  const tail = text.slice(-Math.floor(max * 0.3));
  return `${head}\n\n… [${text.length - head.length - tail.length} characters omitted] …\n\n${tail}`;
}

export function resolvePath(p, cwd) {
  if (typeof p !== 'string' || !p.trim()) throw new ToolError('"path" is required');
  let target = p.trim();
  if (target === '~' || target.startsWith('~/')) target = path.join(os.homedir(), target.slice(1));
  return path.resolve(cwd, target);
}

// Local models often reach for a neighbouring parameter name.
const pathArg = (args) => args.path ?? args.file_path ?? args.filename ?? args.file;

const rel = (file, cwd) => {
  const r = path.relative(cwd, file);
  return r && !r.startsWith('..') ? r : file;
};

function runProcess(cmd, argv, { cwd, signal, timeoutMs, shell = false, env }) {
  return new Promise((resolve) => {
    // detached = own process group, so a timeout or Ctrl+C kills the whole tree.
    const child = spawn(cmd, argv, { cwd, shell, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let killed = null;
    const kill = (why) => {
      killed = why;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const collect = (data) => {
      if (output.length < MAX_OUTPUT * 4) output += data;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    const onAbort = () => kill('aborted');
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = (code, error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ output, code, killed, error });
    };
    child.on('error', (err) => done(null, err));
    child.on('close', (code) => done(code, null));
  });
}

let hasRipgrep;
function ripgrepAvailable() {
  hasRipgrep ??= spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0;
  return hasRipgrep;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}

/** Text to add to a write or edit result when the saved file does not parse ('' otherwise). */
const checkSyntax = async (file) => (CHECKED.test(file) ? (await import('./lint.mjs')).syntaxCheck(file).catch(() => '') : '');
const CHECKED = /\.(m?js|cjs|json|py|sh|bash|rb|php)$/i;

const TODO_MARK = { pending: '☐', in_progress: '◐', completed: '☑' };

// Commands started with `background: true`, by id. They outlive the tool call that
// started them and are stopped when SEEKER exits.
const processes = new Map();
let processCount = 0;

function startBackground(command, cwd) {
  const id = `p${++processCount}`;
  const env = { ...process.env, PAGER: 'cat', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
  const child = spawn(process.env.SHELL || '/bin/sh', ['-c', command], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = { id, command, child, output: '', read: 0, done: false, code: null };
  const collect = (data) => {
    entry.output += data;
    // Keep the newest output; a chatty server would otherwise grow without bound.
    if (entry.output.length > MAX_OUTPUT * 8) {
      const cut = entry.output.length - MAX_OUTPUT * 4;
      entry.output = entry.output.slice(cut);
      entry.read = Math.max(0, entry.read - cut);
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', (err) => {
    entry.output += `\n[could not start: ${err.message}]`;
    entry.done = true;
  });
  child.on('close', (code) => {
    entry.done = true;
    entry.code = code;
  });
  processes.set(id, entry);
  return entry;
}

function stopProcess(entry) {
  if (entry.done) return;
  try {
    process.kill(-entry.child.pid, 'SIGTERM');
  } catch {
    entry.child.kill('SIGTERM');
  }
}

/** Called when SEEKER exits, so nothing it started is left running. */
export function stopAllProcesses() {
  for (const entry of processes.values()) stopProcess(entry);
}

const decodeEntities = (text) =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Reads the result list out of DuckDuckGo's plain HTML results page. */
export function parseSearchResults(html) {
  const results = [];
  for (const block of html.split(/class="result results_links/).slice(1)) {
    const link = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    let url = link[1].replace(/&amp;/g, '&');
    const wrapped = /[?&]uddg=([^&]+)/.exec(url);
    if (wrapped) url = decodeURIComponent(wrapped[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // an advertisement
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    results.push({ title: decodeEntities(link[2]), url, snippet: snippet ? decodeEntities(snippet[1]) : '' });
  }
  return results;
}

/**
 * Fetches a page as plain text, following redirects by hand: the first host is the one the user
 * approved, and a redirect must not turn that approval into a request to this machine or its network.
 * @returns {Promise<{ status: number, url: string, text: string }>}
 */
export async function fetchPage(address, signal) {
  let url;
  try {
    url = new URL(address);
  } catch {
    throw new ToolError('"url" must be a valid http(s) URL');
  }
  if (!/^https?:$/.test(url.protocol)) throw new ToolError('Only http(s) URLs are supported');
  const timeout = AbortSignal.timeout(30_000);
  const approvedHost = url.host;
  let res;
  // Redirects are followed by hand: the user approved one host, and a redirect must not turn
  // that approval into a request to this machine or its network.
  for (let hop = 0; ; hop++) {
    const elsewhere = url.host !== approvedHost;
    res = await httpGet(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { 'user-agent': 'seeker-cli', accept: 'text/html,text/plain,application/json,*/*' },
      publicOnly: elsewhere,
    }).catch((e) => {
      if (elsewhere && /inside this machine or network/.test(e.message)) {
        throw new ToolError(`${approvedHost} redirected to ${url.host}, an address inside this machine or network. It was not followed; fetch that address directly if it is what you want.`);
      }
      throw new ToolError(`Request failed: ${e.cause?.message || e.message}`);
    });
    if (!(res.status >= 300 && res.status < 400 && res.location)) break;
    if (hop >= 5) throw new ToolError('Too many redirects');
    let next;
    try {
      next = new URL(res.location, url);
    } catch {
      throw new ToolError(`The server redirected to an address that is not a URL: ${res.location}`);
    }
    if (!/^https?:$/.test(next.protocol)) throw new ToolError(`The server redirected to ${next.protocol} which is not supported`);
    url = next;
  }
  return { status: res.status, url: url.href, text: res.type.includes('html') ? htmlToText(res.text) : res.text };
}

export const TOOLS = [
  {
    name: 'read_file',
    risk: 'read',
    description:
      'Read a text file, look at an image (PNG, JPEG, GIF, WebP), or read a document as text (PDF, .docx, .xlsx, .ipynb, SQLite). Text comes back as lines prefixed with their line number; use offset/limit for large files. Always read a file before editing it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, absolute or relative to the working directory' },
        offset: { type: 'integer', description: 'First line to read (1-based). Default 1' },
        limit: { type: 'integer', description: 'Maximum number of lines. Default 800' },
      },
      required: ['path'],
    },
    verbs: ['Reading', 'Read'],
    summary: (a) => pathArg(a),
    async run(args, { cwd, vision }) {
      const file = resolvePath(pathArg(args), cwd);
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat) throw new ToolError(`File not found: ${file}`);
      if (stat.isDirectory()) throw new ToolError(`${file} is a directory — use list_dir`);
      const handle = await fsp.open(file);
      const start = Buffer.alloc(16);
      const { bytesRead } = await handle.read(start, 0, 16, 0).finally(() => handle.close());
      const mime = imageType(start.subarray(0, bytesRead));
      if (mime) {
        if (!vision) throw new ToolError(`${rel(file, cwd)} is an image, and the current model cannot see images. Tell the user; they can switch to a vision model with /model`);
        let image;
        try {
          image = loadImage(file);
        } catch (err) {
          throw new ToolError(err.message);
        }
        const { bytes, ...attached } = image;
        return { output: `${attached.name} is an image (${mime}, ${kilobytes(bytes)}). It is attached; look at it.`, note: `image · ${kilobytes(bytes)}`, images: [attached] };
      }
      let text;
      let extracted = false;
      const { DOCUMENT_EXTENSIONS, extractDocument } = DOCUMENT_LIKE.test(file) ? await import('./extract.mjs') : {};
      if (DOCUMENT_EXTENSIONS?.has(path.extname(file).toLowerCase())) {
        // A PDF, Word file, notebook, spreadsheet or database: its text is extracted rather than its bytes shown.
        const doc = await extractDocument(file);
        if (doc.error) throw new ToolError(doc.error);
        text = doc.text;
        extracted = true;
      } else {
        if (stat.size > 5_000_000) throw new ToolError(`File is ${stat.size} bytes — too large; use grep to find the part you need`);
        const buf = await fsp.readFile(file);
        if (buf.subarray(0, 8000).includes(0)) throw new ToolError('Binary file — cannot be read as text');
        text = buf.toString('utf8');
      }
      const lines = text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const offset = Math.max(1, Number(args.offset) || 1);
      const limit = Math.max(1, Number(args.limit) || 800);
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      if (!slice.length) return { output: `(no lines in that range — file has ${lines.length} lines)`, note: 'empty' };
      const body = slice
        .map((l, i) => `${String(offset + i).padStart(5)}\t${l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…` : l}`)
        .join('\n');
      const last = offset - 1 + slice.length;
      const more = last < lines.length ? `\n\n[lines ${offset}-${last} of ${lines.length}; pass offset=${last + 1} to continue]` : '';
      const origin = extracted ? `[Text extracted from ${path.basename(file)}; this is not the file's own bytes, so do not write it back with write_file or edit_file.]\n` : '';
      return { output: origin + body + more, note: `${slice.length} lines${extracted ? ' · extracted' : ''}` };
    },
  },
  {
    name: 'write_file',
    risk: 'write',
    description:
      'Create a new file or completely overwrite an existing one. Parent folders are created. To change part of an existing file use edit_file instead.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'The complete file content' },
      },
      required: ['path', 'content'],
    },
    verbs: ['Writing', 'Wrote'],
    summary: (a) => pathArg(a),
    targetPath: (a, cwd) => resolvePath(pathArg(a), cwd),
    preview(args, { cwd }) {
      resolvePath(pathArg(args), cwd);
      if (typeof args.content !== 'string') throw new ToolError('"content" is required');
      const lines = args.content.split('\n');
      return { added: lines.slice(0, 12), more: Math.max(0, lines.length - 12) };
    },
    async run(args, { cwd }) {
      const file = resolvePath(pathArg(args), cwd);
      const existed = fs.existsSync(file);
      if (existed && /\.(docx?|rtf|odt|pdf|xlsx|db|sqlite3?)$/i.test(file)) throw new ToolError(`${path.basename(file)} is a binary document; read_file showed its extracted text, not its bytes. Writing text over it would destroy it. Write to a new file instead.`);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, args.content);
      const count = args.content.split('\n').length;
      const lint = await checkSyntax(file);
      return { output: `${existed ? 'Overwrote' : 'Created'} ${file} (${count} lines)${lint}`, note: `${existed ? 'overwrote' : 'created'} · ${count} lines${lint ? ' · syntax error' : ''}` };
    },
  },
  {
    name: 'edit_file',
    risk: 'write',
    description:
      'Replace an exact string in a file. old_string must match the file exactly (whitespace and indentation included) and must be unique unless replace_all is true. Include a few surrounding lines to make it unique.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        old_string: { type: 'string', description: 'Exact text to replace' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    verbs: ['Editing', 'Edited'],
    summary: (a) => pathArg(a),
    targetPath: (a, cwd) => resolvePath(pathArg(a), cwd),
    // Validates before the user is asked, so they never approve an edit that cannot apply.
    preview(args, { cwd }) {
      const file = resolvePath(pathArg(args), cwd);
      const { old_string: from, new_string: to } = args;
      if (typeof from !== 'string' || typeof to !== 'string') throw new ToolError('"old_string" and "new_string" are required');
      if (from === to) throw new ToolError('old_string and new_string are identical');
      if (!from) throw new ToolError('old_string is empty — use write_file to create a file');
      if (!fs.existsSync(file)) throw new ToolError(`File not found: ${file}`);
      const count = fs.readFileSync(file, 'utf8').split(from).length - 1;
      if (count === 0) throw new ToolError('old_string was not found in the file. Read the file again and copy the text exactly.');
      if (count > 1 && !args.replace_all)
        throw new ToolError(`old_string occurs ${count} times. Add surrounding lines to make it unique, or set replace_all.`);
      const removed = from.split('\n');
      const added = to.split('\n');
      return { removed: removed.slice(0, 12), added: added.slice(0, 12), more: Math.max(0, removed.length - 12) + Math.max(0, added.length - 12) };
    },
    async run(args, ctx) {
      this.preview(args, ctx);
      const file = resolvePath(pathArg(args), ctx.cwd);
      const parts = (await fsp.readFile(file, 'utf8')).split(args.old_string);
      // split/join rather than replace(): `$&` in new_string must stay literal.
      const next = args.replace_all ? parts.join(args.new_string) : parts[0] + args.new_string + parts.slice(1).join(args.old_string);
      await fsp.writeFile(file, next);
      const n = args.replace_all ? parts.length - 1 : 1;
      const lint = await checkSyntax(file);
      return { output: `Edited ${file} (${n} replacement${n > 1 ? 's' : ''})${lint}`, note: `${n} replacement${n > 1 ? 's' : ''}${lint ? ' · syntax error' : ''}` };
    },
  },
  {
    name: 'bash',
    risk: 'exec',
    description:
      'Run a shell command and return its combined stdout/stderr. Every command starts in the working directory (use `cd dir && …` to run elsewhere). Never run interactive commands (editors, prompts, watch mode); background long-running servers with `&`.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command' },
        timeout: { type: 'integer', description: 'Timeout in seconds. Default 120, max 600' },
        background: { type: 'boolean', description: 'Start it and return at once, for servers and other long-running commands. Read its output later with process_output.' },
      },
      required: ['command'],
    },
    verbs: ['Running', 'Ran'],
    summary: (a) => `${a.command}${a.background === true || a.background === 'true' ? '  (background)' : ''}`,
    async run(args, { cwd, signal }) {
      if (typeof args.command !== 'string' || !args.command.trim()) throw new ToolError('"command" is required');
      if (args.background === true || args.background === 'true') {
        const entry = startBackground(args.command, cwd);
        // A moment to see whether it starts at all.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const first = entry.output.trimEnd();
        entry.read = entry.output.length;
        const state = entry.done ? `It has already exited with code ${entry.code}.` : 'It is running.';
        return {
          output: `Started in the background as process ${entry.id}. ${state} Read more output with process_output, stop it with process_stop.${first ? `\n\nOutput so far:\n${first}` : ''}`,
          note: `process ${entry.id}${entry.done ? ` · exited ${entry.code}` : ' · running'}`,
          display: first,
        };
      }
      const seconds = Math.min(600, Math.max(1, Number(args.timeout) || 120));
      const env = { ...process.env, PAGER: 'cat', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', CI: '1' };
      const shell = process.env.SHELL || '/bin/sh';
      const r = await runProcess(shell, ['-c', args.command], { cwd, signal, timeoutMs: seconds * 1000, env });
      if (r.error) throw new ToolError(`Could not start the shell: ${r.error.message}`);
      const body = r.output.trimEnd();
      let out = body || '(no output)';
      let note = 'exit 0';
      if (r.killed === 'timeout') {
        out += `\n\n[killed: exceeded ${seconds}s timeout]`;
        note = `timed out after ${seconds}s`;
      } else if (r.killed === 'aborted') {
        out += '\n\n[interrupted by the user]';
        note = 'interrupted';
      } else if (r.code !== 0) {
        out += `\n\n[exit code ${r.code}]`;
        note = `exit ${r.code}`;
      }
      return { output: out, note, display: body };
    },
  },
  {
    name: 'glob',
    risk: 'read',
    description: 'Find files by glob pattern, e.g. "src/**/*.ts" or "**/package.json". Newest first. node_modules and .git are skipped.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern' },
        path: { type: 'string', description: 'Directory to search. Default: working directory' },
      },
      required: ['pattern'],
    },
    verbs: ['Finding', 'Found'],
    summary: (a) => a.pattern,
    async run(args, { cwd, signal }) {
      if (typeof args.pattern !== 'string' || !args.pattern) throw new ToolError('"pattern" is required');
      const root = args.path ? resolvePath(args.path, cwd) : cwd;
      const exclude = (entry) => IGNORED_DIRS.has(typeof entry === 'string' ? path.basename(entry) : entry.name);
      const found = [];
      const deadline = Date.now() + 15_000;
      let truncated = false;
      for await (const match of fsp.glob(args.pattern, { cwd: root, exclude })) {
        found.push(match);
        if (found.length >= 300 || Date.now() > deadline || signal?.aborted) {
          truncated = true;
          break;
        }
      }
      if (!found.length) return { output: 'No files matched.', note: 'no files' };
      const withTime = await Promise.all(
        found.map(async (f) => ({ f, t: (await fsp.stat(path.join(root, f)).catch(() => null))?.mtimeMs ?? 0 })),
      );
      withTime.sort((a, b) => b.t - a.t);
      const list = withTime.map((x) => x.f).join('\n');
      return { output: list + (truncated ? '\n\n[results truncated — narrow the pattern]' : ''), note: `${found.length} file${found.length > 1 ? 's' : ''}` };
    },
  },
  {
    name: 'grep',
    risk: 'read',
    description: 'Search file contents with a regular expression. Returns matching lines as path:line:text.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression' },
        path: { type: 'string', description: 'File or directory to search. Default: working directory' },
        include: { type: 'string', description: 'Only search files matching this glob, e.g. "*.ts"' },
        ignore_case: { type: 'boolean', description: 'Case-insensitive search' },
      },
      required: ['pattern'],
    },
    verbs: ['Searching for', 'Searched for'],
    summary: (a) => `"${a.pattern}"${a.include ? ` in ${a.include}` : ''}`,
    async run(args, { cwd, signal }) {
      if (typeof args.pattern !== 'string' || !args.pattern) throw new ToolError('"pattern" is required');
      const target = args.path ? resolvePath(args.path, cwd) : '.';
      let cmd;
      let argv;
      if (ripgrepAvailable()) {
        cmd = 'rg';
        argv = ['-n', '--no-heading', '--color', 'never', '--max-columns', '300'];
        if (args.ignore_case) argv.push('-i');
        if (args.include) argv.push('-g', args.include);
        argv.push('-e', args.pattern, target);
      } else {
        cmd = 'grep';
        argv = ['-rnIE', ...[...IGNORED_DIRS].map((d) => `--exclude-dir=${d}`)];
        if (args.ignore_case) argv.push('-i');
        if (args.include) argv.push(`--include=${args.include}`);
        argv.push('-e', args.pattern, target);
      }
      const r = await runProcess(cmd, argv, { cwd, signal, timeoutMs: 30_000 });
      if (r.error) throw new ToolError(`Search failed: ${r.error.message}`);
      if (r.code > 1) throw new ToolError(r.output.trim() || `search exited with code ${r.code}`);
      const lines = r.output.split('\n').filter(Boolean).map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…` : l));
      if (!lines.length) return { output: 'No matches.', note: 'no matches' };
      const shown = lines.slice(0, 200);
      const more = lines.length > shown.length ? `\n\n[${lines.length - shown.length} more matches — narrow the search]` : '';
      return { output: shown.join('\n') + more, note: `${lines.length} match${lines.length > 1 ? 'es' : ''}` };
    },
  },
  {
    name: 'list_dir',
    risk: 'read',
    description: 'List the entries of a directory. Directories end with "/".',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory. Default: working directory' } },
    },
    verbs: ['Listing', 'Listed'],
    summary: (a) => pathArg(a) || '.',
    async run(args, { cwd }) {
      const dir = pathArg(args) ? resolvePath(pathArg(args), cwd) : cwd;
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch((e) => {
        throw new ToolError(e.code === 'ENOENT' ? `Directory not found: ${dir}` : e.message);
      });
      const names = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort((a, b) => Number(b.endsWith('/')) - Number(a.endsWith('/')) || a.localeCompare(b));
      const shown = names.slice(0, 300);
      const more = names.length > shown.length ? `\n[${names.length - shown.length} more entries]` : '';
      return { output: (shown.join('\n') || '(empty directory)') + more, note: `${names.length} entries` };
    },
  },
  {
    name: 'web_fetch',
    risk: 'net',
    description: 'Fetch a URL and return its content as plain text (HTML is stripped). Use for documentation or API references.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'http(s) URL' } },
      required: ['url'],
    },
    verbs: ['Fetching', 'Fetched'],
    summary: (a) => a.url,
    async run(args, { signal }) {
      const page = await fetchPage(args.url, signal);
      return { output: `HTTP ${page.status} ${page.url}\n\n${page.text}`, note: `HTTP ${page.status} · ${page.text.length} characters` };
    },
  },
  {
    name: 'skill',
    risk: 'read',
    description: 'Load the full instructions of a skill listed under "Skills" in the system prompt. Call it before starting a task the skill covers.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name, exactly as listed' } },
      required: ['name'],
    },
    verbs: ['Loading skill', 'Loaded skill'],
    summary: (a) => a.name,
    async run(args, { skills = [] }) {
      const wanted = String(args.name ?? '').trim().toLowerCase().replace(/^\//, '');
      const found = skills.find((s) => s.name === wanted);
      if (!found) throw new ToolError(`No skill named "${wanted}". Available: ${skills.map((s) => s.name).join(', ') || '(none)'}`);
      import('./skill-manage.mjs').then((m) => m.recordUse(found.name), () => {});
      return { output: renderSkill(found) };
    },
  },
  {
    name: 'process_output',
    risk: 'read',
    description: 'Read what a background process (started by bash with background: true) has printed since you last looked, and whether it is still running.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Process id, e.g. "p1"' },
        wait: { type: 'integer', description: 'Seconds to wait for new output first. Default 0, max 60' },
      },
      required: ['id'],
    },
    verbs: ['Checking process', 'Checked process'],
    summary: (a) => a.id,
    async run(args, { signal }) {
      const entry = processes.get(String(args.id));
      if (!entry) throw new ToolError(`No background process "${args.id}". Running: ${[...processes.keys()].join(', ') || '(none)'}`);
      const until = Date.now() + Math.min(60, Math.max(0, Number(args.wait) || 0)) * 1000;
      while (Date.now() < until && !entry.done && entry.output.length === entry.read && !signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const fresh = entry.output.slice(entry.read).trimEnd();
      entry.read = entry.output.length;
      const state = entry.done ? `exited with code ${entry.code}` : 'still running';
      return { output: `Process ${entry.id} (${entry.command}) — ${state}.\n\n${fresh || '(no new output)'}`, note: state, display: fresh };
    },
  },
  {
    name: 'process_stop',
    risk: 'read',
    description: 'Stop a background process started by bash with background: true.',
    parameters: { type: 'object', properties: { id: { type: 'string', description: 'Process id, e.g. "p1"' } }, required: ['id'] },
    verbs: ['Stopping process', 'Stopped process'],
    summary: (a) => a.id,
    async run(args) {
      const entry = processes.get(String(args.id));
      if (!entry) throw new ToolError(`No background process "${args.id}".`);
      const was = entry.done;
      stopProcess(entry);
      return { output: was ? `Process ${entry.id} had already exited with code ${entry.code}.` : `Process ${entry.id} was stopped.`, note: was ? 'already exited' : 'stopped' };
    },
  },
  {
    name: 'web_search',
    risk: 'other',
    description: 'Search the web. Returns titles, addresses and short excerpts; open a result with web_fetch to read it. Use it for current information, documentation and error messages you do not recognise.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for' } },
      required: ['query'],
    },
    verbs: ['Searching the web for', 'Searched the web for'],
    summary: (a) => `"${a.query ?? ''}"`,
    async run(args, { signal }) {
      if (typeof args.query !== 'string' || !args.query.trim()) throw new ToolError('"query" is required');
      const timeout = AbortSignal.timeout(25_000);
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'accept-language': 'en-US,en;q=0.9',
        },
      }).catch((e) => {
        throw new ToolError(`Search failed: ${e.cause?.message || e.message}`);
      });
      if (!res.ok) throw new ToolError(`The search service answered HTTP ${res.status}`);
      const results = parseSearchResults(await res.text()).slice(0, 8);
      if (!results.length) return { output: 'No results (or the search service did not return a readable page).', note: 'no results' };
      const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n\n');
      return { output: text, note: `${results.length} results` };
    },
  },
  {
    name: 'ask_user',
    risk: 'read',
    description: 'Ask the user a question when the work cannot go on without a decision that is theirs to make. Offer 2-4 options when the choices are known. Do not use it for things you can find out yourself or for permission to continue.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question, complete enough to answer on its own' },
        options: { type: 'array', items: { type: 'string' }, description: 'Choices to offer; put the one you recommend first' },
      },
      required: ['question'],
    },
    verbs: ['Asking', 'Asked'],
    summary: (a) => a.question ?? '',
    async run(args, ctx) {
      if (typeof args.question !== 'string' || !args.question.trim()) throw new ToolError('"question" is required');
      let options = args.options ?? [];
      if (typeof options === 'string') {
        try {
          options = JSON.parse(options);
        } catch {
          options = [];
        }
      }
      if (!ctx.askUser) return 'No user is available to answer (this run is not interactive). Choose the most reasonable option yourself and say which assumption you made.';
      const answer = await ctx.askUser({ question: args.question, options: Array.isArray(options) ? options.map(String).slice(0, 6) : [] });
      if (answer === null) return { output: 'The user did not answer. Stop and wait for them rather than guessing.', note: 'no answer' };
      return { output: `The user answered: ${answer}`, note: answer };
    },
  },
  {
    name: 'task',
    risk: 'read',
    description: 'Hand self-contained work to helper agents that each start with an empty context and have the same tools. Use it for searches and investigations that would fill your own context with file contents, and for independent pieces of work that can go on side by side: you get back only each helper\'s report. One helper: pass `prompt`. Several at once (up to 3): pass `tasks`. A helper knows nothing of this conversation, so each prompt must say everything it needs — the goal, where to look, what to return. A report is a self-report, not a verified fact: check what matters (a file it says it wrote, a test it says passes) before telling the user.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Three to five words naming the job' },
        prompt: { type: 'string', description: 'The full instructions for one helper' },
        tasks: {
          type: 'array',
          description: 'Several jobs to run in parallel, up to 3. Each helper sees only its own prompt — repeat shared background in every one that needs it.',
          items: {
            type: 'object',
            properties: { description: { type: 'string', description: 'Three to five words naming the job' }, prompt: { type: 'string', description: 'The full instructions for this helper' } },
            required: ['prompt'],
          },
        },
      },
    },
    verbs: ['Delegating', 'Delegated'],
    summary: (a) => (Array.isArray(a.tasks) && a.tasks.length ? `${a.tasks.length} tasks in parallel` : (a.description ?? String(a.prompt ?? '').slice(0, 60))),
    async run(args, ctx) {
      let tasks = args.tasks;
      if (typeof tasks === 'string') {
        try {
          tasks = JSON.parse(tasks);
        } catch {
          tasks = null;
        }
      }
      if (Array.isArray(tasks) && tasks.length) {
        if (!ctx.delegateMany) throw new ToolError('A helper cannot start another helper. Do this part yourself.');
        if (tasks.length > 3) throw new ToolError(`At most 3 helpers can run at once; ${tasks.length} were asked for. Send them in batches.`);
        const jobs = tasks.map((t, i) => ({ description: String(t?.description ?? t?.goal ?? `task ${i + 1}`).slice(0, 80), prompt: String(t?.prompt ?? t?.goal ?? '') + (t?.context ? `\n\nCONTEXT:\n${t.context}` : '') }));
        if (jobs.some((j) => !j.prompt.trim())) throw new ToolError('Every task needs a "prompt".');
        const results = await ctx.delegateMany(jobs);
        const output = results.map((r, i) => `## Helper ${i + 1}: ${r.description} — ${r.status}\n${r.report || '(it returned nothing)'}`).join('\n\n');
        return { output, note: `${results.filter((r) => r.status === 'completed').length}/${results.length} completed` };
      }
      if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw new ToolError('"prompt" (one helper) or "tasks" (several) is required');
      if (!ctx.delegate) throw new ToolError('A helper cannot start another helper. Do this part yourself.');
      const report = await ctx.delegate(args.prompt, this.summary(args));
      return { output: report || '(the helper returned nothing)', note: `${report.split('\n').filter((l) => l.trim()).length} lines reported` };
    },
  },
  {
    name: 'memory',
    // Saved text is read back as context in every later session, so saving it is asked about.
    risk: 'learn',
    // What a model with a small context is told instead: the long form costs it too much room.
    brief: "Save durable facts that survive across sessions (they are put into every future session, so keep entries short). One call per target with an 'operations' array of {action: add|patch|remove, content?, old_text?}; it applies all-or-nothing and the size limit is checked on the final result. Targets: 'user' = who the user is; 'memory' = facts true in every project; 'project' = this folder only. Save only what holds for EVERY session — not task progress, and not procedures (those go in a skill via skill_manage).",
    description:
      "Save durable facts to persistent memory that survive across sessions. Memory is injected into every future session, so keep entries compact and high-signal.\n\nHOW: make ALL your changes to one target in ONE call via an 'operations' array (each item: {action, content?, old_text?}). The batch applies atomically and the char limit is checked only on the FINAL result — so a single call can remove/patch stale entries to free room AND add new ones. One batch call finishes the update; don't repeat it.\n\nWHEN: only for facts that apply to EVERY session regardless of task: who the user is, stable environment facts, standing conventions. Anything learned while doing a task (procedures, pitfalls, the user's corrections for that kind of work) belongs in a skill via skill_manage, where it loads only when relevant.\n\nIF FULL: an add is rejected with the current entries shown. Reissue as ONE batch that removes or shortens stale entries and adds the new one together.\n\nTARGETS: 'user' = who the user is (name, role, preferences, style). 'memory' = your notes that hold in every project (environment, conventions, tool quirks). 'project' = facts about the project in this working folder only.\n\nSKIP: trivial or easily re-discovered facts, raw data dumps, task progress, completed-work logs, temporary TODO state (session_search finds those).",
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['memory', 'user', 'project'], description: "Which store: 'memory' for notes that hold everywhere, 'user' for the user profile, 'project' for this folder only." },
        operations: {
          type: 'array',
          description: 'The changes, applied in order as one all-or-nothing batch.',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'patch', 'remove'] },
              content: { type: 'string', description: "Required for 'add' and 'patch'. For 'add', the new entry. For 'patch', the text that replaces old_text; the rest of the entry is kept." },
              old_text: { type: 'string', description: "REQUIRED for 'patch' and 'remove': text from one entry. 'patch' replaces exactly this span (it must occur once in the entry); 'remove' deletes the whole entry. Omit for 'add'." },
            },
            required: ['action'],
          },
        },
      },
      required: ['target', 'operations'],
    },
    verbs: ['Updating memory', 'Updated memory'],
    // Shown when approval is asked, so the user sees what would be remembered.
    summary: (a) => {
      const ops = Array.isArray(a.operations) ? a.operations : a.action ? [a] : [];
      const text = ops.map((op) => (op?.action === 'add' ? `+ ${op.content ?? ''}` : op?.action === 'remove' ? `− ${op.old_text ?? ''}` : `~ ${op?.old_text ?? ''} → ${op?.content ?? ''}`)).join(' · ');
      return `${a.target ?? ''}: ${text}`.replace(/\s+/g, ' ').slice(0, 300);
    },
    async run(args, ctx) {
      const { updateMemory } = await import('./memory.mjs');
      const result = updateMemory(args, { cwd: ctx.cwd, turn: ctx.turn, addOnly: ctx.review });
      return { output: JSON.stringify(result, null, 1), note: result.success ? result.usage : 'not saved' };
    },
  },
  {
    name: 'session_search',
    risk: 'read',
    // What a model with a small context is told instead: the long form costs it too much room.
    brief: "Search or read past SEEKER conversations. `query` = find matching sessions; `session_id` = read one; `session_id` + `around_message_index` = scroll in it; no args = list recent ones. Use it when the user refers to earlier work before asking them to repeat it.",
    description:
      "Search or read past SEEKER conversations, or scroll inside one. Four shapes, picked by args: `query` = discovery (the best matching sessions, the top one opened up); `session_id` + `around_message_index` = scroll (a window of messages around one); `session_id` alone = read a whole session (its start and end); no args = browse recent sessions. Results are the saved messages themselves. Searches conversation history ONLY — when the user gave a direct source (URL, file, live system), inspect that first; never conclude 'not found' from history alone. Use for questions about past conversations: 'what did we do about X', 'where did we leave Y'.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for. All must appear in one message; use OR between alternatives, "quotes" for an exact phrase, -word to exclude, deploy* for a prefix.' },
        session_id: { type: 'string', description: 'A session id from an earlier result, to read or scroll in.' },
        around_message_index: { type: 'integer', description: 'With session_id: show the messages around this index.' },
        window: { type: 'integer', description: 'Messages each side when scrolling. Default 5, max 20.' },
        limit: { type: 'integer', description: 'How many sessions. Default 3 when searching, 10 when browsing; max 10.' },
        sort: { type: 'string', enum: ['newest', 'oldest'], description: 'Order by time instead of relevance.' },
        detail: { type: 'string', enum: ['adaptive', 'full'], description: "'full' opens up every result, not just the best. Default adaptive." },
        after: { type: 'string', description: 'Only sessions after this: an ISO date, or 7d / 24h / 2w ago.' },
        before: { type: 'string', description: 'Only sessions before this.' },
        role_filter: { type: 'string', description: 'Roles to search, comma separated. Default "user,assistant"; add "tool" to search command output.' },
      },
    },
    verbs: ['Searching past sessions', 'Searched past sessions'],
    summary: (a) => (a.query ? `"${a.query}"` : a.session_id ? String(a.session_id).split('/').at(-1) : 'recent'),
    async run(args, ctx) {
      const { searchSessions } = await import('./session-search.mjs');
      const result = searchSessions(args, { currentFile: ctx.sessionFile ?? null });
      const count = result.results?.length ?? result.recent_sessions?.length ?? (result.messages ? 1 : 0);
      return { output: JSON.stringify(result, null, 1), note: result.success ? `${count} session${count === 1 ? '' : 's'}` : 'not found' };
    },
  },
  {
    name: 'skill_manage',
    // Saved text is read back as context in every later session, so saving it is asked about.
    risk: 'learn',
    // What a model with a small context is told instead: the long form costs it too much room.
    brief: "Create or update skills — reusable instructions for a kind of task. 'operations' is an array of {action, name, …}: create (content = full SKILL.md with `name` and `description` frontmatter), patch (old_string + new_string), write_file / remove_file (file_path under references/, templates/, scripts/ or assets/), delete (alone in its call). All-or-nothing. Description max 120 chars: 'Use when <trigger>. <behaviour>.'. Prefer patching the skill you used over creating a new one.",
    description:
      "Create, update or delete skills: your procedural memory for recurring tasks. The call is an operations array (a single edit is a list of one); it applies atomically — any failure rolls every touched skill back. Ops: create (full SKILL.md with `name` and `description` frontmatter; lands in ~/.seeker/skills), patch (targeted old_string/new_string fix — preferred; content alone REPLACES the whole SKILL.md, read it with read_file first), write_file/remove_file (supporting files under references/, templates/, scripts/ or assets/), delete (sole op only). Description: max 120 chars, 'Use when <trigger>. <behaviour>.'. Write lessons, not logs: imperative rule + why, no PR numbers/dates/incident narration, one rule per lesson. Prefer patching the skill you just used over creating a new one; name a new skill after the class of task, not one incident.",
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Ordered ops; each names its target skill (lowercase, hyphens/underscores, max 64 chars).',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create', 'patch', 'write_file', 'remove_file', 'delete'] },
              name: { type: 'string', description: 'The skill this op applies to.' },
              content: { type: 'string', description: 'create: the full SKILL.md. patch without old_string: the full replacement SKILL.md.' },
              old_string: { type: 'string', description: 'patch: exact text to replace.' },
              new_string: { type: 'string', description: 'patch: replacement; an empty string deletes the match.' },
              replace_all: { type: 'boolean', description: 'patch: replace every occurrence.' },
              file_path: { type: 'string', description: "Path RELATIVE to the skill's own folder, e.g. 'references/api.md'; first segment references/, templates/, scripts/ or assets/. On patch: patch that file instead of SKILL.md." },
              file_content: { type: 'string', description: 'write_file: the file content.' },
            },
            required: ['action', 'name'],
          },
        },
      },
      required: ['operations'],
    },
    verbs: ['Updating skills', 'Updated skills'],
    summary: (a) => (Array.isArray(a.operations) ? a.operations.map((op) => `${op?.action ?? '?'} ${op?.name ?? ''}`.trim()).join(', ') : ''),
    async run(args, ctx) {
      const { manageSkills } = await import('./skill-manage.mjs');
      const result = manageSkills(args, { skills: ctx.skills ?? [], review: ctx.review });
      if (result.success) ctx.skillsChanged?.(result.created);
      return { output: JSON.stringify(result, null, 1), note: result.success ? result.done.join(', ') : 'not changed' };
    },
  },
  {
    name: 'cronjob_manage',
    // A job's prompt runs later with nobody watching, so creating or changing one is asked about.
    risk: 'learn',
    brief: "Schedule a task to run by itself, once or repeatedly: action create (needs 'schedule' and 'prompt'), list, update, pause, resume, remove, run. Schedule forms: 'every 2h', 'in 30m' (once), 'every monday 9am', 'weekdays at 9am', '0 9 * * *', or an ISO time. The job runs in a fresh session with none of this conversation, so its prompt must be self-contained.",
    description:
      "Schedule recurring or one-off agent tasks (cron jobs): create, list, edit, run. action='create' schedules a job from a prompt; 'list' inspects jobs; 'update'/'pause'/'resume'/'remove' manage one by job_id (always list first — never guess job IDs); 'run' fires a job immediately.\n\nJobs run in a fresh session with no current-chat context, so prompts must be self-contained, and the agent's FINAL RESPONSE is what gets delivered — cron runs are autonomous and cannot ask questions. A job may read files and run harmless commands; it changes files only if created with allow_changes, and never runs risky commands. Jobs run while SEEKER is open, or when the system scheduler runs `seeker cron tick`. Prefer updating an existing job over creating near-duplicates.",
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'list', 'update', 'pause', 'resume', 'remove', 'run'], description: "When action=create, the 'schedule' and 'prompt' fields are REQUIRED." },
        job_id: { type: 'string', description: 'Required for update/pause/resume/remove/run.' },
        schedule: { type: 'string', description: "REQUIRED for create. Schedule forms: (1) recurring interval — '30m', 'every 2h', 'every hour' (forever by default); (2) explicit one-shot by duration — 'in 30m', 'in 2h' (fires ONCE that far from now; use this for 'remind me in N minutes' — do NOT hand-compute an absolute timestamp); (3) natural day/time — 'every monday 9am', 'weekdays at 9am', 'every day at 9am'; (4) cron syntax — '0 9 * * *' (daily 9am); (5) absolute one-shot — ISO timestamp '2026-06-01T09:00:00'." },
        prompt: { type: 'string', description: "For create/update: the full self-contained prompt (when it runs goes in 'schedule'; data windows like 'since yesterday' stay here)." },
        name: { type: 'string', description: 'A short name for the job.' },
        repeat: { type: 'integer', description: 'Optional repeat count. Omit for defaults (once for one-shot, forever for recurring).' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Names of skills whose instructions the job should follow.' },
        allow_changes: { type: 'boolean', description: 'Let the job write and edit files and run ordinary commands in its folder. Default false: it can only read and report.' },
      },
      required: ['action'],
    },
    verbs: ['Scheduling', 'Scheduled'],
    // Shown when approval is asked: everything that decides what will run unattended, for a change as for a new job.
    summary: (a) => {
      const parts = [String(a.action ?? ''), a.job_id ? String(a.job_id) : ''];
      if (a.schedule !== undefined) parts.push(`schedule: ${a.schedule}`);
      if (a.allow_changes !== undefined) parts.push(a.allow_changes === true || a.allow_changes === 'true' ? '(MAY CHANGE FILES and run commands)' : '(read-only)');
      if (a.repeat !== undefined) parts.push(`repeat: ${a.repeat}`);
      if (Array.isArray(a.skills) && a.skills.length) parts.push(`skills: ${a.skills.join(', ')}`);
      if (a.prompt !== undefined) {
        const prompt = String(a.prompt).replace(/\s+/g, ' ');
        parts.push(`prompt: ${prompt.length > 600 ? `${prompt.slice(0, 600)}… [${prompt.length - 600} more characters]` : prompt}`);
      }
      return parts.filter(Boolean).join(' · ');
    },
    async run(args, ctx) {
      const { manageJobs } = await import('./cron.mjs');
      if (String(args.action).toLowerCase() === 'run') {
        if (!ctx.cronRun) throw new ToolError('A job can only be run by hand from an interactive session.');
        const result = await ctx.cronRun(String(args.job_id ?? ''));
        if (!result) throw new ToolError(`No job with id "${args.job_id ?? ''}". List the jobs first.`);
        return { output: JSON.stringify({ success: !result.error, error: result.error, reply: result.reply, saved_to: result.file }, null, 1), note: result.error ? 'failed' : 'ran' };
      }
      const result = manageJobs(args, { cwd: ctx.cwd });
      ctx.cronChanged?.();
      return { output: JSON.stringify(result, null, 1), note: result.success ? (result.jobs ? `${result.count} job${result.count === 1 ? '' : 's'}` : (result.job?.schedule ?? 'done')) : 'not done' };
    },
  },
  {
    name: 'todo_write',
    risk: 'read',
    description:
      'Record your task plan as a checklist the user can see. Send the full list every time. Use it for work with 3 or more steps, and update statuses as you go (only one item in_progress at a time).',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    verbs: ['Updating plan', 'Updated plan'],
    summary: () => '',
    async run(args, ctx) {
      let todos = args.todos;
      if (typeof todos === 'string') todos = JSON.parse(todos);
      if (!Array.isArray(todos)) throw new ToolError('"todos" must be an array');
      ctx.state.todos = todos.map((t) => ({
        content: String(t.content ?? t.task ?? t.title ?? ''),
        status: TODO_MARK[t.status] ? t.status : 'pending',
      }));
      const display = ctx.state.todos.map((t) => `${TODO_MARK[t.status]} ${t.content}`).join('\n');
      return { output: 'Todo list updated.', display, displayLines: 30 };
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

const TYPE_CHECK = {
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isFinite(Number(v)) && String(v).trim() !== '',
  number: (v) => Number.isFinite(Number(v)) && String(v).trim() !== '',
  boolean: (v) => typeof v === 'boolean' || v === 'true' || v === 'false',
  array: (v) => Array.isArray(v) || typeof v === 'string',
  object: (v) => v !== null && typeof v === 'object',
};

/**
 * Checks arguments against the tool's schema before anything runs. Models can
 * send incomplete input — a streamed call cut short still parses as a smaller
 * valid object. Returns a message describing the problem, or null.
 */
export function validateArgs(tool, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be a JSON object';
  if ('INVALID_JSON' in args) return 'the arguments were not valid JSON';
  const { properties = {}, required = [] } = tool.parameters;
  // `path` has accepted aliases (file_path, …) that each tool resolves itself.
  const missing = required.filter((key) => args[key] === undefined && !(key === 'path' && pathArg(args) !== undefined));
  if (missing.length) return `missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`;
  for (const [key, value] of Object.entries(args)) {
    const type = properties[key]?.type;
    if (type && value !== undefined && value !== null && !TYPE_CHECK[type]?.(value)) return `argument "${key}" must be ${type}`;
  }
  return null;
}

/**
 * The tool list in the shape Ollama's /api/chat expects. With `compact`, tools that have a
 * short description use it: on a small context every request carries these definitions.
 */
export const toolSpecs = (tools = TOOLS, { compact = false } = {}) =>
  tools.map((t) => ({ type: 'function', function: { name: t.name, description: (compact && t.brief) || t.description, parameters: compact && t.brief ? slim(t.parameters) : t.parameters } }));

/** A schema with the parameter descriptions shortened to their first sentence. */
function slim(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(slim);
  const out = {};
  for (const [key, value] of Object.entries(schema)) out[key] = key === 'description' && typeof value === 'string' ? value.split(/(?<=[.;])\s/)[0] : slim(value);
  return out;
}

export { rel };
