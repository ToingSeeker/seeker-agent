// The phone app's lock: Face ID with a 6-digit PIN behind it, and the time before it locks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { ACTIVE_KEY, AFTER_OPTIONS, DEFAULT_AFTER, LOCK_KEY, afterLabel, checkPin, cleared, dueToLock, failed, lockedOut, makePin, minutes, readLock, triesLeft, sameId, userVerified, validPin, writeLock } from '../remote-server/public/lock.js';

const read = (file) => fs.readFileSync(new URL(`../remote-server/public/${file}`, import.meta.url), 'utf8');
const MIN = 60_000;
const memory = () => {
  const data = new Map();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
};

test('lock: a PIN is exactly six digits', () => {
  for (const ok of ['000000', '123456', '987650']) assert.equal(validPin(ok), true, ok);
  for (const bad of ['12345', '1234567', '12a456', ' 123456', '', null, 123456]) assert.equal(validPin(bad), false, String(bad));
});

test('lock: the PIN is kept as a salted hash, and only the same six digits match it', async () => {
  const cfg = await makePin('482916');
  assert.ok(!JSON.stringify(cfg).includes('482916'), 'the digits themselves are never stored');
  assert.ok(cfg.iterations >= 100_000);
  assert.equal(await checkPin(cfg, '482916'), true);
  for (const wrong of ['482917', '000000', '48291', '4829166', '']) assert.equal(await checkPin(cfg, wrong), false, wrong);
  const again = await makePin('482916');
  assert.notEqual(again.salt, cfg.salt);
  assert.notEqual(again.hash, cfg.hash, 'the same PIN hashes differently on each setup');
  assert.equal(await checkPin(null, '482916'), false, 'no lock set up: nothing matches');
  await assert.rejects(makePin('1234'), /6 digits/);
});

test('lock: it locks once unused for 1, 5, 15 or 60 minutes, as chosen', () => {
  assert.deepEqual(AFTER_OPTIONS, [1, 5, 15, 60]);
  const now = 10 * 60 * MIN;
  for (const after of AFTER_OPTIONS) {
    assert.equal(dueToLock({ lastActive: now - after * MIN + 1000, now, after }), false, `${after} min: not yet`);
    assert.equal(dueToLock({ lastActive: now - after * MIN, now, after }), true, `${after} min: due`);
  }
  assert.equal(dueToLock({ lastActive: NaN, now, after: 60 }), true, 'never used since the lock was turned on: locked');
  assert.equal(minutes(7), DEFAULT_AFTER, 'a time that is not an option falls back to the default');
  assert.deepEqual(AFTER_OPTIONS.map(afterLabel), ['1 minute', '5 minutes', '15 minutes', '1 hour']);
});

test('lock: the third wrong PIN within ten minutes locks the phone out; older ones do not count', () => {
  let cfg = { hash: 'x', salt: 'y' };
  cfg = failed(cfg, 0);
  assert.deepEqual([lockedOut(cfg), triesLeft(cfg)], [false, 2]);
  cfg = failed(cfg, 5 * MIN);
  assert.deepEqual([lockedOut(cfg), triesLeft(cfg)], [false, 1]);
  // The first was more than ten minutes before this one: it has run out, so two count, not three.
  cfg = failed(cfg, 10 * MIN + 1);
  assert.deepEqual([lockedOut(cfg), triesLeft(cfg), cfg.misses.length], [false, 1, 2]);
  cfg = failed(cfg, 11 * MIN);
  assert.equal(lockedOut(cfg), true);
  // No wait between tries any more: three are all there is.
  assert.equal(cfg.until, 0);
  // The right PIN forgets the wrong ones.
  assert.deepEqual([lockedOut(cleared(cfg)), triesLeft(cleared(cfg))], [false, 3]);
  // Three in a row, quickly.
  let quick = { hash: 'x', salt: 'y' };
  for (const at of [1000, 2000, 3000]) quick = failed(quick, at);
  assert.equal(lockedOut(quick), true);
});

test('lock: Face ID opens only when the answer says the user was verified, with the passkey made at setup', () => {
  const data = (flags) => Object.assign(new Uint8Array(37), { 32: flags });
  assert.equal(userVerified(data(0x05).buffer), true, 'UP + UV');
  assert.equal(userVerified(data(0x01).buffer), false, 'user present but not verified');
  assert.equal(userVerified(new Uint8Array(10).buffer), false, 'too short to hold the flags');
  assert.equal(userVerified(undefined), false);
  const id = new Uint8Array([1, 2, 3, 250]);
  const stored = btoa(String.fromCharCode(...id));
  assert.equal(sameId(id.buffer, stored), true);
  assert.equal(sameId(new Uint8Array([1, 2, 3]).buffer, stored), false);
  assert.equal(sameId(id.buffer, null), false);
});

test('lock: settings are read back safely and removed whole', async () => {
  const s = memory();
  assert.equal(readLock(s), null);
  s.setItem(LOCK_KEY, '{broken');
  assert.equal(readLock(s), null, 'unreadable storage is no lock, not a crash');
  writeLock(s, { ...(await makePin('111111')), after: 15 });
  s.setItem(ACTIVE_KEY, '5');
  const cfg = readLock(s);
  assert.deepEqual([cfg.after, cfg.faceId, cfg.failures, cfg.until], [15, null, 0, 0]);
  writeLock(s, null);
  assert.equal(s.data.size, 0, 'turning the lock off leaves nothing behind');
});

test('lock: the app hides everything behind the lock and asks Face ID to verify the user', () => {
  const app = read('app.js');
  const css = read('style.css');
  assert.match(read('index.html'), /<div id="lock" hidden><\/div>/);
  assert.match(css, /body\.locked #app,\s*body\.locked #sheet,\s*body\.veiled #app,\s*body\.veiled #sheet \{\s*visibility: hidden;/);
  assert.match(app, /\$\('app'\)\.inert = on;/, 'nothing behind the lock can be focused or tapped');
  assert.equal((app.match(/userVerification: 'required'/g) ?? []).length, 2, 'setup and unlock both require Face ID, not just presence');
  assert.match(app, /authenticatorAttachment: 'platform'/, 'the passkey lives on this phone');
  assert.match(app, /userVerified\(cred\.response\.authenticatorData\)/);
  assert.match(app, /if \(secret\) \{\s*state\.secret = secret;\s*checkLock\(\);\s*await pair\(secret\);/, 'locked before the first event from the Mac is drawn');
});

test('lock: quick taps on the keypad do not zoom the app on iOS', () => {
  const css = read('style.css');
  const all = css.match(/^\* \{[^}]*\}/m)?.[0] ?? '';
  assert.match(all, /touch-action:\s*manipulation/, 'double-tap zoom is off for every element');
  const key = css.match(/^\.pin-key \{[^}]*\}/m)?.[0] ?? '';
  assert.match(key, /touch-action:\s*manipulation/);
  assert.match(key, /user-select:\s*none/);
  assert.doesNotMatch(read('index.html'), /user-scalable=no|maximum-scale/, 'pinch zoom stays available');
});
