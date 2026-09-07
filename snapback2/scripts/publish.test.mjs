import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { stagePlatformDependencies, verifyPlatformDependencies } from './consumer-smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(resolve(root, 'packages/snapback2/package.json'), 'utf8'));
const version = source.version;
const platforms = ['snapback2-darwin-arm64', 'snapback2-linux-x64'].map(name => ({ name, version }));

function fixture(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'snapback2-publication-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writePackage(directory, manifest) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function packedPackage(directory, manifest) {
  const staging = resolve(directory, manifest.name, 'package');
  writePackage(staging, manifest);
  const tarball = resolve(directory, `${manifest.name}.tgz`);
  const packed = spawnSync('tar', ['-czf', tarball, '-C', dirname(staging), 'package'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  return { name: manifest.name, version: manifest.version, tarball };
}

for (const selected of [[platforms[0]], platforms]) {
  test(`stages exactly ${selected.map(p => p.name).join(' and ')}`, t => {
    const directory = fixture(t);
    writePackage(directory, { ...source, optionalDependencies: { ...source.optionalDependencies, unrelated: '1.2.3' } });
    stagePlatformDependencies(directory, selected);
    const staged = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    assert.deepEqual(staged.optionalDependencies, {
      unrelated: '1.2.3', ...Object.fromEntries(selected.map(p => [p.name, p.version])),
    });
    assert.deepEqual(staged.peerDependencies, source.peerDependencies);
    assert.deepEqual(staged.peerDependenciesMeta, source.peerDependenciesMeta);
    assert.deepEqual(staged.dependencies, source.dependencies);
    const artifacts = selected.map(p => packedPackage(directory, p));
    artifacts.push(packedPackage(directory, staged));
    assert.doesNotThrow(() => verifyPlatformDependencies(artifacts));
  });
}

test('refuses absent, mismatched, duplicate and non-platform selections without editing the shim', t => {
  const directory = fixture(t);
  writePackage(directory, source);
  const before = readFileSync(resolve(directory, 'package.json'));
  for (const selected of [[], [{ ...platforms[0], version: '0.0.0-invalid' }],
    [platforms[0], platforms[0]], [{ name: 'react', version }]]) {
    assert.throws(() => stagePlatformDependencies(directory, selected), /platform/);
    assert.deepEqual(readFileSync(resolve(directory, 'package.json')), before);
  }
});

test('rejects a resumed shim that advertises a platform outside its immutable artifacts', t => {
  const directory = fixture(t);
  const artifacts = [packedPackage(directory, platforms[0]), packedPackage(directory, {
    ...source, optionalDependencies: Object.fromEntries(platforms.map(p => [p.name, p.version])),
  })];
  const before = artifacts.map(a => readFileSync(a.tarball));
  assert.throws(() => verifyPlatformDependencies(artifacts), /optionalDependencies do not match/);
  assert.deepEqual(artifacts.map(a => readFileSync(a.tarball)), before);
});

test('rejects artifact records that disagree with the packed package identity', t => {
  const directory = fixture(t);
  const shim = packedPackage(directory, { ...source, optionalDependencies: { [platforms[0].name]: version } });
  const platform = packedPackage(directory, platforms[0]);
  assert.throws(() => verifyPlatformDependencies([shim, { ...platform, version: '0.0.0-invalid' }]), /does not match/);
});

test('a selected platform shim installs from an unchanged lock in a fresh npm consumer', t => {
  const directory = fixture(t);
  const shimDirectory = resolve(directory, 'staged-shim');
  const host = { name: `snapback2-${process.platform}-${process.arch}`, version };
  writePackage(shimDirectory, {
    ...source,
    optionalDependencies: { ...source.optionalDependencies, [host.name]: version },
  });
  stagePlatformDependencies(shimDirectory, [host]);
  const staged = JSON.parse(readFileSync(resolve(shimDirectory, 'package.json'), 'utf8'));
  const artifacts = [packedPackage(directory, staged), packedPackage(directory, {
    ...host, os: [process.platform], cpu: [process.arch],
  })];
  const reactVersion = '19.1.1';
  const dependencyFixtures = [
    packedPackage(directory, { name: 'react', version: reactVersion }),
    packedPackage(directory, { name: 'typescript', version: source.dependencies.typescript }),
  ];
  verifyPlatformDependencies(artifacts);
  const producer = resolve(directory, 'producer');
  const consumer = resolve(directory, 'consumer');
  writePackage(producer, { name: 'publication-install-fixture', private: true });
  mkdirSync(consumer);
  const userConfig = resolve(directory, 'user.npmrc');
  const globalConfig = resolve(directory, 'global.npmrc');
  writeFileSync(userConfig, '');
  writeFileSync(globalConfig, '');
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_'))),
    NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_CACHE: resolve(directory, 'cache'), NPM_CONFIG_OFFLINE: 'true',
    NPM_CONFIG_REGISTRY: 'http://127.0.0.1:9',
  };
  const npm = process.env.SNAPBACK2_PUBLISH_NPM ?? 'npm';
  const run = (args, cwd) => {
    const result = spawnSync(npm, args, { cwd, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, `${npm} ${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  t.diagnostic(`Node ${process.version}; npm ${run(['--version'], producer).stdout.trim()}; offline synthetic tarballs, default peer and optional dependencies`);
  const flags = ['--no-audit', '--no-fund'];
  run(['install', ...flags, ...artifacts.concat(dependencyFixtures).map(a => a.tarball)], producer);
  for (const file of ['package.json', 'package-lock.json']) copyFileSync(resolve(producer, file), resolve(consumer, file));
  const before = ['package.json', 'package-lock.json'].map(file => readFileSync(resolve(consumer, file)));
  assert.equal(existsSync(resolve(consumer, 'node_modules')), false);
  run(['ci', ...flags], consumer);
  assert.deepEqual(['package.json', 'package-lock.json'].map(file => readFileSync(resolve(consumer, file))), before);
  for (const [name, expected] of [['snapback2', version], [host.name, version], ['react', reactVersion]]) {
    assert.equal(JSON.parse(readFileSync(resolve(consumer, 'node_modules', name, 'package.json'))).version, expected);
  }
});
