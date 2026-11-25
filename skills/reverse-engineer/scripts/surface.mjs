#!/usr/bin/env node
// surface.mjs: static map of a BUILT web frontend (a deployed bundle, a dist/ or .next/ folder, a saved
// site) so a rebuild of an app you own starts from evidence instead of guesses. Node 22+, no dependencies.
// It only reads files as text. It never runs them, never fetches anything, never contacts the app.
//
//   node surface.mjs <dir>                          print the map as JSON
//   node surface.mjs <dir> --recover <outDir>       also write original sources embedded in *.map files
//   node surface.mjs <dir> --max 500                cap on listed items per section (default 300)
//
// Prints ONE JSON object: target, counts, sourceMaps, routes, endpoints, graphql, env, storage, sockets,
// services, secrets (masked), skipped. Use it only on an app the user owns or is authorised to rebuild
// (Mode A of the skill). Anything found here is a lead to confirm by hand, not a spec.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_FILE_BYTES = 8_000_000;
const MAX_FILES = 20_000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.html', '.htm', '.json', '.map', '.vue', '.svelte', '.txt']);

// A known secret shape is reported masked: enough to recognise and rotate it, never the value itself.
const SECRET_RULES = [
  ['stripe-secret', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}/g],
  ['openai-key', /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['supabase-service-role', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/g],
];

// Hosts that name the services a backend leans on.
const SERVICES = [
  ['supabase', /[a-z0-9-]+\.supabase\.co/], ['firebase', /firebaseio\.com|firebaseapp\.com|googleapis\.com\/identitytoolkit/],
  ['stripe', /js\.stripe\.com|api\.stripe\.com/], ['midtrans', /midtrans\.com/], ['xendit', /xendit\.co/], ['doku', /doku\.com/],
  ['sentry', /sentry\.io|ingest\.sentry/], ['google-analytics', /googletagmanager\.com|google-analytics\.com/],
  ['posthog', /posthog\.com/], ['algolia', /algolia(?:net)?\.(?:com|net)/], ['cloudinary', /res\.cloudinary\.com/],
  ['pusher', /pusher\.com/], ['auth0', /\.auth0\.com/], ['clerk', /clerk\.(?:com|dev|accounts)/], ['mapbox', /api\.mapbox\.com/],
  ['google-maps', /maps\.googleapis\.com/], ['aws-s3', /s3[.-][a-z0-9-]*\.?amazonaws\.com/], ['vercel', /\.vercel\.app/],
  ['railway', /\.up\.railway\.app/],
];

/** Masks a secret so it can be named and rotated but not reused. */
export const mask = (value) => (value.length <= 12 ? '***' : `${value.slice(0, 6)}…${value.slice(-2)} (${value.length} chars)`);

/** 1-based line number of an offset. */
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Reads one file's text and returns what it reveals about the app.
 * @returns {{routes:object[], endpoints:object[], graphql:object[], env:string[], storage:object[], sockets:string[], services:string[], secrets:object[], sourceMapUrl:string|null}}
 */
export function surfaceOf(text) {
  const out = { routes: [], endpoints: [], graphql: [], env: [], storage: [], sockets: [], services: [], secrets: [], sourceMapUrl: null };
  const add = (list, item) => list.push(item);

  // Router declarations: React Router / Vue Router objects, <Route path>, Next/Nuxt page manifests.
  for (const m of text.matchAll(/\bpath\s*[:=]\s*["'`](\/[^"'`\s]{0,120})["'`]/g)) add(out.routes, { path: m[1], line: lineAt(text, m.index) });
  for (const m of text.matchAll(/<Route\b[^>]*\bpath=["'{`]+(\/[^"'`}\s]{0,120})/g)) add(out.routes, { path: m[1], line: lineAt(text, m.index) });
  for (const m of text.matchAll(/["'`](\/(?:pages|app)\/[^"'`\s]{1,120}?)(?:\/page|\/index)?\.(?:jsx?|tsx?)["'`]/g)) add(out.routes, { path: m[1], line: lineAt(text, m.index) });

  // HTTP calls with a visible method; plain API-looking strings without one.
  const seen = new Set();
  const callRe = /\b(fetch|axios(?:\.(get|post|put|patch|delete))?|\$http\.(get|post|put|patch|delete)|(?:api|client|http|request)\.(get|post|put|patch|delete))\s*\(\s*["'`]([^"'`\s]{2,200})["'`]([^)]{0,200})/gi;
  for (const m of text.matchAll(callRe)) {
    const url = m[5];
    if (!/^(?:\/|https?:\/\/)/.test(url)) continue;
    const explicit = (m[2] || m[3] || m[4] || '').toUpperCase();
    const inOpts = /method\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)/i.exec(m[6])?.[1]?.toUpperCase();
    add(out.endpoints, { method: explicit || inOpts || (m[1].toLowerCase() === 'fetch' ? 'GET?' : '?'), url, line: lineAt(text, m.index) });
    seen.add(url);
  }
  for (const m of text.matchAll(/["'`]((?:https?:\/\/[^"'`\s/]+)?\/(?:api|v\d+|graphql|rest|rpc|trpc)(?:\/[^"'`\s]{0,160})?)["'`]/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    add(out.endpoints, { method: '?', url: m[1], line: lineAt(text, m.index) });
  }

  for (const m of text.matchAll(/\b(query|mutation|subscription)\s+([A-Z_a-z][A-Za-z0-9_]{1,80})\s*[({]/g)) add(out.graphql, { kind: m[1], name: m[2], line: lineAt(text, m.index) });

  for (const m of text.matchAll(/\b(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]{1,80})/g)) out.env.push(m[1]);
  for (const m of text.matchAll(/["'`]((?:NEXT_PUBLIC|VITE|REACT_APP|NUXT_PUBLIC|EXPO_PUBLIC)_[A-Z0-9_]{1,80})["'`]/g)) out.env.push(m[1]);

  for (const m of text.matchAll(/\b(localStorage|sessionStorage)\.(?:setItem|getItem|removeItem)\(\s*["'`]([^"'`]{1,100})["'`]/g)) add(out.storage, { store: m[1], key: m[2] });
  for (const m of text.matchAll(/["'`](wss?:\/\/[^"'`\s]{3,200})["'`]/g)) out.sockets.push(m[1]);
  for (const [name, re] of SERVICES) if (re.test(text)) out.services.push(name);

  for (const [kind, re] of SECRET_RULES) for (const m of text.matchAll(re)) add(out.secrets, { kind, value: mask(m[0]), line: lineAt(text, m.index) });

  const sm = /[#@]\s*sourceMappingURL=([^\s'"*]+)\s*(?:\*\/)?\s*$/m.exec(text.slice(-2000));
  if (sm && !sm[1].startsWith('data:')) out.sourceMapUrl = sm[1];
  else if (sm) out.sourceMapUrl = 'inline';
  return out;
}

/**
 * Where a source named in a map is written under outDir. Bundler prefixes (webpack://, ../, absolute
 * paths, drive letters) are stripped so nothing lands outside outDir; null when no usable name is left.
 */
export function recoverPath(outDir, sourceName) {
  let rel = String(sourceName)
    .replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/i, '') // webpack:///, file://, vite://
    .replace(/\?.*$/, '')
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:\//, '');
  const parts = rel.split('/').filter((p) => p && p !== '.' && p !== '..' && p !== '~');
  if (!parts.length) return null;
  rel = parts.join('/');
  const base = path.resolve(outDir);
  const dest = path.resolve(base, rel);
  return dest === base || !dest.startsWith(base + path.sep) ? null : dest;
}

/** Writes the sourcesContent of one parsed source map under outDir. Returns { written, skipped }. */
export function recoverMap(map, outDir) {
  const res = { written: 0, skipped: 0, files: [] };
  const sources = Array.isArray(map?.sources) ? map.sources : [];
  const contents = Array.isArray(map?.sourcesContent) ? map.sourcesContent : [];
  sources.forEach((name, i) => {
    const content = contents[i];
    const dest = typeof content === 'string' && !/(^|\/)node_modules\//.test(String(name)) ? recoverPath(outDir, name) : null;
    if (!dest) return res.skipped++;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    res.written++;
    res.files.push(path.relative(outDir, dest));
  });
  return res;
}

function* walk(root, skipped) {
  const stack = [root];
  let count = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      skipped.push({ path: path.relative(root, dir) || '.', reason: err.code ?? err.message });
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile() && TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
        if (++count > MAX_FILES) return skipped.push({ path: '.', reason: `stopped after ${MAX_FILES} files` });
        yield full;
      }
    }
  }
}

/** Maps a folder. With recover, sources embedded in *.map files are written under that folder. */
export function surface(target, { max = 300, recover = null } = {}) {
  const root = path.resolve(target);
  if (!fs.statSync(root).isDirectory()) throw new Error(`${target} is not a folder`);
  const into = recover ? path.resolve(recover) : null;
  if (into && (into === root || into.startsWith(root + path.sep))) throw new Error('--recover must be outside the folder being mapped');
  const skipped = [];
  const acc = { routes: new Map(), endpoints: new Map(), graphql: new Map(), env: new Set(), storage: new Map(), sockets: new Set(), services: new Set(), secrets: [] };
  const sourceMaps = { files: 0, withSources: 0, sourceFiles: 0, referencedButMissing: [], recovered: recover ? { to: path.resolve(recover), written: 0, skipped: 0 } : null };
  let files = 0;

  for (const file of walk(root, skipped)) {
    const rel = path.relative(root, file);
    const size = fs.statSync(file).size;
    if (size > MAX_FILE_BYTES) {
      skipped.push({ path: rel, reason: `larger than ${MAX_FILE_BYTES} bytes` });
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    files++;
    if (file.endsWith('.map')) {
      sourceMaps.files++;
      let map;
      try {
        map = JSON.parse(text);
      } catch {
        skipped.push({ path: rel, reason: 'source map is not valid JSON' });
        continue;
      }
      const n = Array.isArray(map.sourcesContent) ? map.sourcesContent.filter((c) => typeof c === 'string').length : 0;
      if (n) sourceMaps.withSources++, (sourceMaps.sourceFiles += n);
      if (recover && n) {
        const r = recoverMap(map, path.resolve(recover));
        sourceMaps.recovered.written += r.written;
        sourceMaps.recovered.skipped += r.skipped;
      }
      continue; // the map's embedded sources are mapped once recovered, not here (they would double every hit)
    }
    const s = surfaceOf(text);
    const at = (line) => `${rel}:${line}`;
    for (const r of s.routes) if (!acc.routes.has(r.path)) acc.routes.set(r.path, { path: r.path, at: at(r.line) });
    for (const e of s.endpoints) {
      const key = `${e.method} ${e.url}`;
      if (!acc.endpoints.has(key)) acc.endpoints.set(key, { method: e.method, url: e.url, at: at(e.line) });
    }
    for (const g of s.graphql) if (!acc.graphql.has(g.name)) acc.graphql.set(g.name, { kind: g.kind, name: g.name, at: at(g.line) });
    s.env.forEach((x) => acc.env.add(x));
    for (const x of s.storage) acc.storage.set(`${x.store}:${x.key}`, x);
    s.sockets.forEach((x) => acc.sockets.add(x));
    s.services.forEach((x) => acc.services.add(x));
    for (const x of s.secrets) acc.secrets.push({ kind: x.kind, value: x.value, at: at(x.line) });
    if (s.sourceMapUrl && s.sourceMapUrl !== 'inline' && !/^https?:/.test(s.sourceMapUrl)) {
      const mapFile = path.resolve(path.dirname(file), s.sourceMapUrl);
      if (!fs.existsSync(mapFile)) sourceMaps.referencedButMissing.push({ from: rel, map: s.sourceMapUrl });
    }
  }

  const cap = (list) => list.slice(0, max);
  const sorted = (m, key) => [...m.values()].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  const out = {
    target: root,
    counts: { files, routes: acc.routes.size, endpoints: acc.endpoints.size, graphql: acc.graphql.size, env: acc.env.size, storage: acc.storage.size, sockets: acc.sockets.size, secrets: acc.secrets.length },
    sourceMaps: { ...sourceMaps, referencedButMissing: cap(sourceMaps.referencedButMissing) },
    routes: cap(sorted(acc.routes, 'path')),
    endpoints: cap(sorted(acc.endpoints, 'url')),
    graphql: cap(sorted(acc.graphql, 'name')),
    env: cap([...acc.env].sort()),
    storage: cap([...acc.storage.values()]),
    sockets: cap([...acc.sockets].sort()),
    services: [...acc.services].sort(),
    secrets: cap(acc.secrets),
    skipped,
  };
  return out;
}

function parseArgs(argv) {
  const opts = { max: 300, recover: null };
  let target = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max') opts.max = Math.max(1, Number(argv[++i]) || 300);
    else if (a === '--recover') opts.recover = argv[++i] ?? null;
    else if (!a.startsWith('--') && !target) target = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!target) throw new Error('usage: node surface.mjs <dir> [--recover <outDir>] [--max N]');
  if (opts.recover === null && argv.includes('--recover')) throw new Error('--recover needs a folder');
  return { target, opts };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const { target, opts } = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(surface(target, opts), null, 2));
  } catch (err) {
    console.error(`surface: ${err.message}`);
    process.exit(1);
  }
}
