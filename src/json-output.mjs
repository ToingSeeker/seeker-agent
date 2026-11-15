// `seeker -p … --output json`: what a script gets instead of prose. The answer and what was done
// arrive on stdout as JSON; the readable activity still goes to stderr, where it was.
//
//   json         one object when the run is over
//   stream-json  one object per line as things happen, the same result object last

const now = () => Date.now();

/**
 * Makes `ui` report to `write` as well as to the screen. Returns `finish`, to call when the turn is over.
 * @param {object} ui  the interface the agent draws with; its methods are wrapped in place
 * @param {{ stream?: boolean, write?: (line: string) => void, meta?: object }} opts
 */
export function attachJson(ui, { stream = false, write = (line) => process.stdout.write(`${line}\n`), meta = {} } = {}) {
  const started = now();
  const steps = [];
  const warnings = [];
  let error = null;
  let text = '';
  let open = null;
  const emit = (event) => stream && write(JSON.stringify(event));
  const plain = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
  const wrap = (name, before) => {
    const original = ui[name].bind(ui);
    ui[name] = (...args) => {
      before(...args);
      return original(...args);
    };
  };

  emit({ type: 'start', ...meta });
  // The answer is kept, not printed: stdout carries JSON only.
  ui.answerStream = () => ({
    push: (chunk) => {
      text += chunk;
      emit({ type: 'text', text: chunk });
    },
    flush() {},
  });
  wrap('toolStart', (doing, done, summary = '') => {
    // A step that was started and never closed (several run at once) is closed as it is.
    open = { action: plain(`${doing} ${summary}`), ok: null, note: null };
    steps.push(open);
    emit({ type: 'step', status: 'started', action: open.action });
  });
  const close = (ok, note) => {
    const step = open ?? steps.at(-1);
    if (!step) return;
    step.ok = ok;
    step.note = plain(note) || null;
    emit({ type: 'step', status: ok ? 'done' : 'failed', action: step.action, note: step.note });
    open = null;
  };
  wrap('toolDone', (note) => close(true, note));
  wrap('toolFail', (message) => close(false, message));
  wrap('warn', (message) => {
    warnings.push(plain(message));
    emit({ type: 'warning', message: plain(message) });
  });
  wrap('error', (message) => {
    error = plain(message).replace(/^Error:\s*/, '');
    emit({ type: 'error', message: error });
  });

  /** The result object: printed alone for `json`, last for `stream-json`. */
  return function finish(agent) {
    const answer = [...agent.messages].reverse().find((m) => m.role === 'assistant' && m.content?.trim())?.content.trim() ?? text.trim();
    const result = {
      type: 'result',
      ok: !error && !agent.interrupted,
      result: answer,
      error,
      interrupted: Boolean(agent.interrupted),
      model: agent.model,
      provider: agent.provider.id,
      steps: steps.map(({ action, ok, note }) => ({ action, ok, note })),
      warnings,
      usage: { input_tokens: agent.usage.totalInput, output_tokens: agent.usage.totalOutput, counted_by_provider: Boolean(agent.usage.known) },
      duration_ms: now() - started,
    };
    write(JSON.stringify(result));
    return result;
  };
}

export const OUTPUT_FORMATS = ['text', 'json', 'stream-json'];
