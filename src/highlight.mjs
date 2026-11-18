// Code in colour, for the diffs SEEKER shows and the code blocks in answers: keywords red, strings green,
// function names cyan, numbers and constants purple, types amber, comments grey.
//
// It is a small tokenizer, not a parser: one line at a time, knowing each language's keywords, how it
// writes comments and strings, and carrying a block comment or a long string over to the next line.
// Only the text colour is set (and put back with 39), so the green or red behind a diff line stays.
import { sgr } from './theme.mjs';

const PALETTE = {
  keyword: '#FF7B72',
  string: '#7EE787',
  func: '#56D4DD',
  number: '#C792EA',
  type: '#FFB86C',
  comment: '#8B949E',
};
// With sixteen colours: red, green, cyan, magenta, yellow, bright black.
const SIXTEEN = { keyword: '31', string: '32', func: '36', number: '35', type: '33', comment: '90' };

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const C_LIKE = { line: ['//'], block: ['/*', '*/'], quotes: `"'` };
const HASH = { line: ['#'], quotes: `"'` };

const LANGUAGES = {
  js: {
    ...C_LIKE,
    quotes: `"'\``,
    keywords: words(`async await break case catch class const continue debugger default delete do else export extends finally for from function
      get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield
      as interface type enum implements namespace declare readonly private protected public abstract keyof satisfies`),
    constants: words('true false null undefined NaN Infinity'),
  },
  py: {
    ...HASH,
    long: ['"""', "'''"],
    keywords: words(`and as assert async await break class continue def del elif else except finally for from global if import in is
      lambda nonlocal not or pass raise return try while with yield match case self`),
    constants: words('True False None'),
  },
  sh: {
    ...HASH,
    keywords: words(`if then else elif fi for while until do done case esac in function return local export source
      echo cd exit set unset readonly shift trap`),
    constants: words('true false'),
  },
  go: {
    ...C_LIKE,
    quotes: `"'\``,
    keywords: words(`break case chan const continue default defer else fallthrough for func go goto if import interface map package range
      return select struct switch type var`),
    constants: words('true false nil iota'),
  },
  rust: {
    ...C_LIKE,
    keywords: words(`as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref
      return self Self static struct super trait type unsafe use where while`),
    constants: words('true false None Some Ok Err'),
  },
  c: {
    ...C_LIKE,
    keywords: words(`auto break case char class const continue default delete do double else enum extern float for goto if inline int long
      namespace new private protected public register return short signed sizeof static struct switch template this throw try
      typedef typename union unsigned using virtual void volatile while bool include define ifdef ifndef endif pragma
      abstract boolean byte extends final finally implements import instanceof interface native package super synchronized
      throws transient var val fun when object override suspend data sealed lateinit internal open
      func let guard defer protocol extension init deinit mutating weak`),
    constants: words('true false null nullptr NULL nil'),
  },
  ruby: {
    ...HASH,
    keywords: words(`alias and begin break case class def do else elsif end ensure for if in module next not or redo rescue retry return
      self super then undef unless until when while yield require attr_accessor`),
    constants: words('true false nil'),
  },
  php: {
    ...C_LIKE,
    keywords: words(`abstract and as break case catch class const continue declare default do echo else elseif extends final finally fn
      for foreach function global if implements include interface namespace new or private protected public require return
      static switch throw trait try use var while yield`),
    constants: words('true false null TRUE FALSE NULL'),
  },
  sql: {
    line: ['--'],
    block: ['/*', '*/'],
    quotes: `'"`,
    caseless: true,
    keywords: words(`select from where and or not insert into values update set delete create table alter drop index on join left right
      inner outer full group by order having limit offset as distinct union all primary key foreign references default
      constraint unique check if exists begin commit rollback returning with case when then else end is in like between`),
    constants: words('null true false'),
  },
  css: {
    block: ['/*', '*/'],
    quotes: `"'`,
    keywords: words('important media import supports keyframes font-face from to and not only'),
    constants: words(''),
    css: true,
  },
  yaml: { ...HASH, keywords: words(''), constants: words('true false null yes no on off ~'), yaml: true },
  html: { block: ['<!--', '-->'], quotes: `"'`, keywords: words(''), constants: words(''), html: true },
};
LANGUAGES.json = { ...LANGUAGES.js, line: [], block: null, keywords: words('') };
LANGUAGES.toml = { ...LANGUAGES.yaml };

const NAMES = {
  js: 'js mjs cjs jsx ts mts cts tsx javascript typescript node deno',
  json: 'json jsonc json5',
  py: 'py pyw python python3 ipython',
  sh: 'sh bash zsh fish shell console shellscript ksh',
  go: 'go golang',
  rust: 'rs rust',
  c: 'c h cc cpp cxx hpp hh cs csharp java kt kts kotlin swift m mm objc scala dart groovy gradle zig',
  ruby: 'rb ruby rake gemspec',
  php: 'php',
  sql: 'sql psql mysql sqlite',
  css: 'css scss sass less',
  yaml: 'yaml yml',
  toml: 'toml ini cfg conf env',
  html: 'html htm xml svg vue svelte astro xhtml plist',
};
const BY_NAME = new Map(Object.entries(NAMES).flatMap(([lang, names]) => names.split(' ').map((n) => [n, lang])));
const FILE_NAMES = { Dockerfile: 'sh', Makefile: 'sh', Gemfile: 'ruby', Rakefile: 'ruby', '.bashrc': 'sh', '.zshrc': 'sh', '.env': 'toml' };

/** The language of a code block's tag (`js`, `python`) or of a file's name; null when it is not one known here. */
export function languageOf(nameOrPath) {
  if (!nameOrPath) return null;
  const text = String(nameOrPath).trim();
  const base = text.split(/[\\/]/).pop();
  if (FILE_NAMES[base]) return FILE_NAMES[base];
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : base;
  return BY_NAME.get(ext.toLowerCase()) ?? null;
}

/** `kind → (text) => coloured text`, at the terminal's colour depth; null when there is no colour. */
export function highlighter(depth) {
  if (!depth) return null;
  const paint = {};
  for (const kind of Object.keys(PALETTE)) {
    const code = depth >= 8 ? sgr(PALETTE[kind], depth) : SIXTEEN[kind];
    paint[kind] = (s) => (s ? `\x1b[${code}m${s}\x1b[39m` : s);
  }
  return paint;
}

const IDENT = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y;

/**
 * One line of code in colour. `state` carries what is still open at the end of the line (a block comment,
 * a long string) into the next one; pass the same object for each line of a block.
 */
export function highlightLine(line, lang, paint, state = {}) {
  const spec = LANGUAGES[lang];
  if (!spec || !paint || !line) return line;
  let out = '';
  let i = 0;
  const n = line.length;

  // Carried over: the rest of a block comment or long string.
  if (state.close) {
    const end = line.indexOf(state.close);
    const kind = state.kind;
    if (end < 0) return paint[kind](line);
    i = end + state.close.length;
    out += paint[kind](line.slice(0, i));
    state.close = null;
  }

  // Markup: tags and their attributes; text between them is left alone.
  if (spec.html) return out + html(line.slice(i), paint, spec, state);

  // YAML and TOML: a key before its colon (or equals) reads as a name.
  if ((spec.yaml || lang === 'toml') && i === 0) {
    const key = /^(\s*-?\s*)([\w.\-"' ]+?)(\s*[:=](?:\s|$))/.exec(line);
    if (key && !line.trimStart().startsWith('#')) {
      out += key[1] + paint.func(key[2]) + key[3];
      i = key[0].length;
    }
  }

  let afterDot = false;
  while (i < n) {
    const ch = line[i];
    const rest = line.slice(i);
    // Comments.
    if (spec.line?.some((m) => rest.startsWith(m)) && !(lang === 'sh' && ch === '#' && i > 0 && !/\s/.test(line[i - 1]))) {
      out += paint.comment(rest);
      break;
    }
    if (spec.block && rest.startsWith(spec.block[0])) {
      const end = line.indexOf(spec.block[1], i + spec.block[0].length);
      if (end < 0) {
        Object.assign(state, { close: spec.block[1], kind: 'comment' });
        out += paint.comment(rest);
        break;
      }
      out += paint.comment(line.slice(i, end + spec.block[1].length));
      i = end + spec.block[1].length;
      continue;
    }
    // Strings, a long one (''' or """) first.
    const long = spec.long?.find((q) => rest.startsWith(q));
    if (long) {
      const end = line.indexOf(long, i + 3);
      if (end < 0) {
        Object.assign(state, { close: long, kind: 'string' });
        out += paint.string(rest);
        break;
      }
      out += paint.string(line.slice(i, end + 3));
      i = end + 3;
      continue;
    }
    if (spec.quotes.includes(ch) && !(lang === 'rust' && ch === "'" && /^'[a-z_]\w*(?!')/.test(rest))) {
      let j = i + 1;
      while (j < n && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
      if (j >= n && ch === '`') {
        // A template string that goes on to the next line.
        Object.assign(state, { close: '`', kind: 'string' });
        out += paint.string(rest);
        break;
      }
      out += paint.string(line.slice(i, Math.min(n, j + 1)));
      i = Math.min(n, j + 1);
      afterDot = false;
      continue;
    }
    // Numbers, not the digits inside a name.
    if (/[\d.]/.test(ch) && !/[\w$]/.test(line[i - 1] ?? '')) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(line);
      if (m && m[0] !== '.' && /\d/.test(m[0])) {
        out += paint.number(m[0]);
        i += m[0].length;
        continue;
      }
    }
    // Names: keywords, constants, function calls, types.
    IDENT.lastIndex = i;
    const id = IDENT.exec(line);
    if (id) {
      const word = id[0];
      const key = spec.caseless ? word.toLowerCase() : word;
      const next = line.slice(i + word.length).match(/^\s*(.)/)?.[1];
      if (spec.css) out += next === ':' && !afterDot ? paint.func(word) : word;
      else if (spec.keywords.has(key) && !afterDot) out += paint.keyword(word);
      else if (spec.constants.has(key)) out += paint.number(word);
      else if (next === '(') out += paint.func(word);
      else if (/^[A-Z][a-z0-9]\w*$/.test(word) || (lang === 'c' && /^[A-Z]\w*$/.test(word) && /[a-z]/.test(word))) out += paint.type(word);
      else out += word;
      i += word.length;
      afterDot = false;
      continue;
    }
    // CSS: #id, .class and @rule.
    if (spec.css && (ch === '@' || ch === '#' || ch === '.') && /[\w-]/.test(line[i + 1] ?? '')) {
      const m = /^[@#.][\w-]+/.exec(rest);
      out += (ch === '@' ? paint.keyword : paint.type)(m[0]);
      i += m[0].length;
      continue;
    }
    afterDot = ch === '.';
    out += ch;
    i += 1;
  }
  return out;
}

/** A line of HTML or XML: tag names red, attribute names cyan, their values green. */
function html(line, paint, spec, state) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith('<!--')) {
      const end = line.indexOf('-->', i + 4);
      if (end < 0) {
        Object.assign(state, { close: '-->', kind: 'comment' });
        return out + paint.comment(rest);
      }
      out += paint.comment(line.slice(i, end + 3));
      i = end + 3;
      continue;
    }
    const tag = /^<\/?([\w:-]+)/.exec(rest);
    if (tag) {
      out += tag[0].slice(0, tag[0].length - tag[1].length) + paint.keyword(tag[1]);
      i += tag[0].length;
      // Its attributes, up to the end of the tag.
      while (i < line.length && line[i] !== '>') {
        const attr = /^(\s+)([\w:@.-]+)/.exec(line.slice(i));
        if (attr) {
          out += attr[1] + paint.func(attr[2]);
          i += attr[0].length;
          continue;
        }
        if (spec.quotes.includes(line[i])) {
          const q = line[i];
          const end = line.indexOf(q, i + 1);
          const stop = end < 0 ? line.length : end + 1;
          out += paint.string(line.slice(i, stop));
          i = stop;
          continue;
        }
        out += line[i];
        i += 1;
      }
      continue;
    }
    out += line[i];
    i += 1;
  }
  return out;
}
