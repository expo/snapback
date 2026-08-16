import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  LEGACY_PROMOTION_PACKAGE_NAMES,
  PROMOTION_PACKAGE_NAMES,
} from '../packages/snapback-publication-authority/protocol.mjs';
import { canonicalJcs, sha256Hex } from './snapback-promotion-core.mjs';

export {
  LEGACY_PROMOTION_PACKAGE_NAMES,
  PROMOTION_PACKAGE_NAMES,
};
// @ref LLP 0194#amendment-2026-08-09-authored-symbol-lifecycle-facts — the
// publication entry point consumes the same authored-fact validator as the
// registry generator and never infers renames from a symbol-set diff.
export {
  assertNoUndeclaredSymbolRemovals,
  integrateSymbolLifecycle,
  publishedSymbolsSnapshot,
  registrySymbolIdentities,
  SYMBOL_LIFECYCLE_INVALID,
  SYMBOL_REMOVAL_UNDECLARED,
  validatePublishedSymbolsSnapshot,
  validateSymbolLifecycle,
} from './symbol-lifecycle.mjs';

// @ref LLP 0041#nine-package-candidate-promotion--2026-07-28 — the public
// closure is an exact source/public-name vector whose qualified bytes are
// consumed unchanged by candidate publication.
// @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
// — closed ledgers and complete platform receipts prevent local credentials
// from silently becoming publication authority.
export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org';

export const BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS = Object.freeze([
  'BrowserContext.serviceWorkers()',
  'Cache.keys()',
  'CacheStorage.keys()',
  'ConsoleMessage.args()',
  'IDBFactory.databases()',
  'Page.workers()',
  'Performance.getEntriesByType("resource")',
  'Reflect.ownKeys(browser value)',
  'Reflect.ownKeys(globalThis)',
]);

// @ref LLP 0115#open-questions — decision 9: the terminal npm scope is
// @expo/snapback-*, published under the `identity` preset (source name and
// registry name are one identity). Pre-migration artifacts recorded the
// `ccheever` preset's @snapback/* -> @ccheever/snapback-* alias pairs; the
// LEGACY tables keep those artifacts verifiable as lineage.
export const PACKAGE_INVENTORY = Object.freeze([
  ['@expo/snapback-runtime-darwin-arm64', '@expo/snapback-runtime-darwin-arm64'],
  ['@expo/snapback-runtime-linux-x64', '@expo/snapback-runtime-linux-x64'],
  ['@expo/snapback-contract', '@expo/snapback-contract'],
  ['@expo/snapback-client', '@expo/snapback-client'],
  ['@expo/snapback-codegen', '@expo/snapback-codegen'],
  ['@expo/snapback-react', '@expo/snapback-react'],
  // @ref LLP 0253#s31-the-umbrella-package — the exact-name umbrella adds one
  // package to the qualified public closure and no historical lineage alias.
  ['@expo/snapback', '@expo/snapback'],
  ['@expo/snapback-expo', '@expo/snapback-expo'],
  // @ref LLP 0258#phase-2--exponative-durable-custody — this identity-only
  // package enters the 0.1.24 closure as Experimental. Publication does not
  // promote either OS custody claim; those remain gated by the Phase 2 ticket.
  ['@expo/snapback-expo-custody', '@expo/snapback-expo-custody'],
  ['@expo/snapback-app-cli', '@expo/snapback-app-cli'],
  ['@expo/snapback-cli', '@expo/snapback-cli'],
  ['@expo/snapback-vite', '@expo/snapback-vite'],
  ['create-snapback-app', 'create-snapback-app'],
]);

export function npmResultIsPackageNotFound(result) {
  return result?.status !== 0
    && /(?:E404|404 Not Found)/u.test(`${result?.stdout ?? ''}\n${result?.stderr ?? ''}`);
}

export const LEGACY_PACKAGE_INVENTORY = Object.freeze([
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

export const RELEASE_SCOPE_PRESETS = Object.freeze(['identity', 'ccheever']);

export function inventoryForScopePreset(scopePreset) {
  if (scopePreset === 'identity') return PACKAGE_INVENTORY;
  if (scopePreset === 'ccheever') return LEGACY_PACKAGE_INVENTORY;
  throw new TypeError(`unsupported ledger scope preset ${scopePreset}`);
}

export function promotionNamesForScopePreset(scopePreset) {
  if (scopePreset === 'identity') return PROMOTION_PACKAGE_NAMES;
  if (scopePreset === 'ccheever') return LEGACY_PROMOTION_PACKAGE_NAMES;
  throw new TypeError(`unsupported ledger scope preset ${scopePreset}`);
}

export function sourceNamesForScopePreset(scopePreset) {
  return Object.fromEntries(
    inventoryForScopePreset(scopePreset).map(([sourceName]) => [
      sourceName.slice(sourceName.lastIndexOf('/') + 1).replace(/^snapback-/u, ''),
      sourceName,
    ]),
  );
}

const PACKAGED_COMPARATOR_CHECKS = Object.freeze([
  Object.freeze({
    id: 'native-live-delivery',
    name: 'cross-client native live delivery',
  }),
  Object.freeze({
    id: 'atomic-declared-writes',
    name: 'atomic declared write set',
  }),
  Object.freeze({
    id: 'rejected-mutation-rollback',
    name: 'rejected mutation rollback without durable version change',
  }),
  Object.freeze({
    id: 'presence-cleanup',
    name: 'TTL and disconnect presence cleanup',
  }),
  Object.freeze({
    id: 'ephemeral-durable-separation',
    name: 'ephemeral publish does not advance durable version',
  }),
]);
const PACKAGED_COMPARATOR_NONCLAIMS = Object.freeze([
  'browser rendering or framework-hook behavior',
  'hosted-target parity',
  'performance, scale, migration, backup, rollback, and cost properties',
  'dev-asserted identity labels are behavioral witnesses, not authenticated-principal evidence',
]);
const COMPARATOR_RECEIPT_MAX_BYTES = 2 * 1024 * 1024;
export const PUBLICATION_RECEIPT_MAX_BYTES = 32 * 1024 * 1024;
const JSON_STRUCTURE_DEFAULTS = Object.freeze({
  maxDepth: 64,
  maxNodes: 250_000,
  maxProperties: 250_000,
  maxArrayLength: 50_000,
  maxStringBytes: 2 * 1024 * 1024,
  maxTotalStringBytes: 16 * 1024 * 1024,
});

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
const LEGACY_CANDIDATE_LEDGER_KEYS = [
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
const CANDIDATE_LEDGER_KEYS = [
  ...LEGACY_CANDIDATE_LEDGER_KEYS,
  'telemetryCurrentness',
];
const TELEMETRY_CURRENTNESS_KEYS = [
  'acceptedForOrdinaryMerge',
  'acceptedForReleaseOrCapabilityPromotion',
  'ageHours',
  'changedSourceFileCount',
  'changedSourceFiles',
  'changedSourceFilesTruncated',
  'currentDigest',
  'evidenceState',
  'headRevision',
  'maxAgeHours',
  'rollingFullProofRequested',
  'schemaVersion',
  'sourceDigest',
  'sourceRevision',
  'state',
  'valid',
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
const EAS_PROOF_KEYS = [
  'buildId',
  'gitCommitHash',
  'operationId',
  'projectId',
  'runner',
  'workflowFilename',
  'workflowRef',
  'workflowRunId',
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
  'proofInvokedHostCollectionApis',
  'proofInvokedHostCollectionResults',
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

/**
 * Bound untrusted JSON before any recursive canonicalization or semantic
 * validation. Byte limits alone do not bound depth, node fan-out, or the cost
 * of repeatedly encoding one very large string.
 *
 * @ref LLP 0041#retained-comparator-evidence-hardening — every release-proof
 * consumer applies byte and structural envelopes before recursive JCS work.
 */
export function assertBoundedJsonValue(value, label = 'JSON value', limits = {}) {
  const resolved = { ...JSON_STRUCTURE_DEFAULTS, ...limits };
  for (const key of [
    'maxDepth',
    'maxNodes',
    'maxProperties',
    'maxArrayLength',
    'maxStringBytes',
    'maxTotalStringBytes',
  ]) {
    if (!Number.isSafeInteger(resolved[key]) || resolved[key] < 1) {
      throw new TypeError(`${label} ${key} must be a positive safe integer`);
    }
  }
  let nodes = 0;
  let properties = 0;
  let totalStringBytes = 0;
  const pending = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    nodes += 1;
    if (nodes > resolved.maxNodes) {
      throw new RangeError(`${label} exceeded its ${resolved.maxNodes}-node bound`);
    }
    if (current.depth > resolved.maxDepth) {
      throw new RangeError(`${label} exceeded its depth-${resolved.maxDepth} bound`);
    }
    if (typeof current.value === 'string') {
      if (current.value.length > resolved.maxStringBytes) {
        throw new RangeError(`${label} exceeded its string-byte bound`);
      }
      const bytes = Buffer.byteLength(current.value);
      if (bytes > resolved.maxStringBytes) {
        throw new RangeError(`${label} exceeded its string-byte bound`);
      }
      totalStringBytes += bytes;
      if (totalStringBytes > resolved.maxTotalStringBytes) {
        throw new RangeError(`${label} exceeded its total-string-byte bound`);
      }
      continue;
    }
    if (
      current.value === null
      || typeof current.value === 'boolean'
      || (
        typeof current.value === 'number'
        && Number.isFinite(current.value)
      )
    ) {
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > resolved.maxArrayLength) {
        throw new RangeError(`${label} exceeded its array-length bound`);
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }
    if (
      typeof current.value !== 'object'
      || (
        Object.getPrototypeOf(current.value) !== Object.prototype
        && Object.getPrototypeOf(current.value) !== null
      )
    ) {
      throw new TypeError(`${label} contains a non-JSON value`);
    }
    const entries = Object.entries(current.value);
    properties += entries.length;
    if (properties > resolved.maxProperties) {
      throw new RangeError(`${label} exceeded its ${resolved.maxProperties}-property bound`);
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      const keyBytes = Buffer.byteLength(key);
      if (keyBytes > resolved.maxStringBytes) {
        throw new RangeError(`${label} exceeded its key-byte bound`);
      }
      totalStringBytes += keyBytes;
      if (totalStringBytes > resolved.maxTotalStringBytes) {
        throw new RangeError(`${label} exceeded its total-string-byte bound`);
      }
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return value;
}

export function parseBoundedJsonBytes(
  bytes,
  label = 'JSON input',
  {
    maxBytes = PUBLICATION_RECEIPT_MAX_BYTES,
    ...structureLimits
  } = {},
) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError(`${label} must be bytes`);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError(`${label} maxBytes must be a positive safe integer`);
  }
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    throw new RangeError(`${label} exceeded its ${maxBytes}-byte bound`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} is not valid UTF-8`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON: ${error.message}`);
  }
  return assertBoundedJsonValue(parsed, label, structureLimits);
}

export function readBoundedFileBytes(
  path,
  label = 'file',
  maxBytes = PUBLICATION_RECEIPT_MAX_BYTES,
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError(`${label} maxBytes must be a positive safe integer`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new TypeError(`${label} must be a regular file`);
    if (metadata.size < 1 || metadata.size > maxBytes) {
      throw new RangeError(`${label} exceeded its ${maxBytes}-byte bound`);
    }
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const growthProbe = Buffer.alloc(1);
    if (offset !== bytes.byteLength || readSync(descriptor, growthProbe, 0, 1, null) !== 0) {
      throw new TypeError(`${label} changed while it was being read`);
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readBoundedJsonFile(
  path,
  label = 'JSON file',
  {
    maxBytes = PUBLICATION_RECEIPT_MAX_BYTES,
    ...structureLimits
  } = {},
) {
  const bytes = readBoundedFileBytes(path, label, maxBytes);
  return parseBoundedJsonBytes(bytes, label, { maxBytes, ...structureLimits });
}

export function validatePublicationReceiptProvenance(
  receipt,
  {
    allowedRunners = ['github-hosted'],
    expectedRevision,
    expectedWorkflow,
    expectedOperationId = undefined,
    expectedWorkflowHead = undefined,
    // The repository slug followed the decision-9 org move; receipts recorded
    // before the move carry the ccheever/snapback slug and stay verifiable by
    // passing it explicitly.
    expectedRepository = 'expo/snapback',
  },
) {
  if (
    !Array.isArray(allowedRunners)
    || allowedRunners.length === 0
    || allowedRunners.some((runner) => (
      !['eas-hosted', 'github-hosted'].includes(runner)
    ))
  ) {
    throw new TypeError('publication provenance allowed runners are invalid');
  }
  requireExactKeys(receipt?.sourceCheckout, SOURCE_CHECKOUT_KEYS, 'receipt source checkout');
  if (
    receipt.sourceCheckout.headSha !== expectedRevision
    || receipt.sourceCheckout.dirty !== false
  ) {
    throw new TypeError('publication receipt source checkout is not the exact clean revision');
  }
  requireExactKeys(
    receipt?.proofHarnessCheckout,
    SOURCE_CHECKOUT_KEYS,
    'receipt proof harness checkout',
  );
  const hasGithubProof = receipt?.githubProof !== null
    && receipt?.githubProof !== undefined;
  const hasEasProof = receipt?.easProof !== null
    && receipt?.easProof !== undefined;
  if (hasGithubProof && hasEasProof) {
    throw new TypeError(
      'publication receipt carries both GitHub-hosted and EAS-hosted provenance',
    );
  }
  if (!hasGithubProof && !hasEasProof) {
    throw new TypeError(
      'publication receipt carries neither GitHub-hosted nor EAS-hosted provenance',
    );
  }
  const runnerFamily = hasGithubProof ? 'github-hosted' : 'eas-hosted';
  if (!allowedRunners.includes(runnerFamily)) {
    const runnerFamilyLabel = hasGithubProof ? 'GitHub-hosted' : 'EAS-hosted';
    throw new TypeError(
      `publication receipt ${runnerFamilyLabel} provenance is not allowed for this proof`,
    );
  }
  const proofHarness = receipt.proofHarnessCheckout;
  let proof;
  let proofHarnessHead;
  if (hasGithubProof) {
    requireExactKeys(receipt.githubProof, GITHUB_PROOF_KEYS, 'receipt GitHub proof');
    proof = receipt.githubProof;
    proofHarnessHead = proof.runHeadSha;
    if (
      proof.repository !== expectedRepository
      || !/^[0-9]+$/u.test(proof.runId ?? '')
      || !/^[1-9][0-9]*$/u.test(proof.runAttempt ?? '')
      || !/^[0-9a-f]{40}$/u.test(proof.runHeadSha ?? '')
      || proof.workflowRef
        !== `${expectedRepository}/.github/workflows/${expectedWorkflow}@${proof.ref}`
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
  } else {
    requireExactKeys(receipt.easProof, EAS_PROOF_KEYS, 'receipt EAS proof');
    proof = receipt.easProof;
    proofHarnessHead = proof.gitCommitHash;
    const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
    if (
      !uuidPattern.test(proof.buildId ?? '')
      || !uuidPattern.test(proof.projectId ?? '')
      || proof.runner !== 'eas-build'
      || !/^[0-9a-f]{40}$/u.test(proof.gitCommitHash ?? '')
      || typeof proof.workflowRunId !== 'string'
      || proof.workflowRunId.length === 0
      || proof.workflowFilename !== expectedWorkflow
      || proof.workflowRef
        !== `.eas/workflows/${expectedWorkflow}@${proof.gitCommitHash}`
      || proof.gitCommitHash !== expectedRevision
      || receipt.machine?.runnerEnvironment !== 'eas-hosted'
      || receipt.machine?.separatelyProvisionedCleanMachine !== true
      || receipt.machine?.easBuildId !== proof.buildId
      || receipt.machine?.easGitCommitHash !== proof.gitCommitHash
      || receipt.machine?.easOperationId !== proof.operationId
      || receipt.machine?.easProjectId !== proof.projectId
      || receipt.machine?.easRunner !== proof.runner
      || receipt.machine?.easWorkflowFilename !== proof.workflowFilename
      || receipt.machine?.easWorkflowRef !== proof.workflowRef
      || receipt.machine?.easWorkflowRunId !== proof.workflowRunId
    ) {
      throw new TypeError('publication receipt lacks exact EAS-hosted provenance');
    }
  }
  if (
    proofHarness.dirty !== false
    || proofHarness.headSha !== proofHarnessHead
    || receipt.machine?.proofHarnessRevision !== proofHarness.headSha
    || (
      expectedWorkflowHead !== undefined
      && proofHarness.headSha !== expectedWorkflowHead
    )
  ) {
    throw new TypeError('publication receipt proof harness is not the exact clean workflow head');
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
    || capture.materializationBoundary.proofInvokedHostCollectionResults
      !== 'post-return-bounded-not-pre-allocation-bounded'
    || !Array.isArray(capture.materializationBoundary.proofInvokedHostCollectionApis)
    || capture.materializationBoundary.proofInvokedHostCollectionApis.length
      !== BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS.length
    || capture.materializationBoundary.proofInvokedHostCollectionApis.some(
      (value, index) => value !== BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS[index],
    )
    || capture.materializationBoundary.proofOwnedCopiesAndEncodings
      !== 'bounded-before-allocation-after-host-return'
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

export function validateInternalDependencyClosure(row, version, scopePreset = 'identity') {
  const inventory = inventoryForScopePreset(scopePreset);
  const publicNames = new Set(inventory.map(([, name]) => name));
  const publicBySource = new Map(inventory);
  for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
    const entries = row[section] ?? {};
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new TypeError(`${row.name}.${section} must be an object`);
    }
    for (const [dependency, value] of Object.entries(entries)) {
      if (/^(?:workspace:|file:|link:)/u.test(String(value))) {
        throw new TypeError(`${row.name}.${section}.${dependency} is not registry-closed`);
      }
      if (scopePreset === 'identity') {
        // Terminal scope: the source key is the registry identity. Any
        // remaining alias syntax or legacy-scope string is refused loudly
        // rather than silently ignored.
        if (
          dependency.startsWith('@snapback/')
          || dependency.startsWith('@ccheever/snapback-')
          || String(value).includes('@snapback/')
          || String(value).includes('@ccheever/snapback-')
          || String(value).startsWith('npm:')
        ) {
          throw new TypeError(
            `${row.name}.${section}.${dependency} carries a pre-migration scope or alias`,
          );
        }
        if (dependency === '@expo/snapback' || dependency.startsWith('@expo/snapback-')) {
          if (!publicBySource.has(dependency)) {
            throw new TypeError(`${row.name}.${section}.${dependency} is outside the package inventory`);
          }
          if (String(value) !== version) {
            throw new TypeError(`${row.name}.${section}.${dependency} escapes the candidate vector`);
          }
        }
        continue;
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
  const inventory = inventoryForScopePreset(ledger.scopePreset);
  if (!Array.isArray(ledger.packages) || ledger.packages.length !== inventory.length) {
    throw new TypeError(`ledger is not the exact ${inventory.length}-package closure`);
  }
  for (const [index, [sourceName, name]] of inventory.entries()) {
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
    const runtime = sourceName.startsWith('@snapback/runtime-')
      || sourceName.startsWith('@expo/snapback-runtime-');
    for (const [field, value] of [
      ['runtimeBinarySha256', row.runtimeBinarySha256],
      ['runtimeSupportSha256', row.runtimeSupportSha256],
    ]) {
      if (runtime) assertSha256(value, `${row.name}.${field}`);
      else if (value !== null) throw new TypeError(`${row.name}.${field} must be null`);
    }
    validateInternalDependencyClosure(row, ledger.version, ledger.scopePreset);
  }
}

function validateCommonLedger(ledger) {
  if (
    ledger.registry !== PUBLIC_NPM_REGISTRY
    // `identity` is the terminal @expo/snapback-* release preset; `ccheever`
    // stays accepted so pre-migration ledgers remain verifiable lineage.
    || !RELEASE_SCOPE_PRESETS.includes(ledger.scopePreset)
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

function validateTelemetryCurrentness(assessment, revision) {
  requireExactKeys(
    assessment,
    TELEMETRY_CURRENTNESS_KEYS,
    'candidate telemetry currentness assessment',
  );
  if (
    assessment.schemaVersion !== 'snapback.telemetry-phase1-evidence-assessment.v1'
    || assessment.valid !== true
    || assessment.evidenceState !== 'HISTORICAL_VALID'
    || assessment.state !== 'CURRENT'
    || assessment.acceptedForOrdinaryMerge !== true
    || assessment.acceptedForReleaseOrCapabilityPromotion !== true
    || assessment.rollingFullProofRequested !== false
    || assessment.headRevision !== revision
    || !/^[0-9a-f]{40}$/u.test(assessment.sourceRevision ?? '')
  ) {
    throw new TypeError('candidate telemetry evidence is not exact-current');
  }
  assertSha256(assessment.sourceDigest, 'telemetry sourceDigest');
  assertSha256(assessment.currentDigest, 'telemetry currentDigest');
  if (
    assessment.sourceDigest !== assessment.currentDigest
    || !Number.isFinite(assessment.ageHours)
    || assessment.ageHours < 0
    || !Number.isFinite(assessment.maxAgeHours)
    || assessment.maxAgeHours <= 0
    || !Number.isSafeInteger(assessment.changedSourceFileCount)
    || assessment.changedSourceFileCount < 0
    || !Array.isArray(assessment.changedSourceFiles)
    || assessment.changedSourceFiles.length > 50
    || assessment.changedSourceFiles.length > assessment.changedSourceFileCount
    || typeof assessment.changedSourceFilesTruncated !== 'boolean'
    || assessment.changedSourceFiles.some((file) => (
      typeof file !== 'string'
      || file.length === 0
      || file.startsWith('/')
      || file.includes('\n')
      || file.split('/').includes('..')
    ))
  ) {
    throw new TypeError('candidate telemetry currentness detail is invalid');
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
  const carriesTelemetryCurrentness = Object.hasOwn(ledger, 'telemetryCurrentness');
  requireExactKeys(
    ledger,
    carriesTelemetryCurrentness ? CANDIDATE_LEDGER_KEYS : LEGACY_CANDIDATE_LEDGER_KEYS,
    'candidate ledger',
  );
  if (
    ledger.schemaVersion !== 'snapback.package-candidate-ledger.v1'
    || ledger.mode !== 'publish'
  ) {
    throw new TypeError('unsupported candidate ledger');
  }
  validateCommonLedger(ledger);
  if (carriesTelemetryCurrentness) {
    validateTelemetryCurrentness(ledger.telemetryCurrentness, ledger.revision);
  }
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

/**
 * Retain the governed comparator receipt itself, rather than reducing an
 * installed run to a boolean. The installed CLI verifies the full receipt
 * against its own package graph before this outer proof reads it; this second
 * validator binds the retained bytes to the release source/runtime and keeps
 * the mandatory checks, timings, cleanup, and nonclaims auditable later.
 *
 * @ref LLP 0041#nine-package-candidate-promotion--2026-07-28 — package
 * qualification retains the governed comparator receipt itself, not a
 * passing boolean detached from target, binary, timing, cleanup, or nonclaims.
 */
export function validateRetainedComparatorReceipt(packageReceipt, {
  sourceRevision,
  version,
  expectedRuntimeBinarySha256 = null,
  expectedExecutorPackageNames = {
    cli: '@expo/snapback-cli',
    client: '@expo/snapback-client',
  },
} = {}) {
  const receipt = packageReceipt?.comparatorReceipt;
  assertBoundedJsonValue(receipt, 'retained comparator receipt', {
    maxDepth: 16,
    maxNodes: 20_000,
    maxProperties: 20_000,
    maxArrayLength: 2_000,
    maxStringBytes: 256 * 1024,
    maxTotalStringBytes: COMPARATOR_RECEIPT_MAX_BYTES,
  });
  const exactKeys = (value, keys, label) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object`);
    }
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (
      actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])
    ) {
      throw new TypeError(`${label} has unknown or missing members`);
    }
  };
  const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;
  const sha256 = (value) => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
  const safeVersion = (value) => Number.isSafeInteger(value) && value >= 0;
  const sameArray = (left, right) => (
    Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
  );
  exactKeys(receipt, [
    'capabilityGaps',
    'checks',
    'cleanup',
    'diagnostic',
    'durationMs',
    'executorPackages',
    'exitCode',
    'expectedChecks',
    'finishedAtMs',
    'identity',
    'nonclaims',
    'profileId',
    'schemaVersion',
    'startedAtMs',
    'status',
    'title',
  ], 'retained comparator receipt');
  if (
    receipt.schemaVersion !== 'snapback.comparator-receipt.v1'
    || receipt.status !== 'passed'
    || receipt.exitCode !== 0
    || receipt.profileId !== 'package-green-fixture'
    || receipt.title !== 'package comparator green fixture'
    || !Number.isSafeInteger(receipt.startedAtMs)
    || !Number.isSafeInteger(receipt.finishedAtMs)
    || !Number.isSafeInteger(receipt.durationMs)
    || receipt.finishedAtMs < receipt.startedAtMs
    || receipt.durationMs !== receipt.finishedAtMs - receipt.startedAtMs
    || receipt.diagnostic !== null
    || !Array.isArray(receipt.capabilityGaps)
    || receipt.capabilityGaps.length !== 0
  ) {
    throw new TypeError('retained comparator receipt is not one complete passing run');
  }
  const canonicalReceipt = canonicalJcs(receipt);
  if (Buffer.byteLength(canonicalReceipt) > COMPARATOR_RECEIPT_MAX_BYTES) {
    throw new RangeError('retained comparator receipt exceeded its 2 MiB canonical bound');
  }
  const canonicalDigest = sha256Hex(canonicalReceipt);
  if (
    typeof packageReceipt.comparatorReceiptSha256 !== 'string'
    || packageReceipt.comparatorReceiptSha256 !== canonicalDigest
  ) {
    throw new TypeError('retained comparator receipt digest drifted');
  }

  exactKeys(receipt.executorPackages, ['cli', 'client'], 'comparator executor packages');
  const requiredExecutorFiles = {
    cli: [
      'cli.mjs',
      'comparator-profile.mjs',
      'fixtures/comparator/green.config.mjs',
      'package.json',
    ],
    client: ['index.mjs', 'package.json'],
  };
  for (const key of ['cli', 'client']) {
    const expectedName = expectedExecutorPackageNames?.[key];
    const identity = receipt.executorPackages[key];
    exactKeys(
      identity,
      ['algorithm', 'files', 'name', 'sha256', 'version'],
      `comparator executor package ${key}`,
    );
    if (
      !nonEmptyString(expectedName)
      || identity.name !== expectedName
      || identity.version !== version
      || identity.algorithm !== 'sha256-package-files-path-length-content.v1'
      || !sha256(identity.sha256)
      || !Array.isArray(identity.files)
      || identity.files.length < 1
      || identity.files.length > 2_000
      || !requiredExecutorFiles[key].every((file) => identity.files.includes(file))
      || identity.files.some((file, index, files) => (
        !nonEmptyString(file)
        || file.startsWith('/')
        || file.split('/').includes('..')
        || (index > 0 && files[index - 1] >= file)
      ))
    ) {
      throw new TypeError(`retained comparator executor package ${key} drifted`);
    }
  }
  if (
    receipt.executorPackages.cli.sha256 === receipt.executorPackages.client.sha256
    || Object.values(receipt.executorPackages).some(
      ({ sha256: digest }) => /^sha256:([0-9a-f])\1{63}$/u.test(digest),
    )
  ) {
    throw new TypeError('retained comparator executor package digests are vacuous');
  }

  exactKeys(receipt.identity, ['artifact', 'binary', 'target'], 'comparator identity');
  const target = receipt.identity.target;
  exactKeys(
    target,
    ['available', 'databaseMode', 'kind', 'managed', 'profileId', 'serverUrl'],
    'comparator target identity',
  );
  let targetUrl;
  try {
    targetUrl = new URL(target.serverUrl);
  } catch {
    throw new TypeError('retained comparator target URL is invalid');
  }
  if (
    target.available !== true
    || target.kind !== 'local-isolated'
    || target.profileId !== 'local-dev-sqlite-ibex'
    || target.databaseMode !== 'isolated-file'
    || target.managed !== true
    || targetUrl.protocol !== 'http:'
    || !['127.0.0.1', '::1', 'localhost'].includes(targetUrl.hostname)
    || targetUrl.username
    || targetUrl.password
    || targetUrl.pathname !== '/'
    || targetUrl.search
    || targetUrl.hash
  ) {
    throw new TypeError('retained comparator target identity drifted');
  }
  const artifact = receipt.identity.artifact;
  exactKeys(
    artifact,
    ['appId', 'available', 'bundleHash', 'inputsHash', 'schemaHash'],
    'comparator artifact identity',
  );
  if (
    artifact.available !== true
    || artifact.appId !== 'app'
    || !/^sha256:[0-9a-f]{16,64}$/u.test(artifact.bundleHash ?? '')
    || !/^[0-9a-f]{64}$/u.test(artifact.inputsHash ?? '')
    || !/^sha256:[0-9a-f]{16,64}$/u.test(artifact.schemaHash ?? '')
  ) {
    throw new TypeError('retained comparator artifact identity drifted');
  }
  const binary = receipt.identity.binary;
  exactKeys(
    binary,
    [
      'available',
      'buildProfile',
      'crateVersion',
      'gitCommit',
      'gitDirty',
      'path',
      'sha256',
      'startupNonce',
    ],
    'comparator binary identity',
  );
  if (
    binary.available !== true
    || typeof binary.path !== 'string'
    || !binary.path.startsWith('/')
    || !binary.path.endsWith('/snapback')
    || !sha256(binary.sha256)
    || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u.test(binary.crateVersion ?? '')
    || binary.gitCommit !== sourceRevision
    || binary.gitDirty !== false
    || binary.buildProfile !== 'release'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(binary.startupNonce ?? '')
    || (
      expectedRuntimeBinarySha256 !== null
      && binary.sha256 !== `sha256:${expectedRuntimeBinarySha256}`
    )
  ) {
    throw new TypeError('retained comparator binary identity drifted');
  }

  if (
    !Array.isArray(receipt.expectedChecks)
    || !Array.isArray(receipt.checks)
    || receipt.expectedChecks.length !== PACKAGED_COMPARATOR_CHECKS.length
    || receipt.checks.length !== PACKAGED_COMPARATOR_CHECKS.length
  ) {
    throw new TypeError('retained comparator check set is incomplete');
  }
  for (const [index, definition] of PACKAGED_COMPARATOR_CHECKS.entries()) {
    const expectedId = definition.id;
    const expected = receipt.expectedChecks[index];
    exactKeys(expected, ['id', 'name'], `comparator expected check ${index}`);
    const check = receipt.checks[index];
    exactKeys(
      check,
      [
        'details',
        'diagnostic',
        'durationMs',
        'finishedAtMs',
        'id',
        'name',
        'startedAtMs',
        'status',
      ],
      `comparator check ${index}`,
    );
    if (
      expected.id !== expectedId
      || expected.name !== definition.name
      || check.id !== expectedId
      || check.name !== definition.name
      || check.status !== 'passed'
      || check.diagnostic !== null
      || check.details === null
      || typeof check.details !== 'object'
      || Array.isArray(check.details)
      || !Number.isSafeInteger(check.startedAtMs)
      || !Number.isSafeInteger(check.finishedAtMs)
      || !Number.isSafeInteger(check.durationMs)
      || check.startedAtMs < receipt.startedAtMs
      || check.finishedAtMs > receipt.finishedAtMs
      || check.finishedAtMs < check.startedAtMs
      || check.durationMs !== check.finishedAtMs - check.startedAtMs
    ) {
      throw new TypeError(`retained comparator check ${expectedId} drifted`);
    }
    const details = check.details;
    if (expectedId === 'native-live-delivery') {
      exactKeys(details, [
        'actorIdentity',
        'deliveredVersion',
        'identitySources',
        'observerIdentity',
        'subscriptionId',
        'transport',
      ], 'native live-delivery details');
      exactKeys(
        details.identitySources,
        ['actor', 'observer'],
        'native live-delivery identity sources',
      );
      const validIdentitySource = (value) => (
        ['sessions-authenticated', 'dev-asserted', 'fixture-asserted'].includes(value)
      );
      if (
        !nonEmptyString(details.observerIdentity)
        || !nonEmptyString(details.actorIdentity)
        || details.observerIdentity === details.actorIdentity
        || !validIdentitySource(details.identitySources.observer)
        || !validIdentitySource(details.identitySources.actor)
        || details.transport !== 'push'
        || !nonEmptyString(details.subscriptionId)
        || !safeVersion(details.deliveredVersion)
      ) {
        throw new TypeError('retained comparator native live-delivery witness is vacuous');
      }
    } else if (expectedId === 'atomic-declared-writes') {
      exactKeys(details, [
        'afterVersion',
        'beforeVersion',
        'changed',
        'declaredWrites',
      ], 'atomic declared-write details');
      if (
        !sameArray(details.declaredWrites, ['primary', 'activity'])
        || !sameArray(details.changed, details.declaredWrites)
        || !safeVersion(details.beforeVersion)
        || details.afterVersion !== details.beforeVersion + 1
      ) {
        throw new TypeError('retained comparator atomic declared-write witness is vacuous');
      }
    } else if (expectedId === 'rejected-mutation-rollback') {
      exactKeys(details, [
        'afterVersion',
        'beforeVersion',
        'diagnosticCode',
      ], 'rejected-mutation details');
      if (
        !safeVersion(details.beforeVersion)
        || details.afterVersion !== details.beforeVersion
        || !/^SNAPBACK_[A-Z0-9_]+$/u.test(details.diagnosticCode ?? '')
      ) {
        throw new TypeError('retained comparator rejected-mutation witness is vacuous');
      }
    } else if (expectedId === 'presence-cleanup') {
      exactKeys(details, [
        'disconnectRemoved',
        'ttlMs',
        'ttlRemoved',
      ], 'presence cleanup details');
      if (
        details.disconnectRemoved !== true
        || details.ttlRemoved !== true
        || !Number.isSafeInteger(details.ttlMs)
        || details.ttlMs < 1
        || details.ttlMs > 60_000
      ) {
        throw new TypeError('retained comparator presence-cleanup witness is vacuous');
      }
    } else {
      exactKeys(details, [
        'afterVersion',
        'beforeVersion',
      ], 'ephemeral durable-separation details');
      if (
        !safeVersion(details.beforeVersion)
        || details.afterVersion !== details.beforeVersion
      ) {
        throw new TypeError('retained comparator ephemeral durable-separation witness is vacuous');
      }
    }
  }
  exactKeys(
    receipt.cleanup,
    ['attempted', 'errors', 'leaderExited', 'managed', 'ok', 'temporaryStateRemoved'],
    'comparator cleanup',
  );
  if (
    receipt.cleanup.attempted !== true
    || receipt.cleanup.ok !== true
    || receipt.cleanup.managed !== true
    || receipt.cleanup.leaderExited !== true
    || receipt.cleanup.temporaryStateRemoved !== true
    || !Array.isArray(receipt.cleanup.errors)
    || receipt.cleanup.errors.length !== 0
    || !sameArray(receipt.nonclaims, PACKAGED_COMPARATOR_NONCLAIMS)
  ) {
    throw new TypeError('retained comparator cleanup or nonclaims drifted');
  }
  return {
    receiptSha256: canonicalDigest,
    profileId: receipt.profileId,
    binarySha256: binary.sha256,
    executorPackages: {
      cli: identityProjection(receipt.executorPackages.cli),
      client: identityProjection(receipt.executorPackages.client),
    },
    checkIds: PACKAGED_COMPARATOR_CHECKS.map(({ id }) => id),
  };
}

function identityProjection(identity) {
  return {
    name: identity.name,
    version: identity.version,
    sha256: identity.sha256,
  };
}

export function comparatorExecutorPackageNames(ledger) {
  const sourceNames = sourceNamesForScopePreset(ledger?.scopePreset);
  const rows = new Map((ledger?.packages ?? []).map((row) => [row.sourceName, row.name]));
  const names = {
    cli: rows.get(sourceNames.cli),
    client: rows.get(sourceNames.client),
  };
  if (!names.cli || !names.client) {
    throw new TypeError('publication ledger lacks comparator executor packages');
  }
  return names;
}

export function validateQualifiedPlatformReceipts({ ledger, records }) {
  validateQualifiedStagingLedger(ledger);
  if (!Array.isArray(records) || records.length !== 2) {
    throw new TypeError('real publication requires exactly two staged platform receipts');
  }
  const hasUmbrellaPackage = ledger.packages.some(
    (row) => row.sourceName === '@expo/snapback',
  );
  const byPlatform = new Map();
  for (const record of records) {
    const receipt = record.receipt;
    validatePublicationReceiptProvenance(receipt, {
      allowedRunners: ['eas-hosted', 'github-hosted'],
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
      || receipt.checks?.packedExpoChatScaffoldTypecheckStaticAndLiveAcceptance !== true
      || receipt.checks?.packedCreateSnapbackAppScaffoldFromCleanDirectory !== true
      || (hasUmbrellaPackage
        && receipt.checks?.packedUmbrellaDoorwaysFromTarball !== true)
    ) {
      throw new TypeError('staged platform receipt is not a clean qualified proof');
    }
    const platform = `${receipt.machine.platform}-${receipt.machine.architecture}`;
    if (!['darwin-arm64', 'linux-x64'].includes(platform) || byPlatform.has(platform)) {
      throw new TypeError(`duplicate or unsupported staged platform receipt: ${platform}`);
    }
    const runtimeSourceNames = sourceNamesForScopePreset(ledger.scopePreset);
    const hostRuntime = platform === 'darwin-arm64'
      ? runtimeSourceNames['runtime-darwin-arm64']
      : runtimeSourceNames['runtime-linux-x64'];
    validateColdInstallBrowserEvidence(receipt);
    validateRetainedComparatorReceipt(receipt, {
      sourceRevision: ledger.revision,
      version: ledger.version,
      expectedExecutorPackageNames: comparatorExecutorPackageNames(ledger),
      expectedRuntimeBinarySha256:
        ledger.packages.find((row) => row.sourceName === hostRuntime)?.runtimeBinarySha256,
    });
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
