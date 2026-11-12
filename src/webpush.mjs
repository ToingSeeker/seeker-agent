// Web Push, sent straight from this machine to the phone's push service
// (Apple, Google, Mozilla). No library: the two standards involved are short.
//
//   RFC 8291  the message is encrypted for one browser, with keys only that
//             browser holds — the push service forwards bytes it cannot read
//   RFC 8292  "VAPID": a signed token telling the push service who is sending
//
// The relay plays no part in this and learns nothing about notifications.
import crypto from 'node:crypto';

const b64u = (data) => Buffer.from(data).toString('base64url');
const fromB64u = (text) => Buffer.from(text, 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Only real push services are ever contacted, whatever address a subscription names.
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

/** A new identity for sending pushes: { publicKey, privateKey }, base64url. */
export function createVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

/** The Authorization header value that identifies the sender to the push service. */
export function vapidHeader(endpoint, vapid, subject) {
  const point = fromB64u(vapid.publicKey); // 0x04 ‖ x ‖ y
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33, 65)), d: vapid.privateKey } });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const signature = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(signature)}, k=${vapid.publicKey}`;
}

/**
 * Encrypts `plaintext` for one subscription (content encoding "aes128gcm").
 * @param {{ keys: { p256dh: string, auth: string } }} subscription
 * @param {string} plaintext
 * @param {{ senderPrivate?: string, salt?: string }} [fixed]  test use only
 */
export function encryptPayload(subscription, plaintext, fixed = {}) {
  const receiver = fromB64u(subscription.keys.p256dh);
  const authSecret = fromB64u(subscription.keys.auth);
  const sender = crypto.createECDH('prime256v1');
  // `fixed` pins the values that are normally random, so the output can be checked against the RFC's example.
  if (fixed.senderPrivate) sender.setPrivateKey(fromB64u(fixed.senderPrivate));
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const shared = sender.computeSecret(receiver);

  // Key derivation from RFC 8291 §3.4; each step is one round of HKDF.
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), receiver, senderPublic, Buffer.from([1])]));
  const salt = fixed.salt ? fromB64u(fixed.salt) : crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const key = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', key, nonce);
  // 0x02 marks the end of the last (here: only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([senderPublic.length]), senderPublic, body]);
}

/**
 * Sends one notification.
 * @param {{ endpoint: string, keys: object }} subscription  what the browser returned from pushManager.subscribe()
 * @param {object} payload   delivered to the phone's service worker as JSON
 * @param {{ publicKey: string, privateKey: string }} vapid
 * @param {{ subject: string, ttl?: number, anyHost?: boolean }} opts  `anyHost` is for tests
 * @returns {Promise<{ ok: boolean, status: number, gone: boolean }>}  `gone` = the subscription no longer exists
 */
export async function sendPush(subscription, payload, vapid, { subject, ttl = 3600, anyHost = false }) {
  let url;
  try {
    url = new URL(subscription.endpoint);
  } catch {
    return { ok: false, status: 0, gone: true };
  }
  if (!anyHost && (url.protocol !== 'https:' || !PUSH_HOSTS.test(url.hostname))) return { ok: false, status: 0, gone: true };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: vapidHeader(subscription.endpoint, vapid, subject),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(ttl),
        urgency: 'high',
      },
      body: encryptPayload(subscription, JSON.stringify(payload)),
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}
