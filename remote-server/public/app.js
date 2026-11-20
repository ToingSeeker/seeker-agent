// SEEKER Remote — the phone app.
//
// Everything shown here arrives encrypted from the Mac and is decrypted in
// this page with a key derived from the pairing secret, which stays on this
// device (localStorage) and is never sent to the server. Text from the Mac is
// always inserted as text, never as HTML.
//
// Nothing on these screens is made up here: statuses, counts and timings come
// from the Mac's events, and a value the Mac has not reported is shown as "—".

import { SOURCES, WORKSPACE_SORTS, activity, connection, crew, current, localFolders, summary, workspaces as explorerRows } from './home.js';
import { SORTS, STATUSES, filters, queues, since, statusOf, switcher, view as sessionsView } from './sessions.js';
import { RANGES, compact, dayLabel, fullDay, labelled, percent, shortDay, view as usageView } from './usage.js';
import { filterLabel, filterTools, toolFilters as filtersFor } from './tools.js';
import { gatePlan, openGate } from './jackin.js';
import { MOODS, SUCCESS_FOR, Steady, badgeCount, mood as moodOf } from './robot.js';
import { CHARACTERS, CHARACTER_SETTING, CHOICES, FACES, PROJECT_CHARACTERS, characterLabel, characterSettingFor, drawCharacter, pickCharacter, readProjectCharacters } from './characters.js';
import { cardPicture, fileKind, filesSummary, folderOf, listZip, pdfPages, plainName, playTime, previewKind, splitName, splitSent, typeName } from './files.js';
import { clearKept, forget, kept, keptList, keptSize, store as keepFile } from './keep.js';
import { ACTIVE_KEY, AFTER_OPTIONS, DEFAULT_AFTER, LOCKOUT_TRIES, PIN_LENGTH, afterLabel, checkPin, cleared, dueToLock, failed, lockedOut, makePin, readLock, sameId, triesLeft, userVerified, writeLock } from './lock.js';

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
  // The user, drawn on the robot's grid: brown hair, a cyan top, blinking and nodding on its own beat.
  you: `<svg class="human" viewBox="0 -1.5 11 11" shape-rendering="crispEdges" aria-hidden="true"><path class="s" d="M4 6h3v1H4z"/><path class="c" d="M2 7h7v1H2z"/><g class="head"><path class="h" d="M3 0h5v1H3zM2 1h7v1H2zM2 2h1v1H2zM8 2h1v1H8z"/><path class="s" d="M3 2h5v1H3zM2 3h7v2H2zM3 5h5v1H3z"/><path class="m" d="M5 5h1v1H5z"/><path class="e open" d="M4 3h1v1H4zM6 3h1v1H6z"/><path class="e shut" d="M4 3.45h1v.35H4zM6 3.45h1v.35H6z"/></g></svg>`,
  laptop: svg('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  folder: svg('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'),
  grid: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
  home: svg('<path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z"/>'),
  terminal: svg('<path d="M5 8l4 4-4 4M12 16h7"/>'),
  file: svg('<path d="M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5"/>'),
  shield: svg('<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  // Built from eight equal teeth, so it stays even at any size.
  gear: svg('<path d="M10.3 4.9L10.72 2.49L13.28 2.49L13.7 4.9L15.81 5.78L17.82 4.37L19.63 6.18L18.22 8.19L19.1 10.3L21.51 10.72L21.51 13.28L19.1 13.7L18.22 15.81L19.63 17.82L17.82 19.63L15.81 18.22L13.7 19.1L13.28 21.51L10.72 21.51L10.3 19.1L8.19 18.22L6.18 19.63L4.37 17.82L5.78 15.81L4.9 13.7L2.49 13.28L2.49 10.72L4.9 10.3L5.78 8.19L4.37 6.18L6.18 4.37L8.19 5.78z"/><circle cx="12" cy="12" r="3.1"/>'),
  cube: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  layers: svg('<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>'),
  bolt: svg('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 118 0v3"/>'),
  face: svg('<path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5V13h-1M9.5 15.5a3.5 3.5 0 005 0"/>'),
  wifi: svg('<path d="M3 9a14 14 0 0118 0M6 12.5a9.5 9.5 0 0112 0M9 16a5 5 0 016 0"/><circle cx="12" cy="19" r="0.6"/>'),
  pulse: svg('<path d="M3 12h4l2-6 4 12 2-6h6"/>'),
  list: svg('<path d="M8 7h12M8 12h12M8 17h12"/><circle cx="4" cy="7" r="0.6"/><circle cx="4" cy="12" r="0.6"/><circle cx="4" cy="17" r="0.6"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: svg('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
  share: svg('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M7 11H6a1 1 0 00-1 1v7a1 1 0 001 1h12a1 1 0 001-1v-7a1 1 0 00-1-1h-1"/>'),
  retry: svg('<path d="M4 12a8 8 0 0113.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 01-13.7 5.6L4 15.5"/><path d="M4 20v-4.5h4.5"/>'),
  wave: svg('<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>'),
  film: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M10 9.5v5l4-2.5z"/>'),
  image: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>'),
  camera: svg('<path d="M4 8.5A1.5 1.5 0 015.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z"/><circle cx="12" cy="12.8" r="3.4"/>'),
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
  swap: svg('<path d="M4 8.5h15M15.5 5l3.5 3.5-3.5 3.5M20 15.5H5M8.5 12L5 15.5 8.500 19"/>'.replace('8.500', '8.5')),
  stop: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 4l18 8-18 8 3-8zm3 8h7"/></svg>`,
};

// ── the robot, alive ─────────────────────────────────────────────────────────
// The logo robot with what it is doing around it. Its mood (robot.js) comes from the Mac's reports;
// style.css draws each one. Only transforms and opacity move, and nothing moves with reduced motion.
// `who` (characters.js) swaps the robot for the agent's character, whose face shows the mood.
function bot(mood, size = 'md', { label = true, who = null } = {}) {
  const fx = (cls, n, text = null) => h('span', { class: cls, 'aria-hidden': 'true' }, text ?? Array.from({ length: n }, () => h('i')));
  const name = who ? CHARACTERS[who.id].name : 'Seeker';
  const body = h('span', { class: 'body', icon: who ? null : 'logo' });
  if (who) body.innerHTML = drawCharacter(who, { face: FACES[mood] }); // fixed drawings; nothing from the Mac
  return h(
    'span',
    { class: `bot ${size} m-${mood}${who ? ' char' : ''}${state.device?.settings?.animation === false ? ' still' : ''}`, ...(label ? { role: 'img', 'aria-label': `${name}: ${MOODS[mood].toLowerCase()}` } : { 'aria-hidden': 'true' }) },
    h('span', { class: 'ring', 'aria-hidden': 'true' }),
    body,
    size !== 'sm' && [fx('orbit', 3), fx('code', 0, '</>'), fx('term', 3), fx('alert', 0, '!'), fx('spark', 6)],
  );
}

// The phone's choice of agent character (Settings): by model, one for every agent, or the robot.
let characterSetting = stored(CHARACTER_SETTING, 'auto');
// A project can have a character of its own (session menu), kept by its path; the rest follow the setting above.
let projectCharacters = readProjectCharacters(stored(PROJECT_CHARACTERS, '{}'));
/** Who stands in for the agent of a session; null keeps SEEKER's robot. */
const whoFor = (meta) => pickCharacter(characterSettingFor(characterSetting, projectCharacters, meta?.path), meta?.model, meta?.provider);

const steady = new Steady(); // keeps each robot's mood on screen long enough to be read
const moodTimers = new Map();
/** The mood to draw for `key`; asks for a redraw when a held or celebrated mood is due to change. */
function moodFor(key, ws) {
  const wanted = moodOf(ws, { up: state.linked && state.online });
  const shown = steady.next(key, wanted);
  const due = shown.at ?? (shown.mood === 'success' ? (ws.meta.lastAt ?? Date.now()) + SUCCESS_FOR : null);
  if (due && !moodTimers.has(key)) moodTimers.set(key, setTimeout(() => (moodTimers.delete(key), render(true)), Math.max(50, due - Date.now() + 20)));
  return shown.mood;
}

// ── the number on the app's icon ──
// The Mac counts what waits for the user (robot.js badgeCount); this only shows it. A push sets it
// while the app is closed (sw.js). Where the browser cannot badge an app, the counts in the dock remain.
let badgeShown = null;
function syncBadge() {
  if (state.secret && !state.loaded) return; // not known yet: leave what the last push set
  const n = state.secret ? badgeCount({ approvals: state.approvals, workspaces: [...state.workspaces.values()] }) : 0;
  if (n === badgeShown || !('setAppBadge' in navigator)) return;
  badgeShown = n;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
const seenSent = new Set(); // "<ws>:<lastAt>" already reported as seen, so a redraw does not repeat it

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
  crewPin: null, // the live session picked from the crew on Home, kept up front while it runs
  sessionTab: 'activity', // activity | tools | metrics
  toolFilter: 'all', // the Tools tab: all | failed | edits | commands | reads
  error: '',
  picking: false, // the model sheet is open and waiting for lists from the Mac
  push: 'unknown', // unsupported | off | on | denied
  lastEntryAt: null, // when the Mac was last heard from
  latency: null, // { ms, at } — a measured round trip to the Mac and back
  open: new Set(), // timeline entries the reader expanded
  shown: new Map(), // workspace id → how many entries are drawn
  deciding: new Set(), // approvals whose answer is on its way
  drafts: new Map(), // session id → what was typed there and not sent
  scrolls: new Map(), // "session:<id>:<tab>" → where the reader was in that view
  drawn: new Set(), // timeline entries already on screen once, so only new ones animate in
  loaded: false, // the Mac's list of projects has arrived at least once
  list: { query: '', searching: false, filter: 'all', sort: stored('seeker.sessions.sort', 'recent') }, // the Sessions screen
  usage: null, // token counts from the Mac's own ledger; null when the Mac does not send them
  everLinked: false, // the relay has answered at least once since the app opened
  explorer: { query: '', sort: stored('seeker.workspaces.sort', 'recent'), source: 'all', local: false, localQuery: '' }, // Home → Projects
  lastSession: stored('seeker.sessions.last', null), // the session opened last, marked in the list
  locked: false, // the app lock is up: nothing behind it is shown until Face ID or the PIN
  faceIdAvailable: null, // this phone can unlock with Face ID / Touch ID (null: not known yet)
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

const SESSION_TABS = ['activity', 'tools', 'metrics'];
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

// A piece of a file: sealed on its own, with the file's id and the piece's number bound in, so the
// relay cannot swap or reorder pieces unnoticed (src/transfer.mjs does the same on the Mac).
const CHUNK_BYTES = 2 * 1024 * 1024; // must match src/transfer.mjs
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const chunkLabel = (id, n) => enc.encode(`seeker-chunk-v1:${id}:${n}`);

async function sealChunk(id, n, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: chunkLabel(id, n) }, state.key, bytes));
  const out = new Uint8Array(12 + body.length);
  out.set(iv);
  out.set(body, 12);
  return toBase64(out);
}

async function unsealChunk(id, n, text) {
  const raw = fromBase64(text);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: chunkLabel(id, n) }, state.key, raw.subarray(12)));
}

const fileSize = (bytes) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const transferId = () => crypto.randomUUID().replace(/-/g, '');

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
      state.usage = event.usage ?? null;
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
    case 'usage':
      state.usage = event.usage ?? null;
      break;
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
    case 'moved':
      // The conversation open here went on in a terminal on the Mac: follow it there.
      if (state.view.name === 'session' && state.view.ws === event.from && state.workspaces.has(event.to)) go({ name: 'session', ws: event.to });
      break;
    case 'opened':
      // Only the phone that just asked follows it there; this event reaches every phone.
      if (state.opening && Date.now() - state.opening < 15_000 && state.workspaces.has(event.id)) {
        state.opening = 0;
        if (event.created) toast('Folder created.');
        go({ name: 'session', ws: event.id });
      }
      break;
    case 'file':
      pictureArrived(event);
      break;
    case 'download':
      downloadArrived(event);
      break;
    case 'choose':
      // The Mac answers a skill that has a list to pick from with that list. Only the phone that is
      // looking at that session shows it; the event reaches every phone.
      if (state.view.name === 'session' && state.view.ws === event.ws && Array.isArray(event.items)) (event.mode === 'send' ? chooseSend : event.mode === 'one' ? chooseOne : chooseMany)(event);
      break;
    case 'settings':
      if (state.view.name === 'session' && state.view.ws === event.ws && Array.isArray(event.items)) showSettings(event);
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
  clearKept(); // files from the Mac kept here go with the pairing
  state.keptInfo = undefined;
  keptPaths = null;
  transfers.clear();
  Object.assign(state, { secret: null, token: null, key: null, since: 0, linked: false, online: false, device: null, workspaces: new Map(), approvals: [], error: message, view: { name: 'home' }, latency: null, lastEntryAt: null });
  // Nothing of the old pairing stays on this phone: no number on the icon, and no more pushes from that Mac
  // (its next one is refused, and the Mac forgets this phone).
  badgeShown = null;
  if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
  navigator.serviceWorker?.getRegistration().then((r) => r?.pushManager.getSubscription()).then((s) => s?.unsubscribe()).catch(() => {}).finally(refreshPush);
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

let liveSheet = null; // { title, build, signature } — a sheet whose content follows the Mac's events
let sheetOpener = null; // the id of what opened the sheet: focus goes back there when it closes
let sheetPressed = false; // a finger is down on the sheet: its rows are not moved under it
let sheetFromLive = false; // sheet() is being called to redraw the live sheet, not to open another
let sheetKeeps = null; // a video the sheet being drawn carries over from the one it replaces: it plays on

/** A bottom sheet. `title` is its heading, or { label, head } for a sheet that draws its own heading. */
function sheet(title, ...content) {
  const el = $('sheet');
  if (el.hidden) sheetOpener = document.activeElement?.id || null;
  if (!sheetFromLive) liveSheet = null; // another sheet takes the place of a live one
  const own = title && typeof title === 'object';
  // A video or sound in the sheet being replaced stops; it would play on unseen otherwise.
  for (const media of el.querySelectorAll('video, audio')) if (media !== sheetKeeps) media.pause();
  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': own ? title.label : title, tabindex: '-1', onclick: (e) => e.stopPropagation() }, h('div', { class: 'grip' }), own ? title.head : h('h3', {}, title), ...content);
  // Pulled down from its top, the sheet goes away.
  let from = null;
  panel.addEventListener('touchstart', (e) => ((sheetPressed = true), (from = panel.scrollTop <= 0 ? e.touches[0].clientY : null)), { passive: true });
  panel.addEventListener('touchmove', (e) => from != null && (panel.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - from)}px)`), { passive: true });
  panel.addEventListener('touchend', (e) => {
    sheetPressed = false;
    const pulled = from != null ? e.changedTouches[0].clientY - from : 0;
    from = null;
    panel.style.transform = '';
    if (pulled > 90) closeSheet();
    else if (liveSheet) drawSheet();
  });
  panel.addEventListener('pointerdown', () => (sheetPressed = true));
  for (const end of ['pointerup', 'pointercancel', 'pointerleave']) panel.addEventListener(end, () => (sheetPressed = false));
  el.replaceChildren(panel);
  el.hidden = false;
  el.onclick = closeSheet;
  if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
}
const closeSheet = () => {
  const wasOpen = !$('sheet').hidden;
  for (const media of $('sheet').querySelectorAll('video, audio')) media.pause();
  $('sheet').hidden = true;
  state.picking = false;
  liveSheet = null;
  sheetPressed = false;
  if (wasOpen && sheetOpener) $(sheetOpener)?.focus({ preventScroll: true });
  sheetOpener = null;
};
document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('sheet').hidden && closeSheet());

/** A sheet that is rebuilt when what it shows changes. `build` returns { signature, content }. */
function openLive(title, build) {
  liveSheet = { title, build, signature: null };
  drawSheet();
}
function drawSheet() {
  if (!liveSheet || sheetPressed) return;
  const { signature, content } = liveSheet.build();
  if (signature === liveSheet.signature && !$('sheet').hidden) return;
  const keep = liveSheet;
  const at = $('sheet').querySelector('.panel')?.scrollTop ?? 0;
  const focused = $('sheet').contains(document.activeElement) ? document.activeElement.dataset.key : null;
  sheetFromLive = true;
  sheet(keep.title, ...content());
  sheetFromLive = false;
  liveSheet = { ...keep, signature };
  const panel = $('sheet').querySelector('.panel');
  panel.scrollTop = at;
  panel.style.animation = at || keep.signature != null ? 'none' : '';
  if (focused) [...panel.querySelectorAll('[data-key]')].find((el) => el.dataset.key === focused)?.focus({ preventScroll: true });
}

// ── the quick switcher: every session, from the header of any main screen ──
function openSwitcher() {
  openLive('Agent Quick Switcher', () => {
    const up = state.linked && state.online;
    const model = switcher([...state.workspaces.values()], { up });
    const chip = (icon, n, label, tone = '') => h('span', { class: `sw-chip ${tone}` }, h('span', { class: 'ico', icon }), `${n} ${label}`);
    return {
      signature: JSON.stringify([up, state.loaded, model]),
      content: () => [
        h('p', { class: 'sheet-sub' }, 'Jump between active coding sessions'),
        h('div', { class: 'sw-chips' }, chip('layers', model.sessions, model.sessions === 1 ? 'session' : 'sessions'), chip('play', model.running, 'running', model.running ? 'execution' : ''), chip('list', model.queued, 'queued', model.queued ? 'warning' : '')),
        !up && h('p', { class: 'stale', role: 'status' }, 'Not connected: what each session is doing cannot be confirmed.'),
        model.rows.length
          ? h(
              'div',
              { class: 's-list sw-list', onkeydown: rowKeys },
              model.rows.map((row) =>
                h(
                  'button',
                  { class: `s-row sw-row${row.id === state.view.ws && state.view.name === 'session' ? ' selected' : ''}`, 'data-key': row.id, onclick: () => (closeSheet(), go({ name: 'session', ws: row.id })) },
                  state.workspaces.has(row.id) ? bot(moodOf(state.workspaces.get(row.id), { up }), 'sm', { label: false, who: whoFor(state.workspaces.get(row.id).meta) }) : h('span', { class: 'ico', icon: 'folder' }),
                  h(
                    'span',
                    { class: 'grow' },
                    h('span', { class: 'top' }, h('span', { class: 'name line' }, row.name), h('span', { class: `pill ${row.tone}` }, h('i', { class: row.live ? 'live' : '' }), row.label)),
                    h('span', { class: 'meta line' }, [row.terminal && 'terminal', row.branch, row.provider].filter(Boolean).join(' · ')),
                    row.doing && h('span', { class: 'doing line' }, h('span', { class: 'ico', icon: 'terminal' }), row.doing),
                    row.waiting > 0 && h('span', { class: 'doing line' }, h('span', { class: 'ico', icon: 'layers' }), `${row.waiting} queued instruction${row.waiting === 1 ? '' : 's'}`),
                  ),
                  h('span', { class: 'chev', icon: 'chevron' }),
                ),
              ),
            )
          : h('p', { class: 'quiet pad' }, state.loaded ? 'No session is open yet.' : 'Waiting for your Mac…'),
        model.more > 0 && h('p', { class: 'muted small pad' }, `${model.more} more in Sessions.`),
        h('button', { class: 'sw-action', 'data-key': 'queues', disabled: !model.queued, onclick: openQueues }, h('span', { class: 'ico', icon: 'layers' }), h('span', { class: 'grow' }, 'Queued instructions'), h('span', { class: 'n' }, model.queued), h('span', { class: 'chev', icon: 'chevron' })),
        h('button', { class: 'sw-action all', 'data-key': 'all', onclick: () => (closeSheet(), go({ name: 'sessions' })) }, h('span', { class: 'grow' }, 'View all sessions'), h('span', { class: 'chev', icon: 'chevron' })),
      ],
    };
  });
}

/** Every waiting instruction, by session. Removing and resuming are the same commands the session screen sends. */
function openQueues() {
  openLive('Queued instructions', () => {
    const up = state.linked && state.online;
    const list = queues([...state.workspaces.values()]);
    return {
      signature: JSON.stringify([up, list]),
      content: () => [
        h('button', { class: 'sheet-back', 'data-key': 'back', onclick: openSwitcher }, h('span', { class: 'ico', icon: 'back' }), 'All sessions'),
        list.length ? null : h('p', { class: 'quiet pad' }, 'Nothing is waiting.'),
        ...list.map((q) =>
          h(
            'section',
            { class: 'q-group' },
            h(
              'div',
              { class: 'head' },
              h('button', { class: 'name line', 'data-key': `open-${q.id}`, 'aria-label': `Open ${q.name}`, onclick: () => (closeSheet(), go({ name: 'session', ws: q.id })) }, q.name),
              q.paused && h('button', { class: 'btn small approve', 'data-key': `resume-${q.id}`, disabled: !up, onclick: () => command('queue_resume', { ws: q.id }) }, 'Resume queue'),
            ),
            q.paused && h('p', { class: 'paused' }, PAUSED[q.paused] ?? 'Paused.'),
            h('ol', {}, q.items.map((item, i) => h('li', {}, h('span', { class: 'n mono' }, `${i + 1}.`), h('span', { class: 'text' }, item.text), h('button', { class: 'x', 'data-key': `x-${item.id}`, 'aria-label': `Remove instruction ${i + 1} of ${q.name}`, icon: 'cross', disabled: !up, onclick: () => command('queue_remove', { ws: q.id, item: item.id }) })))),
          ),
        ),
      ],
    };
  });
}

// ── choosing the model (the lists come from the Mac) ──
// From inside a project (`ws`) the choice is that project's only, and the Mac keeps it for the project.
// Without one (Settings) it is the default: every project without a model of its own follows it.
const modelTarget = () => (state.modelFor ? { ws: state.modelFor } : {});
function modelTitle() {
  const meta = state.modelFor && state.workspaces.get(state.modelFor)?.meta;
  return meta ? `Model for ${meta.name}` : 'Default model';
}

async function chooseModel(ws = null) {
  state.picking = true;
  state.modelFor = typeof ws === 'string' ? ws : null;
  sheet(modelTitle(), h('div', { class: 'muted' }, 'Asking your Mac…'));
  if (!(await command('providers', modelTarget()))) closeSheet();
}

function showProviders(list) {
  const meta = state.modelFor && state.workspaces.get(state.modelFor)?.meta;
  sheet(
    modelTitle(),
    h('div', { class: 'muted small pad' }, meta ? `Only ${meta.name} changes, and it keeps this model when opened again.` : 'Used by every project that has no model of its own.'),
    meta?.ownModel &&
      h(
        'button',
        { class: 'row-btn', onclick: () => ((state.picking = false), closeSheet(), command('model', { ws: meta.id, reset: true })) },
        h('div', {}, 'Use the default model'),
        h('div', { class: 'muted small' }, `${state.device?.model ?? 'the default'} · ${meta.name} follows Settings again`),
      ),
    ...list.map((p) =>
      h(
        'button',
        {
          class: 'row-btn',
          disabled: !p.ready && !p.key,
          onclick: () => {
            if (!p.ready) return enterKey(p);
            sheet(p.label, h('div', { class: 'muted' }, 'Loading its models…'));
            command('models', { provider: p.id, ...modelTarget() });
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
              command('model', { provider, model: m.name, ...modelTarget() });
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
  if (view.name === 'session' && view.ws !== state.view.ws && view.ws !== state.view.from?.ws) (state.sessionTab = 'activity'), (state.toolFilter = 'all');
  if (view.name === 'session' && view.ws) store('seeker.sessions.last', (state.lastSession = view.ws));
  // What was being typed belongs to the session it was typed in: it waits there, and the next session shows its own.
  const from = state.view.name === 'session' ? state.view.ws : null;
  const to = view.name === 'session' ? view.ws : null;
  if (from && from !== to) state.drafts.set(from, input.value);
  if (to && to !== from) {
    input.value = state.drafts.get(to) ?? '';
    input.dispatchEvent(new Event('input'));
  }
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
  const { running } = switcher([...state.workspaces.values()], { up: state.linked && state.online });
  return h(
    'header',
    { class: 'brand' },
    h('span', { class: state.device?.settings?.animation === false ? 'mark still' : 'mark', icon: 'logo' }),
    h('div', { class: 'grow' }, h('div', { class: 'word' }, 'SEEKER'), h('div', { class: 'sub' }, 'REMOTE')),
    h('button', { class: 'switch-btn', id: 'switcher', 'aria-label': `Switch agent session${running ? ` — ${running} running session${running === 1 ? '' : 's'}` : ''}`, 'aria-haspopup': 'dialog', onclick: openSwitcher }, h('span', { icon: 'swap' }), running > 0 && h('span', { class: 'count', 'aria-hidden': 'true' }, running)),
  );
}

/** A strip across the top whenever what is on screen may be out of date. */
function linkBanner() {
  if (!state.secret) return null;
  const strip = (tone, mark, title, sub) =>
    h('div', { class: `banner link ${tone}`, role: 'status' }, mark, h('div', { class: 'grow' }, h('div', { class: 'title' }, title), h('div', { class: 'sub' }, ...sub)));
  if (!state.linked) return strip('warning', h('i', { class: 'spin' }), 'Reconnecting to the relay…', ['What is on screen may be out of date.']);
  if (!state.online) return strip('danger', dot('off'), 'Your Mac is offline', ['Run ', h('code', {}, 'seeker remote'), ' on it to reconnect.']);
  return null;
}

/** The screen with the link banner placed under the sticky brand header, which would otherwise cover it. */
function withBanner(content) {
  const parts = [content].flat(3).filter(Boolean);
  const banner = linkBanner();
  if (!banner) return parts;
  const at = parts.findIndex((el) => el.classList?.contains('brand'));
  parts.splice(at + 1, 0, banner);
  return parts;
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

/**
 * A list to tick, sent by the Mac for a skill that has one (/effects and its forty-odd effects).
 * What is ticked goes back as `/skill a, b`, the way it would have been typed. The boxes are the
 * browser's own and the list is filtered by hiding rows, so typing never rebuilds what is on screen.
 */
function chooseMany({ ws, skill, title, items, attachment }) {
  const boxes = items.map((item) => h('input', { type: 'checkbox', value: item.value }));
  const rows = items.map((item, i) => h('label', { class: 'ck-row' }, boxes[i], h('span', { class: 'grow' }, h('span', { class: 'name mono' }, item.value), item.description && h('span', { class: 'sub' }, item.description))));
  const send = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Tick at least one');
  const picked = () => boxes.filter((box) => box.checked).map((box) => box.value);
  const count = () => {
    const n = picked().length;
    send.disabled = !n;
    send.textContent = n ? `Use ${n} selected` : 'Tick at least one';
  };
  send.addEventListener('click', () => {
    const values = picked();
    if (!values.length) return;
    closeSheet();
    // Files sent with the request go back with the answer, so the skill still has them.
    sendText(ws, `/${skill} ${values.join(', ')}${typeof attachment === 'string' && attachment ? `\n\n${attachment}` : ''}`);
  });
  const none = h('p', { class: 'quiet pad', hidden: true }, 'Nothing matches.');
  const filter =
    items.length > 8 &&
    h('input', {
      class: 'field ck-filter',
      type: 'text',
      inputmode: 'search',
      enterkeyhint: 'search',
      autocapitalize: 'off',
      autocomplete: 'off',
      placeholder: `Filter ${items.length} choices…`,
      'aria-label': 'Filter the list',
      oninput: (e) => {
        const q = e.target.value.trim().toLowerCase();
        let shown = 0;
        rows.forEach((row, i) => {
          row.hidden = Boolean(q) && !`${items[i].value} ${items[i].description ?? ''}`.toLowerCase().includes(q);
          if (!row.hidden) shown += 1;
        });
        none.hidden = shown > 0;
      },
    });
  // Ticks everything the filter leaves in view; when all of that is ticked already, it unticks it.
  const shown = () => boxes.filter((box, i) => !rows[i].hidden);
  const every = h('button', { class: 'btn quiet small ck-all', type: 'button' }, 'Select all');
  const relabel = () => {
    const visible = shown();
    every.disabled = !visible.length;
    every.textContent = visible.length && visible.every((box) => box.checked) ? 'Clear all' : visible.length < boxes.length ? `Select these ${visible.length}` : 'Select all';
  };
  every.addEventListener('click', () => {
    const visible = shown();
    const all = visible.every((box) => box.checked);
    for (const box of visible) box.checked = !all;
    count();
    relabel();
  });
  const list = h('div', { class: 'ck-list', role: 'group', 'aria-label': title }, rows, none);
  list.addEventListener('change', () => (count(), relabel()));
  if (filter) filter.addEventListener('input', relabel);
  sheet(title, h('div', { class: 'ck-top' }, filter, every), list, h('div', { class: 'ck-foot' }, send));
}

/** A filter box over `rows` (each matched against its text), with a line for when nothing matches. */
function filterRows(rows, texts, placeholder) {
  const none = h('p', { class: 'quiet pad', hidden: true }, 'Nothing matches.');
  const field = h('input', {
    class: 'field ck-filter',
    type: 'text',
    inputmode: 'search',
    enterkeyhint: 'search',
    autocapitalize: 'off',
    autocomplete: 'off',
    placeholder,
    'aria-label': 'Filter the list',
    oninput: (e) => {
      const words = e.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      rows.forEach((row, i) => {
        row.hidden = !words.every((w) => texts[i].includes(w));
        if (!row.hidden) shown += 1;
      });
      none.hidden = shown > 0;
    },
  });
  return { field, none };
}

/** The skills, sent by the Mac for /skills: search them, tap one, and it is put in the message box to send. */
function chooseOne({ title, items }) {
  const pick = (value) => () => {
    closeSheet();
    input.value = `/${value} `;
    grow();
    suggest();
    input.focus();
  };
  const rows = items.map((item) => h('button', { class: 'ck-row one', type: 'button', onclick: pick(item.value) }, h('span', { class: 'grow' }, h('span', { class: 'name mono' }, `/${item.value}`), item.description && h('span', { class: 'sub' }, item.description))));
  const { field, none } = filterRows(rows, items.map((i) => `${i.value} ${i.description ?? ''}`.toLowerCase()), `Search ${items.length} skills…`);
  sheet(title, items.length > 8 && h('div', { class: 'ck-top' }, field), h('div', { class: 'ck-list', role: 'list' }, rows, none), h('p', { class: 'quiet small' }, 'Tap one to put it in the message box; add what it should work on, then send.'));
}

/** A list where a tap sends the choice at once (/resume: which saved conversation to continue). */
function chooseSend({ ws, title, items }) {
  const send = (value) => () => {
    closeSheet();
    sendText(ws, `/${value}`);
  };
  const rows = items.map((item) => h('button', { class: 'ck-row one', type: 'button', onclick: send(item.value) }, h('span', { class: 'grow' }, h('span', { class: 'name' }, item.description || `/${item.value}`))));
  const { field, none } = filterRows(rows, items.map((i) => String(i.description ?? i.value).toLowerCase()), `Search ${items.length}…`);
  sheet(title, items.length > 8 && h('div', { class: 'ck-top' }, field), h('div', { class: 'ck-list', role: 'list' }, rows, none));
}

/** The settings, sent by the Mac for /config: a value is changed with a tap; one without a list of values is typed. */
function showSettings({ ws, items }) {
  const row = (item) => {
    const options = item.options ?? [];
    const set = (value) => () => {
      closeSheet();
      sendText(ws, `/config ${item.key} ${value === 'default' ? 'default' : value}`);
    };
    const type = () => {
      closeSheet();
      input.value = `/config ${item.key} `;
      grow();
      suggest();
      input.focus();
    };
    return h(
      'div',
      { class: 'st-row' },
      h('div', { class: 'st-head' }, h('span', { class: 'name mono' }, item.key), h('span', { class: 'st-value mono' }, item.value)),
      h('span', { class: 'sub' }, item.help),
      options.length
        ? h('div', { class: 'st-options', role: 'group', 'aria-label': item.key }, options.map((value) => h('button', { type: 'button', class: value === item.value ? 'on' : '', 'aria-pressed': String(value === item.value), disabled: value === item.value, onclick: set(value) }, value)))
        : h('button', { class: 'btn quiet small st-type', type: 'button', onclick: type }, 'Type a value'),
    );
  };
  const rows = items.map(row);
  const { field, none } = filterRows(rows, items.map((i) => `${i.key} ${i.help}`.toLowerCase()), `Search ${items.length} settings…`);
  sheet('Settings', h('p', { class: 'tu-sub' }, 'For the projects opened from the phone. A change is saved at once.'), h('div', { class: 'ck-top' }, field), h('div', { class: 'ck-list' }, rows, none));
}

/** The setting's words: "Auto (by model)", "Sage · Claude", "SEEKER robot". */
function characterChoiceLabel(id) {
  if (id === 'seeker') return 'SEEKER robot';
  return CHARACTERS[id] ? `${CHARACTERS[id].name} · ${CHARACTERS[id].family}` : 'Auto (by model)';
}

/** Kept on this phone only: the Mac and its other phones keep their own. */
function chooseCharacter() {
  const selected = CHOICES.includes(characterSetting) ? characterSetting : 'auto';
  choose('Live Agent character', CHOICES.map((id) => [id, characterChoiceLabel(id)]), selected, (id) => store(CHARACTER_SETTING, (characterSetting = id)));
}

/** One project's character, kept on this phone by the project's path. "Phone setting" follows the one above. */
function chooseProjectCharacter(meta) {
  const own = Object.hasOwn(projectCharacters, meta.path) ? projectCharacters[meta.path] : 'default';
  choose(`Character for ${meta.name}`, [['default', `Phone setting · ${characterChoiceLabel(characterSetting)}`], ...CHOICES.map((id) => [id, characterChoiceLabel(id)])], own, (id) => {
    projectCharacters = { ...projectCharacters };
    if (id === 'default') delete projectCharacters[meta.path];
    else projectCharacters[meta.path] = id;
    store(PROJECT_CHARACTERS, JSON.stringify(projectCharacters));
  });
}

/** What a project's character row says: its own choice, or that it follows the phone's setting. */
const projectCharacterLabel = (meta) => (Object.hasOwn(projectCharacters, meta.path) ? characterChoiceLabel(projectCharacters[meta.path]) : `Phone setting · ${characterChoiceLabel(characterSetting)}`);

/** A sheet of choices with the one in force ticked. */
function choose(title, options, selected, pick) {
  sheet(title, ...options.map(([id, label]) => h('button', { class: `row-btn pick${selected === id ? ' on' : ''}`, 'aria-pressed': String(selected === id), onclick: () => (closeSheet(), pick(id), render(true)) }, label, selected === id && h('span', { class: 'tick', icon: 'check' }))));
}

// The crew: every session under way, one chip each, under the agent in front. A tap on a chip puts that
// agent in front (until another asks for an approval); past CREW_SHOWN the rest are in the switcher.
const CREW_SHOWN = 5;
const CREW_TONE = { thinking: 'execution', coding: 'execution', executing: 'execution', awaiting_approval: 'primary', success: 'success', error: 'danger' };
function crewRow(team, front) {
  let shown = team.slice(0, CREW_SHOWN);
  const lead = team.find((c) => c.ws.meta.id === front);
  if (team.length > CREW_SHOWN && lead && !shown.includes(lead)) shown = [...shown.slice(0, CREW_SHOWN - 1), lead];
  const rest = team.length - shown.length;
  const chip = ({ ws, mood }) => {
    const on = ws.meta.id === front;
    const word = mood === 'awaiting_approval' ? 'Approval' : MOODS[mood];
    return h(
      'button',
      { class: `crew-chip t-${CREW_TONE[mood] ?? 'muted'}${on ? ' on' : ''}`, type: 'button', 'data-ws': ws.meta.id, 'aria-pressed': String(on), 'aria-label': `${ws.meta.name}, ${MOODS[mood].toLowerCase()}`, onclick: () => ((state.crewPin = ws.meta.id), render(true)) },
      bot(mood, 'sm', { label: false, who: whoFor(ws.meta) }),
      h('span', { class: 'cn' }, ws.meta.name),
      h('span', { class: 'cm' }, word),
      mood === 'awaiting_approval' && h('i', { class: 'pip', 'aria-hidden': 'true' }, '!'),
    );
  };
  return h(
    'div',
    { class: `crew${team.length > 3 ? ' scroll' : ''}`, role: 'group', 'aria-label': 'Live agents' },
    shown.map(chip),
    rest > 0 && h('button', { class: 'crew-chip more', type: 'button', 'aria-label': `${rest} more live agents. Open the switcher`, onclick: openSwitcher }, h('span', { class: 'plus' }, `+${rest}`), h('span', { class: 'cn' }, 'All'), h('span', { class: 'cm' }, 'sessions')),
  );
}

const panel = (title, side, ...content) => h('section', { class: 'panel-box' }, h('div', { class: 'cap' }, h('span', {}, title), side), ...content);

// ── home: the control center ──
function controlCenter(model) {
  const { now, link, stats, team } = model;
  const up = link.key === 'online';
  const list = [...state.workspaces.values()];
  const pick = (title, then) => {
    if (!list.length) return toast('Open a project first.');
    if (list.length === 1) return then(list[0].meta);
    sheet(title, ...list.map((w) => h('button', { class: 'row-btn', onclick: () => (closeSheet(), then(w.meta)) }, w.meta.name)));
  };

  // The live agent: the robot shows what the agent in front is doing (an approval first, then running work),
  // as the Mac reported it. A tap on the robot goes into that conversation; switching agents lives in the
  // header's swap button.
  // Working or waiting for the user: both are sessions still under way.
  const active = list.filter((w) => w.meta.status === 'working' || w.meta.status === 'approval').length;
  let activityPanel;
  if (!state.loaded) {
    activityPanel = panel('LIVE AGENT', null, h('div', { class: 'skeleton-lines', 'aria-busy': 'true', 'aria-label': 'Loading' }, h('i'), h('i'), h('i')));
  } else if (!now) {
    activityPanel = h(
      'section',
      { class: 'panel-box hero' },
      h('div', { class: 'cap' }, h('span', {}, 'LIVE AGENT'), h('span', { class: `mood-word m-${model.mood}` }, MOODS[model.mood])),
      h('div', { class: 'hero-main' }, h('span', { class: 'hero-bot' }, bot(model.mood, 'lg')), h('p', { class: 'quiet grow' }, list.length ? 'Nothing has run yet. Open a session and give Seeker a task.' : 'No project is open yet.')),
      h('div', { class: 'hero-actions' }, h('button', { class: 'btn small', disabled: !up, onclick: () => (list.length ? go({ name: 'sessions' }) : addWorkspace()) }, list.length ? 'Open sessions' : 'Open a project')),
    );
  } else {
    const { meta } = now.ws;
    const open = () => go({ name: 'session', ws: meta.id });
    const mark = now.status === 'completed' ? 'check' : now.status === 'failed' ? 'cross' : null;
    const last = since(meta.lastAt);
    const who = whoFor(meta);
    activityPanel = h(
      'section',
      { class: 'panel-box hero', 'aria-label': `Live agent: ${meta.name}, ${MOODS[model.mood].toLowerCase()}` },
      // The mood under the name says the state; a second label here would say it in other words.
      h('div', { class: 'cap' }, h('span', {}, team.length > 1 ? ['LIVE AGENTS', h('b', { class: 'count' }, team.length)] : now.live ? 'LIVE AGENT' : 'LAST AGENT'), who && h('span', { class: 'char-tag', style: `--sk-char:${CHARACTERS[who.id].accent}` }, characterLabel(who))),
      h(
        'div',
        { class: 'hero-main' },
        h('button', { class: 'hero-bot', type: 'button', 'aria-label': `Open ${meta.name}`, onclick: open }, bot(model.mood, 'lg', { who })),
        h(
          'span',
          { class: 'grow' },
          h('span', { class: 'name line' }, meta.name),
          h('span', { class: `mood-word m-${model.mood}` }, MOODS[model.mood]),
          h('span', { class: 'meta line' }, [meta.branch, meta.provider].filter(Boolean).join(' · ')),
        ),
      ),
      now.text && h('span', { class: `said ${STATUSES[now.status].tone}` }, mark ? h('span', { class: 'mark', icon: mark }) : now.live && h('i', { class: 'beat' }), h('span', { class: 'text' }, now.text)),
      team.length > 1 && crewRow(team, meta.id),
      h('div', { class: 'hero-facts' }, h('span', {}, h('i', { class: `state ${link.tone}` }), link.label), h('span', {}, `${active} active`), last && h('span', {}, `Last active ${last.toLowerCase()}`)),
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

  // The Mac's ledger counts by calendar day, so this one says "today" inside a panel about the last 24 hours.
  const tokensMetric = () => h('button', { class: 'stat tap', 'aria-label': `Tokens today: ${spent(state.usage.today).toLocaleString()}. Show token usage`, onclick: showUsage }, h('span', { class: 'ico', icon: 'cube' }), h('b', {}, big(spent(state.usage.today))), h('span', {}, 'Tokens today', h('span', { class: 'chev', icon: 'chevron' })));
  const metric = (icon, value, label) => h('div', { class: 'stat' }, h('span', { class: 'ico', icon }), h('b', {}, value), h('span', {}, label));
  const statsPanel =
    state.loaded &&
    panel(
      'ACTIVITY',
      h('span', { class: 'when' }, 'Last 24 hours'),
      h('div', { class: 'stats' }, metric('pulse', stats.sessions, stats.sessions === 1 ? 'Session' : 'Sessions'), metric('layers', `${stats.tools}${stats.toolsMore ? '+' : ''}`, stats.tools === 1 && !stats.toolsMore ? 'Tool run' : 'Tool runs'), state.usage ? tokensMetric() : metric('check', stats.completed, 'Completed')),
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
      // Saved conversations of a project opened from the phone (one in a terminal is resumed there).
      quick('/resume', 'play', () => {
        if (!list.some((w) => !w.meta.terminal)) return toast('Open a project first.');
        const own = list.filter((w) => !w.meta.terminal);
        const then = (m) => (go({ name: 'session', ws: m.id }), sendText(m.id, '/resume'));
        if (own.length === 1) return then(own[0].meta);
        sheet('Continue a conversation in which project?', ...own.map((w) => h('button', { class: 'row-btn', onclick: () => (closeSheet(), then(w.meta)) }, w.meta.name)));
      }),
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

const spent = (counts) => (counts?.input ?? 0) + (counts?.output ?? 0);
const big = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : kilo(n));

// ── token usage: what the Mac has counted, as totals, a split of the input, a chart and a history ──
const usageUi = { range: '7', day: null, more: false };
const HISTORY_ROWS = 14;

/** The counts of one day, spelled out. Shown under the chart and under the day's row in the history. */
function usageDay(d, today) {
  const title = `${dayLabel(d.day, today)}${dayLabel(d.day, today).includes(',') ? '' : ` · ${shortDay(d.day)}`}`;
  if (d.coverage === 'unavailable') return h('div', { class: 'tu-day', role: 'status' }, h('b', {}, title), h('p', {}, 'Not recorded. Counting had not begun on this day, so what was used is unknown.'));
  const c = d.counts;
  const cell = (label, value) => h('div', {}, h('span', {}, label), h('b', {}, value));
  return h(
    'div',
    { class: 'tu-day', role: 'status' },
    h('b', {}, title),
    d.coverage === 'zero' ? h('p', {}, 'Counting was on and nothing was used.') : h('div', { class: 'tu-day-grid' }, cell('Total', c.total.toLocaleString()), cell('New input', c.newInput.toLocaleString()), cell('Cached input', c.cacheRatio == null ? '—' : c.cachedInput.toLocaleString()), cell('Output', c.output.toLocaleString()), cell('Model replies', c.replies.toLocaleString())),
    d.partial && h('p', {}, 'Counting began on this day: it holds only what came after that moment.'),
  );
}

function usageChart(v) {
  const top = v.ticks.at(-1);
  const show = labelled(v.days.length, 7);
  const pick = (day) => () => ((usageUi.day = usageUi.day === day ? null : day), drawSheet());
  const wide = v.days.length > 45;
  return h(
    'div',
    { class: 'tu-chart' },
    h('div', { class: 'tu-axis', 'aria-hidden': 'true' }, [...v.ticks].reverse().map((t) => h('span', {}, t === 0 ? '0' : compact(t).replace('.0', '')))),
    h(
      'div',
      { class: 'tu-scroll' },
      h(
        'div',
        { class: 'tu-plot', role: 'group', 'aria-label': 'Tokens per day', style: wide ? `min-width:${v.days.length * 7}px` : '' },
        h('div', { class: 'tu-grid', 'aria-hidden': 'true' }, v.ticks.map(() => h('i'))),
        v.days.map((d, i) => {
          const total = d.counts?.total ?? 0;
          const said = d.coverage === 'unavailable' ? 'not recorded' : `${total.toLocaleString()} tokens`;
          return h(
            'button',
            { class: `tu-bar ${d.coverage}${usageUi.day === d.day ? ' on' : ''}${d.day === v.today ? ' today' : ''}`, type: 'button', 'data-key': `bar-${d.day}`, 'aria-pressed': String(usageUi.day === d.day), 'aria-label': `${fullDay(d.day)}: ${said}`, onclick: pick(d.day) },
            h('i', { style: `height:${total && top ? Math.max(1.5, (total / top) * 100) : 0}%` }),
            h('span', { class: show(i) ? '' : 'skip' }, shortDay(d.day)),
          );
        }),
      ),
    ),
  );
}

/** Token use as the Mac has counted it. The sheet stays open while counts arrive and keeps the range and day chosen. */
function showUsage() {
  Object.assign(usageUi, { day: null, more: false });
  openLive('Token usage', () => {
    const up = state.linked && state.online;
    const { usage } = state;
    const signature = JSON.stringify([usage, usageUi, up, state.loaded]);
    return { signature, content: () => usageSheet(usage, up) };
  });
}

function usageSheet(usage, up) {
  const stale = !up && h('p', { class: 'tu-note warn', role: 'status' }, 'Mac is disconnected. Usage data may be outdated.');
  if (!usage) {
    // Nothing from the Mac yet is not "nothing used": the shape of the panel, without a number in it.
    if (!state.loaded) return [h('div', { class: 'tu-skeleton', 'aria-busy': 'true', 'aria-label': 'Loading token usage' }, h('i'), h('i'), h('i'), h('i'))];
    return [stale, h('div', { class: 'empty' }, h('b', {}, 'Token usage is not reported'), 'SEEKER on this Mac does not send its token counts. Update it and start `seeker remote` again.')];
  }
  const v = usageView(usage, { range: usageUi.range });
  const since = v.sinceDay && `Since ${fullDay(v.sinceDay)}`;
  if (v.empty) return [h('p', { class: 'tu-sub' }, ['Usage analytics', since].filter(Boolean).join(' · ')), stale, h('div', { class: 'empty' }, h('b', {}, 'No token usage recorded yet.'), 'Counts appear here after the first reply of a model on your Mac.')];

  const all = v.lifetime;
  const metric = (label, value, hint) => h('div', { class: 'tu-metric' }, h('span', {}, label), h('b', { title: hint ?? null }, value));
  const composition =
    all.cacheRatio == null
      ? h('p', { class: 'tu-note' }, 'The provider in use does not report how much input it read from its cache, so no share is shown.')
      : [
          h('div', { class: 'tu-bar-split', role: 'img', 'aria-label': `Input: ${percent(all.newRatio)} new, ${percent(all.cacheRatio)} cached` }, h('i', { class: 'new', style: `flex-grow:${all.newRatio}` }), h('i', { class: 'cached', style: `flex-grow:${all.cacheRatio}` })),
          h('div', { class: 'tu-legend' }, h('span', {}, h('i', { class: 'new' }), 'New input', h('b', {}, percent(all.newRatio)), h('em', {}, compact(all.measuredInput - all.cachedInput))), h('span', {}, h('i', { class: 'cached' }), 'Cached input', h('b', {}, percent(all.cacheRatio)), h('em', {}, compact(all.cachedInput)))),
          all.partial && h('p', { class: 'tu-note' }, `Measured over ${compact(all.measuredInput)} of input. The other ${compact(all.newInput + all.cachedInput - all.measuredInput)} came from a provider that does not report its cache.`),
          all.written > 0 && h('p', { class: 'tu-note' }, `${compact(all.written)} of the new input was written to the cache, which providers bill above plain input.`),
        ];

  const chosen = usageUi.day && v.days.find((d) => d.day === usageUi.day);
  const history = [...v.days].reverse();
  const listed = usageUi.more ? history : history.slice(0, HISTORY_ROWS);
  const row = (d) => {
    const open = usageUi.day === d.day;
    const value = d.counts?.total.toLocaleString();
    return [
      h('button', { class: `tu-row${open ? ' on' : ''}`, type: 'button', 'data-key': `row-${d.day}`, 'aria-expanded': String(open), onclick: () => ((usageUi.day = open ? null : d.day), drawSheet()) }, h('span', { class: 'grow' }, dayLabel(d.day, v.today)), d.coverage === 'unavailable' ? h('span', { class: 'none' }, 'Not recorded') : h('b', {}, value)),
      open && usageDay(d, v.today),
    ];
  };

  return [
    h('p', { class: 'tu-sub' }, ['Usage analytics', since].filter(Boolean).join(' · ')),
    stale,
    h('div', { class: 'tu-total' }, h('b', {}, compact(all.total)), h('span', {}, `${all.total.toLocaleString()} total tokens`)),
    h('div', { class: 'tu-metrics' }, metric('New input', compact(all.newInput), all.newInput.toLocaleString()), metric('Cached input', all.cacheRatio == null ? '—' : compact(all.cachedInput), all.cacheRatio == null ? 'Not reported by the provider' : all.cachedInput.toLocaleString()), metric('Output', compact(all.output), all.output.toLocaleString()), metric('Model replies', all.replies.toLocaleString())),

    h('div', { class: 'tu-head' }, h('h4', {}, 'Input composition'), all.cacheRatio != null && h('span', { class: 'tu-chip' }, `${percent(all.cacheRatio)} cached input`)),
    composition,

    h('div', { class: 'tu-head' }, h('h4', {}, 'Daily usage'), h('div', { class: 'tu-range', role: 'group', 'aria-label': 'Range' }, RANGES.map(([id, label]) => h('button', { type: 'button', 'data-key': `range-${id}`, class: usageUi.range === id ? 'on' : '', 'aria-pressed': String(usageUi.range === id), 'aria-label': label, onclick: () => (Object.assign(usageUi, { range: id, day: null, more: false }), drawSheet()) }, id === 'all' ? 'All' : `${id}d`)))),
    h('p', { class: 'tu-sub' }, RANGES.find(([id]) => id === usageUi.range)[1], v.period ? ` · ${compact(v.period.total)} tokens · ${v.period.replies.toLocaleString()} model replies` : ' · not recorded'),
    usageChart(v),
    chosen ? usageDay(chosen, v.today) : h('p', { class: 'tu-note' }, 'Tap a bar for that day\'s counts.'),

    h('div', { class: 'tu-head' }, h('h4', {}, 'Usage history')),
    h('div', { class: 'tu-list' }, listed.flatMap(row)),
    history.length > HISTORY_ROWS && h('button', { class: 'btn quiet small', type: 'button', 'data-key': 'more', onclick: () => ((usageUi.more = !usageUi.more), drawSheet()) }, usageUi.more ? 'Show fewer days' : `Show ${history.length - HISTORY_ROWS} earlier days`),

    h('p', { class: 'tu-note foot' }, `Counted on your Mac${v.sinceDay ? ` since ${fullDay(v.sinceDay)}, when this counter was added` : ''}. What was used before that was never recorded and cannot be recovered. The figures are the providers' own counts, by the Mac's calendar day. Cached input is part of the total. Token counts are not charges: providers price new input, cached input and output differently.`),
  ];
}

/** What Home shows now, and a signature of it: the screen is redrawn only when that changes. */
function homeNow() {
  const list = [...state.workspaces.values()];
  const link = connection(state);
  const base = [state.homeTab, state.loaded, switcher(list, { up: link.key === 'online' }).running, link.key, state.device?.name, state.device?.settings?.animation, characterSetting, projectCharacters];
  if (state.homeTab === 'projects') {
    const rows = explorerRows(list, state.explorer);
    const local = localFolders(state.folders, list, state.explorer.localQuery);
    return { link, rows, local, signature: JSON.stringify([base, state.explorer, list.length, rows.map((r) => [r, since(r.at)]), local]) };
  }
  const front = current(list, { pinned: state.crewPin });
  const now = front && { ...front, status: statusOf(front.ws), text: summary(front.ws) };
  const up = link.key === 'online';
  const team = crew(list).map((ws) => ({ ws, mood: moodOf(ws, { up }) }));
  if (state.crewPin && !team.some((c) => c.ws.meta.id === state.crewPin)) state.crewPin = null; // its run ended: the next one starts unpinned
  const stats = activity(list);
  const meta = now?.ws.meta;
  const mood = now ? moodFor('hero', now.ws) : moodOf(null, { up: link.key === 'online' });
  const last = meta && since(meta.lastAt);
  return { link, now, stats, mood, team, signature: JSON.stringify([base, state.latency?.ms, team.map((c) => [c.ws.meta.id, c.ws.meta.name, c.ws.meta.model, c.mood]), list.length, list[0]?.meta.provider, state.device?.provider, now && [meta.id, meta.name, meta.branch, meta.provider, meta.model, now.live, now.status, now.text], mood, last, list.map((w) => w.meta.status).join(), stats, state.usage && spent(state.usage.today)]) };
}

function home(model) {
  const tab = (id, icon, label) => h('button', { class: state.homeTab === id ? 'active' : '', role: 'tab', 'aria-selected': String(state.homeTab === id), onclick: () => ((state.homeTab = id), render(true)) }, h('span', { class: 'tab-icon', icon }), h('span', {}, label));
  return [header(), h('div', { class: 'tabs home-tabs', role: 'tablist' }, tab('control', 'grid', 'Control Center'), tab('projects', 'folder', 'Projects')), state.homeTab === 'projects' ? workspaceExplorer(model) : controlCenter(model)];
}

function sendText(wsId, text, images = [], files = []) {
  // What was just sent is what the reader wants to follow: back to the bottom, so the reply stays in view.
  const view = $('view');
  view.scrollTop = view.scrollHeight;
  return command('message', { ws: wsId, text, locked: Boolean(lockCfg), ...(images.length ? { images } : {}), ...(files.length ? { files: files.map(({ id, name, bytes }) => ({ id, name, bytes })) } : {}) });
}

// ── images ─────────────────────────────────────────────────────────────────
// A picture is made small enough to travel before it is encrypted and sent: the
// relay takes 4 MB per message, and encryption plus base64 nearly doubles the size.
const MAX_ATTACHMENTS = 4;
const IMAGE_CHARS = 500_000; // base64 characters per picture, about 375 KB
const KEEP_AS_IS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
let attachments = []; // waiting to go with the next message: a picture { name, data, thumb }, or a file { kind: 'file', file, name, bytes }
let uploading = null; // { name, n, chunks, index, count } while a file goes up to the Mac
const originals = new WeakMap(); // a picture waiting to go → the file it was made from, for its preview

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
  // Made smaller, it is a JPEG whatever it was; the name says what is really sent.
  return { name: plainName(file.name, data === original ? file.type : 'image/jpeg'), data, thumb: shrink(img, 240, 0.6) };
}

/**
 * A picture goes to the model to look at; anything else (a video, or anything chosen with /file)
 * is sent whole and saved on the Mac, where the agent can work on it.
 */
async function addImages(files, { whole = false } = {}) {
  const ws = state.workspaces.get(state.view.ws);
  for (const file of files) {
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast(`At most ${MAX_ATTACHMENTS} attachments per message.`);
      break;
    }
    const named = plainName(file.name, file.type);
    if (whole || !file.type.startsWith('image/')) {
      if (!file.size) toast(`${named} is empty.`);
      else if (file.size > MAX_FILE_BYTES) toast(`${named} is ${fileSize(file.size)}; at most ${fileSize(MAX_FILE_BYTES)} can be sent.`);
      else attachments.push({ kind: 'file', file, name: named, bytes: file.size, video: file.type.startsWith('video/') });
      showAttachments();
      continue;
    }
    if (ws && ws.meta.vision === false) {
      toast(`${ws.meta.model} cannot see images. Change the model, or send it as a file with /file.`);
      continue;
    }
    try {
      const picture = await prepare(file);
      originals.set(picture, file);
      attachments.push(picture);
    } catch (err) {
      toast(`${named}: ${err.message}.`);
    }
    showAttachments();
  }
}

/** Sends the pieces of files a message announced. The Mac takes each as it comes. */
async function uploadFiles(files) {
  try {
    for (const [index, f] of files.entries()) {
      const chunks = Math.ceil(f.bytes / CHUNK_BYTES);
      let last = Date.now();
      for (let n = 0; n < chunks; ) {
        uploading = { name: f.name, n, chunks, index, count: files.length };
        showAttachments();
        if (Date.now() - last > 120_000) throw new Error('the relay stopped taking it');
        const bytes = new Uint8Array(await f.file.slice(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES).arrayBuffer());
        const c = await sealChunk(f.id, n, bytes);
        const res = await fetch('/api/chunk', { method: 'POST', headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: f.id, n, c }) }).catch(() => null);
        if (res?.ok) {
          n += 1;
          last = Date.now();
        } else await pause(res?.status === 507 ? 500 : 1500); // 507: the Mac has not taken the earlier pieces yet
      }
    }
    return true;
  } catch (err) {
    toast(`The upload stopped: ${err.message}.`);
    return false;
  } finally {
    uploading = null;
    showAttachments();
  }
}

function showAttachments() {
  composerState();
  shapeComposer();
  const strip = $('attachments');
  if (uploading) {
    const { name, n, chunks, index, count } = uploading;
    const done = Math.round((n / chunks) * 100);
    strip.hidden = false;
    return strip.replaceChildren(
      h(
        'div',
        { class: 'upload', role: 'status' },
        h('div', { class: 'upload-line' }, h('span', { class: 'grow mono' }, `${count > 1 ? `${index + 1}/${count} · ` : ''}${name}`), h('span', { class: 'muted' }, `${done}%`)),
        h('div', { class: 'upload-bar' }, h('i', { style: `width:${done}%` })),
        h('div', { class: 'muted small' }, 'Sending to your Mac. Keep this page open until it is done.'),
      ),
    );
  }
  strip.hidden = attachments.length === 0;
  strip.replaceChildren(
    ...attachments.map((a) =>
      h(
        'div',
        { class: `shot${a.kind === 'file' ? ' file-chip' : ''}` },
        // Tapped, it opens to be checked before it goes.
        a.kind === 'file'
          ? h('button', { type: 'button', class: 'chip-body', 'aria-label': `Check ${a.name}`, onclick: () => previewWaiting(a) }, h('span', { class: `fbadge small t-${fileKind(a.name).tone}` }, fileKind(a.name).label), h('span', { class: 'chip-name' }, a.name), h('span', { class: 'muted small' }, fileSize(a.bytes)))
          : h('button', { type: 'button', class: 'shot-open', 'aria-label': `Check ${a.name}`, onclick: () => previewWaiting(a) }, h('img', { src: `data:image/jpeg;base64,${a.thumb}`, alt: a.name })),
        h('button', { type: 'button', class: 'shot-remove', 'aria-label': `Remove ${a.name}`, onclick: () => ((attachments = attachments.filter((x) => x !== a)), showAttachments()) }, '×'),
      ),
    ),
  );
}

// ── session: the live view of one agent ────────────────────────────────────
/** One file's change: removed and added lines with their line numbers, side by side when there is room. */
function diffView(diff, file) {
  if (!diff || (!diff.removed?.length && !diff.added?.length && !diff.hunk?.rows?.length)) return null;
  const start = Number.isInteger(diff.line) ? diff.line : null;
  // The Mac's own line-by-line reading of the change, when it sends one: every line with its number in
  // the file, the lines around it, and only what really changed marked as removed or added.
  const rows = diff.hunk?.rows?.length ? diff.hunk.rows : null;
  const counts = rows ? { added: diff.hunk.added, removed: diff.hunk.removed } : (diff.counts ?? { added: diff.added?.length ?? 0, removed: diff.removed?.length ?? 0 });
  const KIND = { '+': 'add', '-': 'del', ' ': 'ctx' };
  const numbered = () =>
    h(
      'div',
      { class: 'side', role: 'table', 'aria-label': `Changes to ${file}` },
      rows.map((r) =>
        r.gap
          ? h('div', { class: 'ln gap', role: 'row' }, h('span', { class: 'no' }), h('span', { class: 'sign' }), h('span', { class: 'src' }, '⋯'))
          : h('div', { class: `ln ${KIND[r.kind] ?? 'ctx'}`, role: 'row', 'aria-label': `Line ${r.n}, ${r.kind === '+' ? 'added' : r.kind === '-' ? 'removed' : 'unchanged'}` }, h('span', { class: 'no' }, r.n), h('span', { class: 'sign' }, r.kind === '+' ? '+' : r.kind === '-' ? '−' : ''), h('span', { class: 'src' }, code(r.text))),
      ),
    );
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
    rows ? h('div', { class: 'sides' }, numbered()) : h('div', { class: `sides${diff.removed?.length && diff.added?.length ? ' both' : ''}` }, diff.removed?.length ? side(diff.removed, 'del') : null, diff.added?.length ? side(diff.added, 'add') : null),
    // What the lines above do not show by themselves is said in words.
    Number.isInteger(diff.overwrites) ? h('div', { class: 'more warning' }, `⚠ Replaces the whole file: its ${diff.overwrites} existing line${diff.overwrites === 1 ? '' : 's'} are removed.`) : null,
    diff.times > 1 ? h('div', { class: 'more warning' }, `⚠ Applied in ${diff.times} places: every occurrence in the file is changed.`) : null,
    rows ? (diff.hunk.hidden ? h('div', { class: 'more' }, `… ${diff.hunk.hidden} more changed line${diff.hunk.hidden > 1 ? 's' : ''} not shown`) : null) : diff.more ? h('div', { class: 'more' }, `… ${diff.more} more line${diff.more > 1 ? 's' : ''} not shown`) : null,
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

/**
 * The pictures of an entry: what the user sent, or what a tool step opened on the Mac. A preview is
 * shown only as an image of a type the Mac recognised; anything else is just named.
 */
function pictures(images, size = '', from = null) {
  const shots = (Array.isArray(images) ? images : []).map((sent, index) => {
    const i = { ...sent, name: plainName(sent.name, sent.mime) };
    const shown = i.thumb && /^image\/(png|jpeg|gif|webp)$/.test(i.mime) ? h('img', { src: `data:${i.mime};base64,${i.thumb}`, alt: i.name, title: i.name }) : h('span', { class: 'file' }, i.name);
    // A picture that is a file on the Mac opens whole, ready to save, when tapped. One sent before the
    // Mac kept them opens as the small preview it has, and says so.
    if (!from) return shown;
    const open = i.file ? () => openPicture(from.ws, from.item, index, i.name, i.file) : from.user && shown.tagName === 'IMG' ? () => showPreviewOnly(i) : null;
    if (!open) return shown;
    return h('button', { type: 'button', class: 'shot-open', 'aria-label': `Open ${i.name}`, onclick: open }, shown);
  });
  return shots.length ? h('div', { class: `shots${size ? ` ${size}` : ''}` }, shots) : null;
}

// ── files from the Mac: one record per file, shared by its cards, its preview and Settings ──
// A file is known by its path on the Mac, which only the Mac's own messages give: the phone never
// asks for a path, only for "file N of answer X" (download) or "picture N of step X" (file), and the
// Mac checks that the file is one this transcript showed. The path is just the key it is kept under.
const transfers = new Map(); // path → { state: 'downloading' | 'failed' | 'unavailable', got, total, error, cancelled, promise }
let keptPaths = null; // path → bytes of every file kept on this phone; null until read
let askedPersist = false;

/** Reads what is kept on this phone once, then redraws any card that changes because of it. */
function loadKept() {
  if (keptPaths) return;
  keptPaths = new Map();
  keptList().then((list) => {
    keptPaths = new Map(list.map((e) => [e.path, e.bytes]));
    refreshFile(null);
  });
}

/** Kept here, and (when its size is known) the same size as the file on the Mac. */
const isKept = (where, bytes = null) => !!where && !!keptPaths?.has(where) && (!Number.isFinite(bytes) || keptPaths.get(where) === bytes);

const fileUpdaters = new Set(); // what redraws the cards and the open preview of a file when its state moves

/** Something about the file at `where` moved (null: about every file): its cards and preview catch up. */
function refreshFile(where) {
  for (const update of [...fileUpdaters]) update(where);
}

/** A card that redraws itself in place while it is on screen. */
function liveCard(where, build) {
  let el = build();
  const update = (changed) => {
    if (!el.isConnected) return fileUpdaters.delete(update);
    if (changed != null && changed !== where) return;
    const next = build();
    el.replaceWith(next);
    el = next;
  };
  fileUpdaters.add(update);
  return el;
}

const NO_LONGER_THERE = /no longer (on|be)/i;

/**
 * Fetches a file from the Mac and keeps it here. `src` is { kind: 'download' | 'picture', ws, item,
 * index, name, where, bytes }. One fetch per file at a time: asking again joins the one under way.
 * Resolves with { file, smaller, saved, reason }.
 */
function fetchFile(src) {
  const busy = transfers.get(src.where);
  if (busy?.state === 'downloading') return busy.promise;
  const record = { state: 'downloading', got: 0, total: Number.isFinite(src.bytes) ? src.bytes : null, error: null, cancelled: false };
  const where = src.where;
  record.promise = (async () => {
    try {
      const { file, smaller } = src.kind === 'picture' ? await askForPicture(src, record) : await askForFile(src, record);
      const outcome = await keepFile(file, where, { smaller });
      if (outcome.ok) {
        keptPaths?.set(where, file.size);
        state.keptInfo = undefined;
        if (!askedPersist) (askedPersist = true), navigator.storage?.persist?.().catch(() => {});
      }
      transfers.delete(where);
      refreshFile(where);
      return { file, smaller, saved: outcome.ok, reason: outcome.reason };
    } catch (err) {
      record.state = record.cancelled ? 'cancelled' : NO_LONGER_THERE.test(err.message) ? 'unavailable' : 'failed';
      record.error = record.cancelled ? 'Download cancelled.' : err.message;
      if (record.cancelled) transfers.delete(where);
      refreshFile(where);
      throw err;
    }
  })();
  transfers.set(where, record);
  refreshFile(where);
  return record.promise;
}

const fetching = new Map(); // req → { resolve, reject, timer }: a picture asked of the Mac
const downloads = new Map(); // req → { resolve, reject, timer, record }: a file asked of the Mac

/** Asks the Mac for a message's file; the answer arrives as a 'download' event (downloadArrived). */
function askForFile(src, record) {
  return new Promise((resolve, reject) => {
    const req = transferId();
    const timer = setTimeout(() => downloads.delete(req) && reject(new Error('Your Mac did not send the file. Try again.')), 60_000);
    downloads.set(req, { resolve, reject, timer, record });
    command('download', { ws: src.ws, item: src.item, index: src.index, req }, { quiet: true }).then((sent) => sent || (clearTimeout(timer), downloads.delete(req), reject(new Error('Mac disconnected. Retry when connected.'))));
  });
}

/** Asks the Mac for the whole of a picture; the answer arrives as a 'file' event (pictureArrived). */
function askForPicture(src, record) {
  return new Promise((resolve, reject) => {
    const req = transferId();
    const timer = setTimeout(() => fetching.delete(req) && reject(new Error('Your Mac did not send the picture. Try again.')), 60_000);
    fetching.set(req, { resolve, reject, timer, record });
    command('file', { ws: src.ws, item: src.item, index: src.index, req }, { quiet: true }).then((sent) => sent || (clearTimeout(timer), fetching.delete(req), reject(new Error('Mac disconnected. Retry when connected.'))));
  });
}

async function pictureArrived(event) {
  const wait = fetching.get(event.req);
  if (!wait) return; // asked for by another phone, or replayed from the log
  clearTimeout(wait.timer);
  fetching.delete(event.req);
  if (event.error) return wait.reject(new Error(event.error));
  try {
    const res = await fetch(`/api/blob?id=${encodeURIComponent(event.req)}`, { headers: { authorization: `Bearer ${state.token}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    const picture = await unseal((await res.json()).c);
    if (!/^image\/(png|jpeg|gif|webp)$/.test(picture.mime)) throw new Error('That is not a picture.');
    const file = new File([fromBase64(picture.data)], plainName(picture.name, picture.mime), { type: picture.mime });
    wait.record.total = file.size;
    wait.record.got = file.size;
    wait.resolve({ file, smaller: !!event.smaller });
  } catch (err) {
    wait.reject(new Error(`Could not open the picture: ${err.message}`));
  }
}

const SHOWABLE = /^(video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|wav)|image\/(png|jpeg|gif|webp)|application\/(pdf|zip)|text\/plain)$/;

/** The pieces of a file the Mac is sending, fetched in order; the progress is the bytes that arrived. */
async function downloadArrived(event) {
  const wait = downloads.get(event.req);
  if (!wait) return; // asked for by another phone, or replayed from the log
  clearTimeout(wait.timer);
  downloads.delete(event.req);
  if (event.error) return wait.reject(new Error(event.error));
  const record = wait.record;
  try {
    if (!SHOWABLE.test(String(event.mime))) throw new Error('that kind of file cannot be saved here');
    if (!Number.isInteger(event.chunks) || event.chunks < 1 || event.bytes > MAX_FILE_BYTES) throw new Error('the file is too large');
    record.total = event.bytes;
    const parts = [];
    let got = 0;
    let last = Date.now();
    for (let n = 0; n < event.chunks; ) {
      // Cancelled from its card or its preview: the Mac stops by itself after a while.
      if (record.cancelled) throw new Error('Download cancelled.');
      if (Date.now() - last > 120_000) throw new Error('your Mac stopped sending it');
      const res = await fetch(`/api/chunk?id=${event.req}&n=${n}`, { headers: { authorization: `Bearer ${state.token}` } }).catch(() => null);
      if (res?.status === 204) continue;
      if (!res?.ok) {
        await pause(1500);
        continue;
      }
      const bytes = await unsealChunk(event.req, n, (await res.json()).c);
      parts.push(bytes);
      got += bytes.length;
      last = Date.now();
      n += 1;
      record.got = got;
      refreshFile(null);
    }
    if (got !== event.bytes) throw new Error('it did not arrive whole');
    wait.resolve({ file: new File(parts, plainName(event.name, event.mime), { type: event.mime }), smaller: false });
  } catch (err) {
    wait.reject(err);
  }
}

/** On a phone the share sheet is where "Save Video" and "Save to Files" live; elsewhere it is an ordinary download. */
async function saveFile(file, url) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      return await navigator.share({ files: [file] });
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
}

/** Opens the share sheet for a file kept here, without opening its preview. */
async function exportKept(src) {
  const hit = await kept(src.where);
  if (!hit) return keptPaths?.delete(src.where), refreshFile(src.where), toast(`${src.name} is no longer kept on this phone.`);
  const url = URL.createObjectURL(hit.file);
  await saveFile(hit.file, url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── file cards: GENERATED FILES under an answer, the files a message sent from here ──
/** What a card's button does now, from the shared state: save, cancel, retry, share, or nothing. */
function fileAction(src) {
  const t = transfers.get(src.where);
  const name = src.name;
  if (t?.state === 'downloading') {
    const share = t.total ? Math.min(1, t.got / t.total) : null;
    const ring = h('span', { class: `fring${share == null ? ' spin' : ''}`, style: share == null ? '' : `--p:${share}` });
    const label = share == null ? `Downloading ${name}. Tap to cancel.` : `Downloading ${name}, ${Math.round(share * 100)}%. Tap to cancel.`;
    return h('button', { type: 'button', class: 'fact busy', 'aria-label': label, onclick: () => ((t.cancelled = true), refreshFile(src.where)) }, ring, h('span', { class: 'ico', icon: 'cross' }));
  }
  if (isKept(src.where, src.bytes)) return h('button', { type: 'button', class: 'fact saved', 'aria-label': `${name} is saved on this phone. Share or export it.`, onclick: () => exportKept(src) }, h('span', { class: 'ico', icon: 'check' }));
  if (t?.state === 'unavailable') return h('button', { type: 'button', class: 'fact gone', 'aria-label': `${name} is no longer available on your Mac.`, onclick: () => toast('The file is no longer available on your Mac.') }, h('span', { class: 'ico', icon: 'alert' }));
  if (t?.state === 'failed') return h('button', { type: 'button', class: 'fact failed', 'aria-label': `Downloading ${name} failed. Retry.`, onclick: () => saveToPhone(src) }, h('span', { class: 'ico', icon: 'retry' }));
  return h('button', { type: 'button', class: 'fact', 'aria-label': `Save ${name} on this phone`, onclick: () => saveToPhone(src) }, h('span', { class: 'ico', icon: 'download' }));
}

/** The card's button: fetches the file and keeps it here, without opening it. */
function saveToPhone(src) {
  fetchFile(src).then(
    (got) => !got.saved && toast(keepFailure(got.reason, src.name)),
    (err) => transfers.get(src.where)?.state !== 'cancelled' && toast(err.message.endsWith('.') ? err.message : `Could not download ${src.name}: ${err.message}.`),
  );
}

const keepFailure = (reason, name) =>
  reason === 'full' ? 'Not enough available storage to save this file.' : reason === 'too-large' ? `${name} is too large to keep on this phone.` : `${name} could not be kept on this phone.`;

/** The picture at the start of a card: the Mac's small picture of the file, or its kind drawn plainly. */
function fileThumb(f) {
  const kind = fileKind(f.name);
  const picture = cardPicture(f.thumb);
  const time = playTime(f.duration);
  if (!picture) {
    if (kind.tone === 'pdf') return h('span', { class: 'fthumb doc t-pdf', 'aria-hidden': 'true' }, h('b', {}, 'PDF'), h('i'), h('i'), h('i'));
    if (kind.tone === 'video') return h('span', { class: 'fthumb t-video', 'aria-hidden': 'true' }, h('span', { class: 'fplay', icon: 'play' }), time && h('span', { class: 'ftime' }, time));
    if (kind.tone === 'image') return h('span', { class: 'fthumb t-image', 'aria-hidden': 'true', icon: 'image' });
    return h('span', { class: `fthumb t-${kind.tone}`, 'aria-hidden': 'true' }, h('b', {}, kind.label));
  }
  const img = h('img', { src: `data:image/jpeg;base64,${picture}`, alt: '', loading: 'lazy' });
  // A picture that does not decode is swapped for the plain kind of file.
  img.addEventListener('error', () => img.parentElement?.replaceWith(fileThumb({ ...f, thumb: null })), { once: true });
  return h('span', { class: `fthumb pic${kind.tone === 'pdf' ? ' page' : ''}`, 'aria-hidden': 'true' }, img, kind.tone === 'video' && h('span', { class: 'fplay', icon: 'play' }), kind.tone === 'video' && time && h('span', { class: 'ftime' }, time));
}

/** One file: its picture, name, kind · size, folder, and its button. A tap anywhere else opens it. */
function fileRow(given, src, dir = 'down') {
  const f = { ...given, name: plainName(given.name, given.mime) };
  const { stem, ext } = splitName(f.name);
  const facts = [typeName(f.mime, f.name), Number.isFinite(f.bytes) ? fileSize(f.bytes) : f.size].filter(Boolean).join(' · ');
  const folder = folderOf(f.file);
  const open = src ? () => openFile(src, f) : () => fileFacts(f);
  return liveCard(src?.where ?? null, () =>
    h(
      'div',
      { class: `frow ${dir}` },
      h(
        'button',
        { type: 'button', class: 'fopen', 'aria-label': `Open ${f.name}, ${facts}`, title: f.name, onclick: open },
        fileThumb(f),
        h('span', { class: 'fmain' }, h('span', { class: 'fname' }, h('span', { class: 'stem' }, stem), ext && h('span', { class: 'ext' }, ext)), h('span', { class: 'fmeta' }, facts), folder && h('span', { class: 'ffolder' }, h('span', { class: 'ico', icon: 'folder' }), folder)),
      ),
      src ? fileAction(src) : h('span', { class: 'fact still', 'aria-hidden': 'true' }, h('span', { class: 'ico', icon: dir === 'up' ? 'upload' : 'download' })),
    ),
  );
}

/** The files an answer offers: one row alone, or several under GENERATED FILES with their count and size. */
function offered(files, from) {
  if (!Array.isArray(files) || !files.length) return null;
  loadKept();
  const rows = files.map((f, index) => fileRow(f, { kind: 'download', ws: from.ws, item: from.item, index, name: f.name, where: f.file, bytes: f.bytes, mime: f.mime }));
  if (rows.length === 1) return h('div', { class: 'fgroup single' }, rows);
  return h('section', { class: 'fgroup', 'aria-label': 'Generated files' }, h('div', { class: 'fghead' }, h('span', { class: 'ico', icon: 'file' }), h('span', {}, h('span', { class: 'fgtitle' }, 'GENERATED FILES'), h('span', { class: 'fgsub' }, filesSummary(files, fileSize)))), h('div', { class: 'fglist' }, rows));
}

/**
 * The files a message sent from here, as cards in place of the list the agent reads. Tapped, one is
 * fetched back from the Mac, so what arrived there can be checked. The Mac lists them as `files`;
 * a message from before it did is read from its text, and those can only be described.
 */
function sentFiles(item, listed) {
  const known = Array.isArray(item.files) ? item.files : null;
  const rows = known ?? listed.map((l) => ({ name: l.name, file: l.path, size: l.size, mime: null }));
  if (!rows.length) return null;
  loadKept();
  return h('div', { class: 'fgroup single' }, rows.map((f, index) => fileRow(f, known && f.mime ? { kind: 'download', ws: state.view.ws, item: item.id, index, name: f.name, where: f.file, bytes: f.bytes, mime: f.mime } : null, 'up')));
}

/** A path on the Mac as people read it, with ~ for the home folder. */
const homeShort = (file) => String(file ?? '').replace(/^\/Users\/[^/]+(?=\/|$)/, '~');

/** Where a file is on the Mac, with a button that copies the path. */
function placeOnMac(file) {
  const copy = (e) =>
    navigator.clipboard?.writeText(file).then(
      () => ((e.target.textContent = 'Copied'), setTimeout(() => e.target.isConnected && (e.target.textContent = 'Copy'), 1500)),
      () => toast('Could not copy the path.'),
    );
  return h('div', { class: 'fpath' }, h('span', { class: 'mono' }, homeShort(file)), h('button', { type: 'button', onclick: copy }, 'Copy'));
}

/** A file the phone cannot fetch back or show: what is known of it. */
function fileFacts(f) {
  sheet(plainName(f.name, f.mime), h('div', { class: 'muted viewer-note' }, [Number.isFinite(f.bytes) ? fileSize(f.bytes) : f.size, 'saved on your Mac'].filter(Boolean).join(' · ')), f.file && placeOnMac(f.file), h('div', { class: 'viewer-wait muted' }, 'This kind of file cannot be shown on the phone.'));
}

// ── the file preview: one sheet for a picture, a PDF, a video, a sound, a text or a zip ──
/** "PDF Document · 16 KB · 1 page", each part kept on one line when the line wraps. */
const factLine = (parts) => parts.filter(Boolean).map((part) => String(part).replace(/ /g, '\u00a0')).join(' · ');
let previewUrl = null; // the object URL of the file on screen, freed when another opens
const TEXT_PREVIEW_BYTES = 200_000;
const PDF_COUNT_BYTES = 10_000_000; // a PDF up to this size is read for its page count

/**
 * Opens a file from the Mac: from this phone when it is kept here, else fetched with its progress
 * shown. `f` is what the card knew of it (name, mime, bytes, thumb, duration, modified).
 */
async function openFile(src, f = {}) {
  const meta = { ...f, name: plainName(f.name ?? src.name, f.mime ?? src.mime), file: src.where };
  const id = transferId(); // this preview, so a later one is never mistaken for it
  let shown = null; // { file, saved, reason, smaller } once there is a file to show
  let failure = null;
  let details = false;
  let media = null; // made once and moved into each redraw, so a redraw does not stop a video
  // Still on screen: closed, or replaced by another sheet, it is never drawn again.
  const mine = () => !$('sheet').hidden && $('sheet').querySelector('.panel')?.dataset.pv === id;
  const cancel = () => {
    const t = transfers.get(src.where);
    if (t) (t.cancelled = true), refreshFile(src.where);
  };

  const draw = (first = false) => {
    if (!first && !mine()) return;
    const t = transfers.get(src.where);
    sheetKeeps = media;
    sheet({ label: meta.name, head: previewHead(meta, shown, t, failure) }, ...previewBody(meta, shown, t, failure, { retry: start, cancel }), sourceRow(meta, shown, () => ((details = !details), draw()), details), previewActions(meta, shown));
    sheetKeeps = null;
    const panel = $('sheet').querySelector('.panel');
    panel.classList.add('fpv');
    panel.dataset.pv = id;
    const slot = panel.querySelector('.fpv-stage');
    if (slot && shown) slot.replaceChildren((media ??= previewMedia(shown.file, meta)));
  };
  const update = (changed) => {
    if (!mine()) return fileUpdaters.delete(update);
    if (changed != null && changed !== src.where) return;
    // Only the status line and the progress move while a file comes in: the rest is not redrawn.
    const t = transfers.get(src.where);
    $('sheet').querySelector('.fpv-status')?.replaceWith(previewStatus(meta, shown, t, failure));
    if (t?.state === 'downloading') $('sheet').querySelector('.fpv-progress')?.replaceWith(progressBlock(t, cancel));
  };

  async function start() {
    failure = null;
    draw();
    try {
      shown = await fetchFile(src);
      meta.type = shown.file.type;
      meta.bytes = shown.file.size;
    } catch (err) {
      failure = err.message;
    }
    draw();
  }

  draw(true);
  fileUpdaters.add(update);
  const hit = await kept(src.where, { bytes: Number.isFinite(src.bytes) ? src.bytes : null });
  if (!mine()) return;
  if (hit) {
    // Kept here already: it opens without asking the Mac.
    shown = { file: hit.file, saved: true, reason: null, smaller: hit.smaller };
    meta.type = hit.file.type;
    meta.bytes = hit.file.size;
    if (keptPaths && keptPaths.get(src.where) !== hit.file.size) keptPaths.set(src.where, hit.file.size), refreshFile(src.where);
    return draw();
  }
  if (keptPaths?.has(src.where)) keptPaths.delete(src.where), refreshFile(src.where); // evicted, or another size now
  start();
}

/** Icon, name, kind · size, whether it is kept here, and Share and Close. */
function previewHead(meta, shown, t, failure) {
  const kind = previewKind(meta.type ?? meta.mime, meta.name);
  const { stem, ext } = splitName(meta.name);
  const share = h('button', { type: 'button', class: 'fpv-icon', 'aria-label': `Share ${meta.name}`, disabled: !shown, onclick: () => shown && saveFile(shown.file, previewUrl) }, h('span', { class: 'ico', icon: 'share' }));
  const close = h('button', { type: 'button', class: 'fpv-icon', 'aria-label': 'Close', onclick: closeSheet }, h('span', { class: 'ico', icon: 'cross' }));
  const tile = h('span', { class: `fpv-tile t-${fileKind(meta.name).tone}`, icon: kind === 'image' ? 'image' : kind === 'video' ? 'play' : kind === 'audio' ? 'wave' : 'file' });
  const pages = meta.pages ? `${meta.pages} page${meta.pages === 1 ? '' : 's'}` : null;
  const facts = factLine([typeName(meta.type ?? meta.mime, meta.name), Number.isFinite(meta.bytes) ? fileSize(meta.bytes) : null, pages, playTime(meta.duration)]);
  return h(
    'div',
    { class: 'fpv-head' },
    tile,
    h('div', { class: 'fpv-title' }, h('h3', { class: 'fname', title: meta.name }, h('span', { class: 'stem' }, stem), ext && h('span', { class: 'ext' }, ext)), h('span', { class: 'fpv-facts' }, facts), previewStatus(meta, shown, t, failure)),
    share,
    close,
  );
}

/** Whether the file is kept on this phone, said only once it reads back from the phone's storage. */
function previewStatus(meta, shown, t, failure) {
  let tone = 'muted';
  let text;
  if (shown?.saved) (tone = 'success'), (text = 'Saved on this phone');
  else if (shown) (tone = 'warning'), (text = `Not saved on this phone: ${keepFailure(shown.reason, meta.name).replace(/\.$/, '').replace(/^Not enough/, 'not enough')}`);
  else if (t?.state === 'downloading') text = t.total ? `Downloading from your Mac… ${Math.round((t.got / t.total) * 100)}%` : 'Fetching from your Mac…';
  else if (failure) (tone = 'danger'), (text = t?.state === 'unavailable' ? 'Not on your Mac any more' : 'Not downloaded');
  else text = 'Checking this phone…';
  return h('span', { class: `fpv-status ${tone}`, role: 'status' }, tone === 'success' && h('span', { class: 'ico', icon: 'check' }), text);
}

/** Bytes that arrived of how many, as a bar, with Cancel. Never a guess: no total, no percentage. */
function progressBlock(t, cancel) {
  const share = t.total ? Math.min(1, t.got / t.total) : null;
  return h(
    'div',
    { class: 'fpv-progress' },
    h('div', { class: `bar${share == null ? ' indeterminate' : ''}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', ...(share == null ? {} : { 'aria-valuenow': String(Math.round(share * 100)) }) }, h('span', { style: share == null ? '' : `width:${(share * 100).toFixed(1)}%` })),
    h('div', { class: 'row-line' }, h('span', { class: 'muted small' }, share == null ? 'Fetching from your Mac…' : `${fileSize(t.got)} of ${fileSize(t.total)}`), h('button', { type: 'button', class: 'linkish', onclick: cancel }, 'Cancel')),
  );
}

/** The middle of the sheet: the file itself, its progress while it comes, or what went wrong. */
function previewBody(meta, shown, t, failure, { retry, cancel }) {
  if (shown) return [h('div', { class: 'fpv-stage' }), shown.smaller && h('div', { class: 'muted viewer-note' }, 'A smaller copy: the file on the Mac was too large to send whole.')];
  if (failure) {
    const gone = t?.state === 'unavailable';
    return [h('div', { class: 'fpv-stage empty' }, h('span', { class: 'ico big', icon: gone ? 'alert' : 'cloud' }), h('p', {}, gone ? 'The file is no longer available on your Mac.' : failure), !gone && h('button', { type: 'button', class: 'btn small', onclick: retry }, 'Retry'))];
  }
  if (t?.state === 'downloading') return [h('div', { class: 'fpv-stage empty' }, h('span', { class: 'ico big', icon: 'download' }), progressBlock(t, cancel))];
  return [h('div', { class: 'fpv-stage empty' }, h('span', { class: 'muted' }, 'Looking for it on this phone…'))];
}

/**
 * The file drawn for looking at, in a holder that stays the same when what is in it changes (a PDF
 * framed once checked, a video that will not play), so a redraw of the sheet moves the holder along.
 */
function previewMedia(file, meta) {
  const holder = h('div', { class: 'fpv-holder' });
  holder.append(previewInner(file, meta, holder));
  return holder;
}

/** What the holder shows first. Text is shown as text only, never run as a page. */
function previewInner(file, meta, holder) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  const url = previewUrl;
  const broken = (el, why = 'Unable to preview this file.') => el.replaceWith(h('div', { class: 'fpv-broken' }, h('span', { class: 'ico big', icon: 'alert' }), h('p', {}, why), h('p', { class: 'muted small' }, 'The button below still saves the file.')));
  const kind = previewKind(file.type, file.name);
  if (kind === 'image') {
    const img = h('img', { class: 'fpv-media', src: url, alt: file.name, onclick: () => zoomView(url, file.name) });
    img.addEventListener('error', () => broken(img), { once: true });
    return img;
  }
  if (kind === 'video') {
    const poster = cardPicture(meta.thumb);
    const video = h('video', { class: 'fpv-media', src: url, controls: true, playsinline: true, preload: 'metadata', ...(poster ? { poster: `data:image/jpeg;base64,${poster}` } : {}) });
    video.addEventListener('error', () => broken(video, 'This video cannot be played on this phone. It may be encoded in a way the phone does not support.'), { once: true });
    video.addEventListener('loadedmetadata', () => {
      if (!meta.duration && Number.isFinite(video.duration)) (meta.duration = video.duration), $('sheet').querySelector('.fpv-facts')?.replaceChildren(document.createTextNode(factLine([typeName(file.type, file.name), fileSize(file.size), playTime(video.duration)])));
    });
    return video;
  }
  if (kind === 'audio') return h('audio', { class: 'fpv-audio', src: url, controls: true });
  if (kind === 'pdf') {
    // Framed only once its first bytes say PDF: the type came from the file's name on the Mac.
    const frame = h('div', { class: 'fpv-media doc wait' });
    file
      .slice(0, 5)
      .text()
      .then((magic) => {
        if (magic !== '%PDF-') return broken(frame, 'Unable to preview this file: it is not a PDF inside.');
        frame.replaceWith(h('iframe', { class: 'fpv-media doc', src: url, title: file.name }));
      });
    if (!meta.pages && file.size <= PDF_COUNT_BYTES)
      file.arrayBuffer().then((buf) => {
        const pages = pdfPages(new TextDecoder('latin1').decode(buf));
        if (pages && holder.isConnected) (meta.pages = pages), $('sheet').querySelector('.fpv-facts')?.replaceChildren(document.createTextNode(factLine([typeName(file.type, file.name), fileSize(file.size), `${pages} page${pages === 1 ? '' : 's'}`])));
      });
    return frame;
  }
  if (kind === 'text') {
    const pre = h('pre', { class: 'fpv-media text' }, 'Reading…');
    file
      .slice(0, TEXT_PREVIEW_BYTES)
      .text()
      .then((text) => (pre.textContent = file.size > TEXT_PREVIEW_BYTES ? `${text}\n… (the first ${fileSize(TEXT_PREVIEW_BYTES)})` : text));
    return pre;
  }
  if (kind === 'zip') {
    const list = h('ul', { class: 'fpv-media zip' }, h('li', { class: 'muted' }, 'Reading…'));
    listZip(file).then((zip) => {
      if (!zip) return list.replaceChildren(h('li', { class: 'muted' }, 'This zip could not be read.'));
      list.replaceChildren(...zip.entries.map((e) => h('li', { class: e.folder ? 'folder' : null }, h('span', { class: 'mono' }, e.name), !e.folder && h('span', { class: 'muted' }, fileSize(e.bytes)))));
    });
    return list;
  }
  return h('div', { class: 'fpv-broken' }, h('span', { class: 'ico big', icon: 'file' }), h('p', {}, 'Preview is not available for this file type.'), h('p', { class: 'muted small' }, 'The button below still saves the file.'));
}

/** The folder it is in on the Mac; tapped, the details: the whole path, its type, size, dates, where it is kept. */
function sourceRow(meta, shown, toggle, open) {
  if (!meta.file) return null;
  const folder = folderOf(meta.file).split('/').filter(Boolean);
  const row = h('button', { type: 'button', class: 'fpv-src', 'aria-expanded': String(open), onclick: toggle }, h('span', { class: 'ico', icon: 'folder' }), h('span', { class: 'grow' }, ...folder.flatMap((part, i) => [i ? h('span', { class: 'sep' }, ' / ') : null, h('span', { class: i === folder.length - 1 ? 'last' : '' }, part)])), h('span', { class: `ico chev${open ? ' open' : ''}`, icon: 'chevron' }));
  if (!open) return row;
  const ws = state.workspaces.get(state.view.ws);
  const fact = (label, value) => value && h('div', { class: 'fpv-fact' }, h('span', { class: 'muted' }, label), h('span', {}, value));
  return h(
    'div',
    {},
    row,
    h(
      'div',
      { class: 'fpv-details' },
      fact('Name', meta.name),
      fact('Type', [typeName(meta.type ?? meta.mime, meta.name), meta.type ?? meta.mime].filter(Boolean).join(' · ')),
      fact('Size', Number.isFinite(meta.bytes) ? `${fileSize(meta.bytes)} (${meta.bytes.toLocaleString()} bytes)` : null),
      fact('Changed on the Mac', Number.isFinite(meta.modified) ? new Date(meta.modified).toLocaleString() : null),
      fact('Session', ws?.name),
      fact('On this phone', shown?.saved ? 'Kept in this app’s storage (not in Photos or Files)' : 'Not kept'),
      placeOnMac(meta.file),
    ),
  );
}

/**
 * Where Save puts a file of this kind: a picture or video into Photos, anything else into Files.
 * Both go through the share sheet (a web page cannot write to Photos itself), so "Save Image",
 * "Save Video" or "Save to Files" is one more tap there. Without a share sheet it is a download.
 */
function saveLabel(kind, file) {
  if (file && !navigator.canShare?.({ files: [file] })) return 'Download';
  return kind === 'image' || kind === 'video' ? 'Save to Photos' : 'Save to Files';
}

/** Fullscreen (a picture or video) or Open (a PDF, in the phone's viewer), and Save. */
function previewActions(meta, shown) {
  const kind = previewKind(meta.type ?? meta.mime, meta.name);
  const media = () => $('sheet').querySelector('.fpv-media');
  const big = kind === 'image' || kind === 'video';
  const open = () => {
    if (!shown) return;
    if (kind === 'image') return zoomView(previewUrl, meta.name);
    const video = media();
    if (kind === 'video' && video) return video.webkitEnterFullscreen ? video.webkitEnterFullscreen() : video.requestFullscreen?.();
    window.open(previewUrl, '_blank');
  };
  return h('div', { class: 'actions even fpv-actions' }, h('button', { type: 'button', class: 'btn', disabled: !shown, onclick: open }, big ? 'Fullscreen' : 'Open'), h('button', { type: 'button', class: 'btn primary', disabled: !shown, onclick: () => shown && saveFile(shown.file, previewUrl) }, saveLabel(kind, shown?.file)));
}

/** The pictures a step or message showed, tapped: the whole of one, from this phone or the Mac. */
function openPicture(ws, item, index, name, path = null) {
  return openFile({ kind: 'picture', ws, item, index, name, where: path, bytes: null }, { name });
}

/** The small preview of a picture whose whole was never kept on the Mac. */
function showPreviewOnly(image) {
  sheet(
    image.name,
    h('img', { class: 'viewer', src: `data:${image.mime};base64,${image.thumb}`, alt: image.name }),
    h('div', { class: 'muted viewer-note' }, 'Only a small preview of this picture was kept. Pictures sent from now on open whole.'),
  );
}

/** A picture or file waiting in the composer, opened to check it before it is sent. */
function previewWaiting(a) {
  const file = a.kind === 'file' ? a.file : originals.get(a);
  const remove = h('button', { type: 'button', class: 'btn', onclick: () => ((attachments = attachments.filter((x) => x !== a)), showAttachments(), closeSheet()) }, 'Remove');
  const keepIt = h('button', { type: 'button', class: 'btn primary', onclick: closeSheet }, 'Keep');
  if (!file) return sheet(a.name, h('img', { class: 'viewer', src: `data:image/jpeg;base64,${a.data}`, alt: a.name }), h('div', { class: 'actions even' }, remove, keepIt));
  // Named as it will be sent (`image.png`, not the phone's made-up name).
  const meta = { name: a.name, type: file.type, bytes: file.size };
  const close = h('button', { type: 'button', class: 'fpv-icon', 'aria-label': 'Close', onclick: closeSheet }, h('span', { class: 'ico', icon: 'cross' }));
  const { stem, ext } = splitName(a.name);
  const head = h('div', { class: 'fpv-head' }, h('span', { class: `fpv-tile t-${fileKind(a.name).tone}`, icon: 'upload' }), h('div', { class: 'fpv-title' }, h('h3', { class: 'fname' }, h('span', { class: 'stem' }, stem), ext && h('span', { class: 'ext' }, ext)), h('span', { class: 'fpv-facts' }, factLine([typeName(file.type, a.name), fileSize(file.size)])), h('span', { class: 'fpv-status muted' }, 'Not sent yet')), close);
  sheet({ label: a.name, head }, h('div', { class: 'fpv-stage' }, previewMedia(file, meta)), h('div', { class: 'actions even fpv-actions' }, remove, keepIt));
  $('sheet').querySelector('.panel').classList.add('fpv');
}

// ── a picture made big: pinch, double-tap and drag, over everything ──
function zoomView(url, name) {
  if (!url) return;
  let scale = 1;
  let x = 0;
  let y = 0;
  let from = null; // where the fingers and the picture were when the last finger went down or up
  let lastTap = 0;
  const points = new Map();
  const img = h('img', { src: url, alt: name, draggable: 'false' });
  const apply = () => (img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`);
  const centre = () => ({ x: layer.clientWidth / 2, y: layer.clientHeight / 2 });
  const middle = () => {
    const p = [...points.values()];
    return p.length === 2 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) } : { ...p[0], d: 0 };
  };
  // The picture's place and the fingers' middle when a finger last went down or up.
  const mark = () => {
    const m = points.size ? middle() : null;
    from = m ? { scale, tx: x, ty: y, mx: m.x, my: m.y, d: m.d } : null;
  };
  // Zoomed about a point that stays under the fingers: screen = centre + t + s·local.
  const zoomAbout = (s, m0, m1 = m0) => {
    const c = centre();
    const lx = (m0.x - c.x - from.tx) / from.scale;
    const ly = (m0.y - c.y - from.ty) / from.scale;
    scale = Math.min(6, Math.max(1, s));
    x = m1.x - c.x - scale * lx;
    y = m1.y - c.y - scale * ly;
    if (scale === 1) x = y = 0;
    apply();
  };
  const close = () => {
    layer.remove();
    window.removeEventListener('keydown', onKey, true);
    $('sheet').querySelector('.fpv-actions .btn')?.focus({ preventScroll: true });
  };
  // Escape closes the big picture only, not the preview under it: caught before the sheet's own handler.
  const onKey = (e) => e.key === 'Escape' && (e.stopImmediatePropagation(), close());
  const layer = h('div', { class: 'zoom', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${name}, pinch or double-tap to zoom` }, img, h('button', { type: 'button', class: 'zoom-close', 'aria-label': 'Close fullscreen', icon: 'cross', onclick: close }));
  layer.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.zoom-close')) return;
    layer.setPointerCapture(e.pointerId);
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (points.size === 1) {
      const now = Date.now();
      if (now - lastTap < 300) {
        mark();
        zoomAbout(scale > 1 ? 1 : 2.5, { x: e.clientX, y: e.clientY });
        lastTap = 0;
      } else lastTap = now;
    }
    mark();
  });
  layer.addEventListener('pointermove', (e) => {
    if (!points.has(e.pointerId) || !from) return;
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = middle();
    if (points.size === 2 && from.d) zoomAbout((from.scale * m.d) / from.d, { x: from.mx, y: from.my }, m);
    else if (points.size === 1 && scale > 1) (x = from.tx + m.x - from.mx), (y = from.ty + m.y - from.my), apply();
  });
  const up = (e) => {
    points.delete(e.pointerId);
    mark();
  };
  layer.addEventListener('pointerup', up);
  layer.addEventListener('pointercancel', up);
  window.addEventListener('keydown', onKey, true);
  document.body.append(layer);
  layer.querySelector('.zoom-close').focus({ preventScroll: true });
}

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
      h('div', { class: 'body' }, hasMore ? expandable(item, head, item.diff && diffView(item.diff, item.summary), item.output?.length ? h('pre', { class: 'out' }, item.output.join('\n')) : null) : head, pictures(item.images, 'wide', { ws: state.view.ws, item: item.id })),
    );
  }
  if (item.kind === 'user') {
    // Files sent with it show as cards; the list the agent reads under the words is not repeated.
    const { said, listed } = splitSent(item.text);
    // Its node is the pixel person, moving with the robot's animation setting.
    return h('li', { class: 'ev user' }, h('span', { class: state.device?.settings?.animation === false ? 'node still' : 'node', icon: 'you' }), h('div', { class: 'body' }, h('div', { class: 'headline' }, h('span', { class: 'who' }, 'YOU'), item.via && h('span', { class: 'tag primary' }, item.via === 'steer' ? 'STEERED' : 'QUEUED'), time), said && h('div', { class: 'said' }, said), sentFiles(item, listed), pictures(item.images, '', { ws: state.view.ws, item: item.id, user: true })));
  }
  if (item.kind === 'assistant') {
    if (!item.text) return null;
    // Its node is the robot from the header, blinking with it unless animation is turned off.
    return h('li', { class: 'ev assistant' }, h('span', { class: state.device?.settings?.animation === false ? 'node still' : 'node', icon: 'logo' }), h('div', { class: 'body' }, h('div', { class: 'headline' }, h('span', { class: 'who' }, 'SEEKER'), time), h('div', { class: 'prose' }, prose(item.text)), offered(item.files, { ws: state.view.ws, item: item.id })));
  }
  return h('li', { class: `ev notice ${item.level}` }, h('span', { class: 'node' }), h('div', { class: 'body' }, h('span', { class: 'sub' }, item.text, ' ', time)));
}

let keepFromBottom = null; // set when earlier entries are asked for: the reader stays on the entry they were on

/** `items` in the order they happened; `tail` is one more entry to close the list with. */
function timeline(ws, items = ws.items, tail = null, { key = ws.meta.id, compact = false } = {}) {
  const shown = state.shown.get(key) ?? PAGE;
  const visible = items.slice(-shown);
  return [
    items.length > visible.length && h('button', { class: 'btn quiet small', onclick: () => ((keepFromBottom = $('view').scrollHeight - $('view').scrollTop), state.shown.set(key, shown + PAGE), render(true)) }, `Show ${Math.min(PAGE, items.length - visible.length)} earlier entries`),
    h('ol', { class: compact ? 'timeline compact' : 'timeline' }, visible.map(entry), tail),
  ];
}

/** The step that is waiting for the user, at the end of the timeline. It only says what is waiting: the Review button above the message box opens it. */
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
    card('layers', 'CONTEXT', pct == null ? '—' : `${pct}%`, `${big(meta.used)} / ${sizeOf(meta.limit)}`, h('div', { class: 'track' }, h('div', { class: `fill${pct > 80 ? ' warning' : ''}`, style: `width:${pct ?? 0}%` }))),
    // Counted by the provider. Before its first report there is nothing true to show.
    // In and out each get a line: side by side they do not fit a third of a phone's width.
    card('cube', 'TOKENS', tokens ? big(tokens.totalInput + tokens.totalOutput) : '—', tokens ? `${big(tokens.totalInput)} in` : 'not reported yet', tokens && h('div', { class: 'small' }, `${big(tokens.totalOutput)} out`)),
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
      !meta.terminal && h('button', { class: 'row-btn', onclick: () => chooseModel(meta.id) }, `/model — switch the model${meta.ownModel ? ' (its own)' : ''}`),
      h('button', { class: 'row-btn', onclick: () => (closeSheet(), chooseProjectCharacter(meta)) }, `Character — ${projectCharacterLabel(meta)}`),
      !meta.terminal && h('button', { class: 'row-btn', onclick: () => (closeSheet(), newConversation(meta)) }, '/new — start a new conversation'),
      !meta.terminal && h('button', { class: 'row-btn danger', onclick: () => (closeSheet(), confirm(`Close ${meta.name}? Its conversation is saved on your Mac.`) && (command('close', { ws: meta.id }), go({ name: 'home' }))) }, 'Close this project'),
    );
  const up = state.linked && state.online;
  const tab = state.sessionTab;
  const tabButton = (id, label) => h('button', { class: tab === id ? 'active' : '', role: 'tab', id: `tab-${id}`, 'aria-selected': String(tab === id), 'aria-controls': 'view', tabindex: tab === id ? '0' : '-1', onclick: () => ((state.sessionTab = id), render(true)) }, label);
  // Left and right move between the tabs, as in any tab list.
  const tabKeys = (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    state.sessionTab = SESSION_TABS[(SESSION_TABS.indexOf(tab) + step + SESSION_TABS.length) % SESSION_TABS.length];
    draw();
    $(`tab-${state.sessionTab}`)?.focus();
  };
  const tools = items.filter((i) => i.kind === 'tool');
  const body =
    tab === 'tools'
      ? tools.length
        ? toolsBody(ws, tools, pending)
        : [h('div', { class: 'empty' }, 'No tool has run in this conversation yet.'), pending && h('ol', { class: 'timeline' }, waitingEntry(pending))]
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
                : h('button', { class: 'row', 'aria-label': 'Change model', onclick: () => chooseModel(meta.id) }, h('span', { class: 'ico', icon: 'cube' }), h('span', { class: 'grow' }, h('span', { class: 'label mono line' }, meta.model, h('span', { class: 'muted' }, ' • ', meta.provider, meta.ownModel ? ' • own model' : ' • default'))), h('span', { class: 'chev', icon: 'down' })),
            ),
          ]
        : items.length || pending || st.busy || ws.queue?.items.length
          ? timeline(ws, items, [pending ? waitingEntry(pending) : workingEntry(meta), queuedEntry(ws.queue)])
          : [h('div', { class: 'empty' }, 'Nothing has happened in this conversation yet.')];
  // The head stays where it is while the body below it scrolls: see draw().
  const head = [
    h('div', { class: 'topbar' }, h('button', { class: 'back', 'aria-label': 'Back', icon: 'back', onclick: () => go({ name: 'home' }) }), h('div', { class: 'grow' }, h('div', { class: 'name line' }, meta.name), h('div', { class: 'sub mono line' }, meta.terminal ? 'terminal • ' : '', meta.branch || 'no git', ' • ', meta.model)),
      // What the agent is doing, in words beside the title. How full the context is stays under the message box.
      up ? h('span', { class: `state-chip plain ${st.tone}${st.busy ? ' busy' : ''}`, role: 'status' }, h('i'), STATE_WORD[st.key]) : h('span', { class: 'state-chip plain danger', role: 'status' }, h('i'), 'Offline'),
      h('button', { class: 'more', 'aria-label': 'More', onclick: menu }, '•••')),
    h('div', { class: 'tabs seg', role: 'tablist', 'aria-label': 'Session views', onkeydown: tabKeys }, tabButton('activity', 'Activity'), tabButton('tools', tools.length ? `Tools · ${tools.length}` : 'Tools'), tabButton('metrics', 'Metrics')),
    tab === 'tools' && tools.length > 0 && toolFilters(tools),
  ].filter(Boolean);
  return { head, body };
}

/** The Tools tab's filters, each with how many tools it holds. One that holds none is left out, unless it is the one chosen. */
function toolFilters(tools) {
  return h(
    'div',
    { class: 'tool-filters', role: 'group', 'aria-label': 'Show tools' },
    filtersFor(tools, state.toolFilter).map((f) => h('button', { type: 'button', class: `${f.active ? 'active' : ''}${f.id === 'failed' && f.count ? ' danger' : ''}`, 'aria-pressed': String(f.active), onclick: () => ((state.toolFilter = f.id), render(true)) }, f.label, h('span', { class: 'n' }, f.count))),
  );
}

/** The Tools tab: the tools that pass the filter, one or two lines each, and a request that waits for the user at the foot. */
function toolsBody(ws, tools, pending) {
  const shown = filterTools(tools, state.toolFilter);
  const waiting = pending ? waitingEntry(pending) : null;
  if (!shown.length) return [h('div', { class: 'empty' }, `No ${filterLabel(state.toolFilter).toLowerCase()} tools in this conversation.`), waiting && h('ol', { class: 'timeline' }, waiting)];
  return timeline(ws, shown, waiting, { key: `${ws.meta.id}:tools:${state.toolFilter}`, compact: true });
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
// Lines really added and removed, where the Mac worked that out; otherwise the size of the old and new text.
const diffCounts = (diff) => (diff?.hunk ? { added: diff.hunk.added, removed: diff.hunk.removed } : (diff?.counts ?? (diff ? { added: diff.added?.length ?? 0, removed: diff.removed?.length ?? 0 } : null)));
const plusMinus = (counts) => [h('span', { class: 'success' }, `+${counts.added}`), ' ', h('span', { class: 'danger' }, `−${counts.removed}`)];

// A request in the list: which project asks, what kind of thing it is, and the thing itself — the
// command, the file, the question — so it can be judged before it is opened.
const ASKS = { exec: ['Command', 'terminal'], write: ['File change', 'file'], net: ['Network', 'cloud'], other: ['Tool', 'bolt'], question: ['Question', 'help'] };

function approvalRow(a) {
  const [label, icon] = ASKS[a.kind] ?? ASKS.other;
  const counts = diffCounts(a.diff);
  const answers = a.options?.length ?? 0;
  const detail = a.kind === 'question' ? (answers ? `${answers} suggested answer${answers === 1 ? '' : 's'}` : 'Your own answer') : counts ? plusMinus(counts) : a.warning ? label : null;
  return h(
    'button',
    { class: 's-row', 'aria-label': `${label} in ${a.wsName}: ${a.kind === 'question' ? a.title : a.summary}`, onclick: () => go({ name: 'review', id: a.id, from: { name: 'approvals' } }) },
    h('span', { class: 'ico', icon }),
    h(
      'span',
      { class: 'grow' },
      // One word on the right: what kind of request it is, or that it is one to be careful with.
      h('span', { class: 'top' }, h('span', { class: 'name line' }, a.wsName), h('span', { class: `pill ${a.warning ? 'danger' : 'primary'}` }, h('i'), a.warning ? 'Dangerous' : label)),
      h('span', { class: `task line${a.kind === 'question' ? '' : ' mono'}` }, a.kind === 'question' ? a.title : a.summary),
      h('span', { class: 'meta mono line' }, detail, h('time', { datetime: new Date(a.at).toISOString() }, `${detail ? ' · ' : ''}${ago(a.at)}`)),
    ),
    h('span', { class: 'chev', icon: 'chevron' }),
  );
}

function approvals() {
  const count = state.approvals.length;
  return [
    header(),
    h('div', { class: 'page-head' }, h('h1', { class: 'grow' }, 'Approvals')),
    h('p', { class: 'page-sub' }, count ? `${count} request${count === 1 ? ' is' : 's are'} waiting for you.` : 'Commands and file changes wait here until you allow them.'),
    count ? h('div', { class: 's-list' }, state.approvals.map(approvalRow)) : h('div', { class: 'empty' }, h('b', {}, 'Nothing is waiting for you'), 'Every command and every file change an agent wants to make shows up here first.'),
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
  const ws = state.workspaces.get(row.id);
  const who = ws && whoFor(ws.meta);
  return h(
    'button',
    { class: `s-row${row.id === state.lastSession ? ' selected' : ''}`, 'data-ws': row.id, 'aria-current': row.id === state.lastSession ? 'true' : null, onclick: () => go({ name: 'session', ws: row.id }) },
    who ? bot(moodOf(ws, { up: state.linked && state.online }), 'sm', { label: false, who }) : h('span', { class: 'ico', icon: 'folder' }),
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

let sessionHead = []; // the open session's title, state and tabs, as last built

/** The scrolling part of a session; its head is kept aside for the region above. */
function sessionParts(ws) {
  const built = session(ws);
  if (Array.isArray(built)) return built; // the project was closed: one plain screen
  sessionHead = built.head;
  return built.body;
}

/** What the Sessions screen shows now, and a signature of it: the screen is redrawn only when that changes. */
function sessionsNow() {
  const model = sessionsView([...state.workspaces.values()], state.list);
  const labels = model.rows.map((r) => [r.id, r.name, r.status, r.task, r.model, r.tools, since(r.at)]);
  const signature = JSON.stringify([state.linked, state.online, state.loaded, state.device?.name, state.device?.settings?.animation, characterSetting, projectCharacters, state.list, state.lastSession, model.count, labels]);
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
    section('DEFAULT MODEL'),
    // What a project runs unless it was given its own (from inside it). Details come from one that follows it.
    (() => {
      const follower = [...state.workspaces.values()].map((w) => w.meta).find((m) => !m.terminal && !m.ownModel);
      const own = [...state.workspaces.values()].filter((w) => w.meta.ownModel).length;
      const detail = follower ? `${follower.provider} · ${sizeOf(follower.limit)} context${follower.vision === false ? ' · no images' : follower.vision ? ' · sees images' : ''}` : (state.device?.provider ?? '');
      const note = own ? `${own} project${own > 1 ? 's' : ''} on ${own > 1 ? 'their' : 'its'} own model` : 'Every project uses it';
      return h('div', { class: 'group' }, row('cube', state.device?.model ?? first?.model ?? '—', null, { sub: [detail, note].filter(Boolean).join(' · '), onclick: up ? () => chooseModel() : null }));
    })(),
    ...agentSettings(up, toggle),
    section('AGENT CHARACTER'),
    h('div', { class: 'group' }, row('logo', 'Live Agent character', characterChoiceLabel(characterSetting), { sub: 'Kept on this phone. Auto picks a character by the session’s model.', onclick: chooseCharacter })),
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
    ...lockSettings(toggle),
    section('PRIVACY & SECURITY'),
    h(
      'div',
      { class: 'group' },
      row('lock', 'End-to-end encryption', 'On', { tone: 'success', sub: 'AES-256-GCM between this phone and your Mac' }),
      row('eyeoff', 'Relay', 'Cannot read', { tone: 'success', sub: 'It holds only a hash of the access token' }),
      row('phone', 'This phone', 'Paired', { tone: 'success', sub: 'The pairing secret is stored on this device only' }),
      keptRow(),
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
    h('button', { class: 'btn quiet danger unpair', onclick: () => confirm('Remove the pairing from this phone?') && (saveLock(null), signOut()) }, 'Unpair this phone'),
  ];
}

/** The files from the Mac kept on this phone: how many and how much, and a tap opens their list. */
function keptRow() {
  if (state.keptInfo === undefined) {
    state.keptInfo = null;
    keptSize().then((info) => ((state.keptInfo = info), state.view.name === 'settings' && render()));
  }
  const info = state.keptInfo;
  return row('download', 'Files kept on this phone', info ? (info.count ? fileSize(info.bytes) : 'None') : '…', { sub: info?.count ? `${info.count} file${info.count === 1 ? '' : 's'} open without downloading again` : 'Files you open from the Mac are kept, so they open again without downloading', onclick: info?.count ? keptSheet : null });
}

/** Every file kept here, newest first: open one, share it, remove it, or remove them all. */
async function keptSheet() {
  const list = await keptList();
  const changed = () => {
    state.keptInfo = undefined;
    refreshFile(null);
    if (state.view.name === 'settings') render();
  };
  const removeAll = () => {
    if (!confirm('Remove the files kept on this phone?\n\nThey stay on your Mac and download again when opened.')) return;
    clearKept().then(() => ((keptPaths = new Map()), changed(), closeSheet(), toast('Kept files removed.')));
  };
  const total = list.reduce((sum, e) => sum + e.bytes, 0);
  sheet(
    'Files kept on this phone',
    h('p', { class: 'sheet-sub' }, `${list.length} file${list.length === 1 ? '' : 's'} · ${fileSize(total)} in this app’s storage. Not in Photos or Files: open one and tap Save for that. The phone may clear them when it runs short of space.`),
    list.length
      ? h(
          'div',
          { class: 'fgroup single' },
          list.map((kept) => {
            const e = { ...kept, name: plainName(kept.name, kept.type) };
            const src = { kind: 'download', name: e.name, where: e.path, bytes: e.bytes, mime: e.type };
            const f = { name: e.name, file: e.path, bytes: e.bytes, mime: e.type };
            const remove = h('button', { type: 'button', class: 'fact gone', 'aria-label': `Remove ${e.name} from this phone`, onclick: () => forget(e.path).then(() => (keptPaths?.delete(e.path), changed(), keptSheet())) }, h('span', { class: 'ico', icon: 'cross' }));
            const { stem, ext } = splitName(e.name);
            return h(
              'div',
              { class: 'frow' },
              h('button', { type: 'button', class: 'fopen', 'aria-label': `Open ${e.name}`, onclick: () => openFile(src, f) }, fileThumb(f), h('span', { class: 'fmain' }, h('span', { class: 'fname' }, h('span', { class: 'stem' }, stem), ext && h('span', { class: 'ext' }, ext)), h('span', { class: 'fmeta' }, [typeName(e.type, e.name), fileSize(e.bytes)].join(' · ')), h('span', { class: 'ffolder' }, h('span', { class: 'ico', icon: 'folder' }), folderOf(e.path)))),
              remove,
            );
          }),
        )
      : h('p', { class: 'quiet pad' }, 'Nothing is kept on this phone.'),
    list.length > 0 && h('button', { type: 'button', class: 'btn quiet danger', onclick: removeAll }, 'Remove all'),
  );
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

// ── app lock: Face ID, a 6-digit PIN behind it (lock.js holds the rules) ─────
const lockStore = {
  getItem: (key) => stored(key, null),
  setItem: store,
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};
let lockCfg = readLock(lockStore);
let lastActive = Number.parseInt(stored(ACTIVE_KEY, ''), 10);
let activeSaved = 0;
let pad = null; // the PIN pad on screen: { kind: 'unlock' | 'verify' | 'set', title, sub, entry, note, then }

function saveLock(cfg) {
  lockCfg = cfg;
  writeLock(lockStore, cfg);
}

/** The app was used: the lock's clock starts again. Written to storage at most every 5 s, and always when the app goes away. */
function touched(force = false) {
  if (state.locked) return;
  lastActive = Date.now();
  if (force || lastActive - activeSaved > 5000) {
    activeSaved = lastActive;
    store(ACTIVE_KEY, String(lastActive));
  }
}

function lockNow() {
  if (!lockCfg || !state.secret) return;
  state.locked = true;
  closeSheet();
  if (pad?.kind !== 'unlock') openPad({ kind: 'unlock', title: 'SEEKER is locked', sub: lockCfg.faceId ? 'Use Face ID or enter your PIN.' : 'Enter your PIN.' });
}

/** Locks once the app has gone unused for the time chosen in Settings. */
function checkLock() {
  if (lockCfg && state.secret && !state.locked && dueToLock({ lastActive, now: Date.now(), after: lockCfg.after })) lockNow();
}

function covered(on) {
  document.body.classList.toggle('locked', on);
  $('app').inert = on;
  $('sheet').inert = on;
}

function openPad(p) {
  pad = { entry: '', note: '', bad: false, ...p };
  drawPad();
  if (p.kind !== 'set' && lockCfg?.faceId && !document.hidden) tryFace(true);
}

function closePad() {
  pad = null;
  clearTimeout(drawPad.timer);
  $('lock').hidden = true;
  $('lock').replaceChildren();
  covered(false);
}

function drawPad() {
  if (!pad) return;
  const el = $('lock');
  const wait = pad.kind !== 'set' && lockCfg?.until > Date.now() ? Math.ceil((lockCfg.until - Date.now()) / 1000) : 0;
  const key = (d) => h('button', { class: 'pin-key', type: 'button', disabled: wait > 0, onclick: () => press(d) }, d);
  const face = pad.kind !== 'set' && lockCfg?.faceId ? h('button', { class: 'pin-key aux', type: 'button', 'aria-label': 'Unlock with Face ID', onclick: () => tryFace() }, h('span', { class: 'ico', icon: 'face' })) : h('span');
  const note = wait ? `Too many wrong PINs. Try again in ${wait} s.` : pad.note || pad.sub;
  el.replaceChildren(
    h(
      'div',
      { class: 'lock-screen', role: 'dialog', 'aria-modal': 'true', 'aria-label': pad.title },
      h('span', { class: state.device?.settings?.animation === false ? 'mark still' : 'mark', icon: 'logo' }),
      h('h2', {}, pad.title),
      h('p', { class: wait || pad.bad ? 'lock-note bad' : 'lock-note', 'aria-live': 'polite' }, note),
      h('div', { class: `pin-dots${pad.bad ? ' bad' : ''}${pad.shake ? ' shake' : ''}`, role: 'img', 'aria-label': `${pad.entry.length} of ${PIN_LENGTH} digits entered` }, ...Array.from({ length: PIN_LENGTH }, (_, i) => h('i', { class: i < pad.entry.length ? 'on' : null }))),
      h('div', { class: 'pin-pad' }, ...'123456789'.split('').map(key), face, key('0'), h('button', { class: 'pin-key aux', type: 'button', 'aria-label': 'Delete the last digit', onclick: () => press('del') }, h('span', { class: 'ico', icon: 'back' }))),
      pad.kind === 'unlock' ? h('button', { class: 'btn quiet small', type: 'button', onclick: forgotPin }, 'Forgot the PIN?') : h('button', { class: 'btn quiet small', type: 'button', onclick: closePad }, 'Cancel'),
    ),
  );
  pad.shake = false; // once per wrong PIN, not on every redraw
  el.hidden = false;
  covered(true);
  clearTimeout(drawPad.timer);
  if (wait) drawPad.timer = setTimeout(drawPad, 1000);
}

async function press(d) {
  if (!pad || pad.busy) return;
  if (d === 'del') pad.entry = pad.entry.slice(0, -1);
  else if (pad.entry.length < PIN_LENGTH) Object.assign(pad, { entry: pad.entry + d, note: '', bad: false });
  drawPad();
  if (pad.entry.length < PIN_LENGTH) return;
  const current = pad;
  current.busy = true;
  try {
    await entered(current.entry);
  } finally {
    current.busy = false;
  }
}

async function entered(pin) {
  if (pad.kind === 'set') {
    if (!pad.first) Object.assign(pad, { first: pin, entry: '', sub: 'Enter the same PIN again.' });
    else if (pin !== pad.first) Object.assign(pad, { first: null, entry: '', sub: pad.start, note: 'The two PINs did not match. Choose one again.', bad: true, shake: true });
    else {
      const then = pad.then;
      closePad();
      return then(pin);
    }
    return drawPad();
  }
  if (lockCfg.until > Date.now()) return Object.assign(pad, { entry: '' }), drawPad();
  if (await checkPin(lockCfg, pin)) return passed();
  saveLock(failed(lockCfg, Date.now()));
  navigator.vibrate?.(120);
  if (lockedOut(lockCfg)) return lockOut();
  const left = triesLeft(lockCfg);
  Object.assign(pad, { entry: '', note: `Wrong PIN. ${left} more wrong ${left === 1 ? 'try' : 'tries'} and this phone is unpaired.`, bad: true, shake: true });
  drawPad();
}

/**
 * The third wrong PIN within ten minutes: the Mac is told, then everything that lets this phone in is
 * removed from it (the pairing, the lock, the files kept here). Pairing again is the only way back.
 */
async function lockOut() {
  await command('lockout', {}, { quiet: true });
  saveLock(null);
  state.locked = false;
  closePad();
  signOut(`${LOCKOUT_TRIES} wrong PINs within 10 minutes: this phone was unpaired. To use it again, run seeker remote --setup on your Mac and open the link on this phone.`);
}

/** The centres of what the gate's pixels fly out of after an unlock: the PIN's dots, or the Face ID key. */
function unlockPoints(via) {
  const pick = via === 'face' ? '#lock .pin-key[aria-label="Unlock with Face ID"]' : '#lock .pin-dots i';
  return [...document.querySelectorAll(pick)].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

let gate = null; // the Jack In gate while it plays (jackin.js)
/** Opens through the gate: the robot, the tap, the code, then the app. `from`: points its pixels fly out of. */
function jackIn(from = null) {
  const plan = gatePlan({ paired: Boolean(state.secret), reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, notice: fromNotice });
  gate?.stop();
  let root = $('gate');
  if (plan === 'none') return root?.remove();
  if (!root) document.body.append((root = h('div', { id: 'gate' })));
  gate = openGate({
    root,
    from,
    auto: plan === 'auto',
    status: () => ({ linked: state.linked, online: state.online, ms: state.latency?.ms ?? null, sessions: state.workspaces.size }),
    target: () => document.querySelector('#app header.brand .mark'),
    onDone: () => ((gate = null), render()),
  });
}

function passed(via = 'pin') {
  const then = pad?.kind === 'verify' ? pad.then : null;
  // An unlock opens through the gate, its robot built out of the PIN's dots (or the Face ID key).
  const from = pad?.kind === 'unlock' ? unlockPoints(via) : null;
  if (lockCfg.failures || lockCfg.until) saveLock(cleared(lockCfg));
  state.locked = false;
  if (from) jackIn(from);
  closePad();
  touched(true);
  if (then) then();
  render(true);
}

const random = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Face ID: the phone checks the face against the passkey made at setup; only an answer that says "verified" opens. */
async function tryFace(auto = false) {
  if (!pad || !lockCfg?.faceId || pad.facing) return;
  const asking = pad;
  asking.facing = true;
  try {
    const cred = await navigator.credentials.get({ publicKey: { challenge: random(32), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: fromBase64(lockCfg.faceId), transports: ['internal'] }], userVerification: 'required', timeout: 60_000 } });
    if (pad !== asking) return;
    if (cred && sameId(cred.rawId, lockCfg.faceId) && userVerified(cred.response.authenticatorData)) return passed('face');
    Object.assign(pad, { note: 'Face ID did not confirm it was you. Enter your PIN.', bad: true });
  } catch {
    // Without a tap first, iOS may refuse to ask: the Face ID key on the pad asks again.
    if (pad === asking && !auto) Object.assign(pad, { note: 'Face ID did not unlock. Try again or enter your PIN.', bad: false });
  } finally {
    asking.facing = false;
    if (pad === asking) drawPad();
  }
}

async function enrollFace() {
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        rp: { name: 'SEEKER Remote', id: location.hostname },
        user: { id: random(16), name: 'SEEKER Remote', displayName: 'SEEKER Remote' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        attestation: 'none',
        timeout: 60_000,
      },
    });
    if (!cred) return;
    saveLock({ ...lockCfg, faceId: toBase64(new Uint8Array(cred.rawId)) });
    toast('Face ID unlocks SEEKER now.');
  } catch (e) {
    toast(e?.name === 'NotAllowedError' ? 'Face ID was not turned on.' : `Face ID could not be turned on: ${e?.message ?? e}`);
  }
  render(true);
}

/** Asks for Face ID or the PIN before a change to the lock itself. */
function verify(then) {
  openPad({ kind: 'verify', title: 'Confirm it is you', sub: lockCfg.faceId ? 'Use Face ID or enter your PIN.' : 'Enter your PIN.', then });
}

function choosePin(title, then) {
  const start = '6 digits. It unlocks SEEKER whenever Face ID cannot.';
  openPad({ kind: 'set', title, sub: start, start, then });
}

function setupLock() {
  choosePin('Choose a PIN', async (pin) => {
    saveLock({ ...(await makePin(pin)), after: DEFAULT_AFTER, faceId: null, failures: 0, until: 0 });
    touched(true);
    toast(state.faceIdAvailable ? 'App lock is on. Turn on Face ID below.' : 'App lock is on.');
    render(true);
  });
}

function forgotPin() {
  if (!confirm('Unpair this phone?\n\nWithout the PIN, the way back in is to pair again: run seeker remote --setup on your Mac. Nothing on the Mac is lost.')) return;
  saveLock(null);
  state.locked = false;
  closePad();
  signOut();
}

function lockSettings(toggle) {
  const line = (icon, label, sub, control) => h('div', { class: 'row' }, h('span', { class: 'ico', icon }), h('span', { class: 'grow' }, h('span', { class: 'label' }, label), h('span', { class: 'sub' }, sub)), control);
  const note = h('div', { class: 'muted small pad' }, 'Kept on this phone only. The PIN is stored as a salted hash, never as the digits.');
  if (!lockCfg) return [section('APP LOCK'), h('div', { class: 'group' }, line('lock', 'App lock', 'Ask for Face ID or a 6-digit PIN when SEEKER opens', toggle(false, setupLock, 'App lock'))), note];
  const faceSub = state.faceIdAvailable === false ? 'Not available on this phone or browser' : lockCfg.faceId ? 'Unlocks with your face; the PIN stays as the backup' : 'Off: only the PIN unlocks';
  return [
    section('APP LOCK'),
    h(
      'div',
      { class: 'group' },
      line('lock', 'App lock', 'On: Face ID or the PIN opens SEEKER', toggle(true, () => verify(() => (saveLock(null), toast('App lock is off.'))), 'App lock')),
      line('face', 'Face ID', faceSub, toggle(Boolean(lockCfg.faceId), lockCfg.faceId ? () => verify(() => saveLock({ ...lockCfg, faceId: null })) : enrollFace, 'Face ID', !lockCfg.faceId && !state.faceIdAvailable)),
      row('timer', 'Lock after', afterLabel(lockCfg.after), { sub: 'Locks when SEEKER has not been used for this long', onclick: () => choose('Lock after', AFTER_OPTIONS.map((m) => [m, afterLabel(m)]), lockCfg.after, (m) => saveLock({ ...lockCfg, after: m })) }),
      row('key', 'Change PIN', null, { onclick: () => verify(() => choosePin('Choose a new PIN', async (pin) => (saveLock({ ...lockCfg, ...(await makePin(pin)), failures: 0, until: 0 }), toast('PIN changed.')))) }),
      row('lock', 'Lock now', null, { onclick: lockNow }),
    ),
    note,
  ];
}

document.addEventListener('pointerdown', () => touched(), { capture: true, passive: true });
document.addEventListener(
  'keydown',
  (e) => {
    if (!pad) return touched();
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Escape' && pad.kind !== 'unlock') closePad();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  { capture: true },
);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    touched(true);
    // What the app switcher shows of SEEKER while the lock is on: nothing.
    document.body.classList.toggle('veiled', Boolean(lockCfg && state.secret));
    return;
  }
  checkLock();
  document.body.classList.remove('veiled');
  if (state.locked && pad) tryFace(true);
});
setInterval(() => !document.hidden && checkLock(), 15_000);

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
    syncBadge();
    markSeen();
  });
}

/** A conversation open on screen has been seen: its ending stops counting on the app's icon (the Mac keeps the mark). */
function markSeen() {
  const ws = state.view.name === 'session' && state.workspaces.get(state.view.ws);
  if (!ws?.meta?.unread || document.hidden || !state.online || $('gate')) return;
  const key = `${ws.meta.id}:${ws.meta.lastAt}`;
  if (seenSent.has(key)) return;
  seenSent.add(key);
  command('seen', { ws: ws.meta.id }, { quiet: true }).then((sent) => sent || seenSent.delete(key));
}

function draw() {
  const view = $('view');
  const { name } = state.view;
  const paired = Boolean(state.secret);
  const ws = state.workspaces.get(state.view.ws);
  // Stay at the bottom of a growing conversation, unless the reader has scrolled up.
  const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 80;
  const pinned = name === 'session' && state.sessionTab !== 'metrics' && atBottom;
  const screen = `${name}:${state.view.ws ?? state.view.id ?? ''}:${name === 'home' ? state.homeTab : name === 'session' ? state.sessionTab + (state.sessionTab === 'tools' ? `:${state.toolFilter}` : '') : ''}`;
  // The Sessions list is left alone while nothing it shows has changed: a token streaming in another
  // project does not rebuild it, so a finger or the keyboard focus stays on the row it was on.
  const listed = !paired ? null : name === 'sessions' ? sessionsNow() : name === 'home' ? homeNow() : null;
  const unchanged = listed && view.dataset.screen === screen && view.dataset.listed === listed.signature;
  view.dataset.listed = listed?.signature ?? '';
  const content = unchanged ? null : !paired ? login() : name === 'session' ? sessionParts(ws) : name === 'review' ? review(state.approvals.find((a) => a.id === state.view.id)) : name === 'approvals' ? approvals() : name === 'sessions' ? sessions(listed) : name === 'settings' ? settings() : home(listed);
  const scroll = view.scrollTop;
  const grownFrom = view.scrollHeight;
  const focusedRow = view.contains(document.activeElement) ? document.activeElement.dataset.ws : null;
  // A field being typed in (an answer, a note) keeps its text and the cursor across a redraw.
  const typing = view.contains(document.activeElement) && document.activeElement.matches('input.field') && view.dataset.screen === screen ? document.activeElement : null;
  // The screen is rebuilt on every event. Starting each looping animation "this long ago" keeps
  // spinners and pulses in step across rebuilds instead of restarting them.
  view.style.setProperty('--t', `-${Math.round(performance.now())}ms`);
  if (!unchanged) view.replaceChildren(...withBanner(content));
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
  // Each view of each session keeps its own place: leaving one remembers where the reader was.
  if (!sameScreen && view.dataset.screen?.startsWith('session:')) state.scrolls.set(view.dataset.screen, { top: scroll, bottom: atBottom });
  const kept = sameScreen ? null : state.scrolls.get(screen);
  if (keepFromBottom != null && sameScreen) view.scrollTop = view.scrollHeight - keepFromBottom; // earlier entries were added above
  else if (kept) view.scrollTop = kept.bottom && state.sessionTab !== 'metrics' ? view.scrollHeight : kept.top;
  else view.scrollTop = pinned || !sameScreen ? (name === 'session' && state.sessionTab !== 'metrics' ? view.scrollHeight : 0) : scroll;
  keepFromBottom = null;
  view.dataset.screen = screen;
  if (name === 'session') view.setAttribute('role', 'tabpanel'), view.setAttribute('aria-labelledby', `tab-${state.sessionTab}`);
  else view.removeAttribute('role'), view.removeAttribute('aria-labelledby');
  // Something new arrived below while the reader was further up: the jump button gets a dot.
  if (!sameScreen) unseen = false;
  else if (name === 'session' && !pinned && view.scrollHeight > grownFrom) unseen = true;

  const inSession = paired && name === 'session' && ws;
  // The session's head is its own region above the scrolling one, redrawn only when what it says changes.
  const top = $('top');
  top.hidden = !inSession;
  if (inSession) {
    const signature = `${screen}|${sessionHead.map((el) => el.textContent).join('|')}|${sessionHead[0].querySelector('.state-chip').className}`;
    if (top.dataset.signature !== signature) {
      const focused = top.contains(document.activeElement) ? document.activeElement.id : '';
      top.replaceChildren(...sessionHead);
      top.dataset.signature = signature;
      if (focused) $(focused)?.focus();
    }
  }
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
    $('tokens').textContent = `${big(ws.meta.used)} / ${sizeOf(ws.meta.limit)}`;
    $('input').placeholder = !up ? 'Not connected…' : st.busy ? (ws.meta.terminal ? 'Working… a picture can still be sent' : ws.meta.can?.queue ? 'Write the next instruction…' : 'Seeker is working…') : ws.meta.terminal ? 'Message, or just a picture…' : 'Message or command…';
    // Said aloud once per change, for a reader who cannot see the banner turn colour.
    const say = `${ws.meta.name}: ${st.label.toLowerCase()}`;
    if (say !== announced) $('announce').textContent = announced = say;
  }

  const nav = $('nav');
  nav.hidden = !paired || name === 'session' || name === 'review';
  // What waits for the user, on the dock too: the same counts as the app's icon, for a phone that cannot badge it.
  const unread = [...state.workspaces.values()].filter((w) => !w.meta.terminal && w.meta.unread).length;
  const waiting = { approvals: [state.approvals.length, 'waiting'], sessions: [unread, 'ended, not opened yet'] };
  nav.replaceChildren(
    ...NAV.map(([id, label, icon]) => {
      const [n, said] = waiting[id] ?? [0, ''];
      return h('button', { class: state.view.name === id ? 'active' : '', 'aria-current': state.view.name === id ? 'page' : null, onclick: () => go({ name: id }) }, h('span', { class: 'ico', 'aria-hidden': 'true' }, h('span', { icon }), n > 0 && h('span', { class: 'count' }, n)), h('span', { class: 'label' }, label), n > 0 && h('span', { class: 'sr-only' }, `, ${n} ${said}`));
    }),
  );
  drawSheet();
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
    // One line: what it is doing, the step it is on, and for how long. The header already carries the state word.
    el.replaceChildren(
      h('span', { class: 'ico', icon: st.key === 'thinking' ? 'brain' : waiting ? 'shield' : 'bolt' }),
      h('b', {}, stopping ? 'Stopping' : RUN_TITLE[st.key], !waiting && runningDots()),
      h('span', { class: 'sub line' }, stopping ? 'Waiting for your Mac to confirm' : meta.activity || ''),
      h('time', { class: 'elapsed mono', 'aria-label': 'Time since the task started' }),
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

/**
 * Stop and Send share one place. While something runs and the box is empty it holds Stop; once there is
 * something to send (text or an attachment) Send takes it, and clearing the box brings Stop back.
 */
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
  const showStop = stoppable && empty && !sending;
  $('stop').hidden = !showStop;
  $('send').hidden = showStop;
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

// ── the floating button over a long conversation: jump to the latest entry ──
let unseen = false;
function fabs() {
  const view = $('view');
  const inSession = state.view.name === 'session' && !$('composer').hidden;
  const below = view.scrollHeight - view.scrollTop - view.clientHeight;
  if (below < 80) unseen = false;
  $('fab-latest').hidden = !inSession || below < 200;
  $('fab-latest').classList.toggle('unseen', unseen);
}
$('fab-latest').innerHTML = ICONS.down;
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
function mentionFile() {
  const at = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, at);
  const insert = `${before && !/\s$/.test(before) ? ' ' : ''}@file:`;
  input.value = before + insert + input.value.slice(input.selectionEnd ?? at);
  input.focus();
  input.selectionStart = input.selectionEnd = at + insert.length;
  grow();
  composerState();
}
$('add').innerHTML = ICONS.plus;
let sending = false;

/**
 * One line at rest; two levels (writing area, then the tools) while writing or with something in the box.
 * Leaving the box closes it a moment later, so a tap on a tool lands where the tool was when it was aimed at.
 */
let closing = 0;
function shapeComposer() {
  clearTimeout(closing);
  const open = document.activeElement === input || Boolean(input.value) || attachments.length > 0;
  if (open) $('form').classList.add('open');
  else closing = setTimeout(() => $('form').classList.remove('open'), 300);
}
input.addEventListener('focus', shapeComposer);
input.addEventListener('blur', shapeComposer);

const grow = () => {
  shapeComposer();
  input.style.height = 'auto';
  // An empty box is one line; measuring it would count a placeholder that wraps.
  input.style.height = input.value ? `${Math.min(input.scrollHeight, 176)}px` : '';
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
    { name: '/model', about: 'switch this project’s model', off: busy || terminal, run: () => chooseModel(id) },
    { name: '/new', about: 'start a new conversation', off: busy || terminal, run: () => newConversation(ws.meta) },
    { name: '/stop', about: 'cancel what it is doing', off: !busy, run: () => $('stop').click() },
    { name: '/image', about: 'attach a photo, screenshot or video', off: false, run: () => $('file').click() },
    { name: '/file', about: 'send any file whole, saved on the Mac', off: false, run: () => $('anyfile').click() },
    { name: '/yolo', about: terminal ? 'changed in the terminal for this session' : 'run edits and commands without asking (on/off)', off: busy || terminal, run: run('/yolo') },
    { name: '/plan', about: 'plan first, change nothing (on/off)', off: busy, run: run('/plan') },
    { name: '/plan go', about: 'carry out the plan it proposed', off: busy, run: run('/plan go') },
    { name: '/status', about: 'model, context and approval mode', off: busy, run: run('/status') },
    { name: '/skills', about: 'list skills; run one with /<name>', off: busy, run: run('/skills') },
    { name: '/compact', about: 'summarise to free up context', off: busy, run: run('/compact') },
    { name: '/think', about: 'thinking mode on/off', off: busy || terminal, run: run('/think') },
    { name: '/config', about: 'settings: change one with a tap', off: busy || terminal, run: run('/config') },
    { name: '/memory', about: 'what SEEKER remembers', off: busy, run: run('/memory') },
    { name: '/goal', about: 'keep working until a goal is done', off: busy || !terminal, run: fill('/goal') },
    { name: '/resume', about: 'continue a saved conversation', off: busy || terminal, run: run('/resume') },
    { name: '/restart', about: 'restart SEEKER remote on the Mac safely', off: busy || terminal, run: run('/restart') },
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
    if (attachments.length) return toast('Pictures and files cannot wait in the queue yet. Send them when the task has ended.');
    return chooseMode(ws, text);
  }
  // A message with pictures takes a moment to upload; a second tap must not send it twice.
  sending = true;
  draw();
  try {
    const pictures = attachments.filter((a) => a.kind !== 'file');
    const files = attachments.filter((a) => a.kind === 'file').map((f) => ({ ...f, id: transferId() }));
    if (await sendText(state.view.ws, text, pictures, files)) {
      input.value = '';
      grow();
      attachments = [];
      showAttachments();
      // The message went first; the Mac waits for the files it announced, then hands both to the agent.
      if (files.length) await uploadFiles(files);
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
$('camera').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  await addImages(files);
});
$('file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = ''; // so the same picture can be chosen again
  await addImages(files);
});
// iOS opens a Photo Library / Take Photo / Choose Files menu for any picker that could take a picture or a
// video, and a picker with no accept could. "application/octet-stream" is UTType public.data: nothing a camera
// makes, yet every file (a PDF, a ZIP, and a PNG or MP4 too) conforms to it, so iOS goes straight to the file
// browser. Wildcards such as application/* do not work: iOS turns them into types no file has, and audio/*
// counts as video there (WebKit, WKFileUploadPanel.mm). Elsewhere the attribute would hide files, so it is iOS only.
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (IOS) $('anyfile').accept = 'application/octet-stream';
$('anyfile').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  await addImages(files, { whole: true });
});
// A picture pasted into the text box is attached too.
input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  addImages(files);
});
/**
 * "+": everything that can go into a message, in one sheet — something to attach, a file on the Mac to
 * mention, and the session's model and commands. Each row closes the sheet, then does the real thing.
 */
function addSheet() {
  const ws = state.workspaces.get(state.view.ws);
  if (!ws) return;
  const { meta } = ws;
  const busy = agentState(meta).busy;
  const item = (icon, label, sub, run, { value = null, off = false, more = false } = {}) =>
    h(
      'button',
      { class: 'row', type: 'button', disabled: off, onclick: () => (closeSheet(), run()) },
      h('span', { class: 'ico', icon }),
      h('span', { class: 'grow' }, h('span', { class: 'label' }, label), sub && h('span', { class: 'sub' }, sub)),
      value != null && h('span', { class: 'value' }, value),
      more && h('span', { class: 'chev', icon: 'chevron' }),
    );
  sheet(
    'Add to message',
    h(
      'div',
      { class: 'group add-group' },
      item('camera', 'Camera', null, () => $('camera').click()),
      item('image', 'Photos & videos', null, () => $('file').click()),
      item('file', 'Files', 'PDF, ZIP or anything else — saved on the Mac', () => $('anyfile').click()),
      item('at', 'Mention a file', 'A file in the project, read on the Mac', mentionFile),
    ),
    h(
      'div',
      { class: 'group add-group' },
      item('cube', 'Model', meta.ownModel ? 'This project’s own' : 'The default', () => chooseModel(meta.id), { value: meta.model, off: busy || Boolean(meta.terminal), more: true }),
      item('logo', 'Character', null, () => chooseProjectCharacter(meta), { value: projectCharacterLabel(meta).replace(/^Phone setting · /, ''), more: true }),
      item('terminal', 'Commands', 'Slash commands and earlier messages', showCommands, { more: true }),
    ),
  );
}
$('add').addEventListener('click', addSheet);

function showCommands() {
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
}

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
    // A long message scrolls inside the box instead of pushing it under the keyboard (style.css caps it).
    document.documentElement.style.setProperty('--app-h', keyboard ? `${visualViewport.height}px` : '');
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
// The Jack In gate (jackin.js) covers the app from the first paint: it plays once SEEKER is open, at once
// or after the unlock. Opened from a notification, it runs without waiting for a tap.
const fromNotice = /[#&]v=/.test(location.hash);
$('gate')?.classList.add('held');
(async () => {
  // A pairing link carries the secret after "#", which browsers never send to the server.
  const fromLink = /[#&]k=([^&]+)/.exec(location.hash)?.[1];
  // "#v=session:<id>", "#v=review:<id>" or "#v=approvals" opens straight on that screen.
  route(location.hash);
  if (fromLink) history.replaceState(null, '', location.pathname);
  const secret = fromLink ?? localStorage.getItem('seeker.secret');
  // Opened after the lock's time has passed (or for the first time since it was turned on): locked before anything is drawn.
  if (secret) {
    state.secret = secret;
    checkLock();
    if (!state.locked) jackIn();
    await pair(secret);
  } else $('gate')?.remove();
  render();
  globalThis.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()
    .then((ok) => ((state.faceIdAvailable = ok), render()))
    .catch(() => (state.faceIdAvailable = false));
  if (!globalThis.PublicKeyCredential) state.faceIdAvailable = false;
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
document.addEventListener('visibilitychange', () => {
  // Out of sight, the robots and the gate stop moving (style.css), so nothing animates for no one.
  document.documentElement.classList.toggle('backgrounded', document.hidden);
  if (!document.hidden && state.secret) (ping(), render());
});
