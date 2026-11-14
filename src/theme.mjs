// SEEKER's colours, in one place. The terminal interface reads them from here;
// the phone app (remote-server/public/style.css) carries the same values as
// CSS variables, and a test fails if the two drift apart. Nothing in this file
// needs a browser or Node: it is plain data and arithmetic.
//
// Colour carries meaning, the same in both interfaces:
//   primary (amber)    the brand, what is selected, the prompt, an approval that is waiting
//   execution (blue)   a tool that is running
//   reasoning (purple) the model thinking
//   success (green)    done, connected
//   danger (red)       failed
//   warning            something to be careful about

export const TOKENS = {
  bg: '#0B0D10',
  bgSecondary: '#101216',
  surface: '#15171B',
  surfaceHover: '#1C1F24',
  surfaceElevated: '#22252B',
  border: '#2B2E34',
  borderSubtle: '#22252A',
  borderStrong: '#40444C',
  textPrimary: '#F2F3F5',
  textSecondary: '#A1A5AE',
  textMuted: '#717680',
  primary: '#FF8A00',
  primaryHover: '#FF9F2E',
  primaryDeep: '#B35F00',
  execution: '#4188FF',
  success: '#50D15F',
  reasoning: '#9C6BEB',
  danger: '#F16D76',
  warning: '#FFB547',
};

/** `surfaceElevated` → `--sk-surface-elevated`. */
export const cssName = (token) => `--sk-${token.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;

const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// The 256-colour table: a 6×6×6 cube (16–231) and a grey ramp (232–255).
const STEPS = [0, 95, 135, 175, 215, 255];
function nearest256(hex) {
  const want = rgb(hex);
  const cube = want.map((v) => STEPS.reduce((best, step, i) => (Math.abs(step - v) < Math.abs(STEPS[best] - v) ? i : best), 0));
  const grey = Math.max(0, Math.min(23, Math.round((want.reduce((a, b) => a + b) / 3 - 8) / 10)));
  const cubeRgb = cube.map((i) => STEPS[i]);
  const greyRgb = [0, 0, 0].map(() => 8 + grey * 10);
  return distance(want, cubeRgb) <= distance(want, greyRgb) ? 16 + 36 * cube[0] + 6 * cube[1] + cube[2] : 232 + grey;
}

// The eight colours every terminal has, as xterm draws them.
const BASIC = [[0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229]];
const nearestBasic = (hex) => BASIC.reduce((best, colour, i) => (distance(rgb(hex), colour) < distance(rgb(hex), BASIC[best]) ? i : best), 0);

/**
 * How many colours the terminal can show: 0 (none), 4 (the basic sixteen), 8 (256) or 24 (any).
 * NO_COLOR, when set to anything, turns colour off.
 */
export function colorDepth(env = {}, isTTY = true) {
  if (!isTTY || env.NO_COLOR || env.TERM === 'dumb') return 0;
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? '')) return 24;
  if (/256(color)?/i.test(env.TERM ?? '') || env.COLORTERM) return 8;
  // Apple's Terminal shows 256 colours and says so only in TERM_PROGRAM on some setups.
  if (env.TERM_PROGRAM === 'Apple_Terminal' || env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'vscode') return 8;
  return 4;
}

/** The SGR parameters that set `hex` as the text (or background) colour at this depth. */
export function sgr(hex, depth, background = false) {
  if (depth >= 24) return `${background ? 48 : 38};2;${rgb(hex).join(';')}`;
  if (depth >= 8) return `${background ? 48 : 38};5;${nearest256(hex)}`;
  return String((background ? 40 : 30) + nearestBasic(hex));
}

// With only sixteen colours, "nearest" would give purple and blue the same code; each meaning keeps its own.
const SIXTEEN = { accent: '33', blue: '34', purple: '35', green: '32', red: '31', yellow: '93' };

/**
 * The styles the terminal interface draws with, as SGR parameter strings.
 * `dim` and `bold` are attributes, not colours, so the terminal's own text colour and background are kept.
 */
export function terminalCodes(depth) {
  const fg = (name, token) => (depth >= 8 ? sgr(TOKENS[token], depth) : SIXTEEN[name]);
  const accent = fg('accent', 'primary');
  return {
    dim: '2',
    bold: '1',
    accent,
    accentBold: `1;${accent}`,
    blue: fg('blue', 'execution'),
    purple: fg('purple', 'reasoning'),
    green: fg('green', 'success'),
    yellow: fg('yellow', 'warning'),
    red: fg('red', 'danger'),
    chip: depth >= 8 ? `${sgr(TOKENS.surfaceElevated, depth, true)};${accent}` : `7;${accent}`,
  };
}

/** `name → (text) => coloured text`. With depth 0 every style returns the text as it is. */
export function terminalPalette(depth) {
  const paint = {};
  for (const [name, code] of Object.entries(terminalCodes(depth))) paint[name] = (s) => (depth ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return paint;
}
