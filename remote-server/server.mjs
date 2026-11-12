// SEEKER remote relay.
//
// A mailbox between the phone and the Mac, and the web app the phone opens.
// It never sees what passes through: every event and command is encrypted on
// the device that wrote it, with a key this server is never given. All it
// holds is the SHA-256 of an access token, to decide who may use the mailbox.
//
//   Mac    →  POST /agent/events     encrypted events, appended to a log
//   Mac    ←  GET  /agent/stream     encrypted commands from the phone (SSE)
//   phone  ←  GET  /api/stream       the log since ?since=N, then live (SSE)
//   phone  →  POST /api/command      one encrypted command for the Mac
//
// Nothing is stored on disk; after a restart the Mac sends a fresh snapshot.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const MAX_LOG_ENTRIES = 3000;
const MAX_LOG_BYTES = 12 * 1024 * 1024;
const MAX_BODY = 4 * 1024 * 1024;
const FAILURES_ALLOWED = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_TRACKED = 10_000; // addresses remembered for the lockout
const OVERFLOW = '(everyone else)';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest();

/**
 * @param {{ authHash: string }} opts  hex SHA-256 of the access token
 * @returns {http.Server}
 */
export function createRelay({ authHash, trustProxy = false, maxTracked = MAX_TRACKED }) {
  if (!/^[0-9a-f]{64}$/.test(authHash ?? '')) throw new Error('SEEKER_REMOTE_AUTH must be the 64-character value printed by `seeker remote --setup`.');
  const expected = Buffer.from(authHash, 'hex');

  let log = []; // { seq, c } — encrypted events from the Mac, oldest first
  let logBytes = 0;
  let seq = 0;
  let agent = null; // the Mac's open command stream
  const phones = new Set();
  const failures = new Map(); // ip → { count, until }

  // x-forwarded-for is whatever the caller sent unless a proxy in front rewrites it, so it is believed
  // only when told such a proxy exists (`trustProxy`). Railway's does: the first address is the caller.
  const ipOf = (req) => (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

  function authorised(req) {
    let ip = ipOf(req);
    if (failures.size >= maxTracked && !failures.has(ip)) {
      const now = Date.now();
      for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
      // Still full: a live record is never dropped to make room, or a flood of addresses could
      // erase a lockout. Addresses that do not fit are counted together instead.
      if (failures.size >= maxTracked) ip = OVERFLOW;
    }
    const record = failures.get(ip);
    if (record && record.until > Date.now() && record.count >= FAILURES_ALLOWED) return 'locked';
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const ok = token.length > 0 && crypto.timingSafeEqual(sha256(token), expected);
    if (ok) return 'yes';
    const next = record && record.until > Date.now() ? record : { count: 0, until: 0 };
    next.count += 1;
    next.until = Date.now() + LOCKOUT_MS;
    failures.set(ip, next);
    return 'no';
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new Error('too large'));
          req.destroy();
        } else chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('not JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  function openStream(res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(':ok\n\n');
    // A comment line now and then keeps proxies from closing a quiet connection.
    const beat = setInterval(() => res.write(':\n\n'), 20_000);
    res.on('close', () => clearInterval(beat));
  }
  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const toPhones = (event, data) => {
    for (const phone of phones) send(phone, event, data);
  };

  function append(entry) {
    // A snapshot holds the whole state, so everything before it can go.
    if (entry.snapshot) {
      log = [];
      logBytes = 0;
    }
    const item = { seq: ++seq, c: entry.c, snapshot: Boolean(entry.snapshot) };
    log.push(item);
    logBytes += item.c.length;
    while (log.length > MAX_LOG_ENTRIES || logBytes > MAX_LOG_BYTES) logBytes -= log.shift().c.length;
    toPhones('entry', item);
  }

  function serveFile(req, res, pathname) {
    const name = pathname === '/' ? '/index.html' : pathname;
    const file = path.join(PUBLIC, path.normalize(name));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000',
    });
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url, 'http://relay');
    if (pathname === '/healthz') return json(res, 200, { ok: true });
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/agent/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      return serveFile(req, res, pathname);
    }

    const auth = authorised(req);
    if (auth === 'locked') return json(res, 429, { error: 'Too many wrong attempts. Try again in 15 minutes.' });
    if (auth !== 'yes') return json(res, 401, { error: 'unauthorised' });

    try {
      if (req.method === 'GET' && pathname === '/api/stream') {
        const since = Number(searchParams.get('since')) || 0;
        openStream(res);
        send(res, 'agent', { online: agent !== null });
        // The caller starts over when it has nothing yet, when its position is older than
        // what is kept, or when it is ahead of us (this server restarted and lost the log).
        const stale = log.length > 0 && since < log[0].seq - 1;
        const reset = since === 0 || stale || since > seq;
        if (reset) send(res, 'reset', {});
        for (const entry of reset ? log : log.filter((e) => e.seq > since)) send(res, 'entry', entry);
        phones.add(res);
        res.on('close', () => phones.delete(res));
        return;
      }
      if (req.method === 'POST' && pathname === '/api/command') {
        const body = await readBody(req);
        if (typeof body.c !== 'string') return json(res, 400, { error: 'missing c' });
        if (!agent) return json(res, 503, { error: 'The Mac is not connected.' });
        send(agent, 'command', { c: body.c });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/agent/stream') {
        agent?.end(); // a newer connection from the Mac replaces the old one
        openStream(res);
        agent = res;
        toPhones('agent', { online: true });
        res.on('close', () => {
          if (agent !== res) return;
          agent = null;
          toPhones('agent', { online: false });
        });
        return;
      }
      if (req.method === 'POST' && pathname === '/agent/events') {
        const body = await readBody(req);
        if (!Array.isArray(body.events) || body.events.some((e) => typeof e?.c !== 'string')) return json(res, 400, { error: 'bad events' });
        for (const entry of body.events) append(entry);
        return json(res, 200, { seq });
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  });
}

// Started directly (on Railway): read the settings from the environment.
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const port = Number(process.env.PORT) || 8787;
  try {
    createRelay({ authHash: process.env.SEEKER_REMOTE_AUTH, trustProxy: Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.SEEKER_TRUST_PROXY === '1' }).listen(port, '0.0.0.0', () => console.log(`SEEKER relay listening on ${port}`));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
