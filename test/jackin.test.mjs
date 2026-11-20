// The phone's Jack In gate: when it plays, what its terminal claims, and that it can never keep the app hidden.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STEPS, gatePlan, hackLines } from '../remote-server/public/jackin.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'remote-server', 'public');
const read = (name) => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

test('gate: plays only for a paired phone, waits for a tap unless a notification chose the screen', () => {
  assert.equal(gatePlan({ paired: false }), 'none', 'the pairing screen needs no gate');
  assert.equal(gatePlan({ paired: true }), 'tap');
  assert.equal(gatePlan({ paired: true, notice: true }), 'auto');
  assert.equal(gatePlan({ paired: true, reduced: true }), 'none', 'reduced motion asked for: no gate');
  assert.equal(gatePlan({ paired: true, reduced: true, notice: true }), 'none');
});

test('gate: the terminal only says what the phone knows of its link', () => {
  const up = hackLines({ linked: true, online: true, ms: 34, sessions: 3 });
  assert.match(up[0], /^> relay\.link \.+ ok$/);
  assert.match(up.find((l) => l.includes('mac.handshake')), /mac\.handshake 34ms \.+ ok$/);
  assert.match(up.find((l) => l.includes('sessions')), / 3$/);
  assert.equal(up.at(-1), '> ACCESS GRANTED');

  const offline = hackLines({ linked: true, online: false, ms: 34 });
  assert.match(offline.find((l) => l.includes('mac.handshake')), /mac\.handshake \.+ offline$/, 'no round trip shown for a Mac that is not there');
  assert.ok(!offline.some((l) => l.includes('sessions')), 'no session count when there are none');

  const relayDown = hackLines({});
  assert.match(relayDown[0], / retry$/);
  assert.match(relayDown.find((l) => l.includes('mac.handshake')), / wait$/);
});

test('gate: after the tap it is over in under 4 seconds', () => {
  const { assemble, ...afterTap } = STEPS;
  const total = Object.values(afterTap).reduce((a, b) => a + b, 0);
  assert.ok(assemble <= 800, `assemble ${assemble} ms`);
  assert.ok(total < 4000, `after the tap ${total} ms`);
});

test('gate: the page covers the app with it, and CSS takes it away if app.js never runs', () => {
  assert.match(read('index.html'), /<div id="gate"/);
  assert.doesNotMatch(read('index.html'), /id="launch"/, 'the old launch is gone');
  const css = read('style.css');
  assert.match(css, /#gate \{[^}]*animation: gate-out [^}]*\}/, 'the gate ends by itself');
  assert.match(css, /#gate\.held \{\s*animation: none;/, 'only app.js holds it');
  assert.match(css, /@keyframes gate-out \{[^}]*visibility: hidden;[^}]*pointer-events: none;/);
  assert.match(css, /#gate \{\s*z-index: 35;|#gate \{[^}]*z-index: 35;/, 'under the lock (40), over the app');
  const app = read('app.js');
  assert.match(app, /\$\('gate'\)\?\.classList\.add\('held'\)/);
  assert.match(app, /else \$\('gate'\)\?\.remove\(\)/, 'an unpaired phone goes straight to pairing');
});
