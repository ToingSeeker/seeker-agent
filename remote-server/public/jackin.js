// The Jack In gate: what the phone shows when SEEKER opens, before the app itself.
//
//   assemble  the robot is built from pixels: out of the PIN's dots (or the Face ID key) after an
//             unlock, from the edges of the screen when the app opens without a lock
//   wait      it idles, breathing and blinking, its chest light saying whether the Mac answers,
//             until it is tapped (opened from a notification, it does not wait)
//   hack      a terminal types what the phone knows of its link; no line is made up
//   rain      code falls, faster and denser, and glitches the robot where it hits
//   dive      the robot walks into the code and the code rushes past, the view following it
//   reveal    the code opens from the middle on the app beneath
//   walk      the robot walks to the robot in the header, hops, and merges with it
//
// One canvas draws it all; the prompt and the terminal are text in the page. Once it runs, a tap
// skips to the end, and any error ends it, so it can never keep the app hidden.
// gatePlan() and hackLines() are plain functions, without the page: the tests run them.

/** How long each step lasts, in ms. `wait` has no length: it lasts until the tap. */
export const STEPS = { assemble: 700, hack: 750, rain: 400, dive: 700, reveal: 420, walk: 850, merge: 380 };

/**
 * Whether the gate plays, and how. Not paired: the pairing screen needs no gate. Reduced motion
 * asked for on the phone: none. Opened from a notification: it plays without waiting for a tap,
 * since the user already chose where to go.
 */
export function gatePlan({ paired = false, reduced = false, notice = false } = {}) {
  if (!paired || reduced) return 'none';
  return notice ? 'auto' : 'tap';
}

/** The terminal's lines while the robot "hacks" in: only what the phone actually knows right now. */
export function hackLines({ linked = false, online = false, ms = null, sessions = 0 } = {}) {
  const line = (key, value) => `> ${key} ${'.'.repeat(Math.max(2, 24 - key.length - value.length))} ${value}`;
  return [
    line('relay.link', linked ? 'ok' : 'retry'),
    line('e2e.keys', 'ok'),
    line(ms != null && online ? `mac.handshake ${ms}ms` : 'mac.handshake', online ? 'ok' : linked ? 'offline' : 'wait'),
    sessions > 0 ? line('sessions', String(sessions)) : null,
    '> ACCESS GRANTED',
  ].filter(Boolean);
}

// The header robot (app.js ICONS.logo) in parts, so its feet can step on their own.
const PARTS = {
  antenna: 'M3 0h1v1H3zM7 0h1v1H7z',
  footL: 'M3 7h2v1H3z',
  footR: 'M6 7h2v1H6z',
  c: 'M2 1h7v1H2zM1 2h1v2H1zM9 2h1v2H9zM2 4h7v1H2zM3 5h5v1H3zM3 6h2v1H3zM6 6h2v1H6z',
  b: 'M.5 2H1v2H.5zM10 2h.5v2H10zM2 6h1v1H2zM8 6h1v1H8z',
  k: 'M2 2h7v2H2z',
  y: 'M5 6h1v1H5z',
  open: 'M4.2 2.5l.6.5-.6.5M6.8 2.5l-.6.5.6.5',
  shut: 'M4.15 3h.7M6.15 3h.7',
};
// The order the icon paints them in: a later part covers an earlier one.
const LAYERS = [['o', ['antenna', 'footL', 'footR']], ['c', ['c']], ['b', ['b']], ['k', ['k']], ['y', ['y']]];
const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789{}<>/=+*#$ABCDEF';

const clamp = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, p) => a + (b - a) * p;
const easeOut = (p) => 1 - (1 - p) ** 3;
const easeIn = (p) => p * p * p;
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/**
 * The gate's faint code rain on its own, behind another page (the talk page in app.js): the same glyphs
 * falling as the gate shows while it waits for the tap. `still`: one frame, nothing moves. Returns { stop }.
 */
export function codeRain(canvas, { alpha = 0.14, px = 15, still = false } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { stop() {} };
  const style = getComputedStyle(document.documentElement);
  const green = style.getPropertyValue('--sk-success').trim() || '#50D15F';
  const mono = style.getPropertyValue('--mono').trim() || 'ui-monospace, Menlo, monospace';
  let W = 0;
  let H = 0;
  let cols = [];
  let frame = 0;
  let last = 0;
  let clock = 0;
  const size = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = canvas.clientWidth || innerWidth;
    H = canvas.clientHeight || innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Array.from({ length: Math.ceil(W / px) + 1 }, (_, i) => ({ x: i * px + px / 2, head: Math.random() * H * 1.2, speed: 0.03 + Math.random() * 0.08, len: 6 + Math.floor(Math.random() * 18), seed: Math.floor(Math.random() * 997) }));
  };
  const draw = (now) => {
    const dt = last ? Math.min(50, now - last) : 16;
    last = now;
    clock += dt;
    if (canvas.clientWidth && Math.abs(canvas.clientWidth - W) > 1) size();
    ctx.clearRect(0, 0, W, H);
    ctx.font = `${px}px ${mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tick = Math.floor(clock / 90);
    for (const c of cols) {
      if (!still) c.head += c.speed * dt;
      if (c.head - c.len * px > H) {
        c.head = -Math.random() * H * 0.4;
        c.len = 6 + Math.floor(Math.random() * 18);
      }
      const headRow = Math.floor(c.head / px);
      for (let k = 0; k < c.len; k++) {
        const row = headRow - k;
        const y = row * px;
        if (y < -px || y > H) continue;
        const flicker = k === 0 || (row * 13 + c.seed) % 7 === 0 ? tick : 0;
        ctx.globalAlpha = alpha * (k === 0 ? 1 : 0.85 * (1 - k / c.len));
        ctx.fillStyle = k === 0 ? '#E9FFEE' : green;
        ctx.fillText(GLYPHS[(c.seed + row * 7 + flicker) % GLYPHS.length], c.x, y);
      }
    }
    ctx.globalAlpha = 1;
    if (!still) frame = requestAnimationFrame(draw);
  };
  size();
  frame = requestAnimationFrame(draw);
  return { stop: () => cancelAnimationFrame(frame) };
}

/**
 * Plays the gate in `root` (fixed over the whole screen). `from`: points on screen the pixels fly
 * out of (the PIN's dots), or null. `status()`: { linked, online, ms, sessions } as the app knows
 * them now. `target()`: the element the robot merges with at the end, or null. Returns { stop }.
 */
export function openGate({ root, from = null, auto = false, status = () => ({}), target = () => null, onDone = () => {} }) {
  const canvas = document.createElement('canvas');
  const prompt = document.createElement('div');
  const typed = document.createElement('span');
  const cursor = document.createElement('span');
  const term = document.createElement('pre');
  prompt.className = 'g-prompt';
  cursor.className = 'g-cur';
  cursor.textContent = '_';
  prompt.append(typed, cursor);
  term.className = 'g-term';
  root.replaceChildren(canvas, prompt, term);
  root.className = 'held';
  root.hidden = false;
  root.removeAttribute('aria-hidden');
  if (!auto) {
    root.setAttribute('role', 'button');
    root.setAttribute('aria-label', 'Open SEEKER');
    root.tabIndex = 0;
  }

  let frame = 0;
  let done = false;
  let phase = 'assemble';
  let at = 0; // when the step began, on `clock`
  let clock = 0;
  const ctx = canvas.getContext('2d');
  // `flash`: the header's robot lights up as if the gate's one landed (a skip); not when the app replaces the gate.
  const finish = (flash = true) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    removeEventListener('resize', size);
    const landing = flash && phase !== 'merge' ? target() : null;
    if (landing) merge(landing);
    root.remove();
    onDone();
  };
  if (!ctx || typeof Path2D !== 'function') {
    finish(false);
    return { stop: () => finish(false) };
  }

  const style = getComputedStyle(document.documentElement);
  const v = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const C = {
    bg: v('--sk-bg', '#0E0F11'),
    o: v('--sk-text-secondary', '#A5A7AE'),
    c: v('--sk-primary', '#FF8A00'),
    b: v('--sk-primary-deep', '#B35F00'),
    k: v('--sk-surface-elevated', '#22252B'),
    y: v('--sk-execution', '#4188FF'),
    cyan: v('--sk-cyan', '#31D8F4'),
    green: v('--sk-success', '#50D15F'),
    danger: v('--sk-danger', '#F16D76'),
    warning: v('--sk-warning', '#FFB547'),
    mono: v('--mono', 'ui-monospace, Menlo, monospace'),
  };
  const P = Object.fromEntries(Object.entries(PARTS).map(([k, d]) => [k, new Path2D(d)]));

  // The robot's pixels, found by asking the icon's own shapes which cell each one covers.
  const probe = document.createElement('canvas').getContext('2d');
  const cells = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 11; x++) {
      let tone = null;
      for (const [t, parts] of LAYERS) if (parts.some((p) => probe.isPointInPath(P[p], x + 0.5, y + 0.5))) tone = t;
      if (tone) cells.push({ x, y, tone });
    }
  }

  let W = 0;
  let H = 0;
  let dpr = 1;
  let unit = 12; // one of the robot's pixels, in CSS px, while it waits
  let home = { x: 0, y: 0 }; // where it waits
  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    unit = Math.round(Math.max(9, Math.min(14, W / 28)));
    home = { x: Math.round(W / 2), y: Math.round(H * 0.42) };
    const below = `${home.y + 5 * unit + 26}px`;
    prompt.style.top = below;
    term.style.top = below;
    rains = [makeRain(15), makeRain(10)];
  }

  // ── the code rain: columns of glyphs, each with its head and a fading tail ──
  let rains = [];
  function makeRain(px) {
    const cols = Math.ceil(W / px) + 1;
    return {
      px,
      cols: Array.from({ length: cols }, (_, i) => ({ x: i * px + px / 2, head: Math.random() * H * 1.2, speed: 0.05 + Math.random() * 0.12, len: 6 + Math.floor(Math.random() * 18), seed: Math.floor(Math.random() * 997) })),
    };
  }
  function stepRain(rain, dt, mult) {
    for (const c of rain.cols) {
      c.head += c.speed * mult * dt;
      if (c.head - c.len * rain.px > H) {
        c.head = -Math.random() * H * 0.4;
        c.len = 6 + Math.floor(Math.random() * 18);
      }
    }
  }
  function drawRain(rain, alpha, zoom = 1) {
    if (alpha <= 0) return;
    ctx.save();
    if (zoom !== 1) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.font = `${rain.px}px ${C.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tick = Math.floor(clock / 90);
    for (const c of rain.cols) {
      const headRow = Math.floor(c.head / rain.px);
      for (let k = 0; k < c.len; k++) {
        const row = headRow - k;
        const y = row * rain.px;
        if (y < -rain.px || y > H) continue;
        const flicker = k === 0 || (row * 13 + c.seed) % 7 === 0 ? tick : 0;
        ctx.globalAlpha = alpha * (k === 0 ? 1 : 0.85 * (1 - k / c.len));
        ctx.fillStyle = k === 0 ? '#E9FFEE' : C.green;
        ctx.fillText(GLYPHS[(c.seed + row * 7 + flicker) % GLYPHS.length], c.x, y);
      }
    }
    ctx.restore();
  }

  // Streaks rushing out from the middle: the view diving into the code.
  const streaks = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, d: Math.random(), glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)] }));
  function drawStreaks(dt, alpha) {
    const max = Math.hypot(W, H) / 2;
    ctx.save();
    ctx.strokeStyle = C.green;
    ctx.fillStyle = C.green;
    ctx.font = `12px ${C.mono}`;
    ctx.textAlign = 'center';
    for (const s of streaks) {
      s.d = (s.d + dt * 0.0016) % 1;
      const r = s.d * s.d * max;
      const len = 6 + s.d * 60;
      const cos = Math.cos(s.a);
      const sin = Math.sin(s.a);
      ctx.globalAlpha = alpha * s.d;
      ctx.lineWidth = 1 + s.d * 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 + cos * r, H / 2 + sin * r);
      ctx.lineTo(W / 2 + cos * (r + len), H / 2 + sin * (r + len));
      ctx.stroke();
      if (s.d > 0.45) ctx.fillText(s.glyph, W / 2 + cos * (r + len + 8), H / 2 + sin * (r + len + 8));
    }
    ctx.restore();
  }

  // ── the robot ──
  const bot = { x: 0, y: 0, s: 12, alpha: 1, eye: C.cyan, eyeAlpha: 1, blink: false, step: 0, walking: false };
  function chest() {
    const st = status();
    return st.online ? C.green : st.linked ? C.danger : C.warning;
  }
  function drawBot() {
    const lift = bot.walking ? Math.sin(bot.step) : 0;
    ctx.save();
    ctx.globalAlpha = bot.alpha;
    ctx.translate(bot.x, bot.y - (bot.walking ? Math.abs(lift) * bot.s * 0.35 : 0));
    ctx.scale(bot.s, bot.s);
    ctx.translate(-5.5, -4);
    ctx.fillStyle = C.o;
    ctx.fill(P.antenna);
    ctx.save();
    ctx.translate(0, Math.min(0, -lift) * 0.7);
    ctx.fill(P.footL);
    ctx.restore();
    ctx.save();
    ctx.translate(0, Math.min(0, lift) * 0.7);
    ctx.fill(P.footR);
    ctx.restore();
    for (const t of ['c', 'b', 'k']) {
      ctx.fillStyle = C[t];
      ctx.fill(P[t]);
    }
    const light = chest();
    ctx.fillStyle = light;
    ctx.shadowColor = light;
    ctx.shadowBlur = 10;
    ctx.fill(P.y);
    ctx.globalAlpha = bot.alpha * bot.eyeAlpha;
    ctx.strokeStyle = bot.eye;
    ctx.shadowColor = bot.eye;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 0.3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(bot.blink ? P.shut : P.open);
    ctx.restore();
  }
  // A few strips of the robot's box slide sideways for a frame: code hitting it.
  function glitch(strength) {
    const w = 11 * bot.s + 24;
    const x = bot.x - w / 2;
    const top = bot.y - 5.5 * bot.s;
    const h = 10 * bot.s;
    for (let i = 0; i < 3; i++) {
      if (Math.random() > strength) continue;
      const y = top + Math.random() * h;
      const sh = 2 + Math.random() * 7;
      const dx = (Math.random() - 0.5) * 18 * strength;
      ctx.drawImage(canvas, x * dpr, y * dpr, w * dpr, sh * dpr, x + dx, y, w, sh);
    }
    if (Math.random() < strength * 0.5) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = C.cyan;
      ctx.fillRect(x, top + Math.random() * h, w, 1.5);
      ctx.restore();
    }
  }

  // Pixels thrown out where the robot merges.
  let sparks = [];
  function burst(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 0.08 + Math.random() * 0.16;
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, size: 2 + Math.random() * 3, color: colors[i % colors.length] });
    }
  }
  function drawSparks(dt) {
    sparks = sparks.filter((p) => (p.life -= dt / 420) > 0);
    ctx.save();
    for (const p of sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }
  function merge(mark) {
    mark.classList.remove('gate-merge');
    void mark.offsetWidth; // the class is set again: its animation plays again
    mark.classList.add('gate-merge');
    mark.addEventListener('animationend', () => mark.classList.remove('gate-merge'), { once: true });
  }

  // ── the steps ──
  size();
  addEventListener('resize', size);
  const sources = cells.map((cell, i) => {
    if (from?.length) {
      const p = from[i % from.length];
      return { x: p.x + (Math.random() - 0.5) * 10, y: p.y + (Math.random() - 0.5) * 10, shown: true };
    }
    const a = Math.random() * Math.PI * 2;
    const r = Math.max(W, H) * (0.45 + Math.random() * 0.25);
    return { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r, shown: false };
  });
  const delays = cells.map((cell) => (7 - cell.y) * 32 + Math.random() * 70);

  let last = performance.now();
  let wanted = auto; // a tap during the build starts the rest as soon as the robot stands
  let lines = [];
  let walkFrom = null;
  let walkTo = null;
  let mark = null;
  const go = (next) => ((phase = next), (at = clock));

  function start() {
    if (phase !== 'wait') return;
    lines = hackLines(status()).join('\n');
    prompt.classList.remove('on');
    term.classList.add('on');
    navigator.vibrate?.(15);
    go('hack');
  }
  const tap = (event) => {
    event.preventDefault?.();
    if (phase === 'assemble') wanted = true;
    else if (phase === 'wait') start();
    else if (phase !== 'hack' || clock - at > 250) finish(); // not the same tap twice
  };
  root.addEventListener('pointerup', tap);
  root.addEventListener('keydown', (event) => (event.key === 'Enter' || event.key === ' ') && tap(event));

  function draw(now) {
    if (done) return;
    try {
      const dt = Math.min(50, now - last);
      last = now;
      clock += dt;
      const t = clock - at;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      if (!['walk', 'merge'].includes(phase)) {
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, W, H);
      }
      root.classList.add('drawn');

      bot.x = home.x;
      bot.y = home.y;
      bot.s = unit;
      bot.eye = C.cyan;
      bot.walking = false;
      bot.blink = false;
      bot.alpha = 1;
      bot.eyeAlpha = 1;

      if (phase === 'assemble') {
        stepRain(rains[0], dt, 0.6);
        drawRain(rains[0], 0.12 * clamp(t / STEPS.assemble));
        const ox = home.x - 5.5 * unit;
        const oy = home.y - 4 * unit;
        ctx.save();
        ctx.shadowBlur = 10;
        cells.forEach((cell, i) => {
          const p = clamp((t - delays[i]) / 420);
          if (p <= 0 && !sources[i].shown) return;
          const e = easeOut(p);
          const x = lerp(sources[i].x, ox + (cell.x + 0.5) * unit, e);
          const y = lerp(sources[i].y, oy + (cell.y + 0.5) * unit, e);
          const s = unit * (0.55 + 0.45 * e);
          ctx.globalAlpha = sources[i].shown ? 1 : clamp(p * 3);
          ctx.fillStyle = C[cell.tone];
          ctx.shadowColor = C[cell.tone];
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        });
        ctx.restore();
        if (t >= STEPS.assemble) {
          go('wait');
          if (!auto) prompt.classList.add('on');
        }
      } else if (phase === 'wait') {
        stepRain(rains[0], dt, 0.6);
        drawRain(rains[0], 0.12);
        bot.y = home.y + Math.sin(clock / 650) * 3;
        bot.eyeAlpha = clamp(t / 250);
        bot.blink = clock % 3400 < 130;
        drawBot();
        const text = '> tap the robot to jack in';
        typed.textContent = text.slice(0, Math.floor(t / 30));
        if (wanted) start();
      } else if (phase === 'hack') {
        const p = clamp(t / STEPS.hack);
        stepRain(rains[0], dt, 1 + p);
        drawRain(rains[0], lerp(0.12, 0.3, p));
        bot.eye = C.green;
        bot.eyeAlpha = 1;
        bot.x = home.x + (Math.random() - 0.5) * 2 * p;
        drawBot();
        term.textContent = lines.slice(0, Math.ceil(lines.length * clamp(t / (STEPS.hack * 0.8))));
        if (t >= STEPS.hack) go('rain');
      } else if (phase === 'rain') {
        const p = clamp(t / STEPS.rain);
        stepRain(rains[0], dt, 1.5 + 2 * p);
        stepRain(rains[1], dt, 2 + 2 * p);
        drawRain(rains[1], 0.5 * p);
        drawRain(rains[0], lerp(0.3, 0.95, p));
        term.classList.remove('on');
        bot.eye = C.green;
        drawBot();
        glitch(0.25 + 0.6 * p);
        if (t >= STEPS.rain) go('dive');
      } else if (phase === 'dive' || phase === 'reveal') {
        const p = phase === 'dive' ? clamp(t / STEPS.dive) : 1;
        const r = phase === 'reveal' ? clamp(t / STEPS.reveal) : 0;
        const zoom = 1 + 2.2 * easeIn(p) + 1.5 * r;
        stepRain(rains[0], dt, 3.5);
        stepRain(rains[1], dt, 4);
        drawRain(rains[1], 0.5, zoom * 0.8);
        drawRain(rains[0], 0.95, zoom);
        drawStreaks(dt, 0.4 + 0.6 * p);
        if (r > 0) {
          // The code opens from the middle on the app beneath.
          const max = Math.hypot(W, H) / 2 + 60;
          const rad = easeOut(r) * max;
          const g = ctx.createRadialGradient(W / 2, H / 2, rad * 0.6, W / 2, H / 2, Math.max(1, rad));
          g.addColorStop(0, 'rgba(0,0,0,1)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'source-over';
          root.classList.add('open');
        }
        bot.eye = C.green;
        bot.walking = true;
        bot.step = clock / 70;
        bot.s = unit * lerp(1, 0.5, easeInOut(p));
        bot.x = lerp(home.x, W / 2, p);
        bot.y = lerp(home.y, H / 2, p);
        drawBot();
        if (phase === 'dive' && p < 0.6) glitch(0.4 * (1 - p));
        if (phase === 'dive' && t >= STEPS.dive) go('reveal');
        else if (phase === 'reveal' && t >= STEPS.reveal) {
          root.classList.add('through');
          mark = target();
          const box = mark?.getBoundingClientRect();
          walkFrom = { x: bot.x, y: bot.y, s: bot.s };
          walkTo = box && box.width > 0 && box.bottom > 0 && box.top < H ? { x: box.left + box.width / 2, y: box.top + box.height / 2, s: box.width / 11 } : null;
          go('walk');
        }
      } else if (phase === 'walk') {
        const p = clamp(t / STEPS.walk);
        bot.eye = C.cyan;
        if (walkTo) {
          const e = easeInOut(p);
          bot.x = lerp(walkFrom.x, walkTo.x, e);
          bot.y = lerp(walkFrom.y, walkTo.y, e);
          bot.s = lerp(walkFrom.s, walkTo.s, e);
          // It walks, then hops onto the header's robot for the last stretch.
          bot.walking = p < 0.7;
          bot.step = clock / 65;
          if (p >= 0.7) bot.y -= Math.sin(Math.PI * clamp((p - 0.7) / 0.3)) * 26;
        } else {
          bot.s = walkFrom.s * (1 - easeIn(p));
          bot.alpha = 1 - p;
        }
        if (bot.s > 0.2) drawBot();
        if (t >= STEPS.walk) {
          const x = walkTo?.x ?? bot.x;
          const y = walkTo?.y ?? bot.y;
          burst(x, y, 18, [C.c, C.cyan, C.green, C.b]);
          if (mark) merge(mark);
          go('merge');
        }
      } else if (phase === 'merge') {
        if (t >= STEPS.merge) return finish();
      }
      drawSparks(dt);
      frame = requestAnimationFrame(draw);
    } catch (error) {
      console.error('gate', error);
      finish();
    }
  }
  frame = requestAnimationFrame((now) => {
    last = now;
    draw(now);
  });
  return { stop: () => finish(false) };
}
