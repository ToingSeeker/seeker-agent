// The prompts of the unattended review that runs after a reply (see Agent#reviewTurn):
// a look back over the conversation for facts worth remembering and lessons worth
// keeping in a skill.

const MEMORY_ROUTING = `There are three places a fact can go. Choose one:
  • target='user' — the person: who they are, what they like, how they talk and work, personal details they shared, what they expect from you.
  • target='memory' — the surroundings you work in, true in all projects: oddities of tools, how the machine is set up, configuration traps, paths and endpoints you need.
  • target='project' — only the project in this folder: its conventions, its commands, its traps.

A fact is stored once. Copies in several stores fill them up until the limit pushes out what matters, and a fact in the wrong store is not found by the session that needs it.

Store a fact only if this conversation shows it: you must be able to point at the user's message or the tool result. Do not guess the user's character, level, job, mood or tastes from the subject, the tone or the tools in use. A request made once is not a lasting preference unless the user said it is general ('always', 'from now on', 'remember') or stated a lasting like or dislike ('I hate X', 'stop doing Y'). When in doubt, store nothing: a wrong fact misleads all sessions after this one.`;

const MEMORY_REVIEW = `Look back over the conversation above and decide whether anything in it should be remembered.

${MEMORY_ROUTING}

If something qualifies, store it once in the right place with the memory tool. If nothing does, answer 'Nothing to save.' and stop.`;

const LESSONS = `Writing a lesson:
  • Begin with the procedure: the steps that worked, written as instructions.
  • A trap is written as a rule and its reason ("Apply the schema change before loading sample data — the sample data fills columns the change creates").
  • Leave out PR numbers, dates, ticket ids and how the lesson was learned. One lesson, one rule. A lesson that turned out wrong is corrected where it stands, not contradicted by a second one.

Not lessons: trouble with this machine or the network, statements that some tool "does not work", errors that went away, stories of a single occasion, problems left unsolved.`;

const SKILL_REVIEW = `Look back over the conversation above for know-how worth keeping. Lean towards acting: when real work was done there is usually some small way to make a skill better, and a review that changes nothing gives that up.

Worth acting on: the user corrected your way of working or the style they want for this sort of task; you found a technique or an order of commands that was not obvious; a skill you loaded was wrong, had a gap, or did not warn about a trap you fell into.

Prefer the earliest of these that fits:
  1. Patch a skill loaded during this conversation.
  2. Patch another existing skill that covers this kind of task.
  3. Add a supporting file (references/…) to such a skill.
  4. Create a skill, named for the kind of task (for example "railway-deploys") and not for one bug, error message or code name.

Read a skill's SKILL.md with read_file during this review before you patch it, so the patch fits the file as it is. Do not delete skills here.

${LESSONS}

'Nothing to save.' is allowed, but it should be the exception.`;

/** The instruction for one review pass: memory, skills, or both. */
export function reviewPrompt({ memory, skills }) {
  const body = memory && skills ? `${SKILL_REVIEW}\n\nAfter that, as a separate question, consider memory. ${MEMORY_ROUTING}\n\nWays of working and corrections for one kind of task go in a skill. Memory only takes facts that matter in every session.` : memory ? MEMORY_REVIEW : SKILL_REVIEW;
  return `${body}\n\nIn this pass only the memory and skill tools and reading files are available; any other tool call is refused, so do not try one. Nobody reads your reply: this pass runs unattended.`;
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
