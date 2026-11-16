// Files in the timeline: the ones sent from this phone and the ones an answer offers, shown as
// cards, and what a preview of one can show. Pure functions only; app.js draws them.
//
// A message sent with files reaches the agent as its text plus a list under PHONE_FILES (see
// src/commands.mjs, where the same words are kept). The card takes that list's place on screen;
// the agent still reads it as it was.

export const PHONE_FILES = '[Sent from the phone, saved on this Mac:]';

/** The words of a message and the files listed under it: `{ said, listed: [{ name, path, size }] }`. */
export function splitSent(text) {
  const all = String(text ?? '');
  const at = all.indexOf(PHONE_FILES);
  if (at < 0) return { said: all, listed: [] };
  const listed = [];
  for (const line of all.slice(at + PHONE_FILES.length).split('\n')) {
    const m = /^- (.+) \(([^)]*)\)$/.exec(line.trim());
    if (m) listed.push({ name: m[1].split('/').pop(), path: m[1], size: m[2] });
  }
  return { said: all.slice(0, at).trimEnd(), listed };
}

/** The name split so the end stays in view when the start is cut: `{ stem, ext }`. */
export function splitName(name) {
  const text = String(name ?? '');
  const dot = text.lastIndexOf('.');
  if (dot <= 0 || text.length - dot > 8) return { stem: text, ext: '' };
  return { stem: text.slice(0, dot), ext: text.slice(dot) };
}

const KINDS = [
  ['zip', 'ZIP', /\.(zip|tar|gz|tgz|rar|7z)$/i],
  ['pdf', 'PDF', /\.pdf$/i],
  ['video', null, /\.(mp4|m4v|mov|webm)$/i],
  ['audio', null, /\.(mp3|m4a|wav)$/i],
  ['image', null, /\.(png|jpe?g|gif|webp|heic)$/i],
  ['code', null, /\.(html?|css|m?js|cjs|tsx?|jsx|json|py|rb|go|rs|java|kt|swift|c|h|cpp|sh|sql|ya?ml|toml|xml)$/i],
  ['text', null, /\.(txt|md|markdown|csv|tsv|log|srt)$/i],
];

/** The badge on a card: its colour (`tone`) and the few letters on it. */
export function fileKind(name) {
  const text = String(name ?? '');
  const dot = text.lastIndexOf('.');
  const ext = dot >= 0 ? text.slice(dot + 1).toUpperCase() : '';
  for (const [tone, label, re] of KINDS) if (re.test(text)) return { tone, label: label ?? (ext.length <= 4 ? ext : ext.slice(0, 4)) };
  return { tone: 'other', label: ext && ext.length <= 4 ? ext : 'FILE' };
}

/** The last folder or two of a path, as a hint under the name: `/Users/me/Downloads/SEEKER/a.zip` → `Downloads/SEEKER`. */
export function folderOf(file) {
  const parts = String(file ?? '').split('/').filter(Boolean);
  parts.pop();
  return parts.slice(-2).join('/');
}

/** How a preview shows a file of this type: video, audio, image, pdf, text, zip, or nothing. */
export function previewKind(type, name = '') {
  const t = String(type ?? '');
  if (/^video\//.test(t)) return 'video';
  if (/^audio\//.test(t)) return 'audio';
  if (/^image\/(png|jpeg|gif|webp)$/.test(t)) return 'image';
  if (t === 'application/pdf') return 'pdf';
  if (t === 'application/zip' || /\.zip$/i.test(name)) return 'zip';
  if (/^text\//.test(t) || /^application\/(json|xml|javascript)$/.test(t) || fileKind(name).tone === 'code' || fileKind(name).tone === 'text') return 'text';
  return null;
}

/** How many bytes from the end of a zip hold its end record, at most. */
export const ZIP_TAIL = 65_557;

/**
 * Where a zip keeps its list of contents, from the last ZIP_TAIL bytes of it: `{ offset, size, count }`,
 * or null when those bytes are not the end of a zip.
 */
export function zipDirectory(tail) {
  const data = tail instanceof Uint8Array ? tail : new Uint8Array(tail);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = data.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return { count: view.getUint16(i + 10, true), size: view.getUint32(i + 12, true), offset: view.getUint32(i + 16, true) };
  }
  return null;
}

/** The contents that list names: `[{ name, bytes, folder }]`, Mac clutter left out. Nothing is unpacked. */
export function zipEntries(directory, count, max = 500) {
  const data = directory instanceof Uint8Array ? directory : new Uint8Array(directory);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const names = new TextDecoder();
  const entries = [];
  let at = 0;
  for (let n = 0; n < count && entries.length < max; n++) {
    if (at + 46 > data.length || view.getUint32(at, true) !== 0x02014b50) break;
    const nameLength = view.getUint16(at + 28, true);
    const name = names.decode(data.subarray(at + 46, at + 46 + nameLength));
    if (!/(^|\/)__MACOSX\/|(^|\/)\.DS_Store$/.test(name)) entries.push({ name, bytes: view.getUint32(at + 24, true), folder: name.endsWith('/') });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}

/** What is in a zip File or Blob, reading only its end and its list: null when it is not a zip. */
export async function listZip(blob, max = 500) {
  const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - ZIP_TAIL)).arrayBuffer());
  const dir = zipDirectory(tail);
  if (!dir || dir.offset + dir.size > blob.size) return null;
  return { count: dir.count, entries: zipEntries(new Uint8Array(await blob.slice(dir.offset, dir.offset + dir.size).arrayBuffer()), dir.count, max) };
}
