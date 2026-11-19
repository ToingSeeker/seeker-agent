// Mods: JavaScript of the user's own that changes SEEKER itself, the way shell hooks do from outside.
// A mod can add a slash command, a segment under the status bar, a panel above the input box, a toast in
// the conversation, and handlers on the same events shell hooks see (it may veto or adjust a tool call).
//
// Where they live: ~/.seeker/mods/<name>/mod.mjs, with any files of its own beside it.
// A mod exports a function SEEKER calls with its API once it is loaded (see #api below):
//
//   export default function (seeker) {
//     seeker.command('hello', 'Say hello', (arg) => seeker.toast(`Hello ${arg || 'there'}`));
//     seeker.status(() => 'up');
//     seeker.on('pre_tool_call', ({ tool, args }) => (tool === 'bash' && /rm -rf \//.test(args.command) ? { block: 'no' } : undefined));
//   }
//
// A mod runs inside SEEKER with the user's own permissions, so none runs until the user has approved it in
// /mods, and the approval is for every file in its folder as they were then (node_modules included): a mod whose
// files change waits for a new one. A mod is always a folder, so the files it imports beside itself are its own,
// and a symlink anywhere in it is refused, since what it points to could change without the folder changing.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOME_DIR, VERSION } from './config.mjs';
import { EVENTS } from './hooks.mjs';
import { clipAnsi, truncate } from './text.mjs';

export const MODS_DIR = () => path.join(HOME_DIR, 'mods');
const ALLOWLIST = () => path.join(HOME_DIR, 'mods-allowlist.json');
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const START_TIMEOUT = 5000; // for a mod's own function to return
const HANDLER_TIMEOUT = 10_000; // for one event handler or command
const MAX_FILES = 2000; // a mod folder bigger than this is refused: it cannot be read through before approving
const PANEL_ROWS = 8; // per panel; all panels together take at most a third of the window

/** Mods found in the mods folder: { name, dir, main }. */
export function discover(root = MODS_DIR()) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    // A symlinked folder is listed too, so /mods can say why it does not run (fingerprint refuses it).
    if ((e.isDirectory() || e.isSymbolicLink()) && NAME.test(e.name)) {
      const main = path.join(root, e.name, 'mod.mjs');
      if (fs.existsSync(main)) found.push({ name: e.name, dir: path.join(root, e.name), main });
    }
  }
  return found;
}

/**
 * Every file a mod is made of, relative to its folder and sorted. Only .git is left out (Node never loads from it).
 * Anything that is neither a plain file nor a folder (a symlink above all) makes the whole mod refused.
 */
function filesOf(mod) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(mod.dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) throw new Error(`${r} is a symlink; a mod's files must be its own (copy it in instead)`);
      if (e.isDirectory()) {
        if (e.name !== '.git') walk(r);
      } else if (e.isFile()) {
        out.push(r);
        if (out.length > MAX_FILES) throw new Error(`more than ${MAX_FILES} files in its folder`);
      } else throw new Error(`${r} is not a plain file`);
    }
  };
  if (fs.lstatSync(mod.dir).isSymbolicLink()) throw new Error('its folder is a symlink; a mod must be a folder of its own');
  walk('');
  if (!out.includes('mod.mjs')) throw new Error('mod.mjs is missing');
  return out.sort();
}

/** A digest of a mod's files, names and contents: the approval is for exactly these. */
export function fingerprint(mod) {
  const hash = crypto.createHash('sha256');
  for (const rel of filesOf(mod)) {
    hash.update(`${rel}\0`);
    hash.update(fs.readFileSync(path.join(mod.dir, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function readAllowlist() {
  try {
    const data = JSON.parse(fs.readFileSync(ALLOWLIST(), 'utf8'));
    return Array.isArray(data.approvals) ? data.approvals : [];
  } catch {
    return [];
  }
}

function writeAllowlist(approvals) {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(ALLOWLIST(), `${JSON.stringify({ approvals }, null, 1)}\n`, { mode: 0o600 });
}

/** 'approved', 'changed' (approved once, its files differ now) or 'new'. */
export function approvalOf(mod, hash = fingerprint(mod)) {
  const entry = readAllowlist().find((a) => a.main === mod.main);
  if (!entry) return 'new';
  return entry.hash === hash ? 'approved' : 'changed';
}

/** Records the user's approval of a mod as its files are now. */
export function approveMod(mod) {
  const hash = fingerprint(mod);
  writeAllowlist([...readAllowlist().filter((a) => a.main !== mod.main), { name: mod.name, main: mod.main, hash, approved_at: new Date().toISOString() }]);
  return hash;
}

/** Takes the approval back: the mod stops running and is not loaded again until approved anew. */
export function revokeMod(mod) {
  writeAllowlist(readAllowlist().filter((a) => a.main !== mod.main));
}

/** What `/mods new <name>` writes: a working mod to start from. */
export function modTemplate(name) {
  return `// A SEEKER mod. It runs inside SEEKER with your permissions, once you approve it in /mods.
// Change it, then run /mods reload (it asks for approval again, since its file changed).
import { spawnSync } from 'node:child_process';

export default function (seeker) {
  // A segment under the status bar: the git branch of the folder SEEKER works in, looked up every 10 seconds.
  let branch = '';
  const look = () => {
    const r = spawnSync('git', ['branch', '--show-current'], { cwd: seeker.cwd, encoding: 'utf8', timeout: 2000 });
    branch = r.status === 0 ? r.stdout.trim() : '';
  };
  look();
  seeker.every(10_000, look);
  seeker.status(() => (branch ? seeker.colors.accent(\`⎇ \${branch}\`) : ''));

  // A slash command: /${name} [words]. What it returns, if anything, is sent to SEEKER as a message.
  seeker.command('${name}', 'Say hello from the ${name} mod', (arg) => {
    seeker.toast(\`Hello from ${name}\${arg ? \`: \${arg}\` : ''}\`);
  });

  // A hook on tool calls: refuse a force push before it runs, whoever asked for it.
  seeker.on('pre_tool_call', ({ tool, args }) => {
    if (tool === 'bash' && /\\bgit\\s+push\\b.*(--force\\b|\\s-f\\b)/.test(args.command ?? '')) {
      return { block: 'Force pushes are switched off.' };
    }
  });
}
`;
}

/** Writes a new mod from the template; returns its file. Refuses to overwrite one that exists. */
export function createMod(name) {
  if (!NAME.test(name)) throw new Error('A mod name is letters, digits, - and _ (up to 40), starting with a letter or digit.');
  const dir = path.join(MODS_DIR(), name);
  if (fs.existsSync(dir)) throw new Error(`There is a mod called ${name} already.`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'mod.mjs');
  fs.writeFileSync(file, modTemplate(name));
  return file;
}

const within = (promise, ms, what) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000}s`)), ms)))]).finally(() => clearTimeout(timer));
};

export class Mods {
  /**
   * @param {object} opts
   * @param {object} opts.ui        for toasts and warnings (notice, warn, c)
   * @param {string} opts.cwd       the folder SEEKER works in
   * @param {() => object} [opts.info]     what a mod may read about the session: { model, provider }
   * @param {() => void} [opts.refresh]    redraws the screen
   * @param {() => number} [opts.height]   the window's height, to keep panels to a third of it
   * @param {string} [opts.root]   the mods folder (tests)
   * @param {Set<string>} [opts.reserved]  command names a mod cannot take
   */
  constructor({ ui, cwd, info = () => ({}), refresh = () => {}, height = () => 40, root = MODS_DIR(), reserved = new Set() }) {
    this.ui = ui;
    this.cwd = cwd;
    this.info = info;
    this.refresh = refresh;
    this.height = height;
    this.root = root;
    this.reserved = reserved;
    this.loaded = new Map(); // name → { mod, hash, commands, statuses, panels, handlers, timers, dispose }
    this.errors = new Map(); // name → why it is not running
    this.warned = new Set();
  }

  /** Every mod in the folder, with whether it runs: { name, main, state: 'on'|'new'|'changed'|'error', error? }. */
  list() {
    return discover(this.root).map((mod) => {
      let state;
      try {
        state = approvalOf(mod);
      } catch (err) {
        return { ...mod, state: 'error', error: err.message };
      }
      if (state === 'approved') state = this.loaded.has(mod.name) ? 'on' : 'error';
      return { ...mod, state, error: this.errors.get(mod.name) ?? (state === 'error' ? 'not loaded' : undefined) };
    });
  }

  /** Loads every approved mod. Returns { loaded: [names], waiting: [names not approved], failed: [{ name, error }] }. */
  async loadAll() {
    const report = { loaded: [], waiting: [], failed: [] };
    for (const mod of discover(this.root)) {
      let state;
      try {
        state = approvalOf(mod);
      } catch (err) {
        report.failed.push({ name: mod.name, error: err.message });
        continue;
      }
      if (state !== 'approved') {
        report.waiting.push(mod.name);
        continue;
      }
      const error = await this.load(mod);
      if (error) report.failed.push({ name: mod.name, error });
      else report.loaded.push(mod.name);
    }
    return report;
  }

  /** Loads one approved mod (replacing the copy running now). Returns why it failed, or null. */
  async load(mod) {
    this.unload(mod.name);
    this.errors.delete(mod.name);
    let hash;
    try {
      hash = fingerprint(mod);
      if (approvalOf(mod, hash) !== 'approved') throw new Error('not approved as its files are now; approve it in /mods');
      // The digest in the URL makes a changed file a new module, instead of the copy Node has cached.
      const module = await within(import(`${pathToFileURL(mod.main).href}?v=${hash.slice(0, 16)}`), START_TIMEOUT, 'loading it');
      const start = typeof module.default === 'function' ? module.default : module.activate;
      if (typeof start !== 'function') throw new Error('mod.mjs exports no function (export default function (seeker) { … })');
      const entry = { mod, hash, commands: new Map(), statuses: [], panels: [], handlers: [], timers: new Set(), dispose: null };
      this.loaded.set(mod.name, entry);
      try {
        const dispose = await within(Promise.resolve(start(this.#api(entry))), START_TIMEOUT, 'starting it');
        if (typeof dispose === 'function') entry.dispose = dispose;
      } catch (err) {
        this.unload(mod.name);
        throw err;
      }
      this.refresh();
      return null;
    } catch (err) {
      const why = String(err?.message ?? err).split('\n')[0];
      this.errors.set(mod.name, why);
      return why;
    }
  }

  /** Stops a mod: its timers end, its commands, rows and handlers go, and its own clean-up runs. */
  unload(name) {
    const entry = this.loaded.get(name);
    if (!entry) return;
    this.loaded.delete(name);
    for (const t of entry.timers) clearInterval(t);
    try {
      entry.dispose?.();
    } catch {}
    this.refresh();
  }

  unloadAll() {
    for (const name of [...this.loaded.keys()]) this.unload(name);
  }

  #warnOnce(key, text) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.ui.warn(`  ⚠ ${text}`);
  }

  /** What a mod is handed: everything it may do, all of it undone when the mod is unloaded. */
  #api(entry) {
    const { name } = entry.mod;
    const live = () => this.loaded.get(name) === entry;
    const self = this;
    return {
      name,
      dir: entry.mod.dir,
      cwd: this.cwd,
      version: VERSION,
      colors: this.ui.c,
      get model() {
        return self.info().model ?? null;
      },
      get provider() {
        return self.info().provider ?? null;
      },
      /** A slash command. `run(arg, { phone })` may return text, which is sent to SEEKER as a message. */
      command(command, description, run, { phone = false } = {}) {
        if (typeof description === 'function') [run, description] = [description, ''];
        const key = String(command).replace(/^\//, '').toLowerCase();
        if (!NAME.test(key)) throw new Error(`"${command}" is not a command name (letters, digits, - and _)`);
        if (self.reserved.has(key)) throw new Error(`/${key} is one of SEEKER's own commands`);
        const owner = [...self.loaded.values()].find((e) => e !== entry && e.commands.has(key));
        if (owner) throw new Error(`/${key} belongs to the ${owner.mod.name} mod already`);
        if (typeof run !== 'function') throw new Error(`/${key} needs a function to run`);
        entry.commands.set(key, { description: String(description ?? ''), run, phone: Boolean(phone) });
      },
      /** A segment of the row under the status bar: `render(width)` returns a short text. */
      status(render) {
        if (typeof render !== 'function') throw new Error('status() takes a function that returns the text to show');
        entry.statuses.push(render);
        self.refresh();
      },
      /** Rows above the input box: `render(width)` returns a string or an array of them (up to 8 are shown). */
      panel(render) {
        if (typeof render !== 'function') throw new Error('panel() takes a function that returns the rows to show');
        entry.panels.push(render);
        self.refresh();
      },
      /** A short message in the conversation. kind: 'notice' (quiet) or 'warn'. */
      toast(text, kind = 'notice') {
        if (!live()) return;
        const line = `  ${name} · ${String(text)}`;
        if (kind === 'warn') self.ui.warn(line);
        else self.ui.notice(line);
      },
      /** A handler for one of the events shell hooks see; see Mods.run for what it gets and may return. */
      on(event, handler) {
        if (!EVENTS.includes(event)) throw new Error(`no event "${event}"; there are: ${EVENTS.join(', ')}`);
        if (typeof handler !== 'function') throw new Error(`on("${event}") needs a function`);
        entry.handlers.push({ event, handler });
      },
      /** Calls `fn` every `ms` (1 second at the least) and redraws after it; returns a function that stops it. */
      every(ms, fn) {
        const timer = setInterval(async () => {
          try {
            await fn();
          } catch (err) {
            self.#warnOnce(`${name}:every`, `mod ${name}: a timer failed: ${err?.message ?? err}`);
          }
          if (live()) self.refresh();
        }, Math.max(1000, Number(ms) || 0));
        timer.unref?.();
        entry.timers.add(timer);
        return () => (clearInterval(timer), entry.timers.delete(timer));
      },
      /** Redraws the screen now, after a mod changed what its status or panel shows. */
      refresh: () => live() && this.refresh(),
    };
  }

  /** The commands mods add, for the list shown while typing: [['/name', description]]. */
  commands() {
    const out = [];
    for (const e of this.loaded.values()) for (const [key, c] of e.commands) out.push([`/${key}`, c.description || `from the ${e.mod.name} mod`]);
    return out;
  }

  /** A mod's command of that name: { mod, run, phone }, or null. */
  command(name) {
    const key = String(name).toLowerCase();
    for (const e of this.loaded.values()) {
      const c = e.commands.get(key);
      if (c) return { mod: e.mod.name, ...c };
    }
    return null;
  }

  /** Runs a mod's command. Returns the text it gave back to send as a message, or null. */
  async runCommand(found, arg, { phone = false } = {}) {
    try {
      const out = await within(Promise.resolve(found.run(arg, { phone })), HANDLER_TIMEOUT * 6, `/${found.mod}`);
      return typeof out === 'string' && out.trim() ? out : null;
    } catch (err) {
      this.ui.warn(`  ⚠ mod ${found.mod}: ${err?.message ?? err}`);
      return null;
    }
  }

  #render(key, fn, width) {
    try {
      return fn(width);
    } catch (err) {
      this.#warnOnce(key, `mod ${key.split(':')[0]}: what it shows failed: ${err?.message ?? err}`);
      return '';
    }
  }

  /** The row under the status bar, or none when no mod shows anything. */
  bandRows(width) {
    const parts = [];
    for (const e of this.loaded.values()) {
      e.statuses.forEach((fn, i) => {
        const text = this.#render(`${e.mod.name}:status${i}`, fn, width);
        if (text != null && String(text).trim()) parts.push(String(text).replace(/\s*\n\s*/g, ' '));
      });
    }
    if (!parts.length) return [];
    return [clipAnsi(` ${parts.join(this.ui.c.dim('  •  '))}`, width)];
  }

  /** The rows above the input box. */
  panelRows(width) {
    const max = Math.max(0, Math.floor(this.height() / 3));
    const rows = [];
    for (const e of this.loaded.values()) {
      e.panels.forEach((fn, i) => {
        const got = this.#render(`${e.mod.name}:panel${i}`, fn, width);
        const lines = (Array.isArray(got) ? got : got == null || got === '' ? [] : String(got).split('\n')).slice(0, PANEL_ROWS);
        for (const line of lines) rows.push(clipAnsi(String(line), width));
      });
    }
    return rows.length > max ? [...rows.slice(0, Math.max(0, max - 1)), this.ui.c.dim(truncate(`  … ${rows.length - max + 1} more panel rows`, width))].slice(0, max) : rows;
  }

  /**
   * Runs the mods' handlers for an event, mod by mod in name order, the way Hooks.run does for shell hooks.
   * A handler gets { event, tool, args, extra, cwd } and, for the events that start with pre_, may return:
   *   pre_tool_call  { block: 'why' } to stop the call, or { args: { … } } to change its arguments
   *   pre_llm_call   { block: 'why' } to keep the message from the model, or { context: 'text' } to add to it
   * A handler that throws or takes too long is skipped with a warning; it never stops the work.
   * @returns {Promise<{ block?: string, args?: object, context?: string }>}
   */
  async run(event, { toolName = null, toolInput = null, extra = {} } = {}) {
    const result = {};
    let args = toolInput;
    for (const e of [...this.loaded.values()]) {
      for (const { event: on, handler } of e.handlers) {
        if (on !== event) continue;
        let out;
        try {
          out = await within(Promise.resolve(handler({ event, tool: toolName, args, extra, cwd: this.cwd })), HANDLER_TIMEOUT, `its ${event} handler`);
        } catch (err) {
          this.#warnOnce(`${e.mod.name}:${event}:${err?.message}`, `mod ${e.mod.name}: ${err?.message ?? err} (skipped)`);
          continue;
        }
        if (!out || typeof out !== 'object' || !event.startsWith('pre_')) continue;
        if (out.block) return { block: `${String(out.block)} (${e.mod.name} mod)` };
        if (event === 'pre_tool_call' && out.args && typeof out.args === 'object') {
          args = { ...args, ...out.args };
          result.args = args;
        }
        if (event === 'pre_llm_call' && typeof out.context === 'string' && out.context.trim()) result.context = [result.context, out.context.trim()].filter(Boolean).join('\n\n');
      }
    }
    return result;
  }
}

/** Shell hooks and mods as one: shell hooks first, then mods with the arguments the hooks left. */
export function chainHooks(first, second) {
  if (!first) return second;
  if (!second) return first;
  return {
    async run(event, detail = {}) {
      const a = await first.run(event, detail);
      if (a.block) return a;
      const b = await second.run(event, { ...detail, toolInput: a.args ?? detail.toolInput });
      if (b.block) return b;
      const out = {};
      const args = b.args ?? a.args;
      if (args) out.args = args;
      const context = [a.context, b.context].filter(Boolean).join('\n\n');
      if (context) out.context = context;
      return out;
    },
  };
}
