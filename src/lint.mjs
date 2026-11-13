// A syntax check right after a file is written or edited, so a broken edit is
// reported with the tool result instead of being found three steps later.
// Only checks that need nothing installed beyond the language itself.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 2000;
const MAX_BYTES = 2_000_000;

// The program reads the file but writes nothing next to it (no __pycache__, no build output), and it is
// never started inside the project: a checker must not pick up code or settings from the folder it checks.
const CHECKERS = {
  '.js': (file) => [process.execPath, ['--check', file]],
  '.mjs': (file) => [process.execPath, ['--check', file]],
  '.cjs': (file) => [process.execPath, ['--check', file]],
  // -I: isolated mode, so a module named like a standard one in the project cannot be imported instead of it.
  '.py': (file) => ['python3', ['-I', '-c', 'import ast,sys\nast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])', file]],
  '.sh': (file) => ['bash', ['-n', file]],
  '.bash': (file) => ['bash', ['-n', file]],
  '.rb': (file) => ['ruby', ['-c', file]],
  '.php': (file) => ['php', ['-l', file]],
};

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const collect = (d) => (out.length < MAX_OUTPUT * 2 ? (out += d) : null);
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    // A language that is not installed is not an error in the file.
    child.on('error', () => (clearTimeout(timer), resolve(null)));
    child.on('close', (code, signal) => (clearTimeout(timer), resolve(signal ? null : { code, out: out.trim() })));
  });
}

/**
 * Checks the syntax of a file that was just written.
 * @returns {Promise<string>} text to append to the tool result — '' when the file is fine or cannot be checked
 */
export async function syntaxCheck(file) {
  const ext = path.extname(file).toLowerCase();
  let problem = null;
  try {
    if (fs.statSync(file).size > MAX_BYTES) return '';
    if (ext === '.json') {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        problem = err.message;
      }
    } else if (CHECKERS[ext]) {
      const [cmd, args] = CHECKERS[ext](file);
      const result = await run(cmd, args, os.tmpdir());
      if (result && result.code !== 0) problem = result.out || `exit code ${result.code}`;
    }
  } catch {
    return '';
  }
  if (!problem) return '';
  const text = problem.length > MAX_OUTPUT ? `${problem.slice(0, MAX_OUTPUT)}…` : problem;
  return `\n\n[Syntax check FAILED for ${path.basename(file)} — the file was saved, but it does not parse. Fix it before going on:]\n${text}`;
}
