// How to show, and how to judge, a tool that a provider runs itself — Claude
// Code's Read, Edit, Bash and so on. SEEKER does not execute these; it only
// displays them and, where approval is needed, asks the user.

const lines = (text) => String(text ?? '').split('\n');
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
 *   risk?: 'write'|'exec'|'net'|'other',   absent = safe to show without asking
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
  return about;
}

function describe(name, input) {
  switch (name) {
    case 'Read':
      return { verbs: ['Reading', 'Read'], summary: input.file_path ?? '', note: (out) => count(out, 'line') };
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
      return { verbs: ['Finding', 'Found'], summary: input.pattern ?? '', note: (out) => count(out, 'file') };
    case 'Grep':
      return { verbs: ['Searching for', 'Searched for'], summary: `"${input.pattern ?? ''}"${input.glob ? ` in ${input.glob}` : ''}`, note: (out) => count(out, 'line') };
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
