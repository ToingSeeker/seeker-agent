// A task board shared by the agent and its helpers for one conversation: the work split into
// tasks, which wait for which, who is on each, and what came of it.
//
// The agent (the lead) puts tasks on it and starts workers with the task tool's `workers`.
// Each worker takes the next task that is ready (every task it depends on is done), does it,
// and marks it done with a short result or failed with the reason, until none are left. Results
// of the tasks a task depends on come with it, and anyone may leave a note for the others.
//
// Everything runs in this one process, so a change is a plain assignment: two workers can never
// take the same task. The board lives as long as the conversation (/clear empties it).
export const MAX_TASKS = 50;
const MAX_TEXT = 4000;
const MAX_NOTES = 100;

export const BOARD_MARK = { pending: '☐', active: '◐', done: '☑', failed: '☒', blocked: '⊘' };

const text = (value, max = MAX_TEXT) => String(value ?? '').trim().slice(0, max);

export class Board {
  constructor() {
    this.tasks = [];
    this.notes = [];
    this.waiting = new Set(); // resolvers of workers waiting for a task to become ready
    this.count = 0;
  }

  get empty() {
    return this.tasks.length === 0;
  }

  #changed() {
    for (const wake of this.waiting) wake();
    this.waiting.clear();
  }

  #find(id) {
    const task = this.tasks.find((t) => t.id === String(id ?? '').trim());
    if (!task) throw new Error(`No task "${id}" on the board. Its tasks: ${this.tasks.map((t) => t.id).join(', ') || 'none'}.`);
    return task;
  }

  /** Whether a pending task can never start, because something it waits for failed. */
  #blocked(task, seen = new Set()) {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return task.deps.some((d) => {
      const dep = this.tasks.find((t) => t.id === d);
      return dep.status === 'failed' || (dep.status === 'pending' && this.#blocked(dep, seen));
    });
  }

  /** A task's status as shown: a pending task that can never start is "blocked". */
  statusOf(task) {
    return task.status === 'pending' && this.#blocked(task) ? 'blocked' : task.status;
  }

  #ready(task) {
    return task.status === 'pending' && task.deps.every((d) => this.tasks.find((t) => t.id === d).status === 'done');
  }

  /**
   * Puts tasks on the board. A task may depend only on tasks already there or given before it in
   * the same call, so the order of work can never go round in a circle.
   * @param {{ id?: string, title: string, detail?: string, depends_on?: string[] }[]} items
   * @returns {string[]} the ids given
   */
  add(items, by) {
    if (!Array.isArray(items) || !items.length) throw new Error('Give "tasks": a list of { title, detail, depends_on }.');
    if (this.tasks.length + items.length > MAX_TASKS) throw new Error(`The board holds at most ${MAX_TASKS} tasks; it has ${this.tasks.length}. Make the tasks bigger, or finish some first.`);
    const known = new Set(this.tasks.map((t) => t.id));
    const fresh = [];
    for (const item of items) {
      const title = text(item?.title ?? item?.task ?? item?.content, 200);
      if (!title) throw new Error('Every task needs a "title".');
      let id = text(item?.id, 40).replace(/\s+/g, '-');
      if (!id) id = `t${++this.count}`;
      while (!item?.id && known.has(id)) id = `t${++this.count}`;
      if (known.has(id)) throw new Error(`There is already a task "${id}".`);
      let deps = item?.depends_on ?? item?.deps ?? [];
      if (typeof deps === 'string') deps = deps.split(',');
      deps = [...new Set(deps.map((d) => String(d).trim()).filter(Boolean))];
      const unknown = deps.filter((d) => !known.has(d));
      if (unknown.length) throw new Error(`Task "${title}" depends on ${unknown.map((d) => `"${d}"`).join(', ')}, which is not on the board before it. A task can only wait for one added earlier.`);
      known.add(id);
      fresh.push({ id, title, detail: text(item?.detail ?? item?.description), deps, status: 'pending', owner: null, result: '', by });
    }
    this.tasks.push(...fresh);
    this.#changed();
    return fresh.map((t) => t.id);
  }

  /**
   * The next ready task, taken for `owner`. When none is ready but some are still being worked
   * on, waits until one finishes, since that may make another ready. Null when nothing is left
   * that could ever be done, or when `signal` is aborted.
   */
  async next(owner, signal) {
    for (;;) {
      if (signal?.aborted) return null;
      const task = this.tasks.find((t) => this.#ready(t));
      if (task) {
        task.status = 'active';
        task.owner = owner;
        this.#changed();
        return task;
      }
      const startable = this.tasks.some((t) => t.status === 'pending' && !this.#blocked(t));
      const working = this.tasks.some((t) => t.status === 'active');
      if (!startable || !working) return null;
      await new Promise((resolve) => {
        const wake = () => {
          signal?.removeEventListener('abort', wake);
          this.waiting.delete(wake);
          resolve();
        };
        this.waiting.add(wake);
        signal?.addEventListener('abort', wake, { once: true });
      });
    }
  }

  /** Marks the task `owner` is working on done (ok) or failed, with what came of it. */
  finish(id, owner, ok, result) {
    const task = this.#find(id);
    if (task.status !== 'active') throw new Error(`Task "${task.id}" is ${this.statusOf(task)}, not being worked on: take a task with "next" first.`);
    if (task.owner !== owner) throw new Error(`Task "${task.id}" is ${task.owner}'s, not yours.`);
    const said = text(result);
    if (!said) throw new Error(ok ? 'Say in "result" what you did, what changed and what you checked.' : 'Say in "result" why it failed.');
    task.status = ok ? 'done' : 'failed';
    task.result = said;
    this.#changed();
    return task;
  }

  /** A worker that stopped leaves no task half-taken: what it held is failed, with why. */
  release(owner, why) {
    let any = false;
    for (const task of this.tasks) {
      if (task.status === 'active' && task.owner === owner) {
        task.status = 'failed';
        task.result = why;
        any = true;
      }
    }
    if (any) this.#changed();
  }

  note(by, said) {
    const body = text(said, 1000);
    if (!body) throw new Error('A note needs "text".');
    this.notes.push({ by, text: body });
    if (this.notes.length > MAX_NOTES) this.notes.shift();
  }

  clear() {
    for (const task of this.tasks) if (task.status === 'active') throw new Error(`Task "${task.id}" is still being worked on by ${task.owner}.`);
    this.tasks = [];
    this.notes = [];
    this.count = 0;
    this.#changed();
  }

  counts() {
    const counts = { pending: 0, active: 0, done: 0, failed: 0, blocked: 0 };
    for (const task of this.tasks) counts[this.statusOf(task)] += 1;
    return counts;
  }

  /** A task as a worker is given it: what to do, and what the tasks it waited for came to. */
  brief(task) {
    const lines = [`Task ${task.id}: ${task.title}`];
    if (task.detail) lines.push(task.detail);
    for (const d of task.deps) {
      const dep = this.tasks.find((t) => t.id === d);
      lines.push(`\nResult of ${dep.id} (${dep.title}), by ${dep.owner}:\n${dep.result}`);
    }
    if (this.notes.length) lines.push(`\nNotes on the board:\n${this.notes.map((n) => `- ${n.by}: ${n.text}`).join('\n')}`);
    return lines.join('\n');
  }

  /** The whole board as text, for the model and for /board. */
  render({ results = true } = {}) {
    if (this.empty) return 'The board is empty.';
    const c = this.counts();
    const head = `${this.tasks.length} task(s): ${Object.entries(c).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(', ')}`;
    const rows = this.tasks.map((t) => {
      const status = this.statusOf(t);
      const parts = [`${BOARD_MARK[status]} ${t.id} ${t.title}`];
      if (t.deps.length) parts.push(`(after ${t.deps.join(', ')})`);
      if (t.owner) parts.push(`— ${t.owner}`);
      let row = parts.join(' ');
      if (results && t.result) row += `\n    ${t.result.replace(/\n/g, '\n    ')}`;
      return row;
    });
    const notes = this.notes.length ? `\nNotes:\n${this.notes.map((n) => `- ${n.by}: ${n.text}`).join('\n')}` : '';
    return `${head}\n${rows.join('\n')}${notes}`;
  }
}

/** What each worker is told: how to work the board, and the lead's instructions for all of them. */
export function workerPrompt(index, total, shared) {
  return `You are worker ${index} of ${total} on a shared task board. Other workers take tasks from the same board at the same time.

Repeat until the board says no tasks are left:
1. Call the board tool with action "next". It gives you one task, with the results of the tasks it waited for.
2. Do that task, and only that task.
3. Call the board tool with action "done" and the task's id, and in "result" say briefly what you did, which files you changed and what you checked. If you cannot do it, use action "fail" and say why in "result".
Something the other workers should know (a shared file you changed, a trap you found) goes on the board with action "note".

When "next" says there is nothing left, stop and reply with a short summary of the tasks you did.${shared ? `\n\nInstructions from the lead for every worker:\n${shared}` : ''}`;
}
