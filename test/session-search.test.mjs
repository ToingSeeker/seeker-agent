import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseQuery, searchSessions } from '../src/session-search.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-sessions-'));
function save(folder, name, messages, daysAgo = 0) {
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  const file = path.join(dir, folder, `${name}.json`);
  const when = new Date(Date.now() - daysAgo * 86_400_000);
  fs.writeFileSync(file, JSON.stringify({ cwd: `/work/${folder}`, model: 'm', savedAt: when.toISOString(), messages }));
  fs.utimesSync(file, when, when);
  return file;
}
const u = (content) => ({ role: 'user', content });
const a = (content, tool_calls) => ({ role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) });

save('shop', 's1', [u('the checkout page crashes on Safari'), a('Looking.', [{ function: { name: 'grep', arguments: { pattern: 'checkout' } } }]), { role: 'tool', tool_name: 'grep', content: 'src/checkout.js:10: stripeWebhook()' }, a('Fixed: the stripe webhook secret was read from the wrong variable.'), u('thanks'), a('Done.')], 3);
save('shop', 's2', [u('add a dark theme'), a('Added a dark theme toggle in settings.')], 1);
const current = save('blog', 's3', [u('why did the stripe webhook fail last week?')], 0);
save('blog', 's4', Array.from({ length: 60 }, (_, i) => (i % 2 ? a(`answer ${i}`) : u(`question ${i}${i === 30 ? ' about railway deploys' : ''}`))), 10);

test('a query is read into AND groups, OR alternatives, phrases, exclusions and prefixes', () => {
  assert.deepEqual(parseQuery('stripe webhook OR "dark theme" -safari deploy*'), { groups: [['stripe', 'webhook'], ['dark theme', 'deploy']], exclude: ['safari'] });
  assert.deepEqual(parseQuery('NOT x').groups, []);
});

test('searching finds the conversation, opens up the best match and leaves the current one out', () => {
  const out = searchSessions({ query: 'stripe webhook' }, { dir, currentFile: current });
  assert.equal(out.success, true);
  assert.equal(out.results.length, 1, 'the current conversation is not a result');
  const [hit] = out.results;
  assert.equal(hit.session_id, 'shop/s1');
  assert.equal(hit.folder, '/work/shop');
  assert.equal(hit.title, 'the checkout page crashes on Safari');
  assert.match(hit.snippet, /stripe webhook secret/);
  assert.equal(hit.detail, 'full');
  assert.equal(hit.bookend_start[0].text, 'the checkout page crashes on Safari');
  assert.equal(hit.bookend_end.at(-1).text, 'Done.');
  assert.ok(hit.messages.some((m) => m.role === 'tool:grep'), 'the window around the hit shows tool output too');

  assert.equal(searchSessions({ query: 'stripe webhook', role_filter: 'user' }, { dir, currentFile: current }).results.length, 0);
  assert.equal(searchSessions({ query: 'stripewebhook', role_filter: 'tool' }, { dir }).results[0].session_id, 'shop/s1');
  const none = searchSessions({ query: 'kubernetes' }, { dir });
  assert.deepEqual(none.results, []);
  assert.match(none.message, /broaden with OR/);
});

test('OR, exclusion, time filters and sorting narrow the results', () => {
  const either = searchSessions({ query: 'stripe OR theme', limit: 5 }, { dir, currentFile: current });
  assert.deepEqual(either.results.map((r) => r.session_id).sort(), ['shop/s1', 'shop/s2']);
  assert.equal(either.results[1].detail, 'anchor', 'only the best match is opened up');
  assert.deepEqual(searchSessions({ query: 'stripe OR theme', sort: 'newest', limit: 5 }, { dir, currentFile: current }).results.map((r) => r.session_id), ['shop/s2', 'shop/s1']);
  assert.deepEqual(searchSessions({ query: 'stripe OR theme', after: '2d', limit: 5 }, { dir, currentFile: current }).results.map((r) => r.session_id), ['shop/s2']);
  assert.deepEqual(searchSessions({ query: 'stripe OR theme -dark', limit: 5 }, { dir, currentFile: current }).results.map((r) => r.session_id), ['shop/s1']);
});

test('a session can be read, scrolled and browsed', () => {
  const read = searchSessions({ session_id: 'blog/s4' }, { dir });
  assert.equal(read.messages.length, 30);
  assert.equal(read.omitted_in_the_middle, 30);
  assert.equal(read.messages[20].index, 50);

  const scroll = searchSessions({ session_id: 's4', around_message_index: 30, window: 2 }, { dir });
  assert.deepEqual(scroll.messages.map((m) => m.index), [28, 29, 30, 31, 32]);
  assert.match(scroll.messages[2].text, /railway deploys/);
  assert.equal(scroll.messages_before, 28);

  const recent = searchSessions({}, { dir, currentFile: current });
  assert.deepEqual(recent.recent_sessions.map((s) => s.session_id), ['shop/s2', 'shop/s1', 'blog/s4']);
  assert.equal(searchSessions({ session_id: 'nope' }, { dir }).success, false);
});
