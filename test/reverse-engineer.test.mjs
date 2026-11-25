// The bundled reverse-engineer skill: its surface.mjs maps a built frontend by reading files only, and
// recovers sources from source maps without ever writing outside the chosen folder. Fixtures live in temp.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSkills } from '../src/skills.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(REPO, 'skills', 'reverse-engineer', 'scripts', 'surface.mjs');
const s = await import(SCRIPT);

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-re-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test('reverse-engineer: the skill ships with SEEKER, names its script and both modes', () => {
  const skill = loadSkills(os.tmpdir(), []).find((x) => x.name === 'reverse-engineer');
  assert.equal(skill?.source, 'bundled');
  assert.ok(fs.existsSync(path.join(skill.dir, 'scripts', 'surface.mjs')));
  assert.match(skill.body, /surface\.mjs/);
  assert.match(skill.body, /Mode A/);
  assert.match(skill.body, /Mode B/);
  assert.match(skill.body, /Step 0/);
  assert.ok(skill.description.length <= 300, `description is ${skill.description.length} chars`);
});

test('reverse-engineer: routes, endpoints, graphql, env, storage, sockets and services are found', () => {
  const js = [
    'const routes=[{path:"/dashboard",element:x},{path:"/orders/:id"}];',
    'fetch("/api/orders",{method:"POST",body:b});',
    'fetch("/api/me");',
    'axios.delete("/api/orders/1");',
    'const u="https://api.example.test/v1/items";',
    'const q=gql`query ListOrders { orders { id } }`;',
    'const k=import.meta.env.VITE_SUPABASE_URL; const p=process.env.NEXT_PUBLIC_SITE;',
    'localStorage.setItem("cart", "[]");',
    'new WebSocket("wss://rt.example.test/socket");',
    'const sb="https://abcd.supabase.co"; loadStripe("pk"); src="https://js.stripe.com/v3";',
  ].join('\n');
  const out = s.surfaceOf(js);
  assert.deepEqual(out.routes.map((r) => r.path), ['/dashboard', '/orders/:id']);
  const calls = out.endpoints.map((e) => `${e.method} ${e.url}`);
  assert.ok(calls.includes('POST /api/orders'), calls.join(', '));
  assert.ok(calls.includes('GET? /api/me'));
  assert.ok(calls.includes('DELETE /api/orders/1'));
  assert.ok(calls.includes('? https://api.example.test/v1/items'));
  assert.deepEqual(out.graphql.map((g) => `${g.kind} ${g.name}`), ['query ListOrders']);
  assert.deepEqual(out.env.sort(), ['NEXT_PUBLIC_SITE', 'VITE_SUPABASE_URL']);
  assert.deepEqual(out.storage, [{ store: 'localStorage', key: 'cart' }]);
  assert.deepEqual(out.sockets, ['wss://rt.example.test/socket']);
  assert.deepEqual(out.services.sort(), ['stripe', 'supabase']);
});

test('reverse-engineer: secrets are reported masked, never in full', () => {
  const key = `sk_live_${'A1b2C3d4'.repeat(4)}`;
  const out = s.surfaceOf(`const k="${key}";`);
  assert.equal(out.secrets.length, 1);
  assert.equal(out.secrets[0].kind, 'stripe-secret');
  assert.ok(!out.secrets[0].value.includes(key), 'the full key must not be printed');
  assert.match(out.secrets[0].value, /^sk_liv…/);
  const ant = s.surfaceOf(`x="sk-ant-${'z'.repeat(40)}"`).secrets.map((x) => x.kind);
  assert.deepEqual(ant, ['anthropic-key'], 'an Anthropic key is not also counted as an OpenAI key');
});

test('reverse-engineer: recovered source paths never leave the output folder', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-re-out-'));
  const inside = (p) => p === null || p.startsWith(out + path.sep);
  for (const name of ['webpack:///src/App.tsx', '../../../etc/passwd', '/etc/passwd', 'C:\\Windows\\x.js', 'webpack:///../../.ssh/id_rsa', 'src/../../x.js', '~/x.js']) {
    assert.ok(inside(s.recoverPath(out, name)), `${name} → ${s.recoverPath(out, name)}`);
  }
  assert.equal(s.recoverPath(out, 'webpack:///src/App.tsx'), path.join(out, 'src', 'App.tsx'));
  assert.equal(s.recoverPath(out, '../..'), null);

  const r = s.recoverMap({ sources: ['webpack:///src/App.tsx', '../../escape.js', 'webpack:///node_modules/react/index.js', 'src/nothing.js'], sourcesContent: ['export const App = 1;', 'evil', 'lib', null] }, out);
  assert.equal(r.written, 2);
  assert.equal(r.skipped, 2);
  assert.equal(fs.readFileSync(path.join(out, 'src', 'App.tsx'), 'utf8'), 'export const App = 1;');
  assert.ok(fs.existsSync(path.join(out, 'escape.js')), 'a ../ source is written inside, not above');
  assert.ok(!fs.existsSync(path.join(path.dirname(path.dirname(out)), 'escape.js')));
});

test('reverse-engineer: the CLI maps a bundle, reports maps and recovers sources outside it', () => {
  const dir = fixture({
    'index.html': '<script src="/assets/main.js"></script>',
    'assets/main.js': 'fetch("/api/products");\n//# sourceMappingURL=main.js.map',
    'assets/main.js.map': JSON.stringify({ version: 3, sources: ['webpack:///src/api.ts'], sourcesContent: ['export const list = () => fetch("/api/products");'] }),
    'assets/other.js': 'x\n//# sourceMappingURL=other.js.map',
  });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seeker-re-rec-')), 'src');
  const res = JSON.parse(execFileSync(process.execPath, [SCRIPT, dir, '--recover', out], { encoding: 'utf8' }));
  assert.equal(res.counts.endpoints, 1, 'the map\'s embedded copy does not double the hit');
  assert.equal(res.sourceMaps.files, 1);
  assert.equal(res.sourceMaps.withSources, 1);
  assert.deepEqual(res.sourceMaps.referencedButMissing, [{ from: path.join('assets', 'other.js'), map: 'other.js.map' }]);
  assert.equal(res.sourceMaps.recovered.written, 1);
  assert.ok(fs.existsSync(path.join(out, 'src', 'api.ts')));

  assert.throws(() => s.surface(dir, { recover: path.join(dir, 'out') }), /outside the folder/);
  assert.throws(() => s.surface(dir, { recover: dir }), /outside the folder/);
});
