// Files in the phone timeline: cards for what the phone sent and what an answer offers, and what a
// preview can show — the list a zip holds, read without unpacking it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PHONE_FILES as MAC_MARKER } from '../src/commands.mjs';
import { PHONE_FILES, fileKind, folderOf, listZip, previewKind, splitName, splitSent, zipDirectory } from '../remote-server/public/files.js';

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
  assert.match(app, /startDownload\(state\.view\.ws, item\.id, index, f\.name, f\.file\)/, 'a sent file is fetched back from the Mac to check it');
  const css = read('style.css');
  assert.match(css, /\.fcard\.up \.fdir \{[^}]*var\(--sk-user\)/, 'sent: cyan');
  assert.match(css, /\.fcard\.down \.fdir \{[^}]*var\(--sk-primary\)/, 'offered: orange');
});
