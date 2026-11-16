// Files fetched from the Mac, kept on this phone so opening one again needs no second download.
//
// They live in the browser's Cache Storage under made-up URLs (/__kept/<path on the Mac>) that are
// never requested from the network. A file is found again by its path on the Mac and, when the
// message says it, its size: a file rewritten at the same path with another size is fetched afresh.
// The oldest are dropped past KEEP_LIMIT, and all of them when the phone is unpaired.
//
// What is kept here is the decrypted file: the app lock hides it, it does not encrypt it.

export const KEEP_CACHE = 'seeker-files-v1';
export const KEEP_LIMIT = 300 * 1024 * 1024;
const PREFIX = '/__kept/';

/** The made-up URL a file from this path on the Mac is kept under. */
export const keptUrl = (path) => PREFIX + encodeURIComponent(String(path));

/** Which kept entries to drop, oldest first, so the rest fit in `limit` bytes. */
export function toEvict(entries, limit = KEEP_LIMIT) {
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  const out = [];
  for (const e of [...entries].sort((a, b) => a.at - b.at)) {
    if (total <= limit) break;
    out.push(e.url);
    total -= e.bytes;
  }
  return out;
}

const open = (store) => store?.open(KEEP_CACHE);

/** Keep a file fetched from `path` on the Mac. Never throws: keeping is a convenience. */
export async function keep(file, path, { smaller = false, store = globalThis.caches, limit = KEEP_LIMIT } = {}) {
  if (!path || !store || file.size > limit) return false;
  try {
    const cache = await open(store);
    const headers = { 'content-type': file.type || 'application/octet-stream', 'x-name': encodeURIComponent(file.name), 'x-bytes': String(file.size), 'x-at': String(Date.now()) };
    if (smaller) headers['x-smaller'] = '1';
    await cache.put(keptUrl(path), new Response(file, { headers }));
    for (const url of toEvict(await entries(cache), limit)) await cache.delete(url);
    return true;
  } catch {
    return false;
  }
}

/** The file kept for `path`, or null. With `bytes`, one of another size does not count. */
export async function kept(path, { bytes = null, store = globalThis.caches } = {}) {
  if (!path || !store) return null;
  try {
    const res = await (await open(store)).match(keptUrl(path));
    if (!res) return null;
    const blob = await res.blob();
    if (Number.isFinite(bytes) && blob.size !== bytes) return null;
    const file = new File([blob], decodeURIComponent(res.headers.get('x-name') ?? 'file'), { type: res.headers.get('content-type') ?? '' });
    return { file, smaller: res.headers.get('x-smaller') === '1' };
  } catch {
    return null;
  }
}

async function entries(cache) {
  const out = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res) out.push({ url: new URL(req.url ?? req, 'http://x').pathname, bytes: Number(res.headers.get('x-bytes')) || 0, at: Number(res.headers.get('x-at')) || 0 });
  }
  return out;
}

/** How many files are kept and how many bytes they take. */
export async function keptSize({ store = globalThis.caches } = {}) {
  if (!store) return { count: 0, bytes: 0 };
  try {
    const list = await entries(await open(store));
    return { count: list.length, bytes: list.reduce((sum, e) => sum + e.bytes, 0) };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** Drop every kept file. */
export async function clearKept({ store = globalThis.caches } = {}) {
  try {
    await store?.delete(KEEP_CACHE);
  } catch {}
}
