// Files in the phone timeline: cards for what the phone sent and what an answer offers, and what a
// preview can show — the list a zip holds, read without unpacking it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PHONE_FILES as MAC_MARKER } from '../src/commands.mjs';
import { PHONE_FILES, cardPicture, fileKind, filesSummary, folderOf, listZip, pdfPages, plainName, playTime, previewKind, splitName, splitSent, typeName, zipDirectory } from '../remote-server/public/files.js';

const read = (file) => fs.readFileSync(new URL(`../remote-server/public/${file}`, import.meta.url), 'utf8');

/** A zip of stored (uncompressed) files, written by hand: local headers, the central directory, the end record. */
function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

test('files: the phone reads the list under a sent message with the words the Mac writes', () => {
  assert.equal(PHONE_FILES, MAC_MARKER, 'the marker must match src/commands.mjs');
  const text = `buat landing page\n\n${PHONE_FILES}\n- /Users/me/Downloads/SEEKER/Seeker_Agent_Website_Source.zip (19 KB)\n- /Users/me/Downloads/SEEKER/my clip (2).mp4 (2.4 MB)`;
  const { said, listed } = splitSent(text);
  assert.equal(said, 'buat landing page', 'the list is not repeated under the words');
  assert.deepEqual(listed, [
    { name: 'Seeker_Agent_Website_Source.zip', path: '/Users/me/Downloads/SEEKER/Seeker_Agent_Website_Source.zip', size: '19 KB' },
    { name: 'my clip (2).mp4', path: '/Users/me/Downloads/SEEKER/my clip (2).mp4', size: '2.4 MB' },
  ]);
  assert.deepEqual(splitSent('just words'), { said: 'just words', listed: [] });
});

test('files: a card keeps the extension of a long name, and says what kind and where', () => {
  assert.deepEqual(splitName('seeker-landing-page-final.zip'), { stem: 'seeker-landing-page-final', ext: '.zip' });
  assert.deepEqual(splitName('Makefile'), { stem: 'Makefile', ext: '' });
  assert.deepEqual(splitName('.env'), { stem: '.env', ext: '' });
  assert.deepEqual(fileKind('a.zip'), { tone: 'zip', label: 'ZIP' });
  assert.deepEqual(fileKind('hero.mp4'), { tone: 'video', label: 'MP4' });
  assert.deepEqual(fileKind('index.html'), { tone: 'code', label: 'HTML' });
  assert.deepEqual(fileKind('notes.markdown'), { tone: 'text', label: 'MARK' });
  assert.deepEqual(fileKind('report.docx'), { tone: 'other', label: 'DOCX' });
  assert.deepEqual(fileKind('README'), { tone: 'other', label: 'FILE' });
  assert.equal(folderOf('/Users/me/Downloads/SEEKER/a.zip'), 'Downloads/SEEKER');
  assert.equal(folderOf(undefined), '');
});

test('files: a preview shows media, PDFs, text as text, and zips as their list', () => {
  assert.equal(previewKind('video/mp4'), 'video');
  assert.equal(previewKind('image/png'), 'image');
  assert.equal(previewKind('image/heic'), null, 'not every picture can be drawn');
  assert.equal(previewKind('application/pdf'), 'pdf');
  assert.equal(previewKind('application/zip', 'a.zip'), 'zip');
  assert.equal(previewKind('', 'a.zip'), 'zip');
  assert.equal(previewKind('text/html', 'page.html'), 'text', 'a page is shown as its text, never run');
  assert.equal(previewKind('', 'app.ts'), 'text');
  assert.equal(previewKind('application/octet-stream', 'report.docx'), null);
});

test('files: what a zip holds is read from its directory, Mac clutter left out', async () => {
  const zip = makeZip([
    ['site/', ''],
    ['site/index.html', '<h1>hi</h1>'],
    ['__MACOSX/site/._index.html', 'x'],
    ['site/.DS_Store', 'x'],
    ['site/app.js', 'console.log(1)'],
  ]);
  const listed = await listZip(new Blob([zip]));
  assert.equal(listed.count, 5);
  assert.deepEqual(listed.entries, [
    { name: 'site/', bytes: 0, folder: true },
    { name: 'site/index.html', bytes: 11, folder: false },
    { name: 'site/app.js', bytes: 14, folder: false },
  ]);
  assert.equal(await listZip(new Blob([Buffer.from('not a zip at all')])), null);
  assert.equal(zipDirectory(new Uint8Array(10)), null);
});

test('files: cards replace the raw list in the timeline, and a waiting file opens before it is sent', () => {
  const app = read('app.js');
  assert.match(app, /const \{ said, listed \} = splitSent\(item\.text\)/);
  assert.match(app, /sentFiles\(item, listed\)/);
  assert.match(app, /onclick: \(\) => previewWaiting\(a\)/, 'a file waiting in the composer can be checked');
  assert.match(app, /fileRow\(f, known && f\.mime \? \{ kind: 'download', ws: state\.view\.ws, item: item\.id, index,/, 'a sent file is fetched back from the Mac to check it');
  const css = read('style.css');
  assert.match(css, /\.frow\.up \.fact\.still \{[^}]*var\(--sk-user\)/, 'sent: cyan');
  assert.match(css, /\.fact \{[^}]*var\(--sk-primary\)/, 'offered: orange');
});

test('files: a card says what a file is in words, and a video how long it plays', () => {
  assert.equal(typeName('application/pdf', 'a.pdf'), 'PDF Document');
  assert.equal(typeName('image/jpeg', 'a.jpg'), 'JPEG Image');
  assert.equal(typeName('image/png', 'IMG_3767.png'), 'PNG Image');
  assert.equal(typeName('video/mp4', 'a.mp4'), 'MP4 Video');
  assert.equal(typeName(null, 'photo.heic'), 'HEIC Image', 'from the name when the Mac gave no type');
  assert.equal(typeName(null, 'notes.md'), 'MD File');
  assert.equal(typeName(null, 'README'), 'File');
  assert.equal(playTime(8), '0:08');
  assert.equal(playTime(12.4), '0:12');
  assert.equal(playTime(3725), '1:02:05');
  for (const unknown of [0, -1, NaN, undefined, 'x']) assert.equal(playTime(unknown), '', 'no length is made up');
});

test('files: GENERATED FILES counts the files, and adds their size only when every size is known', () => {
  const size = (b) => `${b} B`;
  assert.equal(filesSummary([{ bytes: 16000 }, { bytes: 30000 }, { bytes: 3213330 }], size), '3 files · 3259330 B');
  assert.equal(filesSummary([{ bytes: 10 }, {}], size), '2 files');
  assert.equal(filesSummary([{ bytes: 10 }], size), '1 file · 10 B');
  assert.equal(filesSummary(null, size), '0 files');
});

test('files: a PDF counts its pages from its page tree, and says nothing when it cannot tell', () => {
  assert.equal(pdfPages('1 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj'), 2);
  assert.equal(pdfPages('<< /Count 7 /Kids [1 0 R] /Type /Pages >>'), 7, 'in either order');
  assert.equal(pdfPages('<< /Type /Pages /Count 3 >> << /Type /Pages /Count 12 >>'), 12, 'the root holds them all');
  assert.equal(pdfPages('<< /Type /Page /Parent 1 0 R >>'), null);
  assert.equal(pdfPages('%PDF-1.7 compressed object streams'), null);
  const minimal = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [ 3 0 R ]\n/Count 1\n>>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF';
  assert.equal(pdfPages(minimal), 1, 'across lines, as most writers put it');
});

test('files: a card shows the Mac’s picture only if it is a small JPEG', () => {
  assert.equal(cardPicture('/9j/4AAQSkZJRg=='), '/9j/4AAQSkZJRg==');
  assert.equal(cardPicture('iVBORw0KGgo='), null, 'not a JPEG');
  assert.equal(cardPicture('/9j/"><script>'), null, 'not base64');
  assert.equal(cardPicture(`/9j/${'A'.repeat(20_000)}`), null, 'too large');
  assert.equal(cardPicture(undefined), null);
});

test('files: a file card opens the file and its button only saves it, each its own button', () => {
  const app = read('app.js');
  const fn = (name) => app.slice(app.indexOf(`function ${name}(`), app.indexOf('\n}\n', app.indexOf(`function ${name}(`)));
  const row = fn('fileRow');
  assert.match(row, /class: 'fopen'[^]*onclick: open/, 'the row opens the preview');
  assert.match(row, /fileAction\(src\)/, 'the button is separate');
  const action = fn('fileAction');
  for (const state of ["'fact busy'", "'fact saved'", "'fact gone'", "'fact failed'", '`Save ${name} on this phone`']) assert.ok(action.includes(state), state);
  assert.doesNotMatch(action, /Math\.random|setInterval/, 'progress is the bytes that arrived, never made up');
  assert.match(fn('progressBlock'), /share == null \? 'Fetching from your Mac…'/, 'no total, no percentage');
  // "Saved on this phone" only once the file reads back from the phone's storage.
  assert.match(fn('previewStatus'), /if \(shown\?\.saved\)/);
  assert.match(app, /saved: outcome\.ok/);
  const css = read('style.css');
  assert.match(css, /\.fpv-media \{[^}]*object-fit: contain/, 'the preview never crops');
});

test('files: the phone asks the Mac by message and place, never by path', () => {
  const app = read('app.js');
  assert.match(app, /command\('download', \{ ws: src\.ws, item: src\.item, index: src\.index, req \}/);
  assert.match(app, /command\('file', \{ ws: src\.ws, item: src\.item, index: src\.index, req \}/);
  assert.doesNotMatch(app, /command\('(download|file)', \{[^}]*(where|path|file:)/);
});

test('files: the relay lets the app frame a PDF it made itself, and nothing else gets looser', async () => {
  const { createRelay } = await import('../remote-server/server.mjs');
  const relay = createRelay({ authHash: 'a'.repeat(64) });
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${relay.address().port}/`);
    const csp = Object.fromEntries(res.headers.get('content-security-policy').split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ')]));
    assert.equal(csp['frame-src'], 'blob:', 'only a blob this page made, never another site');
    assert.equal(csp['script-src'], "'self'", 'a framed blob cannot run script: it inherits this');
    // A blob takes the page's policy with it: with 'none' even the app could not frame its own PDF
    // (WebKit, so the iPhone, refuses it). 'self' still keeps every other site from framing the app.
    assert.equal(csp['frame-ancestors'], "'self'", 'never framed by another site');
    assert.equal(csp['default-src'], "'self'");
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    relay.close();
  }
  const app = read('app.js');
  const inner = app.slice(app.indexOf('function previewInner('), app.indexOf('\n}\n', app.indexOf('function previewInner(')));
  assert.match(inner, /if \(magic !== '%PDF-'\) return broken/, 'framed only when its bytes say PDF, not its name');
  assert.ok(inner.indexOf("magic !== '%PDF-'") < inner.indexOf("h('iframe'"));
});

test('files: a name the phone made up is shown as image, video or file; one a person chose stays', () => {
  const uuid = '4BD7DFEC-C21C-43DC-89B7-837E1F902F06';
  assert.equal(plainName(`${uuid}.png`, 'image/png'), 'image.png');
  assert.equal(plainName(`${uuid}.png`, 'image/jpeg'), 'image.jpg', 'the extension follows what is really sent');
  assert.equal(plainName(`${uuid}.mp4`, ''), 'video.mp4');
  assert.equal(plainName(`${uuid}.MOV`, 'video/quicktime'), 'video.mov');
  assert.equal(plainName('1731900000000.pdf', 'application/pdf'), 'file.pdf');
  assert.equal(plainName('d41d8cd98f00b204e9800998ecf8427e.zip', ''), 'file.zip');
  assert.equal(plainName('20261118_115300.jpg', 'image/jpeg'), 'image.jpg');
  for (const kept of ['IMG_3792.jpg', 'Proposal final.pdf', '2026-11-18.pdf', 'clip.mp4']) assert.equal(plainName(kept, ''), kept);
  // Every place the phone shows or saves a name goes through it: attaching, the timeline, cards, previews, files kept here.
  const app = read('app.js');
  for (const used of ["name: plainName(file.name, data === original ? file.type : 'image/jpeg')", 'const named = plainName(file.name, file.type);', 'name: plainName(sent.name, sent.mime)', 'name: plainName(given.name, given.mime)', 'plainName(f.name ?? src.name, f.mime ?? src.mime)', 'name: plainName(kept.name, kept.type)', 'new File(parts, plainName(event.name, event.mime)'])
    assert.ok(app.includes(used), used);
});
