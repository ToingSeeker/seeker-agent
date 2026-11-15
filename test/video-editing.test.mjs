// The bundled video-editing skill: its script really edits video. These run where ffmpeg and
// python3 are installed, on small clips made for the purpose, and are skipped elsewhere.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSkills } from '../src/skills.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(REPO, 'skills', 'video-editing', 'scripts', 'vedit.py');
const has = (program, args = ['-version']) => spawnSync(program, args, { stdio: 'ignore' }).status === 0;
const tools = has('ffmpeg') && has('ffprobe') && has('python3', ['--version']);
const pillow = tools && has('python3', ['-c', 'import PIL']);
const skip = !tools && 'needs ffmpeg and python3';

const dir = tools ? fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-vedit-')) : null;
const at = (name) => path.join(dir, name);
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });
/** Runs the script and returns the JSON it printed. */
const vedit = (...args) => {
  const out = spawnSync('python3', [SCRIPT, ...args], { encoding: 'utf8' });
  const line = out.stdout.trim().split('\n').at(-1);
  try {
    return { ...JSON.parse(line), code: out.status };
  } catch {
    return { ok: false, error: `not JSON: ${out.stdout}${out.stderr}`, code: out.status };
  }
};

test('video-editing: the skill ships with SEEKER and names its script', () => {
  const skill = loadSkills(os.tmpdir(), []).find((s) => s.name === 'video-editing');
  assert.equal(skill?.source, 'bundled');
  assert.ok(fs.existsSync(path.join(skill.dir, 'scripts', 'vedit.py')), 'the script the instructions point to is there');
  assert.match(skill.body, /scripts\/vedit\.py/);
  for (const command of ['trim', 'concat', 'reframe', 'speed', 'silence', 'captions', 'text', 'audio normalize', 'audio mix', 'gif', 'compress', 'frames']) assert.ok(skill.body.includes(command), `the instructions cover ${command}`);
});

test('video-editing: cut, join, reshape and speed give a file of the length and size asked for', { skip }, () => {
  // Four seconds, landscape, a tone with one second of silence in the middle; and a short silent portrait clip.
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-af', "volume='if(between(t,1.5,2.5),0,1)':eval=frame", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', at('a.mp4'));
  ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=25:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', at('b.mp4'));

  const info = vedit('info', at('a.mp4'));
  assert.deepEqual([info.width, info.height, info.fps, info.has_audio, Math.round(info.duration)], [320, 180, 30, true, 4]);

  const cut = vedit('trim', at('a.mp4'), at('cut.mp4'), '--start', '1', '--end', '2.5');
  assert.equal(cut.ok, true);
  assert.ok(Math.abs(cut.duration - 1.5) < 0.15, `1.5s asked, ${cut.duration}s made`);

  const joined = vedit('concat', at('joined.mp4'), at('a.mp4'), at('b.mp4'));
  assert.deepEqual([joined.ok, joined.width, joined.height, joined.has_audio, joined.joined], [true, 320, 180, true, 2]);
  assert.ok(Math.abs(joined.duration - 6) < 0.2, 'the lengths add up, and the silent clip did not break the sound');

  const tall = vedit('reframe', at('a.mp4'), at('tall.mp4'), '--aspect', '9:16', '--mode', 'blur', '--height', '640');
  assert.deepEqual([tall.ok, tall.width, tall.height], [true, 360, 640]);
  const square = vedit('reframe', at('a.mp4'), at('square.mp4'), '--aspect', '1:1', '--height', '360');
  assert.deepEqual([square.width, square.height], [360, 360]);

  const fast = vedit('speed', at('a.mp4'), at('fast.mp4'), '--factor', '2');
  assert.ok(Math.abs(fast.duration - 2) < 0.15 && fast.has_audio);
});

test('video-editing: pauses are found and cut, sound is levelled and mixed, and a size is aimed at', { skip }, () => {
  const found = vedit('silence', at('a.mp4'), '--report');
  assert.equal(found.silences.length, 1);
  assert.ok(Math.abs(found.silences[0][0] - 1.5) < 0.1 && Math.abs(found.silences[0][1] - 2.5) < 0.1, JSON.stringify(found.silences));
  const tight = vedit('silence', at('a.mp4'), at('tight.mp4'));
  assert.equal(tight.ok, true);
  assert.ok(tight.duration < 3.5 && tight.duration > 2.9, `about a second less: ${tight.duration}`);
  assert.equal(fs.existsSync(at('report-only.mp4')), false);

  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', at('music.mp3'));
  assert.equal(vedit('audio', 'normalize', at('a.mp4'), at('level.mp4')).ok, true);
  const mixed = vedit('audio', 'mix', at('a.mp4'), at('mixed.mp4'), '--music', at('music.mp3'), '--duck');
  assert.ok(mixed.ok && Math.abs(mixed.duration - 4) < 0.15, 'the music loops to the clip\'s length and stops with it');
  const scored = vedit('audio', 'mix', at('b.mp4'), at('scored.mp4'), '--music', at('music.mp3'));
  assert.deepEqual([scored.ok, scored.has_audio], [true, true], 'a silent clip gets the music as its sound');
  assert.equal(vedit('audio', 'extract', at('a.mp4'), at('a.wav')).ok, true);

  const small = vedit('compress', at('a.mp4'), at('small.mp4'), '--max-mb', '0.15');
  assert.ok(small.ok && small.size_mb <= 0.16, `aimed at 0.15 MB, made ${small.size_mb}`);
  const gif = vedit('gif', at('a.mp4'), at('a.gif'), '--duration', '1', '--width', '160');
  assert.ok(gif.ok && fs.statSync(at('a.gif')).size > 0);
  const shots = vedit('frames', at('a.mp4'), at('shots'), '--at', '0.5,3');
  assert.equal(shots.frames.length, 2);
  assert.ok(shots.frames.every((f) => fs.statSync(f).size > 0));
});

test('video-editing: captions and a title are burned into the picture', { skip: skip || (!pillow && 'needs Pillow') }, () => {
  fs.writeFileSync(at('a.srt'), '1\n00:00:00,500 --> 00:00:01,500\nFirst caption\n\n2\n00:00:02,500 --> 00:00:03,500\nSecond,\non two lines\n');
  const captioned = vedit('captions', at('a.mp4'), at('captioned.mp4'), '--srt', at('a.srt'));
  assert.deepEqual([captioned.ok, captioned.cues, captioned.width, captioned.has_audio], [true, 2, 320, true]);
  assert.ok(Math.abs(captioned.duration - 4) < 0.15, 'the clip keeps its length');
  // The picture differs from the source where a caption is shown, and not in between.
  const frame = (file, t) => (vedit('frames', file, at(`${path.basename(file)}-${t}.png`), '--at', String(t), '--force'), fs.readFileSync(at(`${path.basename(file)}-${t}.png`)));
  assert.notDeepEqual(frame(at('captioned.mp4'), 1), frame(at('a.mp4'), 1), 'words are on the picture during a caption');
  const titled = vedit('text', at('a.mp4'), at('titled.mp4'), '--text', 'Chapter one', '--start', '0', '--end', '1');
  assert.deepEqual([titled.ok, titled.cues], [true, 1]);
  assert.match(vedit('captions', at('a.mp4'), at('x.mp4'), '--srt', at('a.mp4')).error, /no captions in \.srt form/);
});

test('video-editing: a mistake is said in one line, and the source is never written over', { skip }, () => {
  const before = fs.statSync(at('a.mp4')).mtimeMs;
  assert.match(vedit('trim', at('a.mp4'), at('a.mp4'), '--start', '1').error, /output is the input file/);
  assert.match(vedit('trim', at('a.mp4'), at('cut.mp4'), '--start', '1').error, /already exists/);
  assert.equal(vedit('trim', at('a.mp4'), at('cut.mp4'), '--start', '1', '--end', '2', '--force').ok, true);
  assert.match(vedit('trim', at('a.mp4'), at('n.mp4'), '--start', '9').error, /4\.\d*s long; it cannot start at 9/);
  assert.match(vedit('trim', at('missing.mp4'), at('n.mp4')).error, /There is no file at/);
  assert.match(vedit('reframe', at('a.mp4'), at('n.mp4'), '--aspect', 'wide').error, /written like 9:16/);
  assert.match(vedit('silence', at('b.mp4'), at('n.mp4')).error, /has no sound/);
  assert.match(vedit('concat', at('a.mp4'), at('a.mp4'), at('b.mp4'), '--force').error, /one of the input files/);
  assert.match(vedit('compress', at('a.mp4'), at('n.mp4'), '--max-mb', '0.001').error, /too small/);
  assert.equal(vedit('trim', at('a.mp4'), at('n.mp4'), '--start', 'soon').code, 1);
  assert.equal(fs.existsSync(at('n.mp4')), false, 'a refused edit leaves nothing behind');
  assert.equal(fs.statSync(at('a.mp4')).mtimeMs, before, 'the source was not touched');
  // --dry-run prints the command and makes nothing.
  const dry = spawnSync('python3', [SCRIPT, 'trim', at('a.mp4'), at('dry.mp4'), '--start', '1', '--end', '2', '--dry-run'], { encoding: 'utf8' });
  assert.match(dry.stdout, /^ffmpeg .* -ss 1\.000 /);
  assert.equal(fs.existsSync(at('dry.mp4')), false);
});
