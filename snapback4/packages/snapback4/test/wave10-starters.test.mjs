import { stopChild, startDev, startServe } from "../dist/proof.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import vm from 'node:vm';
import { settleMutation } from '../dist/write-settlement.js';
import { sentResult, matchRead, otherwiseAll } from '../dist/contract.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bin = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const invoke = (args, cwd, env = {}) => spawnSync(bin, args, { cwd, encoding: 'utf8', env: { ...process.env, SNAPBACK4_BIN: bin, PORT_LO: undefined, PORT_HI: undefined, ...env }, timeout: 120000 });
const success = result => assert.equal(result.status, 0, result.stdout + result.stderr);
const project = (t, name = 'dx10-') => { const dir = mkdtempSync(join(root, 'target', name)); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

for (const mode of ['env', 'flag']) test(`portable ${mode} range sets URLs, Vite ports, launchers and proofs`, t => {
  const dir = project(t);
  success(invoke(['init', '--web', ...(mode === 'flag' ? ['--port-range', '30100-30109'] : [])], dir, mode === 'env' ? { PORT_LO: '30100', PORT_HI: '30109' } : { PORT_LO: '1', PORT_HI: '2' }));
  const client = readFileSync(join(dir, 'src/client.ts'), 'utf8'), config = readFileSync(join(dir, 'vite.config.mts'), 'utf8');
  const backend = 30100, frontend = 30101;
  assert.ok(client.includes(`127.0.0.1:${backend}`)); assert.ok(config.includes(String(frontend)));
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json')));
  assert.equal(pkg.scripts.backend, 'node scripts/launch.mjs backend');
  assert.equal(pkg.scripts.dev, 'node scripts/launch.mjs vite');
  assert.equal(pkg.scripts.preview, 'node scripts/launch.mjs vite-preview');
  assert.equal(pkg.scripts['proof:web'], 'node scripts/frontend-proof.mjs');
  const launcher = readFileSync(join(dir, 'scripts/launch.mjs'), 'utf8');
  assert.ok(launcher.includes(String(backend)) && launcher.includes(String(frontend)));
  assert.ok(launcher.includes('30100') && client.includes('30100'), 'init bakes either assigned range into defaults');
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.ok(readme.includes('npm run backend') && readme.includes(`127.0.0.1:${backend}`), 'README uses the launcher at the written default');
  assert.match(readFileSync(join(dir, 'public/favicon.svg'), 'utf8'), /<svg/);
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /favicon\.svg/);
});

test('invalid ranges refuse before writing; explicit ports must lie inside a range', t => {
  for (const args of [['--port-range', '9-1'], ['--port-range', '0-10'], ['--port-range', '65535-65535'], ['--port-range', '30000-30000'], ['--port-range', '30000-30009', '--port', '4400'], ['--port-range', '30000-30009', '--web-port', '5173']]) {
    const dir = project(t); const result = invoke(['init', '--web', ...args], dir);
    assert.equal(result.status, 2); assert.match(result.stderr, /E_INPUT/);
    assert.throws(() => readFileSync(join(dir, 'package.json')));
  }
  const dir = project(t); const invalid = invoke(['init', '--web'], dir, { PORT_LO: '30000', PORT_HI: '' });
  assert.equal(invalid.status, 2); assert.match(invalid.stderr, /E_INPUT/);
  assert.throws(() => readFileSync(join(dir, 'package.json')), 'an incomplete init range refuses before writes');
});

for (const identity of ['use identity password', 'use identity guests', 'use personas alice']) test(`Expo sync detection and smoke use schema sign-in: ${identity}`, t => {
  const dir = project(t); mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), `${identity}\ntable notes:\n  owner: principal\n  title: text <=80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nquery mine():\n  return notes where .owner = viewer first 20 by .id\nmutation add(title: text <=80):\n  return insert notes { owner: viewer, title }\n`);
  success(invoke(['init', '--expo', '--port-range', '30100-30109'], dir));
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
  success(invoke(['check'], dir));
  const typed = spawnSync(join(root, 'node_modules/.bin/tsc'), ['--noEmit'], { cwd: dir, encoding: 'utf8', timeout: 120000 }); success(typed);
  const client = readFileSync(join(dir, 'src/client.ts'), 'utf8'), readme = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.ok(!client.includes('webDevice') && !readme.includes('web uses the wasm'));
  assert.match(readme, /principal write journal/); assert.match(client, /principal write journal/);
  const screen = readFileSync(join(dir, 'App.tsx'), 'utf8'), smoke = readFileSync(join(dir, 'src/native-smoke.ts'), 'utf8');
  if (identity.includes('password')) {
    assert.match(screen, /useNativeSmokeGuest\(\)/); assert.match(smoke, /auth\.signup/); assert.ok(!smoke.includes('auth.guest'));
    const source = smoke.replace(/^import .*;\n/gm, '').replace('export function', 'function').replace(': string', '');
    for (const segment of [null, 'prime', 'offline', 'restart']) {
      const calls = [], ref = { current: false };
      const context = vm.createContext({ useAuth: () => ({ state: 'signed-out', signup: (...args) => calls.push(args) }), useEffect: fn => fn(), useRef: () => ref, smokeSegment: () => segment, smokeAccount: () => ({ email: 'proof@example.test', password: 'test-only-password' }) });
      vm.runInContext(source, context); vm.runInContext('useNativeSmokeGuest(); useNativeSmokeGuest()', context);
      assert.equal(calls.length, segment === 'prime' ? 1 : 0);
    }
  } else if (identity.includes('personas')) assert.match(screen, /smokeSegment\(\) \? personas\[0\]/);
  else assert.match(smoke, /auth\.guest/);
});

test('adapting a guest starter to password changes the untouched smoke helper too', t => {
  const dir = project(t); success(invoke(['init', '--expo'], dir));
  const schema = join(dir, 'snapback/schema.q'); writeFileSync(schema, readFileSync(schema, 'utf8').replace('use identity ', 'use identity password '));
  success(invoke(['init', '--adapt', '--apply'], dir)); assert.match(readFileSync(join(dir, 'src/native-smoke.ts'), 'utf8'), /auth\.signup/);
});

test('the published stopChild accepts handles and validates unknown shapes; serve launcher closes a real release', async t => {
  const guide = readFileSync(join(root, 'crates/snapback4-lang/src/guide/testing.md'), 'utf8');
  assert.ok(guide.includes('snapback4/proof'), 'the guide uses the packaged helpers');
  let stopped = false; await stopChild({ url: 'http://example', stop: () => { stopped = true; } }); assert.equal(stopped, true);
  for (const invalid of [null, {}, { exitCode: undefined }, { exitCode: {}, signalCode: null, once() {}, kill() {} }]) await assert.rejects(stopChild(invalid), /stopChild needs/);
  const dir = project(t); success(invoke(['init'], dir));
  success(invoke(['deploy', join(dir, 'deploy')], dir));
  const server = await startServe(join(dir, 'deploy'), { cwd: dir }); t.after(server.stop);
  assert.equal((await fetch(server.url + '/schema')).status, 401); await stopChild(server);
  await assert.rejects(fetch(server.url + '/schema'));
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); t.after(() => child.kill('SIGKILL'));
  await stopChild(child); assert.notEqual(child.signalCode, null); await stopChild(child);
});


test('Expo Todos README and client both adapt from synced to journal and back', t => {
  const dir = project(t); success(invoke(['init', '--expo'], dir));
  const schema = join(dir, 'snapback/schema.q'), original = readFileSync(schema, 'utf8');
  writeFileSync(schema, original.replace('  sync to .ownerId', '  online only'));
  success(invoke(['init', '--adapt', '--apply'], dir));
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.match(readme, /principal write journal/); assert.ok(!readme.includes('wasm device'));
  assert.ok(!readFileSync(join(dir, 'src/client.ts'), 'utf8').includes('webDevice'));
  writeFileSync(schema, original); success(invoke(['init', '--adapt', '--apply'], dir));
  assert.ok(readFileSync(join(dir, 'README.md'), 'utf8').includes('wasm') && !readFileSync(join(dir, 'README.md'), 'utf8').includes('principal write journal'));
  assert.match(readFileSync(join(dir, 'src/client.ts'), 'utf8'), /webDevice/);
});
