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
  assert.deepEqual([...new Set(css.match(/var\(--(?!sk-)[a-z-]+/g))].sort(), ['var(--app-h', 'var(--dx', 'var(--dy', 'var(--lvl', 'var(--mono', 'var(--nav-h', 'var(--p', 'var(--safe-b', 'var(--sans', 'var(--t'], 'a variable from before the redesign');
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

test('the mic and Send take turns in one place: the mic while the box is empty, Send once something is typed', () => {
  const html = read('index.html');
  const app = read('app.js');
  const form = html.slice(html.indexOf('<form id="form"'), html.indexOf('</form>'));
  const mic = form.match(/<button id="mic"[^>]*>/)?.[0] ?? '';
  // Same round shape as Send, on the single line at rest, hidden until the browser is known to record.
  assert.match(mic, /class="send mic"/);
  assert.doesNotMatch(mic, /\bextra\b/);
  assert.match(mic, /\bhidden\b/);
  const fn = app.slice(app.indexOf('function composerState()'), app.indexOf('// ── composer'));
  // While the agent works Stop has the place alone; only a voice note under way keeps the mic.
  assert.match(fn, /const showMic = canRecord && \(\(empty && !sending && !showStop\) \|\| Boolean\(voice\)\);/);
  assert.match(fn, /mic\.hidden = !showMic;/);
  assert.match(fn, /\$\('send'\)\.hidden = showStop \|\| showMic;/);
  // Where the browser cannot record, Send shows as it always did.
  assert.ok(!app.slice(app.indexOf('if (canRecord) {')).split('\n').slice(0, 4).some((l) => l.includes("$('mic').hidden = false")));
});

test('a voice note opens the talk page: robot, wave, and the words under it, checked before they are sent', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('style.css');
  // The page sits outside the app, robot over wave over text, with its buttons last; the old strip is gone.
  const page = html.slice(html.indexOf('<div id="talk"'), html.indexOf('</div>\n', html.indexOf('id="talk-actions"')));
  assert.match(page, /role="dialog" aria-modal="true"/);
  assert.deepEqual([...page.matchAll(/id="(talk-[a-z]+)"/g)].map((m) => m[1]), ['talk-bot', 'talk-wave', 'talk-text', 'talk-state', 'talk-actions']);
  assert.match(page, /<canvas id="talk-wave"/);
  assert.match(page, /id="talk-text"[^>]*aria-live="polite"/);
  assert.ok(!html.includes('id="voice"') && !css.includes('.voice {'), 'no strip above the box any more');
  assert.match(app, /\$\('talk-bot'\)\.innerHTML = ICONS\.logo;/, 'the robot is SEEKER\'s own');
  // Over the sheet, under the toast, so what goes wrong is still read.
  assert.match(css, /\.talk \{[^}]*position: fixed;[^}]*z-index: 25;/);
  // Each phase has its buttons: Cancel/Done while recording, Cancel while it is turned into text, Edit/Send at the end.
  const show = app.slice(app.indexOf('function showVoice()'), app.indexOf('function listenTo('));
  assert.match(show, /btn\('Cancel', '', \(\) => stopVoice\(true\)\), btn\('Done', 'primary', \(\) => stopVoice\(false\)\)/);
  assert.match(show, /btn\('Edit', '', \(\) => useVoice\(false\)\), btn\('Send', 'primary', \(\) => useVoice\(true\)\)/);
  assert.match(show, /if \(!changed\) return;/, 'the buttons are not rebuilt on every tick');
  // Previews go up one at a time, quietly, marked partial; their text is only shown, never sent or put in the box.
  const preview = app.slice(app.indexOf('function previewVoice('), app.indexOf('function stopVoice('));
  assert.match(preview, /partial: true/);
  assert.match(preview, /uploadFiles\(\[file\], \{ quiet: true \}\)/);
  assert.match(preview, /if \(mine\.preview && now - mine\.preview\.at < VOICE_PREVIEW_WAIT_MS\) return;/);
  const arrived = app.slice(app.indexOf('function voiceArrived('), app.indexOf('function useVoice('));
  const previewBranch = arrived.slice(arrived.indexOf('if (mine.preview?.req === event.req)'), arrived.indexOf('if (mine.req !== event.req) return;'));
  assert.ok(previewBranch.includes('mine.said = said') && !previewBranch.includes('useVoice') && !previewBranch.includes('input.value'), 'a preview only updates the page');
  assert.match(arrived, /if \(event\.send\) return useVoice\(true\);/, 'voiceAutoSend still sends the final text');
  // A quiet upload leaves the progress bar and toasts alone, so a preview never disturbs a real upload.
  const upload = app.slice(app.indexOf('async function uploadFiles('), app.indexOf('function showAttachments('));
  assert.match(upload, /if \(!quiet\) \{\s*uploading = null;/);
  // The sound graph is made before anything is awaited (iOS starts sound only inside the tap) and closed at the end.
  const start = app.slice(app.indexOf('async function startVoice()'), app.indexOf('function previewVoice('));
  assert.ok(start.indexOf('new Ctx()') < start.indexOf('await navigator.mediaDevices.getUserMedia'));
  assert.match(app, /mine\.audio\?\.ctx\.close\?\.\(\)/);
  // The robot keeps still when animation is off or less motion is asked for.
  assert.match(app, /page\.classList\.toggle\('still', state\.device\?\.settings\?\.animation === false\)/);
  assert.match(css, /\.talk\.still \.talk-bot,/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.talk,/);
});

test('+ offers everything that goes into a message, including files of any kind', () => {
  const html = read('index.html');
  const app = read('app.js');
  const form = html.slice(html.indexOf('<form id="form"'), html.indexOf('</form>'));
  // One + on the bar; the picture and @ buttons, and the separate commands button, live in its sheet now.
  // The mic beside Send records a voice note (it stays hidden where the browser cannot record).
  assert.deepEqual([...form.matchAll(/<button id="([^"]+)"/g)].map((m) => m[1]), ['add', 'mic', 'stop', 'send']);
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

test('on the phone SEEKER\'s messages carry the header robot and an orange name', () => {
  const app = read('app.js');
  const css = read('style.css');
  const assistant = app.slice(app.indexOf("if (item.kind === 'assistant')"), app.indexOf("return h('li', { class: `ev notice"));
  assert.match(assistant, /class: [^,]*'node[^']*', icon: 'logo'/, 'the node draws the robot');
  assert.ok(assistant.includes("'node still'"), 'the robot stays still when animation is off');
  assert.match(css, /\.ev\.assistant \.who \{\s*color: var\(--sk-primary\);/);
});

test('on the phone the user\'s messages carry a pixel person, in cyan', () => {
  const app = read('app.js');
  const css = read('style.css');
  const user = app.slice(app.indexOf("if (item.kind === 'user')"), app.indexOf("if (item.kind === 'assistant')"));
  assert.match(user, /class: [^,]*'node[^']*', icon: 'you'/, 'the node draws the person');
  assert.ok(user.includes("'node still'"), 'the person stays still when animation is off');
  assert.match(app, /you: `<svg class="human"/);
  assert.match(css, /--sk-user: #22D3EE;/);
  assert.match(css, /\.ev\.user \.who \{\s*color: var\(--sk-user\);/);
  assert.match(css, /\.ev\.user \.node \{\s*border-color: var\(--sk-user\);/);
  assert.match(css, /\.still \.human \* \{\s*animation: none;/);
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
  for (const mark of ['◇ thought for 1s', '▸ Editing a.txt', '✓ 1 change', '✗ Running npm test', '› next']) assert.ok(plain.includes(mark), `"${mark}" reads without colour`);
});

test('Stop and Send take turns in one place, and a long message scrolls inside the box', () => {
  const app = read('app.js');
  const css = read('style.css');
  const state = app.slice(app.indexOf('function composerState()'), app.indexOf('function chooseMode('));
  // Stop while a task runs and nothing is typed; Send as soon as there is text or an attachment.
  assert.match(state, /const showStop = stoppable && empty && !sending;/);
  assert.match(state, /\$\('stop'\)\.hidden = !showStop;/);
  // The mic takes Send's place too while the box is empty (see the test on the mic).
  assert.match(state, /\$\('send'\)\.hidden = showStop \|\| showMic;/);
  // The box is redrawn on every keystroke, so clearing the text brings Stop back.
  assert.match(app, /input\.addEventListener\('input', \(\) => \{[^}]*composerState\(\);/);
  // Stop is a circle the size of Send, not a red pill beside it.
  assert.match(css, /\.stop-btn \{[^}]*width: 36px;[^}]*border-radius: 50%;/);
  // With the keyboard up the writing area is capped to a share of what is visible.
  assert.match(app, /setProperty\('--app-h', keyboard \? `\$\{visualViewport\.height\}px` : ''\)/);
  assert.match(css, /\.keyboard \.composer-box textarea \{\s*max-height: max\(64px, min\(176px, calc\(var\(--app-h, 100dvh\) \* 0\.24\)\)\);/);
});

test('a picture under a message the user sent opens when tapped', () => {
  const app = read('app.js');
  // The user's pictures are named by their message, so the Mac can send the one kept in its inbox.
  assert.ok(app.includes("pictures(item.images, '', { ws: state.view.ws, item: item.id, user: true })"));
  // One sent before the Mac kept them still opens, as the small preview there is, and says so.
  assert.match(app, /from\.user && shown\.tagName === 'IMG' \? \(\) => showPreviewOnly\(i\)/);
  assert.match(app, /function showPreviewOnly\(image\) \{[\s\S]{0,400}Only a small preview of this picture was kept/);
});

test('the phone app navigates with a floating glass dock, and its lists are separate capsules', () => {
  const css = read('style.css');
  const app = read('app.js');
  // The dock floats off the bottom edge, above the home indicator, and is a capsule.
  const dock = css.match(/^#nav \{[^}]*\}/m)?.[0] ?? '';
  assert.match(dock, /position: absolute;/);
  assert.match(dock, /bottom: var\(--sk-dock-gap\);/);
  // Just above the home indicator (not a full safe area higher), and never closer than 12px to the edge.
  assert.match(css, /--sk-dock-gap: max\(12px, calc\(env\(safe-area-inset-bottom, 0px\) - 10px\)\);/);
  assert.match(css, /--sk-dock-room: calc\(var\(--nav-h\) \+ 14px \+ var\(--sk-dock-gap\) \+ 16px\);/);
  assert.match(dock, /border-radius: var\(--sk-radius-pill\);/);
  assert.ok(!/border-top/.test(dock), 'no rule across the screen');
  // Every screen under it leaves room, so the last item scrolls clear; with the keyboard up the dock steps aside.
  assert.match(css, /#view:is\(\.screen-home, \.screen-sessions, \.screen-approvals, \.screen-settings\) \{\s*padding-bottom: var\(--sk-dock-room\);/);
  assert.match(css, /\.keyboard #nav \{\s*display: none;/);
  // The current screen is said, not only coloured; the counts on Approvals and Sessions are said in words too.
  assert.ok(app.includes("'aria-current': state.view.name === id ? 'page' : null"));
  assert.ok(app.includes("h('span', { class: 'sr-only' }, `, ${n} ${said}`)") && app.includes("approvals: [state.approvals.length, 'waiting']"));
  // Sessions are cards of their own, not rows parted by hairlines; the selected one is amber glass.
  assert.match(css, /\.s-list \{\s*display: grid;/);
  assert.ok(!/\.s-row \+ \.s-row/.test(css), 'no hairline between session cards');
  assert.match(css, /\.s-row\.selected \{[^}]*var\(--sk-amber-glass\)/);
  // Blur only where something floats, with a solid fallback when it is unavailable or unwanted.
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
});

test('reasoning is folded to one line, its latest line shown live, the full text kept for /think show', async (t) => {
  const { UI } = await import('../src/ui.mjs');
  const { runCommand } = await import('../src/commands.mjs');
  let out = '';
  let live = [];
  const ui = new UI({});
  ui.c = terminalPalette(0);
  ui.attach({ width: 99, append: (s) => (out += s), setLive: (rows) => (live = rows), render() {} });
  ui.turnStart();
  t.after(() => ui.stopSpinner());
  ui.thinkStart();
  ui.thinkChunk('Wait, the logo is 512px.\nActually, let me check ');
  ui.thinkChunk('where it is used.');
  await new Promise((r) => setTimeout(r, 150)); // one spinner frame
  assert.match(live.join(''), /Thinking · Actually, let me check where it is used\./, 'the live row follows the latest line');
  ui.thinkEnd();
  ui.thinkEnd(); // a second end (the agent's finally) adds nothing
  assert.ok(!out.includes('Wait, the logo'), 'the reasoning itself is not printed');
  assert.equal(out.match(/◇ thought for \d+s · \/think show/g)?.length, 1, 'one folded line, naming the way back');
  ui.thinkStart();
  ui.thinkChunk('second thought');
  ui.thinkEnd();
  assert.equal(out.match(/\/think show/g).length, 1, 'the hint is given once');

  out = '';
  await runCommand('/think show', { ui, agent: {}, config: {} });
  assert.ok(out.includes('second thought') && !out.includes('Wait, the logo'), '/think show prints the last reasoning');

  const quiet = new UI({ showThinking: false });
  quiet.c = terminalPalette(0);
  let shown = '';
  quiet.attach({ width: 99, append: (s) => (shown += s), setLive() {}, render() {} });
  quiet.thinkStart();
  quiet.thinkChunk('hidden');
  quiet.thinkEnd();
  assert.ok(!shown.includes('thought for') && !shown.includes('hidden'), 'with showThinking off nothing stays on screen');
  assert.equal(quiet.lastThought, 'hidden');
});
