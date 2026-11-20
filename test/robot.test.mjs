// The phone's robot: which mood each report from the Mac shows, how long a mood stays, and the number on the app's icon.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOLD, MOODS, SUCCESS_FOR, Steady, badgeCount, mood } from '../remote-server/public/robot.js';

const NOW = Date.UTC(2026, 10, 20, 9);
const ws = (meta = {}) => ({ meta: { id: 'a', name: 'a', status: 'idle', outcome: null, lastAt: NOW - 60_000, ...meta } });

test('robot: each mood comes from what the Mac reported, and without the Mac it says disconnected', () => {
  const at = { now: NOW };
  assert.equal(mood(ws(), at), 'idle');
  assert.equal(mood(null, at), 'idle', 'no session yet');
  assert.equal(mood(ws({ status: 'working', phase: 'thinking' }), at), 'thinking');
  assert.equal(mood(ws({ status: 'working', phase: 'responding' }), at), 'thinking', 'writing its answer is still the model at work, not a tool');
  assert.equal(mood(ws({ status: 'working', phase: 'executing', tools: { running: 'Editing src/app.js' } }), at), 'coding');
  assert.equal(mood(ws({ status: 'working', phase: 'executing', tools: { running: 'Writing notes.md' } }), at), 'coding');
  assert.equal(mood(ws({ status: 'working', phase: 'executing', tools: { running: 'Running npm test' } }), at), 'executing');
  assert.equal(mood(ws({ status: 'working', phase: 'executing', tools: { running: null } }), at), 'executing');
  assert.equal(mood(ws({ status: 'approval' }), at), 'awaiting_approval');
  assert.equal(mood(ws({ outcome: 'failed' }), at), 'error');
  assert.equal(mood(ws({ outcome: 'completed', lastAt: NOW - 2_000 }), at), 'success', 'just finished');
  assert.equal(mood(ws({ outcome: 'completed', lastAt: NOW - SUCCESS_FOR - 1 }), at), 'idle', 'the celebration is brief');
  assert.equal(mood(ws({ outcome: 'stopped' }), at), 'idle');
  assert.equal(mood(ws({ status: 'working', phase: 'thinking' }), { up: false, now: NOW }), 'disconnected', 'a phone without the Mac cannot confirm the agent is working');
  for (const key of ['idle', 'thinking', 'coding', 'executing', 'awaiting_approval', 'success', 'error', 'disconnected']) assert.ok(MOODS[key], key);
});

test('robot: a mood stays long enough to be seen, except waiting for the user and losing the Mac', () => {
  const steady = new Steady();
  assert.deepEqual(steady.next('hero', 'thinking', 0), { mood: 'thinking', at: null });
  assert.deepEqual(steady.next('hero', 'executing', 100), { mood: 'thinking', at: HOLD }, 'held back, with when to look again');
  assert.deepEqual(steady.next('hero', 'executing', HOLD), { mood: 'executing', at: null });
  assert.deepEqual(steady.next('hero', 'awaiting_approval', HOLD + 10), { mood: 'awaiting_approval', at: null }, 'an approval shows at once');
  assert.deepEqual(steady.next('hero', 'disconnected', HOLD + 20), { mood: 'disconnected', at: null });
  assert.deepEqual(steady.next('other', 'idle', HOLD + 30), { mood: 'idle', at: null }, 'each robot keeps its own');
});

test('badge: counts what waits for the user, never work in progress or terminal sessions', () => {
  const approvals = [{ id: 'x' }, { id: 'y' }];
  const list = [ws({ unread: 'failed' }), ws({ unread: 'completed' }), ws({ status: 'working' }), ws({ unread: null }), ws({ unread: 'completed', terminal: true })];
  assert.equal(badgeCount({ approvals, workspaces: list }), 4);
  assert.equal(badgeCount({ approvals: [], workspaces: [ws({ status: 'working' })] }), 0);
  assert.equal(badgeCount({}), 0);
});
