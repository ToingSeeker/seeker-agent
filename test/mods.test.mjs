import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import http from 'node:http';
import { Agent } from '../src/agent.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { Permissions } from '../src/permissions.mjs';
import { createProvider } from '../src/providers.mjs';
import { runCommand, runPhoneCommand, matchCommands } from '../src/commands.mjs';
import { Hooks } from '../src/hooks.mjs';
import { Mods, approveMod, approvalOf, chainHooks, createMod, discover, revokeMod } from '../src/mods.mjs';
import { Screen } from '../src/screen.mjs';
import { terminalPalette } from '../src/theme.mjs';

const plain = new Proxy({}, { get: () => (s) => String(s) });
function fakeUi() {
  const said = [];
  return { said, c: plain, notice: (t) => said.push(['notice', t]), warn: (t) => said.push(['warn', t]), line: (t) => said.push(['line', t]), error: (t) => said.push(['error', t]) };
}
function folder() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-mods-')));
}
function write(root, rel, body) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

test('a mod is a folder with a mod.mjs, and anything else is left alone', () => {
  const root = folder();
  write(root, 'one.mjs', 'export default () => {};');
  write(root, 'two/mod.mjs', 'export default () => {};');
  write(root, 'three/index.mjs', 'export default () => {};');
  write(root, 'bad name/mod.mjs', '');
  write(root, '.hidden/mod.mjs', '');
  write(root, 'notes.txt', '');
  assert.deepEqual(discover(root).map((m) => m.name), ['two']);
  assert.deepEqual(discover(path.join(root, 'missing')), []);
});

test('nothing runs until it is approved, and an approval is for the files as they were', async () => {
  const root = folder();
  write(root, 'guard/mod.mjs', `export default (s) => { globalThis.__guardRuns = (globalThis.__guardRuns ?? 0) + 1; s.command('guarded', 'x', () => {}); };`);
  const helper = write(root, 'guard/lib.mjs', 'export const x = 1;');
  const ui = fakeUi();
  const mods = new Mods({ ui, cwd: root, root });
  let report = await mods.loadAll();
  assert.deepEqual(report, { loaded: [], waiting: ['guard'], failed: [] });
  assert.equal(globalThis.__guardRuns, undefined, 'its code was never imported');
  assert.equal(mods.list()[0].state, 'new');

  const [mod] = discover(root);
  approveMod(mod);
  assert.equal(approvalOf(mod), 'approved');
  report = await mods.loadAll();
  assert.deepEqual(report.loaded, ['guard']);
  assert.equal(globalThis.__guardRuns, 1);
  assert.equal(mods.list()[0].state, 'on');

  // Any file of the mod changing, not only mod.mjs, takes the approval away.
  fs.writeFileSync(helper, 'export const x = 2;');
  assert.equal(approvalOf(mod), 'changed');
  mods.unloadAll();
  report = await mods.loadAll();
  assert.deepEqual(report.waiting, ['guard']);
  assert.equal(mods.command('guarded'), null);

  approveMod(mod);
  revokeMod(mod);
  assert.equal(approvalOf(mod), 'new');
});

test('everything a mod can load from its folder is in its approval: node_modules too, and no symlinks', () => {
  const root = folder();
  const dep = write(root, 'pkg/node_modules/dep/index.js', 'module.exports = 1;');
  write(root, 'pkg/mod.mjs', 'export default () => {};');
  const [mod] = discover(root);
  approveMod(mod);
  fs.writeFileSync(dep, 'module.exports = 2;');
  assert.equal(approvalOf(mod), 'changed', 'a changed dependency takes the approval away');

  // A symlink could point somewhere that changes while the folder does not: such a mod is refused outright.
  const outside = write(folder(), 'evil.mjs', 'export const x = 1;');
  fs.symlinkSync(outside, path.join(root, 'pkg', 'lib.mjs'));
  assert.throws(() => approveMod(mod), /lib\.mjs is a symlink/);
  assert.throws(() => approvalOf(mod), /symlink/);
  const whole = folder();
  fs.symlinkSync(path.join(root, 'pkg'), path.join(whole, 'linked'));
  assert.throws(() => approveMod(discover(whole)[0]), /folder is a symlink/);
});

test('a mod adds commands, a status segment, panel rows and toasts, and unloading takes them all away', async () => {
  const root = folder();
  write(
    root,
    'deck/mod.mjs',
    `export default (s) => {
      s.command('ship', 'Ship it', (arg) => arg ? 'please ship ' + arg : s.toast('shipped'));
      s.status(() => 'branch main');
      s.status(() => '');
      s.panel(() => ['row one', 'row two']);
      s.every(60_000, () => {});
      return () => { globalThis.__deckDisposed = true; };
    };`,
  );
  approveMod(discover(root)[0]);
  const ui = fakeUi();
  let refreshed = 0;
  const mods = new Mods({ ui, cwd: root, root, refresh: () => refreshed++ });
  await mods.loadAll();
  assert.ok(refreshed > 0);
  assert.deepEqual(mods.commands(), [['/ship', 'Ship it']]);
  assert.deepEqual(mods.bandRows(80), [' branch main']);
  assert.deepEqual(mods.panelRows(80), ['row one', 'row two']);

  // Typed in the list of commands, and run: words after it make a message, none runs the toast.
  assert.deepEqual(matchCommands('/sh', [], mods.commands())[0], ['/ship', 'Ship it']);
  const ctx = { agent: { skills: [] }, ui, mods };
  assert.deepEqual(await runCommand('/ship v2', ctx), { prompt: 'please ship v2', label: '/ship v2' });
  assert.equal(await runCommand('/ship', ctx), undefined);
  assert.deepEqual(ui.said.at(-1), ['notice', '  deck · shipped']);

  // From the phone a mod's command runs only if it said so.
  await runPhoneCommand('/ship v3', { ...ctx, config: {}, permissions: {} });
  assert.match(ui.said.at(-1)[1], /works only in the terminal/);

  mods.unload('deck');
  assert.equal(globalThis.__deckDisposed, true);
  assert.deepEqual(mods.commands(), []);
  assert.deepEqual(mods.bandRows(80), []);
  assert.deepEqual(mods.panelRows(80), []);
});

test('a mod cannot take a built-in command, and a broken mod is reported, not fatal', async () => {
  const root = folder();
  write(root, 'a/mod.mjs', `export default (s) => s.command('model', 'mine', () => {});`);
  write(root, 'b/mod.mjs', `export default () => { throw new Error('boom'); };`);
  write(root, 'c/mod.mjs', `export const nothing = 1;`);
  write(root, 'd/mod.mjs', `export default (s) => { s.status(() => { throw new Error('bad row'); }); s.on('pre_tool_call', () => { throw new Error('bad hook'); }); };`);
  for (const m of discover(root)) approveMod(m);
  const ui = fakeUi();
  const mods = new Mods({ ui, cwd: root, root, reserved: new Set(['model']) });
  const report = await mods.loadAll();
  assert.deepEqual(report.loaded, ['d']);
  fs.symlinkSync(path.join(root, 'd', 'mod.mjs'), path.join(root, 'b', 'extra.mjs'));
  const again = new Mods({ ui: fakeUi(), cwd: root, root, reserved: new Set(['model']) });
  assert.match((await again.loadAll()).failed.find((f) => f.name === 'b').error, /symlink/, 'a mod that gained a symlink does not load');
  assert.deepEqual(
    report.failed.map((f) => [f.name, f.error]),
    [
      ['a', '/model is one of SEEKER\'s own commands'],
      ['b', 'boom'],
      ['c', 'mod.mjs exports no function (export default function (seeker) { … })'],
    ],
  );
  assert.deepEqual(mods.bandRows(80), []);
  assert.deepEqual(mods.bandRows(80), []);
  assert.equal(await mods.run('pre_tool_call', { toolName: 'bash', toolInput: { command: 'ls' } }).then((r) => r.block), undefined, 'a handler that throws does not stop the call');
  const warnings = ui.said.filter(([k]) => k === 'warn').map(([, t]) => t);
  assert.equal(warnings.filter((t) => t.includes('bad row')).length, 1, 'warned once, not on every redraw');
  assert.ok(warnings.some((t) => t.includes('bad hook')));
});

test('a mod hooks tool calls and messages the way a shell hook does, after the shell hooks', async () => {
  const root = folder();
  write(
    root,
    'policy/mod.mjs',
    `export default (s) => {
      s.on('pre_tool_call', ({ tool, args }) => {
        if (tool === 'bash' && /--force/.test(args.command)) return { block: 'no force pushes' };
        if (tool === 'bash') return { args: { timeout: 5 } };
      });
      s.on('pre_llm_call', () => ({ context: 'from the mod' }));
      s.on('post_tool_call', ({ extra }) => { globalThis.__seen = extra.result; return { block: 'ignored' }; });
    };`,
  );
  approveMod(discover(root)[0]);
  const mods = new Mods({ ui: fakeUi(), cwd: root, root });
  await mods.loadAll();
  assert.deepEqual(await mods.run('pre_tool_call', { toolName: 'bash', toolInput: { command: 'git push --force' } }), { block: 'no force pushes (policy mod)' });
  assert.deepEqual(await mods.run('pre_tool_call', { toolName: 'bash', toolInput: { command: 'ls' } }), { args: { command: 'ls', timeout: 5 } });
  assert.deepEqual(await mods.run('pre_tool_call', { toolName: 'read_file', toolInput: { path: 'a' } }), {});
  assert.deepEqual(await mods.run('post_tool_call', { toolName: 'bash', extra: { result: 'ok' } }), {}, 'events after the fact cannot block');
  assert.equal(globalThis.__seen, 'ok');

  // Chained after shell hooks: a hook's changed arguments reach the mod, and the contexts add up.
  const shell = { run: async (event) => (event === 'pre_tool_call' ? { args: { command: 'ls -la' } } : event === 'pre_llm_call' ? { context: 'from the hook' } : {}) };
  const both = chainHooks(shell, mods);
  assert.deepEqual(await both.run('pre_tool_call', { toolName: 'bash', toolInput: { command: 'ls' } }), { args: { command: 'ls -la', timeout: 5 } });
  assert.deepEqual(await both.run('pre_llm_call', {}), { context: 'from the hook\n\nfrom the mod' });
  const blocking = chainHooks({ run: async () => ({ block: 'hook says no' }) }, mods);
  assert.deepEqual(await blocking.run('pre_tool_call', { toolName: 'bash', toolInput: { command: 'ls' } }), { block: 'hook says no' });
  assert.equal(chainHooks(null, mods), mods);
  assert.ok(new Hooks({ config: {}, cwd: root }).run, 'shell hooks keep their own shape');
});

test('/mods new writes a mod that works once approved', async () => {
  const root = folder();
  const prev = process.cwd();
  const file = createMod('demo');
  try {
    assert.ok(file.endsWith(path.join('mods', 'demo', 'mod.mjs')));
    assert.throws(() => createMod('demo'), /already/);
    assert.throws(() => createMod('../x'), /mod name/);
    const modsRoot = path.dirname(path.dirname(file));
    approveMod(discover(modsRoot).find((m) => m.name === 'demo'));
    const ui = fakeUi();
    const mods = new Mods({ ui, cwd: prev, root: modsRoot });
    const report = await mods.loadAll();
    assert.ok(report.loaded.includes('demo'), JSON.stringify(report));
    assert.ok(mods.command('demo'));
    assert.deepEqual(await mods.run('pre_tool_call', { toolName: 'bash', toolInput: { command: 'git push -f origin main' } }), { block: 'Force pushes are switched off. (demo mod)' });
    assert.deepEqual(await mods.run('pre_tool_call', { toolName: 'bash', toolInput: { command: 'git push origin main' } }), {});
    mods.unloadAll();
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the screen shows panels above the input box and the band under the status bar, with the cursor still in the box', () => {
  let buf = '';
  const out = { columns: 60, rows: 30, write: (s) => (buf += s), on() {}, off() {} };
  const screen = new Screen({ header: () => [], colors: terminalPalette(0), out });
  screen.setFooter({ status: () => 'STATUS', hints: () => 'HINTS', panel: () => ['PANEL A', 'PANEL B'], band: () => ['BAND'] });
  screen.footer.input = { text: 'hi', cursor: 2, placeholder: '' };
  screen.start();
  screen.render();
  const rows = [];
  for (const m of buf.matchAll(/\x1b\[(\d+);1H([^\x1b]*)/g)) rows[Number(m[1])] = m[2];
  const at = (text) => rows.findIndex((r) => r?.includes(text));
  assert.ok(at('PANEL A') < at('PANEL B') && at('PANEL B') < at('╭'), 'panels sit above the box');
  assert.ok(at('STATUS') < at('BAND'), 'the band is under the status bar');
  assert.equal(at('BAND'), 30, 'on the last row');
  const cursor = [...buf.matchAll(/\x1b\[(\d+);(\d+)H\x1b\[\?25h/g)].at(-1);
  assert.equal(Number(cursor[1]), at('› hi') === -1 ? at('hi') : at('› hi'), 'the cursor is on the input row');
  screen.close();
});

test('in the agent loop a mod vetoes a tool call and adds to the message', async () => {
  const root = folder();
  write(root, 'veto/mod.mjs', `export default (s) => {
    s.on('pre_tool_call', ({ tool }) => (tool === 'bash' ? { block: 'shell is off' } : undefined));
    s.on('pre_llm_call', () => ({ context: '[mod: hello]' }));
  };`);
  approveMod(discover(root)[0]);
  const requests = [];
  const replies = [[{ message: { content: '', tool_calls: [{ function: { name: 'bash', arguments: { command: 'touch made.txt' } } }] } }, { done: true }], [{ message: { content: 'ok' }, done: true }]];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(replies.shift().map((c) => JSON.stringify(c)).join('\n'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const cwd = folder();
  const config = { ...DEFAULTS, host: `http://127.0.0.1:${server.address().port}`, review: false, checkpoints: false };
  const ui = new Proxy({}, { get: (_, key) => (key === 'answerStream' ? () => ({ push() {}, flush() {} }) : () => {}) });
  const agent = new Agent({ config, ui, permissions: new Permissions({ mode: 'auto', cwd, ask: null }), provider: createProvider('ollama', config), info: { tools: true, thinking: false, context: null }, cwd });
  const mods = new Mods({ ui: fakeUi(), cwd, root });
  await mods.loadAll();
  agent.shellHooks = chainHooks(null, mods);
  await agent.runTurn('make a file');
  server.close();
  assert.equal(requests[0].messages[1].content, 'make a file\n\n[mod: hello]');
  assert.equal(fs.existsSync(path.join(cwd, 'made.txt')), false);
  assert.match(agent.messages[2].content, /^Blocked by the user's hook: shell is off \(veto mod\)/);
});
