// Images in a conversation.
//
// A message may carry `images: [{ name, mime, data }]`, `data` being base64.
// They get there in two ways: the user names an image file in a message, or
// the model reads one with read_file. Each provider adapter turns them into
// its own wire format; the helpers here are what they share.
import { execFile, spawnSync } from 'node:child_process';
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

// A name no person chose: a UUID (what iOS gives a pasted or shared picture), a long run of hex,
// or a timestamp. The same test is in remote-server/public/files.js, for what the phone shows.
const MADE_UP = /^(?:.*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}.*|[0-9a-f-]{16,}|\d{10,}|\d{8}[_-]\d{6}|image|blob|file|photo)$/i;
const PLAIN_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'application/pdf': 'pdf', 'application/zip': 'zip' };
const IMAGE_EXT = /^(png|jpe?g|gif|webp|heic)$/i;
const VIDEO_EXT = /^(mp4|m4v|mov|webm)$/i;

/**
 * A file's name as a person would say it: one made up by the phone (`4BD7DFEC-…-837E1F902F06.png`)
 * becomes `image.png`, `video.mp4` or `file.pdf`; a name someone chose is left as it is.
 */
export function plainName(name, mime = '') {
  const text = String(name ?? '').trim();
  const ext = path.extname(text);
  if (text && !MADE_UP.test(ext ? text.slice(0, -ext.length) : text)) return text;
  const type = String(mime ?? '');
  const end = PLAIN_EXT[type] ?? ext.slice(1).toLowerCase().replace(/^jpeg$/, 'jpg');
  const base = /^image\//.test(type) || IMAGE_EXT.test(end) ? 'image' : /^video\//.test(type) || VIDEO_EXT.test(end) ? 'video' : 'file';
  return end ? `${base}.${end}` : base;
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
    return { name: plainName(label, mime), mime, data, thumb: smallMime ? { mime: smallMime, data: small } : null };
  });
}

// A preview sent to the phone with a tool step: big enough to make out a screenshot, small enough
// that a few of them fit in a snapshot (the relay takes at most 4 MB per message).
export const PREVIEW_SIDE = 480;
export const MAX_PREVIEW_CHARS = 80_000;

/**
 * A small JPEG of an image, for showing on the phone. Made with `sips` on macOS; elsewhere, or if
 * that fails, the image itself when it is already small enough.
 * @param {{ mime: string, data: string }} image  `data` base64
 * @returns {{ mime: string, data: string } | null}  null when no preview small enough could be made
 */
export function previewOf(image, { run = spawnSync, platform = process.platform } = {}) {
  if (platform === 'darwin') {
    let folder = null;
    try {
      folder = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-preview-'));
      const source = path.join(folder, `source.${image.mime.split('/')[1]}`);
      fs.writeFileSync(source, Buffer.from(image.data, 'base64'), { mode: 0o600 });
      for (const [side, quality] of [[PREVIEW_SIDE, 60], [320, 45]]) {
        const out = path.join(folder, `preview-${side}.jpg`);
        const result = run('sips', ['-Z', String(side), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), source, '--out', out], { timeout: 10_000 });
        if (result.status !== 0 || !fs.existsSync(out)) break;
        const data = fs.readFileSync(out).toString('base64');
        if (data.length <= MAX_PREVIEW_CHARS && imageType(Buffer.from(data.slice(0, 24), 'base64')) === 'image/jpeg') return { mime: 'image/jpeg', data };
      }
    } catch {
      // No preview then; the phone shows the file's name.
    } finally {
      if (folder) fs.rmSync(folder, { recursive: true, force: true });
    }
  }
  return image.data.length <= MAX_PREVIEW_CHARS ? { mime: image.mime, data: image.data } : null;
}

// The picture on a file card: small, since an answer can offer six files and each stays in the snapshot.
export const CARD_THUMB_SIDE = 160;
export const MAX_CARD_THUMB_CHARS = 16_000;

/**
 * A small JPEG of the first page of a PDF, a frame of a video or a picture, for its card on the phone.
 * Made by Quick Look (`qlmanage`) and `sips` on macOS, so nothing here decodes the file; elsewhere,
 * or when Quick Look has nothing, null and the phone draws the kind of file instead.
 * @returns {Promise<string | null>}  base64 JPEG
 */
export async function cardThumb(file, { run = execFileAsync, platform = process.platform } = {}) {
  if (platform !== 'darwin') return null;
  let folder = null;
  try {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-card-'));
    await run('qlmanage', ['-t', '-s', String(CARD_THUMB_SIDE * 2), '-o', folder, file], { timeout: 10_000 });
    const made = fs.readdirSync(folder).find((name) => name.endsWith('.png'));
    if (!made) return null;
    const out = path.join(folder, 'card.jpg');
    await run('sips', ['-Z', String(CARD_THUMB_SIDE), '-s', 'format', 'jpeg', '-s', 'formatOptions', '60', path.join(folder, made), '--out', out], { timeout: 10_000 });
    const data = fs.readFileSync(out).toString('base64');
    return data.length <= MAX_CARD_THUMB_CHARS && imageType(Buffer.from(data.slice(0, 24), 'base64')) === 'image/jpeg' ? data : null;
  } catch {
    return null;
  } finally {
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
  }
}

const execFileAsync = (cmd, args, options) =>
  new Promise((resolve, reject) => execFile(cmd, args, options, (err, stdout) => (err ? reject(err) : resolve(stdout))));

// A whole picture sent to the phone when asked for. Sealed and base64-encoded twice it grows about 1.8x,
// and the relay takes at most 4 MiB in one request.
export const MAX_FULL_BYTES = 2_000_000;

/**
 * An image file as the phone should get it: the file itself, or on macOS a smaller JPEG when the file
 * is too large to send.
 * @returns {{ name: string, mime: string, data: string, bytes: number, smaller: boolean }}
 * @throws {Error} with a message fit to show as it is
 */
export function fullImage(file, { max = MAX_FULL_BYTES, run = spawnSync, platform = process.platform } = {}) {
  const name = path.basename(file);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error(`${name} is no longer on the Mac.`);
  }
  if (!stat.isFile()) throw new Error(`${name} is not a file.`);
  if (stat.size > 64_000_000) throw new Error(`${name} is too large to send.`);
  const buf = fs.readFileSync(file);
  const mime = imageType(buf);
  if (!mime) throw new Error(`${name} is not a PNG, JPEG, GIF or WebP image.`);
  if (buf.length <= max) return { name, mime, data: buf.toString('base64'), bytes: buf.length, smaller: false };
  if (platform === 'darwin') {
    let folder = null;
    try {
      folder = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-full-'));
      const source = path.join(folder, `source.${mime.split('/')[1]}`);
      fs.writeFileSync(source, buf, { mode: 0o600 });
      // `sips -Z` enlarges a smaller picture too, so only sides below its own are tried.
      const probe = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', source], { timeout: 10_000, encoding: 'utf8' });
      const own = Math.max(0, ...[...String(probe.stdout ?? '').matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map((m) => Number(m[1])));
      const steps = [[0, 85], [3000, 85], [2400, 75], [1600, 65], [1200, 60]].filter(([side]) => side === 0 || !own || side < own);
      for (const [side, quality] of steps) {
        const out = path.join(folder, `full-${side}.jpg`);
        const resize = side ? ['-Z', String(side)] : [];
        const result = run('sips', [...resize, '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), source, '--out', out], { timeout: 20_000 });
        if (result.status !== 0 || !fs.existsSync(out)) break;
        const small = fs.readFileSync(out);
        if (small.length <= max && imageType(small) === 'image/jpeg') return { name: name.replace(/\.[^.]*$/, '') + '.jpg', mime: 'image/jpeg', data: small.toString('base64'), bytes: small.length, smaller: true };
      }
    } catch {
      // Falls through to the message below.
    } finally {
      if (folder) fs.rmSync(folder, { recursive: true, force: true });
    }
  }
  throw new Error(`${name} is ${kilobytes(buf.length)}, too large to send to the phone (at most ${kilobytes(max)}).`);
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
  for (const { file } of filesNamedIn(text, cwd, (name) => IMAGE_PATH.test(name))) {
    if (!found.includes(file)) found.push(file);
    if (found.length === MAX_IMAGES_PER_MESSAGE) break;
  }
  return found;
}

/** The words of a message that name a file that exists: where each is, and whether it was written with quotes or escapes. */
function* filesNamedIn(text, cwd, wanted = () => true) {
  for (const m of String(text).matchAll(/"([^"\n]+)"|'([^'\n]+)'|((?:\\.|[^\s"'\\])+)/g)) {
    let candidate = m[1] ?? m[2] ?? m[3].replace(/\\(.)/g, '$1');
    candidate = candidate.replace(/^@/, '').replace(/^file:\/\//, '');
    // A path at the end of a sentence drags its punctuation along.
    if (!wanted(candidate) || !exists(candidate, cwd)) candidate = candidate.replace(/[.,;:!?)\]]+$/, '');
    if (!wanted(candidate)) continue;
    const file = exists(candidate, cwd);
    if (file) yield { file, at: m.index, written: m[0], plain: m[3] !== undefined && !m[3].includes('\\') };
  }
}

/** The absolute path of `candidate` if it is a file on this machine. */
function exists(candidate, cwd) {
  if (candidate === '~' || candidate.startsWith('~/')) candidate = path.join(os.homedir(), candidate.slice(1));
  const file = path.resolve(cwd, candidate);
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null; // not a file on this machine: it stays ordinary text
  }
}

const VIDEO_PATH = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

/**
 * Text that is nothing but the paths of files that exist (one or more files dragged into the terminal),
 * with a short name for each to show in the message box instead: [image.png], [video.mp4], [file.pdf].
 * `taken` are names already in use, so that a second picture is [image 2.png]. Null for anything else,
 * such as a path inside a sentence that was pasted.
 * @returns {{ text: string, files: { token: string, written: string }[] } | null}
 */
export function compactDropped(text, cwd, taken = new Set()) {
  const source = String(text);
  if (!source.trim()) return null;
  const files = [];
  let rest = '';
  let at = 0;
  const used = new Set(taken);
  for (const { file, at: start, written } of filesNamedIn(source, cwd)) {
    rest += source.slice(at, start);
    at = start + written.length;
    const ext = path.extname(file).slice(1).toLowerCase();
    const kind = IMAGE_PATH.test(file) ? 'image' : VIDEO_PATH.test(file) ? 'video' : 'file';
    let token;
    for (let n = 1; !token || used.has(token); n++) token = `[${kind}${n > 1 ? ` ${n}` : ''}${ext ? `.${ext}` : ''}]`;
    used.add(token);
    files.push({ token, written, start: start, end: at });
  }
  rest += source.slice(at);
  if (!files.length || rest.trim()) return null;
  let out = '';
  let from = 0;
  for (const f of files) {
    out += source.slice(from, f.start) + f.token;
    from = f.end;
  }
  return { text: out + source.slice(from), files: files.map(({ token, written }) => ({ token, written })) };
}

/** Whether a message opens with the path of a file that exists — a file dragged into the terminal, not a /command. */
export function startsWithFile(text, cwd) {
  const { value } = filesNamedIn(String(text).trimStart(), cwd).next();
  return Boolean(value && value.at === 0);
}

/**
 * Files other than pictures that a message names the way a terminal types a dragged file: with
 * escaped spaces or in quotes. A model reads `Report\ 2026.pdf` as a name with backslashes in it,
 * so the message is given their plain paths as well.
 */
export function draggedFilesIn(text, cwd) {
  const found = [];
  for (const { file, plain } of filesNamedIn(text, cwd, (name) => !IMAGE_PATH.test(name))) if (!plain && !found.includes(file)) found.push(file);
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
