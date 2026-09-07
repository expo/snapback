import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stagePlatformDependencies, verifyPlatformDependencies } from '../snapshot/snapback2/scripts/consumer-smoke.mjs';

const directory = resolve('multiple-platform-install');
mkdirSync(directory, { recursive: true });
const source = JSON.parse(readFileSync(new URL('../snapshot/snapback2/packages/snapback2/package.json', import.meta.url), 'utf8'));
const npm = process.env.SNAPBACK2_PUBLISH_NPM;
let index = 0;
function run(args, cwd) {
  const stem = resolve(directory, `${++index}-npm`);
  const launch = { command: npm, args, cwd, startedAt: new Date().toISOString(), timeoutMilliseconds: 30000 };
  writeFileSync(`${stem}.launch.json`, JSON.stringify(launch, null, 2));
  const start = performance.now();
  const result = spawnSync(npm, args, { cwd, env: process.env, encoding: 'utf8', timeout: 30000 });
  writeFileSync(`${stem}.stdout.log`, result.stdout ?? '');
  writeFileSync(`${stem}.stderr.log`, result.stderr ?? '');
  writeFileSync(`${stem}.terminal.json`, JSON.stringify({ pid: result.pid, status: result.status, signal: result.signal,
    error: result.error?.message, elapsedSeconds: (performance.now() - start) / 1000 }, null, 2));
  return result;
}
function writePackage(name, manifest) {
  const path = resolve(directory, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(resolve(path, 'package.json'), JSON.stringify(manifest, null, 2));
  return path;
}
function pack(path) {
  const result = run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory, path], directory);
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout)[0];
  return { name: record.name, version: record.version, integrity: record.integrity, tarball: resolve(directory, record.filename) };
}
const selections = [
  { name: 'snapback2-darwin-arm64', version: source.version, os: ['darwin'], cpu: ['arm64'] },
  { name: 'snapback2-linux-x64', version: source.version, os: ['linux'], cpu: ['x64'] },
];
const platforms = selections.map(p => pack(writePackage(p.name, p)));
const shimDirectory = writePackage('shim', source);
stagePlatformDependencies(shimDirectory, platforms);
const shim = pack(shimDirectory);
const artifacts = [...platforms, shim];
verifyPlatformDependencies(artifacts);
console.log('Both npm-packed platform identities and shim dependency map accepted by candidate verifier.');
const deps = [{ name: 'react', version: '19.1.1' }, { name: 'typescript', version: source.dependencies.typescript }]
  .map(p => pack(writePackage(p.name, p)));
const consumer = writePackage('consumer', { name: 'publication-multiple-platform-fixture', private: true, type: 'module' });
// Same relevant install flags and mandatory artifact operands as consumerSmoke;
// unrelated UI tooling is omitted, and dependency stand-ins are local tarballs.
const result = run(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps',
  '--prefer-offline', '--fetch-retries=0', '--fetch-timeout=15000', ...artifacts.concat(deps).map(p => p.tarball)], consumer);
console.log(JSON.stringify({ installStatus: result.status, signal: result.signal }, null, 2));
console.log(result.stdout ?? '');
console.error(result.stderr ?? '');
assert.equal(result.status, 0, 'a consumer of both selected platform artifacts should retain platform-optional installation semantics');
