// The tools SEEKER can call. Each one declares a `risk` that the permission
// layer keys off: 'read' runs freely, 'write' / 'exec' / 'net' need approval.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderSkill } from './skills.mjs';

export class ToolError extends Error {}

const MAX_OUTPUT = 24_000;
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

export const TOOLS = [
  {
    name: 'read_file',
    risk: 'read',
    description:
      'Read a text file. Returns lines prefixed with their line number. Use offset/limit for large files. Always read a file before editing it.',
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
    async run(args, { cwd }) {
      const file = resolvePath(pathArg(args), cwd);
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat) throw new ToolError(`File not found: ${file}`);
      if (stat.isDirectory()) throw new ToolError(`${file} is a directory — use list_dir`);
      if (stat.size > 5_000_000) throw new ToolError(`File is ${stat.size} bytes — too large; use grep to find the part you need`);
      const buf = await fsp.readFile(file);
      if (buf.subarray(0, 8000).includes(0)) throw new ToolError('Binary file — cannot be read as text');
      const lines = buf.toString('utf8').split('\n');
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
      return { output: body + more, note: `${slice.length} lines` };
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
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, args.content);
      const count = args.content.split('\n').length;
      return { output: `${existed ? 'Overwrote' : 'Created'} ${file} (${count} lines)`, note: `${existed ? 'overwrote' : 'created'} · ${count} lines` };
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
      return { output: `Edited ${file} (${n} replacement${n > 1 ? 's' : ''})`, note: `${n} replacement${n > 1 ? 's' : ''}` };
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
      let url;
      try {
        url = new URL(args.url);
      } catch {
        throw new ToolError('"url" must be a valid http(s) URL');
      }
      if (!/^https?:$/.test(url.protocol)) throw new ToolError('Only http(s) URLs are supported');
      const timeout = AbortSignal.timeout(30_000);
      const res = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { 'user-agent': 'seeker-cli', accept: 'text/html,text/plain,application/json,*/*' },
      }).catch((e) => {
        throw new ToolError(`Request failed: ${e.cause?.message || e.message}`);
      });
      const body = await res.text();
      const type = res.headers.get('content-type') || '';
      const text = type.includes('html') ? htmlToText(body) : body;
      return { output: `HTTP ${res.status} ${url.href}\n\n${text}`, note: `HTTP ${res.status} · ${text.length} characters` };
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
    description: 'Hand a self-contained piece of work to a helper agent that starts with an empty context and has the same tools. Use it for searches and investigations that would fill your own context with file contents: you get back only its report. The helper knows nothing of this conversation, so the prompt must say everything it needs — the goal, where to look, what to return.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Three to five words naming the job' },
        prompt: { type: 'string', description: 'The full instructions for the helper' },
      },
      required: ['prompt'],
    },
    verbs: ['Delegating', 'Delegated'],
    summary: (a) => a.description ?? String(a.prompt ?? '').slice(0, 60),
    async run(args, ctx) {
      if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw new ToolError('"prompt" is required');
      if (!ctx.delegate) throw new ToolError('A helper cannot start another helper. Do this part yourself.');
      const report = await ctx.delegate(args.prompt, this.summary(args));
      return { output: report || '(the helper returned nothing)', note: `${report.split('\n').filter((l) => l.trim()).length} lines reported` };
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

/** The tool list in the shape Ollama's /api/chat expects. */
export const toolSpecs = (tools = TOOLS) =>
  tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

export { rel };
