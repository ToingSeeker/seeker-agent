// The phone's agent characters: which one each model gets, the phone's setting, and the drawing itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS, CHOICES, FACES, characterFor, characterLabel, characterSettingFor, drawCharacter, pickCharacter, readProjectCharacters } from '../remote-server/public/characters.js';
import { MOODS } from '../remote-server/public/robot.js';

test('characters: each model family gets its own, by the model name first', () => {
  const cases = [
    ['claude-opus-5-5', 'Claude Code', 'sage', 'opus'],
    ['claude-sonnet-5-5', 'Anthropic', 'sage', 'sonnet'],
    ['haiku', 'Claude Code', 'sage', 'haiku'],
    ['claude-fable-5-2', 'Claude Code', 'sage', 'fable'],
    ['default', 'Claude Code', 'sage', null],
    ['gpt-5.2', 'OpenAI', 'nova', null],
    ['o4-mini', 'OpenAI', 'nova', null],
    ['gpt-oss:20b', 'Ollama', 'nova', null],
    ['gemini-2.5-pro', 'Google', 'twin', null],
    ['gemma3:12b', 'Ollama', 'twin', null],
    ['llama3.2', 'Ollama', 'lama', null],
    ['codellama:7b', 'Ollama', 'lama', null],
    ['qwen3.5:27b', 'Ollama', 'kit', null],
    ['qwen2.5-coder:32b', 'Ollama', 'kit', null],
    ['deepseek-r1:14b', 'Ollama', 'abyss', null],
    ['devstral', 'Ollama', 'gust', null],
    ['mistral-small3.2', 'Ollama', 'gust', null],
    ['phi4', 'Ollama', 'byte', null],
    ['granite3.3', 'LM Studio', 'byte', null],
    ['', '', 'byte', null],
    [undefined, undefined, 'byte', null],
  ];
  for (const [model, provider, id, tier] of cases) assert.deepEqual(characterFor(model, provider), { id, tier }, `${model} on ${provider}`);
});

test('characters: Ollama is not a llama, and a coder model is not o-series', () => {
  assert.equal(characterFor('phi4', 'Ollama').id, 'byte', 'the provider name alone says nothing about the family');
  assert.equal(characterFor('qwen3-coder:30b', 'Ollama').id, 'kit');
  assert.equal(characterFor('yi-coder:9b', 'Ollama').id, 'byte');
});

test('characters: the phone setting picks auto, one for all, or the SEEKER robot', () => {
  assert.deepEqual(pickCharacter('auto', 'claude-opus-5-5', 'Claude Code'), { id: 'sage', tier: 'opus' });
  assert.deepEqual(pickCharacter(undefined, 'qwen3.5:27b', 'Ollama'), { id: 'kit', tier: null });
  assert.equal(pickCharacter('seeker', 'claude-opus-5-5', 'Claude Code'), null);
  assert.deepEqual(pickCharacter('nova', 'claude-opus-5-5', 'Claude Code'), { id: 'nova', tier: null }, 'a tier only fits its own family');
  assert.deepEqual(pickCharacter('sage', 'claude-haiku-4', 'Claude Code'), { id: 'sage', tier: 'haiku' });
  assert.deepEqual(pickCharacter('gone-in-a-newer-version', 'gpt-5', 'OpenAI'), { id: 'nova', tier: null }, 'an unknown stored choice falls back to auto');
  assert.deepEqual(CHOICES, ['auto', ...Object.keys(CHARACTERS), 'seeker']);
});

test('characters: the label names the character and its tier', () => {
  assert.equal(characterLabel({ id: 'sage', tier: 'opus' }), 'Sage · Opus');
  assert.equal(characterLabel({ id: 'kit', tier: null }), 'Kit');
  assert.equal(characterLabel(null), '');
});

test('characters: every character draws every mood, with ids that never clash on one page', () => {
  for (const mood of Object.keys(MOODS)) assert.ok(FACES[mood], `a face for ${mood}`);
  const ids = new Set();
  for (const id of Object.keys(CHARACTERS)) {
    for (const face of new Set(Object.values(FACES))) {
      const svg = drawCharacter({ id, tier: id === 'sage' ? 'opus' : null }, { face });
      assert.match(svg, /^<svg class="char" viewBox="0 0 120 120" aria-hidden="true">[\s\S]*<\/svg>$/);
      assert.doesNotMatch(svg, /undefined|NaN/, `${id} ${face}`);
      for (const [, defined] of svg.matchAll(/ id="([^"]+)"/g)) {
        assert.ok(!ids.has(defined), `id ${defined} is used once`);
        ids.add(defined);
      }
    }
  }
});

test('characters: nothing outside the fixed drawings reaches the SVG', () => {
  const svg = drawCharacter({ id: '<script>', tier: '"><img onerror=x>' }, { face: '<b>' });
  assert.doesNotMatch(svg, /script|onerror|<b>/);
  assert.match(svg, /fill="url\(#ch\d+s\)"/, 'an unknown id draws Byte');
});

test('characters: a project can have its own, and one without follows the phone setting', () => {
  const byProject = { '~/shop': 'gust', '~/blog': 'seeker' };
  assert.equal(characterSettingFor('auto', byProject, '~/shop'), 'gust');
  assert.equal(characterSettingFor('auto', byProject, '~/blog'), 'seeker');
  assert.equal(characterSettingFor('kit', byProject, '~/other'), 'kit', 'not listed: the phone setting');
  assert.equal(characterSettingFor('auto', byProject, undefined), 'auto');
  assert.equal(characterSettingFor('auto', { '~/x': 'dragon' }, '~/x'), 'auto', 'an unknown choice counts as none');
  assert.equal(characterSettingFor('auto', {}, 'toString'), 'auto', 'inherited names are not choices');
  // Two projects on the same model can now look different.
  assert.deepEqual(pickCharacter(characterSettingFor('auto', byProject, '~/shop'), 'qwen3.5:27b', 'Ollama'), { id: 'gust', tier: null });
  assert.deepEqual(pickCharacter(characterSettingFor('auto', byProject, '~/other'), 'qwen3.5:27b', 'Ollama'), { id: 'kit', tier: null });

  assert.deepEqual(readProjectCharacters(JSON.stringify({ '~/a': 'sage', '~/b': 'nope', '~/c': 3 })), { '~/a': 'sage' });
  for (const bad of ['not json', '[]', 'null', '"x"', undefined]) assert.deepEqual(readProjectCharacters(bad), {}, String(bad));
});
