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
const root = resolve(here, 'npm-pack-host-only-ci');
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

const stateDirectory = resolve(root, 'dist/npm', `publish-${hostName}-${version}`);
const shimStage = resolve(stateDirectory, 'shim');
writePackage(shimStage, {
  name: 'snapback2',
  version,
  dependencies: { typescript: source.dependencies.typescript },
  peerDependencies: source.peerDependencies,
  peerDependenciesMeta: source.peerDependenciesMeta,
  optionalDependencies: source.optionalDependencies,
});
stagePlatformDependencies(shimStage, [{ name: hostName, version }]);
assert.deepEqual(JSON.parse(readFileSync(resolve(shimStage, 'package.json'), 'utf8')).optionalDependencies, {
  [hostName]: version,
});

const platformStage = resolve(stateDirectory, hostName);
writePackage(platformStage, {
  name: hostName,
  version,
  os: [process.platform],
  cpu: [process.arch],
  files: ['bin'],
});
mkdirSync(resolve(platformStage, 'bin'), { recursive: true });
writeFileSync(resolve(platformStage, 'bin/snapback2'), '#!/bin/sh\n');

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
const packedShim = JSON.parse(spawnSync('tar', ['-xOzf', shimArtifact.tarball, 'package/package.json'], { encoding: 'utf8', timeout: 5_000 }).stdout);
assert.deepEqual(packedShim.optionalDependencies, { [hostName]: version });
assert.equal(Object.hasOwn(packedShim.optionalDependencies, 'snapback2-linux-x64'), false);
assert.deepEqual(packedShim.peerDependencies, source.peerDependencies);
assert.deepEqual(packedShim.peerDependenciesMeta, source.peerDependenciesMeta);
assert.deepEqual(packedShim.dependencies, source.dependencies);
verifyPlatformDependencies([platformArtifact, shimArtifact]);

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
  packedOptionalDependencies: packedShim.optionalDependencies,
  lockSnapback2OptionalDependencies: snapLock?.optionalDependencies ?? null,
  lockLinux: lock.packages['node_modules/snapback2-linux-x64'] ?? null,
  lockHost: lock.packages[`node_modules/${hostName}`] ?? null,
  producerDependencies: JSON.parse(readFileSync(resolve(producer, 'package.json'), 'utf8')).dependencies,
}, null, 2));
assert.equal(snapLock.optionalDependencies?.[hostName], version);
assert.equal(snapLock.optionalDependencies?.['snapback2-linux-x64'], undefined);
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
console.log('host-only npm pack metadata: linux absent; npm 11 ci accepted unchanged lock');
