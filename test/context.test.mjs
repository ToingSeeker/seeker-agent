// /context and /usage: what fills the conversation and what has been spent, said in the terminal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// The ledger these commands read lives under SEEKER_HOME: a scratch one, set before anything loads.
process.env.SEEKER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-ctx-home-'));
const { Agent } = await import('../src/agent.mjs');
const { runCommand, runPhoneCommand } = await import('../src/commands.mjs');
const { DEFAULTS } = await import('../src/config.mjs');
const { Permissions } = await import('../src/permissions.mjs');
const { createProvider } = await import('../src/providers.mjs');
const { recordUsage } = await import('../src/usage.mjs');

const plain = new Proxy({}, { get: () => (x) => String(x) });
function setup() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-ctx-'));
  const lines = [];
  const ui = new Proxy({}, { get: (_, key) => (key === 'c' ? plain : key === 'screen' ? undefined : key === 'answerStream' ? () => ({ push() {}, flush() {} }) : (text) => void lines.push(String(text ?? ''))) });
  const config = { ...DEFAULTS, host: 'http://127.0.0.1:9', review: false };
  const permissions = new Permissions({ mode: 'ask', cwd, ask: null });
  const agent = new Agent({ config, ui, permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, vision: true, context: null }, cwd });
  return { agent, lines, ctx: { agent, ui, term: null, config, permissions, session: null, hub: null } };
}

test('/context: the parts add up to what is in use, and nothing is hidden in the total', async () => {
  const { agent, lines, ctx } = setup();
  agent.messages = [
    { role: 'user', content: '[The earlier conversation was replaced by this summary.] ' + 's'.repeat(700), compacted: true, task: 'x' },
    { role: 'user', content: 'u'.repeat(3500), images: [{ name: 'a.png', mime: 'image/png', data: 'AAAA' }] },
    { role: 'assistant', content: 'a'.repeat(7000), tool_calls: [{ id: '1', function: { name: 'read_file', arguments: { path: 'a.js' } } }] },
    { role: 'tool', tool_call_id: '1', tool_name: 'read_file', content: 't'.repeat(35_000) },
  ];
  const b = agent.contextBreakdown();
  const by = Object.fromEntries(b.parts.map((p) => [p.key, p.tokens]));
  assert.deepEqual(Object.keys(by), ['system', 'tools', 'summary', 'user', 'assistant', 'tool', 'images']);
  assert.equal(by.images, 1500, 'a picture counts as a fixed amount');
  assert.ok(by.tool > 9900 && by.tool < 10_200 && by.assistant > 2000 && by.user > 1000 && by.summary > 200);
  const sum = b.parts.reduce((n, p) => n + p.tokens, 0);
  assert.ok(Math.abs(sum - b.used) <= b.parts.length, `the parts (${sum}) are the total (${b.used}), within rounding`);
  assert.deepEqual([b.limit, b.ceiling, b.messages], [32768, Math.round(32768 * 0.8), 4]);

  // The model counted more than the text suggests: the difference is shown, not swallowed.
  agent.usedTokens = b.used + 5000;
  const more = agent.contextBreakdown();
  assert.equal(more.parts.at(-1).key, 'uncounted');
  assert.ok(Math.abs(more.parts.at(-1).tokens - 5000) <= more.parts.length);
  assert.equal(more.used, b.used + 5000);

  agent.usedTokens = 0;
  await runCommand('/context', ctx);
  assert.match(lines[0], /of 32k tokens/);
  assert.ok(lines.some((l) => /Tool results\s+\d+\.\dk\s+\d+%\s+█+/.test(l)));
  assert.ok(lines.some((l) => /^\s+Free\s/.test(l)));
  assert.ok(lines.some((l) => /Summarised at 26\.2k tokens/.test(l)));
  lines.length = 0;
  agent.usedTokens = 30_000;
  await runCommand('/context', ctx);
  assert.ok(lines.some((l) => /Over 26\.2k: the conversation is summarised at the next step/.test(l)));
});

test('/usage: totals, the cached share and the days, from the ledger on this machine', async () => {
  const { lines, ctx } = setup();
  await runCommand('/usage', ctx);
  assert.match(lines.at(-1), /No token usage recorded yet/);

  const day = 86_400_000;
  recordUsage({ input: 1_000_000, cached: 900_000, written: 50_000, output: 20_000 }, { now: Date.now() - 2 * day });
  recordUsage({ input: 400_000, cached: 300_000, output: 5000 }, { now: Date.now() });
  lines.length = 0;
  await runCommand('/usage', ctx);
  const text = lines.join('\n');
  assert.match(text, /1\.4M tokens \(1,425,000\)/, 'input + output; cached input is inside input');
  assert.match(text, /new input\s+200\.0K/);
  assert.match(text, /cached input\s+1\.2M\s+85\.7% of input/);
  assert.match(text, /cache writes\s+50\.0K/);
  assert.match(text, /replies\s+2/);
  assert.match(text, /Today\s+405\.0K\s+█+/);
  assert.match(text, /Yesterday\s+0\s*$/m, 'a tracked day without use is a real zero');
  assert.equal((text.match(/not recorded/g) ?? []).length, 4, 'days before counting began are not called zero');
  // Both commands answer from the phone as well.
  lines.length = 0;
  await runPhoneCommand('/usage', ctx);
  await runPhoneCommand('/context', ctx);
  assert.ok(lines.some((l) => /tokens \(1,425,000\)/.test(l)) && lines.some((l) => /Free/.test(l)));
});
