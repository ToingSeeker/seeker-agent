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

// Also tried with quotes and escapes removed: to a shell, `git "push" --force` and `r\m -rf` are the same commands.
export const isDangerous = (command) => [command, command.replace(/['"\\]/g, '')].some((text) => DANGEROUS.some((re) => re.test(text)));

/**
 * Reads a command line the way a shell would, far enough to know what would run: a list of commands,
 * each a list of words with the quotes removed. Returns null for anything it cannot be sure about —
 * substitution, expansion, escapes, redirection, grouping, a lone `&` — so the line is asked about.
 */
function parse(command) {
  const text = command.replace(/\s2>&1/g, ' ').replace(/\s2>\s*\/dev\/null/g, ' ');
  // Refused even inside quotes: `$` and backticks still expand between double quotes.
  if (/[`$\\\n\r]/.test(text)) return null;
  const commands = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      word ??= '';
    } else if (/\s/.test(ch)) endWord();
    else if (ch === ';') endCommand();
    else if (ch === '|') {
      if (text[i + 1] === '|') i++;
      endCommand();
    } else if (ch === '&') {
      if (text[i + 1] !== '&') return null;
      i++;
      endCommand();
    } else if ('<>(){}'.includes(ch)) return null;
    else word = (word ?? '') + ch;
  }
  if (quote) return null;
  endCommand();
  return commands;
}

// Options that make an otherwise read-only command write a file or start a program. Each pattern is
// tried against one word. Short options are found inside clusters too (`sort -no out`), and long ones
// by the shortest spelling the program accepts (`sort --co…` is --compress-program).
const cluster = (letter) => new RegExp(`^-(?!-)[A-Za-z0-9]*${letter}`);
const UNSAFE_OPTIONS = {
  rg: [/^--pre($|=|-)/, /^--hostname-bin/],
  sort: [cluster('o'), /^--(o|co)/],
  tree: [cluster('o'), /^--output/],
  file: [cluster('C'), /^--co/],
  date: [cluster('s'), /^--s/],
  find: [/^-(delete|exec|ok|fprint|fls)/],
};

function isSafeGit(args) {
  const [sub, ...rest] = args;
  if (!SAFE_GIT.has(sub) || rest.some((w) => /^--out/.test(w))) return false;
  // Listing only: any name after `branch` would create or change one.
  if (sub === 'branch') return rest.every((w) => /^(-a|-r|-v|-vv|-l|--all|--remotes|--list|--verbose|--show-current)$/.test(w));
  if (sub === 'remote') return rest.length === 0 || rest.every((w) => /^(-v|--verbose)$/.test(w)) || rest[0] === 'get-url';
  return true;
}

function isSafeCommand([name, ...args]) {
  if (name === 'git') return isSafeGit(args);
  if (UNSAFE_OPTIONS[name]?.some((pattern) => args.some((arg) => pattern.test(arg)))) return false;
  // `uniq in out` writes its second file.
  if (name === 'uniq') return args.filter((arg) => !arg.startsWith('-')).length <= 1;
  return name === 'find' || SAFE_COMMANDS.has(name);
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
  constructor({ mode, cwd, ask, autoLearn = false }) {
    this.mode = mode;
    // Whether memory and skills may be saved without asking (config `autoLearn`).
    this.autoLearn = autoLearn;
    this.cwd = cwd;
    this.ask = ask;
    this.allowWrites = false;
    this.bashPrefixes = new Set();
    this.hosts = new Set();
    this.toolNames = new Set();
  }

  /** True when `name` (memory, skill_manage) may save without the user being asked. */
  mayLearn(name) {
    return this.mode === 'auto' || this.autoLearn || this.toolNames.has(name);
  }

  #bashAllowed(command) {
    const commands = parse(command);
    if (!commands?.length) return false;
    // An "always" rule is one or two words; it covers a command that starts with exactly those words.
    const covered = (words) => [...this.bashPrefixes].some((prefix) => prefix.split(' ').every((part, i) => words[i] === part));
    return commands.every((words) => isSafeCommand(words) || covered(words));
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
      else if (parse(command)?.length === 1) {
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

    if (tool.risk === 'learn') {
      // Memory and skills are read back as context in later sessions: what a web page or a file talked
      // the model into saving would stay. So it is the user who lets it be saved.
      // Looking at the schedule changes nothing.
      if (tool.name === 'cronjob_manage' && args?.action === 'list') return { ok: true };
      // A job that may change files runs later with nobody watching: that is agreed to each time,
      // whatever was answered "always" before.
      const unattendedWrites = tool.name === 'cronjob_manage' && (args?.allow_changes === true || args?.allow_changes === 'true');
      if (unattendedWrites) warning = 'This scheduled job will be able to change files and run commands with nobody watching.';
      else if (this.mayLearn(tool.name)) return { ok: true };
      else always = { label: `always allow ${tool.name} this session`, apply: () => this.toolNames.add(tool.name) };
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
