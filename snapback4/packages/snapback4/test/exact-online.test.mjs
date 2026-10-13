// @ref LLP 3000.001.000#build-stamp — generated operations and online adapters need no device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { spawnTracked, signalChild } from '../../../scripts/test-signals.mjs';
import { captureStdout } from './helpers/server-output.mjs';
import { binary, until } from './helpers/app-server.mjs';

for (const mode of ['dev', 'serve']) test(`Exact online mount without wasm checks and queries/writes through ${mode}`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-gate-online-'));
  let host;
  t.after(async () => {
    try {
      if (host && host.exitCode === null && host.signalCode === null) {
        const done = new Promise(resolve => host.once('exit', resolve));
        await signalChild(host, 'SIGTERM'); await done;
      }
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
  cpSync(new URL('./fixtures/exact-online/', import.meta.url), dir, {recursive: true});
  const command = args => {
    const result = spawnSync(binary, args, {cwd: dir, encoding: 'utf8', timeout: 60_000});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  assert.equal(JSON.parse(command(['check', '--json'])).ok, true);
  assert.equal(existsSync(join(dir, 'app/assets/snapback4.wasm')), false);
  assert.equal(existsSync(join(dir, 'snapback/generated/api.ts')), true);
  if (mode === 'serve') command(['deploy', join(dir, 'release')]);
  host = spawnTracked(binary, mode === 'serve' ? ['serve', join(dir, 'release'), '--port', '0'] : ['dev', '--no-watch', '--port', '0'],
    {cwd: dir, stdio: ['ignore', 'pipe', 'pipe']});
  const output = captureStdout(host); let errors = '';
  host.stderr.on('data', bytes => { errors += bytes; });
  const origin = await until(() => { assert.equal(host.exitCode, null, errors); return output().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; }, 'online fixture listens');
  let headers = {'x-snapback-persona': 'alice'};
  if (mode === 'serve') {
    const response = await fetch(origin + '/auth/guest', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
    assert.equal(response.status, 200);
    const { session } = await response.json();
    assert.ok(session?.token, 'guest auth returns a session');
    headers = {authorization: 'Bearer ' + session.token};
  }
  const mounts = JSON.parse(readFileSync(join(dir, 'app/app.json'))).typescript.sources;
  for (const [name, target] of Object.entries(mounts)) symlinkSync(join(dir, 'app', target), join(dir, 'app', name));
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(fileURLToPath(new URL('../', import.meta.url)), join(dir, 'node_modules/snapback4'));
  const options = {noEmit: true, strict: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true, types: [], lib: ['lib.es2022.d.ts', 'lib.webworker.d.ts']};
  const compilerHost = ts.createCompilerHost(options); compilerHost.getCurrentDirectory = () => dir;
  const program = ts.createProgram([join(dir, 'app/app.ts')], options, compilerHost);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => dir, getNewLine: () => '\n'}));
  // Exact bakes TypeScript. Apply its ordinary TS transform (including parameter
  // properties) in this temp tree before Node loads the virtual mounts.
  for (const file of ['app/app.ts', 'snapback4/online/snapback.ts', 'snapback/generated/api.ts']) {
    const path = join(dir, file);
    writeFileSync(path, ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText);
  }
  const { connect } = await import(pathToFileURL(join(dir, 'app/app.ts')).href);
  const db = connect(origin, () => headers);
  const before = await db.list(); assert.equal(before.server, true); assert.deepEqual(before.data, []);
  const sent = await db.add('online ' + mode); assert.equal(sent.state, 'sent', JSON.stringify(sent)); assert.ok(sent.result.id);
  const after = await db.list(); assert.equal(after.server, true); assert.equal(after.data.length, 1);
  assert.equal(after.data[0].id, sent.result.id); assert.equal(after.data[0].body, 'online ' + mode);
  assert.equal(existsSync(join(dir, 'app/assets/snapback4.wasm')), false);
});
