// SEEKER Remote — the phone app.
//
// Everything shown here arrives encrypted from the Mac and is decrypted in
// this page with a key derived from the pairing secret, which stays on this
// device (localStorage) and is never sent to the server. Text from the Mac is
// always inserted as text, never as HTML.
//
// Nothing on these screens is made up here: statuses, counts and timings come
// from the Mac's events, and a value the Mac has not reported is shown as "—".

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
  logo: `<svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true"><path d="M24 2l5 9H19zM24 46l-5-9h10zM2 24l9-5v10zM46 24l-9 5V19z"/><path d="M22.6 17h2.8v5.6H31v2.8h-5.6V31h-2.8v-5.6H17v-2.8h5.6z"/></svg>`,
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
  error: '',
  picking: false, // the model sheet is open and waiting for lists from the Mac
  push: 'unknown', // unsupported | off | on | denied
  lastEntryAt: null, // when the Mac was last heard from
  latency: null, // { ms, at } — a measured round trip to the Mac and back
  open: new Set(), // timeline entries the reader expanded
  shown: new Map(), // workspace id → how many entries are drawn
  deciding: new Set(), // approvals whose answer is on its way
  drawn: new Set(), // timeline entries already on screen once, so only new ones animate in
};
let streamAbort = null;
let reconnecting = false;
const pings = new Map(); // command id → when it was sent

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
      state.workspaces = new Map(event.workspaces.map(({ items, ...meta }) => [meta.id, { meta, items: items ?? [] }]));
      break;
    case 'ws': {
      const existing = state.workspaces.get(event.ws.id);
      if (existing) existing.meta = event.ws;
      else state.workspaces.set(event.ws.id, { meta: event.ws, items: [] });
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
      if (state.picking) showProviders(event.list);
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
 * works, its phase. `tone` picks the colour.
 */
function agentState(meta) {
  if (meta.status === 'approval') return { key: 'approval', label: 'AWAITING APPROVAL', tone: 'amber', busy: true };
  if (meta.status === 'working') {
    if (meta.phase === 'thinking') return { key: 'thinking', label: 'THINKING', tone: 'violet', busy: true };
    if (meta.phase === 'responding') return { key: 'responding', label: 'RESPONDING', tone: 'cyan', busy: true };
    return { key: 'executing', label: 'EXECUTING', tone: 'cyan', busy: true };
  }
  if (meta.outcome === 'completed') return { key: 'completed', label: 'COMPLETED', tone: 'emerald', busy: false };
  if (meta.outcome === 'failed') return { key: 'failed', label: 'FAILED', tone: 'red', busy: false };
  if (meta.outcome === 'stopped') return { key: 'stopped', label: 'STOPPED', tone: 'muted', busy: false };
  return { key: 'idle', label: 'IDLE', tone: 'muted', busy: false };
}

const chip = (st) => h('span', { class: `chip-state ${st.tone}` }, h('i', { class: st.busy ? 'live' : '' }), st.label);

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
          disabled: !p.ready,
          onclick: () => {
            sheet(p.label, h('div', { class: 'muted' }, 'Loading its models…'));
            command('models', { provider: p.id });
          },
        },
        h('div', {}, p.label, p.active && h('span', { class: 'accent' }, '  • active')),
        h('div', { class: 'muted small' }, p.local ? 'local' : 'cloud', p.ready ? '' : ' · needs an API key — set it on the Mac with /key'),
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
    h('span', { class: 'mark', icon: 'logo' }),
    h('span', { class: 'bar' }),
    h('div', { class: 'grow' }, h('div', { class: 'word' }, 'SEEKER'), h('div', { class: 'sub' }, 'REMOTE')),
    h('button', { class: 'avatar', 'aria-label': `Settings — ${up ? 'connected' : 'not connected'}`, onclick: () => go({ name: 'settings' }) }, initial, h('i', { class: up ? 'on' : 'off' })),
  );
}

/** A strip across the top whenever what is on screen may be out of date. */
function linkBanner() {
  if (!state.secret) return null;
  if (!state.linked) return h('div', { class: 'banner amber', role: 'status' }, h('i', { class: 'spin' }), 'Reconnecting to the relay…');
  if (!state.online) return h('div', { class: 'banner red', role: 'status' }, dot('off'), 'Your Mac is offline. Run `seeker remote` on it.');
  return null;
}

function deviceLine() {
  if (!state.linked) return ['off', 'Connecting to the relay…'];
  if (!state.online) return ['off', 'Offline'];
  const first = [...state.workspaces.values()][0]?.meta;
  return ['on', first ? `${first.provider} • Online` : 'Online'];
}

// ── home ───────────────────────────────────────────────────────────────────
const INIT = 'Explore this project (list the root, read the README and the main manifest/config files, look at the folder structure) and then write a SEEKER.md file in the working directory describing what the project is, the tech stack, how to install / run / test / build it, the folder layout, and conventions visible in the code. Keep it under 80 lines and include only what you verified.';

function workspaceRow(ws) {
  const { meta } = ws;
  const st = agentState(meta);
  return h(
    'button',
    { class: `row ws${meta.status === 'approval' ? ' attention' : ''}`, onclick: () => go({ name: 'session', ws: meta.id }) },
    h('span', { class: 'ico', icon: 'folder' }),
    h('span', { class: 'grow' }, h('span', { class: 'label line' }, meta.name), h('span', { class: 'sub mono line' }, meta.path, meta.branch ? ` · ${meta.branch}` : ''), h('span', { class: 'sub line' }, meta.lastAt ? `Last activity ${ago(meta.lastAt)}` : 'No activity yet')),
    st.key !== 'idle' && chip(st),
    h('span', { class: 'chev', icon: 'chevron' }),
  );
}

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

/** The session to put up front: one that needs the user, else one that is running, else the latest. */
function activeSession(list) {
  const rank = (w) => (w.meta.status === 'approval' ? 3 : w.meta.status === 'working' ? 2 : w.items.length ? 1 : 0);
  return [...list].sort((a, b) => rank(b) - rank(a) || (b.meta.lastAt ?? 0) - (a.meta.lastAt ?? 0))[0] ?? null;
}

function activeCard(ws) {
  if (!ws) return h('div', { class: 'empty' }, state.linked && state.online ? 'No project open yet. Tap + under Workspaces to open one.' : 'Waiting for your Mac…');
  const { meta, items } = ws;
  const st = agentState(meta);
  const lastAnswer = [...items].reverse().find((i) => i.kind === 'assistant' && i.text);
  const summary = meta.activity ? `${meta.activity}…` : lastAnswer ? lastAnswer.text.replace(/\s+/g, ' ').slice(0, 120) : 'Nothing has run here yet.';
  return h(
    'button',
    { class: `card session-card ${st.tone}`, onclick: () => go({ name: 'session', ws: meta.id }) },
    h('span', { class: 'ico big', icon: 'folder' }),
    h('span', { class: 'grow' }, h('span', { class: 'title line' }, meta.name), h('span', { class: 'sub mono line' }, meta.branch || 'no git', ' • ', meta.path), h('span', { class: 'sub line' }, meta.model, ' · ', meta.provider), h('span', { class: `summary ${st.busy ? st.tone : ''}` }, summary)),
    h('span', { class: 'chev', icon: 'chevron' }),
  );
}

function home() {
  const [tone, text] = deviceLine();
  const list = [...state.workspaces.values()];
  const first = list[0]?.meta;
  const ready = state.linked && state.online;
  const active = activeSession(list);
  const pick = (title, then) => {
    if (!list.length) return toast('Open a project first.');
    if (list.length === 1) return then(list[0].meta);
    sheet(title, ...list.map((w) => h('button', { class: 'row-btn', onclick: () => (closeSheet(), then(w.meta)) }, w.meta.name)));
  };
  const tab = (id, label) => h('button', { class: state.homeTab === id ? 'active' : '', role: 'tab', 'aria-selected': String(state.homeTab === id), onclick: () => ((state.homeTab = id), render(true)) }, label);
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, tab('control', 'CONTROL CENTER'), tab('projects', 'PROJECTS'));
  const workspaces = [section('WORKSPACES', h('button', { class: 'add', 'aria-label': 'Open a project', icon: 'plus', onclick: addWorkspace })), list.length ? h('div', { class: 'group' }, list.map(workspaceRow)) : h('div', { class: 'empty' }, ready ? 'No project open yet. Tap + to open one.' : 'Waiting for your Mac…')];

  if (state.homeTab === 'projects') {
    const opened = new Set(list.map((w) => w.meta.path));
    const rest = state.folders.filter((f) => !opened.has(f));
    const open = async (folder) => (await command('open', { path: folder })) && toast(`Opening ${folder}…`);
    return [
      header(),
      tabs,
      ...workspaces,
      section('ON YOUR MAC'),
      rest.length
        ? h('div', { class: 'group' }, rest.map((f) => h('button', { class: 'row', disabled: !ready, onclick: () => open(f) }, h('span', { class: 'ico', icon: 'folder' }), h('span', { class: 'grow' }, h('span', { class: 'label mono line' }, f)), h('span', { class: 'chev', icon: 'plus' }))))
        : h('div', { class: 'empty' }, ready ? 'Every project folder found on your Mac is already open.' : 'Waiting for your Mac…'),
    ];
  }

  const quick = (label, icon, action) => h('button', { class: 'tile', onclick: action }, h('span', { icon }), h('span', { class: 'mono' }, label));
  return [
    header(),
    tabs,
    section('ACTIVE SESSION', active && chip(agentState(active.meta))),
    activeCard(active),
    section('CONNECTED DEVICE'),
    h(
      'button',
      { class: 'card device', onclick: () => go({ name: 'settings' }) },
      h('span', { class: 'ico big', icon: 'laptop' }),
      h('span', { class: 'grow' }, h('span', { class: 'title line' }, dot(tone), state.device?.name ?? 'Your Mac'), h('span', { class: 'sub line' }, text, state.latency ? ` • ${state.latency.ms} ms` : '')),
      h('span', { class: 'chev', icon: 'chevron' }),
    ),
    // Each chip states something checked: where the model runs, whether anything leaves the Mac, whether it can take work now.
    h(
      'div',
      { class: 'chips' },
      h('span', { class: `chip ${first ? 'on' : ''}` }, h('i'), !first ? 'NO MODEL' : first.local ? 'LOCAL' : 'CLOUD'),
      h('span', { class: `chip ${first ? 'on' : ''}` }, h('i'), !first ? '—' : first.local ? 'PRIVATE' : first.provider.toUpperCase()),
      h('span', { class: `chip ${ready ? 'on' : 'warn'}` }, h('i'), ready ? 'READY' : state.linked ? 'OFFLINE' : 'CONNECTING'),
    ),
    ...workspaces,
    section('QUICK ACTIONS'),
    h(
      'div',
      { class: 'tiles' },
      quick('/init', 'terminal', () => pick('Set up which project?', (m) => (go({ name: 'session', ws: m.id }), sendText(m.id, INIT)))),
      quick('/model', 'cube', chooseModel),
      quick('/resume', 'play', () => (active ? go({ name: 'session', ws: active.meta.id }) : go({ name: 'sessions' }))),
    ),
  ];
}

function sendText(wsId, text, images = []) {
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
    h('div', { class: 'file' }, h('span', { class: 'mono line grow' }, file), h('span', { class: 'emerald' }, `+${counts.added}`), h('span', { class: 'red' }, `−${counts.removed}`)),
    h('div', { class: `sides${diff.removed?.length && diff.added?.length ? ' both' : ''}` }, diff.removed?.length ? side(diff.removed, 'del') : null, diff.added?.length ? side(diff.added, 'add') : null),
    // What the lines above do not show by themselves is said in words.
    Number.isInteger(diff.overwrites) ? h('div', { class: 'more amber' }, `⚠ Replaces the whole file: its ${diff.overwrites} existing line${diff.overwrites === 1 ? '' : 's'} are removed.`) : null,
    diff.times > 1 ? h('div', { class: 'more amber' }, `⚠ Applied in ${diff.times} places: every occurrence in the file is changed.`) : null,
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

function entryOf(item) {
  const time = h('time', { class: 'at' }, clock(item.at));
  if (item.kind === 'tool') {
    const mark = item.state === 'done' ? 'done' : item.state === 'failed' ? 'failed' : 'running';
    const verb = item.state === 'done' ? item.done : item.doing;
    const hasMore = item.output?.length || item.diff;
    const head = [h('span', { class: 'title' }, verb, item.state === 'running' && '…'), item.summary && h('span', { class: 'sub mono' }, item.summary), item.note && h('span', { class: `sub ${item.state === 'failed' ? 'red' : ''}` }, item.note)];
    return h(
      'li',
      { class: `ev tool ${mark}` },
      h('span', { class: 'node' }, mark === 'done' ? h('span', { icon: 'check' }) : mark === 'failed' ? h('span', { icon: 'cross' }) : null),
      h('div', { class: 'body' }, hasMore ? expandable(item, head, item.diff && diffView(item.diff, item.summary), item.output?.length ? h('pre', { class: 'out' }, item.output.join('\n')) : null) : head),
      time,
    );
  }
  if (item.kind === 'user') {
    // A preview is shown only as an image of a type the Mac recognised; anything else is just named.
    const shots = (item.images ?? []).map((i) => (i.thumb && /^image\/(png|jpeg|gif|webp)$/.test(i.mime) ? h('img', { src: `data:${i.mime};base64,${i.thumb}`, alt: i.name }) : h('span', { class: 'file' }, i.name)));
    return h('li', { class: 'ev user' }, h('span', { class: 'node' }), h('div', { class: 'body' }, h('span', { class: 'who' }, 'YOU'), h('div', { class: 'said' }, item.text), shots.length ? h('div', { class: 'shots' }, shots) : null), time);
  }
  if (item.kind === 'assistant') {
    if (!item.text) return null;
    return h('li', { class: 'ev assistant' }, h('span', { class: 'node' }), h('div', { class: 'body' }, h('span', { class: 'who' }, 'SEEKER'), h('div', { class: 'prose' }, prose(item.text))), time);
  }
  return h('li', { class: `ev notice ${item.level}` }, h('span', { class: 'node' }), h('div', { class: 'body' }, h('span', { class: 'sub' }, item.text)), time);
}

function timeline(ws) {
  const { items } = ws;
  const shown = state.shown.get(ws.meta.id) ?? PAGE;
  const visible = items.slice(-shown);
  return [
    items.length > visible.length && h('button', { class: 'btn quiet small', onclick: () => (state.shown.set(ws.meta.id, shown + PAGE), render(true)) }, `Show ${Math.min(PAGE, items.length - visible.length)} earlier entries`),
    h('ol', { class: 'timeline' }, visible.map(entry)),
  ];
}

/** The banner that says what the agent is doing. Progress is never a percentage: the Mac cannot know one. */
function statusBanner(ws, pending) {
  const { meta } = ws;
  const st = agentState(meta);
  const failure = st.key === 'failed' ? [...ws.items].reverse().find((i) => i.kind === 'notice' && i.level === 'error')?.text : null;
  const text = {
    thinking: meta.activity && meta.activity !== 'Thinking' ? `${meta.activity}…` : 'The model is working on its next step…',
    executing: meta.tools?.running ?? `${meta.activity || 'Running a tool'}…`,
    responding: 'Writing the answer…',
    approval: pending ? (pending.kind === 'question' ? pending.title : `${pending.doing} ${pending.summary}`) : 'Waiting for your answer.',
    completed: `Finished ${ago(meta.lastAt)}.`,
    failed: failure ?? 'The last task ended with an error.',
    stopped: 'You stopped the last task.',
    idle: 'Ready. Ask Seeker to build, fix, or explore.',
  }[st.key];
  const icon = { thinking: 'brain', approval: 'shield', completed: 'check', failed: 'cross', idle: 'terminal', stopped: 'terminal' }[st.key] ?? 'bolt';
  const link = st.key === 'approval' && pending;
  return h(
    link ? 'button' : 'div',
    { class: `status ${st.tone}`, onclick: link ? () => go({ name: 'review', id: pending.id, from: state.view }) : null },
    h('span', { class: 'ico', icon }),
    h('span', { class: 'grow' }, h('span', { class: 'state' }, st.label), h('span', { class: 'what' }, text)),
    link && h('span', { class: 'chev', icon: 'chevron' }),
    st.busy && st.key !== 'approval' && h('span', { class: 'bar' }),
  );
}

function metrics(meta) {
  const pct = meta.limit ? Math.min(100, Math.round((meta.used / meta.limit) * 100)) : null;
  const t = meta.tools;
  const tokens = meta.tokens;
  const card = (icon, label, big, small, extra) => h('div', { class: 'metric' }, h('div', { class: 'head' }, h('span', { icon }), label), h('div', { class: 'big' }, big), h('div', { class: 'small' }, small), extra);
  return h(
    'div',
    { class: 'metrics' },
    card('layers', 'CONTEXT', pct == null ? '—' : `${pct}%`, `${kilo(meta.used)} / ${sizeOf(meta.limit)}`, h('div', { class: 'track' }, h('div', { class: `fill${pct > 80 ? ' amber' : ''}`, style: `width:${pct ?? 0}%` }))),
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
      h('button', { class: 'row-btn', onclick: () => (closeSheet(), newConversation(meta)) }, '/new — start a new conversation'),
      h('button', { class: 'row-btn red', onclick: () => (closeSheet(), confirm(`Close ${meta.name}? Its conversation is saved on your Mac.`) && (command('close', { ws: meta.id }), go({ name: 'home' }))) }, 'Close this project'),
    );
  const up = state.linked && state.online;
  return [
    h('div', { class: 'topbar' }, h('button', { class: 'back', 'aria-label': 'Back', icon: 'back', onclick: () => go({ name: 'home' }) }), h('div', { class: 'grow' }, h('div', { class: 'name line' }, meta.name), h('div', { class: 'sub mono line' }, meta.branch || 'no git', ' • ', meta.path)), h('button', { class: 'more', 'aria-label': 'More', onclick: menu }, '•••')),
    h(
      'div',
      { class: 'group' },
      row('laptop', state.device?.name ?? 'Your Mac', h('span', { class: `dot ${up ? 'on' : 'off'}`, role: 'img', 'aria-label': up ? 'connected' : 'not connected' })),
      h('button', { class: 'row', 'aria-label': 'Change model', onclick: chooseModel }, h('span', { class: 'ico', icon: 'cube' }), h('span', { class: 'grow' }, h('span', { class: 'label mono line' }, meta.model, h('span', { class: 'muted' }, ' • ', meta.provider))), h('span', { class: 'chev', icon: 'down' })),
    ),
    statusBanner(ws, pending),
    section([h('span', { icon: 'list' }), 'ACTIVITY'], st.busy && up && h('span', { class: 'live' }, h('i'), 'LIVE')),
    items.length ? timeline(ws) : h('div', { class: 'empty' }, 'Nothing has happened in this conversation yet.'),
    metrics(meta),
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
    st.busy && h('button', { class: 'ctl stop', type: 'button', disabled: !up, onclick: () => command('stop', { ws: meta.id }) }, h('i'), 'Stop'),
    pending.length > 0 && h('button', { class: 'ctl approve', type: 'button', onclick: () => go({ name: 'review', id: pending[0].id, from: state.view }) }, h('span', { icon: 'check' }), pending[0].kind === 'question' ? 'Answer' : `Review${pending.length > 1 ? ` (${pending.length})` : ''}`),
    // After a stop the agent's own history says where it was; "continue" is what it is told to expect.
    st.key === 'stopped' && h('button', { class: 'ctl resume', type: 'button', disabled: !up, onclick: () => sendText(meta.id, 'continue') }, h('span', { icon: 'play' }), 'Resume'),
    st.key === 'failed' && lastAsked && h('button', { class: 'ctl resume', type: 'button', disabled: !up, onclick: () => sendText(meta.id, lastAsked) }, h('span', { icon: 'play' }), 'Retry'),
  ].filter(Boolean);
}

// ── approvals ──────────────────────────────────────────────────────────────
const KIND = { exec: 'COMMAND', write: 'FILE CHANGE', net: 'NETWORK', other: 'TOOL', question: 'QUESTION' };
const diffCounts = (diff) => diff?.counts ?? (diff ? { added: diff.added?.length ?? 0, removed: diff.removed?.length ?? 0 } : null);
const plusMinus = (counts) => [h('span', { class: 'emerald' }, `+${counts.added}`), ' ', h('span', { class: 'red' }, `−${counts.removed}`)];

function approvalCard(a) {
  const counts = diffCounts(a.diff);
  return h(
    'button',
    { class: 'card approval', onclick: () => go({ name: 'review', id: a.id, from: { name: 'approvals' } }) },
    h(
      'span',
      { class: 'grow' },
      h('span', { class: 'meta' }, h('span', { class: 'tag amber' }, KIND[a.kind] ?? 'TOOL'), a.warning && h('span', { class: 'tag red' }, 'DANGEROUS'), h('span', { class: 'sub grow line' }, a.wsName), h('time', { class: 'sub' }, ago(a.at))),
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
    approval.warning && h('div', { class: 'banner red' }, '⚠ ', approval.warning),
    isWrite ? (diffView(approval.diff, approval.summary) ?? h('div', { class: 'box' }, h('div', { class: 'cmd plain' }, `${approval.doing} ${approval.summary}`))) : h('div', { class: 'box' }, h('div', { class: `cmd${isCommand ? '' : ' plain'}` }, isCommand ? approval.summary : `${approval.doing} ${approval.summary}`)),
    h('div', { class: 'group' }, row('folder', 'Working directory', null, { sub: h('span', { class: 'mono' }, approval.cwd) })),
    h('div', { class: 'actions' }, h('button', { class: 'btn reject', disabled: busy, onclick: () => send('approve', { decision: 'deny', note: note.value }) }, h('span', { icon: 'cross' }), 'Reject'), h('button', { class: 'btn approve', disabled: busy, onclick: () => send('approve', { decision: 'allow' }) }, h('span', { icon: 'check' }), busy ? 'Sending…' : isWrite ? 'Approve change' : 'Approve')),
    always && h('button', { class: 'btn quiet', disabled: busy, onclick: () => confirm(`${always}? Seeker will stop asking for this.`) && send('approve', { decision: 'always' }) }, always),
    note,
    h('p', { class: 'muted small' }, 'Each command and each file change is approved on its own. Nothing runs until your Mac has your answer.'),
  ];
}

// ── sessions ───────────────────────────────────────────────────────────────
function sessions() {
  const when = (w) => w.meta.lastAt ?? w.items.at(-1)?.at ?? 0;
  const list = [...state.workspaces.values()].sort((a, b) => when(b) - when(a));
  return [
    header(),
    section('SESSIONS'),
    list.length
      ? list.map((w) => {
          const last = [...w.items].reverse().find((i) => i.kind === 'user');
          const st = agentState(w.meta);
          return h(
            'button',
            { class: `card session-card ${st.tone}`, onclick: () => go({ name: 'session', ws: w.meta.id }) },
            h('span', { class: 'grow' }, h('span', { class: 'meta' }, chip(st), h('span', { class: 'grow' }), h('time', { class: 'sub' }, when(w) ? ago(when(w)) : 'not used yet')), h('span', { class: 'title line' }, w.meta.name), h('span', { class: 'sub line' }, last ? `› ${last.text}` : 'No message yet'), h('span', { class: 'sub mono line' }, w.meta.model, ' · ', `${w.meta.tools?.total ?? w.items.filter((i) => i.kind === 'tool').length} tool runs`)),
            h('span', { class: 'chev', icon: 'chevron' }),
          );
        })
      : h('div', { class: 'empty' }, 'No session yet. Open a project from Home.'),
  ];
}

// ── settings ───────────────────────────────────────────────────────────────
function settings() {
  const up = state.linked && state.online;
  const first = [...state.workspaces.values()][0]?.meta;
  const prefs = pushPrefs();
  const toggle = (on, action, label, disabled = false) => h('button', { class: `switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': label, disabled, onclick: action }, h('i'));
  const check = (kind, label) =>
    h('label', { class: 'row check' }, h('span', { class: 'grow' }, h('span', { class: 'label' }, label)), h('input', { type: 'checkbox', checked: prefs[kind], disabled: state.push !== 'on' || !up, onchange: (e) => setPushPref(kind, e.target.checked) }));
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
      row('laptop', state.device?.name ?? 'Your Mac', up ? 'Connected' : 'Offline', { tone: up ? 'emerald' : 'red', sub: first ? `${first.provider}${first.local ? ' · runs on the Mac' : ' · cloud'}` : null }),
      row('wifi', 'Relay', state.linked ? 'Connected' : 'Reconnecting…', { tone: state.linked ? 'emerald' : 'amber', sub: location.host }),
      row('pulse', 'Round trip to the Mac', state.latency ? `${state.latency.ms} ms` : '—', { sub: state.latency ? `measured ${ago(state.latency.at)} · tap to measure again` : up ? 'measuring…' : 'needs the Mac online', onclick: up ? () => (ping(), toast('Measuring…')) : null }),
      row('terminal', 'Last heard from the Mac', ago(state.lastEntryAt)),
    ),
    section('MODEL'),
    h('div', { class: 'group' }, row('cube', first?.model ?? state.device?.model ?? '—', null, { sub: first ? `${first.provider} · ${sizeOf(first.limit)} context${first.vision === false ? ' · no images' : first.vision ? ' · sees images' : ''}` : (state.device?.provider ?? 'No project open'), onclick: up ? chooseModel : null })),
    section('NOTIFICATIONS'),
    h(
      'div',
      { class: 'group' },
      h('div', { class: 'row' }, h('span', { class: 'ico', icon: 'bell' }), h('span', { class: 'grow' }, h('span', { class: 'label' }, state.push === 'on' ? 'On for this phone' : 'Notifications'), h('span', { class: 'sub' }, pushNote)), toggle(state.push === 'on', state.push === 'on' ? disablePush : enablePush, 'Notifications for this phone', ['unsupported', 'denied', 'unknown'].includes(state.push))),
      check('done', 'Task completions'),
      check('approval', 'Approval requests and questions'),
      check('error', 'Errors'),
      state.push === 'on' && row('bell', 'Send a test notification', null, { onclick: () => command('push_test') }),
    ),
    section('PRIVACY & SECURITY'),
    h(
      'div',
      { class: 'group' },
      row('lock', 'End-to-end encryption', 'On', { tone: 'emerald', sub: 'AES-256-GCM between this phone and your Mac' }),
      row('shield', 'Relay', 'Cannot read', { tone: 'emerald', sub: 'It holds only a hash of the access token' }),
      row('check', 'This phone', 'Paired', { tone: 'emerald', sub: 'The pairing secret is stored on this device only' }),
    ),
    section('DIAGNOSTICS'),
    h(
      'div',
      { class: 'group' },
      row('pulse', 'Transport', state.linked ? 'Event stream open' : 'Closed, retrying', { tone: state.linked ? '' : 'amber' }),
      row('layers', 'Context limit', first ? sizeOf(first.limit) : '—'),
      row('terminal', 'Agent version', state.device?.version ? `v${state.device.version}` : '—'),
      row('list', 'Open projects', String(state.workspaces.size)),
    ),
    h('div', { class: 'actions stack' }, h('button', { class: 'btn quiet', disabled: !up, onclick: () => command('sync').then((ok) => ok && toast('Asked your Mac for a fresh copy.')) }, 'Refresh from the Mac'), h('button', { class: 'btn quiet', onclick: reconnect }, 'Reconnect'), h('button', { class: 'btn quiet red', onclick: () => confirm('Remove the pairing from this phone?') && signOut() }, 'Unpair this phone')),
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
    h('header', { class: 'brand' }, h('span', { class: 'mark', icon: 'logo' }), h('span', { class: 'bar' }), h('div', { class: 'grow' }, h('div', { class: 'word' }, 'SEEKER'), h('div', { class: 'sub' }, 'REMOTE'))),
    h('h1', { class: 'hero' }, 'Pair this phone.'),
    h('p', { class: 'muted' }, 'On your Mac, run ', h('code', {}, 'seeker remote --setup'), ' and open the link it prints on this phone — or paste it here.'),
    state.error && h('p', { class: 'amber' }, state.error),
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
  const content = !paired ? login() : name === 'session' ? session(ws) : name === 'review' ? review(state.approvals.find((a) => a.id === state.view.id)) : name === 'approvals' ? approvals() : name === 'sessions' ? sessions() : name === 'settings' ? settings() : home();
  const scroll = view.scrollTop;
  const screen = `${name}:${state.view.ws ?? state.view.id ?? ''}:${name === 'home' ? state.homeTab : ''}`;
  // A field being typed in (an answer, a note) keeps its text and the cursor across a redraw.
  const typing = view.contains(document.activeElement) && document.activeElement.matches('input.field') && view.dataset.screen === screen ? document.activeElement : null;
  // The screen is rebuilt on every event. Starting each looping animation "this long ago" keeps
  // spinners and pulses in step across rebuilds instead of restarting them.
  view.style.setProperty('--t', `-${Math.round(performance.now())}ms`);
  view.replaceChildren(...[linkBanner(), content].flat(3).filter(Boolean));
  if (typing) {
    const fresh = view.querySelector('input.field');
    if (fresh && !fresh.disabled) {
      fresh.value = typing.value;
      fresh.focus();
    }
  }
  view.className = `screen-${paired ? name : 'login'}`;
  view.scrollTop = pinned || view.dataset.screen !== screen ? (name === 'session' ? view.scrollHeight : 0) : scroll;
  view.dataset.screen = screen;

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
    $('send').disabled = st.busy || sending || !up;
    $('tokens').textContent = `${kilo(ws.meta.used)} / ${sizeOf(ws.meta.limit)}`;
    $('input').placeholder = !up ? 'Not connected…' : st.busy ? 'Seeker is working…' : 'Message or /command…';
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
}

// ── composer (kept outside the redrawn area so typing is never interrupted) ──
const input = $('input');
$('send').innerHTML = ICONS.send;
$('attach').innerHTML = ICONS.image;
$('commands').innerHTML = ICONS.plus;
let sending = false;

const grow = () => {
  input.style.height = 'auto';
  // An empty box is one line; measuring it would count a placeholder that wraps.
  input.style.height = input.value ? `${Math.min(input.scrollHeight, 140)}px` : '';
};

/** What "/" offers. Each entry does the real thing; none is text passed to the model. */
function slashCommands() {
  const id = state.view.ws;
  const ws = state.workspaces.get(id);
  if (!ws) return [];
  const busy = agentState(ws.meta).busy;
  return [
    { name: '/init', about: 'write SEEKER.md for this project', off: busy, run: () => sendText(id, INIT) },
    { name: '/model', about: 'switch the model', off: busy, run: chooseModel },
    { name: '/new', about: 'start a new conversation', off: busy, run: () => newConversation(ws.meta) },
    { name: '/stop', about: 'cancel what it is doing', off: !busy, run: () => command('stop', { ws: id }) },
    { name: '/image', about: 'attach a photo or screenshot', off: false, run: () => $('file').click() },
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

// With the on-screen keyboard open, iOS keeps the page its full height and slides it under the
// keys. Sizing the app to what is actually visible keeps the message box above them.
if (window.visualViewport) {
  const fit = () => {
    const keyboard = window.innerHeight - visualViewport.height > 120;
    $('app').style.height = keyboard ? `${visualViewport.height}px` : '';
    document.documentElement.classList.toggle('keyboard', keyboard);
    if (keyboard) window.scrollTo(0, 0);
  };
  visualViewport.addEventListener('resize', fit);
  visualViewport.addEventListener('scroll', fit);
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
