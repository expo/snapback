import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bin = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const env = { ...process.env, SNAPBACK4_BIN: bin };
const run = (command, args, cwd, extra = {}) => {
  const result = spawnSync(command, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 120000 });
  return result;
};
const success = result => assert.equal(result.status, 0, result.stdout + result.stderr);
const source = identity => `${identity}
table notes:
  owner: principal
  title: text 1..80
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
query mine():
  return notes where .owner = viewer first 20 by .id
mutation add(title: text 1..80):
  return insert notes { owner: viewer, title }
mutation refuse():
  require false else PROOF_REFUSED
  return null
`;
async function dev(cwd) {
  const child = spawn(bin, ['dev', '--memory', '--port', '0', '--no-watch'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stderr.on('data', b => log += b);
  const line = once(createInterface({ input: child.stdout }), 'line');
  const died = once(child, 'exit').then(() => { throw Error(log); }); died.catch(() => {});
  const [url] = await Promise.race([line, died]);
  return { url, close: async () => { if (child.exitCode !== null || child.signalCode !== null) return; const ended = once(child, 'close'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await ended; clearTimeout(timer); } };
}
for (const identity of ['use personas alice', 'use identity password']) test(`exported ${identity} starter witnesses sent twice, refuses failures, and compiles`, { timeout: 120000 }, async t => {
  const dir = mkdtempSync(join(root, 'target/dx-web-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'snapback')); writeFileSync(join(dir, 'snapback/schema.q'), source(identity));
  success(run(bin, ['init', '--web'], dir));
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
  success(run(bin, ['check'], dir));
  success(run(join(root, 'node_modules/.bin/tsc'), ['--noEmit'], dir));
  success(run(join(root, 'node_modules/.bin/vite'), ['build'], dir));
  const server = await dev(dir); t.after(server.close);
  const password = 'proof-only-password';
  const email = 'proof@example.test';
  if (identity.includes('password')) {
    const response = await fetch(server.url + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.ok((await response.json()).session);
  }
  const auth = identity.includes('password') ? ['--email', email, '--password-env', 'DX_PROOF_PASSWORD'] : ['--as', 'alice'];
  const invoke = extra => run(bin, ['witness', 'web', 'dist', '--url', server.url, ...auth, ...extra], dir, { DX_PROOF_PASSWORD: password });
  for (let i = 0; i < 2; i++) {
    // Defaults choose the first mutation and synthesize valid scalar args.
    const result = invoke([]); success(result);
    assert.equal(JSON.parse(result.stdout.trim()).state, 'sent');
    assert.ok(!result.stdout.includes(password) && !result.stderr.includes(password));
  }
  const denied = invoke(['--mutation', 'refuse']);
  assert.equal(denied.status, 1, denied.stdout + denied.stderr);
  assert.match(denied.stderr, /E_WITNESS_SENT.*PROOF_REFUSED/);
  if (identity.includes('personas')) {
    const reply = await (await fetch(server.url + '/q/mine', { method: 'POST', headers: { 'content-type': 'application/json', 'x-snapback-persona': 'alice' }, body: '{"args":{}}' })).json();
    assert.equal(reply.data.length, 1, 'repeated witness is one write');
    // Expo's picker starts with no persona rather than reading ?as=.
    // Exercise the same picker behavior in a real bundled browser app.
    const appPath = join(dir, 'src/App.tsx');
    writeFileSync(appPath, readFileSync(appPath, 'utf8').replace('useState(() => new URLSearchParams(location.search).get("as"))', 'useState<string | null>(null)'));
    success(run(join(root, 'node_modules/.bin/vite'), ['build'], dir));
    success(invoke([]));
    success(run(bin, ['witness', 'web', 'dist', '--as', 'alice'], dir)); // owned fresh backend
    assert.ok(!existsSync(join(dir, '.snapback4/store.sqlite')), 'fresh backend never creates durable store');
  }
  if (identity.includes('password')) success(run(bin, ['witness', 'web', 'dist', ...auth], dir, { DX_PROOF_PASSWORD: password })); // signup on the owned empty backend
  assert.equal((await fetch(server.url + '/dev/status')).status, 200, 'witness leaves external server alive');
});

for (const pm of ['npm', 'bun', 'pnpm']) test(`upgrade ${pm}: one version, exact pins and preserved sections`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'dx-upgrade-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'tools'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: `${pm}@1.0.0`, dependencies: { snapback4: '0.4.24' }, devDependencies: { 'snapback4-expo': '0.4.24', unrelated: '1.0.0' } }));
  const script = `#!${process.execPath}
const fs = require('fs'); const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args)+'\\n');
if (['view','info'].includes(args[0])) { console.log(JSON.stringify('0.4.25')); process.exit(0); }
const pkg = JSON.parse(fs.readFileSync('package.json')); const section = args.includes('--dev') || args.includes('--save-dev') ? 'devDependencies' : 'dependencies';
for (const arg of args) { const match = arg.match(/^(snapback4(?:-expo)?)@(.*)$/); if (match) pkg[section][match[1]] = match[2]; }
fs.writeFileSync('package.json', JSON.stringify(pkg));
`;
  writeFileSync(join(dir, 'tools', pm), script, { mode: 0o755 });
  const result = run(bin, ['upgrade'], dir, { PATH: `${join(dir, 'tools')}:${process.env.PATH}` }); success(result);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json')));
  assert.equal(pkg.dependencies.snapback4, '0.4.25'); assert.equal(pkg.devDependencies['snapback4-expo'], '0.4.25');
  assert.equal(pkg.devDependencies.unrelated, '1.0.0');
  const calls = readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const installs = calls.filter(args => ['install', 'add'].includes(args[0]));
  assert.ok(installs.every(args => args.includes(pm === 'bun' ? '--exact' : '--save-exact')));
  assert.ok(installs.every(args => args.filter(arg => arg.startsWith('snapback4')).every(arg => arg.endsWith('@0.4.25'))));
});

test('witness and upgrade input refusals are early and actionable', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dx-refusal-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  success(run(bin, ['witness', 'web', '--help'], dir));
  const missing = run(bin, ['witness', 'web'], dir, { SNAPBACK4_CHROMIUM: '/no-such-chromium' });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /E_WITNESS_BROWSER.*SNAPBACK4_CHROMIUM/);
  const invalid = run(bin, ['upgrade', '--bogus'], dir); assert.equal(invalid.status, 1); assert.match(invalid.stderr, /E_INPUT/);
});

for (const identity of ['use identity password', 'use personas alice']) test(`Expo ${identity} emits a compiling device-less browser client`, t => {
  const dir = mkdtempSync(join(root, 'target/dx-expo-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'snapback')); writeFileSync(join(dir, 'snapback/schema.q'), source(identity));
  success(run(bin, ['init', '--expo'], dir));
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
  success(run(bin, ['check'], dir));
  success(run(join(root, 'node_modules/.bin/tsc'), ['--noEmit'], dir));
  const client = readFileSync(join(dir, 'src/client.ts'), 'utf8');
  assert.ok(!client.includes('webDevice') && client.includes('nativeDevice'));
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  if (identity.includes('password')) assert.ok(readme.includes('Sign up or sign in') && !readme.includes('Continue as a guest'));
});

test('witness stops its owned backend when interrupted before readiness', { timeout: 15000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dx-startup-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist/index.html'), '<html>proof</html>');
  const pidFile = join(dir, 'backend.pid'), fake = join(dir, 'backend');
  writeFileSync(fake, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const child = spawn(process.execPath, [join(root, 'packages/snapback4/bin/witness-web.js')], { cwd: dir, env: { ...env, SNAPBACK4_BIN: fake, SNAPBACK4_CHROMIUM: process.execPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; } });
  for (let n = 0; n < 100 && !existsSync(pidFile); n++) await new Promise(yes => setTimeout(yes, 20));
  assert.ok(existsSync(pidFile), 'owned backend was spawned');
  const backendPid = Number(readFileSync(pidFile, 'utf8'));
  child.kill('SIGTERM'); await closed;
  assert.throws(() => process.kill(backendPid, 0), { code: 'ESRCH' }, 'no startup orphan');
});

test('password-entry failures never print credentials from Playwright call logs', { timeout: 10000 }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'dx-secret-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist/index.html'), '<label>Email<input></label><label>Password<input type="password" disabled></label>');
  const password = 'fake-proof-secret-with-quote"and-backslash\\';
  const result = run(bin, ['witness', 'web', 'dist', '--url', 'http://127.0.0.1:4400', '--email', 'proof@example.test', '--password-env', 'DX_SECRET', '--timeout', '1'], dir, { DX_SECRET: password });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /E_WITNESS_WEB/);
  for (const stream of [result.stdout, result.stderr]) { assert.ok(!stream.includes(password) && !stream.includes(JSON.stringify(password).slice(1, -1))); assert.ok(!stream.includes('fake-proof-secret')); }
});

test('browser proof selects a durable operation and refuses an ephemeral signal', async t => {
  const { registerWebWitness } = await import('../dist/witness-web.js');
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const window = { location: { search: '?witness=web' } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'window', old); else delete globalThis.window; });
  const app = { ready: Promise.resolve({ ok: true }), client: { viewer: () => 'user:proof', onWrite: () => () => {} }, mutate: async (op, args, { id }) => ({ state: 'sent', id, result: op.name }) };
  registerWebWitness(app, { signal: { kind: 'mutation', name: 'signal', ephemeral: true }, durable: { kind: 'mutation', name: 'durable' } });
  assert.equal((await window.__snapback4Witness.mutate(undefined, {}, 'proof')).result, 'durable');
  await assert.rejects(window.__snapback4Witness.mutate('signal', {}, 'proof'), /E_WITNESS_MUTATION/);
});
