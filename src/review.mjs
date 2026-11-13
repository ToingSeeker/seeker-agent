// The prompts of the unattended review that runs after a reply (see Agent#reviewTurn):
// a look back over the conversation for facts worth remembering and lessons worth
// keeping in a skill.

const MEMORY_ROUTING = `Memory has THREE distinct stores — pick the right one for each fact:
  • target='user': who the user is — persona, preferences, communication and work style, personal details they revealed, and expectations about how you should behave.
  • target='memory': facts about the ENVIRONMENT you operate in that hold in every project — tool quirks, machine setup, config gotchas, paths and endpoints that matter.
  • target='project': facts about the project in this working folder only — its conventions, commands and gotchas.

One fact goes to ONE store, never several — writing it to more than one bloats the files until they hit their size limits and crowds out the facts that matter; misrouting it puts it where the next session won't look.

Save only facts GROUNDED in this conversation — a user message or tool result you can point to. Never infer the user's traits, skill level, role, mood or preferences from topic, tone or tools used, and never turn a one-off request into a standing preference unless the user marked it general ('always', 'from now on', 'remember') or stated a standing like/dislike ('I hate X', 'stop doing Y'). If unsure, leave it out — a wrong fact misleads every future session.`;

const MEMORY_REVIEW = `Review the conversation above and consider saving to memory if appropriate.

${MEMORY_ROUTING}

If something stands out, save it once, in the right store, using the memory tool with the matching target. If nothing is worth saving, just say 'Nothing to save.' and stop.`;

const LESSONS = `How to write a lesson:
  • Procedure first: the steps that worked, as imperative instructions.
  • A pitfall is a rule plus its WHY ("Run the migration before the seed — the seed reads columns the migration adds").
  • No PR numbers, dates, ticket ids or the story of how it was learned. One rule per lesson. Fix a wrong lesson in place rather than adding a contradicting one.

Do NOT capture: failures of this machine or network, claims that a tool "does not work", transient errors, one-off narratives, or problems that were never resolved.`;

const SKILL_REVIEW = `Review the conversation above for something worth keeping as procedural knowledge. Be ACTIVE — a session with real work usually holds at least one small improvement to a skill. A pass that does nothing is a missed chance to work better next time.

Signals worth acting on: the user corrected how you work or what style they want for this kind of task; you worked out a technique or a sequence of commands that was not obvious; a skill you loaded was wrong, incomplete or missing a pitfall you then hit.

In this order of preference:
  1. Patch a skill that was loaded in this conversation.
  2. Patch an existing skill that covers this class of task.
  3. Add a supporting file (references/…) to such a skill.
  4. Create a new skill — named after the CLASS of task (e.g. "railway-deploys"), never after one bug, error message or codename.

Before patching a skill, read its SKILL.md in this review (read_file) so the patch matches the file as it is now. Never delete a skill here.

${LESSONS}

'Nothing to save.' is a real answer, but it should not be the default.`;

/** The instruction for one review pass: memory, skills, or both. */
export function reviewPrompt({ memory, skills }) {
  const body = memory && skills ? `${SKILL_REVIEW}\n\nThen, separately, consider memory. ${MEMORY_ROUTING}\n\nProcedures and task-specific corrections go in a skill; only facts that hold in EVERY session go in memory.` : memory ? MEMORY_REVIEW : SKILL_REVIEW;
  return `${body}\n\nYou can only call memory and skill management tools (and read files). Other tools will be denied at runtime — do not attempt them. This is an unattended pass: the user will not read your reply.`;
}

/** One line saying what a review saved, read from its tool results; null when it saved nothing. */
export function reviewOutcome(messages) {
  const parts = [];
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    let result;
    try {
      result = JSON.parse(m.content);
    } catch {
      continue;
    }
    if (!result?.success) continue;
    if (m.tool_name === 'memory' && result.message !== 'Nothing changed.') parts.push(`remembered a fact (${result.target})`);
    if (m.tool_name === 'skill_manage') parts.push(...(result.done ?? []).map((d) => `skill: ${d}`));
  }
  return parts.length ? `learned from this conversation — ${[...new Set(parts)].join(' · ')}` : null;
}
