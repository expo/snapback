import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  aggregatePublicPackageProofs,
  browserAssetsContainSecretCanary,
  browserForbiddenMarkerVariants,
  createBoundedBrowserSurfaceCollector,
  findBrowserVisibleLeaks,
  parseArguments,
  PUBLIC_NPM_REGISTRY,
  resolveInstalledBrowserExecutable,
  runAsync,
  validateFinalLatestReceipts,
  validateLatestRootResolution,
  validatePublicPublicationLedger,
} from './snapback-package-cold-install-lib.mjs';
import { canonicalJcs, sha256Hex } from './snapback-promotion-core.mjs';
import {
  PACKAGE_INVENTORY,
  validateColdInstallBrowserEvidence,
  validateQualifiedPlatformReceipts,
  validateQualifiedStagingLedger,
  validateQualifiedTarballs,
} from './snapback-publish-core.mjs';

const script = fileURLToPath(new URL('./snapback-package-cold-install.mjs', import.meta.url));
const DEFAULT_BROWSER_SOURCE_REVISION = '0'.repeat(40);

test('resolveInstalledBrowserExecutable binds the only installed headless shell', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-browser-executable-'));
  try {
    const browserDirectory = join(
      temporary,
      'chromium_headless_shell-1234',
      'chrome-headless-shell-linux64',
    );
    mkdirSync(browserDirectory, { recursive: true });
    const executable = join(browserDirectory, 'chrome-headless-shell');
    writeFileSync(executable, 'browser');
    assert.equal(resolveInstalledBrowserExecutable(temporary), executable);

    const duplicateDirectory = join(
      temporary,
      'chromium_headless_shell-5678',
      'chrome-linux',
    );
    mkdirSync(duplicateDirectory, { recursive: true });
    writeFileSync(join(duplicateDirectory, 'headless_shell'), 'browser');
    assert.equal(resolveInstalledBrowserExecutable(temporary), null);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

function browserJourneyFixture(overrides = {}) {
  const {
    capture: captureOverrides = {},
    captureSha256: captureSha256Override,
    sourceRevision = DEFAULT_BROWSER_SOURCE_REVISION,
    ...journeyOverrides
  } = overrides;
  const {
    browser: captureBrowserOverrides = {},
    coverage: captureCoverageOverrides = {},
    surfaceManifest: captureSurfaceManifest,
    ...captureFieldOverrides
  } = captureOverrides;
  const surfaceManifest = captureSurfaceManifest ?? [
    { kind: 'request', bytesScanned: 80 },
    { kind: 'response-metadata', bytesScanned: 100 },
    { kind: 'response-body', bytesScanned: 200 },
    { kind: 'response-metadata', bytesScanned: 100 },
    { kind: 'response-body', bytesScanned: 300 },
    { kind: 'websocket-url', bytesScanned: 40 },
    { kind: 'websocket-frame-received', bytesScanned: 120 },
    { kind: 'page-state', bytesScanned: 500 },
    { kind: 'cache-metadata', bytesScanned: 20 },
    { kind: 'indexeddb-metadata', bytesScanned: 20 },
  ];
  const capture = {
    schemaVersion: 'snapback.package-browser-capture.v1',
    sourceRevision,
    startedAtMs: 1_000_000,
    completedAtMs: 1_001_000,
    maxSurfaceBytes: 16 * 1024 * 1024,
    maxTotalBytes: 128 * 1024 * 1024,
    totalBytesScanned: surfaceManifest.reduce((sum, entry) => sum + entry.bytesScanned, 0),
    surfaceManifest,
    coverage: {
      responseBodiesObserved: 2,
      responseBodiesScanned: 2,
      workersObserved: 0,
      workersScanned: 0,
      serviceWorkersObserved: 0,
      serviceWorkersScanned: 0,
      cacheEntriesObserved: 0,
      cacheEntriesScanned: 0,
      indexedDbRecordsObserved: 0,
      indexedDbRecordsScanned: 0,
      scanTruncated: false,
      ...captureCoverageOverrides,
    },
    browser: {
      packageVersion: '1.62.0',
      packageTreeSha256: '8'.repeat(64),
      executableSha256: '9'.repeat(64),
      executableBytes: 1_000_000,
      ...captureBrowserOverrides,
    },
    forbiddenMarkerKindsChecked: [
      'admin-token',
      'admin-token-file',
      'backend-origin',
      'browser-secret-canary',
      'database-path',
      'ready-file',
      'repository-path',
      'runtime-path',
    ],
    captureSanitized: true,
    forbiddenValueRetention: 'none',
    ...captureFieldOverrides,
  };
  return {
    schemaVersion: 'snapback.package-browser-journey.v1',
    browserPackage: 'playwright',
    browserPackageVersion: '1.62.0',
    engine: 'chromium',
    engineVersion: '144.0.7559.0',
    headless: true,
    initialSeededTodoCount: 1,
    postMutationTodoCount: 2,
    reloadedTodoCount: 2,
    liveFramesAfterMutation: 1,
    browserReadableSurfaceCount: capture.surfaceManifest.length,
    forbiddenMarkerKindsChecked: capture.forbiddenMarkerKindsChecked,
    capture,
    captureSha256: captureSha256Override ?? sha256Hex(canonicalJcs(capture)),
    checks: {
      realBrowserRendered: true,
      renderedSeededTodo: true,
      generatedMutationPerformed: true,
      nativeLiveUpdateObserved: true,
      webSocketLiveFrameObserved: true,
      reloadPreservedMutation: true,
      browserReadableBackendOriginAbsent: true,
      browserReadableAdminTokenAbsent: true,
      browserReadableFilesystemPathsAbsent: true,
      browserReadableCanaryAbsent: true,
    },
    ...journeyOverrides,
  };
}

function browserReceiptEvidence(
  sourceRevision = DEFAULT_BROWSER_SOURCE_REVISION,
  overrides = {},
) {
  return {
    sourceRevision,
    browserJourney: browserJourneyFixture({
      sourceRevision,
      ...(overrides.browserJourney ?? {}),
    }),
    checks: {
      packedReactRealBrowserSeedLiveReload: true,
      browserPrivateSurfaceAbsence: true,
      ...(overrides.checks ?? {}),
    },
  };
}

test('browser secret proof allows API field names but refuses an injected canary', () => {
  const canary = `snapback-cold-canary-${'a'.repeat(48)}`;
  const publicApiNames = 'x-snapback-admin-token SNAPBACK_ADMIN_TOKEN';
  assert.equal(browserAssetsContainSecretCanary(publicApiNames, canary), false);
  assert.equal(
    browserAssetsContainSecretCanary(`${publicApiNames} ${canary}`, canary),
    true,
  );
  assert.throws(
    () => browserAssetsContainSecretCanary(publicApiNames, 'guessable'),
    /unguessable/u,
  );
});

test('browser-visible leak scanner reports marker classes without retaining secret values', () => {
  const secret = `snapback-cold-canary-${'b'.repeat(48)}`;
  const backend = 'http://127.0.0.1:45731';
  assert.deepEqual(
    findBrowserVisibleLeaks({
      surfaces: [
        `window.__bad = ${JSON.stringify(secret)}`,
        `fetch(${JSON.stringify(backend)})`,
      ],
      forbiddenMarkers: [
        { kind: 'browser-secret-canary', value: secret },
        { kind: 'backend-origin', value: backend },
        { kind: 'runtime-path', value: '/private/runtime/snapback' },
      ],
    }),
    ['backend-origin', 'browser-secret-canary'],
  );
  assert.throws(
    () => findBrowserVisibleLeaks({
      surfaces: ['safe'],
      forbiddenMarkers: [{ kind: 'admin-token', value: '' }],
    }),
    /non-empty kind\/value pairs/u,
  );
});

test('browser origin scanner normalizes HTTP(S), WS(S), and encoded forms', () => {
  const backend = 'http://127.0.0.1:45731';
  const marker = { kind: 'backend-origin', value: backend };
  assert.ok(browserForbiddenMarkerVariants(marker).includes('ws://127.0.0.1:45731'));
  for (const surface of [
    'ws://127.0.0.1:45731/live/connection/stream',
    'wss://127.0.0.1:45731/live/connection/stream',
    'https://127.0.0.1:45731/health',
    encodeURIComponent(backend),
    encodeURIComponent('ws://127.0.0.1:45731'),
    Buffer.from('wss://127.0.0.1:45731').toString('base64'),
  ]) {
    assert.deepEqual(
      findBrowserVisibleLeaks({ surfaces: [surface], forbiddenMarkers: [marker] }),
      ['backend-origin'],
      surface,
    );
  }
});

test('bounded browser scanner covers binary bytes and retains only sanitized shape', () => {
  const secret = `snapback-cold-canary-${'c'.repeat(48)}`;
  const collector = createBoundedBrowserSurfaceCollector({
    maxSurfaceBytes: 1024,
    maxTotalBytes: 2048,
  });
  collector.add('response-body', Buffer.from(`binary-prefix\0${secret}\0binary-suffix`));
  assert.deepEqual(
    collector.findLeaks([{ kind: 'browser-secret-canary', value: secret }]),
    ['browser-secret-canary'],
  );
  const summary = collector.sanitizedSummary();
  assert.equal(summary.totalBytesScanned, Buffer.byteLength(`binary-prefix\0${secret}\0binary-suffix`));
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(secret, 'u'));
  assert.throws(
    () => collector.add('response-body', Buffer.alloc(1025)),
    /scan bound/u,
  );
});

test('qualified browser evidence fails closed on simulated, non-live, stale, or under-scanned journeys', () => {
  const valid = browserReceiptEvidence();
  assert.equal(validateColdInstallBrowserEvidence(valid), valid.browserJourney);
  for (const mutation of [
    (receipt) => { receipt.browserJourney.headless = false; },
    (receipt) => { receipt.browserJourney.liveFramesAfterMutation = 0; },
    (receipt) => { receipt.browserJourney.reloadedTodoCount = 1; },
    (receipt) => { receipt.browserJourney.checks.nativeLiveUpdateObserved = false; },
    (receipt) => {
      receipt.browserJourney.forbiddenMarkerKindsChecked =
        receipt.browserJourney.forbiddenMarkerKindsChecked.filter((kind) => kind !== 'runtime-path');
    },
    (receipt) => { delete receipt.browserJourney.capture; },
    (receipt) => { receipt.browserJourney.capture.surfaceManifest[0].bytesScanned += 1; },
    (receipt) => { receipt.browserJourney.capture.sourceRevision = 'f'.repeat(40); },
    (receipt) => { receipt.browserJourney.capture.completedAtMs += 11 * 60 * 1000; },
    (receipt) => {
      receipt.browserJourney.capture.coverage.responseBodiesScanned = 1;
      receipt.browserJourney.captureSha256 =
        sha256Hex(canonicalJcs(receipt.browserJourney.capture));
    },
    (receipt) => {
      receipt.browserJourney.capture.browser.executableSha256 = 'not-a-digest';
      receipt.browserJourney.captureSha256 =
        sha256Hex(canonicalJcs(receipt.browserJourney.capture));
    },
    (receipt) => { receipt.checks.browserPrivateSurfaceAbsence = false; },
  ]) {
    const receipt = structuredClone(valid);
    mutation(receipt);
    assert.throws(
      () => validateColdInstallBrowserEvidence(receipt),
      /real-browser seed\/live\/reload\/private-surface proof|unknown or missing members/u,
    );
  }
});

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
  assert.match(result.stdout, /--root-selector <exact\|latest>/u);
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
    ['--root-selector', 'latest'],
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
      rootSelector: 'exact',
    },
  );
});

function closedCandidateFixture() {
  const revision = '1'.repeat(40);
  const version = '0.1.1';
  const candidate = {
    schemaVersion: 'snapback.package-candidate-ledger.v1',
    mode: 'publish',
    sourceDirty: false,
    revision,
    registry: PUBLIC_NPM_REGISTRY,
    tag: `bakeoff-0-1-1-${revision.slice(0, 12)}`,
    scopePreset: 'ccheever',
    version,
    runtimePlatforms: ['darwin-arm64', 'linux-x64'],
    qualifiedLedgerSha256: '2'.repeat(64),
    qualifiedPlatformReceipts: [
      { platform: 'darwin-arm64', sha256: '3'.repeat(64) },
      { platform: 'linux-x64', sha256: '4'.repeat(64) },
    ],
    packages: PACKAGE_INVENTORY.map(([sourceName, name], publicationOrder) => ({
      publicationOrder,
      sourceName,
      name,
      version,
      dependencies: {},
      optionalDependencies: {},
      tarball: `package-${publicationOrder}.tgz`,
      sha256: 'a'.repeat(64),
      runtimeBinarySha256: sourceName.startsWith('@snapback/runtime-')
        ? 'b'.repeat(64)
        : null,
      runtimeSupportSha256: sourceName.startsWith('@snapback/runtime-')
        ? 'c'.repeat(64)
        : null,
      files: 2,
      unpackedSize: 100,
      status: 'published',
      candidateTagVerified: true,
      registrySha256: 'a'.repeat(64),
      registryIntegrity: `sha512-${'d'.repeat(80)}`,
      registryShasum: 'e'.repeat(40),
    })),
  };
  candidate.candidateLedgerSha256 = sha256Hex(canonicalJcs(candidate));
  return candidate;
}

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
    /official npm registry/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({ ...ledger, tag: 'next' }, sourceNames),
    /legacy public ledger must select latest/u,
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

test('candidate ledger validation binds its non-default tag and self-digest', () => {
  const sourceNames = PACKAGE_INVENTORY.map(([sourceName]) => sourceName);
  const candidate = closedCandidateFixture();
  assert.equal(
    validatePublicPublicationLedger(candidate, sourceNames).size,
    sourceNames.length,
  );
  assert.throws(
    () => validatePublicPublicationLedger({
      ...candidate,
      candidateLedgerSha256: 'b'.repeat(64),
    }, sourceNames),
    /self-digest mismatch/u,
  );
  const unverified = structuredClone(candidate);
  unverified.packages[0].candidateTagVerified = false;
  const { candidateLedgerSha256: _digest, ...withoutDigest } = unverified;
  unverified.candidateLedgerSha256 = sha256Hex(canonicalJcs(withoutDigest));
  assert.throws(
    () => validatePublicPublicationLedger(unverified, sourceNames),
    /candidate tag was not verified/u,
  );
  const open = structuredClone(candidate);
  open.unreviewed = true;
  const { candidateLedgerSha256: _openDigest, ...openWithoutDigest } = open;
  open.candidateLedgerSha256 = sha256Hex(canonicalJcs(openWithoutDigest));
  assert.throws(
    () => validatePublicPublicationLedger(open, sourceNames),
    /unknown or missing members/u,
  );
});

test('qualified staging bytes require clean proofs from both platforms', () => {
  const candidate = closedCandidateFixture();
  const qualified = {
    schemaVersion: 'snapback.package-qualified-staging-ledger.v1',
    mode: 'dry-run',
    sourceDirty: false,
    revision: candidate.revision,
    registry: candidate.registry,
    tag: candidate.tag,
    scopePreset: candidate.scopePreset,
    version: candidate.version,
    runtimePlatforms: candidate.runtimePlatforms,
    packages: candidate.packages.map((row) => ({
      publicationOrder: row.publicationOrder,
      sourceName: row.sourceName,
      name: row.name,
      version: row.version,
      dependencies: row.dependencies,
      optionalDependencies: row.optionalDependencies,
      tarball: row.tarball,
      sha256: row.sha256,
      runtimeBinarySha256: row.runtimeBinarySha256,
      runtimeSupportSha256: row.runtimeSupportSha256,
      files: row.files,
      unpackedSize: row.unpackedSize,
      status: 'dry-run-ok',
    })),
  };
  qualified.stagedLedgerSha256 = sha256Hex(canonicalJcs(qualified));
  assert.equal(validateQualifiedStagingLedger(qualified), qualified);
  const record = (platform, architecture, sha256) => ({
    sha256,
    receipt: {
      schemaVersion: 'snapback.package-cold-install.v1',
      ok: true,
      installSource: 'staged',
      rootSelector: 'exact',
      publicationLedgerSchema: qualified.schemaVersion,
      sourceRevision: qualified.revision,
      sourceDirty: false,
      version: qualified.version,
      scopePreset: qualified.scopePreset,
      machine: {
        platform,
        architecture,
        separatelyProvisionedCleanMachine: true,
      },
      packages: qualified.packages.map((row) => ({
        sourceName: row.sourceName,
        publishedName: row.name,
        version: row.version,
        sha256: row.sha256,
      })),
      checks: {
        stagedRegistryAliasResolution: true,
        noSiblingSourceCheckout: true,
        ...browserReceiptEvidence(qualified.revision).checks,
      },
      browserJourney: browserJourneyFixture({ sourceRevision: qualified.revision }),
    },
  });
  const records = [
    record('darwin', 'arm64', '5'.repeat(64)),
    record('linux', 'x64', '6'.repeat(64)),
  ];
  assert.deepEqual(
    validateQualifiedPlatformReceipts({ ledger: qualified, records }),
    [
      { platform: 'darwin-arm64', sha256: '5'.repeat(64) },
      { platform: 'linux-x64', sha256: '6'.repeat(64) },
    ],
  );
  records[1].receipt.packages[0].sha256 = '7'.repeat(64);
  assert.throws(
    () => validateQualifiedPlatformReceipts({ ledger: qualified, records }),
    /staged receipt bytes drifted/u,
  );
});

test('real publication consumes the exact qualified tarballs without restaging', () => {
  const candidate = closedCandidateFixture();
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-qualified-bytes-'));
  try {
    const bytes = Buffer.from('immutable qualified package bytes');
    const digest = sha256Hex(bytes);
    const qualified = {
      schemaVersion: 'snapback.package-qualified-staging-ledger.v1',
      mode: 'dry-run',
      sourceDirty: false,
      revision: candidate.revision,
      registry: candidate.registry,
      tag: candidate.tag,
      scopePreset: candidate.scopePreset,
      version: candidate.version,
      runtimePlatforms: candidate.runtimePlatforms,
      packages: candidate.packages.map((row) => ({
        publicationOrder: row.publicationOrder,
        sourceName: row.sourceName,
        name: row.name,
        version: row.version,
        dependencies: row.dependencies,
        optionalDependencies: row.optionalDependencies,
        tarball: row.tarball,
        sha256: digest,
        runtimeBinarySha256: row.runtimeBinarySha256,
        runtimeSupportSha256: row.runtimeSupportSha256,
        files: row.files,
        unpackedSize: row.unpackedSize,
        status: 'dry-run-ok',
      })),
    };
    qualified.stagedLedgerSha256 = sha256Hex(canonicalJcs(qualified));
    for (const row of qualified.packages) {
      writeFileSync(join(temporary, row.tarball), bytes);
    }
    assert.equal(
      validateQualifiedTarballs({ ledger: qualified, root: temporary }).length,
      9,
    );
    writeFileSync(join(temporary, qualified.packages[4].tarball), 'restaged drift');
    assert.throws(
      () => validateQualifiedTarballs({ ledger: qualified, root: temporary }),
      /qualified tarball bytes changed/u,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('latest-root proof binds the root closure and complete default-tag vector', () => {
  const candidate = closedCandidateFixture();
  const tree = {
    dependencies: {
      '@snapback/cli': {
        version: candidate.version,
        dependencies: {
          '@snapback/client': {
            version: candidate.version,
            dependencies: {
              '@snapback/contract': { version: candidate.version },
            },
          },
          '@snapback/codegen': { version: candidate.version },
          '@snapback/runtime-darwin-arm64': { version: candidate.version },
        },
      },
    },
  };
  const tagVector = Object.fromEntries(candidate.packages.map((row) => [
    row.name,
    row.version,
  ]));
  const resolution = validateLatestRootResolution({
    tree,
    ledger: candidate,
    hostRuntime: '@snapback/runtime-darwin-arm64',
    tagVector,
  });
  assert.equal(resolution.selected, candidate.version);
  assert.equal(Object.keys(resolution.defaultTagVector).length, 9);
  assert.throws(
    () => validateLatestRootResolution({
      tree,
      ledger: candidate,
      hostRuntime: '@snapback/runtime-darwin-arm64',
      tagVector: { ...tagVector, [candidate.packages[0].name]: '0.1.0' },
    }),
    /default-tag vector drifted/u,
  );
});

test('final latest-root receipts are candidate- and platform-closed', () => {
  const candidate = closedCandidateFixture();
  const record = (platform, architecture, receiptSha256) => {
    const hostRuntime = platform === 'darwin'
      ? '@snapback/runtime-darwin-arm64'
      : '@snapback/runtime-linux-x64';
    return {
      sha256: receiptSha256,
      receipt: {
      schemaVersion: 'snapback.package-cold-install.v1',
      ok: true,
      rootSelector: 'latest',
      latestRootResolution: {
        root: '@snapback/cli',
        selected: candidate.version,
        installed: Object.fromEntries([
          '@snapback/cli',
          '@snapback/client',
          '@snapback/codegen',
          '@snapback/contract',
          hostRuntime,
        ].map((sourceName) => [sourceName, candidate.version])),
        defaultTagVector: Object.fromEntries(candidate.packages.map((row) => [
          row.name,
          row.version,
        ])),
      },
      candidateLedgerSha256: candidate.candidateLedgerSha256,
      sourceRevision: candidate.revision,
      sourceDirty: false,
      version: candidate.version,
      scopePreset: candidate.scopePreset,
      installSource: 'public',
      registry: PUBLIC_NPM_REGISTRY,
      machine: {
        platform,
        architecture,
        runtimePackage: hostRuntime,
        separatelyProvisionedCleanMachine: true,
      },
      packages: candidate.packages.map((row) => ({
        sourceName: row.sourceName,
        publishedName: row.name,
        version: row.version,
        sha256: row.sha256,
        registrySha256: row.registrySha256,
      })),
      checks: {
        latestRootCandidateClosure: true,
        publicRegistryTarballDigestMatch: true,
        ...browserReceiptEvidence(candidate.revision).checks,
      },
      browserJourney: browserJourneyFixture({ sourceRevision: candidate.revision }),
    },
    };
  };
  const records = [
    record('darwin', 'arm64', '7'.repeat(64)),
    record('linux', 'x64', '8'.repeat(64)),
  ];
  const final = validateFinalLatestReceipts({
    ledger: candidate,
    records,
  });
  assert.deepEqual(final.map((row) => row.platform), ['darwin-arm64', 'linux-x64']);
  assert.equal(final[0].browserCaptureSha256, records[0].receipt.browserJourney.captureSha256);
  assert.equal(
    final[0].browserExecutableSha256,
    records[0].receipt.browserJourney.capture.browser.executableSha256,
  );
  const vectorDrift = structuredClone(records);
  vectorDrift[0].receipt.latestRootResolution.defaultTagVector[
    candidate.packages[0].name
  ] = '0.1.0';
  assert.throws(
    () => validateFinalLatestReceipts({ ledger: candidate, records: vectorDrift }),
    /tag vector drifted/u,
  );
  const packageDrift = structuredClone(records);
  packageDrift[1].receipt.packages[2].registrySha256 = '9'.repeat(64);
  assert.throws(
    () => validateFinalLatestReceipts({ ledger: candidate, records: packageDrift }),
    /package evidence drifted/u,
  );
  const installedDrift = structuredClone(records);
  installedDrift[0].receipt.latestRootResolution.installed['@snapback/codegen'] = '0.1.0';
  assert.throws(
    () => validateFinalLatestReceipts({ ledger: candidate, records: installedDrift }),
    /installed closure drifted/u,
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
      ...browserReceiptEvidence(ledger.revision).checks,
      packedReactExpoTypecheckAndIosExport: true,
      packagedViteRelativeVersionedSeedSeam: true,
      browserAdapterBundle: true,
    },
    browserJourney: browserJourneyFixture({ sourceRevision: ledger.revision }),
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
  assert.equal(
    aggregate.platforms[0].browserPackageTreeSha256,
    receipts[0].receipt.browserJourney.capture.browser.packageTreeSha256,
  );
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
