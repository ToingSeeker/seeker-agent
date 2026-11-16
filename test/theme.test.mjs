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

test('a session keeps its title and tabs outside the part that scrolls', () => {
  const html = read('index.html');
  const css = read('style.css');
  const app = read('app.js');
  // Four regions, in this order, as siblings: head, scrolling content, composer, navigation.
  const order = ['<header id="top"', '<main id="view"', '<footer id="composer"', '<nav id="nav"'].map((tag) => html.indexOf(tag));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), 'head, content, composer and navigation follow one another');
  assert.ok(html.indexOf('</header>') < html.indexOf('<main id="view"'), 'the head is closed before the scrolling area opens');
  assert.match(css, /#view \{[^}]*overflow-y: auto/, 'the content is the region that scrolls');
  assert.match(css, /\.session-top \{[^}]*flex: none/, 'the head keeps its height');
  assert.doesNotMatch(css, /\.session-top[^{]*\{[^}]*position: (sticky|fixed)/, 'held by the layout, not pinned over the content');
  // The tabs are built into the head, and say which panel they control.
  assert.match(app, /return \{ head, body \}/);
  assert.ok(app.includes("role: 'tablist'") && app.includes("'aria-controls': 'view'") && app.includes("view.setAttribute('role', 'tabpanel')"));
});

test('the message box is one line at rest and opens to two levels while writing', () => {
  const html = read('index.html');
  const css = read('style.css');
  const app = read('app.js');
  const form = html.slice(html.indexOf('<form id="form"'), html.indexOf('</form>'));
  // At rest only +, the writing area, Stop and Send are on the line; everything else waits for the box to open.
  const tag = (id) => form.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
  for (const id of ['add', 'input', 'stop', 'send']) assert.doesNotMatch(tag(id), /\bextra\b/, `${id} stays on the single line`);
  for (const id of ['tokens']) assert.match(tag(id), /class="[^"]*\bextra\b/, `${id} shows only when the box is open`);
  assert.match(css, /\.composer-box:not\(\.open\) \.composer-bar \{\s*display: contents;/, 'at rest the tools join the writing line');
  assert.match(css, /\.composer-box:not\(\.open\) \.extra \{\s*display: none;/);
  assert.match(css, /\.composer-box\.open \{[^}]*flex-direction: column/, 'open, the writing area has a row of its own');
  assert.ok(!html.includes('composer-foot') && !css.includes('composer-foot'), 'no hint line under the box');
  // It opens for focus, typed text or an attachment, and closes only after a pause so a tap on a tool still lands.
  assert.match(app, /document\.activeElement === input \|\| Boolean\(input\.value\) \|\| attachments\.length > 0/);
  assert.match(app, /setTimeout\(\(\) => \$\('form'\)\.classList\.remove\('open'\), \d+\)/);
});

test('+ offers everything that goes into a message, including files of any kind', () => {
  const html = read('index.html');
  const app = read('app.js');
  const form = html.slice(html.indexOf('<form id="form"'), html.indexOf('</form>'));
  // One + on the bar; the picture and @ buttons, and the separate commands button, live in its sheet now.
  assert.deepEqual([...form.matchAll(/<button id="([^"]+)"/g)].map((m) => m[1]), ['add', 'stop', 'send']);
  // A PDF or a ZIP can be picked: the "Files" picker takes every kind, and the camera takes a picture.
  assert.match(form, /<input id="anyfile" type="file" multiple hidden \/>/);
  // On iOS it is narrowed to public.data, so Files opens the file browser and not the Photo Library menu.
  // A wildcard or audio/* there brings the menu back (audio/* counts as video) or greys out every file.
  assert.match(app, /if \(IOS\) \$\('anyfile'\)\.accept = 'application\/octet-stream';/);
  assert.match(form, /<input id="camera" type="file" accept="image\/\*" capture="environment" hidden \/>/);
  const sheet = app.slice(app.indexOf('function addSheet()'), app.indexOf("$('add').addEventListener"));
  for (const [label, does] of [['Camera', "$('camera').click()"], ['Photos & videos', "$('file').click()"], ['Files', "$('anyfile').click()"], ['Mention a file', 'mentionFile'], ['Model', 'chooseModel'], ['Commands', 'showCommands']]) {
    assert.ok(sheet.includes(`'${label}'`) && sheet.includes(does), `${label} is in the + sheet and does what it says`);
  }
});

test('on the phone SEEKER\'s messages carry the header robot and a purple name', () => {
  const app = read('app.js');
  const css = read('style.css');
  const assistant = app.slice(app.indexOf("if (item.kind === 'assistant')"), app.indexOf("return h('li', { class: `ev notice"));
  assert.match(assistant, /class: [^,]*'node[^']*', icon: 'logo'/, 'the node draws the robot');
  assert.ok(assistant.includes("'node still'"), 'the robot stays still when animation is off');
  assert.match(css, /\.ev\.assistant \.who \{\s*color: var\(--sk-reasoning\);/);
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
