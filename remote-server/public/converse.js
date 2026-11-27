// Talk mode: what the phone needs to hold a spoken conversation with the agent.
// Plain data in, plain data out — no DOM, no microphone — so the page and the tests run the same code.
// app.js does the recording, the sending and the reading out; this file decides when someone stopped
// speaking, what of a reply is said aloud, in which voice, and whether a reply holds a plan to run.

/** How long a pause ends what was said, and how much speech there must be before a pause counts. */
export const SILENCE_MS = 1200;
export const SPEECH_MS = 350;
/** Nobody spoke for this long: the recording is started again, so it never grows long and empty. */
export const IDLE_MS = 15_000;
/** The quietest a voice can be and still count (a level is 0–1, as the talk page's wave measures it). */
const MIN_VOICE = 0.06;

/**
 * Hears the end of what was said, from the loudness of the microphone a few dozen times a second. It learns
 * the room's own noise, counts as speech what is clearly above it, and once there has been enough speech, a
 * pause of SILENCE_MS ends it. `feed` answers 'quiet' (nothing said yet), 'speaking', 'pause' (speech, then
 * quiet for less than SILENCE_MS), 'end', or 'idle' when nobody has spoken for IDLE_MS.
 */
export class EndOfSpeech {
  constructor({ silence = SILENCE_MS, speech = SPEECH_MS, idle = IDLE_MS } = {}) {
    Object.assign(this, { silence, speech, idle });
    this.reset(null);
  }

  /** Starts listening anew, as from `now`. */
  reset(now) {
    this.started = now;
    this.floor = null; // the room's noise, learned as it goes
    this.spoken = 0; // ms of speech heard
    this.quietSince = null;
    this.last = null;
  }

  /** How far the pause has gone toward ending it, 0–1: the bar under the words. */
  progress(now) {
    if (this.spoken < this.speech || this.quietSince == null) return 0;
    return Math.min(1, (now - this.quietSince) / this.silence);
  }

  feed(level, now) {
    if (this.started == null) this.started = now;
    const step = this.last == null ? 0 : Math.min(200, now - this.last);
    this.last = now;
    // The floor follows the noise down at once and up only slowly, so a voice does not become the floor.
    this.floor = this.floor == null ? level : level < this.floor ? level : this.floor + (level - this.floor) * 0.01;
    const loud = level > Math.max(MIN_VOICE, this.floor * 2.5 + 0.02);
    if (loud) {
      this.spoken += step;
      this.quietSince = null;
      return 'speaking';
    }
    if (this.spoken < this.speech) return now - this.started >= this.idle ? 'idle' : 'quiet';
    this.quietSince ??= now;
    return now - this.quietSince >= this.silence ? 'end' : 'pause';
  }
}

/** The reply to the last thing the user said: the final answer written after it, or '' while there is none. */
export function latestReply(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === 'user') return '';
    if (item.kind === 'assistant' && String(item.text ?? '').trim()) return item.text.trim();
  }
  return '';
}

/**
 * A reply as it is said aloud: no code (it is on the screen), no markdown signs, no addresses read out letter by
 * letter. Numbered steps keep their numbers, as a person would say them.
 */
export function speakable(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?(```|$)/g, ' (the code is on the screen) ')
    .replace(/^\s*\|.*\|\s*$/gm, '') // table rows
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+?(?=[.,;:!?)]*(\s|$))/g, 'a link')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|~~)(\S[^\n]*?)\1/g, '$2')
    .replace(/\*(\S[^*\n]*?)\*/g, '$1') // *italic*; _snake_case_ names are left alone
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * A spoken reply in pieces of a sentence or so, read one after another: a browser may stop reading a long
 * text partway (Chrome does after ~15 s), and the piece being read is the one lit on the screen.
 */
export function sentences(text, max = 220) {
  const out = [];
  for (const part of String(text ?? '').split(/(?<=[.!?…:;])\s+|\n+/)) {
    let rest = part.trim();
    while (rest.length > max) {
      const cut = Math.max(rest.lastIndexOf(', ', max), rest.lastIndexOf(' ', max));
      const at = cut > max / 3 ? cut + 1 : max;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

// Common words that mark Indonesian, short and frequent enough to show up in almost any reply.
const INDONESIAN = new Set('yang dan di ini itu untuk dengan tidak ada bisa sudah akan dari ke kita saya kamu apa juga atau karena kalau jadi belum perlu sekarang masih lagi mau nya pakai buat sama aja nggak gak biar supaya agar tapi sudah dulu baru'.split(' '));

/** The language a reply is read out in: Indonesian when enough of its words are, English otherwise. */
export function speechLang(text) {
  const words = String(text ?? '').toLowerCase().match(/[a-z]+/g) ?? [];
  if (!words.length) return 'en-US';
  const hits = words.filter((w) => INDONESIAN.has(w)).length;
  return hits / words.length >= 0.08 ? 'id-ID' : 'en-US';
}

/** The voice that reads `lang`: the device's own for that language if it has one, else any of the language. */
export function pickVoice(voices, lang) {
  const base = lang.split('-')[0];
  const of = (v) => String(v.lang ?? '').replace('_', '-').toLowerCase();
  const exact = voices.filter((v) => of(v) === lang.toLowerCase());
  const near = exact.length ? exact : voices.filter((v) => of(v).split('-')[0] === base);
  return near.find((v) => v.localService) ?? near[0] ?? null;
}

/**
 * The reading voice picked in Settings, as kept on the phone: 'auto' (the device's own, by the reply's
 * language), 'device:<voiceURI>' (one of the device's voices) or 'azure:<voice name>' (spoken on the Mac).
 */
export function voiceChoice(raw) {
  const text = String(raw ?? '');
  const m = /^(device|azure):(.{1,200})$/s.exec(text);
  if (!m) return { kind: 'auto', id: '' };
  if (m[1] === 'azure' && !/^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z0-9]{2,60}Neural$/.test(m[2])) return { kind: 'auto', id: '' };
  return { kind: m[1], id: m[2] };
}

// Apple's novelty voices (sound effects and robots, on iPhone and Mac alike): no one wants a reply read in them.
const NOVELTY = new Set(['Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Good News', 'Jester', 'Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Junior', 'Ralph', 'Fred', 'Kathy']);

/** The device's voices worth offering for replies: Indonesian ones first, then English, each by name, no repeats. */
export function offeredVoices(voices) {
  const base = (v) => String(v.lang ?? '').replace('_', '-').toLowerCase().split('-')[0];
  const rank = { id: 0, en: 1 };
  const seen = new Set();
  return [...voices]
    .filter((v) => base(v) in rank && !NOVELTY.has(v.name) && v.voiceURI && !seen.has(v.voiceURI) && seen.add(v.voiceURI))
    .sort((a, b) => rank[base(a)] - rank[base(b)] || String(a.name).localeCompare(String(b.name)));
}

/**
 * The steps of a plan in a reply, when it gives one as a numbered list (1. 2. 3.) of at least two steps — what
 * the model is asked to do when the user wants to go ahead. An empty list when the reply holds no plan.
 */
export function planIn(text) {
  const steps = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*(\d{1,2})[.)]\s+(.+)$/.exec(line);
    if (m) steps.push(speakable(m[2]));
  }
  return steps.length >= 2 ? steps : [];
}
