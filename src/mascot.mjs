// The header art: the robot and the SEEKER wordmark, drawn as pixels.
//
// One terminal cell shows two pixels, one above the other, using the half-block
// characters (▀ ▄ █). Pixels are written as letters; each letter is a colour
// (or nothing). The robot's face is the exception: it is one row of real text,
// a terminal prompt — >_< — on a dark screen.
import { TOKENS, sgr } from './theme.mjs';

const COLORS = {
  c: TOKENS.primary, // amber: head, body
  b: TOKENS.primaryDeep, // deep amber: ears, arms
  k: TOKENS.surfaceElevated, // the dark face
  w: TOKENS.textPrimary, // eyes
  o: TOKENS.textSecondary, // grey: antenna, feet
  y: TOKENS.execution, // blue: antenna lit up while the model works, chest light
};
/** `color` is how many colours the terminal shows (see theme.mjs); true means 256, false none. */
const depthOf = (color) => (color === true ? 8 : Number(color) || 0);

// Antenna and the top of the head; then, under the face, chin, body and feet.
const TOP = ['...o...o...', '..ccccccc..'];
const BOTTOM = ['..ccccccc..', '...ccccc...', '..bccyccb..', '...oo.oo...'];
const FACE_WIDTH = 7;

// The idle loop, in ticks: most of the time the robot just looks ahead, its cursor blinking.
const LOOP = 64;
const BLINKS = new Set([18, 50, 52]);
const GLANCE = { left: [32, 36], right: [36, 40] };

/**
 * What the robot is doing at `tick`.
 * @returns {{ eyes: 'open' | 'closed', look: 'left' | 'center' | 'right', cursor: boolean, antenna: boolean }}
 */
export function pose(tick, busy = false) {
  const t = ((tick % LOOP) + LOOP) % LOOP;
  const look = t >= GLANCE.left[0] && t < GLANCE.left[1] ? 'left' : t >= GLANCE.right[0] && t < GLANCE.right[1] ? 'right' : 'center';
  return {
    eyes: BLINKS.has(t) ? 'closed' : 'open',
    look,
    cursor: Math.floor(t / 4) % 2 === 0,
    // While the model is working the antenna flashes.
    antenna: busy && Math.floor(tick / 3) % 2 === 0,
  };
}

export const RESTING = { eyes: 'open', look: 'center', cursor: true, antenna: false };

/** The face row: ear, rim, the screen with >_< on it, rim, ear. */
function face({ eyes, look, cursor }, depth) {
  const [left, right] = eyes === 'open' ? ['>', '<'] : ['-', '-'];
  const lead = { left: 1, center: 2, right: 3 }[look];
  const pad = (n) => ' '.repeat(n);
  if (!depth) return `▐█${pad(lead)}${left}${cursor ? '_' : ' '}${right}${pad(FACE_WIDTH - lead - 3)}█▌`;
  const on = (code, text) => `\x1b[${code}m${text}\x1b[0m`;
  const fg = (key) => sgr(COLORS[key], depth);
  const screen = sgr(COLORS.k, depth, true);
  return (
    on(fg('b'), '▐') +
    on(fg('c'), '█') +
    on(screen, pad(lead)) +
    on(`1;${fg('w')};${screen}`, left) +
    on(`1;${fg('c')};${screen}`, cursor ? '_' : ' ') +
    on(`1;${fg('w')};${screen}`, right) +
    on(screen, pad(FACE_WIDTH - lead - 3)) +
    on(fg('c'), '█') +
    on(fg('b'), '▌')
  );
}

/** Turns a pixel grid (an even number of rows) into text rows. Without colour, the dark face is left empty. */
function paint(grid, depth) {
  const rows = [];
  const color = depth > 0;
  const code = (p) => (color ? (COLORS[p] ?? null) : p === '.' || p === 'k' ? null : 1);
  const fg = (hex) => sgr(hex, depth);
  for (let y = 0; y < grid.length; y += 2) {
    let row = '';
    for (let x = 0; x < grid[y].length; x++) {
      const top = code(grid[y][x]);
      const bottom = code(grid[y + 1][x]);
      if (top === null && bottom === null) row += ' ';
      else if (!color) row += top === null ? '▄' : bottom === null ? '▀' : '█';
      else if (top === bottom) row += `\x1b[${fg(top)}m█\x1b[0m`;
      else if (bottom === null) row += `\x1b[${fg(top)}m▀\x1b[0m`;
      else if (top === null) row += `\x1b[${fg(bottom)}m▄\x1b[0m`;
      else row += `\x1b[${fg(top)};${sgr(bottom, depth, true)}m▀\x1b[0m`;
    }
    rows.push(row);
  }
  return rows;
}

export const ROBOT_WIDTH = TOP[0].length;

/** The robot as four text rows, each ROBOT_WIDTH columns wide. */
export function robotRows(state = RESTING, color = true) {
  const depth = depthOf(color);
  const top = state.antenna ? [TOP[0].replaceAll('o', 'y'), TOP[1]] : TOP;
  return [...paint(top.map((row) => [...row]), depth), face(state, depth), ...paint(BOTTOM.map((row) => [...row]), depth)];
}

const GLYPHS = {
  S: ['#######', '##.....', '#######', '.....##', '#######'],
  E: ['#######', '##.....', '#####..', '##.....', '#######'],
  K: ['##...##', '##.##..', '####...', '##.##..', '##...##'],
  R: ['######.', '##...##', '######.', '##.##..', '##...##'],
};

/** A word in the block font: three uncoloured text rows (five pixels of letter under one empty pixel). */
export function wordmarkRows(word = 'SEEKER') {
  const grid = [0, 1, 2, 3, 4].map((y) => [...[...word].map((ch) => GLYPHS[ch][y]).join('.')]);
  grid.unshift(new Array(grid[0].length).fill('.'));
  return paint(grid, 0);
}
