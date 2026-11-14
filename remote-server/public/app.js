// SEEKER Remote — the phone app.
//
// Everything shown here arrives encrypted from the Mac and is decrypted in
// this page with a key derived from the pairing secret, which stays on this
// device (localStorage) and is never sent to the server. Text from the Mac is
// always inserted as text, never as HTML.
//
// Nothing on these screens is made up here: statuses, counts and timings come
// from the Mac's events, and a value the Mac has not reported is shown as "—".

import { SOURCES, WORKSPACE_SORTS, activity, connection, current, localFolders, summary, workspaces as explorerRows } from './home.js';
import { SORTS, STATUSES, filters, since, statusOf, view as sessionsView } from './sessions.js';

const $ = (id) => document.getElementById(id);
const enc = new TextEncoder();
const dec = new TextDecoder();

// ── small DOM helper ───────────────────────────────────────────────────────
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key === 'icon') el.innerHTML = ICONS[value]; // fixed strings from this file only
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'style') el.style.cssText = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  // The robot of the terminal header, on the same 11×8 pixel grid (src/mascot.mjs).
  logo: `<svg class="robot" viewBox="0 -1.5 11 11" shape-rendering="crispEdges" aria-hidden="true"><path class="o" d="M3 0h1v1H3zM7 0h1v1H7zM3 7h2v1H3zM6 7h2v1H6z"/><path class="c" d="M2 1h7v1H2zM1 2h1v2H1zM9 2h1v2H9zM2 4h7v1H2zM3 5h5v1H3zM3 6h2v1H3zM6 6h2v1H6z"/><path class="b" d="M.5 2H1v2H.5zM10 2h.5v2H10zM2 6h1v1H2zM8 6h1v1H8z"/><path class="k" d="M2 2h7v2H2z"/><path class="y" d="M5 6h1v1H5z"/><g class="face" shape-rendering="geometricPrecision"><path class="eye open" d="M4.2 2.5l.6.5-.6.5M6.8 2.5l-.6.5.6.5"/><path class="eye shut" d="M4.15 3h.7M6.15 3h.7"/><path class="cur" d="M5.15 3.4h.7v.25h-.7z"/></g></svg>`,
  laptop: svg('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  folder: svg('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'),
  home: svg('<path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z"/>'),
  terminal: svg('<path d="M5 8l4 4-4 4M12 16h7"/>'),
  shield: svg('<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-2.8 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007 19.4a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1A1.7 1.7 0 003 14H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 7a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1A1.7 1.7 0 0010 3.1V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.9 2.9l-.1.1A1.7 1.7 0 0020.9 10H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  cube: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  layers: svg('<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>'),
  bolt: svg('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 118 0v3"/>'),
  wifi: svg('<path d="M3 9a14 14 0 0118 0M6 12.5a9.5 9.5 0 0112 0M9 16a5 5 0 016 0"/><circle cx="12" cy="19" r="0.6"/>'),
  pulse: svg('<path d="M3 12h4l2-6 4 12 2-6h6"/>'),
  list: svg('<path d="M8 7h12M8 12h12M8 17h12"/><circle cx="4" cy="7" r="0.6"/><circle cx="4" cy="12" r="0.6"/><circle cx="4" cy="17" r="0.6"/>'),
  image: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  cross: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  play: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>`,
  brain: svg('<path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V7a3 3 0 00-3-3zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 0"/>'),
  at: svg('<circle cx="12" cy="12" r="3.6"/><path d="M15.6 8.4v4.8a2.6 2.6 0 005.2 0V12a8.8 8.8 0 10-3.6 7.1"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h8M16 17h4"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="14" cy="17" r="2"/>'),
  sort: svg('<path d="M8 5v14M8 19l-3.5-3.5M8 19l3.5-3.5M16 19V5M16 5l-3.5 3.5M16 5l3.5 3.5"/>'),
  funnel: svg('<path d="M4 5h16l-6.2 7.4V18l-3.6 2v-7.6z"/>'),
  // Settings: one icon per row, each for what the row is about.
  cloud: svg('<path d="M7.5 18.5a4.5 4.5 0 01-.6-8.96A5.5 5.5 0 0117.6 10.6 4 4 0 0117 18.5z"/>'),
  timer: svg('<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5M9.5 3.5h5M12 3.5v3"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  hourglass: svg('<path d="M7 3.5h10M7 20.5h10M8 3.5v3.2c0 1.6 4 3.6 4 5.3 0-1.7 4-3.7 4-5.300V3.500M8 20.500v-3.200c0-1.6 4-3.6 4-5.3 0 1.7 4 3.7 4 5.300v3.2"/>'),
  server: svg('<rect x="4" y="4.5" width="16" height="6" rx="1.5"/><rect x="4" y="13.5" width="16" height="6" rx="1.5"/><path d="M7.5 7.500h.01M7.5 16.500h.01"/>'),
  key: svg('<circle cx="8" cy="15" r="3.5"/><path d="M10.6 12.400L19 4M15.5 7.500l2.5 2.500M13 10l1.8 1.8"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  eyeoff: svg('<path d="M4 4l16 16M9.9 5.800A8.6 8.6 0 0112 5.500c6 0 9.5 6.5 9.5 6.500a15.6 15.6 0 01-2.9 3.700M6.4 7.400A15.3 15.3 0 002.5 12S6 18.5 12 18.500a8.7 8.7 0 004-1M10 10.100a2.8 2.8 0 003.9 3.9"/>'),
  plane: svg('<path d="M20.5 3.500L3.5 10.500l6.5 2.5 2.5 6.500zM10 13l4.5-4.5"/>'),
  help: svg('<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.500a2.4 2.4 0 114 1.800c-.9.7-1.7 1.2-1.7 2.400M12 16.800h.01"/>'),
  alert: svg('<path d="M12 4.500l8.5 14.500h-17zM12 10v4.500M12 16.800h.01"/>'),
  done: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.300l2.4 2.4 4.6-5"/>'),
  phone: svg('<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 18h2"/>'),
  gauge: svg('<path d="M4.5 17a8.5 8.5 0 1115 0M12 14l3.5-4.5"/><circle cx="12" cy="14.5" r="1"/>'),
  tag: svg('<path d="M3.5 12.500V4.500h8l9 9-8 8zM8 8.500h.01"/>'),
  stop: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 4l18 8-18 8 3-8zm3 8h7"/></svg>`,
};

// ── state ──────────────────────────────────────────────────────────────────
const state = {
  secret: null,
  token: null,
  key: null,
  since: 0,
  linked: false, // the stream to the relay is open
  online: false, // the Mac is connected to the relay
  device: null,
  workspaces: new Map(), // id → { meta, items }
  approvals: [],
  folders: [],
  view: { name: 'home' },
  homeTab: 'control',
  sessionTab: 'activity', // activity | tools | metrics
  error: '',
  picking: false, // the model sheet is open and waiting for lists from the Mac
  push: 'unknown', // unsupported | off | on | denied
  lastEntryAt: null, // when the Mac was last heard from
  latency: null, // { ms, at } — a measured round trip to the Mac and back
  open: new Set(), // timeline entries the reader expanded
  shown: new Map(), // workspace id → how many entries are drawn
  deciding: new Set(), // approvals whose answer is on its way
  drawn: new Set(), // timeline entries already on screen once, so only new ones animate in
  loaded: false, // the Mac's list of projects has arrived at least once
  list: { query: '', searching: false, filter: 'all', sort: stored('seeker.sessions.sort', 'recent') }, // the Sessions screen
  everLinked: false, // the relay has answered at least once since the app opened
  explorer: { query: '', sort: stored('seeker.workspaces.sort', 'recent'), source: 'all', local: false, localQuery: '' }, // Home → Projects
  lastSession: stored('seeker.sessions.last', null), // the session opened last, marked in the list
};
/** A convenience kept on this phone only. Private windows may refuse storage; the app works without it. */
function stored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

let streamAbort = null;
let reconnecting = false;
const pings = new Map(); // command id → when it was sent
const acks = new Map(); // key of an instruction → called with what the Mac answered
const NO_QUEUE = { items: [], paused: null };

const PAGE = 120; // timeline entries drawn at first; older ones on request
const PREFS_KEY = 'seeker.push.prefs';
function pushPrefs() {
  try {
    return { done: true, approval: true, error: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { done: true, approval: true, error: true };
  }
}

// ── crypto (must match src/remote.mjs) ─────────────────────────────────────
async function derive(secret) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sign = async (label) => new Uint8Array(await crypto.subtle.sign('HMAC', base, enc.encode(label)));
  const token = [...(await sign('seeker-remote-auth-v1'))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', await sign('seeker-remote-enc-v1'), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { token, key };
}

const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

async function unseal(text) {
  const raw = fromBase64(text);
  const plainBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, state.key, raw.subarray(12));
  return JSON.parse(dec.decode(plainBytes));
}

async function seal(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.key, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(12 + body.length);
  out.set(iv);
  out.set(body, 12);
  return toBase64(out);
}

// ── talking to the relay ───────────────────────────────────────────────────
/** Sends one encrypted command to the Mac. Resolves true once the relay has taken it. */
async function command(type, fields = {}, { id = crypto.randomUUID(), quiet = false } = {}) {
  try {
    const c = await seal({ id, at: Date.now(), type, ...fields });
    const res = await fetch('/api/command', { method: 'POST', headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ c }) });
    if (res.ok) return true;
    if (!quiet) toast(res.status === 503 ? 'Your Mac is not connected.' : res.status === 400 ? 'That message is too large to send.' : `Could not send (${res.status}).`);
  } catch {
    if (!quiet) toast('No connection.');
  }
  return false;
}

/**
 * Sends an instruction to a project that is working: 'steer' into the task in progress, 'queue' for after it.
 * Resolves with what the Mac says became of it — { as: 'queued' | 'steered' | 'started' } or { error }. Nothing
 * counts as sent before that answer. Sending again with the same `key` cannot make it happen twice.
 */
function instruct(ws, text, mode, key) {
  return new Promise((resolve) => {
    const finish = (result) => {
      clearTimeout(timer);
      acks.delete(key);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ error: 'Your Mac did not confirm it, so it may not have arrived. Try again.' }), 12_000);
    acks.set(key, finish);
    command('instruct', { ws, text, mode, key }, { quiet: true }).then((taken) => taken || finish({ error: state.linked && state.online ? 'Could not send it.' : 'Your Mac is not connected. Nothing was sent.' }));
  });
}

/** Times the whole path — phone → relay → Mac → relay → phone — with a message the Mac echoes. */
function ping() {
  if (!state.linked || !state.online) return;
  const id = crypto.randomUUID();
  pings.set(id, performance.now());
  if (pings.size > 8) pings.delete(pings.keys().next().value);
  command('ping', {}, { id, quiet: true });
}

function apply(event) {
  const ws = state.workspaces.get(event.ws);
  switch (event.t) {
    case 'snapshot':
      state.device = event.device;
      state.folders = event.folders ?? [];
      state.approvals = event.approvals ?? [];
      state.loaded = true;
      state.workspaces = new Map(event.workspaces.map(({ items, queue, ...meta }) => [meta.id, { meta, items: items ?? [], queue: queue ?? NO_QUEUE }]));
      break;
    case 'ws': {
      const existing = state.workspaces.get(event.ws.id);
      if (existing) existing.meta = event.ws;
      else state.workspaces.set(event.ws.id, { meta: event.ws, items: [], queue: NO_QUEUE });
      break;
    }
    case 'item':
      // The same entry can arrive twice around a reconnect; it is shown once.
      if (ws && !ws.items.some((i) => i.id === event.item.id)) ws.items.push(event.item);
      break;
    case 'patch': {
      const item = ws?.items.find((i) => i.id === event.id);
      if (!item) break;
      Object.assign(item, event.patch ?? {});
      if (event.append) item.text = (item.text ?? '') + event.append;
      break;
    }
    case 'queue':
      // Always the whole queue as the Mac holds it, so a repeated or late event cannot leave a wrong one behind.
      if (ws) ws.queue = event.queue ?? NO_QUEUE;
      break;
    case 'sent':
      acks.get(event.key)?.(event);
      break;
    case 'approval':
      state.approvals = [...state.approvals.filter((a) => a.id !== event.approval.id), event.approval];
      if (navigator.vibrate) navigator.vibrate(120);
      break;
    case 'approval_done':
      state.approvals = state.approvals.filter((a) => a.id !== event.id);
      state.deciding.delete(event.id);
      if (state.view.name === 'review' && state.view.id === event.id) state.view = state.view.from ?? { name: 'approvals' };
      break;
    case 'providers':
      if (state.picking === 'keys') showKeys(event.list);
      else if (state.picking) showProviders(event.list);
      break;
    case 'models':
      if (state.picking) showModels(event);
      break;
    case 'pong': {
      const sent = pings.get(event.id);
      if (sent == null) break;
      pings.delete(event.id);
      state.latency = { ms: Math.round(performance.now() - sent), at: Date.now() };
      break;
    }
    case 'opened':
      // Only the phone that just asked follows it there; this event reaches every phone.
      if (state.opening && Date.now() - state.opening < 15_000 && state.workspaces.has(event.id)) {
        state.opening = 0;
        if (event.created) toast('Folder created.');
        go({ name: 'session', ws: event.id });
      }
      break;
    case 'toast':
      state.opening = 0;
      // It may be the Mac refusing an answer that came too late: nothing is waiting on one any more.
      state.deciding.clear();
      toast(event.text);
      break;
  }
}

async function listen() {
  let wait = 1000;
  for (;;) {
    streamAbort = new AbortController();
    try {
      const res = await fetch(`/api/stream?since=${state.since}`, { headers: { authorization: `Bearer ${state.token}` }, signal: streamAbort.signal });
      if (res.status === 401) return signOut('This phone is not paired with the relay. Paste the pairing link again.');
      if (res.status === 429) return signOut('Too many wrong attempts. Try again in 15 minutes.');
      if (!res.ok) throw new Error(String(res.status));
      state.linked = true;
      state.everLinked = true;
      wait = 1000;
      render();
      const reader = res.body.getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!name || !data) continue;
          const payload = JSON.parse(data);
          if (name === 'agent') {
            const was = state.online;
            state.online = payload.online;
            if (!was && state.online) setTimeout(ping, 400);
            if (!state.online) state.latency = null;
          } else if (name === 'reset') {
            state.workspaces = new Map();
            state.approvals = [];
          } else if (name === 'entry') {
            state.since = payload.seq;
            state.lastEntryAt = Date.now();
            try {
              apply(await unseal(payload.c));
            } catch {
              return signOut('The pairing secret on this phone does not match your Mac. Paste the pairing link again.');
            }
          }
          render();
        }
      }
    } catch (err) {
      // Aborted on purpose: either the phone was unpaired (stop), or a reconnect was asked for (go round again).
      if (err.name === 'AbortError' && !reconnecting) return;
    }
    const again = reconnecting;
    reconnecting = false;
    state.linked = false;
    state.latency = null;
    render();
    if (!again) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait = Math.min(wait * 2, 15000);
    }
  }
}

/** Drops the stream and opens it again; the relay replays whatever was missed. */
function reconnect() {
  reconnecting = true;
  streamAbort?.abort();
  toast('Reconnecting…');
}

// ── pairing ────────────────────────────────────────────────────────────────
async function pair(input) {
  const secret = (/[#&]k=([^&\s]+)/.exec(input)?.[1] ?? input).trim();
  if (secret.length < 20) return false;
  Object.assign(state, await derive(secret), { secret, since: 0, error: '' });
  localStorage.setItem('seeker.secret', secret);
  listen();
  return true;
}

function signOut(message = '') {
  streamAbort?.abort();
  localStorage.removeItem('seeker.secret');
  Object.assign(state, { secret: null, token: null, key: null, since: 0, linked: false, online: false, device: null, workspaces: new Map(), approvals: [], error: message, view: { name: 'home' }, latency: null, lastEntryAt: null });
  render();
}

// ── formatting ─────────────────────────────────────────────────────────────
const kilo = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const sizeOf = (n) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : `${Math.round(n / (n % 1024 === 0 && n % 1000 !== 0 ? 1024 : 1000))}k`);
const clock = (at) => (at ? new Date(at).toLocaleTimeString([], { hour12: false }) : '');
function ago(at) {
  if (!at) return '—';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * What the agent in a workspace is doing, from what the Mac reported: its status and, while it
 * works, its phase. `tone` picks the colour: amber waits for the user, purple is the model thinking,
 * blue is work being done, green finished, red failed.
 */
function agentState(meta) {
  if (meta.status === 'approval') return { key: 'approval', label: 'AWAITING APPROVAL', tone: 'primary', busy: true };
  if (meta.status === 'working') {
    if (meta.phase === 'thinking') return { key: 'thinking', label: 'THINKING', tone: 'reasoning', busy: true };
    if (meta.phase === 'responding') return { key: 'responding', label: 'RESPONDING', tone: 'execution', busy: true };
    return { key: 'executing', label: 'EXECUTING', tone: 'execution', busy: true };
  }
  if (meta.outcome === 'completed') return { key: 'completed', label: 'COMPLETED', tone: 'success', busy: false };
  if (meta.outcome === 'failed') return { key: 'failed', label: 'FAILED', tone: 'danger', busy: false };
  if (meta.outcome === 'stopped') return { key: 'stopped', label: 'STOPPED', tone: 'muted', busy: false };
  return { key: 'idle', label: 'IDLE', tone: 'muted', busy: false };
}

/** Model text → safe DOM: paragraphs, fenced code, `code`, **bold**, headings. */
function prose(text) {
  const out = [];
  const inline = (line) => {
    const parts = [];
    for (const piece of line.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/)) {
      if (!piece) continue;
      if (piece.startsWith('`')) parts.push(h('code', {}, piece.slice(1, -1)));
      else if (piece.startsWith('**')) parts.push(h('b', {}, piece.slice(2, -2)));
      else parts.push(piece);
    }
    return parts;
  };
  for (const [i, chunk] of String(text).split(/```/).entries()) {
    if (i % 2) {
      out.push(h('pre', {}, chunk.replace(/^[^\n]*\n/, '').replace(/\n$/, '')));
      continue;
    }
    for (const para of chunk.split(/\n{2,}/)) {
      if (!para.trim()) continue;
      const heading = /^#{1,6}\s+(.*)$/.exec(para.trim());
      out.push(heading ? h('h4', {}, heading[1]) : h('p', {}, inline(para.replace(/^\n+|\n+$/g, ''))));
    }
  }
  return out;
}

/** A line of code, coloured: comments, strings, numbers and common keywords. Language-agnostic on purpose. */
const TOKEN = /(\/\/.*$|#.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b|\b(const|let|var|function|return|if|else|for|while|import|export|from|class|new|await|async|def|fn|pub|try|catch|throw|type|interface|null|true|false|None|True|False)\b/g;
function code(line) {
  const parts = [];
  let last = 0;
  for (const m of String(line).matchAll(TOKEN)) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    parts.push(h('span', { class: m[1] ? 'tok-c' : m[2] ? 'tok-s' : m[3] ? 'tok-n' : 'tok-k' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 3500);
}

function sheet(title, ...content) {
  const el = $('sheet');
  el.replaceChildren(h('div', { class: 'panel', role: 'dialog', 'aria-label': title, onclick: (e) => e.stopPropagation() }, h('div', { class: 'grip' }), h('h3', {}, title), ...content));
  el.hidden = false;
  el.onclick = closeSheet;
}
const closeSheet = () => {
  $('sheet').hidden = true;
  state.picking = false;
};

// ── choosing the model (the lists come from the Mac) ──
async function chooseModel() {
  state.picking = true;
  sheet('Where should the model run?', h('div', { class: 'muted' }, 'Asking your Mac…'));
  if (!(await command('providers'))) closeSheet();
}

function showProviders(list) {
  sheet(
    'Where should the model run?',
    ...list.map((p) =>
      h(
        'button',
        {
          class: 'row-btn',
          disabled: !p.ready && !p.key,
          onclick: () => {
            if (!p.ready) return enterKey(p);
            sheet(p.label, h('div', { class: 'muted' }, 'Loading its models…'));
            command('models', { provider: p.id });
          },
        },
        h('div', {}, p.label, p.active && h('span', { class: 'accent' }, '  • active')),
        h('div', { class: 'muted small' }, p.local ? 'local' : 'cloud', p.ready ? '' : p.key ? ' · needs an API key — tap to enter it' : ' · needs an API key — set it on the Mac with /key'),
      ),
    ),
  );
}

function showModels({ provider, label, models, active }) {
  const list = h('div');
  const fill = (query) => {
    const q = query.trim().toLowerCase();
    const shown = models.filter((m) => !q || m.name.toLowerCase().includes(q)).slice(0, 80);
    list.replaceChildren(
      ...shown.map((m) =>
        h(
          'button',
          {
            class: 'row-btn',
            onclick: () => {
              state.picking = false;
              closeSheet();
              toast(`Switching to ${m.name}…`);
              command('model', { provider, model: m.name });
            },
          },
          h('div', { class: 'mono' }, m.name, m.name === active && h('span', { class: 'accent' }, '  • active')),
          m.hint && h('div', { class: 'muted small' }, m.hint),
        ),
      ),
      shown.length ? null : h('div', { class: 'muted pad' }, 'Nothing matches.'),
    );
  };
  const filter = h('input', { class: 'field', placeholder: `Filter ${models.length} models`, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', oninput: (e) => fill(e.target.value) });
  fill('');
  sheet(label, models.length > 8 ? filter : null, list);
}

// ── settings kept on the Mac ──
const setConfig = (key, value) => command('config', { key, value: String(value) });

/** A sheet with one field, for a setting that is a number or a short text. */
function editSetting(key, title, current, { hint = null, numeric = false } = {}) {
  const input = h('input', { class: 'field', value: current ?? '', inputmode: numeric ? 'numeric' : null, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const save = (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return input.focus();
    closeSheet();
    setConfig(key, value);
  };
  sheet(title, h('form', { onsubmit: save }, input, h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save'))), hint && h('div', { class: 'muted small pad' }, hint));
}

async function chooseKey() {
  state.picking = 'keys';
  sheet('API keys', h('div', { class: 'muted' }, 'Asking your Mac…'));
  if (!(await command('providers'))) closeSheet();
}

function showKeys(list) {
  const about = { env: 'set in the Mac’s environment', set: 'key set — tap to replace', none: 'no key yet' };
  sheet(
    'API keys',
    h('div', { class: 'muted small pad' }, 'A key travels to your Mac encrypted and is stored there. It is never shown again, here or anywhere.'),
    ...list.filter((p) => p.key).map((p) => h('button', { class: 'row-btn', onclick: () => enterKey(p) }, h('div', {}, p.label, p.active && h('span', { class: 'accent' }, '  • active')), h('div', { class: 'muted small' }, about[p.key] ?? ''))),
  );
}

function enterKey(p) {
  const input = h('input', { class: 'field', type: 'password', placeholder: `${p.label} API key`, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const save = (e) => {
    e.preventDefault();
    const key = input.value.trim();
    if (!key) return input.focus();
    closeSheet();
    command('key', { provider: p.id, key });
  };
  sheet(
    `${p.label} API key`,
    h('form', { onsubmit: save }, input, h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save on the Mac'))),
    p.key === 'env' && h('div', { class: 'muted small pad' }, 'Your Mac already has a key for this in its environment, and that one is used first.'),
  );
}

// ── notifications ──
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function refreshPush() {
  if (!pushSupported()) state.push = 'unsupported';
  else if (Notification.permission === 'denied') state.push = 'denied';
  else {
    const registration = await navigator.serviceWorker.getRegistration();
    state.push = (await registration?.pushManager.getSubscription()) ? 'on' : 'off';
  }
  render();
}

async function enablePush() {
  if (!state.device?.vapid) return toast('Your Mac must be connected to turn this on.');
  try {
    // Must come straight from a tap: browsers only show the permission prompt then.
    if ((await Notification.requestPermission()) !== 'granted') return refreshPush();
    const registration = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(state.device.vapid.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    await command('push_subscribe', { subscription: subscription.toJSON(), prefs: pushPrefs() });
  } catch (err) {
    toast(`Could not turn notifications on: ${err.message}`);
  }
  refreshPush();
}

async function disablePush() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await command('push_unsubscribe', { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
  refreshPush();
}

/** Which kinds of notification this phone gets. Kept here and on the Mac, which is what sends them. */
async function setPushPref(kind, on) {
  const before = pushPrefs();
  const prefs = { ...before, [kind]: on };
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  render();
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription && (await command('push_prefs', { endpoint: subscription.endpoint, prefs }))) return;
  // The Mac did not get it, so it would go on sending the old way: a setting not in force is not shown.
  localStorage.setItem(PREFS_KEY, JSON.stringify(before));
  render();
}

/** Opens the screen named in a link's "#v=…" part. */
function route(link) {
  const [screen, target] = (/[#&]v=([^&]+)/.exec(link)?.[1] ?? '').split(':');
  if (screen === 'session') go({ name: 'session', ws: target });
  else if (screen === 'review') go({ name: 'review', id: target, from: { name: 'approvals' } });
  else if (['approvals', 'sessions', 'settings', 'home'].includes(screen)) go({ name: screen });
}

const go = (view) => {
  // Another conversation opens on its activity; coming back to the same one keeps the tab.
  if (view.name === 'session' && view.ws !== state.view.ws && view.ws !== state.view.from?.ws) state.sessionTab = 'activity';
  if (view.name === 'session' && view.ws) store('seeker.sessions.last', (state.lastSession = view.ws));
  state.view = view;
  render(true);
};

// ── shared pieces ──────────────────────────────────────────────────────────
const section = (title, ...right) => h('div', { class: 'section' }, h('span', { class: 'with-ico' }, title), ...right);
const dot = (tone) => h('span', { class: `dot ${tone}` });
const row = (icon, label, value, { tone = '', onclick = null, sub = null } = {}) =>
  h(
    onclick ? 'button' : 'div',
    { class: 'row', onclick },
    icon && h('span', { class: 'ico', icon }),
    h('span', { class: 'grow' }, h('span', { class: 'label' }, label), sub && h('span', { class: 'sub' }, sub)),
    value != null && h('span', { class: `value ${tone}` }, value),
    onclick && h('span', { class: 'chev', icon: 'chevron' }),
  );

function header() {
  const initial = (state.device?.name ?? 'S').trim()[0]?.toUpperCase() ?? 'S';
  const up = state.linked && state.online;
  return h(
    'header',
    { class: 'brand' },
    h('span', { class: state.device?.settings?.animation === false ? 'mark still' : 'mark', icon: 'logo' }),
    h('div', { class: 'grow' }, h('div', { class: 'word' }, 'SEEKER'), h('div', { class: 'sub' }, 'REMOTE')),
    h('button', { class: 'avatar', 'aria-label': `Settings — ${up ? 'connected' : 'not connected'}`, onclick: () => go({ name: 'settings' }) }, initial, h('i', { class: up ? 'on' : 'off' })),
  );
}

/** A strip across the top whenever what is on screen may be out of date. */
function linkBanner() {
  if (!state.secret) return null;
  if (!state.linked) return h('div', { class: 'banner warning', role: 'status' }, h('i', { class: 'spin' }), 'Reconnecting to the relay…');
  if (!state.online) return h('div', { class: 'banner danger', role: 'status' }, dot('off'), 'Your Mac is offline. Run `seeker remote` on it.');
  return null;
}

// ── home ───────────────────────────────────────────────────────────────────
const INIT = 'Explore this project (list the root, read the README and the main manifest/config files, look at the folder structure) and then write a SEEKER.md file in the working directory describing what the project is, the tech stack, how to install / run / test / build it, the folder layout, and conventions visible in the code. Keep it under 80 lines and include only what you verified.';

function addWorkspace() {
  const input = h('input', { class: 'field', placeholder: '~/project-folder', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const open = async (folder, create = false) => {
    let name = folder.trim();
    if (!name) return input.focus();
    // A bare name for a new project means a folder in the home folder.
    if (create && !/^[~/]/.test(name)) name = `~/${name}`;
    closeSheet();
    state.opening = Date.now();
    if (await command('open', create ? { path: name, create: true } : { path: name })) toast(create ? `Creating ${name}…` : `Opening ${name}…`);
  };
  const opened = new Set([...state.workspaces.values()].map((w) => w.meta.path));
  const rest = state.folders.filter((f) => !opened.has(f));
  sheet(
    'Open a project',
    h('form', { onsubmit: (e) => (e.preventDefault(), open(input.value)) }, input, h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Open'), h('button', { class: 'btn', type: 'button', onclick: () => open(input.value, true) }, 'Create new folder'))),
    h('div', { class: 'muted small pad' }, 'Create new folder makes it on your Mac, inside your home folder, and opens it.'),
    rest.length ? h('div', { class: 'muted small pad' }, 'On your Mac:') : null,
    ...rest.map((f) => h('button', { class: 'row-btn mono', onclick: () => open(f) }, f)),
  );
}

/** A search field with its icon and, once something is typed, a button that empties it. */
function searchBox(name, value, placeholder, onchange) {
  return h(
    'div',
    { class: 'search-box' },
    h('span', { class: 'ico', icon: 'search' }),
    h('input', { class: 'field', 'data-field': name, type: 'text', inputmode: 'search', enterkeyhint: 'search', value, placeholder, 'aria-label': placeholder.replace(/…$/, ''), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', oninput: (e) => (onchange(e.target.value), render()) }),
    value && h('button', { class: 'clear', 'aria-label': 'Clear the search', icon: 'cross', onclick: () => (onchange(''), render(true)) }),
  );
}

/** A sheet of choices with the one in force ticked. */
function choose(title, options, selected, pick) {
  sheet(title, ...options.map(([id, label]) => h('button', { class: `row-btn pick${selected === id ? ' on' : ''}`, 'aria-pressed': String(selected === id), onclick: () => (closeSheet(), pick(id), render(true)) }, label, selected === id && h('span', { class: 'tick', icon: 'check' }))));
}

const panel = (title, side, ...content) => h('section', { class: 'panel-box' }, h('div', { class: 'cap' }, h('span', {}, title), side), ...content);

// ── home: the control center ──
function controlCenter(model) {
  const { now, link, stats } = model;
  const up = link.key === 'online';
  const list = [...state.workspaces.values()];
  const pick = (title, then) => {
    if (!list.length) return toast('Open a project first.');
    if (list.length === 1) return then(list[0].meta);
    sheet(title, ...list.map((w) => h('button', { class: 'row-btn', onclick: () => (closeSheet(), then(w.meta)) }, w.meta.name)));
  };

  let activityPanel;
  if (!state.loaded) {
    activityPanel = panel('ACTIVITY', null, h('div', { class: 'skeleton-lines', 'aria-busy': 'true', 'aria-label': 'Loading' }, h('i'), h('i'), h('i')));
  } else if (!now) {
    activityPanel = panel('ACTIVITY', null, h('p', { class: 'quiet' }, list.length ? 'Nothing has run yet. Open a session and give Seeker a task.' : 'No project is open yet.'), h('button', { class: 'btn small', disabled: !up, onclick: () => (list.length ? go({ name: 'sessions' }) : addWorkspace()) }, list.length ? 'Open sessions' : 'Open a project'));
  } else {
    const { meta } = now.ws;
    const mark = now.status === 'completed' ? 'check' : now.status === 'failed' ? 'cross' : null;
    activityPanel = h(
      'button',
      { class: 'panel-box tap', onclick: () => go({ name: 'session', ws: meta.id }) },
      h('span', { class: 'cap' }, h('span', {}, now.live ? 'CURRENT ACTIVITY' : 'RECENT ACTIVITY'), pill(now.status)),
      h('span', { class: 'lead' }, h('span', { class: 'ico', icon: 'folder' }), h('span', { class: 'grow' }, h('span', { class: 'name line' }, meta.name), h('span', { class: 'meta line' }, [meta.branch, meta.provider].filter(Boolean).join(' · '))), h('span', { class: 'chev', icon: 'chevron' })),
      now.text && h('span', { class: `said ${STATUSES[now.status].tone}` }, mark ? h('span', { class: 'mark', icon: mark }) : now.live && h('i', { class: 'beat' }), h('span', { class: 'text' }, now.text)),
    );
  }

  const first = list[0]?.meta;
  const connectionPanel = h(
    'button',
    { class: 'panel-box tap', 'aria-label': `Remote connection: ${state.device?.name ?? 'your Mac'}, ${link.label}. Open device details`, onclick: () => go({ name: 'settings' }) },
    h('span', { class: 'cap' }, h('span', {}, 'REMOTE CONNECTION')),
    h(
      'span',
      { class: 'lead' },
      h('span', { class: 'ico', icon: 'laptop' }),
      h('span', { class: 'grow' }, h('span', { class: 'name line' }, h('i', { class: `state ${link.tone}` }), state.device?.name ?? 'Your Mac'), h('span', { class: 'meta line' }, [first?.provider ?? state.device?.provider, link.label, up && state.latency ? `${state.latency.ms} ms` : null].filter(Boolean).join(' · '))),
      h('span', { class: 'chev', icon: 'chevron' }),
    ),
  );

  const metric = (icon, value, label) => h('div', { class: 'stat' }, h('span', { class: 'ico', icon }), h('b', {}, value), h('span', {}, label));
  const statsPanel =
    state.loaded &&
    panel(
      'ACTIVITY',
      h('span', { class: 'when' }, 'Last 24 hours'),
      h('div', { class: 'stats' }, metric('pulse', stats.sessions, stats.sessions === 1 ? 'Session' : 'Sessions'), metric('layers', `${stats.tools}${stats.toolsMore ? '+' : ''}`, stats.tools === 1 && !stats.toolsMore ? 'Tool run' : 'Tool runs'), metric('check', stats.completed, 'Completed')),
    );

  const quick = (label, icon, action) => h('button', { onclick: action }, h('span', { icon }), h('span', { class: 'mono' }, label));
  return [
    h('div', { class: 'page-head' }, h('h1', { class: 'grow' }, 'Agent Activity Center')),
    h('p', { class: 'page-sub' }, 'Operate your remote agent and track progress.'),
    activityPanel,
    connectionPanel,
    statsPanel,
    section('QUICK COMMANDS'),
    h(
      'div',
      { class: 'commands' },
      quick('/init', 'terminal', () => pick('Set up which project?', (m) => (go({ name: 'session', ws: m.id }), sendText(m.id, INIT)))),
      quick('/model', 'cube', chooseModel),
      quick('/resume', 'play', () => (now ? go({ name: 'session', ws: now.ws.meta.id }) : go({ name: 'sessions' }))),
    ),
  ];
}

// ── home: the workspace explorer ──
function workspaceLine(row) {
  const live = STATUSES[row.status].live;
  const seen = since(row.at);
  const said = [row.terminal && 'Terminal session', !live && row.status !== 'idle' && STATUSES[row.status].label, seen ? `Last active ${seen.toLowerCase()}` : 'No activity yet'].filter(Boolean).join(' · ');
  return h(
    'button',
    { class: 'w-row', 'data-ws': row.id, onclick: () => go({ name: 'session', ws: row.id }) },
    h('span', { class: 'ico', icon: 'folder' }),
    h('span', { class: 'grow' }, h('span', { class: 'name line' }, row.name), h('span', { class: 'meta mono line' }, [row.path, row.branch].filter(Boolean).join(' · ')), h('span', { class: 'meta line' }, said)),
    live && pill(row.status),
    h('span', { class: 'chev', icon: 'chevron' }),
  );
}

function workspaceExplorer(model) {
  const ex = state.explorer;
  const { rows, local, link } = model;
  const up = link.key === 'online';
  const total = state.workspaces.size;
  const open = async (folder) => {
    state.opening = Date.now();
    if (await command('open', { path: folder })) toast(`Opening ${folder}…`);
  };
  const narrowed = ex.query || ex.source !== 'all';

  let listed;
  if (!state.loaded) listed = h('div', { class: 's-list', 'aria-busy': 'true', 'aria-label': 'Loading workspaces' }, [0, 1, 2].map(() => h('div', { class: 's-row skeleton' }, h('span', { class: 'ico' }), h('span', { class: 'grow' }, h('i'), h('i'), h('i')))));
  else if (!total) listed = h('div', { class: 'empty' }, h('b', {}, 'No workspace yet'), up ? 'Open a folder from your Mac, or create a new one.' : 'Waiting for your Mac…', h('button', { class: 'btn small', disabled: !up, onclick: addWorkspace }, 'Open a project'));
  else if (!rows.length) listed = h('div', { class: 'empty' }, h('b', {}, 'No workspace found'), h('button', { class: 'btn small', onclick: () => (Object.assign(ex, { query: '', source: 'all' }), render(true)) }, 'Clear search and filter'));
  else listed = h('div', { class: 's-list', onkeydown: rowKeys }, rows.map(workspaceLine));

  // The folders are those the Mac listed when it last answered: without the Mac they cannot be opened, and are not called empty.
  let folders;
  if (!up) folders = h('p', { class: 'quiet pad' }, state.linked ? 'Your Mac is offline, so its folders cannot be listed.' : 'Not connected yet.');
  else if (!local.total) folders = h('p', { class: 'quiet pad' }, 'Every project folder found in your home folder is already open. Use + to open another by its path.');
  else
    folders = h(
      'div',
      { class: 's-list local' },
      h('button', { class: 'fold', 'aria-expanded': String(ex.local), onclick: () => ((ex.local = !ex.local), ex.local || (ex.localQuery = ''), render(true)) }, h('span', { class: 'ico', icon: 'laptop' }), h('span', { class: 'grow' }, `${local.total} local project${local.total === 1 ? '' : 's'}`), h('span', { class: `chev${ex.local ? ' up' : ''}`, icon: 'down' })),
      ex.local && local.total > 6 && searchBox('local', ex.localQuery, 'Search local projects…', (v) => (ex.localQuery = v)),
      ex.local && (local.rows.length ? local.rows.map((f) => h('div', { class: 'f-row' }, h('span', { class: 'grow' }, h('span', { class: 'name line' }, f.name), h('span', { class: 'meta mono line' }, f.path)), h('button', { class: 'add', 'aria-label': `Open ${f.path} as a workspace`, icon: 'plus', onclick: () => open(f.path) }))) : h('p', { class: 'quiet pad' }, 'No folder matches.')),
    );

  return [
    h('div', { class: 'page-head' }, h('h1', { class: 'grow' }, 'Workspace Explorer')),
    h('p', { class: 'page-sub' }, 'Browse and manage your agent workspaces.'),
    h(
      'div',
      { class: 'toolbar' },
      searchBox('workspaces', ex.query, 'Search workspaces…', (v) => (ex.query = v)),
      h('button', { class: `icon-btn${ex.sort !== 'recent' ? ' on' : ''}`, 'aria-label': `Sort workspaces — ${WORKSPACE_SORTS.find(([id]) => id === ex.sort)?.[1] ?? ''}`, icon: 'sort', onclick: () => choose('Sort workspaces', WORKSPACE_SORTS, ex.sort, (id) => store('seeker.workspaces.sort', (ex.sort = id))) }),
      h('button', { class: `icon-btn${ex.source !== 'all' ? ' on' : ''}`, 'aria-label': `Filter workspaces — ${SOURCES.find(([id]) => id === ex.source)?.[1] ?? ''}`, icon: 'funnel', onclick: () => choose('Show', SOURCES, ex.source, (id) => (ex.source = id)) }),
      h('button', { class: 'icon-btn primary', 'aria-label': 'Open or create a project', icon: 'plus', disabled: !up, onclick: addWorkspace }),
    ),
    section(narrowed && total ? `WORKSPACES · ${rows.length} OF ${total}` : 'WORKSPACES'),
    listed,
    section('ON YOUR MAC'),
    folders,
  ];
}

/** What Home shows now, and a signature of it: the screen is redrawn only when that changes. */
function homeNow() {
  const list = [...state.workspaces.values()];
  const link = connection(state);
  const base = [state.homeTab, state.loaded, link.key, state.device?.name, state.device?.settings?.animation];
  if (state.homeTab === 'projects') {
    const rows = explorerRows(list, state.explorer);
    const local = localFolders(state.folders, list, state.explorer.localQuery);
    return { link, rows, local, signature: JSON.stringify([base, state.explorer, list.length, rows.map((r) => [r, since(r.at)]), local]) };
  }
  const front = current(list);
  const now = front && { ...front, status: statusOf(front.ws), text: summary(front.ws) };
  const stats = activity(list);
  const meta = now?.ws.meta;
  return { link, now, stats, signature: JSON.stringify([base, state.latency?.ms, list.length, list[0]?.meta.provider, state.device?.provider, now && [meta.id, meta.name, meta.branch, meta.provider, now.live, now.status, now.text], stats]) };
}

function home(model) {
  const tab = (id, label) => h('button', { class: state.homeTab === id ? 'active' : '', role: 'tab', 'aria-selected': String(state.homeTab === id), onclick: () => ((state.homeTab = id), render(true)) }, label);
  return [header(), h('div', { class: 'tabs', role: 'tablist' }, tab('control', 'CONTROL CENTER'), tab('projects', 'PROJECTS')), state.homeTab === 'projects' ? workspaceExplorer(model) : controlCenter(model)];
}

function sendText(wsId, text, images = []) {
  // What was just sent is what the reader wants to follow: back to the bottom, so the reply stays in view.
  const view = $('view');
  view.scrollTop = view.scrollHeight;
  return command('message', images.length ? { ws: wsId, text, images } : { ws: wsId, text });
}

// ── images ─────────────────────────────────────────────────────────────────
// A picture is made small enough to travel before it is encrypted and sent: the
// relay takes 4 MB per message, and encryption plus base64 nearly doubles the size.
const MAX_ATTACHMENTS = 4;
const IMAGE_CHARS = 500_000; // base64 characters per picture, about 375 KB
const KEEP_AS_IS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
let attachments = []; // { name, data, thumb } waiting to go with the next message

const readDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const loadPicture = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('not an image this browser can open'));
    img.src = url;
  });

/** The picture redrawn so its longer side is at most `side`, as base64 JPEG. */
function shrink(img, side, quality) {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}

async function prepare(file) {
  const url = await readDataUrl(file);
  const img = await loadPicture(url);
  const original = url.split(',')[1];
  let data = KEEP_AS_IS.includes(file.type) && original.length <= IMAGE_CHARS ? original : null;
  // 1568 px is as much as vision models look at; smaller and rougher only if that is still too big.
  for (const [side, quality] of [[1568, 0.82], [1568, 0.6], [1024, 0.6], [768, 0.5]]) {
    if (data) break;
    const made = shrink(img, side, quality);
    if (made.length <= IMAGE_CHARS) data = made;
  }
  if (!data) throw new Error('too large even when made smaller');
  return { name: file.name || 'image', data, thumb: shrink(img, 240, 0.6) };
}

async function addImages(files) {
  const ws = state.workspaces.get(state.view.ws);
  if (ws && ws.meta.vision === false) return toast(`${ws.meta.model} cannot see images. Change the model first.`);
  for (const file of files) {
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast(`At most ${MAX_ATTACHMENTS} images per message.`);
      break;
    }
    try {
      attachments.push(await prepare(file));
    } catch (err) {
      toast(`${file.name || 'That file'}: ${err.message}.`);
    }
    showAttachments();
  }
}

function showAttachments() {
  composerState();
  const strip = $('attachments');
  strip.hidden = attachments.length === 0;
  strip.replaceChildren(
    ...attachments.map((a) =>
      h(
        'div',
        { class: 'shot' },
        h('img', { src: `data:image/jpeg;base64,${a.thumb}`, alt: a.name }),
        h('button', { type: 'button', 'aria-label': `Remove ${a.name}`, onclick: () => ((attachments = attachments.filter((x) => x !== a)), showAttachments()) }, '×'),
      ),
    ),
  );
}

// ── session: the live view of one agent ────────────────────────────────────
/** One file's change: removed and added lines with their line numbers, side by side when there is room. */
function diffView(diff, file) {
  if (!diff || (!diff.removed?.length && !diff.added?.length)) return null;
  const start = Number.isInteger(diff.line) ? diff.line : null;
  const counts = diff.counts ?? { added: diff.added?.length ?? 0, removed: diff.removed?.length ?? 0 };
  const side = (lines, kind) =>
    h(
      'div',
      { class: `side ${kind}` },
      lines.map((l, i) => h('div', { class: `ln ${kind}` }, h('span', { class: 'no' }, start == null ? '' : start + i), h('span', { class: 'sign' }, kind === 'del' ? '−' : '+'), h('span', { class: 'src' }, code(l)))),
    );
  return h(
    'div',
    { class: 'diff' },
    h('div', { class: 'file' }, h('span', { class: 'mono line grow' }, file), h('span', { class: 'success' }, `+${counts.added}`), h('span', { class: 'danger' }, `−${counts.removed}`)),
    h('div', { class: `sides${diff.removed?.length && diff.added?.length ? ' both' : ''}` }, diff.removed?.length ? side(diff.removed, 'del') : null, diff.added?.length ? side(diff.added, 'add') : null),
    // What the lines above do not show by themselves is said in words.
    Number.isInteger(diff.overwrites) ? h('div', { class: 'more warning' }, `⚠ Replaces the whole file: its ${diff.overwrites} existing line${diff.overwrites === 1 ? '' : 's'} are removed.`) : null,
    diff.times > 1 ? h('div', { class: 'more warning' }, `⚠ Applied in ${diff.times} places: every occurrence in the file is changed.`) : null,
    diff.more ? h('div', { class: 'more' }, `… ${diff.more} more line${diff.more > 1 ? 's' : ''} not shown`) : null,
  );
}

function expandable(item, summary, ...body) {
  const el = h('details', { class: 'more-box', open: state.open.has(item.id) }, h('summary', {}, summary), ...body);
  el.addEventListener('toggle', () => (el.open ? state.open.add(item.id) : state.open.delete(item.id)));
  return el;
}

function entry(item) {
  const el = entryOf(item);
  if (el && !state.drawn.has(item.id)) {
    state.drawn.add(item.id);
    el.classList.add('fresh');
  }
  return el;
}

/** Three dots that light up one after another while a tool runs. */
const runningDots = () => h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i', {}, '.'), h('i', {}, '.'), h('i', {}, '.'));

function entryOf(item) {
  // The time sits beside the entry's label, so what follows uses the full width of the screen.
  const time = h('time', { class: 'at' }, clock(item.at));
  if (item.kind === 'tool') {
    const mark = item.state === 'done' ? 'done' : item.state === 'failed' ? 'failed' : 'running';
    const verb = item.state === 'done' ? item.done : item.doing;
    const hasMore = item.output?.length || item.diff;
    const head = [h('div', { class: 'headline' }, h('span', { class: 'title' }, verb, item.state === 'running' && runningDots()), time), item.summary && h('span', { class: 'sub mono' }, item.summary), item.note && h('span', { class: `sub ${item.state === 'failed' ? 'danger' : ''}` }, item.note), item.state === 'running' && h('span', { class: 'runbar' })];
    return h(
      'li',
      { class: `ev tool ${mark}` },
      h('span', { class: 'node', icon: mark === 'done' ? 'check' : mark === 'failed' ? 'cross' : 'play' }),
      h('div', { class: 'body' }, hasMore ? expandable(item, head, item.diff && diffView(item.diff, item.summary), item.output?.length ? h('pre', { class: 'out' }, item.output.join('\n')) : null) : head),
    );
  }
  if (item.kind === 'user') {
    // A preview is shown only as an image of a type the Mac recognised; anything else is just named.
    const shots = (item.images ?? []).map((i) => (i.thumb && /^image\/(png|jpeg|gif|webp)$/.test(i.mime) ? h('img', { src: `data:${i.mime};base64,${i.thumb}`, alt: i.name }) : h('span', { class: 'file' }, i.name)));
    return h('li', { class: 'ev user' }, h('span', { class: 'node' }), h('div', { class: 'body' }, h('div', { class: 'headline' }, h('span', { class: 'who' }, 'YOU'), item.via && h('span', { class: 'tag primary' }, item.via === 'steer' ? 'STEERED' : 'QUEUED'), time), h('div', { class: 'said' }, item.text), shots.length ? h('div', { class: 'shots' }, shots) : null));
  }
  if (item.kind === 'assistant') {
    if (!item.text) return null;
    return h('li', { class: 'ev assistant' }, h('span', { class: 'node' }), h('div', { class: 'body' }, h('div', { class: 'headline' }, h('span', { class: 'who' }, 'SEEKER'), time), h('div', { class: 'prose' }, prose(item.text))));
  }
  return h('li', { class: `ev notice ${item.level}` }, h('span', { class: 'node' }), h('div', { class: 'body' }, h('span', { class: 'sub' }, item.text, ' ', time)));
}

/** `items` in the order they happened; `tail` is one more entry to close the list with. */
function timeline(ws, items = ws.items, tail = null) {
  const shown = state.shown.get(ws.meta.id) ?? PAGE;
  const visible = items.slice(-shown);
  return [
    items.length > visible.length && h('button', { class: 'btn quiet small', onclick: () => (state.shown.set(ws.meta.id, shown + PAGE), render(true)) }, `Show ${Math.min(PAGE, items.length - visible.length)} earlier entries`),
    h('ol', { class: 'timeline' }, visible.map(entry), tail),
  ];
}

/** Says no to a request without opening it. Saying yes is only offered on the review screen, where the whole request is shown. */
async function rejectFromTimeline(pending) {
  if (state.deciding.has(pending.id)) return;
  state.deciding.add(pending.id);
  render(true);
  if (!(await command('approve', { id_approval: pending.id, decision: 'deny', note: '' }))) {
    state.deciding.delete(pending.id);
    render(true);
  }
}

/** The step that is waiting for the user, at the end of the timeline. It opens the review screen, where the whole request is shown. */
function waitingEntry(pending) {
  const question = pending.kind === 'question';
  const what = question ? pending.title : `${pending.doing} ${pending.summary}`;
  return h(
    'li',
    { class: 'ev pending' },
    h('span', { class: 'node', icon: 'shield' }),
    h(
      'div',
      { class: 'body' },
      h('div', { class: 'headline' }, h('span', { class: 'title' }, question ? 'Waiting for your answer' : 'Pending approval'), h('time', { class: 'at' }, clock(pending.at))),
      h('span', { class: 'sub mono' }, what.length > 200 ? `${what.slice(0, 200)}…` : what),
      h(
        'div',
        { class: 'pair' },
        h('button', { class: 'btn small approve', onclick: () => go({ name: 'review', id: pending.id, from: state.view }) }, h('span', { icon: question ? 'chevron' : 'check' }), question ? 'Answer' : 'Review'),
        !question && h('button', { class: 'btn small reject', disabled: state.deciding.has(pending.id), onclick: () => rejectFromTimeline(pending) }, h('span', { icon: 'cross' }), 'Reject'),
      ),
    ),
  );
}

/** The banner that says what the agent is doing. Progress is never a percentage: the Mac cannot know one. */
/** The step the agent is on right now, when no tool entry shows it: the model thinking, or writing its answer. */
function workingEntry(meta) {
  const st = agentState(meta);
  if (st.key !== 'thinking' && st.key !== 'responding') return null;
  const thinking = st.key === 'thinking';
  const what = thinking ? (meta.activity && meta.activity !== 'Thinking' ? `${meta.activity}…` : 'The model is working on its next step…') : 'Writing the answer…';
  return h('li', { class: `ev now-step ${st.tone}` }, h('span', { class: 'node', icon: thinking ? 'brain' : 'bolt' }), h('div', { class: 'body' }, h('div', { class: 'headline' }, h('span', { class: 'title' }, thinking ? 'Reasoning' : 'Responding', runningDots())), h('span', { class: 'sub' }, what)));
}

/** What waits for the task in progress to end, at the foot of the timeline. */
function queuedEntry(queue) {
  if (!queue?.items.length) return null;
  const [first] = queue.items;
  return h(
    'li',
    { class: 'ev queued' },
    h('span', { class: 'node', icon: 'layers' }),
    h('div', { class: 'body' }, h('div', { class: 'headline' }, h('span', { class: 'title' }, `Queued next (${queue.items.length})`, queue.paused && ' · paused'), h('time', { class: 'at' }, clock(first.at))), h('span', { class: 'sub' }, first.text.length > 200 ? `${first.text.slice(0, 200)}…` : first.text)),
  );
}

/** The session's state in a word, for the chip under the title. */
const STATE_WORD = { thinking: 'Thinking', executing: 'Running', responding: 'Responding', approval: 'Awaiting approval', completed: 'Completed', failed: 'Failed', stopped: 'Stopped', idle: 'Idle' };

function metrics(meta) {
  const pct = meta.limit ? Math.min(100, Math.round((meta.used / meta.limit) * 100)) : null;
  const t = meta.tools;
  const tokens = meta.tokens;
  const card = (icon, label, big, small, extra) => h('div', { class: 'metric' }, h('div', { class: 'head' }, h('span', { icon }), label), h('div', { class: 'big' }, big), h('div', { class: 'small' }, small), extra);
  return h(
    'div',
    { class: 'metrics' },
    card('layers', 'CONTEXT', pct == null ? '—' : `${pct}%`, `${kilo(meta.used)} / ${sizeOf(meta.limit)}`, h('div', { class: 'track' }, h('div', { class: `fill${pct > 80 ? ' warning' : ''}`, style: `width:${pct ?? 0}%` }))),
    // Counted by the provider. Before its first report there is nothing true to show.
    card('cube', 'TOKENS', tokens ? kilo(tokens.totalInput + tokens.totalOutput) : '—', tokens ? `${kilo(tokens.totalInput)} in · ${kilo(tokens.totalOutput)} out` : 'not reported yet'),
    card('bolt', 'TOOLS', t ? String(t.total) : '—', !t ? 'not reported' : t.running ? 'one running' : t.failed ? `${t.failed} failed` : t.total ? 'all succeeded' : 'none yet'),
  );
}

function session(ws) {
  if (!ws) return [h('div', { class: 'topbar' }, h('button', { class: 'back', 'aria-label': 'Back', icon: 'back', onclick: () => go({ name: 'home' }) }), h('div', { class: 'name' }, 'Closed')), h('div', { class: 'empty' }, 'This project is no longer open.')];
  const { meta, items } = ws;
  const pending = state.approvals.find((a) => a.ws === meta.id);
  const st = agentState(meta);
  const menu = () =>
    sheet(
      meta.name,
      h('button', { class: 'row-btn', onclick: () => (closeSheet(), sendText(meta.id, INIT)) }, '/init — write SEEKER.md for this project'),
      // A conversation typed in a terminal is started, ended and given its model there.
      meta.terminal && h('div', { class: 'muted small pad' }, 'This conversation runs in a terminal on your Mac. A new conversation, another model, or closing it are done there.'),
      !meta.terminal && h('button', { class: 'row-btn', onclick: chooseModel }, '/model — switch the model'),
      !meta.terminal && h('button', { class: 'row-btn', onclick: () => (closeSheet(), newConversation(meta)) }, '/new — start a new conversation'),
      !meta.terminal && h('button', { class: 'row-btn danger', onclick: () => (closeSheet(), confirm(`Close ${meta.name}? Its conversation is saved on your Mac.`) && (command('close', { ws: meta.id }), go({ name: 'home' }))) }, 'Close this project'),
    );
  const up = state.linked && state.online;
  const tab = state.sessionTab;
  const tabButton = (id, label) => h('button', { class: tab === id ? 'active' : '', role: 'tab', 'aria-selected': String(tab === id), onclick: () => ((state.sessionTab = id), render(true)) }, label);
  const tools = items.filter((i) => i.kind === 'tool');
  const body =
    tab === 'tools'
      ? tools.length
        ? timeline(ws, tools)
        : [h('div', { class: 'empty' }, 'No tool has run in this conversation yet.')]
      : tab === 'metrics'
        ? [
            metrics(meta),
            section('RUNNING ON'),
            h(
              'div',
              { class: 'group' },
              row('laptop', state.device?.name ?? 'Your Mac', up ? 'Connected' : 'Offline', { tone: up ? 'success' : 'danger' }),
              meta.terminal
                ? h('div', { class: 'row' }, h('span', { class: 'ico', icon: 'cube' }), h('span', { class: 'grow' }, h('span', { class: 'label mono line' }, meta.model, h('span', { class: 'muted' }, ' • ', meta.provider))))
                : h('button', { class: 'row', 'aria-label': 'Change model', onclick: chooseModel }, h('span', { class: 'ico', icon: 'cube' }), h('span', { class: 'grow' }, h('span', { class: 'label mono line' }, meta.model, h('span', { class: 'muted' }, ' • ', meta.provider))), h('span', { class: 'chev', icon: 'down' })),
            ),
          ]
        : items.length || pending || st.busy || ws.queue?.items.length
          ? timeline(ws, items, [pending ? waitingEntry(pending) : workingEntry(meta), queuedEntry(ws.queue)])
          : [h('div', { class: 'empty' }, 'Nothing has happened in this conversation yet.')];
  return [
    h('div', { class: 'topbar' }, h('button', { class: 'back', 'aria-label': 'Back', icon: 'back', onclick: () => go({ name: 'home' }) }), h('div', { class: 'grow' }, h('div', { class: 'name line' }, meta.name), h('div', { class: 'sub mono line' }, meta.terminal ? 'terminal • ' : '', meta.branch || 'no git', ' • ', meta.model)), h('button', { class: 'more', 'aria-label': 'More', onclick: menu }, '•••')),
    // What the agent is doing on the left; how full its context is on the right.
    h(
      'div',
      { class: 'session-bar' },
      up ? h('span', { class: `state-chip ${st.tone}${st.busy ? ' busy' : ''}` }, h('i'), STATE_WORD[st.key]) : h('span', { class: 'state-chip danger' }, h('i'), 'Offline'),
      h('span', {}, `${kilo(meta.used)} / ${sizeOf(meta.limit)} tokens`),
    ),
    h('div', { class: 'tabs seg', role: 'tablist' }, tabButton('activity', 'Activity'), tabButton('tools', tools.length ? `Tools · ${tools.length}` : 'Tools'), tabButton('metrics', 'Metrics')),
    ...body,
  ];
}

function newConversation(meta) {
  if (confirm(`Start a new conversation in ${meta.name}? The current one is saved on your Mac.`)) command('new', { ws: meta.id });
}

/** The buttons above the message box. Only what can be done in the session's current state is offered. */
function controls(ws) {
  const { meta } = ws;
  const st = agentState(meta);
  const pending = state.approvals.filter((a) => a.ws === meta.id);
  const up = state.linked && state.online;
  const lastAsked = [...ws.items].reverse().find((i) => i.kind === 'user')?.text;
  return [
    pending.length > 0 && h('button', { class: 'ctl approve', type: 'button', onclick: () => go({ name: 'review', id: pending[0].id, from: state.view }) }, h('span', { icon: 'check' }), pending[0].kind === 'question' ? 'Answer' : `Review${pending.length > 1 ? ` (${pending.length})` : ''}`),
    // After a stop the agent's own history says where it was; "continue" is what it is told to expect.
    st.key === 'stopped' && h('button', { class: 'ctl resume', type: 'button', disabled: !up, onclick: () => sendText(meta.id, 'continue') }, h('span', { icon: 'play' }), ws.queue?.paused ? 'Continue task' : 'Resume'),
    st.key === 'failed' && lastAsked && h('button', { class: 'ctl resume', type: 'button', disabled: !up, onclick: () => sendText(meta.id, lastAsked) }, h('span', { icon: 'play' }), 'Retry'),
  ].filter(Boolean);
}

// ── approvals ──────────────────────────────────────────────────────────────
const KIND = { exec: 'COMMAND', write: 'FILE CHANGE', net: 'NETWORK', other: 'TOOL', question: 'QUESTION' };
const diffCounts = (diff) => diff?.counts ?? (diff ? { added: diff.added?.length ?? 0, removed: diff.removed?.length ?? 0 } : null);
const plusMinus = (counts) => [h('span', { class: 'success' }, `+${counts.added}`), ' ', h('span', { class: 'danger' }, `−${counts.removed}`)];

function approvalCard(a) {
  const counts = diffCounts(a.diff);
  return h(
    'button',
    { class: 'card approval', onclick: () => go({ name: 'review', id: a.id, from: { name: 'approvals' } }) },
    h(
      'span',
      { class: 'grow' },
      h('span', { class: 'meta' }, h('span', { class: 'tag primary' }, KIND[a.kind] ?? 'TOOL'), a.warning && h('span', { class: 'tag danger' }, 'DANGEROUS'), h('span', { class: 'sub grow line' }, a.wsName), h('time', { class: 'sub' }, ago(a.at))),
      h('span', { class: 'title line' }, a.title),
      h('span', { class: 'sub mono line' }, a.kind === 'question' ? `${a.options?.length ?? 0} suggested answers` : `${a.doing} ${a.summary}`),
      counts && h('span', { class: 'sub' }, '1 file · ', plusMinus(counts)),
    ),
    h('span', { class: 'chev', icon: 'chevron' }),
  );
}

function approvals() {
  return [
    header(),
    section('APPROVALS', state.approvals.length > 0 && h('span', { class: 'count' }, state.approvals.length)),
    state.approvals.length ? state.approvals.map(approvalCard) : h('div', { class: 'empty' }, h('span', { class: 'ico big', icon: 'shield' }), 'Nothing is waiting for you.', h('span', { class: 'sub' }, 'Every command and every file change an agent wants to make shows up here first.')),
  ];
}

function review(approval) {
  const back = () => go(state.view.from ?? { name: 'approvals' });
  const top = (title) => h('div', { class: 'topbar' }, h('button', { class: 'back', 'aria-label': 'Back', icon: 'back', onclick: back }), h('div', { class: 'grow' }, h('div', { class: 'name accent' }, title), approval && h('div', { class: 'sub line' }, approval.wsName, ' • ', ago(approval.at))));
  if (!approval) return [top('APPROVAL'), h('div', { class: 'empty' }, 'This request has already been answered.')];
  const busy = state.deciding.has(approval.id);
  // The answer counts once the Mac says so (it then removes the request); until then the buttons stay locked.
  const send = async (type, fields) => {
    if (state.deciding.has(approval.id)) return;
    state.deciding.add(approval.id);
    render(true);
    if (!(await command(type, { id_approval: approval.id, ...fields }))) {
      state.deciding.delete(approval.id);
      render(true);
    }
  };

  if (approval.kind === 'question') {
    const reply = h('input', { class: 'field', placeholder: approval.options.length ? 'Or type your own answer…' : 'Type your answer…', disabled: busy });
    const answer = (text) => (text.trim() ? send('answer', { answer: text.trim() }) : toast('Type an answer first.'));
    return [
      top('QUESTION'),
      h('h2', { class: 'ask' }, approval.title),
      h('p', { class: 'muted' }, 'Seeker is waiting for your answer before it goes on.'),
      ...approval.options.map((option, i) => h('button', { class: i === 0 ? 'btn primary' : 'btn', disabled: busy, onclick: () => answer(option) }, option)),
      h('form', { onsubmit: (e) => (e.preventDefault(), answer(reply.value)) }, reply, h('button', { class: 'btn quiet', type: 'submit', disabled: busy }, busy ? 'Sending…' : 'Send answer')),
    ];
  }

  const note = h('input', { class: 'field', placeholder: 'Or tell Seeker what to do instead…', disabled: busy });
  const isCommand = approval.kind === 'exec';
  const isWrite = approval.kind === 'write';
  const counts = diffCounts(approval.diff);
  const what = { exec: 'run this command on your Mac', write: 'change this file', net: 'open this address', other: 'use this tool' }[approval.kind];
  const always = approval.always ? approval.always[0].toUpperCase() + approval.always.slice(1) : null;
  return [
    top('APPROVAL'),
    h('h2', { class: 'ask' }, isWrite ? 'Apply this change to 1 file?' : approval.title),
    h('p', { class: 'muted' }, `Seeker proposes to ${what}.`, counts && h('span', {}, ' 1 file · ', plusMinus(counts))),
    approval.warning && h('div', { class: 'banner danger' }, '⚠ ', approval.warning),
    isWrite ? (diffView(approval.diff, approval.summary) ?? h('div', { class: 'box' }, h('div', { class: 'cmd plain' }, `${approval.doing} ${approval.summary}`))) : h('div', { class: 'box' }, h('div', { class: `cmd${isCommand ? '' : ' plain'}` }, isCommand ? approval.summary : `${approval.doing} ${approval.summary}`)),
    h('div', { class: 'group' }, row('folder', 'Working directory', null, { sub: h('span', { class: 'mono' }, approval.cwd) })),
    h('div', { class: 'actions' }, h('button', { class: 'btn reject', disabled: busy, onclick: () => send('approve', { decision: 'deny', note: note.value }) }, h('span', { icon: 'cross' }), 'Reject'), h('button', { class: 'btn approve', disabled: busy, onclick: () => send('approve', { decision: 'allow' }) }, h('span', { icon: 'check' }), busy ? 'Sending…' : isWrite ? 'Approve change' : 'Approve')),
    always && h('button', { class: 'btn quiet', disabled: busy, onclick: () => confirm(`${always}? Seeker will stop asking for this.`) && send('approve', { decision: 'always' }) }, always),
    note,
    h('p', { class: 'muted small' }, 'Each command and each file change is approved on its own. Nothing runs until your Mac has your answer.'),
  ];
}

// ── sessions ───────────────────────────────────────────────────────────────
// One session per open project. The rows, the counts on the filters and the order all come from
// sessions.js, which reads only what the Mac reported.
const pill = (key) => h('span', { class: `pill ${STATUSES[key].tone}` }, h('i', { class: STATUSES[key].live ? 'live' : '' }), STATUSES[key].label);
const clearList = () => Object.assign(state.list, { query: '', filter: 'all', searching: false });

function chooseSort() {
  const pick = (id) => {
    store('seeker.sessions.sort', (state.list.sort = id));
    closeSheet();
    render(true);
  };
  sheet('Sort sessions', ...SORTS.map(([id, label]) => h('button', { class: `row-btn pick${state.list.sort === id ? ' on' : ''}`, 'aria-pressed': String(state.list.sort === id), onclick: () => pick(id) }, label, state.list.sort === id && h('span', { class: 'tick', icon: 'check' }))));
}

/** Arrow keys move between rows; Tab and Enter work as on any button. */
function rowKeys(event) {
  const step = event.key === 'ArrowDown' ? 'nextElementSibling' : event.key === 'ArrowUp' ? 'previousElementSibling' : null;
  const next = step && event.target.closest('.s-row')?.[step];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

function sessionRow(row) {
  const when = since(row.at);
  return h(
    'button',
    { class: `s-row${row.id === state.lastSession ? ' selected' : ''}`, 'data-ws': row.id, 'aria-current': row.id === state.lastSession ? 'true' : null, onclick: () => go({ name: 'session', ws: row.id }) },
    h('span', { class: 'ico', icon: 'folder' }),
    h(
      'span',
      { class: 'grow' },
      h('span', { class: 'top' }, h('span', { class: 'name line' }, row.name), pill(row.status)),
      h('span', { class: `task line${row.task ? '' : ' none'}` }, row.task ? `› ${row.task}` : 'No messages yet'),
      h('span', { class: 'meta mono line' }, [row.model, row.tools != null && `${row.tools} tool run${row.tools === 1 ? '' : 's'}`].filter(Boolean).join(' · '), when && h('time', { datetime: new Date(row.at).toISOString(), title: new Date(row.at).toLocaleString() }, (row.model || row.tools != null ? ' · ' : '') + when)),
    ),
    h('span', { class: 'chev', icon: 'chevron' }),
  );
}

/** What the Sessions screen shows now, and a signature of it: the screen is redrawn only when that changes. */
function sessionsNow() {
  const model = sessionsView([...state.workspaces.values()], state.list);
  const labels = model.rows.map((r) => [r.id, r.name, r.status, r.task, r.model, r.tools, since(r.at)]);
  const signature = JSON.stringify([state.linked, state.online, state.loaded, state.device?.name, state.device?.settings?.animation, state.list, state.lastSession, model.count, labels]);
  return { ...model, signature };
}

/** Drawn at once, inside the tap, so the phone brings its keyboard up for the field. */
function toggleSearch() {
  const { list } = state;
  list.searching = !list.searching;
  if (!list.searching) list.query = '';
  draw();
  if (list.searching) $('view').querySelector('.field.search')?.focus();
}

function sessions({ rows, count, total }) {
  const { list } = state;
  const up = state.linked && state.online;
  const head = h(
    'div',
    { class: 'page-head' },
    h('h1', { class: 'grow' }, 'Sessions'),
    h('button', { class: `icon-btn${list.searching ? ' on' : ''}`, 'aria-label': 'Search sessions', 'aria-expanded': String(list.searching), icon: 'search', onclick: toggleSearch }),
    h('button', { class: `icon-btn${list.sort !== 'recent' ? ' on' : ''}`, 'aria-label': `Sort sessions — ${SORTS.find(([id]) => id === list.sort)?.[1] ?? ''}`, icon: 'sliders', onclick: chooseSort }),
  );
  const search = list.searching && h('input', { class: 'field search', 'data-field': 'sessions', type: 'search', value: list.query, placeholder: 'Project, instruction or model…', 'aria-label': 'Search sessions', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search', oninput: (e) => ((list.query = e.target.value), render()) });

  let body;
  if (!state.loaded) {
    // Nothing has arrived from the Mac yet: say so with the shape of the list, never with an empty one.
    body = [
      h('div', { class: 's-list', 'aria-busy': 'true', 'aria-label': 'Loading sessions' }, [0, 1, 2].map(() => h('div', { class: 's-row skeleton' }, h('span', { class: 'ico' }), h('span', { class: 'grow' }, h('i'), h('i'), h('i'))))),
      !state.linked && h('button', { class: 'btn', onclick: reconnect }, 'Retry'),
    ];
  } else if (!total) {
    body = h('div', { class: 'empty' }, h('b', {}, 'No sessions yet'), 'Start a task in a workspace to create your first session.', h('button', { class: 'btn small', disabled: !up, onclick: addWorkspace }, 'Open a project'));
  } else {
    const chips = h(
      'div',
      { class: 'filters', role: 'group', 'aria-label': 'Filter by status' },
      filters(count, list.filter).map(([key, label, n]) => h('button', { class: list.filter === key ? 'on' : '', 'aria-pressed': String(list.filter === key), onclick: () => ((list.filter = key), render(true)) }, label, h('span', { class: 'n' }, n))),
    );
    body = [
      chips,
      !up && h('p', { class: 'stale', role: 'status' }, 'Not connected: these statuses may be out of date.'),
      rows.length
        ? h('div', { class: 's-list', onkeydown: rowKeys }, rows.map(sessionRow))
        : h('div', { class: 'empty' }, h('b', {}, 'No sessions found'), h('button', { class: 'btn small', onclick: () => (clearList(), render(true)) }, 'Clear filters')),
    ];
  }
  return [header(), head, h('p', { class: 'page-sub' }, 'Kelola dan lanjutkan session pekerjaan Seeker.'), search, body];
}

// ── settings ───────────────────────────────────────────────────────────────
function settings() {
  const up = state.linked && state.online;
  const first = [...state.workspaces.values()][0]?.meta;
  const prefs = pushPrefs();
  const toggle = (on, action, label, disabled = false) => h('button', { class: `switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': label, disabled, onclick: action }, h('i'));
  const check = (kind, label, icon) =>
    h('label', { class: 'row check' }, h('span', { class: 'ico', icon }), h('span', { class: 'grow' }, h('span', { class: 'label' }, label)), h('input', { type: 'checkbox', checked: prefs[kind], disabled: state.push !== 'on' || !up, onchange: (e) => setPushPref(kind, e.target.checked) }));
  const pushNote = {
    unsupported: 'Not available in this browser. On iPhone: Share → Add to Home Screen, then open SEEKER from the home screen.',
    denied: 'Blocked for this site. Allow notifications for SEEKER in your phone’s settings, then reopen the app.',
    off: 'Off. Turn on to hear about approvals and finished tasks while the app is closed.',
    on: 'Sent from your Mac straight to this phone, encrypted for it.',
    unknown: 'Checking…',
  }[state.push];
  return [
    header(),
    section('DEVICE'),
    h(
      'div',
      { class: 'group' },
      row('laptop', state.device?.name ?? 'Your Mac', up ? 'Connected' : 'Offline', { tone: up ? 'success' : 'danger', sub: first ? `${first.provider}${first.local ? ' · runs on the Mac' : ' · cloud'}` : null }),
      row('cloud', 'Relay', state.linked ? 'Connected' : 'Reconnecting…', { tone: state.linked ? 'success' : 'warning', sub: location.host }),
      row('timer', 'Round trip to the Mac', state.latency ? `${state.latency.ms} ms` : '—', { sub: state.latency ? `measured ${ago(state.latency.at)} · tap to measure again` : up ? 'measuring…' : 'needs the Mac online', onclick: up ? () => (ping(), toast('Measuring…')) : null }),
      row('clock', 'Last heard from the Mac', ago(state.lastEntryAt)),
    ),
    section('MODEL'),
    h('div', { class: 'group' }, row('cube', first?.model ?? state.device?.model ?? '—', null, { sub: first ? `${first.provider} · ${sizeOf(first.limit)} context${first.vision === false ? ' · no images' : first.vision ? ' · sees images' : ''}` : (state.device?.provider ?? 'No project open'), onclick: up ? chooseModel : null })),
    ...agentSettings(up, toggle),
    section('NOTIFICATIONS'),
    h(
      'div',
      { class: 'group' },
      h('div', { class: 'row' }, h('span', { class: 'ico', icon: 'bell' }), h('span', { class: 'grow' }, h('span', { class: 'label' }, state.push === 'on' ? 'On for this phone' : 'Notifications'), h('span', { class: 'sub' }, pushNote)), toggle(state.push === 'on', state.push === 'on' ? disablePush : enablePush, 'Notifications for this phone', ['unsupported', 'denied', 'unknown'].includes(state.push))),
      check('done', 'Task completions', 'done'),
      check('approval', 'Approval requests and questions', 'help'),
      check('error', 'Errors', 'alert'),
      state.push === 'on' && row('plane', 'Send a test notification', null, { onclick: () => command('push_test') }),
    ),
    section('PRIVACY & SECURITY'),
    h(
      'div',
      { class: 'group' },
      row('lock', 'End-to-end encryption', 'On', { tone: 'success', sub: 'AES-256-GCM between this phone and your Mac' }),
      row('eyeoff', 'Relay', 'Cannot read', { tone: 'success', sub: 'It holds only a hash of the access token' }),
      row('phone', 'This phone', 'Paired', { tone: 'success', sub: 'The pairing secret is stored on this device only' }),
    ),
    section('DIAGNOSTICS'),
    h(
      'div',
      { class: 'group' },
      row('pulse', 'Transport', state.linked ? 'Event stream open' : 'Closed, retrying', { tone: state.linked ? '' : 'warning' }),
      row('gauge', 'Context limit', first ? sizeOf(first.limit) : '—'),
      row('tag', 'Agent version', state.device?.version ? `v${state.device.version}` : '—'),
      row('folder', 'Open projects', String(state.workspaces.size)),
    ),
    h('div', { class: 'actions even' }, h('button', { class: 'btn quiet', disabled: !up, onclick: () => command('sync').then((ok) => ok && toast('Asked your Mac for a fresh copy.')) }, 'Refresh from the Mac'), h('button', { class: 'btn quiet', onclick: reconnect }, 'Reconnect')),
    h('button', { class: 'btn quiet danger unpair', onclick: () => confirm('Remove the pairing from this phone?') && signOut() }, 'Unpair this phone'),
  ];
}

/** Everything `/config` holds in the terminal. Absent when the Mac runs a SEEKER from before this screen. */
function agentSettings(up, toggle) {
  const cfg = state.device?.settings;
  if (!cfg) return [];
  const flip = (icon, label, sub, on, action) => h('div', { class: 'row' }, h('span', { class: 'ico', icon }), h('span', { class: 'grow' }, h('span', { class: 'label' }, label), h('span', { class: 'sub' }, sub)), toggle(on, action, label, !up));
  const edit = (icon, label, value, key, current, opts) => row(icon, label, value, { onclick: up ? () => editSetting(key, label, current, opts) : null });
  const asks = cfg.permissionMode !== 'auto';
  const setApproval = () => {
    if (asks && !confirm('Run edits and commands without asking?\n\nProjects opened from this app will stop asking for approval. Risky commands and files outside the project are still asked about.')) return;
    setConfig('permissionMode', asks ? 'auto' : 'ask');
  };
  return [
    section('AGENT'),
    h(
      'div',
      { class: 'group' },
      flip('brain', 'Thinking', 'The model reasons before it answers, when it can', cfg.think, () => setConfig('think', !cfg.think)),
      flip('shield', 'Ask before edits and commands', asks ? 'Each one waits for your approval' : 'Off: they run without asking. Risky ones still ask.', asks, setApproval),
      edit('layers', 'Context window', cfg.context ? `${sizeOf(cfg.context)} tokens` : 'Model default', 'numCtx', cfg.context ?? '', { numeric: true, hint: 'In tokens, at least 2048. A larger window remembers more and needs more memory.' }),
      edit('list', 'Steps per message', String(cfg.maxSteps), 'maxSteps', cfg.maxSteps, { numeric: true, hint: 'How many tool steps the agent may take before it stops and waits for you.' }),
      edit('hourglass', 'Keep the model in memory', cfg.keepAlive, 'keepAlive', cfg.keepAlive, { hint: 'For Ollama: how long a model stays loaded after its last answer, such as 30m or 2h.' }),
      edit('server', 'Ollama address', cfg.host, 'host', cfg.host, { hint: 'Where Ollama listens, as your Mac reaches it.' }),
      row('key', 'API keys', null, { sub: 'For cloud providers', onclick: up ? chooseKey : null }),
    ),
    section('IN THE TERMINAL'),
    h(
      'div',
      { class: 'group' },
      flip('eye', 'Show reasoning', 'Print the model’s thinking as it works', cfg.showThinking, () => setConfig('showThinking', !cfg.showThinking)),
      flip('logo', 'Animate the robot', 'The robot in the header blinks, here and in the terminal', cfg.animation, () => setConfig('animation', !cfg.animation)),
    ),
    h('div', { class: 'muted small pad' }, 'Saved on your Mac. Projects opened from this app change at once; a seeker already running in a terminal keeps what it started with.'),
  ];
}

function login() {
  const input = h('input', { class: 'field', placeholder: 'Pairing link or code', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const submit = async (e) => {
    e.preventDefault();
    if (!(await pair(input.value))) {
      state.error = 'That does not look like a pairing link.';
      render();
    }
  };
  return [
    h('header', { class: 'brand' }, h('span', { class: 'mark', icon: 'logo' }), h('div', { class: 'grow' }, h('div', { class: 'word' }, 'SEEKER'), h('div', { class: 'sub' }, 'REMOTE'))),
    h('h1', { class: 'hero' }, 'Pair this phone.'),
    h('p', { class: 'muted' }, 'On your Mac, run ', h('code', {}, 'seeker remote --setup'), ' and open the link it prints on this phone — or paste it here.'),
    state.error && h('p', { class: 'warning' }, state.error),
    h('form', { onsubmit: submit }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Pair')),
  ];
}

// ── render ─────────────────────────────────────────────────────────────────
const NAV = [
  ['home', 'Home', 'home'],
  ['sessions', 'Sessions', 'terminal'],
  ['approvals', 'Approvals', 'shield'],
  ['settings', 'Settings', 'gear'],
];
let queued = false;
let announced = '';

function render(force = false) {
  if (queued && !force) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    draw();
  });
}

function draw() {
  const view = $('view');
  const { name } = state.view;
  const paired = Boolean(state.secret);
  const ws = state.workspaces.get(state.view.ws);
  // Stay at the bottom of a growing conversation, unless the reader has scrolled up.
  const pinned = name === 'session' && view.scrollHeight - view.scrollTop - view.clientHeight < 80;
  const screen = `${name}:${state.view.ws ?? state.view.id ?? ''}:${name === 'home' ? state.homeTab : name === 'session' ? state.sessionTab : ''}`;
  // The Sessions list is left alone while nothing it shows has changed: a token streaming in another
  // project does not rebuild it, so a finger or the keyboard focus stays on the row it was on.
  const listed = !paired ? null : name === 'sessions' ? sessionsNow() : name === 'home' ? homeNow() : null;
  const unchanged = listed && view.dataset.screen === screen && view.dataset.listed === listed.signature;
  view.dataset.listed = listed?.signature ?? '';
  const content = unchanged ? null : !paired ? login() : name === 'session' ? session(ws) : name === 'review' ? review(state.approvals.find((a) => a.id === state.view.id)) : name === 'approvals' ? approvals() : name === 'sessions' ? sessions(listed) : name === 'settings' ? settings() : home(listed);
  const scroll = view.scrollTop;
  const grownFrom = view.scrollHeight;
  const focusedRow = view.contains(document.activeElement) ? document.activeElement.dataset.ws : null;
  // A field being typed in (an answer, a note) keeps its text and the cursor across a redraw.
  const typing = view.contains(document.activeElement) && document.activeElement.matches('input.field') && view.dataset.screen === screen ? document.activeElement : null;
  // The screen is rebuilt on every event. Starting each looping animation "this long ago" keeps
  // spinners and pulses in step across rebuilds instead of restarting them.
  view.style.setProperty('--t', `-${Math.round(performance.now())}ms`);
  if (!unchanged) view.replaceChildren(...[linkBanner(), content].flat(3).filter(Boolean));
  if (typing && !unchanged) {
    const fresh = [...view.querySelectorAll('input.field')].find((el) => el.dataset.field === typing.dataset.field);
    if (fresh && !fresh.disabled) {
      // A field that mirrors the app's own state (a search) already holds the right text; the others keep what was typed.
      if (!typing.dataset.field) fresh.value = typing.value;
      fresh.focus();
      try {
        fresh.setSelectionRange(typing.selectionStart, typing.selectionEnd);
      } catch {}
    }
  } else if (focusedRow && !unchanged) {
    [...view.querySelectorAll('[data-ws]')].find((el) => el.dataset.ws === focusedRow)?.focus({ preventScroll: true });
  }
  view.className = `screen-${paired ? name : 'login'}`;
  const sameScreen = view.dataset.screen === screen;
  view.scrollTop = pinned || !sameScreen ? (name === 'session' ? view.scrollHeight : 0) : scroll;
  view.dataset.screen = screen;
  // Something new arrived below while the reader was further up: the jump button gets a dot.
  if (!sameScreen) unseen = false;
  else if (name === 'session' && !pinned && view.scrollHeight > grownFrom) unseen = true;

  const inSession = paired && name === 'session' && ws;
  $('composer').hidden = !inSession;
  if (inSession) {
    const st = agentState(ws.meta);
    const up = state.linked && state.online;
    const buttons = controls(ws);
    // Replaced only when they change, so a tap never lands on a button that was just swapped out.
    const signature = buttons.map((b) => `${b.className}|${b.textContent}|${b.disabled}`).join(';') + `@${ws.meta.id}:${state.approvals.find((a) => a.ws === ws.meta.id)?.id ?? ''}`;
    if ($('controls').dataset.signature !== signature) {
      $('controls').replaceChildren(...buttons);
      $('controls').dataset.signature = signature;
    }
    $('controls').hidden = buttons.length === 0;
    runStatus(ws, st);
    queuePanel(ws, up);
    composerState();
    $('tokens').textContent = `${kilo(ws.meta.used)} / ${sizeOf(ws.meta.limit)}`;
    $('input').placeholder = !up ? 'Not connected…' : st.busy ? (ws.meta.terminal ? 'Working… a picture can still be sent' : ws.meta.can?.queue ? 'Next instruction…' : 'Seeker is working…') : ws.meta.terminal ? 'Message, or just a picture…' : 'Message or /command…';
    // Said aloud once per change, for a reader who cannot see the banner turn colour.
    const say = `${ws.meta.name}: ${st.label.toLowerCase()}`;
    if (say !== announced) $('announce').textContent = announced = say;
  }

  const nav = $('nav');
  nav.hidden = !paired || name === 'session' || name === 'review';
  nav.replaceChildren(
    ...NAV.map(([id, label, icon]) =>
      h('button', { class: state.view.name === id ? 'active' : '', 'aria-current': state.view.name === id ? 'page' : null, onclick: () => go({ name: id }) }, h('span', { class: 'ico' }, h('span', { icon }), id === 'approvals' && state.approvals.length > 0 && h('span', { class: 'count' }, state.approvals.length)), label),
    ),
  );
  document.title = state.approvals.length ? `(${state.approvals.length}) SEEKER Remote` : 'SEEKER Remote';
  fabs();
}

// ── above the message box: what the agent is doing, and what waits for it to finish ──
const RUN_TITLE = { thinking: 'Seeker is thinking', executing: 'Seeker is working', responding: 'Seeker is writing', approval: 'Waiting for your approval' };
const PAUSED = { stopped: 'Paused: the task was stopped.', failed: 'Paused: the task failed.', restart: 'Paused: SEEKER was restarted on your Mac.' };
const openQueued = new Set(); // waiting instructions the reader opened to read in full
let stopAsked = null; // the task a stop was sent for, until the Mac says it is stopping

/** Readable at the end of a long conversation without scrolling up. Redrawn only when what it says changes. */
function runStatus(ws, st) {
  const el = $('status');
  const { meta } = ws;
  if (!st.busy) {
    el.hidden = true;
    el.dataset.key = '';
    return;
  }
  const stopping = Boolean(meta.stopping);
  const waiting = st.key === 'approval';
  const key = `${meta.id}|${stopping ? 'stopping' : st.key}|${meta.activity}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.className = `run-status ${stopping ? 'muted' : st.tone}`;
    el.replaceChildren(
      h('span', { class: 'ico', icon: st.key === 'thinking' ? 'brain' : waiting ? 'shield' : 'bolt' }),
      h('span', { class: 'grow' }, h('b', {}, stopping ? 'Stopping' : RUN_TITLE[st.key], !waiting && runningDots()), h('span', { class: 'sub line' }, stopping ? 'Waiting for your Mac to confirm' : meta.activity || '')),
      h('span', { class: 'side' }, h('span', { class: `state-chip ${stopping ? 'muted' : st.tone} busy` }, h('i'), stopping ? 'STOPPING' : waiting ? 'WAITING' : 'RUNNING'), h('time', { class: 'elapsed mono' })),
    );
  }
  el.hidden = false;
  elapsed();
}

/** How long the task has been running, counted from when the Mac says it began. */
function elapsed() {
  const el = $('status').querySelector('.elapsed');
  const startedAt = state.workspaces.get(state.view.ws)?.meta.startedAt;
  if (!el || !startedAt || $('status').hidden) return;
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const two = (n) => String(n).padStart(2, '0');
  el.textContent = s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}
setInterval(elapsed, 1000);

/** The instructions waiting on the Mac, in the order they will run. What is shown is what the Mac last reported. */
function queuePanel(ws, up) {
  const el = $('queue');
  const { items, paused } = ws.queue ?? NO_QUEUE;
  if (!items.length) {
    el.hidden = true;
    el.dataset.key = '';
    return;
  }
  const id = ws.meta.id;
  const key = `${id}|${paused}|${up}|${items.map((i) => `${i.id}${openQueued.has(i.id) ? '+' : ''}`).join(',')}`;
  el.hidden = false;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const parts = [
    h(
      'div',
      { class: 'head' },
      h('span', { class: 'ico', icon: 'layers' }),
      h('b', { class: 'grow line' }, paused ? `Queued (${items.length})` : `Queued instructions (${items.length})`),
      paused && h('button', { class: 'btn small approve', type: 'button', disabled: !up, onclick: () => command('queue_resume', { ws: id }) }, 'Resume queue'),
      h('button', { class: 'btn small quiet', type: 'button', 'aria-label': 'Clear the queue', disabled: !up, onclick: () => (items.length < 2 || confirm(`Remove all ${items.length} waiting instructions? The task that is running is not stopped.`)) && command('queue_clear', { ws: id }) }, 'Clear'),
    ),
    paused && h('div', { class: 'paused' }, PAUSED[paused] ?? 'Paused.'),
    h(
      'ol',
      {},
      items.map((item, i) =>
        h(
          'li',
          {},
          h('span', { class: 'n mono' }, `${i + 1}.`),
          h('button', { class: `text${openQueued.has(item.id) ? ' open' : ''}`, type: 'button', 'aria-label': `Review queue: instruction ${i + 1}`, 'aria-expanded': String(openQueued.has(item.id)), onclick: () => ((openQueued.has(item.id) ? openQueued.delete(item.id) : openQueued.add(item.id)), draw()) }, item.text),
          h('button', { class: 'x', type: 'button', 'aria-label': 'Remove queued instruction', icon: 'cross', disabled: !up, onclick: () => command('queue_remove', { ws: id, item: item.id }) }),
        ),
      ),
    ),
  ];
  el.replaceChildren(...parts.filter(Boolean));
}

/** Stop and Send, each on its own: Stop only while something runs, Send whenever there is something to send and somewhere for it to go. */
function composerState() {
  const ws = state.workspaces.get(state.view.ws);
  if (!ws) return;
  const { meta } = ws;
  const st = agentState(meta);
  const up = state.linked && state.online;
  const empty = !input.value.trim() && !attachments.length;
  // A terminal session takes a picture at any time: it goes into the message being typed there.
  const nowhere = st.busy && !meta.terminal && !meta.can?.queue;
  $('send').disabled = sending || !up || nowhere || empty;
  $('send').classList.toggle('busy', sending);
  const stoppable = st.busy && meta.can?.stop !== false;
  $('stop').hidden = !stoppable;
  $('stop').disabled = !up || Boolean(meta.stopping) || (stopAsked !== null && stopAsked === (meta.turn ?? null));
  if (!st.busy) stopAsked = null;
}

/**
 * Asked when something is sent while the agent works: into the task in progress, or after it.
 * What was typed stays in the box until the Mac has confirmed where it went.
 */
function chooseMode(ws, text) {
  const { meta } = ws;
  const key = crypto.randomUUID(); // one per instruction: a retry repeats it, and the Mac then does it once
  const canSteer = Boolean(meta.can?.steer);
  const body = h('div', { class: 'mode-sheet' });
  let mode = 'queue';
  let busy = false;
  let error = '';
  const option = (id, icon, title, about, off = false) =>
    h(
      'button',
      { class: `mode ${id}${mode === id ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(mode === id), disabled: off || busy, onclick: () => ((mode = id), show()) },
      h('span', { class: 'ico', icon }),
      h('span', { class: 'grow' }, h('b', {}, title), h('span', { class: 'sub' }, about)),
      h('i', { class: 'radio' }),
    );
  const submit = async () => {
    busy = true;
    error = '';
    show();
    const result = await instruct(meta.id, text, mode, key);
    busy = false;
    const open = !$('sheet').hidden && $('sheet').contains(body);
    if (result.error) {
      error = result.error;
      return open ? show() : toast(error);
    }
    // Only now is it out of the box — unless something else was typed meanwhile.
    if (input.value.trim() === text) {
      input.value = '';
      grow();
      suggest();
      composerState();
    }
    if (open) closeSheet();
    // A queued instruction shows in the queue itself; the other two outcomes have nowhere else to be seen.
    if (result.as !== 'queued') toast(result.as === 'steered' ? 'Sent into the running task.' : 'The task had just ended, so this started right away.');
  };
  const show = () =>
    body.replaceChildren(
      ...[
      h('p', { class: 'muted' }, 'Seeker sedang menjalankan task. Bagaimana instruksi ini dijalankan?'),
      h('div', { class: 'draft' }, text.length > 220 ? `${text.slice(0, 220)}…` : text),
      h(
        'div',
        { class: 'modes', role: 'radiogroup', 'aria-label': 'Choose execution mode' },
        option('steer', 'bolt', 'Steer current task', canSteer ? 'Arahkan atau sesuaikan task yang sedang berjalan.' : `Tidak tersedia: ${meta.provider} menjalankan seluruh task dalam satu permintaan, jadi instruksi tidak bisa disisipkan di tengahnya.`, !canSteer),
        option('queue', 'layers', ['Queue next ', h('span', { class: 'accent' }, '(disarankan)')], 'Jalankan setelah task saat ini selesai.'),
      ),
      error && h('div', { class: 'mode-error', role: 'alert' }, error),
      h('div', { class: 'pair' }, h('button', { class: 'btn', type: 'button', disabled: busy, onclick: closeSheet }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', disabled: busy, onclick: submit }, busy ? 'Mengirim…' : error ? 'Coba lagi' : 'Kirim')),
      ].filter(Boolean),
    );
  show();
  sheet('Kirim instruksi baru', body);
}

// ── floating buttons over a long conversation: back (out of thumb reach at the top) and latest ──
let unseen = false;
function fabs() {
  const view = $('view');
  const inSession = state.view.name === 'session' && !$('composer').hidden;
  const below = view.scrollHeight - view.scrollTop - view.clientHeight;
  if (below < 80) unseen = false;
  $('fab-back').hidden = !inSession || view.scrollTop < 120;
  $('fab-latest').hidden = !inSession || below < 200;
  $('fab-latest').classList.toggle('unseen', unseen);
}
$('fab-back').innerHTML = ICONS.back;
$('fab-latest').innerHTML = ICONS.down;
$('fab-back').addEventListener('click', () => go({ name: 'home' }));
$('fab-latest').addEventListener('click', () => {
  const view = $('view');
  unseen = false;
  view.scrollTo({ top: view.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});
$('view').addEventListener('scroll', fabs, { passive: true });

// ── composer (kept outside the redrawn area so typing is never interrupted) ──
const input = $('input');
$('send').innerHTML = ICONS.send;
$('stop').innerHTML = ICONS.stop;
$('mention').innerHTML = ICONS.at;
// Stop ends the task that is running when it is pressed, and only that one.
$('stop').addEventListener('click', async () => {
  const ws = state.workspaces.get(state.view.ws);
  if (!ws) return;
  const turn = ws.meta.turn ?? null;
  stopAsked = turn;
  composerState();
  if (!(await command('stop', turn ? { ws: ws.meta.id, turn } : { ws: ws.meta.id }))) {
    stopAsked = null;
    composerState();
  }
});
// "@" starts a reference to a file: @file:src/app.js is read and attached on the Mac.
$('mention').addEventListener('click', () => {
  const at = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, at);
  const insert = `${before && !/\s$/.test(before) ? ' ' : ''}@file:`;
  input.value = before + insert + input.value.slice(input.selectionEnd ?? at);
  input.focus();
  input.selectionStart = input.selectionEnd = at + insert.length;
  grow();
  composerState();
});
$('attach').innerHTML = ICONS.image;
$('commands').innerHTML = ICONS.plus;
let sending = false;

const grow = () => {
  input.style.height = 'auto';
  // An empty box is one line; measuring it would count a placeholder that wraps.
  input.style.height = input.value ? `${Math.min(input.scrollHeight, 140)}px` : '';
};

/**
 * What "/" offers. Each entry does the real thing; none is text passed to the model. The ones below the
 * first five are run by SEEKER on the computer, as typed in its terminal; so is any /<skill> typed in full.
 */
function slashCommands() {
  const id = state.view.ws;
  const ws = state.workspaces.get(id);
  if (!ws) return [];
  const busy = agentState(ws.meta).busy;
  const terminal = Boolean(ws.meta.terminal);
  const run = (text) => () => sendText(id, text);
  // Needs more after the name: put it in the box to finish typing.
  const fill = (text) => () => {
    input.value = `${text} `;
    grow();
    input.focus();
  };
  return [
    { name: '/init', about: 'write SEEKER.md for this project', off: busy, run: () => sendText(id, INIT) },
    { name: '/model', about: 'switch the model', off: busy || terminal, run: chooseModel },
    { name: '/new', about: 'start a new conversation', off: busy || terminal, run: () => newConversation(ws.meta) },
    { name: '/stop', about: 'cancel what it is doing', off: !busy, run: () => $('stop').click() },
    { name: '/image', about: 'attach a photo or screenshot', off: false, run: () => $('file').click() },
    { name: '/yolo', about: terminal ? 'changed in the terminal for this session' : 'run edits and commands without asking (on/off)', off: busy || terminal, run: run('/yolo') },
    { name: '/status', about: 'model, context and approval mode', off: busy, run: run('/status') },
    { name: '/skills', about: 'list skills; run one with /<name>', off: busy, run: run('/skills') },
    { name: '/compact', about: 'summarise to free up context', off: busy, run: run('/compact') },
    { name: '/think', about: 'thinking mode on/off', off: busy || terminal, run: run('/think') },
    { name: '/config', about: '/config <setting> <value>', off: busy || terminal, run: fill('/config') },
    { name: '/memory', about: 'what SEEKER remembers', off: busy, run: run('/memory') },
    { name: '/goal', about: 'keep working until a goal is done', off: busy || !terminal, run: fill('/goal') },
    { name: '/help', about: 'commands that work from here', off: busy, run: run('/help') },
  ];
}

function suggest() {
  const box = $('suggest');
  const typed = input.value;
  const list = /^\/\S*$/.test(typed) ? slashCommands().filter((c) => c.name.startsWith(typed.toLowerCase())) : [];
  box.hidden = list.length === 0;
  box.replaceChildren(
    ...list.map((c) =>
      h(
        'button',
        {
          type: 'button',
          disabled: c.off,
          onclick: () => {
            input.value = '';
            grow();
            suggest();
            c.run();
          },
        },
        h('span', { class: 'mono accent' }, c.name),
        h('span', { class: 'sub' }, c.about),
      ),
    ),
  );
}

input.addEventListener('input', () => {
  grow();
  suggest();
  composerState();
});
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if ((!text && !attachments.length) || !state.view.ws || sending) return;
  // A typed command runs as a command, not as a message to the model.
  const typed = slashCommands().find((c) => c.name === text.toLowerCase());
  if (typed) {
    if (typed.off) return toast(`${typed.name} is not available right now.`);
    input.value = '';
    grow();
    suggest();
    return typed.run();
  }
  if ($('send').disabled) return;
  const ws = state.workspaces.get(state.view.ws);
  // Sent while the agent works: it is asked whether this goes into the running task or waits for it to end.
  if (ws && agentState(ws.meta).busy && !ws.meta.terminal) {
    if (attachments.length) return toast('Pictures cannot wait in the queue yet. Send them when the task has ended.');
    return chooseMode(ws, text);
  }
  // A message with pictures takes a moment to upload; a second tap must not send it twice.
  sending = true;
  draw();
  try {
    if (await sendText(state.view.ws, text, attachments)) {
      input.value = '';
      grow();
      attachments = [];
      showAttachments();
    }
  } finally {
    sending = false;
    render();
  }
});
// Enter sends where there is a Shift key to make a new line with; on a phone it stays a new line.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
    e.preventDefault();
    $('form').requestSubmit();
  }
});
$('attach').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = ''; // so the same picture can be chosen again
  await addImages(files);
});
// A picture pasted into the text box is attached too.
input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  addImages(files);
});
$('commands').addEventListener('click', () => {
  const ws = state.workspaces.get(state.view.ws);
  if (!ws) return;
  // Earlier messages, newest first, to send again or edit: the phone's stand-in for the ↑ key.
  const earlier = [...new Set(ws.items.filter((i) => i.kind === 'user').map((i) => i.text))].reverse().slice(0, 6);
  sheet(
    'Commands',
    ...slashCommands().map((c) => h('button', { class: 'row-btn', disabled: c.off, onclick: () => (closeSheet(), c.run()) }, h('span', { class: 'mono accent' }, c.name), h('span', { class: 'muted' }, ` — ${c.about}`))),
    earlier.length ? h('div', { class: 'muted small pad' }, 'Earlier messages — tap to put one back in the box:') : null,
    ...earlier.map((text) =>
      h(
        'button',
        {
          class: 'row-btn line',
          onclick: () => {
            closeSheet();
            input.value = text;
            grow();
            input.focus();
          },
        },
        text,
      ),
    ),
  );
});

// With the on-screen keyboard open the app is sized to what is actually visible, which keeps the
// message box above the keys. Whether the keyboard is up is judged against the tallest the visible
// area has been, not against window.innerHeight: some iOS versions shrink that along with the
// keyboard, and then the two never differ.
if (window.visualViewport) {
  const typing = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  let full = 0;
  let width = 0;
  const fit = () => {
    if (window.innerWidth !== width) [width, full] = [window.innerWidth, 0]; // turned on its side
    full = Math.max(full, visualViewport.height, window.innerHeight);
    // Only while a field has the keyboard. As it closes, iOS reports the height in steps; following
    // those would walk the page down slowly, so the full height comes back the moment typing ends.
    const keyboard = typing() && full - visualViewport.height > 120;
    $('app').style.height = keyboard ? `${visualViewport.height}px` : '';
    document.documentElement.classList.toggle('keyboard', keyboard);
    if (keyboard || window.scrollY) window.scrollTo(0, 0);
  };
  fit();
  visualViewport.addEventListener('resize', fit);
  visualViewport.addEventListener('scroll', fit);
  window.addEventListener('resize', fit);
  // After the tick, so moving from one field to another does not count as leaving.
  document.addEventListener('focusout', () => setTimeout(fit, 0));
  // The keyboard takes a moment to come up, and not every iOS version reports it when it has.
  document.addEventListener('focusin', () => [50, 300, 600].forEach((ms) => setTimeout(fit, ms)));
}

// ── start ──────────────────────────────────────────────────────────────────
(async () => {
  // A pairing link carries the secret after "#", which browsers never send to the server.
  const fromLink = /[#&]k=([^&]+)/.exec(location.hash)?.[1];
  // "#v=session:<id>", "#v=review:<id>" or "#v=approvals" opens straight on that screen.
  route(location.hash);
  if (fromLink) history.replaceState(null, '', location.pathname);
  const secret = fromLink ?? localStorage.getItem('seeker.secret');
  if (secret) await pair(secret);
  render();
  if ('serviceWorker' in navigator) {
    // The service worker shows notifications; tapping one sends the screen to open here.
    navigator.serviceWorker.addEventListener('message', (event) => event.data?.open && route(event.data.open));
    await navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  refreshPush();
})();
window.addEventListener('hashchange', () => {
  if (!/[#&]v=/.test(location.hash)) return;
  route(location.hash);
  history.replaceState(null, '', location.pathname);
});
// Times shown as "2m ago" move on, and the round trip is measured again, while the app is in front.
setInterval(() => {
  if (document.hidden || !state.secret) return;
  if (['home', 'settings'].includes(state.view.name)) ping();
  render();
}, 30_000);
document.addEventListener('visibilitychange', () => !document.hidden && state.secret && (ping(), render()));
