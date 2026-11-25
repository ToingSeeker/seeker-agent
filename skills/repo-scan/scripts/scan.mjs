#!/usr/bin/env node
// scan.mjs: static pre-install scan of a repository or package folder, so a "is this safe to install?"
// verdict quotes real file:line evidence instead of guesses. Node 22+, no dependencies, no keys.
// It NEVER runs anything from the scanned tree: no install, no build, no scripts, no imports. It only
// reads files as bytes/text. The one network call is the optional OSV advisory lookup (package names and
// versions only), skipped with --offline.
//
//   node scan.mjs /tmp/review/some-repo
//   node scan.mjs /tmp/review/some-repo --offline
//   node scan.mjs /tmp/review/some-repo --max-findings 400
//   node scan.mjs /tmp/review/some-repo --include-node-modules   also scan a committed/installed node_modules
//
// Prints ONE JSON object: target, verdict, counts, installHooks, findings, binaries, dependencies, osv,
// skipped. A check that failed holds { error } and the rest still prints; report that gap, never fill it.
// "No findings" means no KNOWN pattern matched — it is not a proof of safety.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_FILE_BYTES = 1_500_000;
const MAX_FILES = 30_000;
const SKIP_DIRS = new Set(['.git', '.hg', '.svn']);
// Installed dependencies are skipped unless --include-node-modules: scan the repo, not what npm already put there.
const DEP_DIRS = new Set(['node_modules']);
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

// File types whose CONTENT runs (or configures something that runs). Code rules apply to these.
const CODE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte',
  '.py', '.pyw', '.pth', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd', '.vbs',
  '.rb', '.gemspec', '.php', '.go', '.rs', '.java', '.kt', '.kts', '.gradle', '.groovy', '.scala',
  '.pl', '.pm', '.lua', '.cs', '.swift', '.c', '.cc', '.cpp', '.h', '.r',
  '.json', '.yml', '.yaml', '.toml', '.cfg', '.ini', '.gyp', '.gypi', '.cmake', '.mk', '.nix', '.html', '.htm',
]);
const CODE_NAMES = new Set(['Makefile', 'GNUmakefile', 'Dockerfile', 'Rakefile', 'Gemfile', 'Jenkinsfile',
  'Vagrantfile', 'Taskfile', 'justfile', '.envrc', '.npmrc', '.yarnrc', 'CMakeLists.txt']);
// Prose that an AI agent may read and obey. Only the prompt-injection and hidden-unicode rules apply.
const PROSE_EXT = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc', '']);

const BINARY_EXT = new Set(['.exe', '.dll', '.so', '.dylib', '.node', '.bin', '.o', '.a', '.jar', '.class',
  '.pyc', '.pyo', '.msi', '.scr', '.com', '.app', '.deb', '.rpm', '.apk', '.wasm']);
const ARCHIVE_EXT = new Set(['.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.whl', '.egg', '.nupkg']);

// One rule = one known-bad pattern. `scope`: 'code' (code/config files) or 'all' (prose too).
export const RULES = [
  { id: 'reverse-shell', severity: 'critical', category: 'backdoor', scope: 'code',
    re: /\/dev\/tcp\/[\w.$-]+\/\d|\bnc(at)?\s+(-\w+\s+)*-e\s+\/bin\/|\bbash\s+-i\s+>&|pty\.spawn\(\s*['"]\/bin\/(ba)?sh/,
    why: 'opens a reverse shell to a remote host' },
  { id: 'eval-decoded', severity: 'critical', category: 'obfuscated-exec', scope: 'code',
    re: /\b(eval|exec|Function|execSync|compile)\s*\(\s*(\w+\.)*(atob|Buffer\.from|b64decode|b32decode|a85decode|decompress|fromhex|unhexlify|codecs\.decode|bytes\.fromhex|unescape|decodeURIComponent)\s*\(/,
    why: 'decodes a hidden payload and executes it' },
  { id: 'powershell-download-exec', severity: 'critical', category: 'remote-exec', scope: 'code',
    re: /\b(iex|Invoke-Expression)\b[^\n]*(DownloadString|DownloadFile|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)|(DownloadString|iwr|irm)\b[^\n]*\|\s*iex\b|powershell[^\n]*-e(nc|ncodedcommand)?\s+[A-Za-z0-9+/=]{40,}/i,
    why: 'downloads and executes a PowerShell payload' },
  { id: 'crypto-miner', severity: 'critical', category: 'miner', scope: 'code',
    re: /stratum\+(tcp|ssl):\/\/|\bxmrig\b|\bcryptonight\b|coinhive|minexmr|nanopool\.org|supportxmr/i,
    why: 'cryptocurrency miner' },
  { id: 'destructive-command', severity: 'critical', category: 'destructive', scope: 'code',
    re: /\brm\s+-(rf|fr|r\s+-f)\s+(--no-preserve-root\s+)?(\/|~|\$HOME|\$\{HOME\})(\/?\*?)?(\s|['"`;]|$)|\bmkfs\.\w+\s+\/dev\/|\bdd\s+if=[^\n]*of=\/dev\/(sd|nvme|disk)|:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    why: 'wipes files or disks, or fork-bombs the machine' },
  { id: 'curl-pipe-shell', severity: 'high', category: 'remote-exec', scope: 'code',
    re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(-\w+\s+)*(ba|z|k|da)?sh\b|\b(ba)?sh\s+(-c\s+)?["']?\$\(\s*(curl|wget)\b|\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(python3?|node|perl|ruby)\b/,
    why: 'pipes a download straight into an interpreter: whatever the server sends runs' },
  { id: 'exfil-endpoint', severity: 'high', category: 'exfiltration', scope: 'code',
    re: /discord(app)?\.com\/api\/webhooks|api\.telegram\.org\/bot|hooks\.slack\.com\/services|pastebin\.com\/(api|raw)|transfer\.sh|\bngrok(-free)?\.(io|app|dev)|webhook\.site|requestbin|pipedream\.net|\binteract\.sh\b|oastify\.com|burpcollaborator|\.oast\.(fun|me|pro|site|live|online)|canarytokens/i,
    why: 'known data-drop endpoint (webhook, paste site, tunnel, OAST)' },
  { id: 'credential-access', severity: 'medium', category: 'credential-theft', scope: 'code',
    re: /\.ssh\/(id_[a-z0-9]+|authorized_keys|known_hosts)\b|\.aws\/credentials|\.config\/gcloud|\.azure\/|\.kube\/config|\.docker\/config\.json|\.git-credentials|\.pypirc|\.netrc\b|\.gnupg\b|\/etc\/shadow|Library\/Keychains|login\.keychain|Login Data|Local State|Cookies\.sqlite|key4\.db|logins\.json|wallet\.dat|\bExodus\b|\bElectrum\b|nkbihfbeogaeaoehlefnkodbefgpgknn|Local Storage\/leveldb|discord\/Local Storage/i,
    why: 'reads a credential, browser, wallet or token store' },
  { id: 'persistence', severity: 'high', category: 'persistence', scope: 'code',
    re: /\bcrontab\s+(-\w\s+)*-?[^\n]*(curl|wget|http|\/tmp\/)|Library\/LaunchAgents|Library\/LaunchDaemons|\/etc\/systemd\/system|systemctl\s+(--user\s+)?enable|CurrentVersion\\+Run\b|\bschtasks\s+\/create|(>>|appendFile\w*\(|open\([^)]*['"]a['"])[^\n]*\.(bashrc|zshrc|bash_profile|profile)\b/i,
    why: 'installs itself to run again later (cron, launchd, systemd, Run key, shell rc)' },
  { id: 'js-obfuscator', severity: 'high', category: 'obfuscation', scope: 'code',
    re: /\b_0x[0-9a-f]{4,6}\b[^\n]*\b_0x[0-9a-f]{4,6}\b|(\\x[0-9a-fA-F]{2}){30,}|String\.fromCharCode\(\s*(\d+\s*,\s*){20,}|(\\u00[0-9a-fA-F]{2}){30,}/,
    why: 'machine-obfuscated code: hides what it does from review' },
  { id: 'npmrc-token-read', severity: 'high', category: 'credential-theft', scope: 'code',
    re: /(readFileSync|readFile|open)\s*\([^)]*\.npmrc|_authToken[^\n]*(fetch|http|request|axios)|NPM_TOKEN[^\n]*(fetch|https?\.request|axios|curl)/,
    why: 'reads the npm publish token, the classic worm step' },
  { id: 'env-dump', severity: 'low', category: 'exfiltration', scope: 'code',
    re: /JSON\.stringify\(\s*process\.env\s*\)|Object\.(keys|entries|values)\(\s*process\.env\s*\)|\{\s*\.\.\.process\.env\s*\}[^\n]*(fetch|post|send|write)|dict\(\s*os\.environ\s*\)|os\.environ\.copy\(\)|json\.dumps\(\s*(dict\()?os\.environ|\benv\s*\|\s*(curl|nc|base64)/,
    why: 'collects every environment variable (where tokens live)' },
  { id: 'long-encoded-blob', severity: 'medium', category: 'obfuscation', scope: 'code',
    re: /["'`][A-Za-z0-9+/]{600,}={0,2}["'`]|["'`][0-9a-fA-F]{800,}["'`]/,
    why: 'large encoded blob embedded in code; decode it and look' },
  { id: 'raw-ip-url', severity: 'medium', category: 'network', scope: 'code',
    re: /\b(https?|wss?|tcp|ftp):\/\/(\d{1,3}(?:\.\d{1,3}){3})(:\d+)?/,
    check: (m) => !isPrivateIp(m[2]),
    why: 'talks to a hard-coded public IP instead of a hostname' },
  { id: 'tls-disabled', severity: 'medium', category: 'network', scope: 'code',
    re: /NODE_TLS_REJECT_UNAUTHORIZED['"]?\s*\]?\s*=\s*['"]?0|rejectUnauthorized\s*:\s*false|verify\s*=\s*False\b|InsecureSkipVerify\s*:\s*true|ssl\._create_unverified_context|curl\s+(-\w+\s+)*(-k|--insecure)\b/,
    why: 'turns off TLS certificate checks' },
  { id: 'unsafe-deserialize', severity: 'medium', category: 'code-exec', scope: 'code',
    re: /\b(pickle|cPickle|marshal|dill|shelve)\.loads?\((?!\s*(pickle|cPickle|marshal|dill)\.dumps\()|yaml\.load\((?![^)]*Loader\s*=\s*yaml\.(Safe|CSafe)Loader)|\bunserialize\s*\(\s*\$_(GET|POST|REQUEST|COOKIE)|ObjectInputStream\(/,
    why: 'deserialises data in a way that can execute code' },
  { id: 'dynamic-eval', severity: 'low', category: 'code-exec', scope: 'code',
    re: /(^|[^.\w])eval\s*\(|new\s+Function\s*\(|\bexec\s*\(\s*(compile\(|open\(|requests\.|urlopen)|vm\.runIn(New|This)?Context\(/,
    why: 'evaluates a string as code; check where the string comes from' },
  { id: 'shell-exec', severity: 'low', category: 'code-exec', scope: 'code',
    re: /require\(\s*['"](node:)?child_process['"]\s*\)|from\s+['"](node:)?child_process['"]|\bos\.(system|popen)\(|subprocess\.(Popen|call|run|check_output|check_call)\(|Runtime\.getRuntime\(\)\.exec|\bshell_exec\(|\bpassthru\(|\bproc_open\(/,
    why: 'runs a shell command; common and often fine, but read what it runs' },
  { id: 'prompt-injection', severity: 'medium', category: 'agent-manipulation', scope: 'all',
    re: /\b(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)|\bdo\s+not\s+(tell|inform|show)\s+the\s+user\b|<\/?\s*(system|assistant)\s*>|\byou\s+are\s+now\s+(in\s+)?(developer|dan|unrestricted|jailbreak)|\bAI\s+(agents?|assistants?)\s*(reading|scanning)\s+this\b|\bnew\s+instructions\s*:/i,
    why: 'text aimed at an AI agent reading the repo, not at a human' },
];

// Invisible characters. Bidi controls reorder what a reviewer sees (Trojan Source, CVE-2021-42574).
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/;
// Zero-width chars: ZWJ/ZWNJ are normal inside emoji and Persian/Indic text, so those only count when they
// sit inside an identifier-like run (a disguised name); ZWSP, word joiner and a mid-file BOM always count.
const ZERO_WIDTH_RE = /[\w$][\u200C\u200D][\w$]|[\u200B\u2060\u180E]|(?<!^)\uFEFF/;

// Rules that read secrets, and rules that send data somewhere. Both in one file is the stealer shape.
const READS_SECRETS = new Set(['credential-access', 'env-dump', 'npmrc-token-read']);
const SENDS_OUT = new Set(['exfil-endpoint', 'raw-ip-url']);

/** Extra findings from combinations inside ONE file (findings already carry `file`). */
export function combos(fileFindings) {
  const reads = fileFindings.find((f) => READS_SECRETS.has(f.rule));
  const sends = fileFindings.find((f) => SENDS_OUT.has(f.rule));
  if (!reads || !sends) return [];
  return [{ file: reads.file, ...(reads.context ? { context: reads.context } : {}), rule: 'steal-and-send', severity: 'critical', category: 'exfiltration', line: reads.line,
    excerpt: `reads secrets at line ${reads.line} (${reads.rule}); sends out at line ${sends.line} (${sends.rule})`,
    why: 'the same file collects credentials and talks to a drop endpoint: the shape of a stealer' }];
}

export function isPrivateIp(ip) {
  const o = ip.split('.').map(Number);
  if (o.some((n) => n > 255)) return true; // not an IP (version string etc.)
  return o[0] === 10 || o[0] === 127 || o[0] === 0 || (o[0] === 169 && o[1] === 254) ||
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) || o[0] >= 224;
}

/** Apply the line rules to one file's text. Returns findings without the file name. */
export function scanText(text, { kind = 'code' } = {}) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BIDI_RE.test(line)) out.push(hit('bidi-control', 'high', 'hidden-code', i, line,
      'invisible bidi control character: the code that runs differs from what you see'));
    if (ZERO_WIDTH_RE.test(i === 0 ? line.replace(/^\uFEFF/, '') : line)) out.push(hit('zero-width-char', 'medium', 'hidden-code', i, line,
      'zero-width character: can hide or disguise an identifier'));
    if (line.length > 20_000) continue; // minified bundle line: regexes below would only produce noise
    for (const r of RULES) {
      if (r.scope === 'code' && kind !== 'code') continue;
      const m = line.match(r.re);
      if (m && (!r.check || r.check(m))) out.push(hit(r.id, r.severity, r.category, i, line, r.why));
    }
  }
  return out;
}

function hit(rule, severity, category, i, line, why) {
  const t = line.trim();
  const excerpt = (t.length > 180 ? t.slice(0, 180) + '…' : t).replace(/[\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF]/g, (c) => `<U+${c.charCodeAt(0).toString(16).toUpperCase()}>`);
  return { rule, severity, category, line: i + 1, excerpt, why };
}

// npm lifecycle scripts that run on `npm install` (of the package itself, or as a dependency / git dep).
// pre/install/post run whenever the package is installed, as anyone's dependency. prepare/prepublish run
// only when THIS folder is installed locally (npm install inside the clone) or pulled as a git dependency.
export const NPM_INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'];
export const NPM_LOCAL_HOOKS = ['prepare', 'preprepare', 'postprepare', 'prepublish'];
const SAFE_BUILD_BACKENDS = new Set(['setuptools.build_meta', 'setuptools.build_meta:__legacy__', 'hatchling.build', 'poetry.core.masonry.api',
  'poetry.masonry.api', 'flit_core.buildapi', 'pdm.backend', 'pdm.pep517.api', 'maturin', 'scikit_build_core.build', 'mesonpy', 'sipbuild.api', 'uv_build']);

/** Look at one manifest/config file for things that execute on install, on open, or on cd. */
export function installHooksFor(rel, text) {
  const base = path.basename(rel);
  const hooks = [];
  const add = (severity, what, detail) => hooks.push({ file: rel, severity, what, detail: String(detail).slice(0, 300) });
  try {
    if (base === 'package.json') {
      const pkg = JSON.parse(text);
      for (const h of [...NPM_INSTALL_HOOKS, ...NPM_LOCAL_HOOKS]) {
        const cmd = pkg.scripts?.[h];
        if (!cmd) continue;
        const local = NPM_LOCAL_HOOKS.includes(h);
        const risky = scanText(cmd).some((f) => f.severity === 'critical' || f.severity === 'high');
        const benign = /^(husky( install)?|npm run build|tsc( -[\w-]+)*|node-gyp rebuild|ngcc|patch-package|is-ci \|\| husky( install)?|not-in-publish \|\| npm run prepublishOnly)$/.test(cmd.trim());
        const severity = risky ? 'critical' : benign ? 'low' : local ? 'medium' : 'high';
        add(severity, local ? `npm "${h}" runs on a local or git install of this folder` : `npm "${h}" runs on every install`, cmd);
      }
      const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin || {};
      for (const name of Object.keys(bins)) {
        if (/^(node|npm|npx|git|ls|sh|bash|sudo|python3?|pip3?|curl|ssh|cd|cp|mv|rm)$/.test(name)) add('high', `"bin" shadows the system command "${name}"`, bins[name]);
      }
    } else if (base === 'composer.json') {
      const scripts = JSON.parse(text).scripts || {};
      for (const k of Object.keys(scripts)) if (/^(pre|post)-(install|update|autoload-dump|package-install)/.test(k)) add('high', `composer "${k}" runs on install`, JSON.stringify(scripts[k]));
    } else if (base === 'setup.py') {
      add('medium', 'setup.py is executed by pip when installing from source (sdist / git)', 'review every top-level statement');
      if (/cmdclass\s*=/.test(text)) add('high', 'setup.py overrides install/build commands (cmdclass)', (text.match(/cmdclass\s*=[^\n]*/) || [''])[0]);
    } else if (base === 'pyproject.toml') {
      const backend = text.match(/build-backend\s*=\s*["']([^"']+)["']/)?.[1];
      if (/backend-path\s*=/.test(text)) add('high', 'in-tree build backend (backend-path): repo code runs at build/install', backend || '');
      else if (backend && !SAFE_BUILD_BACKENDS.has(backend)) add('medium', 'unfamiliar build backend runs at install', backend);
    } else if (base === 'build.rs') {
      add('medium', 'Cargo build script runs at build time', 'review it');
    } else if (base === 'binding.gyp') {
      add('low', 'native addon compiled on install (node-gyp)', 'review actions/commands inside');
      if (/<!\(|<!@\(/.test(text)) add('high', 'binding.gyp runs shell commands while configuring', (text.match(/<!@?\([^)]*\)/) || [''])[0]);
    } else if (base === '.npmrc' || base === '.yarnrc' || base === '.yarnrc.yml' || base === 'pip.conf' || base === '.pypirc') {
      const reg = text.match(/^\s*(registry|@[\w-]+:registry|index-url|extra-index-url|npmRegistryServer)\s*[=:]\s*["']?(\S+?)["']?\s*$/m);
      if (reg && !/registry\.npmjs\.org|registry\.yarnpkg\.com|pypi\.org/.test(reg[2])) add('medium', 'package registry overridden', reg[2]);
      const yp = text.match(/^\s*(yarn-path|yarnPath)\s*[=:]\s*["']?(\S+?)["']?\s*$/m);
      if (yp) add('high', 'yarnPath: running any yarn command in this repo executes this file', yp[2]);
      if (/ignore-scripts\s*=\s*false/.test(text)) add('low', 'forces lifecycle scripts on', 'ignore-scripts=false');
    } else if (rel.replace(/\\/g, '/').endsWith('.vscode/tasks.json')) {
      if (/"runOn"\s*:\s*"folderOpen"/.test(text)) add('high', 'VS Code task runs automatically when the folder is opened', 'runOn: folderOpen');
    } else if (/(^|\/)\.devcontainer(\/|\.json)/.test(rel) || base === 'devcontainer.json') {
      const m = text.match(/"(initializeCommand|onCreateCommand|postCreateCommand|postStartCommand|postAttachCommand|updateContentCommand)"\s*:\s*([^\n]+)/);
      if (m) add(m[1] === 'initializeCommand' ? 'high' : 'medium', `devcontainer ${m[1]} runs ${m[1] === 'initializeCommand' ? 'on the HOST' : 'in the container'}`, m[2]);
    } else if (base === '.envrc') {
      add('medium', 'direnv executes .envrc on cd once allowed', text.split('\n').slice(0, 3).join(' ; '));
    } else if (/(^|\/)\.claude\/settings(\.local)?\.json$/.test(rel)) {
      if (/"hooks"\s*:/.test(text)) add('high', 'Claude Code hooks: commands run automatically during an agent session', 'hooks');
    } else if (base === '.mcp.json' || /(^|\/)\.(cursor|vscode)\/mcp\.json$/.test(rel)) {
      add('high', 'MCP server config: an agent opening this folder may launch these commands', (text.match(/"command"\s*:\s*"[^"]*"[^\n]*/) || [''])[0]);
    } else if (base === '.gitattributes') {
      if (/\bfilter=/.test(text)) add('low', 'git filter attribute (only runs if a matching filter is configured locally)', (text.match(/[^\n]*filter=[^\n]*/) || [''])[0]);
    } else if (base === '.gitmodules') {
      for (const u of text.matchAll(/url\s*=\s*(\S+)/g)) add('low', 'submodule (not scanned unless fetched)', u[1]);
    } else if (base.endsWith('.gemspec')) {
      if (/\.extensions\s*=/.test(text)) add('medium', 'gem compiles a native extension on install (extconf.rb runs)', (text.match(/[^\n]*\.extensions\s*=[^\n]*/) || [''])[0]);
    } else if (/(^|\/)\.husky\//.test(rel) || /(^|\/)\.githooks\//.test(rel)) {
      add('low', 'git hook script (runs on commit/push once installed)', rel);
    } else if (/\.pth$/.test(base)) {
      if (/^\s*import\s/m.test(text)) add('high', '.pth file with import: runs on EVERY Python start once installed', (text.match(/^\s*import[^\n]*/m) || [''])[0]);
    }
  } catch (e) {
    add('low', 'could not parse manifest', e.message);
  }
  return hooks;
}

// ---- dependencies ---------------------------------------------------------------------------------------

export const POPULAR_NPM = ['react', 'react-dom', 'express', 'lodash', 'axios', 'chalk', 'commander', 'debug', 'moment',
  'request', 'vue', 'next', 'webpack', 'typescript', 'eslint', 'prettier', 'jest', 'mocha', 'dotenv', 'uuid', 'yargs',
  'colors', 'async', 'bluebird', 'underscore', 'jquery', 'cross-env', 'nodemon', 'mongoose', 'mongodb', 'redis', 'pg',
  'mysql', 'mysql2', 'sequelize', 'prisma', 'socket.io', 'body-parser', 'cookie-parser', 'cors', 'helmet', 'jsonwebtoken',
  'bcrypt', 'bcryptjs', 'passport', 'multer', 'sharp', 'zod', 'vite', 'rollup', 'esbuild', 'babel-core', 'tailwindcss',
  'electron', 'puppeteer', 'playwright', 'node-fetch', 'ethers', 'web3', 'discord.js', 'openai', 'inquirer', 'semver',
  'glob', 'rimraf', 'mkdirp', 'fs-extra', 'minimist', 'ws', 'cheerio', 'nanoid', 'dayjs', 'date-fns', 'svelte', 'angular'];
export const POPULAR_PYPI = ['requests', 'numpy', 'pandas', 'django', 'flask', 'fastapi', 'urllib3', 'setuptools',
  'boto3', 'botocore', 'pyyaml', 'cryptography', 'pillow', 'matplotlib', 'scipy', 'scikit-learn', 'tensorflow', 'torch',
  'beautifulsoup4', 'selenium', 'pytest', 'sqlalchemy', 'psycopg2', 'pymongo', 'redis', 'celery', 'jinja2', 'click',
  'httpx', 'aiohttp', 'pydantic', 'openai', 'anthropic', 'colorama', 'python-dateutil', 'certifi', 'idna', 'six',
  'web3', 'paramiko', 'pycryptodome', 'opencv-python', 'transformers', 'langchain', 'uvicorn', 'gunicorn', 'tqdm', 'rich'];

export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The popular package `name` looks like a misspelling of, or null. */
export function typosquatOf(name, ecosystem = 'npm') {
  const n = String(name).toLowerCase();
  const list = ecosystem === 'PyPI' ? POPULAR_PYPI : POPULAR_NPM;
  if (list.includes(n) || n.length < 4) return null;
  const norm = (s) => s.replace(/[-_.]/g, '');
  for (const p of list) {
    if (p.length < 4) continue;
    if (editDistance(n, p) === 1 || (norm(n) === norm(p) && n !== p && ecosystem === 'npm')) return p;
  }
  return null;
}

/** Classify an npm dependency spec: where would install fetch it from? */
export function npmSpecSource(spec) {
  const s = String(spec).trim();
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(s) || /^[\w.-]+\/[\w.-]+(#.*)?$/.test(s)) return 'git';
  if (/^https?:/.test(s)) return 'url';
  if (/^(file:|link:|\.\.?\/)/.test(s)) return 'local';
  if (/^npm:/.test(s)) return 'alias';
  return 'registry';
}

function collectDeps(root, rels) {
  const deps = [];
  const pinned = []; // { ecosystem, name, version } for OSV
  for (const rel of rels) {
    const base = path.basename(rel);
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    try {
      if (base === 'package.json') {
        const pkg = JSON.parse(text);
        for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
          for (const [name, spec] of Object.entries(pkg[field] || {})) {
            const d = { file: rel, ecosystem: 'npm', name, spec, field, source: npmSpecSource(spec) };
            const alias = d.source === 'alias' ? String(spec).slice(4).replace(/@[^@]*$/, '') : null;
            d.typosquatOf = typosquatOf(alias || name, 'npm');
            deps.push(d);
          }
        }
      } else if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') {
        const lock = JSON.parse(text);
        for (const [key, v] of Object.entries(lock.packages || {})) {
          if (!key) continue;
          const name = v.name || key.replace(/^.*node_modules\//, '');
          if (v.version) pinned.push({ ecosystem: 'npm', name, version: v.version });
          if (v.resolved && !/^https:\/\/registry\.(npmjs\.org|yarnpkg\.com)\//.test(v.resolved)) {
            deps.push({ file: rel, ecosystem: 'npm', name, spec: v.resolved, field: 'lockfile', source: 'non-registry-resolved', typosquatOf: null });
          }
          if (v.hasInstallScript) deps.push({ file: rel, ecosystem: 'npm', name, spec: v.version, field: 'lockfile', source: 'registry', hasInstallScript: true, typosquatOf: null });
        }
      } else if (/^requirements.*\.txt$/.test(base)) {
        for (const raw of text.split('\n')) {
          const line = raw.replace(/#.*/, '').trim();
          if (!line || line.startsWith('-r') || line.startsWith('-c')) {
            continue;
          }
          if (/^(-e\s+)?(git\+|https?:|svn\+|hg\+)/.test(line) || /@\s*(git\+|https?:)/.test(line)) {
            deps.push({ file: rel, ecosystem: 'PyPI', name: line.split(/[@\s]/)[0], spec: line, source: 'url', typosquatOf: null });
            continue;
          }
          if (/^--?(index-url|extra-index-url|i)\b/.test(line)) {
            deps.push({ file: rel, ecosystem: 'PyPI', name: '(index)', spec: line, source: 'index-override', typosquatOf: null });
            continue;
          }
          const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(==|>=|~=|<=|!=|>|<)?\s*([^;\s,]*)/);
          if (!m) continue;
          deps.push({ file: rel, ecosystem: 'PyPI', name: m[1], spec: (m[3] || '') + (m[4] || ''), source: 'registry', typosquatOf: typosquatOf(m[1], 'PyPI') });
          if (m[3] === '==' && m[4]) pinned.push({ ecosystem: 'PyPI', name: m[1], version: m[4] });
        }
      } else if (base === 'pyproject.toml') {
        const block = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1] || '';
        for (const q of block.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)([^"']*)["']/g)) {
          deps.push({ file: rel, ecosystem: 'PyPI', name: q[1], spec: q[2].trim(), source: /@\s*(git\+|https?:)/.test(q[2]) ? 'url' : 'registry', typosquatOf: typosquatOf(q[1], 'PyPI') });
          const pin = q[2].match(/^\s*(\[[^\]]*\])?\s*==\s*([^;\s,]+)/);
          if (pin) pinned.push({ ecosystem: 'PyPI', name: q[1], version: pin[2] });
        }
      }
    } catch (e) {
      deps.push({ file: rel, error: e.message });
    }
  }
  const seen = new Set();
  const uniquePinned = pinned.filter((p) => { const k = `${p.ecosystem}:${p.name}@${p.version}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { deps, pinned: uniquePinned };
}

async function queryOsv(pinned) {
  if (!pinned.length) return { queried: 0, vulnerable: [] };
  const vulnerable = [];
  for (let i = 0; i < pinned.length; i += 900) {
    const chunk = pinned.slice(i, i + 900);
    const res = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`osv.dev HTTP ${res.status}`);
    const body = await res.json();
    body.results.forEach((r, j) => {
      const ids = (r.vulns || []).map((v) => v.id);
      if (ids.length) vulnerable.push({ ...chunk[j], ids, malicious: ids.some((id) => id.startsWith('MAL-')) });
    });
  }
  // The batch answer is ids only. Older malware is filed as a plain GHSA ("Malicious code in X"), so read
  // the summaries (bounded) to catch it and to give the report a one-line reason per advisory.
  const ids = [...new Set(vulnerable.flatMap((v) => v.ids))].slice(0, 60);
  const details = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const r = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) { const v = await r.json(); details[id] = v.summary || (v.details || '').slice(0, 160); }
    } catch {}
  }));
  for (const v of vulnerable) {
    v.advisories = v.ids.map((id) => ({ id, summary: details[id] ?? null }));
    if (v.advisories.some((a) => isMalwareAdvisory(a.id, a.summary))) v.malicious = true;
  }
  return { queried: pinned.length, vulnerable, detailsFetched: Object.keys(details).length, detailsWanted: ids.length };
}

/** An OSV advisory that reports malware rather than a bug. */
export function isMalwareAdvisory(id, summary) {
  return String(id).startsWith('MAL-') || /\b(malicious|malware|backdoor|typosquat|compromised|embedded (malicious|harmful) code)\b/i.test(summary || '');
}

// ---- walking the tree -----------------------------------------------------------------------------------

/** Binary type from the first bytes, or null. */
export function sniffBinary(buf) {
  if (buf.length < 4) return null;
  const h = buf.subarray(0, 4).toString('hex');
  if (h === '7f454c46') return 'ELF executable';
  if (['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe'].includes(h)) return 'Mach-O executable';
  if (h === 'cafebabe') return 'Mach-O universal / Java class';
  if (buf[0] === 0x4d && buf[1] === 0x5a) return 'Windows PE executable';
  if (h === '0061736d') return 'WebAssembly';
  return null;
}

function walk(root, { includeDeps = false } = {}) {
  const files = [];
  const skipped = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (e) { skipped.push({ path: rel, reason: e.code || e.message }); continue; }
    for (const e of entries) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isSymbolicLink()) {
        let target = '';
        try { target = fs.readlinkSync(path.join(root, r)); } catch {}
        const resolved = path.resolve(path.join(root, rel), target);
        files.push({ rel: r, symlink: target, escapes: !resolved.startsWith(path.resolve(root) + path.sep) });
      } else if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (!includeDeps && DEP_DIRS.has(e.name)) { skipped.push({ path: r, reason: 'installed dependencies (use --include-node-modules to scan)' }); continue; }
        stack.push(r);
      } else if (e.isFile()) {
        if (files.length >= MAX_FILES) { skipped.push({ path: r, reason: 'file limit reached' }); continue; }
        files.push({ rel: r });
      }
    }
  }
  return { files, skipped };
}

function kindOf(rel) {
  const base = path.basename(rel);
  const ext = path.extname(base).toLowerCase();
  if (CODE_NAMES.has(base) || CODE_EXT.has(ext)) return 'code';
  if (PROSE_EXT.has(ext)) return 'prose';
  return 'other';
}

// Tests, fixtures and examples don't run on install, and security code legitimately quotes bad patterns
// there. Findings in them are still listed (context: 'test'), but only a critical one moves the verdict.
const TEST_PATH_RE = /(^|[\\/])(tests?|__tests__|spec|specs|fixtures?|examples?|testdata|__mocks__)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$|(^|[\\/])test_[^\\/]*\.py$|_test\.(py|go)$/i;
export const isTestPath = (rel) => TEST_PATH_RE.test(rel);

/** Overall verdict from findings + hooks. Never "safe": the best is "no known red flags". */
export function verdictOf(items) {
  const counted = items.filter((x) => x.context !== 'test' || x.severity === 'critical');
  const has = (s) => counted.some((x) => x.severity === s);
  if (has('critical')) return 'DO-NOT-INSTALL';
  if (has('high')) return 'REVIEW-BEFORE-INSTALL';
  if (has('medium')) return 'CAUTION';
  return 'NO-KNOWN-RED-FLAGS';
}

export async function scan(target, { offline = false, maxFindings = 300, includeDeps = false } = {}) {
  const root = path.resolve(target);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`not a directory: ${target}`);
  const { files, skipped } = walk(root, { includeDeps });
  const findings = [];
  const installHooks = [];
  const binaries = [];
  const manifestRels = [];
  const perRule = {};
  let scannedFiles = 0;

  for (const f of files) {
    if (f.symlink !== undefined) {
      if (f.escapes) installHooks.push({ file: f.rel, severity: 'high', what: 'symlink points outside the repo', detail: f.symlink });
      continue;
    }
    const abs = path.join(root, f.rel);
    const base = path.basename(f.rel);
    const ext = path.extname(base).toLowerCase();
    if (/^(package\.json|package-lock\.json|npm-shrinkwrap\.json|pyproject\.toml)$|^requirements.*\.txt$/.test(base) && !f.rel.split(path.sep).includes('node_modules')) manifestRels.push(f.rel);
    let size;
    try { size = fs.statSync(abs).size; } catch (e) { skipped.push({ path: f.rel, reason: e.code }); continue; }
    let head;
    try {
      const fd = fs.openSync(abs, 'r');
      head = Buffer.alloc(Math.min(size, 8192));
      fs.readSync(fd, head, 0, head.length, 0);
      fs.closeSync(fd);
    } catch (e) { skipped.push({ path: f.rel, reason: e.code }); continue; }
    const magic = sniffBinary(head);
    if (magic || BINARY_EXT.has(ext)) {
      binaries.push({ file: f.rel, type: magic || ext, bytes: size, severity: magic && /executable|Mach-O/.test(magic) ? 'high' : 'medium' });
      continue;
    }
    if (ARCHIVE_EXT.has(ext)) { binaries.push({ file: f.rel, type: 'archive ' + ext, bytes: size, severity: 'low' }); continue; }
    if (head.includes(0)) continue; // other binary data (images, fonts)
    if (size > MAX_FILE_BYTES) { skipped.push({ path: f.rel, reason: `larger than ${MAX_FILE_BYTES} bytes, not scanned` }); continue; }
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { skipped.push({ path: f.rel, reason: e.code }); continue; }
    scannedFiles++;
    let kind = kindOf(f.rel);
    if (kind !== 'code' && /^#!/.test(text)) kind = 'code';
    if (kind === 'other') kind = 'prose'; // unknown text: still check for hidden chars and agent-aimed text
    for (const h of installHooksFor(f.rel, text)) installHooks.push(h);
    const fileHits = scanText(text, { kind }).map((hit) => ({ file: f.rel, ...hit, ...(isTestPath(f.rel) ? { context: 'test' } : {}) }));
    for (const hit of [...fileHits, ...combos(fileHits)]) {
      perRule[hit.rule] = (perRule[hit.rule] || 0) + 1;
      findings.push(hit);
    }
  }

  const rank = (s) => SEVERITIES.indexOf(s);
  findings.sort((a, b) => rank(a.severity) - rank(b.severity) || a.file.localeCompare(b.file) || a.line - b.line);
  installHooks.sort((a, b) => rank(a.severity) - rank(b.severity));

  const { deps, pinned } = collectDeps(root, manifestRels);
  const depFlags = deps.filter((d) => d.error || d.typosquatOf || d.hasInstallScript || !['registry', 'alias'].includes(d.source));
  const depItems = depFlags.map((d) => ({ severity: d.typosquatOf ? 'high' : d.error ? 'low' : 'medium' }));

  let osv;
  if (offline) osv = { skipped: 'offline' };
  else {
    try { osv = await queryOsv(pinned); } catch (e) { osv = { error: e.message, wouldQuery: pinned.length }; }
  }
  const osvItems = (osv.vulnerable || []).map((v) => ({ severity: v.malicious ? 'critical' : 'medium' }));

  const all = [...findings, ...installHooks, ...binaries, ...depItems, ...osvItems];
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, all.filter((x) => x.severity === s).length]));
  return {
    target: root,
    scannedAt: new Date().toISOString(),
    verdict: verdictOf(all),
    counts,
    files: { total: files.length, textScanned: scannedFiles },
    installHooks,
    findings: findings.slice(0, maxFindings),
    findingsTruncated: findings.length > maxFindings ? findings.length - maxFindings : 0,
    findingsPerRule: perRule,
    binaries,
    dependencies: { total: deps.length, flagged: depFlags, pinnedForOsv: pinned.length },
    osv,
    skipped: skipped.slice(0, 50),
    note: 'Static pattern scan: nothing was executed. NO-KNOWN-RED-FLAGS is not proof of safety.',
  };
}

function parseArgs(argv) {
  const opts = { offline: false, maxFindings: 300 };
  let target;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') opts.offline = true;
    else if (a === '--max-findings') opts.maxFindings = Number(argv[++i]) || 300;
    else if (a === '--include-node-modules') opts.includeDeps = true;
    else if (!target) target = a;
  }
  return { target, opts };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { target, opts } = parseArgs(process.argv.slice(2));
  if (!target) {
    console.error('usage: node scan.mjs <dir> [--offline] [--include-node-modules] [--max-findings N]');
    process.exit(2);
  }
  scan(target, opts)
    .then((r) => { console.log(JSON.stringify(r, null, 2)); })
    .catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });
}
