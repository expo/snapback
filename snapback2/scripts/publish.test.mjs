import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { hostConsumerArtifacts, stagePlatformDependencies, verifyPlatformDependencies } from './consumer-smoke.mjs';
import {
  readQualifiedPlatformArtifact,
  recordPlatformQualification,
  stagePublication,
  verifyPublicationQualifications,
} from './publish.mjs';

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

function npmPackedBytes(directory, staging) {
  const output = resolve(directory, `${basename(staging)}-pack`);
  mkdirSync(output);
  const packed = spawnSync('npm', [
    'pack', '--ignore-scripts', '--json', '--pack-destination', output, staging,
  ], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  return readFileSync(resolve(output, JSON.parse(packed.stdout)[0].filename));
}

function integrity(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
}

function passingConsumer() {
  return {
    status: 0,
    steps: [
      { name: 'install tarballs', ok: true },
      { name: 'doctor', ok: true },
      { name: 'todos receipt', accepted: true, verdict: 'pass' },
      { name: 'todos test', ok: true },
      { name: 'chat receipt', accepted: true, verdict: 'pass' },
      { name: 'chat test', ok: true },
    ],
  };
}

for (const selected of [[platforms[0]], [platforms[1]], platforms]) {
  test(`stages exactly ${selected.map(p => p.name).join(' and ')}`, t => {
    const directory = fixture(t);
    const unrelated = { unrelated: '1.2.3', 'snapback2-plugin': '2.3.4', 'snapback2-plugin-tools': '3.4.5' };
    writePackage(directory, { ...source, optionalDependencies: { ...source.optionalDependencies, ...unrelated } });
    stagePlatformDependencies(directory, selected);
    const staged = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    assert.deepEqual(staged.optionalDependencies, {
      ...unrelated, ...Object.fromEntries(selected.map(p => [p.name, p.version])),
    });
    assert.deepEqual(staged.peerDependencies, source.peerDependencies);
    assert.deepEqual(staged.peerDependenciesMeta, source.peerDependenciesMeta);
    assert.deepEqual(staged.dependencies, source.dependencies);
    const artifacts = selected.map(p => packedPackage(directory, p));
    artifacts.push(packedPackage(directory, staged));
    assert.doesNotThrow(() => verifyPlatformDependencies(artifacts));
  });
}

test('platform selection order produces the same unified manifest and immutable shim tarball', t => {
  const directory = fixture(t);
  const stages = ['forward', 'reverse'].map(name => resolve(directory, name));
  for (const stage of stages) writePackage(stage, source);
  stagePlatformDependencies(stages[0], platforms);
  stagePlatformDependencies(stages[1], [...platforms].reverse());
  assert.deepEqual(readFileSync(resolve(stages[0], 'package.json')), readFileSync(resolve(stages[1], 'package.json')));
  assert.deepEqual(npmPackedBytes(directory, stages[0]), npmPackedBytes(directory, stages[1]));
});

test('refuses absent, mismatched, duplicate and non-platform selections without editing the shim', t => {
  const directory = fixture(t);
  writePackage(directory, source);
  const before = readFileSync(resolve(directory, 'package.json'));
  for (const selected of [[], [{ ...platforms[0], version: '0.0.0-invalid' }],
    [platforms[0], platforms[0]],
    ...['react', 'snapback2-plugin', 'snapback2-plugin-tools', 'snapback2-darwin-x64'].map(name => [{ name, version }])]) {
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

test('host consumer qualification excludes a foreign binary while retaining the packed shim', () => {
  const shim = { name: 'snapback2', version };
  const artifacts = [...platforms, shim];
  assert.deepEqual(hostConsumerArtifacts(artifacts, 'darwin', 'arm64'), [platforms[0], shim]);
  assert.deepEqual(hostConsumerArtifacts(artifacts, 'linux', 'x64'), [platforms[1], shim]);
  assert.throws(() => hostConsumerArtifacts([platforms[0], shim], 'linux', 'x64'), /linux-x64/);
  assert.throws(() => hostConsumerArtifacts([platforms[0], shim, shim], 'darwin', 'arm64'), /exactly one snapback2/);
});

test('foreign platform import requires portable digest-bound native-host consumer evidence', t => {
  const directory = fixture(t);
  const platform = platforms[1];
  const artifact = packedPackage(directory, { ...platform, os: ['linux'], cpu: ['x64'] });
  const localTarball = artifact.tarball;
  artifact.integrity = integrity(artifact.tarball);
  const shim = packedPackage(directory, {
    ...source,
    optionalDependencies: { [platform.name]: version },
  });
  shim.integrity = integrity(shim.tarball);
  const staged = {
    name: platform.name,
    version,
    mediaDigest: 'a'.repeat(64),
    artifacts: [artifact, shim],
  };
  recordPlatformQualification(staged, platform.name, passingConsumer(), { platform: 'linux', arch: 'x64' });
  // Stage receipts remain portable when their directory is transferred and
  // the original host's absolute artifact path still exists but is stale.
  const staleHost = resolve(directory, 'original-linux-host');
  mkdirSync(staleHost);
  const staleTarball = resolve(staleHost, basename(localTarball));
  writeFileSync(staleTarball, 'stale artifact at the recorded absolute path');
  staged.artifacts[0].tarball = staleTarball;
  const receipt = resolve(directory, 'resume.json');
  writeFileSync(receipt, `${JSON.stringify(staged, null, 2)}\n`);
  const imported = readQualifiedPlatformArtifact(receipt, version);
  assert.equal(imported.artifact.name, platform.name);
  assert.equal(imported.artifact.tarball, localTarball);
  assert.equal(imported.artifact.integrity, artifact.integrity);
  assert.equal(imported.qualification.shimIntegrity, shim.integrity);

  const withoutConsumer = structuredClone(staged);
  delete withoutConsumer.platformQualifications[platform.name].consumer;
  writeFileSync(receipt, `${JSON.stringify(withoutConsumer, null, 2)}\n`);
  assert.throws(() => readQualifiedPlatformArtifact(receipt, version), /successful production consumer evidence/);

  writeFileSync(receipt, `${JSON.stringify(staged, null, 2)}\n`);
  writeFileSync(localTarball, 'changed after qualification');
  assert.throws(() => readQualifiedPlatformArtifact(receipt, version), /recorded integrity/);
});

test('a durable resume is rebuilt rather than silently ignoring a newly requested platform', t => {
  const directory = fixture(t);
  const stateDirectory = resolve(directory, 'durable');
  mkdirSync(stateDirectory);
  const hostTarball = resolve(stateDirectory, 'host.tgz');
  const foreignTarball = resolve(stateDirectory, 'foreign.tgz');
  const shimTarball = resolve(stateDirectory, 'shim.tgz');
  writeFileSync(hostTarball, 'host');
  writeFileSync(foreignTarball, 'foreign');
  writeFileSync(shimTarball, 'shim');
  const host = { ...platforms[0], tarball: hostTarball, integrity: integrity(hostTarball) };
  const foreign = { ...platforms[1], tarball: foreignTarball, integrity: integrity(foreignTarball) };
  const shim = { name: 'snapback2', version, tarball: shimTarball, integrity: integrity(shimTarball) };
  const resumePath = resolve(stateDirectory, 'resume.json');
  writeFileSync(resumePath, `${JSON.stringify({
    name: host.name,
    version,
    mediaDigest: 'b'.repeat(64),
    artifacts: [host, shim],
  })}\n`);
  const requested = {
    artifact: foreign,
    qualification: { name: foreign.name, version, integrity: foreign.integrity },
  };
  let prepares = 0;
  const stage = stagePublication(version, host.name, stateDirectory, resumePath, {
    dryRun: false,
    platformArtifacts: [requested],
    prepareArtifacts(_version, _name, _directory, requestedPlatforms) {
      prepares += 1;
      assert.deepEqual(requestedPlatforms, [requested]);
      return {
        name: host.name,
        version,
        mediaDigest: 'b'.repeat(64),
        artifacts: [host, foreign, shim],
      };
    },
    qualifyArtifacts(staged) { return staged; },
  });
  assert.equal(prepares, 1);
  assert.deepEqual(stage.staged.artifacts.map(artifact => artifact.name), [host.name, foreign.name, 'snapback2']);

  stagePublication(version, host.name, stateDirectory, resumePath, {
    dryRun: false,
    platformArtifacts: [requested],
    prepareArtifacts() { assert.fail('matching requested platform should resume'); },
    qualifyArtifacts(staged) { return staged; },
  });
  assert.equal(prepares, 1);
});

test('publication requires every host consumer to have exercised the final identical shim', () => {
  const shim = { name: 'snapback2', version, integrity: 'sha512-final' };
  const staged = {
    artifacts: [...platforms.map((platform, index) => ({ ...platform, integrity: `sha512-platform-${index}` })), shim],
    platformQualifications: Object.fromEntries(platforms.map((platform, index) => [platform.name, {
      name: platform.name,
      version,
      integrity: `sha512-platform-${index}`,
      shimIntegrity: 'sha512-final',
      consumer: { verdict: 'pass', steps: passingConsumer().steps },
    }])),
  };
  assert.doesNotThrow(() => verifyPublicationQualifications(staged));
  staged.platformQualifications[platforms[1].name].shimIntegrity = 'sha512-earlier-host-only-shim';
  assert.throws(() => verifyPublicationQualifications(staged), /not production-qualified with final shim/);
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
