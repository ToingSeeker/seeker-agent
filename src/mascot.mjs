// The header art: the robot and the SEEKER wordmark, drawn as pixels.
//
// One terminal cell shows two pixels, one above the other, using the half-block
// characters (▀ ▄ █). Four text rows therefore give an 8-pixel-tall robot.
// Pixels are written as letters; each letter is a colour (or nothing).

const COLORS = {
  c: 80, // cyan: head, ears, body
  b: 31, // blue: chest panel
  k: 236, // the dark face
  w: 255, // eyes
  o: 209, // orange: antenna, feet
  y: 221, // antenna lit up
};

const ROBOT = [
  '...o...o...',
  '.ccccccccc.',
  'cckkkkkkkcc',
  'cckkkkkkkcc',
  '.ccccccccc.',
  '..ccbbbcc..',
  '...cbbbc...',
  '...o...o...',
];

/** Columns of the left eye for each direction the robot can look; the right eye is four columns on. */
const LOOK = { left: 2, center: 3, right: 4 };

// The idle loop, in ticks: most of the time the robot just looks ahead.
const LOOP = 64;
const BLINKS = new Set([18, 50, 52]);
const GLANCE = { left: [32, 36], right: [36, 40] };

/**
 * What the robot is doing at `tick`.
 * @returns {{ eyes: 'open' | 'closed', look: 'left' | 'center' | 'right', antenna: boolean }}
 */
export function pose(tick, busy = false) {
  const t = ((tick % LOOP) + LOOP) % LOOP;
  const look = t >= GLANCE.left[0] && t < GLANCE.left[1] ? 'left' : t >= GLANCE.right[0] && t < GLANCE.right[1] ? 'right' : 'center';
  // While the model is working the antenna flashes.
  return { eyes: BLINKS.has(t) ? 'closed' : 'open', look, antenna: busy && Math.floor(tick / 3) % 2 === 0 };
}

export const RESTING = { eyes: 'open', look: 'center', antenna: false };

function robotPixels({ eyes, look, antenna }) {
  const grid = ROBOT.map((row) => [...row]);
  const left = LOOK[look];
  for (const col of [left, left + 4]) {
    // A closed eye is a thin line: only the lower pixel stays lit.
    if (eyes === 'open') grid[2][col] = 'w';
    grid[3][col] = 'w';
  }
  if (antenna) grid[0] = grid[0].map((p) => (p === 'o' ? 'y' : p));
  return grid;
}

/** Turns a pixel grid (an even number of rows) into text rows. Without colour, the dark face is left empty. */
function paint(grid, color) {
  const rows = [];
  const code = (p) => (color ? (COLORS[p] ?? null) : p === '.' || p === 'k' ? null : 1);
  for (let y = 0; y < grid.length; y += 2) {
    let row = '';
    for (let x = 0; x < grid[y].length; x++) {
      const top = code(grid[y][x]);
      const bottom = code(grid[y + 1][x]);
      if (top === null && bottom === null) row += ' ';
      else if (!color) row += top === null ? '▄' : bottom === null ? '▀' : '█';
      else if (top === bottom) row += `\x1b[38;5;${top}m█\x1b[0m`;
      else if (bottom === null) row += `\x1b[38;5;${top}m▀\x1b[0m`;
      else if (top === null) row += `\x1b[38;5;${bottom}m▄\x1b[0m`;
      else row += `\x1b[38;5;${top};48;5;${bottom}m▀\x1b[0m`;
    }
    rows.push(row);
  }
  return rows;
}

export const ROBOT_WIDTH = ROBOT[0].length;

/** The robot as four text rows, each ROBOT_WIDTH columns wide. */
export const robotRows = (state = RESTING, color = true) => paint(robotPixels(state), color);

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
  return paint(grid, false);
}
