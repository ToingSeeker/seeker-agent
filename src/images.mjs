// Images in a conversation.
//
// A message may carry `images: [{ name, mime, data }]`, `data` being base64.
// They get there in two ways: the user names an image file in a message, or
// the model reads one with read_file. Each provider adapter turns them into
// its own wire format; the helpers here are what they share.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The strictest provider limit is 5 MB of base64 per image, which is 3.75 MB of file.
export const MAX_IMAGE_BYTES = 3_750_000;
export const MAX_IMAGES_PER_MESSAGE = 8;
// What one image is counted as when estimating how full the context is.
const IMAGE_TOKENS = 1500;
const CHARS_PER_TOKEN = 3.5;

const IMAGE_PATH = /\.(png|jpe?g|gif|webp)$/i;

/** The image type of a file's first bytes, or null. The content decides, not the file name. */
export function imageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.toString('latin1', 0, 6))) return 'image/gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export const kilobytes = (bytes) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

/**
 * Reads an image file for sending to a model.
 * @returns {{ name: string, mime: string, data: string, bytes: number }}
 * @throws {Error} with a message fit to show as it is
 */
export function loadImage(file) {
  const name = path.basename(file);
  // Sized before it is read: a file is not an image just because its name says so.
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${name} is not a file`);
  if (stat.size > MAX_IMAGE_BYTES) throw new Error(`${name} is ${kilobytes(stat.size)}; images can be at most ${kilobytes(MAX_IMAGE_BYTES)}. Save a smaller copy and use that`);
  const buf = fs.readFileSync(file);
  const mime = imageType(buf);
  if (!mime) throw new Error(`${name} is not a PNG, JPEG, GIF or WebP image`);
  return { name, mime, data: buf.toString('base64'), bytes: buf.length };
}

const base64Bytes = (text) => Math.floor((text.length * 3) / 4);
const MAX_THUMB_CHARS = 40_000;

/**
 * Checks images that arrived from another device (the phone app) instead of from a file here.
 * What they are is decided by their bytes, never by what the sender says.
 * @param {unknown} list  [{ name, data, thumb? }], `data` and `thumb` base64
 * @returns {{ name: string, mime: string, data: string, thumb: { mime: string, data: string } | null }[]}
 * @throws {Error} with a message fit to show as it is
 */
export function receivedImages(list, max = 4) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > max) throw new Error(`A message can carry at most ${max} images.`);
  return list.map((entry, i) => {
    const data = typeof entry?.data === 'string' ? entry.data : '';
    const label = path.basename(String(entry?.name ?? '')).replace(/[^\w .()-]/g, '').trim().slice(0, 80) || `image-${i + 1}`;
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error(`${label} did not arrive as an image.`);
    if (base64Bytes(data) > MAX_IMAGE_BYTES) throw new Error(`${label} is too large; images can be at most ${kilobytes(MAX_IMAGE_BYTES)}.`);
    const mime = imageType(Buffer.from(data.slice(0, 24), 'base64'));
    if (!mime) throw new Error(`${label} is not a PNG, JPEG, GIF or WebP image.`);
    // The small preview shown in the transcript is optional: one that does not check out is just left out.
    const small = typeof entry.thumb === 'string' && entry.thumb.length <= MAX_THUMB_CHARS && /^[A-Za-z0-9+/]+={0,2}$/.test(entry.thumb) ? entry.thumb : '';
    const smallMime = small ? imageType(Buffer.from(small.slice(0, 24), 'base64')) : null;
    return { name: label, mime, data, thumb: smallMime ? { mime: smallMime, data: small } : null };
  });
}

/** Writes images to a folder only this user can open, for a provider that reads files itself. */
export function saveImages(images, dir = os.tmpdir()) {
  const folder = fs.mkdtempSync(path.join(dir, 'seeker-image-'));
  return images.map((image, i) => {
    const ext = image.mime.split('/')[1].replace('jpeg', 'jpg');
    const file = path.join(folder, `${i + 1}-${path.basename(image.name).replace(/\.[^.]*$/, '') || 'image'}.${ext}`);
    fs.writeFileSync(file, Buffer.from(image.data, 'base64'), { flag: 'wx', mode: 0o600 });
    return file;
  });
}

/**
 * Image files named in a message: plain paths, quoted paths, and paths with
 * escaped spaces (what a terminal types when a file is dragged into it).
 * Only files that exist are returned, as absolute paths.
 */
export function imagePathsIn(text, cwd) {
  const found = [];
  for (const m of String(text).matchAll(/"([^"\n]+)"|'([^'\n]+)'|((?:\\.|[^\s"'\\])+)/g)) {
    let candidate = m[1] ?? m[2] ?? m[3].replace(/\\(.)/g, '$1');
    candidate = candidate.replace(/^@/, '').replace(/^file:\/\//, '');
    // A path at the end of a sentence drags its punctuation along.
    if (!IMAGE_PATH.test(candidate)) candidate = candidate.replace(/[.,;:!?)\]]+$/, '');
    if (!IMAGE_PATH.test(candidate)) continue;
    if (candidate === '~' || candidate.startsWith('~/')) candidate = path.join(os.homedir(), candidate.slice(1));
    const file = path.resolve(cwd, candidate);
    try {
      if (fs.statSync(file).isFile() && !found.includes(file)) found.push(file);
    } catch {
      // Not a file on this machine: it stays ordinary text.
    }
    if (found.length === MAX_IMAGES_PER_MESSAGE) break;
  }
  return found;
}

/** The size of a message for context accounting: an image counts as a fixed amount, not as its bytes. */
export function messageChars(message) {
  if (!message.images?.length) return JSON.stringify(message).length;
  const { images, ...rest } = message;
  return JSON.stringify(rest).length + images.length * IMAGE_TOKENS * CHARS_PER_TOKEN;
}

/** The message with its images replaced by a line saying they were there. */
export function withoutImages(message, why = 'not shown') {
  if (!message.images?.length) return message;
  const { images, ...rest } = message;
  const note = images.map((i) => `[image ${i.name}: ${why}]`).join('\n');
  return { ...rest, content: rest.content ? `${rest.content}\n${note}` : note };
}

/**
 * Most chat APIs take an image only in a user message. Images a tool returned
 * are therefore moved into a user message placed after that turn's tool results.
 */
export function hoistToolImages(messages) {
  const out = [];
  let waiting = [];
  const flush = () => {
    if (!waiting.length) return;
    out.push({ role: 'user', content: `The image${waiting.length > 1 ? 's' : ''} from the tool result above: ${waiting.map((i) => i.name).join(', ')}`, images: waiting });
    waiting = [];
  };
  for (const m of messages) {
    if (m.role !== 'tool') flush();
    if (m.role === 'tool' && m.images?.length) {
      const { images, ...rest } = m;
      waiting.push(...images);
      out.push(rest);
    } else out.push(m);
  }
  flush();
  return out;
}

/**
 * Saves the image on the clipboard (a screenshot, a copied picture) as a PNG file.
 * @returns {string} the file's path
 * @throws {Error} if there is no image on the clipboard or no way to read it here
 */
export function saveClipboardImage(dir = os.tmpdir()) {
  // A folder of its own that only this user can open, so nobody else can plant or read the file.
  const folder = fs.mkdtempSync(path.join(dir, 'seeker-paste-'));
  const file = path.join(folder, 'clipboard.png');
  const attempts =
    process.platform === 'darwin'
      ? [['osascript', ['-e', 'set png to (the clipboard as «class PNGf»)', '-e', `set f to open for access POSIX file ${JSON.stringify(file)} with write permission`, '-e', 'write png to f', '-e', 'close access f']]]
      : [
          ['wl-paste', ['--type', 'image/png']],
          ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
        ];
  let ran = false;
  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, { timeout: 10_000, maxBuffer: 64_000_000 });
    if (result.error?.code === 'ENOENT') continue;
    ran = true;
    if (result.status !== 0) continue;
    if (process.platform !== 'darwin') fs.writeFileSync(file, result.stdout, { flag: 'wx', mode: 0o600 });
    if (fs.existsSync(file) && imageType(fs.readFileSync(file))) return file;
    fs.rmSync(file, { force: true });
  }
  fs.rmSync(folder, { recursive: true, force: true });
  throw new Error(ran ? 'There is no image on the clipboard.' : 'Reading the clipboard needs wl-paste or xclip on this system.');
}
