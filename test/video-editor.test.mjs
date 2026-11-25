// The bundled video-editor skill: its refcut script measures a reference edit, rebuilds it and checks
// the match. The maths runs anywhere python3 is; the video round trip runs where ffmpeg is, on small
// clips made for the purpose, and is skipped elsewhere.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSkills } from '../src/skills.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(REPO, 'skills', 'video-editor', 'scripts');
const SCRIPT = path.join(DIR, 'refcut.py');
const has = (program, args = ['-version']) => spawnSync(program, args, { stdio: 'ignore' }).status === 0;
const py = has('python3', ['--version']);
const tools = py && has('ffmpeg') && has('ffprobe');

// Run a Python expression against the module and return its JSON value.
function calc(expr) {
  const code = `import sys, json; sys.path.insert(0, ${JSON.stringify(DIR)}); import refcut as r; print(json.dumps(${expr}))`;
  return JSON.parse(execFileSync('python3', ['-c', code], { encoding: 'utf8' }));
}
function refcut(...args) {
  const out = spawnSync('python3', [SCRIPT, ...args], { encoding: 'utf8' });
  const line = out.stdout.trim().split('\n').pop();
  return { code: out.status, json: line ? JSON.parse(line) : null, stderr: out.stderr };
}

test('video-editor: the skill ships with SEEKER and names its script', () => {
  const skill = loadSkills(os.tmpdir(), []).find((s) => s.name === 'video-editor');
  assert.equal(skill?.source, 'bundled');
  assert.ok(fs.existsSync(SCRIPT));
  assert.match(skill.body, /refcut\.py/);
  assert.ok(skill.description.length <= 300, `description is ${skill.description.length} chars`);
  assert.match(skill.description, /TikTok/);
  assert.match(skill.description, /reference/i);
});

test('video-editor: shots come from cuts, flashes are dropped, pacing is measured', { skip: !py && 'needs python3' }, () => {
  assert.deepEqual(calc('r.shots_from_cuts([1.5, 1.6, 4.0], 6.0)'), [[0, 1.5], [1.5, 4], [4, 6]]);
  const p = calc('r.pacing([(0, 1.5), (1.5, 2.5), (2.5, 4.5), (4.5, 6.0)])');
  assert.equal(p.shots, 4);
  assert.equal(p.asl, 1.5);
  assert.equal(p.first_cut, 1.5);
  assert.equal(p.cuts_per_minute, 30);
  assert.deepEqual(p.cuts_per_window.counts, [3, 0]);
});

test('video-editor: Lab conversion round-trips and the look transfer moves statistics', { skip: !py && 'needs python3' }, () => {
  const back = calc('[round(c * 255) for c in r.lab_to_rgb(*r.rgb_to_lab(200, 120, 40))]');
  assert.deepEqual(back, [200, 120, 40]);
  const white = calc('[round(v, 1) for v in r.rgb_to_lab(255, 255, 255)]');
  assert.equal(white[0], 100);
  const src = '{"L_mean":50,"L_std":10,"a_mean":0,"a_std":5,"b_mean":0,"b_std":5}';
  const dst = '{"L_mean":60,"L_std":20,"a_mean":5,"a_std":5,"b_mean":-10,"b_std":5}';
  assert.deepEqual(calc(`[round(v, 3) for v in r.transfer((50, 0, 0), ${src}, ${dst})]`), [60, 5, -10]);
  assert.deepEqual(calc(`[round(v, 3) for v in r.transfer((50, 0, 0), ${src}, ${dst}, 0.5)]`), [55, 2.5, -5]);
  // a 2-point LUT has the header and 8 entries, red varying fastest
  const lut = calc(`r.cube_lut(${src}, ${src}, 2)`).trim().split('\n');
  assert.equal(lut[1], 'LUT_3D_SIZE 2');
  assert.equal(lut.length, 4 + 8);
  assert.deepEqual(lut[5].split(' ').map(Number).map(Math.round), [1, 0, 0]);
  assert.ok(calc('r.describe_look({"L_mean":30,"L_std":30,"a_mean":0,"b_mean":-8,"chroma_mean":8})').includes('cool / blue'));
});

test('video-editor: tempo, beat alignment and snapping', { skip: !py && 'needs python3' }, () => {
  // a click every 0.5 s on the 100-per-second envelope is 120 BPM
  const t = calc('r.tempo([1.0 if i % 50 == 0 else 0.0 for i in range(1000)])');
  assert.equal(t.bpm, 120);
  assert.equal(t.beats[1] - t.beats[0], 0.5);
  assert.deepEqual(calc('r.pick_onsets([1.0 if i % 50 == 0 else 0.0 for i in range(300)])'), [0, 0.5, 1, 1.5, 2, 2.5]);
  assert.equal(calc('r.cut_alignment([0.5, 1.03, 1.7], [0.5, 1.0, 1.5, 2.0])'), 0.667);
  assert.deepEqual(calc('r.snap([0.55, 1.9, 1.95], [0.5, 1.0, 1.5, 2.0])'), [0.5, 2.0, 2.2]);
  assert.deepEqual(calc('r.timing_error([1.0, 2.0], [1.02, 2.1])'), { mean: 0.06, worst: 0.1 });
  assert.equal(calc('r.delta_e({"L_mean":50,"a_mean":0,"b_mean":0}, {"L_mean":53,"a_mean":4,"b_mean":0})'), 5);
});

test('video-editor: a reference is measured, rebuilt from other footage and matches on timing', { skip: !tools && 'needs ffmpeg and python3' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-refcut-'));
  const at = (n) => path.join(dir, n);
  const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });
  // reference: four shots of 1.5 / 1.0 / 2.0 / 1.5 s over a click track at 120 BPM
  ff('-f', 'lavfi', '-i', 'color=c=0xc04020:size=320x180:rate=30:duration=1.5', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1.0',
    '-f', 'lavfi', '-i', 'color=c=0x2040c0:size=320x180:rate=30:duration=2.0', '-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=30:duration=1.5',
    '-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*1000*t)*lt(mod(t\\,0.5)\\,0.03)':s=48000:d=6",
    '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,format=yuv420p[v]', '-map', '[v]', '-map', '4:a',
    '-c:v', 'libx264', '-c:a', 'aac', '-shortest', at('ref.mp4'));
  ff('-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=8',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', at('a.mp4'));
  ff('-f', 'lavfi', '-i', 'mandelbrot=size=320x240:rate=30', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', at('b.mp4'));

  const an = refcut('analyze', at('ref.mp4'), '--out', at('ref.json'), '--stills', at('stills'));
  assert.equal(an.json.ok, true, an.stdout);
  assert.equal(an.json.shots, 4);
  assert.equal(an.json.first_cut, 1.5);
  assert.equal(an.json.tempo_bpm, 120);
  assert.equal(an.json.cuts_on_beat, 1);
  assert.equal(fs.readdirSync(at('stills')).length, 4);

  const lut = refcut('lut', at('ref.json'), at('look.cube'), '--from', at('a.mp4'), at('b.mp4'));
  assert.equal(lut.json.ok, true);
  assert.match(fs.readFileSync(at('look.cube'), 'utf8'), /^LUT_3D_SIZE 33$/m);

  const plan = refcut('plan', at('ref.json'), at('plan.json'), '--footage', at('a.mp4'), at('b.mp4'), '--keep-audio', '--lut', at('look.cube'));
  assert.equal(plan.json.segments, 4);
  const rendered = refcut('render', at('plan.json'), at('out.mp4'));
  assert.equal(rendered.json.ok, true, rendered.stderr);
  assert.equal(rendered.json.duration, 6);
  assert.equal(rendered.json.fps, 30);
  assert.equal(rendered.json.has_audio, true);

  const cmp = refcut('compare', at('ref.json'), at('out.mp4'));
  assert.equal(cmp.json.shots.result, 4);
  assert.equal(cmp.json.cut_timing_s.mean, 0);
  assert.equal(cmp.json.cuts_within_2_frames, 1);

  const vertical = refcut('plan', at('ref.json'), at('v.json'), '--footage', at('a.mp4'), '--aspect', '9:16');
  assert.equal(vertical.json.size, '1080x1920');

  // mistakes are one line of JSON, and nothing is written over
  assert.equal(refcut('render', at('plan.json'), at('out.mp4')).json.ok, false);
  assert.match(refcut('plan', at('missing.json'), at('x.json'), '--footage', at('a.mp4')).json.error, /no file/);
});
