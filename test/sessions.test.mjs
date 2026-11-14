// The phone's Sessions list: what a row says, which rows a search and a filter leave, and their order.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, filters, matches, since, statusOf, view } from '../remote-server/public/sessions.js';

const NOW = Date.UTC(2026, 10, 15, 12);
const MIN = 60_000;
const ws = (id, name, meta = {}, items = [], queue = { items: [], paused: null }) => ({ meta: { id, name, path: `/Users/me/${name}`, model: 'opus', status: 'idle', outcome: null, ...meta }, items, queue });
const user = (text, at) => ({ kind: 'user', text, at });
const tool = (at) => ({ kind: 'tool', name: 'bash', at });

const LIST = [
  ws('a1', 'nebulaflow', { status: 'working', phase: 'thinking', lastAt: NOW - MIN, tools: { total: 207 } }, [user('commit lalu buat PR dan merge', NOW - 2 * MIN)]),
  ws('b2', 'shuttershoot', { outcome: 'completed', lastAt: NOW - 12 * 60 * MIN, tools: { total: 387 }, model: 'qwen3.5:27b' }, [user('commit merge lalu\n  railway up', NOW - 13 * 60 * MIN)]),
  ws('c3', 'seeker', { tools: { total: 0 } }),
  ws('d4', 'Ovrint'),
  ws('e5', 'toingseeker', { outcome: 'failed', lastAt: NOW - 30 * 60 * MIN }, [user('run the tests', NOW - 31 * 60 * MIN), tool(NOW - 30 * 60 * MIN)]),
];

test('sessions: a row states what the Mac reported and leaves out what it did not', () => {
  const [running, done, idle, bare, failed] = LIST.map(describe);
  assert.deepEqual(running, { id: 'a1', name: 'nebulaflow', path: '/Users/me/nebulaflow', status: 'running', task: 'commit lalu buat PR dan merge', model: 'opus', tools: 207, at: NOW - MIN });
  assert.equal(done.task, 'commit merge lalu railway up', 'the latest instruction, on one line');
  assert.equal(done.model, 'qwen3.5:27b', 'each session shows its own model');
  assert.equal(idle.tools, 0, 'a count the Mac gave is shown, zero included');
  assert.deepEqual([bare.tools, bare.task, bare.at], [null, '', 0], 'nothing counted, nothing said, never used');
  assert.equal(failed.tools, 1, 'without a total from the Mac, the tool runs in the conversation are counted');
});

test('sessions: the status comes from the agent state, the queue and the last outcome', () => {
  assert.equal(statusOf(ws('x', 'x', { status: 'approval', outcome: 'completed' })), 'approval');
  assert.equal(statusOf(ws('x', 'x', { status: 'working', phase: 'responding' })), 'running');
  assert.equal(statusOf(ws('x', 'x', { outcome: 'stopped' }, [], { items: [{ id: 'q', text: 'next' }], paused: 'stopped' })), 'queued', 'instructions wait while nothing runs');
  assert.equal(statusOf(ws('x', 'x', { status: 'working' }, [], { items: [{ id: 'q', text: 'next' }], paused: null })), 'running', 'a running task is running, whatever waits behind it');
  assert.equal(statusOf(ws('x', 'x', { outcome: 'stopped' })), 'stopped');
  assert.equal(statusOf(ws('x', 'x', { outcome: 'something new' })), 'idle', 'an outcome this app does not know is not guessed at');
  assert.equal(statusOf({ meta: { status: 'idle' } }), 'idle', 'a daemon that sends no queue');
});

test('sessions: search looks at the project, its folder, the latest instruction, the model and the id', () => {
  const names = (query) => view(LIST, { query }).rows.map((r) => r.name);
  assert.deepEqual(names('NEBULA'), ['nebulaflow'], 'project name, any case');
  assert.deepEqual(names('railway'), ['shuttershoot'], 'the latest instruction');
  assert.deepEqual(names('qwen'), ['shuttershoot'], 'the model');
  assert.deepEqual(names('e5'), ['toingseeker'], 'the session id');
  assert.deepEqual(names('commit merge'), ['nebulaflow', 'shuttershoot'], 'every word must appear, in any order');
  assert.deepEqual(names('nothing like this'), []);
  assert.equal(matches(describe(LIST[0]), '   '), true, 'an empty search keeps everything');
});

test('sessions: the filters carry real counts, and follow the search', () => {
  const all = view(LIST);
  assert.deepEqual(all.count, { all: 5, approval: 0, running: 1, queued: 0, failed: 1, stopped: 0, completed: 1, idle: 2 });
  assert.deepEqual(filters(all.count, 'all'), [['all', 'All', 5], ['running', 'Running', 1], ['failed', 'Failed', 1], ['completed', 'Completed', 1], ['idle', 'Idle', 2]], 'a state nobody is in is not offered, except the usual three');
  assert.deepEqual(view(LIST, { filter: 'idle' }).rows.map((r) => r.name), ['Ovrint', 'seeker']);
  const searched = view(LIST, { query: 'seeker', filter: 'failed' });
  assert.deepEqual([searched.count.all, searched.count.idle, searched.count.failed, searched.total], [2, 1, 1, 5], 'counts are of what the search left');
  assert.deepEqual(searched.rows.map((r) => r.name), ['toingseeker']);
  // A filter whose last session moved on stays visible, with zero, instead of vanishing under the finger.
  assert.deepEqual(filters(view([LIST[2]]).count, 'failed').map(([key]) => key), ['all', 'running', 'failed', 'completed', 'idle']);
  assert.deepEqual(view(LIST, { filter: 'queued' }).rows, []);
});

test('sessions: a task that finishes moves from Running to Completed', () => {
  const list = structuredClone(LIST);
  assert.equal(view(list).count.running, 1);
  Object.assign(list[0].meta, { status: 'idle', phase: null, outcome: 'completed', lastAt: NOW });
  const after = view(list, { filter: 'completed' });
  assert.deepEqual([after.count.running, after.count.completed], [0, 2]);
  assert.deepEqual(after.rows.map((r) => r.name), ['nebulaflow', 'shuttershoot']);
});

test('sessions: each order is the one asked for, and ties always fall the same way', () => {
  const names = (sort, list = LIST) => view(list, { sort }).rows.map((r) => r.name);
  assert.deepEqual(names('recent'), ['nebulaflow', 'shuttershoot', 'toingseeker', 'Ovrint', 'seeker'], 'never-used sessions last, by name');
  assert.deepEqual(names('oldest'), ['Ovrint', 'seeker', 'toingseeker', 'shuttershoot', 'nebulaflow']);
  assert.deepEqual(names('name'), ['nebulaflow', 'Ovrint', 'seeker', 'shuttershoot', 'toingseeker'], 'capitals do not sort first');
  assert.deepEqual(names('status'), ['nebulaflow', 'toingseeker', 'shuttershoot', 'Ovrint', 'seeker'], 'what needs attention first');
  assert.deepEqual(names('recent', [...LIST].reverse()), names('recent'), 'the same whatever order they arrived in');
  // A running session is not pulled to the top of an order the user chose.
  assert.equal(names('name')[0] === 'nebulaflow' && names('oldest').at(-1) === 'nebulaflow', true);
  assert.deepEqual(names('no such order'), names('recent'));
  const twins = [ws('z9', 'same'), ws('a0', 'same')];
  assert.deepEqual(view(twins).rows.map((r) => r.id), ['a0', 'z9']);
});

test('sessions: a long list is filtered and ordered quickly', () => {
  const many = Array.from({ length: 2000 }, (_, i) => ws(`id${i}`, `project-${i % 97}-${'x'.repeat(i % 60)}`, { lastAt: NOW - i * MIN, outcome: i % 3 ? 'completed' : null }, [user(`task ${i}`, NOW - i * MIN)]));
  const started = performance.now();
  const out = view(many, { query: 'project-5', sort: 'status' });
  assert.ok(performance.now() - started < 500, 'well under a frame budget per hundred rows');
  assert.ok(out.rows.length > 0 && out.rows.length === out.count.all);
});

test('sessions: times are said the way people say them', () => {
  assert.equal(since(0, NOW), '', 'never used: nothing is shown');
  assert.equal(since(NOW - 5_000, NOW), 'Just now');
  assert.equal(since(NOW + 90_000, NOW), 'Just now', 'a Mac clock slightly ahead');
  assert.equal(since(NOW - MIN, NOW), '1m ago');
  assert.equal(since(NOW - 12 * 60 * MIN, NOW), '12h ago');
  assert.equal(since(NOW - 30 * 60 * MIN, NOW), 'Yesterday');
  assert.equal(since(NOW - 3 * 24 * 60 * MIN, NOW), '3d ago');
});
