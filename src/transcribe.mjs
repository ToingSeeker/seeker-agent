// Voice notes: turns a recording from the phone into text.
//
// Two kinds of engine, chosen by `voiceEngine` in the config:
//   whisper-cpp   whisper.cpp on this machine (`whisper-cli` + `ffmpeg` + a ggml model file). The audio
//                 never leaves the Mac. ffmpeg first turns whatever the phone recorded (m4a on an iPhone,
//                 webm or ogg elsewhere) into the 16 kHz mono WAV whisper.cpp reads.
//   groq, openai  the provider's OpenAI-compatible /audio/transcriptions, with the API key already set for
//                 it in SEEKER (config or environment variable).
// 'auto' takes the first of these that is ready, in that order; 'off' turns voice notes off.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apiKey, providerDefs } from './providers.mjs';

export const VOICE_ENGINES = ['auto', 'whisper-cpp', 'groq', 'openai', 'off'];
export const MAX_VOICE_BYTES = 25 * 1024 * 1024; // the cloud services take at most 25 MB
const CLOUD_MODELS = { groq: 'whisper-large-v3-turbo', openai: 'gpt-4o-mini-transcribe' };
const RUN_MS = 5 * 60_000;

// Where whisper.cpp model files are usually put: its own download script, Homebrew, a manual download.
const MODEL_DIRS = [
  path.join(os.homedir(), '.cache', 'whisper-cpp'),
  path.join(os.homedir(), '.cache', 'whisper'),
  path.join(os.homedir(), '.seeker', 'whisper'),
  '/opt/homebrew/share/whisper-cpp',
  '/opt/homebrew/share/whisper.cpp',
  '/usr/local/share/whisper-cpp',
  '/usr/local/share/whisper.cpp',
];

/** The program `name` on PATH, or null. */
export function findProgram(name, envPath = process.env.PATH ?? '') {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return file;
    } catch {}
  }
  return null;
}

/**
 * The whisper.cpp model to use: `voiceWhisperModel` when set, else the largest ggml-*.bin found in the
 * usual folders (the bigger model is the better one). The tiny test models whisper.cpp ships are skipped.
 */
export function findWhisperModel(config = {}, dirs = MODEL_DIRS) {
  const chosen = String(config.voiceWhisperModel ?? '').trim();
  if (chosen) {
    const file = chosen.startsWith('~/') ? path.join(os.homedir(), chosen.slice(2)) : chosen;
    return fs.existsSync(file) ? file : null;
  }
  const found = [];
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^ggml-.*\.bin$/.test(name) || /for-tests/.test(name)) continue;
      try {
        found.push({ file: path.join(dir, name), bytes: fs.statSync(path.join(dir, name)).size });
      } catch {}
    }
  }
  return found.sort((a, b) => b.bytes - a.bytes)[0]?.file ?? null;
}

/** What whisper.cpp needs here, or what is missing. */
function whisperSetup(config, env, dirs) {
  const whisper = findProgram('whisper-cli', env.PATH) ?? findProgram('whisper-cpp', env.PATH);
  const ffmpeg = findProgram('ffmpeg', env.PATH);
  const model = findWhisperModel(config, dirs);
  const missing = [!whisper && 'whisper-cli', !ffmpeg && 'ffmpeg', !model && 'a ggml model file'].filter(Boolean);
  return { whisper, ffmpeg, model, missing };
}

function cloudSetup(id, config) {
  const def = providerDefs(config).find((p) => p.id === id);
  const key = def ? apiKey(def, config) : null;
  const base = (config.providers?.[id]?.baseUrl ?? def?.baseUrl ?? '').replace(/\/+$/, '');
  return { key, base, env: def?.env };
}

/**
 * Which engine would run, and how, without running it.
 * @returns {{ engine: string, ... } | { engine: null, reason: string }}
 */
export function chooseEngine(config = {}, { env = process.env, modelDirs = MODEL_DIRS } = {}) {
  const wanted = VOICE_ENGINES.includes(config.voiceEngine) ? config.voiceEngine : 'auto';
  if (wanted === 'off') return { engine: null, reason: 'Voice notes are off on the Mac (voiceEngine is "off" in /config).' };
  const local = wanted === 'auto' || wanted === 'whisper-cpp' ? whisperSetup(config, env, modelDirs) : null;
  if (local && !local.missing.length) return { engine: 'whisper-cpp', ...local };
  for (const id of ['groq', 'openai']) {
    if (wanted !== 'auto' && wanted !== id) continue;
    const cloud = cloudSetup(id, config);
    if (cloud.key && cloud.base) return { engine: id, ...cloud };
    if (wanted === id) return { engine: null, reason: `No ${id === 'groq' ? 'Groq' : 'OpenAI'} API key on the Mac: set ${cloud.env} or add the key in /model.` };
  }
  if (wanted === 'whisper-cpp') return { engine: null, reason: `whisper.cpp is not ready on the Mac: ${local.missing.join(', ')} missing.` };
  return {
    engine: null,
    reason: `Nothing on the Mac can turn speech into text yet. Install whisper.cpp (brew install whisper-cpp ffmpeg, plus a model in ~/.cache/whisper-cpp), or set a Groq or OpenAI API key. Missing for whisper.cpp: ${local.missing.join(', ')}.`,
  };
}

const run = (file, args, timeout, { both = false } = {}) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().split('\n').slice(-3).join(' ') || 'failed'));
      else resolve(both ? { stdout: String(stdout), stderr: String(stderr) } : String(stdout));
    }),
  );

/**
 * The languages voiceLanguage allows, as codes: [] lets the engine tell, one code is the language, and
 * several ("id,en") let it tell among them only. A short note ("hi seeker") is easily heard as another
 * language altogether, and then written in that language's spelling.
 */
export const languagesOf = (config) => [...new Set(String(config.voiceLanguage ?? '').toLowerCase().split(/[\s,]+/).filter((l) => /^[a-z]{2,3}$/.test(l)))];

/**
 * Words the engine is told to expect, so they are spelled right: SEEKER's name, then voiceWords (names
 * of projects, tools, people), comma-separated. Given as the engine's prompt.
 */
export const voicePrompt = (config) => {
  const words = ['SEEKER', ...String(config.voiceWords ?? '').split(',').map((w) => w.trim())].filter(Boolean);
  return [...new Set(words)].join(', ').slice(0, 400);
};

/** A transcript that is only the prompt said back is the engine filling silence, not what was said. */
const echoesPrompt = (text, prompt) => {
  const bare = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return Boolean(text) && bare(text) === bare(prompt);
};

/** whisper.cpp prints each segment on a line of its own; joined, they are the text. */
export const cleanTranscript = (text) =>
  String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, '').trim())
    .filter((line) => line && !/^\[(BLANK_AUDIO|MUSIC|NOISE)[^\]]*\]$|^\((music|silence)\)$/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

async function withWhisper(file, setup, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-voice-'));
  try {
    const wav = path.join(dir, 'voice.wav');
    await run(setup.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], RUN_MS);
    const langs = languagesOf(config);
    const prompt = voicePrompt(config);
    const pass = (lang) => run(setup.whisper, ['-m', setup.model, '-f', wav, '-l', lang, '-nt', '--prompt', prompt], RUN_MS, { both: true });
    let out = await pass(langs.length === 1 ? langs[0] : 'auto');
    // Told among which languages to tell: heard as another one, it is done again in the first of them.
    const heard = /auto-detected language: ([a-z]{2,3})\b/.exec(out.stderr)?.[1];
    if (langs.length > 1 && heard && !langs.includes(heard)) out = await pass(langs[0]);
    const text = cleanTranscript(out.stdout);
    return echoesPrompt(text, prompt) ? '' : text;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withCloud(file, setup, engine, config, fetchImpl) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  form.append('model', CLOUD_MODELS[engine]);
  form.append('response_format', 'json');
  const langs = languagesOf(config);
  if (langs.length === 1) form.append('language', langs[0]); // the services take one language, not a choice of several
  const prompt = voicePrompt(config);
  form.append('prompt', prompt);
  const res = await fetchImpl(`${setup.base}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${setup.key}` }, body: form, signal: AbortSignal.timeout(RUN_MS) });
  if (!res.ok) {
    let said = '';
    try {
      said = (await res.json())?.error?.message ?? '';
    } catch {}
    throw new Error(`${engine === 'groq' ? 'Groq' : 'OpenAI'} answered ${res.status}${said ? `: ${said}` : ''}`);
  }
  const text = cleanTranscript((await res.json())?.text);
  return echoesPrompt(text, prompt) ? '' : text;
}

/**
 * Turns the recording in `file` into text.
 * @returns {Promise<{ text: string, engine: string }>}
 * @throws {Error} with a message fit to show on the phone as it is
 */
export async function transcribe(file, config = {}, { env = process.env, fetchImpl = fetch, modelDirs = MODEL_DIRS } = {}) {
  const setup = chooseEngine(config, { env, modelDirs });
  if (!setup.engine) throw new Error(setup.reason);
  let text;
  try {
    text = setup.engine === 'whisper-cpp' ? await withWhisper(file, setup, config) : await withCloud(file, setup, setup.engine, config, fetchImpl);
  } catch (err) {
    throw new Error(`The voice note could not be turned into text (${setup.engine}): ${err.message}`);
  }
  if (!text) throw new Error('Nothing was heard in that voice note.');
  return { text, engine: setup.engine };
}
