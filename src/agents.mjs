// Agents of your own: helpers with a role, and optionally a model and a set of tools, described in a
// small file. The `task` tool can hand work to one by name.
//
//   ~/.seeker/agents/<name>.md           yours, available in every project
//   <project>/.seeker/agents/<name>.md   the project's (one of the same name replaces yours)
//
//   ---
//   name: reviewer
//   description: Reads a change and reports bugs, most severe first
//   model: claude-haiku-5-5        # optional: "model" on the provider in use, or "provider:model"
//   tools: read_file, grep, glob   # optional: the only tools it gets
//   ---
//   You review code. Report what is wrong, with file and line…
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.mjs';
import { scanThreats } from './memory.mjs';
import { parseSkillFile } from './skills.mjs';

export const AGENTS_DIR = path.join(HOME_DIR, 'agents');
export const projectAgentsDir = (cwd) => path.join(cwd, '.seeker', 'agents');
const MAX_BODY = 20_000; // characters of instructions; a longer file is not an agent's role, it is a manual

function readAgent(file, source) {
  try {
    const { meta, body } = parseSkillFile(fs.readFileSync(file, 'utf8'));
    const name = String(meta.name || path.basename(file, '.md')).trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(name) || !body || body.length > MAX_BODY) return null;
    // A project's file is text somebody else wrote and it becomes a helper's instructions.
    if (source === 'project' && scanThreats(`${meta.description ?? ''}\n${body}`, 'context')) return null;
    const tools = meta.tools ? String(meta.tools).split(',').map((t) => t.trim()).filter(Boolean) : null;
    return { name, description: String(meta.description || body.split('\n')[0].replace(/^#+\s*/, '')).slice(0, 300), model: String(meta.model ?? '').trim() || null, tools: tools?.length ? tools : null, body, file, source };
  } catch {
    return null;
  }
}

function scan(dir, source) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return [];
  }
  return names.map((n) => readAgent(path.join(dir, n), source)).filter(Boolean);
}

/** The agents available in `cwd`, by name. The project's replace the user's of the same name. */
export function loadAgents(cwd, { userDir = AGENTS_DIR } = {}) {
  const byName = new Map();
  for (const agent of [...scan(userDir, 'user'), ...scan(projectAgentsDir(cwd), 'project')]) byName.set(agent.name, agent);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** What the model is told about them, in the system prompt. */
export function agentsSection(agents) {
  if (!agents.length) return '';
  return `# Agents\nHelpers with a role of their own. To use one, pass its name as \`agent\` to the task tool; it starts with an empty context, so the prompt must say everything it needs.\n\n${agents.map((a) => `- ${a.name}: ${a.description}`).join('\n')}`;
}

/** The instructions a helper gets when it runs as `agent`. */
export const roleText = (agent) => `# Your role: ${agent.name}\n${agent.body}`;
