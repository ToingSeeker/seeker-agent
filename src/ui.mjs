// Everything SEEKER prints: header, welcome panel, the conversation (answers
// and the tree of tool steps), spinner and the bars under the input box.
// In print mode (-p) activity goes to stderr so stdout carries only the answer.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { MdStream } from './markdown.mjs';
import { VERSION } from './config.mjs';
import { ANSI, padEnd, truncate, truncateStart, visibleLength } from './text.mjs';
import { RESTING, ROBOT_WIDTH, pose, robotRows, wordmarkRows } from './mascot.mjs';

export { padEnd, truncate, truncateStart, visibleLength };

const CODES = {
  dim: '2',
  bold: '1',
  accent: '38;5;80',
  accentBold: '1;38;5;80',
  green: '38;5;114',
  yellow: '38;5;214',
  red: '38;5;203',
  chip: '48;5;236;38;5;80',
};

function palette(enabled) {
  const p = {};
  for (const [name, code] of Object.entries(CODES)) p[name] = (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return p;
}

export const tildify = (p) => (p === os.homedir() || p.startsWith(`${os.homedir()}/`) ? `~${p.slice(os.homedir().length)}` : p);
export const kilo = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
/** 32768 → "32k", 1000000 → "1M". */
export const contextSize = (n) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / (n % 1024 === 0 && n % 1000 !== 0 ? 1024 : 1000))}k`);

const SPINNER = ['◐', '◓', '◑', '◒'];
const WORDMARK = wordmarkRows();
// For a window too narrow for the block letters.
const SMALL_WORDMARK = ['╔═╗╔═╗╔═╗╦╔═╔═╗╦═╗', '╚═╗║╣ ║╣ ╠╩╗║╣ ╠╦╝', '╚═╝╚═╝╚═╝╩ ╩╚═╝╩╚═'];
const MASCOT_TICK = 150;

/** Branch and whether the tree is clean; null outside a repository. `clean` is null if git was too slow to say. */
export function gitInfo(cwd) {
  const git = (args, timeout) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout });
  let head = git(['rev-parse', '--abbrev-ref', 'HEAD'], 1000);
  // A repository with no commits yet has no HEAD to resolve, but still has a branch name.
  if (head.status !== 0) head = git(['symbolic-ref', '--short', 'HEAD'], 1000);
  if (head.status !== 0) return null;
  const status = git(['status', '--porcelain', '--untracked-files=no'], 1500);
  return { branch: head.stdout.trim(), clean: status.status === 0 ? status.stdout.trim() === '' : null };
}

export class UI {
  constructor({ print = false, showThinking = true, animation = true } = {}) {
    this.print = print;
    this.showThinking = showThinking;
    this.animation = animation;
    this.mascot = RESTING;
    this.mascotTimer = null;
    this.activity = print ? process.stderr : process.stdout;
    const colors = !process.env.NO_COLOR;
    this.colors = colors && Boolean(this.activity.isTTY);
    this.c = palette(this.colors);
    this.answerMarkdown = colors && Boolean(process.stdout.isTTY);
    this.atLineStart = true;
    this.timer = null;
    this.marked = false;
    this.last = null;
    this.tool = null;
    this.screen = null;
  }

  /** From here on everything is drawn through the full-screen layout instead of written straight out. */
  attach(screen) {
    this.screen = screen;
  }

  cols() {
    return this.screen ? this.screen.width + 1 : this.activity.columns || 100;
  }

  write(text) {
    if (!text) return;
    this.stopSpinner();
    if (this.screen) this.screen.append(text);
    else this.activity.write(text);
    this.atLineStart = text.endsWith('\n');
  }

  line(text = '') {
    this.write(`${text}\n`);
  }

  ensureNewline() {
    if (!this.atLineStart) this.write('\n');
  }

  rule() {
    this.line(this.c.dim('─'.repeat(this.cols() - 1)));
  }

  /** The model's answer — always stdout, even in print mode. */
  answerStream() {
    return new MdStream((text) => {
      if (!text) return;
      this.stopSpinner();
      if (this.screen) this.screen.append(text);
      else process.stdout.write(text);
      this.atLineStart = text.endsWith('\n');
    }, this.answerMarkdown);
  }

  startSpinner(label, prefix = '  ') {
    this.stopSpinner();
    if (!this.screen && !this.activity.isTTY) return;
    const started = Date.now();
    const text = truncate(label.replace(/\s+/g, ' '), Math.max(10, this.cols() - visibleLength(prefix) - 12));
    let frame = 0;
    const draw = () => {
      const secs = Math.floor((Date.now() - started) / 1000);
      const row = `${prefix}${this.c.yellow(SPINNER[frame++ % SPINNER.length])} ${text}… ${this.c.dim(`${secs}s`)}`;
      if (this.screen) this.screen.setLive([row]);
      else this.activity.write(`\r\x1b[K${row}`);
    };
    draw();
    this.timer = setInterval(draw, 120);
  }

  stopSpinner() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    if (this.screen) this.screen.setLive([]);
    else this.activity.write('\r\x1b[K');
  }

  // ── Opening screen ───────────────────────────────────────────────────────

  /** Brings the robot in the header to life: it blinks, glances around, and flashes its antenna while the model works. */
  startMascot() {
    this.stopMascot();
    if (!this.screen || !this.animation) return;
    let tick = 0;
    this.mascotTimer = setInterval(() => {
      const next = pose(++tick, Boolean(this.timer));
      if (JSON.stringify(next) === JSON.stringify(this.mascot)) return;
      this.mascot = next;
      this.screen.render();
    }, MASCOT_TICK);
    // The animation alone must never keep the process alive.
    this.mascotTimer.unref();
  }

  stopMascot() {
    if (this.mascotTimer) clearInterval(this.mascotTimer);
    this.mascotTimer = null;
    this.mascot = RESTING;
  }

  /** The rows pinned to the top of the screen. */
  headerRows(width, { ready, provider }) {
    const { c } = this;
    const bar = c.dim('│');
    const robot = robotRows(this.mascot, this.colors);
    const dot = c.accent('•');
    // A cloud model sees the code it is given; the badge must not claim otherwise.
    const where = provider.local ? `LOCAL ${dot} PRIVATE` : `${c.yellow('CLOUD')} ${dot} ${provider.label.toUpperCase()}`;
    const badge = `${where} ${dot} ${ready ? 'READY' : c.yellow('CHAT ONLY')}`;
    const room = width - visibleLength(badge);
    const build = (wordmark) => {
      const rows = wordmark.map((word, i) => ` ${robot[i]} ${bar}  ${c.accentBold(word)}`);
      rows.push(` ${robot[3]} ${bar}  Your local coding companion  ${c.dim(`v${VERSION}`)}`);
      // The badge goes beside the wordmark if there is room, otherwise beside the tagline.
      const at = [1, 3].find((i) => room > visibleLength(rows[i]) + 2);
      if (at !== undefined) rows[at] = padEnd(rows[at], room) + badge;
      return { rows, fits: at !== undefined && visibleLength(rows[0]) <= width };
    };
    // The block letters are for show; where they would push the badge out, the small ones are used.
    let { rows, fits } = build(WORDMARK);
    if (!fits) ({ rows } = build(SMALL_WORDMARK));
    rows.push(c.dim('─'.repeat(width)));
    return rows;
  }

  welcome({ cwd, model, limit, used, provider, git, instructionFiles, skillCount, yolo }) {
    const { c } = this;
    const width = this.cols() - 1;
    const twoColumns = width >= 86;
    const leftWidth = twoColumns ? Math.floor(width * 0.6) : width - 2;
    const rightWidth = twoColumns ? width - leftWidth - 5 : width - 2;
    const dot = c.dim('•');

    const chip = (name) => c.chip(` ${name.padEnd(8)}`);
    const extras = [
      instructionFiles.length ? `Loaded ${instructionFiles.join(', ')}` : null,
      skillCount ? `${skillCount} skill${skillCount > 1 ? 's' : ''} available · /skills` : null,
      yolo ? 'YOLO: edits and commands run without asking' : null,
    ].filter(Boolean);
    const left = [
      c.accentBold('Build something remarkable.'),
      'Describe a task. Seeker handles the next step.',
      '',
      `${chip('/init')}  Set up project context`,
      `${chip('/model')}  Switch provider and model`,
      `${chip('/resume')}  Continue a session`,
      '',
      ...extras.map((e) => c.dim(truncate(e, leftWidth))),
    ];

    const tree = git ? (git.clean === null ? '' : ` ${dot} ${git.clean ? c.green('clean') : c.yellow('modified')}`) : '';
    const barWidth = Math.min(26, rightWidth - 2);
    const filled = Math.min(barWidth, Math.round((used / limit) * barWidth));
    const right = [
      c.accentBold('WORKSPACE'),
      truncateStart(tildify(cwd), rightWidth),
      git ? `${truncate(git.branch, rightWidth - 12)}${tree}` : c.dim('not a git repository'),
      '',
      c.accentBold('MODEL'),
      c.bold(truncate(model, rightWidth)),
      `${truncate(provider.label, rightWidth - 14)} ${dot} ${c.green('connected')}`,
      `Context  ${kilo(used)} / ${contextSize(limit)}`,
      `[${c.accent('•'.repeat(filled))}${c.dim('.'.repeat(barWidth - filled))}]`,
    ];

    if (twoColumns) {
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        this.line(` ${padEnd(left[i] ?? '', leftWidth)} ${c.dim('│')}  ${right[i] ?? ''}`);
      }
    } else {
      for (const row of left) this.line(` ${row}`);
      for (const row of right) this.line(` ${row}`);
    }
    this.rule();
  }

  // ── Conversation ─────────────────────────────────────────────────────────

  userEcho(text) {
    const [first, ...rest] = text.split('\n');
    this.ensureNewline();
    this.line();
    this.line(`${this.c.accent('›')} ${this.c.accent(first)}`);
    for (const row of rest) this.line(`  ${this.c.accent(row)}`);
    this.line();
  }

  turnStart() {
    this.marked = false;
    this.last = null;
    this.tool = null;
  }

  /** Prints the "✧ SEEKER" mark once per turn; `inline` leaves the cursor after it for the answer to follow. */
  #mark(inline) {
    this.ensureNewline();
    this.write(`${this.c.accent('✧')} ${this.c.accentBold('SEEKER')}${inline ? ` ${this.c.dim('│')} ` : '\n'}`);
    this.marked = true;
  }

  answerStart() {
    if (this.last === 'text') return;
    if (!this.marked) this.#mark(true);
    else {
      this.ensureNewline();
      this.line();
    }
    this.last = 'text';
  }

  thinkStart() {
    if (!this.marked) this.#mark(false);
    this.ensureNewline();
    if (this.showThinking) this.line(this.c.dim('  ✻ thinking'));
    else this.startSpinner('Thinking');
    this.last = 'think';
  }

  thinkChunk(text) {
    if (this.showThinking) this.write(this.c.dim(text));
  }

  thinkEnd() {
    if (!this.showThinking) return this.stopSpinner();
    this.ensureNewline();
  }

  // ── Tool steps, drawn as a tree under the SEEKER mark ─────────────────────

  #branch() {
    return `  ${this.c.dim('├─')} `;
  }

  #stem() {
    return `  ${this.c.dim('│')}    `;
  }

  toolStart(doing, done, summary = '') {
    if (!this.marked) this.#mark(false);
    this.ensureNewline();
    const text = truncate(String(summary).replace(/\s*\n\s*/g, ' ⏎ '), Math.max(16, this.cols() - 34));
    this.tool = { doing, done, summary: text, open: false };
    this.last = 'tool';
    this.startSpinner(`${doing} ${text}`.trim(), this.#branch());
  }

  /** Makes the step permanent before something has to be shown under it (a diff, a question). */
  toolOpen() {
    const { tool } = this;
    if (!tool || tool.open) return;
    this.line(`${this.#branch()}${this.c.accent('●')} ${`${tool.doing} ${tool.summary}`.trim()}`);
    tool.open = true;
  }

  /** What a write is about to do: removed lines in red, added in green. */
  diff({ removed = [], added = [], more = 0, overwrites = null, times = 1 }) {
    this.toolOpen();
    const width = this.cols() - 12;
    for (const l of removed) this.line(`${this.#stem()}${this.c.red(`- ${truncate(l, width)}`)}`);
    for (const l of added) this.line(`${this.#stem()}${this.c.green(`+ ${truncate(l, width)}`)}`);
    if (more) this.line(`${this.#stem()}${this.c.dim(`… +${more} lines`)}`);
    // What the shown lines do not say by themselves.
    if (Number.isInteger(overwrites)) this.line(`${this.#stem()}${this.c.yellow(`⚠ replaces the whole file (${overwrites} existing line${overwrites === 1 ? '' : 's'})`)}`);
    if (times > 1) this.line(`${this.#stem()}${this.c.yellow(`⚠ applied in ${times} places`)}`);
  }

  /** A line under the open step, e.g. the permission question. */
  toolLine(text) {
    this.toolOpen();
    this.line(`${this.#stem()}${text}`);
  }

  toolRunning() {
    const { tool } = this;
    if (!tool) return;
    if (tool.open) this.startSpinner('Working', this.#stem());
    else this.startSpinner(`${tool.doing} ${tool.summary}`.trim(), this.#branch());
  }

  #toolEnd(icon, note, display, maxLines, failed = false) {
    const { tool } = this;
    this.stopSpinner();
    if (!tool) return;
    if (tool.open) this.line(`${this.#stem()}${icon} ${note || 'done'}`);
    else this.line(`${this.#branch()}${icon} ${`${failed ? tool.doing : tool.done} ${tool.summary}`.trim()}${note ? this.c.dim(` · ${note}`) : ''}`);
    if (display) {
      const lines = String(display).split('\n').filter((l) => l.trim());
      const width = this.cols() - 10;
      for (const l of lines.slice(0, maxLines)) this.line(`${this.#stem()}${this.c.dim(truncate(l, width))}`);
      if (lines.length > maxLines) this.line(`${this.#stem()}${this.c.dim(`… +${lines.length - maxLines} lines`)}`);
    }
    this.tool = null;
  }

  toolDone(note, display, maxLines = 4) {
    this.#toolEnd(this.c.green('✓'), note, display, maxLines);
  }

  toolFail(message) {
    this.#toolEnd(this.c.red('✗'), this.c.red(String(message).split('\n')[0]), null, 0, true);
  }

  // ── Notices ──────────────────────────────────────────────────────────────

  notice(text) {
    this.ensureNewline();
    this.line(this.c.dim(text));
  }

  warn(text) {
    this.ensureNewline();
    this.line(this.c.yellow(text));
  }

  error(text) {
    this.ensureNewline();
    this.line(this.c.red(text));
  }

  // ── The two bars under the input box ─────────────────────────────────────

  hintBar(width, exitArmed) {
    const { c } = this;
    const dot = c.dim('•');
    const right = exitArmed ? c.yellow('Press Ctrl+C again to exit') : c.dim('Ctrl+C cancel');
    const full = ` Enter send ${dot} Alt+Enter newline ${dot} / commands`;
    const left = visibleLength(full) + visibleLength(right) + 2 <= width ? full : ' Enter send';
    return padEnd(c.dim(left.replace(ANSI, '')), width - visibleLength(right)) + right;
  }

  statusBar(width, { model, cwd, used, limit, provider, tokensPerSecond, yolo }) {
    const { c } = this;
    const speed = tokensPerSecond ? ` • ${Math.round(tokensPerSecond)} tok/s` : '';
    const right = `${kilo(used)} tokens • ${contextSize(limit)} context${speed}`;
    const online = `● ${provider.label}${provider.local ? ' online' : ''}`;
    const mode = yolo ? '   YOLO' : '';
    const fixed = 1 + online.length + 3 + model.length + mode.length + 3 + 2 + right.length;
    const path = truncateStart(tildify(cwd), Math.max(0, width - fixed));
    const left = ` ${c.green(online)}   ${model}${c.yellow(mode)}   ${c.dim(path)}`;
    if (visibleLength(left) + 2 + right.length > width) return ` ${c.green(online)}   ${truncate(model, Math.max(4, width - online.length - 5))}`;
    return padEnd(left, width - right.length) + right;
  }
}
