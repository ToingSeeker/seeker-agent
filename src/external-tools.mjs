// How to show, and how to judge, a tool that a provider runs itself — Claude
// Code's Read, Edit, Bash and so on. SEEKER does not execute these; it only
// displays them and, where approval is needed, asks the user.

import fs from 'node:fs';
import path from 'node:path';
import { hunkRows } from './hunks.mjs';

const lines = (text) => String(text ?? '').split('\n');

/** `text` with the first `from` (or every one) turned into `to`; null when `from` is not in it. */
const swap = (text, from, to, all = false) => {
  if (typeof from !== 'string' || typeof to !== 'string' || !from || !text.includes(from)) return null;
  const parts = text.split(from);
  return all ? parts.join(to) : parts[0] + to + parts.slice(1).join(from);
};

/**
 * The change as numbered lines of the file, for the terminal. The file is read as it is now:
 * usually before the change, sometimes just after it (a tool that needed no approval is reported
 * once it has run), so the change is looked for in both directions. Null when it cannot be placed.
 */
function hunkOf(name, input, cwd) {
  try {
    const file = path.resolve(cwd || '.', String(input.file_path ?? ''));
    const now = fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : null;
    let was = null;
    let will = null;
    if (name === 'Write') {
      if (typeof input.content !== 'string' || now === input.content) return null;
      [was, will] = [now, input.content];
    } else if (now != null) {
      const edits = name === 'MultiEdit' ? (Array.isArray(input.edits) ? input.edits : []) : [input];
      const run = (text, forward) => edits.reduce((t, e) => (t == null ? null : forward ? swap(t, e.old_string, e.new_string, e.replace_all) : swap(t, e.new_string, e.old_string, e.replace_all)), text);
      const after = run(now, true);
      if (after != null) [was, will] = [now, after];
      else {
        const before = [...edits].reverse().reduce((t, e) => (t == null ? null : swap(t, e.new_string, e.old_string, e.replace_all)), now);
        if (before != null) [was, will] = [before, now];
      }
    }
    if (will == null) return null;
    const hunk = hunkRows(was == null ? [] : was.split('\n'), will.split('\n'));
    return hunk.rows.length ? hunk : null;
  } catch {
    return null; // a file that cannot be read is still shown, the plain way
  }
}
const preview = (removed, added) => ({
  removed: removed.slice(0, 12),
  added: added.slice(0, 12),
  more: Math.max(0, removed.length - 12) + Math.max(0, added.length - 12),
});
const count = (output, noun) => {
  const n = output.split('\n').filter((l) => l.trim()).length;
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
};

const TODO_MARK = { pending: '☐', in_progress: '◐', completed: '☑' };

/**
 * @returns {{
 *   verbs: [string, string], summary: string,
 *   risk?: 'read'|'write'|'exec'|'net'|'other',   absent = safe to show without asking
 *   path?: string, command?: string, url?: string,
 *   diff?: object,                          what a write is about to change
 *   note?: (output: string) => string,      short remark once it has finished
 *   display?: (output: string) => string, displayLines?: number,
 * }}
 */
export function describeExternal(name, input = {}, cwd = '') {
  const about = describe(name, input);
  // Claude Code reports absolute paths; inside the project the relative one reads better.
  if (cwd && about.summary.startsWith(`${cwd}/`)) about.summary = about.summary.slice(cwd.length + 1);
  if (about.diff && ['Edit', 'MultiEdit', 'Write'].includes(name)) {
    const hunk = hunkOf(name, input, cwd);
    if (hunk) about.diff.hunk = hunk;
    about.diff.path = input.file_path ?? null;
  }
  return about;
}

function describe(name, input) {
  switch (name) {
    case 'Read':
      // Looking is judged as a read, like SEEKER's own read_file: Claude Code asks about a file outside the
      // project (a file sent from the phone sits in ~/Downloads/SEEKER), and plan mode must let that through.
      return { verbs: ['Reading', 'Read'], summary: input.file_path ?? '', risk: 'read', path: input.file_path, note: (out) => count(out, 'line') };
    case 'Edit':
      return {
        verbs: ['Editing', 'Edited'],
        summary: input.file_path ?? '',
        risk: 'write',
        path: input.file_path,
        diff: preview(lines(input.old_string), lines(input.new_string)),
      };
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return {
        verbs: ['Editing', 'Edited'],
        summary: `${input.file_path ?? ''} (${edits.length} changes)`,
        risk: 'write',
        path: input.file_path,
        diff: preview(edits.flatMap((e) => lines(e.old_string)), edits.flatMap((e) => lines(e.new_string))),
      };
    }
    case 'Write':
      return {
        verbs: ['Writing', 'Wrote'],
        summary: input.file_path ?? '',
        risk: 'write',
        path: input.file_path,
        diff: preview([], lines(input.content)),
      };
    case 'NotebookEdit':
      return { verbs: ['Editing', 'Edited'], summary: input.notebook_path ?? '', risk: 'write', path: input.notebook_path };
    case 'Bash':
      return {
        verbs: ['Running', 'Ran'],
        summary: input.command ?? '',
        risk: 'exec',
        command: String(input.command ?? ''),
        display: (out) => out,
        displayLines: 4,
      };
    case 'Glob':
      return { verbs: ['Finding', 'Found'], summary: input.pattern ?? '', risk: 'read', path: input.path, note: (out) => count(out, 'file') };
    case 'Grep':
      return { verbs: ['Searching for', 'Searched for'], summary: `"${input.pattern ?? ''}"${input.glob ? ` in ${input.glob}` : ''}`, risk: 'read', path: input.path, note: (out) => count(out, 'line') };
    case 'WebFetch':
      return { verbs: ['Fetching', 'Fetched'], summary: input.url ?? '', risk: 'net', url: input.url };
    case 'WebSearch':
      return { verbs: ['Searching the web for', 'Searched the web for'], summary: `"${input.query ?? ''}"`, risk: 'other' };
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return {
        verbs: ['Updating plan', 'Updated plan'],
        summary: '',
        display: () => todos.map((t) => `${TODO_MARK[t.status] ?? '☐'} ${t.content ?? ''}`).join('\n'),
        displayLines: 30,
      };
    }
    case 'Task':
    case 'Agent':
      return { verbs: ['Delegating', 'Delegated'], summary: input.description ?? input.subagent_type ?? '' };
    default: {
      const args = JSON.stringify(input);
      return { verbs: ['Using', 'Used'], summary: `${name}${args === '{}' ? '' : ` ${args}`}`, risk: 'other' };
    }
  }
}
