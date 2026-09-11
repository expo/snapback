import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { hostConsumerArtifacts, stagePlatformDependencies, verifyPlatformDependencies } from './consumer-smoke.mjs';
import {
  readQualifiedPlatformArtifact,
  recordPlatformQualification,
  stagePublication,
  stagePublicationShim,
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
  assert.equal(imported.shim.tarball, shim.tarball);
  assert.equal(imported.shim.integrity, shim.integrity);
  assert.equal(imported.qualification.shimIntegrity, shim.integrity);

  const withoutConsumer = structuredClone(staged);
  delete withoutConsumer.platformQualifications[platform.name].consumer;
  writeFileSync(receipt, `${JSON.stringify(withoutConsumer, null, 2)}\n`);
  assert.throws(() => readQualifiedPlatformArtifact(receipt, version), /successful production consumer evidence/);

  writeFileSync(receipt, `${JSON.stringify(staged, null, 2)}\n`);
  writeFileSync(localTarball, 'changed after qualification');
  assert.throws(() => readQualifiedPlatformArtifact(receipt, version), /recorded integrity/);
});

test('a full-set imported shim is reused byte-for-byte while a single-platform shim expands', t => {
  const directory = fixture(t);
  const platformDirectory = resolve(directory, 'platforms');
  const platformArtifacts = platforms.map((platform, index) => {
    const artifact = packedPackage(platformDirectory, {
      ...platform, os: [index === 0 ? 'darwin' : 'linux'], cpu: [index === 0 ? 'arm64' : 'x64'],
    });
    return { ...artifact, integrity: integrity(artifact.tarball) };
  });
  const fullShim = packedPackage(resolve(directory, 'canonical'), {
    ...source,
    custody: 'canonical-import',
    optionalDependencies: Object.fromEntries(platforms.map(platform => [platform.name, version])),
  });
  fullShim.integrity = integrity(fullShim.tarball);
  const singleShim = packedPackage(resolve(directory, 'single'), {
    ...source,
    custody: 'single-platform-import',
    optionalDependencies: { [platforms[1].name]: version },
  });
  singleShim.integrity = integrity(singleShim.tarball);
  const rebuilt = packedPackage(resolve(directory, 'rebuilt'), {
    ...source,
    custody: 'locally-rebuilt-different-bytes',
    optionalDependencies: Object.fromEntries(platforms.map(platform => [platform.name, version])),
  });
  rebuilt.integrity = integrity(rebuilt.tarball);
  assert.notEqual(rebuilt.integrity, fullShim.integrity);

  const canonicalState = resolve(directory, 'canonical-state');
  const canonicalSource = resolve(directory, 'canonical-source');
  mkdirSync(canonicalState);
  writePackage(canonicalSource, source);
  let canonicalPacks = 0;
  const reused = stagePublicationShim(
    version,
    canonicalSource,
    canonicalState,
    platformArtifacts,
    [{ artifact: platformArtifacts[1], shim: fullShim, qualification: {} }],
    () => { canonicalPacks += 1; return rebuilt; },
  );
  assert.equal(canonicalPacks, 0);
  assert.equal(reused.integrity, fullShim.integrity);
  assert.deepEqual(readFileSync(reused.tarball), readFileSync(fullShim.tarball));
  assert.notDeepEqual(readFileSync(reused.tarball), readFileSync(rebuilt.tarball));

  const expansionState = resolve(directory, 'expansion-state');
  const expansionSource = resolve(directory, 'expansion-source');
  mkdirSync(expansionState);
  writePackage(expansionSource, source);
  let expansionPacks = 0;
  const expanded = stagePublicationShim(
    version,
    expansionSource,
    expansionState,
    platformArtifacts,
    [{ artifact: platformArtifacts[1], shim: singleShim, qualification: {} }],
    (shimStage) => {
      expansionPacks += 1;
      const artifact = packedPackage(expansionState, JSON.parse(readFileSync(resolve(shimStage, 'package.json'), 'utf8')));
      return { tarball: artifact.tarball, integrity: integrity(artifact.tarball) };
    },
  );
  assert.equal(expansionPacks, 1);
  assert.notEqual(expanded.integrity, singleShim.integrity);
  assert.doesNotThrow(() => verifyPlatformDependencies([...platformArtifacts, expanded]));
});

test('a resume with stale local shim bytes refuses an imported canonical full-set shim', t => {
  const directory = fixture(t);
  const stateDirectory = resolve(directory, 'durable');
  mkdirSync(stateDirectory);
  const records = platforms.map((platform, index) => {
    const packed = packedPackage(resolve(directory, `platform-${index}`), {
      ...platform, os: [index === 0 ? 'darwin' : 'linux'], cpu: [index === 0 ? 'arm64' : 'x64'],
    });
    const tarball = resolve(stateDirectory, basename(packed.tarball));
    copyFileSync(packed.tarball, tarball);
    return { ...platform, tarball, integrity: integrity(tarball) };
  });
  const packedStale = packedPackage(resolve(directory, 'stale'), {
    ...source,
    custody: 'stale-local',
    optionalDependencies: Object.fromEntries(platforms.map(platform => [platform.name, version])),
  });
  const staleTarball = resolve(stateDirectory, basename(packedStale.tarball));
  copyFileSync(packedStale.tarball, staleTarball);
  const staleShim = { name: 'snapback2', version, tarball: staleTarball, integrity: integrity(staleTarball) };
  const canonicalShim = packedPackage(resolve(directory, 'canonical'), {
    ...source,
    custody: 'canonical-import',
    optionalDependencies: Object.fromEntries(platforms.map(platform => [platform.name, version])),
  });
  canonicalShim.integrity = integrity(canonicalShim.tarball);
  assert.notEqual(staleShim.integrity, canonicalShim.integrity);
  const resumePath = resolve(stateDirectory, 'resume.json');
  writeFileSync(resumePath, `${JSON.stringify({
    name: platforms[0].name,
    version,
    mediaDigest: 'd'.repeat(64),
    artifacts: [...records, staleShim],
  })}\n`);
  const before = [resumePath, ...records.map(record => record.tarball), staleTarball]
    .map(path => readFileSync(path));
  assert.throws(() => stagePublication(version, platforms[0].name, stateDirectory, resumePath, {
    dryRun: false,
    platformArtifacts: [{ artifact: records[1], shim: canonicalShim, qualification: {} }],
    prepareArtifacts() { assert.fail('stale local shim must not be resumed or replaced'); },
    qualifyArtifacts(staged) { return staged; },
  }), /refusing to replace its immutable stage.*--stage-only/);
  assert.deepEqual(
    [resumePath, ...records.map(record => record.tarball), staleTarball].map(path => readFileSync(path)),
    before,
  );
});

test('publication refuses a mismatched durable resume without changing its receipt or tarballs', t => {
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
  const before = Object.fromEntries(readdirSync(stateDirectory).map(name => [name, readFileSync(resolve(stateDirectory, name))]));
  assert.throws(() => stagePublication(version, host.name, stateDirectory, resumePath, {
    dryRun: false,
    platformArtifacts: [requested],
    prepareArtifacts() { assert.fail('publication must not replace a mismatched immutable stage'); },
    qualifyArtifacts(staged) { return staged; },
  }), /refusing to replace its immutable stage.*--stage-only/);
  assert.deepEqual(readdirSync(stateDirectory), Object.keys(before));
  for (const [name, bytes] of Object.entries(before)) {
    assert.deepEqual(readFileSync(resolve(stateDirectory, name)), bytes);
  }
});

test('stage-only can change selection while preserving the prior immutable stage', t => {
  const directory = fixture(t);
  const stateDirectory = resolve(directory, 'durable');
  mkdirSync(stateDirectory);
  const hostTarball = resolve(stateDirectory, 'host.tgz');
  const foreignSource = resolve(directory, 'foreign.tgz');
  const shimTarball = resolve(stateDirectory, 'shim.tgz');
  writeFileSync(hostTarball, 'host');
  writeFileSync(foreignSource, 'foreign');
  writeFileSync(shimTarball, 'host-only-shim');
  const host = { ...platforms[0], tarball: hostTarball, integrity: integrity(hostTarball) };
  const foreign = { ...platforms[1], tarball: foreignSource, integrity: integrity(foreignSource) };
  const shim = { name: 'snapback2', version, tarball: shimTarball, integrity: integrity(shimTarball) };
  const resumePath = resolve(stateDirectory, 'resume.json');
  const oldResume = Buffer.from(`${JSON.stringify({
    name: host.name,
    version,
    mediaDigest: 'b'.repeat(64),
    artifacts: [host, shim],
  })}\n`);
  writeFileSync(resumePath, oldResume);
  const requested = {
    artifact: foreign,
    qualification: { name: foreign.name, version, integrity: foreign.integrity },
  };
  let prepares = 0;
  const stage = stagePublication(version, host.name, stateDirectory, resumePath, {
    dryRun: false,
    stageOnly: true,
    platformArtifacts: [requested],
    prepareArtifacts(_version, _name, target, requestedPlatforms) {
      prepares += 1;
      assert.deepEqual(requestedPlatforms, [requested]);
      mkdirSync(target);
      const nextHost = resolve(target, 'host.tgz');
      const nextForeign = resolve(target, 'foreign.tgz');
      const nextShim = resolve(target, 'shim.tgz');
      writeFileSync(nextHost, 'new host');
      copyFileSync(foreignSource, nextForeign);
      writeFileSync(nextShim, 'unified shim');
      return {
        name: host.name,
        version,
        mediaDigest: 'b'.repeat(64),
        artifacts: [
          { ...host, tarball: nextHost, integrity: integrity(nextHost) },
          { ...foreign, tarball: nextForeign, integrity: integrity(nextForeign) },
          { ...shim, tarball: nextShim, integrity: integrity(nextShim) },
        ],
      };
    },
    qualifyArtifacts(staged) { return staged; },
  });
  assert.equal(prepares, 1);
  assert.deepEqual(stage.staged.artifacts.map(artifact => artifact.name), [host.name, foreign.name, 'snapback2']);
  const preserved = `${stateDirectory}.previous`;
  assert.deepEqual(readFileSync(resolve(preserved, 'resume.json')), oldResume);
  assert.deepEqual(readFileSync(resolve(preserved, 'host.tgz')), Buffer.from('host'));
  assert.deepEqual(readFileSync(resolve(preserved, 'shim.tgz')), Buffer.from('host-only-shim'));
});

test('the two-host stage-stage-stage-publish workflow converges on one immutable shim', t => {
  const directory = fixture(t);
  const hostA = platforms[0];
  const hostB = platforms[1];
  const stateA = resolve(directory, 'host-a');
  const stateB = resolve(directory, 'host-b');
  const resumeA = resolve(stateA, 'resume.json');
  const resumeB = resolve(stateB, 'resume.json');
  const preparations = [];
  const prepareArtifacts = (_version, name, target, requestedPlatforms) => {
    preparations.push({ name, selected: requestedPlatforms.map(({ artifact }) => artifact.name) });
    mkdirSync(target);
    const hostTarball = resolve(target, `${name}.tgz`);
    writeFileSync(hostTarball, `platform:${name}`);
    const artifacts = [{ name, version, tarball: hostTarball, integrity: integrity(hostTarball) }];
    for (const requested of requestedPlatforms) {
      const copied = resolve(target, basename(requested.artifact.tarball));
      copyFileSync(requested.artifact.tarball, copied);
      artifacts.push({ ...requested.artifact, tarball: copied });
    }
    const shimSource = resolve(target, 'shim-source');
    writePackage(shimSource, source);
    artifacts.push(stagePublicationShim(
      version,
      shimSource,
      target,
      artifacts,
      requestedPlatforms,
      (stagedSource) => {
        const packed = packedPackage(target, JSON.parse(readFileSync(resolve(stagedSource, 'package.json'), 'utf8')));
        return { tarball: packed.tarball, integrity: integrity(packed.tarball) };
      },
    ));
    return { name, version, mediaDigest: 'c'.repeat(64), artifacts };
  };
  const qualifyArtifacts = staged => staged;
  const qualification = artifact => ({ name: artifact.name, version, integrity: artifact.integrity });

  const aHostOnly = stagePublication(version, hostA.name, stateA, resumeA, {
    dryRun: false, stageOnly: true, prepareArtifacts, qualifyArtifacts,
  }).staged;
  const aArtifact = aHostOnly.artifacts.find(artifact => artifact.name === hostA.name);
  const aHostOnlyShim = aHostOnly.artifacts.find(artifact => artifact.name === 'snapback2');
  const bUnified = stagePublication(version, hostB.name, stateB, resumeB, {
    dryRun: false, stageOnly: true, prepareArtifacts, qualifyArtifacts,
    platformArtifacts: [{ artifact: aArtifact, shim: aHostOnlyShim, qualification: qualification(aArtifact) }],
  }).staged;
  const bArtifact = bUnified.artifacts.find(artifact => artifact.name === hostB.name);
  const bUnifiedShim = bUnified.artifacts.find(artifact => artifact.name === 'snapback2');
  const aUnified = stagePublication(version, hostA.name, stateA, resumeA, {
    dryRun: false, stageOnly: true, prepareArtifacts, qualifyArtifacts,
    platformArtifacts: [{ artifact: bArtifact, shim: bUnifiedShim, qualification: qualification(bArtifact) }],
  }).staged;
  const refreshedA = aUnified.artifacts.find(artifact => artifact.name === hostA.name);
  const aUnifiedShim = aUnified.artifacts.find(artifact => artifact.name === 'snapback2');
  const published = stagePublication(version, hostB.name, stateB, resumeB, {
    dryRun: false, prepareArtifacts() { assert.fail('matching publication should resume'); }, qualifyArtifacts,
    platformArtifacts: [{ artifact: refreshedA, shim: aUnifiedShim, qualification: qualification(refreshedA) }],
  }).staged;

  const shimIntegrity = staged => staged.artifacts.find(artifact => artifact.name === 'snapback2').integrity;
  assert.equal(shimIntegrity(bUnified), shimIntegrity(aUnified));
  assert.equal(shimIntegrity(published), shimIntegrity(aUnified));
  assert.deepEqual(preparations, [
    { name: hostA.name, selected: [] },
    { name: hostB.name, selected: [hostA.name] },
    { name: hostA.name, selected: [hostB.name] },
  ]);
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
