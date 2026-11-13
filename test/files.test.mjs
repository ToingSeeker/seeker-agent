// The file tools' extras: a syntax check after a write, and documents read as text.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TOOL_BY_NAME } from '../src/tools.mjs';

const dir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-files-')));
const has = (cmd) => spawnSync('which', [cmd]).status === 0;
const tool = (name, args, cwd) => TOOL_BY_NAME.get(name).run(args, { cwd, state: {} });

test('a file that does not parse is reported with the write, and a good one is not', async () => {
  const cwd = dir();
  const bad = await tool('write_file', { path: 'a.mjs', content: 'export const x = {\n' }, cwd);
  assert.match(bad.output, /^Created .*a\.mjs \(2 lines\)\n\n\[Syntax check FAILED for a\.mjs — the file was saved, but it does not parse\. Fix it before going on:\]\n[\s\S]*SyntaxError/);
  assert.match(bad.note, /syntax error/);
  const good = await tool('write_file', { path: 'b.mjs', content: 'export const x = 1;\n' }, cwd);
  assert.doesNotMatch(good.output, /Syntax check/);
  assert.match((await tool('write_file', { path: 'c.json', content: '{"a": 1,}' }, cwd)).output, /Syntax check FAILED for c\.json/);
  assert.match((await tool('edit_file', { path: 'b.mjs', old_string: 'x = 1;', new_string: 'x = ;' }, cwd)).output, /Syntax check FAILED for b\.mjs/);
  assert.doesNotMatch((await tool('write_file', { path: 'notes.md', content: '{ not code' }, cwd)).output, /Syntax check/);
  if (has('python3')) {
    assert.match((await tool('write_file', { path: 'd.py', content: 'def f(:\n  pass\n' }, cwd)).output, /Syntax check FAILED for d\.py/);
    assert.equal(fs.existsSync(path.join(cwd, '__pycache__')), false, 'the check leaves nothing behind');
  }
});

test('a notebook is read as its cells and outputs', async () => {
  const cwd = dir();
  fs.writeFileSync(path.join(cwd, 'n.ipynb'), JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['# Title'] }, { cell_type: 'code', source: ['print(1+1)'], outputs: [{ text: ['2\n'] }] }] }));
  const out = await tool('read_file', { path: 'n.ipynb' }, cwd);
  assert.match(out.output, /^\[Text extracted from n\.ipynb; this is not the file's own bytes/);
  assert.match(out.output, /--- cell 1 \[markdown\] ---\n\s+\d+\t# Title/);
  assert.match(out.output, /print\(1\+1\)[\s\S]*\[output\]\n\s+\d+\t2/);
});

test('Word, Excel, PDF and SQLite files are read as text, and are not overwritten with text', { skip: process.platform !== 'darwin' || !has('unzip') }, async () => {
  const cwd = dir();
  fs.writeFileSync(path.join(cwd, 'src.txt'), 'Kontrak sewa\nPasal 1: harga Rp 5.000.000\n');
  execFileSync('textutil', ['-convert', 'docx', '-output', path.join(cwd, 'doc.docx'), path.join(cwd, 'src.txt')]);
  const word = await tool('read_file', { path: 'doc.docx' }, cwd);
  assert.match(word.output, /Kontrak sewa[\s\S]*Pasal 1: harga Rp 5\.000\.000/);
  await assert.rejects(tool('write_file', { path: 'doc.docx', content: 'x' }, cwd), /binary document/);

  // A minimal workbook, built by hand.
  const x = path.join(cwd, 'x');
  fs.mkdirSync(path.join(x, 'xl/worksheets'), { recursive: true });
  fs.writeFileSync(path.join(x, 'xl/workbook.xml'), '<workbook><sheets><sheet name="Harga &amp; stok" sheetId="1"/></sheets></workbook>');
  fs.writeFileSync(path.join(x, 'xl/sharedStrings.xml'), '<sst><si><t>Barang</t></si><si><t>Kopi</t></si></sst>');
  fs.writeFileSync(path.join(x, 'xl/worksheets/sheet1.xml'), '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>3.5</v></c></row></sheetData></worksheet>');
  execFileSync('zip', ['-qr', path.join(cwd, 'book.xlsx'), '.'], { cwd: x });
  const sheet = await tool('read_file', { path: 'book.xlsx' }, cwd);
  assert.match(sheet.output, /--- sheet: Harga & stok ---\n\s+\d+\tBarang\t\t42\n\s+\d+\tKopi\t3\.5/);

  if (has('sqlite3')) {
    execFileSync('sqlite3', [path.join(cwd, 'app.db'), "CREATE TABLE users(id INTEGER, name TEXT); INSERT INTO users VALUES (1,'Budi'),(2,'Sari');"]);
    const before = fs.statSync(path.join(cwd, 'app.db')).mtimeMs;
    const db = await tool('read_file', { path: 'app.db' }, cwd);
    assert.match(db.output, /CREATE TABLE users\(id INTEGER, name TEXT\)/);
    assert.match(db.output, /--- table users: 2 rows; first 5 ---\n\s+\d+\tid\|name\n\s+\d+\t1\|Budi/);
    assert.equal(fs.statSync(path.join(cwd, 'app.db')).mtimeMs, before, 'reading does not touch the database');
  }

  if (has('pdftotext')) {
    const stream = 'BT /F1 18 Tf 40 700 Td (Faktur nomor 0042) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    let body = '%PDF-1.4\n';
    const offsets = objects.map((o, i) => {
      const at = body.length;
      body += `${i + 1} 0 obj\n${o}\nendobj\n`;
      return at;
    });
    const xref = body.length;
    body += `xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    fs.writeFileSync(path.join(cwd, 'f.pdf'), body);
    assert.match((await tool('read_file', { path: 'f.pdf' }, cwd)).output, /--- page 1 ---\n\s+\d+\t\s*Faktur nomor 0042/);
  }
});

test('the Python check cannot be made to run code from the project it checks', { skip: !has('python3') }, async () => {
  const cwd = dir();
  // A module named like the standard one the checker imports.
  fs.writeFileSync(path.join(cwd, 'ast.py'), `open(${JSON.stringify(path.join(cwd, 'ran.txt'))}, "w").write("x")\ndef parse(*a): pass\n`);
  const out = await tool('write_file', { path: 'app.py', content: 'def f(:\n' }, cwd);
  assert.match(out.output, /Syntax check FAILED for app\.py/, 'the real parser did the check');
  assert.equal(fs.existsSync(path.join(cwd, 'ran.txt')), false);
});
