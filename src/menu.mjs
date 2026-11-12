// Arrow-key screens: the settings menu behind /config and the list picker
// used by /model and /resume.
import { SETTINGS, configPath } from './config.mjs';
import { truncate } from './ui.mjs';

const CHOICES = {
  numCtx: [8192, 16384, 32768, 65536, 131072],
  think: [true, false],
  showThinking: [true, false],
  permissionMode: ['ask', 'auto'],
  maxSteps: [30, 60, 100, 200],
  keepAlive: ['5m', '30m', '2h', '24h'],
};

const LABELS = {
  true: 'on',
  false: 'off',
  ask: 'ask first',
  auto: 'auto (YOLO)',
};

/** The value one step left (-1) or right (+1) of `current`, wrapping around. */
export function step(choices, current, direction) {
  const at = choices.indexOf(current);
  if (at === -1) return direction > 0 ? choices[0] : choices.at(-1);
  return choices[(at + direction + choices.length) % choices.length];
}

const isCancel = (key) => key.name === 'escape' || key.name === 'q' || (key.ctrl && (key.name === 'c' || key.name === 'd'));


/**
 * Lets the user pick one row with the arrow keys. The list is removed again afterwards.
 * With `filter`, typing narrows the list (for the hundreds of models some providers offer).
 * @param {{ term, ui, title: string, items: { label: string, hint?: string }[], initial?: number, filter?: boolean }} opts
 * @returns {Promise<number>} the chosen index into `items`, or -1 if cancelled
 */
export async function pickList({ term, ui, title, items: all, initial = 0, filter = false }) {
  const { c } = ui;
  const labelWidth = Math.min(44, Math.max(...all.map((i) => i.label.length)));
  let query = '';
  let items = all;
  let visible = Math.min(items.length, 10);
  let selected = Math.max(0, Math.min(items.length - 1, initial));
  let top = 0;
  let chosen = -1;
  const { screen } = ui;
  const narrow = () => {
    const q = query.toLowerCase();
    items = q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all;
    visible = Math.min(items.length, 10);
    selected = 0;
    top = 0;
  };

  const rows = () => {
    const { width } = screen;
    if (selected < top) top = selected;
    if (selected >= top + visible) top = selected - visible + 1;
    const typed = filter ? `  ${c.dim('filter:')} ${query}${c.dim('▏')}` : '';
    const lines = ['', `  ${c.accentBold(title)}${typed}`];
    if (!items.length) lines.push(`    ${c.dim('nothing matches')}`);
    for (let i = top; i < top + visible; i++) {
      const item = items[i];
      const label = truncate(item.label, labelWidth).padEnd(labelWidth);
      const hint = truncate(item.hint ?? '', Math.max(0, width - labelWidth - 8));
      lines.push(i === selected ? `  ${c.accent(`❯ ${label}`)}  ${c.dim(hint)}` : `    ${label}  ${c.dim(hint)}`);
    }
    const more = items.length > visible ? ` · ${selected + 1}/${items.length}` : '';
    lines.push(`  ${c.dim(`↑↓ select · Enter choose · ${filter ? 'type to filter · ' : ''}Esc cancel${more}`)}`);
    return lines;
  };

  const idle = screen.footer.idle;
  screen.setFooter({ idle: filter ? 'Type to filter the list above · ↑↓ to move · Enter to choose' : 'Use ↑↓ and Enter in the list above' });
  screen.setLive(rows());
  await term.captureKeys((key) => {
    const { name, text } = key;
    if (name === 'escape' || (key.ctrl && (name === 'c' || name === 'd')) || (!filter && name === 'q')) return true;
    if (name === 'return') {
      if (!items.length) return false;
      chosen = all.indexOf(items[selected]);
      return true;
    }
    if (name === 'up' || (!filter && name === 'k')) selected = items.length ? (selected - 1 + items.length) % items.length : 0;
    else if (name === 'down' || name === 'tab' || (!filter && name === 'j')) selected = items.length ? (selected + 1) % items.length : 0;
    else if (filter && name === 'backspace') {
      query = query.slice(0, -1);
      narrow();
    } else if (filter && text && !key.ctrl && !key.meta && text.length === 1 && text >= ' ' && text !== '\x7f') {
      query += text;
      narrow();
    } else return false;
    screen.setLive(rows());
    return false;
  });
  screen.setLive([]);
  screen.setFooter({ idle });
  return chosen;
}

/**
 * The settings screen: arrow keys to move and change, every change saved at once.
 * @param {{ term, ui, config, modelNames: string[], apply: (key: string, value: unknown) => Promise<void> }} deps
 *        `apply` persists a setting and pushes it into the running session.
 */
export async function configMenu({ term, ui, config, modelNames, apply }) {
  const { c } = ui;
  const keys = Object.keys(SETTINGS);
  const choices = { ...CHOICES, model: modelNames };
  const { screen } = ui;
  let selected = 0;
  let status = '';
  let editing = null;
  const idle = screen.footer.idle;
  const done = () => {
    screen.setLive([]);
    screen.setFooter({ idle });
  };
  screen.setFooter({ idle: 'Use the arrow keys in the settings above' });

  const rows = () => {
    const { width } = screen;
    const lines = ['', `  ${c.accentBold('Settings')}`];
    keys.forEach((key, i) => {
      const value = LABELS[config[key]] ?? String(config[key]);
      const active = i === selected;
      const shown = active && choices[key] ? `‹ ${value} ›` : `  ${value}`;
      const plain = `${active ? '❯' : ' '} ${key.padEnd(15)} ${shown.padEnd(28)} `;
      const help = truncate(SETTINGS[key].help, Math.max(0, width - plain.length - 3));
      lines.push(`  ${active ? c.accent(plain) : plain}${c.dim(help)}`);
    });
    lines.push('');
    lines.push(`  ${c.dim('↑↓ select · ←→ / Enter change · e type a value · Esc done')}`);
    lines.push(`  ${status || c.dim(truncate(`saved to ${configPath()}`, width - 2))}`);
    return lines;
  };

  const set = async (key, value) => {
    try {
      await apply(key, value);
      status = c.green(`✓ ${key} = ${LABELS[value] ?? value}`);
    } catch (err) {
      status = c.red(`✗ ${err.message}`);
    }
  };

  for (;;) {
    screen.setLive(rows());
    await term.captureKeys(async (key) => {
      const { name } = key;
      const current = keys[selected];
      if (isCancel(key)) return true;
      if (name === 'up' || name === 'k') selected = (selected - 1 + keys.length) % keys.length;
      else if (name === 'down' || name === 'j' || name === 'tab') selected = (selected + 1) % keys.length;
      else if (name === 'e' || ((name === 'return' || name === 'space') && !choices[current])) {
        if (typeof config[current] === 'boolean') return false;
        editing = current;
        return true;
      } else if (name === 'left' || name === 'right' || name === 'return' || name === 'space') {
        await set(current, step(choices[current], config[current], name === 'left' ? -1 : 1));
      } else return false;
      screen.setLive(rows());
      return false;
    });
    if (!editing) return done();

    // The value is typed in the input box while the menu stays on screen.
    const key = editing;
    editing = null;
    status = c.accent(`Type the new ${key} below, then Enter (empty = keep)`);
    screen.setLive(rows());
    const typed = await term.ask(`New value for ${key} — ${SETTINGS[key].help}`);
    if (typed) {
      const value = SETTINGS[key].parse(typed);
      if (value === undefined) status = c.red(`✗ not a valid value for ${key}`);
      else await set(key, value);
    } else status = '';
  }
}
