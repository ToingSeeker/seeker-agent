// Files fetched from the Mac and kept on the phone (remote-server/public/keep.js), against a
// stand-in for the browser's Cache Storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KEEP_CACHE, clearKept, forget, keep, kept, keptList, keptSize, keptUrl, store as keepStore, toEvict } from '../remote-server/public/keep.js';

function fakeStore() {
  const caches = new Map();
  const key = (r) => new URL(typeof r === 'string' ? r : r.url, 'https://relay.example').pathname;
  return {
    caches,
    async open(name) {
      if (!caches.has(name)) caches.set(name, new Map());
      const m = caches.get(name);
      return {
        put: async (r, res) => void m.set(key(r), { body: await res.arrayBuffer(), headers: [...res.headers] }),
        match: async (r) => (m.has(key(r)) ? new Response(m.get(key(r)).body, { headers: m.get(key(r)).headers }) : undefined),
        keys: async () => [...m.keys()].map((url) => ({ url: `https://relay.example${url}` })),
        delete: async (r) => m.delete(key(r)),
      };
    },
    delete: async (name) => caches.delete(name),
  };
}

const file = (name, bytes, type = 'video/mp4') => new File([new Uint8Array(bytes).fill(7)], name, { type });

test('a kept file comes back whole, with its name and type', async () => {
  const store = fakeStore();
  assert.equal(await keep(file('clip final.mp4', 1000), '/Users/a/Movies/clip final.mp4', { store }), true);
  const hit = await kept('/Users/a/Movies/clip final.mp4', { store });
  assert.equal(hit.file.name, 'clip final.mp4');
  assert.equal(hit.file.type, 'video/mp4');
  assert.equal(hit.file.size, 1000);
  assert.deepEqual(new Uint8Array(await hit.file.arrayBuffer()), new Uint8Array(1000).fill(7));
  assert.equal(hit.smaller, false);
});

test('a file of another size at the same path is not served from the phone', async () => {
  const store = fakeStore();
  await keep(file('a.mp4', 1000), '/x/a.mp4', { store });
  assert.equal(await kept('/x/a.mp4', { bytes: 2000, store }), null);
  assert.ok(await kept('/x/a.mp4', { bytes: 1000, store }));
  assert.equal(await kept('/x/other.mp4', { store }), null);
  assert.equal(await kept(null, { store }), null);
});

test('a smaller copy is remembered as one', async () => {
  const store = fakeStore();
  await keep(file('p.jpg', 10, 'image/jpeg'), '/in/p.jpg', { smaller: true, store });
  assert.equal((await kept('/in/p.jpg', { store })).smaller, true);
});

test('past the limit the oldest go first; a file larger than the limit is not kept', async () => {
  assert.deepEqual(toEvict([{ url: 'a', bytes: 50, at: 1 }, { url: 'b', bytes: 50, at: 3 }, { url: 'c', bytes: 50, at: 2 }], 100), ['a']);
  assert.deepEqual(toEvict([{ url: 'a', bytes: 50, at: 1 }], 100), []);
  const store = fakeStore();
  assert.equal(await keep(file('big.mp4', 200), '/big.mp4', { store, limit: 100 }), false);
  await keep(file('one.mp4', 60), '/one.mp4', { store, limit: 100 });
  await new Promise((r) => setTimeout(r, 5));
  await keep(file('two.mp4', 60), '/two.mp4', { store, limit: 100 });
  assert.equal(await kept('/one.mp4', { store }), null);
  assert.ok(await kept('/two.mp4', { store }));
});

test('size counts what is kept, and clearing drops it all', async () => {
  const store = fakeStore();
  await keep(file('a.mp4', 30), '/a.mp4', { store });
  await keep(file('b.zip', 20, 'application/zip'), '/b.zip', { store });
  assert.deepEqual(await keptSize({ store }), { count: 2, bytes: 50 });
  await clearKept({ store });
  assert.equal(store.caches.has(KEEP_CACHE), false);
  assert.deepEqual(await keptSize({ store }), { count: 0, bytes: 0 });
  assert.equal(await kept('/a.mp4', { store }), null);
});

test('without Cache Storage nothing is kept and nothing breaks', async () => {
  assert.equal(await keep(file('a.mp4', 1), '/a.mp4', { store: undefined }), false);
  assert.equal(await kept('/a.mp4', { store: undefined }), null);
  assert.deepEqual(await keptSize({ store: undefined }), { count: 0, bytes: 0 });
});

test('the url never leaves the made-up prefix', () => {
  assert.equal(keptUrl('/Users/a/../b?x#y'), '/__kept/%2FUsers%2Fa%2F..%2Fb%3Fx%23y');
});

test('the app checks the phone before asking the Mac, keeps what arrives, and unpairing clears it', () => {
  const app = fs.readFileSync(new URL('../remote-server/public/app.js', import.meta.url), 'utf8');
  const fn = (name) => app.slice(app.indexOf(`function ${name}(`), app.indexOf('\n}\n', app.indexOf(`function ${name}(`)));
  const open = fn('openFile');
  assert.match(open, /await kept\(src\.where/);
  assert.ok(open.indexOf('kept(') < open.indexOf('start();'), 'the phone is looked at before the Mac is asked');
  assert.match(fn('fetchFile'), /await keepFile\(file, where, \{ smaller \}\)/);
  assert.match(fn('fetchFile'), /if \(busy\?\.state === 'downloading'\) return busy\.promise/, 'one download per file at a time');
  assert.match(fn('openPicture'), /openFile\(\{ kind: 'picture'/);
  assert.match(fn('signOut'), /clearKept\(\)/);
});

test('a kept file is only reported kept once it reads back whole', async () => {
  const store = fakeStore();
  assert.deepEqual(await keepStore(file('a.mp4', 10), '/a.mp4', { store }), { ok: true, reason: null });
  assert.deepEqual(await keepStore(file('big.mp4', 200), '/big.mp4', { store, limit: 100 }), { ok: false, reason: 'too-large' });
  assert.deepEqual(await keepStore(file('a.mp4', 10), '/a.mp4', { store: undefined }), { ok: false, reason: 'no-storage' });
  // The phone refuses the space.
  const full = { open: async () => ({ put: async () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); }, keys: async () => [], match: async () => undefined, delete: async () => false }) };
  assert.deepEqual(await keepStore(file('a.mp4', 10), '/a.mp4', { store: full }), { ok: false, reason: 'full' });
  // It says it stored it, and does not have it.
  const forgetful = { open: async () => ({ put: async () => {}, keys: async () => [], match: async () => undefined, delete: async () => false }) };
  assert.deepEqual(await keepStore(file('a.mp4', 10), '/a.mp4', { store: forgetful }), { ok: false, reason: 'failed' });
});

test('the list of kept files names each by its path on the Mac, newest first, and one can be dropped', async () => {
  const store = fakeStore();
  await keep(file('one.pdf', 5, 'application/pdf'), '/tmp/s/one.pdf', { store });
  await new Promise((r) => setTimeout(r, 5));
  await keep(file('two.jpg', 7, 'image/jpeg'), '/tmp/s/two.jpg', { store });
  const list = await keptList({ store });
  assert.deepEqual(list.map((e) => [e.path, e.name, e.type, e.bytes]), [['/tmp/s/two.jpg', 'two.jpg', 'image/jpeg', 7], ['/tmp/s/one.pdf', 'one.pdf', 'application/pdf', 5]]);
  assert.equal(await forget('/tmp/s/two.jpg', { store }), true);
  assert.equal(await kept('/tmp/s/two.jpg', { store }), null);
  assert.deepEqual((await keptList({ store })).map((e) => e.path), ['/tmp/s/one.pdf']);
  assert.deepEqual(await keptList({ store: undefined }), []);
});
