// The phone's talk mode: when the user has finished speaking, what of a reply is read out and in which
// voice, and whether a reply holds a plan to run. Plain functions, the same the page runs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EndOfSpeech, IDLE_MS, SILENCE_MS, latestReply, pickVoice, planIn, sentences, speakable, speechLang } from '../remote-server/public/converse.js';

/** Feeds `level` every 50 ms for `ms`, from `t`; returns what was heard last and the time reached. */
const run = (hear, level, ms, t) => {
  let heard = null;
  for (const end = t + ms; t < end; t += 50) heard = hear.feed(level, t);
  return { heard, t };
};

test('end of speech: a pause after enough speech ends it, a pause before does not', () => {
  const hear = new EndOfSpeech();
  hear.reset(0);
  let { heard, t } = run(hear, 0.01, 1000, 0); // the room
  assert.equal(heard, 'quiet');
  ({ heard, t } = run(hear, 0.4, 1500, t)); // speaking
  assert.equal(heard, 'speaking');
  ({ heard, t } = run(hear, 0.01, SILENCE_MS - 200, t)); // a breath between sentences
  assert.equal(heard, 'pause');
  assert.ok(hear.progress(t) > 0.5 && hear.progress(t) < 1, 'the bar fills during the pause');
  ({ heard, t } = run(hear, 0.4, 600, t)); // and on they go
  assert.equal(heard, 'speaking');
  assert.equal(hear.progress(t), 0, 'speaking again empties the bar');
  ({ heard } = run(hear, 0.01, SILENCE_MS + 100, t));
  assert.equal(heard, 'end');
});

test('end of speech: a click or a cough is not speech, a noisy room is not a voice, and nobody speaking starts over', () => {
  const hear = new EndOfSpeech();
  hear.reset(0);
  let { t } = run(hear, 0.01, 500, 0);
  run(hear, 0.5, 100, t); // a click
  ({ t } = run(hear, 0.01, SILENCE_MS * 2, t + 100));
  assert.notEqual(hear.feed(0.01, t), 'end', 'too little speech to end anything');

  const noisy = new EndOfSpeech();
  noisy.reset(0);
  const r = run(noisy, 0.12, 3000, 0); // a fan, steady
  assert.notEqual(r.heard, 'speaking', 'steady noise becomes the floor');
  assert.equal(run(noisy, 0.5, 500, r.t).heard, 'speaking', 'a voice above it still counts');

  const empty = new EndOfSpeech();
  empty.reset(0);
  assert.equal(run(empty, 0.01, IDLE_MS + 100, 0).heard, 'idle');
});

test('the reply read out is the last answer after the last thing the user said', () => {
  const items = [
    { kind: 'user', text: 'first' },
    { kind: 'assistant', text: 'old answer' },
    { kind: 'user', text: 'second' },
    { kind: 'assistant', text: 'Let me look.' },
    { kind: 'tool', text: '' },
    { kind: 'assistant', text: ' The answer. ' },
    { kind: 'notice', text: 'Plan mode: …' },
  ];
  assert.equal(latestReply(items), 'The answer.');
  assert.equal(latestReply([...items, { kind: 'user', text: 'third' }]), '', 'nothing yet for the newest question');
  assert.equal(latestReply([]), '');
});

test('a reply is said without code, markdown signs or addresses', () => {
  const said = speakable('## Plan\nUse **magic links** in `src/auth.mjs`, see [the docs](https://x.y/z) or https://a.b/c.\n```js\nconst a = 1;\n```\n- one\n- two\n| a | b |\n|---|---|');
  assert.equal(said, 'Plan\nUse magic links in src/auth.mjs, see the docs or a link.\n(the code is on the screen)\none\ntwo');
  assert.equal(speakable('1. First step\n2. Second'), '1. First step\n2. Second', 'numbers stay, as they are said');
  assert.equal(speakable(null), '');
});

test('a reply is read in pieces of about a sentence, a long one cut at a comma or a space', () => {
  assert.deepEqual(sentences('One. Two? Three!\nFour'), ['One.', 'Two?', 'Three!', 'Four']);
  const long = `${'word '.repeat(60)}end.`;
  const parts = sentences(long, 100);
  assert.ok(parts.every((p) => p.length <= 100));
  assert.equal(parts.join(' '), long.trim());
});

test('Indonesian replies are read in an Indonesian voice, others in English', () => {
  assert.equal(speechLang('Bisa. Sekarang auth.mjs masih pakai password, jadi kita perlu kirim email dulu.'), 'id-ID');
  assert.equal(speechLang('Sure. The login still uses a password, so we need to send email first.'), 'en-US');
  assert.equal(speechLang(''), 'en-US');
  const voices = [
    { name: 'Samantha', lang: 'en-US', localService: true },
    { name: 'Google Bahasa', lang: 'id-ID', localService: false },
    { name: 'Damayanti', lang: 'id_ID', localService: true },
  ];
  assert.equal(pickVoice(voices, 'id-ID').name, 'Damayanti', 'the device’s own voice first');
  assert.equal(pickVoice(voices, 'en-GB').name, 'Samantha', 'same language, another country');
  assert.equal(pickVoice(voices, 'fr-FR'), null);
});

test('a numbered list of two or more steps is a plan to run; anything else is not', () => {
  assert.deepEqual(planIn('Here is the plan:\n1. Add the **magic_links** table\n2) Route `/auth/magic`\n3. Tests\nTap Run.'), ['Add the magic_links table', 'Route /auth/magic', 'Tests']);
  assert.deepEqual(planIn('1. Only one step'), []);
  assert.deepEqual(planIn('No plan here.'), []);
});
