import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offeredVoices, voiceChoice } from '../remote-server/public/converse.js';
import { AZURE_VOICES, azureSpeech, isAzureVoice, parseRegion, ssml, synthesize } from '../src/speech.mjs';

const KEY = 'k'.repeat(32);

test('speech: the key and region come from the environment first, then config.json', () => {
  assert.deepEqual(azureSpeech({}, {}), { key: null, region: null, status: 'none', ready: false });
  assert.deepEqual(azureSpeech({ azureSpeechKey: KEY, azureSpeechRegion: 'southeastasia' }, {}), { key: KEY, region: 'southeastasia', status: 'set', ready: true });
  const both = azureSpeech({ azureSpeechKey: KEY, azureSpeechRegion: 'eastus' }, { AZURE_SPEECH_KEY: 'e'.repeat(32), AZURE_SPEECH_REGION: 'westeurope' });
  assert.deepEqual([both.key, both.region, both.status], ['e'.repeat(32), 'westeurope', 'env']);
  assert.equal(parseRegion(' South East Asia '), 'southeastasia');
  assert.equal(parseRegion('evil.com/x'), undefined);
  assert.equal(parseRegion(''), undefined);
});

test('speech: voice names are checked and the text is escaped, so nothing can be added to the SSML', () => {
  assert.ok(AZURE_VOICES.every((v) => isAzureVoice(v.id)));
  assert.ok(AZURE_VOICES.some((v) => v.lang === 'id-ID' && v.gender === 'male'), 'a male Indonesian voice is offered');
  for (const bad of ['', 'id-ID-Ardi', 'x"><y', 'id-ID-Ardi Neural', null]) assert.equal(isAzureVoice(bad), false, String(bad));
  const out = ssml('a < b & "c" </voice><voice name="x">', 'id-ID-ArdiNeural');
  assert.match(out, /xml:lang="id-ID"><voice name="id-ID-ArdiNeural">a &lt; b &amp; &quot;c&quot; &lt;\/voice&gt;/);
  assert.equal((out.match(/<voice /g) ?? []).length, 1);
  assert.doesNotMatch(ssml('bell\u0007', 'en-US-AvaMultilingualNeural'), /\u0007/, 'characters XML cannot hold are dropped');
});

test('speech: Azure is asked with the key in a header and the voice in SSML; its refusals read plainly', async () => {
  const calls = [];
  const reply = { status: 200, body: Buffer.from('ID3fake-mp3') };
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return new Response(reply.status === 200 ? reply.body : 'no', { status: reply.status });
  };
  const config = { azureSpeechKey: KEY, azureSpeechRegion: 'southeastasia' };
  const got = await synthesize('Halo semua', 'id-ID-ArdiNeural', config, { env: {}, fetchImpl });
  assert.equal(got.mime, 'audio/mpeg');
  assert.ok(got.data.equals(reply.body));
  assert.equal(calls[0].url, 'https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(calls[0].opts.headers['Ocp-Apim-Subscription-Key'], KEY);
  assert.equal(calls[0].opts.headers['X-Microsoft-OutputFormat'], 'audio-24khz-48kbitrate-mono-mp3');
  assert.match(calls[0].opts.body, /<voice name="id-ID-ArdiNeural">Halo semua<\/voice>/);
  assert.equal(calls[0].url.includes(KEY) || calls[0].opts.body.includes(KEY), false, 'the key is only in the header');

  reply.status = 401;
  await assert.rejects(synthesize('x', 'id-ID-ArdiNeural', config, { env: {}, fetchImpl }), /refused the key/);
  reply.status = 429;
  await assert.rejects(synthesize('x', 'id-ID-ArdiNeural', config, { env: {}, fetchImpl }), /quota/);
  const failing = async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  };
  await assert.rejects(synthesize('x', 'id-ID-ArdiNeural', config, { env: {}, fetchImpl: failing }), /could not be reached \(ENOTFOUND\)/);

  const before = calls.length;
  await assert.rejects(synthesize('x', 'id-ID-ArdiNeural', {}, { env: {}, fetchImpl }), /No Azure Speech key/);
  await assert.rejects(synthesize('x', 'id-ID-ArdiNeural', { azureSpeechKey: KEY }, { env: {}, fetchImpl }), /region is not set/);
  await assert.rejects(synthesize('  ', 'id-ID-ArdiNeural', config, { env: {}, fetchImpl }), /Nothing to say/);
  await assert.rejects(synthesize('x', 'bad"voice', config, { env: {}, fetchImpl }), /not an Azure voice/);
  assert.equal(calls.length, before, 'nothing is sent to Azure when the request cannot work');
});

test('speech: the phone keeps its voice choice, and offers Indonesian voices before English ones', () => {
  assert.deepEqual(voiceChoice(null), { kind: 'auto', id: '' });
  assert.deepEqual(voiceChoice('auto'), { kind: 'auto', id: '' });
  assert.deepEqual(voiceChoice('device:com.apple.voice.compact.id-ID.Damayanti'), { kind: 'device', id: 'com.apple.voice.compact.id-ID.Damayanti' });
  assert.deepEqual(voiceChoice('azure:id-ID-ArdiNeural'), { kind: 'azure', id: 'id-ID-ArdiNeural' });
  assert.deepEqual(voiceChoice('azure:"><x'), { kind: 'auto', id: '' }, 'a stored value that is not a voice name falls back');
  const voices = [
    { name: 'Samantha', lang: 'en-US', voiceURI: 's' },
    { name: 'Thomas', lang: 'fr-FR', voiceURI: 't' },
    { name: 'Damayanti', lang: 'id_ID', voiceURI: 'd' },
    { name: 'Daniel', lang: 'en-GB', voiceURI: 'dn' },
    { name: 'Samantha', lang: 'en-US', voiceURI: 's' },
    { name: 'Bad News', lang: 'en-US', voiceURI: 'b' },
  ];
  assert.deepEqual(offeredVoices(voices).map((v) => v.name), ['Damayanti', 'Daniel', 'Samantha']);
});
