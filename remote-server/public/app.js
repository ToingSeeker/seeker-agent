// SEEKER Remote — the phone app.
//
// Everything shown here arrives encrypted from the Mac and is decrypted in
// this page with a key derived from the pairing secret, which stays on this
// device (localStorage) and is never sent to the server. Text from the Mac is
// always inserted as text, never as HTML.

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

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  logo: `<svg viewBox="0 0 48 48" fill="currentColor"><path d="M24 2l5 9H19zM24 46l-5-9h10zM2 24l9-5v10zM46 24l-9 5V19z"/><path d="M22.6 17h2.8v5.6H31v2.8h-5.6V31h-2.8v-5.6H17v-2.8h5.6z"/></svg>`,
  laptop: svg('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  folder: svg('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'),
  terminal: svg('<path d="M5 8l4 4-4 4M12 16h7"/>'),
  shield: svg('<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-2.8 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007 19.4a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1A1.7 1.7 0 003 14H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 7a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1A1.7 1.7 0 0010 3.1V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.9 2.9l-.1.1A1.7 1.7 0 0020.9 10H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  send: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 4l18 8-18 8 3-8zm3 8h7"/></svg>`,
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
  error: '',
  picking: false, // the model sheet is open and waiting for lists from the Mac
  push: 'unknown', // unsupported | off | on | denied
};
let streamAbort = null;

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
async function command(type, fields = {}) {
  try {
    const c = await seal({ id: crypto.randomUUID(), at: Date.now(), type, ...fields });
    const res = await fetch('/api/command', { method: 'POST', headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ c }) });
    if (res.status === 503) return toast('Your Mac is not connected.');
    if (!res.ok) return toast(`Could not send (${res.status}).`);
    return true;
  } catch {
    toast('No connection.');
  }
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
      ws?.items.push(event.item);
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
      if (state.view.name === 'review' && state.view.id === event.id) state.view = state.view.from ?? { name: 'approvals' };
      break;
    case 'providers':
      if (state.picking) showProviders(event.list);
      break;
    case 'models':
      if (state.picking) showModels(event);
      break;
    case 'toast':
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
          if (name === 'agent') state.online = payload.online;
          else if (name === 'reset') {
            state.workspaces = new Map();
            state.approvals = [];
          } else if (name === 'entry') {
            state.since = payload.seq;
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
      if (err.name === 'AbortError') return;
    }
    state.linked = false;
    render();
    await new Promise((resolve) => setTimeout(resolve, wait));
    wait = Math.min(wait * 2, 15000);
  }
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
  Object.assign(state, { secret: null, token: null, key: null, since: 0, linked: false, online: false, device: null, workspaces: new Map(), approvals: [], error: message, view: { name: 'home' } });
  render();
}

// ── formatting ─────────────────────────────────────────────────────────────
const kilo = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const sizeOf = (n) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : `${Math.round(n / (n % 1024 === 0 && n % 1000 !== 0 ? 1024 : 1000))}k`);
const STATUS = { idle: ['Idle', 'muted'], working: ['Working', 'accent'], approval: ['Needs approval', 'amber'] };

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

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 3500);
}

function sheet(title, ...content) {
  const el = $('sheet');
  el.replaceChildren(h('div', { class: 'panel', onclick: (e) => e.stopPropagation() }, h('h3', {}, title), ...content));
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
        h('div', { class: 'muted' }, p.local ? 'local' : 'cloud', p.ready ? '' : ' · needs an API key — set it on the Mac with /key'),
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
          h('div', {}, m.name, m.name === active && h('span', { class: 'accent' }, '  • active')),
          m.hint && h('div', { class: 'muted' }, m.hint),
        ),
      ),
      shown.length ? null : h('div', { class: 'muted', style: 'padding:12px 4px' }, 'Nothing matches.'),
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
    await command('push_subscribe', { subscription: subscription.toJSON() });
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

// ── screens ────────────────────────────────────────────────────────────────
function brand() {
  const initial = (state.device?.name ?? 'S').trim()[0]?.toUpperCase() ?? 'S';
  return h('div', { class: 'brand' }, h('span', { icon: 'logo' }), h('span', { class: 'bar' }), h('div', {}, h('div', { class: 'word' }, 'SEEKER'), h('div', { class: 'sub' }, 'REMOTE')), h('div', { class: 'avatar' }, initial));
}

function deviceLine() {
  if (!state.linked) return ['off', 'Connecting to the relay…'];
  if (!state.online) return ['off', 'Mac offline — run `seeker remote` on it'];
  const first = [...state.workspaces.values()][0]?.meta;
  return ['on', first ? `${first.provider} connected` : 'Connected'];
}

function workspaceCard(ws) {
  const { meta } = ws;
  const [label, tone] = STATUS[meta.status] ?? STATUS.idle;
  return h(
    'button',
    { class: `card${meta.status === 'approval' ? ' attention' : ''}`, onclick: () => go({ name: 'session', ws: meta.id }) },
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'title line' }, meta.name),
      h('div', { class: 'muted line' }, meta.path),
      h('div', { class: 'line' }, meta.branch || 'no git', h('span', { class: 'sep' }, '•'), meta.status === 'approval' && h('span', { class: 'dot warn', style: 'margin-right:8px' }), h('span', { class: tone }, label)),
      meta.activity && h('div', { class: 'muted line' }, `${meta.activity}…`),
    ),
    h('span', { icon: 'chevron' }),
  );
}

function addWorkspace() {
  const input = h('input', { class: 'field', placeholder: '~/project-folder', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const open = async (folder) => {
    if (!folder.trim()) return;
    closeSheet();
    if (await command('open', { path: folder.trim() })) toast(`Opening ${folder.trim()}…`);
  };
  const opened = new Set([...state.workspaces.values()].map((w) => w.meta.path));
  sheet(
    'Open a project',
    h('form', { onsubmit: (e) => (e.preventDefault(), open(input.value)) }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Open')),
    h('div', { class: 'muted', style: 'margin:6px 0' }, 'On your Mac:'),
    ...state.folders.filter((f) => !opened.has(f)).map((f) => h('button', { class: 'row-btn', onclick: () => open(f) }, f)),
  );
}

function home() {
  const [tone, text] = deviceLine();
  const list = [...state.workspaces.values()];
  const first = list[0]?.meta;
  const ready = state.linked && state.online;
  const quick = (label, action) => h('button', { class: 'chip', onclick: action }, label);
  const pick = (title, then) => {
    if (!list.length) return toast('Open a project first.');
    if (list.length === 1) return then(list[0].meta);
    sheet(title, ...list.map((w) => h('button', { class: 'row-btn', onclick: () => (closeSheet(), then(w.meta)) }, w.meta.name)));
  };
  return [
    brand(),
    h('hr'),
    h('h1', { class: 'hero' }, 'Build from anywhere.'),
    h('p', {}, 'Your local coding companion.'),
    h('div', { class: 'card' }, h('span', { class: `dot ${tone}` }), h('div', { class: 'grow' }, h('div', { class: 'title line' }, state.device?.name ?? 'Your Mac'), h('div', { class: 'muted line' }, text)), h('span', { icon: 'laptop' })),
    h('div', { class: 'badges' }, first && !first.local ? 'CLOUD' : 'LOCAL', h('i', {}, '•'), first && !first.local ? first.provider.toUpperCase() : 'PRIVATE', h('i', {}, '•'), ready ? 'READY' : h('span', { class: 'amber' }, 'OFFLINE')),
    h('hr'),
    h('div', { class: 'section' }, 'WORKSPACES', h('button', { 'aria-label': 'Open a project', onclick: addWorkspace }, '+')),
    list.length ? list.map(workspaceCard) : h('div', { class: 'empty' }, ready ? 'No project open yet. Tap + to open one.' : 'Waiting for your Mac…'),
    h('hr'),
    h('div', { class: 'section' }, 'QUICK START'),
    h(
      'div',
      { class: 'chips' },
      quick('/init', () => pick('Set up which project?', (m) => (go({ name: 'session', ws: m.id }), sendText(m.id, INIT)))),
      quick('/model', () => go({ name: 'settings' })),
      quick('/resume', () => go({ name: 'sessions' })),
    ),
    h('hr'),
    first && h('div', { class: 'footline' }, h('span', {}, first.model), h('span', {}, h('span', { class: 'accent' }, '• '), `${sizeOf(first.limit)} context`)),
  ];
}

const INIT = 'Explore this project (list the root, read the README and the main manifest/config files, look at the folder structure) and then write a SEEKER.md file in the working directory describing what the project is, the tech stack, how to install / run / test / build it, the folder layout, and conventions visible in the code. Keep it under 80 lines and include only what you verified.';

function sendText(wsId, text) {
  return command('message', { ws: wsId, text });
}

function stepRow(item) {
  const mark = item.state === 'done' ? '✓' : item.state === 'failed' ? '✗' : '◌';
  const verb = item.state === 'done' ? item.done : item.doing;
  return h('div', { class: `step ${item.state}` }, h('span', { class: 'mark' }, mark), h('span', { class: 'text' }, `${verb} ${item.summary}`.trim(), item.state === 'running' && '…', item.note && h('span', { class: 'note' }, ` · ${item.note}`)));
}

function transcript(items) {
  const out = [];
  let steps = null;
  for (const item of items) {
    if (item.kind === 'tool') {
      if (!steps) out.push((steps = h('div', { class: 'steps' })));
      steps.append(stepRow(item));
      continue;
    }
    steps = null;
    if (item.kind === 'user') out.push(h('div', { class: 'user' }, item.text));
    else if (item.kind === 'assistant') {
      if (item.text) out.push(h('div', { class: 'assistant' }, h('span', { class: 'who' }, h('span', { icon: 'logo' }), 'SEEKER'), h('span', { class: 'muted' }, '| '), ...prose(item.text)));
    } else out.push(h('div', { class: `notice ${item.level}` }, item.text));
  }
  return out;
}

function session(ws) {
  if (!ws) return [h('div', { class: 'topbar' }, h('button', { class: 'back', onclick: () => go({ name: 'home' }) }, '‹'), h('div', { class: 'name' }, 'Closed')), h('div', { class: 'empty' }, 'This project is no longer open.')];
  const { meta, items } = ws;
  const lastOutput = [...items].reverse().find((i) => i.kind === 'tool' && i.output?.length);
  const pending = state.approvals.find((a) => a.ws === meta.id);
  const menu = () =>
    sheet(
      meta.name,
      h('button', { class: 'row-btn', onclick: () => (closeSheet(), sendText(meta.id, INIT)) }, '/init — write SEEKER.md for this project'),
      h('button', { class: 'row-btn', onclick: () => (closeSheet(), command('new', { ws: meta.id })) }, '/new — start a new conversation'),
      h('button', { class: 'row-btn red', onclick: () => (closeSheet(), command('close', { ws: meta.id }), go({ name: 'home' })) }, 'Close this project'),
    );
  return [
    h('div', { class: 'topbar' }, h('button', { class: 'back', 'aria-label': 'Back', onclick: () => go({ name: 'home' }) }, '‹'), h('div', { class: 'grow' }, h('div', { class: 'name' }, meta.name), h('div', { class: 'muted' }, meta.branch || 'no git', h('span', { class: 'sep' }, '•'), state.device?.name ?? 'Mac')), h('button', { class: 'more', 'aria-label': 'More', onclick: menu }, '•••')),
    h('hr'),
    h('button', { class: 'pill', 'aria-label': 'Change model', onclick: chooseModel }, h('span', {}, meta.model, h('span', { class: 'muted' }, '  ⌄')), h('span', { class: 'state' }, h('span', { class: `dot ${state.online ? 'on' : 'off'}` }), h('span', { class: state.online ? 'green' : 'red' }, state.online ? 'Connected' : 'Offline'))),
    items.length ? transcript(items) : h('div', { class: 'empty' }, 'Ask Seeker to build, fix, or explore.'),
    pending && h('button', { class: 'card attention', style: 'margin-top:14px', onclick: () => go({ name: 'review', id: pending.id, from: state.view }) }, h('span', { class: 'dot warn' }), h('div', { class: 'grow' }, h('div', { class: 'title amber' }, pending.kind === 'question' ? 'Seeker has a question' : 'Approval required'), h('div', { class: 'muted line' }, pending.kind === 'question' ? pending.title : `${pending.doing} ${pending.summary}`)), h('span', { icon: 'chevron' })),
    lastOutput && h('details', { class: 'output' }, h('summary', {}, 'TOOL OUTPUT'), h('div', { class: 'body' }, h('pre', {}, lastOutput.output.join('\n')))),
    meta.progress &&
      h(
        'div',
        { class: 'progress' },
        h('div', { class: 'section', style: 'margin:0' }, 'TASK PROGRESS'),
        h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.round((meta.progress.done / meta.progress.total) * 100)}%` })),
        h('div', { class: 'muted' }, meta.progress.current || (meta.progress.done === meta.progress.total ? 'All steps done' : 'In progress'), h('span', { class: 'sep' }, '•'), `${meta.progress.done} of ${meta.progress.total} steps`),
      ),
  ];
}

function diffView(approval) {
  const { diff } = approval;
  if (!diff || (!diff.removed?.length && !diff.added?.length)) return null;
  return [
    h('hr'),
    h('div', { class: 'section' }, 'PROPOSED CHANGES', h('span', {}, h('span', { class: 'green' }, `+${diff.added.length} `), h('span', { class: 'red' }, `−${diff.removed.length}`))),
    h('div', { class: 'diff' }, h('div', { class: 'file' }, approval.summary), ...diff.removed.map((l) => h('div', { class: 'row del' }, `− ${l}`)), ...diff.added.map((l) => h('div', { class: 'row add' }, `+ ${l}`)), diff.more ? h('div', { class: 'row muted' }, `… ${diff.more} more lines`) : null),
  ];
}

function review(approval) {
  const back = () => go(state.view.from ?? { name: 'approvals' });
  if (!approval) return [h('div', { class: 'topbar' }, h('button', { class: 'back', onclick: back }, '‹'), h('div', { class: 'name' }, 'Review action')), h('div', { class: 'empty' }, 'Already answered.')];
  if (approval.kind === 'question') {
    const reply = h('input', { class: 'field', placeholder: approval.options.length ? 'Or type your own answer…' : 'Type your answer…' });
    const answer = async (text) => {
      if (!text.trim()) return toast('Type an answer first.');
      if (await command('answer', { id_approval: approval.id, answer: text.trim() })) back();
    };
    return h(
      'div',
      { class: 'review' },
      h('div', { class: 'topbar' }, h('button', { class: 'back', 'aria-label': 'Back', onclick: back }, '‹'), h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Question'), h('div', { class: 'muted' }, approval.wsName, h('span', { class: 'sep' }, '•'), 'current session'))),
      h('hr'),
      h('div', { class: 'amber' }, h('span', { class: 'dot warn', style: 'margin-right:10px' }), 'Seeker is waiting for your answer'),
      h('h2', { class: 'question' }, approval.title),
      h('div', { style: 'margin-top:14px' }, ...approval.options.map((option, i) => h('button', { class: i === 0 ? 'btn primary' : 'btn', onclick: () => answer(option) }, option))),
      h('form', { onsubmit: (e) => (e.preventDefault(), answer(reply.value)) }, reply, h('button', { class: 'btn quiet', type: 'submit' }, 'Send answer')),
    );
  }
  const note = h('input', { class: 'field', placeholder: 'Or say what to do instead…' });
  const decide = async (decision) => {
    if (await command('approve', { id_approval: approval.id, decision, note: note.value })) back();
  };
  const isCommand = approval.kind === 'exec';
  const what = { exec: 'run this command', write: 'change this file', net: 'open this address', other: 'use this tool' }[approval.kind];
  return h(
    'div',
    { class: 'review' },
    h('div', { class: 'topbar' }, h('button', { class: 'back', 'aria-label': 'Back', onclick: back }, '‹'), h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Review action'), h('div', { class: 'muted' }, approval.wsName, h('span', { class: 'sep' }, '•'), 'current session'))),
    h('hr'),
    h('div', { class: 'amber' }, h('span', { class: 'dot warn', style: 'margin-right:10px' }), 'Approval required'),
    h('h2', {}, approval.title),
    h('div', {}, `Seeker is requesting access to ${what}.`),
    approval.warning && h('div', { class: 'amber', style: 'margin-top:8px' }, `⚠ ${approval.warning}`),
    h('div', { class: 'box' }, h('div', { class: `cmd${isCommand ? '' : ' plain'}` }, isCommand ? approval.summary : `${approval.doing} ${approval.summary}`), h('div', { class: 'meta' }, h('div', { class: 'muted' }, 'Working directory'), h('div', {}, approval.cwd))),
    h('button', { class: 'btn primary', onclick: () => decide('allow') }, 'Allow once'),
    h('button', { class: 'btn', onclick: () => decide('deny') }, 'Deny'),
    approval.always && h('button', { class: 'btn quiet', onclick: () => decide('always') }, approval.always[0].toUpperCase() + approval.always.slice(1)),
    note,
    diffView(approval),
    h('p', { class: 'muted' }, 'Each command and each change is approved separately.'),
  );
}

function approvals() {
  return [
    h('div', { class: 'section' }, 'APPROVALS'),
    state.approvals.length
      ? state.approvals.map((a) => h('button', { class: 'card attention', onclick: () => go({ name: 'review', id: a.id, from: { name: 'approvals' } }) }, h('span', { class: 'dot warn' }), h('div', { class: 'grow' }, h('div', { class: 'title line' }, a.kind === 'question' ? 'Question' : a.title), h('div', { class: 'line' }, a.kind === 'question' ? a.title : `${a.doing} ${a.summary}`), h('div', { class: 'muted line' }, a.wsName)), h('span', { icon: 'chevron' })))
      : h('div', { class: 'empty' }, 'Nothing is waiting for you.'),
  ];
}

function sessions() {
  const list = [...state.workspaces.values()].filter((w) => w.items.length).sort((a, b) => (b.items.at(-1)?.at ?? 0) - (a.items.at(-1)?.at ?? 0));
  return [
    h('div', { class: 'section' }, 'SESSIONS'),
    list.length
      ? list.map((w) => {
          const last = [...w.items].reverse().find((i) => i.kind === 'user');
          return h('button', { class: 'card', onclick: () => go({ name: 'session', ws: w.meta.id }) }, h('div', { class: 'grow' }, h('div', { class: 'title line' }, w.meta.name), h('div', { class: 'muted line' }, last ? `› ${last.text}` : ''), h('div', { class: 'line' }, `${w.items.length} entries`)), h('span', { icon: 'chevron' }));
        })
      : h('div', { class: 'empty' }, 'No conversation yet.'),
  ];
}

function settings() {
  const [tone, text] = deviceLine();
  const first = [...state.workspaces.values()][0]?.meta;
  const model = first ? `${first.model} · ${first.provider}` : state.device?.model ? `${state.device.model} · ${state.device.provider}` : '—';
  const notifications = {
    unsupported: [h('div', {}, 'Not available in this browser.'), h('div', { class: 'muted', style: 'margin-top:6px' }, 'On iPhone: tap Share → Add to Home Screen, then open SEEKER from the home screen and come back here.')],
    denied: [h('div', { class: 'amber' }, 'Blocked for this site.'), h('div', { class: 'muted', style: 'margin-top:6px' }, 'Allow notifications for SEEKER in your phone’s settings, then reopen the app.')],
    off: [h('div', {}, 'Off. Turn them on to hear about approvals, questions and finished tasks while the app is closed.'), h('button', { class: 'btn primary', style: 'margin-top:12px', onclick: enablePush }, 'Turn on notifications')],
    on: [h('div', { class: 'green' }, 'On for this phone.'), h('button', { class: 'btn quiet', style: 'margin-top:12px', onclick: () => command('push_test') }, 'Send a test'), h('button', { class: 'btn quiet', onclick: disablePush }, 'Turn off')],
    unknown: [h('div', { class: 'muted' }, 'Checking…')],
  }[state.push];
  return [
    h('div', { class: 'section' }, 'SETTINGS'),
    h('div', { class: 'card' }, h('span', { class: `dot ${tone}` }), h('div', { class: 'grow' }, h('div', { class: 'title' }, state.device?.name ?? 'Your Mac'), h('div', { class: 'muted' }, text))),
    h('div', { class: 'box' }, h('div', { class: 'muted' }, 'Model'), h('div', {}, model), h('button', { class: 'btn quiet', style: 'margin:12px 0 0', onclick: chooseModel }, 'Change model')),
    h('div', { class: 'box' }, h('div', { class: 'muted' }, 'Notifications'), ...notifications),
    h('div', { class: 'box' }, h('div', { class: 'muted' }, 'Privacy'), h('div', {}, 'Messages are encrypted between this phone and your Mac. The relay server only passes them along and cannot read them. Notifications are encrypted for this phone too.')),
    h('button', { class: 'btn quiet', onclick: () => command('sync') }, 'Refresh from the Mac'),
    h('button', { class: 'btn quiet red', onclick: () => confirm('Remove the pairing from this phone?') && signOut() }, 'Unpair this phone'),
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
  return h(
    'div',
    { class: 'login' },
    brand(),
    h('hr'),
    h('h1', { class: 'hero' }, 'Pair this phone.'),
    h('p', {}, 'On your Mac, run `seeker remote --setup` and open the link it prints on this phone — or paste it here.'),
    state.error && h('p', { class: 'amber' }, state.error),
    h('form', { onsubmit: submit }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Pair')),
  );
}

// ── render ─────────────────────────────────────────────────────────────────
const NAV = [
  ['home', 'Projects', 'folder'],
  ['sessions', 'Sessions', 'terminal'],
  ['approvals', 'Approvals', 'shield'],
  ['settings', 'Settings', 'gear'],
];
let queued = false;

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
  view.replaceChildren(...[content].flat(3).filter(Boolean));
  view.scrollTop = pinned || view.dataset.screen !== `${name}:${state.view.ws ?? ''}` ? (name === 'session' ? view.scrollHeight : 0) : scroll;
  view.dataset.screen = `${name}:${state.view.ws ?? ''}`;

  const inSession = paired && name === 'session' && ws;
  $('composer').hidden = !inSession;
  if (inSession) {
    const busy = ws.meta.status !== 'idle';
    $('stop').hidden = !busy;
    $('send').disabled = busy || !state.online;
    $('context').textContent = `Context  ${Math.round((ws.meta.used / ws.meta.limit) * 100)}%`;
    $('tokens').textContent = `${kilo(ws.meta.used)} / ${sizeOf(ws.meta.limit)} tokens`;
    $('input').placeholder = busy ? 'Seeker is working…' : 'Ask Seeker…';
  }

  const nav = $('nav');
  nav.hidden = !paired || name === 'session' || name === 'review';
  nav.replaceChildren(
    ...NAV.map(([id, label, icon]) =>
      h('button', { class: state.view.name === id ? 'active' : '', onclick: () => go({ name: id }) }, h('span', { icon }), label, id === 'approvals' && state.approvals.length > 0 && h('span', { class: 'count' }, state.approvals.length)),
    ),
  );
  document.title = state.approvals.length ? `(${state.approvals.length}) SEEKER Remote` : 'SEEKER Remote';
}

// ── composer (kept outside the redrawn area so typing is never interrupted) ──
const input = $('input');
$('send').innerHTML = ICONS.send;
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !state.view.ws) return;
  if (await sendText(state.view.ws, text)) {
    input.value = '';
    input.style.height = 'auto';
  }
});
$('stop').addEventListener('click', () => command('stop', { ws: state.view.ws }));
$('commands').addEventListener('click', () => {
  const id = state.view.ws;
  sheet(
    'Commands',
    h('button', { class: 'row-btn', onclick: () => (closeSheet(), sendText(id, INIT)) }, '/init — write SEEKER.md for this project'),
    h('button', { class: 'row-btn', onclick: () => (closeSheet(), command('new', { ws: id })) }, '/new — start a new conversation'),
    h('button', { class: 'row-btn', onclick: () => (closeSheet(), command('stop', { ws: id })) }, '/stop — cancel what it is doing'),
  );
});

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
