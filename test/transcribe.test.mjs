import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chooseEngine, cleanTranscript, findWhisperModel, languagesOf, transcribe, voicePrompt, withoutMadeUp } from '../src/transcribe.mjs';
import { SETTINGS } from '../src/config.mjs';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-voice-test-'));

/**
 * A folder of stand-in programs: ffmpeg copies its input to its output (and, given `peak`, reports it as the
 * loudest point when asked to measure), whisper-cli prints what it was given.
 */
function fakeTools({ whisper = true, ffmpeg = true, peak = null } = {}) {
  const bin = scratch();
  const log = path.join(bin, 'calls.log');
  const measure = peak === null ? '' : `case "$*" in *volumedetect*) echo "[Parsed_volumedetect_0 @ 0x1] max_volume: ${peak} dB" >&2;; esac\n`;
  if (ffmpeg) fs.writeFileSync(path.join(bin, 'ffmpeg'), `#!/bin/sh\necho "ffmpeg $*" >> "${log}"\n${measure}for a; do last="$a"; done\nin=""; prev=""; for a; do [ "$prev" = "-i" ] && in="$a"; prev="$a"; done\ncp "$in" "$last"\n`, { mode: 0o755 });
  if (whisper) fs.writeFileSync(path.join(bin, 'whisper-cli'), `#!/bin/sh\necho "whisper $*" >> "${log}"\nprintf ' Halo, tolong cek\\n [BLANK_AUDIO]\\n file README.md.\\n'\n`, { mode: 0o755 });
  return { bin, log, env: { PATH: `${bin}:/bin:/usr/bin` } };
}

function models() {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'ggml-tiny.bin'), Buffer.alloc(10));
  fs.writeFileSync(path.join(dir, 'ggml-small.bin'), Buffer.alloc(100));
  fs.writeFileSync(path.join(dir, 'for-tests-ggml-large.bin'), Buffer.alloc(1000));
  fs.writeFileSync(path.join(dir, 'ggml-for-tests-huge.bin'), Buffer.alloc(5000));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  return dir;
}

/** Runs `fn` with the cloud keys of this machine out of the way, so only what the test sets is seen. */
async function withoutCloudKeys(fn) {
  const saved = { GROQ_API_KEY: process.env.GROQ_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}

test('voice: the largest real whisper.cpp model is chosen, test models are skipped, and a chosen one must exist', () => {
  const dir = models();
  assert.equal(findWhisperModel({}, [dir, '/nonexistent']), path.join(dir, 'ggml-small.bin'));
  assert.equal(findWhisperModel({}, ['/nonexistent']), null);
  assert.equal(findWhisperModel({ voiceWhisperModel: path.join(dir, 'ggml-tiny.bin') }, [dir]), path.join(dir, 'ggml-tiny.bin'));
  assert.equal(findWhisperModel({ voiceWhisperModel: path.join(dir, 'missing.bin') }, [dir]), null);
});

test('voice: whisper.cpp on this machine is preferred, the audio is converted to 16 kHz WAV first, and the text is cleaned', async () => {
  await withoutCloudKeys(async () => {
    const tools = fakeTools();
    const dir = models();
    const audio = path.join(scratch(), 'voice-note.m4a');
    fs.writeFileSync(audio, 'not really audio');
    const config = { voiceEngine: 'auto', voiceLanguage: 'id', providers: { groq: { apiKey: 'gsk_test' } } };
    assert.equal(chooseEngine(config, { env: tools.env, modelDirs: [dir] }).engine, 'whisper-cpp', 'local wins over a cloud key');
    const result = await transcribe(audio, config, { env: tools.env, modelDirs: [dir] });
    assert.deepEqual(result, { text: 'Halo, tolong cek file README.md.', engine: 'whisper-cpp' });
    const calls = fs.readFileSync(tools.log, 'utf8');
    assert.match(calls, /ffmpeg .*-i .*voice-note\.m4a -ar 16000 -ac 1 -c:a pcm_s16le .*voice\.wav/);
    assert.match(calls, new RegExp(`whisper -m ${path.join(dir, 'ggml-small.bin').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -f .*voice\\.wav -l id -nt --prompt SEEKER$`, 'm'));
    assert.ok(fs.existsSync(audio), 'the recording itself is left to whoever sent it');
  });
});

test('voice: without whisper.cpp, Groq is used with the key SEEKER already has, then OpenAI', async () => {
  await withoutCloudKeys(async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      const parts = [];
      req.on('data', (c) => parts.push(c)).on('end', () => {
        const body = Buffer.concat(parts).toString('latin1');
        seen.push({ url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body });
        if (req.headers.authorization === 'Bearer bad') {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: 'Invalid API Key' } }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ text: '  deploy ke staging  ' }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/v1`;
    try {
      const tools = fakeTools({ whisper: false });
      const audio = path.join(scratch(), 'voice-note.webm');
      fs.writeFileSync(audio, 'opus bytes');
      const config = { voiceEngine: 'auto', voiceLanguage: '', providers: { groq: { apiKey: 'gsk_test', baseUrl: base }, openai: { apiKey: 'sk-test', baseUrl: base } } };
      assert.deepEqual(await transcribe(audio, config, { env: tools.env, modelDirs: [models()] }), { text: 'deploy ke staging', engine: 'groq' });
      assert.equal(seen[0].url, '/v1/audio/transcriptions');
      assert.equal(seen[0].auth, 'Bearer gsk_test');
      assert.match(seen[0].type, /^multipart\/form-data/);
      assert.match(seen[0].body, /name="model"\r\n\r\nwhisper-large-v3-turbo/);
      assert.match(seen[0].body, /filename="voice-note\.webm"[\s\S]*opus bytes/);
      assert.doesNotMatch(seen[0].body, /name="language"/, 'no language hint unless one is set');
      assert.match(seen[0].body, /name="prompt"\r\n\r\nSEEKER\r\n/, 'SEEKER is a word it expects');

      const openai = { ...config, voiceEngine: 'openai', voiceLanguage: 'en' };
      assert.equal((await transcribe(audio, openai, { env: tools.env })).engine, 'openai');
      assert.match(seen[1].body, /name="model"\r\n\r\ngpt-4o-mini-transcribe/);
      assert.match(seen[1].body, /name="language"\r\n\r\nen/);

      const bad = { ...config, voiceEngine: 'groq', providers: { groq: { apiKey: 'bad', baseUrl: base } } };
      await assert.rejects(transcribe(audio, bad, { env: tools.env }), /could not be turned into text \(groq\): Groq answered 401: Invalid API Key/);
    } finally {
      server.close();
    }
  });
});

test('voice: with no engine ready, or voice notes off, the reason says what to do', async () => {
  await withoutCloudKeys(async () => {
    const env = { PATH: scratch() };
    const audio = path.join(scratch(), 'v.m4a');
    fs.writeFileSync(audio, 'x');
    await assert.rejects(transcribe(audio, { voiceEngine: 'auto', providers: {} }, { env, modelDirs: [] }), /brew install whisper-cpp ffmpeg[\s\S]*Groq or OpenAI API key[\s\S]*whisper-cli, ffmpeg, a ggml model file/);
    await assert.rejects(transcribe(audio, { voiceEngine: 'off' }, { env }), /Voice notes are off/);
    await assert.rejects(transcribe(audio, { voiceEngine: 'groq', providers: {} }, { env }), /No Groq API key on the Mac: set GROQ_API_KEY/);
    const tools = fakeTools({ ffmpeg: false });
    await assert.rejects(transcribe(audio, { voiceEngine: 'whisper-cpp' }, { env: tools.env, modelDirs: [models()] }), /whisper\.cpp is not ready on the Mac: ffmpeg missing/);
  });
});

test('voice: silence is not text, and /config takes only known values', async () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO]\n\n (music)\n'), '');
  assert.equal(cleanTranscript('[00:00:00.000 --> 00:00:02.000]  satu\n[00:00:02.000 --> 00:00:04.000]  dua'), 'satu dua');
  await withoutCloudKeys(async () => {
    const tools = fakeTools();
    fs.writeFileSync(path.join(tools.bin, 'whisper-cli'), '#!/bin/sh\nprintf " [BLANK_AUDIO]\\n"\n', { mode: 0o755 });
    const audio = path.join(scratch(), 'v.m4a');
    fs.writeFileSync(audio, 'x');
    await assert.rejects(transcribe(audio, {}, { env: tools.env, modelDirs: [models()] }), /Nothing was heard/);
  });
  assert.equal(SETTINGS.voiceEngine.parse('Groq'), 'groq');
  assert.equal(SETTINGS.voiceEngine.parse('siri'), undefined);
  assert.equal(SETTINGS.voiceLanguage.parse('ID'), 'id');
  assert.equal(SETTINGS.voiceLanguage.parse('auto'), '');
  assert.equal(SETTINGS.voiceLanguage.parse('indonesian'), undefined);
  assert.equal(SETTINGS.voiceLanguage.parse('ID, en'), 'id,en');
  assert.equal(SETTINGS.voiceLanguage.parse('id,english'), undefined);
  assert.equal(SETTINGS.voiceWords.parse(' Orfy,  LensBook ,'), 'Orfy, LensBook');
  assert.equal(SETTINGS.voiceWords.parse('-'), '');
  assert.equal(SETTINGS.voiceAutoSend.parse('on'), true);
});

/** A whisper-cli that hears `heard` when left to tell the language, and says what it was given. */
function guessingWhisper(tools, heard, said = 'Hæ, hýkar.') {
  fs.writeFileSync(
    path.join(tools.bin, 'whisper-cli'),
    `#!/bin/sh\necho "whisper $*" >> "${tools.log}"\nlang=""; prev=""; for a; do [ "$prev" = "-l" ] && lang="$a"; prev="$a"; done\nif [ "$lang" = auto ]; then echo "whisper_full_with_state: auto-detected language: ${heard} (p = 0.41)" >&2; printf ' ${said}\\n'; else printf " Hi SEEKER, ($lang)\\n"; fi\n`,
    { mode: 0o755 },
  );
}

test('voice: told the languages to choose among, a note heard as another language is done again in the first', async () => {
  assert.deepEqual(languagesOf({ voiceLanguage: 'id,en' }), ['id', 'en']);
  assert.deepEqual(languagesOf({ voiceLanguage: '' }), []);
  assert.equal(voicePrompt({ voiceWords: 'Orfy, SEEKER, LensBook' }), 'SEEKER, Orfy, LensBook');
  await withoutCloudKeys(async () => {
    const tools = fakeTools();
    const audio = path.join(scratch(), 'v.m4a');
    fs.writeFileSync(audio, 'x');
    const dirs = [models()];
    // "hi seeker" heard as Icelandic: redone in Indonesian, the first allowed.
    guessingWhisper(tools, 'is');
    assert.equal((await transcribe(audio, { voiceLanguage: 'id,en' }, { env: tools.env, modelDirs: dirs })).text, 'Hi SEEKER, (id)');
    assert.deepEqual(fs.readFileSync(tools.log, 'utf8').match(/-l [a-z]+/g), ['-l auto', '-l id']);
    // Heard as one of them: taken as it is, one pass only.
    fs.rmSync(tools.log);
    guessingWhisper(tools, 'en', 'Hi SEEKER.');
    assert.equal((await transcribe(audio, { voiceLanguage: 'id,en' }, { env: tools.env, modelDirs: dirs })).text, 'Hi SEEKER.');
    assert.deepEqual(fs.readFileSync(tools.log, 'utf8').match(/-l [a-z]+/g), ['-l auto']);
    // Left to tell (no list), whatever it hears stands.
    guessingWhisper(tools, 'is');
    assert.equal((await transcribe(audio, {}, { env: tools.env, modelDirs: dirs })).text, 'Hæ, hýkar.');
    // The prompt said back over silence is not taken for speech.
    guessingWhisper(tools, 'en', 'SEEKER.');
    await assert.rejects(transcribe(audio, {}, { env: tools.env, modelDirs: dirs }), /Nothing was heard/);
    assert.match(fs.readFileSync(tools.log, 'utf8'), /--prompt SEEKER$/m);
  });
});

test('voice: a recording with no voice in it goes to no engine, and is said to have nothing in it', async () => {
  await withoutCloudKeys(async () => {
    const audio = path.join(scratch(), 'v.m4a');
    fs.writeFileSync(audio, 'x');
    const dirs = [models()];
    // Silence (what an iPhone records in a quiet room, measured at -91 dB): whisper is never run.
    const quiet = fakeTools({ peak: '-91.0' });
    await assert.rejects(transcribe(audio, {}, { env: quiet.env, modelDirs: dirs }), /Nothing was heard/);
    const calls = fs.readFileSync(quiet.log, 'utf8');
    assert.match(calls, /ffmpeg -nostdin -hide_banner -loglevel info -i .*v\.m4a -af volumedetect -f null \/dev\/null/);
    assert.doesNotMatch(calls, /whisper/);
    const silent = fakeTools({ peak: '-inf' });
    await assert.rejects(transcribe(audio, {}, { env: silent.env, modelDirs: dirs }), /Nothing was heard/);
    // A voice (peaks near 0 dB): transcribed as before.
    const loud = fakeTools({ peak: '-1.4' });
    assert.equal((await transcribe(audio, {}, { env: loud.env, modelDirs: dirs })).text, 'Halo, tolong cek file README.md.');
    // Not measurable (an ffmpeg that says nothing): not held back.
    assert.equal((await transcribe(audio, {}, { env: fakeTools().env, modelDirs: dirs })).text, 'Halo, tolong cek file README.md.');
    // A cloud engine is spared a silent recording too, when ffmpeg is here to measure it.
    let asked = 0;
    const cloud = fakeTools({ whisper: false, peak: '-91.0' });
    const fetchImpl = async () => (asked++, new Response(JSON.stringify({ text: 'x' })));
    await assert.rejects(transcribe(audio, { voiceEngine: 'groq', providers: { groq: { apiKey: 'gsk_test', baseUrl: 'http://127.0.0.1:9' } } }, { env: cloud.env, fetchImpl }), /Nothing was heard/);
    assert.equal(asked, 0);
  });
});

test('voice: what whisper makes up over silence or a hiss is not taken for what was said', async () => {
  const prompt = voicePrompt({ voiceWords: 'Orfy, LensBook' });
  // Heard by the real whisper.cpp on this project's silence and hiss tests.
  assert.equal(withoutMadeUp('Sous-titrage Société Radio-Canada', prompt), '');
  assert.equal(withoutMadeUp('EKER', prompt), '', 'a piece of SEEKER out of a hiss');
  assert.equal(withoutMadeUp('you', prompt), '');
  assert.equal(withoutMadeUp('.', prompt), '');
  assert.equal(withoutMadeUp('SEEKER, Orfy, LensBook.', prompt), '', 'the prompt said back');
  assert.equal(withoutMadeUp('Thanks for watching!', prompt), '');
  assert.equal(withoutMadeUp('Terima kasih telah menonton.', prompt), '');
  assert.equal(withoutMadeUp("Sous-titres réalisés par la communauté d'Amara.org", prompt), '');
  // Taken off the end of real words, which stay as they were.
  assert.equal(withoutMadeUp('Deploy ke staging. Terima kasih sudah menonton.', prompt), 'Deploy ke staging.');
  assert.equal(withoutMadeUp('Cek file README. Sous-titrage Société Radio-Canada', prompt), 'Cek file README.');
  // Real requests that only look like them are kept.
  assert.equal(withoutMadeUp('Terima kasih, lanjut deploy', prompt), 'Terima kasih, lanjut deploy');
  assert.equal(withoutMadeUp('Thank you', prompt), 'Thank you');
  assert.equal(withoutMadeUp('Hi SEEKER, open Orfy', prompt), 'Hi SEEKER, open Orfy');
  assert.equal(withoutMadeUp('Tell me how many people watched thanks for watching videos', prompt), 'Tell me how many people watched thanks for watching videos');
  // Through the engine: made-up text is the same as nothing heard.
  await withoutCloudKeys(async () => {
    const tools = fakeTools();
    fs.writeFileSync(path.join(tools.bin, 'whisper-cli'), '#!/bin/sh\nprintf " Sous-titrage Société Radio-Canada\\n"\n', { mode: 0o755 });
    const audio = path.join(scratch(), 'v.m4a');
    fs.writeFileSync(audio, 'x');
    await assert.rejects(transcribe(audio, {}, { env: tools.env, modelDirs: [models()] }), /Nothing was heard/);
  });
});
