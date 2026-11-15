// A skill with a list to choose from offers it to tick: in the terminal, and on the phone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runCommand, runPhoneCommand } from '../src/commands.mjs';
import { DEFAULTS } from '../src/config.mjs';
import { pickMany } from '../src/menu.mjs';
import { Permissions } from '../src/permissions.mjs';
import { loadSkills, skillChoices } from '../src/skills.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-choices-'));
const table = (rows) => `| # | name | What it does |\n|---|---|---|\n${rows.map(([n, d], i) => `| ${i + 1} | \`${n}\` | ${d} |`).join('\n')}`;
const EFFECTS = [['orbit', 'Reels circle your head'], ['spotlight', 'Kills the lights, keeps you lit'], ['lean-in', 'A fast punch-in'], ['moody', 'A moody grade'], ['swipe', 'Before and after'], ['todo', 'A checklist card'], ['tap', 'A Follow button']];
const skill = (over = {}) => ({ name: 'effects', description: 'video effects', dir: tmp(), source: 'user', body: `Run \`/effects <name>\` to add one.\n\n${table(EFFECTS)}\n`, ...over });

test('choices: a skill names its list in a file, in its frontmatter, or in a table its command takes a name from', () => {
  const fromTable = skillChoices(skill());
  assert.deepEqual(fromTable.map((c) => c.value), EFFECTS.map(([n]) => n));
  assert.deepEqual(fromTable[1], { value: 'spotlight', description: 'Kills the lights, keeps you lit' });

  // A table by itself is not a list to choose from: plenty of skills have one of commands or options.
  assert.deepEqual(skillChoices(skill({ body: `Some reference.\n\n${table(EFFECTS)}` })), [], 'the skill does not say its command takes one of them');
  assert.deepEqual(skillChoices(skill({ body: `Run \`/effects <name>\`.\n\n${table(EFFECTS.slice(0, 4))}` })), [], 'too short a list to need ticking');
  assert.deepEqual(skillChoices(skill({ body: 'Run `/effects <name>`.\n\n| Step | Command |\n|---|---|\n| one | run `a` then `b` |\n| two | x |\n| three | y |\n| four | z |\n| five | w |\n| six | v |' })), []);

  // Said outright: a file in the skill's folder wins, then the frontmatter.
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'choices.json'), JSON.stringify(['a', { value: 'b', description: 'the second' }, { value: 'a' }, { value: '' }, { value: 'has, comma' }]));
  assert.deepEqual(skillChoices(skill({ dir, choices: 'x, y' })), [{ value: 'a', description: '' }, { value: 'b', description: 'the second' }], 'doubles, blanks and values that could not be typed back are left out');
  assert.deepEqual(skillChoices(skill({ body: 'no table', choices: 'fast, slow , ' })).map((c) => c.value), ['fast', 'slow']);
  assert.deepEqual(skillChoices(null), []);

  // Read from a real skill file, frontmatter and all.
  const home = tmp();
  fs.mkdirSync(path.join(home, '.seeker/skills/tone'), { recursive: true });
  fs.writeFileSync(path.join(home, '.seeker/skills/tone/SKILL.md'), '---\nname: tone\ndescription: rewrite in a tone\nchoices: formal, friendly, blunt\n---\nRewrite the text.');
  const loaded = loadSkills(home, [], { bundled: false }).find((s) => s.name === 'tone');
  assert.deepEqual(skillChoices(loaded).map((c) => c.value), ['formal', 'friendly', 'blunt']);
  // None of the skills that ship with SEEKER turns into a list by accident.
  assert.deepEqual(loadSkills(os.tmpdir(), []).filter((s) => s.source === 'bundled' && skillChoices(s).length).map((s) => s.name), []);
});

/** A terminal that is sent keys, and a screen that keeps what was drawn. */
function fakeTerminal(keys) {
  const drawn = [];
  const screen = { width: 100, footer: { idle: '' }, setFooter() {}, setLive: (rows) => drawn.push(rows) };
  const term = { captureKeys: async (onKey) => { for (const key of keys) if (await onKey(typeof key === 'string' ? { name: key, text: key.length === 1 ? key : undefined } : key)) return; } };
  const ui = { c: new Proxy({}, { get: () => (x) => String(x) }), screen };
  return { term, ui, drawn };
}

test('choices: the terminal list is ticked with Space, filtered by typing, sent with Enter', async () => {
  const items = EFFECTS.map(([label, hint]) => ({ label, hint }));
  let t = fakeTerminal(['space', 'down', 'down', 'space', 'return']);
  assert.deepEqual(await pickMany({ ...t, title: 'pick', items }), [0, 2]);
  assert.ok(t.drawn.at(-2).some((l) => /\[x\] lean-in/.test(l)) && t.drawn.at(-2).some((l) => /2 ticked/.test(l)));

  // Typing narrows the list; what was ticked before stays ticked, and comes back in list order.
  t = fakeTerminal(['down', 'space', 's', 'w', 'space', 'backspace', 'backspace', 'return']);
  assert.deepEqual(await pickMany({ ...t, title: 'pick', items }), [1, 4]);
  t = fakeTerminal(['space', 'space', 'return']);
  assert.deepEqual(await pickMany({ ...t, title: 'pick', items }), [], 'ticked and unticked: nothing chosen');
  t = fakeTerminal(['space', 'escape']);
  assert.equal(await pickMany({ ...t, title: 'pick', items }), null, 'Esc cancels');
  // Ctrl+A ticks everything listed, and unticks it when it all is; with a filter, only what matches.
  const all = { name: 'a', ctrl: true };
  t = fakeTerminal([all, 'return']);
  assert.deepEqual(await pickMany({ ...t, title: 'pick', items }), [0, 1, 2, 3, 4, 5, 6]);
  t = fakeTerminal([all, all, 'return']);
  assert.deepEqual(await pickMany({ ...t, title: 'pick', items }), []);
  t = fakeTerminal(['space', 't', all, 'backspace', 'return']);
  assert.deepEqual(await pickMany({ ...t, title: 'pick', items }), [0, 1, 2, 4, 5, 6], 'all whose name or description has a "t" — everything but moody, which the filter had hidden');
  t = fakeTerminal(['z', 'z', 'space', 'return']);
  assert.deepEqual(await pickMany({ ...t, title: 'pick', items }), [], 'nothing matches: nothing to tick');
});

test('choices: /skill with nothing after it offers the list; what is ticked becomes its arguments', async () => {
  const said = [];
  const run = (keys, input = '/effects', extra = {}) => {
    const t = fakeTerminal(keys);
    const ui = { ...t.ui, notice: (x) => void said.push(x), warn: (x) => void said.push(x) };
    const agent = { cwd: os.tmpdir(), skills: [skill()] };
    return runCommand(input, { agent, ui, term: t.term, config: { ...DEFAULTS }, permissions: new Permissions({ mode: 'ask', cwd: os.tmpdir(), ask: null }), session: null, hub: null, ...extra });
  };
  const picked = await run(['space', 'down', 'space', 'return']);
  assert.equal(picked.label, '/effects orbit, spotlight');
  assert.match(picked.prompt, /^Skill "effects"[\s\S]*Arguments from the user: orbit, spotlight$/);

  assert.equal(await run(['space', 'escape']), undefined);
  assert.match(said.at(-1), /\/effects cancelled/);
  const none = await run(['return']);
  assert.doesNotMatch(none.prompt, /Arguments from the user/, 'nothing ticked: the skill runs as it would have');
  // With something typed after it, the list is not shown.
  const typed = await run([], '/effects orbit on the word hello');
  assert.match(typed.prompt, /Arguments from the user: orbit on the word hello$/);

  // On the phone the list is handed over, not drawn; nothing runs until the answer comes back.
  const offered = [];
  const agent = { cwd: os.tmpdir(), skills: [skill()] };
  const ui = { c: new Proxy({}, { get: () => (x) => String(x) }), notice() {}, warn() {} };
  const ctx = { agent, ui, term: null, config: { ...DEFAULTS }, permissions: new Permissions({ mode: 'ask', cwd: os.tmpdir(), ask: null }), session: null, hub: null, choose: (list) => offered.push(list) };
  assert.equal(await runPhoneCommand('/effects', ctx), undefined);
  assert.deepEqual([offered[0].skill, offered[0].title, offered[0].items.length, offered[0].items[0]], ['effects', '/effects — tick what to use', 7, { value: 'orbit', description: 'Reels circle your head' }]);
  const back = await runPhoneCommand('/effects orbit, tap', ctx);
  assert.match(back.prompt, /Arguments from the user: orbit, tap$/);
  // Where nobody can be shown a list (a scheduled job, a chat), the skill runs as before.
  const plain = await runPhoneCommand('/effects', { ...ctx, choose: undefined });
  assert.match(plain.prompt, /^Skill "effects"/);
});
