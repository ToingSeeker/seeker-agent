// The agent characters: who stands on the Live Agent card, chosen by the model the session runs.
// The orange robot stays SEEKER's own mark (header, gate, app icon); these are for the agents it drives.
// One character per model family, a tier shown as an accessory, and the mood shown as a face.
// Plain data in, an SVG string out — no DOM — so the page and the tests run the same code. Nothing
// from the Mac is ever put into the SVG: a model name only picks among the fixed drawings below.

// The mascot collection: picked by hand only (automatic choices still go by the model). Drawn like
// the model characters below, so they wear the same faces for the same moods. Names never repeat a
// model character's; ids stay as first shipped (`nova-builder`, `sage-planner`) so saved choices hold.
const MASCOTS = Object.fromEntries([
  ['seeker-core', 'Seeker', 'Core Agent', '#62E6FF'],
  ['nova-builder', 'Vega', 'Builder', '#BA80FF'],
  ['kairo', 'Kairo', 'Coder', '#FFAD63'],
  ['zen', 'Zen', 'Reviewer', '#94E975'],
  ['sage-planner', 'Solon', 'Planner', '#F4BC59'],
  ['lumi', 'Lumi', 'Creative', '#BD85FF'],
  ['atlas', 'Atlas', 'Ops', '#A8C5F5'],
  ['orion', 'Orion', 'Analyzer', '#58E7F0'],
  ['rae', 'Rae', 'Automator', '#F682C5'],
  ['cosmo', 'Cosmo', 'Explorer', '#A298FF'],
  ['golem', 'Golem', 'Infra', '#B1E872'],
  ['vex', 'Vex', 'Security', '#FF729C'],
  ['foxwise', 'Foxwise', 'Strategist', '#FFB33E'],
  ['owlara', 'Owlara', 'Analyst', '#5DEAF2'],
  ['opty', 'Opty', 'Operator', '#C8C3E2'],
  ['flowbie', 'Flowbie', 'Executor', '#8EEE80'],
  ['ravenix', 'Ravenix', 'Scout', '#B385FA'],
  ['bytecat', 'Bytecat', 'Hacker', '#BE80F6'],
  ['shieldbug', 'Shieldbug', 'Defender', '#FFBA4D'],
  ['octy', 'Octy', 'Multitasker', '#5DEAF2'],
].map(([id, name, role, accent]) => [id, { name, role, accent }]));

/** Every character, in the order the settings list them. Model characters carry a `family`, mascots a `role`. */
export const CHARACTERS = {
  sage: { name: 'Sage', kind: 'Owl', family: 'Claude', accent: '#E8805F' },
  nova: { name: 'Nova', kind: 'Android', family: 'GPT', accent: '#2BD9B0' },
  twin: { name: 'Twin', kind: 'Twin stars', family: 'Gemini', accent: '#8A8CFF' },
  lama: { name: 'Lama', kind: 'Llama', family: 'Llama', accent: '#E3C79A' },
  kit: { name: 'Kit', kind: 'Fox', family: 'Qwen', accent: '#9F82FF' },
  abyss: { name: 'Abyss', kind: 'Diver', family: 'DeepSeek', accent: '#46B4FF' },
  gust: { name: 'Gust', kind: 'Wind spirit', family: 'Mistral', accent: '#86D3FF' },
  byte: { name: 'Byte', kind: 'Slime', family: 'Other models', accent: '#62E089' },
  ...MASCOTS,
};

/** Claude's tiers, each worn as an accessory: a crown, a scarf, a sprout, a book. */
export const TIERS = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };

/** The phone's setting: `auto` picks by model, `seeker` keeps the robot, or one character for all. */
export const CHARACTER_SETTING = 'seeker.character';
export const CHOICES = ['auto', ...Object.keys(CHARACTERS), 'seeker'];

// The model name first (it is the most precise), then the provider for names such as "default".
// A provider that serves many families (Ollama, OpenRouter, LM Studio) says nothing, so it is not listed.
const MODELS = [
  ['sage', /claude|opus|sonnet|haiku|fable/],
  ['nova', /gpt|codex|chatgpt|(^|[^a-z0-9])o\d(-|$|[^a-z0-9])/],
  ['twin', /gemini|gemma/],
  ['lama', /llama/],
  ['kit', /qwen|qwq/],
  ['abyss', /deepseek/],
  ['gust', /mistral|mixtral|codestral|devstral|ministral|magistral/],
];
const PROVIDERS = [
  ['sage', /anthropic|claude/],
  ['nova', /openai|codex/],
  ['twin', /google|gemini|vertex/],
  ['kit', /alibaba|dashscope|qwen/],
  ['abyss', /deepseek/],
  ['gust', /mistral/],
];

/** The character for a model, with its tier when the family has tiers: `{ id, tier }`. */
export function characterFor(model, provider) {
  const name = String(model ?? '').toLowerCase();
  const by = String(provider ?? '').toLowerCase();
  const id = MODELS.find(([, re]) => re.test(name))?.[0] ?? PROVIDERS.find(([, re]) => re.test(by))?.[0] ?? 'byte';
  const tier = id === 'sage' ? (Object.keys(TIERS).find((t) => name.includes(t)) ?? null) : null;
  return { id, tier };
}

/**
 * Who to draw for a session, given the phone's setting. null means SEEKER's own robot. A character
 * picked by hand keeps the tier the model would have given it only when it is the model's own family.
 */
export function pickCharacter(setting, model, provider) {
  if (setting === 'seeker') return null;
  const auto = characterFor(model, provider);
  if (!setting || setting === 'auto' || !Object.hasOwn(CHARACTERS, setting)) return auto;
  return { id: setting, tier: setting === auto.id ? auto.tier : null };
}

/** The phone's choice per project: project path → one of CHOICES. A project not in it follows CHARACTER_SETTING. */
export const PROJECT_CHARACTERS = 'seeker.character.projects';

/** The setting in force for one project: its own choice when it has a valid one, else the phone's. */
export function characterSettingFor(setting, byProject, project) {
  const own = byProject && typeof project === 'string' && Object.hasOwn(byProject, project) ? byProject[project] : null;
  return CHOICES.includes(own) ? own : setting;
}

/** Reads the per-project choices kept on the phone; anything malformed counts as none. */
export function readProjectCharacters(text) {
  try {
    const all = JSON.parse(text ?? '{}');
    if (!all || typeof all !== 'object' || Array.isArray(all)) return {};
    return Object.fromEntries(Object.entries(all).filter(([, id]) => CHOICES.includes(id)));
  } catch {
    return {};
  }
}

/** "Sage · Opus": the character's name and tier, for the card's corner. */
export function characterLabel(who) {
  if (!who || !CHARACTERS[who.id]) return '';
  return [CHARACTERS[who.id].name, who.tier && TIERS[who.tier]].filter(Boolean).join(' · ');
}

/** The face each mood wears (robot.js MOODS). */
export const FACES = {
  idle: 'normal',
  thinking: 'up',
  coding: 'down',
  executing: 'down',
  awaiting_approval: 'wide',
  success: 'happy',
  error: 'x',
  disconnected: 'closed',
};

// ── drawing ── 120×120 view box; gradient ids are unique per drawing so many can share a page.
const INK = '#1A1622';
let drawn = 0;

function eye(x, y, r, face, ink = INK) {
  const s = `stroke="${ink}" stroke-width="${r * 0.42}" stroke-linecap="round" fill="none"`;
  if (face === 'happy') return `<path d="M${x - r * 0.8} ${y + r * 0.2}Q${x} ${y - r} ${x + r * 0.8} ${y + r * 0.2}" ${s}/>`;
  if (face === 'closed') return `<path d="M${x - r * 0.75} ${y}H${x + r * 0.75}" ${s}/>`;
  if (face === 'x') return `<path d="M${x - r * 0.6} ${y - r * 0.6}L${x + r * 0.6} ${y + r * 0.6}M${x + r * 0.6} ${y - r * 0.6}L${x - r * 0.6} ${y + r * 0.6}" ${s}/>`;
  const [dx, dy, pr] = { up: [0.18, -0.3, 0.58], down: [0, 0.32, 0.58], wide: [0, 0, 0.45] }[face] ?? [0.1, 0.12, 0.6];
  const px = x + r * dx;
  const py = y + r * dy;
  return `<g class="eye"><circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${px}" cy="${py}" r="${r * pr}" fill="${ink}"/><circle cx="${px + r * 0.25}" cy="${py - r * 0.25}" r="${r * 0.2}" fill="#fff"/></g>`;
}

function mouth(x, y, w, face, c = INK) {
  if (face === 'x') return `<path d="M${x - w / 2} ${y + 2}q${w / 4} -3 ${w / 2} 0t${w / 2} 0" stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  if (face === 'wide') return `<ellipse cx="${x}" cy="${y + 1}" rx="${w / 4}" ry="${w / 3.2}" fill="${c}"/>`;
  if (face === 'happy') return `<path d="M${x - w / 2} ${y - 1}Q${x} ${y + w * 0.7} ${x + w / 2} ${y - 1}Z" fill="${c}"/>`;
  return `<path d="M${x - w / 2} ${y}Q${x} ${y + w * 0.45} ${x + w / 2} ${y}" stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
}

// Glowing visor eyes (Nova, Abyss): the same seven faces as a screen would show them.
function visor(face, { l, r, y, color, off, shape }) {
  if (face === 'happy') return `<path d="M${l - 6} ${y + 2}q6 -8 12 0M${r - 6} ${y + 2}q6 -8 12 0" stroke="${color}" stroke-width="3.8" fill="none" stroke-linecap="round"/>`;
  if (face === 'closed') return `<path d="M${l - 5} ${y}h10M${r - 5} ${y}h10" stroke="${off}" stroke-width="3.8" stroke-linecap="round"/>`;
  if (face === 'x') return `<path d="M${l - 4} ${y - 4}l8 8M${l + 4} ${y - 4}l-8 8M${r - 4} ${y - 4}l8 8M${r + 4} ${y - 4}l-8 8" stroke="#FF6B7A" stroke-width="3.3" stroke-linecap="round"/>`;
  const dy = face === 'up' ? -4 : face === 'down' ? 3 : 0;
  return `<g class="eye">${shape(l, y + dy, face === 'wide')}${shape(r, y + dy, face === 'wide')}</g>`;
}

const gradient = (id, a, b, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const SHADOW = '<ellipse cx="60" cy="112" rx="28" ry="4.5" fill="#000" opacity=".35"/>';

const ART = {
  sage(face, tier, p) {
    const acc = {
      opus: `<defs>${gradient(`${p}c`, '#FFE27A', '#E0A21E')}</defs><path d="M43 27L46 9L53 18L60 5L67 18L74 9L77 27Z" fill="url(#${p}c)" stroke="#C98A12" stroke-width="1.2" stroke-linejoin="round"/><circle cx="60" cy="18" r="2.4" fill="#E84A5F"/>`,
      sonnet: '<path d="M29 70Q60 82 91 70L91 78Q60 90 29 78Z" fill="#3FA796"/><path d="M76 80L84 100L74 100L70 82Z" fill="#2F8C7D"/>',
      haiku: '<path d="M60 26Q59 18 62 12" stroke="#4FAE5E" stroke-width="2.6" fill="none" stroke-linecap="round"/><ellipse cx="68" cy="12" rx="7" ry="3.6" transform="rotate(-25 68 12)" fill="#7DDB7A"/><ellipse cx="54" cy="16" rx="5" ry="2.8" transform="rotate(25 54 16)" fill="#7DDB7A"/>',
      fable: '<path d="M38 80L60 86L82 80L82 102L60 108L38 102Z" fill="#7A2E3E"/><path d="M41 81L59 86L59 104L41 99ZM79 81L61 86L61 104L79 99Z" fill="#FFF8EA"/><path d="M45 88l10 3M45 93l10 3M65 91l10 -3M65 96l10 -3" stroke="#C9B9A0" stroke-width="1.2"/>',
    };
    return `<defs>${gradient(`${p}b`, '#F39A78', '#C4553A')}</defs>${SHADOW}
<path d="M30 40L33 14L52 30ZM90 40L87 14L68 30Z" fill="url(#${p}b)"/>
<ellipse cx="26" cy="74" rx="10" ry="22" transform="rotate(14 26 74)" fill="#B24C33"/><ellipse cx="94" cy="74" rx="10" ry="22" transform="rotate(-14 94 74)" fill="#B24C33"/>
<ellipse cx="60" cy="66" rx="34" ry="42" fill="url(#${p}b)"/><ellipse cx="60" cy="84" rx="20" ry="20" fill="#F8E7CF"/>
<path d="M51 80q4 4 8 0M61 80q4 4 8 0M56 89q4 4 8 0" stroke="#DDAA86" stroke-width="2" fill="none" stroke-linecap="round"/>
<circle cx="46" cy="52" r="14" fill="#FFF4E6"/><circle cx="74" cy="52" r="14" fill="#FFF4E6"/>${eye(46, 53, 8.5, face)}${eye(74, 53, 8.5, face)}
<path d="M55 62H65L60 70Z" fill="#F2B84B" stroke="#D9952A" stroke-width="1" stroke-linejoin="round"/>
<ellipse cx="50" cy="108" rx="6" ry="3" fill="#F2B84B"/><ellipse cx="70" cy="108" rx="6" ry="3" fill="#F2B84B"/>${acc[tier] ?? ''}`;
  },
  nova(face, _tier, p) {
    const teal = '#2BE3B8';
    const eyes = visor(face, { l: 49, r: 71, y: 50.5, color: teal, off: '#3B5566', shape: (x, y, wide) => `<rect x="${x - 6}" y="${y - (wide ? 7 : 5.5)}" width="12" height="${wide ? 14 : 11}" rx="6" fill="${teal}"/>` });
    const smile = ['normal', 'up', 'down'].includes(face) ? `<path d="M54 59q6 3.5 12 0" stroke="${teal}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` : '';
    return `<defs>${gradient(`${p}w`, '#FFFFFF', '#C6D0DC')}<filter id="${p}g"><feGaussianBlur stdDeviation="2.2"/></filter></defs>${SHADOW}
<path d="M60 26V14" stroke="#B9C3CF" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="12" r="5" fill="${teal}"/>
<rect x="29" y="84" width="9" height="19" rx="4.5" fill="#AAB5C3"/><rect x="82" y="84" width="9" height="19" rx="4.5" fill="#AAB5C3"/>
<rect x="40" y="80" width="40" height="28" rx="13" fill="url(#${p}w)"/><circle cx="60" cy="93" r="4" fill="${teal}"/><rect x="53" y="72" width="14" height="10" rx="3" fill="#9AA6B5"/>
<rect x="18" y="40" width="10" height="22" rx="5" fill="#AAB5C3"/><rect x="92" y="40" width="10" height="22" rx="5" fill="#AAB5C3"/>
<rect x="25" y="24" width="70" height="52" rx="24" fill="url(#${p}w)"/><rect x="33" y="35" width="54" height="30" rx="15" fill="#0E1A24"/>
<g filter="url(#${p}g)" opacity=".7">${eyes}</g>${eyes}${smile}
<path d="M34 30q10 -4 22 -4" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/>`;
  },
  twin(face, _tier, p) {
    return `<defs>${gradient(`${p}s`, '#6FB0FF', '#A57BFF', 1, 1)}${gradient(`${p}y`, '#FFE98A', '#FFB938')}</defs>${SHADOW}
<path d="M58 12Q70 50 106 62Q70 74 58 110Q46 74 10 62Q46 50 58 12Z" fill="url(#${p}s)"/>
<path d="M58 22Q64 46 76 54" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".55"/>
${eye(50, 60, 6.5, face)}${eye(66, 60, 6.5, face)}${mouth(58, 71, 8, face)}
<circle cx="44" cy="69" r="3.2" fill="#FF9EC7" opacity=".7"/><circle cx="72" cy="69" r="3.2" fill="#FF9EC7" opacity=".7"/>
<path d="M96 14Q98 24 108 26Q98 28 96 38Q94 28 84 26Q94 24 96 14Z" fill="url(#${p}y)"/>
<circle cx="93.5" cy="25.5" r="1.3" fill="#3A2A00"/><circle cx="98.5" cy="25.5" r="1.3" fill="#3A2A00"/>`;
  },
  lama(face, _tier, p) {
    return `<defs>${gradient(`${p}f`, '#FBF1DE', '#E4CDA6')}</defs>${SHADOW}
<rect x="44" y="64" width="32" height="44" rx="14" fill="url(#${p}f)"/>
<circle cx="47" cy="92" r="7" fill="#FFF8EC"/><circle cx="60" cy="96" r="8" fill="#FFF8EC"/><circle cx="73" cy="92" r="7" fill="#FFF8EC"/>
<ellipse cx="39" cy="26" rx="5.5" ry="13" transform="rotate(-18 39 26)" fill="#E4CDA6"/><ellipse cx="81" cy="26" rx="5.5" ry="13" transform="rotate(18 81 26)" fill="#E4CDA6"/>
<ellipse cx="39.5" cy="27" rx="2.6" ry="8" transform="rotate(-18 39.5 27)" fill="#F2B5A8"/><ellipse cx="80.5" cy="27" rx="2.6" ry="8" transform="rotate(18 80.5 27)" fill="#F2B5A8"/>
<ellipse cx="60" cy="50" rx="24" ry="22" fill="url(#${p}f)"/>
<circle cx="51" cy="30" r="8" fill="#FFF8EC"/><circle cx="60" cy="27" r="9" fill="#FFF8EC"/><circle cx="69" cy="30" r="8" fill="#FFF8EC"/>
${eye(49, 47, 6.5, face)}${eye(71, 47, 6.5, face)}
<ellipse cx="60" cy="62" rx="14" ry="10" fill="#E8C99B"/><ellipse cx="55" cy="59" rx="2" ry="1.4" fill="#6A4A33"/><ellipse cx="65" cy="59" rx="2" ry="1.4" fill="#6A4A33"/>
${mouth(60, 65, 8, face, '#6A4A33')}
<circle cx="40" cy="57" r="3.6" fill="#F7A8A0" opacity=".6"/><circle cx="80" cy="57" r="3.6" fill="#F7A8A0" opacity=".6"/>`;
  },
  kit(face, _tier, p) {
    return `<defs>${gradient(`${p}v`, '#A58BFF', '#6C4ED8')}</defs>${SHADOW}
<path d="M74 100Q112 98 106 62Q100 84 74 86Z" fill="url(#${p}v)"/><path d="M98 76Q108 72 106 62Q104 72 96 74Z" fill="#F3EEFF"/>
<ellipse cx="58" cy="96" rx="21" ry="15" fill="url(#${p}v)"/><ellipse cx="58" cy="99" rx="11" ry="9" fill="#F3EEFF"/>
<path d="M26 50L28 12L54 38ZM94 50L92 12L66 38Z" fill="url(#${p}v)"/><path d="M32 42L33 22L47 37ZM88 42L87 22L73 37Z" fill="#F6A9CC"/>
<path d="M22 46Q26 80 60 86Q94 80 98 46Q80 34 60 36Q40 34 22 46Z" fill="url(#${p}v)"/>
<path d="M30 60Q42 84 60 86Q78 84 90 60Q76 70 60 68Q44 70 30 60Z" fill="#F3EEFF"/>
${eye(45, 56, 7, face)}${eye(75, 56, 7, face)}<ellipse cx="60" cy="70" rx="4" ry="3" fill="#1A1430"/>${mouth(60, 76, 7, face)}`;
  },
  abyss(face, _tier, p) {
    const cyan = '#62E6FF';
    const eyes = visor(face, { l: 51, r: 69, y: 54, color: cyan, off: '#3E6E80', shape: (x, y, wide) => `<ellipse cx="${x}" cy="${y}" rx="${wide ? 6 : 4.6}" ry="${wide ? 8 : 6.5}" fill="${cyan}"/>` });
    const bolts = [0, 60, 120, 180, 240, 300].map((a) => `<circle cx="${(60 + 29.5 * Math.cos((a * Math.PI) / 180)).toFixed(1)}" cy="${(54 + 29.5 * Math.sin((a * Math.PI) / 180)).toFixed(1)}" r="2.2" fill="#7A5420"/>`).join('');
    return `<defs>${gradient(`${p}b`, '#F0C779', '#9C6C2A')}${gradient(`${p}d`, '#1D5C7A', '#071C2A')}<filter id="${p}g"><feGaussianBlur stdDeviation="2.4"/></filter></defs>${SHADOW}
<circle cx="98" cy="28" r="4.5" fill="none" stroke="#9FE6FF" stroke-width="1.6"/><circle cx="105" cy="15" r="3" fill="none" stroke="#9FE6FF" stroke-width="1.4"/><circle cx="94" cy="11" r="2" fill="none" stroke="#9FE6FF" stroke-width="1.2"/>
<rect x="36" y="82" width="48" height="26" rx="13" fill="#2459B4"/><rect x="27" y="86" width="10" height="17" rx="5" fill="#1C4790"/><rect x="83" y="86" width="10" height="17" rx="5" fill="#1C4790"/>
<circle cx="60" cy="54" r="34" fill="url(#${p}b)"/>${bolts}
<circle cx="60" cy="54" r="23" fill="url(#${p}d)" stroke="#7A5420" stroke-width="4"/>
<g filter="url(#${p}g)" opacity=".8">${eyes}</g>${eyes}
<path d="M45 42a18 18 0 0 1 14 -7" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".45"/>`;
  },
  gust(face, _tier, p) {
    const ink = '#173A57';
    return `<defs><linearGradient id="${p}c" gradientUnits="userSpaceOnUse" x1="0" y1="26" x2="0" y2="96"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#AEDAF6"/></linearGradient></defs>${SHADOW}
<path d="M40 94q-6 8 2 14M60 96q6 7 -1 13M80 94q-6 8 3 13" stroke="#AEDAF6" stroke-width="3.2" fill="none" stroke-linecap="round"/>
<g fill="url(#${p}c)"><circle cx="38" cy="66" r="21"/><circle cx="60" cy="52" r="27"/><circle cx="84" cy="64" r="21"/><rect x="26" y="62" width="70" height="30" rx="15"/></g>
<path d="M44 36q8 -9 20 -9" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/>
${eye(50, 63, 7, face, ink)}${eye(72, 63, 7, face, ink)}${mouth(61, 75, 7, face, ink)}
<circle cx="40" cy="73" r="3.6" fill="#FFB3CB" opacity=".6"/><circle cx="82" cy="73" r="3.6" fill="#FFB3CB" opacity=".6"/>
<path d="M100 40q10 0 10 8q0 6 -7 6" stroke="#AEDAF6" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  },
  byte(face, _tier, p) {
    const ink = '#0D2E17';
    return `<defs>${gradient(`${p}s`, '#8DF5A9', '#27A653')}</defs>
<ellipse cx="60" cy="110" rx="38" ry="5" fill="#27A653" opacity=".45"/>
<path d="M20 104Q18 62 42 46Q60 32 78 46Q102 62 100 104Q92 110 84 104Q78 110 70 105Q60 111 50 105Q42 110 36 104Q28 110 20 104Z" fill="url(#${p}s)"/>
<ellipse cx="42" cy="58" rx="9" ry="5" transform="rotate(-30 42 58)" fill="#fff" opacity=".7"/><circle cx="34" cy="70" r="2.6" fill="#fff" opacity=".6"/>
${eye(50, 76, 7.5, face, ink)}${eye(72, 76, 7.5, face, ink)}${mouth(61, 89, 8, face, ink)}`;
  },
};

// ── the mascot collection ── same view box, shadow and faces as the model characters.
const GLOW = (p) => `<filter id="${p}g"><feGaussianBlur stdDeviation="2.2"/></filter>`;
const glow = (p, eyes) => `<g filter="url(#${p}g)" opacity=".75">${eyes}</g>${eyes}`;
// A glowing eye slanted toward the nose: the stern look of the hooded and armoured ones.
const slant = (color, w = 6.5, hgt = 4.2) => (x, y, wide) => `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${wide ? hgt * 1.5 : hgt}" transform="rotate(${x < 60 ? 14 : -14} ${x} ${y})" fill="${color}"/>`;
const round = (color, rx = 4.6, ry = 6) => (x, y, wide) => `<ellipse cx="${x}" cy="${y}" rx="${wide ? rx * 1.3 : rx}" ry="${wide ? ry * 1.3 : ry}" fill="${color}"/>`;
const smileIf = (face, d, color) => (['normal', 'up', 'down'].includes(face) ? `<path d="${d}" stroke="${color}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` : '');

Object.assign(ART, {
  'seeker-core'(face, _tier, p) {
    const c = '#62E6FF';
    return `<defs>${gradient(`${p}w`, '#F7F9FC', '#AEB9C8')}${GLOW(p)}</defs>${SHADOW}
<path d="M36 84H84L88 108H32Z" fill="url(#${p}w)"/><path d="M54 88V100M66 88V100" stroke="#8C98A8" stroke-width="2" stroke-linecap="round"/>
<path d="M60 14C90 14 102 40 99 66C97 84 82 92 60 92C38 92 23 84 21 66C18 40 30 14 60 14Z" fill="url(#${p}w)"/>
<circle cx="22" cy="62" r="10" fill="#26303D" stroke="${c}" stroke-width="3"/><circle cx="98" cy="62" r="10" fill="#26303D" stroke="${c}" stroke-width="3"/>
<ellipse cx="60" cy="61" rx="27" ry="22" fill="#0B1420"/>${glow(p, visor(face, { l: 49, r: 71, y: 59, color: c, off: '#2E4A5A', shape: slant(c) }))}
<path d="M38 26q12 -8 26 -8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9"/>`;
  },
  'nova-builder'(face, _tier, p) {
    const c = '#62E6FF';
    const purple = '#BA80FF';
    return `<defs>${gradient(`${p}w`, '#FFFFFF', '#C9C6DC')}${GLOW(p)}</defs>${SHADOW}
<path d="M78 100Q104 102 100 78" stroke="${purple}" stroke-width="6" fill="none" stroke-linecap="round"/>
<rect x="42" y="80" width="36" height="27" rx="12" fill="url(#${p}w)"/>
<path d="M30 42L33 10L56 32ZM90 42L87 10L64 32Z" fill="url(#${p}w)"/><path d="M35 36L36 20L48 32ZM85 36L84 20L72 32Z" fill="${purple}"/>
<rect x="24" y="28" width="72" height="54" rx="25" fill="url(#${p}w)"/>
<circle cx="22" cy="56" r="10" fill="#7B4FD6"/><circle cx="22" cy="56" r="5" fill="${purple}"/><circle cx="98" cy="56" r="10" fill="#7B4FD6"/><circle cx="98" cy="56" r="5" fill="${purple}"/>
<path d="M62 30l-5 6h4l-3 6 7-8h-4l3-4z" fill="${purple}"/>
<rect x="33" y="42" width="54" height="30" rx="15" fill="#120E22"/>${glow(p, visor(face, { l: 49, r: 71, y: 56, color: c, off: '#3B4C66', shape: round(c, 5, 5.5) }))}${smileIf(face, 'M55 64q5 3 10 0', c)}`;
  },
  kairo(face, _tier, p) {
    const o = '#FFAD63';
    return `<defs>${gradient(`${p}f`, '#F4F6F9', '#C3C9D2')}${gradient(`${p}t`, '#FFB25C', '#F06A1A')}${GLOW(p)}</defs>${SHADOW}
<path d="M80 104Q114 96 104 60Q100 82 82 90Z" fill="url(#${p}t)"/><path d="M100 70Q106 64 104 60Q100 66 96 68Z" fill="#fff"/>
<ellipse cx="58" cy="98" rx="21" ry="12" fill="url(#${p}f)"/>
<path d="M36 86Q60 98 84 86L84 94Q60 106 36 94Z" fill="${o}"/><path d="M70 94L78 106L68 106L66 96Z" fill="#E88A3A"/>
<path d="M26 48L22 8L52 32ZM94 48L98 8L68 32Z" fill="url(#${p}f)"/><path d="M31 41L29 18L46 33ZM89 41L91 18L74 33Z" fill="#6E747E"/>
<path d="M20 48Q26 84 60 90Q94 84 100 48Q80 32 60 34Q40 32 20 48Z" fill="url(#${p}f)"/>
<path d="M27 54Q44 44 60 56Q76 44 93 54Q89 71 74 71Q66 71 60 65Q54 71 46 71Q31 71 27 54Z" fill="#22252D"/>
${glow(p, visor(face, { l: 45, r: 75, y: 60, color: o, off: '#5A4A3A', shape: slant(o, 6, 3.8) }))}
<ellipse cx="60" cy="75" rx="4" ry="3" fill="#1A1622"/>${mouth(60, 81, 7, face)}`;
  },
  zen(face, _tier, p) {
    const g = '#94E975';
    const ink = '#BFF7A8';
    const pupil = ['happy', 'closed', 'x'].includes(face) ? ink : '#1F3A1A'; // a line on the black patch is drawn light
    return `<defs>${gradient(`${p}w`, '#FFFFFF', '#D3D9E0')}</defs>${SHADOW}
<ellipse cx="60" cy="98" rx="24" ry="13" fill="#2A2D33"/><ellipse cx="38" cy="100" rx="8" ry="6" fill="#2A2D33"/><ellipse cx="82" cy="100" rx="8" ry="6" fill="#2A2D33"/>
<circle cx="33" cy="30" r="10" fill="#2A2D33"/><circle cx="87" cy="30" r="10" fill="#2A2D33"/>
<ellipse cx="60" cy="58" rx="35" ry="31" fill="url(#${p}w)"/>
<circle cx="25" cy="60" r="9" fill="#2A2D33" stroke="${g}" stroke-width="3"/><circle cx="95" cy="60" r="9" fill="#2A2D33" stroke="${g}" stroke-width="3"/>
<ellipse cx="46" cy="57" rx="10" ry="12" transform="rotate(25 46 57)" fill="#2A2D33"/><ellipse cx="74" cy="57" rx="10" ry="12" transform="rotate(-25 74 57)" fill="#2A2D33"/>
${eye(46, 57, 5.5, face, pupil).replace('fill="#fff"/>', `fill="${ink}"/>`)}${eye(74, 57, 5.5, face, pupil).replace('fill="#fff"/>', `fill="${ink}"/>`)}
<ellipse cx="60" cy="70" rx="4.5" ry="3.2" fill="#2A2D33"/>${mouth(60, 76, 7, face, '#2A2D33')}
<path d="M60 28Q59 20 62 13" stroke="#4FAE5E" stroke-width="2.6" fill="none" stroke-linecap="round"/><ellipse cx="68" cy="13" rx="7" ry="3.6" transform="rotate(-25 68 13)" fill="${g}"/><ellipse cx="54" cy="17" rx="5" ry="2.8" transform="rotate(25 54 17)" fill="${g}"/>
<ellipse cx="80" cy="80" rx="10" ry="3.4" transform="rotate(-28 80 80)" fill="#5FC24A"/>`;
  },
  'sage-planner'(face, _tier, p) {
    return `<defs>${gradient(`${p}b`, '#B07A50', '#6A4227')}${gradient(`${p}c`, '#FFE27A', '#E0A21E')}${gradient(`${p}y`, '#FFE7A0', '#F4BC59')}</defs>${SHADOW}
<path d="M30 42L32 18L50 32ZM90 42L88 18L70 32Z" fill="url(#${p}b)"/>
<ellipse cx="26" cy="76" rx="10" ry="22" transform="rotate(14 26 76)" fill="#5A361E"/><ellipse cx="94" cy="76" rx="10" ry="22" transform="rotate(-14 94 76)" fill="#5A361E"/>
<ellipse cx="60" cy="68" rx="34" ry="40" fill="url(#${p}b)"/><ellipse cx="60" cy="86" rx="19" ry="18" fill="url(#${p}y)"/>
<path d="M52 82q4 4 8 0M60 82q4 4 8 0M56 91q4 4 8 0" stroke="#D9952A" stroke-width="2" fill="none" stroke-linecap="round"/>
<circle cx="46" cy="55" r="14" fill="#F4BC59"/><circle cx="74" cy="55" r="14" fill="#F4BC59"/><circle cx="46" cy="55" r="11" fill="#FFF4E6"/><circle cx="74" cy="55" r="11" fill="#FFF4E6"/>
${eye(46, 56, 8, face)}${eye(74, 56, 8, face)}<path d="M55 64H65L60 72Z" fill="#F2A23B" stroke="#C97F1E" stroke-width="1" stroke-linejoin="round"/>
<ellipse cx="50" cy="108" rx="6" ry="3" fill="#F2B84B"/><ellipse cx="70" cy="108" rx="6" ry="3" fill="#F2B84B"/>
<path d="M44 30L47 12L54 21L60 8L66 21L73 12L76 30Z" fill="url(#${p}c)" stroke="#C98A12" stroke-width="1.2" stroke-linejoin="round"/><circle cx="60" cy="21" r="2.4" fill="#E84A5F"/>`;
  },
  lumi(face, _tier, p) {
    const c = '#62E6FF';
    const legs = [36, 48, 60, 72, 84].map((x, i) => `<path d="M${x} 66q${i % 2 ? 6 : -6} 10 0 20t0 18" stroke="#9D6CF0" stroke-width="5" fill="none" stroke-linecap="round"/>`).join('');
    return `<defs>${gradient(`${p}j`, '#DCC0FF', '#7B4FE0')}${GLOW(p)}</defs>${SHADOW}${legs}
<path d="M22 64Q22 20 60 20Q98 20 98 64Q92 71 85 66Q79 72 72 66Q66 72 60 66Q54 72 48 66Q41 72 35 66Q28 71 22 64Z" fill="url(#${p}j)"/>
<path d="M36 32q10 -8 24 -8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/>
<ellipse cx="60" cy="49" rx="23" ry="15" fill="#1B1036"/>${glow(p, visor(face, { l: 51, r: 69, y: 47, color: c, off: '#3B3E66', shape: round(c, 4.2, 5.2) }))}${smileIf(face, 'M55 55q5 3.5 10 0', c)}`;
  },
  atlas(face, _tier, p) {
    const o = '#FFB347';
    return `<defs>${gradient(`${p}a`, '#8C97AC', '#4C5468')}${gradient(`${p}h`, '#C7D8F7', '#6F86B4')}${GLOW(p)}</defs>${SHADOW}
<rect x="20" y="80" width="15" height="20" rx="6" fill="url(#${p}a)"/><rect x="85" y="80" width="15" height="20" rx="6" fill="url(#${p}a)"/>
<rect x="36" y="76" width="48" height="31" rx="12" fill="url(#${p}a)"/><rect x="50" y="84" width="20" height="6" rx="3" fill="#A8C5F5" opacity=".7"/>
<path d="M32 40Q12 32 16 10Q24 26 42 30Z" fill="url(#${p}h)"/><path d="M88 40Q108 32 104 10Q96 26 78 30Z" fill="url(#${p}h)"/>
<path d="M30 36l6 -3M84 33l6 3" stroke="${o}" stroke-width="3" stroke-linecap="round"/>
<rect x="27" y="26" width="66" height="52" rx="20" fill="url(#${p}a)"/>
<rect x="35" y="43" width="50" height="20" rx="9" fill="#0D1018"/>${glow(p, visor(face, { l: 49, r: 71, y: 53, color: o, off: '#5A4A3A', shape: slant(o, 6, 3.4) }))}
<rect x="44" y="66" width="32" height="8" rx="3" fill="#B9C2D2"/><path d="M52 66v8M60 66v8M68 66v8" stroke="#6E788A" stroke-width="1.6"/>`;
  },
  orion(face, _tier, p) {
    const c = '#58E7F0';
    return `<defs>${gradient(`${p}d`, '#323A58', '#12172A')}${gradient(`${p}c`, '#B5FAFF', '#2BB8D0')}${GLOW(p)}</defs>${SHADOW}
<path d="M42 86Q60 98 78 86L84 108H36Z" fill="url(#${p}d)"/><path d="M50 96l10 6l10 -6" stroke="${c}" stroke-width="2" fill="none" opacity=".7"/>
<path d="M42 34L32 8L52 28ZM54 28L58 2L68 27ZM72 31L90 9L82 36Z" fill="url(#${p}c)"/>
<path d="M30 62L8 52L28 74ZM90 62L112 52L92 74Z" fill="url(#${p}c)"/>
<path d="M28 60Q28 28 60 26Q92 28 92 60Q90 86 60 92Q30 86 28 60Z" fill="url(#${p}d)" stroke="#3E4A70" stroke-width="1.6"/>
<path d="M44 72Q60 64 76 72Q74 86 60 88Q46 86 44 72Z" fill="#262E48"/><path d="M53 74l3 3M67 74l-3 3" stroke="${c}" stroke-width="2" stroke-linecap="round"/><path d="M50 82q10 4 20 0" stroke="#58E7F0" stroke-width="1.6" fill="none" opacity=".6"/>
${glow(p, visor(face, { l: 46, r: 74, y: 55, color: c, off: '#2E4A5A', shape: slant(c, 7, 3.8) }))}`;
  },
  rae(face, _tier, p) {
    const pink = '#F682C5';
    return `<defs>${gradient(`${p}w`, '#FFFFFF', '#D6CFE0')}${GLOW(p)}</defs>${SHADOW}
<ellipse cx="45" cy="22" rx="8" ry="19" transform="rotate(-14 45 22)" fill="url(#${p}w)"/><ellipse cx="75" cy="22" rx="8" ry="19" transform="rotate(14 75 22)" fill="url(#${p}w)"/>
<ellipse cx="45" cy="23" rx="3.6" ry="12" transform="rotate(-14 45 23)" fill="${pink}"/><ellipse cx="75" cy="23" rx="3.6" ry="12" transform="rotate(14 75 23)" fill="${pink}"/>
<rect x="42" y="82" width="36" height="25" rx="11" fill="url(#${p}w)"/><path d="M62 86l-5 7h4l-3 7 8 -9h-4l3 -5z" fill="${pink}"/>
<rect x="25" y="32" width="70" height="52" rx="24" fill="url(#${p}w)"/>
<circle cx="22" cy="60" r="9" fill="#B43F88"/><circle cx="22" cy="60" r="4.5" fill="${pink}"/><circle cx="98" cy="60" r="9" fill="#B43F88"/><circle cx="98" cy="60" r="4.5" fill="${pink}"/>
<rect x="30" y="33" width="60" height="9" rx="4.5" fill="${pink}"/><circle cx="47" cy="37.5" r="6" fill="#FFD6EC" stroke="#B43F88" stroke-width="2"/><circle cx="73" cy="37.5" r="6" fill="#FFD6EC" stroke="#B43F88" stroke-width="2"/>
<rect x="34" y="47" width="52" height="28" rx="14" fill="#1A0F1E"/>${glow(p, visor(face, { l: 49, r: 71, y: 61, color: pink, off: '#5A3A50', shape: round(pink, 5, 5.5) }))}${smileIf(face, 'M56 68q4 3 8 0', pink)}`;
  },
  cosmo(face, _tier, p) {
    const c = '#62E6FF';
    const v = '#A298FF';
    return `<defs>${gradient(`${p}w`, '#FFFFFF', '#C3C8DA')}${gradient(`${p}y`, '#FFE98A', '#FFB938')}${GLOW(p)}</defs>${SHADOW}
<ellipse cx="60" cy="99" rx="19" ry="11" fill="url(#${p}w)"/><path d="M60 94l2 4h4l-3 3 1 4-4 -2-4 2 1 -4-3 -3h4z" fill="url(#${p}y)"/>
<circle cx="60" cy="54" r="35" fill="url(#${p}w)"/>
<rect x="18" y="44" width="10" height="22" rx="5" fill="${v}"/><rect x="92" y="44" width="10" height="22" rx="5" fill="${v}"/>
<ellipse cx="60" cy="57" rx="26" ry="20" fill="#0C0F1C"/>${glow(p, visor(face, { l: 50, r: 70, y: 56, color: c, off: '#2E4A5A', shape: round(c) }))}${smileIf(face, 'M55 65q5 3 10 0', c)}
<ellipse cx="60" cy="82" rx="48" ry="9" fill="none" stroke="${v}" stroke-width="2"/><circle cx="104" cy="85" r="3.4" fill="${v}"/>
<path d="M100 10Q101 18 108 19Q101 20 100 28Q99 20 92 19Q99 18 100 10Z" fill="url(#${p}y)"/>
<path d="M38 32q10 -9 24 -10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9"/>`;
  },
  golem(face, _tier, p) {
    const y = '#FFD84A';
    return `<defs>${gradient(`${p}s`, '#959BA6', '#555A63')}${GLOW(p)}</defs>${SHADOW}
<path d="M38 78H82L86 106H34Z" fill="url(#${p}s)"/>
<circle cx="24" cy="92" r="13" fill="url(#${p}s)"/><circle cx="96" cy="92" r="13" fill="url(#${p}s)"/><path d="M20 88l6 4M98 86l-4 6" stroke="#3E4249" stroke-width="2" stroke-linecap="round"/>
<path d="M28 46L38 26L82 24L94 42L92 72L78 82H42L28 72Z" fill="url(#${p}s)"/>
<path d="M36 40l8 4M84 64l-6 4M40 70l6 -2" stroke="#3E4249" stroke-width="2" stroke-linecap="round"/>
<g fill="#7CC24F"><circle cx="42" cy="27" r="7"/><circle cx="54" cy="23" r="8"/><circle cx="68" cy="23" r="7.5"/><circle cx="80" cy="28" r="6.5"/></g>
<path d="M50 18q-2 -8 4 -10M70 18q4 -7 10 -6" stroke="#4FAE5E" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<rect x="38" y="44" width="44" height="17" rx="6" fill="#2A2C30"/>${glow(p, visor(face, { l: 50, r: 70, y: 52.5, color: y, off: '#5A5240', shape: slant(y, 6, 3.6) }))}
${mouth(60, 70, 9, face, '#2A2C30')}`;
  },
  vex(face, _tier, p) {
    const pink = '#FF729C';
    return `<defs>${gradient(`${p}d`, '#3E2D54', '#16101F')}${GLOW(p)}</defs>${SHADOW}
<ellipse cx="60" cy="90" rx="25" ry="18" fill="#2C2140" stroke="#6B4A92" stroke-width="2"/><path d="M38 84Q30 98 40 106M82 84Q90 98 80 106" stroke="${pink}" stroke-width="2" fill="none" opacity=".6"/>
<path d="M38 34L18 18L42 26ZM46 26L38 4L58 22ZM60 23L66 3L72 25Z" fill="#4A3566"/>
<circle cx="58" cy="54" r="31" fill="url(#${p}d)" stroke="#6B4A92" stroke-width="2"/>
<path d="M40 40q8 -10 20 -11" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".35"/>
<path d="M76 54L108 62L78 72Z" fill="#8E86A0"/><path d="M78 62L108 62" stroke="#5E5670" stroke-width="1.4"/>
${glow(p, visor(face, { l: 46, r: 66, y: 50, color: pink, off: '#5A3A4A', shape: slant(pink, 6, 3.4) }))}`;
  },
  foxwise(face, _tier, p) {
    const o = '#FFB33E';
    return `<defs>${gradient(`${p}v`, '#FFB65E', '#E2701C')}</defs>${SHADOW}
<path d="M30 102Q2 96 12 66Q16 86 34 90Z" fill="url(#${p}v)"/><path d="M14 74Q10 68 12 66Q16 70 18 72Z" fill="#fff"/>
<path d="M34 86Q60 78 86 86L92 108H28Z" fill="#1E1A22"/><path d="M54 91H66L60 101Z" fill="none" stroke="${o}" stroke-width="2.6" stroke-linejoin="round"/>
<path d="M26 50L28 10L54 36ZM94 50L92 10L66 36Z" fill="url(#${p}v)"/><path d="M32 42L33 20L47 35ZM88 42L87 20L73 35Z" fill="#FFE3C0"/>
<path d="M22 46Q26 80 60 86Q94 80 98 46Q80 34 60 36Q40 34 22 46Z" fill="url(#${p}v)"/>
<path d="M30 60Q42 84 60 86Q78 84 90 60Q76 70 60 68Q44 70 30 60Z" fill="#FFF4E6"/>
<rect x="30" y="31" width="60" height="7" rx="3.5" fill="#3A2A1E"/><circle cx="47" cy="34" r="8" fill="#FFD27A" stroke="#3A2A1E" stroke-width="3"/><circle cx="73" cy="34" r="8" fill="#FFD27A" stroke="#3A2A1E" stroke-width="3"/>
${eye(46, 56, 6.5, face)}${eye(74, 56, 6.5, face)}<ellipse cx="60" cy="70" rx="4" ry="3" fill="#1A1622"/>${mouth(60, 76, 7, face)}`;
  },
  owlara(face, _tier, p) {
    const c = '#5DEAF2';
    const ink = '#183A44';
    return `<defs>${gradient(`${p}b`, '#A87650', '#6A4429')}</defs>${SHADOW}
<path d="M30 40L32 16L50 30ZM90 40L88 16L70 30Z" fill="url(#${p}b)"/>
<ellipse cx="60" cy="66" rx="34" ry="40" fill="url(#${p}b)"/><ellipse cx="60" cy="80" rx="20" ry="18" fill="#F3DDBF"/>
<circle cx="45" cy="52" r="13" fill="#FFF4E6" stroke="#2E2218" stroke-width="3"/><circle cx="75" cy="52" r="13" fill="#FFF4E6" stroke="#2E2218" stroke-width="3"/><path d="M58 52h4" stroke="#2E2218" stroke-width="3"/>
${eye(45, 53, 7.5, face, ink)}${eye(75, 53, 7.5, face, ink)}<path d="M55 62H65L60 70Z" fill="#F2A23B" stroke="#C97F1E" stroke-width="1" stroke-linejoin="round"/>
<rect x="38" y="76" width="44" height="28" rx="4" fill="#1B2430" stroke="#3E4A5C" stroke-width="2"/>
<path d="M46 98V92M53 98V88M60 98V84M67 98V90M74 98V82" stroke="${c}" stroke-width="3.4" stroke-linecap="round"/>
<ellipse cx="33" cy="88" rx="8" ry="12" transform="rotate(20 33 88)" fill="#5A361E"/><ellipse cx="87" cy="88" rx="8" ry="12" transform="rotate(-20 87 88)" fill="#5A361E"/>
<ellipse cx="50" cy="108" rx="6" ry="3" fill="#F2B84B"/><ellipse cx="70" cy="108" rx="6" ry="3" fill="#F2B84B"/>`;
  },
  opty(face, _tier, p) {
    const c = '#62E6FF';
    return `<defs>${gradient(`${p}w`, '#FFFFFF', '#C8C3E2')}${GLOW(p)}</defs>${SHADOW}
<path d="M60 24V14" stroke="#B9B5D0" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="11" r="5" fill="${c}"/>
<ellipse cx="34" cy="92" rx="6" ry="10" fill="url(#${p}w)"/><ellipse cx="86" cy="92" rx="6" ry="10" fill="url(#${p}w)"/>
<ellipse cx="60" cy="93" rx="20" ry="15" fill="url(#${p}w)"/><circle cx="60" cy="93" r="4.5" fill="${c}"/>
<ellipse cx="60" cy="51" rx="35" ry="29" fill="url(#${p}w)"/>
<circle cx="25" cy="51" r="7" fill="#DAD6EC"/><circle cx="25" cy="51" r="3.5" fill="${c}"/><circle cx="95" cy="51" r="7" fill="#DAD6EC"/><circle cx="95" cy="51" r="3.5" fill="${c}"/>
<ellipse cx="60" cy="53" rx="25" ry="16" fill="#10161F"/>${glow(p, visor(face, { l: 50, r: 70, y: 52, color: c, off: '#2E4A5A', shape: round(c, 4.4, 5) }))}${smileIf(face, 'M55 60q5 3 10 0', c)}
<path d="M36 34q10 -8 22 -9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9"/>`;
  },
  flowbie(face, _tier, p) {
    const ink = '#0D2E17';
    return `<defs>${gradient(`${p}s`, '#B0F7A2', '#3CB648')}</defs>
<ellipse cx="60" cy="108" rx="40" ry="5" fill="#3CB648" opacity=".45"/>
<circle cx="74" cy="34" r="5" fill="#8EEE80"/><circle cx="84" cy="22" r="3.4" fill="#8EEE80"/><circle cx="66" cy="22" r="2.4" fill="#8EEE80"/>
<path d="M20 104Q16 56 60 46Q104 56 100 104Q60 112 20 104Z" fill="url(#${p}s)"/>
<ellipse cx="40" cy="64" rx="9" ry="5" transform="rotate(-25 40 64)" fill="#fff" opacity=".7"/><circle cx="32" cy="76" r="2.6" fill="#fff" opacity=".6"/>
${eye(49, 78, 7.5, face, ink)}${eye(71, 78, 7.5, face, ink)}${mouth(60, 91, 8, face, ink)}
<circle cx="40" cy="88" r="3.4" fill="#FF9EC7" opacity=".5"/><circle cx="80" cy="88" r="3.4" fill="#FF9EC7" opacity=".5"/>`;
  },
  ravenix(face, _tier, p) {
    const o = '#F5A623';
    return `<defs>${gradient(`${p}d`, '#6E4CA4', '#2A1D42')}${gradient(`${p}c`, '#B385FA', '#5B3796')}</defs>${SHADOW}
<path d="M30 76Q60 66 90 76L102 106Q60 96 18 106Z" fill="url(#${p}c)"/><path d="M54 82H66L60 92Z" fill="${o}"/>
<path d="M38 32L20 16L42 24ZM46 24L40 4L58 20ZM60 22L68 4L72 24Z" fill="#6E4CA4"/>
<circle cx="58" cy="50" r="28" fill="url(#${p}d)"/>
<path d="M76 50L106 57L78 64Z" fill="#9A93A8"/><path d="M78 57L106 57" stroke="#6A6378" stroke-width="1.4"/>
${eye(45, 49, 6.5, face)}<circle cx="67" cy="47" r="10" fill="none" stroke="${o}" stroke-width="3.2"/>${eye(67, 47, 6.5, face)}
<path d="M75 53Q80 66 76 74" stroke="${o}" stroke-width="1.4" fill="none"/>`;
  },
  bytecat(face, _tier, p) {
    const c = '#62E6FF';
    return `<defs>${gradient(`${p}h`, '#C99BFA', '#6E3FC0')}</defs>${SHADOW}
<path d="M30 98Q6 94 14 72" stroke="#8D5BDE" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M26 44L28 8L50 28ZM94 44L92 8L70 28Z" fill="url(#${p}h)"/><path d="M31 38L32 18L44 30ZM89 38L88 18L76 30Z" fill="#E9DDFB"/>
<path d="M60 16C88 16 100 40 98 64C96 82 82 90 60 90C38 90 24 82 22 64C20 40 32 16 60 16Z" fill="url(#${p}h)"/>
<ellipse cx="60" cy="58" rx="24" ry="19" fill="#EBE0FB"/>
${eye(50, 55, 6, face)}${eye(70, 55, 6, face)}<path d="M58 63h4l-2 2.5z" fill="#F682C5"/>${mouth(60, 68, 6, face)}
<path d="M38 62h-10M38 66l-9 2M82 62h10M82 66l9 2" stroke="#A88BCB" stroke-width="1.4" stroke-linecap="round"/>
<rect x="34" y="78" width="52" height="26" rx="3" fill="#262B36" stroke="#4A5262" stroke-width="2"/>
<path d="M53 86L47 91L53 96M67 86L73 91L67 96" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="28" y="103" width="64" height="5" rx="2.5" fill="#5A6272"/>`;
  },
  shieldbug(face, _tier, p) {
    const y = '#FFD84A';
    return `<defs>${gradient(`${p}o`, '#FFC266', '#D9741A')}${gradient(`${p}d`, '#3A3E47', '#1C1E24')}${GLOW(p)}</defs>${SHADOW}
<path d="M38 74l-14 -6M36 88l-16 2M40 100l-12 8M82 74l14 -6M84 88l16 2M80 100l12 8" stroke="#2A2D33" stroke-width="3.4" stroke-linecap="round"/>
<ellipse cx="38" cy="84" rx="15" ry="24" transform="rotate(14 38 84)" fill="url(#${p}o)"/><ellipse cx="82" cy="84" rx="15" ry="24" transform="rotate(-14 82 84)" fill="url(#${p}o)"/>
<ellipse cx="60" cy="84" rx="19" ry="23" fill="url(#${p}d)"/>
<path d="M60 72L70 76V84Q70 92 60 96Q50 92 50 84V76Z" fill="none" stroke="#FFBA4D" stroke-width="2.6" stroke-linejoin="round"/>
<path d="M46 34Q34 18 40 6Q46 20 54 28ZM74 34Q86 18 80 6Q74 20 66 28Z" fill="url(#${p}o)"/>
<ellipse cx="60" cy="46" rx="22" ry="17" fill="url(#${p}d)"/>${glow(p, visor(face, { l: 52, r: 68, y: 46, color: y, off: '#5A5240', shape: round(y, 4.4, 5) }))}`;
  },
  octy(face, _tier, p) {
    const c = '#5DEAF2';
    const arms = [[38, -10], [46, -5], [55, -2], [65, 2], [74, 5], [82, 10]].map(([x, d]) => `<path d="M${x} 72q${d} 18 ${d * 2} 26q${d > 0 ? 4 : -4} 4 ${d > 0 ? 7 : -7} 0" stroke="#9867EC" stroke-width="7" fill="none" stroke-linecap="round"/>`).join('');
    return `<defs>${gradient(`${p}o`, '#D2B2FF', '#8C5BE8')}</defs>${SHADOW}${arms}
<ellipse cx="60" cy="52" rx="31" ry="28" fill="url(#${p}o)"/>
<path d="M30 52Q30 18 60 18Q90 18 90 52" stroke="#26303D" stroke-width="4" fill="none"/>
<rect x="22" y="44" width="11" height="19" rx="5.5" fill="#26303D" stroke="${c}" stroke-width="2"/><rect x="87" y="44" width="11" height="19" rx="5.5" fill="#26303D" stroke="${c}" stroke-width="2"/>
${eye(50, 54, 6, face)}${eye(70, 54, 6, face)}${mouth(60, 64, 7, face)}
<circle cx="42" cy="62" r="3.4" fill="#FF9EC7" opacity=".6"/><circle cx="78" cy="62" r="3.4" fill="#FF9EC7" opacity=".6"/>
<rect x="4" y="12" width="20" height="14" rx="3" fill="#1E2B38" stroke="${c}" stroke-width="1.6"/><path d="M9 19l3 3 6 -6" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>
<rect x="96" y="14" width="20" height="14" rx="3" fill="#1E2B38" stroke="${c}" stroke-width="1.6"/><path d="M100 19h12M100 23h8" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>`;
  },
});

/**
 * The character as an SVG string. `face` is one of FACES' values; an unknown id draws Byte and an
 * unknown face draws the resting one, so a newer Mac can never break the drawing.
 */
export function drawCharacter(who, { face = 'normal' } = {}) {
  const id = ART[who?.id] ? who.id : 'byte';
  const tier = id === 'sage' && TIERS[who?.tier] ? who.tier : null;
  const p = `ch${++drawn}`;
  return `<svg class="char" viewBox="0 0 120 120" aria-hidden="true">${ART[id](face, tier, p)}</svg>`;
}
