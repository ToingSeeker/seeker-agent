// One palette for the terminal and the phone app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { STATUSES } from '../remote-server/public/sessions.js';
import { TOKENS, colorDepth, cssName, sgr, terminalCodes, terminalPalette } from '../src/theme.mjs';

const read = (file) => fs.readFileSync(new URL(`../remote-server/public/${file}`, import.meta.url), 'utf8');

test('the phone app carries the same colours as the terminal', () => {
  const css = read('style.css');
  for (const [token, hex] of Object.entries(TOKENS)) {
    const declared = new RegExp(`${cssName(token)}:\\s*(#[0-9a-fA-F]{6});`).exec(css)?.[1];
    assert.equal(declared?.toUpperCase(), hex.toUpperCase(), `${cssName(token)} in style.css`);
  }
  assert.equal(cssName('surfaceElevated'), '--sk-surface-elevated');
  // The page and its install manifest open on the same background, so there is no flash of another colour.
  assert.ok(read('index.html').includes(`name="theme-color" content="${TOKENS.bg}"`));
  const manifest = JSON.parse(read('app.webmanifest'));
  assert.deepEqual([manifest.background_color, manifest.theme_color], [TOKENS.bg, TOKENS.bg]);
});

test('the stylesheet takes every colour from a token', () => {
  const css = read('style.css');
  const rules = css.slice(css.indexOf('}', css.indexOf(':root')));
  assert.deepEqual(rules.match(/#[0-9a-fA-F]{6}\b/g) ?? [], [], 'a colour written out below the token block');
  assert.deepEqual([...new Set(css.match(/var\(--(?!sk-)[a-z-]+/g))].sort(), ['var(--mono', 'var(--nav-h', 'var(--safe-b', 'var(--sans', 'var(--t'], 'a variable from before the redesign');
  // The class names the app gives its states all have a rule.
  const app = read('app.js');
  for (const tone of ['primary', 'execution', 'reasoning', 'success', 'danger']) {
    assert.ok(app.includes(`tone: '${tone}'`), `${tone} is a state of the agent`);
    assert.ok(css.includes(`.state-chip.${tone}`), `${tone} is styled`);
  }
  // The Sessions list says a state with a small pill; no row carries a coloured edge any more.
  const states = Object.values(STATUSES).map((s) => s.tone);
  for (const tone of new Set(states)) assert.ok(css.includes(`.pill.${tone}`), `a ${tone} pill is styled`);
  assert.ok(!/\.session-card[^{]*\{[^}]*border-left/.test(css) && !/\.s-row[^{]*\{[^}]*border-left/.test(css), 'no status-coloured left border');
});

test('how many colours a terminal shows is read from its environment', () => {
  assert.equal(colorDepth({ TERM: 'xterm-256color', COLORTERM: 'truecolor' }), 24);
  assert.equal(colorDepth({ TERM: 'xterm-256color' }), 8);
  assert.equal(colorDepth({ TERM: 'xterm', TERM_PROGRAM: 'Apple_Terminal' }), 8);
  assert.equal(colorDepth({ TERM: 'xterm' }), 4);
  assert.equal(colorDepth({ TERM: 'xterm-256color', COLORTERM: 'truecolor', NO_COLOR: '1' }), 0);
  assert.equal(colorDepth({ TERM: 'dumb' }), 0);
  assert.equal(colorDepth({ TERM: 'xterm-256color' }, false), 0, 'not a terminal');
});

test('each meaning keeps its own colour at every depth', () => {
  assert.equal(sgr(TOKENS.primary, 24), '38;2;255;138;0');
  assert.equal(sgr(TOKENS.primary, 24, true), '48;2;255;138;0');
  assert.equal(sgr(TOKENS.primary, 8), '38;5;208');
  assert.equal(sgr('#000000', 8), '38;5;16');
  assert.equal(sgr('#808080', 8), '38;5;244', 'greys come from the grey ramp');
  for (const depth of [4, 8, 24]) {
    const codes = terminalCodes(depth);
    const meanings = ['accent', 'blue', 'purple', 'green', 'yellow', 'red'].map((name) => codes[name]);
    assert.equal(new Set(meanings).size, meanings.length, `six different colours at depth ${depth}`);
    assert.equal(codes.dim, '2');
  }
  assert.deepEqual([terminalCodes(4).accent, terminalCodes(4).blue, terminalCodes(4).purple], ['33', '34', '35']);
});

test('without colour the palette leaves text as it is', () => {
  const plain = terminalPalette(0);
  assert.equal(plain.accent('seeker'), 'seeker');
  assert.equal(plain.chip(' /init '), ' /init ');
  assert.equal(terminalPalette(8).blue('x'), '\x1b[38;5;69mx\x1b[0m');
});

test('the terminal interface says what a step is with colour and with a mark', async () => {
  const { UI } = await import('../src/ui.mjs');
  const draw = (depth) => {
    const ui = new UI({});
    let out = '';
    ui.depth = depth;
    ui.colors = depth > 0;
    ui.c = terminalPalette(depth);
    ui.activity = { write: (s) => (out += s), columns: 100, isTTY: false };
    ui.turnStart();
    ui.thinkStart();
    ui.thinkEnd();
    ui.toolStart('Editing', 'Edited', 'a.txt');
    ui.diff({ removed: ['old'], added: ['new'] });
    ui.toolDone('1 change');
    ui.toolStart('Running', 'Ran', 'npm test');
    ui.toolFail('exit 1');
    ui.userEcho('next');
    return out;
  };
  const { accent, blue, purple, green, red } = terminalCodes(8);
  const colour = draw(8);
  assert.ok(colour.includes(`\x1b[${purple}m◇\x1b[0m`), 'thinking is purple');
  assert.ok(colour.includes(`\x1b[${blue}m▸\x1b[0m Editing a.txt`), 'a step at work is blue');
  assert.ok(colour.includes(`\x1b[${green}m✓\x1b[0m`) && colour.includes(`\x1b[${red}m✗\x1b[0m`), 'done is green, failed is red');
  assert.ok(colour.includes(`\x1b[${accent}m›\x1b[0m \x1b[1mnext\x1b[0m`), 'the prompt mark is the brand colour, the typed text is not');
  const plain = draw(0);
  assert.ok(!plain.includes('\x1b'), 'no escape codes without colour');
  for (const mark of ['◇ thinking', '▸ Editing a.txt', '✓ 1 change', '✗ Running npm test', '› next']) assert.ok(plain.includes(mark), `"${mark}" reads without colour`);
});
