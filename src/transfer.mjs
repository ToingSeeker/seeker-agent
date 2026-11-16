// Whole files between the phone and this machine: a video to edit, a reference, the result.
//
// They go through the relay in pieces (see remote-server/server.mjs), each sealed on its own
// with AES-256-GCM. The piece's file id and number are bound into the seal, so the relay can
// neither swap pieces between files nor reorder them unnoticed. remote-server/public/app.js
// does the same on the phone; CHUNK_BYTES must match there.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kilobytes } from './images.mjs';

export const CHUNK_BYTES = 2 * 1024 * 1024; // sealed and base64-encoded it stays under the relay's 4 MiB per request
export const MAX_TRANSFER_BYTES = 300 * 1024 * 1024; // the phone holds a download in memory
export const MAX_FILES_PER_MESSAGE = 4;
export const FILE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const IDLE_MS = 120_000; // no piece moved for this long: the other side has gone

// What can be offered to the phone, by extension. The phone decides how to show it from this type.
export const TRANSFER_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.srt': 'text/plain',
};

export const INBOX = path.join(os.homedir(), 'Downloads', 'SEEKER');

const aad = (id, n) => Buffer.from(`seeker-chunk-v1:${id}:${n}`);

export function sealChunk(key, id, n, bytes) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(id, n));
  const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
}

/** Throws if the piece was not sealed with this key, for this file and this place in it. */
export function unsealChunk(key, id, n, text) {
  const raw = Buffer.from(text, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(aad(id, n));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
}

/** A file name as the phone said it, made safe to use here: no folders, no odd characters. */
export function cleanName(name, fallback = 'file') {
  const base = path.basename(String(name ?? '').replace(/\\/g, '/')).replace(/[^\w .()+-]/g, '').replace(/^\.+/, '').trim().slice(-120);
  return base || fallback;
}

/**
 * Checks the files a message from the phone announces. Their content comes later, in pieces.
 * @returns {{ id: string, name: string, bytes: number, chunks: number }[]}
 * @throws {Error} with a message fit to show as it is
 */
export function announcedFiles(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > MAX_FILES_PER_MESSAGE) throw new Error(`A message can carry at most ${MAX_FILES_PER_MESSAGE} files.`);
  const ids = new Set();
  return list.map((entry, i) => {
    const name = cleanName(entry?.name, `file-${i + 1}`);
    const bytes = Number(entry?.bytes);
    if (typeof entry?.id !== 'string' || !FILE_ID.test(entry.id) || ids.has(entry.id)) throw new Error(`${name} could not be sent.`);
    ids.add(entry.id);
    if (!Number.isInteger(bytes) || bytes <= 0) throw new Error(`${name} is empty.`);
    if (bytes > MAX_TRANSFER_BYTES) throw new Error(`${name} is ${kilobytes(bytes)}; a file can be at most ${kilobytes(MAX_TRANSFER_BYTES)}.`);
    return { id: entry.id, name, bytes, chunks: Math.ceil(bytes / CHUNK_BYTES) };
  });
}

/** `name` in `dir`, or `name (2)` and so on when that is taken: nothing already there is overwritten. */
function freePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const file = path.join(dir, i === 1 ? name : `${stem} (${i})${ext}`);
    if (!fs.existsSync(file)) return file;
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Takes a file the phone is sending, piece by piece, and saves it in `dir`.
 * @returns {Promise<string>} where it was saved
 */
export async function receiveFile({ url, headers, key, file, dir = INBOX, idleMs = IDLE_MS, fetchImpl = fetch }) {
  fs.mkdirSync(dir, { recursive: true });
  const part = path.join(dir, `.${file.id}.part`);
  const fd = fs.openSync(part, 'w', 0o600);
  let ok = false;
  try {
    let written = 0;
    let last = Date.now();
    for (let n = 0; n < file.chunks; ) {
      if (Date.now() - last > idleMs) throw new Error(`The phone stopped sending ${file.name}.`);
      let res;
      try {
        res = await fetchImpl(`${url}/agent/chunk?id=${file.id}&n=${n}`, { headers, signal: AbortSignal.timeout(40_000) });
      } catch {
        await pause(1000);
        continue;
      }
      if (res.status === 204 || res.status === 409) continue;
      if (!res.ok) {
        await pause(1000);
        continue;
      }
      let bytes;
      try {
        bytes = unsealChunk(key, file.id, n, (await res.json()).c);
      } catch {
        throw new Error(`${file.name} did not arrive intact.`);
      }
      written += bytes.length;
      if (written > file.bytes || (n < file.chunks - 1 && bytes.length !== CHUNK_BYTES)) throw new Error(`${file.name} did not arrive intact.`);
      fs.writeSync(fd, bytes);
      last = Date.now();
      n += 1;
    }
    if (written !== file.bytes) throw new Error(`${file.name} did not arrive whole.`);
    ok = true;
  } finally {
    fs.closeSync(fd);
    if (!ok) fs.rmSync(part, { force: true });
  }
  // The name is chosen only now, so two files of the same name arriving together both keep theirs.
  const target = freePath(dir, file.name);
  fs.renameSync(part, target);
  return target;
}

// Sent from the phone and read back there to check it: text of these kinds is shown as plain text.
const TEXT_PREVIEW = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.sh', '.sql', '.env.example', '.ini', '.conf']);

/**
 * The files a message lists under `marker` ("- /path (19 KB)", one per line), as the phone shows
 * them: `{ name, bytes, mime, file }`. `mime` is null when the phone cannot show that kind; text
 * of any kind comes back as text/plain, so it is never run as a page there.
 */
export function listedFiles(text, marker) {
  const at = String(text ?? '').indexOf(marker);
  if (at < 0) return [];
  const files = [];
  for (const line of String(text).slice(at + marker.length).split('\n')) {
    const m = /^- (\/.+) \(([^)]*)\)$/.exec(line.trim());
    if (!m) continue;
    const file = m[1];
    const ext = path.extname(file).toLowerCase();
    let bytes = null;
    try {
      bytes = fs.statSync(file).size;
    } catch {}
    files.push({ name: path.basename(file), bytes, mime: TRANSFER_TYPES[ext] ?? (TEXT_PREVIEW.has(ext) ? 'text/plain' : null), file });
  }
  return files;
}

/** What a file is, if it may be offered to the phone. */
export function transferable(file) {
  const mime = TRANSFER_TYPES[path.extname(file).toLowerCase()];
  if (!mime) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_TRANSFER_BYTES) return null;
    return { mime, bytes: stat.size };
  } catch {
    return null;
  }
}

/**
 * The files an answer names that the phone could download: paths written in it, plain or in
 * `code`, absolute, under ~ or relative to the project. Only files that exist, of a type in
 * TRANSFER_TYPES.
 * @returns {{ name: string, mime: string, bytes: number, file: string }[]}
 */
export function filesNamed(text, cwd, max = 6) {
  const words = new Set();
  for (const m of String(text ?? '').matchAll(/`([^`\n]+)`/g)) words.add(m[1].trim());
  for (const m of String(text ?? '').matchAll(/[^\s`'"<>()[\]{}|*]+/g)) words.add(m[0]);
  const found = new Map();
  for (let word of words) {
    word = word.replace(/^@/, '').replace(/^file:\/\//, '').replace(/[.,;:!?]+$/, '');
    if (!TRANSFER_TYPES[path.extname(word).toLowerCase()]) continue;
    const file = word.startsWith('~/') ? path.join(os.homedir(), word.slice(2)) : path.resolve(cwd, word);
    if (found.has(file)) continue;
    const kind = transferable(file);
    if (kind) found.set(file, { name: path.basename(file), ...kind, file });
    if (found.size >= max) break;
  }
  return [...found.values()];
}

/**
 * Sends a file to the phone piece by piece. The relay holds only so much at once, so this
 * waits whenever it says it is full, until the phone has taken some.
 */
export async function sendFile({ url, headers, key, id, file, idleMs = IDLE_MS, fetchImpl = fetch }) {
  const { size } = fs.statSync(file);
  const chunks = Math.ceil(size / CHUNK_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(CHUNK_BYTES);
    let last = Date.now();
    for (let n = 0; n < chunks; ) {
      if (Date.now() - last > idleMs) throw new Error('The phone stopped downloading.');
      const read = fs.readSync(fd, buf, 0, CHUNK_BYTES, n * CHUNK_BYTES);
      const body = JSON.stringify({ id, n, c: sealChunk(key, id, n, buf.subarray(0, read)) });
      let res;
      try {
        res = await fetchImpl(`${url}/agent/chunk`, { method: 'POST', headers, body, signal: AbortSignal.timeout(60_000) });
      } catch {
        res = null;
      }
      if (!res?.ok) {
        await pause(res?.status === 507 ? 500 : 1500);
        continue;
      }
      last = Date.now();
      n += 1;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { chunks, bytes: size };
}
