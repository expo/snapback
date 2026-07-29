import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertPublicPackageBuildIdentity } from '../../scripts/runtime-package-authority.mjs';
import {
  createLinuxRuntimeArtifactAttestation,
  readLinuxRuntimeArtifactAttestation,
  readLinuxRuntimeBuildIdentity,
  validateLinuxRuntimeArtifactAttestation,
} from './artifact-attestation.mjs';

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
assert.equal(manifest.name, '@snapback/runtime-linux-x64');
assert.deepEqual(manifest.os, ['linux']);
assert.deepEqual(manifest.cpu, ['x64']);
assert.deepEqual(manifest.files, ['bin', 'lib']);

// @ref LLP 0041#runtime-distribution — prepared native payloads are package
// outputs, while the source-side package contract remains reviewable.
const ignoreRules = readFileSync(new URL('./.gitignore', import.meta.url), 'utf8')
  .split(/\r?\n/u)
  .filter(Boolean);
assert.deepEqual(ignoreRules, ['/bin/', '/lib/']);

const attestationRoot = mkdtempSync(join(tmpdir(), 'snapback-linux-attestation-'));
try {
  const sourceRevision = 'a'.repeat(40);
  const attestedBinary = join(attestationRoot, 'snapback');
  const attestedHermes = join(attestationRoot, 'libhermesvm.so');
  const attestationPath = join(attestationRoot, 'build-attestation.json');
  const cliAttestationPath = join(attestationRoot, 'cli-build-attestation.json');
  const identityPath = join(attestationRoot, 'build-identity.json');
  writeFileSync(attestedBinary, 'linux-runtime-bytes');
  writeFileSync(attestedHermes, 'linux-hermes-bytes');
  const buildIdentity = {
    schemaVersion: 'snapback.binary-identity.v1',
    binary: {
      crateVersion: '0.1.0',
      gitCommit: sourceRevision,
      gitDirty: false,
      buildProfile: 'release',
      startupNonce: '0198f865-9f71-7d7a-9bab-7ae3637b7d58',
    },
    buildDistribution: 'public-package',
  };
  writeFileSync(identityPath, `${JSON.stringify(buildIdentity)}\n`);
  assert.deepEqual(
    readLinuxRuntimeBuildIdentity(identityPath, sourceRevision),
    buildIdentity,
  );
  const attestation = createLinuxRuntimeArtifactAttestation({
    binaryPath: attestedBinary,
    hermesPath: attestedHermes,
    buildIdentity,
    sourceRevision,
  });
  writeFileSync(attestationPath, `${JSON.stringify(attestation)}\n`);
  assert.deepEqual(
    validateLinuxRuntimeArtifactAttestation({
      attestation: readLinuxRuntimeArtifactAttestation(attestationPath),
      binaryPath: attestedBinary,
      hermesPath: attestedHermes,
      sourceRevision,
    }),
    attestation,
  );
  const attestationCli = fileURLToPath(
    new URL('../../scripts/snapback-create-runtime-artifact-attestation.mjs', import.meta.url),
  );
  const created = spawnSync(process.execPath, [
    attestationCli,
    '--binary', attestedBinary,
    '--hermes', attestedHermes,
    '--identity', identityPath,
    '--source-revision', sourceRevision,
    '--out', cliAttestationPath,
  ], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  assert.deepEqual(
    readLinuxRuntimeArtifactAttestation(cliAttestationPath),
    attestation,
  );
  writeFileSync(attestedBinary, 'tampered-linux-runtime-bytes');
  assert.throws(
    () => validateLinuxRuntimeArtifactAttestation({
      attestation,
      binaryPath: attestedBinary,
      hermesPath: attestedHermes,
      sourceRevision,
    }),
    /attestation digest drifted/u,
  );
  assert.throws(
    () => createLinuxRuntimeArtifactAttestation({
      binaryPath: attestedBinary,
      hermesPath: attestedHermes,
      buildIdentity,
      sourceRevision: 'b'.repeat(40),
    }),
    /source revision drifted/u,
  );
} finally {
  rmSync(attestationRoot, { recursive: true, force: true });
}

const binary = fileURLToPath(new URL('./bin/snapback', import.meta.url));
const hermes = fileURLToPath(new URL('./lib/libhermesvm.so', import.meta.url));
if (existsSync(binary) || existsSync(hermes)) {
  assert.equal(existsSync(binary), true, 'prepared package must contain the binary');
  assert.equal(existsSync(hermes), true, 'prepared package must contain libhermesvm.so');
  const environment = { ...process.env };
  delete environment.LD_LIBRARY_PATH;
  const launched = spawnSync(binary, ['--help'], {
    encoding: 'utf8',
    env: environment,
    timeout: 15_000,
  });
  assert.equal(
    launched.status,
    0,
    `packaged Linux binary must launch via its loader-relative rpath: ${launched.stderr}`,
  );
  const identity = spawnSync(binary, ['build-identity'], {
    encoding: 'utf8',
    env: environment,
    timeout: 15_000,
  });
  assert.equal(identity.status, 0, identity.stderr);
  assertPublicPackageBuildIdentity(JSON.parse(identity.stdout));
}
console.log('package.test.mjs: Linux x64 package identity and relocatable closure pass');
