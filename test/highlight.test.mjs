// Code in colour: the diffs SEEKER shows and the code blocks in its answers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlightLine, highlighter, languageOf } from '../src/highlight.mjs';
import { MdStream } from '../src/markdown.mjs';

const paint = highlighter(24);
// Each coloured piece as [colour, text]; plain text is left out.
const pieces = (line) => [...line.matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m(.*?)\x1b\[39m/g)].map((m) => [{ '255;123;114': 'keyword', '126;231;135': 'string', '86;212;221': 'func', '199;146;234': 'number', '255;184;108': 'type', '139;148;158': 'comment' }[m[1]], m[2]]);
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('the language comes from a file name or a code block tag', () => {
  assert.equal(languageOf('src/claude-code.mjs'), 'js');
  assert.equal(languageOf('/a/b/App.tsx'), 'js');
  assert.equal(languageOf('python'), 'py');
  assert.equal(languageOf('Dockerfile'), 'sh');
  assert.equal(languageOf('notes.txt'), null);
  assert.equal(languageOf(''), null);
});

test('keywords, strings, calls, numbers, types and comments each get their colour, and the text is unchanged', () => {
  const line = "const x = await fetch('/a', { n: 30 * 60_000 }); // later";
  const out = highlightLine(line, 'js', paint);
  assert.equal(plain(out), line);
  assert.deepEqual(pieces(out), [['keyword', 'const'], ['keyword', 'await'], ['func', 'fetch'], ['string', "'/a'"], ['number', '30'], ['number', '60_000'], ['comment', '// later']]);
  assert.deepEqual(pieces(highlightLine('def total(items, tax=0.11):  # sum', 'py', paint)), [['keyword', 'def'], ['func', 'total'], ['number', '0.11'], ['comment', '# sum']]);
  assert.deepEqual(pieces(highlightLine('let s: Session = new Session(cwd)', 'js', paint)), [['keyword', 'let'], ['type', 'Session'], ['keyword', 'new'], ['func', 'Session']]);
  // A word after a dot is a property, not a keyword; digits in a name are not a number.
  assert.deepEqual(pieces(highlightLine('a.new.delete(x2)', 'js', paint)), [['func', 'delete']]);
  // Only the text colour is set, so the green or red behind a diff line stays.
  assert.ok(!/\x1b\[0m|\x1b\[4\d/.test(out));
});

test('a block comment or a long string goes on into the next lines', () => {
  const state = {};
  assert.deepEqual(pieces(highlightLine('/* starts here', 'js', paint, state)), [['comment', '/* starts here']]);
  assert.deepEqual(pieces(highlightLine('still a comment', 'js', paint, state)), [['comment', 'still a comment']]);
  assert.deepEqual(pieces(highlightLine('ends */ return 1', 'js', paint, state)), [['comment', 'ends */'], ['keyword', 'return'], ['number', '1']]);
  const py = {};
  highlightLine('x = """first', 'py', paint, py);
  assert.deepEqual(pieces(highlightLine('second""" if y', 'py', paint, py)), [['string', 'second"""'], ['keyword', 'if']]);
});

test('without colour, or in a language not known here, the line is left as it is', () => {
  assert.equal(highlightLine('const a = 1', 'js', highlighter(0)), 'const a = 1');
  assert.equal(highlightLine('const a = 1', 'cobol', paint), 'const a = 1');
  assert.match(highlightLine('const a', 'js', highlighter(4)), /\x1b\[31mconst\x1b\[39m/);
});

test('a code block in an answer is coloured by its tag, one whole line at a time', () => {
  let out = '';
  const md = new MdStream((s) => (out += s), 24);
  for (const ch of 'See:\n```js\nconst a = 1;\n```\n```\nplain block\n```\ndone\n') md.push(ch);
  md.flush();
  assert.equal(plain(out), 'See:\n┌─ js\nconst a = 1;\n└─\n┌─\nplain block\n└─\ndone\n');
  assert.deepEqual(pieces(out.split('\n')[2]), [['keyword', 'const'], ['number', '1']]);
  assert.ok(out.split('\n')[5].startsWith('\x1b[38;2;156;194;255m'), 'a block without a known language keeps the code tint');
});
