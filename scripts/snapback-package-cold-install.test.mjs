import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  aggregatePublicPackageProofs,
  parseArguments,
  PUBLIC_NPM_REGISTRY,
  runAsync,
  validatePublicPublicationLedger,
} from './snapback-package-cold-install-lib.mjs';

const script = fileURLToPath(new URL('./snapback-package-cold-install.mjs', import.meta.url));

function runCli(args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 5_000,
  });
}

test('--help exits before reading the ledger or staging packages', () => {
  const missingLedger = join(tmpdir(), `snapback-cold-install-help-${process.pid}`, 'missing.json');
  const result = runCli(['--ledger', missingLedger, '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage:/u);
  assert.match(result.stdout, /--ledger <path>/u);
  assert.match(result.stdout, /--install-source <staged\|public>/u);
  assert.match(result.stdout, /--registry <url>/u);
  assert.match(result.stdout, /--receipt <path>/u);
  assert.match(result.stdout, /--keep/u);
  assert.equal(result.stderr, '');
});

test('unknown flags and stale positional arguments fail before the proof', () => {
  for (const args of [
    ['--install-source', 'tarball'],
    ['tarball'],
    ['--receipt'],
    ['--install-source', 'somewhere-else'],
    ['--registry', 'file:///tmp/registry'],
    ['--help', '--unknown'],
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1, `unexpected success for ${args.join(' ')}`);
    assert.match(result.stderr, /snapback-package-cold-install:/u);
    assert.doesNotMatch(result.stderr, /publication ledger is missing/u);
  }
});

test('public-install arguments are explicit and normalized', () => {
  assert.deepEqual(
    parseArguments([
      '--install-source', 'public',
      '--registry', 'https://registry.example.test/',
      '--ledger', 'publication.json',
      '--receipt', 'proof.json',
      '--keep',
    ]),
    {
      help: false,
      ledger: 'publication.json',
      installSource: 'public',
      registry: 'https://registry.example.test',
      receipt: 'proof.json',
      keep: true,
    },
  );
});

test('public-install ledger validation requires the complete immutable closure', () => {
  const sourceNames = [
    '@snapback/runtime-darwin-arm64',
    '@snapback/runtime-linux-x64',
    '@snapback/contract',
  ];
  const ledger = {
    schemaVersion: 'snapback.package-publication.v1',
    mode: 'publish',
    sourceDirty: false,
    revision: '0'.repeat(40),
    registry: PUBLIC_NPM_REGISTRY,
    tag: 'latest',
    scopePreset: 'ccheever',
    version: '0.1.0',
    packages: sourceNames.map((sourceName) => ({
      sourceName,
      name: `@ccheever/snapback-${sourceName.slice('@snapback/'.length)}`,
      version: '0.1.0',
      status: 'published',
      sha256: 'a'.repeat(64),
      registrySha256: 'a'.repeat(64),
    })),
  };
  assert.deepEqual(
    [...validatePublicPublicationLedger(ledger, sourceNames).keys()],
    sourceNames,
  );
  assert.throws(
    () => validatePublicPublicationLedger({ ...ledger, mode: 'dry-run' }, sourceNames),
    /successful publication ledger/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({ ...ledger, sourceDirty: undefined }, sourceNames),
    /dirty-source publication ledger/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({
      ...ledger,
      registry: 'https://registry.example.test',
    }, sourceNames),
    /official npm registry under latest/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({ ...ledger, tag: 'next' }, sourceNames),
    /official npm registry under latest/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({
      ...ledger,
      packages: ledger.packages.slice(1),
    }, sourceNames),
    /not the exact expected package closure/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({
      ...ledger,
      packages: ledger.packages.map((entry, index) => (
        index === 0 ? { ...entry, status: 'publish-failed' } : entry
      )),
    }, sourceNames),
    /no successful public status/u,
  );
});

test('aggregate proof requires one public clean receipt for every runtime tuple', () => {
  const sourceNames = [
    '@snapback/runtime-darwin-arm64',
    '@snapback/runtime-linux-x64',
    '@snapback/contract',
  ];
  const ledger = {
    schemaVersion: 'snapback.package-publication.v1',
    mode: 'publish',
    sourceDirty: false,
    revision: '0123456789abcdef0123456789abcdef01234567',
    registry: PUBLIC_NPM_REGISTRY,
    tag: 'latest',
    scopePreset: 'ccheever',
    version: '0.1.0',
    packages: sourceNames.map((sourceName) => ({
      sourceName,
      name: `@ccheever/snapback-${sourceName.slice('@snapback/'.length)}`,
      version: '0.1.0',
      status: 'published',
      sha256: 'a'.repeat(64),
      registrySha256: 'b'.repeat(64),
    })),
  };
  const platformReceipt = (platform, architecture) => ({
    schemaVersion: 'snapback.package-cold-install.v1',
    ok: true,
    platformClaimSatisfied: true,
    sourceRevision: ledger.revision,
    sourceDirty: false,
    publicationMode: 'publish',
    installSource: 'public',
    registry: PUBLIC_NPM_REGISTRY,
    scopePreset: 'ccheever',
    version: '0.1.0',
    machine: {
      platform,
      architecture,
      runtimePackage: platform === 'darwin'
        ? '@snapback/runtime-darwin-arm64'
        : '@snapback/runtime-linux-x64',
      separatelyProvisionedCleanMachine: true,
    },
    packages: ledger.packages.map((entry) => ({
      sourceName: entry.sourceName,
      publishedName: entry.name,
      version: entry.version,
      registrySha256: entry.registrySha256,
    })),
    checks: {
      publicRegistryAliasResolution: true,
      publicRegistryTarballDigestMatch: true,
      registryTarballCount: sourceNames.length,
      noSiblingSourceCheckout: true,
      localCodegenOffline: true,
      remoteCodegenOffline: true,
      packagedCliIntrospection: true,
      packagedRuntimeDoctor: true,
      packagedComparatorProfile: true,
      packagedScaffoldAndOfflineGenerate: true,
      packagedDeployBuildAndVerify: true,
      packagedManagedDevReadyAttachWatchAndStop: true,
      packedReactWebTypecheckTestBuildAndLiveAcceptance: true,
      packedReactOneCommandBackendViteJourney: true,
      packedReactExpoTypecheckAndIosExport: true,
      packagedViteRelativeVersionedSeedSeam: true,
      browserAdapterBundle: true,
    },
  });
  const receipts = [
    {
      path: 'darwin.json',
      sha256: 'c'.repeat(64),
      receipt: platformReceipt('darwin', 'arm64'),
    },
    {
      path: 'linux.json',
      sha256: 'd'.repeat(64),
      receipt: platformReceipt('linux', 'x64'),
    },
  ];
  const aggregate = aggregatePublicPackageProofs({
    ledger,
    expectedSourceNames: sourceNames,
    expectedPlatforms: new Map([
      ['darwin-arm64', '@snapback/runtime-darwin-arm64'],
      ['linux-x64', '@snapback/runtime-linux-x64'],
    ]),
    receipts,
  });
  assert.equal(aggregate.claimSatisfied, true);
  assert.equal(aggregate.platforms.length, 2);
  assert.deepEqual(aggregate.nonclaims, []);
  assert.throws(
    () => aggregatePublicPackageProofs({
      ledger,
      expectedSourceNames: sourceNames,
      expectedPlatforms: new Map([
        ['darwin-arm64', '@snapback/runtime-darwin-arm64'],
        ['linux-x64', '@snapback/runtime-linux-x64'],
      ]),
      receipts: receipts.slice(0, 1),
    }),
    /missing platform receipt: linux-x64/u,
  );
  assert.throws(
    () => aggregatePublicPackageProofs({
      ledger,
      expectedSourceNames: sourceNames,
      expectedPlatforms: new Map([
        ['darwin-arm64', '@snapback/runtime-darwin-arm64'],
        ['linux-x64', '@snapback/runtime-linux-x64'],
      ]),
      receipts: receipts.map((record, index) => index === 0
        ? {
            ...record,
            receipt: {
              ...record.receipt,
              checks: {
                ...record.receipt.checks,
                packagedRuntimeDoctor: false,
              },
            },
          }
        : record),
    }),
    /complete packaged-loop proof/u,
  );
});

test('spawn ENOENT rejects without hanging or escaping the promise', async () => {
  const missingCommand = `snapback-command-that-does-not-exist-${process.pid}`;
  let deadline;
  try {
    await assert.rejects(
      Promise.race([
        runAsync(missingCommand, []),
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('runAsync did not settle after spawn ENOENT')),
            2_000,
          );
        }),
      ]),
      (error) => {
        assert.match(error.message, /failed to spawn/u);
        assert.equal(error.cause?.code, 'ENOENT');
        return true;
      },
    );
  } finally {
    clearTimeout(deadline);
  }
});
