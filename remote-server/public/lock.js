// The app lock: Face ID, with a 6-digit PIN behind it, asked for when SEEKER opens or has sat
// unused for the time chosen in Settings.
//
// Everything here stays on this phone. The PIN is never stored, only a PBKDF2 hash of it with a
// random salt. Face ID is a passkey made for this site on this phone (WebAuthn, platform
// authenticator, user verification required); unlocking asks the phone to use it, and the answer
// must say the user was verified. The lock is a gate in front of the screens: it keeps out
// someone holding the unlocked phone, it does not encrypt what the app keeps in storage.
//
// No DOM here, so the rules can be tested in Node.

export const LOCK_KEY = 'seeker.lock';
export const ACTIVE_KEY = 'seeker.lock.active';
export const AFTER_OPTIONS = [1, 5, 15, 60]; // minutes
export const DEFAULT_AFTER = 5;
export const PIN_LENGTH = 6;
export const ITERATIONS = 210_000;
// Three wrong PINs within ten minutes and this phone is unpaired: someone is guessing.
export const LOCKOUT_TRIES = 3;
export const LOCKOUT_WINDOW = 10 * 60_000;

const enc = new TextEncoder();
const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Exactly six digits. */
export const validPin = (pin) => typeof pin === 'string' && /^\d{6}$/.test(pin);

/** "1 minute", "15 minutes", "1 hour". */
export const afterLabel = (minutes) => (minutes === 60 ? '1 hour' : `${minutes} minute${minutes === 1 ? '' : 's'}`);

export async function hashPin(pin, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations }, base, 256);
  return toBase64(bits);
}

/** What is kept for a new PIN: never the PIN itself. */
export async function makePin(pin) {
  if (!validPin(pin)) throw new Error('The PIN must be 6 digits.');
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hashPin(pin, salt), iterations: ITERATIONS };
}

/** Compared in full, whatever the first wrong character, so the time taken says nothing. */
export async function checkPin(cfg, pin) {
  if (!cfg?.hash || !validPin(pin)) return false;
  const got = await hashPin(pin, cfg.salt, cfg.iterations ?? ITERATIONS);
  if (got.length !== cfg.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ cfg.hash.charCodeAt(i);
  return diff === 0;
}

/** The lock is due once the app has not been used for `after` minutes, or when no use was ever recorded. */
export function dueToLock({ lastActive, now, after }) {
  if (!Number.isFinite(lastActive)) return true;
  return now - lastActive >= minutes(after) * 60_000;
}

/** A chosen time that is not one of the options counts as the default. */
export const minutes = (after) => (AFTER_OPTIONS.includes(after) ? after : DEFAULT_AFTER);

/** The authenticator data of a WebAuthn answer says the user was verified (Face ID, Touch ID, passcode): flag UV, bit 2 of byte 32. */
export function userVerified(authenticatorData) {
  const bytes = new Uint8Array(authenticatorData ?? []);
  return bytes.length >= 37 && (bytes[32] & 0x04) !== 0;
}

/** Same bytes, as the id of the passkey made at setup. */
export function sameId(rawId, stored) {
  if (!rawId || !stored) return false;
  return toBase64(rawId) === stored;
}

export function readLock(storage) {
  try {
    const cfg = JSON.parse(storage.getItem(LOCK_KEY) ?? 'null');
    return cfg?.hash && cfg?.salt ? { faceId: null, failures: 0, until: 0, ...cfg, after: minutes(cfg.after) } : null;
  } catch {
    return null;
  }
}

export function writeLock(storage, cfg) {
  if (cfg) storage.setItem(LOCK_KEY, JSON.stringify(cfg));
  else {
    storage.removeItem(LOCK_KEY);
    storage.removeItem(ACTIVE_KEY);
  }
}

/** One wrong PIN: kept with the others of the last ten minutes; older ones no longer count. */
export function failed(cfg, now) {
  const misses = [...(Array.isArray(cfg.misses) ? cfg.misses : []).filter((at) => Number.isFinite(at) && at <= now && now - at < LOCKOUT_WINDOW), now];
  return { ...cfg, misses, failures: misses.length, until: 0 };
}

/** The third wrong PIN within ten minutes: the phone is to be unpaired, and pairing again is the way back. */
export const lockedOut = (cfg) => (Array.isArray(cfg?.misses) ? cfg.misses.length : 0) >= LOCKOUT_TRIES;

/** Tries left before the phone is unpaired. */
export const triesLeft = (cfg) => Math.max(0, LOCKOUT_TRIES - (Array.isArray(cfg?.misses) ? cfg.misses.length : 0));

export const cleared = (cfg) => ({ ...cfg, failures: 0, until: 0, misses: [] });

export { toBase64, fromBase64 };
