// Decides whether a tool call may run. Reads are free; writes, shell commands
// and network requests need the user's approval unless a rule already covers them.
// Files that hold secrets are the exception (src/secrets.mjs): SEEKER's own are refused,
// others are asked about in every mode.
import path from 'node:path';
import { secretInCommand, secretKind } from './secrets.mjs';

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

export const PLANNING = 'Not run: plan mode is on, so nothing is changed or executed yet. Finish looking with the read-only tools, then give the plan and stop. The user approves it before any change.';

/** What the model is told with each message while plan mode is on. */
export const PLAN_NOTE = '[Plan mode is on. Look at what you need with the read-only tools, then answer with a plan: the steps in order, the files each one touches, and how the result will be checked. Do not change files or run commands that change anything; those are refused until the user approves the plan.]';

/**
 * True when `command` would stop the `seeker remote` process with process id `pid`: killing it by name or
 * number, or killing every node or seeker process. An agent there runs inside that process.
 */
export function stopsDaemon(command, pid) {
  const text = String(command ?? '');
  if (!/\b(kill|pkill|killall|launchctl|systemctl)\b/.test(text)) return false;
  if (/seeker\S*[^\n;&|]*\bremote\b/i.test(text)) return true;
  if (pid && new RegExp(`(^|[^\\w])${pid}([^\\w]|$)`).test(text)) return true;
  return /\b(pkill|killall)\b[^\n;&|]*\b(seeker|node)\b/i.test(text);
}

const SEEKER_SECRET =
  "Refused: this is one of SEEKER's own key files (its settings with the API keys, the remote key, the push subscriptions). The agent never reads or changes them, whatever the mode. Do not try another way. If the user wants a setting changed, tell them to use /config or /model.";

const STOPS_DAEMON =
  'Refused: this would stop `seeker remote`, the process this agent runs in. It would end this task halfway, and nothing would start it again. Do not try another way. Tell the user to send /restart from the phone app, which restarts it safely, or to restart it on the Mac.';

export class Permissions {
  /**
   * @param {{ mode: 'ask'|'auto', cwd: string, ask: null | ((q: object) => Promise<string|null>) }} opts
   *        `ask` is null when nobody is there to answer (print mode).
   */
  constructor({ mode, cwd, ask, autoLearn = false, daemonPid = null }) {
    this.mode = mode;
    // Set when this agent runs inside `seeker remote`: a command that would stop that process is refused, whatever the mode.
    this.daemonPid = daemonPid;
    // Whether memory and skills may be saved without asking (config `autoLearn`).
    this.autoLearn = autoLearn;
    this.cwd = cwd;
    this.ask = ask;
    this.allowWrites = false;
    // Plan mode: SEEKER looks and proposes, and nothing is changed or run until the plan is approved.
    // It sits beside `mode`, which is how approvals work once the plan is being carried out.
    this.planning = false;
    // Set for the length of one turn that may only look (a review): the reason given to a tool that would change something.
    this.lookOnly = null;
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

  /** The secret file a tool call would touch: `{ kind, file }` (src/secrets.mjs), or null. */
  #secret(tool, args) {
    if (tool.risk === 'exec') return secretInCommand(args?.command, this.cwd);
    if (tool.risk !== 'read' && tool.risk !== 'write') return null;
    let file = null;
    try {
      file = tool.targetPath?.(args ?? {}, this.cwd) ?? null;
    } catch {
      return null; // no usable path: the tool itself reports that
    }
    const kind = file && secretKind(file);
    return kind ? { kind, file } : null;
  }

  /** @returns {Promise<{ ok: true } | { ok: false, reason: string }>} */
  async check(tool, args) {
    // SEEKER's own key files are refused in every mode; other secrets are asked about even in --yolo,
    // since what is read goes to the model provider and can be sent on from there.
    const secret = this.#secret(tool, args);
    if (secret?.kind === 'seeker') return { ok: false, reason: SEEKER_SECRET };
    const secretWarning = secret && `${path.basename(secret.file)} looks like it holds secrets (keys, passwords); what is read goes to the model provider.`;
    if (tool.risk === 'read') return secret ? this.#confirm(tool, args, secretWarning, null) : { ok: true };
    if (tool.risk === 'exec' && this.daemonPid && stopsDaemon(args?.command, this.daemonPid)) return { ok: false, reason: STOPS_DAEMON };
    const refusal = this.planning ? PLANNING : this.lookOnly;
    if (refusal) {
      // Looking around is part of planning: the short list of commands that only read still runs.
      // A page to read is asked about as usual. Anything that changes something waits for the plan.
      const looks = tool.risk === 'exec' && !isDangerous(String(args.command ?? '')) && parse(String(args.command ?? ''))?.every((words) => isSafeCommand(words));
      if (looks && secret) return this.#confirm(tool, args, secretWarning, null);
      if (!looks && tool.risk !== 'net') return { ok: false, reason: refusal };
      if (looks) return { ok: true };
    }

    let always = null; // { label, apply } offered as the "always" answer
    let warning = null;

    if (tool.risk === 'exec') {
      const command = String(args.command ?? '');
      if (isDangerous(command)) warning = 'This command is risky or hard to undo.';
      else if (secret) warning = secretWarning;
      else if (this.mode === 'auto' || this.#bashAllowed(command)) return { ok: true };
      else if (parse(command)?.length === 1) {
        const prefix = bashPrefix(command);
        always = { label: `always allow \`${prefix} …\``, apply: () => this.bashPrefixes.add(prefix) };
      }
    } else if (tool.risk === 'write') {
      const inside = this.#insideCwd(tool.targetPath(args, this.cwd));
      if (!inside) warning = 'This file is outside the working folder.';
      else if (secret) warning = `${path.basename(secret.file)} looks like it holds secrets (keys, passwords).`;
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
      let unattendedWrites = tool.name === 'cronjob_manage' && (args?.allow_changes === true || args?.allow_changes === 'true');
      // Changing, resuming or running a job that already may change files is the same decision.
      if (tool.name === 'cronjob_manage' && !unattendedWrites && ['update', 'resume', 'run'].includes(String(args?.action ?? '').toLowerCase())) {
        const { readJobs } = await import('./cron.mjs');
        unattendedWrites = readJobs().some((j) => j.id === args?.job_id && j.allow_changes);
      }
      if (unattendedWrites) warning = 'This scheduled job will be able to change files and run commands with nobody watching.';
      else if (this.mayLearn(tool.name)) return { ok: true };
      else always = { label: `always allow ${tool.name} this session`, apply: () => this.toolNames.add(tool.name) };
    }

    if (tool.risk === 'other') {
      // A provider's own tool that fits none of the categories above: allowed by name.
      if (this.mode === 'auto' || this.toolNames.has(tool.name)) return { ok: true };
      always = { label: `always allow ${tool.name}`, apply: () => this.toolNames.add(tool.name) };
    }

    return this.#confirm(tool, args, warning, always);
  }

  /** Asks the user, with the warning and the "always" answer if there is one. */
  async #confirm(tool, args, warning, always) {
    if (!this.ask) {
      if (always === null && warning?.includes('holds secrets')) return { ok: false, reason: `Refused: ${warning} Nobody is here to approve reading it. Do not try another way; tell the user.` };
      return { ok: false, reason: 'Permission denied: this session is non-interactive. The user must rerun with --yolo to allow this action.' };
    }

    // Somebody is about to be kept waiting: a hook of theirs may want to tell them (a sound, a notification).
    this.onAsk?.(tool, args, warning);
    const answer = await this.ask({ tool, args, warning, always: always?.label ?? null });
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
