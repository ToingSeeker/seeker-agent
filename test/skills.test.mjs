import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SETTINGS } from '../src/config.mjs';
import { buildSystemPrompt } from '../src/prompt.mjs';
import { loadSkills, parseSkillFile, renderSkill } from '../src/skills.mjs';
import { TOOL_BY_NAME } from '../src/tools.mjs';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

test('frontmatter: plain, quoted and folded values', () => {
  const { meta, body } = parseSkillFile('---\nname: "deploy"\ndescription: >\n  Deploy the app\n  to Railway.\nother: x\n---\n\n# Steps\n1. go\n');
  assert.deepEqual(meta, { name: 'deploy', description: 'Deploy the app to Railway.', other: 'x' });
  assert.equal(body, '# Steps\n1. go');
  assert.deepEqual(parseSkillFile('just text'), { meta: {}, body: 'just text' });
});

test('skills load from extra dirs and the project, project winning on a clash', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-skill-'));
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-extra-'));
  write(path.join(extra, 'review/SKILL.md'), '---\nname: review\ndescription: from extra\n---\nextra body');
  write(path.join(extra, 'notes.md'), '# Catatan rilis\nisi');
  write(path.join(cwd, '.seeker/skills/review/SKILL.md'), '---\ndescription: from project\n---\nproject body');
  write(path.join(cwd, '.seeker/skills/empty/SKILL.md'), '---\nname: empty\n---\n');

  // Skills installed for the real user on this machine are not part of this test.
  const skills = loadSkills(cwd, [extra]).filter((s) => s.source === 'extra' || s.source === 'project');
  assert.deepEqual(skills.map((s) => [s.name, s.description, s.source]), [
    ['notes', 'Catatan rilis', 'extra'],
    ['review', 'from project', 'project'],
  ]);
  assert.match(renderSkill(skills[1], 'src/app.js'), /project body\n\nArguments from the user: src\/app\.js$/);
});

test('skills are listed in the system prompt and loaded by the skill tool', async () => {
  const skills = [{ name: 'review', description: 'Review code', body: 'Check the diff.', dir: '/x', source: 'user' }];
  const { prompt } = buildSystemPrompt({ cwd: os.tmpdir(), model: 'm', skills });
  assert.match(prompt, /# Skills[\s\S]*- review: Review code/);
  assert.doesNotMatch(prompt, /Check the diff/, 'the body stays out until loaded');
  assert.doesNotMatch(buildSystemPrompt({ cwd: os.tmpdir(), model: 'm' }).prompt, /# Skills/);

  const tool = TOOL_BY_NAME.get('skill');
  assert.match((await tool.run({ name: '/Review' }, { skills })).output, /Check the diff\./);
  await assert.rejects(tool.run({ name: 'nope' }, { skills }), /No skill named "nope". Available: review/);
});

test('config values are validated', () => {
  assert.equal(SETTINGS.numCtx.parse('65536'), 65536);
  assert.equal(SETTINGS.numCtx.parse('100'), undefined);
  assert.equal(SETTINGS.numCtx.parse('abc'), undefined);
  assert.equal(SETTINGS.think.parse('off'), false);
  assert.equal(SETTINGS.think.parse('maybe'), undefined);
  assert.equal(SETTINGS.permissionMode.parse('auto'), 'auto');
  assert.equal(SETTINGS.permissionMode.parse('yes'), undefined);
  assert.equal(SETTINGS.host.parse('localhost'), 'http://localhost:11434');
});

test('menu stepping wraps and recovers from a value outside the list', async () => {
  const { step } = await import('../src/menu.mjs');
  assert.equal(step([1, 2, 3], 3, 1), 1);
  assert.equal(step([1, 2, 3], 1, -1), 3);
  assert.equal(step([1, 2, 3], 99, 1), 1);
  assert.equal(step([true, false], true, 1), false);
});

test('input layout wraps text and finds the cursor', async () => {
  const { layout } = await import('../src/input.mjs');
  assert.deepEqual(layout('', 0, 10), { rows: [''], starts: [0], cursorRow: 0, cursorCol: 0 });
  const wrapped = layout('abcdefghij', 10, 4);
  assert.deepEqual(wrapped.rows, ['abcd', 'efgh', 'ij']);
  assert.deepEqual([wrapped.cursorRow, wrapped.cursorCol], [2, 2]);
  assert.deepEqual([layout('abcdefghij', 4, 4).cursorRow, layout('abcdefghij', 4, 4).cursorCol], [1, 0]);
  const multi = layout('ab\n\ncd', 3, 10);
  assert.deepEqual(multi.rows, ['ab', '', 'cd']);
  assert.deepEqual(multi.starts, [0, 3, 4]);
  assert.deepEqual([multi.cursorRow, multi.cursorCol], [1, 0]);
  assert.deepEqual([layout('abcd', 4, 4).cursorRow, layout('abcd', 4, 4).cursorCol], [0, 4], 'cursor may sit one past a full row');
});

test('slash suggestions cover commands and skills', async () => {
  const { matchCommands } = await import('../src/commands.mjs');
  const skills = [{ name: 'review', description: 'Review code' }];
  assert.deepEqual(matchCommands('/re', skills).map((m) => m[0]), ['/resume', '/review']);
  assert.equal(matchCommands('/', skills).length, 15);
  assert.deepEqual(matchCommands('/review src', skills), [], 'no suggestions once arguments start');
  assert.deepEqual(matchCommands('hello', skills), []);
});

test('status bar always fits the width it is given', async () => {
  const { UI, visibleLength } = await import('../src/ui.mjs');
  const ui = new UI();
  const info = { model: 'qwen3.5:27b', cwd: '/very/long/path/'.repeat(8), used: 1234, limit: 32768, provider: { label: 'Ollama', local: true }, tokensPerSecond: 41 };
  for (const width of [30, 60, 90, 140]) {
    assert.ok(visibleLength(ui.statusBar(width, info)) <= width, `status at ${width}`);
    assert.ok(visibleLength(ui.hintBar(width, false)) <= width, `hints at ${width}`);
  }
  assert.match(ui.statusBar(140, info), /1\.2k tokens • 32k context • 41 tok\/s$/);
});

test('memory: the index goes into the prompt when it fits, and becomes a pointer when it does not', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-mem-'));
  const script = `
    import { memorySection, projectMemoryDir, buildSystemPrompt } from ${JSON.stringify(path.resolve('src/prompt.mjs'))};
    const big = memorySection('/work/app', 200000);
    const small = memorySection('/work/app', 4096);
    const prompt = buildSystemPrompt({ cwd: '/work/app', model: 'm', contextLimit: 200000 });
    console.log(JSON.stringify({ big, small, dir: projectMemoryDir('/work/app'), inPrompt: prompt.prompt.includes('# Memory'), files: prompt.instructionFiles, none: memorySection('/work/other', 4096)?.label }));`;
  write(path.join(home, 'memory/MEMORY.md'), `# Memory Index\n\n${Array.from({ length: 60 }, (_, i) => `- [Note ${i}](n${i}.md) — ${'detail '.repeat(12)}`).join('\n')}`);
  write(path.join(home, 'memory/projects/work-app/MEMORY.md'), '- [Deploy](deploy.md) — how this app ships');
  const { execFileSync } = await import('node:child_process');
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, SEEKER_HOME: home }, encoding: 'utf8' }));

  assert.equal(out.dir, path.join(home, 'memory/projects/work-app'));
  assert.equal(out.big.label, 'memory (61 notes)');
  assert.match(out.big.text, /## This project[\s\S]*how this app ships[\s\S]*## All projects[\s\S]*Note 59/);
  // On a small context the project's own notes still fit; the large shared index is left on disk.
  assert.equal(out.small.label, 'memory (1 notes)');
  assert.match(out.small.text, /how this app ships/);
  assert.match(out.small.text, /too large to include[\s\S]*memory\/MEMORY\.md: search it with grep/);
  assert.doesNotMatch(out.small.text, /Note 59/);
  assert.equal(out.inPrompt, true);
  assert.deepEqual(out.files, ['memory (61 notes)']);
  assert.equal(out.none, 'memory (index on disk)');
});

test('plugin skills are namespaced, and the skill list shrinks to fit the context', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-plug-'));
  write(path.join(home, 'plugins/Sales/skills/forecast/SKILL.md'), '---\nname: forecast\ndescription: Build a sales forecast\n---\nSteps');
  write(path.join(home, 'plugins/Sales/skills/deal-review/SKILL.md'), '---\ndescription: Review a deal\n---\nSteps');
  write(path.join(home, 'skills/forecast/SKILL.md'), '---\ndescription: my own forecast\n---\nMine');
  const script = `
    import { loadSkills } from ${JSON.stringify(path.resolve('src/skills.mjs'))};
    console.log(JSON.stringify(loadSkills('/nowhere').map((s) => [s.name, s.source])));`;
  const { execFileSync } = await import('node:child_process');
  const names = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, SEEKER_HOME: home }, encoding: 'utf8' }));
  assert.deepEqual(names, [['forecast', 'user'], ['sales:deal-review', 'plugin'], ['sales:forecast', 'plugin']]);

  const { skillsSection } = await import('../src/prompt.mjs');
  const many = Array.from({ length: 500 }, (_, i) => ({ name: `group:skill-number-${i}`, description: 'does a very particular thing '.repeat(12) }));
  const few = many.slice(0, 5);
  assert.match(skillsSection(few, 32768), /- group:skill-number-0: does a very particular thing[\s\S]{150,}/, 'room for full descriptions');
  const large = skillsSection(many, 400_000);
  assert.ok(large.length <= 400_000 * 0.08 * 3.5 + 400 && /- group:skill-number-499: does a/.test(large), 'descriptions shortened to share the space');
  const at128 = skillsSection(many, 131072);
  assert.ok(at128.length <= 131072 * 0.08 * 3.5, `fits its share (${at128.length} chars)`);
  assert.ok(/- group:skill-number-0: does a very particular thing[^\n]*…\n/.test(at128), 'short descriptions at 128k');
  const namesOnly = skillsSection(many, 65536);
  assert.ok(namesOnly.length <= 65536 * 0.08 * 3.5 + 400, `names fit their share (${namesOnly.length} chars)`);
  assert.ok(/only their names are listed/.test(namesOnly) && namesOnly.includes('group:skill-number-0, group:skill-number-1,'), 'names only at 64k');
  assert.match(skillsSection(many, 8192), /500 skills are installed — too many to list/);
});
