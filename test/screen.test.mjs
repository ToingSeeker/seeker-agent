import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Screen } from '../src/screen.mjs';
import { clipAnsi, visibleLength, wrapAnsi } from '../src/text.mjs';

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

/** Just enough of a terminal to check what ends up on screen and what ends up in scrollback. */
class FakeTerminal {
  constructor(columns, rows) {
    this.columns = columns;
    this.rows = rows;
    this.grid = Array.from({ length: rows }, () => []);
    this.scrollback = [];
    this.r = 0;
    this.c = 0;
    this.cursorVisible = true;
  }

  on() {}

  off() {}

  write(data) {
    const re = /\x1b\[([0-9;?]*)([A-Za-z])|([\s\S])/gu;
    for (const m of data.matchAll(re)) {
      if (m[2]) {
        const [a, b] = m[1].split(';').map((n) => Number(n) || 1);
        if (m[2] === 'H') [this.r, this.c] = [Math.min(this.rows, a) - 1, b - 1];
        else if (m[2] === 'K') this.grid[this.r].length = this.c;
        else if (m[2] === 'h' && m[1] === '?25') this.cursorVisible = true;
        else if (m[2] === 'l' && m[1] === '?25') this.cursorVisible = false;
      } else if (m[3] === '\n') {
        if (this.r === this.rows - 1) {
          this.scrollback.push(this.line(0));
          this.grid.shift();
          this.grid.push([]);
        } else this.r++;
        this.c = 0;
      } else {
        assert.ok(this.c < this.columns, `wrote past the right edge on row ${this.r}`);
        this.grid[this.r][this.c++] = m[3];
      }
    }
  }

  line(i) {
    return Array.from(this.grid[i], (ch) => ch ?? ' ').join('').trimEnd();
  }

  lines() {
    return this.grid.map((_, i) => this.line(i));
  }
}

const colors = new Proxy({}, { get: () => (s) => String(s) });

function makeScreen(columns = 40, rows = 24) {
  const out = new FakeTerminal(columns, rows);
  const screen = new Screen({ out, colors, header: (width) => ['LOGO', '='.repeat(width)] });
  screen.setFooter({ idle: 'working', hints: () => 'HINTS', status: () => 'STATUS' });
  screen.start();
  return { out, screen };
}

test('wrapAnsi breaks at spaces, hard-breaks long words and carries colour', () => {
  assert.deepEqual(wrapAnsi('the quick brown fox', 10), ['the quick', 'brown fox']);
  assert.deepEqual(wrapAnsi('abcdefghijkl', 5), ['abcde', 'fghij', 'kl']);
  assert.deepEqual(wrapAnsi('', 5), ['']);
  const rows = wrapAnsi('\x1b[31mred words here\x1b[0m', 9);
  assert.deepEqual(rows.map(strip), ['red words', 'here']);
  assert.ok(rows[0].endsWith('\x1b[0m') && rows[1].startsWith('\x1b[31m'), 'colour closed and reopened across the break');
  for (const row of wrapAnsi('漢字漢字漢字 emoji 🎉🎉🎉 text', 8)) assert.ok(visibleLength(row) <= 8);
  assert.equal(strip(clipAnsi('\x1b[1mabcdef\x1b[0m', 3)), 'abc');
});

test('header stays on top and the input box at the bottom while the conversation scrolls', () => {
  const { out, screen } = makeScreen();
  for (let i = 0; i < 60; i++) screen.append(`line ${i}\n`);

  const lines = out.lines();
  assert.equal(lines[0], 'LOGO');
  assert.equal(lines[1], '='.repeat(39));
  assert.equal(lines.at(-1), 'STATUS');
  assert.equal(lines.at(-3), 'HINTS');
  assert.match(lines.at(-5), /^│ › working\s+│$/);

  // 24 rows − 2 header − 7 footer = 15 conversation rows, the newest ones.
  assert.deepEqual(lines.slice(2, 17), Array.from({ length: 15 }, (_, i) => `line ${45 + i}`));
  // Everything older went to scrollback, in order, and nothing but conversation went there.
  const history = out.scrollback.filter((l) => l !== '');
  assert.deepEqual(history, Array.from({ length: 45 }, (_, i) => `line ${i}`));
});

test('the cursor sits in the input box and long input grows the box upward', () => {
  const { out, screen } = makeScreen();
  for (let i = 0; i < 30; i++) screen.append(`line ${i}\n`);
  screen.setFooter({ input: { text: 'hello', cursor: 5, placeholder: 'ask' } });
  assert.equal(out.cursorVisible, true);
  assert.equal(out.line(out.r).slice(0, 9), '│ › hello');
  assert.equal(out.c, 9);

  screen.setFooter({ input: { text: 'one\ntwo\nthree', cursor: 13, placeholder: 'ask' } });
  const lines = out.lines();
  assert.equal(lines[0], 'LOGO');
  assert.equal(lines.at(-1), 'STATUS');
  assert.match(lines.at(-7), /^│ › one/);
  assert.match(lines.at(-5), /^│ {3}three/);
  assert.equal(out.r, 24 - 5);
  // The two rows the taller box covered were moved to scrollback, not lost.
  assert.deepEqual(out.scrollback.filter((l) => l !== '').at(-1), 'line 16');
  assert.equal(lines[2], 'line 17');

  screen.setFooter({ input: null });
  assert.equal(out.cursorVisible, false);
});

test('an unfinished line and live rows are shown but never sent to scrollback', () => {
  const { out, screen } = makeScreen();
  screen.append('done\nstill typ');
  screen.append('ing');
  screen.setLive(['  spinner']);
  assert.deepEqual(out.lines().slice(2, 5), ['done', 'still typing', '  spinner']);
  screen.setLive([]);
  screen.append('\n');
  assert.deepEqual(out.lines().slice(2, 5), ['done', 'still typing', '']);
  assert.deepEqual(out.scrollback.filter((l) => l !== ''), []);
});

test('escape codes that would move the cursor are stripped from conversation text', () => {
  const { out, screen } = makeScreen();
  screen.append('a\x1b[2Jb\x1b[5;5Hc\x1b[31md\x1b[0m\r\n');
  assert.equal(out.lines()[2], 'abcd');
  assert.equal(out.lines()[0], 'LOGO');
});

test('a colour left open continues on the next line', () => {
  const { screen } = makeScreen();
  screen.append('\x1b[2mdim one\ndim two\x1b[0m\n');
  assert.equal(screen.rows[1], '\x1b[2mdim two\x1b[0m');
});

test('header art: the robot and wordmark keep their width in every pose', async () => {
  const { ROBOT_WIDTH, pose, robotRows, wordmarkRows } = await import('../src/mascot.mjs');
  const { visibleLength } = await import('../src/text.mjs');
  const seen = new Set();
  for (let tick = 0; tick < 64; tick++) {
    for (const busy of [false, true]) {
      const state = pose(tick, busy);
      seen.add(`${state.eyes}/${state.look}`);
      for (const color of [true, false]) {
        const rows = robotRows(state, color);
        assert.equal(rows.length, 4);
        for (const row of rows) assert.equal(visibleLength(row), ROBOT_WIDTH);
        if (!color) assert.ok(!rows.join('').includes('\x1b'));
      }
      if (!busy) assert.equal(state.antenna, false);
    }
  }
  // The loop blinks and glances both ways, and repeats.
  assert.deepEqual([...seen].sort(), ['closed/center', 'open/center', 'open/left', 'open/right']);
  assert.deepEqual(pose(70), pose(6));
  assert.notEqual(robotRows(pose(18)).join(''), robotRows(pose(0)).join(''));
  const word = wordmarkRows();
  assert.equal(word.length, 3);
  assert.ok(word.every((row) => visibleLength(row) === visibleLength(word[0])));
});

test('header: rows never exceed the window, wide or narrow', async () => {
  const { UI } = await import('../src/ui.mjs');
  const { visibleLength } = await import('../src/text.mjs');
  const ui = new UI();
  for (const width of [120, 96, 70, 64, 40]) {
    const rows = ui.headerRows(width, { ready: true, provider: { local: true, label: 'Ollama' } });
    assert.equal(rows.length, 5);
    for (const row of rows) assert.ok(visibleLength(row) <= Math.max(width, 51), `width ${width}: ${visibleLength(row)}`);
    // Whether the model is local or in the cloud must stay visible on any ordinary window.
    if (width >= 64) assert.ok(rows.join('\n').includes('READY'), `badge shown at width ${width}`);
  }
});
