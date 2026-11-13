// Reading documents that are not plain text: notebooks, Word and OpenDocument
// files, PDFs, spreadsheets and SQLite databases come back as text, using only the
// tools a system already has (textutil on macOS, unzip, pdftotext, sqlite3).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_CELL_OUTPUT = 20_000;
const MAX_ROWS = 5000;

export const DOCUMENT_EXTENSIONS = new Set(['.ipynb', '.docx', '.doc', '.rtf', '.odt', '.pdf', '.xlsx', '.db', '.sqlite', '.sqlite3']);

function run(cmd, args, { maxBytes = 20_000_000, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    let err = '';
    child.stdout.on('data', (d) => {
      if (size < maxBytes) chunks.push(d);
      size += d.length;
    });
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', () => (clearTimeout(timer), resolve({ missing: true })));
    child.on('close', (code) => (clearTimeout(timer), resolve({ ok: code === 0, out: Buffer.concat(chunks).toString('utf8'), err: err.trim() })));
  });
}

const unxml = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function notebook(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const text = (value) => (Array.isArray(value) ? value.join('') : String(value ?? ''));
  const parts = [];
  (data.cells ?? []).forEach((cell, i) => {
    parts.push(`--- cell ${i + 1} [${cell.cell_type}] ---\n${text(cell.source)}`);
    for (const out of cell.outputs ?? []) {
      let shown = out.text ? text(out.text) : out.data?.['text/plain'] ? text(out.data['text/plain']) : out.ename ? `${out.ename}: ${out.evalue}` : '';
      if (shown.length > MAX_CELL_OUTPUT) shown = `${shown.slice(0, MAX_CELL_OUTPUT)}\n… [output cut]`;
      if (shown.trim()) parts.push(`[output]\n${shown.trimEnd()}`);
    }
  });
  return parts.join('\n\n');
}

async function wordLike(file, ext) {
  // macOS converts all of these itself.
  if (process.platform === 'darwin') {
    const result = await run('textutil', ['-convert', 'txt', '-stdout', file]);
    if (result.ok) return result.out;
  }
  if (ext !== '.docx') return null;
  const xml = await run('unzip', ['-p', file, 'word/document.xml']);
  if (!xml.ok) return null;
  return unxml(xml.out.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, ''));
}

async function spreadsheet(file) {
  const read = async (name) => {
    const result = await run('unzip', ['-p', file, name]);
    return result.ok ? result.out : null;
  };
  const workbook = await read('xl/workbook.xml');
  if (workbook === null) return null;
  const shared = [...((await read('xl/sharedStrings.xml')) ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => unxml(m[1]));
  const parts = [];
  for (let i = 0; i < names.length; i++) {
    const xml = await read(`xl/worksheets/sheet${i + 1}.xml`);
    if (xml === null) continue;
    const rows = [];
    for (const row of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= MAX_ROWS) {
        rows.push(`… [more than ${MAX_ROWS} rows; the rest is not shown]`);
        break;
      }
      const cells = [];
      for (const cell of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const column = /r="([A-Z]+)\d+"/.exec(cell[1])?.[1] ?? '';
        const index = [...column].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[2] ?? '')?.[1] ?? [...(cell[2] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('');
        const value = /t="s"/.test(cell[1]) ? (shared[Number(raw)] ?? '') : unxml(raw);
        if (index >= 0 && index < 256) cells[index] = value;
      }
      rows.push(Array.from(cells, (c) => c ?? '').join('\t'));
    }
    parts.push(`--- sheet: ${names[i]} ---\n${rows.join('\n')}`);
  }
  return parts.join('\n\n');
}

async function sqlite(file) {
  // Opened read-only: looking at a database must never change it.
  const uri = `file:${encodeURI(file)}?mode=ro&immutable=1`;
  const query = (sql) => run('sqlite3', ['-readonly', uri, sql]);
  const schema = await query('.schema');
  if (schema.missing) return { missing: 'sqlite3' };
  if (!schema.ok) return null;
  const tables = (await query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).out.split('\n').filter(Boolean);
  const parts = [`--- schema ---\n${schema.out.trim()}`];
  for (const table of tables.slice(0, 40)) {
    const quoted = `"${table.replace(/"/g, '""')}"`;
    const count = (await query(`SELECT COUNT(*) FROM ${quoted}`)).out.trim();
    const rows = (await run('sqlite3', ['-readonly', '-header', uri, `SELECT * FROM ${quoted} LIMIT 5`])).out.trim();
    parts.push(`--- table ${table}: ${count} rows; first 5 ---\n${rows || '(empty)'}`);
  }
  return parts.join('\n\n');
}

async function pdf(file) {
  const result = await run('pdftotext', ['-layout', file, '-']);
  if (result.missing) return { missing: 'pdftotext (part of poppler: `brew install poppler`)' };
  if (!result.ok) return null;
  const pages = result.out.split('\f');
  if (pages.at(-1)?.trim() === '') pages.pop();
  const empty = pages.filter((p) => p.trim().length < 20).length;
  let note = '';
  if (pages.length && empty === pages.length) {
    note = `[NEEDS OCR: all ${pages.length} pages of this PDF are scanned images with no text layer — their content is MISSING below. Render the pages you need as images (e.g. \`pdftoppm -jpeg -r 150 -f <first> -l <last> ${file} /tmp/page\`) and look at them with read_file.]\n\n`;
  } else if (empty >= 2 && (empty / pages.length >= 0.2 || empty >= 10)) {
    note = `[EXTRACTION COVERAGE WARNING: ${empty} of ${pages.length} pages in this PDF yielded no text. Those pages are likely scanned images (or blank) — their content is MISSING from the extracted text below. Decide which gaps you actually need; render just that range with \`pdftoppm -jpeg -r 150 -f <first> -l <last> ${file} /tmp/page\` and look at each image with read_file.]\n\n`;
  }
  return note + pages.map((p, i) => `--- page ${i + 1} ---\n${p.trimEnd()}`).join('\n\n');
}

/**
 * The text of a document, or a reason it could not be read.
 * @returns {Promise<{ text: string } | { error: string }>}
 */
export async function extractDocument(file) {
  const ext = path.extname(file).toLowerCase();
  const size = fs.statSync(file).size;
  if (size > MAX_DOCUMENT_BYTES) return { error: `The document is ${Math.round(size / 1024 / 1024)} MB; documents over 50 MB are not read.` };
  let result;
  try {
    if (ext === '.ipynb') result = notebook(file);
    else if (['.docx', '.doc', '.rtf', '.odt'].includes(ext)) result = await wordLike(file, ext);
    else if (ext === '.xlsx') result = await spreadsheet(file);
    else if (ext === '.pdf') result = await pdf(file);
    else result = await sqlite(file);
  } catch (err) {
    return { error: `Could not read this ${ext} file: ${err.message}` };
  }
  if (result?.missing) return { error: `Reading ${ext} files needs ${result.missing}, which is not installed on this machine. Tell the user, or work with the file another way.` };
  if (typeof result !== 'string') return { error: `Could not extract text from this ${ext} file (it may be damaged, encrypted or in an unexpected format).` };
  return { text: result };
}
