import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME_DIR, projectSlug } from './config.mjs';
import { discoverContextFiles } from './context-files.mjs';
import { MEMORY_GUIDANCE, SESSION_SEARCH_GUIDANCE, memoryBlocks } from './memory.mjs';

export { projectSlug };

const MAX_INSTRUCTIONS = 12_000;
// Share of the model's context the memory index may take; the rest is for the work itself.
const MEMORY_SHARE = 0.2;
// Share of the context the list of skills may take.
const SKILLS_SHARE = 0.08;
const CHARS_PER_TOKEN = 3.5;

export const MEMORY_DIR = path.join(HOME_DIR, 'memory');
export const projectMemoryDir = (cwd) => path.join(MEMORY_DIR, 'projects', projectSlug(cwd));

const readIndex = (dir) => {
  try {
    return fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8').trim();
  } catch {
    return '';
  }
};

/**
 * Notes carried over from earlier sessions: one set for every project, one for
 * this folder. Only the index lines go into the prompt; the model reads a note's
 * file when it needs the detail.
 * @returns {{ text: string, label: string } | null}
 */
export function memorySection(cwd, contextLimit) {
  const sets = [
    { title: 'This project', dir: projectMemoryDir(cwd) },
    { title: 'All projects', dir: MEMORY_DIR },
  ]
    .map((s) => ({ ...s, index: readIndex(s.dir) }))
    .filter((s) => s.index);
  if (!sets.length) return null;

  let budget = Math.floor(contextLimit * MEMORY_SHARE * CHARS_PER_TOKEN);
  let notes = 0;
  const parts = sets.map((s) => {
    const count = s.index.split('\n').filter((l) => l.startsWith('- ')).length;
    if (s.index.length <= budget) {
      budget -= s.index.length;
      notes += count;
      return `## ${s.title} — files in ${s.dir}\n${s.index}`;
    }
    // A small local model cannot afford the whole index; it can still look things up.
    return `## ${s.title} — files in ${s.dir}\nThis index (${count} notes) is too large to include for this model. It is at ${s.dir}/MEMORY.md: search it with grep for the project or topic at hand before starting work that may depend on earlier sessions.`;
  });
  return {
    text: `# Notes on file
Notes saved in earlier sessions about the user, their projects and how they want work done. Each line is an index entry: a summary that points to a file in the folder named in its heading. Read the file before relying on a note. A note says what was true when it was written — if it names a file, command or setting, check that it still exists.

${parts.join('\n\n')}`,
    label: notes ? `memory (${notes} notes)` : 'memory (index on disk)',
  };
}

function readCapped(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    return text.length > MAX_INSTRUCTIONS ? `${text.slice(0, MAX_INSTRUCTIONS)}\n[truncated]` : text;
  } catch {
    return null;
  }
}

/**
 * User-level notes first, then the project's own instruction files (see context-files.mjs for
 * which ones apply). `real` is each project file's resolved path.
 */
export function loadInstructions(cwd, contextLimit) {
  const found = [];
  const global = readCapped(path.join(HOME_DIR, 'SEEKER.md'));
  if (global) found.push({ file: '~/.seeker/SEEKER.md', text: global });
  found.push(...discoverContextFiles(cwd, contextLimit));
  return found;
}

/**
 * The skill list for the prompt. With hundreds of skills the descriptions are
 * shortened to share the space; past that, only the names are listed.
 */
export function skillsSection(skills, contextLimit, { roots = null } = {}) {
  const budget = Math.floor(contextLimit * SKILLS_SHARE * CHARS_PER_TOKEN);
  // A provider with its own tools (Claude Code) has no `skill` tool, so it reads the file itself.
  const intro = roots
    ? `# SEEKER skills\nThese are instructions prepared for specific kinds of task. They are SEEKER's own, separate from any skills your harness lists. When the user's request matches one, read its SKILL.md BEFORE doing anything else and follow it; files it mentions are relative to its folder. A skill \`name\` is in \`<root>/<name>/SKILL.md\`, and \`plugin:name\` in \`${roots.plugins}/<plugin>/skills/\` (possibly one folder deeper). If the folder name differs, search those roots for \`name: <name>\` in a SKILL.md. Roots: ${roots.dirs.join(', ')}.`
    : `# Skills\nThese are instructions prepared for specific kinds of task. When the user's request matches one, call the \`skill\` tool with its exact name BEFORE doing anything else, then follow what it returns. If a skill you loaded was missing steps, had wrong commands, or needed pitfalls you discovered, update it with skill_manage before finishing.`;
  const each = Math.floor((budget - intro.length) / skills.length) - 1; // one character per line is its line break
  const line = (s, room) => `- ${s.name}: ${s.description.length > room ? `${s.description.slice(0, room - 1)}…` : s.description}`;
  const shortest = Math.min(...skills.map((s) => each - s.name.length - 4));
  if (shortest >= 220) return `${intro}\n\n${skills.map((s) => line(s, 220)).join('\n')}`;
  if (shortest >= 40) return `${intro}\n\n${skills.map((s) => line(s, each - s.name.length - 4)).join('\n')}`;
  const names = skills.map((s) => s.name).join(', ');
  if (names.length <= budget) return `${intro} There are too many to describe here, so only their names are listed; the name usually says what the skill is for.\n\n${names}`;
  return `${intro}\n\n${skills.length} skills are installed — too many to list for this model. Use one when the user names it (they can browse them with /skills).`;
}

/** Folders the skills come from, as loadSkills reads them, for a model that opens the files itself. */
function skillRoots(cwd, skillDirs = []) {
  const expand = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);
  const plugins = path.join(HOME_DIR, 'plugins');
  const dirs = [...skillDirs.map((d) => path.resolve(cwd, expand(String(d)))), path.join(HOME_DIR, 'skills'), path.join(cwd, '.seeker', 'skills'), plugins];
  return { plugins, dirs };
}

export function buildSystemPrompt({ cwd, model, skills = [], skillDirs = [], provider = { label: 'Ollama', local: true }, contextLimit = 32_768 }) {
  const memory = memorySection(cwd, contextLimit);
  const own = memoryBlocks(cwd);
  const where = provider.local
    ? `You run entirely on the user's own machine through ${provider.label} (model: ${model}).`
    : `You are powered by ${model === 'default' ? 'Claude' : model} through ${provider.label}; the tools run on the user's own machine.`;
  const instructions = loadInstructions(cwd, contextLimit);
  const loaded = [...instructions.map((i) => i.file), ...(own ? [`memory (${own.count} entr${own.count === 1 ? 'y' : 'ies'})`] : []), ...(memory ? [memory.label] : [])];
  const contextFiles = instructions.map((i) => i.real).filter(Boolean);
  if (provider.ownTools) {
    // This text is added to the provider's own instructions, so it only says what differs.
    const notes = [
      `You are running as the engine of SEEKER, the user's terminal coding agent. The user sees your replies and your tool activity in SEEKER's interface, and approves edits and commands there.
- Reply in the language the user writes in (Indonesian in, Indonesian out).
- Be concise: lead with the answer or the result, and report honestly what you verified and what you did not.
- Do not commit, push or delete files unless the user asked for exactly that.`,
      ...instructions.map(({ file, text }) => `# Project instructions (${file})\nThe user wrote these; follow them.\n\n${text}`),
      ...(own ? [`# What you know from earlier sessions\n${own.text}`] : []),
      ...(memory ? [memory.text] : []),
      ...(skills.length ? [skillsSection(skills, contextLimit, { roots: skillRoots(cwd, skillDirs) })] : []),
    ];
    return { prompt: notes.join('\n\n'), instructionFiles: loaded, contextFiles };
  }
  const isGit = fs.existsSync(path.join(cwd, '.git'));
  const parts = [
    `You are SEEKER, an AI coding agent working in the user's terminal. ${where}

# How you work
- You act by calling tools. Do not describe what you would do — do it, then report what happened.
- Never guess file contents, paths, function names or APIs. Look them up first with glob, grep and read_file.
- Read a file before you edit it. Use edit_file for changes to existing files: old_string must match the file exactly, indentation included, and be unique. Use write_file only for new files or complete rewrites.
- Match the conventions of the code around your change (naming, formatting, libraries already in use). Do not add dependencies without asking.
- After changing code, verify it when you can: run the tests, the build, or the script. Report honestly what passed and what failed — never claim something works if you did not run it.
- For work with three or more steps, keep a plan with todo_write and update it as you go.
- Keep going until the task is finished. Stop to ask only when a decision truly belongs to the user.
- If a tool call fails, read the error, fix the cause and try a different approach. Do not repeat the same failing call.
- Do not delete files, rewrite git history, commit or push unless the user asked for exactly that.
- bash: each command starts in the working directory. Never start interactive programs (editors, REPLs, prompts, watch mode). Put long-running servers in the background.

# Style
- Reply in the language the user writes in (Indonesian in, Indonesian out).
- Be concise. Lead with the answer or the result; skip preamble and do not restate the request.
- Use markdown sparingly. Refer to code as path:line.
- If you are unsure or could not verify something, say so plainly.

# Environment
- Working directory: ${cwd}
- Git repository: ${isGit ? 'yes' : 'no'}
- Platform: ${os.platform()} ${os.arch()}, shell ${path.basename(process.env.SHELL || 'sh')}
- Today: ${new Date().toISOString().slice(0, 10)}`,
  ];
  parts.push(`# Memory and skills\n${MEMORY_GUIDANCE}\n\n${SESSION_SEARCH_GUIDANCE}\n\nWhen you work out a non-trivial workflow, record it with skill_manage for future reuse.`);
  if (skills.length) parts.push(skillsSection(skills, contextLimit));
  for (const { file, text } of instructions) {
    parts.push(`# Project instructions (${file})\nThe user wrote these; follow them.\n\n${text}`);
  }
  if (own) parts.push(own.text);
  if (memory) parts.push(memory.text);
  return { prompt: parts.join('\n\n'), instructionFiles: loaded, contextFiles };
}
