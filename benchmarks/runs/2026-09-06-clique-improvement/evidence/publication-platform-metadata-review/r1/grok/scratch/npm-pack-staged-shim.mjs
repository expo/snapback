import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagePlatformDependencies, verifyPlatformDependencies } from '../snapshot/snapback2/scripts/consumer-smoke.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(readFileSync(resolve(here, '../snapshot/snapback2/packages/snapback2/package.json'), 'utf8'));
const version = source.version;
const npm = process.env.SNAPBACK2_PUBLISH_NPM ?? 'npm';
const hostName = `snapback2-${process.platform}-${process.arch}`;
const root = resolve(here, 'npm-pack-staged-shim');
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

function run(args, cwd) {
  const result = spawnSync(npm, args, { cwd, encoding: 'utf8', timeout: 25_000, env: process.env });
  if (result.status !== 0) {
    throw new Error(`${npm} ${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function writePackage(directory, manifest) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

writePackage(root, { name: 'snapback2-workspace', private: true, workspaces: ['packages/*'] });
writePackage(resolve(root, 'packages/snapback2'), {
  name: 'snapback2',
  version,
  dependencies: { typescript: source.dependencies.typescript },
  peerDependencies: source.peerDependencies,
  peerDependenciesMeta: source.peerDependenciesMeta,
  optionalDependencies: source.optionalDependencies,
});

const shimStage = resolve(root, 'dist/npm', `publish-${hostName}-${version}`, 'shim');
writePackage(shimStage, {
  name: 'snapback2',
  version,
  dependencies: { typescript: source.dependencies.typescript },
  peerDependencies: source.peerDependencies,
  peerDependenciesMeta: source.peerDependenciesMeta,
  optionalDependencies: { ...source.optionalDependencies, unrelated: '1.2.3' },
});
stagePlatformDependencies(shimStage, [{ name: hostName, version }]);

const platformStage = resolve(root, 'dist/npm', `publish-${hostName}-${version}`, hostName);
writePackage(platformStage, {
  name: hostName,
  version,
  os: [process.platform],
  cpu: [process.arch],
  files: ['bin'],
});
mkdirSync(resolve(platformStage, 'bin'), { recursive: true });
writeFileSync(resolve(platformStage, 'bin/snapback2'), '#!/bin/sh\n');

const stateDirectory = resolve(root, 'dist/npm', `publish-${hostName}-${version}`);
function pack(directory) {
  const result = run(['pack', '--ignore-scripts', '--json', '--pack-destination', stateDirectory, directory], root);
  const report = JSON.parse(result.stdout)[0];
  assert.ok(report?.filename, result.stdout);
  return {
    name: JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')).name,
    version,
    tarball: resolve(stateDirectory, report.filename),
    integrity: report.integrity,
  };
}

const platformArtifact = pack(platformStage);
const shimArtifact = pack(shimStage);
assert.equal(shimArtifact.name, 'snapback2');

const extracted = spawnSync('tar', ['-xOzf', shimArtifact.tarball, 'package/package.json'], { encoding: 'utf8', timeout: 5_000 });
assert.equal(extracted.status, 0, extracted.stderr);
const packedShim = JSON.parse(extracted.stdout);
console.log(JSON.stringify({
  packedOptionalDependencies: packedShim.optionalDependencies,
  packedDependencies: packedShim.dependencies,
  packedPeerDependencies: packedShim.peerDependencies,
  packedPeerDependenciesMeta: packedShim.peerDependenciesMeta,
  sourceOptionalDependencies: source.optionalDependencies,
}, null, 2));

assert.deepEqual(packedShim.optionalDependencies, { unrelated: '1.2.3', [hostName]: version });
assert.equal(Object.hasOwn(packedShim.optionalDependencies, 'snapback2-linux-x64'), false);
assert.deepEqual(packedShim.dependencies, { typescript: source.dependencies.typescript });
assert.deepEqual(packedShim.peerDependencies, source.peerDependencies);
assert.deepEqual(packedShim.peerDependenciesMeta, source.peerDependenciesMeta);
assert.doesNotThrow(() => verifyPlatformDependencies([platformArtifact, shimArtifact]));

writePackage(resolve(root, 'react'), { name: 'react', version: '19.1.1' });
writePackage(resolve(root, 'typescript'), { name: 'typescript', version: source.dependencies.typescript });
const reactArtifact = pack(resolve(root, 'react'));
const typescriptArtifact = pack(resolve(root, 'typescript'));

const producer = resolve(root, 'producer');
writePackage(producer, { name: 'publication-npm-pack-producer', private: true });
run([
  'install', '--no-audit', '--no-fund',
  shimArtifact.tarball, platformArtifact.tarball, reactArtifact.tarball, typescriptArtifact.tarball,
], producer);

const lock = JSON.parse(readFileSync(resolve(producer, 'package-lock.json'), 'utf8'));
const snapLock = lock.packages['node_modules/snapback2'];
console.log(JSON.stringify({
  lockSnapback2OptionalDependencies: snapLock?.optionalDependencies ?? null,
  lockLinux: lock.packages['node_modules/snapback2-linux-x64'] ?? null,
  lockHost: lock.packages[`node_modules/${hostName}`] ? { version: lock.packages[`node_modules/${hostName}`].version, optional: lock.packages[`node_modules/${hostName}`].optional ?? false } : null,
  producerDependencies: JSON.parse(readFileSync(resolve(producer, 'package.json'), 'utf8')).dependencies,
}, null, 2));

assert.ok(snapLock, 'lock missing snapback2');
assert.equal(snapLock.optionalDependencies?.['snapback2-linux-x64'], undefined);
assert.equal(snapLock.optionalDependencies?.[hostName], version);
assert.equal(lock.packages['node_modules/snapback2-linux-x64'], undefined);

const consumer = resolve(root, 'consumer');
mkdirSync(consumer, { recursive: true });
writeFileSync(resolve(consumer, 'package.json'), readFileSync(resolve(producer, 'package.json')));
writeFileSync(resolve(consumer, 'package-lock.json'), readFileSync(resolve(producer, 'package-lock.json')));
const before = ['package.json', 'package-lock.json'].map((file) => readFileSync(resolve(consumer, file)));
run(['ci', '--no-audit', '--no-fund'], consumer);
assert.deepEqual(['package.json', 'package-lock.json'].map((file) => readFileSync(resolve(consumer, file))), before);
assert.equal(JSON.parse(readFileSync(resolve(consumer, 'node_modules/snapback2/package.json'), 'utf8')).optionalDependencies['snapback2-linux-x64'], undefined);
assert.equal(JSON.parse(readFileSync(resolve(consumer, 'node_modules', hostName, 'package.json'), 'utf8')).version, version);
console.log('npm-pack staged shim: darwin-only metadata survived pack, lock, and npm ci');
