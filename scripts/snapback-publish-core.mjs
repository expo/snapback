import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalJcs, sha256Hex } from './snapback-promotion-core.mjs';

// @ref LLP 0041#nine-package-candidate-promotion--2026-07-28 — the public
// closure is an exact source/public-name vector whose qualified bytes are
// consumed unchanged by candidate publication.
// @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
// — closed ledgers and complete platform receipts prevent local credentials
// from silently becoming publication authority.
export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org';

export const PACKAGE_INVENTORY = Object.freeze([
  ['@snapback/runtime-darwin-arm64', '@ccheever/snapback-runtime-darwin-arm64'],
  ['@snapback/runtime-linux-x64', '@ccheever/snapback-runtime-linux-x64'],
  ['@snapback/contract', '@ccheever/snapback-contract'],
  ['@snapback/client', '@ccheever/snapback-client'],
  ['@snapback/codegen', '@ccheever/snapback-codegen'],
  ['@snapback/react', '@ccheever/snapback-react'],
  ['@snapback/app-cli', '@ccheever/snapback-app-cli'],
  ['@snapback/cli', '@ccheever/snapback-cli'],
  ['@snapback/vite', '@ccheever/snapback-vite'],
]);

export const PROMOTION_PACKAGE_NAMES = Object.freeze([
  '@ccheever/snapback-runtime-darwin-arm64',
  '@ccheever/snapback-runtime-linux-x64',
  '@ccheever/snapback-contract',
  '@ccheever/snapback-client',
  '@ccheever/snapback-codegen',
  '@ccheever/snapback-vite',
  '@ccheever/snapback-react',
  '@ccheever/snapback-app-cli',
  '@ccheever/snapback-cli',
]);

const QUALIFIED_LEDGER_KEYS = [
  'mode',
  'packages',
  'registry',
  'revision',
  'runtimePlatforms',
  'schemaVersion',
  'scopePreset',
  'sourceDirty',
  'stagedLedgerSha256',
  'tag',
  'version',
];
const CANDIDATE_LEDGER_KEYS = [
  'candidateLedgerSha256',
  'mode',
  'packages',
  'qualifiedLedgerSha256',
  'qualifiedPlatformReceipts',
  'registry',
  'revision',
  'runtimePlatforms',
  'schemaVersion',
  'scopePreset',
  'sourceDirty',
  'tag',
  'version',
];
const QUALIFIED_PACKAGE_KEYS = [
  'dependencies',
  'devDependencies',
  'files',
  'name',
  'optionalDependencies',
  'peerDependencies',
  'publicationOrder',
  'runtimeBinarySha256',
  'runtimeSupportSha256',
  'sha256',
  'sourceName',
  'status',
  'tarball',
  'unpackedSize',
  'version',
];
const CANDIDATE_PACKAGE_KEYS = [
  'candidateTagVerified',
  'dependencies',
  'devDependencies',
  'files',
  'name',
  'optionalDependencies',
  'peerDependencies',
  'publicationOrder',
  'registryIntegrity',
  'registrySha256',
  'registryShasum',
  'runtimeBinarySha256',
  'runtimeSupportSha256',
  'sha256',
  'sourceName',
  'status',
  'tarball',
  'unpackedSize',
  'version',
];
const PLATFORM_RECEIPT_KEYS = ['platform', 'sha256'];
const SOURCE_CHECKOUT_KEYS = ['dirty', 'headSha'];
const GITHUB_PROOF_KEYS = [
  'eventName',
  'operationId',
  'ref',
  'repository',
  'runAttempt',
  'runHeadSha',
  'runId',
  'workflowRef',
];
const BROWSER_JOURNEY_KEYS = [
  'browserPackage',
  'browserPackageVersion',
  'browserReadableSurfaceCount',
  'capture',
  'captureSha256',
  'checks',
  'engine',
  'engineVersion',
  'forbiddenMarkerKindsChecked',
  'headless',
  'initialSeededTodoCount',
  'liveFramesAfterMutation',
  'postMutationTodoCount',
  'reloadedTodoCount',
  'schemaVersion',
];
const BROWSER_JOURNEY_CHECK_KEYS = [
  'browserReadableAdminTokenAbsent',
  'browserReadableBackendOriginAbsent',
  'browserReadableCanaryAbsent',
  'browserReadableFilesystemPathsAbsent',
  'generatedMutationPerformed',
  'nativeLiveUpdateObserved',
  'realBrowserRendered',
  'reloadPreservedMutation',
  'renderedSeededTodo',
  'webSocketLiveFrameObserved',
];
const REQUIRED_BROWSER_FORBIDDEN_MARKER_KINDS = [
  'admin-token',
  'admin-token-file',
  'backend-origin',
  'browser-secret-canary',
  'database-path',
  'ready-file',
  'repository-path',
  'runtime-path',
];
const BROWSER_CAPTURE_KEYS = [
  'browser',
  'captureSanitized',
  'materializationBoundary',
  'completedAtMs',
  'coverage',
  'forbiddenMarkerKindsChecked',
  'forbiddenValueRetention',
  'maxSurfaces',
  'maxSurfaceBytes',
  'maxTotalBytes',
  'schemaVersion',
  'sourceDirty',
  'sourceRevision',
  'startedAtMs',
  'surfaceManifest',
  'totalBytesScanned',
];
const BROWSER_CAPTURE_MATERIALIZATION_KEYS = [
  'cdpEventMaterialization',
  'chromiumInternalMaterialization',
  'proofOwnedCopiesAndEncodings',
  'requestPostDataProtocolCapBytes',
  'resourceProtocolCapBytes',
  'totalResourceProtocolCapBytes',
  'unprovableCompletenessPolicy',
];
const BROWSER_CAPTURE_BROWSER_KEYS = [
  'distributionBytes',
  'distributionEntries',
  'distributionSha256',
  'executableBytes',
  'executableSha256',
  'packageTreeBytes',
  'packageTreeEntries',
  'packageTreeSha256',
  'packageVersion',
];
const BROWSER_CAPTURE_COVERAGE_KEYS = [
  'asyncTasksObserved',
  'asyncTasksPeakConcurrency',
  'cacheEntriesObserved',
  'cacheEntriesScanned',
  'consoleArgumentsObserved',
  'consoleArgumentsScanned',
  'consoleMessagesObserved',
  'indexedDbRecordsObserved',
  'indexedDbRecordsScanned',
  'networkResourcesObserved',
  'requestBodiesObserved',
  'requestBodiesScanned',
  'responseBodiesObserved',
  'responseBodiesScanned',
  'scanTruncated',
  'serviceWorkersObserved',
  'serviceWorkersScanned',
  'workersObserved',
  'workersScanned',
  'webSocketFramesObserved',
  'webSocketFramesScanned',
  'webSocketHandshakesObserved',
  'webSocketHandshakesScanned',
];
const BROWSER_CAPTURE_SURFACE_KINDS = new Set([
  'cache-body',
  'cache-metadata',
  'console',
  'console-arg',
  'indexeddb-metadata',
  'indexeddb-record',
  'page-error',
  'page-state',
  'request',
  'request-body',
  'request-headers',
  'response-body',
  'response-headers',
  'response-metadata',
  'service-worker-state',
  'websocket-frame-received',
  'websocket-frame-sent',
  'websocket-handshake-request',
  'websocket-handshake-response',
  'websocket-url',
  'worker-state',
]);

function requireExactKeys(value, keys, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${field} has unknown or missing members`);
  }
}

function assertSha256(value, field) {
  if (!/^[0-9a-f]{64}$/u.test(value ?? '')) {
    throw new TypeError(`${field} must be a lowercase SHA-256`);
  }
}

export function validatePublicationReceiptProvenance(
  receipt,
  {
    expectedRevision,
    expectedWorkflow,
    expectedOperationId = undefined,
  },
) {
  requireExactKeys(receipt?.sourceCheckout, SOURCE_CHECKOUT_KEYS, 'receipt source checkout');
  if (
    receipt.sourceCheckout.headSha !== expectedRevision
    || receipt.sourceCheckout.dirty !== false
  ) {
    throw new TypeError('publication receipt source checkout is not the exact clean revision');
  }
  requireExactKeys(receipt?.githubProof, GITHUB_PROOF_KEYS, 'receipt GitHub proof');
  const proof = receipt.githubProof;
  if (
    proof.repository !== 'ccheever/snapback'
    || !/^[0-9]+$/u.test(proof.runId ?? '')
    || !/^[1-9][0-9]*$/u.test(proof.runAttempt ?? '')
    || !/^[0-9a-f]{40}$/u.test(proof.runHeadSha ?? '')
    || proof.workflowRef
      !== `ccheever/snapback/.github/workflows/${expectedWorkflow}@${proof.ref}`
    || !/^refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/u.test(proof.ref ?? '')
    || !['push', 'workflow_dispatch'].includes(proof.eventName)
    || receipt.machine?.runnerEnvironment !== 'github-hosted'
    || receipt.machine?.separatelyProvisionedCleanMachine !== true
    || String(receipt.machine?.githubRunId) !== proof.runId
    || String(receipt.machine?.githubRunAttempt) !== proof.runAttempt
    || receipt.machine?.githubRepository !== proof.repository
    || receipt.machine?.githubWorkflowSha !== proof.runHeadSha
  ) {
    throw new TypeError('publication receipt lacks exact GitHub-hosted provenance');
  }
  if (
    expectedOperationId !== undefined
    && proof.operationId !== expectedOperationId
  ) {
    throw new TypeError('publication receipt operation correlation drifted');
  }
  return proof;
}

export function validateColdInstallBrowserEvidence(receipt) {
  const journey = receipt?.browserJourney;
  requireExactKeys(journey, BROWSER_JOURNEY_KEYS, 'cold-install browser journey');
  requireExactKeys(journey.checks, BROWSER_JOURNEY_CHECK_KEYS, 'cold-install browser journey checks');
  const capture = journey.capture;
  requireExactKeys(capture, BROWSER_CAPTURE_KEYS, 'cold-install browser capture');
  requireExactKeys(capture.browser, BROWSER_CAPTURE_BROWSER_KEYS, 'cold-install browser identity');
  requireExactKeys(capture.coverage, BROWSER_CAPTURE_COVERAGE_KEYS, 'cold-install browser coverage');
  requireExactKeys(
    capture.materializationBoundary,
    BROWSER_CAPTURE_MATERIALIZATION_KEYS,
    'cold-install browser materialization boundary',
  );
  const manifest = Array.isArray(capture.surfaceManifest) ? capture.surfaceManifest : [];
  let manifestBytes = 0;
  const manifestCounts = new Map();
  let manifestValid = manifest.length > 0;
  for (const entry of manifest) {
    try {
      requireExactKeys(
        entry,
        ['bytesScanned', 'contentSha256', 'kind'],
        'cold-install browser surface',
      );
    } catch {
      manifestValid = false;
      continue;
    }
    if (
      !BROWSER_CAPTURE_SURFACE_KINDS.has(entry.kind)
      || !Number.isSafeInteger(entry.bytesScanned)
      || entry.bytesScanned < 0
      || entry.bytesScanned > capture.maxSurfaceBytes
      || !/^[0-9a-f]{64}$/u.test(entry.contentSha256 ?? '')
    ) {
      manifestValid = false;
      continue;
    }
    manifestBytes += entry.bytesScanned;
    manifestCounts.set(entry.kind, (manifestCounts.get(entry.kind) ?? 0) + 1);
  }
  const markerKindsAgree = (
    Array.isArray(capture.forbiddenMarkerKindsChecked)
    && capture.forbiddenMarkerKindsChecked.length === journey.forbiddenMarkerKindsChecked.length
    && capture.forbiddenMarkerKindsChecked.every(
      (value, index) => value === journey.forbiddenMarkerKindsChecked[index],
    )
  );
  const coverage = capture.coverage;
  const countPairValid = (observed, scanned) => (
    Number.isSafeInteger(observed)
    && observed >= 0
    && observed === scanned
  );
  if (
    journey.schemaVersion !== 'snapback.package-browser-journey.v1'
    || journey.engine !== 'chromium'
    || journey.headless !== true
    || journey.browserPackage !== 'playwright'
    || journey.browserPackageVersion !== '1.62.0'
    || typeof journey.engineVersion !== 'string'
    || journey.engineVersion.length === 0
    || journey.initialSeededTodoCount !== 1
    || journey.postMutationTodoCount !== 2
    || journey.reloadedTodoCount !== 2
    || !Number.isSafeInteger(journey.liveFramesAfterMutation)
    || journey.liveFramesAfterMutation < 1
    || !Number.isSafeInteger(journey.browserReadableSurfaceCount)
    || journey.browserReadableSurfaceCount < 1
    || journey.browserReadableSurfaceCount !== manifest.length
    || !Array.isArray(journey.forbiddenMarkerKindsChecked)
    || journey.forbiddenMarkerKindsChecked.some(
      (value, index, values) => (
        typeof value !== 'string'
        || value.length === 0
        || (index > 0 && values[index - 1] >= value)
      ),
    )
    || REQUIRED_BROWSER_FORBIDDEN_MARKER_KINDS.some(
      (kind) => !journey.forbiddenMarkerKindsChecked.includes(kind),
    )
    || capture.schemaVersion !== 'snapback.package-browser-capture.v1'
    || capture.captureSanitized !== true
    || capture.forbiddenValueRetention !== 'none'
    || capture.materializationBoundary.cdpEventMaterialization
      !== 'not-bounded-by-this-proof'
    || capture.materializationBoundary.chromiumInternalMaterialization
      !== 'not-bounded-by-this-proof'
    || capture.materializationBoundary.proofOwnedCopiesAndEncodings
      !== 'bounded-before-allocation'
    || capture.materializationBoundary.requestPostDataProtocolCapBytes
      !== capture.maxSurfaceBytes
    || capture.materializationBoundary.resourceProtocolCapBytes
      !== capture.maxSurfaceBytes
    || capture.materializationBoundary.totalResourceProtocolCapBytes
      !== capture.maxTotalBytes
    || capture.materializationBoundary.unprovableCompletenessPolicy !== 'fail-closed'
    || capture.sourceRevision !== receipt.sourceRevision
    || capture.sourceDirty !== receipt.sourceDirty
    || capture.sourceDirty !== false
    || !/^[0-9a-f]{40}$/u.test(capture.sourceRevision ?? '')
    || !Number.isSafeInteger(capture.startedAtMs)
    || !Number.isSafeInteger(capture.completedAtMs)
    || capture.startedAtMs <= 0
    || capture.completedAtMs < capture.startedAtMs
    || capture.completedAtMs - capture.startedAtMs > 10 * 60 * 1000
    || !Number.isSafeInteger(capture.maxSurfaceBytes)
    || capture.maxSurfaceBytes < 1
    || !Number.isSafeInteger(capture.maxTotalBytes)
    || capture.maxTotalBytes < capture.maxSurfaceBytes
    || !Number.isSafeInteger(capture.maxSurfaces)
    || capture.maxSurfaces < manifest.length
    || !Number.isSafeInteger(capture.totalBytesScanned)
    || capture.totalBytesScanned < 1
    || capture.totalBytesScanned > capture.maxTotalBytes
    || manifestBytes !== capture.totalBytesScanned
    || !manifestValid
    || !markerKindsAgree
    || manifestCounts.get('page-state') !== 1
    || (manifestCounts.get('request') ?? 0) < 1
    || manifestCounts.get('request') !== coverage.networkResourcesObserved
    || (manifestCounts.get('websocket-url') ?? 0) < 1
    || (manifestCounts.get('websocket-frame-received') ?? 0) < journey.liveFramesAfterMutation
    || (manifestCounts.get('cache-metadata') ?? 0) < 1
    || (manifestCounts.get('indexeddb-metadata') ?? 0) < 1
    || coverage.scanTruncated !== false
    || !Number.isSafeInteger(coverage.asyncTasksObserved)
    || coverage.asyncTasksObserved < 1
    || !Number.isSafeInteger(coverage.asyncTasksPeakConcurrency)
    || coverage.asyncTasksPeakConcurrency < 1
    || coverage.asyncTasksPeakConcurrency > 8
    || !countPairValid(coverage.consoleArgumentsObserved, coverage.consoleArgumentsScanned)
    || !Number.isSafeInteger(coverage.consoleMessagesObserved)
    || coverage.consoleMessagesObserved < 0
    || (manifestCounts.get('console') ?? 0) !== coverage.consoleMessagesObserved
    || (manifestCounts.get('console-arg') ?? 0) !== coverage.consoleArgumentsScanned
    || !Number.isSafeInteger(coverage.networkResourcesObserved)
    || coverage.networkResourcesObserved < 1
    || !countPairValid(coverage.requestBodiesObserved, coverage.requestBodiesScanned)
    || (manifestCounts.get('request-body') ?? 0) !== coverage.requestBodiesScanned
    || !countPairValid(coverage.responseBodiesObserved, coverage.responseBodiesScanned)
    || coverage.responseBodiesScanned < 1
    || manifestCounts.get('response-body') !== coverage.responseBodiesScanned
    || manifestCounts.get('response-metadata') !== coverage.responseBodiesScanned
    || !countPairValid(coverage.workersObserved, coverage.workersScanned)
    || (manifestCounts.get('worker-state') ?? 0) !== coverage.workersScanned
    || !countPairValid(coverage.serviceWorkersObserved, coverage.serviceWorkersScanned)
    || (manifestCounts.get('service-worker-state') ?? 0) !== coverage.serviceWorkersScanned
    || !countPairValid(coverage.cacheEntriesObserved, coverage.cacheEntriesScanned)
    || (manifestCounts.get('cache-body') ?? 0) !== coverage.cacheEntriesScanned
    || !countPairValid(coverage.indexedDbRecordsObserved, coverage.indexedDbRecordsScanned)
    || (manifestCounts.get('indexeddb-record') ?? 0) !== coverage.indexedDbRecordsScanned
    || !countPairValid(coverage.webSocketFramesObserved, coverage.webSocketFramesScanned)
    || (manifestCounts.get('websocket-frame-received') ?? 0)
      + (manifestCounts.get('websocket-frame-sent') ?? 0) !== coverage.webSocketFramesScanned
    || !countPairValid(
      coverage.webSocketHandshakesObserved,
      coverage.webSocketHandshakesScanned,
    )
    || coverage.webSocketHandshakesScanned < 1
    || manifestCounts.get('websocket-handshake-request')
      !== coverage.webSocketHandshakesScanned
    || manifestCounts.get('websocket-handshake-response')
      !== coverage.webSocketHandshakesScanned
    || !/^[0-9a-f]{64}$/u.test(capture.browser.executableSha256 ?? '')
    || !Number.isSafeInteger(capture.browser.executableBytes)
    || capture.browser.executableBytes < 1
    || !/^[0-9a-f]{64}$/u.test(capture.browser.distributionSha256 ?? '')
    || !Number.isSafeInteger(capture.browser.distributionEntries)
    || capture.browser.distributionEntries < 1
    || !Number.isSafeInteger(capture.browser.distributionBytes)
    || capture.browser.distributionBytes < capture.browser.executableBytes
    || !/^[0-9a-f]{64}$/u.test(capture.browser.packageTreeSha256 ?? '')
    || !Number.isSafeInteger(capture.browser.packageTreeEntries)
    || capture.browser.packageTreeEntries < 1
    || !Number.isSafeInteger(capture.browser.packageTreeBytes)
    || capture.browser.packageTreeBytes < 1
    || capture.browser.packageVersion !== journey.browserPackageVersion
    || !/^[0-9a-f]{64}$/u.test(journey.captureSha256 ?? '')
    || journey.captureSha256 !== sha256Hex(canonicalJcs(capture))
    || BROWSER_JOURNEY_CHECK_KEYS.some((key) => journey.checks[key] !== true)
    || receipt.checks?.packedReactRealBrowserSeedLiveReload !== true
    || receipt.checks?.browserPrivateSurfaceAbsence !== true
  ) {
    throw new TypeError('cold-install receipt lacks the real-browser seed/live/reload/private-surface proof');
  }
  return journey;
}

function assertSemver(value, field) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value ?? '')) {
    throw new TypeError(`${field} must be an exact semver`);
  }
}

function withoutField(value, field) {
  const clone = { ...value };
  delete clone[field];
  return clone;
}

export const PACKAGE_DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
]);

export function validateInternalDependencyClosure(row, version) {
  const publicNames = new Set(PACKAGE_INVENTORY.map(([, name]) => name));
  const publicBySource = new Map(PACKAGE_INVENTORY);
  for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
    const entries = row[section] ?? {};
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new TypeError(`${row.name}.${section} must be an object`);
    }
    for (const [dependency, value] of Object.entries(entries)) {
      if (/^(?:workspace:|file:|link:)/u.test(String(value))) {
        throw new TypeError(`${row.name}.${section}.${dependency} is not registry-closed`);
      }
      if (
        publicNames.has(dependency)
        || dependency.startsWith('@ccheever/snapback-')
      ) {
        throw new TypeError(
          `${row.name}.${section}.${dependency} must use the normative @snapback source key`,
        );
      }
      const alias = String(value).match(
        /^npm:(@ccheever\/snapback-[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u,
      );
      if (String(value).includes('@ccheever/snapback-') && !alias) {
        throw new TypeError(`${row.name}.${section}.${dependency} is not an exact alias`);
      }
      if (dependency.startsWith('@snapback/')) {
        if (!publicBySource.has(dependency)) {
          throw new TypeError(`${row.name}.${section}.${dependency} is outside the package inventory`);
        }
        if (!alias || alias[1] !== publicBySource.get(dependency)) {
          throw new TypeError(`${row.name}.${section}.${dependency} is not the decided public alias`);
        }
      } else if (alias) {
        throw new TypeError(
          `${row.name}.${section}.${dependency} aliases an internal package from a non-normative key`,
        );
      }
      if (alias && (!publicNames.has(alias[1]) || alias[2] !== version)) {
        throw new TypeError(`${row.name}.${section}.${dependency} escapes the candidate vector`);
      }
    }
  }
}

function validatePackageRows(ledger, keys, statuses) {
  if (!Array.isArray(ledger.packages) || ledger.packages.length !== PACKAGE_INVENTORY.length) {
    throw new TypeError('ledger is not the exact nine-package closure');
  }
  for (const [index, [sourceName, name]] of PACKAGE_INVENTORY.entries()) {
    const row = ledger.packages[index];
    requireExactKeys(row, keys, `package row ${index}`);
    if (
      row.publicationOrder !== index
      || row.sourceName !== sourceName
      || row.name !== name
      || row.version !== ledger.version
    ) {
      throw new TypeError(`package row ${index} is outside the closed inventory/order`);
    }
    if (!statuses.has(row.status)) {
      throw new TypeError(`package row ${index} has an ineligible status`);
    }
    assertSha256(row.sha256, `${row.name}.sha256`);
    if (!Number.isSafeInteger(row.files) || row.files <= 0
        || !Number.isSafeInteger(row.unpackedSize) || row.unpackedSize <= 0) {
      throw new TypeError(`${row.name} has invalid pack measurements`);
    }
    if (typeof row.tarball !== 'string' || !/^[A-Za-z0-9._-]+\.tgz$/u.test(row.tarball)) {
      throw new TypeError(`${row.name}.tarball is invalid`);
    }
    const runtime = sourceName.startsWith('@snapback/runtime-');
    for (const [field, value] of [
      ['runtimeBinarySha256', row.runtimeBinarySha256],
      ['runtimeSupportSha256', row.runtimeSupportSha256],
    ]) {
      if (runtime) assertSha256(value, `${row.name}.${field}`);
      else if (value !== null) throw new TypeError(`${row.name}.${field} must be null`);
    }
    validateInternalDependencyClosure(row, ledger.version);
  }
}

function validateCommonLedger(ledger) {
  if (
    ledger.registry !== PUBLIC_NPM_REGISTRY
    || ledger.scopePreset !== 'ccheever'
    || ledger.sourceDirty !== false
    || !/^[0-9a-f]{40}$/u.test(ledger.revision ?? '')
  ) {
    throw new TypeError('ledger source/registry identity is not release eligible');
  }
  assertSemver(ledger.version, 'ledger.version');
  const expectedTag = `bakeoff-${ledger.version.replaceAll('.', '-')}-${ledger.revision.slice(0, 12)}`;
  if (ledger.tag !== expectedTag) throw new TypeError('ledger candidate tag is not source-bound');
  if (
    !Array.isArray(ledger.runtimePlatforms)
    || ledger.runtimePlatforms.length !== 2
    || ledger.runtimePlatforms[0] !== 'darwin-arm64'
    || ledger.runtimePlatforms[1] !== 'linux-x64'
  ) {
    throw new TypeError('ledger runtime platform matrix is not closed');
  }
}

export function validateQualifiedStagingLedger(ledger) {
  requireExactKeys(ledger, QUALIFIED_LEDGER_KEYS, 'qualified staging ledger');
  if (
    ledger.schemaVersion !== 'snapback.package-qualified-staging-ledger.v1'
    || ledger.mode !== 'dry-run'
  ) {
    throw new TypeError('unsupported qualified staging ledger');
  }
  validateCommonLedger(ledger);
  validatePackageRows(ledger, QUALIFIED_PACKAGE_KEYS, new Set(['dry-run-ok']));
  assertSha256(ledger.stagedLedgerSha256, 'stagedLedgerSha256');
  if (ledger.stagedLedgerSha256 !== sha256Hex(canonicalJcs(withoutField(
    ledger,
    'stagedLedgerSha256',
  )))) {
    throw new TypeError('qualified staging ledger self-digest mismatch');
  }
  return ledger;
}

export function validateCandidateLedger(ledger) {
  requireExactKeys(ledger, CANDIDATE_LEDGER_KEYS, 'candidate ledger');
  if (
    ledger.schemaVersion !== 'snapback.package-candidate-ledger.v1'
    || ledger.mode !== 'publish'
  ) {
    throw new TypeError('unsupported candidate ledger');
  }
  validateCommonLedger(ledger);
  validatePackageRows(
    ledger,
    CANDIDATE_PACKAGE_KEYS,
    new Set(['published', 'skipped-already-published']),
  );
  assertSha256(ledger.qualifiedLedgerSha256, 'qualifiedLedgerSha256');
  if (
    !Array.isArray(ledger.qualifiedPlatformReceipts)
    || ledger.qualifiedPlatformReceipts.length !== 2
  ) {
    throw new TypeError('candidate ledger must retain two qualified platform receipts');
  }
  for (const [index, platform] of ['darwin-arm64', 'linux-x64'].entries()) {
    const row = ledger.qualifiedPlatformReceipts[index];
    requireExactKeys(row, PLATFORM_RECEIPT_KEYS, `qualified platform receipt ${index}`);
    if (row.platform !== platform) {
      throw new TypeError('qualified platform receipt order/identity drifted');
    }
    assertSha256(row.sha256, `${platform} receipt sha256`);
  }
  for (const row of ledger.packages) {
    if (row.candidateTagVerified !== true) {
      throw new TypeError(`${row.name} candidate tag was not verified`);
    }
    assertSha256(row.registrySha256, `${row.name}.registrySha256`);
    if (row.registrySha256 !== row.sha256) {
      throw new TypeError(`${row.name} registry bytes differ from qualified bytes`);
    }
    if (typeof row.registryIntegrity !== 'string' || row.registryIntegrity.length < 16
        || typeof row.registryShasum !== 'string' || !/^[0-9a-f]{40}$/u.test(row.registryShasum)) {
      throw new TypeError(`${row.name} registry integrity is incomplete`);
    }
  }
  assertSha256(ledger.candidateLedgerSha256, 'candidateLedgerSha256');
  if (ledger.candidateLedgerSha256 !== sha256Hex(canonicalJcs(withoutField(
    ledger,
    'candidateLedgerSha256',
  )))) {
    throw new TypeError('candidate ledger self-digest mismatch');
  }
  return ledger;
}

export function validateQualifiedPlatformReceipts({ ledger, records }) {
  validateQualifiedStagingLedger(ledger);
  if (!Array.isArray(records) || records.length !== 2) {
    throw new TypeError('real publication requires exactly two staged platform receipts');
  }
  const byPlatform = new Map();
  for (const record of records) {
    const receipt = record.receipt;
    validatePublicationReceiptProvenance(receipt, {
      expectedRevision: ledger.revision,
      expectedWorkflow: 'qualified-package-staging.yml',
      expectedOperationId: null,
    });
    if (
      receipt?.schemaVersion !== 'snapback.package-cold-install.v1'
      || receipt.ok !== true
      || receipt.installSource !== 'staged'
      || receipt.rootSelector !== 'exact'
      || receipt.publicationLedgerSchema !== ledger.schemaVersion
      || receipt.sourceRevision !== ledger.revision
      || receipt.sourceDirty !== false
      || receipt.version !== ledger.version
      || receipt.scopePreset !== ledger.scopePreset
      || receipt.machine?.separatelyProvisionedCleanMachine !== true
      || receipt.checks?.stagedRegistryAliasResolution !== true
      || receipt.checks?.noSiblingSourceCheckout !== true
    ) {
      throw new TypeError('staged platform receipt is not a clean qualified proof');
    }
    validateColdInstallBrowserEvidence(receipt);
    const platform = `${receipt.machine.platform}-${receipt.machine.architecture}`;
    if (!['darwin-arm64', 'linux-x64'].includes(platform) || byPlatform.has(platform)) {
      throw new TypeError(`duplicate or unsupported staged platform receipt: ${platform}`);
    }
    const receiptRows = new Map((receipt.packages ?? []).map((row) => [row.sourceName, row]));
    if (receiptRows.size !== PACKAGE_INVENTORY.length) {
      throw new TypeError(`${platform} staged receipt package closure drifted`);
    }
    for (const row of ledger.packages) {
      const observed = receiptRows.get(row.sourceName);
      if (
        observed?.publishedName !== row.name
        || observed.version !== row.version
        || observed.sha256 !== row.sha256
      ) {
        throw new TypeError(`${platform} staged receipt bytes drifted for ${row.sourceName}`);
      }
    }
    assertSha256(record.sha256, `${platform} receipt file sha256`);
    byPlatform.set(platform, record.sha256);
  }
  return ['darwin-arm64', 'linux-x64'].map((platform) => ({
    platform,
    sha256: byPlatform.get(platform),
  }));
}

export function validateQualifiedTarballs({ ledger, root }) {
  validateQualifiedStagingLedger(ledger);
  for (const row of ledger.packages) {
    const path = join(root, row.tarball);
    if (!existsSync(path) || sha256File(path) !== row.sha256) {
      throw new TypeError(`qualified tarball bytes changed: ${row.tarball}`);
    }
  }
  return ledger.packages.map((row) => ({
    sourceName: row.sourceName,
    tarball: row.tarball,
    sha256: row.sha256,
  }));
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
