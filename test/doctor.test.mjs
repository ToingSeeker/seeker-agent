// `seeker doctor`: each thing SEEKER needs is checked, and what is wrong comes with how to fix it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS } from '../src/config.mjs';
import { diagnose, report } from '../src/doctor.mjs';

const files = { config: '/h/.seeker/config.json', usage: '/h/.seeker/usage.json', link: '/h/.seeker/remote.sock', home: '/h/.seeker' };
/** A machine where everything is in place; each test breaks one thing. */
const healthy = (over = {}) => ({
  nodeVersion: () => '22.11.0',
  has: async () => true,
  mode: () => 0o600,
  get: async (url) => (url.endsWith('/api/tags') ? { ok: true, status: 200, json: { models: [{ name: DEFAULTS.model }] } } : { ok: true, status: 200, json: null }),
  listening: async () => true,
  resolves: () => true,
  ...over,
});
const run = (config = {}, probes = {}) => diagnose({ config: { ...DEFAULTS, ...config }, probes: healthy(probes), files });
const find = (results, name) => results.find((r) => r.name === name);

test('doctor: a machine with everything in place has nothing to fix', async () => {
  const results = await run({ remote: { url: 'https://relay.example', secret: 'never-shown-secret' } });
  assert.deepEqual([...new Set(results.map((r) => r.level))], ['ok']);
  const text = report(results).join('\n');
  assert.match(text, /Everything SEEKER needs is in place\./);
  assert.match(text, /✓ Relay\s+https:\/\/relay\.example answers/);
  assert.doesNotMatch(text, /never-shown-secret/, 'no secret is printed');
});

test('doctor: each problem is named with what to do about it', async () => {
  assert.deepEqual(find(await run({}, { nodeVersion: () => '20.9.0' }), 'Node'), { level: 'fail', name: 'Node', detail: 'v20.9.0 is too old', fix: 'SEEKER needs Node 22 or newer.' });
  assert.equal(find(await run({}, { has: async (p) => p !== 'git' }), 'git').level, 'warn');
  assert.match(find(await run({}, { resolves: (n) => n !== '@anthropic-ai/sdk' }), 'Packages').detail, /not installed: @anthropic-ai\/sdk$/);
  assert.match(find(await run({}, { mode: (f) => (f === files.config ? 0o644 : 0o600) }), 'Settings').fix, /^chmod 600 /);
  assert.equal(find(await run({}, { mode: () => null }), 'Settings').level, 'info', 'no settings file is not a fault');
  assert.match(find(await run({}, { mode: (f) => (f === files.usage ? 0o644 : 0o600) }), 'Token ledger').fix, /usage\.json$/);

  const down = find(await run({}, { get: async () => ({ ok: false, error: 'ECONNREFUSED' }) }), 'Provider');
  assert.deepEqual([down.level, /ollama serve/.test(down.fix)], ['fail', true]);
  const noModel = find(await run({ model: 'not-here:1b' }), 'Provider');
  assert.match(noModel.fix, /^ollama pull not-here:1b/);
  const noKey = find(await run({ provider: 'openai', model: 'gpt-x' }), 'Provider');
  assert.deepEqual([noKey.level, noKey.detail], ['fail', 'OpenAI has no API key']);
  const keyed = find(await run({ provider: 'openai', model: 'gpt-x', providers: { openai: { apiKey: 'sk-secret-value' } } }), 'Provider');
  assert.equal(keyed.level, 'ok');
  assert.doesNotMatch(keyed.detail, /sk-secret-value/);
  assert.equal(find(await run({ provider: 'nope' }), 'Provider').level, 'fail');
  assert.match(find(await run({ fallback: [{ provider: 'typo', model: 'x' }] }), 'Backup models').detail, /unknown provider in "fallback": typo/);

  const noRemote = await run();
  assert.deepEqual([find(noRemote, 'Remote').level, find(noRemote, 'Relay')], ['info', undefined]);
  const relayDown = await run({ remote: { url: 'https://relay.example', secret: 's' } }, { get: async (url) => (url.includes('relay') ? { ok: false, status: 502 } : { ok: true, status: 200, json: { models: [{ name: DEFAULTS.model }] } }), listening: async () => false });
  assert.match(find(relayDown, 'Relay').detail, /does not answer \(HTTP 502\)/);
  assert.equal(find(relayDown, 'Remote daemon').level, 'info');

  const text = report(await run({}, { nodeVersion: () => '18.0.0', has: async (p) => p !== 'git' })).join('\n');
  assert.match(text, /✗ Node/);
  assert.match(text, /→ SEEKER needs Node 22 or newer\./);
  assert.match(text, /1 problem to fix, 1 to look at\./);
  assert.match(report(await run({}, { has: async (p) => p !== 'git' })).join('\n'), /Nothing is broken; 1 thing to look at\./);
});
