// The link between a `seeker` running in a terminal and `seeker remote` on the
// same machine. Only `seeker remote` talks to the relay; a terminal session
// joins it over a local socket, so it shows on the phone next to the projects
// the daemon opened itself: what it is doing, its approvals, and a way to send
// it a message or a picture.
//
// One JSON object per line, both ways.
//   terminal → daemon   hello { ws }      this session: its summary and transcript so far
//                       send { event }    an event for the phone, as the daemon would send it
//                       ask { approval }  put this to the phone        unask { id }  no longer needed
//                       notify { payload, kind }
//   daemon → terminal   message { text, images }   stop   answer { id, answer }
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';

/** Where `seeker remote` listens. Inside the settings folder, which only this user can open. */
export const LINK_FILE = path.join(HOME_DIR, 'remote.sock');

// A picture is a few megabytes of base64; nothing sent here is larger than a message with its pictures.
const MAX_LINE = 48_000_000;

/** Calls `onMessage` with each object the other side writes. A line that is not JSON ends the connection. */
export function readLines(socket, onMessage) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_LINE) return socket.destroy();
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return socket.destroy();
      }
      if (message && typeof message === 'object') onMessage(message);
    }
  });
}

export const writeLine = (socket, message) => {
  if (socket && !socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
};

/** The id a terminal session is known by on the phone: its own, so it never collides with the same folder opened by the daemon. */
export const terminalId = (cwd, pid = process.pid) => crypto.createHash('sha256').update(`terminal:${pid}:${cwd}`).digest('hex').slice(0, 10);

/**
 * Starts listening at `file`. A socket file left behind by a daemon that is gone is replaced;
 * one that still answers means another `seeker remote` is running, and it is left alone.
 * @returns {Promise<net.Server|null>} null when another daemon holds it
 */
export async function listenLink(file, onConnection) {
  const taken = await new Promise((resolve) => {
    const probe = net.connect(file);
    probe.once('connect', () => (probe.destroy(), resolve(true)));
    probe.once('error', () => resolve(false));
  });
  if (taken) return null;
  fs.rmSync(file, { force: true });
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const server = net.createServer(onConnection);
  // The socket is made closed to everyone else from the first moment, not closed afterwards.
  const umask = process.umask(0o077);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(file, resolve);
    });
  } finally {
    process.umask(umask);
  }
  fs.chmodSync(file, 0o600);
  // What a terminal has to show before it is believed: only this user can read it.
  server.key = crypto.randomBytes(24).toString('hex');
  fs.rmSync(keyFile(file), { force: true });
  fs.writeFileSync(keyFile(file), server.key, { flag: 'wx', mode: 0o600 });
  return server;
}

const keyFile = (file) => `${file}.key`;

/** The daemon's key for the socket at `file`, or null unless both are this user's own and closed to others. */
export function linkKey(file) {
  try {
    const me = process.getuid?.();
    for (const f of [file, keyFile(file)]) {
      const stat = fs.lstatSync(f);
      if (me !== undefined && stat.uid !== me) return null;
      if (stat.mode & 0o077) return null;
    }
    if (!fs.lstatSync(file).isSocket() || !fs.lstatSync(keyFile(file)).isFile()) return null;
    return fs.readFileSync(keyFile(file), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Compares two keys without telling how much of a wrong one was right. */
export const sameKey = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The terminal's end. To a Workspace it stands where the daemon would: it takes the
 * events, approvals and notifications and passes them on while a daemon is there.
 * With no daemon running they go nowhere, and the terminal works as it always has.
 */
export class TerminalLink {
  /**
   * @param {object} opts
   * @param {string} [opts.file]
   * @param {(message: { text: string, images: object[] }) => void} [opts.onMessage]  the phone sent something
   * @param {() => void} [opts.onStop]
   * @param {number} [opts.retry]  milliseconds between attempts to find a daemon
   */
  constructor({ file = LINK_FILE, info = null, notifyAfter = 30_000, onMessage = () => {}, onStop = () => {}, retry = 5000 } = {}) {
    this.file = file;
    this.info = info;
    this.notifyAfter = notifyAfter;
    this.onMessage = onMessage;
    this.onStop = onStop;
    this.retry = retry;
    this.socket = null;
    this.linked = false;
    this.closed = false;
    this.pending = new Map(); // approval id → resolve
    this.hello = null; // () => the workspace as the daemon should first see it
    this.build = null; // set by whoever owns the agent; see Workspace.open()
  }

  /** Looks for a daemon now and keeps looking, quietly, for as long as the terminal is open. */
  start(hello) {
    this.hello = hello;
    this.#connect();
  }

  #connect() {
    if (this.closed) return;
    const again = () => {
      const timer = setTimeout(() => this.#connect(), this.retry);
      timer.unref();
    };
    // Nothing is sent to a socket that is not this user's own daemon.
    const key = linkKey(this.file);
    if (!key) return again();
    const socket = net.connect(this.file);
    socket.once('connect', () => {
      this.socket = socket;
      this.linked = true;
      writeLine(socket, { t: 'hello', key, ws: this.hello() });
      // What was waiting for an answer when the daemon came back is asked again.
      for (const { approval } of this.pending.values()) writeLine(socket, { t: 'ask', approval });
    });
    readLines(socket, (message) => {
      if (message.t === 'message') this.onMessage({ text: typeof message.text === 'string' ? message.text : '', images: Array.isArray(message.images) ? message.images : [] });
      else if (message.t === 'stop') this.onStop();
      else if (message.t === 'answer') this.#answered(message.id, message.answer);
    });
    socket.on('error', () => {});
    socket.once('close', () => {
      if (this.socket === socket) this.socket = null;
      this.linked = this.socket !== null;
      if (!this.closed) again();
    });
  }

  #answered(id, answer) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.resolve(typeof answer === 'string' ? answer : null);
  }

  // ── what a Workspace asks of its daemon ──
  send(event) {
    writeLine(this.socket, { t: 'send', event });
  }

  /** Puts an approval to the phone. Without a daemon it simply stays unanswered until withdrawn. */
  ask(approval) {
    return new Promise((resolve) => {
      this.pending.set(approval.id, { approval, resolve });
      writeLine(this.socket, { t: 'ask', approval });
    });
  }

  /** Answered here in the terminal: the phone need not be asked any more. */
  withdraw() {
    for (const [id, entry] of this.pending) {
      writeLine(this.socket, { t: 'unask', id });
      entry.resolve(null);
    }
    this.pending.clear();
  }

  notify(payload, kind) {
    writeLine(this.socket, { t: 'notify', payload, kind });
  }

  /** A line for the phone that sent something, e.g. why it was not taken. */
  toast(text) {
    this.send({ t: 'toast', text });
  }

  close() {
    this.closed = true;
    this.withdraw();
    this.socket?.destroy();
  }
}

/**
 * One interface in front of two: everything the agent shows goes to the terminal
 * and, in the same breath, to the copy the phone sees. What a call returns is the
 * terminal's; a failure in the copy never reaches the agent.
 */
export function teeUi(main, mirror) {
  const both = (name) => {
    const here = main[name];
    const there = mirror[name];
    if (typeof there !== 'function') return here.bind(main);
    if (typeof here !== 'function') return there.bind(mirror);
    if (name === 'answerStream') {
      return () => {
        const a = main.answerStream();
        const b = mirror.answerStream();
        return { push: (text) => (b.push(text), a.push(text)), flush: () => (b.flush(), a.flush()) };
      };
    }
    return (...args) => {
      try {
        there.apply(mirror, args);
      } catch {
        // The phone's copy is a courtesy; the terminal carries on.
      }
      return here.apply(main, args);
    };
  };
  return new Proxy(main, {
    get: (target, name) => (typeof target[name] === 'function' || typeof mirror[name] === 'function' ? both(name) : target[name]),
    set: (target, name, value) => ((target[name] = value), true),
  });
}
