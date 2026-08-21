// CLI-owned done-oracle composition.
//
// @ref LLP 0146#d2-snapback-verify--the-done-oracle — verification composes
// existing authorities in a fixed order and emits a portable, identity-bound
// receipt; it is intentionally not a new acceptance.run host operation.
// @ref LLP 0146#d1-declarationobservation-conformance — registered acceptance
// paths must contribute the exact D1 read/write conformance report. Aggregate
// over-declaration is the intersection across complete observations, so a
// conditionally used table is not mislabeled as dead declaration surface.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from '@expo/snapback-codegen';
import {
  resolveGeneratedArtifact,
  verifyGeneratedGraph,
} from '@expo/snapback-codegen/review-surface';
import { GOVERNANCE_FILES } from '@expo/snapback-codegen/visibility-governance';

export const VERIFY_CONFIG_SCHEMA_VERSION = 'snapback.verify-config.v1';
export const VERIFY_RECEIPT_SCHEMA_VERSION = 'snapback.verify-receipt.v1';
export const VERIFY_CONFIG_CONVENTION = 'snapback.verify.config.mjs';
export const DEFAULT_VERIFY_PROFILE_TIMEOUT_MS = 300_000;
export const CLOUDFLARE_ACCEPTANCE_SCHEMA_VERSION = 'snapback.cloudflare-acceptance.v1';

export const VERIFY_STAGE_IDS = Object.freeze([
  'artifact-freshness',
  'runtime-readiness',
  'admission-and-conformance',
  'capability-resolution',
  'acceptance-profiles',
]);

const PATH_KINDS = new Set([
  'success',
  'failure',
  'action',
  'relational',
  'search',
  'snapshot-bundle',
]);
const REPORT_KEYS = Object.freeze([
  'missingReads',
  'missingWrites',
  'extraReads',
  'extraWrites',
]);
const PROVENANCE = new Set(['complete', 'incomplete', 'unsupported']);
const COVERAGE_REQUIREMENTS = new Set([
  'path-observation',
  'complete-operation-provenance',
]);
const NEXT_BY_STAGE = Object.freeze({
  'artifact-freshness': Object.freeze({
    code: 'SNAPBACK_VERIFY_REGENERATE_ARTIFACTS',
    command: 'snapback generate',
    instruction: 'Regenerate the backend selected by the current working directory, or pass its directory explicitly.',
    reason: 'generated artifacts are absent, invalid, or do not match current source bytes',
  }),
  'runtime-readiness': Object.freeze({
    code: 'SNAPBACK_VERIFY_QUALIFY_RUNTIME',
    command: 'snapback runtime-qualify --persist',
    instruction: 'Qualify the exact local packaged runtime and persist its digest-bound readiness receipt.',
    reason: 'the selected runtime has no valid digest-bound readiness receipt',
  }),
  'admission-and-conformance': Object.freeze({
    code: 'SNAPBACK_VERIFY_FIX_ADMISSION_OR_COVERAGE',
    command: null,
    instruction: 'Fix schema/function admission failures and rerun every registered coverage path.',
    reason: 'generated identities disagree or D1 coverage evidence is missing/under-declared',
  }),
  'capability-resolution': Object.freeze({
    code: 'SNAPBACK_VERIFY_SELECT_CAPABLE_TARGET',
    command: null,
    instruction: 'Select a target profile that supplies every required capability, then regenerate.',
    reason: 'the generated target profile does not satisfy the application and profile requirements',
  }),
  'acceptance-profiles': Object.freeze({
    code: 'SNAPBACK_VERIFY_FIX_ACCEPTANCE',
    command: null,
    instruction: 'Repair the failing registered acceptance profile and rerun snapback verify.',
    reason: 'one or more registered acceptance profiles failed',
  }),
});

function foreignCauseDetails(error, details = undefined) {
  const causeCode = typeof error?.code === 'string' && !error.code.startsWith('SNAPBACK_')
    ? error.code
    : null;
  return {
    ...(details ?? {}),
    ...(causeCode === null ? {} : { causeCode }),
  };
}

function verifyError(code, message, details = undefined) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'verify',
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
}

function assert(condition, message, details = undefined) {
  if (!condition) throw verifyError('SNAPBACK_VERIFY_CONFIG_INVALID', message, details);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableJson(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function diagnostic(code, message, details = undefined, severity = 'error') {
  return Object.freeze({
    code,
    severity,
    subsystem: 'verify',
    message,
    ...(details === undefined ? {} : { details }),
  });
}

function normalizedStringArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  const output = value.map((entry, index) => {
    assert(typeof entry === 'string' && entry.length > 0, `${label}[${index}] must be a non-empty string`);
    return entry;
  });
  assert(new Set(output).size === output.length, `${label} must not contain duplicates`);
  return Object.freeze([...output].sort());
}

function normalizeContext(value = {}) {
  assert(plainObject(value), 'context must be an object');
  const normalizeIdentity = (entry, label, fallbackKind) => {
    const selected = entry ?? { kind: fallbackKind, identity: null };
    assert(plainObject(selected), `context.${label} must be an object`);
    assert(typeof selected.kind === 'string' && selected.kind.length > 0, `context.${label}.kind must be a non-empty string`);
    assert(selected.identity === null || (typeof selected.identity === 'string' && selected.identity.length > 0), `context.${label}.identity must be null or a non-empty string`);
    return Object.freeze({ kind: selected.kind, identity: selected.identity });
  };
  const authority = value.authority ?? {
    kind: 'not-exercised', identity: null, principalClass: 'not-exercised',
  };
  assert(plainObject(authority), 'context.authority must be an object');
  assert(typeof authority.kind === 'string' && authority.kind.length > 0, 'context.authority.kind must be a non-empty string');
  assert(authority.identity === null || (typeof authority.identity === 'string' && authority.identity.length > 0), 'context.authority.identity must be null or a non-empty string');
  assert(typeof authority.principalClass === 'string' && authority.principalClass.length > 0, 'context.authority.principalClass must be a non-empty string');
  return Object.freeze({
    target: normalizeIdentity(value.target, 'target', 'local-generated-artifact'),
    data: normalizeIdentity(value.data, 'data', 'not-exercised'),
    authority: Object.freeze({
      kind: authority.kind,
      identity: authority.identity,
      principalClass: authority.principalClass,
    }),
    seed: normalizeIdentity(value.seed, 'seed', 'not-exercised'),
  });
}

function normalizeServedTarget(value) {
  if (value === undefined || value === null) return null;
  assert(plainObject(value), 'servedTarget must be an object');
  assert(typeof value.url === 'string' && value.url.length > 0, 'servedTarget.url must be a non-empty string');
  let parsed;
  try {
    parsed = new URL(value.url);
  } catch (error) {
    throw verifyError(
      'SNAPBACK_VERIFY_CONFIG_INVALID',
      'servedTarget.url must be an absolute http or https URL',
      foreignCauseDetails(error),
    );
  }
  assert(parsed.protocol === 'http:' || parsed.protocol === 'https:', 'servedTarget.url must use http or https');
  assert(parsed.username === '' && parsed.password === '', 'servedTarget.url must not embed credentials');
  assert(parsed.search === '' && parsed.hash === '', 'servedTarget.url must not include a query or fragment');
  const url = parsed.href.replace(/\/$/u, '');
  const adminTokenEnv = value.adminTokenEnv ?? 'SNAPBACK_ADMIN_TOKEN';
  assert(typeof adminTokenEnv === 'string' && adminTokenEnv.length > 0, 'servedTarget.adminTokenEnv must be a non-empty string');
  const authorityMode = value.authorityMode ?? 'admin-token';
  assert(
    authorityMode === 'admin-token',
    'servedTarget.authorityMode supports only admin-token; sessions-secret-read-lease probing is not implemented',
  );
  const timeoutMs = value.timeoutMs ?? 10_000;
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'servedTarget.timeoutMs must be a positive integer');
  return Object.freeze({ url, adminTokenEnv, authorityMode, timeoutMs });
}

function normalizePath(path, profileId, index) {
  assert(plainObject(path), `profiles[${profileId}].paths[${index}] must be an object`);
  assert(typeof path.id === 'string' && path.id.length > 0, `profiles[${profileId}].paths[${index}].id must be a non-empty string`);
  assert(PATH_KINDS.has(path.kind), `profiles[${profileId}].paths[${index}].kind must be a closed D1 path kind`);
  assert(typeof path.targetProfileId === 'string' && path.targetProfileId.length > 0, `profiles[${profileId}].paths[${index}].targetProfileId must be a non-empty string`);
  assert(path.functionId === null || path.functionId === undefined || (typeof path.functionId === 'string' && path.functionId.length > 0), `profiles[${profileId}].paths[${index}].functionId must be null or a non-empty string`);
  return Object.freeze({
    id: path.id,
    kind: path.kind,
    targetProfileId: path.targetProfileId,
    functionId: path.functionId ?? null,
  });
}

function normalizeCoverageCapability(value, profileId, paths) {
  if (value === undefined || value === null) return null;
  assert(plainObject(value), `profiles[${profileId}].coverageCapability must be an object`);
  assert(
    value.claim === 'identity-bound-path-observation',
    `profiles[${profileId}].coverageCapability.claim must be identity-bound-path-observation`,
  );
  const baselinePathIds = normalizedStringArray(
    value.baselinePathIds ?? [],
    `profiles[${profileId}].coverageCapability.baselinePathIds`,
  );
  const registeredPathIds = new Set(paths.map(({ id }) => id));
  assert(
    baselinePathIds.every((pathId) => registeredPathIds.has(pathId)),
    `profiles[${profileId}].coverageCapability.baselinePathIds must name registered paths`,
  );
  const receiptAddressedPathIds = new Set(paths.flatMap(({ id, functionId }) => (
    functionId === null ? [] : [id]
  )));
  assert(
    baselinePathIds.every((pathId) => receiptAddressedPathIds.has(pathId)),
    `profiles[${profileId}].coverageCapability.baselinePathIds must name paths with receipt-addressed observation identities`,
  );
  return Object.freeze({
    claim: value.claim,
    baselinePathIds,
    readProvenance: 'unsupported',
    writeProvenance: 'unsupported',
  });
}

function normalizeProfile(profile, index, configDirectory) {
  assert(plainObject(profile), `profiles[${index}] must be an object`);
  assert(typeof profile.id === 'string' && profile.id.length > 0, `profiles[${index}].id must be a non-empty string`);
  assert(typeof profile.run === 'function', `profiles[${profile.id}].run must be a function`);
  const paths = (profile.paths ?? []).map((path, pathIndex) => normalizePath(path, profile.id, pathIndex));
  assert(new Set(paths.map(({ id }) => id)).size === paths.length, `profiles[${profile.id}].paths must have unique ids`);
  if (profile.timeoutMs !== undefined) {
    assert(Number.isSafeInteger(profile.timeoutMs) && profile.timeoutMs > 0, `profiles[${profile.id}].timeoutMs must be a positive integer`);
  }
  let testFiles;
  try {
    testFiles = (profile.testFiles ?? []).map((path) => realpathSync(resolve(configDirectory, path))).sort();
  } catch (error) {
    throw verifyError(
      'SNAPBACK_VERIFY_CONFIG_INVALID',
      `profiles[${profile.id}].testFiles contains an unavailable path`,
      foreignCauseDetails(error, { profileId: profile.id }),
    );
  }
  return Object.freeze({
    id: profile.id,
    title: typeof profile.title === 'string' && profile.title.length > 0 ? profile.title : profile.id,
    testFiles: Object.freeze(testFiles),
    requiredCapabilities: normalizedStringArray(profile.requiredCapabilities ?? [], `profiles[${profile.id}].requiredCapabilities`),
    paths: Object.freeze(paths),
    coverageCapability: normalizeCoverageCapability(profile.coverageCapability, profile.id, paths),
    timeoutMs: profile.timeoutMs ?? null,
    run: profile.run,
  });
}

export function defineVerifyConfig(config) {
  assert(plainObject(config), 'verify config must be an object');
  assert(config.schemaVersion === VERIFY_CONFIG_SCHEMA_VERSION, `schemaVersion must be ${VERIFY_CONFIG_SCHEMA_VERSION}`);
  return config;
}

const STARTER_ACCEPTANCE_SCHEMA_VERSION = 'snapback.starter-acceptance.v1';
const STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const STARTER_ACCEPTANCE_MAX_INVALID_PATHS = 64;
const STARTER_ACCEPTANCE_MAX_OPERATION_PATHS = 16;
const STARTER_ACCEPTANCE_MAX_DIAGNOSTIC_MESSAGE_CHARS = 4_096;
const STARTER_ACCEPTANCE_MAX_REMEDIATION_ID_CHARS = 256;
const STARTER_ACCEPTANCE_MAX_DEBUG_OUTPUT_CHARS = 16_384;

function resolveStarterAcceptanceFile(value) {
  if (value instanceof URL) return realpathSync(fileURLToPath(value));
  assert(typeof value === 'string' && value.length > 0, 'starter acceptanceFile must be a path or file URL');
  return realpathSync(resolve(value));
}

function unsupportedConformance(paths) {
  return paths.map(({ id }) => Object.freeze({
    pathId: id,
    status: 'observed',
    report: Object.freeze({
      missingReads: Object.freeze([]),
      missingWrites: Object.freeze([]),
      extraReads: Object.freeze([]),
      extraWrites: Object.freeze([]),
      readProvenance: 'unsupported',
      writeProvenance: 'unsupported',
    }),
  }));
}

function receiptValueKind(value, present = true) {
  if (!present) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function receiptLeaf(parent, key) {
  const present = plainObject(parent) && Object.hasOwn(parent, key);
  return { present, value: present ? parent[key] : undefined };
}

function invalidReceiptPath(path, expectedKind, expectedState, value, present, observedState) {
  return Object.freeze({
    path,
    expected: Object.freeze({ kind: expectedKind, state: expectedState }),
    observed: Object.freeze({
      kind: receiptValueKind(value, present),
      state: present ? observedState : 'missing',
    }),
  });
}

function parseStarterAcceptanceReceipt(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return Object.freeze({ kind: 'missing-receipt', receipt: null, invalidPaths: Object.freeze([
      invalidReceiptPath('$', 'object', 'starter-acceptance-receipt-present', undefined, false, 'missing'),
    ]) });
  }

  const lines = trimmed.split('\n');
  let lastJson;
  let sawJson = false;
  let lastLineLooksLikeJson = false;
  for (const [reverseIndex, line] of [...lines].reverse().entries()) {
    const candidateLine = line.trim();
    if (reverseIndex === 0) {
      lastLineLooksLikeJson = candidateLine.startsWith('{') || candidateLine.startsWith('[');
    }
    try {
      const candidate = JSON.parse(candidateLine);
      if (!sawJson) {
        lastJson = candidate;
        sawJson = true;
      }
      if (candidate?.schemaVersion === STARTER_ACCEPTANCE_SCHEMA_VERSION) {
        return Object.freeze({ kind: 'receipt', receipt: candidate, invalidPaths: Object.freeze([]) });
      }
    } catch {
      // Human-readable output may precede the final JSON receipt. It is not
      // receipt evidence and is never copied into structured diagnostics.
    }
  }

  if (sawJson) {
    const schemaVersion = receiptLeaf(lastJson, 'schemaVersion');
    return Object.freeze({
      kind: 'malformed-receipt',
      receipt: null,
      invalidPaths: Object.freeze([
        plainObject(lastJson)
          ? invalidReceiptPath(
            '$.schemaVersion',
            'string',
            STARTER_ACCEPTANCE_SCHEMA_VERSION,
            schemaVersion.value,
            schemaVersion.present,
            'unexpected',
          )
          : invalidReceiptPath('$', 'object', 'starter-acceptance-receipt', lastJson, true, 'wrong-kind'),
      ]),
    });
  }

  if (lastLineLooksLikeJson) {
    return Object.freeze({ kind: 'malformed-receipt', receipt: null, invalidPaths: Object.freeze([
      invalidReceiptPath('$', 'object', 'valid-json', '', true, 'invalid-json'),
    ]) });
  }

  return Object.freeze({ kind: 'missing-receipt', receipt: null, invalidPaths: Object.freeze([
    invalidReceiptPath('$', 'object', 'starter-acceptance-receipt-present', undefined, false, 'missing'),
  ]) });
}

function operationReceiptPath(key) {
  const boundedKey = key.slice(0, 128);
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(boundedKey)
    ? `$.operations.${boundedKey}`
    : `$.operations[${JSON.stringify(boundedKey)}]`;
}

function boundedRemediationId(key, value) {
  const truncated = value.length > STARTER_ACCEPTANCE_MAX_REMEDIATION_ID_CHARS;
  return {
    [key]: value.slice(0, STARTER_ACCEPTANCE_MAX_REMEDIATION_ID_CHARS),
    [`${key}Truncated`]: truncated,
  };
}

function remediationRegisteredPath(path) {
  return Object.freeze({
    ...boundedRemediationId('pathId', path.id),
    ...(path.functionId === null ? {} : boundedRemediationId('functionId', path.functionId)),
  });
}

function remediationObservedPath({ path, functionId }) {
  return Object.freeze({
    receiptPath: path,
    ...boundedRemediationId('functionId', functionId),
  });
}

function generatedOperationIds(artifact) {
  const functions = artifact?.manifests?.functions?.functions;
  if (!Array.isArray(functions)) return null;
  return new Set(functions.flatMap((entry) => (
    typeof entry?.id === 'string' ? [entry.id] : []
  )));
}

// @ref LLP 0275#d5-make-acceptance-profiles-single-source-and-staleness-aware
// — operation-set drift is one typed stale-registration remediation, not a
// hidden requirement that every domain preserve generic receipt key names.
// @ref LLP 0294#w1--make-proof-commands-trustworthy-and-legible — every other
// incomplete passing receipt reports bounded expected-versus-observed paths.
function validatePassingStarterReceipt(receipt, registeredPaths, artifact) {
  const invalidPaths = [];
  let invalidPathCount = 0;
  const add = (entry) => {
    invalidPathCount += 1;
    if (invalidPaths.length < STARTER_ACCEPTANCE_MAX_INVALID_PATHS) invalidPaths.push(entry);
  };
  const requireLiteral = (path, parent, key, expectedKind, expectedState, predicate) => {
    const leaf = receiptLeaf(parent, key);
    if (!leaf.present || !predicate(leaf.value)) {
      add(invalidReceiptPath(
        path,
        expectedKind,
        expectedState,
        leaf.value,
        leaf.present,
        leaf.present && receiptValueKind(leaf.value) !== expectedKind ? 'wrong-kind' : 'unexpected',
      ));
    }
    return leaf;
  };

  const expectedCheckCount = requireLiteral(
    '$.expectedCheckCount', receipt, 'expectedCheckCount', 'integer', 'positive',
    (value) => Number.isInteger(value) && value > 0,
  );
  const executedCheckCount = requireLiteral(
    '$.executedCheckCount', receipt, 'executedCheckCount', 'integer', 'present', Number.isInteger,
  );
  if (
    expectedCheckCount.present
    && Number.isInteger(expectedCheckCount.value)
    && expectedCheckCount.value > 0
    && executedCheckCount.present
    && Number.isInteger(executedCheckCount.value)
    && executedCheckCount.value !== expectedCheckCount.value
  ) {
    add(invalidReceiptPath(
      '$.executedCheckCount',
      'integer',
      'matches-$.expectedCheckCount',
      executedCheckCount.value,
      true,
      'count-mismatch',
    ));
  }

  const checks = receiptLeaf(receipt, 'checks');
  if (!checks.present || !Array.isArray(checks.value)) {
    add(invalidReceiptPath(
      '$.checks', 'array', 'present', checks.value, checks.present,
      checks.present ? 'wrong-kind' : 'missing',
    ));
  } else {
    if (
      expectedCheckCount.present
      && Number.isInteger(expectedCheckCount.value)
      && expectedCheckCount.value > 0
      && checks.value.length !== expectedCheckCount.value
    ) {
      add(invalidReceiptPath(
        '$.checks.length',
        'integer',
        'matches-$.expectedCheckCount',
        checks.value.length,
        true,
        'count-mismatch',
      ));
    }
    for (const [index, check] of checks.value.entries()) {
      requireLiteral(
        `$.checks[${index}].status`, check, 'status', 'string', 'passed',
        (value) => value === 'passed',
      );
    }
  }

  const identity = receiptLeaf(receipt, 'identity').value;
  const artifactIdentity = receiptLeaf(identity, 'artifact').value;
  const loadedIdentity = receiptLeaf(identity, 'loaded').value;
  const artifactAppId = requireLiteral(
    '$.identity.artifact.appId', artifactIdentity, 'appId', 'string', 'present',
    (value) => typeof value === 'string',
  );
  // LLP 0146 D2 binds the loaded and generated identities by equality; it
  // does not require a bundle hash on receipt classes where both sides omit it.
  let artifactBundleHash = receiptLeaf(artifactIdentity, 'bundleHash');
  const loadedAppId = requireLiteral(
    '$.identity.loaded.appId', loadedIdentity, 'appId', 'string', 'present',
    (value) => typeof value === 'string',
  );
  let loadedBundleHash = receiptLeaf(loadedIdentity, 'bundleHash');
  if (artifactBundleHash.present || loadedBundleHash.present) {
    artifactBundleHash = requireLiteral(
      '$.identity.artifact.bundleHash', artifactIdentity, 'bundleHash', 'string', 'present',
      (value) => typeof value === 'string',
    );
    loadedBundleHash = requireLiteral(
      '$.identity.loaded.bundleHash', loadedIdentity, 'bundleHash', 'string', 'present',
      (value) => typeof value === 'string',
    );
  }
  if (
    artifactAppId.present && typeof artifactAppId.value === 'string'
    && loadedAppId.present && typeof loadedAppId.value === 'string'
    && loadedAppId.value !== artifactAppId.value
  ) {
    add(invalidReceiptPath(
      '$.identity.loaded.appId', 'string', 'matches-$.identity.artifact.appId',
      loadedAppId.value, true, 'identity-mismatch',
    ));
  }
  if (
    artifactBundleHash.present && typeof artifactBundleHash.value === 'string'
    && loadedBundleHash.present && typeof loadedBundleHash.value === 'string'
    && loadedBundleHash.value !== artifactBundleHash.value
  ) {
    add(invalidReceiptPath(
      '$.identity.loaded.bundleHash', 'string', 'matches-$.identity.artifact.bundleHash',
      loadedBundleHash.value, true, 'identity-mismatch',
    ));
  }

  const lifecycle = receiptLeaf(receipt, 'lifecycle').value;
  requireLiteral('$.lifecycle.owned', lifecycle, 'owned', 'boolean', 'true', (value) => value === true);
  requireLiteral(
    '$.lifecycle.applicationReadyObserved', lifecycle, 'applicationReadyObserved',
    'boolean', 'true', (value) => value === true,
  );
  requireLiteral(
    '$.lifecycle.waitLevel', lifecycle, 'waitLevel', 'string', 'application',
    (value) => value === 'application',
  );
  requireLiteral(
    '$.lifecycle.firstQueryRetries', lifecycle, 'firstQueryRetries', 'integer', 'zero',
    (value) => value === 0,
  );

  const operationsLeaf = receiptLeaf(receipt, 'operations');
  const operations = operationsLeaf.value;
  const currentOperationIds = generatedOperationIds(artifact);
  const registeredOperationPaths = registeredPaths.filter(({ functionId }) => functionId !== null);
  const registeredOperationIds = new Set(registeredOperationPaths.map(({ functionId }) => functionId));
  const observations = [];
  if (currentOperationIds === null) {
    add(invalidReceiptPath(
      '$.operations', 'generated-operation-manifest', 'available', operations,
      operationsLeaf.present, 'unavailable',
    ));
  }
  if (!operationsLeaf.present || !plainObject(operations)) {
    add(invalidReceiptPath(
      '$.operations', 'object', 'generated-operation-observations', operations,
      operationsLeaf.present, operationsLeaf.present ? 'wrong-kind' : 'missing',
    ));
  } else {
    for (const key of Object.keys(operations).sort()) {
      const path = operationReceiptPath(key);
      const functionId = operations[key];
      if (typeof functionId !== 'string') {
        add(invalidReceiptPath(
          path, 'string', 'generated-operation-reference-id', functionId, true, 'wrong-kind',
        ));
        continue;
      }
      const current = currentOperationIds?.has(functionId) === true;
      const registered = registeredOperationIds.has(functionId);
      if (!current && !registered) continue;
      if (!current) {
        add(invalidReceiptPath(
          path, 'string', 'current-generated-operation-reference-id', functionId, true,
          'stale-or-unknown-operation',
        ));
      }
      observations.push(Object.freeze({ path, functionId, current }));
    }
  }
  const observedCurrentIds = new Set(
    observations.filter(({ current }) => current).map(({ functionId }) => functionId),
  );
  const observedPathIds = new Set(registeredOperationPaths.flatMap(({ id, functionId }) => (
    observedCurrentIds.has(functionId) ? [id] : []
  )));
  const staleRegistrationPaths = registeredOperationPaths.filter(({ functionId }) => (
    currentOperationIds !== null && !currentOperationIds.has(functionId)
  ));
  const unobservedRegistrationPaths = registeredOperationPaths.filter(({ functionId }) => (
    currentOperationIds?.has(functionId) === true
    && !observedCurrentIds.has(functionId)
  ));
  const unclaimedObservations = observations.filter(({ functionId, current }) => (
    current && !registeredOperationIds.has(functionId)
  ));
  let remediation = null;
  if (registeredOperationPaths.length === 0) {
    add(invalidReceiptPath(
      '$.operations',
      'generated-operation-registration',
      'profile-paths-bound',
      operations,
      operationsLeaf.present,
      'unbound-registration',
    ));
  } else if (staleRegistrationPaths.length > 0 || unobservedRegistrationPaths.length > 0) {
    add(invalidReceiptPath(
      '$.operations',
      'generated-operation-registration',
      'registered-identities-observed',
      operations,
      operationsLeaf.present,
      staleRegistrationPaths.length > 0 ? 'stale-registration' : 'registered-not-observed',
    ));
  }
  if (staleRegistrationPaths.length > 0) {
    remediation = Object.freeze({
      kind: 'refresh-generated-operation-registration',
      staleRegistrationPaths: Object.freeze(staleRegistrationPaths
        .slice(0, STARTER_ACCEPTANCE_MAX_OPERATION_PATHS)
        .map(remediationRegisteredPath)),
      staleRegistrationPathsTruncated:
        staleRegistrationPaths.length > STARTER_ACCEPTANCE_MAX_OPERATION_PATHS,
      registeredPaths: Object.freeze(registeredPaths
        .slice(0, STARTER_ACCEPTANCE_MAX_OPERATION_PATHS)
        .map(remediationRegisteredPath)),
      registeredPathsTruncated: registeredPaths.length > STARTER_ACCEPTANCE_MAX_OPERATION_PATHS,
      unclaimedOperationPaths: Object.freeze(unclaimedObservations
        .slice(0, STARTER_ACCEPTANCE_MAX_OPERATION_PATHS)
        .map(remediationObservedPath)),
      unclaimedOperationPathsTruncated:
        unclaimedObservations.length > STARTER_ACCEPTANCE_MAX_OPERATION_PATHS,
      instruction: 'Refresh the starter acceptance registration from generated operation references and rerun snapback verify.',
    });
  }

  const cleanup = receiptLeaf(receipt, 'cleanup').value;
  requireLiteral('$.cleanup.attempted', cleanup, 'attempted', 'boolean', 'true', (value) => value === true);
  requireLiteral(
    '$.cleanup.clientResourcesReleased', cleanup, 'clientResourcesReleased',
    'boolean', 'true', (value) => value === true,
  );
  requireLiteral('$.cleanup.devExited', cleanup, 'devExited', 'boolean', 'true', (value) => value === true);
  requireLiteral(
    '$.cleanup.temporaryStateRemoved', cleanup, 'temporaryStateRemoved',
    'boolean', 'true', (value) => value === true,
  );
  requireLiteral('$.cleanup.ok', cleanup, 'ok', 'boolean', 'true', (value) => value === true);
  requireLiteral('$.diagnostic', receipt, 'diagnostic', 'null', 'null', (value) => value === null);

  return Object.freeze({
    complete: invalidPathCount === 0,
    invalidPathCount,
    invalidPaths: Object.freeze(invalidPaths),
    invalidPathsTruncated: invalidPathCount > invalidPaths.length,
    remediation,
    observedPathIds: Object.freeze([...observedPathIds]),
  });
}

async function runStarterAcceptanceProfile({ acceptanceFile, artifact, identityContext, paths, timeoutMs }) {
  const child = spawn(process.execPath, [acceptanceFile], {
    cwd: dirname(acceptanceFile),
    env: { ...process.env, SNAPBACK_VERIFY_PROFILE: 'starter-acceptance' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let overflow = false;
  let timedOut = false;
  let killTimeout = null;
  const append = (current, chunk) => {
    const next = `${current}${chunk.toString('utf8')}`;
    if (Buffer.byteLength(next) > STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES) {
      overflow = true;
      child.kill('SIGTERM');
      return next.slice(-STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES);
    }
    return next;
  };
  child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killTimeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  }, timeoutMs);
  const exit = await new Promise((resolveExit) => {
    child.once('error', (error) => resolveExit({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolveExit({ code, signal, error: null }));
  });
  clearTimeout(timeout);
  if (killTimeout !== null) clearTimeout(killTimeout);

  const parsed = parseStarterAcceptanceReceipt(stdout);
  const receipt = parsed.receipt;
  const processFailed = exit.error !== null || exit.code !== 0;
  const receiptValidation = parsed.kind === 'receipt'
    ? validatePassingStarterReceipt(receipt, paths, artifact)
    : null;
  const passingValidation = receipt?.status === 'passed' ? receiptValidation : null;
  const ok = !overflow
    && !timedOut
    && !processFailed
    && parsed.kind === 'receipt'
    && passingValidation?.complete === true;
  const candidateCauseCode = exit.error?.code ?? receipt?.diagnostic?.code ?? null;
  const causeCode = typeof candidateCauseCode === 'string'
    && /^[A-Z][A-Z0-9_]{0,255}$/u.test(candidateCauseCode)
    ? candidateCauseCode
    : null;
  const outcome = overflow || timedOut
    ? 'process-failure'
    : receipt?.status === 'failed'
      ? 'failed-receipt'
      : processFailed
      ? 'process-failure'
      : parsed.kind === 'missing-receipt'
        ? 'missing-receipt'
        : parsed.kind === 'malformed-receipt' || receipt?.status !== 'passed'
          ? 'malformed-receipt'
          : 'incomplete-passing-receipt';
  const diagnosticCode = overflow
    ? 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_OUTPUT_LIMIT'
    : timedOut
      ? 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_TIMEOUT'
      : 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED';
  const diagnosticMessage = overflow
    ? 'starter acceptance exceeded the bounded output limit'
    : timedOut
      ? `starter acceptance exceeded its ${timeoutMs}ms timeout`
      : outcome === 'failed-receipt'
        ? 'starter acceptance returned a failed receipt'
        : outcome === 'process-failure'
          ? receipt?.status === 'passed'
            ? 'starter acceptance process failed despite returning a passing receipt'
            : 'starter acceptance process failed before returning a receipt'
          : outcome === 'missing-receipt'
            ? 'starter acceptance did not return a receipt'
            : outcome === 'malformed-receipt'
              ? 'starter acceptance returned a malformed receipt'
              : 'starter acceptance returned a passing receipt with incomplete evidence';
  const invalidPaths = parsed.kind === 'receipt'
    ? passingValidation?.invalidPaths ?? Object.freeze([
      invalidReceiptPath(
        '$.status', 'string', 'passed-or-failed', receipt?.status,
        plainObject(receipt) && Object.hasOwn(receipt, 'status'), 'unexpected',
      ),
    ])
    : parsed.invalidPaths;
  const diagnostics = ok ? [] : [diagnostic(
    diagnosticCode,
    diagnosticMessage,
    {
      acceptanceFile,
      outcome,
      ...(outcome === 'process-failure' || outcome === 'failed-receipt' ? {
        exitCode: exit.code,
        signal: exit.signal,
        receiptStatus: receipt?.status === 'passed' || receipt?.status === 'failed' ? receipt.status : null,
        expectedCheckCount: Number.isInteger(receipt?.expectedCheckCount) ? receipt.expectedCheckCount : null,
        executedCheckCount: Number.isInteger(receipt?.executedCheckCount) ? receipt.executedCheckCount : null,
      } : {}),
      ...((outcome === 'malformed-receipt' || outcome === 'missing-receipt' || outcome === 'incomplete-passing-receipt') ? {
        invalidPathCount: passingValidation?.invalidPathCount ?? invalidPaths.length,
        invalidPaths,
        invalidPathsTruncated: passingValidation?.invalidPathsTruncated ?? false,
      } : {}),
      ...(passingValidation?.remediation === null || passingValidation?.remediation === undefined
        ? {}
        : { remediation: passingValidation.remediation }),
      ...(typeof causeCode === 'string' ? { causeCode } : {}),
    },
  )];
  const receiptDiagnosticMessage = typeof receipt?.diagnostic?.message === 'string'
    ? receipt.diagnostic.message
    : '';
  const childErrorMessage = typeof exit.error?.message === 'string' ? exit.error.message : '';
  return Object.freeze({
    ok,
    context: identityContext,
    conformance: Object.freeze(unsupportedConformance(paths.filter(({ id }) => (
      passingValidation === null
      || passingValidation.observedPathIds.includes(id)
    )))),
    diagnostics: Object.freeze(diagnostics),
    unsafeDebug: Object.freeze({
      warning: 'May contain application-controlled values; do not publish as structured diagnostics.',
      stderr: stderr.slice(-STARTER_ACCEPTANCE_MAX_DEBUG_OUTPUT_CHARS),
      stderrTruncated: stderr.length > STARTER_ACCEPTANCE_MAX_DEBUG_OUTPUT_CHARS,
      receiptDiagnosticMessage: receiptDiagnosticMessage
        .slice(0, STARTER_ACCEPTANCE_MAX_DIAGNOSTIC_MESSAGE_CHARS),
      receiptDiagnosticMessageTruncated:
        receiptDiagnosticMessage.length > STARTER_ACCEPTANCE_MAX_DIAGNOSTIC_MESSAGE_CHARS,
      childErrorMessage: childErrorMessage.slice(0, STARTER_ACCEPTANCE_MAX_DIAGNOSTIC_MESSAGE_CHARS),
      childErrorMessageTruncated:
        childErrorMessage.length > STARTER_ACCEPTANCE_MAX_DIAGNOSTIC_MESSAGE_CHARS,
    }),
  });
}

// @ref LLP 0196#program — scaffold proof commands register the existing live
// starter acceptance under LLP 0146 D2; this adapter runs that receipt instead
// of creating a second verifier or duplicating its product assertions.
// @ref LLP 0294#w7--turn-shipped-primitives-into-discoverable-application-workflows
// — starter acceptance claims identity-bound path observation, while its
// unsupported operation-provenance baseline is rendered once as a nonclaim.
export function defineStarterVerifyProfile({
  id,
  title = id,
  acceptanceFile,
  additionalTestFiles = [],
  requiredCapabilities = [],
  paths = [],
  provenanceBaseline = [],
  timeoutMs = 180_000,
}) {
  assert(typeof id === 'string' && id.length > 0, 'starter profile id must be a non-empty string');
  assert(typeof title === 'string' && title.length > 0, 'starter profile title must be a non-empty string');
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0, 'starter profile timeoutMs must be a positive integer');
  const resolvedAcceptanceFile = resolveStarterAcceptanceFile(acceptanceFile);
  const resolvedAdditionalTestFiles = additionalTestFiles.map((file) => (
    resolveStarterAcceptanceFile(file)
  ));
  const normalizedPaths = Object.freeze(paths.map((path, index) => normalizePath(path, id, index)));
  const coverageCapability = normalizeCoverageCapability({
    claim: 'identity-bound-path-observation',
    baselinePathIds: provenanceBaseline,
  }, id, normalizedPaths);
  return Object.freeze({
    id,
    title,
    testFiles: Object.freeze([resolvedAcceptanceFile, ...resolvedAdditionalTestFiles]),
    requiredCapabilities: Object.freeze([...requiredCapabilities]),
    paths: normalizedPaths,
    coverageCapability,
    run(context) {
      return runStarterAcceptanceProfile({
        acceptanceFile: resolvedAcceptanceFile,
        artifact: context.artifact,
        identityContext: context.identityContext,
        paths: normalizedPaths,
        timeoutMs,
      });
    },
  });
}

async function runRepositoryAcceptanceCommand({ command, cwd, timeoutMs }) {
  const child = spawn(command, {
    cwd,
    env: { ...process.env, SNAPBACK_VERIFY_PROFILE: 'repository-acceptance-adapter' },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let overflow = false;
  let killTimeout = null;
  const append = (current, chunk) => {
    const next = `${current}${chunk.toString('utf8')}`;
    if (Buffer.byteLength(next) <= STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES) return next;
    overflow = true;
    child.kill('SIGTERM');
    return next.slice(-STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES);
  };
  child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killTimeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  }, timeoutMs);
  const exit = await new Promise((resolveExit) => {
    child.once('error', (error) => resolveExit({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolveExit({ code, signal, error: null }));
  });
  clearTimeout(timer);
  if (killTimeout !== null) clearTimeout(killTimeout);
  return Object.freeze({
    ok: !overflow && !timedOut && exit.error === null && exit.code === 0,
    overflow,
    timedOut,
    exit,
    stdout,
    stderr,
  });
}

// @ref LLP 0146#d1-declarationobservation-conformance — the repository demo
// catalog is the existing acceptance-path inventory. This adapter registers
// those legacy paths without asking every demo to grow a bespoke verify config;
// because legacy suites do not emit D1 reports, their provenance is explicitly
// unsupported until the suite adopts the app-data ring observation carrier.
export function defineRepositoryVerifyProfiles({
  catalogFile,
  repositoryRoot = process.cwd(),
  include = null,
  timeoutMs = DEFAULT_VERIFY_PROFILE_TIMEOUT_MS,
  runCommand = runRepositoryAcceptanceCommand,
} = {}) {
  assert(typeof catalogFile === 'string' || catalogFile instanceof URL, 'repository catalogFile must be a path or file URL');
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'repository adapter timeoutMs must be a positive integer');
  assert(typeof runCommand === 'function', 'repository adapter runCommand must be a function');
  const root = realpathSync(resolve(repositoryRoot));
  const catalogPath = realpathSync(catalogFile instanceof URL ? fileURLToPath(catalogFile) : resolve(catalogFile));
  const catalog = readJson(catalogPath, 'SNAPBACK_VERIFY_REPOSITORY_CATALOG_INVALID');
  assert(catalog.schemaVersion === 'snapback.demo-catalog.v1', 'repository adapter requires snapback.demo-catalog.v1');
  assert(Array.isArray(catalog.entries), 'repository demo catalog entries must be an array');
  const selected = include === null ? null : new Set(normalizedStringArray(include, 'repository adapter include'));
  return Object.freeze(catalog.entries
    .filter((entry) => entry?.targets?.includes('local'))
    .filter((entry) => selected === null || selected.has(entry.id))
    .map((entry, index) => {
      assert(typeof entry.id === 'string' && entry.id.length > 0, `repository catalog entries[${index}].id must be a non-empty string`);
      assert(typeof entry.directory === 'string' && entry.directory.length > 0, `repository catalog ${entry.id}.directory must be a non-empty string`);
      assert(typeof entry.proof === 'string' && entry.proof.length > 0, `repository catalog ${entry.id}.proof must be a non-empty string`);
      assert(Array.isArray(entry.evidence) && entry.evidence.length > 0, `repository catalog ${entry.id}.evidence must be non-empty`);
      const demoDirectory = realpathSync(resolve(root, entry.directory));
      // Catalog commands are historical contracts: some spell a repository-
      // relative script path, while package-script commands are documented
      // from the demo directory. The directory field resolves that legacy
      // split without rewriting the canonical command.
      const proofCwd = entry.directory === '.' || entry.proof.includes(`${entry.directory}/`)
        ? root
        : demoDirectory;
      const evidenceFiles = entry.evidence.map((file) => realpathSync(resolve(root, file)));
      // One catalog proof command is one executed acceptance path. The
      // first evidence file is the catalog-designated proof evidence. Other
      // inventory files are neither digest-bound nor promoted into observed
      // D1 paths unless their own commands are registered and executed.
      const paths = Object.freeze([Object.freeze({
        id: `repository:${entry.id}:proof`,
        kind: entry.id === 'public-dashboard' ? 'snapshot-bundle' : 'success',
        targetProfileId: 'local-dev-sqlite-ibex',
        functionId: null,
      })]);
      return Object.freeze({
        id: `repository-demo:${entry.id}`,
        title: `repository demo acceptance: ${entry.id}`,
        testFiles: Object.freeze([catalogPath, evidenceFiles[0]]),
        requiredCapabilities: Object.freeze([]),
        paths,
        timeoutMs,
        async run(context) {
          const outcome = await runCommand({
            command: entry.proof,
            cwd: proofCwd,
            timeoutMs,
            entry: Object.freeze({ ...entry }),
          });
          const ok = outcome?.ok === true;
          const executed = outcome?.exit?.error == null && (
            Number.isInteger(outcome?.exit?.code)
            || typeof outcome?.exit?.signal === 'string'
            || outcome?.timedOut === true
            || outcome?.overflow === true
          );
          return Object.freeze({
            ok,
            context: context.identityContext,
            conformance: Object.freeze(executed ? unsupportedConformance(paths) : []),
            diagnostics: ok ? Object.freeze([]) : Object.freeze([diagnostic(
              outcome?.overflow
                ? 'SNAPBACK_VERIFY_REPOSITORY_ACCEPTANCE_OUTPUT_LIMIT'
                : outcome?.timedOut
                  ? 'SNAPBACK_VERIFY_REPOSITORY_ACCEPTANCE_TIMEOUT'
                  : 'SNAPBACK_VERIFY_REPOSITORY_ACCEPTANCE_FAILED',
              `repository acceptance ${entry.id} did not pass`,
              {
                profileId: `repository-demo:${entry.id}`,
                command: entry.proof,
                exitCode: outcome?.exit?.code ?? null,
                signal: outcome?.exit?.signal ?? null,
                stderr: String(outcome?.stderr ?? '').slice(-16_384),
              },
            )]),
          });
        },
      });
    }));
}

function redactSecret(value, secret) {
  const text = String(value ?? '');
  return typeof secret === 'string' && secret.length > 0
    ? text.replaceAll(secret, '[redacted]')
    : text;
}

function normalizedRemoteOrigin(value) {
  const parsed = new URL(value);
  assert(
    parsed.protocol === 'https:' || parsed.protocol === 'http:',
    'Cloudflare proof URL must use http or https',
  );
  return parsed.href.replace(/\/$/u, '');
}

async function runCloudflareAcceptanceProfile({
  acceptanceFile,
  proofUrl,
  adminToken,
  artifact,
  identityContext,
  paths,
  timeoutMs,
  expectedCheckCount,
}) {
  const effectiveProofUrl = proofUrl ?? process.env.SNAPBACK_PROOF_URL ?? '';
  const effectiveAdminToken = adminToken ?? process.env.SNAPBACK_ADMIN_TOKEN ?? '';
  if (effectiveProofUrl.length === 0 || effectiveAdminToken.length === 0) {
    return Object.freeze({
      ok: false,
      context: identityContext,
      conformance: Object.freeze(unsupportedConformance(paths)),
      diagnostics: Object.freeze([diagnostic(
        'SNAPBACK_VERIFY_CLOUDFLARE_CREDENTIALS_MISSING',
        'Cloudflare acceptance requires SNAPBACK_PROOF_URL and SNAPBACK_ADMIN_TOKEN',
        { missingProofUrl: effectiveProofUrl.length === 0, missingAdminToken: effectiveAdminToken.length === 0 },
      )]),
    });
  }

  let origin;
  try {
    origin = normalizedRemoteOrigin(effectiveProofUrl);
  } catch (error) {
    return Object.freeze({
      ok: false,
      context: identityContext,
      conformance: Object.freeze(unsupportedConformance(paths)),
      diagnostics: Object.freeze([diagnostic(
        'SNAPBACK_VERIFY_CLOUDFLARE_PROOF_URL_INVALID',
        'Cloudflare acceptance proof URL is invalid',
        foreignCauseDetails(error),
      )]),
    });
  }

  const child = spawn(process.execPath, [acceptanceFile], {
    cwd: dirname(acceptanceFile),
    env: {
      ...process.env,
      SNAPBACK_PROOF_URL: origin,
      SNAPBACK_ADMIN_TOKEN: effectiveAdminToken,
      SNAPBACK_VERIFY_PROFILE: 'cloudflare-acceptance',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let overflow = false;
  let timedOut = false;
  let killTimeout = null;
  const append = (current, chunk) => {
    const next = `${current}${chunk.toString('utf8')}`;
    if (Buffer.byteLength(next) > STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES) {
      overflow = true;
      child.kill('SIGTERM');
      return next.slice(-STARTER_ACCEPTANCE_MAX_OUTPUT_BYTES);
    }
    return next;
  };
  child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killTimeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  }, timeoutMs);
  const exit = await new Promise((resolveExit) => {
    child.once('error', (error) => resolveExit({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolveExit({ code, signal, error: null }));
  });
  clearTimeout(timeout);
  if (killTimeout !== null) clearTimeout(killTimeout);

  let receipt = null;
  for (const line of stdout.trim().split('\n').reverse()) {
    try {
      const candidate = JSON.parse(line);
      if (candidate?.schemaVersion === CLOUDFLARE_ACCEPTANCE_SCHEMA_VERSION) {
        receipt = candidate;
        break;
      }
    } catch {
      // Only the final single-line machine receipt is evidence. Human output
      // from the remote runner is intentionally ignored.
    }
  }
  const expectedArtifact = artifact?.identity ?? {};
  const checks = Array.isArray(receipt?.checks) ? receipt.checks : [];
  let receiptOrigin = null;
  try {
    receiptOrigin = normalizedRemoteOrigin(receipt?.target?.origin ?? '');
  } catch {
    // An absent or malformed observed origin makes the receipt incomplete.
  }
  const receiptComplete = ['passed', 'passed-with-nonclaims'].includes(receipt?.status)
    && receipt?.expectedCheckCount === expectedCheckCount
    && receipt?.executedCheckCount === expectedCheckCount
    && checks.length === expectedCheckCount
    && checks.every((check) => check?.status === 'passed' || check?.status === 'skipped')
    && checks.some((check) => check?.status === 'passed')
    && receiptOrigin === origin
    && typeof receipt?.target?.platformBuildId === 'string'
    && receipt.target.platformBuildId.length > 0
    && receipt?.artifact?.appId === expectedArtifact.appId
    && receipt?.artifact?.schemaHash === expectedArtifact.schemaHash
    && receipt?.artifact?.bundleHash === expectedArtifact.bundleHash
    && /^sha256:[0-9a-f]{64}$/u.test(receipt?.dataIdentity ?? '')
    && /^sha256:[0-9a-f]{64}$/u.test(receipt?.seedIdentity ?? '')
    && receipt?.diagnostic === null;
  const ok = !overflow && !timedOut && exit.error === null && exit.code === 0 && receiptComplete;
  const diagnosticCode = overflow
    ? 'SNAPBACK_VERIFY_CLOUDFLARE_ACCEPTANCE_OUTPUT_LIMIT'
    : timedOut
      ? 'SNAPBACK_VERIFY_CLOUDFLARE_ACCEPTANCE_TIMEOUT'
      : 'SNAPBACK_VERIFY_CLOUDFLARE_ACCEPTANCE_FAILED';
  const diagnostics = ok
    ? checks.some(({ status }) => status === 'skipped')
      ? [diagnostic(
          'SNAPBACK_VERIFY_CLOUDFLARE_ACCEPTANCE_NONCLAIM',
          'Cloudflare acceptance passed with one or more explicit external-provider nonclaims',
          { skippedChecks: checks.filter(({ status }) => status === 'skipped').map(({ label }) => label) },
          'warning',
        )]
      : []
    : [diagnostic(
        diagnosticCode,
        overflow
          ? 'Cloudflare acceptance exceeded the bounded output limit'
          : timedOut
            ? `Cloudflare acceptance exceeded its ${timeoutMs}ms timeout`
            : `Cloudflare acceptance exited ${exit.code ?? exit.signal ?? 'without a status'} or returned an incomplete receipt`,
        {
          acceptanceFile,
          origin,
          exitCode: exit.code,
          signal: exit.signal,
          receiptStatus: receipt?.status ?? null,
          expectedCheckCount,
          executedCheckCount: receipt?.executedCheckCount ?? null,
          ...(typeof exit.error?.code === 'string' ? { causeCode: exit.error.code } : {}),
          stderr: redactSecret(stderr.slice(-16_384), effectiveAdminToken),
        },
      )];
  const context = ok
    ? normalizeContext({
        ...identityContext,
        target: {
          kind: 'cloudflare-deployment',
          identity: `${origin}#${receipt.target.platformBuildId}`,
        },
        data: { kind: 'cloudflare-live-observation', identity: receipt.dataIdentity },
        seed: { kind: 'authored-seed-bytes', identity: receipt.seedIdentity },
      })
    : identityContext;
  return Object.freeze({
    ok,
    context,
    conformance: Object.freeze(unsupportedConformance(paths)),
    diagnostics: Object.freeze(diagnostics),
  });
}

// @ref LLP 0146#d2-snapback-verify--the-done-oracle — the non-local runtime
// skip is not evidence; Cloudflare readiness comes from an explicit remote
// profile whose receipt binds the admitted app hashes and observed target.
export function defineCloudflareVerifyProfile({
  id,
  title = id,
  acceptanceFile,
  additionalTestFiles = [],
  requiredCapabilities = [],
  paths = [],
  proofUrl = null,
  adminToken = null,
  expectedCheckCount = 22,
  timeoutMs = DEFAULT_VERIFY_PROFILE_TIMEOUT_MS,
}) {
  assert(typeof id === 'string' && id.length > 0, 'Cloudflare profile id must be a non-empty string');
  assert(typeof title === 'string' && title.length > 0, 'Cloudflare profile title must be a non-empty string');
  assert(Number.isInteger(expectedCheckCount) && expectedCheckCount > 0, 'Cloudflare expectedCheckCount must be a positive integer');
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0, 'Cloudflare profile timeoutMs must be a positive integer');
  assert(proofUrl === null || (typeof proofUrl === 'string' && proofUrl.length > 0), 'Cloudflare proofUrl must be null or a non-empty string');
  assert(adminToken === null || (typeof adminToken === 'string' && adminToken.length > 0), 'Cloudflare adminToken must be null or a non-empty string');
  const resolvedAcceptanceFile = resolveStarterAcceptanceFile(acceptanceFile);
  const resolvedAdditionalTestFiles = additionalTestFiles.map((file) => resolveStarterAcceptanceFile(file));
  const normalizedPaths = Object.freeze(paths.map((path, index) => normalizePath(path, id, index)));
  assert(
    normalizedPaths.every(({ targetProfileId }) => targetProfileId === 'cloudflare-do-sqlite-v8'),
    'Cloudflare profile paths must target cloudflare-do-sqlite-v8',
  );
  return Object.freeze({
    id,
    title,
    testFiles: Object.freeze([resolvedAcceptanceFile, ...resolvedAdditionalTestFiles]),
    requiredCapabilities: Object.freeze([...requiredCapabilities]),
    paths: normalizedPaths,
    timeoutMs,
    run(context) {
      return runCloudflareAcceptanceProfile({
        acceptanceFile: resolvedAcceptanceFile,
        proofUrl,
        adminToken,
        artifact: context.artifact,
        identityContext: context.identityContext,
        paths: normalizedPaths,
        timeoutMs,
        expectedCheckCount,
      });
    },
  });
}

export async function loadVerifyConfig(path, { backendDirectory = null } = {}) {
  let configPath;
  try {
    configPath = realpathSync(resolve(path));
  } catch (error) {
    throw verifyError(
      'SNAPBACK_VERIFY_CONFIG_UNAVAILABLE',
      `verify config ${resolve(path)} is unavailable`,
      foreignCauseDetails(error, { path: resolve(path) }),
    );
  }
  const imported = await import(`${pathToFileURL(configPath).href}?verify=${Date.now()}`);
  const value = imported.default;
  assert(plainObject(value), 'verify config default export must be an object');
  assert(value.schemaVersion === VERIFY_CONFIG_SCHEMA_VERSION, `schemaVersion must be ${VERIFY_CONFIG_SCHEMA_VERSION}`);
  const configDirectory = dirname(configPath);
  const profiles = (value.profiles ?? []).map((profile, index) => normalizeProfile(profile, index, configDirectory));
  assert(new Set(profiles.map(({ id }) => id)).size === profiles.length, 'profile ids must be unique');
  const coverageRequirement = value.coverageRequirement ?? 'path-observation';
  assert(
    COVERAGE_REQUIREMENTS.has(coverageRequirement),
    'coverageRequirement must be path-observation or complete-operation-provenance',
  );
  return Object.freeze({
    schemaVersion: VERIFY_CONFIG_SCHEMA_VERSION,
    configPath,
    // An explicit CLI positional is shell-facing and therefore cwd-relative;
    // paths authored inside the config remain config-file-relative.
    backendDirectory: backendDirectory === null
      ? resolve(configDirectory, value.backendDirectory ?? 'snapback')
      : resolve(process.cwd(), backendDirectory),
    generatedDirectory: value.generatedDirectory === undefined
      ? null
      : resolve(configDirectory, value.generatedDirectory),
    servedTarget: normalizeServedTarget(value.servedTarget),
    context: normalizeContext(value.context),
    coverageRequirement,
    profiles: Object.freeze(profiles),
  });
}

export function discoverVerifyConfig(directory = process.cwd()) {
  const candidate = resolve(directory, VERIFY_CONFIG_CONVENTION);
  return existsSync(candidate) ? candidate : null;
}

export function defaultVerifyConfig({ backendDirectory = 'snapback' } = {}) {
  return Object.freeze({
    schemaVersion: VERIFY_CONFIG_SCHEMA_VERSION,
    configPath: null,
    backendDirectory: resolve(backendDirectory),
    generatedDirectory: null,
    servedTarget: null,
    context: normalizeContext(),
    coverageRequirement: 'path-observation',
    profiles: Object.freeze([]),
  });
}

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = verifyError(code, `could not read generated artifact ${path}`, { path });
    error.cause = cause;
    throw error;
  }
}

// @ref LLP 0234#d5--exact-ratchets-cover-overrides-and-ordinary-policy-widening
// — governance baselines and ledgers are committed generation inputs. A
// freshness regeneration discards ordinary outputs but must retain these
// records so codegen can validate, rather than manufacture, authority.
const FRESHNESS_GOVERNANCE_INPUTS = new Set(Object.values(GOVERNANCE_FILES).filter((path) => (
  path.startsWith('generated/')
)));

function copyBackendSource(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    filter(path) {
      if (path === source) return true;
      const relativePath = relative(source, path).split(sep).join('/');
      const name = relativePath.split('/')[0];
      if (name === 'generated') {
        return relativePath === 'generated' || FRESHNESS_GOVERNANCE_INPUTS.has(relativePath);
      }
      return !['.snapback', 'node_modules'].includes(name);
    },
  });
}

export async function probeArtifactFreshness(config) {
  const backendRoot = realpathSync(config.backendDirectory);
  const generatedRoot = resolve(config.generatedDirectory ?? join(backendRoot, 'generated'));
  const verified = verifyGeneratedGraph(generatedRoot);
  const artifactIndex = readJson(join(generatedRoot, 'artifacts.json'), 'SNAPBACK_VERIFY_ARTIFACT_INVALID');
  const capability = readJson(resolveGeneratedArtifact(generatedRoot, 'capability.manifest.json'), 'SNAPBACK_VERIFY_ARTIFACT_INVALID');
  const targetProfile = capability.targetProfileId ?? 'local-dev-sqlite-ibex';
  const scratch = mkdtempSync(join(dirname(backendRoot), '.snapback-verify-'));
  let regenerated;
  try {
    copyBackendSource(backendRoot, scratch);
    regenerated = await generate(scratch, { targetProfile });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (!regenerated?.ok) {
    return {
      ok: false,
      diagnostics: regenerated?.diagnostics ?? [diagnostic(
        'SNAPBACK_VERIFY_ARTIFACT_REGEN_FAILED',
        'source could not be regenerated for freshness comparison',
      )],
    };
  }
  const keys = ['appId', 'schemaVersion', 'schemaHash', 'bundleHash', 'inputsHash'];
  const expected = Object.fromEntries(keys.map((key) => [key, artifactIndex[key] ?? null]));
  const observed = Object.fromEntries(keys.map((key) => [key, regenerated.artifactIndex?.[key] ?? null]));
  const mismatches = keys.filter((key) => expected[key] !== observed[key]);
  if (mismatches.length > 0) {
    return {
      ok: false,
      diagnostics: [diagnostic(
        'SNAPBACK_VERIFY_ARTIFACT_STALE',
        'generated artifact identity does not match a fresh source regeneration',
        { mismatches, expected, observed },
      )],
    };
  }
  return {
    ok: true,
    identity: expected,
    seedIdentity: (() => {
      const seedPath = join(backendRoot, 'seed.json');
      try {
        return {
          kind: 'authored-seed-bytes',
          identity: `sha256:${createHash('sha256').update(readFileSync(seedPath)).digest('hex')}`,
        };
      } catch (error) {
        if (error?.code === 'ENOENT') return { kind: 'no-authored-seed', identity: null };
        throw error;
      }
    })(),
    generatedRoot,
    verifiedGraph: {
      inputsHash: verified.manifest.inputsHash,
      files: verified.manifest.files?.length ?? 0,
    },
    manifests: {
      artifactIndex,
      schema: readJson(resolveGeneratedArtifact(generatedRoot, 'schema.manifest.json'), 'SNAPBACK_VERIFY_ARTIFACT_INVALID'),
      functions: readJson(resolveGeneratedArtifact(generatedRoot, 'functions.manifest.json'), 'SNAPBACK_VERIFY_ARTIFACT_INVALID'),
      capability,
    },
    diagnostics: [],
  };
}

// @ref LLP 0146#d2-snapback-verify--the-done-oracle — admission and
// capability resolution use the authenticated state of the live served
// target when configured; regenerated local artifacts remain the comparison
// source, never the claimed serving authority.
export async function probeServedTarget(artifact, config, options = {}) {
  if (!config.servedTarget) {
    return {
      ok: true,
      claimed: false,
      diagnostics: [],
      evidence: {
        disposition: 'not-configured',
        claim: false,
        nonclaim: 'no live served target was configured for admission/capability resolution',
      },
    };
  }
  const token = (options.env ?? process.env)[config.servedTarget.adminTokenEnv] ?? '';
  if (token.length === 0) {
    return {
      ok: false,
      claimed: false,
      diagnostics: [diagnostic(
        'SNAPBACK_VERIFY_SERVED_TARGET_AUTHORITY_MISSING',
        `live target inspection requires ${config.servedTarget.adminTokenEnv}`,
        { environment: config.servedTarget.adminTokenEnv },
      )],
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.servedTarget.timeoutMs);
  let envelope;
  try {
    const response = await (options.fetch ?? fetch)(
      `${config.servedTarget.url}/_snapback/api/host-ops`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-snapback-admin-token': token,
        },
        body: JSON.stringify({
          schemaVersion: 'snapback.v0',
          requestId: `verify-live-${Date.now()}`,
          operation: 'app.inspect',
        }),
        signal: controller.signal,
      },
    );
    envelope = await response.json();
  } catch (error) {
    return {
      ok: false,
      claimed: false,
      diagnostics: [diagnostic(
        error?.name === 'AbortError'
          ? 'SNAPBACK_VERIFY_SERVED_TARGET_TIMEOUT'
          : 'SNAPBACK_VERIFY_SERVED_TARGET_UNAVAILABLE',
        error?.name === 'AbortError'
          ? `live target inspection exceeded ${config.servedTarget.timeoutMs}ms`
          : 'live target inspection did not return a JSON host-operation envelope',
        foreignCauseDetails(error, { url: config.servedTarget.url }),
      )],
    };
  } finally {
    clearTimeout(timeout);
  }
  if (envelope?.ok !== true || envelope?.operation !== 'app.inspect') {
    // A hostOpsResult uses diagnostics[], while a real non-2xx HTTP refusal
    // uses LLP 0094's ErrorResponse with singular diagnostic. Probe both
    // carriers before classifying the served authority profile.
    const codes = [...new Set([
      envelope?.diagnostic?.code,
      ...(Array.isArray(envelope?.diagnostics)
        ? envelope.diagnostics.map(({ code }) => code)
        : []),
    ].filter((code) => typeof code === 'string' && code.length > 0))];
    const sessionsLeaseRequired = codes.includes('SNAPBACK_ADMIN_SECRET_READ_REQUIRED');
    return {
      ok: false,
      claimed: false,
      diagnostics: [diagnostic(
        sessionsLeaseRequired
          ? 'SNAPBACK_VERIFY_SERVED_TARGET_AUTHORITY_PROFILE_UNSUPPORTED'
          : 'SNAPBACK_VERIFY_SERVED_TARGET_REFUSED',
        sessionsLeaseRequired
          ? 'live sessions-mode app.inspect requires an AdminInspect secret-read lease; verify live probing currently supports admin-token targets only'
          : 'live target refused authenticated app.inspect',
        {
          url: config.servedTarget.url,
          authorityMode: config.servedTarget.authorityMode ?? 'admin-token',
          limitation: sessionsLeaseRequired
            ? 'sessions-secret-read-lease-not-supported'
            : null,
          codes,
        },
      )],
    };
  }
  const runtimeState = envelope.data?.runtimeState;
  const capabilityManifest = runtimeState?.capabilityManifest;
  const supportedCapabilities = capabilityManifest?.supportedCapabilities;
  const observation = {
    serverUrl: config.servedTarget.url,
    startupNonce: envelope.data?.operationalReadiness?.startupNonce ?? null,
    targetProfileId: capabilityManifest?.targetProfileId
      ?? runtimeState?.targetProfileId
      ?? envelope.target?.targetProfile
      ?? null,
    serverProfileTarget: envelope.target?.targetProfile ?? null,
    appId: envelope.target?.appId ?? runtimeState?.functions?.appId ?? null,
    schemaHash: envelope.artifacts?.schemaHash ?? runtimeState?.schema?.schemaHash ?? null,
    bundleHash: envelope.artifacts?.bundleHash ?? runtimeState?.functions?.bundleHash ?? null,
    databaseVersion: envelope.artifacts?.databaseVersion ?? runtimeState?.storage?.version ?? null,
    supportedCapabilities: Array.isArray(supportedCapabilities)
      ? [...new Set(supportedCapabilities)].sort()
      : null,
  };
  const complete = typeof observation.startupNonce === 'string'
    && observation.startupNonce.length > 0
    && typeof observation.targetProfileId === 'string'
    && typeof observation.serverProfileTarget === 'string'
    && typeof observation.appId === 'string'
    && typeof observation.schemaHash === 'string'
    && typeof observation.bundleHash === 'string'
    && Number.isSafeInteger(observation.databaseVersion)
    && Array.isArray(observation.supportedCapabilities);
  if (!complete) {
    return {
      ok: false,
      claimed: false,
      diagnostics: [diagnostic(
        'SNAPBACK_VERIFY_SERVED_TARGET_INVALID',
        'live app.inspect omitted admission or capability facts required by verify',
        { observation },
      )],
    };
  }
  const targetIdentity = `sha256:${createHash('sha256').update(stableJson({
    serverUrl: observation.serverUrl,
    startupNonce: observation.startupNonce,
    targetProfileId: observation.targetProfileId,
    serverProfileTarget: observation.serverProfileTarget,
    appId: observation.appId,
  })).digest('hex')}`;
  return {
    ok: true,
    claimed: true,
    observation: Object.freeze(observation),
    targetIdentity,
    dataIdentity: `version:${observation.databaseVersion}`,
    diagnostics: [],
    evidence: Object.freeze({
      disposition: 'authenticated-live-app-inspect',
      claim: true,
      authorityMode: 'admin-token',
      limitation: 'sessions-mode targets requiring an AdminInspect secret-read lease are not claimed live',
      observation: Object.freeze(observation),
      targetIdentity,
    }),
  };
}

export function probeAdmission(artifact, servedTarget = null) {
  if (!artifact?.ok) return { ok: false, blocked: true, diagnostics: [] };
  const { artifactIndex, schema, functions, capability } = artifact.manifests;
  const identity = artifact.identity;
  const mismatches = [];
  for (const [manifestName, manifest] of Object.entries({ schema, functions })) {
    for (const key of ['appId', 'schemaVersion', 'inputsHash']) {
      if (manifest[key] !== identity[key]) mismatches.push({ manifest: manifestName, key, expected: identity[key], observed: manifest[key] ?? null });
    }
  }
  if (schema.schemaHash !== identity.schemaHash) mismatches.push({ manifest: 'schema', key: 'schemaHash', expected: identity.schemaHash, observed: schema.schemaHash ?? null });
  if (functions.bundleHash !== identity.bundleHash) mismatches.push({ manifest: 'functions', key: 'bundleHash', expected: identity.bundleHash, observed: functions.bundleHash ?? null });
  if (artifactIndex.artifactKind !== 'artifactIndex' || schema.artifactKind !== 'schemaManifest' || functions.artifactKind !== 'functionManifest' || capability.artifactKind !== 'capabilityManifest') {
    mismatches.push({ manifest: 'artifact-set', key: 'artifactKind', expected: 'closed known kinds', observed: 'invalid' });
  }
  if (servedTarget?.claimed) {
    const observed = servedTarget.observation;
    for (const key of ['appId', 'schemaHash', 'bundleHash']) {
      if (observed[key] !== identity[key]) {
        mismatches.push({
          manifest: 'live-served-target',
          key,
          expected: identity[key],
          observed: observed[key] ?? null,
        });
      }
    }
    const generatedTarget = capability.targetProfileId ?? null;
    if (observed.targetProfileId !== generatedTarget) {
      mismatches.push({
        manifest: 'live-served-target',
        key: 'targetProfileId',
        expected: generatedTarget,
        observed: observed.targetProfileId,
      });
    }
  }
  const mode = servedTarget?.claimed
    ? 'authenticated-live-served-target-admission'
    : 'generated-artifact-local-admission';
  return mismatches.length === 0
    ? { ok: true, mode, diagnostics: [] }
    : {
      ok: false,
      mode,
      diagnostics: [diagnostic('SNAPBACK_VERIFY_ADMISSION_IDENTITY_MISMATCH', 'schema/function artifact admission identities disagree', { mismatches })],
    };
}

export function probeCapabilities(artifact, profiles, servedTarget = null) {
  if (!artifact?.ok) return { ok: false, blocked: true, diagnostics: [], required: [], supported: [], missing: [] };
  const required = new Set(artifact.manifests.schema.requiredCapabilities ?? []);
  for (const fn of artifact.manifests.functions.functions ?? []) {
    for (const capability of fn.requiredCapabilities ?? []) required.add(capability);
  }
  for (const profile of profiles) {
    for (const capability of profile.requiredCapabilities) required.add(capability);
  }
  const supported = new Set(servedTarget?.claimed
    ? servedTarget.observation.supportedCapabilities
    : artifact.manifests.capability.supportedCapabilities ?? []);
  const missing = [...required].filter((capability) => !supported.has(capability)).sort();
  return {
    ok: missing.length === 0,
    targetProfileId: servedTarget?.claimed
      ? servedTarget.observation.targetProfileId
      : artifact.manifests.capability.targetProfileId ?? null,
    resolutionMode: servedTarget?.claimed
      ? 'authenticated-live-served-target'
      : 'generated-capability-manifest',
    required: [...required].sort(),
    supported: [...supported].sort(),
    missing,
    diagnostics: missing.length === 0 ? [] : [diagnostic(
      'SNAPBACK_VERIFY_CAPABILITY_GAP',
      'the selected target profile is missing required capabilities',
      { missing },
    )],
  };
}

function digestFiles(configPath, paths) {
  const files = [...new Set([...(configPath === null ? [] : [configPath]), ...paths])].sort();
  const baseDirectory = configPath === null ? process.cwd() : dirname(configPath);
  const hash = createHash('sha256');
  hash.update('snapback:verify-test-bytes:v1\n', 'utf8');
  let bytes = 0;
  const records = files.map((path) => {
    const content = readFileSync(path);
    const portablePath = relative(baseDirectory, path).split(sep).join('/');
    const fileDigest = createHash('sha256').update(content).digest('hex');
    bytes += content.byteLength;
    hash.update(`${Buffer.byteLength(portablePath)}:${portablePath}${content.byteLength}:`, 'utf8');
    hash.update(content);
    return Object.freeze({ path: portablePath, bytes: content.byteLength, sha256: `sha256:${fileDigest}` });
  });
  return Object.freeze({
    algorithm: 'sha256-path-length-content.v1',
    sha256: `sha256:${hash.digest('hex')}`,
    bytes,
    files: Object.freeze(records),
  });
}

function normalizeReport(report, label) {
  assert(plainObject(report), `${label}.report must be an object`);
  for (const key of REPORT_KEYS) assert(Array.isArray(report[key]), `${label}.report.${key} must be an array`);
  assert(PROVENANCE.has(report.readProvenance), `${label}.report.readProvenance must be complete, incomplete, or unsupported`);
  assert(PROVENANCE.has(report.writeProvenance), `${label}.report.writeProvenance must be complete, incomplete, or unsupported`);
  return Object.freeze({
    missingReads: normalizedStringArray(report.missingReads, `${label}.report.missingReads`),
    missingWrites: normalizedStringArray(report.missingWrites, `${label}.report.missingWrites`),
    extraReads: normalizedStringArray(report.extraReads, `${label}.report.extraReads`),
    extraWrites: normalizedStringArray(report.extraWrites, `${label}.report.extraWrites`),
    readProvenance: report.readProvenance,
    writeProvenance: report.writeProvenance,
  });
}

function intersection(sets) {
  if (sets.length === 0) return [];
  return [...sets.slice(1).reduce(
    (common, entries) => new Set([...common].filter((entry) => entries.has(entry))),
    new Set(sets[0]),
  )].sort();
}

export function aggregateConformance(profiles, results, {
  coverageRequirement = 'path-observation',
} = {}) {
  assert(
    COVERAGE_REQUIREMENTS.has(coverageRequirement),
    'coverageRequirement must be path-observation or complete-operation-provenance',
  );
  const registeredPathCount = profiles.reduce((count, profile) => count + profile.paths.length, 0);
  if (registeredPathCount === 0) {
    return Object.freeze({
      status: 'not-claimed',
      disposition: 'no-registered-acceptance-paths',
      coverageRequirement,
      scope: 'registered-or-repository-adapted-paths',
      limitationReason: 'no configured or repository-adapted acceptance paths were selected',
      complete: false,
      expectedPaths: 0,
      observedPaths: 0,
      pathEvidence: Object.freeze([]),
      underDeclarations: Object.freeze([]),
      overDeclarations: Object.freeze([]),
      diagnostics: Object.freeze([]),
    });
  }
  const resultByProfile = new Map(results.map((result) => [result.profileId, result]));
  const evidence = [];
  const diagnostics = [];
  for (const profile of profiles) {
    const baselinePathIds = new Set(profile.coverageCapability?.baselinePathIds ?? []);
    const returned = resultByProfile.get(profile.id)?.conformance ?? [];
    const byPath = new Map();
    for (const [index, item] of returned.entries()) {
      assert(plainObject(item), `profile ${profile.id} conformance[${index}] must be an object`);
      assert(typeof item.pathId === 'string' && item.pathId.length > 0, `profile ${profile.id} conformance[${index}].pathId must be a non-empty string`);
      assert(!byPath.has(item.pathId), `profile ${profile.id} returned duplicate conformance for ${item.pathId}`);
      byPath.set(item.pathId, item);
    }
    for (const path of profile.paths) {
      const item = byPath.get(path.id);
      if (!item || item.status !== 'observed') {
        const status = item?.status === 'unsupported' ? 'unsupported' : 'incomplete';
        evidence.push(Object.freeze({ profileId: profile.id, ...path, status, report: null }));
        diagnostics.push(diagnostic(
          status === 'unsupported' ? 'SNAPBACK_VERIFY_COVERAGE_PATH_UNSUPPORTED' : 'SNAPBACK_VERIFY_COVERAGE_PATH_INCOMPLETE',
          `registered acceptance path ${profile.id}/${path.id} has no complete D1 conformance observation`,
          { profileId: profile.id, pathId: path.id, kind: path.kind, targetProfileId: path.targetProfileId },
        ));
        continue;
      }
      const report = normalizeReport(item.report, `profile ${profile.id} path ${path.id}`);
      const status = report.readProvenance === 'unsupported' && report.writeProvenance === 'unsupported'
        ? 'unsupported'
        : report.readProvenance === 'complete' && report.writeProvenance === 'complete'
          ? 'authoritative'
          : 'incomplete';
      evidence.push(Object.freeze({ profileId: profile.id, ...path, status, report }));
      // @ref LLP 0275#p4-evidence-obligations-are-proportional-to-the-claim —
      // identity observation may be green without manufacturing operation
      // provenance; a stronger configured claim remains fail-closed below.
      const isDeclaredUnsupportedBaseline = status === 'unsupported'
        && path.functionId !== null
        && profile.coverageCapability?.claim === 'identity-bound-path-observation'
        && baselinePathIds.has(path.id);
      if (status !== 'authoritative' && !isDeclaredUnsupportedBaseline) {
        diagnostics.push(diagnostic(
          status === 'unsupported'
            ? 'SNAPBACK_VERIFY_COVERAGE_EVIDENCE_UNSUPPORTED'
            : 'SNAPBACK_VERIFY_COVERAGE_EVIDENCE_INCOMPLETE',
          `registered path ${profile.id}/${path.id} was observed without complete read/write provenance`,
          {
            profileId: profile.id,
            pathId: path.id,
            readProvenance: report.readProvenance,
            writeProvenance: report.writeProvenance,
          },
          'warning',
        ));
      }
      const authoritativeMissingReads = report.readProvenance === 'complete' ? report.missingReads : [];
      const authoritativeMissingWrites = report.writeProvenance === 'complete' ? report.missingWrites : [];
      if (authoritativeMissingReads.length > 0 || authoritativeMissingWrites.length > 0) {
        diagnostics.push(diagnostic(
          'SNAPBACK_VERIFY_UNDER_DECLARATION',
          `registered path ${profile.id}/${path.id} observed undeclared reads or writes`,
          { profileId: profile.id, pathId: path.id, missingReads: authoritativeMissingReads, missingWrites: authoritativeMissingWrites },
        ));
      }
    }
    const extras = [...byPath.keys()].filter((pathId) => !profile.paths.some(({ id }) => id === pathId)).sort();
    assert(extras.length === 0, `profile ${profile.id} returned conformance for unregistered paths: ${extras.join(', ')}`);
    if (coverageRequirement === 'complete-operation-provenance') {
      const incompletePathIds = evidence
        .filter((entry) => entry.profileId === profile.id && entry.status !== 'authoritative')
        .map(({ id }) => id)
        .sort();
      if (incompletePathIds.length > 0) {
        diagnostics.push(diagnostic(
          'SNAPBACK_VERIFY_COVERAGE_PROVENANCE_REQUIRED',
          `acceptance profile ${profile.id} cannot satisfy the required complete read/write operation provenance`,
          {
            profileId: profile.id,
            coverageRequirement,
            profileClaim: profile.coverageCapability?.claim ?? null,
            incompletePathIds,
          },
        ));
      }
    }
  }
  evidence.sort((left, right) => `${left.targetProfileId}\0${left.kind}\0${left.profileId}\0${left.id}`.localeCompare(`${right.targetProfileId}\0${right.kind}\0${right.profileId}\0${right.id}`));
  const observed = evidence.filter(({ report }) => report !== null);
  const authoritative = evidence.filter(({ status }) => status === 'authoritative');
  const underDeclarations = observed.flatMap((entry) => {
    const missingReads = entry.report.readProvenance === 'complete' ? entry.report.missingReads : [];
    const missingWrites = entry.report.writeProvenance === 'complete' ? entry.report.missingWrites : [];
    return missingReads.length === 0 && missingWrites.length === 0
      ? []
      : [{ profileId: entry.profileId, pathId: entry.id, functionId: entry.functionId, missingReads, missingWrites }];
  });
  const byFunction = new Map();
  for (const entry of observed) {
    if (entry.functionId === null) continue;
    const current = byFunction.get(entry.functionId) ?? [];
    current.push(entry);
    byFunction.set(entry.functionId, current);
  }
  const overDeclarations = [...byFunction.entries()].flatMap(([functionId, entries]) => {
    const readEntries = entries.filter(({ report }) => report.readProvenance === 'complete');
    const writeEntries = entries.filter(({ report }) => report.writeProvenance === 'complete');
    const extraReads = intersection(readEntries.map(({ report }) => new Set(report.extraReads)));
    const extraWrites = intersection(writeEntries.map(({ report }) => new Set(report.extraWrites)));
    return extraReads.length === 0 && extraWrites.length === 0 ? [] : [{
      functionId,
      completeObservedPaths: { reads: readEntries.length, writes: writeEntries.length },
      extraReads,
      extraWrites,
      severity: 'warning',
    }];
  }).sort((left, right) => left.functionId.localeCompare(right.functionId));
  const missingEvidence = evidence.filter(({ report }) => report === null);
  const partialPaths = evidence.filter(({ status }) => status === 'incomplete' || status === 'unsupported');
  const complete = authoritative.length === evidence.length;
  const completeProvenanceRequired = coverageRequirement === 'complete-operation-provenance';
  const ok = missingEvidence.length === 0
    && underDeclarations.length === 0
    && (!completeProvenanceRequired || complete);
  const hasIdentityBoundProfile = profiles.some(({ coverageCapability }) => (
    coverageCapability?.claim === 'identity-bound-path-observation'
  ));
  return Object.freeze({
    status: ok ? (complete ? 'passed' : 'partial') : 'failed',
    disposition: 'registered-path-aggregate-v0',
    coverageRequirement,
    scope: 'registered-or-repository-adapted-paths',
    limitationReason: hasIdentityBoundProfile
      ? 'one or more profiles claim identity-bound path observation only; complete read/write operation provenance is not supplied'
      : 'repository-adapted legacy suites remain partial until they emit D1 capture evidence',
    complete,
    expectedPaths: evidence.length,
    observedPaths: observed.length,
    authoritativePaths: authoritative.length,
    partialPaths: partialPaths.length,
    pathEvidence: Object.freeze(evidence),
    underDeclarations: Object.freeze(underDeclarations),
    overDeclarations: Object.freeze(overDeclarations),
    diagnostics: Object.freeze(diagnostics),
  });
}

function runWithTimeout(work, timeoutMs, profileId) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(verifyError(
        'SNAPBACK_VERIFY_PROFILE_TIMEOUT',
        `acceptance profile ${profileId} exceeded its ${timeoutMs}ms timeout`,
        { profileId, timeoutMs },
      )), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runProfiles(config, context, options) {
  const output = [];
  for (const profile of config.profiles) {
    // Capture the bytes before execution. A runner that rewrites its own test
    // file cannot make the retained receipt describe post-run bytes instead
    // of the program that was selected to execute.
    const testBytes = digestFiles(config.configPath, profile.testFiles);
    const startedAtMs = Date.now();
    let returned;
    try {
      const timeoutMs = options.profileTimeoutMs ?? profile.timeoutMs ?? DEFAULT_VERIFY_PROFILE_TIMEOUT_MS;
      returned = await runWithTimeout(
        () => profile.run(Object.freeze({
          artifact: context.artifact,
          backendDirectory: config.backendDirectory,
          generatedDirectory: context.artifact?.generatedRoot ?? config.generatedDirectory,
          identityContext: context.identityContext,
          profileId: profile.id,
        })),
        timeoutMs,
        profile.id,
      );
      assert(plainObject(returned), `profile ${profile.id} must return an object`);
      assert(typeof returned.ok === 'boolean', `profile ${profile.id} must return boolean ok`);
    } catch (error) {
      returned = {
        ok: false,
        diagnostics: [error?.diagnostic ?? diagnostic(
          'SNAPBACK_VERIFY_PROFILE_THREW',
          error?.message ?? String(error),
          foreignCauseDetails(error, { profileId: profile.id }),
        )],
        conformance: [],
      };
    }
    const finishedAtMs = Date.now();
    let identityContext;
    try {
      identityContext = normalizeContext(returned.context ?? context.identityContext);
    } catch (error) {
      identityContext = context.identityContext;
      returned = {
        ...returned,
        ok: false,
        diagnostics: [
          ...(returned.diagnostics ?? []),
          error?.diagnostic ?? diagnostic(
            'SNAPBACK_VERIFY_PROFILE_IDENTITY_INVALID',
            error?.message ?? String(error),
            foreignCauseDetails(error, { profileId: profile.id }),
          ),
        ],
      };
    }
    const identityGaps = [
      identityContext.target.identity === null ? 'target.identity' : null,
      identityContext.data.identity === null ? 'data.identity' : null,
      identityContext.authority.identity === null ? 'authority.identity' : null,
      identityContext.seed.kind === 'not-exercised' ? 'seed.kind' : null,
    ].filter(Boolean);
    if (identityGaps.length > 0) {
      returned = {
        ...returned,
        ok: false,
        diagnostics: [
          ...(returned.diagnostics ?? []),
          diagnostic(
            'SNAPBACK_VERIFY_PROFILE_IDENTITY_INCOMPLETE',
            `acceptance profile ${profile.id} did not bind every required execution identity`,
            { profileId: profile.id, identityGaps },
          ),
        ],
      };
    }
    output.push(Object.freeze({
      profileId: profile.id,
      title: profile.title,
      status: returned.ok ? 'passed' : 'failed',
      startedAtMs,
      finishedAtMs,
      durationMs: finishedAtMs - startedAtMs,
      testBytes,
      context: identityContext,
      coverageCapability: profile.coverageCapability ?? null,
      conformance: Array.isArray(returned.conformance) ? returned.conformance : [],
      diagnostics: Object.freeze(returned.diagnostics ?? []),
      ...(returned.unsafeDebug === undefined ? {} : { unsafeDebug: returned.unsafeDebug }),
    }));
  }
  return Object.freeze(output);
}

function stage(id, result, { blocked = false } = {}) {
  const ok = result?.ok === true;
  return Object.freeze({
    id,
    status: blocked || result?.blocked ? 'blocked' : ok ? 'passed' : 'failed',
    diagnostics: Object.freeze(result?.diagnostics ?? []),
    evidence: result?.evidence ?? null,
  });
}

async function safeProbe(probe, ...args) {
  try {
    return await probe(...args);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [error?.diagnostic ?? diagnostic(
        'SNAPBACK_VERIFY_PROBE_FAILED',
        error?.message ?? String(error),
        foreignCauseDetails(error),
      )],
    };
  }
}

function targetUsesLocalPackagedRuntime(artifact) {
  const targetProfileId = artifact?.manifests?.capability?.targetProfileId ?? null;
  return targetProfileId === null
    || targetProfileId.startsWith('local-')
    || targetProfileId.startsWith('local.');
}

export async function runVerify(config, options = {}) {
  const startedAtMs = options.now?.() ?? Date.now();
  const profileSetTestBytes = digestFiles(
    config.configPath,
    config.profiles.flatMap(({ testFiles }) => testFiles),
  );
  const artifact = await safeProbe(options.artifactProbe ?? probeArtifactFreshness, config);
  const runtime = artifact.ok
    ? targetUsesLocalPackagedRuntime(artifact)
      ? await safeProbe(
        options.runtimeProbe ?? (() => ({ ok: false, diagnostics: [diagnostic('SNAPBACK_VERIFY_RUNTIME_PROBE_MISSING', 'no runtime readiness verifier was supplied')]})),
        artifact,
        config,
      )
      : {
          ok: true,
          skipped: true,
          diagnostics: [],
          evidence: {
            disposition: 'not-applicable-non-local-target',
            targetProfileId: artifact.manifests.capability.targetProfileId,
            claim: false,
            nonclaim: 'the local packaged runtime readiness probe does not apply to this non-local target',
          },
        }
    : { ok: false, blocked: true, diagnostics: [] };
  const servedTarget = artifact.ok && runtime.ok
    ? await safeProbe(
      options.servedTargetProbe ?? probeServedTarget,
      artifact,
      config,
      options,
    )
    : { ok: false, blocked: true, claimed: false, diagnostics: [] };
  const admission = artifact.ok && runtime.ok && servedTarget.ok
    ? await safeProbe(options.admissionProbe ?? probeAdmission, artifact, servedTarget, config)
    : { ok: false, blocked: true, diagnostics: [] };
  const capabilities = artifact.ok && admission.ok
    ? await safeProbe(
      options.capabilityProbe ?? probeCapabilities,
      artifact,
      config.profiles,
      servedTarget,
      config,
    )
    : { ok: false, blocked: true, diagnostics: [], required: [], supported: [], missing: [] };
  // Profile execution is the observation source for D1 coverage, whose
  // judgement precedes capability and acceptance verdicts in the receipt.
  // Capability resolution still gates the final acceptance stage; a missing
  // capability never turns a profile outcome into a passing acceptance claim.
  const canRunProfiles = artifact.ok && runtime.ok && admission.ok;
  const identityContext = normalizeContext({
    ...config.context,
    target: servedTarget.claimed
      ? { kind: 'live-served-target', identity: servedTarget.targetIdentity }
      : config.context.target.identity === null && artifact.identity?.inputsHash
        ? { ...config.context.target, identity: artifact.identity.inputsHash }
      : config.context.target,
    data: servedTarget.claimed
      ? { kind: 'served-database-version', identity: servedTarget.dataIdentity }
      : config.context.data,
    seed: config.context.seed.identity === null && artifact.seedIdentity
      ? artifact.seedIdentity
      : config.context.seed,
  });
  const profileResults = canRunProfiles
    ? await runProfiles(config, { artifact, identityContext }, options)
    : Object.freeze([]);
  const registeredPathCount = config.profiles.reduce((count, profile) => count + profile.paths.length, 0);
  let conformance;
  if (canRunProfiles) {
    try {
      conformance = aggregateConformance(config.profiles, profileResults, {
        coverageRequirement: config.coverageRequirement ?? 'path-observation',
      });
    } catch (error) {
      conformance = Object.freeze({
        status: 'failed', disposition: 'invalid-profile-conformance', complete: false,
        coverageRequirement: config.coverageRequirement ?? 'path-observation',
        scope: 'registered-or-repository-adapted-paths',
        limitationReason: 'one or more acceptance profiles returned malformed conformance evidence',
        expectedPaths: registeredPathCount,
        observedPaths: 0, authoritativePaths: 0, partialPaths: 0,
        pathEvidence: [], underDeclarations: [], overDeclarations: [],
        diagnostics: [diagnostic(
          'SNAPBACK_VERIFY_CONFORMANCE_INVALID',
          error?.message ?? String(error),
          {
            causeCode: error?.code ?? null,
            causeDiagnostic: error?.diagnostic ?? null,
          },
        )],
      });
    }
  } else if (registeredPathCount === 0) {
    // @ref LLP 0245#rollout-4-implementation-note--2026-08-15 — an upstream
    // verify failure cannot turn an empty registered path set into coverage.
    // Preserve the same zero-path nonclaim shape the aggregate producer emits.
    conformance = aggregateConformance(config.profiles, profileResults, {
      coverageRequirement: config.coverageRequirement ?? 'path-observation',
    });
  } else {
    conformance = Object.freeze({
      status: 'blocked', disposition: 'upstream-stage-failed', complete: false,
      coverageRequirement: config.coverageRequirement ?? 'path-observation',
      scope: 'registered-or-repository-adapted-paths',
      limitationReason: 'repository-adapted legacy suites remain partial until they emit D1 capture evidence',
      expectedPaths: registeredPathCount, observedPaths: 0,
      pathEvidence: [], underDeclarations: [], overDeclarations: [], diagnostics: [],
    });
  }
  const admissionAndConformance = {
    ok: admission.ok && ['passed', 'partial', 'not-claimed'].includes(conformance.status),
    blocked: admission.blocked,
    diagnostics: [...(admission.diagnostics ?? []), ...(conformance.diagnostics ?? [])],
    evidence: {
      admissionMode: admission.mode ?? null,
      servedTarget: servedTarget.evidence ?? null,
      conformance,
    },
  };
  const acceptance = {
    ok: canRunProfiles && capabilities.ok && profileResults.every(({ status }) => status === 'passed'),
    blocked: !canRunProfiles || !capabilities.ok,
    diagnostics: profileResults.flatMap(({ diagnostics }) => diagnostics),
    evidence: { profiles: profileResults },
  };
  const stages = Object.freeze([
    stage('artifact-freshness', {
      ...artifact,
      evidence: artifact.ok ? {
        identity: artifact.identity,
        generatedRoot: artifact.generatedRoot,
        verifiedGraph: artifact.verifiedGraph ?? null,
      } : null,
    }),
    stage('runtime-readiness', {
      ...runtime,
      evidence: runtime.ok ? (runtime.evidence ?? runtime.receipt ?? null) : null,
    }),
    stage('admission-and-conformance', admissionAndConformance),
    stage('capability-resolution', {
      ...capabilities,
      evidence: capabilities.blocked ? null : {
        targetProfileId: capabilities.targetProfileId ?? null,
        required: capabilities.required,
        supported: capabilities.supported,
        missing: capabilities.missing,
        resolutionMode: capabilities.resolutionMode ?? null,
      },
    }),
    stage('acceptance-profiles', acceptance),
  ]);
  const next = Object.freeze(stages.filter(({ status }) => status === 'failed').map(({ id }) => NEXT_BY_STAGE[id]));
  const finishedAtMs = options.now?.() ?? Date.now();
  const allStagesPassed = stages.every(({ status }) => status === 'passed');
  const acceptanceRegistered = config.profiles.length > 0;
  const receipt = {
    artifactKind: 'snapbackVerifyReceipt',
    schemaVersion: VERIFY_RECEIPT_SCHEMA_VERSION,
    ok: allStagesPassed,
    status: allStagesPassed
      ? acceptanceRegistered ? 'passed' : 'passed-without-acceptance'
      : 'failed',
    startedAtMs,
    finishedAtMs,
    durationMs: finishedAtMs - startedAtMs,
    profileSet: {
      ids: config.profiles.map(({ id }) => id).sort(),
      identity: `sha256:${createHash('sha256').update(stableJson({
        coverageRequirement: config.coverageRequirement ?? 'path-observation',
        profiles: config.profiles.map((profile) => ({
          id: profile.id,
          requiredCapabilities: profile.requiredCapabilities,
          paths: profile.paths,
          coverageCapability: profile.coverageCapability ?? null,
        })),
      })).digest('hex')}`,
      testBytes: profileSetTestBytes,
    },
    context: identityContext,
    stages,
    acceptanceProfiles: profileResults,
    next,
    ...(next.length === 1 ? { recommendedNext: next[0] } : {}),
    nonclaims: Object.freeze([
      'a passing receipt proves readiness under the registered contract, not product completion',
      'no registered acceptance paths means D1 aggregate coverage is not claimed',
      ...config.profiles.flatMap((profile) => (
        profile.coverageCapability?.claim === 'identity-bound-path-observation'
          ? [`acceptance profile ${profile.id} claims identity-bound path observation only; complete read/write operation provenance is not claimed`]
          : []
      )),
      ...(!servedTarget.claimed
        ? ['generated-artifact-local-admission does not claim a live target admitted the same bytes']
        : []),
      ...(!targetUsesLocalPackagedRuntime(artifact)
        ? ['the local packaged runtime readiness probe was skipped and makes no claim about the non-local target runtime']
        : []),
      'this receipt does not perform semantic review or satisfy LLP 0115 CV-14 review custody',
    ]),
  };
  return Object.freeze(receipt);
}

export function validateVerifyReceipt(receipt) {
  if (!plainObject(receipt) || receipt.artifactKind !== 'snapbackVerifyReceipt' || receipt.schemaVersion !== VERIFY_RECEIPT_SCHEMA_VERSION) {
    throw verifyError('SNAPBACK_VERIFY_RECEIPT_INVALID', 'receipt kind or schema version is invalid');
  }
  if (!Array.isArray(receipt.stages) || receipt.stages.length !== VERIFY_STAGE_IDS.length
    || receipt.stages.some((entry, index) => entry.id !== VERIFY_STAGE_IDS[index])) {
    throw verifyError('SNAPBACK_VERIFY_RECEIPT_INVALID', 'receipt does not contain the five ordered verify stages');
  }
  if (!Array.isArray(receipt.next) || (receipt.recommendedNext !== undefined && (receipt.next.length !== 1 || stableJson(receipt.recommendedNext) !== stableJson(receipt.next[0])))) {
    throw verifyError('SNAPBACK_VERIFY_RECEIPT_INVALID', 'recommendedNext is present without one mechanically unique next action');
  }
  return receipt;
}

export function writeVerifyReceipt(path, receipt) {
  validateVerifyReceipt(receipt);
  const output = resolve(path);
  const temporary = `${output}.tmp-${process.pid}`;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, output);
  return output;
}
