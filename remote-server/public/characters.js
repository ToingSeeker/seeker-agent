// The agent characters: who stands on the Live Agent card, chosen by the model the session runs.
// The orange robot stays SEEKER's own mark (header, gate, app icon); these are for the agents it drives.
// One character per model family, a tier shown as an accessory, and the mood shown as a face.
// Plain data in, an SVG string out — no DOM — so the page and the tests run the same code. Nothing
// from the Mac is ever put into the SVG: a model name only picks among the fixed drawings below.

/** Every character, in the order the settings list them. `family` is what it stands for. */
export const CHARACTERS = {
  sage: { name: 'Sage', kind: 'Owl', family: 'Claude', accent: '#E8805F' },
  nova: { name: 'Nova', kind: 'Android', family: 'GPT', accent: '#2BD9B0' },
  twin: { name: 'Twin', kind: 'Twin stars', family: 'Gemini', accent: '#8A8CFF' },
  lama: { name: 'Lama', kind: 'Llama', family: 'Llama', accent: '#E3C79A' },
  kit: { name: 'Kit', kind: 'Fox', family: 'Qwen', accent: '#9F82FF' },
  abyss: { name: 'Abyss', kind: 'Diver', family: 'DeepSeek', accent: '#46B4FF' },
  gust: { name: 'Gust', kind: 'Wind spirit', family: 'Mistral', accent: '#86D3FF' },
  byte: { name: 'Byte', kind: 'Slime', family: 'Other models', accent: '#62E089' },
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
  if (!setting || setting === 'auto' || !CHARACTERS[setting]) return auto;
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
