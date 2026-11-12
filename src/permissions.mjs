// Decides whether a tool call may run. Reads are free; writes, shell commands
// and network requests need the user's approval unless a rule already covers them.
import path from 'node:path';

// Asked about even in --yolo mode: these are hard to undo.
const DANGEROUS = [
  /\brm\s+(-\S+\s+)*-\S*[rf]/i,
  /\bsudo\b/,
  /\bgit\s+push\b.*(--force|\s-f\b|--delete|\s:)/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-\S*f/,
  /\bgit\s+checkout\s+(--\s+)?\./,
  /\bmkfs\b|\bdd\s+if=|\bdiskutil\s+(erase|partition)/,
  /\b(curl|wget)\b[^|;]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/,
  /\bchmod\s+-R\b|\bchown\s+-R\b/,
  /\b(shutdown|reboot|halt)\b/,
  /\bkillall\b|\bpkill\b/,
  />\s*\/dev\/(disk|sd|nvme)/,
  /:\(\)\s*\{/,
  /\bdrop\s+(table|database)\b/i,
  /\b(npm|pnpm|yarn)\s+publish\b/,
];

const SAFE_COMMANDS = new Set([
  'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'echo', 'which', 'file', 'stat', 'du', 'df', 'date', 'whoami',
  'uname', 'rg', 'grep', 'tree', 'sort', 'uniq', 'cut', 'diff', 'basename', 'dirname', 'realpath', 'true',
]);
const SAFE_GIT = new Set(['status', 'diff', 'log', 'show', 'branch', 'remote', 'rev-parse', 'ls-files', 'blame', 'describe']);

export const isDangerous = (command) => DANGEROUS.some((re) => re.test(command));

/**
 * Splits a command line into its pipeline / chain segments, or null if it does something we can't reason about.
 * The split is deliberately cruder than a shell's: it may cut inside quotes, which only produces extra
 * segments that must each pass. Anything that could start a command this split would not see — a lone `&`,
 * substitution, expansion, grouping, escapes, redirection — makes the whole line unknown.
 */
function segments(command) {
  const stripped = command.replace(/\s2>&1/g, ' ').replace(/\s2>\s*\/dev\/null/g, ' ');
  if (/[`<>$(){}\\\n\r]/.test(stripped)) return null;
  if (stripped.replace(/&&/g, ' ').includes('&')) return null;
  return stripped.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
}

// Options that make an otherwise read-only command write a file or start a program.
// Short options are matched inside clusters too (`sort -no out`).
const short = (letters) => new RegExp(`(^|\\s)-[A-Za-z0-9]*[${letters}]`);
const UNSAFE_OPTIONS = {
  rg: /(^|\s)--(pre|hostname-bin)/,
  sort: new RegExp(`${short('o').source}|(^|\\s)--(o|comp)`),
  tree: new RegExp(`${short('o').source}|(^|\\s)--output`),
  file: new RegExp(`${short('C').source}|(^|\\s)--comp`),
  date: new RegExp(`${short('s').source}|(^|\\s)--set`),
};

function isSafeGit(words, segment) {
  if (!SAFE_GIT.has(words[1]) || /(^|\s)--output/.test(segment)) return false;
  const rest = words.slice(2);
  // Listing only: any name after `branch` would create or change one.
  if (words[1] === 'branch') return rest.every((w) => /^(-a|-r|-v|-vv|-l|--all|--remotes|--list|--verbose|--show-current)$/.test(w));
  if (words[1] === 'remote') return rest.length === 0 || rest.every((w) => /^(-v|--verbose)$/.test(w)) || rest[0] === 'get-url';
  return true;
}

function isSafeSegment(segment) {
  const words = segment.split(/\s+/);
  if (words[0] === 'git') return isSafeGit(words, segment);
  if (words[0] === 'find') return !/-(delete|exec|execdir|ok|fprint|fls)/.test(segment);
  // `uniq in out` writes its second file.
  if (words[0] === 'uniq') return words.slice(1).filter((w) => !w.startsWith('-')).length <= 1;
  if (UNSAFE_OPTIONS[words[0]]?.test(words.slice(1).join(' '))) return false;
  return SAFE_COMMANDS.has(words[0]);
}

/** The rule offered by "always allow": `npm test`, `git commit`, or just `make`. */
export function bashPrefix(command) {
  const words = command.trim().split(/\s+/);
  return words[1] && /^[a-z][\w:-]*$/i.test(words[1]) ? `${words[0]} ${words[1]}` : words[0];
}

export class Permissions {
  /**
   * @param {{ mode: 'ask'|'auto', cwd: string, ask: null | ((q: object) => Promise<string|null>) }} opts
   *        `ask` is null when nobody is there to answer (print mode).
   */
  constructor({ mode, cwd, ask }) {
    this.mode = mode;
    this.cwd = cwd;
    this.ask = ask;
    this.allowWrites = false;
    this.bashPrefixes = new Set();
    this.hosts = new Set();
    this.toolNames = new Set();
  }

  #bashAllowed(command) {
    const parts = segments(command);
    if (!parts?.length) return false;
    return parts.every((s) => isSafeSegment(s) || [...this.bashPrefixes].some((p) => s === p || s.startsWith(`${p} `)));
  }

  #insideCwd(file) {
    const r = path.relative(this.cwd, file);
    return !r.startsWith('..') && !path.isAbsolute(r);
  }

  /** @returns {Promise<{ ok: true } | { ok: false, reason: string }>} */
  async check(tool, args) {
    if (tool.risk === 'read') return { ok: true };

    let always = null; // { label, apply } offered as the "always" answer
    let warning = null;

    if (tool.risk === 'exec') {
      const command = String(args.command ?? '');
      if (isDangerous(command)) warning = 'This command is risky or hard to undo.';
      else if (this.mode === 'auto' || this.#bashAllowed(command)) return { ok: true };
      else if (segments(command)?.length === 1) {
        const prefix = bashPrefix(command);
        always = { label: `always allow \`${prefix} …\``, apply: () => this.bashPrefixes.add(prefix) };
      }
    } else if (tool.risk === 'write') {
      const inside = this.#insideCwd(tool.targetPath(args, this.cwd));
      if (!inside) warning = 'This file is outside the working folder.';
      else if (this.mode === 'auto' || this.allowWrites) return { ok: true };
      else always = { label: 'always allow edits this session', apply: () => (this.allowWrites = true) };
    } else if (tool.risk === 'net') {
      let host = '';
      try {
        host = new URL(args.url).host;
      } catch {}
      if (this.mode === 'auto' || this.hosts.has(host)) return { ok: true };
      if (host) always = { label: `always allow ${host}`, apply: () => this.hosts.add(host) };
    }

    if (tool.risk === 'other') {
      // A provider's own tool that fits none of the categories above: allowed by name.
      if (this.mode === 'auto' || this.toolNames.has(tool.name)) return { ok: true };
      always = { label: `always allow ${tool.name}`, apply: () => this.toolNames.add(tool.name) };
    }

    if (!this.ask) {
      return { ok: false, reason: 'Permission denied: this session is non-interactive. The user must rerun with --yolo to allow this action.' };
    }

    const answer = await this.ask({ tool, warning, always: always?.label ?? null });
    if (answer === null) return { ok: false, reason: 'The user interrupted before answering.' };
    if (answer === 'y') return { ok: true };
    if (answer === 'a' && always) {
      always.apply();
      return { ok: true };
    }
    const feedback = answer === 'n' || answer === 'a' ? '' : ` The user said: "${answer}"`;
    return { ok: false, reason: `The user declined this action.${feedback} Do not retry it unchanged; adjust your approach or ask what they want.` };
  }
}
