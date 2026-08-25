import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeAdminConsoleSnapshotManifest } from '../packages/snapback-cli/admin-snapshot.mjs';
import { produceRuntimePackageSeal } from '../packages/snapback-cli/runtime-readiness.mjs';
import { verifyPackedRuntimeSeal } from './snapback-publish.mjs';

test('publication refuses a foreign Linux tarball with mismatched catalog proof', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'snapback-publish-catalog-proof-'));
  try {
    const packageRoot = join(fixtureRoot, 'package');
    const binaryPath = join(packageRoot, 'bin', 'snapback');
    const sourceRevision = 'a'.repeat(40);
    const packageName = '@expo/snapback-runtime-linux-x64';
    mkdirSync(join(packageRoot, 'bin'), { recursive: true });
    mkdirSync(join(packageRoot, 'lib'), { recursive: true });
    mkdirSync(join(packageRoot, 'include', 'hermes'), { recursive: true });
    mkdirSync(join(packageRoot, 'admin', '__exact'), { recursive: true });
    writeFileSync(binaryPath, '#!/usr/bin/env node\nprocess.exit(2);\n');
    chmodSync(binaryPath, 0o755);
    writeFileSync(join(packageRoot, 'lib', 'libhermesvm.so'), 'fixture Hermes');
    writeFileSync(
      join(packageRoot, 'include', 'hermes', 'hermes.h.artifact'),
      'fixture Hermes header',
    );
    writeFileSync(join(packageRoot, 'admin', 'index.html'), '<title>Fixture</title>');
    writeFileSync(join(packageRoot, 'admin', '__exact', 'platform-manifest.json'), '{}\n');
    writeAdminConsoleSnapshotManifest({
      root: join(packageRoot, 'admin'),
      sourceRevision,
      sourceDirty: false,
    });

    const buildIdentity = {
      schemaVersion: 'snapback.binary-identity.v1',
      buildDistribution: 'public-package',
      binary: {
        crateVersion: '0.1.0',
        gitCommit: sourceRevision,
        gitDirty: false,
        buildProfile: 'release',
        startupNonce: 'build-identity-fixture',
      },
    };
    produceRuntimePackageSeal({
      root: packageRoot,
      binaryPath,
      packageName,
      platform: 'linux',
      architecture: 'x64',
      buildIdentity,
      sourceRevision,
      qualification: {
        ok: true,
        report: {
          schemaVersion: 'snapback.runtime-qualify.v1',
          probe: 'restricted-no-eval-handler-vm',
          ok: true,
          binary: {
            ...buildIdentity.binary,
            startupNonce: 'qualification-fixture',
          },
        },
      },
      catalogBuildIdentityProof: {
        schemaVersion: 'snapback.runtime-catalog-build-identity-proof.v1',
        source: 'snapback.runtime-artifact-attestation.v4',
        buildIdentity: { sourceCommit: 'b'.repeat(40), dirty: false },
      },
    });

    const tarballPath = join(fixtureRoot, 'runtime-linux-x64.tgz');
    const packed = spawnSync('tar', [
      '-czf', tarballPath,
      '-C', fixtureRoot,
      'package',
    ], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    assert.throws(
      () => verifyPackedRuntimeSeal({
        tarballPath,
        packageName,
        platformId: 'linux-x64',
        hostPlatformId: 'darwin-arm64',
      }),
      (error) => error.code === 'SNAPBACK_RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH',
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
