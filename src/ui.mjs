// Everything SEEKER prints: header, welcome panel, the conversation (answers
// and the tree of tool steps), spinner and the bars under the input box.
// In print mode (-p) activity goes to stderr so stdout carries only the answer.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { highlightLine, highlighter, languageOf } from './highlight.mjs';
import { MdStream } from './markdown.mjs';
import { VERSION } from './config.mjs';
import { ANSI, padEnd, truncate, truncateStart, visibleLength } from './text.mjs';
import { RESTING, ROBOT_WIDTH, pose, robotRows, wordmarkRows } from './mascot.mjs';
import { colorDepth, terminalPalette } from './theme.mjs';

export { padEnd, truncate, truncateStart, visibleLength };

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
    // How many colours this terminal shows decides how the palette is written: 24-bit, 256, sixteen, or none.
    this.depth = colorDepth(process.env, Boolean(this.activity.isTTY));
    this.colors = this.depth > 0;
    this.c = terminalPalette(this.depth);
    this.answerMarkdown = colorDepth(process.env, Boolean(process.stdout.isTTY));
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

  /** `tone` says what is going on: blue for a tool at work, purple for the model thinking. */
  startSpinner(label, prefix = '  ', tone = 'blue') {
    this.stopSpinner();
    if (!this.screen && !this.activity.isTTY) return;
    const started = Date.now();
    const text = truncate(label.replace(/\s+/g, ' '), Math.max(10, this.cols() - visibleLength(prefix) - 12));
    let frame = 0;
    const draw = () => {
      const secs = Math.floor((Date.now() - started) / 1000);
      const row = `${prefix}${this.c[tone](SPINNER[frame++ % SPINNER.length])} ${text}… ${this.c.dim(`${secs}s`)}`;
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
    const robot = robotRows(this.mascot, this.depth);
    const dot = c.dim('•');
    // A cloud model sees the code it is given; the badge must not claim otherwise.
    const where = provider.local ? `LOCAL ${dot} PRIVATE` : `${c.yellow('CLOUD')} ${dot} ${provider.label.toUpperCase()}`;
    const badge = `${where} ${dot} ${ready ? c.green('● READY') : c.yellow('CHAT ONLY')}`;
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

  /**
   * The welcome panel. `info` is the panel's facts, or a function returning them: on the full screen the
   * panel is drawn from that function at every paint, so the model, provider and context it shows follow
   * /model instead of keeping what was true at startup.
   */
  welcome(info) {
    const facts = typeof info === 'function' ? info : () => info;
    if (this.screen) {
      this.ensureNewline();
      this.screen.setIntro((width) => this.welcomeRows(width, facts()));
      return;
    }
    for (const row of this.welcomeRows(this.cols() - 1, facts())) this.line(row);
  }

  /** The welcome panel's rows, ending with a rule, for a screen `width` columns wide. */
  welcomeRows(width, { cwd, model, limit, used, provider, git, instructionFiles, skillCount, yolo }) {
    const { c } = this;
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
      c.bold('Build something remarkable.'),
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
      c.dim('WORKSPACE'),
      c.accent(truncateStart(tildify(cwd), rightWidth)),
      git ? `${truncate(git.branch, rightWidth - 12)}${tree}` : c.dim('not a git repository'),
      '',
      c.dim('MODEL'),
      c.bold(truncate(model, rightWidth)),
      `${truncate(provider.label, rightWidth - 14)} ${dot} ${c.green('connected')}`,
      `Context  ${kilo(used)} / ${contextSize(limit)}`,
      `[${(used / limit > 0.8 ? c.yellow : c.accent)('•'.repeat(filled))}${c.dim('.'.repeat(barWidth - filled))}]`,
    ];

    const rows = [];
    if (twoColumns) {
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        rows.push(` ${padEnd(left[i] ?? '', leftWidth)} ${c.dim('│')}  ${right[i] ?? ''}`);
      }
    } else {
      for (const row of left) rows.push(` ${row}`);
      for (const row of right) rows.push(` ${row}`);
    }
    rows.push(c.dim('─'.repeat(width)));
    return rows;
  }

  // ── Conversation ─────────────────────────────────────────────────────────

  userEcho(text) {
    const [first, ...rest] = text.split('\n');
    this.ensureNewline();
    this.line();
    // On the full screen what the user typed carries a cyan bar down its left edge, so it is found again
    // when scrolling back; there is no name or face, the bar is enough.
    if (this.#full()) {
      for (const row of [first, ...rest]) this.line(`${this.c.user('▎')} ${this.c.bold(row)}`);
      this.line();
      return;
    }
    // The prompt mark is the brand colour; what was typed stays the terminal's own text colour.
    this.line(`${this.c.accent('›')} ${this.c.bold(first)}`);
    for (const row of rest) this.line(`  ${this.c.bold(row)}`);
    this.line();
  }

  /** `model` is the model answering this turn, shown beside SEEKER's name on the full screen. */
  turnStart({ model = null } = {}) {
    this.turnModel = model;
    this.marked = false;
    this.last = null;
    this.tool = null;
  }

  /** Whether the conversation is drawn on the full screen with colour, where the marks are the quiet ones. */
  #full() {
    return Boolean(this.screen && this.colors);
  }

  /**
   * Marks SEEKER's turn once: "✦ seeker · model · 14:02" on its own row on the full screen, "✧ SEEKER"
   * elsewhere, where `inline` leaves the cursor after it for the answer to follow.
   */
  #mark(inline) {
    this.ensureNewline();
    if (this.#full()) {
      const time = new Date().toTimeString().slice(0, 5);
      const meta = [this.turnModel, time].filter(Boolean).join(' · ');
      this.line(`${this.c.accent('✦')} ${this.c.accentBold('seeker')} ${this.c.dim(`· ${meta}`)}`);
      this.marked = true;
      return;
    }
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
    if (this.showThinking) this.line(`  ${this.c.purple('◇')} ${this.c.dim('thinking')}`);
    else this.startSpinner('Thinking', '  ', 'purple');
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
    this.line(`${this.#branch()}${this.c.blue('▸')} ${`${tool.doing} ${tool.summary}`.trim()}`);
    tool.open = true;
  }

  /** What a write is about to do: removed lines in red, added in green. */
  diff({ removed = [], added = [], more = 0, overwrites = null, times = 1, hunk = null, path = null }) {
    this.toolOpen();
    const width = this.cols() - 12;
    if (hunk?.rows.length) {
      // Each line with its number in the file; a removed line on red, an added one on green, across the width.
      const { c } = this;
      const digits = Math.max(3, ...hunk.rows.map((r) => String(r.n ?? '').length));
      const room = Math.max(10, width - digits - 3);
      // The code in colour, by the file's language; the old and the new text each carry their own open comments.
      const lang = languageOf(path ?? this.tool?.summary);
      const paint = lang ? highlighter(this.depth) : null;
      let before = {};
      let after = {};
      const code = (row, text) => {
        if (!paint) return text;
        const state = row.kind === '-' ? before : after;
        const coloured = highlightLine(text, lang, paint, state);
        if (row.kind === ' ') Object.assign(before, state);
        return coloured;
      };
      this.line(`${this.#stem()}${c.green(`+${hunk.added}`)} ${c.red(`−${hunk.removed}`)}`);
      for (const row of hunk.rows) {
        if (row.gap) {
          this.line(`${this.#stem()}${c.dim('...')}`);
          before = {};
          after = {};
          continue;
        }
        const text = truncate(row.text.replace(/\t/g, '  '), room);
        const coloured = code(row, text);
        const body = `${String(row.n).padStart(digits)} ${row.kind} ${coloured}`;
        if (row.kind === ' ') this.line(`${this.#stem()}${c.dim(String(row.n).padStart(digits))}   ${coloured}`);
        else this.line(`${this.#stem()}${(row.kind === '+' ? c.added : c.removed)(body + ' '.repeat(Math.max(0, room - visibleLength(text))))}`);
      }
      if (hunk.hidden) this.line(`${this.#stem()}${c.dim(`… +${hunk.hidden} changed lines`)}`);
    } else {
      for (const l of removed) this.line(`${this.#stem()}${this.c.red(`- ${truncate(l, width)}`)}`);
      for (const l of added) this.line(`${this.#stem()}${this.c.green(`+ ${truncate(l, width)}`)}`);
      if (more) this.line(`${this.#stem()}${this.c.dim(`… +${more} lines`)}`);
    }
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
      // Output that is a diff keeps its meaning: what was added in green, what was removed in red.
      const isDiff = lines.some((l) => /^(@@ |diff --git )/.test(l));
      const paint = (l) => (isDiff && /^\+(?!\+\+ )/.test(l) ? this.c.green : isDiff && /^-(?!-- )/.test(l) ? this.c.red : this.c.dim);
      for (const l of lines.slice(0, maxLines)) this.line(`${this.#stem()}${paint(l)(truncate(l, width))}`);
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

  statusBar(width, { model, cwd, used, limit, provider, tokensPerSecond, yolo, plan }) {
    const { c } = this;
    const speed = tokensPerSecond ? ` • ${Math.round(tokensPerSecond)} tok/s` : '';
    const right = `${kilo(used)} tokens • ${contextSize(limit)} context${speed}`;
    const online = `● ${provider.label}${provider.local ? ' online' : ''}`;
    const mode = plan ? '   PLAN' : yolo ? '   YOLO' : '';
    const fixed = 1 + online.length + 3 + model.length + mode.length + 3 + 2 + right.length;
    const path = truncateStart(tildify(cwd), Math.max(0, width - fixed));
    const left = ` ${c.green(online)}   ${model}${c.yellow(mode)}   ${c.dim(path)}`;
    if (visibleLength(left) + 2 + right.length > width) return ` ${c.green(online)}   ${truncate(model, Math.max(4, width - online.length - 5))}`;
    return padEnd(left, width - right.length) + right;
  }
}
