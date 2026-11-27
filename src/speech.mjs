// Cloud voices for talk mode: turns a reply into speech with Azure AI Speech, for the phone to play.
//
// The phone reads replies in its own voice by default (Web Speech, in remote-server/public/app.js). When the
// user picks an Azure voice there, each piece of a reply is sent here, spoken by Azure's text-to-speech REST
// API, and the MP3 goes back to the phone sealed like any file. The key stays on this Mac: it is read from
// AZURE_SPEECH_KEY / AZURE_SPEECH_REGION first, else from azureSpeechKey / azureSpeechRegion in config.json,
// which the phone can set (it is never sent back).

/** The Azure voices the phone offers. Any other Azure neural voice name is accepted too. */
export const AZURE_VOICES = [
  { id: 'id-ID-ArdiNeural', name: 'Ardi', lang: 'id-ID', gender: 'male' },
  { id: 'id-ID-GadisNeural', name: 'Gadis', lang: 'id-ID', gender: 'female' },
  { id: 'en-US-AndrewMultilingualNeural', name: 'Andrew (multilingual)', lang: 'en-US', gender: 'male' },
  { id: 'en-US-BrianMultilingualNeural', name: 'Brian (multilingual)', lang: 'en-US', gender: 'male' },
  { id: 'en-US-AvaMultilingualNeural', name: 'Ava (multilingual)', lang: 'en-US', gender: 'female' },
  { id: 'en-US-EmmaMultilingualNeural', name: 'Emma (multilingual)', lang: 'en-US', gender: 'female' },
];

export const MAX_SPEECH_CHARS = 2000; // one piece of a reply; the phone sends a sentence or so at a time
const VOICE_NAME = /^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z0-9]{2,60}Neural$/;
const REGION = /^[a-z0-9]{3,40}$/;
const SPEAK_MS = 20_000;

/** Whether `name` is an Azure neural voice name (id-ID-ArdiNeural), so it can go into SSML as it is. */
export const isAzureVoice = (name) => typeof name === 'string' && VOICE_NAME.test(name);

/** An Azure region as written in the portal ("southeastasia"), or undefined when it is not one. */
export function parseRegion(raw) {
  const region = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return REGION.test(region) ? region : undefined;
}

/** The key and region to use, and where they came from: 'env', 'set' (config.json) or 'none'. */
export function azureSpeech(config = {}, env = process.env) {
  const envKey = String(env.AZURE_SPEECH_KEY ?? '').trim();
  const key = envKey || String(config.azureSpeechKey ?? '').trim();
  const region = parseRegion(env.AZURE_SPEECH_REGION) ?? parseRegion(config.azureSpeechRegion) ?? null;
  return { key: key || null, region, status: envKey ? 'env' : key ? 'set' : 'none', ready: Boolean(key && region) };
}

const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

/** The SSML Azure reads: one voice, the text escaped. Characters XML cannot hold are dropped. */
export function ssml(text, voice) {
  const lang = voice.split('-').slice(0, 2).join('-');
  const clean = String(text).replace(/[^\t\n\r\x20-퟿-�]/gu, ' ');
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}">${escapeXml(clean)}</voice></speak>`;
}

/**
 * Speaks `text` in the Azure voice `voice`. Returns { data: Buffer, mime: 'audio/mpeg' }; throws with a
 * sentence the phone can show when it cannot (no key, a refused key, a voice Azure does not know).
 */
export async function synthesize(text, voice, config = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const said = String(text ?? '').trim();
  if (!said) throw new Error('Nothing to say.');
  if (said.length > MAX_SPEECH_CHARS) throw new Error(`At most ${MAX_SPEECH_CHARS} characters can be spoken at once.`);
  if (!isAzureVoice(voice)) throw new Error('That is not an Azure voice name.');
  const azure = azureSpeech(config, env);
  if (!azure.key) throw new Error('No Azure Speech key on the Mac yet. Add it in Settings → Voice.');
  if (!azure.region) throw new Error('The Azure Speech region is not set. Add it in Settings → Voice.');
  let res;
  try {
    res = await fetchImpl(`https://${azure.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azure.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'seeker',
      },
      body: ssml(said, voice),
      signal: AbortSignal.timeout(SPEAK_MS),
    });
  } catch (err) {
    throw new Error(`Azure Speech could not be reached (${err.cause?.code ?? err.name ?? err.message}).`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('Azure refused the key. Check the key and that the region is the one of your Speech resource.');
  if (res.status === 429) throw new Error('Azure Speech is busy or the free quota is used up. Try again in a moment.');
  if (res.status === 400) throw new Error(`Azure did not accept that request; is ${voice} a voice it has?`);
  if (!res.ok) throw new Error(`Azure Speech answered HTTP ${res.status}.`);
  const data = Buffer.from(await res.arrayBuffer());
  if (!data.length) throw new Error('Azure sent back no sound.');
  return { data, mime: 'audio/mpeg' };
}
