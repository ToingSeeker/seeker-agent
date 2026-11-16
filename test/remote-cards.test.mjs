// What the Mac sends with a file an answer offers, for its card on the phone: when it changed, how
// long a video plays (read from the file's own header) and a small picture of it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cardThumb } from '../src/images.mjs';
import { keepRecentPreviews } from '../src/remote.mjs';
import { cardFacts, mediaDuration } from '../src/transfer.mjs';

const box = (type, ...body) => {
  const data = Buffer.concat(body);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + data.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, data]);
};

/** An `mvhd` box: version 0 keeps times in 32 bits, version 1 in 64. */
function mvhd(scale, duration, version = 0) {
  if (version === 1) {
    const b = Buffer.alloc(4 + 8 + 8 + 4 + 8);
    b[0] = 1;
    b.writeUInt32BE(scale, 20);
    b.writeBigUInt64BE(BigInt(duration), 24);
    return box('mvhd', b);
  }
  const b = Buffer.alloc(4 + 4 + 4 + 4 + 4);
  b.writeUInt32BE(scale, 12);
  b.writeUInt32BE(duration, 16);
  return box('mvhd', b);
}

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-cards-'));

test('cards: a video says how long it plays, from its movie header wherever that is in the file', () => {
  const dir = scratch();
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isom'));
  // Header first (a file made for streaming).
  fs.writeFileSync(path.join(dir, 'start.mp4'), Buffer.concat([ftyp, box('moov', mvhd(1000, 8000)), box('mdat', Buffer.alloc(64))]));
  assert.equal(mediaDuration(path.join(dir, 'start.mp4')), 8);
  // Header last, after the media, the way most cameras write it; and with a 64-bit header.
  fs.writeFileSync(path.join(dir, 'end.mov'), Buffer.concat([ftyp, box('mdat', Buffer.alloc(5000)), box('moov', box('udta'), mvhd(600, 7230, 1))]));
  assert.equal(mediaDuration(path.join(dir, 'end.mov')), 12.05);
  // Nothing to read: no length is made up.
  fs.writeFileSync(path.join(dir, 'none.mp4'), Buffer.concat([ftyp, box('mdat', Buffer.alloc(16))]));
  assert.equal(mediaDuration(path.join(dir, 'none.mp4')), null);
  fs.writeFileSync(path.join(dir, 'junk.mp4'), Buffer.from('not a movie at all'));
  assert.equal(mediaDuration(path.join(dir, 'junk.mp4')), null);
  fs.writeFileSync(path.join(dir, 'zero.mp4'), Buffer.concat([ftyp, box('moov', mvhd(0, 100))]));
  assert.equal(mediaDuration(path.join(dir, 'zero.mp4')), null, 'a zero time scale is not a length');
  assert.equal(mediaDuration(path.join(dir, 'missing.mp4')), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cards: facts for a card add the change time, a video length and a picture, and leave out what is unknown', async () => {
  const dir = scratch();
  const video = path.join(dir, 'clip.mp4');
  fs.writeFileSync(video, Buffer.concat([box('ftyp', Buffer.from('isom')), box('moov', mvhd(1000, 12400))]));
  const zip = path.join(dir, 'a.zip');
  fs.writeFileSync(zip, 'PK');
  const asked = [];
  const thumb = async (file) => (asked.push(path.basename(file)), file === video ? '/9j/thumb' : null);
  const v = await cardFacts({ name: 'clip.mp4', mime: 'video/mp4', bytes: 10, file: video }, thumb);
  assert.equal(v.duration, 12.4);
  assert.equal(v.thumb, '/9j/thumb');
  assert.equal(typeof v.modified, 'number');
  assert.equal(v.name, 'clip.mp4', 'what the card had stays');
  const z = await cardFacts({ name: 'a.zip', mime: 'application/zip', bytes: 2, file: zip }, thumb);
  assert.equal('thumb' in z, false);
  assert.equal('duration' in z, false);
  assert.deepEqual(asked, ['clip.mp4'], 'a zip is not given a picture');
  const gone = await cardFacts({ name: 'g.pdf', mime: 'application/pdf', bytes: 2, file: path.join(dir, 'gone.pdf') }, async () => null);
  assert.equal('modified' in gone, false, 'a file that went is not given a date');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cards: the picture is made by Quick Look on macOS only, and never by decoding the file here', async () => {
  assert.equal(await cardThumb('/x/a.pdf', { platform: 'linux', run: () => assert.fail('nothing runs off macOS') }), null);
  const calls = [];
  const run = async (cmd, args) => {
    calls.push(cmd);
    if (cmd === 'qlmanage') fs.writeFileSync(path.join(args[args.indexOf('-o') + 1], 'a.pdf.png'), 'png');
    // A small JPEG, as sips writes it.
    if (cmd === 'sips') fs.writeFileSync(args[args.length - 1], Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]));
  };
  const data = await cardThumb('/x/a.pdf', { platform: 'darwin', run });
  assert.deepEqual(calls, ['qlmanage', 'sips']);
  assert.ok(data.startsWith('/9j/'), 'a JPEG');
  assert.equal(await cardThumb('/x/a.pdf', { platform: 'darwin', run: async () => {} }), null, 'Quick Look made nothing');
  assert.equal(await cardThumb('/x/a.pdf', { platform: 'darwin', run: async () => { throw new Error('timed out'); } }), null);
});

test('cards: a long session keeps the pictures of the last answers only; the files themselves stay', () => {
  const items = [];
  for (let i = 0; i < 20; i++) items.push({ id: `a${i}`, kind: 'assistant', text: 'x', files: [{ name: `f${i}.pdf`, file: `/t/f${i}.pdf`, mime: 'application/pdf', bytes: 1, thumb: '/9j/x' }] });
  keepRecentPreviews(items);
  const withPicture = items.filter((i) => i.files[0].thumb).map((i) => i.id);
  assert.equal(withPicture.length, 12);
  assert.equal(withPicture[0], 'a8', 'the newest keep theirs');
  assert.ok(items.every((i) => i.files[0].file && i.files[0].name), 'every card still opens its file');
});
