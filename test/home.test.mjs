// The phone's Home: what the Control Center says, and what the Workspace Explorer lists.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activity, connection, current, localFolders, preview, summary, workspaces } from '../remote-server/public/home.js';

const NOW = Date.UTC(2026, 10, 15, 12);
const MIN = 60_000;
const HOUR = 60 * MIN;
const ws = (id, name, meta = {}, items = []) => ({ meta: { id, name, path: `~/${name}`, branch: 'main', provider: 'Claude Code', status: 'idle', outcome: null, ...meta }, items, queue: { items: [], paused: null } });
const user = (text, at) => ({ kind: 'user', text, at });
const said = (text, at) => ({ kind: 'assistant', text, at });
const tool = (at) => ({ kind: 'tool', at });

test('home: a finished session is recent activity, never current', () => {
  const done = ws('a', 'nebulaflow', { outcome: 'completed', lastAt: NOW - 5 * MIN }, [user('merge it', NOW - 9 * MIN), said('PR #227 merged.', NOW - 5 * MIN)]);
  const older = ws('b', 'shuttershoot', { outcome: 'completed', lastAt: NOW - 12 * HOUR }, [said('done', NOW - 12 * HOUR)]);
  const unused = ws('c', 'seeker');
  assert.equal(current([]), null);
  assert.equal(current([unused]), null, 'a project nothing has run in is not activity');
  assert.deepEqual([current([older, done, unused]).ws.meta.id, current([older, done, unused]).live], ['a', false], 'the one used last');
  const running = ws('d', 'Ovrint', { status: 'working', lastAt: NOW - HOUR });
  assert.deepEqual([current([done, running]).ws.meta.id, current([done, running]).live], ['d', true], 'a running task comes first, however long ago it started');
  const asking = ws('e', 'toingseeker', { status: 'approval', lastAt: NOW - 2 * HOUR });
  assert.equal(current([running, asking, done]).ws.meta.id, 'e', 'one that waits for the user comes before one that runs');
});

test('home: the line under the project says what is happening, or how it ended', () => {
  assert.equal(summary(ws('a', 'a', { status: 'working', activity: 'Running  npm test' })), 'Running npm test');
  assert.equal(summary(ws('a', 'a', { status: 'working', activity: '' }, [said('old answer', 1)])), '', 'while it works, an earlier answer is not passed off as the present');
  assert.equal(summary(ws('a', 'a', { status: 'approval' })), 'Waiting for your approval.');
  assert.equal(summary(ws('a', 'a', { outcome: 'completed' }, [user('do it', 1), said('## Done\n\n**PR #227** merged and `deployed`.', 2)])), 'Done PR #227 merged and deployed.');
  assert.equal(summary(ws('a', 'a', { outcome: 'failed' }, [said('trying', 1), { kind: 'notice', level: 'error', text: 'The model did not answer.', at: 2 }])), 'The model did not answer.');
  assert.equal(summary(ws('a', 'a', { outcome: 'stopped' }, [user('rename the file', 1)])), 'rename the file', 'no answer yet: the instruction itself');
  assert.equal(summary(ws('a', 'a')), '', 'nothing to say is nothing, not a placeholder');
});

test('home: a preview is plain text, short, and leaves words alone', () => {
  assert.equal(preview('# Title\n\n- one\n- **two**\n\n```js\nconst a = 1;\n```\nSee [the docs](https://example.com) and `x_y`.'), 'Title one two const a = 1; See the docs and x_y.');
  assert.equal(preview('1. first\n2. second\n> quoted'), 'first second quoted');
  assert.equal(preview('| a | b |\n|---|---|\n| 1 | 2 |'), '| a | b | | 1 | 2 |');
  assert.equal(preview('snake_case_name and 2 * 3 * 4 stay'), 'snake_case_name and 2 * 3 * 4 stay');
  assert.equal(preview('an *emphasised* word'), 'an emphasised word');
  const long = preview('word '.repeat(200), 50);
  assert.ok(long.length <= 50 && long.endsWith('…'));
  assert.equal(preview(null), '');
});

test('home: the connection is called online only when the Mac is there now', () => {
  assert.equal(connection({ linked: true, online: true, everLinked: true }).label, 'Online');
  assert.equal(connection({ linked: true, online: false, everLinked: true }).label, 'Offline');
  assert.equal(connection({ linked: false, online: false, everLinked: false }).label, 'Connecting');
  assert.equal(connection({ linked: false, online: true, everLinked: true }).label, 'Reconnecting', 'what the relay said before the link dropped is not trusted');
});

test('home: the last 24 hours are counted from the conversations', () => {
  const list = [
    ws('a', 'nebulaflow', { outcome: 'completed', lastAt: NOW - 5 * MIN, tools: { total: 3 } }, [user('go', NOW - HOUR), tool(NOW - 50 * MIN), tool(NOW - 40 * MIN), tool(NOW - 30 * MIN), said('ok', NOW - 5 * MIN)]),
    ws('b', 'shuttershoot', { outcome: 'completed', lastAt: NOW - 30 * HOUR, tools: { total: 2 } }, [tool(NOW - 31 * HOUR), tool(NOW - 30 * HOUR)]),
    ws('c', 'Ovrint', { status: 'working', outcome: 'completed', lastAt: NOW - MIN, tools: { total: 1 } }, [user('again', NOW - 2 * MIN), tool(NOW - MIN)]),
    ws('d', 'seeker'),
    ws('e', 'failed-one', { outcome: 'failed', lastAt: NOW - 2 * HOUR }, [user('x', NOW - 2 * HOUR)]),
  ];
  assert.deepEqual(activity(list, NOW), { sessions: 3, tools: 4, toolsMore: false, completed: 1 }, 'yesterday, the unused project and the task still running are not counted');
  assert.deepEqual(activity([], NOW), { sessions: 0, tools: 0, toolsMore: false, completed: 0 });
  // A long conversation: the Mac counted 900 tool runs but holds only the latest part, all of it from today.
  const long = ws('f', 'long', { outcome: 'completed', lastAt: NOW, tools: { total: 900 } }, [tool(NOW - 3 * MIN), tool(NOW - 2 * MIN)]);
  assert.deepEqual(activity([long], NOW), { sessions: 1, tools: 2, toolsMore: true, completed: 1 }, 'said as "2+", not as 2');
  // Held part reaches back past the window: everything in the window is in view, so the count is exact.
  const old = ws('g', 'old', { outcome: 'completed', lastAt: NOW, tools: { total: 900 } }, [tool(NOW - 40 * HOUR), tool(NOW - 2 * MIN)]);
  assert.equal(activity([old], NOW).toolsMore, false);
});

test('explorer: workspaces are searched by name, folder and branch, and sorted as asked', () => {
  const list = [
    ws('a', 'seeker', {}),
    ws('b', 'Ovrint', { branch: 'chore/deps-major-security' }),
    ws('c', 'nebulaflow', { outcome: 'completed', lastAt: NOW - 5 * MIN }),
    ws('d', 'shuttershoot', { path: '~', branch: 'redesign/soft-palette-v1', outcome: 'completed', lastAt: NOW - 12 * HOUR }),
    ws('e', 'toingseeker', { status: 'working', lastAt: NOW - HOUR, terminal: true }),
  ];
  const names = (opts) => workspaces(list, opts).map((r) => r.name);
  assert.deepEqual(names(), ['nebulaflow', 'toingseeker', 'shuttershoot', 'Ovrint', 'seeker'], 'recently active first; never used last, by name');
  assert.deepEqual(names({ sort: 'az' }), ['nebulaflow', 'Ovrint', 'seeker', 'shuttershoot', 'toingseeker']);
  assert.deepEqual(names({ sort: 'za' }), ['toingseeker', 'shuttershoot', 'seeker', 'Ovrint', 'nebulaflow']);
  assert.deepEqual(names({ sort: 'status' }), ['toingseeker', 'nebulaflow', 'shuttershoot', 'Ovrint', 'seeker']);
  assert.deepEqual(names({ sort: 'unknown' }), names());
  assert.deepEqual(names({ query: 'SEEKER' }), ['toingseeker', 'seeker'], 'any case');
  assert.deepEqual(names({ query: 'deps' }), ['Ovrint'], 'the branch');
  assert.deepEqual(names({ query: '~/neb' }), ['nebulaflow'], 'the folder');
  assert.deepEqual(names({ query: 'soft seeker' }), [], 'every word must match');
  assert.deepEqual(names({ source: 'terminal' }), ['toingseeker']);
  assert.deepEqual(names({ source: 'remote', query: 'seeker' }), ['seeker']);
  assert.deepEqual(workspaces(list)[1], { id: 'e', name: 'toingseeker', path: '~/toingseeker', branch: 'main', terminal: true, status: 'running', at: NOW - HOUR });
});

test('explorer: a folder that is already open is not offered again', () => {
  const list = [ws('a', 'seeker'), ws('b', 'Ovrint')];
  const folders = ['~/Aksylo', '~/helix', '~/Ovrint', '~/seeker', '~/helix'];
  assert.deepEqual(localFolders(folders, list), { total: 2, rows: [{ path: '~/Aksylo', name: 'Aksylo' }, { path: '~/helix', name: 'helix' }] });
  assert.deepEqual(localFolders(folders, list, 'HEL'), { total: 2, rows: [{ path: '~/helix', name: 'helix' }] }, 'the count stays the whole list while searching');
  assert.deepEqual(localFolders(['~/seeker'], list), { total: 0, rows: [] });
  assert.deepEqual(localFolders([], []), { total: 0, rows: [] });
});
