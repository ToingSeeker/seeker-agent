// What keeps a long session from costing more than it has to: a smaller review, pictures of past
// turns let go, an earlier summary, a model of their own for helpers, and the cache settings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS, SETTINGS } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider, withoutReasoning } from '../src/providers.mjs';
import { reviewReplay } from '../src/review.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-sv-'));
const quietUi = (warnings = []) => new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : key === 'warn' ? (text) => warnings.push(text) : () => {}) });

/** A scripted stand-in for Ollama. Chat requests get the next reply; a model named "missing" does not exist. */
async function fakeOllama(replies) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const sent = body ? JSON.parse(body) : {};
      if (req.url === '/api/show') {
        if (sent.model === 'missing') return res.writeHead(404).end(JSON.stringify({ error: 'model not found' }));
        return res.end(JSON.stringify({ capabilities: ['completion', 'tools'] }));
      }
      requests.push(sent);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end((replies.shift() ?? [{ message: { content: 'out of script' }, done: true }]).map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { host: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}
const call = (name, args) => ({ message: { content: '', tool_calls: [{ function: { name, arguments: args } }] } });
const done = (content) => ({ message: { content }, done: true, prompt_eval_count: 10, eval_count: 5 });

function makeAgent(host, cwd, extra = {}, warnings = []) {
  const config = { ...DEFAULTS, host, review: false, ...extra };
  const permissions = new Permissions({ mode: 'auto', cwd, ask: null });
  return new Agent({ config, ui: quietUi(warnings), permissions, provider: createProvider('ollama', config), info: { tools: true, thinking: false, vision: true, context: null }, cwd });
}

const picture = { name: 'shot.png', mime: 'image/png', data: 'AAAA' };
const thought = { type: 'thinking', thinking: '', signature: 'sig' };

test('a review reads the recent part of the conversation, cut down, and always opens on a request', () => {
  const long = 'x'.repeat(20_000);
  const history = [
    { role: 'user', content: 'first request' },
    { role: 'assistant', content: `done ${'z'.repeat(1000)}`, blocks: [thought] },
    { role: 'user', content: 'second request', images: [picture] },
    { role: 'assistant', content: '', tool_calls: [{ id: 'a', function: { name: 'bash', arguments: { command: 'ls' } } }], blocks: [thought] },
    { role: 'tool', tool_call_id: 'a', content: long, images: [picture] },
    { role: 'assistant', content: 'all listed' },
  ];
  const all = reviewReplay(history, 100_000);
  assert.equal(all.length, history.length);
  assert.ok(all.every((m) => !m.blocks && !m.images), 'no replayed reasoning and no pictures');
  assert.match(all[2].content, /second request\n\[image shot\.png: was shown here\]/);
  assert.ok(all[4].content.length < 1500 && /characters omitted/.test(all[4].content), 'long tool output keeps its start and end');

  // Too small for both turns: the older one goes, and what is left starts with the user.
  const recent = reviewReplay(history, 1000, { each: 200 });
  assert.equal(recent.length, 4);
  assert.equal(recent[0].content.startsWith('second request'), true);
  assert.equal(recent.at(-1).content, 'all listed');

  // One turn longer than the room: its request, then its end — never a tool result without its call.
  const steps = [{ role: 'user', content: 'do a lot' }];
  for (let i = 0; i < 40; i++) steps.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, function: { name: 'bash', arguments: { command: `step ${i}` } } }] }, { role: 'tool', tool_call_id: `c${i}`, content: `output ${i} ${'y'.repeat(600)}` });
  steps.push({ role: 'assistant', content: 'finished' });
  const tail = reviewReplay(steps, 4000);
  assert.equal(tail[0].content, 'do a lot');
  assert.notEqual(tail[1].role, 'tool');
  assert.equal(tail.at(-1).content, 'finished');
  assert.ok(JSON.stringify(tail).length <= 4000);
  assert.deepEqual(reviewReplay([{ role: 'assistant', content: 'hello' }], 4000), []);
});

test('pictures of past turns leave the history only once the cache has run out, and take later reasoning with them', () => {
  const agent = makeAgent('http://127.0.0.1:9', tmp());
  const history = () => [
    { role: 'user', content: 'look at this', images: [picture] },
    { role: 'assistant', content: 'seen', blocks: [thought, { type: 'text', text: 'seen' }] },
    { role: 'user', content: 'and now?' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'r', function: { name: 'read_file', arguments: { path: 'b.png' } } }], blocks: [thought, { type: 'tool_use', id: 'r', name: 'read_file', input: { path: 'b.png' } }] },
    { role: 'tool', tool_call_id: 'r', content: 'b.png', images: [picture] },
    { role: 'assistant', content: 'both seen', blocks: [thought] },
  ];

  agent.messages = history();
  agent.lastRequestAt = Date.now();
  assert.equal(agent.dropPastImages(), 0, 'the conversation is still cached: changing it would cost more than the pictures');
  assert.equal(agent.messages[0].images.length, 1);

  agent.lastRequestAt = Date.now() - 6 * 60_000;
  assert.equal(agent.dropPastImages(), 2);
  assert.ok(agent.messages.every((m) => !m.images));
  assert.match(agent.messages[0].content, /look at this\n\[image shot\.png: removed after its turn to save context\]/);
  assert.deepEqual(agent.messages[1].blocks, [{ type: 'text', text: 'seen' }], 'reasoning after a changed message is not sent back');
  assert.equal(agent.messages[3].blocks.length, 1);
  assert.equal(agent.messages[3].blocks[0].type, 'tool_use');
  assert.equal('blocks' in agent.messages[5], false, 'a reply that was only reasoning falls back to its text');
  assert.equal(agent.dropPastImages(), 0, 'nothing left to remove');

  // Reasoning written before the first picture is untouched.
  agent.messages = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello', blocks: [thought] }, ...history()];
  agent.lastRequestAt = undefined; // a resumed session: nothing is cached
  assert.equal(agent.dropPastImages(), 2);
  assert.deepEqual(agent.messages[1].blocks, [thought]);
});

test('a new message drops the pictures of earlier turns when the cache is cold, and keeps its own', async () => {
  const cwd = tmp();
  const ollama = await fakeOllama([[done('I see it.')], [done('Still here.')], [done('Gone now.')]]);
  const agent = makeAgent(ollama.host, cwd);
  await agent.runTurn('what is this?', { images: [picture] });
  assert.equal(ollama.requests[0].messages.at(-1).images?.length, 1, 'the picture goes with its own message');
  await agent.runTurn('thanks');
  assert.equal(agent.messages[0].images?.length, 1, 'sent again while the conversation is cached');
  agent.lastRequestAt = Date.now() - 10 * 60_000;
  await agent.runTurn('one more thing');
  ollama.close();
  assert.equal(agent.messages[0].images, undefined);
  assert.equal(ollama.requests[2].messages.some((m) => m.images?.length), false);
});

test('the conversation is summarised at compactAt even when the window is far larger', () => {
  const agent = makeAgent('http://127.0.0.1:9', tmp());
  agent.info = { ...agent.info, context: 1_000_000 };
  agent.provider = { ...agent.provider, kind: 'openai' };
  assert.equal(agent.contextLimit(), 1_000_000);
  assert.equal(agent.compactCeiling(), 300_000);
  agent.config.compactAt = 0;
  assert.equal(agent.compactCeiling(), 800_000, '0: only when the window is nearly full');
  agent.config.compactAt = 500_000;
  agent.info = { ...agent.info, context: 200_000 };
  assert.equal(agent.compactCeiling(), 160_000, 'a small window still summarises before it is full');
});

test('helpers run on subagentModel when it is set, and on the own model when it cannot be used', async () => {
  const cwd = tmp();
  const script = () => [[call('task', { description: 'look', prompt: 'Report.' }), { done: true }], [done('Report: fine.')], [done('It is fine.')]];

  let ollama = await fakeOllama(script());
  let agent = makeAgent(ollama.host, cwd, { subagentModel: 'tiny:1b' });
  await agent.runTurn('check');
  ollama.close();
  assert.deepEqual(ollama.requests.map((r) => r.model), [DEFAULTS.model, 'tiny:1b', DEFAULTS.model], 'only the helper changes model');

  ollama = await fakeOllama(script());
  agent = makeAgent(ollama.host, cwd, { subagentModel: 'ollama:tiny:1b' });
  await agent.runTurn('check');
  ollama.close();
  assert.equal(ollama.requests[1].model, 'tiny:1b', 'a provider can be named in front');

  ollama = await fakeOllama(script());
  agent = makeAgent(ollama.host, cwd);
  await agent.runTurn('check');
  ollama.close();
  assert.equal(ollama.requests[1].model, DEFAULTS.model, 'unset: the same model');

  const warnings = [];
  ollama = await fakeOllama([...script(), [call('task', { description: 'again', prompt: 'Report.' }), { done: true }], [done('Report: fine.')], [done('Fine again.')]]);
  agent = makeAgent(ollama.host, cwd, { subagentModel: 'missing' }, warnings);
  await agent.runTurn('check');
  await agent.runTurn('check again');
  ollama.close();
  assert.equal(ollama.requests[1].model, DEFAULTS.model);
  assert.equal(warnings.filter((w) => /subagentModel "missing" cannot be used/.test(w)).length, 1, 'said once, not at every helper');
});

test('replayed reasoning can be taken out of a Claude history, and the new settings read their values', () => {
  const messages = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [thought, { type: 'text', text: 'hello' }] },
    { role: 'assistant', content: [{ type: 'redacted_thinking', data: 'x' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
  ];
  assert.deepEqual(withoutReasoning(messages), [messages[0], { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }, messages[3]]);

  assert.equal(SETTINGS.cacheTtl.parse('1h'), '1h');
  assert.equal(SETTINGS.cacheTtl.parse('24h'), undefined, 'the provider offers five minutes or an hour');
  assert.equal(SETTINGS.compactAt.parse('0'), 0);
  assert.equal(SETTINGS.subagentModel.parse('claude-haiku-5-5'), 'claude-haiku-5-5');
  assert.equal(SETTINGS.subagentModel.parse('same'), '');
  assert.deepEqual([DEFAULTS.cacheTtl, DEFAULTS.compactAt, DEFAULTS.subagentModel], ['1h', 300_000, '']);
});

test('every on/off setting can be switched in the /config list', async () => {
  const { CHOICES } = await import('../src/menu.mjs');
  const switches = Object.keys(SETTINGS).filter((key) => typeof DEFAULTS[key] === 'boolean');
  assert.ok(switches.includes('autoLearn') && switches.includes('review'));
  for (const key of switches) assert.deepEqual(CHOICES[key], [true, false], key);
  for (const [key, values] of Object.entries(CHOICES)) for (const value of values) assert.notEqual(SETTINGS[key].parse(String(value)), undefined, `${key} ${value}`);
});

test('a file dragged into the terminal is a message, not a /command, and the model gets its plain path', async () => {
  const { draggedFilesIn, imagePathsIn, startsWithFile } = await import('../src/images.mjs');
  const dir = fs.realpathSync(tmp());
  const pdf = path.join(dir, 'Report 2026 final.pdf');
  const shot = path.join(dir, 'Screenshot 2026-11-15 at 17.14.44.png');
  fs.writeFileSync(pdf, '%PDF-1.4');
  fs.writeFileSync(shot, 'png');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const typed = (file) => file.replace(/ /g, '\\ '); // what a terminal types for a dragged file

  assert.equal(startsWithFile(`${typed(shot)}   update the screenshot`, dir), true);
  assert.equal(startsWithFile(`${typed(pdf)} summarise this`, dir), true);
  assert.equal(startsWithFile(`'${pdf}' summarise this`, dir), true);
  assert.equal(startsWithFile('/help', dir), false);
  assert.equal(startsWithFile('/config autoLearn on', dir), false);
  assert.equal(startsWithFile(`/model ${typed(pdf)}`, dir), false, 'a command that names a file is still a command');
  assert.equal(startsWithFile(`${typed(path.join(dir, 'missing.pdf'))} read it`, dir), false);

  assert.deepEqual(imagePathsIn(`${typed(shot)} what is this?`, dir), [shot]);
  assert.deepEqual(draggedFilesIn(`${typed(pdf)} and ${typed(shot)} and notes.txt.`, dir), [pdf], 'pictures are attached instead, and a plain name needs no help');
  assert.deepEqual(draggedFilesIn(`read "${pdf}"`, dir), [pdf]);

  const ollama = await fakeOllama([[done('Read.')]]);
  const agent = makeAgent(ollama.host, dir);
  await agent.runTurn(`${typed(pdf)} summarise this`);
  ollama.close();
  assert.equal(ollama.requests[0].messages.at(-1).content, `${typed(pdf)} summarise this\n\n[The file named above, as plain path to open: ${pdf}]`);
});

test('an edit is shown as numbered lines: what goes, what comes, and the lines around them', async () => {
  const { hunkRows, lineDiff } = await import('../src/hunks.mjs');
  const { TOOL_BY_NAME } = await import('../src/tools.mjs');
  const show = (rows) => rows.map((r) => (r.gap ? '...' : `${r.n}${r.kind}${r.text}`));

  assert.deepEqual(lineDiff(['a', 'b', 'c'], ['a', 'x', 'c']).map((s) => s.kind + s.text), [' a', '-b', '+x', ' c']);
  assert.deepEqual(lineDiff([], ['a', 'b']).map((s) => s.kind + s.text), ['+a', '+b']);

  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  const after = [...before];
  after[9] = 'line ten';
  after.splice(20, 1); // "line 21" goes
  const { rows, added, removed, hidden } = hunkRows(before, after);
  assert.deepEqual([added, removed, hidden], [1, 2, 0]);
  assert.deepEqual(show(rows), ['7 line 7', '8 line 8', '9 line 9', '10-line 10', '10+line ten', '11 line 11', '12 line 12', '13 line 13', '...', '18 line 18', '19 line 19', '20 line 20', '21-line 21', '21 line 22', '22 line 23', '23 line 24']);
  assert.equal(hunkRows(before, after, { first: 101 }).rows[0].n, 107, 'numbered from where the lines sit in the file');
  const cut = hunkRows([], Array.from({ length: 100 }, (_, i) => `n${i}`), { limit: 40 });
  assert.deepEqual([cut.rows.length, cut.hidden, cut.added], [40, 60, 100]);

  // The edit tool: the change in place, with the file's own line numbers and three lines either side.
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.js'), before.join('\n'));
  const edit = TOOL_BY_NAME.get('edit_file').preview({ path: 'a.js', old_string: 'line 15\nline 16', new_string: 'line 15\nline sixteen\nline 16b' }, { cwd: dir });
  assert.deepEqual(show(edit.hunk.rows), ['13 line 13', '14 line 14', '15 line 15', '16-line 16', '16+line sixteen', '17+line 16b', '18 line 17', '19 line 18', '20 line 19']);
  assert.deepEqual([edit.hunk.added, edit.hunk.removed, edit.line], [2, 1, 15]);
  // A change inside a line shows the whole line, before and after.
  const inside = TOOL_BY_NAME.get('edit_file').preview({ path: 'a.js', old_string: 'ne 2\n', new_string: 'ne two\n' }, { cwd: dir });
  assert.deepEqual(show(inside.hunk.rows), ['1 line 1', '2-line 2', '2+line two', '3 line 3', '4 line 4', '5 line 5']);
  // Writing over a file shows what really changes, not the whole new file.
  const write = TOOL_BY_NAME.get('write_file').preview({ path: 'a.js', content: after.join('\n') }, { cwd: dir });
  assert.deepEqual([write.hunk.added, write.hunk.removed, write.overwrites], [1, 2, 30]);
  const fresh = TOOL_BY_NAME.get('write_file').preview({ path: 'new.js', content: 'one\ntwo' }, { cwd: dir });
  assert.deepEqual(show(fresh.hunk.rows), ['1+one', '2+two']);
});

test('an edit made by the provider\'s own tools is shown as numbered lines too, before or just after it ran', async () => {
  const { describeExternal } = await import('../src/external-tools.mjs');
  const show = (rows) => rows.map((r) => (r.gap ? '...' : `${r.n}${r.kind}${r.text}`));
  const dir = fs.realpathSync(tmp());
  const file = path.join(dir, 'a.css');
  const before = ['.a {', '  color: red;', '}', '.b {', '  color: blue;', '}'];
  fs.writeFileSync(file, before.join('\n'));

  const edit = { file_path: file, old_string: '  color: red;', new_string: '  color: green;\n  margin: 0;' };
  const asked = describeExternal('Edit', edit, dir);
  assert.equal(asked.summary, 'a.css');
  assert.deepEqual(show(asked.diff.hunk.rows), ['1 .a {', '2-  color: red;', '2+  color: green;', '3+  margin: 0;', '4 }', '5 .b {', '6   color: blue;']);
  assert.deepEqual(asked.diff.removed, ['  color: red;'], 'the phone still gets the plain lines');

  // Reported once it has already run: the same picture, read back from the changed file.
  fs.writeFileSync(file, before.join('\n').replace(edit.old_string, edit.new_string));
  assert.deepEqual(show(describeExternal('Edit', edit, dir).diff.hunk.rows), show(asked.diff.hunk.rows));

  fs.writeFileSync(file, before.join('\n'));
  const multi = describeExternal('MultiEdit', { file_path: file, edits: [{ old_string: 'red', new_string: 'black' }, { old_string: 'blue', new_string: 'white' }] }, dir);
  assert.deepEqual([multi.diff.hunk.added, multi.diff.hunk.removed], [2, 2]);
  const write = describeExternal('Write', { file_path: file, content: [...before, '.c {}'].join('\n') }, dir);
  assert.deepEqual(show(write.diff.hunk.rows), ['4 .b {', '5   color: blue;', '6 }', '7+.c {}']);
  const fresh = describeExternal('Write', { file_path: path.join(dir, 'new.css'), content: '.n {}' }, dir);
  assert.deepEqual(show(fresh.diff.hunk.rows), ['1+.n {}']);
  // A change that cannot be found in the file falls back to the plain lines, with nothing invented.
  const lost = describeExternal('Edit', { file_path: file, old_string: 'not there', new_string: 'x' }, dir);
  assert.equal(lost.diff.hunk, undefined);
  assert.deepEqual(lost.diff.added, ['x']);
  assert.equal(describeExternal('Edit', { file_path: path.join(dir, 'missing.css'), old_string: 'a', new_string: 'b' }, dir).diff.hunk, undefined);
});
