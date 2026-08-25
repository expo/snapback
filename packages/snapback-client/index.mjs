// Headless Snapback client adapter — the shared bridge, not per-demo glue.
//
// @ref LLP 0012#contract-artifacts — the bridge is a first-class
//   adapter (one shared client), not ~200 lines re-copied per demo as in Valet.
// @ref LLP 0012#runtime-state — subscribing returns the authoritative initial
//   snapshot *and* the live stream as one "current value + subscription" seam, so
//   no adapter races a manual prime against later updates.
// @ref LLP 0155#execution-contract — generated mutation IR in the bounded
//   Move-3 class replays locally as a private outbox-derived presentation;
//   authoritative mutation execution and settlement remain server-owned.
// @ref LLP 0034#2-d0--d1--a-liveness-signal-then-durable-push-to-the-browser — `liveQuery` gains a `stream`
//   transport over the managed shared live socket (one socket, both lanes) with
//   poll fallback, reconnect-by-fresh-subscribe, and the Exact LLP 0284 §2.2
//   connection axis.

import {
  createClientMutationId,
  retainedQueryKey,
  stableJson,
} from '@expo/snapback-contract/client-store';
import { classifyClientAuthorityState } from '@expo/snapback-contract/auth-coordinator';
import { isMintedIdentifier } from '@expo/snapback-contract/ids';
import {
  OPERATION_NAME_PATTERN,
  isOperationName,
} from '@expo/snapback-contract/operation-name';
import {
  createLiveQueryAuthorizationFence,
  createLiveQueryInstanceAllocator,
  createLiveQueryNamespace,
} from '@expo/snapback-contract/query-authorization';
import {
  scopeKey,
  validateAuthorizationInvalidationConnection,
  validateScopeId,
} from '@expo/snapback-contract/auth-invalidation';
import { isAgentAuthorityFence } from './agent-authority-brand.mjs';
import {
  devIdentityCapabilityFor,
  installDevIdentityCapability,
} from './dev-identity-capability.mjs';
import {
  createDeclaredDevEpisodeGate,
} from './declared-dev-episode.mjs';
import {
  normalizeArgumentsAgainstContractV1,
  normalizeGeneratedArgumentsV1,
} from './argument-normalization.mjs';
import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import {
  SnapbackDiagnosticError,
  asSnapbackDiagnosticError,
  isSnapbackDiagnosticError,
  snapbackDiagnosticError,
} from './diagnostic-error.mjs';

export { DEFAULT_AUTH_STORAGE_PARTITION } from './app-client-defaults.mjs';
export { createSnapbackAppClient } from './app-client.mjs';
export {
  CLIENT_AUTHORITY_STATES,
  CLIENT_AUTHORITY_STATE_MATRIX,
  CLIENT_AUTHORITY_SURFACES,
  CLIENT_AUTHORITY_TERMINALS,
  authorityTransitionCell,
  classifyClientAuthorityState,
} from './authority-transition.mjs';
import {
  SEARCH_REQUEST_ARGS_CONTRACT_GENERATION,
  SEARCH_REQUEST_ARGS_CONTRACT_HASH,
} from './search-contract.generated.mjs';
import {
  canonicalSenderExternalUri,
  createSenderIssuanceProofForCustody,
  createSenderProofForCustody,
  generateSenderConstraintKey,
  isCanonicalSenderNonce,
} from './sender-proof.mjs';
import {
  prepareReactBindingForClient,
} from './react-binding.mjs';
import { assertClientReferenceKind } from './reference-kinds.mjs';
import {
  attachOutboxDiagnosticsProducer,
  createClientDevConsoleReporter,
  createClientDiagnosticsChannel,
  DEFAULT_QUEUED_MUTATION_WEDGE_WARNING_MS,
  positiveDevelopmentEnvironment,
} from './client-diagnostics.mjs';
import { createRuntimeCostDiagnostics } from './runtime-cost-diagnostics.mjs';
import { readInlineBootPayload as readInlineBootPayloadForRegistration } from './rqs-preload-core.mjs';
import {
  deriveLegacyResumeAnswerV1,
} from './answer-classes.mjs';
import { applyLiveDeltaById, durableVersionAdvances } from './live-wire-core.mjs';
export { parseSearchQueryV1, search } from './search.mjs';
export { SnapbackCommandClient, createCommandClient } from './commands.mjs';
export {
  REMEDIATION_KIND_REGISTRY_VERSION,
  REMEDIATION_SET_MAX_ITEMS,
  REMEDIATION_SET_SCHEMA_VERSION,
  createIdentifierRemediationSet,
  decodeRemediationSet,
  remediationControlCatalogProjection,
} from './remediation.mjs';
export { createAssetClient } from './assets.mjs';
export {
  createClientDevConsoleReporter,
  createClientDiagnosticsChannel,
  DEFAULT_QUEUED_MUTATION_WEDGE_WARNING_MS,
  positiveDevelopmentEnvironment,
  projectDiagnosticV1,
} from './client-diagnostics.mjs';
export {
  CANONICAL_CLIENT_VALUE_V1_LIMITS,
  canonicalizeClientValueV1,
  canonicalReactStoreKeyV1,
} from './canonical-client-value.mjs';
export {
  ARGUMENT_NORMALIZATION_VERSION,
  exactArgumentContract,
  normalizeArgumentsAgainstContractV1,
  normalizeGeneratedArgumentsV1,
  optionalPropertyPathsV1,
} from './argument-normalization.mjs';
export {
  SnapbackDiagnosticError,
  isSnapbackDiagnosticError,
  projectAppRefusal,
} from './diagnostic-error.mjs';
export {
  compileResultContractValidator,
  RESULT_CONTRACT_LIMITS_V1,
} from '@expo/snapback-contract/result-contract-validator';
export {
  activeReactBindingDeploymentIdentity,
  admittedReactCommand,
  admittedReactEphemeralDefinition,
  admittedReactQueryGroup,
  admittedReactReference,
  admittedReactSurface,
  abandonConsumedReactQueryGroup,
  assertPreparedReactBinding,
  classifyRegeneratedReactReference,
  consumePreparedReactQueryGroup,
  handoffPreparedReactBindingGeneration,
  isPreparedReactQueryGroup,
  prepareReactQueryGroupForBinding,
  preparedReactResultContract,
  preparedReactBindingClient,
} from './react-binding.mjs';

export {
  AgentAuthorityFence,
  createMemoryAgentAuthorityCustodyStorage,
} from './agent-authority.mjs';
export { deriveServiceAuthorityInstanceId } from '@expo/snapback-contract/auth-coordinator';
export {
  assertExternalStoreCompatibility,
  createExternalQueryStore,
  externalStoreIdentity,
  ExternalQueryScope,
  SNAPBACK_EXTERNAL_STORE_PROTOCOL,
} from './external-store.mjs';

import {
  argsHash,
  base64UrlNoPad,
  membershipWitnessOfRows,
  rowsMatchDigest,
  sha256,
} from './rqs.mjs';
import {
  arbitrateResumeCandidates,
  rqsEntryKey,
  verifyPersistedResumeEntry,
} from './rqs-store.mjs';
export {
  arbitrateResumeCandidates,
  createIndexedDbRqsResumeStore,
  rqsEntryKey,
  verifyPersistedResumeEntry,
  RQS_STORE_MAX_BYTES,
  RQS_STORE_MAX_ENTRIES,
} from './rqs-store.mjs';
export { createFileRqsResumeStore } from './rqs-store-file.mjs';
export {
  createExpoFilesAdapter,
  createExpoRqsResumeStore,
  registerExpoFileSystemRqsFiles,
} from './rqs-store-expo.mjs';
export { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';
export {
  clearNativeRqsFiles,
  registerNativeRqsFiles,
  resolveDefaultRqsStore,
} from './rqs-store-default.mjs';
export {
  createRqsPreloadRegistry,
  createRqsRegisteredRegistry,
  readInlineBootPayload,
  readRqsPreloadRegistry,
  RQS_BOOT_ELEMENT_ID,
} from './rqs-preload-core.mjs';
import {
  isDefaultRqsStoreResolution,
  resolveDefaultRqsStore,
} from './rqs-store-default.mjs';

// Connectivity classification (transport provenance, 0137 A1-Expo f2) now
// lives in outbox-shared.mjs so the binding-receipt path in react-binding.mjs
// — which cannot import this module without a cycle — applies the exact same
// rule. sanitizeTransportError below still owns the provenance stamp.
import {
  isConnectivityFailureError,
  OUTBOX_QUARANTINE_TOMBSTONE_FORMAT,
} from './outbox-shared.mjs';
import {
  rewriteOptimisticLayerIdsV1,
  settlementIdResolution,
} from './settlement-id-resolution.mjs';

// @ref LLP 0162#acceptance — once an operation identity is below the retained
// outcome horizon, the client must expose unknown outcome and retain durable
// intent; it may never publish a terminal local failure or blindly retry.
const isOperationOutcomeUnknownError = (error) => (
  error?.diagnostic?.code === 'SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED'
  || error?.code === 'SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED'
  || error?.diagnostic?.details?.disposition === 'identity-horizon-passed'
);

const isOperationResultExpiredError = (error) => (
  error?.diagnostic?.code === 'SNAPBACK_OPERATION_RESULT_EXPIRED'
  || error?.code === 'SNAPBACK_OPERATION_RESULT_EXPIRED'
  || error?.diagnostic?.details?.disposition === 'result-expired'
);

// @ref LLP 0043#dated-c28-lifecycle-reconciliation-2026-08-05 — aggregate
// epoch capacity is uncovered queueing, never a terminal mutation failure.
const isOperationRangeCapacityError = (error) => (
  error?.diagnostic?.code === 'SNAPBACK_OPERATION_RANGE_EXHAUSTED'
  || error?.code === 'SNAPBACK_OPERATION_RANGE_EXHAUSTED'
);

const isOperationRangeRecoveryBlockedError = (error) => (
  isOperationRangeCapacityError(error)
  || error?.diagnostic?.code === 'SNAPBACK_OPERATION_RANGE_REAUTH_REQUIRED'
  || error?.code === 'SNAPBACK_OPERATION_RANGE_REAUTH_REQUIRED'
);

// Mirrored from @expo/snapback-sidecar so the client/storage owner can enforce
// LLP 0081 without importing the desktop supervisor. The suffix rule keeps
// target-specific upgrade refusals inside the same fail-closed family.
const DEFAULT_UPGRADE_REQUIRED_CODES = new Set([
  'SNAPBACK_UPGRADE_REQUIRED',
  'SNAPBACK_CLIENT_UPGRADE_REQUIRED',
  'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
]);

const isUpgradeRequiredRefusal = (error) => {
  const code = error?.diagnostic?.code ?? error?.code;
  return typeof code === 'string'
    && (DEFAULT_UPGRADE_REQUIRED_CODES.has(code) || /_UPGRADE_REQUIRED$/u.test(code));
};

const STREAM_RESET_RETRY_DELAY_MS = 250;

const OPTIMISTIC_PROCESS_ORDER_KEY = Symbol.for(
  'expo.snapback-client.optimistic-process-order.v1',
);
const optimisticProcessOrder = (() => {
  const existing = globalThis[OPTIMISTIC_PROCESS_ORDER_KEY];
  if (
    existing !== null
    && typeof existing === 'object'
    && typeof existing.epoch === 'string'
    && Number.isSafeInteger(existing.sequence)
    && existing.sequence >= 0
  ) return existing;
  const created = { epoch: createClientMutationId(), sequence: 0 };
  try {
    globalThis[OPTIMISTIC_PROCESS_ORDER_KEY] = created;
  } catch { /* module-local process epoch fallback */ }
  return created;
})();
const nextOptimisticInvocationSequence = () => {
  if (optimisticProcessOrder.sequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error('SNAPBACK_OPTIMISTIC_INVOCATION_SEQUENCE_EXHAUSTED');
  }
  optimisticProcessOrder.sequence += 1;
  return optimisticProcessOrder.sequence;
};

const OUTBOX_DRAIN_RETRY_BASE_MS = 250;
const OUTBOX_DRAIN_RETRY_MAX_MS = 30_000;
const OUTBOX_DRAIN_WRITER_POLL_MS = 1_000;
const OUTBOX_DRAIN_BARRIER_TIMEOUT_MS = 15_000;
const OUTBOX_DRAIN_REGISTRY_KEY = Symbol.for(
  'expo.snapback-client.outbox-drain-registry.v1',
);
// @ref LLP 0218#43-the-platform-owned-drain — a realm-global weak registry
//   makes Strict-Mode/HMR and multiple clients over one store merge into the
//   live lifecycle; the durable store, not a component or client instance, is
//   the dedupe key.
const outboxDrainControllersByStore = (() => {
  const existing = globalThis[OUTBOX_DRAIN_REGISTRY_KEY];
  if (existing instanceof WeakMap) return existing;
  const created = new WeakMap();
  try { globalThis[OUTBOX_DRAIN_REGISTRY_KEY] = created; } catch { /* module-local fallback */ }
  return created;
})();
const OUTBOX_FOREGROUND_OWNERS_REGISTRY_KEY = Symbol.for(
  'expo.snapback-client.outbox-foreground-owners.v1',
);
const outboxForegroundOwnersByStore = (() => {
  const existing = globalThis[OUTBOX_FOREGROUND_OWNERS_REGISTRY_KEY];
  if (existing instanceof WeakMap) return existing;
  const created = new WeakMap();
  try {
    globalThis[OUTBOX_FOREGROUND_OWNERS_REGISTRY_KEY] = created;
  } catch { /* module-local fallback */ }
  return created;
})();
const claimForegroundOutboxRecord = (store, record) => {
  if (!store || typeof record?.id !== 'string') return false;
  let owners = outboxForegroundOwnersByStore.get(store);
  if (owners === undefined) {
    owners = new Map();
    outboxForegroundOwnersByStore.set(store, owners);
  }
  const current = owners.get(record.id);
  owners.set(record.id, {
    count: (current?.count ?? 0) + 1,
    sequence: Number.isSafeInteger(record.sequence) ? record.sequence : current?.sequence ?? null,
  });
  return true;
};
const releaseForegroundOutboxRecord = (store, clientMutationId) => {
  const owners = outboxForegroundOwnersByStore.get(store);
  const current = owners?.get(clientMutationId);
  if (current === undefined) return false;
  if (current.count > 1) owners.set(clientMutationId, { ...current, count: current.count - 1 });
  else owners.delete(clientMutationId);
  if (owners.size === 0) outboxForegroundOwnersByStore.delete(store);
  return true;
};
const foregroundOutboxFenceSequence = (store) => {
  const owners = outboxForegroundOwnersByStore.get(store);
  if (owners === undefined) return null;
  let fence = null;
  for (const owner of owners.values()) {
    if (!Number.isSafeInteger(owner.sequence)) return Number.NEGATIVE_INFINITY;
    if (fence === null || owner.sequence < fence) fence = owner.sequence;
  }
  return fence;
};
const isForegroundReplayEligible = (store, record) => {
  if (record?.dispatchLane === 'housekeeping') return false;
  const fence = foregroundOutboxFenceSequence(store);
  if (fence === null) return true;
  return Number.isSafeInteger(record?.sequence) && record.sequence < fence;
};
const replayEligibleOutboxRecords = (store, records) => records
  .filter((record) => record?.status === 'pending')
  .filter((record) => isForegroundReplayEligible(store, record));
const isHousekeepingReplayEligible = (record) => record?.dispatchLane === 'housekeeping';

const acquireOutboxAuthorizationDispatch = async (store, lane = null) => {
  if (typeof store?.withOutboxAuthorizationDispatch !== 'function') {
    return async () => {};
  }
  let enterResolve;
  let enterReject;
  let releaseResolve;
  const entered = new Promise((resolve, reject) => {
    enterResolve = resolve;
    enterReject = reject;
  });
  const held = new Promise((resolve) => { releaseResolve = resolve; });
  const task = Promise.resolve(store.withOutboxAuthorizationDispatch(async () => {
    enterResolve();
    await held;
  }, { lane }));
  task.catch(enterReject);
  await entered;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    releaseResolve();
    await task;
  };
};
let outboxDrainControllerCounter = 0;

const isRetryableStreamResetRefusal = (error) => (
  error?.status === 401
  && error?.diagnostic?.code === 'SNAPBACK_AUTH_STREAM_RESET'
  && error?.diagnostic?.details?.retryable === true
);

// Exact protocol/profile offers are client configuration, not server
// readiness. A 400 from this class cannot change under an unchanged live
// subscribe, so framework owners must surface it instead of starting a retry
// loop. Keep readiness/unavailability 503s outside this classification.
//
// @ref LLP 0094#0e--refusal-code-registry-negotiation — the exact closed
//   negotiation/configuration set requires caller repair and forbids
//   unchanged retry; readiness and transport neighbors remain retryable.
const TERMINAL_LIVE_PROTOCOL_REFUSAL_CODES = new Set([
  'SNAPBACK_AUTHORIZED_LEASE_CLIENT_UNSUPPORTED',
  'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED',
  'SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED',
  'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED',
  'SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED',
  'SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED',
  'SNAPBACK_EPHEMERAL_AUTHORITY_PROTOCOL_MISMATCH',
  'SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED',
  'SNAPBACK_EPHEMERAL_EXPIRY_PROTOCOL_MISMATCH',
  'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED',
  'SNAPBACK_WIRE_VERSION_MISMATCH',
  'SNAPBACK_WIRE_VERSION_REQUIRED',
  'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
]);

export const isTerminalLiveProtocolRefusal = (error) => {
  const code = error?.diagnostic?.code ?? error?.code;
  if (typeof code !== 'string' || (error?.status !== undefined && error.status !== 400)) {
    return false;
  }
  return TERMINAL_LIVE_PROTOCOL_REFUSAL_CODES.has(code);
};

const operationOutcomeFromError = (error) => {
  const outcome = error?.diagnostic?.details?.outcome;
  return outcome === 'committed' || outcome === 'refused' ? outcome : 'unknown';
};

// ---------------------------------------------------------------------------
// D1 freshness + reconnect policy (LLP 0034 §2.2/§2.3; Exact LLP 0284 §2.2).
//
// The server sends nothing on an idle-healthy socket, so freshness is a
// kit-derived policy with explicit timers: the client sends an app-level
// `{"type":"ping"}` every LIVE_HEARTBEAT_INTERVAL_MS while the socket is open
// (the server answers `{"kind":"pong"}` immediately — src/server.rs), and any
// received frame counts as socket activity. The freshness budget is
// LIVE_FRESHNESS_BUDGET_MS = 3x the heartbeat interval; silence past the
// budget is a missed budget: the socket is force-closed and reconnect begins.
//
// Connection-axis mapping (normative table, LLP 0034 §2.2):
//
//   | provider state                                              | value          |
//   |-------------------------------------------------------------|----------------|
//   | socket connecting / (re)subscribe in flight                 | 'connecting'   |
//   | socket open, subscription established, heartbeat in budget  | 'live'         |
//   | no socket; HTTP drain timer active at declared cadence      | 'polling'      |
//   | freshness budget missed while retry/backoff is in progress  | 'stale'        |
//   | closed with no retry scheduled; drain stopped               | 'disconnected' |
//
// Notes against the table as implemented:
// - With poll fallback enabled (the default), losing the socket goes straight
//   to 'polling' — the declared-cadence drain is a healthy declared transport,
//   not a degradation mystery. With fallback disabled, socket loss goes to
//   'stale' (last-known rows renderable, retry in progress).
// - transport:'poll' handles (the pre-D1 behavior, still the default) report
//   'polling' after establish: the cadence is caller-owned there, so the kit
//   claims no freshness budget for them.
//
// Reconnect (LLP 0034 §2.3, amended): the server drops a connection's durable
// subscriptions when its socket closes (src/server.rs live_stream ->
// LocalSnapback::disconnect), so there is nothing to resume across a socket
// loss. Reconnect therefore ALWAYS re-enters through a fresh subscribe_live —
// snapshot-with-subscribe, never a prime race — and emits a 'resubscribed'
// subscription event. `resume_live` is not used across socket loss; a
// subscription-survival grace window is future work.
// ---------------------------------------------------------------------------
export const LIVE_HEARTBEAT_INTERVAL_MS = 5_000;
export const LIVE_FRESHNESS_BUDGET_MS = LIVE_HEARTBEAT_INTERVAL_MS * 3;
export const LIVE_RECONNECT_BASE_DELAY_MS = 250;
export const LIVE_RECONNECT_MAX_DELAY_MS = 10_000;
// Provider poll floor: the declared HTTP outbox drain cadence used as the
// stream fallback and emitted by codegen as the manifest `pollCadenceMs`.
export const DEFAULT_POLL_CADENCE_MS = 1_500;

const SNAPBACK_ID_TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SNAPBACK_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

const freezeDeep = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const member of Object.values(value)) freezeDeep(member);
    Object.freeze(value);
  }
  return value;
};

const copyInspectionValue = (value) => {
  if (Array.isArray(value)) return value.map(copyInspectionValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, copyInspectionValue(member)]),
    );
  }
  return value;
};

const mutationTiming = (record = null) => Object.freeze({
  enqueuedAtMs: record?.timing
    && Object.prototype.hasOwnProperty.call(record.timing, 'enqueuedAtMs')
    ? record.timing.enqueuedAtMs
    : record?.enqueuedAt ?? null,
  dispatchedAtMs: record?.timing?.dispatchedAtMs ?? null,
  authorizedAtMs: record?.timing?.authorizedAtMs ?? record?.settlement?.timing?.authorizedAtMs ?? null,
  executedAtMs: record?.timing?.executedAtMs ?? record?.settlement?.timing?.executedAtMs ?? null,
  committedAtMs: record?.timing?.committedAtMs ?? record?.settlement?.timing?.committedAtMs ?? null,
});

const MUTATION_PHASE_COST_RECORD_LIMIT = 512;
const MUTATION_PHASE_COST_BYTE_LIMIT = 1024 * 1024;
const MUTATION_PHASE_COST_COUNTER_KEY_LIMIT = 1_024;
const MUTATION_PHASE_COST_DETAIL_SAMPLING_THRESHOLD = 512;
const MUTATION_PHASE_COST_DETAIL_SAMPLE_EVERY = 4;
const MUTATION_PHASE_NAMES = Object.freeze([
  'queueWaitMs',
  'authWaitMs',
  'executionMs',
  'commitMs',
]);
const utf8ByteLength = (value) => new TextEncoder().encode(value).byteLength;

/**
 * Stable gated-inspection pseudonym using the same JCS + SHA-256 args-hash
 * algorithm as the query-cost window ledger. This is a fingerprint, not an
 * anonymization claim, and must not cross a public/export boundary.
 */
export function inspectionPseudonymV1(value) {
  if (typeof value !== 'string') {
    throw new TypeError('inspectionPseudonymV1 requires a string');
  }
  return argsHash(value);
}

const finiteTimestampOrNull = (value) => Number.isFinite(value) ? value : null;
const durationBetween = (start, end) => (
  start === null || end === null ? null : end - start
);

/** The single LLP 0267 §7.2 subtraction vocabulary. */
export function mutationPhaseDurationsV1(timing = {}) {
  const enqueuedAtMs = finiteTimestampOrNull(timing?.enqueuedAtMs);
  const dispatchedAtMs = finiteTimestampOrNull(timing?.dispatchedAtMs);
  const authorizedAtMs = finiteTimestampOrNull(timing?.authorizedAtMs);
  const executedAtMs = finiteTimestampOrNull(timing?.executedAtMs);
  const committedAtMs = finiteTimestampOrNull(timing?.committedAtMs);
  return Object.freeze({
    queueWaitMs: durationBetween(enqueuedAtMs, dispatchedAtMs),
    authWaitMs: durationBetween(dispatchedAtMs, authorizedAtMs),
    executionMs: durationBetween(authorizedAtMs, executedAtMs),
    commitMs: durationBetween(executedAtMs, committedAtMs),
  });
}

const mutationPhaseCostRecord = ({
  clientMutationId,
  functionId,
  timing,
  disposition,
}, { pseudonymize = false } = {}) => {
  if (typeof clientMutationId !== 'string' || clientMutationId.length === 0) {
    throw new TypeError('MutationPhaseCostV1 requires clientMutationId');
  }
  if (typeof functionId !== 'string' || functionId.length === 0) {
    throw new TypeError('MutationPhaseCostV1 requires functionId');
  }
  if (typeof disposition !== 'string' || disposition.length === 0) {
    throw new TypeError('MutationPhaseCostV1 requires disposition');
  }
  const normalizedTiming = Object.freeze({
    enqueuedAtMs: finiteTimestampOrNull(timing?.enqueuedAtMs),
    dispatchedAtMs: finiteTimestampOrNull(timing?.dispatchedAtMs),
    authorizedAtMs: finiteTimestampOrNull(timing?.authorizedAtMs),
    executedAtMs: finiteTimestampOrNull(timing?.executedAtMs),
    committedAtMs: finiteTimestampOrNull(timing?.committedAtMs),
  });
  return Object.freeze({
    format: 'snapback.mutation-phase-cost.v1',
    clientMutationId: pseudonymize
      ? inspectionPseudonymV1(clientMutationId)
      : clientMutationId,
    functionId,
    ...normalizedTiming,
    ...mutationPhaseDurationsV1(normalizedTiming),
    disposition,
  });
};

/** Project one ruling-6 timing carrier at the gated snapshot boundary. */
export function projectMutationPhaseCostV1(input) {
  return mutationPhaseCostRecord(input, { pseudonymize: true });
}

const inspectionAuthorityClass = (authority) => {
  const state = typeof authority?.state === 'string' ? authority.state : 'unknown';
  return authority?.settled === true ? `settled:${state}` : `transitioning:${state}`;
};

/**
 * Project the D0.5 sharing tuple without copying caller strings, principals,
 * or a literal server URL. The internal sharing key remains unchanged.
 */
export function projectOwnershipTupleInspectionV1({
  canonicalAppId = null,
  storagePartition,
  settledAuthority,
} = {}) {
  if (typeof storagePartition !== 'string' || storagePartition.length === 0) {
    throw new TypeError('ownership inspection requires storagePartition');
  }
  return Object.freeze({
    format: 'snapback.ownership-tuple-inspection.v1',
    canonicalAppId: canonicalAppId === null ? null : inspectionPseudonymV1(canonicalAppId),
    storagePartition: inspectionPseudonymV1(storagePartition),
    serverInstance: 'self',
    authorityClass: inspectionAuthorityClass(settledAuthority),
  });
}

const normalizedSubscriptionState = (row) => {
  const state = row?.subscriptionState ?? row?.state ?? 'UNKNOWN';
  const normalized = String(state).replaceAll('-', '_').toUpperCase();
  if (normalized === 'ACTIVE') return 'LIVE';
  if (normalized === 'PAUSED') return 'RESYNC_PENDING';
  return normalized;
};

const normalizedConnectionState = (row) => {
  const state = row?.connectionState ?? row?.connection ?? 'UNKNOWN';
  const normalized = String(state).replaceAll('-', '_').toUpperCase();
  if (normalized === 'LIVE') return 'ATTACHED_LIVE';
  if (normalized === 'POLLING') return 'ATTACHED_POLL';
  if (normalized === 'STALE') return 'RECOVERING';
  if (normalized === 'CONNECTING') return 'GRANTED';
  if (normalized === 'DISCONNECTED') return 'IDLE';
  return normalized;
};

const pendingDeliveryOutcome = (outcome, pendingDeliveryReason, detail) => freezeDeep({
  outcome,
  pendingDeliveryReason,
  detail,
});

const snapshotSkewOutcome = (direction) => pendingDeliveryOutcome(
  'snapshot-skew',
  null,
  { class: 'snapshot-skew', direction, reread: 'client-and-server' },
);

/**
 * LLP 0267 §7.4's strict ordered decision list. This function is pure: the
 * derived answer is retained on neither the client nor server snapshot.
 */
export function derivePendingDeliveryOutcomeV1(clientRow, serverRow) {
  if (clientRow === null) {
    return serverRow === null
      ? pendingDeliveryOutcome('neutral', null, { class: 'retired' })
      : snapshotSkewOutcome('server-ahead-of-client-retirement');
  }

  const subscriptionState = normalizedSubscriptionState(clientRow);
  const connectionState = normalizedConnectionState(clientRow);
  const supersedes = clientRow.supersedesSubscriptionId ?? clientRow.supersedes ?? null;

  // Step 0: lifecycle classes precede every hold/reason and owed comparison.
  if (subscriptionState === 'PENDING' && supersedes === null) {
    return pendingDeliveryOutcome('neutral', null, { class: 'initial-pending' });
  }
  if (
    subscriptionState === 'RELEASED'
    || subscriptionState === 'TERMINAL_DELETED'
    || connectionState === 'CLOSED'
  ) {
    return serverRow === null
      ? pendingDeliveryOutcome('neutral', null, { class: 'retired' })
      : snapshotSkewOutcome('server-ahead-of-client-retirement');
  }
  if (connectionState === 'IDLE' && serverRow === null) {
    return pendingDeliveryOutcome('neutral', null, { class: 'idle' });
  }

  // Step 1: the six closed reason members, first match wins.
  const terminalCode = clientRow.terminalCode ?? clientRow.terminalDiagnosticCode ?? null;
  if (
    typeof terminalCode === 'string'
    || connectionState === 'TERMINAL_AUTH'
    || subscriptionState === 'TERMINAL_QUARANTINE'
  ) {
    return pendingDeliveryOutcome('reason', 'terminal-quarantine', {
      class: 'terminal-quarantine',
      terminalCode,
    });
  }
  const suspension = clientRow.outboxSuspensionReason ?? clientRow.blockedReason ?? null;
  if (suspension === 'auth-barrier') {
    return pendingDeliveryOutcome('reason', 'auth-barrier', { class: 'auth-barrier' });
  }
  if (suspension === 'custody-unsettled') {
    return pendingDeliveryOutcome('reason', 'custody-unsettled', {
      class: 'custody-unsettled',
    });
  }
  if (typeof suspension === 'string' && suspension.startsWith('authority-unavailable:')) {
    return pendingDeliveryOutcome('reason', 'authority-unavailable', {
      class: 'authority-unavailable',
      blockedReason: suspension,
    });
  }
  if (
    connectionState === 'RECOVERING'
    || connectionState === 'GRANT_LOST'
    || subscriptionState === 'DROPPED'
    || subscriptionState === 'RESYNC_PENDING'
    || (subscriptionState === 'PENDING' && supersedes !== null)
  ) {
    return pendingDeliveryOutcome('reason', 'transport-recovery', {
      class: 'transport-recovery',
      connectionState,
      subscriptionState,
    });
  }
  const evaluation = serverRow?.evaluation ?? 'idle';
  const pendingWork = serverRow?.pendingWork ?? 'none';
  const activeStage = serverRow !== null
    && (evaluation !== 'idle' || pendingWork !== 'none');
  if (activeStage) {
    return pendingDeliveryOutcome('reason', 'server-pending', {
      class: 'server-pending',
      evaluation,
      currentWaveSeq: serverRow.currentWaveSeq ?? null,
      pendingWork,
      owedThroughVersion: serverRow.owedThroughVersion ?? null,
    });
  }

  // Step 2: total residuals over admitted client/server pairs.
  if (serverRow !== null) {
    const authoritativeRevision = Number.isSafeInteger(clientRow.authoritativeRevision)
      ? clientRow.authoritativeRevision
      : Number.isSafeInteger(clientRow.snapshotVersion)
        ? clientRow.snapshotVersion
        : null;
    const owedThroughVersion = Number.isSafeInteger(serverRow.owedThroughVersion)
      ? serverRow.owedThroughVersion
      : null;
    if (owedThroughVersion !== null && authoritativeRevision === null) {
      return pendingDeliveryOutcome('defect', null, {
        class: 'unrepresentable-pair',
        reason: 'owed-version-without-client-revision',
      });
    }
    if (owedThroughVersion !== null && owedThroughVersion > authoritativeRevision) {
      return pendingDeliveryOutcome('defect', null, {
        class: 'owed-without-recorded-stage',
        owedThroughVersion,
        authoritativeRevision,
      });
    }
    if (
      authoritativeRevision !== null
      && Number.isSafeInteger(serverRow.lastDeliveredVersion)
      && serverRow.lastDeliveredVersion > authoritativeRevision
    ) {
      return pendingDeliveryOutcome('neutral', null, {
        class: 'in-transit',
        lastDeliveredVersion: serverRow.lastDeliveredVersion,
        authoritativeRevision,
      });
    }
    return pendingDeliveryOutcome('neutral', null, { class: 'settled' });
  }

  if (
    subscriptionState === 'LIVE'
    && ['ATTACHED_LIVE', 'ATTACHED_POLL', 'GRANTED'].includes(connectionState)
  ) {
    return snapshotSkewOutcome('client-ahead-of-server-retirement');
  }
  return pendingDeliveryOutcome('defect', null, {
    class: 'unrepresentable-pair',
    reason: 'server-row-absent-outside-retirement-or-recovery',
    connectionState,
    subscriptionState,
  });
}

const snapshotRows = (snapshot, candidates) => {
  for (const path of candidates) {
    let value = snapshot;
    for (const member of path) value = value?.[member];
    if (Array.isArray(value)) return value;
  }
  return [];
};

const uniqueInspectionMap = (rows, key, label, { numeric = false } = {}) => {
  const result = new Map();
  for (const row of rows) {
    const identity = row?.[key];
    const valid = numeric
      ? Number.isSafeInteger(identity) && identity >= 0
      : typeof identity === 'string' && identity.length > 0;
    if (!valid) {
      throw new TypeError(`${label} row requires ${key}`);
    }
    if (result.has(identity)) throw new TypeError(`${label} contains duplicate ${key} ${identity}`);
    result.set(identity, row);
  }
  return result;
};

/** Join the two gated pull snapshots by subscription id, then by waveSeq. */
export function joinPendingDeliveryInspectionV1(
  clientSnapshot,
  serverSnapshot,
  { previous = null } = {},
) {
  const clientRows = snapshotRows(clientSnapshot, [['subscriptions']]);
  const serverRows = snapshotRows(serverSnapshot, [
    ['runtimeCost', 'subscriptionRegistry'],
    ['subscriptions'],
    ['liveSubscriptions'],
  ]);
  const waves = snapshotRows(serverSnapshot, [
    ['runtimeCost', 'liveDeliveryWaves', 'records'],
    ['liveDeliveryWaves'],
  ]);
  const unidentifiedInitialClients = [];
  const identifiedClientRows = [];
  for (const row of clientRows) {
    if (typeof row?.subscriptionId === 'string' && row.subscriptionId.length > 0) {
      identifiedClientRows.push(row);
      continue;
    }
    const supersedes = row?.supersedesSubscriptionId ?? row?.supersedes ?? null;
    if (
      row?.subscriptionId === null
      && normalizedSubscriptionState(row) === 'PENDING'
      && supersedes === null
    ) {
      unidentifiedInitialClients.push(row);
      continue;
    }
    throw new TypeError('client snapshot row requires subscriptionId unless it is initial PENDING');
  }
  const clients = uniqueInspectionMap(
    identifiedClientRows,
    'subscriptionId',
    'client snapshot',
  );
  const servers = uniqueInspectionMap(serverRows, 'subscriptionId', 'server snapshot');
  const waveMap = uniqueInspectionMap(
    waves,
    'waveSeq',
    'server wave snapshot',
    { numeric: true },
  );
  const previousRows = new Map((previous?.subscriptions ?? []).map((row) => [
    row.subscriptionId,
    row,
  ]));
  const subscriptionIds = [...new Set([...clients.keys(), ...servers.keys()])].sort();
  const subscriptions = unidentifiedInitialClients.map((client) => freezeDeep({
    format: 'snapback.pending-delivery-inspection-row.v1',
    subscriptionId: null,
    functionId: client?.functionName ?? client?.functionId ?? null,
    ...derivePendingDeliveryOutcomeV1(client, null),
    serverRegistry: null,
    wave: null,
  }));
  subscriptions.push(...subscriptionIds.map((subscriptionId) => {
    const client = clients.get(subscriptionId) ?? null;
    const server = servers.get(subscriptionId) ?? null;
    let derived = derivePendingDeliveryOutcomeV1(client, server);
    const prior = previousRows.get(subscriptionId) ?? null;
    if (
      derived.outcome === 'snapshot-skew'
      && prior?.outcome === 'snapshot-skew'
      && prior.detail?.direction === derived.detail?.direction
    ) {
      derived = pendingDeliveryOutcome('defect', null, {
        class: 'persistent-snapshot-skew',
        direction: derived.detail.direction,
      });
    }
    const joinedWaveSeq = Number.isSafeInteger(server?.currentWaveSeq)
      ? server.currentWaveSeq
      : Number.isSafeInteger(server?.lastDeliveredWaveSeq)
        ? server.lastDeliveredWaveSeq
        : null;
    return freezeDeep({
      format: 'snapback.pending-delivery-inspection-row.v1',
      subscriptionId,
      functionId: client?.functionName ?? client?.functionId
        ?? server?.functionName ?? server?.functionId ?? null,
      ...derived,
      serverRegistry: copyInspectionValue(server),
      wave: joinedWaveSeq === null
        ? null
        : copyInspectionValue(waveMap.get(joinedWaveSeq) ?? null),
    });
  }));
  return freezeDeep({
    format: 'snapback.pending-delivery-inspection.v1',
    subscriptions,
  });
}

const emptyMutationPhaseAggregate = (functionId) => ({
  functionId,
  count: 0,
  queueWaitMs: { count: 0, totalMs: 0, maxMs: null },
  authWaitMs: { count: 0, totalMs: 0, maxMs: null },
  executionMs: { count: 0, totalMs: 0, maxMs: null },
  commitMs: { count: 0, totalMs: 0, maxMs: null },
});

const addMutationPhaseRecordToAggregate = (aggregate, record) => {
  aggregate.count += 1;
  for (const phase of MUTATION_PHASE_NAMES) {
    const value = record[phase];
    if (value === null) continue;
    aggregate[phase].count += 1;
    aggregate[phase].totalMs += value;
    aggregate[phase].maxMs = aggregate[phase].maxMs === null
      ? value
      : Math.max(aggregate[phase].maxMs, value);
  }
};

const mergeMutationPhaseAggregates = (target, source) => {
  target.count += source.count;
  for (const phase of MUTATION_PHASE_NAMES) {
    target[phase].count += source[phase].count;
    target[phase].totalMs += source[phase].totalMs;
    if (source[phase].maxMs !== null) {
      target[phase].maxMs = target[phase].maxMs === null
        ? source[phase].maxMs
        : Math.max(target[phase].maxMs, source[phase].maxMs);
    }
  }
};

const freezeMutationPhaseAggregate = (aggregate) => freezeDeep(structuredClone(aggregate));

const isUnresolvedOutboxRecord = (record) => (
  record?.status === 'pending'
  || record?.status === 'quarantined'
  || record?.status === 'result-gone'
);

const outboxDispositionCounts = (records) => {
  const counts = { pending: 0, failed: 0, stranded: 0, quarantined: 0, resultGone: 0 };
  for (const record of records) {
    if (record?.status === 'pending') counts.pending += 1;
    else if (record?.status === 'failed') counts.failed += 1;
    else if (record?.status === 'stranded') counts.stranded += 1;
    else if (record?.status === 'quarantined') counts.quarantined += 1;
    else if (record?.status === 'result-gone') counts.resultGone += 1;
  }
  return counts;
};

const samePrincipalScope = (left, right) => (
  left?.authMode === right?.authMode
  && left?.authorizationStreamIncarnation === right?.authorizationStreamIncarnation
  && (left?.userId ?? null) === (right?.userId ?? null)
);

const outboxAuthorizationFenceFrom = (value) => Object.freeze({
  authorityGeneration: value?.authorizationAuthorityGeneration
    ?? value?.authorityGeneration,
  generation: value?.authorizationQueueGeneration ?? value?.generation,
});

const authorizationDeleteTombstone = (record) => (
  record?.status === 'stranded'
  && record?.disposition === 'delete'
  && record?.discardOnly === true
  && record?.rerecordable === false
  && record?.replayable === false
);

const effectProvenanceFromError = (error) => {
  const details = error?.diagnostic?.details;
  const effectCommitted = typeof error?.effectCommitted === 'boolean'
    ? error.effectCommitted
    : typeof details?.effectCommitted === 'boolean'
      ? details.effectCommitted
      : null;
  const effectMayHaveCommitted = typeof error?.effectMayHaveCommitted === 'boolean'
    ? error.effectMayHaveCommitted
    : typeof details?.effectMayHaveCommitted === 'boolean'
      ? details.effectMayHaveCommitted
      : effectCommitted === true
        ? true
        : effectCommitted === false
          ? false
          : null;
  return Object.freeze({
    effectCommitted,
    effectMayHaveCommitted: effectCommitted === true ? true : effectMayHaveCommitted,
  });
};

const outboxInsertionOwnershipFrom = (record) => (
  record?.insertionOwned === true
  && Number.isSafeInteger(record?.sequence)
  && record.sequence > 0
    ? Object.freeze({ sequence: record.sequence })
    : null
);

const nonReplayableOutboxEffectFacts = (record) => {
  if (record?.status === 'result-gone') {
    if (record?.resultGone?.outcome === 'committed') {
      return { effectCommitted: true, effectMayHaveCommitted: true };
    }
    if (record?.resultGone?.outcome === 'refused') {
      return { effectCommitted: false, effectMayHaveCommitted: false };
    }
    return { effectCommitted: null, effectMayHaveCommitted: null };
  }
  if (['failed', 'stranded', 'quarantined'].includes(record?.status)) {
    const provenance = record?.effectProvenance;
    if (
      provenance?.effectCommitted === true
      && provenance?.effectMayHaveCommitted === true
    ) return { effectCommitted: true, effectMayHaveCommitted: true };
    if (
      provenance?.effectCommitted === false
      && provenance?.effectMayHaveCommitted === false
    ) return { effectCommitted: false, effectMayHaveCommitted: false };
    if (
      provenance?.effectCommitted === null
      && provenance?.effectMayHaveCommitted === true
    ) return { effectCommitted: null, effectMayHaveCommitted: true };
    return { effectCommitted: null, effectMayHaveCommitted: null };
  }
  return { effectCommitted: null, effectMayHaveCommitted: null };
};

const nonReplayableOutboxDispositionError = (record) => {
  const deleteTombstone = authorizationDeleteTombstone(record);
  const effectFacts = nonReplayableOutboxEffectFacts(record);
  const code = deleteTombstone
    ? 'SNAPBACK_OUTBOX_AUTHORIZATION_DELETE_TOMBSTONE'
    : 'SNAPBACK_OUTBOX_MUTATION_NOT_REPLAYABLE';
  const status = typeof record?.status === 'string' ? record.status : 'unknown';
  const message = deleteTombstone
    ? 'authorization proof deleted the mutation intent; its redacted tombstone is terminal'
    : `the durable mutation disposition ${status} is not replay-eligible`;
  const mutationDisposition = freezeDeep({
    status,
    disposition: record?.disposition ?? null,
    discardOnly: record?.discardOnly === true,
    replayable: record?.replayable === true,
  });
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    subsystem: 'outbox',
    message,
    details: Object.freeze({
      clientMutationId: record?.id ?? null,
      mutationDisposition,
      ...(typeof effectFacts.effectCommitted === 'boolean'
        ? { effectCommitted: effectFacts.effectCommitted }
        : {}),
      ...(typeof effectFacts.effectMayHaveCommitted === 'boolean'
        ? { effectMayHaveCommitted: effectFacts.effectMayHaveCommitted }
        : {}),
      retryable: false,
    }),
  });
  const error = new SnapbackDiagnosticError(diagnostic, {
    message,
    operation: 'mutation',
    retryable: false,
    effectCommitted: effectFacts.effectCommitted,
    effectMayHaveCommitted: effectFacts.effectMayHaveCommitted,
  });
  error.clientMutationId = record?.id ?? null;
  error.mutationDisposition = mutationDisposition;
  return error;
};

const outboxTransitionAuthorityKey = (context = {}) => stableJson({
  appId: context.appId ?? null,
  expectedEpoch: context.expectedEpoch ?? null,
  expectedAuthorityKey: context.expectedAuthorityKey ?? null,
  nextEpoch: context.nextEpoch ?? null,
  nextAuthorityKey: context.nextAuthorityKey ?? null,
});

const authorityErrorCode = (error) => error?.diagnostic?.code ?? error?.code ?? null;
const isAuthorityFenceUnsettledError = (error) => (
  authorityErrorCode(error) === 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
  || authorityErrorCode(error) === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
  || authorityErrorCode(error) === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED'
  || authorityErrorCode(error) === 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE'
  || authorityErrorCode(error) === 'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE'
);
const isServerAuthorityStaleResult = (error) => (
  authorityErrorCode(error) === 'SNAPBACK_AUTH_STALE_RESULT'
);

const GENERATED_AUTHENTICATED_REQUIREMENT = 'authenticated';
const AUTHENTICATION_REQUIRED_REASON = 'authentication-required';
const AUTHENTICATION_NOT_SETTLED_REASON = 'authentication-not-settled';
const AUTHENTICATION_TERMINATED_REASON = 'authentication-terminated';
const AUTH_TRANSITION_OWNER = 'auth-coordinator';

const requiresGeneratedAuthenticatedAuthority = (ref) => (
  ref !== null
  && typeof ref === 'object'
  && !Array.isArray(ref)
  && ref.artifactKind === 'functionReference'
  && ref.authRequirement === GENERATED_AUTHENTICATED_REQUIREMENT
);

const oneShotAuthAdmissionError = ({
  code,
  message,
  reason,
  retryStrategy,
  cause = undefined,
  operation = null,
  refKind = null,
}) => {
  const details = Object.freeze({
    reason,
    transitionOwner: AUTH_TRANSITION_OWNER,
    retryable: true,
    retryStrategy,
    effectCommitted: false,
  });
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    subsystem: 'client',
    message,
    reason,
    details,
  });
  const error = new SnapbackDiagnosticError(diagnostic, {
    message,
    cause,
    operation,
    refKind,
    retryable: true,
    retryStrategy,
    effectCommitted: false,
    effectMayHaveCommitted: false,
  });
  error.reason = reason;
  return error;
};

const authenticatedOneShotAdmissionError = (ref, client = {}, operation = null) => {
  const { authCoordinator = null, custody = null } = client;
  const authenticatedRequired = requiresGeneratedAuthenticatedAuthority(ref);
  if (custody === 'anonymous-public') {
    if (!authenticatedRequired) return null;
    return oneShotAuthAdmissionError({
      code: 'SNAPBACK_AUTH_REQUIRED',
      message: 'authentication is required for this generated operation',
      reason: AUTHENTICATION_REQUIRED_REASON,
      retryStrategy: 'after-authentication',
      operation,
      refKind: ref.kind ?? null,
    });
  }
  const terminal = typeof client.authTerminalStatus === 'function'
    ? client.authTerminalStatus()
    : null;
  if (terminal?.terminated === true) {
    // @ref LLP 0059#typed-terminal-auth-error — a terminal carrier is not
    // admissible merely because its last durable capture remains inspectable.
    // Every fresh one-shot settles locally until explicit replacement clears
    // the terminal fact.
    return oneShotAuthAdmissionError({
      code: terminal.code ?? 'SNAPBACK_AUTH_TRANSITION_FAILED',
      message: 'the authority for this operation has terminated',
      reason: AUTHENTICATION_TERMINATED_REASON,
      retryStrategy: 'after-authentication-replacement',
      operation,
      refKind: ref?.kind ?? null,
    });
  }
  if (!authCoordinator) return null;
  let capture;
  try {
    capture = authCoordinator.capture();
  } catch (cause) {
    if (!isAuthorityFenceUnsettledError(cause)) throw cause;
    // A genuinely blank coordinator is still allowed to bootstrap a
    // legacy/public operation. Every other capture refusal is a closed
    // publication level, including resume/final confirmation (whose durable
    // record already reads `settled`) and a peer clearing wakeup that paused
    // publication before its asynchronous durable reload.
    // @ref LLP 0059#coordinator-interface — capture(), rather than the durable
    // record's phase label, is the final app-visible admission authority.
    if (!authenticatedRequired && authCoordinator.phase === 'blank') return null;
    return oneShotAuthAdmissionError({
      code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
      message: 'authentication custody is not settled for this generated operation',
      reason: AUTHENTICATION_NOT_SETTLED_REASON,
      retryStrategy: 'after-authentication-settles',
      cause,
      operation,
      refKind: ref?.kind ?? null,
    });
  }
  // Transition admission is reference-independent. Legacy generated
  // references can lack authRequirement, but they still must not join a
  // coordinator barrier whose transport phase has not made a request
  // admissible. Once custody is settled, only metadata-rich authenticated
  // references can be refused locally; legacy references continue to the
  // server for its authoritative classification.
  if (!authenticatedRequired) return null;
  const authority = authCoordinator.credentialFor(capture).authority;
  if (authority?.kind !== 'anonymous') return null;
  return oneShotAuthAdmissionError({
    code: 'SNAPBACK_AUTH_REQUIRED',
    message: 'authentication is required for this generated operation',
    reason: AUTHENTICATION_REQUIRED_REASON,
    retryStrategy: 'after-authentication',
    operation,
    refKind: ref.kind ?? null,
  });
};

const captureHasAnonymousAuthority = (authorityFence, capture) => {
  if (!authorityFence || !capture) return false;
  try {
    return authorityFence.credentialFor(capture)?.authority?.kind === 'anonymous';
  } catch {
    return false;
  }
};

const outboxAdoptionError = (code, message, details = {}) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
};

function searchReferenceInvalid(message, details = {}) {
  const error = new Error(`SNAPBACK_SEARCH_REFERENCE_INVALID: ${message}`);
  error.code = 'SNAPBACK_SEARCH_REFERENCE_INVALID';
  error.diagnostic = {
    code: 'SNAPBACK_SEARCH_REFERENCE_INVALID',
    severity: 'error',
    subsystem: 'client',
    message,
    details,
  };
  return error;
}

// @ref LLP 0073#rust-owned-artifacts-and-operation-carrier — every generated
// v1 search operation carries the same closed SearchRequestV1 contract. Its
// dedicated digest is the runtime discriminator that keeps client.search off
// arbitrary query refs; the complete args and operation-specific result
// digests remain intentionally variable.
// @ref LLP 0131#identity-and-hashing — cascade item 2: the pin is a
// generated artifact from the descriptor pipeline (regenerate, never
// hand-keep), and version skew refuses with the coded diagnostic naming the
// expected and carried contract generations instead of an uncoded TypeError.
// @ref LLP 0131#amendment-2026-08-09-typed-search-selector-witness-for-resource-scoped-references
// — resource-scoped search refs bind the unchanged request grammar separately
// from their additional required resource argument.
function assertSearchFunctionReferenceV1(ref) {
  const requiredStrings = [
    'schemaVersion',
    'appId',
    'id',
    'name',
    'implementationHash',
    'argsContractHash',
    'resultContractHash',
  ];
  const otherwiseGeneratedQuery = ref !== null
    && typeof ref === 'object'
    && !Array.isArray(ref)
    && ref.artifactKind === 'functionReference'
    && ref.kind === 'Query'
    && requiredStrings.every((key) => typeof ref[key] === 'string' && ref[key].length > 0);
  if (
    otherwiseGeneratedQuery
    && (
      typeof ref.searchRequestContractHash !== 'string'
      || ref.searchRequestContractHash.length === 0
    )
  ) {
    throw searchReferenceInvalid(
      'Snapback search reference predates the request witness; regenerate the app references',
    );
  }
  if (
    ref === null
    || typeof ref !== 'object'
    || Array.isArray(ref)
    || ref.artifactKind !== 'functionReference'
    || ref.kind !== 'Query'
    || requiredStrings.some((key) => typeof ref[key] !== 'string' || ref[key].length === 0)
    || typeof ref.searchRequestContractHash !== 'string'
    || ref.searchRequestContractHash.length === 0
    || !(
      ref.searchResourceArg === null
      || (typeof ref.searchResourceArg === 'string' && ref.searchResourceArg.length > 0)
    )
  ) {
    throw searchReferenceInvalid(
      'Snapback search requires a generated Query reference for SearchRequestV1',
    );
  }
  if (ref.searchRequestContractHash !== SEARCH_REQUEST_ARGS_CONTRACT_HASH) {
    throw searchReferenceInvalid(
      `search reference carries a different contract generation than this client expects `
        + `(expected ${SEARCH_REQUEST_ARGS_CONTRACT_GENERATION} ${SEARCH_REQUEST_ARGS_CONTRACT_HASH}); `
        + 'upgrade @expo/snapback-client or regenerate the app references so both sides '
        + 'share one contract generation',
      {
        expectedGeneration: SEARCH_REQUEST_ARGS_CONTRACT_GENERATION,
        expectedSearchRequestContractHash: SEARCH_REQUEST_ARGS_CONTRACT_HASH,
        carriedSearchRequestContractHash: ref.searchRequestContractHash,
        // Compatibility aliases retained for consumers of the original
        // diagnostic shape; these now name the dedicated request witness.
        expectedArgsContractHash: SEARCH_REQUEST_ARGS_CONTRACT_HASH,
        carriedArgsContractHash: ref.searchRequestContractHash,
      },
    );
  }
  return ref.searchResourceArg;
}

function assertSearchQueryOutputV1(output) {
  if (
    output === null
    || typeof output !== 'object'
    || Array.isArray(output)
    || !Array.isArray(output.rows)
    || (
      output.cursor !== undefined
      && output.cursor !== null
      && typeof output.cursor !== 'string'
    )
  ) {
    throw new TypeError('Snapback search query returned an invalid QueryOutput transport');
  }
  for (const item of output.rows) {
    if (
      item === null
      || typeof item !== 'object'
      || Array.isArray(item)
      || typeof item.rowId !== 'string'
      || !Number.isSafeInteger(item.score)
      || item.score < 0
      || item.fields === null
      || typeof item.fields !== 'object'
      || Array.isArray(item.fields)
      || !Array.isArray(item.highlights)
    ) {
      throw new TypeError('Snapback search query returned an invalid SearchItemV1');
    }
  }
}

function vectorQueryInvalid(message) {
  const error = new TypeError(`SNAPBACK_VECTOR_QUERY_INVALID: ${message}`);
  error.code = 'SNAPBACK_VECTOR_QUERY_INVALID';
  return error;
}

function assertVectorFunctionReferenceV1(ref) {
  const requiredStrings = [
    'schemaVersion', 'appId', 'id', 'name', 'implementationHash',
    'argsContractHash', 'resultContractHash',
  ];
  const root = ref?.argumentSchema;
  const vectorSchema = root?.properties?.vector;
  const dimensions = vectorSchema?.minItems;
  if (
    ref === null
    || typeof ref !== 'object'
    || Array.isArray(ref)
    || ref.artifactKind !== 'functionReference'
    || ref.kind !== 'Query'
    || requiredStrings.some((key) => typeof ref[key] !== 'string' || ref[key].length === 0)
    || root?.type !== 'object'
    || root.additionalProperties !== false
    || vectorSchema?.type !== 'array'
    || !Number.isSafeInteger(dimensions)
    || dimensions < 1
    || dimensions > 4_096
    || vectorSchema.maxItems !== dimensions
    || vectorSchema.items?.type !== 'number'
    || vectorSchema.items.minimum !== -(2 ** 100)
    || vectorSchema.items.maximum !== 2 ** 100
  ) {
    throw vectorQueryInvalid('vectorSearch requires a generated exact-vector Query reference');
  }
  const filterSchema = root.properties.filters;
  if (filterSchema === undefined) return { dimensions, filterFields: null };
  const fieldSchema = filterSchema?.items?.properties?.field;
  const filterNames = typeof fieldSchema?.const === 'string'
    ? [fieldSchema.const]
    : fieldSchema?.anyOf?.map((variant) => variant?.const);
  if (
    filterSchema.type !== 'array'
    || filterSchema.maxItems !== 8
    || filterSchema.items?.type !== 'object'
    || filterSchema.items.additionalProperties !== false
    || !Array.isArray(filterNames)
    || filterNames.length === 0
    || filterNames.some((name) => typeof name !== 'string' || name.length === 0)
    || new Set(filterNames).size !== filterNames.length
  ) {
    throw vectorQueryInvalid('vectorSearch requires an exact generated filter-field contract');
  }
  return { dimensions, filterFields: new Set(filterNames) };
}

function assertVectorQueryOutputV1(output) {
  if (
    output === null
    || typeof output !== 'object'
    || Array.isArray(output)
    || !Array.isArray(output.rows)
    || (output.cursor !== undefined && output.cursor !== null)
  ) {
    throw vectorQueryInvalid('vector query returned an invalid single-page QueryOutput');
  }
  for (const item of output.rows) {
    if (
      item === null
      || typeof item !== 'object'
      || Array.isArray(item)
      || typeof item.rowId !== 'string'
      || item.rowId.length === 0
      || typeof item.distance !== 'number'
      || !Number.isFinite(item.distance)
      || Object.is(item.distance, -0)
      || item.fields === null
      || typeof item.fields !== 'object'
      || Array.isArray(item.fields)
    ) {
      throw vectorQueryInvalid('vector query returned an invalid VectorItemV1');
    }
  }
}

function assertExpectedDataVersionStreamV1(value, label) {
  const valid = value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      (value.state === 'absent' && Object.keys(value).length === 1)
      || (
        value.state === 'present'
        && Object.keys(value).length === 2
        && typeof value.value === 'string'
        && value.value.length > 0
      )
    );
  if (!valid) {
    throw new TypeError(`${label} requires a closed ExpectedDataVersionStreamV1`);
  }
}

/**
 * Admit an opaque id obtained at an untyped application boundary into the
 * generated table-specific id type. This proves only Snapback's bounded wire
 * grammar; it deliberately does not claim that the row currently exists.
 */
export function admitSnapbackId(table, value) {
  if (typeof table !== 'string' || !SNAPBACK_ID_TABLE.test(table)) {
    throw new TypeError('SNAPBACK_CLIENT_ID_TABLE_INVALID: table must be a generated identifier');
  }
  if (typeof value !== 'string' || !SNAPBACK_OPAQUE_ID.test(value)) {
    throw new TypeError(
      'SNAPBACK_CLIENT_ID_INVALID: value must be a 1..256 byte ASCII opaque id',
    );
  }
  return value;
}

// 0137 A1-Expo f1: React Native/Hermes ships no `globalThis.crypto`.
// Security-bearing random identity is never synthesized from Math.random —
// when the WebCrypto RNG is absent these mints refuse with ONE named,
// actionable code instead of the carrier's bare
// "Cannot read property 'getRandomValues' of undefined".
const cryptoRandomSource = (what) => {
  const source = globalThis.crypto;
  if (typeof source?.getRandomValues === 'function') return source;
  const code = 'SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING';
  const message = `${what} requires crypto.getRandomValues, which this runtime `
    + 'does not provide (React Native/Hermes ships no WebCrypto). Install an '
    + 'RNG polyfill before constructing the client — Expo: expo-crypto '
    + '(import its getRandomValues polyfill), bare RN: '
    + 'react-native-get-random-values.';
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message };
  throw error;
};

export function newSeedOperationIdV1(nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff) {
    throw new RangeError('seed operation timestamp is outside UUIDv7 range');
  }
  const bytes = new Uint8Array(16);
  cryptoRandomSource('seed operation identity').getRandomValues(bytes);
  let timestamp = BigInt(nowMs);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const SENDER_PROTOCOL = 'snapback.sender-constrained.v2';
const SENDER_ISSUANCE_PROTOCOL = 'snapback.sender-issuance.v2';
const SENDER_NONCE_TTL_MS = 120_000;
const CONNECTION_TOKEN_HEADER = 'x-snapback-connection-token';
const DEV_IDENTITY_HEADER = 'x-snapback-dev-identity';
const EPHEMERAL_AUTHORITY_INSTANCE_HEADER = 'x-snapback-ephemeral-authority-instance';
// Module-private capability used only by predecessor T-UNSUB and successor
// fresh-subscribe work owned by replaceBearerToken(). Public work must wait
// outside that transition even though these lifecycle operations run inside it.
const EXTERNAL_BEARER_TRANSITION_PERMIT = Symbol('snapback.externalBearerTransitionPermit');
const OUTBOX_AUTHORIZATION_DISPATCH_OWNERSHIP = Symbol(
  'snapback.outboxAuthorizationDispatchOwnership',
);
let rawActionDeprecationWarned = false;

const senderProofId = () => {
  const value = new Uint8Array(16);
  cryptoRandomSource('sender-constrained proof identity').getRandomValues(value);
  return value;
};

const senderNonceRecord = (value, generation) => {
  if (!isCanonicalSenderNonce(value)
      || !Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('SNAPBACK_AUTH_SENDER_PROOF_INVALID: response nonce is invalid');
  }
  const expiresAtMs = Date.now() + SENDER_NONCE_TTL_MS;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new Error('SNAPBACK_AUTH_SENDER_CUSTODY_GENERATION_EXHAUSTED: nonce deadline overflow');
  }
  return { value, generation, expiresAtMs };
};

const senderIndeterminateSuccessError = () => {
  const error = new Error(
    'SNAPBACK_AUTH_SENDER_OUTCOME_INDETERMINATE: protected success omitted its successor nonce',
  );
  error.code = 'SNAPBACK_AUTH_SENDER_OUTCOME_INDETERMINATE';
  error.diagnostic = {
    code: error.code,
    message: 'the protected operation may have committed; retry only through application idempotency',
  };
  error.outcome = 'indeterminate';
  error.effectMayHaveCommitted = true;
  error.retryable = false;
  return error;
};
// Grace before the fallback path re-subscribes after a socket loss, so the
// server has processed the closing socket's disconnect (which drops the
// connection's subscriptions) before the fresh subscribe_live lands.
const RESUBSCRIBE_AFTER_LOSS_DELAY_MS = 300;
// Kit receipt ring bound — mirrors the server-side retention cap (LLP 0034 §3).
const RECEIPT_RING_CAP = 256;
// @ref LLP 0059#plan-begin-commit-finalize — authorization-reservation
// contention is retryable only when the closed refusal proves no effect
// committed. Keep the retry trace bounded alongside the receipt ring.
const RESERVATION_RETRY_DIAGNOSTIC_RING_CAP = 256;
const DEFAULT_RESERVATION_RETRY_MAX_ATTEMPTS = 40;
const DEFAULT_RESERVATION_RETRY_JITTER_MILLISECONDS = Object.freeze([20, 80]);
const AUTH_MODE_PENDING_RETRY_MAX_ATTEMPTS = 40;
const EPHEMERAL_AUTHORITY_PENDING_RETRY_MAX_ATTEMPTS = 40;
// A subscription registers its lane consumer before dispatching the snapshot
// request, then buffers deltas until that snapshot arrives. Keep a hung request
// from turning the temporary queue into an unbounded client-memory sink.
const EPHEMERAL_PRE_SNAPSHOT_BUFFER_CAP = 1_024;
// A token-resume subscribe can register and emit its rowless durable answer
// before the HTTP acknowledgement reaches the client. Bound that cross-
// transport establishment window just like the ephemeral snapshot boundary.
const RQS_PRE_SUBSCRIBE_DURABLE_BUFFER_CAP = 1_024;
// Generated function/collection identifiers are URL path components on the
// app-data plane. Keep this grammar in lockstep with codegen's IDENT so a
// caller-supplied reference cannot acquire authority through URL parsing.
// @ref LLP 0031#the-invariant — app-data names must never normalize into the
// privileged system namespace.
const GENERATED_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
// @ref LLP 0253#s52-operation-names-and-normalizedapplicationdefinitionv1 —
// canonical clients accept the same one-segment or IDENT.IDENT grammar that
// codegen admits; profile-specific leaf allowlists would create uncallable
// generated references.
const AUTHORIZED_LEASE_V1_DURATION_MS = 86_400_000;
// Channel B persistence cadence (LLP 0091 §0A.5): trailing debounce after the
// last result-changing envelope, hard cap under continuous change, immediate
// flush on pagehide / visibility-hidden.
const RQS_PERSIST_DEBOUNCE_MS = 1_000;
const RQS_PERSIST_MAX_DELAY_MS = 10_000;
// LLP 0094 §0B: the exact wire-version token this kit speaks. Offered at
// `/connection/open` (B2) and already offered as the stream subprotocol; the
// open response echoes it back on explicitly bound lineages.
// @ref LLP 0094#0b5-staged-bootstrap — B2: the kit offers at open, carrying
//   the §0B.6 legacy-server detection fallback below.
const WIRE_VERSION_TOKEN = 'snapback.v1';
// §0B.6 per-endpoint server verdicts, cached for the process lifetime:
// baseUrl -> 'modern' | 'legacy'. `modern` requires the exact §0B.3 echo;
// `legacy` is proven either by the pinned decode-class differential or by a
// successful offered open with no echo (the hosted pre-B1 shape). Later opens
// against a legacy endpoint go offerless without re-probing.
const wireVersionEndpointVerdicts = new Map();
// Only one unknown-endpoint probe may run at a time. Concurrent clients wait
// for its process-wide verdict before deciding whether their own open offers,
// so the first legacy differential is not multiplied by a race.
const wireVersionEndpointProbes = new Map();

// The live wire kinds this kit dispatches on, pinned to the committed
// Rust-generated schemas (LLP 0051 D4 / ENG-23891):
// demos/_kit/tests/live-wire-schema.mjs asserts these sets exactly match
// schemas/live.envelope.schema.json and
// schemas/live.socket-server.schema.json, so a server-side kind change is a
// failing gate instead of a frame that silently never matches here.
export const LIVE_DURABLE_KINDS = Object.freeze({
  LIVE_REPLACE: 'live_replace',
  LIVE_DELTA: 'live_delta',
  RESYNC_REQUIRED: 'resync_required',
  AUTHORIZATION_INVALIDATION: 'authorization_invalidation',
  // Rung-1 answer to a resumeFromToken subscribe (LLP 0090 D1.3 / LLP 0091
  // §0B.2): advances version + token without touching rows. Only ever sent
  // to a subscriber that presented resumeFromToken.
  CURRENT_AS_OF: 'current_as_of',
});
export const LIVE_SOCKET_KINDS = Object.freeze({
  AUTH_ERROR: 'auth_error',
  PONG: 'pong',
  EPHEMERAL_ACK: 'ephemeral_ack',
  EPHEMERAL_ERROR: 'ephemeral_error',
  EPHEMERAL: 'ephemeral',
  // Server-side fallback for a non-UTF-8 durable payload. Its outbox lease
  // was already released at socket handoff, so the update is unrecoverable
  // in place and no drain will re-deliver it while the socket owns the
  // outbox — dispatch synthesizes a connection-wide clear-retained resync
  // instead of ignoring the frame (dispatchDurableBytesFrame;
  // issues/closed/20260724-durable-bytes-silent-staleness.md).
  DURABLE_BYTES: 'durable_bytes',
  // LLP 0077 decision 5: the first server frame on a sender-proof-gated
  // upgrade delivers the successor nonce in band (a browser cannot read the
  // 101 response's DPoP-Nonce header). The frame is transport-internal: it
  // releases the per-custody flight and never surfaces to the application.
  SENDER_NONCE: 'sender_nonce',
});
// These hosted subscribe refusals are explicitly pre-persistence: the
// coordinator returns before inserting/replacing a subscription row. They are
// therefore the ONLY subscribe failures the kit may replay after proving a
// current socket session. Network errors, timeouts, 5xx responses, and every
// other diagnostic remain ambiguous and are never retried here.
const LIVE_SUBSCRIBE_READINESS_RETRY_CODES = new Set([
  'SNAPBACK_CONNECTION_SOCKET_REQUIRED',
  'SNAPBACK_CONNECTION_SESSION_REPLACED',
]);
const LIVE_SUBSCRIBE_READINESS_RETRIES = 2;
const LIVE_SUPERSESSION_TARGET_UNKNOWN = 'SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN';
const AUTH_CLIENT_PROTOCOL_HEADER = 'x-snapback-auth-client-protocol';
const AUTH_INVALIDATION_PROTOCOL_HEADER = 'x-snapback-auth-invalidation-protocol';
const AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER = 'x-snapback-authority-descriptor-protocol';
const AUTHORIZED_LEASE_PROTOCOL_HEADER = 'x-snapback-authorized-lease-protocol';
const AUTHORITY_CAPTURE = Symbol('snapback.authorityCapture');
const AUTHORIZATION_CONNECTION = Symbol('snapback.authorizationConnection');
const TERMINAL_AUTHORITY_PUBLICATION = Symbol('snapback.terminalAuthorityPublication');

const invalidSupersessionWitnessError = (supersedes, response) => {
  const error = new Error(
    'SNAPBACK_LIVE_SUPERSESSION_WITNESS_INVALID: fresh subscribe did not prove exact predecessor disposal',
  );
  error.code = 'SNAPBACK_LIVE_SUPERSESSION_WITNESS_INVALID';
  error.diagnostic = {
    code: error.code,
    message: 'fresh subscribe did not prove exact predecessor disposal',
    details: {
      expectedSuperseded: supersedes,
      receivedSuperseded: response?.superseded ?? null,
      receivedRefusal: response?.supersessionRefusal ?? null,
    },
  };
  return error;
};

const sameAuthorityCapture = (left, right) => {
  if (!left || !right) return false;
  const axes = [
    'authorityEpoch',
    'authorityKey',
    'custodyRevision',
    'carrierGeneration',
    'tokenId',
  ];
  return axes.every((axis) => left?.[axis] === right?.[axis]);
};

const sameAuthorityLineage = (left, right) => Boolean(
  left
  && right
  && left.authorityEpoch === right.authorityEpoch
  && left.authorityKey === right.authorityKey
);

const processClientStoreId = (() => {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `live_${randomId.replaceAll('-', '')}`;
  const pid = typeof process !== 'undefined' && Number.isSafeInteger(process.pid)
    ? process.pid
    : 0;
  return `live_${Date.now().toString(36)}_${pid.toString(36)}`;
})();
const liveQueryAllocators = new Map();

const allocatorForClientStore = (clientStoreId) => {
  let allocator = liveQueryAllocators.get(clientStoreId);
  if (!allocator) {
    allocator = createLiveQueryInstanceAllocator();
    liveQueryAllocators.set(clientStoreId, allocator);
  }
  return allocator;
};

// UUID_V7 stays exact for `authorizationStreamIncarnation`, which is an
// opaque incarnation marker with its own persisted format. Object ids use
// SNAPBACK_ID, which accepts the pre-LLP-0148 spelling too.
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SNAPBACK_ID = { test: (value) => isMintedIdentifier(value) };

const authorityDescriptorIsValid = (descriptor) => (
  descriptor !== null
  && typeof descriptor === 'object'
  && !Array.isArray(descriptor)
  && Object.keys(descriptor).sort().join(',')
    === 'authorityInstanceId,descriptorVersion,sessionGeneration'
  && descriptor.descriptorVersion === 1
  && typeof descriptor.authorityInstanceId === 'string'
  && SNAPBACK_ID.test(descriptor.authorityInstanceId)
  && Number.isSafeInteger(descriptor.sessionGeneration)
  && descriptor.sessionGeneration >= 0
);

const sameAuthorityDescriptor = (left, right) => (
  authorityDescriptorIsValid(left)
  && authorityDescriptorIsValid(right)
  && left.descriptorVersion === right.descriptorVersion
  && left.authorityInstanceId === right.authorityInstanceId
  && left.sessionGeneration === right.sessionGeneration
);

const requireAuthorityDescriptor = (descriptor, code = 'SNAPBACK_AUTH_HANDSHAKE_INVALID') => {
  if (authorityDescriptorIsValid(descriptor)) {
    return Object.freeze({ ...descriptor });
  }
  const error = new Error(`${code}: authority descriptor is missing or malformed`);
  error.code = code;
  error.diagnostic = { code, message: 'authority descriptor is missing or malformed' };
  throw error;
};

const markAuthorityCapture = (value, capture) => {
  if (!capture || value === null || typeof value !== 'object') return value;
  try {
    Object.defineProperty(value, AUTHORITY_CAPTURE, {
      value: capture,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  } catch {
    // Frozen protocol objects remain usable; their caller must carry capture.
  }
  if (Array.isArray(value)) {
    for (const entry of value) markAuthorityCapture(entry, capture);
  }
  if (value.receipt && typeof value.receipt === 'object') {
    markAuthorityCapture(value.receipt, capture);
  }
  return value;
};

const CLIENT_SECRET_REDACTION = '[REDACTED]';

const normalizedFieldName = (name) => String(name ?? '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[^A-Za-z0-9]+/g, '_')
  .toLowerCase();

const sensitiveProtocolField = (name) => {
  const normalized = normalizedFieldName(name);
  return normalized === 'x_snapback_dev_identity'
    || normalized === 'token'
    || normalized.endsWith('_token')
    || normalized === 'bearer'
    || normalized.endsWith('_bearer')
    || normalized === 'credential'
    || normalized.endsWith('_credential')
    || normalized === 'lease'
    || normalized.endsWith('_lease')
    || normalized === 'proof'
    || normalized.endsWith('_proof')
    || normalized === 'secret'
    || normalized.endsWith('_secret')
    || normalized === 'private_key'
    || normalized.endsWith('_private_key')
    || normalized === 'key_material'
    || normalized.endsWith('_key_material')
    || normalized === 'login_code'
    || normalized === 'challenge_code'
    || normalized === 'password'
    || normalized.endsWith('_password')
    || normalized === 'recovery_code'
    || normalized.endsWith('_recovery_code')
    || normalized === 'recovery_codes'
    || normalized.endsWith('_recovery_codes');
};

const addSecret = (secrets, value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const text = String(value);
  // This is exact semantic discovery from a request carrier, not a heuristic.
  // Rejecting destructive short-value reflections is safer than publishing a
  // one-byte admin credential or caller-supplied challenge proof.
  if (text.length > 0) secrets.add(text);
};

const collectRequestSecrets = (body, headers) => {
  const secrets = new Set();
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = normalizedFieldName(name);
    if (
      normalized === 'authorization'
      || sensitiveProtocolField(name)
    ) {
      addSecret(secrets, value);
      if (normalized === 'authorization') {
        addSecret(secrets, String(value).replace(/^Bearer\s+/i, ''));
      }
    }
  }
  const visit = (value, field = null) => {
    if (field === 'code' || sensitiveProtocolField(field)) addSecret(secrets, value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, field);
    } else if (value && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) visit(item, name);
    }
  };
  visit(body);
  return secrets;
};

const redactKnownSecrets = (text, secrets) => {
  let redacted = String(text ?? '');
  const marker = safeClientRedactionMarker(secrets);
  const ordered = [...secrets].sort((left, right) => right.length - left.length);
  for (const secret of ordered) redacted = redacted.replaceAll(secret, marker);
  return redacted;
};

const safeClientRedactionMarker = (secrets) => (
  [CLIENT_SECRET_REDACTION, '<redacted>', '***', '•••', ''].find((candidate) => (
    [...secrets].every((secret) => !candidate.includes(secret))
  )) ?? ''
);

// @ref LLP 0060#c1-the-v1-custody-claim — numeric positions are excluded too:
// an all-numeric bearer/code reflected as a JSON number is compared against
// the known request secrets in its canonical string form. A clean number
// passes through unchanged; a reflecting one leaves only the redacted text.
const redactReflectedNumber = (value, secrets) => {
  const text = String(value);
  const redacted = redactKnownSecrets(text, secrets);
  return redacted === text ? value : redacted;
};

const sanitizeProtocolErrorValue = (value, secrets, field = null) => {
  if (sensitiveProtocolField(field)) return safeClientRedactionMarker(secrets);
  if (typeof value === 'string') return redactKnownSecrets(value, secrets);
  if (typeof value === 'number' || typeof value === 'bigint') {
    return redactReflectedNumber(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProtocolErrorValue(item, secrets));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [
    redactKnownSecrets(name, secrets),
    sanitizeProtocolErrorValue(item, secrets, name),
  ]));
};

const sanitizeTransportError = (error, secrets, { dispatchFailure = false } = {}) => {
  const message = redactKnownSecrets(error?.message ?? String(error), secrets);
  // Preserve the fetch-unavailable class used by the offline cache policy;
  // only the payload is sanitized. A plain Error here would turn a known
  // network outage into a protocol failure and erase the last safe projection.
  const safe = error instanceof TypeError ? new TypeError(message) : new Error(message);
  safe.name = redactKnownSecrets(error?.name ?? 'Error', secrets);
  // Transport provenance for the connectivity classifier (0137 A1-Expo f2):
  // stamped only when the fetch dispatch itself rejected — no Response, so
  // no status/diagnostic/receipt can exist. Carrier fetch implementations
  // disagree on the rejection class (undici: TypeError; Expo/RN: Error), so
  // provenance, not the constructor, carries the fact.
  if (dispatchFailure || error?.fetchDispatchFailed === true) {
    safe.fetchDispatchFailed = true;
  }
  if (error?.code !== undefined) {
    safe.code = sanitizeProtocolErrorValue(error.code, secrets);
  }
  if (error?.status !== undefined) {
    safe.status = sanitizeProtocolErrorValue(error.status, secrets);
  }
  if (error?.diagnostic !== undefined) {
    safe.diagnostic = sanitizeProtocolErrorValue(error.diagnostic, secrets);
  }
  if (error?.receipt !== undefined) {
    safe.receipt = sanitizeProtocolErrorValue(error.receipt, secrets);
  }
  // @ref LLP 0055#audit — the server-derived attribution block survives
  // re-wrapping untouched: it is ids-only and bearer-free by construction,
  // and the wrapper contract is byte-preserving copy — running it through
  // the redaction reshape would be client-side mutation of a block this
  // client has no authority to alter (and could never re-synthesize).
  if (error?.attribution !== undefined) {
    safe.attribution = error.attribution;
  }
  return safe;
};

// Parent-side ingress bounds. Everything the credential-bearing parent
// ingests from the network gets a per-class decoded-byte ceiling enforced
// *before* full-text or JSON materialization — dishonest `Content-Length`,
// chunked bodies, decompression expansion, and WebSocket payloads included.
//
// @ref LLP 0062#1-engine-plus-data-never-program-source--served-or-generated —
// "not code" rules out RCE, not denial of service: an oversized response must
// not exhaust the credential-bearing parent before any advertised ceiling
// applies.
export const DEFAULT_INGRESS_LIMIT_BYTES = Object.freeze({
  appCall: 64 * 1024 * 1024,
  authLifecycle: 1 * 1024 * 1024,
  discovery: 1 * 1024 * 1024,
  artifact: 64 * 1024 * 1024,
  liveFrame: 64 * 1024 * 1024,
});

const ingressLimitExceededError = (ingressClass, limitBytes) => {
  const message = `${ingressClass} response exceeds the ${limitBytes}-byte decoded ingress bound`;
  const error = new Error(`SNAPBACK_INGRESS_LIMIT_EXCEEDED: ${message}`);
  error.code = 'SNAPBACK_INGRESS_LIMIT_EXCEEDED';
  error.diagnostic = Object.freeze({
    code: 'SNAPBACK_INGRESS_LIMIT_EXCEEDED',
    message,
    details: Object.freeze({ ingressClass, limitBytes }),
  });
  return error;
};

const redirectRefusedError = (status) => {
  const message = 'redirects on credential-carrying requests are terminal';
  const error = new Error(`SNAPBACK_REDIRECT_REFUSED: ${message}`);
  error.code = 'SNAPBACK_REDIRECT_REFUSED';
  error.diagnostic = Object.freeze({
    code: 'SNAPBACK_REDIRECT_REFUSED',
    message,
    details: Object.freeze({ status: typeof status === 'number' ? status : null }),
  });
  return error;
};

// 304 is a cache validator, not a redirect; everything else in the 3xx range
// names a second hop that must never see a credential again.
const REDIRECT_STATUSES = new Set([300, 301, 302, 303, 305, 307, 308]);
const isRedirectResponse = (res) => (
  res?.type === 'opaqueredirect' || REDIRECT_STATUSES.has(res?.status)
);

const normalizedIngressLimits = (overrides) => {
  if (overrides === null || overrides === undefined) return DEFAULT_INGRESS_LIMIT_BYTES;
  const limits = { ...DEFAULT_INGRESS_LIMIT_BYTES };
  for (const [name, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_INGRESS_LIMIT_BYTES, name)) {
      throw new TypeError(`unknown ingress class '${name}'`);
    }
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError('ingress limits must be positive safe integers');
    }
    limits[name] = value;
  }
  return Object.freeze(limits);
};

const ingressClassForPath = (path) => (
  String(path ?? '').startsWith('/auth/') ? 'authLifecycle' : 'appCall'
);

// Read a fetch response body as text while counting decoded bytes against the
// class ceiling. The platform decodes any content coding before the body
// stream, so this bound is on materialized bytes, not the wire framing.
const readBoundedResponseText = async (res, ingressClass, limitBytes) => {
  const declared = Number(res.headers?.get?.('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > limitBytes) {
    try { await res.body?.cancel?.(); } catch { /* the refusal owns cleanup */ }
    throw ingressLimitExceededError(ingressClass, limitBytes);
  }
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    // Non-streaming response implementations still get the bound before any
    // JSON materialization, just without incremental cancellation.
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > limitBytes) {
      throw ingressLimitExceededError(ingressClass, limitBytes);
    }
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value?.byteLength ?? value?.length ?? 0;
    if (receivedBytes > limitBytes) {
      try { await reader.cancel(); } catch { /* bounded refusal, orderly cleanup */ }
      throw ingressLimitExceededError(ingressClass, limitBytes);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
};

const authHandshakeRequired = (path) => !(
  path === '/health'
  || path === '/inspect'
  || path === '/auth/session'
  || path === '/app/ensure'
  || path.startsWith('/_snapback/')
);

// A failed forced probe must not erase the last authenticated projection:
// offline AuthorizedLease reads still need its immutable app/authority facts.
// Online boundaries continue to pass `force: true`, so preserving this cache
// cannot turn a failed freshness probe into online admission.
const isUnavailableAuthTransport = (error) => (
  error instanceof TypeError
  && error?.diagnostic == null
  && error?.status == null
  && error?.code == null
);

const sessionWireBody = (path, body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const wire = { ...body };
  delete wire.auth;
  if (path.startsWith('/live/') && wire.input && typeof wire.input === 'object') {
    wire.input = { ...wire.input };
    delete wire.input.auth;
  }
  if (path.startsWith('/ephemeral/')) {
    delete wire.principal;
    delete wire.session_id;
    delete wire.user_id;
    delete wire.custom_key;
  }
  if (wire.ctx_ledger && typeof wire.ctx_ledger === 'object') {
    wire.ctx_ledger = { ...wire.ctx_ledger };
    delete wire.ctx_ledger.auth_fingerprint;
  }
  return wire;
};

const carriesClientAssertedDevIdentity = (body) => (
  typeof body?.auth?.user_id === 'string'
  || typeof body?.input?.auth?.user_id === 'string'
);

const authAvailabilityError = (handshake) => {
  if (handshake == null) return null;
  const availability = handshake?.availability?.onlineRequestResponse;
  if (availability?.available) return null;
  const code = availability?.reason ?? 'SNAPBACK_AUTH_POLICY_UNAVAILABLE';
  const error = new Error(`${code}: the current auth mode does not admit online app data`);
  error.diagnostic = {
    code,
    message: 'the current auth mode does not admit online app data',
  };
  error.authSession = handshake;
  return error;
};

const TERMINAL_AUTH_CODES = new Set([
  'SNAPBACK_AUTH_REQUIRED',
  'SNAPBACK_AUTH_SESSION_EXPIRED',
  'SNAPBACK_AUTH_SESSION_REVOKED',
  'SNAPBACK_AUTH_FAMILY_REVOKED',
  'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
]);

const SUPERSEDED_AUTH_CODES = new Set([
  'SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED',
  'SNAPBACK_AUTH_REFRESH_SUPERSEDED',
]);

// These answered refusals re-enter #request's auth transition/retry machinery.
// Release queue-dispatch custody before that machinery runs; all other
// failures retain it until the mutation caller records its local terminal
// disposition (or deliberately leaves the record pending).
const requestFailureReentersAuthorityTransport = (error) => {
  const code = authorityErrorCode(error);
  return code === 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED'
    || code === 'SNAPBACK_AUTH_MODE_PENDING'
    || code === 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
    || code === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
    || SUPERSEDED_AUTH_CODES.has(code)
    || TERMINAL_AUTH_CODES.has(code);
};

// 0137 A1-Expo f4 (carrier-agnostic): a successor bearer whose fresh
// subscribe the server ANSWERS with an authorization refusal is a completed,
// renderable outcome of a custody transition — not a lifecycle failure of the
// barrier itself. Custody-terminal codes are excluded: they have their own
// owner (handleTerminalAuthLoss) and must stay loud.
const isSubscribeAuthorizationDenial = (error, {
  authorityFence = null,
  capture = null,
} = {}) => (
  (error?.status === 401 || error?.status === 403)
  && typeof error?.diagnostic?.code === 'string'
  && error.diagnostic.code.startsWith('SNAPBACK_AUTH_')
  && (
    !TERMINAL_AUTH_CODES.has(error.diagnostic.code)
    || (
      error.diagnostic.code === 'SNAPBACK_AUTH_REQUIRED'
      && captureHasAnonymousAuthority(authorityFence, capture)
    )
  )
);

const LIVE_TERMINAL_AUTH_CODES = new Set([
  'SNAPBACK_AUTH_SESSION_EXPIRED',
  'SNAPBACK_AUTH_STREAM_RESET',
  'SNAPBACK_AUTH_MODE_PENDING',
  'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
]);
const LIVE_TERMINAL_AUTH_REASONS = new Set([
  'expired',
  'revoked',
  'reset',
  'restore',
  'downgrade',
  'mode_transition',
]);
const LIVE_AUTHORITY_DISPOSITIONS = new Set(['carrier', 'durableDelete']);

const finiteAuthorityDisposition = (diagnostic) => {
  if (
    !TERMINAL_AUTH_CODES.has(diagnostic?.code)
    && diagnostic?.code !== 'SNAPBACK_AUTH_MODE_PENDING'
  ) return null;
  const details = diagnostic?.details;
  const declaresDisposition = details !== null
    && typeof details === 'object'
    && Object.hasOwn(details, 'authorityDisposition');
  if (declaresDisposition && LIVE_AUTHORITY_DISPOSITIONS.has(details.authorityDisposition)) {
    if (
      diagnostic.code !== 'SNAPBACK_AUTH_MODE_PENDING'
      || details.reason === 'mode_transition'
    ) return details.authorityDisposition;
    return 'carrier';
  }
  if (diagnostic?.code === 'SNAPBACK_AUTH_MODE_PENDING' && !declaresDisposition) return null;
  // Finite terminal codes historically collapsed expiry and revocation.
  // Missing or malformed causal metadata must terminate the live carrier but
  // must not destroy durable replay/session custody.
  return 'carrier';
};

const isTerminalAuthorityError = (error) => (
  TERMINAL_AUTH_CODES.has(authorityErrorCode(error))
  || (
    authorityErrorCode(error) === 'SNAPBACK_AUTH_MODE_PENDING'
    && (error?.authorityDisposition === 'carrier' || error?.authorityDisposition === 'durableDelete')
  )
);

// @ref LLP 0059#typed-terminal-auth-error — the identifier-free frame applies
//   only to the authority capture that owns this socket and never reconnects.
const liveTerminalAuthError = (frame) => {
  const valid = exactRecord(frame, ['kind', 'code', 'reason', 'authorityDisposition'])
    && frame.kind === LIVE_SOCKET_KINDS.AUTH_ERROR
    && LIVE_TERMINAL_AUTH_CODES.has(frame.code)
    && LIVE_TERMINAL_AUTH_REASONS.has(frame.reason)
    && (frame.code !== 'SNAPBACK_AUTH_MODE_PENDING' || frame.reason === 'mode_transition')
    && LIVE_AUTHORITY_DISPOSITIONS.has(frame.authorityDisposition);
  const code = valid ? frame.code : 'SNAPBACK_AUTH_LIVE_FRAME_INVALID';
  const message = valid
    ? `the authenticated live transport ended (${frame.reason})`
    : 'the live transport received a malformed terminal auth frame';
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = {
    code,
    message,
    details: valid
      ? { reason: frame.reason, authorityDisposition: frame.authorityDisposition }
      : {},
  };
  error.terminalAuth = valid;
  // Unknown control bytes still force a synchronous visibility cut, but they
  // cannot prove durable revocation. Preserve custody until a classified
  // finite handshake can select deletion.
  error.authorityDisposition = valid ? frame.authorityDisposition : 'carrier';
  return error;
};

const liveTerminalAuthCloseError = () => {
  const code = 'SNAPBACK_AUTH_STREAM_RESET';
  const message = 'the authenticated live transport ended without a terminal frame';
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details: { closeCode: 4401, closeReason: 'auth_error' } };
  error.terminalAuth = true;
  // A close-only peer supplied no causal classification. Blank and retire the
  // carrier now; a classified finite handshake decides durable deletion.
  error.authorityDisposition = 'carrier';
  return error;
};

const safeNextCounter = (
  value,
  code,
  label,
  ceiling = Number.MAX_SAFE_INTEGER,
) => {
  if (
    !Number.isSafeInteger(ceiling)
    || ceiling < 1
    || !Number.isSafeInteger(value)
    || value < 0
    || value >= ceiling
  ) {
    throw clientCodedError(new Error(`${code}: ${label} is exhausted`), code);
  }
  return value + 1;
};

const exactRecord = (value, keys) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key))
);

const safeUnsignedInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const nullableString = (value) => value === null || typeof value === 'string';
const nullableProtocolV1 = (value) => value === null || value === 1;

const AUTH_PROTOCOL_AXES = Object.freeze([
  'authClient',
  'authInvalidation',
  'authorityDescriptor',
  'authorizedLease',
]);

// @ref LLP 0058#bootstrap-handshake — `clientProtocols` echoes only exactly
// supported versions this request offered. A non-null echo the request never
// carried (or any version other than the locally supported v1) rejects the
// entire response: Contract consumes these axes for queued replay and
// retained reads, so an unsolicited echo must not become capability.
const echoMatchesRequestOffer = (clientProtocols, requestOffer) => (
  AUTH_PROTOCOL_AXES.every((axis) => {
    const echo = clientProtocols[axis];
    return echo === null || (echo === 1 && requestOffer?.[axis] === 1);
  })
);

const projectOnlineAvailability = (value) => {
  if (
    !exactRecord(value, ['available', 'reason'])
    || typeof value.available !== 'boolean'
    || !nullableString(value.reason)
  ) return null;
  return { available: value.available, reason: value.reason };
};

const projectAuthScopedLiveAvailability = (value) => {
  if (
    !exactRecord(value, ['available', 'minimumAuthInvalidationProtocol', 'reason'])
    || typeof value.available !== 'boolean'
    || !nullableProtocolV1(value.minimumAuthInvalidationProtocol)
    || !nullableString(value.reason)
  ) return null;
  return {
    available: value.available,
    minimumAuthInvalidationProtocol: value.minimumAuthInvalidationProtocol,
    reason: value.reason,
  };
};

const projectRetainedReadAvailability = (value) => {
  if (
    !exactRecord(value, [
      'available',
      'minimumAuthInvalidationProtocol',
      'minimumAuthorizedLeaseProtocol',
      'reason',
    ])
    || typeof value.available !== 'boolean'
    || !nullableProtocolV1(value.minimumAuthInvalidationProtocol)
    || !nullableProtocolV1(value.minimumAuthorizedLeaseProtocol)
    || !nullableString(value.reason)
  ) return null;
  return {
    available: value.available,
    minimumAuthInvalidationProtocol: value.minimumAuthInvalidationProtocol,
    minimumAuthorizedLeaseProtocol: value.minimumAuthorizedLeaseProtocol,
    reason: value.reason,
  };
};

const projectQueuedReplayAvailability = (value) => {
  if (
    !exactRecord(value, ['available', 'minimumAuthorityDescriptorProtocol', 'reason'])
    || typeof value.available !== 'boolean'
    || !nullableProtocolV1(value.minimumAuthorityDescriptorProtocol)
    || !nullableString(value.reason)
  ) return null;
  return {
    available: value.available,
    minimumAuthorityDescriptorProtocol: value.minimumAuthorityDescriptorProtocol,
    reason: value.reason,
  };
};

const projectAuthorizedLeaseFacts = (value) => {
  if (!exactRecord(value, [
    'protocolVersion',
    'defaultMs',
    'hardMaxMs',
    'configuredMs',
    'clamps',
    'renewal',
    'timeBasis',
    'clockRollback',
  ])) return null;
  if (
    value.protocolVersion !== 1
    || value.defaultMs !== AUTHORIZED_LEASE_V1_DURATION_MS
    || value.hardMaxMs !== AUTHORIZED_LEASE_V1_DURATION_MS
    || !safeUnsignedInteger(value.configuredMs)
    || value.configuredMs === 0
    || value.configuredMs > value.hardMaxMs
    || !Array.isArray(value.clamps)
    || value.clamps.length !== 2
    || value.clamps[0] !== 'session'
    || value.clamps[1] !== 'provider'
    || value.renewal !== 'full-revalidation'
    || value.timeBasis !== 'server-absolute+client-request-elapsed'
    || value.clockRollback !== 'delete-before-read'
  ) return null;
  return {
    protocolVersion: 1,
    defaultMs: value.defaultMs,
    hardMaxMs: value.hardMaxMs,
    configuredMs: value.configuredMs,
    clamps: ['session', 'provider'],
    renewal: 'full-revalidation',
    timeBasis: 'server-absolute+client-request-elapsed',
    clockRollback: 'delete-before-read',
  };
};

// @ref LLP 0058#exact-response-dto — wire projection independently enforces
// the deployment identity's closed mode/version and digest namespaces.
const projectDeploymentIdentity = (value) => {
  if (!exactRecord(value, [
    'schemaVersion',
    'authMode',
    'appId',
    'schemaHash',
    'bundleHash',
    'inputsHash',
  ])) return null;
  if (!['schemaVersion', 'appId', 'schemaHash', 'bundleHash', 'inputsHash']
    .every((key) => typeof value[key] === 'string' && value[key].length > 0)) return null;
  if (value.authMode === 'dev') {
    if (
      value.schemaVersion !== 'snapback.v0'
      || ['schemaHash', 'bundleHash', 'inputsHash']
        .some((key) => value[key].startsWith('snapback.v1:'))
    ) return null;
  } else if (value.authMode === 'sessions') {
    if (
      value.schemaVersion !== 'snapback.v1'
      || !/^snapback\.v1:sessions:schema:sha256:[0-9a-f]{64}$/.test(value.schemaHash)
      || !/^snapback\.v1:sessions:function:sha256:[0-9a-f]{64}$/.test(value.bundleHash)
      || !/^snapback\.v1:sessions:inputs:sha256:[0-9a-f]{64}$/.test(value.inputsHash)
    ) return null;
  } else {
    return null;
  }
  return { ...value };
};

const projectAuthSessionResponse = (value, requestOffer = null, expectedAppId = null) => {
  if (!exactRecord(value, [
    'protocolVersion',
    'serverStartupNonce',
    'authorizationStreamIncarnation',
    'transitionGeneration',
    'activeMode',
    'desiredMode',
    'modeState',
    'appDataAvailability',
    'quarantineCode',
    'clientProtocols',
    'availability',
    'provider',
    'transports',
    'authority',
    'authorityDescriptor',
    'deploymentIdentity',
    'authorizedLease',
  ])) return null;

  const clientProtocols = value.clientProtocols;
  const availability = value.availability;
  const provider = value.provider;
  const authority = value.authority;
  const deploymentIdentity = value.deploymentIdentity === null
    ? null
    : projectDeploymentIdentity(value.deploymentIdentity);
  const authorizedLease = value.authorizedLease === null
    ? null
    : projectAuthorizedLeaseFacts(value.authorizedLease);
  if (
    value.protocolVersion !== 1
    || typeof value.serverStartupNonce !== 'string'
    || value.serverStartupNonce.length === 0
    || typeof value.authorizationStreamIncarnation !== 'string'
    || !UUID_V7.test(value.authorizationStreamIncarnation)
    || !safeUnsignedInteger(value.transitionGeneration)
    || !['dev', 'sessions'].includes(value.activeMode)
    || !['dev', 'sessions'].includes(value.desiredMode)
    || !['settled', 'pendingRestart', 'quarantined'].includes(value.modeState)
    || !['available', 'refusedPending'].includes(value.appDataAvailability)
    || !nullableString(value.quarantineCode)
    || !exactRecord(clientProtocols, [
      'authClient',
      'authInvalidation',
      'authorityDescriptor',
      'authorizedLease',
    ])
    || !Object.values(clientProtocols).every(nullableProtocolV1)
    || !echoMatchesRequestOffer(clientProtocols, requestOffer)
    || !exactRecord(availability, [
      'onlineRequestResponse',
      'authScopedLive',
      'retainedReads',
      'queuedReplay',
    ])
    || !exactRecord(provider, ['key', 'available'])
    || typeof provider.key !== 'string'
    || provider.key.length === 0
    || typeof provider.available !== 'boolean'
    || !Array.isArray(value.transports)
    || value.transports.length !== 1
    || value.transports[0] !== 'bearer'
    || !exactRecord(authority, ['kind', 'userId', 'sessionId', 'isAuthenticated'])
    || !authorityDescriptorIsValid(value.authorityDescriptor)
    || (value.deploymentIdentity !== null && deploymentIdentity === null)
    || (value.activeMode === 'sessions' && deploymentIdentity === null)
    || (deploymentIdentity !== null && deploymentIdentity.authMode !== value.activeMode)
    || (deploymentIdentity !== null && expectedAppId !== null && deploymentIdentity.appId !== expectedAppId)
    || (value.authorizedLease !== null && authorizedLease === null)
    || !['anonymous', 'humanSession', 'servicePrincipal'].includes(authority.kind)
    || (value.activeMode === 'dev' && authority.kind !== 'anonymous')
    || typeof authority.isAuthenticated !== 'boolean'
    || (authority.kind === 'anonymous'
      ? (
          authority.isAuthenticated !== false
          || authority.userId !== null
          || authority.sessionId !== null
        )
      : authority.kind === 'humanSession'
        ? (
            authority.isAuthenticated !== true
            || !SNAPBACK_ID.test(authority.userId ?? '')
            || !SNAPBACK_ID.test(authority.sessionId ?? '')
          )
        : (
            authority.isAuthenticated !== true
            || !SNAPBACK_ID.test(authority.userId ?? '')
            || authority.sessionId !== null
          ))
    || (authority.kind === 'humanSession'
      ? value.authorityDescriptor.sessionGeneration < 1
      : value.authorityDescriptor.sessionGeneration !== 0)
  ) return null;

  const onlineRequestResponse = projectOnlineAvailability(availability.onlineRequestResponse);
  const authScopedLive = projectAuthScopedLiveAvailability(availability.authScopedLive);
  const retainedReads = projectRetainedReadAvailability(availability.retainedReads);
  const queuedReplay = projectQueuedReplayAvailability(availability.queuedReplay);
  if (!onlineRequestResponse || !authScopedLive || !retainedReads || !queuedReplay) return null;

  return {
    protocolVersion: 1,
    serverStartupNonce: value.serverStartupNonce,
    authorizationStreamIncarnation: value.authorizationStreamIncarnation,
    transitionGeneration: value.transitionGeneration,
    activeMode: value.activeMode,
    desiredMode: value.desiredMode,
    modeState: value.modeState,
    appDataAvailability: value.appDataAvailability,
    quarantineCode: value.quarantineCode,
    clientProtocols: {
      authClient: clientProtocols.authClient,
      authInvalidation: clientProtocols.authInvalidation,
      authorityDescriptor: clientProtocols.authorityDescriptor,
      authorizedLease: clientProtocols.authorizedLease,
    },
    availability: {
      onlineRequestResponse,
      authScopedLive,
      retainedReads,
      queuedReplay,
    },
    provider: { key: provider.key, available: provider.available },
    transports: ['bearer'],
    authority: {
      kind: authority.kind,
      userId: authority.userId,
      sessionId: authority.sessionId,
      isAuthenticated: authority.isAuthenticated,
    },
    authorityDescriptor: { ...value.authorityDescriptor },
    deploymentIdentity,
    authorizedLease,
  };
};

const projectSessionResponse = (value) => {
  if (
    !exactRecord(value, [
      'id',
      'userId',
      'provider',
      'createdAt',
      'expiresAt',
      'absoluteExpiresAt',
    ])
    || typeof value.id !== 'string'
    || value.id.length === 0
    || typeof value.userId !== 'string'
    || value.userId.length === 0
    || typeof value.provider !== 'string'
    || value.provider.length === 0
    || !safeUnsignedInteger(value.createdAt)
    || !safeUnsignedInteger(value.expiresAt)
    || !safeUnsignedInteger(value.absoluteExpiresAt)
  ) return null;
  return {
    id: value.id,
    userId: value.userId,
    provider: value.provider,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    absoluteExpiresAt: value.absoluteExpiresAt,
  };
};

// @ref LLP 0060#c1-the-v1-custody-claim — successful exchange/refresh
// projections exclude both request proofs and issued credentials.
const valueContainsSecret = (value, secret) => {
  if (typeof secret !== 'string' && typeof secret !== 'number') return false;
  const text = String(secret);
  if (text.length === 0) return false;
  if (['string', 'number', 'bigint', 'boolean'].includes(typeof value)) {
    return String(value).includes(text);
  }
  if (Array.isArray(value)) return value.some((item) => valueContainsSecret(item, secret));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([name, item]) => (
    name.includes(text) || valueContainsSecret(item, secret)
  ));
};

const projectCredentialResponse = (value, forbiddenSecrets = []) => {
  if (
    !exactRecord(value, [
      'tokenType',
      'token',
      'refreshAfter',
      'session',
      'authorityDescriptor',
    ])
    || value.tokenType !== 'Bearer'
    || typeof value.token !== 'string'
    || value.token.length === 0
    || !safeUnsignedInteger(value.refreshAfter)
    || !authorityDescriptorIsValid(value.authorityDescriptor)
  ) return null;
  const session = projectSessionResponse(value.session);
  if (!session) return null;
  const projected = {
    tokenType: 'Bearer',
    token: value.token,
    refreshAfter: value.refreshAfter,
    session,
    authorityDescriptor: { ...value.authorityDescriptor },
  };
  const publicProjection = credentialPublicProjection(projected);
  if ([projected.token, ...forbiddenSecrets].some((secret) => (
    valueContainsSecret(publicProjection, secret)
  ))) return null;
  return projected;
};

const RECOVERY_CODE = /^sbrv1_[A-Za-z0-9_-]{27}$/;
const RECOVERY_CODE_COUNT = 8;

// Recovery-bearing issuance is a distinct closed wire shape. Do not widen
// projectCredentialResponse: its exact five-key closure prevents a server or
// intermediary from smuggling additional fields beside a credential.
// @ref LLP 0214#9-recovery-code-plaintext-custody — plaintext recovery codes
//   cross exactly one success boundary and never enter coordinator custody.
const projectCredentialResponseWithRecoveryCodes = (value, forbiddenSecrets = []) => {
  if (
    !exactRecord(value, [
      'tokenType',
      'token',
      'refreshAfter',
      'session',
      'authorityDescriptor',
      'recoveryCodes',
    ])
    || value.tokenType !== 'Bearer'
    || typeof value.token !== 'string'
    || value.token.length === 0
    || !safeUnsignedInteger(value.refreshAfter)
    || !authorityDescriptorIsValid(value.authorityDescriptor)
    || !Array.isArray(value.recoveryCodes)
    || value.recoveryCodes.length !== RECOVERY_CODE_COUNT
    || !value.recoveryCodes.every((code) => typeof code === 'string' && RECOVERY_CODE.test(code))
    || new Set(value.recoveryCodes).size !== value.recoveryCodes.length
  ) return null;
  const session = projectSessionResponse(value.session);
  if (!session) return null;
  const projected = {
    tokenType: 'Bearer',
    token: value.token,
    refreshAfter: value.refreshAfter,
    session,
    authorityDescriptor: { ...value.authorityDescriptor },
    recoveryCodes: [...value.recoveryCodes],
  };
  const publicProjection = credentialPublicProjection(projected);
  if ([projected.token, ...projected.recoveryCodes, ...forbiddenSecrets].some((secret) => (
    valueContainsSecret(publicProjection, secret)
  ))) return null;
  return projected;
};

const credentialPublicProjection = (credential) => ({
  tokenType: credential.tokenType,
  refreshAfter: credential.refreshAfter,
  session: { ...credential.session },
  authorityDescriptor: { ...credential.authorityDescriptor },
});

const credentialPublicProjectionWithRecoveryCodes = (credential) => ({
  ...credentialPublicProjection(credential),
  recoveryCodes: [...credential.recoveryCodes],
});

const LOADING_CURRENT_PRINCIPAL = Object.freeze({ status: 'loading' });

const currentPrincipalSemanticKey = (snapshot) => {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => (
      [key, canonicalize(value[key])]
    )));
  };
  return JSON.stringify(canonicalize(snapshot));
};

const currentPrincipalFromSession = (session, credential = null) => {
  if (session.authority.kind === 'anonymous') {
    return Object.freeze({
      status: 'anonymous',
      authMode: session.activeMode,
      authorizationStreamIncarnation: session.authorizationStreamIncarnation,
      authorityInstanceId: session.authorityDescriptor.authorityInstanceId,
    });
  }
  const credentialSession = credential?.session ?? null;
  return Object.freeze({
    status: 'authenticated',
    userId: session.authority.userId,
    sessionId: session.authority.sessionId,
    sessionClass: session.authority.kind,
    provider: credentialSession?.provider ?? null,
    authorityInstanceId: session.authorityDescriptor.authorityInstanceId,
    sessionGeneration: session.authorityDescriptor.sessionGeneration,
    authorizationStreamIncarnation: session.authorizationStreamIncarnation,
    expiresAt: credentialSession?.expiresAt ?? null,
    absoluteExpiresAt: credentialSession?.absoluteExpiresAt ?? null,
  });
};

const SAFE_DIAGNOSTIC_CODE = /^SNAPBACK_[A-Z0-9_]+$/u;
const SECRET_BEARING_TEXT = /(?:\bBearer\s+\S+|sbs_[A-Za-z0-9._~-]+|sbrv1_[A-Za-z0-9._~-]+)/u;
const UNSAFE_FACT_KEY = /(?:bearer|credential|password|recovery|secret|token)/iu;

const safeBlockedString = (value, { diagnosticCode = false } = {}) => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= 512
  && !SECRET_BEARING_TEXT.test(value)
  && (!diagnosticCode || SAFE_DIAGNOSTIC_CODE.test(value))
);

const safeBlockedPrecondition = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
  const entries = [];
  for (const [key, fact] of Object.entries(value)) {
    if (UNSAFE_FACT_KEY.test(key)) continue;
    if (key === 'code' || key === 'causeCode') {
      if (safeBlockedString(fact, { diagnosticCode: true })) entries.push([key, fact]);
      continue;
    }
    if (
      fact === null
      || typeof fact === 'boolean'
      || (typeof fact === 'number' && Number.isSafeInteger(fact))
      || safeBlockedString(fact)
    ) entries.push([key, fact]);
  }
  return Object.freeze(Object.fromEntries(entries));
};

const safeBlockedRemediation = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (
    !safeBlockedString(value.kind)
    || !safeBlockedString(value.riskClass)
    || typeof value.machineApplicable !== 'boolean'
    || typeof value.requiresApproval !== 'boolean'
    || !safeBlockedString(value.authorityEffect)
    || !safeBlockedString(value.description)
  ) return null;
  return Object.freeze({
    kind: value.kind,
    riskClass: value.riskClass,
    machineApplicable: value.machineApplicable,
    requiresApproval: value.requiresApproval,
    authorityEffect: value.authorityEffect,
    precondition: safeBlockedPrecondition(value.precondition),
    description: value.description,
  });
};

const blockedFallbackRemediation = (causeCode, phase) => {
  if (causeCode === 'SNAPBACK_AUTH_TRANSITION_FAILED') {
    return Object.freeze({
      kind: 'repairAuthTransitionParticipant',
      riskClass: 'mechanical',
      machineApplicable: false,
      requiresApproval: false,
      authorityEffect: 'none',
      precondition: Object.freeze({ causeCode, ...(phase === null ? {} : { phase }) }),
      description: 'Repair the named failing auth-transition phase, then retry settlement.',
    });
  }
  if (
    causeCode === 'SNAPBACK_AUTH_CUSTODY_CORRUPT'
    || causeCode === 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'
    || causeCode === 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'
  ) {
    return Object.freeze({
      kind: 'recoverAuthCustody',
      riskClass: 'destructive',
      machineApplicable: false,
      requiresApproval: true,
      authorityEffect: 'clears-session',
      precondition: Object.freeze({ causeCode }),
      description: 'Recover or replace the named fail-closed auth custody record with explicit approval.',
    });
  }
  return Object.freeze({
    kind: 'retryAuthBootstrap',
    riskClass: 'mechanical',
    machineApplicable: true,
    requiresApproval: false,
    authorityEffect: 'none',
    precondition: Object.freeze({ causeCode }),
    description: 'Retry authentication bootstrap after repairing the named protocol condition.',
  });
};

const currentPrincipalBlocked = (error) => {
  const observedCode = error?.diagnostic?.code ?? error?.code;
  const causeCode = safeBlockedString(observedCode, { diagnosticCode: true })
    ? observedCode
    : 'SNAPBACK_AUTH_HANDSHAKE_INVALID';
  const sourceDetails = error?.diagnostic?.details;
  const phase = safeBlockedString(sourceDetails?.phase) ? sourceDetails.phase : null;
  const nestedCauseCode = safeBlockedString(sourceDetails?.causeCode, { diagnosticCode: true })
    ? sourceDetails.causeCode
    : causeCode;
  const details = Object.freeze({
    ...(phase === null ? {} : { phase }),
    causeCode: nestedCauseCode,
  });
  const message = safeBlockedString(error?.diagnostic?.message)
    ? error.diagnostic.message
    : 'Authentication custody or authority could not settle.';
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: causeCode,
    severity: 'error',
    message,
    details,
  });
  const originalRemediations = Array.isArray(error?.remediations)
    ? error.remediations.map(safeBlockedRemediation).filter(Boolean)
    : [];
  return Object.freeze({
    status: 'blocked',
    diagnostic,
    remediations: Object.freeze(originalRemediations.length > 0
      ? originalRemediations
      : [blockedFallbackRemediation(causeCode, phase)]),
  });
};

const projectChallengeResponse = (value) => {
  if (
    !exactRecord(value, ['challengeId', 'expiresAt'])
    || typeof value.challengeId !== 'string'
    || value.challengeId.length === 0
    || !safeUnsignedInteger(value.expiresAt)
  ) return null;
  return { challengeId: value.challengeId, expiresAt: value.expiresAt };
};

const opaqueCredentialResponseError = () => {
  const error = new Error(
    'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: auth provider returned an invalid credential response',
  );
  error.code = 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
  error.diagnostic = {
    code: error.code,
    message: 'auth provider returned an invalid credential response',
  };
  return error;
};

// @ref LLP 0060#c1-the-v1-custody-claim — issuer diagnostics are
// response-controlled. Only an exact method/route/status/code tuple may
// select a fixed local recovery error; no response message, details, headers,
// receipt, or other bytes cross this boundary.
const LOCAL_ISSUER_FAILURES = new Map([
  ['POST /auth/exchange 401 SNAPBACK_AUTH_CODE_INVALID', {
    code: 'SNAPBACK_AUTH_CODE_INVALID',
    message: 'the login code is invalid; request a new challenge',
  }],
  ['POST /auth/exchange 403 SNAPBACK_AUTH_CODE_LOCKED', {
    code: 'SNAPBACK_AUTH_CODE_LOCKED',
    message: 'the login challenge is locked; request a new challenge',
  }],
  ['POST /auth/refresh 409 SNAPBACK_AUTH_REFRESH_SUPERSEDED', {
    code: 'SNAPBACK_AUTH_REFRESH_SUPERSEDED',
    message: 'the session refresh was superseded',
  }],
  ['POST /auth/refresh 401 SNAPBACK_AUTH_SENDER_PROOF_REQUIRED', {
    code: 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED',
    message: 'the sender proof nonce must be refreshed',
  }],
]);

const localIssuerFailure = (method, path, status, value) => {
  const responseCode = value?.diagnostic?.code;
  if (typeof responseCode !== 'string') return null;
  const local = LOCAL_ISSUER_FAILURES.get(`${method} ${path} ${status} ${responseCode}`);
  if (!local) return null;
  const error = new Error(`${local.code}: ${local.message}`);
  error.code = local.code;
  error.diagnostic = { code: local.code, message: local.message };
  error.status = status;
  return error;
};

const clientAuthorityFromHandshake = (session) => {
  const base = {
    authMode: session.activeMode,
    authorizationStreamIncarnation: session.authorizationStreamIncarnation,
  };
  if (session.authority?.kind === 'humanSession') {
    return {
        kind: 'session',
        ...base,
        sessionId: session.authority.sessionId,
        userId: session.authority.userId,
      };
  }
  if (session.authority?.kind === 'anonymous') return { kind: 'anonymous', ...base };
  // AuthCoordinator owns browser session custody only. A service projection
  // is valid on the wire for AgentAuthorityFence, but must never be adopted as
  // a browser session with a null session id.
  throw staleAuthorityError();
};

const credentialAuthority = (response, activeMode = 'sessions', incarnation = null) => ({
  kind: 'session',
  authMode: activeMode,
  authorizationStreamIncarnation: incarnation,
  sessionId: response?.session?.id,
  userId: response?.session?.userId,
});

const sameClientAuthority = (left, right) => (
  left?.kind === right?.kind
  && left?.authMode === right?.authMode
  && left?.authorizationStreamIncarnation === right?.authorizationStreamIncarnation
  && (left?.kind !== 'session' || (
    left?.sessionId === right?.sessionId
    && left?.userId === right?.userId
  ))
);

const staleAuthorityError = () => clientCodedError(new Error(
  'SNAPBACK_CLIENT_AUTHORITY_STALE: the operation completed under a stale client authority',
), 'SNAPBACK_CLIENT_AUTHORITY_STALE');

const authorityCommitReentrantError = (message) => clientCodedError(
  new Error(`SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT: ${message}`),
  'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
);

/// Construct the generic client around a session bearer minted by a trusted
/// server-side identity broker. This is the explicit non-custodial protocol
/// client seam: it offers the exact auth/rr + auth/live protocol versions at
/// every boundary, but it does not claim browser sender-constrained custody.
///
/// @ref LLP 0096#2-per-profile-contract — external protocol clients repeat
///   the exact auth offers independently of how the bearer was obtained.
export function createExternalSessionClient(baseUrl, {
  bearerToken,
  ...options
} = {}) {
  if (typeof bearerToken != 'string' || bearerToken === '') {
    throw new TypeError('createExternalSessionClient requires a non-empty bearerToken');
  }
  if (options.authCoordinator || options.agentAuthority || options.senderConstrained) {
    throw new TypeError(
      'external session bearer custody is mutually exclusive with browser, agent, and sender-constrained custody',
    );
  }
  options.bearerToken = bearerToken;
  options.authClientProtocol = 1;
  options.authorityDescriptorProtocol = 1;
  return new SnapbackClient(baseUrl, options);
}

/// Bind a first-party live-query handle to a React Native/Expo-style AppState
/// source without taking a react-native package dependency. The source must
/// expose `currentState` and `addEventListener('change', listener)`; the
/// handle must expose the provider-owned pause/resume lifecycle.
///
/// @ref LLP 0064#5-host-lifecycle — host events translate once into provider
///   policy; view code never owns reconnection.
export function bindSnapbackAppLifecycle(appState, handle, {
  activeState = 'active',
  onError = () => {},
} = {}) {
  if (!appState || typeof appState.addEventListener !== 'function') {
    throw new TypeError('bindSnapbackAppLifecycle requires an AppState-compatible event source');
  }
  if (!handle || typeof handle.pause !== 'function' || typeof handle.resume !== 'function') {
    throw new TypeError('bindSnapbackAppLifecycle requires a live handle with pause() and resume()');
  }
  if (typeof onError !== 'function') {
    throw new TypeError('bindSnapbackAppLifecycle onError must be a function');
  }
  let disposed = false;
  let observedState = appState.currentState ?? null;
  let transition = Promise.resolve();
  const apply = (state) => {
    if (disposed || state === observedState) return transition;
    observedState = state;
    transition = transition.then(async () => {
      if (disposed) return;
      if (state === activeState) await handle.resume();
      else await handle.pause();
    }).catch((error) => {
      try { onError(error); } catch { /* observation never owns lifecycle */ }
    });
    return transition;
  };
  const subscription = appState.addEventListener('change', apply);
  // Bind the current non-active state immediately. Active handles begin in
  // their ordinary attached state and need no synthetic resume.
  if (observedState !== null && observedState !== activeState) {
    const initial = observedState;
    observedState = null;
    void apply(initial);
  }
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof subscription === 'function') subscription();
      else subscription?.remove?.();
    },
    settled() {
      return transition;
    },
  });
}

const clientCodedError = (error, code) => {
  const message = error.message.startsWith(`${code}: `)
    ? error.message.slice(code.length + 2)
    : error.message;
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    subsystem: 'client',
    message,
    details: Object.freeze({}),
  });
  return new SnapbackDiagnosticError(diagnostic, { message, cause: error });
};

const EXTERNAL_BEARER_FENCED_STORE_READS = new Set([
  '__admitLocalMutationReads',
  '__evaluateLocalMutationWithReadAdmission',
  '__prepareGeneratedMaterializationBridge',
  '__readQmk1LocalAnswer',
  'evaluateLocalResultTransform',
  'prepareGeneratedMutation',
  'prepareProtectedQueryRetention',
  'registerQuery',
  'seedFromMaterializationState',
  'seedProtectedQueryRetention',
  'seedProtectedQueryRetentionState',
]);
const externalBearerPredecessorFencedError = () => new Error(
  'retained predecessor data is fenced until the writer completes the authority-transition wipe',
);

const OFFLINE_MUTATION_REPLAY_CAPABILITY = 'offline_mutation_replay';
const OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED =
  'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED';
const OFFLINE_MUTATION_REPLAY_CAPABILITY_FACT_V1 =
  'snapback.offline-mutation-replay-capability-fact.v1';

const canonicalServerOrigin = (baseUrl) => {
  try { return new URL(baseUrl).origin; } catch { return baseUrl; }
};

const offlineMutationReplayCapabilityFactFromInspection = (inspection, origin) => {
  // Local `/inspect` nests the manifest in PublicInspect; the Cloudflare
  // proof serves that same manifest directly at `/inspect` and `/capability`.
  const manifest = inspection?.capabilityManifest
    ?? (Array.isArray(inspection?.supportedCapabilities) ? inspection : null);
  const targetProfileId = typeof manifest?.targetProfileId === 'string'
    ? manifest.targetProfileId
    : typeof inspection?.targetProfileId === 'string'
      ? inspection.targetProfileId
      : null;
  const supported = Array.isArray(manifest?.supportedCapabilities)
    && manifest.supportedCapabilities.includes(OFFLINE_MUTATION_REPLAY_CAPABILITY);
  return Object.freeze({
    schemaVersion: OFFLINE_MUTATION_REPLAY_CAPABILITY_FACT_V1,
    origin,
    supported,
    reason: supported ? null : 'not-advertised',
    targetProfileId,
    artifactGeneration: artifactGenerationFromInspection(inspection),
  });
};

const offlineMutationReplayCapabilityFactFromAnsweredError = (cause, origin) => Object.freeze({
  schemaVersion: OFFLINE_MUTATION_REPLAY_CAPABILITY_FACT_V1,
  origin,
  supported: false,
  reason: 'inspection-refused',
  targetProfileId: null,
  artifactGeneration: null,
  cause,
});

const normalizeOfflineMutationReplayCapabilityFact = (value) => {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schemaVersion !== OFFLINE_MUTATION_REPLAY_CAPABILITY_FACT_V1
    || typeof value.origin !== 'string'
    || value.origin.length === 0
    || typeof value.supported !== 'boolean'
    || !(value.reason === null || typeof value.reason === 'string')
    || !(value.targetProfileId === null || typeof value.targetProfileId === 'string')
    || !(
      value.storeRevision === undefined
      || (Number.isSafeInteger(value.storeRevision) && value.storeRevision >= 1)
    )
  ) return null;
  let artifactGeneration = null;
  if (value.artifactGeneration !== null) {
    try {
      artifactGeneration = normalizeExpectedGeneration(
        value.artifactGeneration,
        'offline mutation replay capability artifact generation',
      );
    } catch {
      return null;
    }
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    origin: value.origin,
    supported: value.supported,
    reason: value.reason,
    targetProfileId: value.targetProfileId,
    artifactGeneration,
    ...(value.storeRevision === undefined ? {} : { storeRevision: value.storeRevision }),
  });
};

const offlineQueueSettlementLedgerError = ({
  cause = undefined,
  reason,
  targetProfileId = null,
} = {}) => {
  const message = reason === 'inspection-unavailable'
    ? 'the target settlement-ledger capability could not be verified; durable mutation queueing and replay are disabled'
    : `target ${targetProfileId ?? '(unknown)'} does not advertise ${OFFLINE_MUTATION_REPLAY_CAPABILITY}; durable mutation queueing and replay are unsafe`;
  const error = new Error(
    `${OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED}: ${message}`,
    cause === undefined ? undefined : { cause },
  );
  error.name = 'SnapbackOfflineQueueCapabilityError';
  error.code = OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED;
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED,
    severity: 'error',
    subsystem: 'outbox',
    message,
    details: Object.freeze({
      capability: OFFLINE_MUTATION_REPLAY_CAPABILITY,
      reason,
      targetProfileId,
    }),
  });
  return error;
};

export const SNAPBACK_QUERY_OFFLINE_UNAVAILABLE =
  'SNAPBACK_QUERY_OFFLINE_UNAVAILABLE';
export const SNAPBACK_STORE_RUNTIME_LOAD_FAILED =
  'SNAPBACK_STORE_RUNTIME_LOAD_FAILED';

const RETAINABLE_QUERY_RETENTION_CLASSES = new Set([
  'opaque-authorized-snapshot-v1',
  'result-transform-snapshot-v1',
  'rqs-authority-independent-snapshot-v1',
]);

// @ref LLP 0092#0c2-the-rqseligible-served-manifest-predicate — refuse with
// the failed rule, not just the outcome: the generated reference carries the
// codegen-derived retention classification, so when the server mints no
// resume token the fact can name WHICH eligibility layer refused (declaration
// never opted in vs. class volatile-by-design vs. target did not activate an
// eligible class) instead of one generic sentence.
export function rqsRetentionIneligibilityReason(ref) {
  const declaredRetention =
    ref?.composition?.normalizedCompositePlan?.classification?.retention ?? null;
  if (declaredRetention === 'rqs-authority-independent-snapshot-v1') {
    return 'the generated declaration is retention-eligible (single_table_v1), '
      + 'but this server minted no resume token: the target did not advertise '
      + 'or activate the class for this query';
  }
  if (declaredRetention !== null) {
    return `the generated retention class '${declaredRetention}' is `
      + 'deliberately volatile on this arm: only '
      + 'rqs-authority-independent-snapshot-v1 single-table declarations '
      + 'cold-retain here';
  }
  if (ref !== null && typeof ref === 'object' && ref.artifactKind === 'functionReference') {
    return 'the generated declaration carries no retention classification: '
      + 'eligibility requires a declarative defineLiveQuery over one table '
      + "with auth: 'public' and no membership or ambient inputs (explicit "
      + 'args are allowed; JS handlers are never eligible)';
  }
  return 'the server minted no resume token: not an '
    + 'authority-independent closed-inputs live query (LLP 0090)';
}

const GRANDFATHERED_PRELOAD_RECEIPT = Object.freeze({
  committed: true,
  added: 0,
  retired: 0,
  duplicate: true,
  grandfatheredLegacy: true,
});

function storeRuntimeLoadError(cause) {
  if (cause?.code === SNAPBACK_STORE_RUNTIME_LOAD_FAILED) return cause;
  const message = 'the optional Full-profile store runtime could not be loaded';
  const error = new Error(`${SNAPBACK_STORE_RUNTIME_LOAD_FAILED}: ${message}`, { cause });
  error.code = SNAPBACK_STORE_RUNTIME_LOAD_FAILED;
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: SNAPBACK_STORE_RUNTIME_LOAD_FAILED,
    severity: 'error',
    subsystem: 'client',
    message,
  });
  return error;
}

// @ref LLP 0166#d4--completeness-honest-local-answers — transport failure
// cannot upgrade missing or volatile state into a local answer. This typed D4
// refusal stays in the root because it must remain available when the optional
// Full-profile store-runtime chunk itself cannot load.
function queryOfflineUnavailableError({
  cause,
  name,
  ref,
  persistResume = true,
  preparedMaterialization = null,
}) {
  const retentionClass = preparedMaterialization?.bridge?.retentionClass
    ?? ref?.composition?.normalizedCompositePlan?.classification?.retention
    ?? 'none';
  const retentionDisposition = RETAINABLE_QUERY_RETENTION_CLASSES.has(retentionClass)
    ? 'retainable'
    : 'volatile';
  const reason = retentionDisposition === 'volatile'
    ? `query retention class ${JSON.stringify(retentionClass)} does not admit `
      + 'an authoritative retained local answer'
    : persistResume !== true
      ? 'local retention was disabled for this query'
      : 'no authoritative retained answer passed the LLP 0166 D4 witness, '
        + 'capability, fence, and completeness checks';
  const message = `${name} is unavailable offline because ${reason}`;
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: SNAPBACK_QUERY_OFFLINE_UNAVAILABLE,
    severity: 'error',
    subsystem: 'client',
    message,
    details: Object.freeze({
      function: name,
      retentionClass,
      retentionDisposition,
      localAnswer: Object.freeze({
        answerClass: 'unknown',
        freshness: null,
        reason,
      }),
    }),
  });
  const error = new SnapbackDiagnosticError(diagnostic, {
    message,
    cause: isSnapbackDiagnosticError(cause) && cause.cause !== undefined
      ? cause.cause
      : cause,
    operation: 'query',
    refKind: ref?.kind ?? 'Query',
    effectCommitted: false,
    effectMayHaveCommitted: false,
  });
  error.name = 'SnapbackQueryOfflineUnavailableError';
  return error;
}

export class SnapbackClient {
  constructor(baseUrl, {
    adminToken = (typeof process !== 'undefined' && process.env ? process.env.SNAPBACK_ADMIN_TOKEN : null) ?? null,
    devIdentityCapability = null,
    bearerToken = null,
    // 0137 A4-f6: an explicit anonymous mode so headless consumers (suites,
    // SSR, prerender) can read `auth: 'public'` operations from a sessions
    // server — the protocol offer is sent with no credential. Auth-required
    // operations receive the server's ordinary anonymous refusal.
    custody = null,
    authClientProtocol = null,
    // Capability advertisement, default-on at the implementing library
    // boundary. Embedded integrations may pass null to remain intentionally
    // legacy; auth-scoped live work then refuses rather than degrading.
    authInvalidationProtocol = 1,
    authorityDescriptorProtocol = 1,
    authorizedLeaseProtocol = null,
    // LLP 0163 pre-publication carrier. Explicit opt-in only while the Spec
    // and capability rows remain Draft/Missing; v1 requires a durable outbox
    // so range, next counter, and intent share one restart-safe transition.
    operationIdentityProtocol = null,
    // Set only after capability preflight advertises the hosted ephemeral
    // authority offer. Old servers therefore never see an unknown member.
    ephemeralAuthorityProtocol = null,
    // LLP 0107's additive expiry clock negotiation. A version-aware server
    // echoes 1; a legacy server is retried without this member so durable
    // operations remain available while React presence reports unsupported.
    ephemeralExpiryProtocol = 1,
    authCoordinator = null,
    agentAuthority = null,
    senderConstrained = false,
    clientStoreId = processClientStoreId,
    authCounterCeiling = Number.MAX_SAFE_INTEGER,
    // Channel B persisted RQS resume store (LLP 0090 D3 / rollout step 5):
    // when present, rqsEligible subscriptions persist {rows, meta, token}
    // and relaunches render-first + resume.
    //
    // DEFAULT-ON since LLP 0129 Phase 0 (option A): when the option is
    // omitted the client resolves a default store — IndexedDB in browsers,
    // durable files on node, in-memory otherwise — reported on
    // `client.rqsStoreInfo`. Pass `rqsStore: null` (or set
    // SNAPBACK_CLIENT_RQS_STORE=off) to disable persistence entirely.
    rqsStore = undefined,
    // LLP 0043 M2 queued-intent outbox (LLP 0129 Phase 0, JS arm): 'auto'
    // enables durable offline queueing whenever the resolved store carries
    // the outbox contract. Browser/agent custody records are fenced by their
    // captured descriptor, principal scope, and durable authority lineage.
    // `false` disables queueing; `true` requires an outbox-capable store.
    offlineQueue = 'auto',
    // LLP 0270 D4: a qualified durable outbox owns its safety controller for
    // the client lifecycle. `manual` keeps the controller and all barriers but
    // disables automatic scheduling, matching the React provider vocabulary.
    outboxDrain = 'auto',
    // LLP 0218 P4 attachment seam, now attached: when no explicit observer
    // is injected, relinquishment events land on this client's LLP 0219
    // structured diagnostics channel (the delivery surface 0218 SS4.4 names).
    devDiagnosticsChannel = null,
    // The line-oriented channel reporter is a development default only. The
    // positive environment seam still gates `true`; `false` is an explicit
    // host opt-out.
    devDiagnosticsReporter = true,
    queuedMutationWedgeWarningMs = DEFAULT_QUEUED_MUTATION_WEDGE_WARNING_MS,
    // LLP 0094 §0B.6 strict mode: refuse a suspected pre-B1 legacy server
    // instead of downgrading to an offerless (legacy) open. Conformance
    // claims made against a strict configuration are claims about v1-bound
    // connections only.
    strictWireVersion = false,
    // Optional sink for the §0B.6 structured downgrade diagnostic. Default:
    // the diagnostic is recorded on `wireVersionDiagnostics` and emitted via
    // console.warn — a downgrade is never silent.
    onWireVersionDiagnostic = null,
    // LLP 0059's effect-free authorization-reservation retry contract. A
    // value of 1 disables retries while retaining the exact refusal.
    reservationRetryMaxAttempts = DEFAULT_RESERVATION_RETRY_MAX_ATTEMPTS,
    reservationRetryJitterMilliseconds = DEFAULT_RESERVATION_RETRY_JITTER_MILLISECONDS,
    onReservationRetryDiagnostic = null,
    // Per-class decoded-byte ingress bounds (LLP 0062); partial overrides
    // merge over DEFAULT_INGRESS_LIMIT_BYTES.
    ingressLimits = null,
    // Internal construction seams for generated identity, test carriers, and
    // deterministic owner snapshots. Product callers use registerQuery and
    // never author addresses or authority partition digests.
    __registrationAddressResolver = null,
    __authorityPartitionDigestResolver = null,
    __preloadBootPayload = undefined,
    __materializationStore = null,
    __allowLegacyDevAssertion = false,
    __clientDiagnosticsOptions = null,
    __devDiagnosticsReporterOptions = null,
    // LLP 0267 fixture seam. Product callers omit it; positive development
    // detection controls the recorder and production absence stays disabled.
    __runtimeCostDiagnosticsOptions = null,
    __defaultRqsStoreAppPlatform = null,
    __defaultRqsStoreAppOwnerKey = null,
    // Deterministic package-test seam. Product callers omit this and use the
    // served `/inspect` capability manifest; it is intentionally undeclared
    // in the public TypeScript surface.
    __offlineMutationReplayCapability = null,
    // Settlement-core tests can suppress only the new default lifecycle while
    // exercising the lower-level replay state machine directly. Product
    // callers omit this undeclared seam.
    __outboxDrainLifecycle = true,
    // Cloudflare proof-target transport seam: that target has no hosted
    // session authority, so its constructor adapter may opt ordinary app
    // data requests into the already-configured operator credential.
    __adminDataPlane = false,
    // Deterministic construction seam for the LLP 0166 background runtime.
    // Production callers omit it; wiring tests inject clocks/carriers without
    // replacing any policy or broker object.
    __storeRuntimeOptions = null,
    // Installed only by the generated declared-dev app-binding path. The
    // public URL is insufficient without this generated identity witness.
    declaredDevDeploymentIdentity = null,
    // @ref LLP 0302#8a-recorded-obligations-post-freeze-resolved-in-implementation-not
    // — in this explicit mode every outbound transport-bearing public method
    // invocation is its own operation episode; composite/nested phases and
    // concurrent invocations each receive an independent preflight.
    declaredDevStreamless = false,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    if (typeof declaredDevStreamless !== 'boolean') {
      throw new TypeError('declaredDevStreamless must be boolean');
    }
    this.__declaredDevEpisodeGate = declaredDevDeploymentIdentity === null
      ? null
      : createDeclaredDevEpisodeGate({
          origin: this.baseUrl,
          expectedDeploymentIdentity: declaredDevDeploymentIdentity,
          streamless: declaredDevStreamless,
        });
    this.adminToken = adminToken;
    installDevIdentityCapability(this, devIdentityCapability);
    if (typeof __adminDataPlane !== 'boolean') throw new TypeError('__adminDataPlane must be boolean');
    this.__adminDataPlane = __adminDataPlane;
    this.ingressLimits = normalizedIngressLimits(ingressLimits);
    if (authCoordinator && agentAuthority) {
      throw new TypeError('AuthCoordinator and AgentAuthorityFence are mutually exclusive');
    }
    if (agentAuthority !== null && !isAgentAuthorityFence(agentAuthority)) {
      throw new TypeError('agentAuthority must be an AgentAuthorityFence');
    }
    if ((authCoordinator || agentAuthority) && bearerToken !== null) {
      throw new TypeError('bearerToken cannot bypass browser or agent custody');
    }
    if (typeof senderConstrained != 'boolean') {
      throw new TypeError('senderConstrained must be boolean');
    }
    if (senderConstrained && !authCoordinator) {
      throw new TypeError('senderConstrained browser transport requires AuthCoordinator custody');
    }
    if (senderConstrained) canonicalSenderExternalUri(this.baseUrl, '/auth/session');
    if (custody !== null && custody !== 'anonymous-public') {
      throw new TypeError("custody must be null or 'anonymous-public'");
    }
    if (custody === 'anonymous-public') {
      if (authCoordinator || agentAuthority || bearerToken !== null) {
        throw new TypeError(
          "custody 'anonymous-public' is mutually exclusive with browser, agent, and external-bearer custody",
        );
      }
      if (authClientProtocol === null) authClientProtocol = 1;
    }
    if (
      authClientProtocol === 1
      && !authCoordinator
      && !agentAuthority
      && custody !== 'anonymous-public'
      && (typeof bearerToken != 'string' || !bearerToken)
    ) {
      throw new TypeError(
        'authClientProtocol v1 requires browser, agent, explicit external-bearer, or anonymous-public custody',
      );
    }
    if ((authCoordinator || agentAuthority) && authClientProtocol === null) authClientProtocol = 1;
    this.custody = custody;
    if (typeof __allowLegacyDevAssertion !== 'boolean') {
      throw new TypeError('__allowLegacyDevAssertion must be boolean');
    }
    if (__allowLegacyDevAssertion && custody !== 'anonymous-public') {
      throw new TypeError('__allowLegacyDevAssertion requires anonymous-public offer custody');
    }
    this.__allowLegacyDevAssertion = __allowLegacyDevAssertion;
    if (!Number.isSafeInteger(authCounterCeiling) || authCounterCeiling < 1) {
      throw new TypeError('authCounterCeiling must be a positive safe integer');
    }
    this.bearerToken = bearerToken;
    this.authCoordinator = authCoordinator;
    this.senderConstrained = senderConstrained;
    this.agentAuthority = agentAuthority;
    this.authorityFence = authCoordinator ?? agentAuthority;
    this.clientStoreId = clientStoreId;
    // Default persistence resolution (LLP 0129 Phase 0). `undefined` means
    // "not configured" and resolves the default ladder; explicit null/false
    // is the opt-out. The resolved implementation and durability mode are
    // always reported (LLP 0008 DK-9).
    let registrationRandomBytes;
    if (isDefaultRqsStoreResolution(rqsStore)) {
      this.rqsStore = rqsStore.store;
      this.rqsStoreInfo = rqsStore.info;
      // Provider-level acquisition owns the shared registry refcount and is
      // therefore the only layer allowed to close this default connection.
      this.__ownsRqsStore = false;
      registrationRandomBytes = rqsStore.randomBytes;
    } else if (rqsStore === undefined) {
      const resolved = __defaultRqsStoreAppPlatform === null
        ? resolveDefaultRqsStore({ baseUrl: this.baseUrl })
        : resolveDefaultRqsStore({
            baseUrl: this.baseUrl,
            appPlatform: __defaultRqsStoreAppPlatform,
            appOwnerKey: __defaultRqsStoreAppOwnerKey,
          });
      this.rqsStore = resolved.store;
      this.rqsStoreInfo = resolved.info;
      this.__ownsRqsStore = resolved.store !== null;
      registrationRandomBytes = resolved.randomBytes;
    } else if (rqsStore) {
      this.rqsStore = rqsStore;
      const durability = typeof rqsStore.durability === 'function'
        ? rqsStore.durability()
        : null;
      this.rqsStoreInfo = Object.freeze({
        source: 'injected',
        implementation: durability?.implementation ?? 'injected',
        durable: durability?.durable ?? null,
        reason: null,
      });
      this.__ownsRqsStore = false;
    } else {
      this.rqsStore = null;
      this.rqsStoreInfo = Object.freeze({
        source: 'disabled',
        implementation: null,
        durable: false,
        reason: 'explicit-opt-out',
      });
      this.__ownsRqsStore = false;
    }
    this.__rqsStoreClosePromise = null;
    this.__inlinePreloadBootPayload = __preloadBootPayload === undefined
      ? readInlineBootPayloadForRegistration()
      : __preloadBootPayload;
    this.__preloadRegistrationPromise = null;
    this.__storeRuntimeModule = null;
    this.__storeRuntimeModulePromise = null;
    this.__storeRuntimeInitialized = false;
    this.__storeRuntimeClosed = false;
    this.__storeRuntimeConfiguration = Object.freeze({
      options: __storeRuntimeOptions,
      authorityPartitionDigestResolver: __authorityPartitionDigestResolver,
      materializationStore: __materializationStore,
      preloadBootPayload: this.__inlinePreloadBootPayload,
      randomBytes: registrationRandomBytes,
      registrationAddressResolver: __registrationAddressResolver,
    });
    if (offlineQueue !== 'auto' && typeof offlineQueue != 'boolean') {
      throw new TypeError("offlineQueue must be 'auto', true, or false");
    }
    if (outboxDrain !== 'auto' && outboxDrain !== 'manual') {
      throw new TypeError("outboxDrain must be 'auto' or 'manual'");
    }
    if (typeof __outboxDrainLifecycle !== 'boolean') {
      throw new TypeError('__outboxDrainLifecycle must be boolean');
    }
    if (
      __offlineMutationReplayCapability !== null
      && typeof __offlineMutationReplayCapability !== 'boolean'
    ) {
      throw new TypeError('__offlineMutationReplayCapability must be null or boolean');
    }
    this.__offlineQueue = offlineQueue;
    this.outboxDrainPolicy = outboxDrain;
    this.__outboxDrainLifecycle = __outboxDrainLifecycle;
    this.__offlineMutationReplayCapability = __offlineMutationReplayCapability;
    this.__observedOfflineMutationReplayCapability = null;
    this.__offlineMutationReplayCapabilityLocalOverride = null;
    this.__offlineMutationReplayLifecycleProbe = null;
    this.__offlineMutationReplayLifecycleSettlement = Promise.resolve(null);
    if (operationIdentityProtocol !== null && operationIdentityProtocol !== 1) {
      throw new TypeError('operationIdentityProtocol must be null or 1');
    }
    this.__operationIdentityProtocol = operationIdentityProtocol;
    this.__outboxReplayTask = null;
    this.__outboxHousekeepingReplayTask = null;
    this.__outboxReplayScheduled = false;
    this.__outboxReplayTimer = null;
    this.__outboxDrainController = null;
    this.__outboxDrainHandle = null;
    this.__outboxDrainStartBlockedReason = null;
    this.__outboxCustodyWakeGeneration = 0;
    this.__clientClosed = false;
    this.__outboxBarrierProviders = new Set();
    this.__outboxLastReplayStop = null;
    this.__outboxHousekeepingLastReplayStop = null;
    this.__inspectionAppId = null;
    this.__outboxDiagnostics = [];
    if (typeof devDiagnosticsReporter !== 'boolean') {
      throw new TypeError('devDiagnosticsReporter must be boolean');
    }
    this.__clientDiagnosticsChannel = createClientDiagnosticsChannel(
      __clientDiagnosticsOptions ?? undefined,
    );
    this.__runtimeCostDiagnostics = createRuntimeCostDiagnostics({
      diagnosticsChannel: this.__clientDiagnosticsChannel,
      ...(__runtimeCostDiagnosticsOptions ?? {}),
    });
    this.__outboxListeners = new Set();
    // @ref LLP 0219#decision — default console delivery exists only under a
    // positive dev/HMR signal; absence of production markers never enables it.
    this.__devDiagnosticsReporter = devDiagnosticsReporter
      && positiveDevelopmentEnvironment()
      ? createClientDevConsoleReporter(
        this.__clientDiagnosticsChannel,
        __devDiagnosticsReporterOptions ?? undefined,
      )
      : null;
    this.__outboxDiagnosticsProducer = attachOutboxDiagnosticsProducer({
      channel: this.__clientDiagnosticsChannel,
      subscribeOutbox: (listener) => this.subscribeOutbox(listener),
      readHeadFact: () => this.#outboxHeadFact(),
      queuedMutationWedgeWarningMs,
      now: __clientDiagnosticsOptions?.now ?? Date.now,
    });
    this.__optimisticMutationViews = new Set();
    // Carrier-independent presentation ledger for online generated
    // mutations. Durable queue-capable calls use the outbox instead; this
    // process-local fallback lets React/Expo and headless paint the
    // same generated operation without manufacturing restart durability.
    // @ref LLP 0270#d3-derive-and-attach-optimistic-presentation-by-default
    this.__ephemeralOptimisticRecords = new Map();
    this.__optimisticRecordStore = Object.freeze({
      outboxRecords: async () => {
        const durable = this.#offlineQueueStore(false);
        const durableRecords = durable === null ? [] : await durable.outboxRecords();
        const durableIds = new Set(durableRecords.map((record) => record?.id));
        return [
          ...durableRecords.map((record) => ({
            ...record,
            __optimisticSequenceEpoch:
              record.optimisticProcessEpoch === optimisticProcessOrder.epoch
              && Number.isSafeInteger(record.optimisticInvocationSequence)
                ? 'current'
                : 'prior',
            __optimisticInvocationSequence: record.optimisticInvocationSequence,
          })),
          ...[...this.__ephemeralOptimisticRecords.values()]
            .filter((record) => !durableIds.has(record.id))
            .map((record) => ({
              ...record,
              __optimisticSequenceEpoch: 'current',
              __optimisticInvocationSequence: record.optimisticInvocationSequence,
            })),
        ].map((record) => structuredClone(record));
      },
    });
    // @ref LLP 0219#producers-pilot-scoped-detectors — LLP 0218 §4.4 owns the
    // relinquishment trigger and payload; this channel owns delivery. With no
    // injected observer, the P4 seam's default target is this client's own
    // structured channel, adapted into the v2 carrier.
    this.__devDiagnosticsChannel = devDiagnosticsChannel ?? Object.freeze({
      emit: (event) => this.#bridgeRelinquishmentDevEvent(event),
    });
    this.__queuedRelinquishmentCount = 0;
    if (typeof strictWireVersion != 'boolean') {
      throw new TypeError('strictWireVersion must be boolean');
    }
    if (onWireVersionDiagnostic !== null && typeof onWireVersionDiagnostic != 'function') {
      throw new TypeError('onWireVersionDiagnostic must be a function');
    }
    if (
      !Number.isSafeInteger(reservationRetryMaxAttempts)
      || reservationRetryMaxAttempts < 1
      || reservationRetryMaxAttempts > 1_000
    ) {
      throw new TypeError('reservationRetryMaxAttempts must be a safe integer from 1 through 1000');
    }
    if (
      !Array.isArray(reservationRetryJitterMilliseconds)
      || reservationRetryJitterMilliseconds.length !== 2
      || !reservationRetryJitterMilliseconds.every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
      || reservationRetryJitterMilliseconds[0] > reservationRetryJitterMilliseconds[1]
    ) {
      throw new TypeError(
        'reservationRetryJitterMilliseconds must be an ascending pair of non-negative safe integers',
      );
    }
    if (
      onReservationRetryDiagnostic !== null
      && typeof onReservationRetryDiagnostic !== 'function'
    ) {
      throw new TypeError('onReservationRetryDiagnostic must be a function');
    }
    this.strictWireVersion = strictWireVersion;
    this.onWireVersionDiagnostic = onWireVersionDiagnostic;
    // §0B.6: the structured wire-version diagnostics this client surfaced.
    this.wireVersionDiagnostics = [];
    this.reservationRetryMaxAttempts = reservationRetryMaxAttempts;
    this.reservationRetryJitterMilliseconds = Object.freeze([
      ...reservationRetryJitterMilliseconds,
    ]);
    this.onReservationRetryDiagnostic = onReservationRetryDiagnostic;
    this.__reservationRetryDiagnostics = [];
    this.__liveQueryAllocator = allocatorForClientStore(clientStoreId);
    this.authProtocols = Object.freeze({
      authClient: authClientProtocol,
      authInvalidation: authInvalidationProtocol,
      authorityDescriptor: authorityDescriptorProtocol,
      authorizedLease: authorizedLeaseProtocol,
      ephemeralAuthority: ephemeralAuthorityProtocol,
      ephemeralExpiry: ephemeralExpiryProtocol,
    });
    this.__ephemeralExpirySupported = ephemeralExpiryProtocol === 1 ? null : false;
    // Keep the last validated projection separate from the current network
    // attempt. A forced offline probe may reject without poisoning or
    // replacing the durable/offline fence's last successful projection.
    this.__authSessionLastSuccessful = null;
    this.__authSessionInFlight = null;
    this.__authSessionCacheGeneration = 0;
    this.__unrecognizedAuthorityRecovery = null;
    this.__authCounterCeiling = authCounterCeiling;
    this.__authCounterError = null;
    this.__authCounterCut = false;
    // Receipt retention, kit half (LLP 0034 §3 / ENG-22478): a bounded ring
    // of every receipt this client observed (mutation receipts riding
    // responses, subscription receipts emitted by live handles, ephemeral
    // publish receipts), surfaced to the adapter via receipts()/onReceipt.
    this.__receiptRing = [];
    this.__receiptListeners = new Set();
    // Cross-lane drain routing (LLP 0034 §10.1 residual): per-connection
    // consumer registries so one connection's durable and ephemeral lanes
    // never destructively discard each other's envelopes on drain.
    this.__laneConsumers = new Map();
    // Owner labels are finite application-chosen diagnostics only. They are
    // never sent to the server and carry no authority or subscription token.
    // @ref LLP 0095#connection-ownership-per-app-authorityorigin — active
    // headless subscriptions remain attributable to their manager owner.
    this.__liveQueryOwners = new Map();
    // @ref LLP 0267#72-mutation-phase-visibility-consumes-llp-0059-ruling-6--decided
    // — retain one bounded client-side projection of the already-carried
    // ruling-6 timestamps; snapshot projection pseudonymizes caller ids.
    this.__mutationPhaseCostRecords = new Map();
    this.__mutationPhaseCostRetainedBytes = 0;
    this.__mutationPhaseCostDroppedRecords = 0;
    this.__mutationPhaseCostCounters = new Map();
    this.__mutationPhaseCostOtherKeys = emptyMutationPhaseAggregate('otherKeys');
    this.__mutationPhaseCostEvictedKeys = 0;
    this.__mutationPhaseCostEventSequence = 0;
    // Client-observed settlement versions are a bounded clock-local bridge to
    // the first covering authoritative delivery. They are not serialized.
    this.__mutationCommitObservations = new Map();
    this.__mutationCommitObservationSequence = 0;
    // ENG-23442 connection grants: caller label -> Promise<{id, token}>.
    this.__connectionGrants = new Map();
    // Hosted ephemeral recovery is application data production, not transport
    // authority. Registrations never receive the opaque authority identity;
    // they are invoked only after a fresh empty successor snapshot.
    //
    // @ref LLP 0111#four-way-wire-rollout-and-republisher — registrations are
    // bounded, generation-fenced, idempotently disposable, and become current
    // only after a successful publish acknowledgement.
    this.__ephemeralRepublishers = new Map();
    this.__ephemeralRepublisherGeneration = 0;
    this.__ephemeralAuthorityByCollection = new Map();
    this.__authControllers = new Set();
    // Retained across transport/response failures so retrying guest entry
    // presents the same durable effect identity instead of minting a second
    // principal after an unknown commit.
    this.__guestEntryIdempotencyKey = null;
    this.__rawLiveStreams = new Set();
    this.__closeAuthPromise = null;
    this.__authTransportGeneration = 0;
    this.__authSessionCapture = null;
    this.__currentPrincipalSnapshot = LOADING_CURRENT_PRINCIPAL;
    this.__currentPrincipalPending = LOADING_CURRENT_PRINCIPAL;
    this.__currentPrincipalSnapshotKey = currentPrincipalSemanticKey(LOADING_CURRENT_PRINCIPAL);
    this.__currentPrincipalListeners = new Set();
    this.__currentPrincipalPublicationHold = 0;
    this.__currentPrincipalNotificationsClosed = false;
    this.__authMaterializations = new Set();
    this.__authBarrierParticipants = new Set();
    // The durable clear and successor reconciliation are separate awaited
    // AuthCoordinator phases. Remember the exact queue authority generation
    // advanced by each transition so an older tab cannot reconcile after a
    // newer transition has already installed successor custody.
    this.__outboxTransitionAuthorityGenerations = new Map();
    // Explicit external-bearer custody has no AuthCoordinator to enumerate
    // protected handles during an identity transition. Keep the live handles
    // that must release demand, blank, and re-enter under a successor bearer.
    this.__externalBearerHandles = new Set();
    // Handles a bearer transition paused that have NOT yet fresh-subscribed
    // under a successor (denied successor, transport loss mid-transition, or
    // a null-token logout). Parked handles are transition-owned: the next
    // transition re-enters them. App-paused handles are never parked, so app
    // pause intent survives custody transitions. (0137 A1-Expo f4: the
    // pre-fix resume set was "not paused when this transition started",
    // which permanently excluded a handle a previous transition left paused.)
    this.__externalBearerParkedHandles = new WeakSet();
    this.__externalBearerTransition = null;
    this.__externalBearerPredecessorFence = null;
    // A finite terminal response closes one exact explicit-bearer generation.
    // Keep the presented bearer installed for an explicit caller-controlled
    // replacement, but refuse every later auth admission until a genuinely
    // different bearer (or null) crosses replaceBearerToken's custody barrier.
    this.__externalBearerTerminalError = null;
    this.__authorityPublicationCapture = null;
    this.__authorityPublicationDepth = 0;
    this.__terminalAuthorityCapture = undefined;
    this.__terminalAuthorityHandle = null;
    this.__terminalTransportCut = null;
    // Terminal-auth projection state (0137 A6 f3): the recorded fact behind
    // authTerminalStatus()/subscribeAuthTerminal(). Recorded at the single
    // terminal choke point (handleTerminalAuthLoss) and the counter-failure
    // cut; cleared only by the explicit custody-replacement barriers.
    this.__authTerminalFact = null;
    this.__authTerminalListeners = new Set();
    this.__authorityTransitionListeners = new Set();
    this.__authModePendingRetryDepth = 0;
    this.__ephemeralAuthorityPendingRetryDepth = 0;
    this.__authTransportParticipant = {
      name: 'snapback-kit-transport',
      quiesce: (context = {}) => {
        if (this.#terminalTransportPhaseAlreadyCut('quiesce', context)) return;
        let firstError = null;
        try {
          this.__authTransportGeneration = safeNextCounter(
            this.__authTransportGeneration,
            'SNAPBACK_CLIENT_AUTH_TRANSPORT_GENERATION_EXHAUSTED',
            'auth transport generation',
            this.__authCounterCeiling,
          );
        } catch (error) {
          firstError = this.#recordAuthCounterFailure(error);
        }
        for (const controller of this.__authControllers) {
          try { controller.abort(staleAuthorityError()); } catch (error) { firstError ??= error; }
        }
        for (const stream of this.__rawLiveStreams) {
          try { stream.close(); } catch (error) { firstError ??= error; }
        }
        for (const manager of this.__liveStreamManagers?.values?.() ?? []) {
          try {
            if (context.terminalError) {
              manager.close(context.terminalError, {
                error: context.terminalError,
                terminal: true,
                code: context.terminalError?.diagnostic?.code
                  ?? context.terminalError?.code
                  ?? 'SNAPBACK_AUTH_STREAM_RESET',
              });
            } else {
              manager.close();
            }
          } catch (error) { firstError ??= error; }
        }
        if (firstError) throw firstError;
      },
      // @ref LLP 0059#exposure-invariant — the transport owns direct kit
      // materializations that are not represented by a Contract participant.
      // They blank synchronously in the same barrier as every other surface.
      blank: (context = {}) => {
        if (this.#terminalTransportPhaseAlreadyCut('blank', context)) return;
        this.#blankAuthMaterializations(context.previousCapture ?? null, context);
      },
      clearMemory: (context = {}) => {
        if (this.#terminalTransportPhaseAlreadyCut('clearMemory', context)) return;
        let firstError = null;
        try { this.clearAuthSession(); } catch (error) { firstError = error; }
        this.__connectionGrants.clear();
        this.__laneConsumers.clear();
        this.__receiptRing.length = 0;
        this.__liveStreamManagers?.clear?.();
        if (firstError) throw firstError;
      },
      commitDurable: async (context = {}) => {
        // @ref LLP 0166#d1--one-store-domain — every LLP 0039 session
        // authority transition clears resident/read sections and the selected
        // storeMeta projection atomically, preserving monotone owner state and
        // rotating the handle key. The outbox is now deliberately preserved:
        // LLP 0043's per-record descriptor matrix strands or privacy-deletes it
        // before successor observation. Agent authority transitions remain LLP
        // 0055 grant-scoped and must not enter this store-wide path.
        //
        if (!this.rqsStore || !this.authCoordinator) return;
        const queueStore = this.#custodyReconciliationStore();
        const transitionKey = outboxTransitionAuthorityKey(context);
        let transitionAuthorityGeneration = null;
        const commit = async () => {
          const wipeWithinDispatch = typeof this.rqsStore
            .wipeForAuthorityTransitionWithinDispatch === 'function'
            ? this.rqsStore.wipeForAuthorityTransitionWithinDispatch
            : this.rqsStore.wipeForAuthorityTransition;
          const committed = typeof wipeWithinDispatch === 'function'
            ? await wipeWithinDispatch.call(
                this.rqsStore,
                transitionKey,
                context.nextEpoch,
              )
            : await this.rqsStore.wipe();
          if (committed !== true || !queueStore) return committed;
          const status = await queueStore.outboxAuthorizationStatus();
          if (
            !Number.isSafeInteger(status?.authorityGeneration)
            || status.authorityGeneration < 0
          ) {
            const error = new Error(
              'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_INVALID: transition did not expose its queue generation',
            );
            error.code = 'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_INVALID';
            throw error;
          }
          transitionAuthorityGeneration = status.authorityGeneration;
          return true;
        };
        const committed = typeof this.rqsStore.withOutboxAuthorizationDispatch === 'function'
          ? await this.rqsStore.withOutboxAuthorizationDispatch(commit)
          : await commit();
        if (committed !== true) {
          const error = new Error(
            'SNAPBACK_AUTH_TRANSITION_STORE_DEFERRED: predecessor queue custody awaits the shared writer',
          );
          error.code = 'SNAPBACK_AUTH_TRANSITION_STORE_DEFERRED';
          throw error;
        }
        if (queueStore) {
          this.__outboxTransitionAuthorityGenerations.set(
            transitionKey,
            transitionAuthorityGeneration,
          );
        }
      },
      resume: async (context) => {
        if (!this.authCoordinator) {
          // Agent custody has no refresh/session bearer to stage during its
          // local durable barrier. The next #agentAuthSession performs the
          // scoped-token handshake after synchronize has reopened custody.
          this.__terminalAuthorityCapture = undefined;
          this.__terminalAuthorityHandle = null;
          this.__terminalTransportCut = null;
          this.#clearAuthTerminalFact();
          return;
        }
        const transitionKey = outboxTransitionAuthorityKey(context);
        const queueStore = this.#custodyReconciliationStore();
        const transitionAuthorityGeneration = this.__outboxTransitionAuthorityGenerations.get(
          transitionKey,
        );
        if (
          queueStore
          && (
            !Number.isSafeInteger(transitionAuthorityGeneration)
            || transitionAuthorityGeneration < 0
          )
        ) {
          const error = new Error(
            'SNAPBACK_AUTH_TRANSITION_QUEUE_GENERATION_MISSING: successor reconciliation has no durable transition generation',
          );
          error.code = 'SNAPBACK_AUTH_TRANSITION_QUEUE_GENERATION_MISSING';
          throw error;
        }
        try {
          await this.#resumeAuthTransport(
            context.capture,
            context.stagePublication,
            transitionAuthorityGeneration,
          );
        } finally {
          this.__outboxTransitionAuthorityGenerations.delete(transitionKey);
        }
      },
    };
    this.__authParticipantUnregister = authCoordinator?.registerParticipant?.(
      this.__authTransportParticipant,
    ) ?? null;
    if (!authCoordinator && agentAuthority) {
      try {
        this.__authParticipantUnregister = agentAuthority.registerParticipant(
          this.__authTransportParticipant,
        );
      } catch (error) {
        // Durable agent custody intentionally starts closed until its first
        // ownership reload. There is no private transport state to blank yet;
        // #request/#agentAuthSession register immediately after synchronize.
        if (error?.code !== 'SNAPBACK_CLIENT_AUTHORITY_STALE') throw error;
      }
    }
    // A Channel-A inline payload is the concrete routes-manifest revision in
    // force for this boot. Start its ordinary ledger commit as boot work;
    // live-query startup joins this promise and surfaces any cap/refusal.
    if (this.__inlinePreloadBootPayload !== null) {
      this.__preloadRegistrationPromise = Promise.resolve()
        .then(() => this.__replacePreloadRouteBoot(this.__inlinePreloadBootPayload))
        .catch((error) => ({
          refused: {
            code: error?.diagnostic?.code
              ?? error?.code
              ?? SNAPBACK_STORE_RUNTIME_LOAD_FAILED,
          },
        }));
    }
    // LLP 0238 D6 deliberately changes vocabulary only: every method below
    // remains a bound projection of the existing flat implementation.
    this.auth = Object.freeze({
      currentPrincipal: () => this.__currentPrincipalSnapshot,
      subscribeCurrentPrincipal: (listener) => this.#subscribeCurrentPrincipal(listener),
      authSession: (...args) => this.authSession(...args),
      authRequestCode: (...args) => this.authRequestCode(...args),
      authStepUpRequest: (...args) => this.authStepUpRequest(...args),
      authExchange: (...args) => this.authExchange(...args),
      authEnterAsGuest: (...args) => this.authEnterAsGuest(...args),
      authClaimGuestWithPassword: (...args) => this.authClaimGuestWithPassword(...args),
      authPasswordSignup: (...args) => this.authPasswordSignup(...args),
      authPasswordSignIn: (...args) => this.authPasswordSignIn(...args),
      authPasswordChange: (...args) => this.authPasswordChange(...args),
      authPasswordSet: (...args) => this.authPasswordSet(...args),
      authPasswordReset: (...args) => this.authPasswordReset(...args),
      authRecoveryConsume: (...args) => this.authRecoveryConsume(...args),
      authRecoveryRotate: (...args) => this.authRecoveryRotate(...args),
      authRefresh: (...args) => this.authRefresh(...args),
      authLogout: (...args) => this.authLogout(...args),
      authTerminalStatus: (...args) => this.authTerminalStatus(...args),
      subscribeAuthTerminal: (...args) => this.subscribeAuthTerminal(...args),
      authorityTransitionStatus: (...args) => this.authorityTransitionStatus(...args),
      subscribeAuthorityTransition: (...args) => this.subscribeAuthorityTransition(...args),
    });
    // @ref LLP 0270#d4-queue-and-settle-offline-intent-by-default — client
    // readiness is the completed construction/bootstrap-binding cut. Starting
    // in its following microtask lets every constructor fence and inline boot
    // task exist before restored work is scanned; close generation-fences the
    // task before it can acquire lifecycle ownership.
    this.__outboxDrainReadinessTask = Promise.resolve(this.__preloadRegistrationPromise)
      .then(() => this.#startDefaultOutboxDrainAtReadiness());
  }

  async #startDefaultOutboxDrainAtReadiness() {
    if (this.__clientClosed) return null;
    let store = null;
    try { store = this.#offlineQueueStore(); } catch { store = null; }
    if (store === null) return null;
    await this.#recordRestoredMutationPhaseCosts(store);
    if (this.__clientClosed || !this.__outboxDrainLifecycle) return null;
    try {
      this.__outboxDrainHandle = this.startOutboxDrain({
        automatic: this.outboxDrainPolicy === 'auto',
      });
      this.__outboxDrainStartBlockedReason = null;
      return this.__outboxDrainHandle;
    } catch (error) {
      const code = error?.diagnostic?.code ?? error?.code ?? 'unavailable';
      this.__outboxDrainStartBlockedReason = `drain-start-refused:${code}`;
      this.#notifyOutboxListeners();
      return null;
    }
  }

  #subscribeCurrentPrincipal(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribeCurrentPrincipal requires a listener function');
    }
    const entry = { listener, active: true, lastDeliveredKey: null };
    this.__currentPrincipalListeners.add(entry);
    this.#queueCurrentPrincipalNotification(entry, this.__currentPrincipalSnapshotKey);
    return () => {
      if (!entry.active) return;
      entry.active = false;
      this.__currentPrincipalListeners.delete(entry);
    };
  }

  #queueCurrentPrincipalNotification(entry, semanticKey) {
    // @ref LLP 0238#d3-one-observable-handle-grammar — the subscribe-time
    // current snapshot and every later distinct projection share one deferred,
    // non-reentrant notification queue.
    queueMicrotask(() => {
      if (
        this.__currentPrincipalNotificationsClosed
        || !entry.active
        || entry.lastDeliveredKey === semanticKey
      ) return;
      entry.lastDeliveredKey = semanticKey;
      try { entry.listener(); } catch { /* current-principal observation cannot own auth */ }
    });
  }

  #notifyCurrentPrincipal() {
    const semanticKey = this.__currentPrincipalSnapshotKey;
    for (const entry of [...this.__currentPrincipalListeners]) {
      this.#queueCurrentPrincipalNotification(entry, semanticKey);
    }
  }

  #commitCurrentPrincipalSnapshot(snapshot) {
    const semanticKey = currentPrincipalSemanticKey(snapshot);
    if (this.__currentPrincipalSnapshotKey === semanticKey) return;
    this.__currentPrincipalSnapshot = snapshot;
    this.__currentPrincipalSnapshotKey = semanticKey;
    this.#notifyCurrentPrincipal();
  }

  #publishCurrentPrincipal(snapshot) {
    this.__currentPrincipalPending = snapshot;
    if (this.__currentPrincipalPublicationHold > 0) return;
    this.#commitCurrentPrincipalSnapshot(snapshot);
  }

  #publishCredentialPrincipal(credential, session = this.__authSessionLastSuccessful) {
    if (!credential?.session) return;
    if (session) {
      this.#publishCurrentPrincipal(currentPrincipalFromSession(session, credential));
      return;
    }
    const authority = this.authCoordinator?.authority ?? null;
    if (
      authority?.kind !== 'session'
      || authority.userId !== credential.session.userId
      || authority.sessionId !== credential.session.id
    ) {
      this.#publishCurrentPrincipal(currentPrincipalBlocked(Object.assign(
        new Error('settled credential adoption lacks a current session witness'),
        {
          code: 'SNAPBACK_AUTH_HANDSHAKE_INVALID',
          diagnostic: {
            code: 'SNAPBACK_AUTH_HANDSHAKE_INVALID',
            message: 'Settled credential adoption lacks a current session witness.',
            details: { phase: 'credential-publication', causeCode: 'SNAPBACK_AUTH_HANDSHAKE_INVALID' },
          },
        },
      )));
      return;
    }
    this.#publishCurrentPrincipal(Object.freeze({
      status: 'authenticated',
      userId: credential.session.userId,
      sessionId: credential.session.id,
      sessionClass: 'humanSession',
      provider: credential.session.provider,
      authorityInstanceId: credential.authorityDescriptor.authorityInstanceId,
      sessionGeneration: credential.authorityDescriptor.sessionGeneration,
      authorizationStreamIncarnation: authority.authorizationStreamIncarnation,
      expiresAt: credential.session.expiresAt,
      absoluteExpiresAt: credential.session.absoluteExpiresAt,
    }));
  }

  #settleCurrentPrincipalAfterAuthFailure(error) {
    const session = this.__authSessionLastSuccessful;
    const authority = this.authCoordinator?.authority ?? null;
    if (
      session
      && authority
      && sameClientAuthority(clientAuthorityFromHandshake(session), authority)
    ) {
      this.#publishCurrentPrincipal(currentPrincipalFromSession(session));
      return;
    }
    if (
      this.__currentPrincipalSnapshot.status !== 'loading'
      && this.__currentPrincipalSnapshot.status !== 'refreshing'
    ) return;
    this.#publishCurrentPrincipal(currentPrincipalBlocked(error));
  }

  async #transitionCredentialAuthority(capture, successor) {
    try {
      return await this.authCoordinator.transition(capture, successor, 'login');
    } catch (error) {
      this.#settleCurrentPrincipalAfterAuthFailure(error);
      throw error;
    }
  }

  // Owner-only composition seam used by createSnapbackAppClient. It gates the
  // D5 initiating context's projection; it never pauses coordinator
  // participants or changes custody.
  __withholdCurrentPrincipalPublication() {
    this.__currentPrincipalPublicationHold += 1;
    if (this.__currentPrincipalPublicationHold === 1) {
      this.__currentPrincipalPending = this.__currentPrincipalSnapshot;
      const withheld = this.__currentPrincipalSnapshot.status === 'authenticated'
        ? Object.freeze({
            status: 'refreshing',
            principal: this.__currentPrincipalSnapshot,
          })
        : LOADING_CURRENT_PRINCIPAL;
      this.#commitCurrentPrincipalSnapshot(withheld);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.__currentPrincipalPublicationHold -= 1;
      if (this.__currentPrincipalPublicationHold === 0) {
        const pending = this.__currentPrincipalPending;
        this.#commitCurrentPrincipalSnapshot(pending);
      }
    };
  }

  #ensureAgentTransportParticipant() {
    if (this.__authParticipantUnregister || !this.agentAuthority) return;
    this.__authParticipantUnregister = this.agentAuthority.registerParticipant(
      this.__authTransportParticipant,
    );
  }

  #recordAuthCounterFailure(error) {
    if (this.__authCounterError === null) {
      let capture = null;
      try { capture = this.authorityFence?.capture?.() ?? null; } catch { /* already clearing */ }
      this.__authCounterError = error;
      if (capture !== null) this.__terminalAuthorityCapture = capture;
      this.#recordAuthTerminalFact(error, 'carrier');
      this.#performAuthCounterTerminalCut(error, capture);
    }
    return this.__authCounterError;
  }

  #performAuthCounterTerminalCut(error, capture) {
    if (this.__authCounterCut) return;
    this.__authCounterCut = true;
    const context = Object.freeze({
      previousCapture: capture,
      terminalError: error,
      reason: 'auth_counter_exhausted',
      disposition: 'delete',
      terminal: true,
    });
    for (const controller of this.__authControllers) {
      try { controller.abort(error); } catch { /* remain closed */ }
    }
    for (const stream of this.__rawLiveStreams) {
      try { stream.close(); } catch { /* remain closed */ }
    }
    for (const manager of this.__liveStreamManagers?.values?.() ?? []) {
      try {
        manager.close(error, {
          error,
          terminal: true,
          code: error?.diagnostic?.code ?? error?.code,
        });
      } catch { /* remain closed */ }
    }

    const quiescence = [];
    for (const entry of this.__authBarrierParticipants) {
      if (entry.removed) continue;
      try {
        quiescence.push(Promise.resolve(entry.participant.quiesce?.(context)));
      } catch (caught) {
        quiescence.push(Promise.reject(caught));
      }
    }
    const blankParticipants = () => {
      for (const entry of this.__authBarrierParticipants) {
        if (entry.removed) continue;
        for (const method of ['blank', 'clearMemory']) {
          try {
            const value = entry.participant[method]?.(context);
            if (value && typeof value.then === 'function') void value.catch(() => {});
          } catch { /* one participant cannot retain the others */ }
        }
      }
    };
    blankParticipants();
    if (this.__terminalTransportCut?.phases?.blank !== true) {
      try { this.#blankAuthMaterializations(null, context); } catch { /* every entry was attempted */ }
    }

    // Clear cache and transport memory directly. Calling clearAuthSession()
    // here would recursively consume the exhausted comparison identity.
    this.__authSessionLastSuccessful = null;
    this.__authSessionInFlight = null;
    this.__authSessionCapture = null;
    this.__connectionGrants.clear();
    this.__laneConsumers.clear();
    this.__receiptRing.length = 0;
    this.__liveStreamManagers?.clear?.();
    void Promise.allSettled(quiescence).then(() => {
      blankParticipants();
    });
  }

  #assertAuthCountersAvailable() {
    if (this.__authCounterError) throw this.__authCounterError;
  }

  #assertNotInAuthorityPublication(message) {
    if (this.__authorityPublicationDepth > 0) {
      throw authorityCommitReentrantError(message);
    }
  }

  #terminalTransportPhaseAlreadyCut(phase, context) {
    if (
      this.__authCounterCut
      && (phase === 'blank' || phase === 'clearMemory')
    ) return true;
    const cut = this.__terminalTransportCut;
    if (!cut?.phases?.[phase] || !cut.capture) return false;
    if (context?.previousCapture) {
      return sameAuthorityCapture(cut.capture, context.previousCapture);
    }
    return (
      context?.expectedEpoch === cut.capture.authorityEpoch
      && context?.expectedAuthorityKey === cut.capture.authorityKey
    );
  }

  /// Resolve the current server/mode/authority projection. A successful value
  /// is process- and generation-scoped by the returned nonce/generation; the
  /// cache is cleared on every authority change and terminal mode/credential
  /// diagnostic. Connection and subscribe boundaries request a fresh value.
  // @ref LLP 0058#kit-ordering — no online boundary relies on capability-manifest mode guesses.
  authSession(options = {}) {
    return this.#authSession(options).catch((error) => {
      const code = error?.diagnostic?.code ?? error?.code ?? '';
      const custodyPrefix = ['SNAPBACK', 'AUTH', 'CUSTODY'].join('_') + '_';
      const clientAuthPrefix = ['SNAPBACK', 'CLIENT', 'AUTH'].join('_') + '_';
      if (
        code.startsWith(custodyPrefix)
        || code.startsWith(clientAuthPrefix)
        || code === 'SNAPBACK_AUTH_HANDSHAKE_INVALID'
        || code === 'SNAPBACK_AUTH_HANDSHAKE_AUTHORITY_MISMATCH'
        || code === 'SNAPBACK_AUTH_TRANSITION_FAILED'
      ) {
        this.#settleCurrentPrincipalAfterAuthFailure(error);
      }
      throw error;
    });
  }

  #authSession(
    { force = false } = {},
    externalBearerTransitionPermit = null,
  ) {
    this.#assertAuthCountersAvailable();
    const externalBearerTransition = this.__externalBearerTransition;
    if (
      externalBearerTransition
      && externalBearerTransitionPermit !== EXTERNAL_BEARER_TRANSITION_PERMIT
    ) {
      return externalBearerTransition.then(() => this.#authSession({ force }));
    }
    if (this.__externalBearerTerminalError) {
      return Promise.reject(this.__externalBearerTerminalError);
    }
    if (this.authProtocols.authClient == null) return Promise.resolve(null);
    if (!force && this.__authSessionLastSuccessful) {
      if (!this.authorityFence) return Promise.resolve(this.__authSessionLastSuccessful);
      try {
        const capture = this.authorityFence.capture();
        if (
          this.__authSessionCapture?.authorityEpoch === capture.authorityEpoch
          && this.__authSessionCapture?.authorityKey === capture.authorityKey
        ) {
          return this.commitAuthorityPublication(capture, () => (
            this.__authSessionLastSuccessful
          )).then((committed) => {
            if (!committed.committed) throw staleAuthorityError();
            return committed.value;
          });
        }
      } catch {
        // A blank/clearing coordinator must synchronize before cache use.
      }
    }
    if (this.__authSessionInFlight) return this.__authSessionInFlight;
    const cacheGeneration = this.__authSessionCacheGeneration;
    const operation = this.authCoordinator
      ? this.#coordinatedAuthSession({ cacheGeneration })
      : this.agentAuthority
        ? this.#agentAuthSession({ cacheGeneration })
        : this.#uncoordinatedAuthSession({ cacheGeneration });
    let pending;
    pending = Promise.resolve(operation).finally(() => {
      if (this.__authSessionInFlight === pending) this.__authSessionInFlight = null;
    });
    this.__authSessionInFlight = pending;
    return pending;
  }

  async #uncoordinatedAuthSession({ cacheGeneration }) {
    const bearerAtStart = this.bearerToken;
    const transportGenerationAtStart = this.__authTransportGeneration;
    try {
      const offer = this.#authSessionOffer();
      const session = await this.#fetchJson(
        'GET',
        '/auth/session',
        undefined,
        this.#authOfferHeaders(true, undefined, offer),
      );
      const projected = this.#validateAuthSession(session, this.bearerToken, offer);
      if (
        this.__authCounterError === null
        && this.__authSessionCacheGeneration === cacheGeneration
      ) {
        this.#cacheAuthSession(projected, null, cacheGeneration);
      }
      return projected;
    } catch (error) {
      const code = error?.diagnostic?.code ?? error?.code;
      if (
        isTerminalAuthorityError(error)
        && this.authProtocols.authClient === 1
        && typeof bearerAtStart === 'string'
        && bearerAtStart.length > 0
        && this.bearerToken === bearerAtStart
        && this.__authTransportGeneration === transportGenerationAtStart
      ) {
        const terminal = this.handleTerminalAuthLoss(null, error);
        if (terminal && typeof terminal === 'object') await terminal.settlement;
      }
      if (
        this.__authSessionCacheGeneration === cacheGeneration
        && !isUnavailableAuthTransport(error)
      ) {
        this.__authSessionLastSuccessful = null;
        this.__authSessionCapture = null;
      }
      throw error;
    }
  }

  async #agentAuthSession({ cacheGeneration }) {
    this.#ensureAgentTransportParticipant();
    const credential = this.agentAuthority.credentialOfferForHandshake();
    let offeredCapture = null;
    try {
      const candidate = this.agentAuthority.capture();
      const current = this.agentAuthority.credentialFor(candidate);
      if (
        current.tokenId === credential.tokenId
        && current.bearer === credential.bearer
      ) offeredCapture = candidate;
    } catch {
      // A fresh or recovery fence deliberately stays publication-closed while
      // this exact carrier is validated against /auth/session.
    }
    try {
      const offer = this.#authSessionOffer();
      const session = await this.#trackedFetchJson(
        'GET',
        '/auth/session',
        undefined,
        this.#authOfferHeaders(true, credential.bearer, offer),
      );
      const projected = this.#validateAuthSession(session, credential.bearer, offer);
      if (
        projected.activeMode !== 'sessions'
        || projected.authority.kind !== 'servicePrincipal'
      ) {
        throw clientCodedError(new Error(
          'SNAPBACK_AUTH_HANDSHAKE_INVALID: agent custody requires a service-principal authority response',
        ), 'SNAPBACK_AUTH_HANDSHAKE_INVALID');
      }
      // A different configured tuple may delete predecessor durable work.
      // Admit that transition only after the server proves this carrier's
      // exact service descriptor; plain synchronize remains non-destructive.
      await this.agentAuthority.synchronizeValidated(projected.authorityDescriptor);
      const capture = this.agentAuthority.capture();
      this.agentAuthority.bindHandshake(capture, projected.authorityDescriptor);
      const committed = await this.commitAuthorityPublication(capture, () => (
        this.#cacheAuthSession(projected, capture, cacheGeneration)
      ));
      if (!committed.committed) throw staleAuthorityError();
      return committed.value;
    } catch (error) {
      const code = error?.diagnostic?.code ?? error?.code;
      if (isTerminalAuthorityError(error)) {
        const terminal = offeredCapture
          ? this.handleTerminalAuthLoss(offeredCapture, error)
          : this.agentAuthority.terminateValidatedCredential(credential, {
              authorityDisposition: error?.authorityDisposition === 'durableDelete'
                ? 'durableDelete'
                : 'carrier',
              terminalError: error,
            });
        if (terminal && typeof terminal === 'object') await terminal.settlement;
      }
      if (
        this.__authSessionCacheGeneration === cacheGeneration
        && !isUnavailableAuthTransport(error)
      ) this.clearAuthSession();
      throw error;
    }
  }

  setBearerToken(token) {
    this.#assertNotInAuthorityPublication(
      'bearer mutation is forbidden inside an authority publication callback',
    );
    if (this.authCoordinator || this.agentAuthority) {
      throw new TypeError('setBearerToken cannot bypass browser or agent custody');
    }
    if (token === this.bearerToken) return;
    throw new TypeError(
      'setBearerToken cannot synchronously replace custody; use await replaceBearerToken(token)',
    );
  }

  __externalBearerRetainedReadsFenced() {
    return this.__externalBearerPredecessorFence !== null
      && this.__externalBearerPredecessorFence !== undefined;
  }

  async #wipeExternalBearerPredecessorStore() {
    const store = this.rqsStore;
    if (!store) return;
    let predecessorMarker = null;
    if (typeof store.readStoreMeta === 'function') {
      try {
        const meta = await store.readStoreMeta();
        if (
          typeof meta?.clientStoreId === 'string'
          && /^[0-9a-f]{64}$/u.test(meta?.handleKey ?? '')
        ) {
          predecessorMarker = Object.freeze({
            clientStoreId: meta.clientStoreId,
            handleKey: meta.handleKey,
          });
        }
      } catch {
        // A successful writer wipe below remains authoritative. If it refuses,
        // unreadable metadata cannot supply the local predecessor fence.
      }
    }

    const wipe = typeof store.wipeForAuthorityTransition === 'function'
      ? store.wipeForAuthorityTransition
      : store.wipe;
    if (typeof wipe !== 'function') {
      throw new Error('configured RQS store has no authority-transition wipe');
    }
    const transitionArgs = [null, null, { rebaseUnscopedPending: true }];
    if ((await wipe.call(store, ...transitionArgs)) === true) {
      this.__externalBearerPredecessorFence = null;
      return;
    }

    // @ref LLP 0053#client-fences — a non-writer transition first installs
    // an exact local predecessor marker, then queues phase-7 deletion on the
    // actual shared-store writer. No retained selector may run while the
    // marker remains current.
    if (predecessorMarker === null) {
      throw new Error(
        'RQS store refused the authority-transition wipe and cannot install a predecessor fence',
      );
    }
    this.__externalBearerPredecessorFence = predecessorMarker;

    const wake = typeof store.requestAuthorityTransitionWipe === 'function'
      ? store.requestAuthorityTransitionWipe(...transitionArgs)
      : null;
    if (!wake || typeof wake.settlement?.then !== 'function') {
      throw new Error(
        'RQS store refused the authority-transition wipe and cannot wake its writer owner',
      );
    }
    if ((await wake.settlement) !== true) {
      throw new Error('the shared-store writer refused the authority-transition wipe');
    }
    const successorMeta = await store.readStoreMeta();
    if (
      typeof successorMeta?.clientStoreId !== 'string'
      || !/^[0-9a-f]{64}$/u.test(successorMeta?.handleKey ?? '')
      || successorMeta.handleKey === predecessorMarker.handleKey
    ) {
      throw new Error('the shared-store writer completed without rotating the predecessor fence');
    }
    if (this.__externalBearerPredecessorFence === predecessorMarker) {
      this.__externalBearerPredecessorFence = null;
    }
  }

  // @ref LLP 0059#exposure-invariant — external bearer replacement is a
  // custody barrier: release predecessor demand, blank synchronously, retire
  // old transports/grants, then re-enter under the successor.
  async replaceBearerToken(token) {
    this.#assertNotInAuthorityPublication(
      'bearer replacement is forbidden inside an authority publication callback',
    );
    if (this.authCoordinator || this.agentAuthority) {
      throw new TypeError('replaceBearerToken cannot bypass browser or agent custody');
    }
    if (token !== null && (typeof token !== 'string' || token.length === 0)) {
      throw new TypeError('replaceBearerToken requires a non-empty bearer or null');
    }
    if (token === this.bearerToken) return;
    if (this.__externalBearerTransition) {
      throw new TypeError('replaceBearerToken cannot overlap another bearer transition');
    }
    let settleTransition;
    let failTransition;
    const transition = new Promise((resolve, reject) => {
      settleTransition = resolve;
      failTransition = reject;
    });
    // Install the completion before invoking pause/blank callbacks. Those
    // callbacks are app-observable and may re-enter this client synchronously;
    // a transition that is not already visible there is not a closed barrier.
    this.__externalBearerTransition = transition;
    void (async () => {
      const parked = this.__externalBearerParkedHandles;
      const handles = [...this.__externalBearerHandles].map((handle) => ({
        handle,
        // A parked handle is paused because a PREVIOUS transition parked it
        // (denied successor / logout), not because the app paused it — it
        // re-enters with this transition (0137 A1-Expo f4).
        wasPaused: handle.paused === true && !parked.has(handle),
      }));
      const handlesPausedByTransition = handles.filter((entry) => !entry.wasPaused);
      const failures = [];
      // pause() quiesces locally and starts T-UNSUB synchronously. Blank in
      // this same turn; network release settlement is not a confidentiality
      // gate and may take arbitrarily long. Every handle this transition
      // owns is parked BEFORE any async work, so an interrupted transition
      // still leaves them re-enterable by the next one.
      const releasePromises = handlesPausedByTransition.map(({ handle }) => {
        parked.add(handle);
        try {
          return Promise.resolve(handle.pause(EXTERNAL_BEARER_TRANSITION_PERMIT));
        } catch (error) {
          return Promise.reject(error);
        }
      });
      const context = Object.freeze({
        reason: token === null ? 'external_bearer_cleared' : 'external_bearer_replaced',
        disposition: 'delete',
      });
      try {
        this.#blankAuthMaterializations(null, context);
      } catch (error) {
        failures.push(error);
      }
      // Cut predecessor requests/streams immediately after local pause+blank.
      // Waiting for a remote unsubscribe first would let an old finite result
      // publish after the visible delete boundary.
      try {
        this.__authTransportParticipant.quiesce(context);
      } catch (error) {
        failures.push(error);
      }
      const releases = await Promise.allSettled(releasePromises);
      for (const outcome of releases) {
        if (outcome.status === 'rejected') failures.push(outcome.reason);
      }
      // Preserve lane-consumer registrations owned by the paused handles;
      // resume reuses them. Everything that can carry or publish predecessor
      // authority is nevertheless closed or forgotten here.
      try {
        this.clearAuthSession();
      } catch (error) {
        failures.push(error);
      }
      this.__connectionGrants.clear();
      this.__receiptRing.length = 0;
      this.__liveStreamManagers?.clear?.();
      // External-bearer custody has no AuthCoordinator participant to perform
      // phase 7. Run the same durable predecessor deletion before installing
      // or resuming any successor bearer. A failed wipe keeps the predecessor
      // bearer installed and the visible surfaces blank/parked.
      // @ref LLP 0059#transition-barrier — durable participants delete before
      // successor settlement and exposure resume.
      try {
        await this.#wipeExternalBearerPredecessorStore();
      } catch (error) {
        failures.push(error);
        throw new AggregateError(
          failures,
          'external bearer custody transition could not delete predecessor durable facts',
        );
      }
      this.bearerToken = token;
      this.__externalBearerTerminalError = null;
      this.__terminalAuthorityCapture = undefined;
      this.__terminalAuthorityHandle = null;
      this.__terminalTransportCut = null;
      this.#clearAuthTerminalFact();

      if (token === null && this.authProtocols.authClient !== null) {
        try {
          await this.#authSession(
            { force: true },
            EXTERNAL_BEARER_TRANSITION_PERMIT,
          );
        } catch (error) {
          this.#settleCurrentPrincipalAfterAuthFailure(error);
          failures.push(error);
        }
      }

      if (token !== null) {
        const resumeEntries = handlesPausedByTransition
          .filter(({ handle }) => this.__externalBearerHandles.has(handle));
        const resumes = await Promise.allSettled(
          resumeEntries.map(({ handle }) => handle.resume(EXTERNAL_BEARER_TRANSITION_PERMIT)),
        );
        resumes.forEach((outcome, index) => {
          const { handle } = resumeEntries[index];
          if (outcome.status === 'fulfilled') {
            parked.delete(handle);
            return;
          }
          // A server-ANSWERED authorization denial is the successor's
          // completed outcome, recorded on the handle as a renderable
          // lifecycle fact by resume() itself (0137 A1-Expo f4). The handle
          // stays parked so a later authority transition re-enters it; the
          // transition still settles. Anything else — transport loss, broken
          // callbacks — remains a loud lifecycle failure below.
          if (isSubscribeAuthorizationDenial(outcome.reason)) return;
          failures.push(outcome.reason);
        });
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          'external bearer custody transition completed with lifecycle failures',
        );
      }
    })().then(settleTransition, failTransition);
    try {
      await transition;
    } finally {
      if (this.__externalBearerTransition === transition) {
        this.__externalBearerTransition = null;
      }
    }
  }

  __registerExternalBearerHandle(handle) {
    if (this.authCoordinator || this.agentAuthority || this.authProtocols.authClient !== 1) {
      return () => {};
    }
    if (this.__externalBearerTransition) {
      throw new TypeError(
        'external bearer live-query admission is closed during a custody transition',
      );
    }
    this.__externalBearerHandles.add(handle);
    return () => this.__externalBearerHandles.delete(handle);
  }

  async replaceAgentCredential(credential) {
    if (!this.agentAuthority) {
      throw new TypeError('replaceAgentCredential requires AgentAuthorityFence custody');
    }
    this.#ensureAgentTransportParticipant();
    this.#assertAuthCountersAvailable();
    const replacement = this.agentAuthority.credentialOfferForReplacement(credential);
    const offer = this.#authSessionOffer();
    const session = await this.#trackedFetchJson(
      'GET',
      '/auth/session',
      undefined,
      this.#authOfferHeaders(true, replacement.bearer, offer),
    );
    const projected = this.#validateAuthSession(session, replacement.bearer, offer);
    if (
      projected.activeMode !== 'sessions'
      || projected.authority.kind !== 'servicePrincipal'
    ) {
      throw clientCodedError(new Error(
        'SNAPBACK_AUTH_HANDSHAKE_INVALID: agent credential replacement requires a service-principal authority response',
      ), 'SNAPBACK_AUTH_HANDSHAKE_INVALID');
    }
    // Only the server-proven descriptor can authorize the destructive local
    // barrier. An invalid proposed bearer leaves predecessor custody and every
    // predecessor surface untouched.
    const capture = await this.agentAuthority.replaceCredentialValidated(
      replacement.previousCapture,
      credential,
      projected.authorityDescriptor,
    );
    this.agentAuthority.bindHandshake(capture, projected.authorityDescriptor);
    const cacheGeneration = this.__authSessionCacheGeneration;
    const committed = await this.commitAuthorityPublication(capture, () => (
      this.#cacheAuthSession(projected, capture, cacheGeneration)
    ));
    if (!committed.committed) throw staleAuthorityError();
    this.__terminalAuthorityCapture = undefined;
    this.__terminalAuthorityHandle = null;
    this.__terminalTransportCut = null;
    this.#clearAuthTerminalFact();
    return capture;
  }

  clearAuthSession() {
    this.#assertNotInAuthorityPublication(
      'auth-session clearing is forbidden inside an authority publication callback',
    );
    // Clear first: if the generation cannot advance, no predecessor cache may
    // remain reachable under the last reusable comparison id.
    this.__authSessionLastSuccessful = null;
    this.__authSessionInFlight = null;
    this.__authSessionCapture = null;
    this.#publishCurrentPrincipal(LOADING_CURRENT_PRINCIPAL);
    if (this.__authCounterError) throw this.__authCounterError;
    try {
      this.__authSessionCacheGeneration = safeNextCounter(
        this.__authSessionCacheGeneration,
        'SNAPBACK_CLIENT_AUTH_SESSION_GENERATION_EXHAUSTED',
        'auth session cache generation',
        this.__authCounterCeiling,
      );
    } catch (error) {
      throw this.#recordAuthCounterFailure(error);
    }
  }

  captureAuthority() {
    this.#assertAuthCountersAvailable();
    return this.authorityFence?.capture?.() ?? null;
  }

  isAuthorityCaptureCurrent(capture) {
    this.#assertAuthCountersAvailable();
    if (!this.authorityFence) return capture === null;
    return capture !== null && this.authorityFence.isCurrent?.(capture) === true;
  }

  allocateLiveQueryNamespace(ref, args = {}) {
    const name = functionName(ref);
    return createLiveQueryNamespace({
      clientStoreId: this.clientStoreId,
      queryKey: retainedQueryKey(name, args),
      queryInstanceId: this.__liveQueryAllocator.allocate(),
    });
  }

  authorityCaptureFor(value) {
    return value?.[AUTHORITY_CAPTURE] ?? null;
  }

  registerAuthBarrierParticipant(participant) {
    if (!participant || typeof participant !== 'object') {
      throw new TypeError('auth barrier participant must be an object');
    }
    if (this.__authCounterError) {
      const context = Object.freeze({
        previousCapture: null,
        terminalError: this.__authCounterError,
        reason: 'auth_counter_exhausted',
        disposition: 'delete',
        terminal: true,
      });
      try { participant.quiesce?.(context); } catch { /* remain closed */ }
      try { participant.blank?.(context); } catch { /* remain closed */ }
      try { participant.clearMemory?.(context); } catch { /* remain closed */ }
      throw this.__authCounterError;
    }
    const entry = { participant, removed: false };
    this.__authBarrierParticipants.add(entry);
    let unregister;
    try {
      unregister = this.authCoordinator
        // Insert browser stores/surfaces before the transport. Reverse resume
        // brings the handshake up first; quiesce/blank keep declaration order.
        ? this.authCoordinator.registerParticipant(participant, {
            before: this.__authTransportParticipant,
          })
        : this.agentAuthority?.registerParticipant
          ? this.agentAuthority.registerParticipant(participant)
          : async () => {};
    } catch (error) {
      this.__authBarrierParticipants.delete(entry);
      throw error;
    }
    return async () => {
      entry.removed = true;
      try {
        await unregister();
      } finally {
        this.__authBarrierParticipants.delete(entry);
      }
    };
  }

  registerAuthMaterialization({ capture, blank }) {
    if (typeof capture !== 'function' || typeof blank !== 'function') {
      throw new TypeError('auth materialization requires capture and blank callbacks');
    }
    if (this.__authCounterError) {
      try { blank({ reason: 'auth_counter_exhausted', disposition: 'delete' }); } catch { /* remain closed */ }
      throw this.__authCounterError;
    }
    const entry = Object.freeze({ capture, blank });
    this.__authMaterializations.add(entry);
    return () => this.__authMaterializations.delete(entry);
  }

  #blankAuthMaterializations(expectedCapture = null, context = null) {
    let firstError = null;
    for (const entry of [...this.__authMaterializations]) {
      let captureMatches = true;
      if (expectedCapture !== null) {
        try {
          const materializationCapture = entry.capture();
          // A surface that is still awaiting its first authority-tagged
          // snapshot has no predecessor capture to compare yet. It is not
          // public authority-neutral state: blank/cancel it as unknown so a
          // late predecessor response cannot populate it after this cut.
          captureMatches = materializationCapture == null
            || sameAuthorityCapture(materializationCapture, expectedCapture);
        } catch (error) {
          // A broken capture callback cannot become a veto over terminal
          // confidentiality. This loop is synchronous, so no successor can
          // interleave; blank the unknown surface fail-closed and report the
          // capture failure only after every materialization was attempted.
          firstError ??= error;
          captureMatches = true;
        }
      }
      if (!captureMatches) continue;
      try {
        const result = entry.blank(context);
        if (result && typeof result.then === 'function') {
          throw new TypeError('auth materialization blank callback must be synchronous');
        }
      } catch (error) {
        // One broken surface must not prevent later private materializations
        // or the receipt ring from blanking. The barrier still receives the
        // first error after every synchronous delete has been attempted.
        firstError ??= error;
      }
    }
    // Receipts are app-visible authority-scoped history. Clear them in the
    // synchronous blank phase, before any durable custody transition resumes.
    this.__receiptRing.length = 0;
    if (firstError) throw firstError;
  }

  #isTerminalAuthorityCapture(capture) {
    if (this.__terminalAuthorityCapture === undefined) return false;
    return (
      (this.__terminalAuthorityCapture === null && capture === null)
      || sameAuthorityCapture(this.__terminalAuthorityCapture, capture)
    );
  }

  // @ref LLP 0059#cross-context-ownership — isCurrent() is only a process
  // hint. Every socket/drain publication re-reads durable custody and runs the
  // complete synchronous app-visible mutation under the storage ownership
  // fence. Nested receipt publication reuses the already-held fence instead
  // of attempting a prohibited reentrant coordinator call.
  async commitAuthorityPublication(capture, commit) {
    if (typeof commit !== 'function') {
      throw new TypeError('commitAuthorityPublication requires a commit callback');
    }
    this.#assertAuthCountersAvailable();
    if (!this.authorityFence) {
      this.__authorityPublicationDepth += 1;
      try {
        const value = commit();
        if (value && typeof value.then === 'function') {
          throw new TypeError('authority publication callback must be synchronous');
        }
        return { committed: true, value };
      } finally {
        this.__authorityPublicationDepth -= 1;
      }
    }
    if (!capture) return { committed: false };
    if (this.#isTerminalAuthorityCapture(capture)) return { committed: false };
    if (sameAuthorityCapture(this.__authorityPublicationCapture, capture)) {
      if (this.#isTerminalAuthorityCapture(capture)) return { committed: false };
      const value = commit();
      if (value && typeof value.then === 'function') {
        throw new TypeError('authority publication callback must be synchronous');
      }
      return { committed: true, value };
    }
    const result = await this.authorityFence.compareAndCommit(capture, () => {
      // Terminal loss is synchronous while durable comparisons may queue.
      // Re-check inside the custody lock so work queued before the terminal
      // cut cannot republish after its surfaces were blanked.
      if (this.__authCounterError || this.#isTerminalAuthorityCapture(capture)) {
        return TERMINAL_AUTHORITY_PUBLICATION;
      }
      const previous = this.__authorityPublicationCapture;
      this.__authorityPublicationCapture = capture;
      this.__authorityPublicationDepth += 1;
      try {
        const value = commit();
        if (value && typeof value.then === 'function') {
          throw new TypeError('authority publication callback must be synchronous');
        }
        return value;
      } finally {
        this.__authorityPublicationDepth -= 1;
        this.__authorityPublicationCapture = previous;
      }
    });
    if (result.committed && result.value === TERMINAL_AUTHORITY_PUBLICATION) {
      return { committed: false };
    }
    return result;
  }

  /// Commit the in-band successor nonce a sender-proof-gated socket's first
  /// server frame delivered, rotating custody exactly like an HTTP
  /// `DPoP-Nonce` install. Returns the successor capture, or null when the
  /// value is non-canonical or custody moved — the caller then releases the
  /// flight as consumed-unknown and the next request resynchronizes through
  /// the bounded challenge (a nonce is never reused).
  ///
  /// @ref LLP 0077#author-decisions--2026-07-23 — decision 5.
  async commitSenderSocketNonce(senderFlight, value) {
    if (typeof value !== 'string' || !isCanonicalSenderNonce(value)) return null;
    try {
      const rotated = await this.authCoordinator.compareAndRotateSenderCredential(
        senderFlight.capture,
        {
          bearer: senderFlight.credential.bearer,
          refreshAfterMs: senderFlight.credential.refreshAfterMs,
          nonce: senderNonceRecord(
            value,
            senderFlight.credential.senderConstraint.nonce.generation + 1,
          ),
          expectedSenderGeneration:
            senderFlight.credential.senderConstraint.custodyGeneration,
        },
      );
      return rotated.rotated ? rotated.capture : null;
    } catch {
      return null;
    }
  }

  handleTerminalAuthLoss(capture, error) {
    this.#assertNotInAuthorityPublication(
      'terminal auth handling is forbidden inside an authority publication callback',
    );
    const authorityDisposition = error?.authorityDisposition === 'durableDelete'
      ? 'durableDelete'
      : 'carrier';
    if (error && typeof error === 'object') error.authorityDisposition = authorityDisposition;
    const explicitExternalBearer = (
      !this.authorityFence
      && this.authProtocols.authClient === 1
      && typeof this.bearerToken === 'string'
      && this.bearerToken.length > 0
    );
    if (explicitExternalBearer) {
      this.__externalBearerTerminalError = error ?? staleAuthorityError();
    }
    if (this.#isTerminalAuthorityCapture(capture)) {
      if (
        this.agentAuthority
        && authorityDisposition === 'durableDelete'
        && this.__terminalAuthorityHandle?.authorityDisposition === 'carrier'
      ) {
        const escalated = this.agentAuthority.terminate(capture, {
          authorityDisposition,
          terminalError: error,
        });
        if (escalated && typeof escalated === 'object') {
          this.__terminalAuthorityHandle = escalated;
          this.#recordAuthTerminalFact(error, authorityDisposition);
          return escalated;
        }
      }
      if (
        explicitExternalBearer
        && authorityDisposition === 'durableDelete'
        && this.__terminalAuthorityHandle?.authorityDisposition === 'carrier'
      ) {
        // A concurrent finite request may carry the stronger committed
        // deletion axis after a carrier-class response already closed this
        // bearer generation. Repeat the local cut with delete semantics; null
        // external captures deliberately do not participate in the
        // coordinator phase-deduplication path.
        this.__terminalAuthorityCapture = undefined;
        this.__terminalAuthorityHandle = null;
        this.__terminalTransportCut = null;
        return this.handleTerminalAuthLoss(capture, error);
      }
      return this.__terminalAuthorityHandle ?? true;
    }
    if (
      this.authorityFence
      && (!capture || !this.authorityFence.isCurrent?.(capture))
    ) return false;
    this.__terminalAuthorityCapture = capture ?? null;
    this.#recordAuthTerminalFact(error, authorityDisposition);

    if (this.agentAuthority) {
      // AgentAuthorityFence owns the synchronous transport participant barrier.
      // Running the browser/manual cut as well would blank callbacks and
      // advance carrier generations twice for one terminal event.
      let agentTermination = null;
      let terminationError = null;
      try {
        agentTermination = this.agentAuthority.terminate(capture, {
          authorityDisposition,
          terminalError: error,
        });
      } catch (caught) {
        terminationError = caught;
      }
      let settlement;
      if (terminationError) {
        settlement = Promise.reject(terminationError);
        void settlement.catch(() => {});
      } else {
        settlement = agentTermination && typeof agentTermination === 'object'
          ? agentTermination.settlement
          : Promise.resolve();
      }
      const terminalHandle = Object.freeze({
        handled: true,
        authorityDisposition,
        settlement,
      });
      this.__terminalAuthorityHandle = terminalHandle;
      return terminalHandle;
    }

    // Run the same participant phases that AuthCoordinator owns, and remember
    // only phases that completed for this exact predecessor. A following
    // durableDelete transition can then skip those local phases once while
    // every other participant still executes normally. Failed phases retry.
    const cut = {
      capture: capture ?? null,
      phases: { quiesce: false, blank: false, clearMemory: false },
    };
    this.__terminalTransportCut = cut;
    const context = Object.freeze({
      previousCapture: capture ?? null,
      terminalError: error ?? staleAuthorityError(),
      reason: error?.code ?? 'SNAPBACK_AUTH_STREAM_RESET',
      disposition: authorityDisposition === 'carrier' ? 'quarantine' : 'delete',
      authorityDisposition,
      terminal: true,
    });
    let firstError = null;
    for (const phase of ['quiesce', 'blank', 'clearMemory']) {
      try {
        this.__authTransportParticipant[phase](context);
        cut.phases[phase] = true;
      } catch (caught) {
        firstError ??= caught;
      }
    }
    const settlement = firstError ? Promise.reject(firstError) : Promise.resolve();
    void settlement.catch(() => {});
    const terminalHandle = Object.freeze({
      handled: true,
      authorityDisposition,
      settlement,
    });
    this.__terminalAuthorityHandle = terminalHandle;
    return terminalHandle;
  }

  // @ref LLP 0058#bootstrap-handshake — the offer tuple is captured once per
  // request; the same object drives both the emitted headers and the echo
  // validation for that exact network request.
  #authSessionOffer() {
    return Object.freeze({
      authClient: this.authProtocols.authClient ?? null,
      authInvalidation: this.authProtocols.authInvalidation ?? null,
      authorityDescriptor: this.authProtocols.authorityDescriptor ?? null,
      authorizedLease: this.authProtocols.authorizedLease ?? null,
    });
  }

  #authOfferHeaders(includeAll = false, bearerOverride = undefined, offer = this.authProtocols) {
    const headers = {};
    const add = (name, version) => {
      if (version != null) headers[name] = String(version);
    };
    add(AUTH_CLIENT_PROTOCOL_HEADER, offer.authClient);
    if (includeAll) {
      add(AUTH_INVALIDATION_PROTOCOL_HEADER, offer.authInvalidation);
      add(AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER, offer.authorityDescriptor);
      add(AUTHORIZED_LEASE_PROTOCOL_HEADER, offer.authorizedLease);
    }
    const bearer = bearerOverride === undefined
      ? this.authorityFence
        ? (() => {
            try { return this.authorityFence.credentialFor(this.authorityFence.capture()).bearer; }
            catch { return null; }
          })()
        : this.bearerToken
      : bearerOverride;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    return headers;
  }

  #validateAuthSession(session, requestBearer = null, requestOffer = null) {
    const projected = projectAuthSessionResponse(
      session,
      requestOffer,
      this.authCoordinator?.appId ?? null,
    );
    if (projected && !valueContainsSecret(projected, requestBearer)) return projected;
    const diagnostic = {
      code: 'SNAPBACK_AUTH_HANDSHAKE_INVALID',
      message: 'GET /auth/session returned an invalid protocol-v1 response',
    };
    const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
    error.diagnostic = diagnostic;
    throw error;
  }

  async #trackedFetchJson(method, path, body, headers, options = {}) {
    const controller = new AbortController();
    this.__authControllers.add(controller);
    try {
      return await this.#fetchJson(method, path, body, headers, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      this.__authControllers.delete(controller);
    }
  }

  #cacheAuthSession(session, capture, cacheGeneration = this.__authSessionCacheGeneration) {
    this.#assertAuthCountersAvailable();
    if (this.__authSessionCacheGeneration !== cacheGeneration) return session;
    this.__authSessionLastSuccessful = session;
    this.__authSessionCapture = capture
      ? { authorityEpoch: capture.authorityEpoch, authorityKey: capture.authorityKey }
      : null;
    this.#publishCurrentPrincipal(currentPrincipalFromSession(session));
    return session;
  }

  async #commitAuthSession(session, capture, cacheGeneration = this.__authSessionCacheGeneration) {
    const committed = await this.commitAuthorityPublication(capture, () => (
      this.#cacheAuthSession(session, capture, cacheGeneration)
    ));
    if (!committed.committed) throw staleAuthorityError();
    return committed.value;
  }

  async currentAuthorityDescriptor() {
    const session = await this.authSession();
    return requireAuthorityDescriptor(session?.authorityDescriptor);
  }

  async currentAuthorizationScope({ devUserId = null } = {}) {
    const session = await this.authSession();
    const authorityDescriptor = requireAuthorityDescriptor(session?.authorityDescriptor);
    const authorizationStreamIncarnation = session?.authorizationStreamIncarnation
      ?? (session?.activeMode === 'dev' ? authorityDescriptor.authorityInstanceId : null);
    if (!UUID_V7.test(authorizationStreamIncarnation ?? '')) {
      const error = new Error(
        'SNAPBACK_AUTH_HANDSHAKE_INVALID: authorization stream incarnation is missing',
      );
      error.code = 'SNAPBACK_AUTH_HANDSHAKE_INVALID';
      throw error;
    }
    const userId = session.activeMode === 'sessions'
      ? (session.authority?.isAuthenticated ? session.authority.userId : null)
      : devUserId;
    return Object.freeze({
      principalScope: Object.freeze({
        authMode: session.activeMode,
        authorizationStreamIncarnation,
        userId: userId ?? null,
      }),
      authorityDescriptor,
      queryAuthorization: Object.freeze({}),
    });
  }

  async #prepareSenderAttempt(
    method,
    path,
    capture,
    headers,
    {
      accessToken = null,
      includeAuthorization = true,
      credential: preparedCredential = null,
    } = {},
  ) {
    const credential = preparedCredential
      ?? this.authCoordinator.senderCredentialFor(capture);
    const sender = credential.senderConstraint;
    const proofAccessToken = accessToken ?? credential.bearer;
    const proof = await createSenderProofForCustody({
      privateKey: sender.privateKey,
      publicJwk: sender.publicJwk,
      method,
      canonicalExternalUri: canonicalSenderExternalUri(this.baseUrl, path),
      accessToken: proofAccessToken,
      nonce: sender.nonce.value,
      issuedAtSeconds: Math.floor(Date.now() / 1_000),
      proofId: senderProofId(),
    });
    return {
      credential,
      forbiddenSecrets: [
        credential.bearer,
        sender.nonce.value,
        sender.thumbprint,
        sender.publicJwk.x,
        sender.publicJwk.y,
        proofAccessToken,
        ...proof.split('.'),
      ],
      headers: {
        ...(headers ?? {}),
        ...(includeAuthorization
          ? { authorization: `Bearer ${credential.bearer}` }
          : {}),
        dpop: proof,
      },
    };
  }

  // @ref LLP 0077#websocket-and-connection-binding — grant-token ath, not the unrelated session bearer, binds every socket proof.
  async liveStreamProtocolsFor(grant, path, capture, preparedCredential = null) {
    const offered = liveStreamProtocols(grant, this.authProtocols);
    if (!this.senderConstrained) return offered;
    const credential = preparedCredential
      ?? this.authCoordinator.senderCredentialFor(capture);
    const sender = credential.senderConstraint;
    const proof = await createSenderProofForCustody({
      privateKey: sender.privateKey,
      publicJwk: sender.publicJwk,
      method: 'GET',
      canonicalExternalUri: canonicalSenderExternalUri(this.baseUrl, path),
      accessToken: grant.token,
      nonce: sender.nonce.value,
      issuedAtSeconds: Math.floor(Date.now() / 1_000),
      proofId: senderProofId(),
    });
    return [...offered, `snapback.sender-proof.${proof}`];
  }

  async #senderFetchJson(
    method,
    path,
    body,
    headers,
    capture,
    options = {},
    challengeRetry = true,
    serialized = false,
    preparedCredential = null,
  ) {
    // @ref LLP 0077#browser-custody — proof creation, network completion, and successor CAS are one serialized flight.
    if (!serialized) {
      return this.authCoordinator.withSenderRequestSerialization(
        capture,
        ({ capture: currentCapture, credential }) => this.#senderFetchJson(
          method,
          path,
          body,
          headers,
          currentCapture,
          options,
          challengeRetry,
          true,
          credential,
        ),
      );
    }
    const attempt = await this.#prepareSenderAttempt(method, path, capture, headers, {
      credential: preparedCredential,
    });
    let nextCapture = null;
    try {
      const value = await this.#trackedFetchJson(method, path, body, attempt.headers, {
        ...options,
        forbiddenSecrets: [
          ...(options.forbiddenSecrets ?? []),
          ...attempt.forbiddenSecrets,
        ],
        onSenderNonce: async (value) => {
          const rotated = await this.authCoordinator.compareAndRotateSenderCredential(capture, {
            bearer: attempt.credential.bearer,
            refreshAfterMs: attempt.credential.refreshAfterMs,
            nonce: senderNonceRecord(
              value,
              attempt.credential.senderConstraint.nonce.generation + 1,
            ),
            expectedSenderGeneration:
              attempt.credential.senderConstraint.custodyGeneration,
          });
          if (!rotated.rotated) throw staleAuthorityError();
          nextCapture = rotated.capture;
        },
      });
      if (nextCapture === null) {
        throw senderIndeterminateSuccessError();
      }
      return { value, capture: nextCapture };
    } catch (error) {
      if (nextCapture !== null) markAuthorityCapture(error, nextCapture);
      const code = error?.diagnostic?.code ?? error?.code;
      if (
        code === 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED'
        && challengeRetry
        && nextCapture !== null
      ) {
        return this.#senderFetchJson(
          method,
          path,
          body,
          headers,
          nextCapture,
          options,
          false,
          true,
          null,
        );
      }
      throw error;
    }
  }

  async #fetchAuthSessionWithBearer(bearer, capture = null) {
    const offer = this.#authSessionOffer();
    if (this.senderConstrained && bearer !== null && capture !== null) {
      const sender = await this.#senderFetchJson(
        'GET',
        '/auth/session',
        undefined,
        this.#authOfferHeaders(true, bearer, offer),
        capture,
      );
      return {
        session: this.#validateAuthSession(sender.value, bearer, offer),
        capture: sender.capture,
      };
    }
    const session = await this.#trackedFetchJson(
      'GET',
      '/auth/session',
      undefined,
      this.#authOfferHeaders(true, bearer, offer),
    );
    return { session: this.#validateAuthSession(session, bearer, offer), capture };
  }

  // Framework-owner seam for LLP 0258's admitted supervised carrier. This is
  // deliberately absent from client.auth and the public declarations: an
  // ordinary application never receives a bearer or an adoption primitive.
  // The Expo owner supplies the carrier only after AppBinding admission, and
  // this method validates it through the ordinary /auth/session handshake
  // before the existing coordinator transition/barrier owns publication.
  async __supervisedBootstrapHandshake(
    bearer,
    {
      refreshAfterMs = Number.MAX_SAFE_INTEGER,
      allowSameAuthorityRotation = false,
    } = {},
  ) {
    if (!this.authCoordinator) {
      throw new TypeError('supervised bootstrap requires AuthCoordinator custody');
    }
    if (typeof bearer !== 'string' || bearer.length === 0) {
      throw new TypeError('supervised bootstrap requires a non-empty bearer');
    }
    await this.authSession();
    const offeredCapture = this.authCoordinator.capture();
    const { session } = await this.#fetchAuthSessionWithBearer(bearer, offeredCapture);
    const observed = clientAuthorityFromHandshake(session);
    if (observed.kind !== 'session') throw staleAuthorityError();

    let currentCapture;
    try {
      currentCapture = this.authCoordinator.capture();
    } catch (error) {
      if (
        error?.code === 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
        || error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
      ) throw staleAuthorityError();
      throw error;
    }
    const current = this.authCoordinator.credentialFor(currentCapture);
    if (current.authority.kind === 'session') {
      if (sameClientAuthority(current.authority, observed)) {
        if (!allowSameAuthorityRotation) {
          return Object.freeze({ status: 'conflict', session });
        }
        const rotated = await this.authCoordinator.compareAndRotateBearer(currentCapture, {
          bearer,
          refreshAfterMs,
        });
        if (!rotated.rotated) throw staleAuthorityError();
        await this.#commitAuthSession(session, rotated.capture);
        return Object.freeze({ status: 'rebound', capture: rotated.capture, session });
      }
      return Object.freeze({ status: 'conflict', session });
    } else if (current.authority.kind !== 'anonymous') {
      throw staleAuthorityError();
    }

    // @ref LLP 0258#d5-application-authority-wins-over-ambient-development-adoption
    // — a supervised principal may enter only over a fresh/settled anonymous
    // predecessor. Same-principal remints took the carrier-only branch above.
    const successor = await this.authCoordinator.transition(currentCapture, {
      authority: observed,
      bearer,
      refreshAfterMs,
    }, current.authority.kind === 'anonymous'
      ? 'supervised-bootstrap'
      : 'supervised-refresh');
    await this.#commitAuthSession(session, successor);
    return Object.freeze({ status: 'adopted', capture: successor, session });
  }

  async #probeUnrecognizedAuthority(predecessor) {
    let session;
    try {
      ({ session } = await this.#fetchAuthSessionWithBearer(null));
    } catch {
      return null;
    }
    const observed = clientAuthorityFromHandshake(session);
    if (
      observed.kind !== 'anonymous'
      || observed.authorizationStreamIncarnation
        === predecessor.authorizationStreamIncarnation
    ) return null;
    return { session, observed };
  }

  async #recoverUnrecognizedAuthority(capture, cacheGeneration, reason) {
    const coordinator = this.authCoordinator;
    if (
      !coordinator
      || !capture
      || !coordinator.isCurrent(capture)
    ) return null;
    const predecessor = coordinator.credentialFor(capture).authority;
    const witness = await this.#probeUnrecognizedAuthority(predecessor);
    if (witness === null) return null;
    const successor = await coordinator.transition(capture, {
      authority: witness.observed,
      bearer: null,
      refreshAfterMs: null,
    }, reason);
    return this.#commitAuthSession(witness.session, successor, cacheGeneration);
  }

  async #synchronizeAuthCoordinatorWithRecovery() {
    const coordinator = this.authCoordinator;
    // A witness belongs only to a refusal raised by this synchronize call.
    // Discard anything left by a transition whose caller already observed the
    // failure; a later unrelated resume must never consume stale evidence.
    this.__unrecognizedAuthorityRecovery = null;
    try {
      const capture = await coordinator.synchronize();
      this.__unrecognizedAuthorityRecovery = null;
      return capture;
    } catch (error) {
      const recovery = this.__unrecognizedAuthorityRecovery;
      this.__unrecognizedAuthorityRecovery = null;
      if (recovery === null) throw error;
      try {
        return await coordinator.recoverUnrecognizedAuthority(
          recovery.observed,
          recovery.reason,
        );
      } finally {
        // A refusal while resuming the recovery successor is a new terminal
        // observation, but this caller must never turn it into a retry loop.
        this.__unrecognizedAuthorityRecovery = null;
      }
    }
  }

  async #coordinatedAuthSession({
    retry = true,
    cacheGeneration = this.__authSessionCacheGeneration,
  } = {}) {
    const coordinator = this.authCoordinator;
    const synchronized = await this.#synchronizeAuthCoordinatorWithRecovery();
    let capture = synchronized;

    if (capture === null) {
      try {
        const { session } = await this.#fetchAuthSessionWithBearer(null);
        const authority = clientAuthorityFromHandshake(session);
        if (authority.kind !== 'anonymous') {
          throw staleAuthorityError();
        }
        capture = await coordinator.establishAnonymous(authority);
        return await this.#commitAuthSession(session, capture, cacheGeneration);
      } catch (error) {
        if (error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE' && retry) {
          return this.#coordinatedAuthSession({ retry: false, cacheGeneration });
        }
        throw error;
      }
    }

    // A non-null synchronization result may be an exact confirmation returned
    // inside a still-paused resume barrier. It authorizes neither bootstrap nor
    // an ordinary cache publication; only the barrier's stagePublication hook
    // may publish at the final locked confirmation.
    if (!coordinator.isCurrent(capture)) {
      if (retry) {
        return this.#coordinatedAuthSession({ retry: false, cacheGeneration });
      }
      throw staleAuthorityError();
    }
    capture = coordinator.capture();

    const credential = coordinator.credentialFor(capture);
    try {
      const fetched = await this.#fetchAuthSessionWithBearer(credential.bearer, capture);
      const session = fetched.session;
      capture = fetched.capture;
      if (!coordinator.isCurrent(capture)) {
        if (retry) {
          return this.#coordinatedAuthSession({
            retry: false,
            cacheGeneration,
          });
        }
        throw staleAuthorityError();
      }
      const observed = clientAuthorityFromHandshake(session);
      if (!sameClientAuthority(observed, credential.authority)) {
        capture = await coordinator.transition(capture, {
          authority: observed,
          bearer: observed.kind === 'session' ? credential.bearer : null,
          refreshAfterMs: observed.kind === 'session' ? credential.refreshAfterMs : null,
        }, 'handshake_authority_change');
      }
      return await this.#commitAuthSession(session, capture, cacheGeneration);
    } catch (error) {
      const code = error?.diagnostic?.code ?? error?.code;
      const responseCapture = error?.[AUTHORITY_CAPTURE] ?? null;
      if (responseCapture && coordinator.isCurrent(responseCapture)) {
        capture = responseCapture;
      }
      if (
        this.__authSessionCacheGeneration === cacheGeneration
        && !isUnavailableAuthTransport(error)
      ) {
        this.__authSessionLastSuccessful = null;
        this.__authSessionCapture = null;
      }
      if (code === 'SNAPBACK_AUTH_SENDER_PROOF_INVALID') {
        const recovered = await this.#recoverUnrecognizedAuthority(
          capture,
          cacheGeneration,
          'sender_authorization_stream_replaced',
        );
        if (recovered !== null) return recovered;
      }
      if (
        isTerminalAuthorityError(error)
        && error?.authorityDisposition === 'carrier'
      ) {
        const recovered = await this.#recoverUnrecognizedAuthority(
          capture,
          cacheGeneration,
          'terminal_carrier_authority_unrecognized',
        );
        if (recovered !== null) return recovered;
      }
      if (
        (error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE' || !coordinator.isCurrent(capture))
        && retry
      ) {
        return this.#coordinatedAuthSession({
          retry: false,
          cacheGeneration,
        });
      }
      throw error;
    }
  }

  async #resumeAuthTransport(capture, stagePublication, transitionAuthorityGeneration = null) {
    const credential = this.authCoordinator.credentialFor(capture);
    let fetched;
    try {
      fetched = await this.#fetchAuthSessionWithBearer(credential.bearer, capture);
    } catch (error) {
      const code = error?.diagnostic?.code ?? error?.code;
      if (
        isTerminalAuthorityError(error)
        && error?.authorityDisposition === 'carrier'
      ) {
        const witness = await this.#probeUnrecognizedAuthority(credential.authority);
        if (witness !== null) {
          // The coordinator is still inside the failed resume barrier here;
          // retain only the server-witnessed anonymous authority. The outer
          // synchronize boundary consumes it after the barrier fails closed.
          // @ref LLP 0059#unrecognized-authority-recovery — one bearerless
          //   probe plus the incarnation witness may enter capture-free
          //   recovery; a bare carrier refusal never destroys custody.
          this.__unrecognizedAuthorityRecovery = {
            observed: witness.observed,
            reason: 'resume_terminal_carrier_authority_unrecognized',
          };
        }
      }
      throw error;
    }
    const session = fetched.session;
    capture = fetched.capture;
    const observed = clientAuthorityFromHandshake(session);
    if (!sameClientAuthority(observed, credential.authority)) {
      const error = new Error(
        'SNAPBACK_AUTH_HANDSHAKE_AUTHORITY_MISMATCH: resume handshake does not match settled custody',
      );
      error.code = 'SNAPBACK_AUTH_HANDSHAKE_AUTHORITY_MISMATCH';
      error.diagnostic = {
        code: error.code,
        message: 'resume handshake does not match settled custody',
      };
      throw error;
    }
    if (typeof stagePublication !== 'function') {
      throw staleAuthorityError();
    }
    const queueStore = this.#custodyReconciliationStore();
    if (queueStore) {
      // The successor handshake is available while AuthCoordinator still
      // holds publication closed. Reconcile the preserved outbox here so a
      // writer can delete predecessor bytes before the barrier opens. DK-9
      // also permits this context to be a non-writer, so this participant is
      // mandatory: successor publication cannot precede predecessor root and
      // record disposition.
      // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — the custody matrix runs
      //   before successor publication, including cross-principal deletion.
      const authority = this.#queueAuthorityFromSession(capture, session);
      const reconciled = await this.#applyQueueCustodyReconciliation(queueStore, authority, {
        validateCurrent: false,
        expectedAuthorityGeneration: transitionAuthorityGeneration,
      });
      if (!reconciled) {
        const error = new Error(
          'SNAPBACK_AUTH_TRANSITION_QUEUE_RECONCILIATION_FAILED: successor queue custody was not committed',
        );
        error.code = 'SNAPBACK_AUTH_TRANSITION_QUEUE_RECONCILIATION_FAILED';
        throw error;
      }
    }
    // @ref LLP 0059#participant-contract — the handshake may complete during
    // resume, but its cache is app-visible state. Stage it against the exact
    // resume capture; AuthCoordinator flushes it inside the final locked
    // confirmation and discards it on any failure.
    stagePublication(capture, () => {
      this.__terminalAuthorityCapture = undefined;
      this.__terminalAuthorityHandle = null;
      this.__terminalTransportCut = null;
      this.#clearAuthTerminalFact();
      return this.#cacheAuthSession(session, capture);
    });
  }

  #validateCredentialResponse(response, forbiddenSecrets = []) {
    const projected = projectCredentialResponse(response, forbiddenSecrets);
    if (projected) return projected;
    const error = new Error(
      'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: auth provider returned an invalid credential response',
    );
    error.code = 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
    error.diagnostic = {
      code: error.code,
      message: 'auth provider returned an invalid credential response',
    };
    throw error;
  }

  #validateCredentialResponseWithRecoveryCodes(response, forbiddenSecrets = []) {
    const projected = projectCredentialResponseWithRecoveryCodes(response, forbiddenSecrets);
    if (projected) return projected;
    throw opaqueCredentialResponseError();
  }

  async #familyAlarmWithBearer(bearer) {
    if (!bearer) return { accepted: false };
    return this.#trackedFetchJson(
      'POST',
      '/auth/family-alarm',
      {},
      this.#authOfferHeaders(true, bearer),
    );
  }

  // ENG-23442: connection ids are server-granted capabilities, not bare
  // caller-chosen strings. The kit opens a grant transparently the first time
  // a connection id is used: `POST /connection/open` adopts the caller's
  // readable id in non-prod profiles (demos, acceptance suites, and
  // gated-inspect output keep meaningful ids) or mints an unguessable one
  // (prod, or a suggestion colliding with a live grant). Every wire operation
  // uses the GRANTED id plus its bearer token; callers keep addressing the
  // kit by their own label. Registries (lane consumers, stream managers) stay
  // label-keyed, so a caller never needs to learn the wire id.
  //
  // @ref LLP 0031#connection-capability-grants — the client half of the handshake.
  connectionGrant(connectionId, externalBearerTransitionPermit = null) {
    if (!connectionId) {
      return Promise.reject(clientCodedError(
        new TypeError(
          'SNAPBACK_CONNECTION_ID_REQUIRED: Snapback connectionId is required for connection-scoped operations',
        ),
        'SNAPBACK_CONNECTION_ID_REQUIRED',
      ));
    }
    const externalBearerTransition = this.__externalBearerTransition;
    if (
      externalBearerTransition
      && externalBearerTransitionPermit !== EXTERNAL_BEARER_TRANSITION_PERMIT
    ) {
      return externalBearerTransition.then(() => this.connectionGrant(connectionId));
    }
    let grant = this.__connectionGrants.get(connectionId);
    if (!grant) {
      grant = this.#openGrant(
        connectionId,
        connectionId,
        null,
        null,
        externalBearerTransitionPermit,
      );
      this.__connectionGrants.set(connectionId, grant);
    }
    return grant;
  }

  /// Re-run the handshake for a label whose grant looks stale (a rejected
  /// token, a socket that never opened — typically a restarted server whose
  /// grant registry is empty). The previous token rides along so a still-live
  /// server returns the SAME grant idempotently. Re-suggest the prior granted
  /// wire id, not the readable cache label: collision and mint-only posture
  /// can make them differ. After a restart that suggestion preserves identity
  /// where the target permits adoption; a mint-only target returns a fresh id.
  refreshConnectionGrant(connectionId, externalBearerTransitionPermit = null) {
    const externalBearerTransition = this.__externalBearerTransition;
    if (
      externalBearerTransition
      && externalBearerTransitionPermit !== EXTERNAL_BEARER_TRANSITION_PERMIT
    ) {
      return externalBearerTransition.then(() => this.refreshConnectionGrant(connectionId));
    }
    const stale = this.__connectionGrants.get(connectionId) ?? null;
    let grant;
    grant = (stale ? stale.catch(() => null) : Promise.resolve(null)).then(
      (previous) => this.#openGrant(
        connectionId,
        previous?.id ?? connectionId,
        previous?.token ?? null,
        () => grant,
        externalBearerTransitionPermit,
      ),
    );
    this.__connectionGrants.set(connectionId, grant);
    return grant;
  }

  /// Surface a §0B.6 wire-version diagnostic — never silently: recorded on
  /// the client, then delivered to the configured sink or console.warn.
  #surfaceWireVersionDiagnostic(diagnostic) {
    this.wireVersionDiagnostics.push(diagnostic);
    if (this.onWireVersionDiagnostic) {
      try {
        this.onWireVersionDiagnostic(diagnostic);
      } catch {
        // A throwing sink must not turn the surviving open into a failure.
      }
      return;
    }
    try {
      console.warn(`${diagnostic.code}: ${diagnostic.message}`, diagnostic.details);
    } catch {
      // Environments without a console still keep wireVersionDiagnostics.
    }
  }

  #openGrant(
    connectionLabel,
    suggestedConnectionId,
    previousToken,
    storedAs = null,
    externalBearerTransitionPermit = null,
  ) {
    let grant;
    const openBody = (withWireVersion, withEphemeralExpiry = true) => ({
      connectionId: suggestedConnectionId,
      ...(previousToken ? { previousToken } : {}),
      ...(this.authProtocols.authInvalidation != null
        ? { authInvalidationProtocol: this.authProtocols.authInvalidation }
        : {}),
      ...(this.authProtocols.ephemeralAuthority != null
        ? { ephemeralAuthorityProtocol: this.authProtocols.ephemeralAuthority }
        : {}),
      ...(withEphemeralExpiry && this.authProtocols.ephemeralExpiry != null
        ? { ephemeralExpiryProtocol: this.authProtocols.ephemeralExpiry }
        : {}),
      // @ref LLP 0094#0b3-the-wireversion-open-time-offer — B2: the kit
      // offers the exact token; the response echo witnesses the binding.
      ...(withWireVersion ? { wireVersion: WIRE_VERSION_TOKEN } : {}),
    });
    const openRequest = (withWireVersion, withEphemeralExpiry = true) => this.#req(
      'POST',
      '/connection/open',
      openBody(withWireVersion, withEphemeralExpiry),
      undefined,
      { externalBearerTransitionPermit },
    );
    const strictRefusal = (cause, reason) => {
      const diagnostic = {
        code: 'SNAPBACK_CLIENT_WIRE_VERSION_STRICT',
        message: `the server at ${this.baseUrl} ${reason} and this client is configured strict`,
        details: {
          endpoint: this.baseUrl,
          offered: WIRE_VERSION_TOKEN,
          cause,
        },
      };
      this.#surfaceWireVersionDiagnostic(diagnostic);
      const refusal = new Error(`${diagnostic.code}: ${diagnostic.message}`);
      refusal.code = diagnostic.code;
      refusal.diagnostic = diagnostic;
      refusal.cause = cause;
      throw refusal;
    };
    const surfaceDowngrade = (detection) => {
      this.#surfaceWireVersionDiagnostic({
        code: 'SNAPBACK_CLIENT_WIRE_VERSION_DOWNGRADED',
        message: `the server at ${this.baseUrl} did not establish the offered `
          + `${WIRE_VERSION_TOKEN} binding (${detection}); this client is using a legacy `
          + '(implicitly v1) connection and will stay offerless toward this endpoint '
          + 'for the process lifetime',
        details: {
          endpoint: this.baseUrl,
          offered: WIRE_VERSION_TOKEN,
          detection,
        },
      });
    };
    const validateOfferedGrant = (granted) => {
      if (
        this.authProtocols.ephemeralAuthority != null
        && granted?.ephemeralAuthorityProtocol !== this.authProtocols.ephemeralAuthority
      ) {
        const error = new Error(
          'SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED: server did not echo the offered protocol',
        );
        error.code = 'SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED';
        error.diagnostic = {
          code: error.code,
          message: 'server did not echo the offered ephemeral authority protocol',
        };
        throw error;
      }
      if (
        this.authProtocols.ephemeralAuthority != null
        && (
          typeof granted?.ephemeralAuthorityInstance !== 'string'
          || !/^eai1\.[A-Za-z0-9_-]{43}$/u.test(granted.ephemeralAuthorityInstance)
        )
      ) {
        const error = new Error(
          'SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_REQUIRED: server omitted the authority witness',
        );
        error.code = 'SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_REQUIRED';
        error.diagnostic = {
          code: error.code,
          message: 'server omitted the negotiated ephemeral authority instance',
        };
        throw error;
      }
      if (granted?.ephemeralExpiryProtocol === this.authProtocols.ephemeralExpiry) {
        this.__ephemeralExpirySupported = true;
      } else if (granted?.ephemeralExpiryProtocol != null) {
        const error = new Error(
          'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED: server echoed an unknown expiry protocol',
        );
        error.code = 'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED';
        error.diagnostic = {
          code: error.code,
          message: 'server echoed an unknown ephemeral expiry protocol',
        };
        throw error;
      } else {
        this.__ephemeralExpirySupported = false;
      }
      if (granted?.wireVersion === WIRE_VERSION_TOKEN) {
        wireVersionEndpointVerdicts.set(this.baseUrl, 'modern');
        return granted;
      }
      if (granted?.wireVersion != null) {
        const diagnostic = {
          code: 'SNAPBACK_CLIENT_WIRE_VERSION_ECHO_INVALID',
          message: `the server at ${this.baseUrl} echoed a wire version other than `
            + `the offered ${WIRE_VERSION_TOKEN}`,
          details: {
            endpoint: this.baseUrl,
            offered: WIRE_VERSION_TOKEN,
            echoed: granted.wireVersion,
          },
        };
        this.#surfaceWireVersionDiagnostic(diagnostic);
        const refusal = new Error(`${diagnostic.code}: ${diagnostic.message}`);
        refusal.code = diagnostic.code;
        refusal.diagnostic = diagnostic;
        throw refusal;
      }
      // A successful offered open without the additive B1 echo is the hosted
      // pre-B1 shape. It cannot be distinguished from an offerless success by
      // response bytes alone, but the caller knows it offered; the missing
      // witness means this connection is not proven explicitly bound.
      const firstDowngrade = wireVersionEndpointVerdicts.get(this.baseUrl) !== 'legacy';
      wireVersionEndpointVerdicts.set(this.baseUrl, 'legacy');
      if (this.strictWireVersion) {
        return strictRefusal(
          { code: 'SNAPBACK_CLIENT_WIRE_VERSION_ECHO_MISSING' },
          `accepted the wireVersion member without echoing the required bound-version witness`,
        );
      }
      if (firstDowngrade) surfaceDowngrade('missing wireVersion response echo');
      return granted;
    };
    const openWithNegotiation = async () => {
      const verdict = wireVersionEndpointVerdicts.get(this.baseUrl);
      if (verdict === 'legacy') {
        if (this.strictWireVersion) {
          return strictRefusal(
            { code: 'SNAPBACK_CLIENT_WIRE_VERSION_LEGACY_CACHED' },
            `was already proven to be a pre-B1 legacy endpoint`,
          );
        }
        return openRequest(false, false);
      }
      if (verdict === 'modern') {
        try {
          return validateOfferedGrant(await openRequest(
            true,
            this.__ephemeralExpirySupported !== false,
          ));
        } catch (error) {
          if (
            this.__ephemeralExpirySupported !== false
            && error?.status === 400
            && (error?.diagnostic?.code ?? error?.code) === 'SNAPBACK_REQUEST_JSON_INVALID'
          ) {
            this.__ephemeralExpirySupported = false;
            return validateOfferedGrant(await openRequest(true, false));
          }
          throw error;
        }
      }

      const activeProbe = wireVersionEndpointProbes.get(this.baseUrl);
      if (activeProbe) {
        await activeProbe;
        return openWithNegotiation();
      }

      let settleProbe;
      const probe = new Promise((resolve) => {
        settleProbe = resolve;
      });
      wireVersionEndpointProbes.set(this.baseUrl, probe);
      try {
        try {
          return validateOfferedGrant(await openRequest(true, true));
        } catch (error) {
          // §0B.6 legacy-server detection. The trigger is exact, not
          // heuristic: only the decode-class rejection a closed pre-B1 open
          // DTO produces may start the differential re-try. The code is not
          // sufficient by itself: LLP 0094 pins the exact HTTP 400 + code
          // pair, so a proxy or future 422 using the same code cannot
          // accidentally authorize a downgrade.
          const rejectionCode = error?.diagnostic?.code ?? error?.code;
          if (
            error?.status !== 400
            || rejectionCode !== 'SNAPBACK_REQUEST_JSON_INVALID'
          ) throw error;
          if (this.strictWireVersion) {
            return strictRefusal(
              error?.diagnostic ?? { code: rejectionCode },
              `rejected the wireVersion offer as a body-decode failure `
                + `(pre-B1 legacy server suspected)`,
            );
          }
          // Re-open with the offer member alone removed. Success proves the
          // legacy closed-DTO shape; failure records no verdict.
          const granted = await openRequest(false, false);
          this.__ephemeralExpirySupported = false;
          wireVersionEndpointVerdicts.set(this.baseUrl, 'legacy');
          surfaceDowngrade('decode-class differential');
          return granted;
        }
      } finally {
        if (wireVersionEndpointProbes.get(this.baseUrl) === probe) {
          wireVersionEndpointProbes.delete(this.baseUrl);
        }
        settleProbe();
      }
    };
    const openWithStreamResetRetry = async () => {
      try {
        return await openWithNegotiation();
      } catch (error) {
        if (!isRetryableStreamResetRefusal(error)) throw error;
        // A boot-provision reset can replace anonymous authority between the
        // open capture and publication. Retry the complete negotiation ladder
        // once after it settles (issues/20260807-auth-stream-reset-boot-flake.md).
        await new Promise((resolve) => setTimeout(resolve, STREAM_RESET_RETRY_DELAY_MS));
        // openWithNegotiation reaches #request again, whose declared-dev
        // preflight must finish before the retried connection-open dispatch.
        return openWithNegotiation();
      }
    };
    grant = openWithStreamResetRetry().then(
      (granted) => {
        const authorizationInvalidation = granted.authorizationInvalidation == null
          ? null
          : validateAuthorizationInvalidationConnection(granted.authorizationInvalidation);
        return markAuthorityCapture({
          id: granted.connectionId,
          token: granted.connectionToken,
          devIdentityCapabilityWitnessed:
            typeof granted.devIdentityCapabilityWitnessed === 'boolean'
              ? granted.devIdentityCapabilityWitnessed
              : null,
          authorizationInvalidation,
          // The §0B.3 bound-version witness: the token on explicitly bound
          // lineages, null on legacy lineages and pre-B1 servers (§0B.6).
          wireVersion: typeof granted.wireVersion === 'string' ? granted.wireVersion : null,
          ephemeralAuthorityProtocol: Number.isSafeInteger(granted.ephemeralAuthorityProtocol)
            ? granted.ephemeralAuthorityProtocol
            : null,
          ephemeralAuthorityInstance:
            typeof granted.ephemeralAuthorityInstance === 'string'
              ? granted.ephemeralAuthorityInstance
              : null,
          ephemeralExpiryProtocol: Number.isSafeInteger(granted.ephemeralExpiryProtocol)
            ? granted.ephemeralExpiryProtocol
            : null,
        }, granted?.[AUTHORITY_CAPTURE] ?? null);
      },
      (error) => {
        // A failed open must not poison the label: drop the cached promise
        // so the next operation retries the handshake. The cache may hold
        // this promise directly (first open) or a wrapper derived from it
        // (refresh) — compare against whichever the caller stored.
        const stored = this.__connectionGrants.get(connectionLabel);
        if (stored === grant || (storedAs && stored === storedAs())) {
          this.__connectionGrants.delete(connectionLabel);
        }
        throw error;
      },
    );
    return grant;
  }

  /// Run one connection-scoped operation; on a refreshable rejection, refresh
  /// the grant once (server restart/reset recovery) and retry the operation.
  async #withGrant(
    connectionId,
    run,
    externalBearerTransitionPermit = null,
  ) {
    const cached = this.connectionGrant(connectionId, externalBearerTransitionPermit);
    const grant = await cached;
    try {
      return await run(grant);
    } catch (error) {
      if (
        error?.diagnostic?.code !== 'SNAPBACK_CONNECTION_TOKEN_INVALID'
        && !isRetryableStreamResetRefusal(error)
      ) throw error;
      // An operation may race the same anonymous boot-provision reset window
      // after its grant opens; refresh once under the existing identity guard
      // before retrying (issues/20260807-auth-stream-reset-boot-flake.md).
      // Another operation may have refreshed the grant already; only refresh
      // when this operation still holds the rejected one.
      if (this.__connectionGrants.get(connectionId) === cached) {
        await this.refreshConnectionGrant(connectionId, externalBearerTransitionPermit);
      }
      // `run` owns an ordinary #req operation. Re-enter it only after the
      // refreshed grant is ready; #fetchJson then re-verifies any invalidated
      // declared-dev episode before replaying the failed operation.
      return run(await this.connectionGrant(
        connectionId,
        externalBearerTransitionPermit,
      ));
    }
  }

  /// Record a receipt into the bounded kit ring and notify listeners.
  recordReceipt(receipt, capture = receipt?.[AUTHORITY_CAPTURE] ?? null) {
    if (!receipt || typeof receipt !== 'object') return receipt;
    const publish = () => {
      this.__receiptRing.push(receipt);
      while (this.__receiptRing.length > RECEIPT_RING_CAP) this.__receiptRing.shift();
      const publication = Object.freeze({
        authorityCapture: capture,
        authorityFenced: Boolean(this.authorityFence),
      });
      for (const listener of [...this.__receiptListeners]) {
        // A throwing app listener must never turn a committed operation into a
        // client-side failure (ENG-22478 review fix G).
        try {
          listener(receipt, publication);
        } catch {
          // Listener errors are the listener's problem, not the operation's.
        }
      }
      return receipt;
    };
    if (!this.authorityFence) {
      void this.commitAuthorityPublication(null, publish).catch(() => {});
      return receipt;
    }
    // Most receipt callers intentionally remain synchronous. The publication
    // itself is queued behind durable custody and every observer still runs
    // inside the synchronous compare-and-commit callback. When a receipt is
    // emitted while a frame already owns that fence, the nested fast path
    // above commits immediately without re-entering AuthCoordinator.
    void this.commitAuthorityPublication(capture, publish).catch(() => {});
    return receipt;
  }

  /// The receipts this client has observed, oldest first (bounded ring).
  receipts() {
    return [...this.__receiptRing];
  }

  onReceipt(listener) {
    this.__receiptListeners.add(listener);
    return () => this.__receiptListeners.delete(listener);
  }

  /// Structured effect-free reservation retry evidence, oldest first.
  reservationRetryDiagnostics() {
    return [...this.__reservationRetryDiagnostics];
  }

  #recordReservationRetryDiagnostic(diagnostic) {
    const frozen = Object.freeze({ ...diagnostic });
    this.__reservationRetryDiagnostics.push(frozen);
    while (
      this.__reservationRetryDiagnostics.length
      > RESERVATION_RETRY_DIAGNOSTIC_RING_CAP
    ) this.__reservationRetryDiagnostics.shift();
    if (this.onReservationRetryDiagnostic !== null) {
      try {
        this.onReservationRetryDiagnostic(frozen);
      } catch {
        // Observation cannot change mutation settlement or retry ownership.
      }
    }
    return frozen;
  }

  #reservationRetryDelayMilliseconds() {
    const [minimum, maximum] = this.reservationRetryJitterMilliseconds;
    if (minimum === maximum) return minimum;
    return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
  }

  #isEffectFreeReservationStale(error) {
    const details = error?.diagnostic?.details;
    const detailKeys = details && typeof details === 'object' && !Array.isArray(details)
      ? Object.keys(details).sort()
      : [];
    return error?.status === 409
      && error?.diagnostic?.code === 'SNAPBACK_AUTH_RESERVATION_STALE'
      && JSON.stringify(detailKeys) === JSON.stringify([
        'effectCommitted',
        'retryStrategy',
        'retryable',
      ])
      && details?.retryable === true
      && details?.retryStrategy === 'short-jitter'
      && details?.effectCommitted === false
      && error?.effectMayHaveCommitted !== true;
  }

  #laneConsumersFor(connectionId) {
    let consumers = this.__laneConsumers.get(connectionId);
    if (!consumers) {
      consumers = { durable: new Set(), ephemeral: new Set() };
      this.__laneConsumers.set(connectionId, consumers);
    }
    return consumers;
  }

  registerDurableConsumer(connectionId, consumer) {
    const consumers = this.#laneConsumersFor(connectionId);
    consumers.durable.add(consumer);
    return () => consumers.durable.delete(consumer);
  }

  registerEphemeralConsumer(connectionId, consumer) {
    const consumers = this.#laneConsumersFor(connectionId);
    consumers.ephemeral.add(consumer);
    return () => consumers.ephemeral.delete(consumer);
  }

  static auth(userId, { permissions = [] } = {}) {
    if (userId === isAgentAuthorityFence) return this.#req;
    return { principal: userId ?? null, session_id: null, user_id: userId ?? null, permissions };
  }

  static roomPermission(prefix, scope) {
    return `${prefix}:${normalizedScopeKey(scope)}`;
  }

  async #request(method, path, body, headers, {
    admin = false,
    supersededRetry = true,
    senderChallengeRetry = true,
    expectedAuthorityCapture = null,
    externalBearerTransitionPermit = null,
    beforeTransportDispatch = null,
    onTransportFailure = null,
    authAdmissionReference = null,
    authAdmissionOperation = null,
    authModePendingRetry = 0,
    ephemeralAuthorityPendingRetry = 0,
    ephemeralRetryAuthorityCapture = null,
    ephemeralRetryExternalBearer = undefined,
    ephemeralRetryExternalTransportGeneration = null,
  } = {}) {
    this.#assertAuthCountersAvailable();
    if (authAdmissionReference !== null) {
      // @ref LLP 0059#participant-contract — bind one-shot admission to the
      // final request-start capture. Mutation preparation can await local
      // durable work before reaching this cut, so its earlier eager preflight
      // is necessary but not sufficient.
      const authAdmissionError = authenticatedOneShotAdmissionError(
        authAdmissionReference,
        this,
        authAdmissionOperation,
      );
      if (authAdmissionError !== null) throw authAdmissionError;
    }
    const assertEphemeralRetryAuthorityCurrent = () => {
      if (ephemeralRetryAuthorityCapture !== null) {
        let currentCapture = null;
        try { currentCapture = this.authorityFence?.capture?.() ?? null; } catch { /* stale below */ }
        if (
          currentCapture === null
          || !sameAuthorityCapture(currentCapture, ephemeralRetryAuthorityCapture)
          || !this.authorityFence?.isCurrent?.(ephemeralRetryAuthorityCapture)
        ) throw staleAuthorityError();
      }
      if (
        ephemeralRetryExternalTransportGeneration !== null
        && (
          this.__externalBearerTransition !== null
          || this.bearerToken !== ephemeralRetryExternalBearer
          || this.__authTransportGeneration !== ephemeralRetryExternalTransportGeneration
        )
      ) throw staleAuthorityError();
    };
    assertEphemeralRetryAuthorityCurrent();
    const externalBearerTransition = this.__externalBearerTransition;
    if (
      externalBearerTransition
      && externalBearerTransitionPermit !== EXTERNAL_BEARER_TRANSITION_PERMIT
    ) {
      await externalBearerTransition;
    }
    if (!admin && this.__externalBearerTerminalError) {
      throw this.__externalBearerTerminalError;
    }
    const externalBearerAtStart = (
      !admin
      && !this.authorityFence
      && this.authProtocols.authClient === 1
      && typeof this.bearerToken === 'string'
      && this.bearerToken.length > 0
    ) ? this.bearerToken : null;
    const externalTransportGenerationAtStart = this.__authTransportGeneration;
    let session = null;
    let capture = null;
    let bearerUsed = null;
    let terminalHandle = null;
    let custodyCleared = false;
    let requestTransportGeneration = null;
    let fetchInvoked = false;
    try {
      if (this.authorityFence) {
        this.#ensureAgentTransportParticipant();
        if (!this.agentAuthority) await this.#synchronizeAuthCoordinatorWithRecovery();
        try { capture = this.authorityFence.capture(); } catch { /* bootstrap handshake below */ }
        if (
          expectedAuthorityCapture
          && !sameAuthorityCapture(capture, expectedAuthorityCapture)
        ) throw staleAuthorityError();
      }
      if (
        !admin
        && this.authProtocols.authClient != null
        && authHandshakeRequired(path)
        // Anonymous-public custody has no credential to exchange: the offer
        // header alone is the contract, and the server answers public-auth
        // operations directly (0137 A4-f6).
        && this.custody !== 'anonymous-public'
      ) {
        // Every top-level online operation establishes a new observable
        // connection attempt. Re-probe the same URL so a replacement process
        // can never inherit its predecessor's startup nonce/generation cache.
        // @ref LLP 0058#kit-ordering — handshake cache is process-scoped, not
        // an origin-scoped capability assertion.
        session = externalBearerTransitionPermit === EXTERNAL_BEARER_TRANSITION_PERMIT
          ? await this.#authSession(
              { force: true },
              externalBearerTransitionPermit,
            )
          : await this.authSession({ force: true });
        const unavailable = authAvailabilityError(session);
        if (unavailable) throw unavailable;
      }
      if (this.authorityFence && (capture || session || !this.agentAuthority)) {
        // authSession may have bootstrapped or transitioned custody.
        if (capture || session || authHandshakeRequired(path)) {
          capture = this.authorityFence.capture();
        } else {
          // Handshake-exempt public probes (`/health`, `/inspect`) are the
          // pre-auth bootstrap surface: signed-out custody must not veto
          // them. They proceed anonymously — same protocol-offer headers, no
          // bearer — instead of failing closed on unsettled custody.
          // @ref LLP 0058#bootstrap-handshake — the exact offer rides every
          // online boundary; settled custody is required only for
          // app-visible authenticated work.
          try { capture = this.authorityFence.capture(); } catch { capture = null; }
        }
        if (
          expectedAuthorityCapture
          && !sameAuthorityCapture(capture, expectedAuthorityCapture)
        ) throw staleAuthorityError();
        if (capture) bearerUsed = this.authorityFence.credentialFor(capture).bearer;
      }

      if (authAdmissionReference !== null) {
        // @ref LLP 0059#participant-contract — synchronize() may join an
        // authority barrier that settled to a different admission state. The
        // post-handshake capture is the last local authority fact before
        // dispatch, so revalidate generated one-shot admission against it.
        const authAdmissionError = authenticatedOneShotAdmissionError(
          authAdmissionReference,
          this,
          authAdmissionOperation,
        );
        if (authAdmissionError !== null) throw authAdmissionError;
      }

      const sessionsMode = session?.activeMode === 'sessions';
      let requestBody = body;
      const mutationIdentityRequest = path.startsWith('/mutation/') && body?.clientMutationId;
      const rangeIdentityRequest = path === '/client-mutations/identity-range';
      if (mutationIdentityRequest || rangeIdentityRequest) {
        const queuedAvailability = session?.availability?.queuedReplay;
        if (session && queuedAvailability?.available !== true) {
          const code = queuedAvailability?.reason ?? 'SNAPBACK_AUTH_POLICY_UNAVAILABLE';
          throw clientCodedError(
            new Error(`${code}: queued mutation replay is unavailable`),
            code,
          );
        }
        const descriptor = body.authorityDescriptor ?? session?.authorityDescriptor ?? null;
        if (descriptor !== null || sessionsMode) {
          requestBody = {
            ...body,
            authorityDescriptor: requireAuthorityDescriptor(
              descriptor,
              'SNAPBACK_AUTHORITY_DESCRIPTOR_INVALID',
            ),
          };
        }
      }
      // Anonymous-public custody never performs the handshake that flips
      // sessionsMode, but its offer contract (LLP 0137 A4-f6) is the same
      // sessions-era protocol: the offer header is the only auth carrier, so
      // the body must not carry legacy identity fields — a sessions server
      // refuses them with SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED.
      // @ref LLP 0062#6-packaging-phases — the app CLI's dev lane must offer
      // auth-client v1 while still presenting its explicit legacy assertion:
      // dev targets consume it and sessions targets refuse it. Ordinary
      // anonymous-public callers continue to strip every legacy auth field.
      const carriesExplicitDevAssertion = this.__allowLegacyDevAssertion
        && typeof requestBody?.auth?.user_id === 'string';
      const wireBody = sessionsMode || (
        this.custody === 'anonymous-public' && !carriesExplicitDevAssertion
      )
        ? sessionWireBody(path, requestBody)
        : requestBody;
      const merged = {
        ...((admin || (
          this.__adminDataPlane && /^\/(?:query|mutation|action)\/[A-Za-z0-9_-]+$/u.test(path)
        )) && this.adminToken ? { 'x-snapback-admin-token': this.adminToken } : {}),
        ...(sessionsMode ? this.#sessionRequestHeaders(
          path,
          requestBody,
          this.authorityFence ? bearerUsed : undefined,
        ) : this.custody === 'anonymous-public'
          // No handshake session exists to flip sessionsMode; the offer
          // header itself is the anonymous contract (0137 A4-f6). Live and
          // ephemeral work additionally carries the negotiated
          // authorization-invalidation offer, exactly like the sessions
          // header path: on a sessions-mode server an anonymous caller's
          // auth-scoped subscription is admitted only with that header, and
          // omitting it made every such subscribe refuse with
          // SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED (found by the
          // 2026-08-07 browser-carrier public witness).
          ? {
              ...this.#authOfferHeaders(false),
              ...((path.startsWith('/live/') || path.startsWith('/ephemeral/'))
                && this.authProtocols.authInvalidation != null
                ? { [AUTH_INVALIDATION_PROTOCOL_HEADER]: String(this.authProtocols.authInvalidation) }
                : {}),
            }
          : {}),
        ...(headers ?? {}),
        // @ref LLP 0262#d2-carriers-per-shipped-topology — this dedicated
        // custody header accompanies only body-installed dev authority and
        // the connection grant that witnesses later identity-bearing frames.
        ...(!admin && devIdentityCapabilityFor(this) && (
          path === '/connection/open' || carriesClientAssertedDevIdentity(wireBody)
        ) ? { [DEV_IDENTITY_HEADER]: devIdentityCapabilityFor(this) } : {}),
      };
      const connectionGrantToken = merged[CONNECTION_TOKEN_HEADER] ?? null;
      if (connectionGrantToken !== null) {
        delete merged.authorization;
      }
      let senderAttempt = null;
      let senderNonceRotated = false;
      const senderEligible = (
        this.senderConstrained
        && this.authCoordinator
        && capture
        && bearerUsed
        && !admin
      );
      const dispatch = async (serializedPrepared = null) => {
        if (serializedPrepared !== null) {
          capture = serializedPrepared.capture;
          bearerUsed = serializedPrepared.credential.bearer;
          if (
            expectedAuthorityCapture
            && !sameAuthorityLineage(capture, expectedAuthorityCapture)
          ) throw staleAuthorityError();
          if (connectionGrantToken === null) {
            merged.authorization = `Bearer ${bearerUsed}`;
          } else {
            delete merged.authorization;
          }
        }
        if (senderEligible) {
        senderAttempt = await this.#prepareSenderAttempt(method, path, capture, merged, {
          accessToken: connectionGrantToken,
          includeAuthorization: connectionGrantToken === null,
          credential: serializedPrepared?.credential ?? null,
        });
        Object.assign(merged, senderAttempt.headers);
        }
        const senderFetchOptions = senderAttempt === null ? {} : {
          forbiddenSecrets: senderAttempt.forbiddenSecrets,
          onSenderNonce: async (value) => {
            const rotated = await this.authCoordinator.compareAndRotateSenderCredential(capture, {
              bearer: senderAttempt.credential.bearer,
              refreshAfterMs: senderAttempt.credential.refreshAfterMs,
              nonce: senderNonceRecord(
                value,
                senderAttempt.credential.senderConstraint.nonce.generation + 1,
              ),
              expectedSenderGeneration:
                senderAttempt.credential.senderConstraint.custodyGeneration,
            });
            if (!rotated.rotated) throw staleAuthorityError();
            capture = rotated.capture;
            senderNonceRotated = true;
          },
        };
        try {
          // The hook may itself acquire durable queue custody before finding
          // a stale/suspended record. From this point every failure must
          // release that custody before #request enters authority recovery;
          // successful transport retains it through the caller's durable
          // settlement/disposition cut.
          assertEphemeralRetryAuthorityCurrent();
          await beforeTransportDispatch?.();
          // A queue hook may itself span a logout or A→B transition. The
          // pending-authority retry remains the predecessor operation, so it
          // must refuse before the only transport-entry cut.
          assertEphemeralRetryAuthorityCurrent();
          let requestTask = null;
          if (this.authorityFence && capture) {
            // Start the actual fetch synchronously inside the final durable
            // comparison. Returning the Promise from this callback would violate
            // the custody contract, so retain it locally and await only after the
            // lock releases. A peer transition can therefore refuse the old
            // intent, but can never reinterpret it as a successor-authority call.
            const started = await this.commitAuthorityPublication(
              senderAttempt === null ? (expectedAuthorityCapture ?? capture) : capture,
              () => {
                requestTransportGeneration = this.__authTransportGeneration;
                requestTask = this.#trackedFetchJson(
                  method,
                  path,
                  wireBody,
                  merged,
                  {
                    ...senderFetchOptions,
                    onFetchInvoked: () => { fetchInvoked = true; },
                  },
                );
              },
            );
            if (!started.committed || requestTask === null) throw staleAuthorityError();
          } else {
            requestTransportGeneration = this.__authTransportGeneration;
            requestTask = this.#trackedFetchJson(
              method,
              path,
              wireBody,
              merged,
              {
                ...senderFetchOptions,
                onFetchInvoked: () => { fetchInvoked = true; },
              },
            );
          }
          const result = await requestTask;
          if (senderAttempt !== null && !senderNonceRotated) {
            throw senderIndeterminateSuccessError();
          }
          if (
            requestTransportGeneration !== this.__authTransportGeneration
          ) throw staleAuthorityError();
          if (!this.authorityFence || !capture) return result;
          if (!this.authorityFence.isCurrent(capture)) throw staleAuthorityError();
          const committed = await this.commitAuthorityPublication(capture, () => (
            markAuthorityCapture(result, capture)
          ));
          if (!committed.committed) throw staleAuthorityError();
          return committed.value;
        } catch (error) {
          await onTransportFailure?.(error);
          throw error;
        }
      };
      return senderEligible
        ? await this.authCoordinator.withSenderRequestSerialization(capture, dispatch)
        : await dispatch();
    } catch (error) {
      const responseCapture = error?.[AUTHORITY_CAPTURE] ?? null;
      if (
        responseCapture
        && this.authorityFence?.isCurrent?.(responseCapture)
      ) capture = responseCapture;
      if (this.authorityFence && capture) markAuthorityCapture(error, capture);
      if (
        this.authorityFence
        && capture
        && !this.authorityFence.isCurrent(capture)
        && !this.#isTerminalAuthorityCapture(capture)
      ) {
        if (!fetchInvoked) throw staleAuthorityError();
        // Once fetch() has been invoked, a logout abort cannot prove that an
        // action or mutation had no server effect. Preserve the stale
        // authority classification, but let the common diagnostic wrapper
        // stamp effectMayHaveCommitted from the transport-entry fact below.
        error = staleAuthorityError();
      }
      const code = error?.diagnostic?.code ?? error?.code;
      if (
        code === 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED'
        && senderChallengeRetry
        && senderNonceRotated
        && this.authCoordinator
        && capture
      ) {
        // A non-2xx invalidates the declared-dev gate in #fetchJson. Re-enter
        // #request so identity verification completes before this replay.
        return this.#request(method, path, body, headers, {
          admin,
          supersededRetry,
          senderChallengeRetry: false,
          expectedAuthorityCapture: capture,
          externalBearerTransitionPermit,
          beforeTransportDispatch,
          onTransportFailure,
          authAdmissionReference,
          authAdmissionOperation,
          authModePendingRetry,
          ephemeralAuthorityPendingRetry,
          ephemeralRetryAuthorityCapture,
          ephemeralRetryExternalBearer,
          ephemeralRetryExternalTransportGeneration,
        });
      }
      if (
        code === 'SNAPBACK_AUTH_MODE_PENDING'
        && error?.authorityDisposition == null
        && authModePendingRetry < AUTH_MODE_PENDING_RETRY_MAX_ATTEMPTS
      ) {
        // @ref LLP 0059#typed-terminal-auth-error — an axisless finite
        // mode-pending refusal is a watch-reload window, not terminal
        // authority evidence. Release happened through onTransportFailure;
        // retry the same operation within a bounded short-jitter budget.
        this.__authModePendingRetryDepth += 1;
        this.__notifyAuthorityTransitionStatus();
        try {
          await new Promise((resolve) => setTimeout(
            resolve,
            this.#reservationRetryDelayMilliseconds(),
          ));
          // The retry re-enters #fetchJson, so an invalidated declared-dev
          // episode is verified before AUTH_MODE_PENDING is replayed.
          return await this.#request(method, path, body, headers, {
            admin,
            supersededRetry,
            senderChallengeRetry,
            expectedAuthorityCapture,
            externalBearerTransitionPermit,
            beforeTransportDispatch,
            onTransportFailure,
            authAdmissionReference,
            authAdmissionOperation,
            authModePendingRetry: authModePendingRetry + 1,
            ephemeralAuthorityPendingRetry,
            ephemeralRetryAuthorityCapture,
            ephemeralRetryExternalBearer,
            ephemeralRetryExternalTransportGeneration,
          });
        } finally {
          this.__authModePendingRetryDepth -= 1;
          this.__notifyAuthorityTransitionStatus();
        }
      }
      if (
        code === 'SNAPBACK_EPHEMERAL_AUTHORITY_PENDING'
        && error?.status === 503
        && (path === '/ephemeral/subscribe' || path === '/ephemeral/publish')
        && ephemeralAuthorityPendingRetry < EPHEMERAL_AUTHORITY_PENDING_RETRY_MAX_ATTEMPTS
      ) {
        // @ref LLP 0059#dated-amendment-total-client-authority-transition-state-and-settlement-matrix-2026-08-21-llp-0295-d02 — password sign-in settles before the room read lane can occasionally observe its successor; these two refusals occur before any room registration or publish effect, so the client owns one finite successor wait instead of leaking it to app code.
        this.__ephemeralAuthorityPendingRetryDepth += 1;
        this.__notifyAuthorityTransitionStatus();
        try {
          const retryAuthorityCapture = ephemeralRetryAuthorityCapture
            ?? expectedAuthorityCapture
            ?? capture;
          const retryExternalTransportGeneration =
            ephemeralRetryExternalTransportGeneration
            ?? (externalBearerAtStart !== null
              ? externalTransportGenerationAtStart
              : null);
          const retryExternalBearer = retryExternalTransportGeneration === null
            ? undefined
            : (ephemeralRetryExternalTransportGeneration === null
              ? externalBearerAtStart
              : ephemeralRetryExternalBearer);
          const assertRetryAuthorityCurrent = () => {
            if (retryAuthorityCapture !== null) {
              let currentCapture = null;
              try { currentCapture = this.authorityFence?.capture?.() ?? null; } catch { /* stale below */ }
              if (
                currentCapture === null
                || !this.authorityFence?.isCurrent?.(retryAuthorityCapture)
                || !sameAuthorityCapture(currentCapture, retryAuthorityCapture)
              ) throw staleAuthorityError();
            }
            if (
              retryExternalTransportGeneration !== null
              && (
                this.__externalBearerTransition !== null
                || this.bearerToken !== retryExternalBearer
                || this.__authTransportGeneration !== retryExternalTransportGeneration
              )
            ) throw staleAuthorityError();
          };
          // @ref LLP 0059#dated-amendment-total-client-authority-transition-state-and-settlement-matrix-2026-08-21-llp-0295-d02 — a finite pending retry is one authority-bound operation, not a new admission. Pin the first exact coordinator capture or external-bearer generation and compare it on both sides of the delay.
          assertRetryAuthorityCurrent();
          await new Promise((resolve) => setTimeout(
            resolve,
            this.#reservationRetryDelayMilliseconds(),
          ));
          assertRetryAuthorityCurrent();
          // Preserve the authority capture while still re-entering the common
          // declared-dev identity preflight before the transport replay.
          return await this.#request(method, path, body, headers, {
            admin,
            supersededRetry,
            senderChallengeRetry,
            expectedAuthorityCapture: retryAuthorityCapture,
            externalBearerTransitionPermit,
            beforeTransportDispatch,
            onTransportFailure,
            authAdmissionReference,
            authAdmissionOperation,
            authModePendingRetry,
            ephemeralAuthorityPendingRetry: ephemeralAuthorityPendingRetry + 1,
            ephemeralRetryAuthorityCapture: retryAuthorityCapture,
            ephemeralRetryExternalBearer: retryExternalBearer,
            ephemeralRetryExternalTransportGeneration: retryExternalTransportGeneration,
          });
        } finally {
          this.__ephemeralAuthorityPendingRetryDepth -= 1;
          this.__notifyAuthorityTransitionStatus();
        }
      }
      if (this.authorityFence && capture && error?.receipt) {
        markAuthorityCapture(error.receipt, capture);
      }
      const currentExternalBearerGeneration = (
        externalBearerAtStart !== null
        && this.bearerToken === externalBearerAtStart
        && this.__authTransportGeneration === externalTransportGenerationAtStart
      );
      // @ref LLP 0247#d2-protected-continuing-reads-wait-one-shot-reads-refuse-locally
      // — an anonymous capture owns no authenticated authority to terminate;
      // a raced server refusal stays scoped to this request/resource.
      const anonymousAuthRequiredRefusal = (
        code === 'SNAPBACK_AUTH_REQUIRED'
        && captureHasAnonymousAuthority(this.authCoordinator, capture)
      );
      if (
        isTerminalAuthorityError(error)
        && !anonymousAuthRequiredRefusal
        && (
          (this.authorityFence && capture)
          || currentExternalBearerGeneration
        )
      ) {
        terminalHandle = this.handleTerminalAuthLoss(capture, error);
      }
      if (this.authCoordinator && capture && SUPERSEDED_AUTH_CODES.has(code)) {
        const successor = await this.authCoordinator.waitForNewerRevision(capture);
        if (successor && supersededRetry && expectedAuthorityCapture === null) {
          this.clearAuthSession();
          // Successor retry also re-enters #fetchJson after any failed
          // response invalidated the declared-dev episode.
          return this.#request(method, path, body, headers, {
            admin,
            supersededRetry: false,
            senderChallengeRetry,
            expectedAuthorityCapture,
            externalBearerTransitionPermit,
            beforeTransportDispatch,
            onTransportFailure,
            authAdmissionReference,
            authAdmissionOperation,
            authModePendingRetry,
            ephemeralAuthorityPendingRetry,
            ephemeralRetryAuthorityCapture,
            ephemeralRetryExternalBearer,
            ephemeralRetryExternalTransportGeneration,
          });
        }
        try { await this.#familyAlarmWithBearer(bearerUsed); } catch { /* named stolen-successor residual */ }
        const cleared = await this.authCoordinator.compareAndClear(
          capture,
          'credential_superseded_without_successor',
        );
        custodyCleared = cleared?.cleared === true;
      } else if (
        this.authCoordinator
        && capture
        && isTerminalAuthorityError(error)
        && !anonymousAuthRequiredRefusal
        && error?.authorityDisposition !== 'carrier'
      ) {
        const cleared = await this.authCoordinator.compareAndClear(capture, code);
        custodyCleared = cleared?.cleared === true;
      }
      if (terminalHandle && typeof terminalHandle === 'object') {
        await terminalHandle.settlement;
      }
      if (!anonymousAuthRequiredRefusal && !terminalHandle && !custodyCleared && [
        'SNAPBACK_AUTH_REQUIRED',
        'SNAPBACK_AUTH_SESSION_EXPIRED',
        'SNAPBACK_AUTH_SESSION_REVOKED',
        'SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED',
        'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
      ].includes(code)) {
        this.clearAuthSession();
      }
      const effectMayHaveCommitted = error?.effectMayHaveCommitted
        ?? (error?.effectCommitted === false
          ? false
          : (path.startsWith('/mutation/') || path.startsWith('/action/'))
            && fetchInvoked);
      throw asSnapbackDiagnosticError(error, {
        operation: path.startsWith('/mutation/')
          ? 'mutation'
          : path.startsWith('/action/')
            ? 'action'
            : path.startsWith('/query/')
              ? 'query'
              : path.startsWith('/ephemeral/')
                ? 'ephemeral'
                : 'request',
        effectMayHaveCommitted,
      });
    }
  }

  #sessionRequestHeaders(path, originalBody, bearerOverride = undefined) {
    const headers = this.#authOfferHeaders(false, bearerOverride);
    const authorizedLeaseRequest = path.startsWith('/query/')
      && path.endsWith('/authorized-lease');
    const standaloneAcknowledgement = path === '/client-mutations/acknowledge'
      || path === '/client-mutations/identity-range'
      || path === '/live/authorization-invalidation/acknowledge'
      || path === '/live/authorization-invalidation/manual-retry';
    if (path.startsWith('/live/') || path.startsWith('/ephemeral/') || authorizedLeaseRequest) {
      if (this.authProtocols.authInvalidation != null) {
        headers[AUTH_INVALIDATION_PROTOCOL_HEADER] = String(this.authProtocols.authInvalidation);
      }
    }
    if (authorizedLeaseRequest && this.authProtocols.authorizedLease != null) {
      headers[AUTHORIZED_LEASE_PROTOCOL_HEADER] = String(
        this.authProtocols.authorizedLease,
      );
    }
    if (
      (path.startsWith('/mutation/') && originalBody?.clientMutationId)
      || standaloneAcknowledgement
    ) {
      if (this.authProtocols.authorityDescriptor != null) {
        headers[AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER] = String(
          this.authProtocols.authorityDescriptor,
        );
      }
    }
    return headers;
  }

  async #fetchJson(
    method,
    path,
    body,
    headers,
    {
      signal = undefined,
      successfulResponseFacts = false,
      opaqueSuccessFailure = false,
      includeSenderNonce = false,
      onSenderNonce = null,
      onSenderErrorNonce = null,
      onFetchInvoked = null,
      forbiddenSecrets = [],
    } = {},
  ) {
    let declaredDevOperation = null;
    if (this.__declaredDevEpisodeGate !== null) {
      declaredDevOperation = this.__declaredDevEpisodeGate.beginTopLevelOperation();
      await this.__declaredDevEpisodeGate.ensureVerified(declaredDevOperation, signal);
    }
    if (includeSenderNonce && onSenderNonce !== null) {
      throw new TypeError('sender nonce must have one transport owner');
    }
    if (onSenderNonce !== null && typeof onSenderNonce !== 'function') {
      throw new TypeError('onSenderNonce must be a function');
    }
    if (onSenderErrorNonce !== null && typeof onSenderErrorNonce !== 'function') {
      throw new TypeError('onSenderErrorNonce must be a function');
    }
    if (onFetchInvoked !== null && typeof onFetchInvoked !== 'function') {
      throw new TypeError('onFetchInvoked must be a function');
    }
    const merged = {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headers ?? {}),
    };
    const requestSecrets = collectRequestSecrets(body, merged);
    for (const secret of forbiddenSecrets) addSecret(requestSecrets, secret);
    // @ref LLP 0062#4-auth-the-existing-model-projected--with-explicit-selection — non-redirection is
    // client-enforced, not assumed: every request that carries a credential
    // (bearer/admin/connection headers or secret-classified body fields) is
    // issued with redirects treated as terminal errors, because the platform
    // default follows redirects and a 307/308 would replay a secret to
    // whatever URL a proxy, misconfiguration, or hostile target names.
    const credentialed = requestSecrets.size > 0;
    let res;
    let text;
    try {
      onFetchInvoked?.();
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: Object.keys(merged).length > 0 ? merged : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        ...(credentialed || declaredDevOperation !== null ? { redirect: 'manual' } : {}),
      });
    } catch (error) {
      this.__declaredDevEpisodeGate?.invalidate(declaredDevOperation);
      if (opaqueSuccessFailure) throw opaqueCredentialResponseError();
      throw sanitizeTransportError(error, requestSecrets, { dispatchFailure: true });
    }
    if (!res.ok) this.__declaredDevEpisodeGate?.invalidate(declaredDevOperation);
    if (credentialed && isRedirectResponse(res)) {
      try { await res.body?.cancel?.(); } catch { /* the refusal owns cleanup */ }
      throw redirectRefusedError(res.status);
    }
    const responseSenderNonce = res.headers?.get?.('dpop-nonce') ?? null;
    if (responseSenderNonce !== null && !isCanonicalSenderNonce(responseSenderNonce)) {
      if (opaqueSuccessFailure) throw opaqueCredentialResponseError();
      const error = new Error('SNAPBACK_AUTH_SENDER_PROOF_INVALID: response nonce is invalid');
      error.code = 'SNAPBACK_AUTH_SENDER_PROOF_INVALID';
      error.diagnostic = {
        code: error.code,
        message: 'sender-constrained response nonce is invalid',
      };
      throw error;
    }
    if (responseSenderNonce !== null) addSecret(requestSecrets, responseSenderNonce);
    if (responseSenderNonce !== null && onSenderNonce !== null) {
      await onSenderNonce(responseSenderNonce);
    }
    if (responseSenderNonce !== null && !res.ok && onSenderErrorNonce !== null) {
      await onSenderErrorNonce(responseSenderNonce);
    }
    try {
      const ingressClass = ingressClassForPath(path);
      text = await readBoundedResponseText(res, ingressClass, this.ingressLimits[ingressClass]);
    } catch (error) {
      this.__declaredDevEpisodeGate?.invalidate(declaredDevOperation);
      if (opaqueSuccessFailure) {
        throw opaqueCredentialResponseError();
      }
      // A response object with a known 2xx status may represent a logout that
      // already committed even when its body reader fails. Carry only opaque
      // facts so authLogout can run the captured-authority clear barrier.
      if (res.ok && successfulResponseFacts) {
        return { status: res.status, emptyBody: false, readFailed: true };
      }
      const transportError = sanitizeTransportError(error, requestSecrets);
      // Preserve the known HTTP outcome so callers whose successful response
      // commits an authority transition can distinguish a 2xx body-read
      // failure from a request that never received a committed success.
      transportError.status = res.status;
      throw transportError;
    }
    // Logout needs to distinguish exact empty 204 from a malformed successful
    // response without ever carrying the successful body past this boundary.
    // Non-successes continue through the ordinary sanitized diagnostic path.
    if (res.ok && successfulResponseFacts) {
      return { status: res.status, emptyBody: text === '', readFailed: false };
    }
    // @ref LLP 0032#confirmed-defect-register — S5.D3: check status before
    //   trusting the body as JSON, so a proxy 502 HTML page surfaces as a
    //   structured diagnostic instead of a bare SyntaxError.
    let json = null;
    let parseError = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        parseError = error;
      }
    }
    if (!res.ok) {
      if (opaqueSuccessFailure) {
        throw localIssuerFailure(method, path, res.status, json)
          ?? opaqueCredentialResponseError();
      }
      const rawDiagnostic = json && json.diagnostic
        ? json.diagnostic
        : parseError
          ? { code: 'SNAPBACK_HTTP_ERROR', message: `HTTP ${res.status} with non-JSON body: ${bodySnippet(redactKnownSecrets(text, requestSecrets))}` }
          : { code: `HTTP_${res.status}`, message: text };
      const diag = sanitizeProtocolErrorValue(rawDiagnostic, requestSecrets);
      const error = new SnapbackDiagnosticError(diag, {
        message: diag.message ?? '',
        status: res.status,
        retryable: diag?.details?.retryable,
        retryStrategy: diag?.details?.retryStrategy,
        effectCommitted: diag?.details?.effectCommitted,
        effectMayHaveCommitted: diag?.details?.effectMayHaveCommitted,
      });
      if (isTerminalLiveProtocolRefusal(error)) {
        error.retryable = false;
        error.terminalLiveProtocolRefusal = true;
      }
      const authorityDisposition = finiteAuthorityDisposition(diag);
      if (authorityDisposition !== null) error.authorityDisposition = authorityDisposition;
      if (json?.receipt) {
        error.receipt = sanitizeProtocolErrorValue(json.receipt, requestSecrets);
      }
      if (json?.timing && typeof json.timing === 'object') {
        error.timing = sanitizeProtocolErrorValue(json.timing, requestSecrets);
      }
      // @ref LLP 0055#audit — a non-2xx envelope's `attribution` sibling is
      // retained verbatim (byte-preserving pass-through): it is server-derived
      // and ids-only, and a wrapper that reshaped or redacted it would be
      // mutating an attribution block it cannot re-synthesize. Absent stays
      // absent — this client never fabricates the member.
      if (json && typeof json === 'object' && json.attribution !== undefined) {
        error.attribution = json.attribution;
      }
      throw error;
    }
    if (parseError) {
      if (opaqueSuccessFailure) throw opaqueCredentialResponseError();
      const diag = {
        code: 'SNAPBACK_RESPONSE_NOT_JSON',
        message: `HTTP ${res.status} response is not JSON: ${bodySnippet(redactKnownSecrets(text, requestSecrets))}`,
      };
      throw new SnapbackDiagnosticError(diag, {
        message: diag.message,
        status: res.status,
      });
    }
    return includeSenderNonce ? { body: json, senderNonce: responseSenderNonce } : json;
  }

  #req(method, path, body, headers, options = undefined) {
    return this.#request(method, path, body, headers, options);
  }

  __beginDeclaredDevStandingStreamEpisode(signal = undefined) {
    return this.__declaredDevEpisodeGate?.beginStandingStreamEpisode(signal)
      ?? Promise.resolve(null);
  }

  __markDeclaredDevStandingStreamOpen(episode) {
    return this.__declaredDevEpisodeGate?.markStandingStreamOpen(episode) ?? true;
  }

  __endDeclaredDevStandingStreamEpisode(episode) {
    this.__declaredDevEpisodeGate?.endStandingStreamEpisode(episode);
  }

  async __beforeDeclaredDevTransport(signal = undefined) {
    if (this.__declaredDevEpisodeGate === null) return null;
    const operation = this.__declaredDevEpisodeGate.beginTopLevelOperation();
    await this.__declaredDevEpisodeGate.ensureVerified(operation, signal);
    return operation;
  }

  __afterDeclaredDevTransport(response, operation) {
    if (response?.ok !== true) this.__declaredDevEpisodeGate?.invalidate(operation);
  }

  __invalidateDeclaredDevEpisode(operation) {
    this.__declaredDevEpisodeGate?.invalidate(operation);
  }

  #adminReq(method, path, body, headers) {
    return this.#request(method, path, body, headers, { admin: true });
  }

  health() { return this.#req('GET', '/health'); }
  async inspect() {
    const origin = canonicalServerOrigin(this.baseUrl);
    let inspection;
    try {
      inspection = await this.#req(
        'GET',
        '/inspect',
        undefined,
        this.#authOfferHeaders(false),
      );
    } catch (cause) {
      // An HTTP answer is current target evidence even when it is a refusal
      // or proxy error. Only a request that produced no Response preserves
      // the predecessor fact for a possible automatic enqueue fallback.
      if (!isConnectivityFailureError(cause)) {
        await this.#recordOfflineMutationReplayCapabilityFact(
          offlineMutationReplayCapabilityFactFromAnsweredError(cause, origin),
        );
      }
      throw cause;
    }
    await this.#recordOfflineMutationReplayCapabilityFact(
      offlineMutationReplayCapabilityFactFromInspection(inspection, origin),
    );
    return inspection;
  }

  // @ref LLP 0043#target-settlement-ledger-capability-gate-2026-08-12 —
  // durable enqueue/replay requires a positive server-ledger advertisement.
  // @ref LLP 0058#target-capability-registry-amendment--offline-mutation-replay-2026-08-12 —
  // a missing capability gap is never positive support; inspect the closed
  // supportedCapabilities set on both local and Cloudflare payload shapes.
  async #recordOfflineMutationReplayCapabilityFact(fact) {
    const normalized = normalizeOfflineMutationReplayCapabilityFact(fact);
    if (normalized === null) return null;
    let store = null;
    try { store = this.#offlineQueueStore(false); } catch { store = null; }
    if (typeof store?.commitOfflineMutationReplayCapabilityFact === 'function') {
      try {
        const committed = await store.commitOfflineMutationReplayCapabilityFact(normalized);
        if (
          committed !== false
          && typeof store.readOfflineMutationReplayCapabilityFact === 'function'
        ) {
          const shared = normalizeOfflineMutationReplayCapabilityFact(
            await store.readOfflineMutationReplayCapabilityFact(),
          );
          if (shared !== null) {
            this.__observedOfflineMutationReplayCapability = shared;
            this.__offlineMutationReplayCapabilityLocalOverride = null;
            return shared;
          }
        }
      } catch { /* the fresh answer remains usable only by its direct caller */ }
    }
    // A follower may receive a newer answered negative while its writer
    // broker is unavailable. The durable predecessor is then incoherent for
    // this observer: retain the negative locally so writer takeover cannot
    // resurrect an older positive. A later answered positive from this exact
    // canonical target clears the override; an uncommitted positive alone is
    // never promoted into durable cached evidence.
    if (normalized.supported === false) {
      this.__offlineMutationReplayCapabilityLocalOverride = normalized;
    } else if (
      this.__offlineMutationReplayCapabilityLocalOverride?.origin === normalized.origin
    ) {
      this.__offlineMutationReplayCapabilityLocalOverride = null;
    }
    this.__observedOfflineMutationReplayCapability = normalized;
    return normalized;
  }

  async #cachedOfflineMutationReplayCapabilityFact(expectedGeneration) {
    let store = null;
    try { store = this.#offlineQueueStore(false); } catch { store = null; }
    let fact = normalizeOfflineMutationReplayCapabilityFact(
      this.__offlineMutationReplayCapabilityLocalOverride,
    );
    if (fact !== null) {
      // An answered negative that could not coherently replace shared bytes
      // is authoritative for this client until a later answered positive.
      this.__observedOfflineMutationReplayCapability = fact;
    } else if (typeof store?.readOfflineMutationReplayCapabilityFact === 'function') {
      try {
        // Shared bytes are authoritative over every process cache. This read
        // occurs after the writer-routed replacement settles, so a negative
        // answered in another context invalidates a predecessor positive.
        fact = normalizeOfflineMutationReplayCapabilityFact(
          await store.readOfflineMutationReplayCapabilityFact(),
        );
      } catch { fact = null; }
      this.__observedOfflineMutationReplayCapability = fact;
    } else {
      fact = this.__observedOfflineMutationReplayCapability;
    }
    if (
      fact?.supported !== true
      || fact.origin !== canonicalServerOrigin(this.baseUrl)
      // Generated references must equal every artifact identity component.
      // String-named mutations carry no generation, so their cached boundary
      // is the canonical origin rather than an invented operation witness.
      || fact.artifactGeneration === null
      || (
        expectedGeneration !== null
        && !sameArtifactGeneration(fact.artifactGeneration, expectedGeneration)
      )
    ) return null;
    return fact;
  }

  async #offlineMutationReplayCapabilityFact({
    allowCachedForEnqueue = false,
    expectedGeneration = null,
  } = {}) {
    if (this.__offlineMutationReplayCapability !== null) {
      return Object.freeze({
        supported: this.__offlineMutationReplayCapability,
        reason: this.__offlineMutationReplayCapability ? null : 'not-advertised',
        targetProfileId: null,
        evidence: 'configured',
      });
    }
    let inspection;
    try {
      inspection = await this.inspect();
    } catch (cause) {
      // @ref LLP 0043#target-settlement-ledger-capability-gate-2026-08-12 —
      // only queue:'auto' may reuse a target-bound prior positive after a
      // genuine no-Response transport loss. Answered HTTP errors replace it,
      // and replay never sets allowCachedForEnqueue.
      if (allowCachedForEnqueue && isConnectivityFailureError(cause)) {
        const cached = await this.#cachedOfflineMutationReplayCapabilityFact(
          expectedGeneration,
        );
        if (cached !== null) return Object.freeze({ ...cached, evidence: 'cached' });
      }
      return Object.freeze({
        supported: false,
        reason: isConnectivityFailureError(cause)
          ? 'inspection-unavailable'
          : 'inspection-refused',
        targetProfileId: null,
        cause,
      });
    }
    const fact = offlineMutationReplayCapabilityFactFromInspection(
      inspection,
      canonicalServerOrigin(this.baseUrl),
    );
    if (
      fact.supported
      && expectedGeneration !== null
      && (
        fact.artifactGeneration === null
        || !sameArtifactGeneration(fact.artifactGeneration, expectedGeneration)
      )
    ) {
      return Object.freeze({
        ...fact,
        supported: false,
        reason: 'target-identity-mismatch',
        evidence: 'fresh',
      });
    }
    return Object.freeze({ ...fact, evidence: 'fresh' });
  }

  async #observeOfflineMutationReplayCapabilityFromLifecycle() {
    if (
      this.__offlineMutationReplayCapability !== null
      || this.#offlineQueueStore(false) === null
    ) return null;
    if (this.__offlineMutationReplayLifecycleProbe === null) {
      const task = this.#offlineMutationReplayCapabilityFact();
      this.__offlineMutationReplayLifecycleProbe = task;
      this.__offlineMutationReplayLifecycleSettlement = task.then((fact) => Object.freeze({
        supported: fact?.supported === true,
        reason: typeof fact?.reason === 'string' ? fact.reason : null,
        targetProfileId: typeof fact?.targetProfileId === 'string'
          ? fact.targetProfileId
          : null,
        evidence: typeof fact?.evidence === 'string' ? fact.evidence : null,
      }));
      void this.__offlineMutationReplayLifecycleSettlement.catch(() => {});
      void task.finally(() => {
        if (this.__offlineMutationReplayLifecycleProbe === task) {
          this.__offlineMutationReplayLifecycleProbe = null;
        }
      }).catch(() => {});
      return task;
    }
    return this.__offlineMutationReplayLifecycleProbe;
  }

  /** Settle the latest target-capability observation scheduled by ordinary
   * query/live-query lifecycle. This is the public coordination boundary for
   * discovery; applications never need to poll RQS store metadata. */
  whenOfflineMutationReplayCapabilitySettled() {
    return this.__offlineMutationReplayLifecycleSettlement;
  }

  async #requireOfflineMutationReplayCapability() {
    const fact = await this.#offlineMutationReplayCapabilityFact();
    if (!fact.supported) throw offlineQueueSettlementLedgerError(fact);
    return fact;
  }

  #runtimeCostOwnershipTuple() {
    const authority = this.authorityTransitionStatus();
    const settledAuthority = Object.freeze({
      state: authority.state,
      settled: authority.settled === true,
      transitionOwner: authority.transitionOwner ?? null,
      barrierPhase: authority.barrierPhase ?? null,
    });
    let serverOrigin = this.baseUrl;
    try { serverOrigin = new URL(this.baseUrl).origin; } catch { /* relative development base */ }
    return Object.freeze({
      canonicalAppId: this.__inspectionAppId,
      storagePartition: this.clientStoreId,
      serverOrigin,
      settledAuthority,
    });
  }

  #recordMutationPhaseCost({
    clientMutationId,
    functionId,
    disposition,
    timing,
    committedVersion = null,
    observedAtMs = Date.now(),
  }) {
    if (
      typeof clientMutationId !== 'string'
      || clientMutationId.length === 0
      || typeof functionId !== 'string'
      || functionId.length === 0
      || typeof disposition !== 'string'
      || disposition.length === 0
    ) return false;

    if (
      Number.isSafeInteger(committedVersion)
      && Number.isFinite(observedAtMs)
    ) {
      this.__mutationCommitObservationSequence += 1;
      this.__mutationCommitObservations.set(
        this.__mutationCommitObservationSequence,
        Object.freeze({
          version: committedVersion,
          observedAtMs,
          sequence: this.__mutationCommitObservationSequence,
        }),
      );
      while (this.__mutationCommitObservations.size > MUTATION_PHASE_COST_RECORD_LIMIT) {
        this.__mutationCommitObservations.delete(
          this.__mutationCommitObservations.keys().next().value,
        );
      }
    }

    let record;
    try {
      record = mutationPhaseCostRecord({
        clientMutationId,
        functionId,
        timing,
        disposition,
      });
    } catch {
      return false;
    }

    let aggregate = this.__mutationPhaseCostCounters.get(functionId) ?? null;
    if (aggregate === null) {
      if (this.__mutationPhaseCostCounters.size >= MUTATION_PHASE_COST_COUNTER_KEY_LIMIT) {
        const oldestKey = this.__mutationPhaseCostCounters.keys().next().value;
        const evicted = this.__mutationPhaseCostCounters.get(oldestKey);
        this.__mutationPhaseCostCounters.delete(oldestKey);
        mergeMutationPhaseAggregates(this.__mutationPhaseCostOtherKeys, evicted);
        this.__mutationPhaseCostEvictedKeys += 1;
      }
      aggregate = emptyMutationPhaseAggregate(functionId);
    } else {
      this.__mutationPhaseCostCounters.delete(functionId);
    }
    addMutationPhaseRecordToAggregate(aggregate, record);
    this.__mutationPhaseCostCounters.set(functionId, aggregate);

    this.__mutationPhaseCostEventSequence += 1;
    const eventSequence = this.__mutationPhaseCostEventSequence;
    if (
      eventSequence > MUTATION_PHASE_COST_DETAIL_SAMPLING_THRESHOLD
      && eventSequence % MUTATION_PHASE_COST_DETAIL_SAMPLE_EVERY !== 0
    ) {
      this.__mutationPhaseCostDroppedRecords += 1;
      return true;
    }

    // The ring's storage and byte accounting are over the exact gated
    // inspection projection. Exact counters are updated at terminal event
    // seams before sampling or eviction, and the ring key is framework-only.
    const projectedRecord = projectMutationPhaseCostV1({
      clientMutationId,
      functionId,
      timing,
      disposition,
    });
    const bytes = utf8ByteLength(JSON.stringify(projectedRecord));
    if (bytes > MUTATION_PHASE_COST_BYTE_LIMIT) {
      this.__mutationPhaseCostDroppedRecords += 1;
      return true;
    }
    while (
      this.__mutationPhaseCostRecords.size >= MUTATION_PHASE_COST_RECORD_LIMIT
      || this.__mutationPhaseCostRetainedBytes + bytes > MUTATION_PHASE_COST_BYTE_LIMIT
    ) {
      const oldestId = this.__mutationPhaseCostRecords.keys().next().value;
      const oldest = this.__mutationPhaseCostRecords.get(oldestId);
      this.__mutationPhaseCostRecords.delete(oldestId);
      this.__mutationPhaseCostRetainedBytes -= oldest.bytes;
      this.__mutationPhaseCostDroppedRecords += 1;
    }
    this.__mutationPhaseCostRecords.set(eventSequence, {
      record: projectedRecord,
      bytes,
    });
    this.__mutationPhaseCostRetainedBytes += bytes;
    return true;
  }

  #observeCoveringLiveDelivery(handle, deliveredVersion, deliveredAtMs) {
    if (!Number.isSafeInteger(deliveredVersion) || !Number.isFinite(deliveredAtMs)) return;
    const coveredSequences = handle.__coveredMutationCostObservationSequences;
    for (const sequence of coveredSequences) {
      if (!this.__mutationCommitObservations.has(sequence)) coveredSequences.delete(sequence);
    }
    let covered = null;
    for (const [sequence, observation] of this.__mutationCommitObservations) {
      if (coveredSequences.has(observation.sequence) || observation.version > deliveredVersion) {
        continue;
      }
      coveredSequences.add(sequence);
      if (covered === null || observation.sequence > covered.sequence) {
        covered = observation;
      }
    }
    if (covered === null || deliveredAtMs < covered.observedAtMs) return;
    handle.deliveryLagMs = deliveredAtMs - covered.observedAtMs;
  }

  async #recordRestoredMutationPhaseCosts(store) {
    let records;
    try {
      records = await store.outboxRecords();
    } catch {
      return;
    }
    for (const record of records) {
      const disposition = record?.status === 'result-gone'
        ? 'resultGone'
        : ['settled', 'failed', 'stranded', 'quarantined'].includes(record?.status)
          ? record.status
          : null;
      if (disposition === null) continue;
      this.#recordMutationPhaseCost({
        clientMutationId: record.id,
        functionId: record.function,
        disposition,
        timing: mutationTiming(record),
        committedVersion: record.settlement?.version ?? null,
        observedAtMs: record.settledAt ?? record.quarantinedAt ?? record.strandedAt ?? Date.now(),
      });
    }
  }

  mutationPhaseCostInspection() {
    return freezeDeep({
      format: 'snapback.mutation-phase-cost-inspection.v1',
      records: [...this.__mutationPhaseCostRecords.values()].map(({ record }) => record),
      counters: [...this.__mutationPhaseCostCounters.values()].map(
        freezeMutationPhaseAggregate,
      ),
      otherKeys: freezeMutationPhaseAggregate(this.__mutationPhaseCostOtherKeys),
      evictedKeys: this.__mutationPhaseCostEvictedKeys,
      droppedRecords: this.__mutationPhaseCostDroppedRecords,
      retainedBytes: this.__mutationPhaseCostRetainedBytes,
      recordLimit: MUTATION_PHASE_COST_RECORD_LIMIT,
      byteLimit: MUTATION_PHASE_COST_BYTE_LIMIT,
    });
  }

  #runtimeCostOwnershipIdentityTuple({ authorityCapture, userId, appId }) {
    const projection = this.#runtimeCostOwnershipTuple();
    const settledAuthority = typeof authorityCapture?.authorityKey === 'string'
      ? Object.freeze({ kind: 'authority-key', authorityKey: authorityCapture.authorityKey })
      : typeof userId === 'string'
        ? Object.freeze({ kind: 'development-user', userId })
        : Object.freeze({ kind: 'anonymous' });
    return Object.freeze({
      canonicalAppId: typeof appId === 'string' ? appId : projection.canonicalAppId,
      storagePartition: projection.storagePartition,
      serverOrigin: projection.serverOrigin,
      settledAuthority,
    });
  }

  #recordRuntimeCostOutboxEnqueue(stored, functionId) {
    if (stored?.insertionOwned !== true) return;
    try {
      this.__runtimeCostDiagnostics.recordEquivalentEnqueue({
        functionId,
        args: stored.args,
      });
      this.__runtimeCostDiagnostics.recordHousekeepingSupersessions(
        stored.housekeepingSupersessions,
      );
    } catch { /* diagnostics are observational and cannot own enqueue */ }
  }

  // Internal framework adapters report only already-admitted, value-free
  // ownership facts. These methods are intentionally absent from index.d.mts.
  __registerRuntimeCostSubscription(token, {
    functionId,
    args,
    ownerLabel,
    ownershipTuple = this.#runtimeCostOwnershipTuple(),
  }) {
    try {
      this.__runtimeCostDiagnostics.registerSubscription({
        token,
        functionId,
        args,
        ownerLabel,
        ownershipTuple,
      });
    } catch { /* diagnostics are observational and cannot own subscribe */ }
  }

  __unregisterRuntimeCostSubscription(token) {
    try { this.__runtimeCostDiagnostics.unregisterSubscription(token); } catch { /* observational */ }
  }

  __recordRuntimeCostAssetIssuance(fact) {
    try { this.__runtimeCostDiagnostics.recordAssetIssuance(fact); } catch { /* observational */ }
  }

  // @ref LLP 0107#package-and-acceptance — retained cleanup evidence inspects
  // only caller-known labels and finite resource counts; it never exposes
  // grant tokens, wire ids, payloads, or authority facts.
  localResourceInspection(connectionIds = null) {
    const selected = connectionIds === null
      ? null
      : new Set(Array.from(connectionIds, (value) => String(value)));
    const includes = (connectionId) => selected === null || selected.has(connectionId);
    const authority = this.authorityTransitionStatus();
    const ownershipTuple = projectOwnershipTupleInspectionV1(
      this.#runtimeCostOwnershipTuple(),
    );
    const outboxSuspensionReason = authority.transitionOwner !== null
      ? 'auth-barrier'
      : this.__outboxDrainStartBlockedReason
        ?? this.__outboxLastReplayStop?.reason
        ?? null;
    const managers = Object.freeze(
      [...(this.__liveStreamManagers?.entries?.() ?? [])]
        .filter(([connectionId]) => includes(connectionId))
        .map(([connectionId, manager]) => Object.freeze({
          ...manager.inspection(),
          connectionId: inspectionPseudonymV1(connectionId),
          ownershipTuple,
        })),
    );
    const grantLabels = Object.freeze(
      [...this.__connectionGrants.keys()]
        .filter(includes)
        .map(inspectionPseudonymV1)
        .sort(),
    );
    const laneConsumers = Object.freeze(
      [...this.__laneConsumers.entries()]
        .filter(([connectionId]) => includes(connectionId))
        .map(([connectionId, lanes]) => Object.freeze({
          connectionId: inspectionPseudonymV1(connectionId),
          durable: lanes?.durable?.size ?? 0,
          ephemeral: lanes?.ephemeral?.size ?? 0,
        })),
    );
    const subscriptions = Object.freeze(
      [...this.__liveQueryOwners.values()]
        .filter((entry) => includes(entry.connectionId))
        .map((entry) => {
          const authorization = entry.handle.authorizationState?.() ?? null;
          return Object.freeze({
            owner: entry.owner,
            connectionId: inspectionPseudonymV1(entry.connectionId),
            subscriptionId: entry.handle.inspectionSubscriptionId,
            functionName: entry.functionName,
            state: entry.handle.paused ? 'paused' : 'active',
            subscriptionState: entry.handle.inspectionSubscriptionState,
            connection: entry.handle.connection,
            connectionState: entry.handle.inspectionConnectionState,
            supersedesSubscriptionId: entry.handle.inspectionSupersedesSubscriptionId,
            snapshotVersion: entry.handle.authoritativeRevision,
            lastDeliveryAtMs: entry.handle.lastDeliveryAtMs,
            authoritativeRevision: entry.handle.authoritativeRevision,
            deliveryLagMs: entry.handle.deliveryLagMs,
            suppressedEqualSnapshots: entry.handle.suppressedEqualSnapshots,
            terminalCode: entry.handle.terminalDiagnosticCode,
            ownershipTuple,
            authBarrier: authorization?.lifecycle ?? null,
            readiness: ['live', 'polling'].includes(entry.handle.connection)
              ? 'ready'
              : 'waiting',
            outboxSuspensionReason,
          });
        }),
    );
    return Object.freeze({
      managers,
      managerCount: managers.length,
      grants: grantLabels,
      ownershipTuple,
      outboxSuspensionReason,
      grantCount: grantLabels.length,
      laneConsumers,
      subscriptions,
      mutationPhaseCosts: this.mutationPhaseCostInspection(),
      subscriptionCount: subscriptions.length,
      runtimeCostDiagnostics: this.__runtimeCostDiagnostics.snapshot(),
      socketDemand: managers.reduce((sum, manager) => sum + manager.socketDemand, 0),
      timers: managers.reduce(
        (sum, manager) => sum + manager.reconnectTimer + manager.heartbeatTimer,
        0,
      ),
      listeners: managers.reduce(
        (sum, manager) => sum
          + manager.durableListeners
          + manager.ephemeralListeners
          + manager.stateListeners
          + manager.readinessListeners,
        0,
      ),
    });
  }
  __registerInspectionAppId(appId) {
    if (typeof appId !== 'string' || appId.length === 0) return;
    if (this.__inspectionAppId === null) this.__inspectionAppId = appId;
  }
  prepareReactBinding(options) {
    return prepareReactBindingForClient(this, options);
  }

  // The store family is a Full-profile capability. A literal dynamic import is
  // the bundler-visible code-splitting seam; the metrology runner measures the
  // entry's static closure and reports the optional chunk independently.
  async __ensureStoreRuntimeModule() {
    if (this.__storeRuntimeModule) return this.__storeRuntimeModule;
    if (!this.__storeRuntimeModulePromise) {
      this.__storeRuntimeModulePromise = import('./store-runtime.mjs')
        .catch((error) => { throw storeRuntimeLoadError(error); })
        .then((module) => {
          this.__storeRuntimeModule = module;
          module.initializeStoreRuntimeClient(this, this.__storeRuntimeConfiguration);
          return module;
        }).catch((error) => {
          this.__storeRuntimeModulePromise = null;
          throw error;
        });
    }
    return this.__storeRuntimeModulePromise;
  }

  async __storeRuntimeInvoke(name, ...args) {
    if (
      this.__externalBearerRetainedReadsFenced()
      && EXTERNAL_BEARER_FENCED_STORE_READS.has(name)
    ) throw externalBearerPredecessorFencedError();
    const module = await this.__ensureStoreRuntimeModule();
    return module.storeRuntimeMethods[name].call(this, ...args);
  }

  __storeFunctionName(ref) { return functionName(ref); }
  __storeValidateGeneratedArguments(ref, args) {
    return validateGeneratedArguments(ref, args, functionName(ref));
  }

  async __replacePreloadRouteBoot(payload, options = {}) {
    if (payload === null || options?.functionReferences == null) {
      return GRANDFATHERED_PRELOAD_RECEIPT;
    }
    return this.__storeRuntimeInvoke('__replacePreloadRouteBoot', payload, options);
  }

  async __replacePreloadManifestInForce(...args) {
    return this.__storeRuntimeInvoke('__replacePreloadManifestInForce', ...args);
  }

  __queueStoreMaintenance(delayMs = 0) {
    if (!this.__storeRuntimeModule) return false;
    return this.__storeRuntimeModule.storeRuntimeMethods.__queueStoreMaintenance.call(
      this,
      delayMs,
    );
  }

  async __runStoreMaintenance(...args) {
    return this.__storeRuntimeInvoke('__runStoreMaintenance', ...args);
  }

  async storePolicyInspection(...args) {
    return this.__storeRuntimeInvoke('storePolicyInspection', ...args);
  }

  __storePolicyRuntimeInspection() {
    if (!this.__storeRuntimeModule) {
      return Object.freeze({
        constructed: false,
        scheduled: false,
        running: false,
        lastErrorCode: null,
      });
    }
    return this.__storeRuntimeModule.storeRuntimeMethods.__storePolicyRuntimeInspection.call(this);
  }

  async __prepareGeneratedMaterializationBridge(ref, ...args) {
    if (
      this.__externalBearerRetainedReadsFenced()
      || ref?.artifacts?.trustedCompositionActivation == null
      || ref?.composition == null
      || typeof this.rqsStore?.materializationTransaction !== 'function'
    ) return null;
    return this.__storeRuntimeInvoke('__prepareGeneratedMaterializationBridge', ref, ...args);
  }

  async __registerActiveQueryDemand(ref, args, persistResume, preparedBridge = null, userId = null) {
    if (preparedBridge === null) {
      const suppliedAddress = ref?.clientMaterializationAddress
        ?? ref?.materializationAddress
        ?? null;
      const suppliedQmk = (
        Array.isArray(suppliedAddress)
        && /^qmk1\.[A-Za-z0-9_-]{43}$/u.test(suppliedAddress[2] ?? '')
      ) || /^qmk1\.[A-Za-z0-9_-]{43}$/u.test(ref?.materializationKey ?? '');
      if (!suppliedQmk && this.__preloadRegistrationPromise === null) {
        return Object.freeze({
          registrationId: null,
          publishLiveAnswer: () => false,
          clearLiveAnswer: () => false,
          release: () => Promise.resolve(),
        });
      }
    }
    return this.__storeRuntimeInvoke(
      '__registerActiveQueryDemand',
      ref,
      args,
      persistResume,
      preparedBridge,
      userId,
    );
  }

  async registerQuery(...args) {
    return this.__storeRuntimeInvoke('registerQuery', ...args);
  }

  __registerOutcome(...args) {
    return this.__storeRuntimeModule.storeRuntimeMethods.__registerOutcome.call(this, ...args);
  }

  async evaluateLocalResultTransform(...args) {
    return this.__storeRuntimeInvoke('evaluateLocalResultTransform', ...args);
  }

  async releaseQueryRegistration(...args) {
    return this.__storeRuntimeInvoke('releaseQueryRegistration', ...args);
  }

  async __readQmk1LocalAnswer(...args) {
    return this.__storeRuntimeInvoke('__readQmk1LocalAnswer', ...args);
  }

  async __admitLocalMutationReads(...args) {
    return this.__storeRuntimeInvoke('__admitLocalMutationReads', ...args);
  }

  async __evaluateLocalMutationWithReadAdmission(...args) {
    return this.__storeRuntimeInvoke('__evaluateLocalMutationWithReadAdmission', ...args);
  }

  // Internal Move-3 Phase-1 composition seam retained for focused tests; M4's
  // public view below wraps the same outbox/registration/store composition.
  async __createOptimisticRebaseEngine({
    initialAuthoritativeRows = {},
    connected = false,
  } = {}) {
    return this.__storeRuntimeInvoke('__createOptimisticRebaseEngine', {
      outboxStore: this.rqsStore,
      initialAuthoritativeRows,
      connected,
    });
  }

  // Public Move-3 view: authoritative rows are supplied by the app's live
  // query, while every private layer is replayed from the durable outbox.
  // @ref LLP 0155#rebase — delivery replaces the base and retires identities;
  // remaining generated operations replay atomically in durable sequence.
  async createOptimisticMutationView({
    authoritativeRows = {},
    connected = false,
  } = {}) {
    const outboxStore = this.#offlineQueueStore(true);
    await this.#reconcileQueueCustody(outboxStore, { required: true });
    return this.__storeRuntimeInvoke('createOptimisticMutationView', outboxStore, {
      authoritativeRows,
      connected,
    });
  }

  // Ordinary query handles own one table-scoped view over the same rebase
  // engine as the compatibility API above. The merged record seam chooses
  // durable outbox identity whenever available and the bounded ephemeral
  // ledger otherwise; callers never author a reducer or materialization id.
  async __createGeneratedOptimisticMaterializationView({
    authoritativeRows = {},
    connected = false,
    materializationIdentity,
    table,
    projectionMode = 'project',
  } = {}) {
    if (typeof table !== 'string' || table.length === 0) return null;
    return this.__storeRuntimeInvoke(
      'createOptimisticMutationView',
      this.__optimisticRecordStore,
      {
        authoritativeRows,
        connected,
        materializationIdentity: materializationIdentity ?? null,
        targetTables: [table],
        projectionMode,
      },
    );
  }

  async __optimisticMutationDisposition(clientMutationId) {
    const ephemeral = this.__ephemeralOptimisticRecords.get(clientMutationId) ?? null;
    if (ephemeral !== null) {
      if (ephemeral.status === 'settled') {
        return Object.freeze({
          status: 'settled',
          settlement: structuredClone(ephemeral.settlement),
          settledAt: ephemeral.settledAt,
          record: structuredClone(ephemeral),
        });
      }
      if (ephemeral.status === 'failed') {
        return Object.freeze({
          status: 'failed',
          failure: structuredClone(ephemeral.failure),
          record: structuredClone(ephemeral),
        });
      }
      return Object.freeze({
        status: 'pending',
        blockedReason: null,
        record: structuredClone(ephemeral),
      });
    }
    const disposition = await this.mutationStatus(clientMutationId);
    let record = null;
    try {
      record = (await this.__optimisticRecordStore.outboxRecords())
        .find((candidate) => candidate?.id === clientMutationId) ?? null;
    } catch { /* disposition remains inspectable without the private record */ }
    return Object.freeze({
      ...disposition,
      record: record === null ? null : structuredClone(record),
    });
  }

  #installEphemeralOptimisticRecord(record, sequence) {
    const enqueuedAt = Date.now();
    const stored = Object.freeze({
      ...structuredClone(record),
      sequence,
      status: 'pending',
      enqueuedAt,
      // This process-local optimistic carrier was never durably enqueued.
      timing: mutationTiming({ enqueuedAt }),
    });
    this.__ephemeralOptimisticRecords.set(stored.id, stored);
    while (this.__ephemeralOptimisticRecords.size > 256) {
      const removable = [...this.__ephemeralOptimisticRecords.values()]
        .find((entry) => entry.status !== 'pending');
      if (removable === undefined) break;
      this.__ephemeralOptimisticRecords.delete(removable.id);
    }
    this.#notifyOutboxListeners();
    return stored;
  }

  #settleEphemeralOptimisticRecord(clientMutationId, settlement) {
    const record = this.__ephemeralOptimisticRecords.get(clientMutationId) ?? null;
    if (record === null) return false;
    const settled = Object.freeze({
      ...record,
      status: 'settled',
      settlement: structuredClone(settlement),
      settledAt: Date.now(),
      timing: mutationTiming({ ...record, settlement }),
    });
    this.__ephemeralOptimisticRecords.set(clientMutationId, settled);
    this.#recordMutationPhaseCost({
      clientMutationId,
      functionId: settled.function,
      disposition: 'settled',
      timing: settled.timing,
      committedVersion: settlement?.version ?? null,
      observedAtMs: settled.settledAt,
    });
    this.#notifyOutboxListeners();
    return true;
  }

  #markEphemeralOptimisticDispatched(clientMutationId) {
    const record = this.__ephemeralOptimisticRecords.get(clientMutationId) ?? null;
    if (record === null || record.timing?.dispatchedAtMs !== null) return false;
    this.__ephemeralOptimisticRecords.set(clientMutationId, Object.freeze({
      ...record,
      timing: Object.freeze({ ...record.timing, dispatchedAtMs: Date.now() }),
    }));
    this.#notifyOutboxListeners();
    return true;
  }

  #failEphemeralOptimisticRecord(clientMutationId, error) {
    const record = this.__ephemeralOptimisticRecords.get(clientMutationId) ?? null;
    if (record === null) return false;
    const failed = Object.freeze({
      ...record,
      status: 'failed',
      failure: {
        code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_MUTATION_REFUSED',
        message: error?.message ?? String(error),
      },
      timing: mutationTiming({ ...record, settlement: { timing: error?.timing } }),
    });
    this.__ephemeralOptimisticRecords.set(clientMutationId, failed);
    this.#recordMutationPhaseCost({
      clientMutationId,
      functionId: failed.function,
      disposition: 'failed',
      timing: failed.timing,
    });
    this.#notifyOutboxListeners();
    return true;
  }

  #optimisticPresentationDisposition(clientMutationId) {
    for (const { engine } of this.__optimisticMutationViews) {
      const snapshot = engine.getSnapshot();
      if (snapshot.layers.some((entry) => entry.clientMutationId === clientMutationId)) {
        return 'installed';
      }
    }
    return 'withheld';
  }

  async #refreshOptimisticMutationViews(cause) {
    await Promise.all([...this.__optimisticMutationViews].map(({ engine }) => (
      engine.refresh({ cause })
    )));
  }

  async authRequestCode(email) {
    if (this.authCoordinator) await this.authSession();
    const capture = this.authCoordinator?.capture() ?? null;
    const response = projectChallengeResponse(await this.#trackedFetchJson(
      'POST',
      '/auth/request-code',
      { email },
      this.#authOfferHeaders(true, null),
      { opaqueSuccessFailure: true },
    ));
    if (!response) throw opaqueCredentialResponseError();
    if (!this.authCoordinator) return response;
    const committed = await this.commitAuthorityPublication(capture, () => (
      markAuthorityCapture(response, capture)
    ));
    if (!committed.committed) throw staleAuthorityError();
    return committed.value;
  }

  async authStepUpRequest({ operation }) {
    if (operation !== 'passwordSet') {
      throw new TypeError('authStepUpRequest operation must be passwordSet');
    }
    if (!this.authCoordinator) {
      throw new TypeError('authStepUpRequest requires AuthCoordinator custody');
    }
    this.#requirePasswordBearerCustody();
    await this.authSession();
    const capture = this.authCoordinator.capture();
    const bearer = this.authCoordinator.credentialFor(capture).bearer;
    const response = projectChallengeResponse(await this.#trackedFetchJson(
      'POST',
      '/auth/step-up/request',
      { operation },
      this.#authOfferHeaders(true, bearer),
      { forbiddenSecrets: [bearer] },
    ));
    if (!response) throw opaqueCredentialResponseError();
    const committed = await this.commitAuthorityPublication(capture, () => (
      markAuthorityCapture(response, capture)
    ));
    if (!committed.committed) throw staleAuthorityError();
    return committed.value;
  }

  // The provider returns a bearer, but coordinated clients never publish it
  // to app code. Custody advances and every local participant resumes before
  // this method exposes the non-secret session projection.
  async authExchange({ challengeId, code }) {
    if (!this.authCoordinator) {
      throw new TypeError('authExchange requires AuthCoordinator custody');
    }
    await this.authSession();
    const capture = this.authCoordinator.capture();
    const predecessor = this.authCoordinator.credentialFor(capture);
    if (predecessor.authority.kind !== 'anonymous') {
      throw staleAuthorityError();
    }
    let senderConstraint = null;
    let requestBody = { challengeId, code };
    let responseEnvelope;
    if (this.senderConstrained) {
      const generated = await generateSenderConstraintKey();
      const proof = await createSenderIssuanceProofForCustody({
        privateKey: generated.privateKey,
        publicJwk: generated.publicJwk,
        challengeId,
        canonicalExchangeUri: canonicalSenderExternalUri(this.baseUrl, '/auth/exchange'),
        issuedAtSeconds: Math.floor(Date.now() / 1_000),
        proofId: senderProofId(),
      });
      requestBody = {
        challengeId,
        code,
        senderConstraint: {
          protocol: SENDER_ISSUANCE_PROTOCOL,
          publicJwk: generated.publicJwk,
          proof,
        },
      };
      responseEnvelope = await this.#trackedFetchJson(
        'POST',
        '/auth/exchange',
        requestBody,
        this.#authOfferHeaders(true, null),
        { opaqueSuccessFailure: true, includeSenderNonce: true },
      );
      if (responseEnvelope.senderNonce === null) {
        throw senderIndeterminateSuccessError();
      }
      if (!isCanonicalSenderNonce(responseEnvelope.senderNonce)) {
        throw opaqueCredentialResponseError();
      }
      senderConstraint = {
        formatVersion: 1,
        protocol: SENDER_PROTOCOL,
        custodyGeneration: 1,
        privateKey: generated.privateKey,
        publicJwk: generated.publicJwk,
        thumbprint: generated.thumbprint,
        nonce: senderNonceRecord(responseEnvelope.senderNonce, 1),
      };
    } else {
      responseEnvelope = {
        body: await this.#trackedFetchJson(
          'POST',
          '/auth/exchange',
          requestBody,
          this.#authOfferHeaders(true, null),
          { opaqueSuccessFailure: true },
        ),
      };
    }
    const response = this.#validateCredentialResponse(
      responseEnvelope.body,
      [challengeId, code],
    );
    // The POST is deliberately outside custody ownership. Reconcile its
    // result against a fresh settled capture: an internal /auth/session may
    // have advanced the authority while the credential exchange was in
    // flight, and submitting the pre-POST capture would apply the exchange
    // result against an obsolete authorization-stream incarnation.
    // @ref LLP 0059#coordinator-interface — a different current authority is
    // a typed stale result; only an exact requested successor is idempotent.
    let currentCapture;
    try {
      currentCapture = this.authCoordinator.capture();
    } catch (error) {
      if (
        error?.code === 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
        || error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
      ) throw staleAuthorityError();
      throw error;
    }
    const current = this.authCoordinator.credentialFor(currentCapture);
    const authority = credentialAuthority(
      response,
      'sessions',
      current.authority.authorizationStreamIncarnation,
    );
    if (current.authority.kind !== 'anonymous') {
      if (sameClientAuthority(current.authority, authority)) {
        const projected = credentialPublicProjection(response);
        this.#publishCredentialPrincipal(projected);
        return projected;
      }
      throw staleAuthorityError();
    }
    await this.#transitionCredentialAuthority(currentCapture, {
      authority,
      bearer: response.token,
      refreshAfterMs: response.refreshAfter,
      ...(senderConstraint === null ? {} : { senderConstraint }),
    });
    const projected = credentialPublicProjection(response);
    this.#publishCredentialPrincipal(projected);
    return projected;
  }

  #requirePasswordBearerCustody() {
    if (!this.senderConstrained) return;
    throw clientCodedError(new Error(
      'SNAPBACK_AUTH_PASSWORD_SENDER_CONSTRAINED_UNSUPPORTED: password authentication does not support sender-constrained custody',
    ), 'SNAPBACK_AUTH_PASSWORD_SENDER_CONSTRAINED_UNSUPPORTED');
  }

  #requireGuestBearerCustody() {
    if (!this.senderConstrained) return;
    throw clientCodedError(new Error(
      'SNAPBACK_AUTH_GUEST_CUSTODY_UNSUPPORTED: guest entry does not support sender-constrained custody',
    ), 'SNAPBACK_AUTH_GUEST_CUSTODY_UNSUPPORTED');
  }

  async #authPasswordAnonymousIssuance({
    path,
    body,
    forbiddenSecrets,
    recoveryCodes,
    guest = false,
    headers = {},
  }) {
    if (!this.authCoordinator) {
      throw new TypeError('password authentication requires AuthCoordinator custody');
    }
    if (guest) this.#requireGuestBearerCustody();
    else this.#requirePasswordBearerCustody();
    await this.authSession();
    const capture = this.authCoordinator.capture();
    const predecessor = this.authCoordinator.credentialFor(capture);
    if (predecessor.authority.kind !== 'anonymous') {
      throw staleAuthorityError();
    }
    const raw = await this.#trackedFetchJson(
      'POST',
      path,
      body,
      { ...this.#authOfferHeaders(true, null), ...headers },
      { forbiddenSecrets },
    );
    const response = recoveryCodes
      ? this.#validateCredentialResponseWithRecoveryCodes(raw, forbiddenSecrets)
      : this.#validateCredentialResponse(raw, forbiddenSecrets);

    // Password issuance runs outside custody ownership, just like
    // authExchange. Re-capture so an interleaved transition cannot install a
    // credential against a stale anonymous predecessor.
    // @ref LLP 0059#coordinator-interface — only the exact successor is an
    //   idempotent transition; every other current authority is stale.
    let currentCapture;
    try {
      currentCapture = this.authCoordinator.capture();
    } catch (error) {
      if (
        error?.code === 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
        || error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
      ) throw staleAuthorityError();
      throw error;
    }
    const current = this.authCoordinator.credentialFor(currentCapture);
    const authority = credentialAuthority(
      response,
      'sessions',
      current.authority.authorizationStreamIncarnation,
    );
    if (current.authority.kind !== 'anonymous') {
      if (sameClientAuthority(current.authority, authority)) {
        const projected = recoveryCodes
          ? credentialPublicProjectionWithRecoveryCodes(response)
          : credentialPublicProjection(response);
        this.#publishCredentialPrincipal(projected);
        return projected;
      }
      throw staleAuthorityError();
    }
    await this.#transitionCredentialAuthority(currentCapture, {
      authority,
      bearer: response.token,
      refreshAfterMs: response.refreshAfter,
    });
    const projected = recoveryCodes
      ? credentialPublicProjectionWithRecoveryCodes(response)
      : credentialPublicProjection(response);
    this.#publishCredentialPrincipal(projected);
    return projected;
  }

  async #authPasswordCredentialRotation({
    path,
    body,
    forbiddenSecrets,
    recoveryCodes,
  }) {
    if (!this.authCoordinator) {
      throw new TypeError('password credential rotation requires AuthCoordinator custody');
    }
    this.#requirePasswordBearerCustody();
    const currentDescriptor = requireAuthorityDescriptor(
      (await this.authSession()).authorityDescriptor,
    );
    const capture = this.authCoordinator.capture();
    const outcome = await this.authCoordinator.withCredentialRotation(
      capture,
      async ({ bearer, authority }) => {
        const raw = await this.#trackedFetchJson(
          'POST',
          path,
          body,
          this.#authOfferHeaders(true, bearer),
          { forbiddenSecrets: [bearer, ...forbiddenSecrets] },
        );
        const response = recoveryCodes
          ? this.#validateCredentialResponseWithRecoveryCodes(
            raw,
            [bearer, ...forbiddenSecrets],
          )
          : this.#validateCredentialResponse(raw, [bearer, ...forbiddenSecrets]);
        const observed = credentialAuthority(
          response,
          'sessions',
          authority.authorizationStreamIncarnation,
        );
        if (
          !sameClientAuthority(observed, authority)
          || response.authorityDescriptor.authorityInstanceId
            !== currentDescriptor.authorityInstanceId
        ) {
          throw opaqueCredentialResponseError();
        }
        return {
          bearer: response.token,
          refreshAfterMs: response.refreshAfter,
          value: recoveryCodes
            ? credentialPublicProjectionWithRecoveryCodes(response)
            : credentialPublicProjection(response),
        };
      },
    );
    if (!outcome.rotated) throw staleAuthorityError();
    const session = this.__authSessionLastSuccessful;
    this.clearAuthSession();
    this.#publishCredentialPrincipal(outcome.value, session);
    return outcome.value;
  }

  async #authPasswordCredentialTransition({
    path,
    body,
    forbiddenSecrets,
  }) {
    if (!this.authCoordinator) {
      throw new TypeError('password credential transition requires AuthCoordinator custody');
    }
    this.#requirePasswordBearerCustody();
    const currentDescriptor = requireAuthorityDescriptor(
      (await this.authSession()).authorityDescriptor,
    );
    const capture = this.authCoordinator.capture();
    const predecessor = this.authCoordinator.credentialFor(capture);
    if (predecessor.authority.kind !== 'session') throw staleAuthorityError();
    let response;
    let receivedSuccessfulResponse = false;
    try {
      const raw = await this.#trackedFetchJson(
        'POST',
        path,
        body,
        this.#authOfferHeaders(true, predecessor.bearer),
        { forbiddenSecrets: [predecessor.bearer, ...forbiddenSecrets] },
      );
      receivedSuccessfulResponse = true;
      response = this.#validateCredentialResponseWithRecoveryCodes(
        raw,
        [predecessor.bearer, ...forbiddenSecrets],
      );
    } catch (error) {
      const committedSuccess = receivedSuccessfulResponse
        || (Number.isInteger(error?.status) && error.status >= 200 && error.status < 300);
      if (committedSuccess) {
        // The password-set commit already terminalized this exact predecessor.
        // Even a success body that cannot be read, parsed, or validated must
        // not leave its dead bearer in custody; a concurrent authority remains
        // untouched. Non-2xx and dispatch failures did not commit and retain it.
        // @ref LLP 0059#coordinator-interface — malformed committed successes
        // may clear only the exact predecessor captured before the request.
        await this.authCoordinator.compareAndClear(
          capture,
          'password_set_invalid_successor',
        );
      }
      throw error;
    }
    const successorAuthority = credentialAuthority(
      response,
      'sessions',
      predecessor.authority.authorizationStreamIncarnation,
    );
    if (
      response.session.provider !== 'local-password'
      || successorAuthority.userId !== predecessor.authority.userId
      || successorAuthority.sessionId === predecessor.authority.sessionId
      || response.authorityDescriptor.authorityInstanceId
        === currentDescriptor.authorityInstanceId
    ) {
      // Password-set success terminalizes the predecessor and must name the
      // fresh local-password session it issued. A malformed success cannot
      // leave the now-suspect predecessor bearer in custody, while the exact
      // capture keeps a concurrent successor outside this cleanup.
      // @ref LLP 0059#coordinator-interface — only an exact captured
      // predecessor may be cleared after an invalid transition response.
      await this.authCoordinator.compareAndClear(
        capture,
        'password_set_invalid_successor',
      );
      throw opaqueCredentialResponseError();
    }

    // The POST runs outside custody ownership. Reconcile the well-formed
    // successor against a fresh settled capture, matching authExchange: a peer
    // may have refreshed the predecessor or already adopted this successor.
    // @ref LLP 0059#coordinator-interface — only the exact successor is
    // idempotent; a current authority other than predecessor or successor is
    // stale.
    let currentCapture;
    try {
      currentCapture = this.authCoordinator.capture();
    } catch (error) {
      if (
        error?.code === 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
        || error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
      ) throw staleAuthorityError();
      throw error;
    }
    const current = this.authCoordinator.credentialFor(currentCapture);
    const projected = credentialPublicProjectionWithRecoveryCodes(response);
    if (sameClientAuthority(current.authority, successorAuthority)) {
      this.#publishCredentialPrincipal(projected);
      return projected;
    }
    if (!sameClientAuthority(current.authority, predecessor.authority)) {
      throw staleAuthorityError();
    }
    await this.#transitionCredentialAuthority(currentCapture, {
      authority: successorAuthority,
      bearer: response.token,
      refreshAfterMs: response.refreshAfter,
    });
    this.#publishCredentialPrincipal(projected);
    return projected;
  }

  authPasswordSignup({ email, password }) {
    return this.#authPasswordAnonymousIssuance({
      path: '/auth/password/signup',
      body: { email, password },
      forbiddenSecrets: [password],
      recoveryCodes: true,
    });
  }

  async authEnterAsGuest() {
    const idempotencyKey = this.__guestEntryIdempotencyKey
      ?? SnapbackClient.mintGuestEntryIdempotencyKey();
    this.__guestEntryIdempotencyKey = idempotencyKey;
    try {
      const result = await this.#authPasswordAnonymousIssuance({
        path: '/auth/guest',
        body: {},
        forbiddenSecrets: [],
        recoveryCodes: false,
        guest: true,
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      if (this.__guestEntryIdempotencyKey === idempotencyKey) {
        this.__guestEntryIdempotencyKey = null;
      }
      return result;
    } catch (error) {
      // @ref LLP 0215#6-idempotency-and-retry-identity — retain the identity across an
      // unknown transport outcome so the retry converges on the first effect.
      // A server refusal may release it only when the response explicitly
      // proves that no guest/session effect committed or may have committed.
      if (
        error?.effectCommitted === false
        && error?.effectMayHaveCommitted === false
        && this.__guestEntryIdempotencyKey === idempotencyKey
      ) {
        this.__guestEntryIdempotencyKey = null;
      }
      throw error;
    }
  }

  async authClaimGuestWithPassword({ email, password }) {
    this.#requireGuestBearerCustody();
    return this.#authPasswordCredentialRotation({
      path: '/auth/guest/claim/password',
      body: { email, password },
      forbiddenSecrets: [password],
      recoveryCodes: true,
    });
  }

  authPasswordSignIn({ email, password }) {
    return this.#authPasswordAnonymousIssuance({
      path: '/auth/password/signin',
      body: { email, password },
      forbiddenSecrets: [password],
      recoveryCodes: false,
    });
  }

  authPasswordChange({ currentPassword, newPassword }) {
    return this.#authPasswordCredentialRotation({
      path: '/auth/password/change',
      body: { currentPassword, newPassword },
      forbiddenSecrets: [currentPassword, newPassword],
      recoveryCodes: false,
    });
  }

  authPasswordSet({ newPassword, stepUp }) {
    return this.#authPasswordCredentialTransition({
      path: '/auth/password/change',
      body: { currentPassword: null, newPassword, stepUp },
      forbiddenSecrets: [newPassword, stepUp?.code],
    });
  }

  authPasswordReset({ challengeId, code, newPassword }) {
    return this.#authPasswordAnonymousIssuance({
      path: '/auth/password/reset',
      body: { challengeId, code, newPassword },
      forbiddenSecrets: [challengeId, code, newPassword],
      recoveryCodes: false,
    });
  }

  authRecoveryConsume({ email, code }) {
    return this.#authPasswordAnonymousIssuance({
      path: '/auth/recovery/consume',
      body: { email, code },
      forbiddenSecrets: [code],
      recoveryCodes: true,
    });
  }

  authRecoveryRotate() {
    return this.#authPasswordCredentialRotation({
      path: '/auth/recovery/rotate',
      body: {},
      forbiddenSecrets: [],
      recoveryCodes: true,
    });
  }

  async #authRefreshSender({
    currentDescriptor,
    capture,
    suspect,
    senderChallengeRetry,
    serialized = false,
  }) {
    if (!serialized) {
      return this.authCoordinator.withSenderRequestSerialization(
        capture,
        ({ capture: currentCapture, credential }) => this.#authRefreshSender({
          currentDescriptor,
          capture: currentCapture,
          suspect: credential.bearer,
          senderChallengeRetry,
          serialized: true,
        }),
      );
    }
    let challengeCapture = null;
    try {
      const outcome = await this.authCoordinator.withSenderCredentialRotation(
        capture,
        async ({ bearer, authority, refreshAfterMs, senderConstraint }) => {
          const proof = await createSenderProofForCustody({
            privateKey: senderConstraint.privateKey,
            publicJwk: senderConstraint.publicJwk,
            method: 'POST',
            canonicalExternalUri: canonicalSenderExternalUri(this.baseUrl, '/auth/refresh'),
            accessToken: bearer,
            nonce: senderConstraint.nonce.value,
            issuedAtSeconds: Math.floor(Date.now() / 1_000),
            proofId: senderProofId(),
          });
          const envelope = await this.#trackedFetchJson(
            'POST',
            '/auth/refresh',
            {},
            {
              ...this.#authOfferHeaders(true, bearer),
              dpop: proof,
            },
            {
              opaqueSuccessFailure: true,
              includeSenderNonce: true,
              onSenderErrorNonce: async (value) => {
                const rotated = await this.authCoordinator.compareAndRotateSenderCredential(
                  capture,
                  {
                    bearer,
                    refreshAfterMs,
                    nonce: senderNonceRecord(
                      value,
                      senderConstraint.nonce.generation + 1,
                    ),
                    expectedSenderGeneration: senderConstraint.custodyGeneration,
                  },
                );
                if (!rotated.rotated) throw staleAuthorityError();
                challengeCapture = rotated.capture;
              },
            },
          );
          if (envelope.senderNonce === null) {
            throw senderIndeterminateSuccessError();
          }
          if (!isCanonicalSenderNonce(envelope.senderNonce)) {
            throw opaqueCredentialResponseError();
          }
          const response = this.#validateCredentialResponse(envelope.body, [bearer]);
          const observed = credentialAuthority(
            response,
            'sessions',
            authority.authorizationStreamIncarnation,
          );
          if (!sameClientAuthority(observed, authority)
              || response.authorityDescriptor.authorityInstanceId
                !== currentDescriptor.authorityInstanceId) {
            throw opaqueCredentialResponseError();
          }
          return {
            bearer: response.token,
            refreshAfterMs: response.refreshAfter,
            nonce: senderNonceRecord(
              envelope.senderNonce,
              senderConstraint.nonce.generation + 1,
            ),
            value: credentialPublicProjection(response),
          };
        },
      );
      if (!outcome.rotated) {
        const successor = await this.authCoordinator.waitForNewerRevision(capture);
        if (successor) return { superseded: true };
        throw staleAuthorityError();
      }
      const session = this.__authSessionLastSuccessful;
      this.clearAuthSession();
      this.#publishCredentialPrincipal(outcome.value, session);
      return outcome.value;
    } catch (error) {
      const errorCode = error?.diagnostic?.code ?? error?.code;
      if (
        errorCode === 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED'
        && senderChallengeRetry
        && challengeCapture !== null
      ) {
        this.clearAuthSession();
        // The recursive sender refresh performs a fresh #trackedFetchJson;
        // any non-2xx invalidation is therefore re-verified before replay.
        return this.#authRefreshSender({
          currentDescriptor,
          capture: challengeCapture,
          suspect,
          senderChallengeRetry: false,
          serialized: true,
        });
      }
      if (!SUPERSEDED_AUTH_CODES.has(errorCode)) throw error;
      const successor = await this.authCoordinator.waitForNewerRevision(capture);
      if (successor) return { superseded: true };
      try { await this.#familyAlarmWithBearer(suspect); } catch { /* named residual */ }
      await this.authCoordinator.compareAndClear(
        capture,
        'refresh_superseded_without_successor',
      );
      throw error;
    }
  }

  async authRefresh({ senderChallengeRetry = true } = {}) {
    if (!this.authCoordinator) {
      throw new TypeError('authRefresh requires AuthCoordinator custody');
    }
    const currentDescriptor = requireAuthorityDescriptor(
      (await this.authSession()).authorityDescriptor,
    );
    const capture = this.authCoordinator.capture();
    const suspect = this.authCoordinator.credentialFor(capture).bearer;
    if (this.senderConstrained) {
      return this.#authRefreshSender({
        currentDescriptor,
        capture,
        suspect,
        senderChallengeRetry,
      });
    }
    try {
      const outcome = await this.authCoordinator.withCredentialRotation(
        capture,
        async ({ bearer, authority }) => {
          const response = this.#validateCredentialResponse(await this.#trackedFetchJson(
            'POST',
            '/auth/refresh',
            {},
            this.#authOfferHeaders(true, bearer),
            { opaqueSuccessFailure: true },
          ), [bearer]);
          const observed = credentialAuthority(
            response,
            'sessions',
            authority.authorizationStreamIncarnation,
          );
          if (!sameClientAuthority(observed, authority)) {
            const error = new Error(
              'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: refresh changed session authority',
            );
            error.code = 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
            throw error;
          }
          if (
            response.authorityDescriptor.authorityInstanceId
            !== currentDescriptor.authorityInstanceId
          ) {
            const error = new Error(
              'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: refresh changed authority instance',
            );
            error.code = 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
            throw error;
          }
          return {
            bearer: response.token,
            refreshAfterMs: response.refreshAfter,
            value: credentialPublicProjection(response),
          };
        },
      );
      if (!outcome.rotated) {
        const successor = await this.authCoordinator.waitForNewerRevision(capture);
        if (successor) return { superseded: true };
        throw staleAuthorityError();
      }
      const session = this.__authSessionLastSuccessful;
      this.clearAuthSession();
      this.#publishCredentialPrincipal(outcome.value, session);
      return outcome.value;
    } catch (error) {
      const errorCode = error?.diagnostic?.code ?? error?.code;
      if (!SUPERSEDED_AUTH_CODES.has(errorCode)) throw error;
      const successor = await this.authCoordinator.waitForNewerRevision(capture);
      if (successor) return { superseded: true };
      try { await this.#familyAlarmWithBearer(suspect); } catch { /* named residual */ }
      await this.authCoordinator.compareAndClear(capture, 'refresh_superseded_without_successor');
      throw error;
    }
  }

  authLogout() {
    return this.#authLogoutExpectedCapture(null);
  }

  __authLogoutExpectedCapture(expectedCapture) {
    if (!expectedCapture || typeof expectedCapture !== 'object') {
      throw new TypeError('expected logout capture must be an authority capture');
    }
    return this.#authLogoutExpectedCapture(expectedCapture);
  }

  async #authLogoutExpectedCapture(expectedCapture) {
    if (!this.authCoordinator) {
      throw new TypeError('authLogout requires AuthCoordinator custody');
    }
    await this.authSession();
    if (
      expectedCapture !== null
      && !this.authCoordinator.isCurrent(expectedCapture)
    ) throw staleAuthorityError();
    let capture = expectedCapture ?? this.authCoordinator.capture();
    const credential = this.authCoordinator.credentialFor(capture);
    const bearer = credential.bearer;
    // @ref LLP 0060#c1-the-v1-custody-claim — exact empty 204 is the only
    // public logout success; malformed 2xx still clears captured custody.
    // The logout request is the operation that terminalizes this exact
    // predecessor. Keep it outside the general tracked-controller set so a
    // live socket observing that same revocation cannot abort the response
    // before logout records its exact status/body facts. A competing successor
    // is still rejected by compareAndClear below.
    // @ref LLP 0060#c1-the-v1-custody-claim — self-terminal logout owns its
    // response through the captured-authority clear boundary.
    const response = this.senderConstrained
      ? await (async () => {
          const sender = await this.#senderFetchJson(
            'POST',
            '/auth/logout',
            {},
            this.#authOfferHeaders(true, bearer),
            capture,
            { successfulResponseFacts: true },
          );
          capture = sender.capture;
          return sender.value;
        })()
      : await this.#fetchJson(
          'POST',
          '/auth/logout',
          {},
          this.#authOfferHeaders(true, bearer),
          { successfulResponseFacts: true },
        );
    const cleared = await this.authCoordinator.compareAndClear(capture, 'logout');
    if (!cleared.cleared) {
      let terminallyAnonymous = false;
      for (;;) {
        try {
          // Synchronize may return an exact durable capture reentrantly while
          // the matching local resume barrier is still closed. The final
          // compare-and-commit both waits for exposure and rechecks that exact
          // durable record under ownership, so a missed peer successor wins.
          const confirmed = await this.authCoordinator.synchronize();
          if (confirmed !== null) {
            const confirmation = await this.authCoordinator.compareAndCommit(
              confirmed,
              ({ authority }) => authority.kind === 'anonymous'
                && authority.authMode === credential.authority.authMode
                && authority.authorizationStreamIncarnation
                  === credential.authority.authorizationStreamIncarnation,
            );
            if (confirmation.committed) {
              terminallyAnonymous = confirmation.value === true;
              break;
            }
          }
        } catch (error) {
          const code = error?.code ?? error?.diagnostic?.code;
          if (
            code !== 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
            && code !== 'SNAPBACK_CLIENT_AUTHORITY_STALE'
          ) throw error;
        }
        // Ownership acquisition and participant barriers are deliberately
        // non-cancellable: abandoning either could let an orphaned operation
        // publish after logout returned. Follow the custody transition's
        // liveness instead of advertising a wall-clock deadline that cannot
        // safely cover the owned work.
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (!terminallyAnonymous) throw staleAuthorityError();
    }
    if (response.status !== 204 || !response.emptyBody) {
      const error = new Error(
        'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: auth provider returned an invalid logout response',
      );
      error.code = 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
      error.diagnostic = {
        code: error.code,
        message: 'auth provider returned an invalid logout response',
      };
      throw error;
    }
    return null;
  }

  close() {
    return this.closeAuth();
  }

  closeAuth() {
    // The terminal fence is synchronous even though owned-resource settlement
    // is awaitable. A queued readiness microtask or fresh-snapshot callback can
    // therefore never start replay after close() has been requested.
    this.__clientClosed = true;
    if (this.__outboxReplayTimer !== null) {
      clearTimeout(this.__outboxReplayTimer);
      this.__outboxReplayTimer = null;
      this.__outboxReplayScheduled = false;
    }
    this.__closeAuthPromise ??= (async () => {
      this.__currentPrincipalNotificationsClosed = true;
      for (const entry of this.__currentPrincipalListeners) entry.active = false;
      this.__currentPrincipalListeners.clear();
      let firstError = null;
      let outboxDrainSettlement = Promise.resolve();
      try {
        if (typeof this.__outboxDrainController?.releaseClient === 'function') {
          outboxDrainSettlement = Promise.resolve(
            this.__outboxDrainController.releaseClient(this),
          );
        } else {
          this.__outboxDrainHandle?.stop?.();
        }
      } catch (error) { firstError ??= error; }
      this.__outboxDrainController = null;
      this.__outboxDrainHandle = null;
      for (const entry of [...this.__optimisticMutationViews]) {
        try { entry.engine.close(); } catch (error) { firstError ??= error; }
        this.__optimisticMutationViews.delete(entry);
      }
      this.__ephemeralOptimisticRecords.clear();
      for (const controller of this.__authControllers) {
        try { controller.abort(); } catch (error) { firstError ??= error; }
      }
      try { await this.__authParticipantUnregister?.(); } catch (error) { firstError ??= error; }
      this.__authParticipantUnregister = null;

      // Unregistration removes the transport from future authority barriers;
      // it does not run a terminal barrier for resources the client already
      // owns. Drain those resources here so a forgotten live handle cannot
      // retain socket demand or a backend connection after closeAuth settles.
      // @ref LLP 0059#participant-contract — an unregistered participant may
      // retain no predecessor transport or materialization outside the barrier.
      const transportSettlements = [];
      for (const stream of [...this.__rawLiveStreams]) {
        try {
          transportSettlements.push(Promise.resolve(stream.close?.()));
        } catch (error) { firstError ??= error; }
      }
      this.__rawLiveStreams.clear();
      for (const manager of [...(this.__liveStreamManagers?.values?.() ?? [])]) {
        try { manager.close(); } catch (error) { firstError ??= error; }
        try {
          if (typeof manager.settled === 'function') {
            transportSettlements.push(Promise.resolve(manager.settled()));
          }
        } catch (error) { firstError ??= error; }
      }
      for (const outcome of await Promise.allSettled(transportSettlements)) {
        if (outcome.status === 'rejected') firstError ??= outcome.reason;
      }
      try { await outboxDrainSettlement; } catch (error) { firstError ??= error; }
      this.__authControllers.clear();
      this.__liveStreamManagers?.clear?.();
      this.__connectionGrants.clear();
      this.__laneConsumers.clear();
      for (const token of this.__liveQueryOwners.keys()) {
        this.__unregisterRuntimeCostSubscription(token);
      }
      this.__liveQueryOwners.clear();

      this.__storeRuntimeClosed = true;
      if (this.__storeRuntimeModulePromise !== null) {
        try {
          const module = await this.__storeRuntimeModulePromise;
          await module.storeRuntimeMethods.__closeStoreRuntime.call(this);
        } catch (error) { firstError ??= error; }
      }
      // @ref LLP 0090#d3-channel-b--persisted-device-snapshot — the client
      // owns stores resolved by the default ladder, so final client cleanup
      // releases their single-writer lease. Injected stores remain caller-owned.
      if (this.__ownsRqsStore && typeof this.rqsStore?.close === 'function') {
        this.__rqsStoreClosePromise ??= Promise.resolve().then(() => this.rqsStore.close());
        try { await this.__rqsStoreClosePromise; } catch (error) { firstError ??= error; }
      }
      this.__outboxDiagnosticsProducer.dispose();
      this.__devDiagnosticsReporter?.dispose();
      this.__clientDiagnosticsChannel.dispose();
      if (firstError) throw firstError;
    })();
    return this.__closeAuthPromise;
  }
  // @ref LLP 0031#migration-plan — system writes moved from ungated root
  //   /admin/* aliases to the gated /_snapback/api/* namespace (D5). Per
  //   LLP 0017#security-defaults, served loopback writes now require a local
  //   admin token; the shared server harness supplies it for demos/tests.
  loadSchema(manifest) { return this.#adminReq('POST', '/_snapback/api/schema/load', manifest); }
  ensureEphemeralCollections(manifestOrCollections) {
    const collections = Array.isArray(manifestOrCollections)
      ? manifestOrCollections
      : manifestOrCollections?.ephemeralCollections ?? manifestOrCollections?.collections ?? [];
    return this.#req('POST', '/ephemeral/collections/ensure', {
      collections,
      schemaHash: manifestOrCollections?.schemaHash ?? null,
      inputsHash: manifestOrCollections?.inputsHash ?? null,
    });
  }
  loadFunctions(manifest) { return this.#adminReq('POST', '/_snapback/api/functions/load', manifest); }
  // The single idempotent mount-lifecycle ensure (LLP 0034 §5 / ENG-22527):
  // inspects schemaHash/bundleHash/collections against the posted generated
  // manifests, provisions ONLY what is missing/mismatched, seeds only when
  // the seed's target tables are all empty — never reset-then-seed. Throws a
  // structured diagnostic when the server profile gates a needed half.
  async ensureApp({
    schema = null,
    functions = null,
    seed = null,
    routes = null,
    intent = null,
    requestedMode = null,
    // The codegen-owned API envelope members (LLP 0062 §5, server-composes
    // ruling). Provision-only: the server composes and self-verifies the
    // envelope from its own projection plus these members, and an activation
    // without them is explicitly envelope-less rather than degraded.
    apiEnvelope = null,
  } = {}) {
    const explicitProvision = intent !== null || requestedMode !== null;
    if (explicitProvision) {
      if (intent !== null && intent !== 'provision') {
        throw new TypeError("ensureApp intent must be 'provision'");
      }
      if (requestedMode !== 'dev' && requestedMode !== 'sessions') {
        throw new TypeError("ensureApp requestedMode must be 'dev' or 'sessions'");
      }
    }
    const body = {
      ...(explicitProvision ? { intent: 'provision', requestedMode } : {}),
      ...(schema ? { schema } : {}),
      ...(functions ? { functions } : {}),
      ...(seed ? { seed } : {}),
      // The route→query manifest (LLP 0092 §0C.1), ensured beside the
      // functions manifest; its hash becomes the routeManifestHash
      // generation component server-side.
      ...(routes ? { routes } : {}),
      ...(apiEnvelope && explicitProvision ? { apiEnvelope } : {}),
    };
    // @ref LLP 0058#complete-candidate-pair-preflight — explicit mode
    // provisioning is AdminWrite even when hashes already match; the client
    // must carry its configured admin token instead of using the Public
    // legacy request path.
    const outcome = explicitProvision
      ? await this.#adminReq('POST', '/app/ensure', body)
      : await this.#req('POST', '/app/ensure', body);
    const gated = ['schema', 'functions', 'seed', 'routes'].filter((part) => outcome[part] === 'gated');
    if (gated.length > 0) {
      const diag = {
        code: 'SNAPBACK_PROFILE_FORBIDS',
        message: `backend is not provisioned and the '${outcome.profile}' profile gates provisioning: ${gated.join(', ')}`,
      };
      const error = new Error(`${diag.code}: ${diag.message}`);
      error.diagnostic = diag;
      error.outcome = outcome;
      throw error;
    }
    return outcome;
  }
  async #requireVersionedSeedCapability(capability) {
    const inspection = await this.inspect();
    const supported = inspection?.capabilityManifest?.supportedCapabilities ?? [];
    if (!Array.isArray(supported) || !supported.includes(capability)) {
      const diagnostic = {
        code: 'SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED',
        message: `target does not advertise required versioned seed capability ${capability}`,
        details: { capability },
      };
      const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
      error.code = diagnostic.code;
      error.diagnostic = diagnostic;
      throw error;
    }
  }
  async ensureVersionedSeed(artifact, {
    operationId = newSeedOperationIdV1(),
    requestedMode = 'dev',
  } = {}) {
    await this.#requireVersionedSeedCapability('versioned_seed_install_v1');
    return this.#adminReq('POST', '/_snapback/api/app/seed/ensure-v1', {
      formatVersion: 'snapback.seed.install-request.v1',
      operationId,
      artifact,
      requestedMode,
    });
  }
  async previewVersionedSeed(artifact, {
    operation = 'install',
    requestedMode = 'dev',
    expectedDataVersionStream,
  } = {}) {
    // @ref LLP 0109#162-closed-carriers-and-exact-operation-combinations —
    // reject impossible tagged variants locally instead of relying on the
    // server to refuse an artifact-less resetInstall or artifact-bearing
    // clear after a network request.
    if (operation === 'install') {
      if (!artifact || expectedDataVersionStream !== undefined) {
        throw new TypeError(
          'install seed preview requires artifact and forbids expectedDataVersionStream',
        );
      }
    } else if (operation === 'resetInstall') {
      if (!artifact) {
        throw new TypeError('resetInstall seed preview requires artifact');
      }
      assertExpectedDataVersionStreamV1(
        expectedDataVersionStream,
        'resetInstall seed preview',
      );
    } else if (operation === 'clear') {
      if (artifact !== null) {
        throw new TypeError('clear seed preview forbids artifact');
      }
      assertExpectedDataVersionStreamV1(expectedDataVersionStream, 'clear seed preview');
    } else {
      throw new TypeError(`unknown versioned seed preview operation ${String(operation)}`);
    }
    const capability = operation === 'install'
      ? 'versioned_seed_install_v1'
      : 'versioned_seed_reset_v1';
    await this.#requireVersionedSeedCapability(capability);
    return this.#adminReq('POST', '/_snapback/api/app/seed/preview-v1', {
      formatVersion: 'snapback.seed.preview-request.v1',
      ...(artifact ? { artifact } : {}),
      requestedMode,
      operation,
      ...(expectedDataVersionStream ? { expectedDataVersionStream } : {}),
    });
  }
  async resetInstallVersionedSeed(artifact, {
    operationId = newSeedOperationIdV1(),
    requestedMode = 'dev',
    expectedDataVersionStream,
  } = {}) {
    if (!artifact) {
      throw new TypeError('resetInstallVersionedSeed requires artifact');
    }
    assertExpectedDataVersionStreamV1(
      expectedDataVersionStream,
      'resetInstallVersionedSeed',
    );
    await this.#requireVersionedSeedCapability('versioned_seed_reset_v1');
    return this.#adminReq('POST', '/_snapback/api/app/seed/reset-install-v1', {
      formatVersion: 'snapback.seed.reset-request.v1',
      operationId,
      operation: 'resetInstall',
      requestedMode,
      expectedDataVersionStream,
      artifact,
    });
  }
  async clearVersionedSeed({
    operationId = newSeedOperationIdV1(),
    requestedMode = 'dev',
    expectedDataVersionStream,
  } = {}) {
    assertExpectedDataVersionStreamV1(expectedDataVersionStream, 'clearVersionedSeed');
    await this.#requireVersionedSeedCapability('versioned_seed_reset_v1');
    return this.#adminReq('POST', '/_snapback/api/app/seed/clear-v1', {
      formatVersion: 'snapback.seed.reset-request.v1',
      operationId,
      operation: 'clear',
      requestedMode,
      expectedDataVersionStream,
    });
  }
  // app.reset folds seed in as an optional argument (LLP 0031 D5): reset() wipes,
  // reset(seed) / seed(seed) reset-then-seed. There is no seed-without-reset path.
  reset(seed) { return this.#adminReq('POST', '/_snapback/api/app/reset', seed ? { seed } : {}); }
  seed(seed) { return this.#adminReq('POST', '/_snapback/api/app/reset', { seed }); }
  // Forced scheduler tick — an AdminWrite like the other /_snapback/api/*
  // system calls, so it must ride #adminReq for the admin token and fail loudly on
  // a non-2xx instead of a raw fetch silently swallowing a 401 (ENG-23706).
  cronTick() { return this.#adminReq('POST', '/_snapback/api/cron/tick', {}); }

  query(ref, { args = {}, userId, readSet = [], authorityCapture = null } = {}) {
    assertClientReferenceKind({
      reference: ref,
      acceptedKinds: ['Query', 'LiveQuery'],
      invokedVerb: 'query',
      diagnosticsChannel: this.__clientDiagnosticsChannel,
    });
    const name = functionName(ref);
    args = validateGeneratedArguments(ref, args, name);
    const generation = expectedGeneration(ref);
    const authAdmissionError = authenticatedOneShotAdmissionError(ref, this, 'query');
    if (authAdmissionError !== null) return Promise.reject(authAdmissionError);
    return this.#req(
      'POST',
      `/query/${encodeURIComponent(name)}`,
      {
        args,
        auth: SnapbackClient.auth(userId),
        read_set: readSet,
        ...(generation === null ? {} : { expectedGeneration: generation }),
      },
      undefined,
      {
        expectedAuthorityCapture: authorityCapture,
        authAdmissionReference: ref,
        authAdmissionOperation: 'query',
      },
    ).catch(async (error) => {
      if (!isConnectivityFailureError(error)) throw error;
      throw queryOfflineUnavailableError({
        cause: error,
        name,
        ref,
      });
    }).then((output) => {
      // The first successful ordinary read acquires target capability evidence
      // through the normal client lifecycle and persists it with the durable
      // store. A relaunched client can therefore queue while offline without
      // application-authored inspect pre-warming.
      void this.#observeOfflineMutationReplayCapabilityFromLifecycle().catch(() => {});
      return projectTypedQueryOutput(ref, output);
    });
  }

  async search(ref, options = {}) {
    const resourceArg = assertSearchFunctionReferenceV1(ref);
    const {
      query,
      limit,
      after,
      userId,
      readSet = [],
      authorityCapture = null,
    } = options;
    if (!query || typeof query !== 'object' || !Array.isArray(query.all)) {
      throw new TypeError('Snapback search requires a structured SearchQueryAstV1');
    }
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)) {
      throw new TypeError('Snapback search limit must be an integer in 1..50');
    }
    if (after !== undefined && typeof after !== 'string') {
      throw new TypeError('Snapback search after cursor must be a string when present');
    }
    const args = {
      query,
      ...(limit !== undefined ? { limit } : {}),
      ...(after !== undefined ? { after } : {}),
      ...(resourceArg === null ? {} : { [resourceArg]: options[resourceArg] }),
    };
    const output = await this.query(ref, {
      args,
      userId: resourceArg === 'userId' ? undefined : userId,
      readSet: resourceArg === 'readSet' ? [] : readSet,
      authorityCapture: resourceArg === 'authorityCapture' ? null : authorityCapture,
    });
    assertSearchQueryOutputV1(output);
    const cursor = output?.cursor ?? null;
    return {
      items: Array.isArray(output?.rows) ? output.rows : [],
      cursor,
      hasMore: cursor !== null,
    };
  }

  /** Project the ordinary QueryOutput carrier of one generated vector query
   * to the public items-only VectorPageV1. Target capability admission still
   * refuses any target that has not independently qualified the exact profile.
   * @ref LLP 0132#query-surface */
  async vectorSearch(ref, {
    vector,
    k,
    filters,
    userId,
    readSet = [],
    authorityCapture = null,
  } = {}) {
    const { dimensions, filterFields } = assertVectorFunctionReferenceV1(ref);
    if (
      !Array.isArray(vector)
      || vector.length !== dimensions
      || vector.some((value) => (
        typeof value !== 'number'
        || !Number.isFinite(value)
        || Math.abs(value) > 2 ** 100
      ))
    ) {
      throw vectorQueryInvalid(`vector must contain exactly ${dimensions} portable components`);
    }
    if (k !== undefined && (!Number.isSafeInteger(k) || k < 1 || k > 64)) {
      throw vectorQueryInvalid('k must be an integer in 1..64');
    }
    const seenFilterFields = new Set();
    if (filters !== undefined && (
      filterFields === null
      || !Array.isArray(filters)
      || filters.length > 8
      || filters.some((filter) => {
        if (
          filter === null
          || typeof filter !== 'object'
          || Array.isArray(filter)
          || Object.keys(filter).sort().join(',') !== 'field,op,value'
          || typeof filter.field !== 'string'
          || filter.field.length === 0
          || filter.op !== 'eq'
        ) return true;
        if (seenFilterFields.has(filter.field) || !filterFields.has(filter.field)) return true;
        seenFilterFields.add(filter.field);
        return !(
          typeof filter.value === 'string'
          || typeof filter.value === 'boolean'
          || (typeof filter.value === 'number' && Number.isFinite(filter.value))
        );
      })
    )) {
      throw vectorQueryInvalid(
        'filters must use each declared equality field at most once with a closed scalar eq value',
      );
    }
    const output = await this.query(ref, {
      args: {
        vector: vector.map((value) => (Object.is(value, -0) ? 0 : value)),
        ...(k !== undefined ? { k } : {}),
        ...(filters !== undefined ? { filters } : {}),
      },
      userId,
      readSet,
      authorityCapture,
    });
    assertVectorQueryOutputV1(output);
    return { items: output.rows };
  }

  /// Mint a bundle boot idempotency key (LLP 0092 §0D.3): 22-char base64url
  /// over 16 random bytes, minted per boot attempt — two concurrent boots
  /// hold distinct keys and produce distinct registration sets.
  static mintBundleBootKey() {
    const bytes = new Uint8Array(16);
    cryptoRandomSource('bundle boot idempotency key').getRandomValues(bytes);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  }

  /// Mint a retry-stable guest-entry effect identity. The instance retains it
  /// until the complete authority transition succeeds.
  static mintGuestEntryIdempotencyKey() {
    const bytes = new Uint8Array(24);
    cryptoRandomSource('guest-entry idempotency key').getRandomValues(bytes);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  }

  /// Fetch a snapshot bundle (`POST /app/bundle` — LLP 0090 D1.2, contract
  /// LLP 0092 §0D): every entry is evaluated at one shared commit, and each
  /// entry's `resume` is present iff its query is rqsEligible (null
  /// otherwise — the closed union). `mode: 'register'` additionally arms the
  /// pending-registration owner (credentialed callers only; an anonymous
  /// register refuses with SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL and
  /// the caller retries in read mode) and returns `connection`; the minted
  /// grant is adopted into this client's connection-grant cache so the
  /// subsequent socket attach and outbox drains present it — the atomic
  /// handoff of the pending registrations — without a second
  /// `/connection/open` handshake.
  ///
  /// Until the cluster-0C routes-manifest authoring surface lands, the
  /// served local instance requires the route entry inline as
  /// `devManifestEntry` (a clearly-marked dev/test form).
  async fetchBundle({
    route,
    params = {},
    mode = 'read',
    idempotencyKey = null,
    devManifestEntry = null,
    userId,
    authorityCapture = null,
    authorizationNamespaces = [],
    authInvalidationProtocol = this.authProtocols.authInvalidation ?? null,
    formatVersion = null,
    profile = null,
    planHash = null,
    __preloadFunctionReferences = null,
    __preloadPersist = devManifestEntry?.persist !== false,
    __preloadRoutesManifest = null,
  } = {}) {
    if (typeof route !== 'string' || route.length === 0) {
      throw new TypeError('Snapback fetchBundle requires a route pattern string');
    }
    const body = { route, params, mode, auth: SnapbackClient.auth(userId) };
    if (mode === 'register') {
      body.idempotencyKey = idempotencyKey ?? SnapbackClient.mintBundleBootKey();
      if (
        authorizationNamespaces.length > 0
        && authInvalidationProtocol !== 1
      ) {
        throw new TypeError(
          'Snapback fetchBundle authorizationNamespaces require authInvalidationProtocol 1',
        );
      }
      if (authInvalidationProtocol != null) {
        body.authInvalidationProtocol = authInvalidationProtocol;
      }
      if (authorizationNamespaces.length > 0) {
        body.authorizationNamespaces = authorizationNamespaces;
      }
      if (formatVersion != null || profile != null || planHash != null) {
        if (
          formatVersion !== 2
          || profile !== 'mixed-route.v2'
          || typeof planHash !== 'string'
          || !planHash.startsWith('sha256:')
        ) {
          throw new TypeError(
            'Snapback mixed bundle requires formatVersion 2, profile mixed-route.v2, and planHash',
          );
        }
        body.formatVersion = formatVersion;
        body.profile = profile;
        body.planHash = planHash;
      }
    } else if (idempotencyKey != null) {
      body.idempotencyKey = idempotencyKey;
    } else if (formatVersion != null || profile != null || planHash != null) {
      throw new TypeError('Snapback mixed bundle profile is register-mode only');
    }
    if (devManifestEntry) body.devManifestEntry = devManifestEntry;
    const response = await this.#req(
      'POST',
      '/app/bundle',
      body,
      undefined,
      { expectedAuthorityCapture: authorityCapture },
    );
    const connection = response?.connection;
    if (connection?.connectionId && connection?.grant) {
      const authority = response?.[AUTHORITY_CAPTURE] ?? authorityCapture;
      // The register response has already transferred this grant into client
      // custody. Cache the minimum valid grant before interpreting optional
      // projections so a later validation failure can release the pending
      // owner through the grant-owned socket seam.
      this.__connectionGrants.set(
        connection.connectionId,
        Promise.resolve(markAuthorityCapture({
          id: connection.connectionId,
          token: connection.grant,
          authorizationInvalidation: null,
        }, authority)),
      );
      let authorizationInvalidation;
      try {
        authorizationInvalidation = connection.authorizationInvalidation == null
          ? null
          : validateAuthorizationInvalidationConnection(
            connection.authorizationInvalidation,
          );
      } catch (error) {
        // @ref LLP 0112#authority-races-and-cleanup — post-registration validation
        // failure tears down the pending owner even before grant adoption.
        // Register-mode bundle evaluation has already created the pending
        // owner. A malformed negotiated projection must not strand it merely
        // because it failed before the grant entered the client cache.
        await this.releaseConnection(connection.connectionId, {
          attachDeadline: connection.attachDeadline,
        }).catch(() => {});
        throw error;
      }
      this.__connectionGrants.set(
        connection.connectionId,
        Promise.resolve(markAuthorityCapture({
          id: connection.connectionId,
          token: connection.grant,
          authorizationInvalidation,
        }, authority)),
      );
    }
    try {
      const currentPayload = {
        route,
        generation: response?.generation,
        entries: response?.entries,
      };
      const preloadOutcome = __preloadRoutesManifest === null
        ? await this.__replacePreloadRouteBoot(currentPayload, {
            userId: userId ?? null,
            functionReferences: __preloadFunctionReferences,
            persist: __preloadPersist,
          })
        : await this.__replacePreloadManifestInForce(
            __preloadRoutesManifest,
            currentPayload,
            {
              userId: userId ?? null,
              functionReferences: __preloadFunctionReferences,
            },
          );
      if (preloadOutcome?.refused) {
        const error = new Error(
          `${preloadOutcome.refused.code}: routes-manifest preload registration refused`,
        );
        error.code = preloadOutcome.refused.code;
        throw error;
      }
    } catch (error) {
      if (connection?.connectionId) {
        await this.releaseConnection(connection.connectionId, {
          attachDeadline: connection.attachDeadline,
        }).catch(() => {});
      }
      throw error;
    }
    return response;
  }

  // Item 8's only renewal path: a fresh full query whose rows and exact
  // server-issued AuthorizedLease are returned as one response boundary.
  // The caller reserves leaseRequestId durably before entering this method.
  //
  // @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
  // heartbeat, reconnect, delta delivery, and session refresh never renew.
  authorizedLeaseQuery(ref, {
    args = {},
    userId,
    readSet = [],
    leaseRequestId,
    authorizationNamespace,
    authorityCapture = null,
  } = {}) {
    const name = functionName(ref);
    args = validateGeneratedArguments(ref, args, name);
    const generation = expectedGeneration(ref);
    const namespace = createLiveQueryNamespace(authorizationNamespace ?? {});
    if (typeof leaseRequestId !== 'string' || leaseRequestId.length === 0) {
      throw new TypeError('authorizedLeaseQuery requires leaseRequestId');
    }
    return this.#req('POST', `/query/${encodeURIComponent(name)}/authorized-lease`, {
      args,
      auth: SnapbackClient.auth(userId),
      read_set: readSet,
      leaseRequestId,
      clientStoreId: namespace.clientStoreId,
      queryKey: namespace.queryKey,
      queryInstanceId: namespace.queryInstanceId,
      ...(generation === null ? {} : { expectedGeneration: generation }),
    }, undefined, { expectedAuthorityCapture: authorityCapture });
  }

  #actionRaw(
    ref,
    { args = {}, userId, readSet = [], authorityCapture = null } = {},
    invokedVerb = 'action',
  ) {
    assertClientReferenceKind({
      reference: ref,
      acceptedKinds: ['Action'],
      invokedVerb,
      diagnosticsChannel: this.__clientDiagnosticsChannel,
    });
    const name = functionName(ref);
    args = validateGeneratedArguments(ref, args, name);
    const generation = expectedGeneration(ref);
    const authAdmissionError = authenticatedOneShotAdmissionError(ref, this, 'action');
    if (authAdmissionError !== null) return Promise.reject(authAdmissionError);
    return this.#req(
      'POST',
      `/action/${encodeURIComponent(name)}`,
      {
        args,
        auth: SnapbackClient.auth(userId),
        read_set: readSet,
        ...(generation === null ? {} : { expectedGeneration: generation }),
      },
      undefined,
      {
        expectedAuthorityCapture: authorityCapture,
        authAdmissionReference: ref,
        authAdmissionOperation: 'action',
      },
    );
  }

  /** @deprecated Use run(), which throws SnapbackDiagnosticError on refusal
   * and resolves the plain typed action result. */
  action(ref, options = {}) {
    if (positiveDevelopmentEnvironment() && !rawActionDeprecationWarned) {
      rawActionDeprecationWarned = true;
      console.warn(
        'SNAPBACK_ACTION_RAW_DEPRECATED: client.action() returns the legacy raw envelope; '
        + 'use client.run() and isSnapbackDiagnosticError().',
      );
    }
    return this.#actionRaw(ref, options);
  }

  async run(ref, options = {}) {
    const outcome = await this.#actionRaw(ref, options, 'run');
    if (outcome?.ok === true) return outcome.result;
    const diagnostic = outcome?.diagnostic && typeof outcome.diagnostic.code === 'string'
      ? outcome.diagnostic
      : Object.freeze({
          schemaVersion: 'snapback.client-diagnostic.v1',
          code: 'SNAPBACK_ACTION_REFUSED',
          severity: 'error',
          subsystem: 'client',
          message: 'the action did not return a successful result',
          details: Object.freeze({}),
        });
    throw new SnapbackDiagnosticError(diagnostic, {
      operation: 'action',
      refKind: typeof ref === 'object' && ref !== null ? ref.kind ?? 'Action' : 'Action',
      // An action may have external effects before a result-level refusal is
      // observed. Absence of an explicit server fact is conservative, never
      // a safe-retry claim.
      effectCommitted: diagnostic?.details?.effectCommitted,
      effectMayHaveCommitted: diagnostic?.details?.effectMayHaveCommitted ?? true,
      retryable: diagnostic?.details?.retryable,
      retryStrategy: diagnostic?.details?.retryStrategy,
    });
  }

  async acknowledgeMutations({
    userId,
    clientMutationIds = [],
    authorityDescriptor = null,
    authorityCapture = null,
  } = {}) {
    const store = this.#offlineQueueStore();
    let authorizationDispatchRelease = null;
    let acknowledgementFence = null;
    const releaseAuthorizationDispatch = async () => {
      const release = authorizationDispatchRelease;
      authorizationDispatchRelease = null;
      await release?.();
    };
    let resolvedAuthorityDescriptor = authorityDescriptor;
    if (!resolvedAuthorityDescriptor && store && clientMutationIds.length > 0) {
      await this.#reconcileQueueCustody(store, { required: true });
      const selected = (await store.outboxRecords())
        .filter((record) => clientMutationIds.includes(record.id));
      const descriptors = new Map(selected
        .map((record) => record.settlementAuthorityDescriptor
          ?? record.settlement?.authorityDescriptor
          ?? null)
        .filter(Boolean)
        .map((record) => [
          record.authorityInstanceId,
          record,
        ]));
      if (selected.some((record) => !(
        record.settlementAuthorityDescriptor ?? record.settlement?.authorityDescriptor
      ))) {
        const error = new Error(
          'SNAPBACK_OUTBOX_ACK_AUTHORITY_UNKNOWN: retained settlement has no authority descriptor',
        );
        error.code = 'SNAPBACK_OUTBOX_ACK_AUTHORITY_UNKNOWN';
        throw error;
      }
      if (descriptors.size > 1) {
        const error = new Error(
          'SNAPBACK_OUTBOX_ACK_AUTHORITY_MIXED: acknowledge one authority cohort per request',
        );
        error.code = 'SNAPBACK_OUTBOX_ACK_AUTHORITY_MIXED';
        throw error;
      }
      resolvedAuthorityDescriptor = descriptors.values().next().value ?? null;
    }
    const body = {
      auth: SnapbackClient.auth(userId),
      clientMutationIds,
    };
    if (resolvedAuthorityDescriptor) {
      body.authorityDescriptor = requireAuthorityDescriptor(
        resolvedAuthorityDescriptor,
        'SNAPBACK_AUTHORITY_DESCRIPTOR_INVALID',
      );
    }
    try {
      const response = await this.#req(
        'POST',
        '/client-mutations/acknowledge',
        body,
        undefined,
        {
          expectedAuthorityCapture: authorityCapture,
          beforeTransportDispatch: async () => {
            if (!store || clientMutationIds.length === 0) return;
            if (authorizationDispatchRelease !== null) return;
            authorizationDispatchRelease = await acquireOutboxAuthorizationDispatch(store);
            const status = await store.outboxAuthorizationStatus();
            if (status?.suspended === true) {
              const error = new Error(
                'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED: mutation acknowledgement waits for authorization proof',
              );
              error.code = 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED';
              throw error;
            }
            acknowledgementFence = outboxAuthorizationFenceFrom(status);
          },
          onTransportFailure: async (error) => {
            if (requestFailureReentersAuthorityTransport(error)) {
              await releaseAuthorizationDispatch();
            }
          },
        },
      );
      if (store && clientMutationIds.length > 0) {
        await store.outboxConfirmAcknowledgements(
          clientMutationIds,
          typeof userId === 'string' ? userId : null,
          body.authorityDescriptor ?? null,
          acknowledgementFence,
        );
      }
      return response;
    } finally {
      await releaseAuthorizationDispatch();
    }
  }

  // -------------------------------------------------------------------
  // LLP 0043 M2 queued-intent outbox on the JS arm (LLP 0129 Phase 0).
  // -------------------------------------------------------------------

  /// The outbox-capable store this client may queue into, or null. Browser and
  /// agent session custody use the same store contract with per-record server
  /// descriptor, principal-scope, and durable-lineage custody captured at the
  /// enqueue cut; dev/external-bearer records retain their existing shape.
  #offlineQueueStore(required = false) {
    const fail = (code, message) => {
      if (!required) return null;
      const error = new Error(`${code}: ${message}`);
      error.code = code;
      throw error;
    };
    if (this.__offlineQueue === false) {
      return fail('SNAPBACK_OFFLINE_QUEUE_DISABLED', 'offlineQueue is disabled for this client');
    }
    const store = this.rqsStore;
    const capable = store
      && typeof store.outboxEnqueue === 'function'
      && typeof store.outboxPending === 'function'
      && typeof store.outboxPrepareSubmission === 'function'
      && typeof store.outboxRecords === 'function'
      && typeof store.outboxMarkAcknowledgementsReady === 'function'
      && typeof store.outboxDurablyConsume === 'function'
      && typeof store.outboxMarkResultGone === 'function'
      && typeof store.outboxMarkStranded === 'function'
      && typeof store.outboxReconcileCustody === 'function'
      && typeof store.outboxDiscardStranded === 'function'
      && typeof store.wipeForAuthorityTransition === 'function';
    if (!capable) {
      return fail(
        'SNAPBACK_OFFLINE_QUEUE_STORE_INCAPABLE',
        'the configured rqsStore does not carry the outbox contract',
      );
    }
    if (store.durability?.()?.durable !== true) {
      return fail(
        'SNAPBACK_OFFLINE_QUEUE_DURABILITY_REQUIRED',
        'queued settlement publication requires a restart-safe store; the resolved store is volatile',
      );
    }
    return store;
  }

  #authorizationQueueAdapter(externalAdapter = null) {
    // @ref LLP 0053#dispositions-with-producers-and-meanings —
    //   every non-retain query root suspends the client's own durable outbox;
    //   adapter absence cannot waive that obligation or license an ACK.
    // Root custody is independent of this client's permission to produce new
    // queued work. `offlineQueue:false` still shares a store with live-query
    // invalidation and foreground dispatch, so the exact root must land there
    // before either path may ACK or POST.
    const store = this.#custodyReconciliationStore();
    const persistenceError = (method) => {
      const error = new Error(
        `SNAPBACK_RQS_STORE_UNAVAILABLE: durable outbox cannot ${method}`,
      );
      error.code = 'SNAPBACK_RQS_STORE_UNAVAILABLE';
      return error;
    };
    const persistenceDeferred = (method) => {
      const error = new Error(
        `SNAPBACK_OUTBOX_AUTHORIZATION_DEFERRED: shared writer has not committed ${method}`,
      );
      error.code = 'SNAPBACK_OUTBOX_AUTHORIZATION_DEFERRED';
      return error;
    };
    const persist = async (method, args, expectedAuthorityGeneration) => {
      if (store === null) return null;
      if (typeof store[method] !== 'function') throw persistenceError(method);
      let result;
      try {
        const commit = () => store[method](...args, expectedAuthorityGeneration);
        result = typeof store.withOutboxAuthorizationDispatch === 'function'
          ? await store.withOutboxAuthorizationDispatch(commit)
          : await commit();
      } catch (error) {
        if (error?.code !== 'SNAPBACK_OUTBOX_NOT_WRITER') throw error;
        await store.whenLockSettled?.();
        const visibilityKind = method === 'outboxApplyAuthorizationObligation'
          ? 'apply'
          : method === 'outboxResolveAuthorizationObligation'
            ? 'resolve'
            : method === 'outboxRetireAuthorizationScopes' ? 'retire' : null;
        const sharedCommitVisible = visibilityKind !== null
          && typeof store.outboxAuthorizationTransitionVisible === 'function'
          && await store.outboxAuthorizationTransitionVisible(
            visibilityKind,
            args[0],
            expectedAuthorityGeneration,
          );
        if (!sharedCommitVisible) throw persistenceDeferred(method);
        result = true;
      }
      if (result === false || result === null || result === undefined) {
        throw persistenceDeferred(method);
      }
      this.__outboxCustodyWakeGeneration += 1;
      this.#notifyOutboxListeners();
      const controller = outboxDrainControllersByStore.get(store) ?? null;
      if (controller !== null) void controller.noteOutboxTransition();
      return result;
    };
    if (store === null && externalAdapter === null) return null;
    return Object.freeze({
      async captureAuthorityGeneration() {
        if (store === null) return null;
        if (typeof store.outboxAuthorizationStatus !== 'function') {
          throw persistenceError('capture the authorization authority generation');
        }
        const status = await store.outboxAuthorizationStatus();
        if (
          !Number.isSafeInteger(status?.authorityGeneration)
          || status.authorityGeneration < 0
        ) {
          // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — unavailable generation capture defers instead of rebinding delayed work to a successor.
          // A normalization-pending/unavailable projection is not generation
          // zero and is never permission to compare against whatever durable
          // successor happens to be current when delayed work finally runs.
          throw persistenceDeferred('capture the authorization authority generation');
        }
        return status.authorityGeneration;
      },
      async applyObligation(obligation, expectedAuthorityGeneration = null) {
        await persist(
          'outboxApplyAuthorizationObligation',
          [obligation],
          expectedAuthorityGeneration,
        );
        return externalAdapter?.applyObligation?.(obligation) ?? null;
      },
      prepareResolution(resolution, snapshot) {
        return externalAdapter?.prepareResolution?.(resolution, snapshot) ?? null;
      },
      async resolveObligation(resolution, snapshot, expectedAuthorityGeneration = null) {
        await persist(
          'outboxResolveAuthorizationObligation',
          [resolution],
          expectedAuthorityGeneration,
        );
        return externalAdapter?.resolveObligation?.(resolution, snapshot) ?? null;
      },
      async retireScopes(retired, snapshot, expectedAuthorityGeneration = null) {
        const scopes = retired.map((entry) => entry?.scopeId).filter(Boolean);
        await persist(
          'outboxRetireAuthorizationScopes',
          [scopes],
          expectedAuthorityGeneration,
        );
        return externalAdapter?.retireScopes?.(retired, snapshot) ?? null;
      },
      async acknowledged(
        resolution,
        acknowledgement,
        expectedAuthorityGeneration = null,
      ) {
        await persist(
          'outboxAcknowledgeAuthorizationResolution',
          [resolution],
          expectedAuthorityGeneration,
        );
        return externalAdapter?.acknowledged?.(resolution, acknowledgement) ?? null;
      },
    });
  }

  async #outboxHeadFact() {
    let store = null;
    try { store = this.#offlineQueueStore(); } catch { store = null; }
    if (!store) {
      return {
        head: null,
        pending: 0,
        oldestPendingAtMs: null,
        blockedReason: null,
        drainPhase: 'idle',
        nextRetryAtMs: null,
      };
    }

    const status = await this.outboxStatus();
    // @ref LLP 0219#producers-pilot-scoped-detectors — queue-head identity is
    // re-read from the durable store notification seam, never reconstructed
    // from the bounded __outboxDiagnostics history.
    const records = typeof store.outboxRecords === 'function'
      ? await store.outboxRecords()
      : await store.outboxPending();
    const pendingFromRecords = records
      .filter((record) => record?.status === 'pending').length;
    const pending = status.pending === pendingFromRecords
      ? status.pending
      : pendingFromRecords;
    const head = records
      .filter((record) => record?.status === 'pending' || record?.status === 'result-gone')
      .sort((left, right) => left.sequence - right.sequence)[0] ?? null;
    const statusFact = {
      oldestPendingAtMs: status.oldestPendingAtMs,
      blockedReason: status.blockedReason,
      drainPhase: status.drainPhase,
      nextRetryAtMs: status.nextRetryAtMs,
    };
    if (head === null) return { head: null, pending, ...statusFact };

    let transportProvenance;
    if (typeof head.transportProvenance === 'string') {
      transportProvenance = head.transportProvenance;
    } else if (Array.isArray(head.operationIssuance?.transports)) {
      transportProvenance = head.operationIssuance.transports
        .filter((transport) => typeof transport === 'string')
        .slice(0, 8);
    }
    // LLP 0218 P1 attachment consumed: the diagnostics fact now carries its
    // landed status fields while head identity still comes from store records.
    return {
      head: {
        clientMutationId: head.clientMutationId ?? head.id,
        sequence: head.sequence,
        status: head.status,
        function: head.function,
        ...(Number.isFinite(head.enqueuedAt) ? { enqueuedAtMs: head.enqueuedAt } : {}),
        ...(transportProvenance === undefined ? {} : { transportProvenance }),
      },
      pending,
      ...statusFact,
    };
  }

  // Authority-transition privacy does not depend on whether this particular
  // client instance has queue production enabled: its store may contain intent
  // written by a predecessor process. Reconcile that existing custody
  // before publishing the successor whenever the store carries the contract.
  #custodyReconciliationStore() {
    const store = this.rqsStore;
    return store
      && typeof store.outboxReconcileCustody === 'function'
      ? store
      : null;
  }

  // Capture only the ratified durable lineage axes. AuthCoordinator revision
  // and AgentAuthorityFence carrier/token generations are deliberately absent.
  // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — capture-at-enqueue authority
  //   descriptor, principal scope, and durable fence lineage.
  async #captureQueueAuthority(expectedCapture = null) {
    if (!this.authorityFence) return null;
    const capture = this.authorityFence.capture();
    if (
      expectedCapture !== null
      && !sameAuthorityLineage(capture, expectedCapture)
    ) throw staleAuthorityError();
    const session = await this.authSession();
    if (!this.authorityFence.isCurrent?.(capture)) throw staleAuthorityError();
    if (
      expectedCapture !== null
      && !sameAuthorityLineage(capture, expectedCapture)
    ) throw staleAuthorityError();
    return this.#queueAuthorityFromSession(capture, session);
  }

  #queueAuthorityFromSession(capture, session, { devUserId = null } = {}) {
    const authorityDescriptor = requireAuthorityDescriptor(session?.authorityDescriptor);
    const authorizationStreamIncarnation = session?.authorizationStreamIncarnation
      ?? (session?.activeMode === 'dev' ? authorityDescriptor.authorityInstanceId : null);
    if (!UUID_V7.test(authorizationStreamIncarnation ?? '')) {
      const error = new Error(
        'SNAPBACK_AUTH_HANDSHAKE_INVALID: authorization stream incarnation is missing',
      );
      error.code = 'SNAPBACK_AUTH_HANDSHAKE_INVALID';
      throw error;
    }
    const userId = session?.activeMode === 'sessions'
      ? (session?.authority?.isAuthenticated === true ? session.authority.userId : null)
      : devUserId;
    return Object.freeze({
      capture,
      authorityDescriptor,
      principalScope: Object.freeze({
        authMode: session?.activeMode,
        authorizationStreamIncarnation,
        userId: userId ?? null,
      }),
      custody: Object.freeze({
        authorityEpoch: capture.authorityEpoch,
        authorityKey: capture.authorityKey,
      }),
    });
  }

  #recordWithQueueAuthority(record, authority) {
    if (authority === null) return record;
    return {
      ...record,
      authorityDescriptor: authority.authorityDescriptor,
      principalScope: authority.principalScope,
      custody: authority.custody,
      operationAuthorityPrincipalId: authority.principalScope.userId,
    };
  }

  async #compensateStaleQueueWrite(
    store,
    clientMutationId,
    authority,
    { insertionOwnership = null, expectedAuthorizationFence = null } = {},
  ) {
    if (
      authority === null
      || this.authorityFence?.isCurrent?.(authority.capture) === true
    ) return true;
    if (
      insertionOwnership !== null
      && typeof store.outboxDiscardPendingInsertion === 'function'
    ) {
      try {
        await store.outboxDiscardPendingInsertion(
          clientMutationId,
          insertionOwnership.sequence,
          expectedAuthorizationFence,
        );
      } catch { /* refusal is recorded below */ }
    }
    this.#recordOutboxDiagnostic({
      code: 'SNAPBACK_OFFLINE_MUTATION_QUEUE_REFUSED',
      clientMutationId,
      reason: 'authority_changed_during_enqueue',
      custody: 'capture_validate_commit',
    });
    return false;
  }

  /// Reconcile the complete custody matrix in one store transition before a
  /// client observation or drain. An unsettled/terminal fence leaves bytes
  /// untouched and returns an inadmissible result.
  async #reconcileQueueCustody(store, { required = false } = {}) {
    if (!this.authorityFence) {
      return { settled: true, authority: null, result: null };
    }
    if (this.authTerminalStatus().terminated === true) {
      const error = staleAuthorityError();
      if (required) throw error;
      return { settled: false, authority: null, error };
    }
    let authority;
    let expectedAuthorityGeneration;
    try {
      // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — custody compare-and-commits the exact generation captured before delayed authority work.
      // Capture both lineage axes before any delayed reconciliation work. A
      // normalization-pending projection is typed unavailability, never an
      // invitation to compare against whichever queue generation is current
      // when the transaction eventually runs.
      const capture = this.authorityFence.capture();
      const status = await store.outboxAuthorizationStatus();
      if (
        !Number.isSafeInteger(status?.authorityGeneration)
        || status.authorityGeneration < 0
      ) {
        const error = new Error(
          'SNAPBACK_OUTBOX_AUTHORIZATION_DEFERRED: authorization generation is unavailable',
        );
        error.code = 'SNAPBACK_OUTBOX_AUTHORIZATION_DEFERRED';
        throw error;
      }
      expectedAuthorityGeneration = status.authorityGeneration;
      const session = await this.authSession();
      if (!this.authorityFence.isCurrent?.(capture)) throw staleAuthorityError();
      authority = this.#queueAuthorityFromSession(capture, session);
    } catch (error) {
      if (required) throw error;
      return { settled: false, authority: null, error };
    }
    try {
      const result = await this.#applyQueueCustodyReconciliation(store, authority, {
        expectedAuthorityGeneration,
      });
      return { settled: true, authority, result };
    } catch (error) {
      if (required) throw error;
      return { settled: false, authority: null, error };
    }
  }

  async #applyQueueCustodyReconciliation(
    store,
    authority,
    { validateCurrent = true, expectedAuthorityGeneration = null } = {},
  ) {
    let beforeRecords = [];
    try { beforeRecords = await store.outboxRecords(); } catch { /* transition remains authoritative */ }
    const pendingBefore = new Map(beforeRecords
      .filter((record) => record?.status === 'pending')
      .map((record) => [record.id, record]));
    const commit = () => store.outboxReconcileCustody(
      authority.principalScope,
      authority.authorityDescriptor,
      authority.custody,
      expectedAuthorityGeneration,
    );
    const result = typeof store.withOutboxAuthorizationDispatch === 'function'
      ? await store.withOutboxAuthorizationDispatch(commit)
      : await commit();
    if (
      !result
      || (validateCurrent && this.authorityFence.isCurrent?.(authority.capture) !== true)
    ) {
      const error = staleAuthorityError();
      throw error;
    }
    if (result.deleted > 0) {
      for (const clientMutationId of result.deletedIds ?? []) {
        const record = pendingBefore.get(clientMutationId);
        if (record === undefined) continue;
        this.#recordMutationPhaseCost({
          clientMutationId,
          functionId: record.function,
          disposition: 'deleted',
          timing: mutationTiming(record),
        });
      }
      // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — cross-principal privacy
      //   deletion retains no tombstone and reports only the deleted count.
      this.#recordOutboxDiagnostic({
        code: 'SNAPBACK_OFFLINE_MUTATIONS_DELETED_AUTHORITY_CHANGE',
        reason: 'principal_scope_changed',
        deleted: result.deleted,
      });
    }
    if (result.stranded > 0) {
      for (const clientMutationId of result.strandedIds ?? []) {
        const record = pendingBefore.get(clientMutationId);
        if (record === undefined) continue;
        this.#recordMutationPhaseCost({
          clientMutationId,
          functionId: record.function,
          disposition: 'stranded',
          timing: mutationTiming(record),
        });
      }
      this.#recordOutboxDiagnostic({
        code: 'SNAPBACK_OFFLINE_MUTATIONS_STRANDED',
        reason: 'authority_instance_changed',
        stranded: result.stranded,
        clientMutationIds: result.strandedIds,
      });
    }
    if (result.deleted > 0 || result.stranded > 0) {
      await this.#refreshOptimisticMutationViews('authority-custody-reconciled');
      this.#notifyOutboxListeners();
    }
    return result;
  }

  #recordOutboxDiagnostic(diagnostic) {
    const recorded = Object.freeze({ at: Date.now(), ...diagnostic });
    this.__outboxDiagnostics.push(recorded);
    if (this.__outboxDiagnostics.length > 256) this.__outboxDiagnostics.shift();
    const { code, at, ...details } = recorded;
    // @ref LLP 0219#producers-pilot-scoped-detectors — the canonical queued
    // channel events ride LLP 0218 §4.4's relinquishment helper (every
    // foreground relinquishment, never bare durable insertion), so the
    // record-cut bridge deliberately skips them here; every other outbox
    // lifecycle fact still projects into this client's v2 channel.
    const queuedAdvisory = code === 'SNAPBACK_OFFLINE_MUTATION_QUEUED'
      || code === 'SNAPBACK_OPERATION_RANGE_UNCOVERED_QUEUED';
    if (!queuedAdvisory) {
      try {
        this.__clientDiagnosticsChannel.emit({
          schemaVersion: 'snapback.client-diagnostic.v2',
          code,
          severity: 'error',
          subsystem: 'outbox',
          message: `Outbox settlement rule (${code}): do not treat durable work as settled until reconciliation completes. Inspect outboxStatus() and follow guide/sync/offline-and-retention.md#replay-and-settle-without-guessing.`,
          details: { atMs: at, ...details },
          site: typeof details.mutation === 'string' ? details.mutation : undefined,
        });
      } catch { /* diagnostic observation cannot own queue behavior */ }
    }
    this.#notifyOutboxListeners();
  }

  // @ref LLP 0219#channel-semantics — adapter from LLP 0218 §4.4's stable
  // relinquishment payload (code, mutation, clientMutationId, sequence,
  // queueReasonClass, drainMode, firstInSession) into the v2 carrier this
  // channel owns. Trigger cadence and payload stay 0218's; delivery,
  // formatting, and coalescing stay here.
  #bridgeRelinquishmentDevEvent(event) {
    if (typeof event?.code !== 'string') return;
    const { code, ...details } = event;
    try {
      this.__clientDiagnosticsChannel.emit({
        schemaVersion: 'snapback.client-diagnostic.v2',
        code,
        severity: 'warning',
        subsystem: 'outbox',
        message: 'Offline queue rule: queued is pending, not settled. Keep pending UI visible; the client-owned drain replays it, or drain via useSnapbackOutbox().drainNow() / client.replayQueuedMutations(); see guide/sync/offline-and-retention.md#replay-and-settle-without-guessing.',
        details,
        site: typeof details.mutation === 'string' ? details.mutation : undefined,
      });
    } catch { /* diagnostics are observational and cannot own dispatch */ }
  }

  #emitDevDiagnosticsEvent(event) {
    try {
      this.__devDiagnosticsChannel?.emit?.(event);
    } catch { /* diagnostics are observational and cannot own dispatch */ }
  }

  // P3 React presentation bookkeeping uses this optional internal bridge too;
  // the canonical queued event itself is emitted only by the relinquishment
  // helper below, so adapters do not duplicate it.
  __emitDevDiagnosticsEvent(event) {
    this.#emitDevDiagnosticsEvent(event);
  }

  #currentOutboxDrainMode() {
    let status = null;
    try { status = this.__outboxDrainController?.status?.() ?? null; } catch { /* no owner */ }
    if (status?.running !== true) return 'none';
    return status.automatic === false ? 'manual' : 'auto';
  }

  #connectivityQueueReasonClass(error) {
    const code = error?.diagnostic?.code ?? error?.code ?? null;
    return globalThis.navigator?.onLine === false
      || (typeof code === 'string' && code.includes('OFFLINE'))
      ? 'offline'
      : 'connectivity';
  }

  #emitQueuedRelinquishmentDiagnostic({
    mutation,
    clientMutationId,
    sequence,
    queueReasonClass,
  }) {
    const firstInSession = this.__queuedRelinquishmentCount === 0;
    this.__queuedRelinquishmentCount += 1;
    const facts = Object.freeze({
      queueReasonClass,
      drainMode: this.#currentOutboxDrainMode(),
      firstInSession,
    });
    const event = Object.freeze({
      code: 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
      mutation,
      clientMutationId,
      sequence,
      ...facts,
    });
    // @ref LLP 0218#44-dev-diagnostic — every foreground relinquishment emits
    // the stable payload; durable insertion without relinquishment emits none.
    // LLP 0218 §4.4 emission point; delivery surface is LLP 0219's (stub until that program attaches).
    this.#emitDevDiagnosticsEvent(event);
    return facts;
  }

  get outboxDiagnostics() {
    return [...this.__outboxDiagnostics];
  }

  diagnosticsChannel() {
    return this.__clientDiagnosticsChannel;
  }

  #notifyOutboxListeners() {
    for (const listener of [...this.__outboxListeners]) {
      try { listener(); } catch { /* observation cannot own the queue */ }
    }
  }

  /// Live outbox facts for UI projection (the LLP 0114 React arm's
  /// queued-changes surface — LLP 0129 Phase 0). Pure projection of the
  /// durable store's own records plus the single-flight drain flag: no new
  /// claims, and an unreadable store reports zero counts rather than
  /// guessing. `supported: false` means this client resolved no
  /// outbox-capable store (disabled or incapable).
  async outboxStatus() {
    let store = null;
    try { store = this.#offlineQueueStore(); } catch { store = null; }
    if (!store) {
      return Object.freeze({
        supported: false,
        pending: 0,
        failed: 0,
        stranded: 0,
        quarantined: 0,
        resultGone: 0,
        replaying: false,
        drainMode: 'none',
        oldestPendingAtMs: null,
        drainPhase: 'idle',
        lastAttemptAtMs: null,
        nextRetryAtMs: null,
        blockedReason: null,
      });
    }
    const registeredController = outboxDrainControllersByStore.get(store) ?? null;
    if (registeredController !== null) this.__outboxDrainController = registeredController;
    const controllerStatus = registeredController?.status?.() ?? null;
    let pending = 0;
    let failed = 0;
    let stranded = 0;
    let quarantined = 0;
    let resultGone = 0;
    let oldestPendingAtMs = null;
    let blockedReason = controllerStatus?.blockedReason
      ?? this.__outboxDrainStartBlockedReason
      ?? (
      typeof store.isWriter === 'function' && store.isWriter() !== true
        ? 'not-writer'
        : null
    );
    const authorityTransition = this.authorityTransitionStatus();
    if (
      blockedReason === null
      && authorityTransition.transitionOwner === 'auth-coordinator'
    ) blockedReason = 'auth-barrier';
    try {
      const custody = await this.#reconcileQueueCustody(store);
      if (!custody.settled && blockedReason === null) blockedReason = 'custody-unsettled';
      if (!custody.settled) throw custody.error;
      const records = typeof store.outboxRecords === 'function'
        ? await store.outboxRecords()
        : await store.outboxPending();
      for (const record of records) {
        if (record?.status === 'failed') failed += 1;
        else if (record?.status === 'pending') {
          pending += 1;
          if (
            Number.isSafeInteger(record.enqueuedAt)
            && (oldestPendingAtMs === null || record.enqueuedAt < oldestPendingAtMs)
          ) oldestPendingAtMs = record.enqueuedAt;
        }
        else if (record?.status === 'stranded') stranded += 1;
        else if (record?.status === 'quarantined') quarantined += 1;
        else if (record?.status === 'result-gone') resultGone += 1;
      }
    } catch { /* counts stay zero; the store remains the authority */ }
    return Object.freeze({
      supported: true,
      pending,
      failed,
      stranded,
      quarantined,
      resultGone,
      replaying: controllerStatus?.drainPhase === 'replaying'
        || this.__outboxReplayTask !== null
        || this.__outboxHousekeepingReplayTask !== null,
      drainMode: controllerStatus === null
        ? 'none'
        : controllerStatus.automatic === false ? 'manual' : 'auto',
      oldestPendingAtMs,
      drainPhase: controllerStatus?.drainPhase
        ?? (
          this.__outboxReplayTask !== null || this.__outboxHousekeepingReplayTask !== null
            ? 'replaying'
            : 'idle'
        ),
      lastAttemptAtMs: controllerStatus?.lastAttemptAtMs ?? null,
      nextRetryAtMs: controllerStatus?.nextRetryAtMs ?? null,
      blockedReason,
    });
  }

  /// Non-consuming projection of one durable outbox record. This deliberately
  /// does not use settledMutations() or cross the ACK-eligibility cut.
  ///
  /// @ref LLP 0218#41-the-dispatch-union-headless-contract — durable mutation
  ///   disposition is independently observable without licensing settlement
  ///   inference when no retained record exists.
  async mutationStatus(clientMutationId) {
    if (typeof clientMutationId !== 'string' || clientMutationId.length === 0) {
      throw new TypeError('mutationStatus requires a client mutation id');
    }
    const ephemeral = this.__ephemeralOptimisticRecords.get(clientMutationId) ?? null;
    if (ephemeral !== null) {
      if (ephemeral.status === 'settled') {
        return freezeDeep({
          status: 'settled',
          settlement: structuredClone(ephemeral.settlement),
          settledAt: ephemeral.settledAt,
          timing: mutationTiming(ephemeral),
        });
      }
      if (ephemeral.status === 'failed') {
        return freezeDeep({
          status: 'failed',
          failure: structuredClone(ephemeral.failure),
          timing: mutationTiming(ephemeral),
        });
      }
      return Object.freeze({ status: 'pending', blockedReason: null, timing: mutationTiming(ephemeral) });
    }
    let store = null;
    try { store = this.#offlineQueueStore(); } catch { store = null; }
    if (!store || typeof store.outboxRecords !== 'function') {
      return Object.freeze({ status: 'unknown', timing: mutationTiming() });
    }
    const notWriter = typeof store.isWriter === 'function' && store.isWriter() !== true;
    const custody = await this.#reconcileQueueCustody(store);
    if (!custody.settled && !notWriter) return Object.freeze({ status: 'unknown', timing: mutationTiming() });
    let record;
    try {
      record = (await store.outboxRecords())
        .find((candidate) => candidate?.id === clientMutationId);
    } catch {
      return Object.freeze({ status: 'unknown', timing: mutationTiming() });
    }
    if (!record) return Object.freeze({ status: 'unknown', timing: mutationTiming() });
    const disposition = (value) => freezeDeep(value);
    if (record.status === 'pending') {
      // LLP 0218 §4.1: the current store records no durable
      // identity-horizon-passed marker, so outcome-unknown cannot be inferred
      // from a merely pending record and blockedReason remains null.
      const authorityStatus = this.authorityFence?.authorityTransitionStatus?.() ?? null;
      return Object.freeze({
        status: 'pending',
        blockedReason: authorityStatus?.transitionOwner === 'auth-coordinator' ? 'auth-barrier' : null,
        timing: mutationTiming(record),
      });
    }
    if (record.status === 'settled') {
      return freezeDeep({
        status: 'settled',
        settlement: structuredClone(record.settlement),
        settledAt: record.settledAt,
        timing: mutationTiming(record),
      });
    }
    if (record.status === 'failed') {
      return disposition({
        status: 'failed',
        failure: structuredClone(record.failure),
        timing: mutationTiming(record),
      });
    }
    if (record.status === 'stranded') {
      return disposition({ status: 'stranded', timing: mutationTiming(record) });
    }
    if (record.status === 'quarantined') {
      return disposition({ status: 'quarantined', timing: mutationTiming(record) });
    }
    if (record.status === 'result-gone') {
      return disposition({ status: 'resultGone', ...structuredClone(record.resultGone), timing: mutationTiming(record) });
    }
    return Object.freeze({ status: 'unknown', timing: mutationTiming(record) });
  }

  /// Observe one durable mutation disposition over the existing outbox seam.
  /// Initial delivery is promise-task asynchronous; listener failures remain
  /// observational and cannot perturb queue state.
  subscribeMutation(clientMutationId, listener) {
    if (typeof clientMutationId !== 'string' || clientMutationId.length === 0) {
      throw new TypeError('subscribeMutation requires a client mutation id');
    }
    if (typeof listener !== 'function') {
      throw new TypeError('subscribeMutation requires a listener function');
    }
    let active = true;
    let lastStatus = null;
    let observations = Promise.resolve();
    const observe = () => {
      observations = observations.then(async () => {
        if (!active) return;
        const disposition = await this.mutationStatus(clientMutationId);
        if (!active || disposition.status === lastStatus) return;
        lastStatus = disposition.status;
        try { listener(disposition); } catch { /* observation cannot own the queue */ }
      }).catch(() => { /* a transient unreadable store is not queue authority */ });
    };
    const unsubscribeOutbox = this.subscribeOutbox(observe);
    observe();
    return () => {
      active = false;
      unsubscribeOutbox();
    };
  }

  /// Payload-free application acknowledgement for outcome-known records whose
  /// retained result is gone. This is deliberately not re-record or replay:
  /// it releases the local ordered-successor fence only after the application
  /// has observed and accepted the missing-payload disposition.
  ///
  /// @ref LLP 0218#41-the-dispatch-union-headless-contract — resultGone is
  ///   non-replayable/non-rerecordable and requires one explicit acknowledge cut.
  async acknowledgeResultGoneMutations(clientMutationIds = []) {
    if (
      !Array.isArray(clientMutationIds)
      || clientMutationIds.some((id) => typeof id !== 'string' || id.length === 0)
    ) {
      throw new TypeError('acknowledgeResultGoneMutations requires an array of client mutation ids');
    }
    const ids = [...new Set(clientMutationIds)];
    const store = this.#offlineQueueStore(true);
    await this.#reconcileQueueCustody(store, { required: true });
    const records = new Map((await store.outboxRecords()).map((record) => [record?.id, record]));
    const invalid = ids.find((id) => records.get(id)?.status !== 'result-gone');
    if (invalid !== undefined) {
      const error = new Error(
        'SNAPBACK_OUTBOX_RESULT_GONE_NOT_CURRENT: acknowledge only retained result-gone mutation ids',
      );
      error.code = 'SNAPBACK_OUTBOX_RESULT_GONE_NOT_CURRENT';
      throw error;
    }
    const acknowledged = [];
    const release = await acquireOutboxAuthorizationDispatch(store);
    try {
      const discardFence = outboxAuthorizationFenceFrom(
        await store.outboxAuthorizationStatus(),
      );
      for (const id of ids) {
        if (await store.outboxDiscard(id, discardFence)) acknowledged.push(id);
      }
    } finally {
      await release();
    }
    if (acknowledged.length > 0) {
      this.#recordOutboxDiagnostic({
        code: 'SNAPBACK_OUTBOX_RESULT_GONE_ACKNOWLEDGED',
        acknowledged: acknowledged.length,
        clientMutationIds: acknowledged,
      });
      this.#notifyOutboxListeners();
    }
    return Object.freeze({
      acknowledged: acknowledged.length,
      clientMutationIds: Object.freeze(acknowledged),
    });
  }

  /// Stable, payload-free LLP 0081 tombstones. The durable store privately
  /// retains the complete intent for re-entry, but this public projection never
  /// exposes args, auth context, read sets, generated facts, or optimistic data.
  async quarantinedMutations() {
    const store = this.#offlineQueueStore();
    if (!store) return [];
    const custody = await this.#reconcileQueueCustody(store);
    if (!custody.settled) return [];
    return (await store.outboxRecords())
      .filter((record) => record?.status === 'quarantined')
      .map((record) => Object.freeze({
        format: OUTBOX_QUARANTINE_TOMBSTONE_FORMAT,
        status: 'quarantined',
        id: record.id,
        clientMutationId: record.clientMutationId ?? record.id,
        function: record.function,
        sequence: record.sequence,
        quarantinedAt: record.quarantinedAt,
        refusalCode: record.refusalCode,
        quarantineDisposition: record.quarantineDisposition,
        causeClientMutationId: record.causeClientMutationId,
        provenance: Object.freeze({
          source: 'server-replay-refusal',
          payload: 'redacted',
        }),
      }));
  }

  /// Explicit first-cut successor admission. The application calls this only
  /// after its successor artifacts have loaded/reconnected successfully. This
  /// moves the whole quarantine back to pending without transforming payloads;
  /// per-intent generated-fact classification is a named follow-on.
  async reenterQuarantinedMutations() {
    const store = this.#offlineQueueStore(true);
    await this.#reconcileQueueCustody(store, { required: true });
    if (typeof store.outboxReenterQuarantined !== 'function') {
      const error = new Error(
        'SNAPBACK_OFFLINE_QUEUE_STORE_INCAPABLE: store cannot re-enter quarantined mutations',
      );
      error.code = 'SNAPBACK_OFFLINE_QUEUE_STORE_INCAPABLE';
      throw error;
    }
    const release = await acquireOutboxAuthorizationDispatch(store);
    let result;
    try {
      const expectedAuthorizationFence = outboxAuthorizationFenceFrom(
        await store.outboxAuthorizationStatus(),
      );
      result = await store.outboxReenterQuarantined(expectedAuthorizationFence);
    } finally {
      await release();
    }
    if (!result) {
      const error = new Error(
        'SNAPBACK_OUTBOX_REENTRY_NOT_DURABLE: quarantined mutations were not re-entered',
      );
      error.code = 'SNAPBACK_OUTBOX_REENTRY_NOT_DURABLE';
      throw error;
    }
    await this.#refreshOptimisticMutationViews('upgrade-required-reentry');
    this.#recordOutboxDiagnostic({
      code: 'SNAPBACK_OFFLINE_MUTATIONS_REENTERED',
      count: result.count,
      clientMutationIds: result.clientMutationIds,
    });
    this.#notifyOutboxListeners();
    return Object.freeze({
      reentered: result.count,
      clientMutationIds: Object.freeze([...result.clientMutationIds]),
    });
  }

  async #currentStrandedCustody(store) {
    const custody = await this.#reconcileQueueCustody(store, { required: true });
    if (custody.authority === null) {
      const error = new Error(
        'SNAPBACK_OUTBOX_STRANDED_AUTHORITY_REQUIRED: stranded recovery requires settled session custody',
      );
      error.code = 'SNAPBACK_OUTBOX_STRANDED_AUTHORITY_REQUIRED';
      throw error;
    }
    return custody.authority;
  }

  /// Full-byte, rerecordable intents owned by the currently re-attested
  /// principal. The explicit projection cannot acquire credential material
  /// because no credential, sender, or lease field is copied into the queue.
  async strandedMutations() {
    const store = this.#offlineQueueStore(true);
    const authority = await this.#currentStrandedCustody(store);
    return (await store.outboxRecords())
      .filter((record) => (
        record?.status === 'stranded'
        && record.rerecordable === true
        && samePrincipalScope(record.predecessorPrincipalScope, authority.principalScope)
      ))
      .map((record) => freezeDeep(structuredClone({
        status: 'stranded',
        id: record.id,
        clientMutationId: record.id,
        function: record.function,
        args: record.args,
        userId: record.userId ?? null,
        readSet: record.readSet ?? [],
        correlation: record.correlation ?? null,
        ctxLedger: record.ctxLedger ?? null,
        expectedGeneration: record.expectedGeneration ?? null,
        settlementLane: record.settlementLane ?? 'replay-accept',
        settlementIdentity: record.settlementIdentity ?? null,
        settlementClaims: record.settlementClaims ?? null,
        boundedSkew: record.boundedSkew ?? null,
        operationIssuance: record.operationIssuance ?? null,
        operationCoverageDisposition: record.operationCoverageDisposition ?? null,
        optimisticOperation: record.optimisticOperation ?? null,
        capturedNow: record.capturedNow ?? null,
        sequence: record.sequence,
        enqueuedAt: record.enqueuedAt,
        authorityDescriptor: record.authorityDescriptor,
        predecessorPrincipalScope: record.predecessorPrincipalScope,
        disposition: 'strand',
        reason: record.reason,
        strandedAt: record.strandedAt,
        replayable: false,
        rerecordable: true,
      })));
  }

  async discardStrandedMutations(clientMutationIds = []) {
    if (!Array.isArray(clientMutationIds) || clientMutationIds.some((id) => typeof id !== 'string')) {
      throw new TypeError('discardStrandedMutations requires an array of client mutation ids');
    }
    const store = this.#offlineQueueStore(true);
    const authority = await this.#currentStrandedCustody(store);
    const release = await acquireOutboxAuthorizationDispatch(store);
    let result;
    try {
      const discardFence = outboxAuthorizationFenceFrom(
        await store.outboxAuthorizationStatus(),
      );
      if (this.authorityFence?.isCurrent?.(authority.capture) !== true) {
        throw staleAuthorityError();
      }
      result = await store.outboxDiscardStranded(
        [...new Set(clientMutationIds)],
        authority.principalScope,
        discardFence,
      );
    } finally {
      await release();
    }
    if (!result) throw staleAuthorityError();
    if (this.authorityFence?.isCurrent?.(authority.capture) !== true) throw staleAuthorityError();
    if (result.discarded > 0) {
      this.#recordOutboxDiagnostic({
        code: 'SNAPBACK_OFFLINE_STRANDED_MUTATIONS_DISCARDED',
        discarded: result.discarded,
        clientMutationIds: result.clientMutationIds,
      });
      await this.#refreshOptimisticMutationViews('stranded-discard');
    }
    return Object.freeze({
      discarded: result.discarded,
      clientMutationIds: Object.freeze([...result.clientMutationIds]),
    });
  }

  async reRecordStrandedMutation(clientMutationId, options = {}) {
    if (typeof clientMutationId !== 'string' || clientMutationId.length === 0) {
      throw new TypeError('reRecordStrandedMutation requires a client mutation id');
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('reRecordStrandedMutation options must be an object');
    }
    const store = this.#offlineQueueStore(true);
    const authority = await this.#currentStrandedCustody(store);
    const record = (await store.outboxRecords()).find((candidate) => (
      candidate?.id === clientMutationId
      && candidate.status === 'stranded'
      && candidate.rerecordable === true
      && samePrincipalScope(candidate.predecessorPrincipalScope, authority.principalScope)
    ));
    if (!record) {
      const error = new Error(
        'SNAPBACK_OUTBOX_STRANDED_NOT_CURRENT: no rerecordable stranded mutation belongs to the current principal',
      );
      error.code = 'SNAPBACK_OUTBOX_STRANDED_NOT_CURRENT';
      throw error;
    }
    if (this.authorityFence?.isCurrent?.(authority.capture) !== true) throw staleAuthorityError();

    // Re-recording is a new intent: the predecessor's exactly-once id,
    // descriptor, custody, and finite operation issuance are never reused.
    // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — explicit re-record mints a
    //   new clientMutationId; there is no cross-authority exactly-once bridge.
    const nextClientMutationId = createClientMutationId();
    const ref = outboxReplayReference(record);
    await this.mutate(ref, {
      args: options.args ?? structuredClone(record.args),
      userId: options.userId ?? record.userId ?? undefined,
      readSet: options.readSet ?? structuredClone(record.readSet ?? []),
      correlation: options.correlation ?? structuredClone(record.correlation ?? null),
      clientMutationId: nextClientMutationId,
      ctxLedger: options.ctxLedger ?? structuredClone(record.ctxLedger ?? null),
      settlementLane: options.settlementLane ?? record.settlementLane ?? 'replay-accept',
      settlementIdentity: options.settlementIdentity ?? null,
      settlementClaims:
        options.settlementClaims ?? structuredClone(record.settlementClaims ?? null),
      boundedSkew: options.boundedSkew ?? structuredClone(record.boundedSkew ?? null),
      optimisticOperation:
        options.optimisticOperation ?? structuredClone(record.optimisticOperation ?? null),
      operationIssuance: null,
      operationCoverageDisposition: null,
      queue: options.queue ?? 'auto',
    });

    // Mint and durably issue the replacement before deleting its predecessor.
    // A refused replacement therefore leaves the recoverable source bytes
    // intact. There is no atomic bridge across authorities; a failed cleanup
    // leaves a visible duplicate affordance instead of silently losing intent.
    let discarded = null;
    let discardError = null;
    try {
      const release = await acquireOutboxAuthorizationDispatch(store);
      try {
        const discardFence = outboxAuthorizationFenceFrom(
          await store.outboxAuthorizationStatus(),
        );
        if (this.authorityFence?.isCurrent?.(authority.capture) !== true) {
          throw staleAuthorityError();
        }
        discarded = await store.outboxDiscardStranded(
          [clientMutationId],
          authority.principalScope,
          discardFence,
        );
      } finally {
        await release();
      }
      if (discarded?.discarded !== 1) discardError = staleAuthorityError();
    } catch (error) {
      discardError = error;
    }
    if (discardError === null) {
      await this.#refreshOptimisticMutationViews('stranded-rerecord-discard');
      this.#notifyOutboxListeners();
    } else {
      this.#recordOutboxDiagnostic({
        code: 'SNAPBACK_OFFLINE_STRANDED_MUTATION_RERECORD_DISCARD_FAILED',
        predecessorClientMutationId: clientMutationId,
        clientMutationId: nextClientMutationId,
        reason: discarded === null ? 'store_error' : 'store_refused',
        causeCode: discardError?.code ?? discardError?.diagnostic?.code ?? null,
      });
    }
    this.#recordOutboxDiagnostic({
      code: 'SNAPBACK_OFFLINE_STRANDED_MUTATION_RERECORDED',
      predecessorClientMutationId: clientMutationId,
      clientMutationId: nextClientMutationId,
    });
    return nextClientMutationId;
  }

  /// Notification seam for outbox projections: fires after every recorded
  /// outbox transition (queue, replay, settle-failure) and around each
  /// single-flight drain. Listeners observe; they never own queue state.
  subscribeOutbox(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribeOutbox requires a listener function');
    }
    this.__outboxListeners.add(listener);
    return () => { this.__outboxListeners.delete(listener); };
  }

  /// Complete settlements retained across a response-loss/crash cut. Reading
  /// does not make them ACK-eligible; the application first recovers/publishes
  /// them, then calls markMutationSettlementsConsumed or acknowledgeMutations.
  async #currentSettlementRecoveryCohort(devUserId = null) {
    const userId = typeof devUserId === 'string' ? devUserId : null;
    if (this.authProtocols.authClient == null) {
      return { userId, authorityDescriptor: null, enforceAuthorityDescriptor: false };
    }
    const session = await this.authSession();
    const authorityDescriptor = requireAuthorityDescriptor(
      session?.authorityDescriptor,
      'SNAPBACK_AUTHORITY_DESCRIPTOR_INVALID',
    );
    return {
      // `record.userId` is the dev-mode body selector, not the authenticated
      // session principal. Sessions are isolated by the re-attested descriptor.
      userId: session?.activeMode === 'sessions' ? null : userId,
      authorityDescriptor,
      enforceAuthorityDescriptor: true,
    };
  }

  async settledMutations({ userId = null } = {}) {
    const store = this.#offlineQueueStore();
    if (!store || typeof store.outboxRecords !== 'function') return [];
    await this.#reconcileQueueCustody(store, { required: true });
    const cohort = await this.#currentSettlementRecoveryCohort(userId);
    return (await store.outboxRecords())
      .filter((record) => record?.status === 'settled')
      .filter((record) => (record.userId ?? null) === cohort.userId)
      .filter((record) => (
        !cohort.enforceAuthorityDescriptor
        || sameAuthorityDescriptor(
          record.settlementAuthorityDescriptor ?? record.settlement?.authorityDescriptor,
          cohort.authorityDescriptor,
        )
      ))
      .map((record) => Object.freeze({
        clientMutationId: record.id,
        function: record.function,
        settlement: structuredClone(record.settlement),
        settledAt: record.settledAt,
        authorityDescriptor: record.settlementAuthorityDescriptor
          ?? record.settlement?.authorityDescriptor
          ?? null,
      }));
  }

  async markMutationSettlementsConsumed(clientMutationIds = [], { userId = null } = {}) {
    const store = this.#offlineQueueStore(true);
    if (typeof store.outboxMarkAcknowledgementsReady !== 'function') {
      const error = new Error(
        'SNAPBACK_OFFLINE_QUEUE_STORE_INCAPABLE: store cannot publish settlement consumption',
      );
      error.code = 'SNAPBACK_OFFLINE_QUEUE_STORE_INCAPABLE';
      throw error;
    }
    const cohort = await this.#currentSettlementRecoveryCohort(userId);
    return store.outboxMarkAcknowledgementsReady(
      clientMutationIds,
      cohort.userId,
      cohort.enforceAuthorityDescriptor ? cohort.authorityDescriptor : undefined,
    );
  }

  /// Terminal-auth fact for rigs and admin tools (0137 A6 f3): a pure
  /// projection of the custody cut this client already performs on a
  /// terminal auth loss (SNAPBACK_AUTH_STREAM_RESET after a receipted
  /// reset-install, session revocation, finite auth refusals).
  /// `terminated: true` means this client's current authority is permanently
  /// done — reconnect retries will not recover it; rebuild the session
  /// (fresh sign-in or an explicit custody replacement such as
  /// replaceBearerToken / replaceAgentCredential), which clears the fact.
  /// The projection changes nothing: recording happens at the existing
  /// terminal choke point, and the authority posture (reset never
  /// resurrects authority) is untouched.
  authTerminalStatus() {
    return this.__authTerminalFact ?? Object.freeze({
      terminated: false,
      code: null,
      authorityDisposition: null,
      atMs: null,
    });
  }

  /// Notification seam for the terminal-auth projection: fires after a
  /// terminal fact is recorded or escalated (carrier → durableDelete) and
  /// after a custody replacement clears it. Listeners observe via
  /// authTerminalStatus(); they never own auth state, and a throwing
  /// listener cannot perturb the custody cut.
  subscribeAuthTerminal(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribeAuthTerminal requires a listener function');
    }
    this.__authTerminalListeners.add(listener);
    return () => { this.__authTerminalListeners.delete(listener); };
  }

  /** Settled-authority signal projected from the shared coordinator. */
  authorityTransitionStatus() {
    const ephemeralAuthorityPending = this.__ephemeralAuthorityPendingRetryDepth > 0;
    const reconnecting = ephemeralAuthorityPending || [...(this.__liveStreamManagers?.values?.() ?? [])].some((manager) => {
      const inspection = manager.inspection();
      return inspection.closed !== true && inspection.socketDemand > 0 && !manager.isReady();
    });
    const modePending = this.__authModePendingRetryDepth > 0;
    if (typeof this.authorityFence?.authorityTransitionStatus === 'function') {
      return this.authorityFence.authorityTransitionStatus({
        reconnecting,
        modePending,
        ephemeralAuthorityPending,
      });
    }
    let settled = false;
    try { settled = this.authorityFence === null || this.authorityFence.capture?.() !== null; } catch {}
    const principal = this.auth.currentPrincipal();
    const current = principal.status === 'authenticated'
      ? { kind: 'session' }
      : { kind: 'anonymous' };
    return Object.freeze({
      state: classifyClientAuthorityState({ current, reconnecting, modePending }),
      settled,
      subscribeSafe: settled,
      ephemeralAuthorityUsable: settled && !ephemeralAuthorityPending,
      transitionOwner: null,
      barrierPhase: null,
      authorityEpoch: null,
      custodyRevision: null,
      closed: this.__clientClosed,
    });
  }

  subscribeAuthorityTransition(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribeAuthorityTransition requires a listener function');
    }
    this.__authorityTransitionListeners.add(listener);
    let unsubscribeFence = null;
    if (typeof this.authorityFence?.subscribeAuthorityTransition === 'function') {
      unsubscribeFence = this.authorityFence.subscribeAuthorityTransition(() => {
        if (this.__authorityTransitionListeners.has(listener)) {
          listener(this.authorityTransitionStatus());
        }
      });
    } else {
      listener(this.authorityTransitionStatus());
    }
    return () => {
      this.__authorityTransitionListeners.delete(listener);
      unsubscribeFence?.();
    };
  }

  __notifyAuthorityTransitionStatus() {
    const status = this.authorityTransitionStatus();
    for (const listener of [...this.__authorityTransitionListeners]) {
      try { listener(status); } catch { /* observer isolation */ }
    }
  }

  #recordAuthTerminalFact(error, authorityDisposition) {
    const code = error?.diagnostic?.code ?? error?.code ?? null;
    const previous = this.__authTerminalFact;
    if (
      previous
      && previous.code === code
      && previous.authorityDisposition === authorityDisposition
    ) return;
    this.__authTerminalFact = Object.freeze({
      terminated: true,
      code,
      authorityDisposition,
      atMs: Date.now(),
    });
    this.#notifyAuthTerminalListeners();
  }

  #clearAuthTerminalFact() {
    if (this.__authTerminalFact !== null) {
      this.__authTerminalFact = null;
      this.#notifyAuthTerminalListeners();
    }
    // @ref LLP 0218#43-the-platform-owned-drain — successor custody can bind
    //   without enqueue/connectivity edges (and without a prior terminal fact),
    //   so the existing outbox observation seam also carries this level wake.
    this.__outboxCustodyWakeGeneration += 1;
    this.#notifyOutboxListeners();
  }

  #notifyAuthTerminalListeners() {
    for (const listener of [...this.__authTerminalListeners]) {
      try { listener(); } catch { /* observation cannot own auth state */ }
    }
  }

  #operationIdentityCohortKey(clientAudienceId, userId, authorityDescriptor) {
    const authorityCohort = typeof authorityDescriptor?.authorityInstanceId === 'string'
      ? `authority:${authorityDescriptor.authorityInstanceId}`
      : `dev:${typeof userId === 'string' ? userId : 'anonymous'}`;
    return `client-store:${clientAudienceId}:${authorityCohort}`;
  }

  async #refreshOperationIdentityRange(
    store,
    authorityCohortKey,
    clientAudienceId,
    userId,
    authorityDescriptor,
    authorityCapture,
  ) {
    const previousRange = await store.outboxOperationIdentityRange(authorityCohortKey);
    const body = {
      schemaVersion: 1,
      auth: SnapbackClient.auth(userId),
      clientAudienceId,
    };
    if (authorityDescriptor) body.authorityDescriptor = authorityDescriptor;
    if (previousRange) body.previousRange = previousRange;
    const response = await this.#req(
      'POST',
      '/client-mutations/identity-range',
      body,
      undefined,
      { expectedAuthorityCapture: authorityCapture },
    );
    if (response?.schemaVersion !== 1 || !response.range) {
      const error = new Error(
        'SNAPBACK_OPERATION_RANGE_RESPONSE_INVALID: server returned no v1 identity range',
      );
      error.code = 'SNAPBACK_OPERATION_RANGE_RESPONSE_INVALID';
      throw error;
    }
    return response.range;
  }

  /// Durable enqueue of one refused-by-connectivity mutation intent.
  /// Returns the queued marker, or null when the store refused (the caller
  /// then surfaces the ORIGINAL connectivity error — an enqueue failure must
  /// never masquerade as queued success).
  async #enqueueOfflineMutation(
    store,
    record,
    {
      alreadyCommitted = false,
      functionId = record.function,
      queueReasonClass = 'connectivity',
    } = {},
  ) {
    try {
      let authority = null;
      if (this.authorityFence && !alreadyCommitted) {
        try {
          authority = await this.#captureQueueAuthority();
        } catch (error) {
          if (!isAuthorityFenceUnsettledError(error)) throw error;
          this.#recordOutboxDiagnostic({
            code: 'SNAPBACK_OFFLINE_MUTATION_QUEUE_REFUSED',
            mutation: record.function,
            reason: authorityErrorCode(error),
            custody: 'authority_unsettled',
          });
          return null;
        }
      }
      let stored;
      if (alreadyCommitted) {
        stored = (await store.outboxRecords()).find((candidate) => candidate?.id === record.id);
        if (!stored) return null;
      } else {
        const queueFence = outboxAuthorizationFenceFrom(
          await store.outboxAuthorizationStatus(),
        );
        if (
          authority !== null
          && this.authorityFence?.isCurrent?.(authority.capture) !== true
        ) throw staleAuthorityError();
        stored = await store.outboxEnqueue(
          this.#recordWithQueueAuthority(record, authority),
          queueFence,
        );
        this.#recordRuntimeCostOutboxEnqueue(stored, functionId);
      }
      if (
        !alreadyCommitted
        && !await this.#compensateStaleQueueWrite(store, stored.id, authority, {
          insertionOwnership: outboxInsertionOwnershipFrom(stored),
          expectedAuthorizationFence: outboxAuthorizationFenceFrom(stored),
        })
      ) return null;
      const queuedDiagnostic = this.#emitQueuedRelinquishmentDiagnostic({
        mutation: record.function,
        clientMutationId: stored.id,
        sequence: stored.sequence,
        queueReasonClass,
      });
      this.#recordOutboxDiagnostic({
        code: 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
        mutation: record.function,
        clientMutationId: stored.id,
        sequence: stored.sequence,
        ...queuedDiagnostic,
      });
      if (stored.optimisticOperation != null) {
        await this.#refreshOptimisticMutationViews('generated-ir-queued');
      }
      // @ref LLP 0218#41-the-dispatch-union-headless-contract — connectivity
      //   relinquishment, not durable insertion, is the queued dispatch cut.
      return {
        status: 'queued',
        clientMutationId: stored.id,
        sequence: stored.sequence,
        presentation: this.#optimisticPresentationDisposition(stored.id),
      };
    } catch (error) {
      this.#recordOutboxDiagnostic({
        code: 'SNAPBACK_OFFLINE_MUTATION_QUEUE_REFUSED',
        mutation: record.function,
        reason: error?.code ?? error?.message ?? String(error),
      });
      return null;
    }
  }

  /// Start (or join) the lifecycle owner for one durable store's replay lane.
  /// The returned handle is deliberately headless; React attaches it later.
  startOutboxDrain(options = {}) {
    if (this.__clientClosed) {
      const error = new Error('SNAPBACK_CLIENT_CLOSED: outbox drain cannot start after close()');
      error.code = 'SNAPBACK_CLIENT_CLOSED';
      throw error;
    }
    const normalized = this.#normalizeOutboxDrainOptions(options);
    const store = this.#offlineQueueStore(true);
    let lifecycle = outboxDrainControllersByStore.get(store) ?? null;
    if (lifecycle === null) {
      lifecycle = this.#createOutboxDrainLifecycle(store);
      outboxDrainControllersByStore.set(store, lifecycle);
    }
    const handle = lifecycle.join(this, normalized);
    this.__outboxDrainController = lifecycle;
    this.__outboxDrainHandle = handle;
    return handle;
  }

  // React providers predate client-owned default drain lifetimes. This
  // internal composition seam lets a mounted provider temporarily project its
  // auto/manual policy onto the same client participant without acquiring a
  // second kill-capable owner; provider disposal restores constructor policy.
  __configureOutboxDrain(mode = this.outboxDrainPolicy, options = {}) {
    if (this.__clientClosed) {
      const error = new Error('SNAPBACK_CLIENT_CLOSED: outbox drain cannot configure after close()');
      error.code = 'SNAPBACK_CLIENT_CLOSED';
      throw error;
    }
    if (mode !== 'auto' && mode !== 'manual') {
      throw new TypeError("outboxDrain must be 'auto' or 'manual'");
    }
    const normalized = this.#normalizeOutboxDrainOptions({
      ...options,
      automatic: mode === 'auto',
    });
    const store = this.#offlineQueueStore(true);
    let lifecycle = outboxDrainControllersByStore.get(store) ?? null;
    if (lifecycle === null) {
      lifecycle = this.#createOutboxDrainLifecycle(store);
      outboxDrainControllersByStore.set(store, lifecycle);
    }
    const handle = lifecycle.configure(this, normalized);
    this.__outboxDrainController = lifecycle;
    this.__outboxDrainHandle = handle;
    return handle;
  }

  #normalizeOutboxDrainOptions(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('startOutboxDrain options must be an object');
    }
    if (options.automatic !== undefined && typeof options.automatic !== 'boolean') {
      throw new TypeError('startOutboxDrain automatic must be boolean');
    }
    const automatic = options.automatic !== false;
    const timer = options.timer ?? {};
    if (timer === null || typeof timer !== 'object' || Array.isArray(timer)) {
      throw new TypeError('startOutboxDrain timer must be an object');
    }
    const schedule = typeof timer.setTimeout === 'function'
      ? timer.setTimeout.bind(timer)
      : (callback, delay) => setTimeout(callback, delay);
    const cancel = typeof timer.clearTimeout === 'function'
      ? timer.clearTimeout.bind(timer)
      : (scheduled) => clearTimeout(scheduled);
    const now = typeof timer.now === 'function' ? timer.now.bind(timer) : () => Date.now();
    const random = typeof timer.random === 'function' ? timer.random.bind(timer) : () => Math.random();
    if (
      typeof schedule !== 'function'
      || typeof cancel !== 'function'
      || typeof now !== 'function'
      || typeof random !== 'function'
    ) {
      throw new TypeError('startOutboxDrain timer requires function-valued timer hooks');
    }
    const defaultEventTarget = (
      typeof globalThis.addEventListener === 'function'
      && typeof globalThis.removeEventListener === 'function'
    ) ? globalThis : null;
    const eventTarget = options.eventTarget === undefined ? defaultEventTarget : options.eventTarget;
    if (
      eventTarget !== null
      && (
        typeof eventTarget?.addEventListener !== 'function'
        || typeof eventTarget?.removeEventListener !== 'function'
      )
    ) {
      throw new TypeError('startOutboxDrain eventTarget must provide add/removeEventListener');
    }
    return Object.freeze({
      automatic,
      schedule,
      cancel,
      now,
      random,
      eventTarget,
    });
  }

  #createOutboxDrainLifecycle(store) {
    const participants = new Map();
    let engine = null;
    let engineSpec = null;
    let generation = 0;
    let transitioning = false;
    let transitionTask = Promise.resolve();
    let pendingFreshBarrier = false;
    let lastOutcome = Object.freeze({
      replayed: 0, failed: 0, stranded: 0, quarantined: 0, remaining: 0,
    });
    let lifecycle;

    const desiredSpec = () => {
      const active = [...participants.values()].filter((participant) => participant.active);
      const owner = active.find((participant) => participant.options.automatic) ?? active[0] ?? null;
      if (owner === null) return null;
      return Object.freeze({
        owner,
        automatic: active.some((participant) => participant.options.automatic),
      });
    };

    const startDesired = (token) => {
      if (token !== generation) return null;
      const desired = desiredSpec();
      if (desired === null || desired.owner.client.__clientClosed) {
        if (participants.size === 0 && outboxDrainControllersByStore.get(store) === lifecycle) {
          outboxDrainControllersByStore.delete(store);
        }
        return null;
      }
      const engineOptions = Object.freeze({
        ...desired.owner.options,
        automatic: desired.automatic,
      });
      engine = desired.owner.client.#createOutboxDrainEngine(store, engineOptions, lifecycle);
      engineSpec = Object.freeze({
        owner: desired.owner,
        automatic: desired.automatic,
        options: desired.owner.options,
      });
      if (pendingFreshBarrier) {
        pendingFreshBarrier = false;
        engine.noteFreshBarrier();
      }
      return engine;
    };

    const reconcile = () => {
      const desired = desiredSpec();
      if (
        engine?.running === true
        && desired !== null
        && engineSpec?.owner === desired.owner
        && engineSpec.automatic === desired.automatic
        && engineSpec.options === desired.owner.options
      ) return Promise.resolve(lastOutcome);

      generation += 1;
      const token = generation;
      const previous = engine;
      engine = null;
      engineSpec = null;
      if (previous !== null) previous.handle.stop();
      const previousSettled = previous === null
        ? transitionTask
        : previous.settled().then((outcome) => {
            lastOutcome = outcome;
            return outcome;
          });

      if (previous === null && !transitioning) {
        startDesired(token);
        transitionTask = Promise.resolve(lastOutcome);
        return transitionTask;
      }

      transitioning = true;
      transitionTask = Promise.resolve(previousSettled)
        .catch(() => lastOutcome)
        .then(() => startDesired(token))
        .finally(() => {
          if (token === generation) transitioning = false;
        });
      return previousSettled;
    };

    const stoppedStatus = (automatic = false) => Object.freeze({
      running: false,
      automatic,
      drainPhase: 'idle',
      lastAttemptAtMs: null,
      nextRetryAtMs: null,
      blockedReason: null,
    });

    const participantHandle = (participant) => Object.freeze({
      async drainNow() {
        if (!participant.active) return lastOutcome;
        return lifecycle.drainNow();
      },
      stop() {
        if (!participant.active) return;
        void lifecycle.releaseClient(participant.client);
      },
      status() {
        if (!participant.active) return stoppedStatus(participant.options.automatic);
        return lifecycle.status();
      },
    });

    lifecycle = {
      store,
      get running() { return engine?.running === true; },
      get handle() { return engine?.handle ?? null; },
      status() {
        const status = engine?.status?.();
        if (status) return status;
        return stoppedStatus(desiredSpec()?.automatic ?? false);
      },
      join(client, options) {
        const existing = participants.get(client) ?? null;
        if (existing?.active) return existing.handle;
        const participant = {
          client,
          options,
          active: true,
          handle: null,
          cleanups: [],
        };
        participant.handle = participantHandle(participant);
        participant.cleanups.push(
          client.subscribeOutbox(() => lifecycle.noteOutboxTransition()),
          client.subscribeAuthTerminal(() => lifecycle.wake('participant-authority-transition')),
          client.subscribeAuthorityTransition((status) => {
            if (status.settled) lifecycle.wake('settled-authority');
          }),
        );
        participants.set(client, participant);
        try { reconcile(); } catch (error) {
          participant.active = false;
          participants.delete(client);
          for (const cleanup of participant.cleanups.splice(0)) cleanup();
          if (participants.size === 0) outboxDrainControllersByStore.delete(store);
          throw error;
        }
        return participant.handle;
      },
      configure(client, options) {
        let participant = participants.get(client) ?? null;
        if (!participant?.active) return lifecycle.join(client, options);
        participant.options = options;
        reconcile();
        return participant.handle;
      },
      releaseClient(client) {
        const participant = participants.get(client) ?? null;
        if (!participant?.active) return Promise.resolve(lastOutcome);
        participant.active = false;
        participants.delete(client);
        for (const cleanup of participant.cleanups.splice(0)) {
          try { cleanup(); } catch { /* observation teardown remains best-effort */ }
        }
        if (client.__outboxDrainController === lifecycle) {
          client.__outboxDrainController = null;
          client.__outboxDrainHandle = null;
        }
        return Promise.resolve(reconcile());
      },
      async drainNow() {
        await transitionTask;
        if (engine?.running !== true) {
          reconcile();
          await transitionTask;
        }
        if (engine?.running !== true) return lastOutcome;
        lastOutcome = await engine.handle.drainNow();
        return lastOutcome;
      },
      noteFreshBarrier() {
        if (engine?.running === true) engine.noteFreshBarrier();
        else pendingFreshBarrier = true;
      },
      wake(reason) {
        return engine?.running === true ? engine.wake(reason) : Promise.resolve(lastOutcome);
      },
      noteOutboxTransition() {
        return engine?.running === true
          ? engine.noteOutboxTransition()
          : Promise.resolve(lastOutcome);
      },
    };
    return lifecycle;
  }

  #createOutboxDrainEngine(store, options, lifecycle) {
    const {
      automatic,
      schedule,
      cancel,
      now,
      random,
      eventTarget,
    } = options;

    outboxDrainControllerCounter += 1;
    const connectionId = `snapback-outbox-drain-${outboxDrainControllerCounter}`;
    let running = true;
    let requested = false;
    let requestGeneration = 0;
    let activeCycleRequestGeneration = 0;
    let pumpTask = null;
    let retryTimer = null;
    let housekeepingRetryTimer = null;
    let writerPollTimer = null;
    let retryAttempt = 0;
    let freshBarrierAvailable = false;
    let drainPhase = 'idle';
    let lastAttemptAtMs = null;
    let nextRetryAtMs = null;
    let blockedReason = null;
    let publishing = false;
    let replayingCore = false;
    let replayWakePending = false;
    let resolveStopped;
    const stoppedTask = new Promise((resolve) => { resolveStopped = resolve; });
    let engineSettlementTask = null;
    const ownedTimers = new Set();
    const barrierWaitCancelers = new Set();
    let lastOutcome = Object.freeze({
      replayed: 0, failed: 0, stranded: 0, quarantined: 0, remaining: 0,
    });
    const cleanups = [];
    let handle;

    const controller = {
      client: this,
      store,
      lifecycle,
      connectionId,
      automatic,
      get running() { return running; },
      get handle() { return handle; },
      settled: () => engineSettlementTask ?? Promise.resolve(lastOutcome),
      wake: (reason) => requestCycle(reason),
      noteOutboxTransition: () => {
        if (!running || publishing) return Promise.resolve(lastOutcome);
        if (replayingCore) {
          // Replay publishes its own bookkeeping transitions. Only a
          // foreground-owned record can be absent from this replay snapshot
          // and become eligible when its foreground attempt relinquishes.
          if (foregroundOutboxFenceSequence(store) !== null) replayWakePending = true;
          return Promise.resolve(lastOutcome);
        }
        return requestCycle('participant-outbox-transition');
      },
      status: () => Object.freeze({
        running,
        automatic,
        drainPhase,
        lastAttemptAtMs,
        nextRetryAtMs,
        blockedReason,
      }),
      takeFreshBarrier: () => {
        if (!freshBarrierAvailable) return false;
        freshBarrierAvailable = false;
        return true;
      },
      noteFreshBarrier: () => {
        if (!running) return;
        freshBarrierAvailable = true;
        // A cycle already waiting for its provider consumes this evidence in
        // place; scheduling a sibling cycle would merely repeat the barrier.
        if (drainPhase !== 'waiting-barrier' && automatic) requestCycle('fresh-barrier');
      },
    };

    const publish = (phase, reason = null, retryAt = null) => {
      if (!running) return;
      drainPhase = phase;
      blockedReason = reason;
      nextRetryAtMs = retryAt;
      publishing = true;
      try { this.#notifyOutboxListeners(); } finally { publishing = false; }
    };

    const clearRetryTimer = () => {
      if (retryTimer === null) return;
      cancel(retryTimer);
      ownedTimers.delete(retryTimer);
      retryTimer = null;
      nextRetryAtMs = null;
    };

    const clearHousekeepingRetryTimer = () => {
      if (housekeepingRetryTimer === null) return;
      cancel(housekeepingRetryTimer);
      ownedTimers.delete(housekeepingRetryTimer);
      housekeepingRetryTimer = null;
    };

    const clearWriterPollTimer = () => {
      if (writerPollTimer === null) return;
      cancel(writerPollTimer);
      ownedTimers.delete(writerPollTimer);
      writerPollTimer = null;
    };

    const timerHandle = (callback, delay) => {
      let scheduled;
      scheduled = schedule(() => {
        ownedTimers.delete(scheduled);
        return callback();
      }, delay);
      ownedTimers.add(scheduled);
      scheduled?.unref?.();
      return scheduled;
    };

    const replayStopReason = (fallback) => {
      const reason = this.__outboxLastReplayStop?.reason;
      return typeof reason === 'string' && reason.length > 0 ? reason : fallback;
    };

    const rearmLatchedReplayWake = () => {
      if (!replayWakePending) return false;
      replayWakePending = false;
      requested = true;
      return true;
    };

    const withBarrierDeadline = (operation) => new Promise((resolve, reject) => {
      let settled = false;
      const finish = (settle, value) => {
        if (settled) return;
        settled = true;
        cancel(deadline);
        ownedTimers.delete(deadline);
        barrierWaitCancelers.delete(cancelWait);
        settle(value);
      };
      const cancelWait = () => {
        const error = new Error(
          'SNAPBACK_OUTBOX_DRAIN_STOPPED: the drain controller stopped during its resync barrier',
        );
        error.code = 'SNAPBACK_OUTBOX_DRAIN_STOPPED';
        finish(reject, error);
      };
      const deadline = timerHandle(() => {
        const error = new Error(
          'SNAPBACK_OUTBOX_DRAIN_BARRIER_TIMEOUT: no authoritative resync cut arrived within the bounded barrier window',
        );
        error.code = 'SNAPBACK_OUTBOX_DRAIN_BARRIER_TIMEOUT';
        finish(reject, error);
      }, OUTBOX_DRAIN_BARRIER_TIMEOUT_MS);
      barrierWaitCancelers.add(cancelWait);
      Promise.resolve(operation).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });

    const scheduleBackoff = (reason) => {
      if (!running) return;
      const wakeAlreadyQueued = requestGeneration !== activeCycleRequestGeneration;
      requested = false;
      rearmLatchedReplayWake();
      clearRetryTimer();
      clearWriterPollTimer();
      for (const cancelWait of [...barrierWaitCancelers]) cancelWait();
      for (const scheduled of [...ownedTimers]) {
        cancel(scheduled);
        ownedTimers.delete(scheduled);
      }
      freshBarrierAvailable = false;
      const exponent = Math.min(retryAttempt, 30);
      const ceiling = Math.min(
        OUTBOX_DRAIN_RETRY_MAX_MS,
        OUTBOX_DRAIN_RETRY_BASE_MS * 2 ** exponent,
      );
      const sample = Number(random());
      const jitter = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
      const delay = Math.max(1, Math.min(
        OUTBOX_DRAIN_RETRY_MAX_MS,
        Math.floor(ceiling * (0.75 + jitter * 0.25)),
      ));
      retryAttempt += 1;
      const retryAt = now() + delay;
      publish('backoff', reason, retryAt);
      retryTimer = timerHandle(() => {
        retryTimer = null;
        nextRetryAtMs = null;
        requestCycle('backoff-expired');
      }, delay);
      if (wakeAlreadyQueued) {
        clearRetryTimer();
        requested = true;
      }
    };

    const scheduleWriterPoll = () => {
      if (
        !running
        || writerPollTimer !== null
        || typeof store.subscribeWriterLock === 'function'
      ) return;
      writerPollTimer = timerHandle(async () => {
        writerPollTimer = null;
        if (!running) return;
        // File/Expo carriers have no native cross-process lock event. Re-read
        // the level before every bounded poll so a writer that already settled
        // the durable intent makes this reader go idle instead of polling an
        // empty queue forever.
        // @ref LLP 0218#43-the-platform-owned-drain — fallback lock polling is
        //   permitted only while pending work exists in a non-writer context.
        try {
          if ((await scanPending()).length === 0) {
            publish('idle', null, null);
            return;
          }
        } catch {
          // Keep the observable not-writer pause and retry at the same bounded
          // cadence; unreadable storage is not proof that intent disappeared.
        }
        if (!running) return;
        try { await store.whenLockSettled?.(); } catch { /* next bounded poll retries */ }
        if (!running) return;
        if (store.isWriter?.() === true) requestCycle('writer-lock-acquired');
        else scheduleWriterPoll();
      }, OUTBOX_DRAIN_WRITER_POLL_MS);
    };

    const pause = (reason, { pollWriter = false } = {}) => {
      const wakeAlreadyQueued = requestGeneration !== activeCycleRequestGeneration;
      requested = false;
      rearmLatchedReplayWake();
      clearRetryTimer();
      if (!pollWriter) clearWriterPollTimer();
      publish('paused', reason, null);
      if (pollWriter) scheduleWriterPoll();
      if (wakeAlreadyQueued) requested = true;
    };

    const barrierFailure = (error) => {
      const code = error?.diagnostic?.code ?? error?.code ?? 'unavailable';
      if (
        isConnectivityFailureError(error)
        || code === 'SNAPBACK_OUTBOX_DRAIN_BARRIER_TIMEOUT'
        || error?.status === 408
        || error?.status === 429
        || (Number.isInteger(error?.status) && error.status >= 500)
      ) {
        scheduleBackoff(`barrier-transient:${code}`);
        return;
      }
      if (isAuthorityFenceUnsettledError(error) || this.authTerminalStatus().terminated === true) {
        pause(`authority-unavailable:${code}`);
        return;
      }
      pause(`barrier-refused:${code}`);
    };

    const scanPending = async () => {
      const records = typeof store.outboxRecords === 'function'
        ? await store.outboxRecords()
        : await store.outboxPending();
      return records.filter((record) => record?.status === 'pending');
    };

    const runCycle = async () => {
      let pending;
      try {
        pending = await scanPending();
      } catch (error) {
        scheduleBackoff(`store-transient:${error?.code ?? 'unavailable'}`);
        return lastOutcome;
      }
      if (!running) return lastOutcome;
      if (
        pending.length === 0
        || !pending.some((record) => (
          isForegroundReplayEligible(store, record)
          || isHousekeepingReplayEligible(record)
        ))
      ) {
        retryAttempt = 0;
        clearRetryTimer();
        clearWriterPollTimer();
        freshBarrierAvailable = false;
        publish('idle', null, null);
        return lastOutcome;
      }
      const authorityTransition = this.authorityTransitionStatus();
      if (authorityTransition.transitionOwner === 'auth-coordinator') {
        this.__outboxLastReplayStop = Object.freeze({
          kind: 'paused',
          reason: 'auth-barrier',
        });
        pause('auth-barrier');
        return lastOutcome;
      }
      try {
        if (
          typeof store.outboxAuthorizationStatus === 'function'
          && (await store.outboxAuthorizationStatus()).suspended === true
        ) {
          this.__outboxLastReplayStop = Object.freeze({
            kind: 'paused',
            reason: 'authorization-suspended',
          });
          pause('authorization-suspended');
          return lastOutcome;
        }
      } catch (error) {
        scheduleBackoff(`store-transient:${error?.code ?? 'unavailable'}`);
        return lastOutcome;
      }

      if (typeof store.isWriter === 'function' && store.isWriter() !== true) {
        void Promise.resolve(store.whenLockSettled?.()).then(() => {
          if (running && store.isWriter?.() === true) requestCycle('writer-lock-acquired');
        }, () => { /* role remains paused; another level wake retries */ });
        pause('not-writer', { pollWriter: true });
        return lastOutcome;
      }
      clearWriterPollTimer();

      try {
        // Gate the controller before custody reconciliation or a freshness
        // barrier can touch a ledger-less target. The private replay core
        // repeats this check because callers may use it without a controller.
        await this.#requireOfflineMutationReplayCapability();
      } catch (error) {
        if (running) {
          const code = error?.diagnostic?.code ?? error?.code ?? 'unavailable';
          if (code === OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED) {
            this.__outboxLastReplayStop = Object.freeze({
              kind: 'terminal',
              reason: `target-capability-refused:${code}`,
            });
            pause(`target-capability-refused:${code}`);
          } else {
            scheduleBackoff(`capability-transient:${code}`);
          }
        }
        return lastOutcome;
      }

      const custodyWakeGeneration = this.__outboxCustodyWakeGeneration;
      const custody = await this.#reconcileQueueCustody(store);
      if (!running) return lastOutcome;
      if (!custody.settled) {
        const code = custody.error?.diagnostic?.code ?? custody.error?.code ?? 'unsettled';
        pause(`custody-unavailable:${code}`);
        if (this.__outboxCustodyWakeGeneration !== custodyWakeGeneration) {
          requestCycle('custody-settled-during-pause');
        }
        return lastOutcome;
      }

      lastAttemptAtMs = now();
      publish('waiting-barrier', null, null);
      try {
        if (!controller.takeFreshBarrier()) {
          await withBarrierDeadline(this.#establishOutboxDrainBarrier(store, controller));
        }
        // A controller-owned live query reports the same snapshot through
        // #scheduleOutboxReplay; consume that evidence before replay so it
        // cannot accidentally license a later retry cycle.
        controller.takeFreshBarrier();
      } catch (error) {
        if (running) barrierFailure(error);
        return lastOutcome;
      }
      if (!running) return lastOutcome;

      publish('replaying', null, null);
      this.__outboxLastReplayStop = null;
      try {
        replayingCore = true;
        lastOutcome = Object.freeze(await this.#replayQueuedMutationsWithOptions({
          replayLane: 'foreground',
          shouldContinue: () => running && !this.__clientClosed,
          shouldReplayRecord: (record) => isForegroundReplayEligible(store, record),
        }));
        replayingCore = false;
        // Housekeeping owns an independent single-flight. Do not await its
        // transport: a later foreground level wake must be able to run a new
        // foreground replay while the background request remains in flight.
        // @ref LLP 0218#w2-implementation-record-2026-08-21 — slow housekeeping cannot head-of-line block foreground dispatch.
        if (
          running
          && housekeepingRetryTimer === null
          && this.__outboxHousekeepingReplayTask === null
          && (await scanPending()).some(isHousekeepingReplayEligible)
        ) {
          void this.#replayQueuedMutationsWithOptions({
            replayLane: 'housekeeping',
            shouldContinue: () => running && !this.__clientClosed,
            shouldReplayRecord: isHousekeepingReplayEligible,
          }).then((outcome) => {
            if (!running) return;
            const stop = this.__outboxHousekeepingLastReplayStop;
            if (stop?.kind === 'transient') {
              housekeepingRetryTimer = timerHandle(() => {
                housekeepingRetryTimer = null;
                requestCycle('housekeeping-backoff-expired');
              }, OUTBOX_DRAIN_RETRY_BASE_MS);
              return;
            }
            if (outcome.remaining > 0 || outcome.replayed > 0) {
              requestCycle('housekeeping-replay-settled');
            }
          }, () => {
            if (running) requestCycle('housekeeping-replay-rejected');
          });
        }
      } catch (error) {
        if (running) {
          const code = error?.diagnostic?.code ?? error?.code ?? 'unavailable';
          if (code === OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED) {
            this.__outboxLastReplayStop = Object.freeze({
              kind: 'terminal',
              reason: `target-capability-refused:${code}`,
            });
            pause(`target-capability-refused:${code}`);
          } else {
            scheduleBackoff(`replay-transient:${code}`);
          }
        }
        return lastOutcome;
      } finally {
        replayingCore = false;
      }
      if (!running) return lastOutcome;
      const disposition = this.__outboxLastReplayStop;
      if (disposition?.kind === 'transient') {
        scheduleBackoff(replayStopReason('replay-transient'));
        return lastOutcome;
      }
      if (disposition?.kind === 'paused') {
        pause(replayStopReason('replay-paused'));
        return lastOutcome;
      }
      if (disposition?.kind === 'terminal') {
        retryAttempt = 0;
        pause(replayStopReason('terminal-disposition'));
        return lastOutcome;
      }
      if (lastOutcome.stopped === true && lastOutcome.remaining > 0) {
        pause(replayStopReason('replay-refused'));
        return lastOutcome;
      }
      retryAttempt = 0;
      clearRetryTimer();
      clearHousekeepingRetryTimer();
      rearmLatchedReplayWake();
      publish('idle', null, null);
      return lastOutcome;
    };

    const pump = async () => {
      while (running && requested) {
        requested = false;
        activeCycleRequestGeneration = requestGeneration;
        await runCycle();
      }
      return lastOutcome;
    };

    function requestCycle(reason, { manual = false } = {}) {
      if (!running || (!automatic && !manual)) return Promise.resolve(lastOutcome);
      if (retryTimer !== null) clearRetryTimer();
      if (reason !== 'writer-lock-poll') clearWriterPollTimer();
      requestGeneration += 1;
      requested = true;
      if (pumpTask === null) {
        pumpTask = pump().finally(() => {
          pumpTask = null;
          // @ref LLP 0218#43-the-platform-owned-drain — enqueue/relinquish
          // wakes are level facts even at the pump-task finalization cut.
          // A foreground ownership release can publish at the exact cut where
          // pump() observed `requested === false` but before this finalizer
          // clears the task. Preserve that level wake instead of stranding it
          // behind an already-resolved pump promise.
          if (running && requested) requestCycle('pump-tail-level-wake');
        });
      }
      return Promise.race([pumpTask, stoppedTask]);
    }

    const stop = () => {
      if (!running) return;
      running = false;
      requested = false;
      replayWakePending = false;
      clearRetryTimer();
      clearWriterPollTimer();
      for (const cancelWait of [...barrierWaitCancelers]) cancelWait();
      for (const scheduled of [...ownedTimers]) {
        cancel(scheduled);
        ownedTimers.delete(scheduled);
      }
      freshBarrierAvailable = false;
      drainPhase = 'idle';
      blockedReason = null;
      nextRetryAtMs = null;
      for (const cleanup of cleanups.splice(0)) {
        try { cleanup(); } catch { /* deterministic best-effort observation teardown */ }
      }
      const activePump = pumpTask;
      engineSettlementTask = Promise.resolve(activePump)
        .catch(() => lastOutcome)
        .then(() => lastOutcome);
      this.#notifyOutboxListeners();
      resolveStopped(lastOutcome);
    };

    handle = Object.freeze({
      drainNow: async () => {
        const pending = await scanPending();
        if (pending.length > 0) await this.#requireOfflineMutationReplayCapability();
        return requestCycle('manual', { manual: true });
      },
      stop,
      status: controller.status,
    });
    if (typeof store.subscribeWriterLock === 'function') {
      cleanups.push(store.subscribeWriterLock((writer) => {
        if (writer === true) requestCycle('writer-lock-acquired');
      }));
    }
    if (eventTarget !== null) {
      const onOnline = () => requestCycle('online');
      eventTarget.addEventListener('online', onOnline);
      cleanups.push(() => eventTarget.removeEventListener('online', onOnline));
    }
    if (automatic) requestCycle('start');
    return controller;
  }

  async #establishOutboxDrainBarrier(store, controller) {
    // Mounted query lifecycles already own the exact fresh-subscribe protocol.
    // Asking one to resubscribe keeps the resync cut in that existing owner.
    for (const provider of [...this.__outboxBarrierProviders]) {
      if (controller.takeFreshBarrier()) return;
      const landed = await provider();
      if (landed === true || controller.takeFreshBarrier()) return;
    }

    const meta = typeof store.readStoreMeta === 'function'
      ? await store.readStoreMeta()
      : null;
    const registrations = Object.values(meta?.durableRegistrations ?? {})
      .flatMap((byId) => Object.values(byId ?? {}))
      .filter((registration) => (
        registration
        && typeof registration === 'object'
        && typeof registration.functionReference?.name === 'string'
      ));
    if (registrations.length > 0) {
      const handles = [];
      try {
        // @ref LLP 0218#43-the-platform-owned-drain — with no mounted owner,
        //   replay is gated by fresh-subscribe cuts over every durable retained
        //   registration; this reuses liveQuery instead of a second resync wire.
        for (const registration of registrations) {
          handles.push(await this.liveQuery(registration.functionReference, {
            connectionId: controller.connectionId,
            args: structuredClone(registration.canonicalArgs ?? {}),
            transport: 'poll',
            persistResume: registration.retentionRequest === 'durable',
          }));
        }
      } finally {
        await Promise.allSettled(handles.map((candidate) => candidate.dispose()));
      }
      if (!controller.takeFreshBarrier()) {
        const error = new Error(
          'SNAPBACK_OUTBOX_DRAIN_BARRIER_REFUSED: retained-query resync produced no fresh snapshot',
        );
        error.code = 'SNAPBACK_OUTBOX_DRAIN_BARRIER_REFUSED';
        throw error;
      }
      return;
    }

    // No retained local replica exists to resync. A fresh connection grant is
    // the existing readiness handshake and therefore the complete empty-set cut.
    await this.refreshConnectionGrant(controller.connectionId);
  }

  /// Deferred single-flight replay trigger, scheduled by every successful
  /// fresh-subscribe snapshot (the full-resync barrier of LLP 0008
  /// §Mutation Replay: resync first, then replay in sequence order).
  #scheduleOutboxReplay() {
    if (this.__clientClosed) return;
    let store = null;
    try {
      store = this.#offlineQueueStore();
    } catch {
      store = null;
    }
    if (!store) return;
    const controller = outboxDrainControllersByStore.get(store) ?? null;
    if (controller !== null) {
      this.__outboxDrainController = controller;
      controller.noteFreshBarrier();
      return;
    }
    if (this.__outboxReplayScheduled) return;
    this.__outboxReplayScheduled = true;
    const timer = setTimeout(() => {
      this.__outboxReplayTimer = null;
      this.__outboxReplayScheduled = false;
      if (this.__clientClosed) return;
      void this.replayQueuedMutations().catch(() => {});
    }, 0);
    this.__outboxReplayTimer = timer;
    timer.unref?.();
  }

  /// Replay every pending queued mutation in client-local sequence order
  /// (LLP 0008: ordering uses the sequence, never a wall clock). Success
  /// settles the record and schedules its exactly-once ledger ACK; a server
  /// refusal is drop-and-mark-failed (never retried, visible as failed client
  /// state), except authority-stale results, which strand, and LLP 0081
  /// upgrade-required refusals, which quarantine the incompatible queue for
  /// explicit successor re-entry; a connectivity failure stops the drain with
  /// the record still pending. Single-flight: concurrent calls share one drain.
  async replayQueuedMutations() {
    if (this.__clientClosed) {
      const error = new Error('SNAPBACK_CLIENT_CLOSED: outbox replay cannot run after close()');
      error.code = 'SNAPBACK_CLIENT_CLOSED';
      throw error;
    }
    let store = null;
    try { store = this.#offlineQueueStore(); } catch { store = null; }
    let controller = store ? outboxDrainControllersByStore.get(store) ?? null : null;
    if (store && controller === null && this.__outboxDrainLifecycle) {
      this.startOutboxDrain({ automatic: this.outboxDrainPolicy === 'auto' });
      controller = outboxDrainControllersByStore.get(store) ?? null;
    }
    if (controller !== null) {
      // @ref LLP 0218#43-the-platform-owned-drain — once a controller owns
      //   this store, the legacy public replay entry requests its safe cycle;
      //   only the private replay core may run without controller orchestration.
      this.__outboxDrainController = controller;
      return controller.drainNow();
    }
    return this.#replayQueuedMutationsWithOptions({
      // A generated foreground call may have durably enqueued before this
      // legacy fresh-snapshot wake runs. The wake shares the platform drain's
      // ownership fence: it may drain predecessors, but never redeliver a
      // record whose process-local foreground dispatcher still owns delivery.
      shouldReplayRecord: (record) => isForegroundReplayEligible(store, record),
    });
  }

  async #replayQueuedMutationsWithOptions(options = undefined) {
    const replayLane = options?.replayLane === 'housekeeping' ? 'housekeeping' : 'foreground';
    const taskField = replayLane === 'housekeeping'
      ? '__outboxHousekeepingReplayTask'
      : '__outboxReplayTask';
    if (this[taskField]) return this[taskField];
    const task = this.#replayOutboxOnce(options).finally(() => {
      if (this[taskField] === task) this[taskField] = null;
      this.#notifyOutboxListeners();
    });
    this[taskField] = task;
    this.#notifyOutboxListeners();
    return task;
  }

  async #replayOutboxOnce({
    preserveTerminalFailures = false,
    shouldContinue = () => true,
    shouldReplayRecord = () => true,
    replayLane = 'foreground',
  } = {}) {
    const thisClient = this;
    const replayStop = {
      set value(value) {
        if (replayLane === 'housekeeping') {
          thisClient.__outboxHousekeepingLastReplayStop = value;
        } else {
          thisClient.__outboxLastReplayStop = value;
        }
      },
    };
    replayStop.value = null;
    let store = null;
    try {
      store = this.#offlineQueueStore();
    } catch {
      store = null;
    }
    if (!store) {
      return { replayed: 0, failed: 0, stranded: 0, quarantined: 0, remaining: 0 };
    }
    if (typeof store.whenLockSettled === 'function') await store.whenLockSettled();
    if (!shouldContinue()) {
      const remaining = (await store.outboxRecords()).filter(isUnresolvedOutboxRecord).length;
      return {
        replayed: 0, failed: 0, stranded: 0, quarantined: 0, remaining, stopped: true,
      };
    }
    if (typeof store.isWriter === 'function' && store.isWriter() !== true) {
      // @ref LLP 0008#decision-dk-9--client-local-store-mandate-2026-07-02 —
      // a non-writer may inspect the shared durable domain but may not mutate
      // it. Never turn that custody refusal into a misleading empty queue.
      const remaining = (await store.outboxRecords()).filter(isUnresolvedOutboxRecord).length;
      replayStop.value = Object.freeze({ kind: 'paused', reason: 'not-writer' });
      return {
        replayed: 0, failed: 0, stranded: 0, quarantined: 0, remaining, stopped: true,
      };
    }
    if (
      typeof store.outboxAuthorizationStatus === 'function'
      && (await store.outboxAuthorizationStatus()).suspended === true
    ) {
      const remaining = (await store.outboxRecords()).filter(isUnresolvedOutboxRecord).length;
      replayStop.value = Object.freeze({
        kind: 'paused',
        reason: 'authorization-suspended',
      });
      return {
        replayed: 0, failed: 0, stranded: 0, quarantined: 0, remaining, stopped: true,
      };
    }
    let queuedBeforeCustody;
    try {
      queuedBeforeCustody = (await store.outboxPending()).filter(shouldReplayRecord);
    } catch (error) {
      replayStop.value = Object.freeze({
        kind: 'transient',
        reason: `store-transient:${error?.code ?? 'unavailable'}`,
      });
      return { replayed: 0, failed: 0, stranded: 0, quarantined: 0, remaining: 0 };
    }
    if (queuedBeforeCustody.length > 0) {
      // The check precedes every queue-state reconciliation and mutation
      // transport: a target without the ledger cannot double-apply an old
      // record or mutate its custody disposition as a side effect of drain.
      if (!shouldContinue()) {
        return {
          replayed: 0,
          failed: 0,
          stranded: 0,
          quarantined: 0,
          remaining: queuedBeforeCustody.length,
          stopped: true,
        };
      }
      await this.#requireOfflineMutationReplayCapability();
    }
    if (!shouldContinue()) {
      const remaining = (await store.outboxRecords()).filter(isUnresolvedOutboxRecord).length;
      return {
        replayed: 0, failed: 0, stranded: 0, quarantined: 0, remaining, stopped: true,
      };
    }
    const headCustody = await this.#reconcileQueueCustody(store);
    if (!headCustody.settled) {
      const remaining = (await store.outboxRecords()).filter(isUnresolvedOutboxRecord).length;
      const code = headCustody.error?.diagnostic?.code ?? headCustody.error?.code ?? 'unsettled';
      replayStop.value = Object.freeze({
        kind: 'paused',
        reason: `custody-unavailable:${code}`,
      });
      return {
        replayed: 0, failed: 0, stranded: 0, quarantined: 0, remaining, stopped: true,
      };
    }
    let pending;
    try {
      pending = (await store.outboxPending()).filter(shouldReplayRecord);
    } catch (error) {
      replayStop.value = Object.freeze({
        kind: 'transient',
        reason: `store-transient:${error?.code ?? 'unavailable'}`,
      });
      return { replayed: 0, failed: 0, stranded: 0, quarantined: 0, remaining: 0 };
    }
    let replayed = 0;
    let failed = 0;
    let stranded = 0;
    let quarantined = 0;
    let stopped = false;
    for (const queuedRecord of pending) {
      if (!shouldContinue()) {
        stopped = true;
        break;
      }
      if (!shouldReplayRecord(queuedRecord)) continue;
      let record = queuedRecord;
      // Re-read and reconcile at the actual submission slot. The current
      // implementation drains serially, but this gate is the normative fence
      // a future pipelining client must preserve: no leaf-visible dependent
      // crosses while its minting predecessor is pending or unresolved.
      // @ref LLP 0133#divergence-on-settle — sequence order is a submission
      //   fence, and cascade is checked again immediately before transport.
      const prepared = await store.outboxPrepareSubmission(record.id);
      if (
        prepared?.status === 'authorization-suspended'
        || prepared?.status === 'authorization-stale'
      ) {
        replayStop.value = Object.freeze({
          kind: 'paused',
          reason: 'authorization-suspended',
        });
        stopped = true;
        break;
      }
      if (prepared?.status === 'blocked') {
        replayStop.value = Object.freeze({
          kind: 'terminal',
          reason: 'terminal-disposition:sequence-blocked',
        });
        stopped = true;
        break;
      }
      if (prepared?.status === 'failed') {
        failed += 1;
        this.#recordMutationPhaseCost({
          clientMutationId: record.id,
          functionId: record.function,
          disposition: 'failed',
          timing: mutationTiming(prepared.record ?? record),
        });
        this.#recordOutboxDiagnostic({
          code: 'SNAPBACK_SPECULATIVE_ID_UNRESOLVED',
          mutation: record.function,
          clientMutationId: record.id,
          reason: prepared.record?.failure?.message,
        });
        continue;
      }
      if (prepared?.status === 'quarantined') {
        replayStop.value = Object.freeze({
          kind: 'terminal',
          reason: 'terminal-disposition:quarantined',
        });
        stopped = true;
        break;
      }
      if (prepared?.status !== 'ready' || !prepared.record) continue;
      record = prepared.record;
      let preparationFence = prepared.fence;
      let replayAuthority = null;
      if (record.custody !== undefined && record.custody !== null) {
        // Re-attest at every submission slot. Reconciliation normally handled
        // either mismatch at the drain head; these comparisons are the
        // belt-and-braces transport gate for authority changes during a drain.
        // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — never transmit a
        //   record under an authority other than its enqueue authority.
        const custody = await this.#reconcileQueueCustody(store);
        if (!custody.settled || custody.authority === null) {
          const code = custody.error?.diagnostic?.code ?? custody.error?.code ?? 'unsettled';
          replayStop.value = Object.freeze({
            kind: 'paused',
            reason: `custody-unavailable:${code}`,
          });
          stopped = true;
          break;
        }
        replayAuthority = custody.authority;
        if (!samePrincipalScope(record.principalScope, replayAuthority.principalScope)) {
          continue;
        }
        if (
          record.authorityDescriptor?.authorityInstanceId
          !== replayAuthority.authorityDescriptor.authorityInstanceId
        ) {
          continue;
        }
        const currentPrepared = await store.outboxPrepareSubmission(record.id);
        if (currentPrepared?.status !== 'ready' || !currentPrepared.record) continue;
        record = currentPrepared.record;
        preparationFence = currentPrepared.fence;
      }
      let authorizationDispatchRelease = null;
      let authorizationDispatchSettlement = Promise.resolve();
      const releaseAuthorizationDispatch = () => {
        if (authorizationDispatchRelease === null) return authorizationDispatchSettlement;
        const release = authorizationDispatchRelease;
        authorizationDispatchRelease = null;
        authorizationDispatchSettlement = Promise.resolve(release());
        authorizationDispatchSettlement.catch(() => {});
        return authorizationDispatchSettlement;
      };
      let authorizationDispatchFence = null;
      try {
        if (!shouldContinue()) {
          stopped = true;
          break;
        }
        if (this.__operationIdentityProtocol === 1 && record.operationIssuance === null) {
          const clientAudienceId = (await store.readStoreMeta())?.clientStoreId;
          if (typeof clientAudienceId !== 'string' || !SNAPBACK_OPAQUE_ID.test(clientAudienceId)) {
            const error = new Error(
              'SNAPBACK_OPERATION_RANGE_AUDIENCE_INVALID: durable store has no valid client identity',
            );
            error.code = 'SNAPBACK_OPERATION_RANGE_AUDIENCE_INVALID';
            throw error;
          }
          let replayAuthorityDescriptor = record.authorityDescriptor;
          let replayAuthorityPrincipalId = record.operationAuthorityPrincipalId ?? null;
          if (this.authProtocols.authClient != null) {
            const session = await this.authSession();
            const currentDescriptor = requireAuthorityDescriptor(
              session?.authorityDescriptor,
              'SNAPBACK_AUTHORITY_DESCRIPTOR_INVALID',
            );
            const currentPrincipalId = session?.activeMode === 'sessions'
              && session?.authority?.isAuthenticated === true
              && typeof session?.authority?.userId === 'string'
              ? session.authority.userId
              : null;
            if (
              replayAuthorityPrincipalId === null
              || currentPrincipalId === null
              || currentPrincipalId !== replayAuthorityPrincipalId
            ) {
              const error = new Error(
                'SNAPBACK_OPERATION_RANGE_REAUTH_REQUIRED: uncovered intent cannot cross principals',
              );
              error.code = 'SNAPBACK_OPERATION_RANGE_REAUTH_REQUIRED';
              throw error;
            }
            if (record.custody === undefined || record.custody === null) {
              replayAuthorityDescriptor = currentDescriptor;
            }
            replayAuthorityPrincipalId = currentPrincipalId;
          }
          const authorityCohortKey = this.#operationIdentityCohortKey(
            clientAudienceId,
            record.userId,
            replayAuthorityDescriptor,
          );
          if (!shouldContinue()) {
            stopped = true;
            break;
          }
          const range = await this.#refreshOperationIdentityRange(
            store,
            authorityCohortKey,
            clientAudienceId,
            record.userId,
            replayAuthorityDescriptor,
            replayAuthority?.capture ?? null,
          );
          record = await store.outboxAssignOperationIdentity(
            record.id,
            authorityCohortKey,
            range,
            replayAuthorityDescriptor,
            replayAuthorityPrincipalId,
            preparationFence,
          );
          preparationFence = outboxAuthorizationFenceFrom(record);
          if (!record?.operationIssuance) {
            const error = new Error(
              'SNAPBACK_OPERATION_RANGE_EXHAUSTED: reconnect supplied no operation identity',
            );
            error.code = 'SNAPBACK_OPERATION_RANGE_EXHAUSTED';
            throw error;
          }
        }
        if (!shouldContinue()) {
          stopped = true;
          break;
        }
        if (!shouldReplayRecord(record)) continue;
        // Redelivery under the SAME client-minted durable identity: the
        // server's settlement ledger returns the original result on a
        // duplicate, so a crash between settle and remove cannot double-
        // apply (LLP 0043 M2 exactly-once).
        const settlement = await this.#mutate(
          outboxReplayReference(record),
          {
          args: record.args,
          userId: record.userId ?? undefined,
          readSet: record.readSet ?? [],
          correlation: record.correlation ?? null,
          clientMutationId: record.id,
          authorityDescriptor: record.authorityDescriptor ?? null,
          ctxLedger: record.ctxLedger ?? null,
          settlementLane: record.settlementLane ?? 'replay-accept',
          settlementIdentity: record.settlementIdentity ?? null,
          settlementClaims: record.settlementClaims ?? null,
          boundedSkew: record.boundedSkew ?? null,
          mediaCommand: record.mediaCommand ?? null,
          operationIssuance: record.operationIssuance ?? null,
          operationCoverageDisposition: record.operationCoverageDisposition ?? null,
          optimisticOperation: record.optimisticOperation ?? null,
          authorityCapture: replayAuthority?.capture ?? null,
          queue: false,
          __authorizationDispatchOwnership: OUTBOX_AUTHORIZATION_DISPATCH_OWNERSHIP,
          __beforeTransportDispatch: async () => {
            authorizationDispatchRelease = await acquireOutboxAuthorizationDispatch(
              store,
              record.dispatchLane ?? 'foreground',
            );
            const submission = await store.outboxPrepareSubmission(
              record.id,
              { markDispatched: true },
            );
            if (submission?.status !== 'ready' || !submission.record) {
              const error = new Error(
                `SNAPBACK_OUTBOX_SUBMISSION_NOT_READY: replay record is ${submission?.status ?? 'missing'}`,
              );
              error.code = submission?.status === 'authorization-suspended'
                ? 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED'
                : submission?.status === 'authorization-stale'
                  ? 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE'
                  : 'SNAPBACK_OUTBOX_SUBMISSION_NOT_READY';
              throw error;
            }
            record = submission.record;
            authorizationDispatchFence = submission.fence;
          },
          __onTransportFailure: async (error) => {
            if (requestFailureReentersAuthorityTransport(error)) {
              await releaseAuthorizationDispatch();
            }
          },
          },
          // @ref LLP 0247#d1-contract-directed-optional-omission — durable
          // outbox arguments crossed normalization before enqueue; replaying
          // those captured bytes must not require a contract absent from a
          // predecessor record shape.
          true,
        );
        // @ref LLP 0218#41-the-dispatch-union-headless-contract — `status` is
        //   the process-local dispatch discriminant, not a settlement fact:
        //   the durable record retains the raw wire settlement (LLP 0043 owns
        //   that family), so strip the stamp before persisting.
        const { status: _dispatchStatus, ...retainedSettlement } = settlement;
        let consumed;
        try {
          consumed = await store.outboxDurablyConsume(
            record.id,
            retainedSettlement,
            record.userId ?? null,
            [],
            authorizationDispatchFence,
          );
        } catch (error) {
          error.outboxSettlementPersistenceFailure = true;
          throw error;
        }
        if (!consumed) {
          const error = new Error(
            'SNAPBACK_OUTBOX_SETTLEMENT_NOT_DURABLE: settlement publication lost its outbox record',
          );
          error.code = 'SNAPBACK_OUTBOX_SETTLEMENT_NOT_DURABLE';
          error.outboxSettlementPersistenceFailure = true;
          throw error;
        }
        this.#recordMutationPhaseCost({
          clientMutationId: record.id,
          functionId: record.function,
          disposition: 'settled',
          timing: mutationTiming({ ...record, settlement: retainedSettlement }),
          committedVersion: retainedSettlement.version ?? null,
        });
        await this.#refreshOptimisticMutationViews('settlement-confirmed-bridge');
        replayed += 1;
        this.#recordOutboxDiagnostic({
          code: 'SNAPBACK_OFFLINE_MUTATION_REPLAYED',
          mutation: record.function,
          clientMutationId: record.id,
        });
      } catch (error) {
        if (error?.outboxSettlementPersistenceFailure === true) {
          replayStop.value = Object.freeze({
            kind: 'transient',
            reason: `settlement-store-transient:${error.code ?? 'unavailable'}`,
          });
          stopped = true;
          this.#recordOutboxDiagnostic({
            code: error.code ?? 'SNAPBACK_OUTBOX_SETTLEMENT_NOT_DURABLE',
            mutation: record.function,
            clientMutationId: record.id,
            reason: error?.message ?? String(error),
          });
          break;
        }
        if (isOperationResultExpiredError(error)) {
          let retained;
          try {
            retained = await store.outboxMarkResultGone(record.id, {
              outcome: operationOutcomeFromError(error),
              receiptDigest: error?.diagnostic?.details?.receiptDigest,
            }, authorizationDispatchFence ?? preparationFence);
          } catch (custodyError) {
            stopped = true;
            this.#recordOutboxDiagnostic({
              code: custodyError?.code ?? 'SNAPBACK_OUTBOX_RESULT_GONE_NOT_DURABLE',
              mutation: record.function,
              clientMutationId: record.id,
              reason: custodyError?.message ?? String(custodyError),
            });
            break;
          }
          if (!retained) {
            stopped = true;
            this.#recordOutboxDiagnostic({
              code: 'SNAPBACK_OUTBOX_RESULT_GONE_NOT_DURABLE',
              mutation: record.function,
              clientMutationId: record.id,
            });
            break;
          }
          stopped = true;
          replayStop.value = Object.freeze({
            kind: 'terminal',
            reason: 'terminal-disposition:result-expired',
          });
          this.#recordMutationPhaseCost({
            clientMutationId: retained.id,
            functionId: retained.function,
            disposition: 'resultGone',
            timing: mutationTiming({
              ...retained,
              settlement: { timing: error?.timing },
            }),
          });
          this.#recordOutboxDiagnostic({
            code: 'SNAPBACK_OFFLINE_MUTATION_RESULT_EXPIRED',
            mutation: record.function,
            clientMutationId: record.id,
            disposition: 'result-expired',
            operationOutcome: operationOutcomeFromError(error),
          });
          break;
        }
        if (isOperationOutcomeUnknownError(error)) {
          stopped = true;
          replayStop.value = Object.freeze({
            kind: 'terminal',
            reason: 'terminal-disposition:identity-horizon-passed',
          });
          this.#recordOutboxDiagnostic({
            code: 'SNAPBACK_OFFLINE_MUTATION_OUTCOME_UNKNOWN',
            mutation: record.function,
            clientMutationId: record.id,
            disposition: 'identity-horizon-passed',
          });
          break;
        }
        if (isOperationRangeRecoveryBlockedError(error)) {
          stopped = true;
          replayStop.value = Object.freeze({
            kind: 'paused',
            reason: isOperationRangeCapacityError(error)
              ? 'authority-unavailable:uncovered-range-exhausted'
              : 'authority-unavailable:uncovered-reauth-required',
          });
          this.#recordOutboxDiagnostic({
            code: 'SNAPBACK_OPERATION_RANGE_UNCOVERED_QUEUED',
            mutation: record.function,
            clientMutationId: record.id,
            disposition: isOperationRangeCapacityError(error)
              ? 'uncovered-range-exhausted'
              : 'uncovered-reauth-required',
          });
          break;
        }
        if (isConnectivityFailureError(error)) {
          // Still offline: keep the record pending and preserve order.
          replayStop.value = Object.freeze({
            kind: 'transient',
            reason: 'replay-transient:connectivity',
          });
          stopped = true;
          break;
        }
        if (isAuthorityFenceUnsettledError(error)) {
          // A local transition racing an admitted submission cannot become a
          // content failure. Leave the record pending for the next settled
          // authority reconciliation.
          const code = error?.diagnostic?.code ?? error?.code ?? 'unsettled';
          replayStop.value = Object.freeze({
            kind: 'paused',
            reason: `authority-unavailable:${code}`,
          });
          stopped = true;
          break;
        }
        if (isServerAuthorityStaleResult(error)) {
          // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — server-proven stale
          //   replay is terminal stranded custody, never a content failure.
          let held = false;
          try {
            held = await store.outboxMarkStranded(
              record.id,
              'server_authority_stale_result',
              record.principalScope ?? null,
              authorizationDispatchFence ?? preparationFence,
              effectProvenanceFromError(error),
            );
          } catch { /* pending is safer than silent loss */ }
          if (!held) {
            stopped = true;
            break;
          }
          stranded += 1;
          replayStop.value = Object.freeze({
            kind: 'terminal',
            reason: 'terminal-disposition:stranded',
          });
          this.#recordMutationPhaseCost({
            clientMutationId: held.id,
            functionId: held.function,
            disposition: 'stranded',
            timing: mutationTiming({
              ...held,
              settlement: { timing: error?.timing },
            }),
          });
          await this.#refreshOptimisticMutationViews('authority-stale-stranded');
          this.#recordOutboxDiagnostic({
            code: 'SNAPBACK_OFFLINE_MUTATION_STRANDED',
            mutation: record.function,
            clientMutationId: record.id,
            reason: 'server_authority_stale_result',
          });
          continue;
        }
        if (isUpgradeRequiredRefusal(error)) {
          const refusalCode = error?.diagnostic?.code ?? error?.code;
          if (typeof store.outboxMarkQuarantined !== 'function') {
            stopped = true;
            this.#recordOutboxDiagnostic({
              code: 'SNAPBACK_OUTBOX_QUARANTINE_UNSUPPORTED',
              mutation: record.function,
              clientMutationId: record.id,
              refusalCode,
            });
            break;
          }
          let held = false;
          try {
            held = await store.outboxMarkQuarantined(
              record.id,
              { code: refusalCode, ...effectProvenanceFromError(error) },
              authorizationDispatchFence ?? preparationFence,
            );
          } catch { /* handled below: pending is safer than silent loss */ }
          if (!held) {
            stopped = true;
            break;
          }
          quarantined += held.count;
          stopped = true;
          replayStop.value = Object.freeze({
            kind: 'terminal',
            reason: `terminal-disposition:${refusalCode}`,
          });
          for (const tombstone of held.tombstones) {
            const pendingRecord = pending.find((candidate) => candidate.id === tombstone.id)
              ?? tombstone;
            this.#recordMutationPhaseCost({
              clientMutationId: tombstone.id,
              functionId: tombstone.function,
              disposition: 'quarantined',
              timing: mutationTiming(tombstone.id === record.id
                ? { ...pendingRecord, settlement: { timing: error?.timing } }
                : pendingRecord),
            });
          }
          await this.#refreshOptimisticMutationViews('upgrade-required-quarantine');
          this.#recordOutboxDiagnostic({
            code: 'SNAPBACK_OFFLINE_MUTATIONS_QUARANTINED',
            mutation: record.function,
            clientMutationId: record.id,
            refusalCode,
            quarantined: held.count,
            disposition: 'tombstone-and-re-entry',
          });
          break;
        }
        if (preserveTerminalFailures) {
          // Sidecar adoption is a reversible stop/start handoff. A candidate
          // identity refusal must leave the durable intent pending so the
          // predecessor can be reattached; the ordinary reconnect path below
          // retains LLP 0008's drop-and-mark-failed behavior.
          //
          // This preserves pending work across a stop/start cut. It does not
          // make the sidecar zero-request-downtime; that needs a stable front
          // door or overlapping runtimes owned by a separate design.
          this.#recordOutboxDiagnostic({
            code: 'SNAPBACK_OUTBOX_ADOPTION_REPLAY_REFUSED',
            mutation: record.function,
            clientMutationId: record.id,
            reason: error?.diagnostic?.code ?? error?.code ?? error?.message,
          });
          stopped = true;
          replayStop.value = Object.freeze({
            kind: 'paused',
            reason: 'replay-paused:adoption-refused',
          });
          break;
        }
        // LLP 0008: a mutation the server refused on replay is dropped and
        // marked failed, never retried — observable client state.
        let markedFailed = false;
        try {
          markedFailed = await store.outboxMarkFailed(record.id, {
            code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_OUTBOX_REPLAY_FAILED',
            message: error?.message ?? String(error),
            timing: error?.timing ?? null,
            ...effectProvenanceFromError(error),
          }, authorizationDispatchFence ?? preparationFence);
        } catch { /* handled below: never submit a dependent past an unknown terminal */ }
        if (!markedFailed) {
          stopped = true;
          break;
        }
        await this.#refreshOptimisticMutationViews('settlement-refused');
        failed += 1;
        const refusalCode = error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_OUTBOX_REPLAY_FAILED';
        replayStop.value = Object.freeze({
          kind: 'terminal',
          reason: `terminal-disposition:${refusalCode}`,
        });
        this.#recordMutationPhaseCost({
          clientMutationId: record.id,
          functionId: record.function,
          disposition: 'failed',
          timing: mutationTiming({
            ...record,
            settlement: { timing: error?.timing },
          }),
        });
        this.#recordOutboxDiagnostic({
          code: 'SNAPBACK_OFFLINE_MUTATION_REPLAY_FAILED',
          mutation: record.function,
          clientMutationId: record.id,
          reason: error?.diagnostic?.code ?? error?.code ?? error?.message,
        });
      } finally {
        await releaseAuthorizationDispatch();
      }
    }
    let remaining = 0;
    try {
      remaining = (await store.outboxRecords())
        .filter((record) => (
          record?.status === 'pending' || record?.status === 'result-gone'
          || record?.status === 'quarantined'
        )).length;
    } catch { /* inspection only */ }
    return { replayed, failed, stranded, quarantined, remaining, stopped };
  }

  /**
   * Adopt the caller-owned durable outbox after a sidecar transport change.
   * This is an explicit opt-in store handoff: default per-origin store
   * selection remains unchanged, so unrelated servers never merge queues.
   *
   * @ref LLP 0129#phase-2b-desktop-sidecar-first-rung-note--2026-08-05 —
   * pending-work-preserving replacement is a checked follow-on to the cold
   * stop/start rung, not a literal zero-request-downtime claim.
   */
  async adoptQueuedMutations({
    expectedClientStoreId,
    expectedGeneration,
    afterFreshSnapshot,
  } = {}) {
    if (typeof expectedClientStoreId !== 'string' || expectedClientStoreId.length === 0) {
      throw new TypeError('adoptQueuedMutations requires expectedClientStoreId');
    }
    const expectedArtifactGeneration = normalizeExpectedGeneration(
      expectedGeneration,
      'adoptQueuedMutations expectedGeneration',
    );
    if (typeof afterFreshSnapshot !== 'function') {
      throw new TypeError('adoptQueuedMutations requires an afterFreshSnapshot function');
    }
    const store = this.#offlineQueueStore(true);

    const barrier = normalizeOutboxFreshSnapshotBarrier(await afterFreshSnapshot());
    if (barrier === null) {
      throw outboxAdoptionError(
        'SNAPBACK_OUTBOX_ADOPTION_FRESH_SNAPSHOT_REQUIRED',
        'the application fresh-snapshot barrier returned no passed v1 evidence',
      );
    }

    if (typeof store.whenLockSettled === 'function') await store.whenLockSettled();
    if (typeof store.isWriter !== 'function' || store.isWriter() !== true) {
      throw outboxAdoptionError(
        'SNAPBACK_OUTBOX_ADOPTION_NOT_WRITER',
        'the adopted durable store has not acquired single-writer custody',
      );
    }
    if (typeof store.readStoreMeta !== 'function') {
      throw outboxAdoptionError(
        'SNAPBACK_OUTBOX_ADOPTION_STORE_ID_UNAVAILABLE',
        'the adopted durable store cannot attest clientStoreId',
      );
    }
    const observedClientStoreId = (await store.readStoreMeta())?.clientStoreId;
    if (observedClientStoreId !== expectedClientStoreId) {
      throw outboxAdoptionError(
        'SNAPBACK_OUTBOX_ADOPTION_STORE_ID_MISMATCH',
        'the candidate client opened a different durable store domain',
        { expectedClientStoreId, observedClientStoreId: observedClientStoreId ?? null },
      );
    }

    const inspection = await this.inspect();
    const candidateGeneration = artifactGenerationFromInspection(inspection);
    if (
      candidateGeneration === null
      || !sameArtifactGeneration(candidateGeneration, expectedArtifactGeneration)
    ) {
      throw outboxAdoptionError(
        'SNAPBACK_OUTBOX_ADOPTION_INCOMPATIBLE_SUCCESSOR',
        'the candidate app/schema/function generation does not exactly match the predecessor',
        { expectedGeneration: expectedArtifactGeneration, observedGeneration: candidateGeneration },
      );
    }

    await this.#reconcileQueueCustody(store, { required: true });
    const beforeRecords = await store.outboxRecords();
    const before = outboxDispositionCounts(beforeRecords);
    for (const record of beforeRecords.filter((entry) => entry?.status === 'pending')) {
      const recordGeneration = record.expectedGeneration === null
        || record.expectedGeneration === undefined
        ? null
        : normalizeExpectedGeneration(
          record.expectedGeneration,
          `pending outbox record ${record.id} expectedGeneration`,
        );
      if (
        recordGeneration === null
        || !sameArtifactGeneration(recordGeneration, expectedArtifactGeneration)
      ) {
        throw outboxAdoptionError(
          'SNAPBACK_OUTBOX_ADOPTION_INTENT_INCOMPATIBLE',
          'a pending intent is not exactly bound to the predecessor artifact generation',
          { clientMutationId: record.id, expectedGeneration: expectedArtifactGeneration },
        );
      }
    }

    const replay = await this.#replayQueuedMutationsWithOptions({
      preserveTerminalFailures: true,
    });
    const after = outboxDispositionCounts(await store.outboxRecords());
    const receipt = {
      schemaVersion: 'snapback.outbox-adoption.v1',
      candidateOrigin: this.baseUrl,
      clientStoreId: observedClientStoreId,
      writer: store.isWriter() === true,
      freshSnapshotBarrier: barrier,
      artifactGeneration: candidateGeneration,
      before,
      after,
      pendingBefore: before.pending,
      replayed: replay.replayed,
      failedDelta: Math.max(0, after.failed - before.failed),
      strandedDelta: Math.max(0, after.stranded - before.stranded),
      quarantinedDelta: Math.max(0, after.quarantined - before.quarantined),
      resultGoneDelta: Math.max(0, after.resultGone - before.resultGone),
      remaining: after.pending + after.quarantined + after.resultGone,
      stopped: replay.stopped === true,
    };
    return freezeDeep(receipt);
  }

  async mutate(ref, options = {}) {
    return this.#mutate(ref, options, false);
  }

  async #mutate(ref, {
    args = {},
    userId,
    readSet = [],
    correlation = null,
    clientMutationId = null,
    acknowledgedClientMutationIds = [],
    ctxLedger = null,
    settlementLane = null,
    settlementIdentity = null,
    settlementClaims = null,
    boundedSkew = null,
    operationIssuance = null,
    operationCoverageDisposition = null,
    optimisticOperation = null,
    authorityDescriptor = null,
    authorityCapture = null,
    mediaCommand = null,
    __beforeTransportDispatch = null,
    __onTransportFailure = null,
    // Internal replay marks that its callback already owns the shared
    // authorization-dispatch gate through durable disposition.
    __authorizationDispatchOwnership = null,
    // Internal facade seam: an explicit app-authored React reducer owns the
    // presentation for that call. Ordinary callers never set this.
    __generatedOptimistic = true,
    // LLP 0129 Phase 0 (LLP 0043 M2): 'auto' queues this intent durably
    // when delivery fails at the transport (connectivity) and the client
    // carries an outbox-capable store; `false` restores fail-loud delivery.
    queue = 'auto',
    // Declared background intent: idempotent, latest-wins, and valid under
    // the settled successor. The opaque key is its coalescing identity.
    housekeeping = null,
  } = {}, argumentsAlreadyNormalized = false) {
    assertClientReferenceKind({
      reference: ref,
      acceptedKinds: ['Mutation'],
      invokedVerb: 'mutate',
      diagnosticsChannel: this.__clientDiagnosticsChannel,
    });
    const name = functionName(ref);
    const functionId = typeof ref?.id === 'string' ? ref.id : name;
    const generatedReference = ref?.mutationIr?.format === 'snapback.generated-mutation-ir.v1';
    const generatedPresentationEnabled = generatedReference && __generatedOptimistic === true;
    if (typeof __generatedOptimistic !== 'boolean') {
      throw new TypeError('__generatedOptimistic must be boolean');
    }
    let optimisticInvocationSequence = null;
    if (generatedPresentationEnabled) {
      clientMutationId ??= createClientMutationId();
      optimisticInvocationSequence = nextOptimisticInvocationSequence();
    }
    args = argumentsAlreadyNormalized ? args : validateGeneratedArguments(ref, args, name);
    const generation = expectedGeneration(ref);
    if (
      housekeeping !== null
      && (
        typeof housekeeping !== 'object'
        || housekeeping.idempotent !== true
        || housekeeping.successorValid !== true
        || typeof housekeeping.key !== 'string'
        || !SNAPBACK_OPAQUE_ID.test(housekeeping.key)
      )
    ) {
      throw new TypeError('mutate housekeeping requires { key, idempotent: true, successorValid: true }');
    }
    const dispatchLane = housekeeping === null ? 'foreground' : 'housekeeping';
    if (dispatchLane === 'housekeeping') clientMutationId ??= createClientMutationId();
    const transitionStatus = this.authorityTransitionStatus();
    if (dispatchLane === 'housekeeping' && transitionStatus.transitionOwner === 'auth-coordinator') {
      if (queue === false) {
        throw oneShotAuthAdmissionError({
          code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
          message: 'housekeeping mutation cannot dispatch during an authority barrier',
          reason: AUTHENTICATION_NOT_SETTLED_REASON,
          retryStrategy: 'after-authentication-settles',
          operation: 'mutation',
          refKind: ref?.kind ?? null,
        });
      }
      const store = this.#offlineQueueStore(true);
      clientMutationId ??= createClientMutationId();
      const queueFence = outboxAuthorizationFenceFrom(await store.outboxAuthorizationStatus());
      const stored = await store.outboxEnqueue({
        id: clientMutationId,
        function: name,
        args,
        userId: typeof userId === 'string' ? userId : null,
        readSet,
        correlation,
        expectedGeneration: generation,
        settlementLane: settlementLane ?? 'replay-accept',
        settlementIdentity,
        settlementClaims,
        boundedSkew,
        dispatchLane,
        housekeepingKey: housekeeping.key,
        successorTargetedHousekeeping: true,
        capturedNow: Date.now(),
      }, queueFence);
      this.#recordRuntimeCostOutboxEnqueue(stored, functionId);
      this.#notifyOutboxListeners();
      return Object.freeze({
        status: 'queued',
        clientMutationId: stored.id,
        sequence: stored.sequence,
        presentation: 'unavailable',
        blockedReason: 'auth-barrier',
      });
    }
    const authAdmissionError = (
      __authorizationDispatchOwnership === OUTBOX_AUTHORIZATION_DISPATCH_OWNERSHIP
    )
      ? null
      : authenticatedOneShotAdmissionError(ref, this, 'mutation');
    if (authAdmissionError !== null) throw authAdmissionError;
    if (queue !== 'auto' && queue !== false && queue !== true) {
      throw new TypeError("mutate queue option must be 'auto', true, or false");
    }
    // @ref LLP 0059#authority-identity-and-captures — foreground admission,
    // asynchronous generated preparation, and transport belong to one exact
    // authority. Internal durable replay already supplies its owned capture.
    let preparationAuthorityCapture = authorityCapture;
    if (
      preparationAuthorityCapture === null
      && requiresGeneratedAuthenticatedAuthority(ref)
      && this.authorityFence
      && __authorizationDispatchOwnership !== OUTBOX_AUTHORIZATION_DISPATCH_OWNERSHIP
    ) {
      preparationAuthorityCapture = this.captureAuthority();
    }
    // Queue admission and authorization fencing are separate capabilities.
    // Preserve the shared authorization store before an `auto` capability
    // probe can relinquish durable replay: a ledger-less target still may
    // not carry a foreground mutation across an already-installed root.
    const authorizationDispatchStore = (
      __authorizationDispatchOwnership === OUTBOX_AUTHORIZATION_DISPATCH_OWNERSHIP
    )
      ? null
      : this.#custodyReconciliationStore();
    let queueCapabilityVerified = queue === false ? false : null;
    let queueCapabilityEvidence = null;
    if (queue === true) {
      // Preserve the existing local-custody error ordering: an explicit queue
      // request with no durable store fails locally before any target probe.
      this.#offlineQueueStore(true);
      await this.#requireOfflineMutationReplayCapability();
      queueCapabilityVerified = true;
      queueCapabilityEvidence = 'fresh';
    } else if (
      queue === 'auto'
      && this.#offlineQueueStore(false) !== null
    ) {
      const capability = await this.#offlineMutationReplayCapabilityFact({
        allowCachedForEnqueue: true,
        expectedGeneration: generation,
      });
      if (capability.supported) {
        queueCapabilityVerified = true;
        queueCapabilityEvidence = capability.evidence ?? 'fresh';
        if (queueCapabilityEvidence === 'cached' && clientMutationId === null) {
          clientMutationId = createClientMutationId();
        }
      }
      else queue = false;
    }
    let generatedMutation = null;
    let generatedComposedStore = null;
    if (generatedReference) {
      generatedComposedStore = queue === true
        ? this.#offlineQueueStore(true)
        : queue === 'auto' ? this.#offlineQueueStore(false) : null;
      let prepared;
      try {
        prepared = await this.__storeRuntimeInvoke('prepareGeneratedMutation', {
          ref, args, userId, clientMutationId, optimisticOperation, ctxLedger,
          settlementLane, settlementIdentity, settlementClaims, boundedSkew,
          composeLocalExecution: generatedPresentationEnabled,
        });
      } catch (error) {
        if (preparationAuthorityCapture !== null) {
          // @ref LLP 0059#cross-context-ownership — a rejected preparation is
          // still an app-visible foreground completion. Reload durable custody
          // before exposing its original error; isCurrent() may have missed a
          // peer transition because broadcasts are only wakeups.
          const rejectionFence = await this.commitAuthorityPublication(
            preparationAuthorityCapture,
            () => undefined,
          );
          if (!rejectionFence.committed) throw staleAuthorityError();
        }
        throw error;
      }
      if (
        preparationAuthorityCapture !== null
        && !this.isAuthorityCaptureCurrent(preparationAuthorityCapture)
      ) throw staleAuthorityError();
      ({
        generatedMutation,
        clientMutationId,
        optimisticOperation,
        ctxLedger,
        settlementLane,
        settlementIdentity,
        settlementClaims,
        boundedSkew,
      } = prepared);
    }
    const mutationInspectionId = clientMutationId ?? createClientMutationId();
    let mutationInspectionDispatchedAtMs = null;
    const directMutationTiming = (serverTiming = null) => mutationTiming({
      timing: {
        enqueuedAtMs: null,
        dispatchedAtMs: mutationInspectionDispatchedAtMs,
      },
      settlement: { timing: serverTiming },
    });
    if (
      settlementLane !== null
      && settlementLane !== 'replay-accept'
      && settlementLane !== 're-derive'
    ) {
      throw new TypeError("mutate settlementLane must be 'replay-accept' or 're-derive'");
    }
    if (optimisticOperation !== null && settlementLane !== 're-derive') {
      throw new TypeError("mutate optimisticOperation requires settlementLane 're-derive'");
    }
    if (optimisticOperation !== null && clientMutationId === null) {
      clientMutationId = createClientMutationId();
    }
    let queueStore = generatedMutation !== null
      ? generatedComposedStore
      : queue === false ? null : this.#offlineQueueStore(queue === true);
    const operationIdentityEnabled = this.__operationIdentityProtocol === 1 && queueStore !== null;
    if (operationIdentityEnabled) {
      const requiredMethods = [
        'readStoreMeta',
        'outboxEnqueueWithOperationIdentity',
        'outboxAssignOperationIdentity',
        'outboxOperationIdentityRange',
      ];
      if (requiredMethods.some((method) => typeof queueStore[method] !== 'function')) {
        const error = new Error(
          'SNAPBACK_OPERATION_RANGE_STORE_INCAPABLE: durable store lacks atomic range custody',
        );
        error.code = 'SNAPBACK_OPERATION_RANGE_STORE_INCAPABLE';
        throw error;
      }
      if (clientMutationId === null) clientMutationId = createClientMutationId();
    }
    // @ref LLP 0093#mutation-wire-artifact-identity-amendment--2026-08-10 —
    // finite mutations cannot inherit a connection's negotiated version, so
    // the exact offer travels with the generated build identity on every
    // online and replay dispatch.
    const body = {
      args,
      auth: SnapbackClient.auth(userId),
      read_set: readSet,
      wireVersion: WIRE_VERSION_TOKEN,
    };
    if (generation !== null) body.expectedGeneration = generation;
    // Opaque adapter correlation (LLP 0034 §3.2): sent verbatim, echoed on
    // the receipt; the provider never interprets it.
    if (correlation) body.correlation = correlation;
    // LLP 0043 M2: a queued mutation keeps one durable identity and one
    // captured answer ledger across retries/reloads. The server settles the
    // id atomically with data changes and returns the original result on a
    // duplicate delivery.
    if (clientMutationId) body.clientMutationId = clientMutationId;
    if (mediaCommand !== null) body.mediaCommand = mediaCommand;
    if (operationIssuance) body.operationIssuance = operationIssuance;
    if (authorityDescriptor) {
      body.authorityDescriptor = requireAuthorityDescriptor(
        authorityDescriptor,
        'SNAPBACK_AUTHORITY_DESCRIPTOR_INVALID',
      );
    }
    let queueAuthority = null;
    if (queueStore && clientMutationId !== null && this.authorityFence) {
      try {
        queueAuthority = await this.#captureQueueAuthority(preparationAuthorityCapture);
      } catch (error) {
        this.#recordOutboxDiagnostic({
          code: 'SNAPBACK_OFFLINE_MUTATION_QUEUE_REFUSED',
          mutation: name,
          clientMutationId,
          reason: authorityErrorCode(error) ?? error?.message ?? String(error),
          custody: 'authority_unsettled',
        });
        throw error;
      }
      body.authorityDescriptor = queueAuthority.authorityDescriptor;
    }
    let operationAuthorityPrincipalId = typeof userId === 'string' ? userId : null;
    if (queueAuthority !== null) {
      operationAuthorityPrincipalId = queueAuthority.principalScope.userId;
    } else if (operationIdentityEnabled && this.authProtocols.authClient != null) {
      const session = await this.authSession();
      const currentDescriptor = requireAuthorityDescriptor(
        session?.authorityDescriptor,
        'SNAPBACK_AUTHORITY_DESCRIPTOR_INVALID',
      );
      const currentPrincipalId = session?.activeMode === 'sessions'
        && session?.authority?.isAuthenticated === true
        && typeof session?.authority?.userId === 'string'
        ? session.authority.userId
        : null;
      if (
        body.authorityDescriptor
        && !sameAuthorityDescriptor(currentDescriptor, body.authorityDescriptor)
      ) {
        const error = new Error(
          'SNAPBACK_OPERATION_RANGE_REAUTH_REQUIRED: mutation descriptor is not current',
        );
        error.code = 'SNAPBACK_OPERATION_RANGE_REAUTH_REQUIRED';
        throw error;
      }
      body.authorityDescriptor = currentDescriptor;
      operationAuthorityPrincipalId = currentPrincipalId;
    }
    // Exactly-once ledger GC piggyback (LLP 0043 M2): ride pending ACK
    // obligations for this auth identity on the next mutation. A request
    // may not acknowledge its own current id.
    let sentAcknowledgements = [];
    let sentAcknowledgementFence = null;
    if (
      queueStore
      && body.authorityDescriptor
      && acknowledgedClientMutationIds.length === 0
    ) {
      try {
        const status = await queueStore.outboxAuthorizationStatus();
        if (status?.suspended !== true) {
          sentAcknowledgementFence = outboxAuthorizationFenceFrom(status);
          sentAcknowledgements = (await queueStore.outboxPendingAcknowledgements(
            typeof userId === 'string' ? userId : null,
            64,
            body.authorityDescriptor ?? null,
          )).filter((id) => id !== clientMutationId);
        }
      } catch {
        sentAcknowledgements = [];
        sentAcknowledgementFence = null;
      }
      if (sentAcknowledgements.length > 0) {
        body.acknowledgedClientMutationIds = sentAcknowledgements;
      }
    }
    const confirmSentAcknowledgements = async () => {
      if (sentAcknowledgements.length === 0) return;
      try {
        await queueStore.outboxConfirmAcknowledgements(
          sentAcknowledgements,
          undefined,
          undefined,
          sentAcknowledgementFence,
        );
      } catch { /* retained obligations are retried on a later mutation */ }
    };
    if (acknowledgedClientMutationIds.length > 0) {
      body.acknowledgedClientMutationIds = acknowledgedClientMutationIds;
    }
    if (ctxLedger) body.ctx_ledger = ctxLedger;
    // This is an ordinary synthetic wire carrier, not a local executor. The
    // server owns the selected policy and all authoritative answers.
    // @ref LLP 0133#the-two-settlement-lanes — the client-attested label is
    //   immutable outbox identity and grants no authority.
    if (settlementLane !== null) body.settlementLane = settlementLane;
    if (settlementIdentity !== null) body.settlementIdentity = settlementIdentity;
    if (settlementClaims !== null) body.settlementClaims = settlementClaims;
    if (boundedSkew !== null) body.boundedSkew = boundedSkew;
    let durableMutationRecord = clientMutationId ? {
      id: clientMutationId,
      function: name,
      args,
      userId: typeof userId === 'string' ? userId : null,
      readSet,
      correlation,
      authorityDescriptor: body.authorityDescriptor ?? null,
      operationAuthorityPrincipalId,
      ctxLedger: ctxLedger ?? null,
      expectedGeneration: generation,
      ...(typeof ref !== 'object' || ref === null || ref.argsContract == null
        ? {}
        : { argsContract: ref.argsContract }),
      ...(typeof ref !== 'object' || ref === null || ref.argumentSchema == null
        ? {}
        : { argumentSchema: ref.argumentSchema }),
      settlementLane: settlementLane ?? 'replay-accept',
      dispatchLane,
      housekeepingKey: housekeeping?.key ?? null,
      settlementIdentity,
      settlementClaims,
      boundedSkew,
      mediaCommand,
      operationIssuance,
      operationCoverageDisposition,
      optimisticOperation,
      generatedMutationTables: generatedReference
        ? generatedMutationWriteTables(ref.mutationIr?.plan)
        : null,
      optimisticProcessEpoch: optimisticProcessOrder.epoch,
      optimisticInvocationSequence,
      capturedNow: Date.now(),
      ...(queueAuthority === null ? {} : {
        principalScope: queueAuthority.principalScope,
        custody: queueAuthority.custody,
      }),
    } : null;
    let durableOnlineRecord = false;
    let durableOnlineStoredRecord = null;
    let queueInsertionOwnership = null;
    const storedDispatchDisposition = async (stored) => {
      if (stored?.status === 'pending' && stored?.replayable !== false) return null;
      this.#notifyOutboxListeners();
      if (generatedPresentationEnabled || stored?.optimisticOperation != null) {
        // A delete tombstone may replace a record whose generated layer was
        // already visible through an idempotent/concurrent enqueue. Re-read
        // the durable projection before surfacing its terminal disposition.
        await this.#refreshOptimisticMutationViews('authorization-delete-tombstone');
      }
      if (stored?.status === 'settled' && stored?.settlement) {
        return generatedMutation === null
          ? { ...structuredClone(stored.settlement), status: 'settled' }
          : {
            ...structuredClone(stored.settlement),
            status: 'settled',
            clientMutationId: stored.id,
            optimistic: {
              operationHash: generatedMutation.operationHash,
              settlementIdentity: stored.id,
            },
          };
      }
      throw nonReplayableOutboxDispositionError(stored);
    };
    const currentStoredDispatchDisposition = async () => {
      let current = null;
      try {
        current = (await queueStore.outboxRecords())
          .find((record) => record?.id === clientMutationId) ?? null;
      } catch (error) {
        // Without a readable record the caller cannot be told that durable
        // replay owns this mutation. Preserve the store refusal instead of
        // manufacturing a replay-eligible `queued` outcome.
        throw error;
      }
      if (!await this.#compensateStaleQueueWrite(
        queueStore,
        clientMutationId,
        queueAuthority,
        {
          insertionOwnership: queueInsertionOwnership,
          expectedAuthorizationFence: current === null
            ? null
            : outboxAuthorizationFenceFrom(current),
        },
      )) {
        throw staleAuthorityError();
      }
      return storedDispatchDisposition(current);
    };
    let authorizationDispatchRelease = null;
    let authorizationDispatchSettlement = Promise.resolve();
    const releaseAuthorizationDispatch = () => {
      if (authorizationDispatchRelease === null) return authorizationDispatchSettlement;
      const release = authorizationDispatchRelease;
      authorizationDispatchRelease = null;
      authorizationDispatchSettlement = Promise.resolve(release());
      authorizationDispatchSettlement.catch(() => {});
      return authorizationDispatchSettlement;
    };
    let authorizationDispatchFence = null;
    let foregroundOutboxOwnershipHeld = false;
    let foregroundOutboxOwnershipId = null;
    const claimForegroundOwnership = (record) => {
      if (dispatchLane === 'housekeeping' || foregroundOutboxOwnershipHeld) return;
      foregroundOutboxOwnershipHeld = claimForegroundOutboxRecord(queueStore, record);
      if (foregroundOutboxOwnershipHeld) foregroundOutboxOwnershipId = record.id;
    };
    const releaseForegroundOwnership = () => {
      if (!foregroundOutboxOwnershipHeld) return;
      foregroundOutboxOwnershipHeld = false;
      if (releaseForegroundOutboxRecord(queueStore, foregroundOutboxOwnershipId)) {
        this.#notifyOutboxListeners();
      }
      foregroundOutboxOwnershipId = null;
    };
    try {
      if (queueStore && durableMutationRecord) {
      try {
        const enqueueDurably = async (operation) => {
          const queueFence = outboxAuthorizationFenceFrom(
            await queueStore.outboxAuthorizationStatus(),
          );
          if (
            queueAuthority !== null
            && this.authorityFence?.isCurrent?.(queueAuthority.capture) !== true
          ) throw staleAuthorityError();
          return operation(queueFence);
        };
        if (operationIdentityEnabled) {
          const clientAudienceId = (await queueStore.readStoreMeta())?.clientStoreId;
          if (typeof clientAudienceId !== 'string' || !SNAPBACK_OPAQUE_ID.test(clientAudienceId)) {
            const error = new Error(
              'SNAPBACK_OPERATION_RANGE_AUDIENCE_INVALID: durable store has no valid client identity',
            );
            error.code = 'SNAPBACK_OPERATION_RANGE_AUDIENCE_INVALID';
            throw error;
          }
          const authorityCohortKey = this.#operationIdentityCohortKey(
            clientAudienceId,
            userId,
            body.authorityDescriptor,
          );
          let stored = await enqueueDurably((queueFence) => (
            queueStore.outboxEnqueueWithOperationIdentity(
              durableMutationRecord,
              authorityCohortKey,
              null,
              queueFence,
            )
          ));
          this.#recordRuntimeCostOutboxEnqueue(stored, functionId);
          let preparationFence = outboxAuthorizationFenceFrom(stored);
          durableOnlineStoredRecord = stored;
          queueInsertionOwnership = outboxInsertionOwnershipFrom(stored);
          if (!await this.#compensateStaleQueueWrite(
            queueStore,
            stored.id,
            queueAuthority,
            {
              insertionOwnership: queueInsertionOwnership,
              expectedAuthorizationFence: preparationFence,
            },
          )) {
            throw staleAuthorityError();
          }
          if (stored.status !== 'pending') {
            durableOnlineRecord = true;
            return storedDispatchDisposition(stored);
          }
          claimForegroundOwnership(stored);
          if (stored.operationIssuance === null) {
            let range;
            try {
              range = await this.#refreshOperationIdentityRange(
                queueStore,
                authorityCohortKey,
                clientAudienceId,
                userId,
                body.authorityDescriptor,
                queueAuthority?.capture ?? authorityCapture,
              );
              stored = await queueStore.outboxAssignOperationIdentity(
                stored.id,
                authorityCohortKey,
                range,
                body.authorityDescriptor ?? undefined,
                operationAuthorityPrincipalId ?? undefined,
                preparationFence,
              );
              durableOnlineStoredRecord = stored;
              preparationFence = outboxAuthorizationFenceFrom(stored);
            } catch (error) {
              if (isConnectivityFailureError(error) || isOperationRangeCapacityError(error)) {
                const queuedDiagnostic = this.#emitQueuedRelinquishmentDiagnostic({
                  mutation: name,
                  clientMutationId: stored.id,
                  sequence: stored.sequence,
                  queueReasonClass: isOperationRangeCapacityError(error)
                    ? 'no-attempt-policy'
                    : this.#connectivityQueueReasonClass(error),
                });
                this.#recordOutboxDiagnostic({
                  code: 'SNAPBACK_OPERATION_RANGE_UNCOVERED_QUEUED',
                  mutation: name,
                  clientMutationId: stored.id,
                  disposition: 'uncovered-range-exhausted',
                  reason: isOperationRangeCapacityError(error)
                    ? 'authenticated-epoch-capacity'
                    : 'connectivity',
                  ...queuedDiagnostic,
                });
                // @ref LLP 0218#41-the-dispatch-union-headless-contract — an
                //   uncovered range relinquishes foreground dispatch as queued.
                if (generatedPresentationEnabled) {
                  await this.#refreshOptimisticMutationViews('generated-ir-queued');
                }
                return {
                  status: 'queued',
                  clientMutationId: stored.id,
                  sequence: stored.sequence,
                  presentation: this.#optimisticPresentationDisposition(stored.id),
                  operationCoverageDisposition: 'uncovered-range-exhausted',
                };
              }
              if (
                authorityErrorCode(error) === 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE'
                || authorityErrorCode(error) === 'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE'
                || authorityErrorCode(error) === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED'
              ) {
                const terminal = await currentStoredDispatchDisposition();
                if (terminal !== null) return terminal;
                const authorizationDisposition = authorityErrorCode(error)
                  === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED'
                  ? 'authorization-suspended'
                  : 'authorization-stale';
                this.#notifyOutboxListeners();
                return {
                  status: 'queued',
                  clientMutationId: stored.id,
                  sequence: stored.sequence,
                  presentation: this.#optimisticPresentationDisposition(stored.id),
                  authorizationDisposition,
                };
              }
              if (isAuthorityFenceUnsettledError(error)) {
                await this.#reconcileQueueCustody(queueStore);
                throw error;
              }
              const markedFailed = await queueStore.outboxMarkFailed(stored.id, {
                code: error?.diagnostic?.code ?? error?.code
                  ?? 'SNAPBACK_OPERATION_RANGE_REFRESH_FAILED',
                message: error?.message ?? String(error),
                effectCommitted: false,
                effectMayHaveCommitted: false,
              }, preparationFence);
              if (markedFailed) {
                this.#recordMutationPhaseCost({
                  clientMutationId: stored.id,
                  functionId: stored.function,
                  disposition: 'failed',
                  timing: mutationTiming(stored),
                });
              }
              throw error;
            }
          }
          if (!stored?.operationIssuance) {
            const error = new Error(
              'SNAPBACK_OPERATION_RANGE_EXHAUSTED: refreshed range supplied no operation identity',
            );
            error.code = 'SNAPBACK_OPERATION_RANGE_EXHAUSTED';
            throw error;
          }
          body.operationIssuance = stored.operationIssuance;
          durableMutationRecord.operationIssuance = stored.operationIssuance;
          durableMutationRecord.operationCoverageDisposition = stored.operationCoverageDisposition;
        } else {
          const stored = await enqueueDurably((queueFence) => (
            queueStore.outboxEnqueue(durableMutationRecord, queueFence)
          ));
          this.#recordRuntimeCostOutboxEnqueue(stored, functionId);
          durableOnlineStoredRecord = stored;
          queueInsertionOwnership = outboxInsertionOwnershipFrom(stored);
          if (!await this.#compensateStaleQueueWrite(
            queueStore,
            stored?.id ?? clientMutationId,
            queueAuthority,
            {
              insertionOwnership: queueInsertionOwnership,
              expectedAuthorizationFence: stored === null || stored === undefined
                ? null
                : outboxAuthorizationFenceFrom(stored),
            },
          )) {
            throw staleAuthorityError();
          }
          const storedDisposition = await storedDispatchDisposition(stored);
          if (storedDisposition !== null) return storedDisposition;
          claimForegroundOwnership(stored);
        }
        durableOnlineRecord = true;
        this.#notifyOutboxListeners();
        if (generatedPresentationEnabled) {
          await this.#refreshOptimisticMutationViews('generated-ir-enqueued');
        }
      } catch (error) {
        const code = error?.diagnostic?.code ?? error?.code;
        if (
          queueCapabilityEvidence === 'cached'
          && code === 'SNAPBACK_OUTBOX_NOT_WRITER'
        ) {
          // Cached support authorizes enqueue custody only. If another writer
          // owns that custody, surface its exact refusal and never convert the
          // missing record into a ledger error or an online POST.
          throw error;
        }
        if (
          !generatedPresentationEnabled
          || queue !== 'auto'
          || code !== 'SNAPBACK_OUTBOX_NOT_WRITER'
        ) throw error;
        // @ref LLP 0270#d3-derive-and-attach-optimistic-presentation-by-default
        // A non-writer cannot claim durable replay, but it can retain the
        // generated operation in the process-local ledger for this
        // online attempt. Connectivity failure still rejects because no
        // durable queue accepted custody.
        queueStore = null;
      }
      }
    let ephemeralOptimisticRecord = false;
    if (
      generatedPresentationEnabled
      && !durableOnlineRecord
      && durableMutationRecord !== null
    ) {
      if (
        preparationAuthorityCapture !== null
        && !this.isAuthorityCaptureCurrent(preparationAuthorityCapture)
      ) throw staleAuthorityError();
      this.#installEphemeralOptimisticRecord(
        durableMutationRecord,
        optimisticInvocationSequence,
      );
      ephemeralOptimisticRecord = true;
      await this.#refreshOptimisticMutationViews('generated-ir-ephemeral-admitted');
    }
    if (queueCapabilityEvidence === 'cached') {
      // @ref LLP 0043#target-settlement-ledger-capability-gate-2026-08-12 —
      // cached support grants enqueue custody only. It cannot authorize a
      // foreground attempt against a target that may have changed since the
      // answered manifest, because a lost response could otherwise duplicate
      // the effect before fresh-gated replay.
      const queued = durableOnlineRecord && queueStore && durableMutationRecord
        ? await this.#enqueueOfflineMutation(queueStore, durableMutationRecord, {
            alreadyCommitted: true,
            functionId,
            queueReasonClass: 'no-attempt-policy',
          })
        : null;
      if (queued === null) {
        throw offlineQueueSettlementLedgerError({
          reason: 'cached-enqueue-custody-unavailable',
        });
      }
      return generatedMutation === null
        ? queued
        : { ...queued, operationHash: generatedMutation.operationHash };
    }
    let reservationRetryAuthorityCapture = queueAuthority?.capture ?? authorityCapture;
    let reservationRetryExternalBearer = null;
    let reservationRetryExternalTransportGeneration = null;
    if (!this.authorityFence && this.authProtocols.authClient === 1) {
      // A call started during an explicit bearer transition belongs to the
      // successor, but once its first attempt starts every automatic retry
      // remains pinned to that exact carrier generation.
      if (this.__externalBearerTransition) await this.__externalBearerTransition;
      reservationRetryExternalBearer = this.bearerToken;
      reservationRetryExternalTransportGeneration = this.__authTransportGeneration;
    }
    const assertReservationRetryAuthority = () => {
      if (reservationRetryAuthorityCapture !== null) {
        const current = this.captureAuthority();
        if (!sameAuthorityCapture(current, reservationRetryAuthorityCapture)) {
          throw staleAuthorityError();
        }
      }
      if (
        reservationRetryExternalTransportGeneration !== null
        && (
          this.__externalBearerTransition !== null
          || this.bearerToken !== reservationRetryExternalBearer
          || this.__authTransportGeneration
            !== reservationRetryExternalTransportGeneration
        )
      ) {
        throw staleAuthorityError();
      }
    };
    for (
      let attempt = 1;
      attempt <= this.reservationRetryMaxAttempts;
      attempt += 1
    ) {
      assertReservationRetryAuthority();
      try {
        const json = await this.#req(
          'POST',
          `/mutation/${encodeURIComponent(name)}`,
          body,
          undefined,
          {
            expectedAuthorityCapture: reservationRetryAuthorityCapture,
            authAdmissionReference: ref,
            authAdmissionOperation: 'mutation',
            beforeTransportDispatch: async () => {
              await __beforeTransportDispatch?.();
              if (
                preparationAuthorityCapture !== null
                && !this.isAuthorityCaptureCurrent(preparationAuthorityCapture)
              ) throw staleAuthorityError();
              if (authorizationDispatchStore) {
                await releaseAuthorizationDispatch();
                authorizationDispatchRelease = await acquireOutboxAuthorizationDispatch(
                  authorizationDispatchStore,
                  dispatchLane,
                );
                if (!durableOnlineRecord) {
                  const status = await authorizationDispatchStore.outboxAuthorizationStatus();
                  if (status?.suspended === true) {
                    const error = new Error(
                      'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED: foreground mutation waits for authorization proof',
                    );
                    error.code = 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED';
                    throw error;
                  }
                } else {
                  const prepared = await queueStore.outboxPrepareSubmission(
                    clientMutationId,
                    { authorizationOnly: true, markDispatched: true },
                  );
                  if (prepared?.status !== 'ready' || !prepared.record) {
                    const error = new Error(
                      `SNAPBACK_OUTBOX_SUBMISSION_NOT_READY: foreground record is ${prepared?.status ?? 'missing'}`,
                    );
                    error.code = prepared?.status === 'authorization-suspended'
                      ? 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED'
                      : prepared?.status === 'authorization-stale'
                        || prepared?.status === 'stranded'
                        ? 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE'
                        : 'SNAPBACK_OUTBOX_SUBMISSION_NOT_READY';
                    throw error;
                  }
                  durableOnlineStoredRecord = prepared.record;
                  authorizationDispatchFence = prepared.fence;
                }
              }
              if (ephemeralOptimisticRecord) {
                this.#markEphemeralOptimisticDispatched(clientMutationId);
              }
              mutationInspectionDispatchedAtMs ??= Date.now();
            },
            onTransportFailure: async (error) => {
              await __onTransportFailure?.(error);
              if (
                !durableOnlineRecord
                || requestFailureReentersAuthorityTransport(error)
              ) {
                await releaseAuthorizationDispatch();
              }
            },
          },
        );
        if (json?.receipt) {
          this.recordReceipt(json.receipt, json?.[AUTHORITY_CAPTURE] ?? null);
        }
        // Publication crosses one durable boundary: retain the complete
        // settlement and its GC obligation atomically before returning it.
        if (durableOnlineRecord) {
          let consumed;
          try {
            consumed = await queueStore.outboxDurablyConsume(
              clientMutationId,
              json,
              typeof userId === 'string' ? userId : null,
              sentAcknowledgements,
              authorizationDispatchFence ?? preparationFence,
            );
          } catch (error) {
            error.outboxSettlementPersistenceFailure = true;
            throw error;
          }
          if (!consumed) {
            const error = new Error(
              'SNAPBACK_OUTBOX_SETTLEMENT_NOT_DURABLE: settlement publication lost its outbox record',
            );
            error.code = 'SNAPBACK_OUTBOX_SETTLEMENT_NOT_DURABLE';
            error.outboxSettlementPersistenceFailure = true;
            throw error;
          }
          this.#recordMutationPhaseCost({
            clientMutationId,
            functionId: name,
            disposition: 'settled',
            timing: mutationTiming({ ...durableOnlineStoredRecord, settlement: json }),
            committedVersion: json?.version ?? null,
          });
          this.#notifyOutboxListeners();
          if (generatedPresentationEnabled) {
            await this.#refreshOptimisticMutationViews('settlement-confirmed-bridge');
          }
        }
        if (ephemeralOptimisticRecord) {
          this.#settleEphemeralOptimisticRecord(clientMutationId, json);
          await this.#refreshOptimisticMutationViews('settlement-confirmed-bridge');
        }
        if (
          !durableOnlineRecord
          && !ephemeralOptimisticRecord
          && __authorizationDispatchOwnership !== OUTBOX_AUTHORIZATION_DISPATCH_OWNERSHIP
        ) {
          this.#recordMutationPhaseCost({
            clientMutationId: mutationInspectionId,
            functionId: name,
            disposition: 'settled',
            timing: directMutationTiming(json?.timing),
            committedVersion: json?.version ?? null,
          });
        }
        // The response proves the origin ran its piggyback ACK stage.
        await confirmSentAcknowledgements();
        if (attempt > 1) {
          this.#recordReservationRetryDiagnostic({
            code: 'SNAPBACK_AUTH_RESERVATION_RETRY_SETTLED',
            mutation: name,
            outcome: 'settled',
            attempts: attempt,
          });
        }
        // @ref LLP 0218#41-the-dispatch-union-headless-contract — foreground
        //   settlement stays settled even though durable custody was committed first.
        return generatedMutation === null
          ? {
            ...json,
            status: 'settled',
            ...(generatedPresentationEnabled ? { clientMutationId } : {}),
          }
          : {
            ...json,
            status: 'settled',
            clientMutationId,
            optimistic: {
              operationHash: generatedMutation.operationHash,
              settlementIdentity: clientMutationId,
            },
          };
      } catch (error) {
        const authorizationCode = authorityErrorCode(error);
        if (
          durableOnlineRecord
          && (
            authorizationCode === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED'
            || authorizationCode === 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE'
            || authorizationCode === 'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE'
          )
        ) {
          const terminal = await currentStoredDispatchDisposition();
          if (terminal !== null) return terminal;
          const authorizationDisposition = authorizationCode
            === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED'
            ? 'authorization-suspended'
            : 'authorization-stale';
          this.#notifyOutboxListeners();
          await this.#refreshOptimisticMutationViews('authorization-suspended');
          return {
            status: 'queued',
            clientMutationId,
            sequence: durableOnlineStoredRecord?.sequence ?? null,
            presentation: this.#optimisticPresentationDisposition(clientMutationId),
            authorizationDisposition,
          };
        }
        if (error?.outboxSettlementPersistenceFailure === true) throw error;
        // A REJECTED mutation still produced its receipt (it rides the error
        // envelope) — retain it before rethrowing.
        if (error?.receipt) this.recordReceipt(error.receipt);
        if (!this.#isEffectFreeReservationStale(error)) {
          // A provider receipt on the refusal proves the piggyback ACK
          // stage ran even though this mutation was rejected (LLP 0043); a
          // receipt-less failure is ambiguous and RETAINS the obligations.
          if (error?.receipt) await confirmSentAcknowledgements();
          if (isOperationResultExpiredError(error)) {
            error.operationOutcome = operationOutcomeFromError(error);
            error.operationResult = 'expired';
            if (durableOnlineRecord) {
              let retained;
              try {
                retained = await queueStore.outboxMarkResultGone(clientMutationId, {
                  outcome: error.operationOutcome,
                  receiptDigest: error?.diagnostic?.details?.receiptDigest,
          }, authorizationDispatchFence ?? preparationFence);
              } catch (custodyError) {
                custodyError.outboxSettlementPersistenceFailure = true;
                throw custodyError;
              }
              if (!retained) {
                const custodyError = new Error(
                  'SNAPBACK_OUTBOX_RESULT_GONE_NOT_DURABLE: result-expired state lost its outbox record',
                );
                custodyError.code = 'SNAPBACK_OUTBOX_RESULT_GONE_NOT_DURABLE';
                custodyError.outboxSettlementPersistenceFailure = true;
                throw custodyError;
              }
              this.#notifyOutboxListeners();
              this.#recordMutationPhaseCost({
                clientMutationId,
                functionId: name,
                disposition: 'resultGone',
                timing: mutationTiming({
                  ...durableOnlineStoredRecord,
                  settlement: { timing: error?.timing },
                }),
              });
            } else if (__authorizationDispatchOwnership !== OUTBOX_AUTHORIZATION_DISPATCH_OWNERSHIP) {
              const ephemeralRecord = clientMutationId === null
                ? null
                : this.__ephemeralOptimisticRecords.get(clientMutationId) ?? null;
              this.#recordMutationPhaseCost({
                clientMutationId: mutationInspectionId,
                functionId: name,
                disposition: 'resultGone',
                timing: ephemeralRecord === null
                  ? directMutationTiming(error?.timing)
                  : mutationTiming({
                      ...ephemeralRecord,
                      settlement: { timing: error?.timing },
                    }),
              });
            }
            this.#recordOutboxDiagnostic({
              code: 'SNAPBACK_OFFLINE_MUTATION_RESULT_EXPIRED',
              mutation: name,
              clientMutationId,
              disposition: 'result-expired',
              operationOutcome: error.operationOutcome,
            });
            throw error;
          }
          if (isOperationOutcomeUnknownError(error)) {
            error.operationOutcome = 'unknown';
            this.#recordOutboxDiagnostic({
              code: 'SNAPBACK_OFFLINE_MUTATION_OUTCOME_UNKNOWN',
              mutation: name,
              clientMutationId,
              disposition: 'identity-horizon-passed',
            });
            throw error;
          }
          if (queueStore && isConnectivityFailureError(error)) {
            if (queueCapabilityVerified !== true) {
              const capability = await this.#offlineMutationReplayCapabilityFact({
                allowCachedForEnqueue: true,
                expectedGeneration: generation,
              });
              if (!capability.supported || capability.evidence === 'cached') {
                this.#recordOutboxDiagnostic({
                  code: OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED,
                  mutation: name,
                  clientMutationId,
                  reason: capability.evidence === 'cached'
                    ? 'cached-evidence-after-foreground-attempt'
                    : capability.reason,
                  targetProfileId: capability.targetProfileId,
                });
                // `queue:'auto'` degrades to `queue:false`: the original
                // ambiguous transport failure remains the caller-visible
                // error, and no durable intent is created.
                throw error;
              }
              queueCapabilityVerified = true;
            }
            // LLP 0043 M2 / LLP 0129 Phase 0: delivery refused at the
            // transport — queue the intent durably under a client-minted
            // durable identity and settle it by ordered replay after the
            // full-resync reconnect. The captured wall-clock is a labeled
            // claim (decision 10 taxonomy), never transmitted as authority;
            // this arm runs no local execution, so there is no captured
            // {generatedIds} ledger unless the caller supplied one
            // (LLP 0008 §Replay environment contract governs when one
            // exists — replay then transmits it verbatim).
            const queued = await this.#enqueueOfflineMutation(
              queueStore,
              durableMutationRecord ?? {
                id: createClientMutationId(),
                function: name,
                args,
                userId: typeof userId === 'string' ? userId : null,
                readSet,
                correlation,
                authorityDescriptor: body.authorityDescriptor ?? null,
                operationAuthorityPrincipalId,
                ctxLedger: ctxLedger ?? null,
                expectedGeneration: generation,
                ...(typeof ref !== 'object' || ref === null || ref.argsContract == null
                  ? {}
                  : { argsContract: ref.argsContract }),
                ...(typeof ref !== 'object' || ref === null || ref.argumentSchema == null
                  ? {}
                  : { argumentSchema: ref.argumentSchema }),
                settlementLane: settlementLane ?? 'replay-accept',
                settlementIdentity,
                settlementClaims,
                boundedSkew,
                operationIssuance,
                operationCoverageDisposition,
                optimisticOperation,
                capturedNow: Date.now(),
              },
              {
                alreadyCommitted: durableOnlineRecord,
                functionId,
                queueReasonClass: this.#connectivityQueueReasonClass(error),
              },
            );
            if (queued) {
              return generatedMutation === null
                ? queued
                : { ...queued, operationHash: generatedMutation.operationHash };
            }
          }
          if (durableOnlineRecord && isAuthorityFenceUnsettledError(error)) {
            await this.#reconcileQueueCustody(queueStore);
            throw error;
          }
          if (durableOnlineRecord && isServerAuthorityStaleResult(error)) {
            const held = await queueStore.outboxMarkStranded(
              clientMutationId,
              'server_authority_stale_result',
              durableMutationRecord.principalScope ?? null,
              authorizationDispatchFence,
              effectProvenanceFromError(error),
            );
            if (held) {
              this.#recordMutationPhaseCost({
                clientMutationId,
                functionId: name,
                disposition: 'stranded',
                timing: mutationTiming({
                  ...durableOnlineStoredRecord,
                  settlement: { timing: error?.timing },
                }),
              });
              this.#recordOutboxDiagnostic({
                code: 'SNAPBACK_OFFLINE_MUTATION_STRANDED',
                mutation: name,
                clientMutationId,
                reason: 'server_authority_stale_result',
              });
              await this.#refreshOptimisticMutationViews('authority-stale-stranded');
            }
            throw error;
          }
          if (durableOnlineRecord) {
            let failureMarked = true;
            try {
              await queueStore.outboxMarkFailed(clientMutationId, {
                code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_MUTATION_REFUSED',
                message: error?.message ?? String(error),
                timing: error?.timing ?? null,
                ...effectProvenanceFromError(error),
              }, authorizationDispatchFence);
            } catch (markError) {
              if (markError?.code !== 'SNAPBACK_RQS_STORE_CLOSED') throw markError;
              // Teardown may close the owned store while a transport refusal
              // is still unwinding. Failure marking is a best-effort durable
              // annotation at that cut: preserve the real mutation error and
              // record why the annotation could not land. Every other store
              // error remains fail-loud.
              failureMarked = false;
              this.#recordOutboxDiagnostic({
                code: 'SNAPBACK_OUTBOX_FAILURE_MARK_SKIPPED_STORE_CLOSED',
                mutation: name,
                clientMutationId,
                reason: markError.message,
              });
            }
            if (failureMarked) {
              this.#recordMutationPhaseCost({
                clientMutationId,
                functionId: name,
                disposition: 'failed',
                timing: mutationTiming({
                  ...durableOnlineStoredRecord,
                  settlement: { timing: error?.timing },
                }),
              });
              this.#notifyOutboxListeners();
              if (optimisticOperation !== null) {
                await this.#refreshOptimisticMutationViews('settlement-refused');
              }
            }
          }
          if (ephemeralOptimisticRecord) {
            this.#failEphemeralOptimisticRecord(clientMutationId, error);
            await this.#refreshOptimisticMutationViews('settlement-refused');
          }
          if (
            !durableOnlineRecord
            && !ephemeralOptimisticRecord
            && __authorizationDispatchOwnership !== OUTBOX_AUTHORIZATION_DISPATCH_OWNERSHIP
          ) {
            this.#recordMutationPhaseCost({
              clientMutationId: mutationInspectionId,
              functionId: name,
              disposition: 'failed',
              timing: directMutationTiming(error?.timing),
            });
          }
          if (generatedPresentationEnabled) error.clientMutationId = clientMutationId;
          throw error;
        }
        // This refusal is server-proven effect-free and the loop will issue a
        // fresh transport attempt. It has no terminal outbox disposition to
        // serialize, so relinquish this attempt's dispatch cut before retry.
        await releaseAuthorizationDispatch();
        if (this.authorityFence) {
          const refusalCapture = this.authorityCaptureFor(error);
          if (reservationRetryAuthorityCapture === null) {
            if (refusalCapture === null) throw staleAuthorityError();
            reservationRetryAuthorityCapture = refusalCapture;
          } else if (
            refusalCapture !== null
            && !sameAuthorityCapture(
              refusalCapture,
              reservationRetryAuthorityCapture,
            )
          ) {
            throw staleAuthorityError();
          }
        }
        assertReservationRetryAuthority();
        if (attempt >= this.reservationRetryMaxAttempts) {
          this.#recordReservationRetryDiagnostic({
            code: 'SNAPBACK_AUTH_RESERVATION_RETRY_EXHAUSTED',
            mutation: name,
            outcome: 'exhausted',
            attempts: attempt,
            effectCommitted: false,
          });
          throw error;
        }
        const delayMilliseconds = this.#reservationRetryDelayMilliseconds();
        this.#recordReservationRetryDiagnostic({
          code: 'SNAPBACK_AUTH_RESERVATION_RETRY_SCHEDULED',
          mutation: name,
          outcome: 'effect-free-refusal',
          attempt,
          nextAttempt: attempt + 1,
          maximumAttempts: this.reservationRetryMaxAttempts,
          delayMilliseconds,
          effectCommitted: false,
        });
        if (delayMilliseconds > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
        }
      }
    }
      throw new Error('unreachable authorization reservation retry exhaustion');
    } finally {
      await releaseAuthorizationDispatch();
      // @ref LLP 0218#41-the-dispatch-union-headless-contract — the durable
      // record stays outside replay eligibility until foreground delivery has
      // settled or relinquished it; release publishes the level wake.
      releaseForegroundOwnership();
    }
  }

  subscribeLive(ref, options = {}) {
    return this.#subscribeLive(ref, options);
  }

  async #subscribeLive(ref, {
    connectionId,
    args = {},
    userId,
    correlation = null,
    supersedes = null,
    authorizationNamespace = null,
    authorityCapture = null,
    resumeFromToken = null,
  } = {}, externalBearerTransitionPermit = null) {
    const name = functionName(ref);
    args = validateGeneratedArguments(ref, args, name);
    const generation = expectedGeneration(ref);
    const input = { args, auth: SnapbackClient.auth(userId), read_set: [] };
    if (correlation) input.correlation = correlation;
    const response = await this.#withGrant(connectionId, (grant) => {
      const body = { connection_id: grant.id, input };
      if (generation !== null) body.expectedGeneration = generation;
      // RQS token resume (LLP 0091 §0B.4): the token seeds this ordinary
      // subscribe; a refused token is answered with a fresh snapshot by the
      // server, never retried client-side.
      if (resumeFromToken) body.resumeFromToken = resumeFromToken;
      const namespace = typeof authorizationNamespace === 'function'
        ? authorizationNamespace(grant)
        : authorizationNamespace;
      if (namespace !== null && namespace !== undefined) {
        body.authorizationNamespace = namespace;
      }
      // Explicit supersession (ENG-22478 review fix A): name the subscription
      // this fresh subscribe replaces (the kit's own resubscribe paths only);
      // the server disposes exactly that id. Never inferred — plain duplicate
      // subscribes coexist.
      if (supersedes) body.supersedes = supersedes;
      return this.#req(
        'POST',
        `/live/${encodeURIComponent(name)}/subscribe`,
        body,
        connectionTokenHeader(grant),
        {
          expectedAuthorityCapture: authorityCapture,
          externalBearerTransitionPermit,
        },
      );
    }, externalBearerTransitionPermit);
    if (supersedes !== null) {
      const exactRetirement = response?.superseded === supersedes;
      const exactAbsence = response?.supersessionRefusal
        === LIVE_SUPERSESSION_TARGET_UNKNOWN;
      if (exactRetirement === exactAbsence) {
        // @ref LLP 0095#14-transition-catalogue — request success and a replacement
        // snapshot do not prove predecessor disposal. Retire the unproven new
        // id without installing it; the caller still owns `supersedes`.
        if (
          typeof response?.subscription_id === 'string'
          && response.subscription_id.length > 0
        ) {
          void this.#unsubscribeLive(name, {
            connectionId,
            subscriptionId: response.subscription_id,
            userId,
            authorityCapture: response?.[AUTHORITY_CAPTURE] ?? authorityCapture,
          }, externalBearerTransitionPermit).catch(() => {});
        }
        throw invalidSupersessionWitnessError(supersedes, response);
      }
    }
    Object.defineProperty(response, AUTHORIZATION_CONNECTION, {
      value: await this.connectionGrant(
        connectionId,
        externalBearerTransitionPermit,
      ).then(
        (grant) => grant.authorizationInvalidation,
      ),
      configurable: false,
      enumerable: false,
      writable: false,
    });
    if (response?.receipt) {
      this.recordReceipt(response.receipt, response?.[AUTHORITY_CAPTURE] ?? null);
    }
    return response;
  }

  async acknowledgeAuthorizationInvalidation(connectionId, ackToken) {
    return this.#withGrant(connectionId, (grant) => this.#req(
      'POST',
      '/live/authorization-invalidation/acknowledge',
      { connectionId: grant.id, ackToken },
      connectionTokenHeader(grant),
    ));
  }

  /// Explicit unsubscribe (LLP 0034 §10.1 residual / ENG-22478): dispose one
  /// live subscription; ownership mirrors resume_live.
  unsubscribeLive(ref, options = {}) {
    return this.#unsubscribeLive(ref, options);
  }

  async #unsubscribeLive(ref, {
    subscriptionId,
    connectionId,
    userId,
    authorityCapture = null,
  } = {}, externalBearerTransitionPermit = null) {
    const name = functionName(ref);
    const response = await this.#withGrant(connectionId, (grant) => this.#req('POST', `/live/${encodeURIComponent(name)}/unsubscribe`, {
      subscription_id: subscriptionId,
      connection_id: grant.id,
      auth: SnapbackClient.auth(userId),
    }, connectionTokenHeader(grant), {
      expectedAuthorityCapture: authorityCapture,
      externalBearerTransitionPermit,
    }), externalBearerTransitionPermit);
    if (response?.receipt) {
      this.recordReceipt(response.receipt, response?.[AUTHORITY_CAPTURE] ?? null);
    }
    return response;
  }

  async subscribeEphemeral(ref, {
    connectionId,
    scope = {},
    userId,
    permissions = [],
    transport = 'stream',
    stream: streamOptions = {},
  } = {}) {
    const collection = collectionName(ref);
    scope = normalizeEphemeralScope(ref, scope);
    if (transport !== 'stream' && transport !== 'poll') {
      throw new TypeError(
        `Snapback ephemeral transport must be "stream" or "poll", got ${JSON.stringify(transport)}`,
      );
    }
    // An ephemeral subscription is live by default, so it owns managed-socket
    // demand for exactly the overlay's lifetime. Readiness observation alone
    // deliberately does not own demand (LLP 0034 §10.8); without this lease a
    // fresh connection could take its HTTP snapshot successfully while no
    // transport existed to deliver later room changes. `transport: 'poll'`
    // preserves the explicit headless/manual-drain profile.
    let releaseStreamDemand = null;
    if (transport === 'stream') {
      const manager = this.liveStreamManager(connectionId, streamOptions);
      releaseStreamDemand = manager.acquireDemand();
      try {
        await manager.waitUntilReady();
      } catch (error) {
        releaseStreamDemand();
        releaseStreamDemand = null;
        throw error;
      }
    }
    // @ref LLP 0012#runtime-state — register before the snapshot request so a
    // shared socket cannot destructively drain and discard a post-snapshot
    // delta while the HTTP response is still in flight. The overlay buffers
    // that interval and applies it only after the authoritative snapshot.
    let overlay = null;
    try {
      const snapshot = await this.#withGrant(connectionId, (grant) => {
        // Start buffering immediately before the request is dispatched. Grant
        // acquisition itself cannot create a server-side room registration.
        overlay ??= new EphemeralOverlay(this, ref, { connectionId, scope, userId, permissions });
        // #withGrant may retry this closure after refreshing a rejected
        // token. Bind the id used by THIS request attempt so the successful
        // overlay exposes the exact connection-owned entry key.
        overlay.grantedConnectionId = grant.id;
        return this.#req('POST', '/ephemeral/subscribe', {
          collection,
          scope,
          connection_id: grant.id,
          auth: SnapbackClient.auth(userId, { permissions }),
        }, connectionTokenHeader(grant));
      });
      const committed = await this.commitAuthorityPublication(
        snapshot?.[AUTHORITY_CAPTURE] ?? null,
        () => overlay.applyInitialSnapshot(snapshot),
      );
      if (!committed.committed) throw staleAuthorityError();
      await this.#republishAfterAuthorityReplacement(collection, snapshot, overlay);
      if (releaseStreamDemand) {
        overlay.adoptStreamDemand(releaseStreamDemand);
        releaseStreamDemand = null;
      }
      return overlay;
    } catch (error) {
      overlay?.dispose();
      if (overlay) {
        // The HTTP subscribe may already have registered the room before a
        // post-response failure (notably a bounded pre-snapshot buffer
        // overflow). Detach locally first, then best-effort the authenticated
        // socket unsubscribe so the abandoned server registration does not
        // linger until connection reap. Cleanup must never mask or delay the
        // original subscribe diagnostic.
        const cleanup = this.unsubscribeEphemeral(ref, {
          connectionId,
          scope,
          userId,
          permissions,
        }).catch(() => {});
        // Keep the socket alive only for this best-effort cleanup attempt.
        // The failed overlay is already detached, and cleanup never delays or
        // replaces the original subscription error.
        const releaseAfterCleanup = releaseStreamDemand;
        releaseStreamDemand = null;
        void cleanup.finally(() => releaseAfterCleanup?.());
      } else {
        releaseStreamDemand?.();
        releaseStreamDemand = null;
      }
      throw error;
    }
  }

  // @ref LLP 0107#resync-authority-and-lifecycle — React borrows one
  // client-owned room handle; the handle owns socket demand, overlay
  // replacement, expiry, bounded startup, and unsubscribe-before-detach.
  startEphemeralRoom(admittedDefinition, scope = {}) {
    const definition = admittedDefinition?.definition;
    const ref = admittedDefinition?.reference;
    const connectionId = admittedDefinition?.connectionId;
    if (
      !definition
      || !ref
      || ref.artifactKind !== 'ephemeralCollectionReference'
      || typeof connectionId !== 'string'
      || connectionId.length === 0
    ) {
      throw new TypeError('startEphemeralRoom requires an admitted React collection definition');
    }
    scope = normalizeEphemeralScope(ref, scope, definition.name ?? ref.name);
    const listeners = new Set();
    const manager = this.liveStreamManager(connectionId);
    let overlay = null;
    let overlayOff = null;
    let managerOff = null;
    let expiryTimer = null;
    let generation = 0;
    let disposed = false;
    let cleanup = Promise.resolve();
    let currentConnection = 'connecting';
    let current = freezeEphemeralRoomSnapshot({
      status: 'pending',
      entries: [],
      selfKey: null,
      diagnostic: null,
      connection: currentConnection,
      reason: null,
    });
    const notify = () => {
      for (const listener of [...listeners]) deliverIsolated(listener);
    };
    const publishSnapshot = (patch, expectedGeneration = generation) => {
      if (disposed || expectedGeneration !== generation) return false;
      current = freezeEphemeralRoomSnapshot({ ...current, ...patch });
      notify();
      return true;
    };
    const clearExpiry = () => {
      if (expiryTimer !== null) clearTimeout(expiryTimer);
      expiryTimer = null;
    };
    const scheduleExpiry = (expectedGeneration = generation) => {
      clearExpiry();
      if (!overlay || disposed || expectedGeneration !== generation) return;
      const delayMs = overlay.msUntilEarliestExpiry();
      if (!Number.isFinite(delayMs)) return;
      expiryTimer = setTimeout(() => {
        if (!overlay || disposed || expectedGeneration !== generation) return;
        overlay.pruneExpired();
        publishSnapshot({
          entries: overlay.currentEntries(),
          status: currentConnection === 'live' ? 'ready' : 'stale',
        }, expectedGeneration);
        scheduleExpiry(expectedGeneration);
      }, Math.max(0, delayMs));
      expiryTimer.unref?.();
    };
    const adoptOverlay = (next, expectedGeneration) => {
      if (disposed || generation !== expectedGeneration) {
        next.dispose();
        // Registrations are keyed by the same granted connection, collection,
        // and scope across replacement generations. A late generation cannot
        // distinguish "its" server registration from the successor's, so an
        // unsubscribe here could tear down the current room. Final handle
        // disposal still owns the one authenticated unsubscribe; a successor
        // generation safely adopts the shared server registration meanwhile.
        return;
      }
      overlayOff?.();
      overlay?.dispose();
      overlay = next;
      overlayOff = overlay.onChange((result) => {
        if (disposed || generation !== expectedGeneration) return;
        if (result === 'terminal_error') {
          clearExpiry();
          const diagnostic = overlay.terminalDiagnostic;
          publishSnapshot({
            status: 'error',
            entries: [],
            selfKey: null,
            diagnostic,
            reason: diagnostic?.details?.reason === 'AuthRevoked'
              ? 'auth_revoked'
              : 'ephemeral_error',
          }, expectedGeneration);
          return;
        }
        if (
          result === 'needs_resync'
          || result === 'authority_changed'
          || result === 'authority_missing'
        ) {
          void startGeneration(
            result === 'authority_changed'
              ? 'ephemeral_authority_changed'
              : result,
          );
          return;
        }
        const entries = overlay.currentEntries();
        publishSnapshot({
          status: currentConnection === 'live' ? 'ready' : 'stale',
          entries,
          selfKey: overlay.grantedConnectionId,
          diagnostic: null,
          reason: null,
        }, expectedGeneration);
        scheduleExpiry(expectedGeneration);
      });
      // A terminal frame may have been buffered between server registration
      // and the initial snapshot response. onChange replays that level
      // synchronously; do not overwrite its error projection with ready.
      if (overlay.terminalDiagnostic !== null) return;
      const entries = overlay.currentEntries();
      publishSnapshot({
        status: currentConnection === 'live' ? 'ready' : 'stale',
        entries,
        selfKey: overlay.grantedConnectionId,
        diagnostic: null,
        reason: null,
      }, expectedGeneration);
      scheduleExpiry(expectedGeneration);
    };
    const bounded = (promise, label) => {
      let timer;
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(`SNAPBACK_EPHEMERAL_ROOM_TIMEOUT: ${label} exceeded 5000ms`);
            error.code = 'SNAPBACK_EPHEMERAL_ROOM_TIMEOUT';
            reject(error);
          }, 5_000);
        }),
      ]).finally(() => clearTimeout(timer));
    };
    const startGeneration = async (reason = null) => {
      if (disposed) return;
      const expectedGeneration = ++generation;
      clearExpiry();
      overlayOff?.();
      overlayOff = null;
      overlay?.dispose();
      overlay = null;
      publishSnapshot({
        status: reason === null ? 'pending' : 'resyncing',
        entries: [],
        selfKey: null,
        diagnostic: null,
        reason,
      }, expectedGeneration);
      try {
        const grant = await bounded(this.connectionGrant(connectionId), 'connection grant');
        if (grant.ephemeralExpiryProtocol !== 1) {
          const error = new Error(
            'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED: connection did not negotiate ephemeral expiry protocol 1',
          );
          error.code = 'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED';
          throw error;
        }
        await bounded(manager.waitUntilReady({ timeoutMs: 5_000 }), 'socket readiness');
        // A managed socket that live-query demand already opened emits no
        // further state transition, so a room that only tracked 'open' edges
        // would report 'connecting'/'stale' forever (0137 A2 f1). Readiness
        // was just proven for the current generation: adopt the level.
        // @ref LLP 0107#resync-authority-and-lifecycle — connection events
        // are level-triggered; an edge-only view of an already-open socket
        // is not an admissible readiness proof.
        if (manager.isOpen() && currentConnection !== 'live') {
          currentConnection = 'live';
          publishSnapshot({ connection: currentConnection }, expectedGeneration);
        }
        const next = await bounded(
          this.subscribeEphemeral(ref, { connectionId, scope }),
          'ephemeral subscribe',
        );
        adoptOverlay(next, expectedGeneration);
      } catch (error) {
        if (disposed || generation !== expectedGeneration) return;
        const unsupported = error?.code === 'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED';
        publishSnapshot({
          status: unsupported ? 'unsupported' : 'error',
          entries: [],
          selfKey: null,
          diagnostic: clientDiagnosticFromError(error),
          reason,
        }, expectedGeneration);
      }
    };
    managerOff = manager.onState((state, detail = {}) => {
      if (disposed) return;
      currentConnection = state === 'open'
        ? 'live'
        : state === 'connecting'
          ? 'connecting'
          : state === 'lost'
            ? 'stale'
            : state === 'closed'
              ? 'closed'
              : currentConnection;
      if (state === 'lost' && current.status === 'ready') {
        publishSnapshot({ status: 'stale', connection: currentConnection });
      } else {
        publishSnapshot({
          connection: currentConnection,
          // @ref LLP 0107#closed-presence-state — terminal room diagnostics
          // remain authoritative while later manager events may still update
          // connection state. Transport noise cannot replace the reason this
          // room generation closed.
          ...(detail.error
            && current.status !== 'ready'
            && current.status !== 'error'
            && current.status !== 'unsupported'
            ? { diagnostic: clientDiagnosticFromError(detail.error) }
            : {}),
        });
      }
      if (state === 'open' && (current.status === 'stale' || current.status === 'resyncing')) {
        void startGeneration('socket_reconnected');
      }
    });
    const startedPromise = startGeneration().then(() => {
      if (current.status === 'error' || current.status === 'unsupported') {
        const error = new Error(`${current.diagnostic.code}: ${current.diagnostic.message}`);
        error.code = current.diagnostic.code;
        error.diagnostic = current.diagnostic;
        throw error;
      }
    });
    const observedStart = startedPromise.catch(() => {});
    const handle = {
      subscribe(listener) {
        if (disposed) return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot() { return current; },
      getServerSnapshot() {
        return freezeEphemeralRoomSnapshot({
          status: 'pending',
          entries: [],
          selfKey: null,
          diagnostic: null,
          connection: 'idle',
          reason: null,
        });
      },
      get grantedConnectionId() { return overlay?.grantedConnectionId ?? null; },
      started() { return startedPromise; },
      publish(value, options = {}) {
        if (!overlay || current.status !== 'ready') {
          const error = new Error('SNAPBACK_REACT_PRESENCE_NOT_AUTHORITATIVE: room is not ready');
          error.code = 'SNAPBACK_REACT_PRESENCE_NOT_AUTHORITATIVE';
          return Promise.reject(error);
        }
        return bounded(overlay.publish(value, options), 'ephemeral publish');
      },
      delete(options = {}) {
        if (!overlay) return Promise.resolve();
        return bounded(overlay.delete(options), 'ephemeral delete');
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        generation += 1;
        clearExpiry();
        overlayOff?.();
        overlayOff = null;
        const retiringOverlay = overlay;
        overlay = null;
        retiringOverlay?.dispose();
        cleanup = bounded(
          Promise.resolve(
            thisClient.unsubscribeEphemeral(ref, { connectionId, scope }),
          ).catch(() => {}),
          'ephemeral unsubscribe',
        ).catch(() => {}).finally(() => {
          managerOff?.();
          managerOff = null;
          listeners.clear();
        });
      },
      async settled() {
        await observedStart;
        await cleanup;
      },
      inspection() {
        return Object.freeze({
          generation,
          disposed,
          listeners: listeners.size,
          expiryTimer: expiryTimer === null ? 0 : 1,
          subscription: overlay === null ? 0 : 1,
          grantedConnectionId: overlay?.grantedConnectionId ?? null,
          reason: current.reason,
        });
      },
    };
    const thisClient = this;
    return Object.freeze(handle);
  }

  registerEphemeralRepublisher(ref, callback) {
    const collection = collectionName(ref);
    if (typeof callback !== 'function') {
      throw new TypeError('registerEphemeralRepublisher requires a callback');
    }
    let registrations = this.__ephemeralRepublishers.get(collection);
    if (!registrations) {
      registrations = new Set();
      this.__ephemeralRepublishers.set(collection, registrations);
    }
    if (registrations.size >= 64) {
      const error = new Error('SNAPBACK_EPHEMERAL_REPUBLISHER_LIMIT: at most 64 registrations per collection');
      error.code = 'SNAPBACK_EPHEMERAL_REPUBLISHER_LIMIT';
      throw error;
    }
    const registration = { callback, disposed: false };
    registrations.add(registration);
    const dispose = () => {
      if (registration.disposed) return;
      registration.disposed = true;
      registrations.delete(registration);
      if (registrations.size === 0) this.__ephemeralRepublishers.delete(collection);
    };
    return Object.freeze({ dispose });
  }

  async #republishAfterAuthorityReplacement(collection, snapshot, overlay) {
    const message = unwrapEphemeralMessage(snapshot);
    const authority = snapshot?.ephemeralAuthorityInstance
      ?? snapshot?.ephemeral_authority_instance
      ?? message?.Snapshot?.ephemeralAuthorityInstance
      ?? message?.Snapshot?.ephemeral_authority_instance
      ?? null;
    if (typeof authority !== 'string' || authority.length === 0) return;
    const previous = this.__ephemeralAuthorityByCollection.get(collection);
    this.__ephemeralAuthorityByCollection.set(collection, authority);
    if (previous === undefined || previous === authority) return;
    const entries = message?.Snapshot?.entries;
    if (!Array.isArray(entries) || entries.length !== 0) return;
    const registrations = [...(this.__ephemeralRepublishers.get(collection) ?? [])];
    if (registrations.length === 0) return;
    const generation = ++this.__ephemeralRepublisherGeneration;
    for (const registration of registrations) {
      if (registration.disposed || generation !== this.__ephemeralRepublisherGeneration) return;
      let acknowledged = false;
      const publish = async (value, options = {}) => {
        if (registration.disposed || generation !== this.__ephemeralRepublisherGeneration) {
          const error = new Error('SNAPBACK_EPHEMERAL_REPUBLISHER_STALE: authority changed while republishing');
          error.code = 'SNAPBACK_EPHEMERAL_REPUBLISHER_STALE';
          throw error;
        }
        const outcome = await overlay.publish(value, options);
        acknowledged = outcome?.accepted !== false && outcome?.ok !== false;
        if (!acknowledged) {
          const error = new Error('SNAPBACK_EPHEMERAL_REPUBLISH_UNACKNOWLEDGED: successor publish was not accepted');
          error.code = 'SNAPBACK_EPHEMERAL_REPUBLISH_UNACKNOWLEDGED';
          throw error;
        }
        return outcome;
      };
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('SNAPBACK_EPHEMERAL_REPUBLISH_TIMEOUT: callback exceeded 5000ms');
          error.code = 'SNAPBACK_EPHEMERAL_REPUBLISH_TIMEOUT';
          reject(error);
        }, 5_000);
      });
      try {
        const result = await Promise.race([
          Promise.resolve(registration.callback(Object.freeze({
            collection,
            scope: deepFreezeEphemeralValue(structuredClone(overlay.scope)),
            publish,
          }))),
          timeout,
        ]);
        if (result !== undefined && !acknowledged) await publish(result);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async publishEphemeral(ref, { connectionId, scope = {}, value, ttlMs = null, userId, permissions = [], sessionId = null, ownerUserId = null, customKey = null } = {}) {
    const collection = collectionName(ref);
    scope = normalizeEphemeralScope(ref, scope);
    value = normalizeEphemeralValue(ref, value);
    const operationCapture = this.authorityFence?.capture?.() ?? null;
    try {
      const outcome = await this.#withGrant(connectionId, (grant) => this.#req('POST', '/ephemeral/publish', {
        collection,
        scope,
        connection_id: grant.id,
        session_id: sessionId,
        user_id: ownerUserId,
        custom_key: customKey,
        value: encodeEphemeralValue(value),
        ttl_ms: ttlMs,
        auth: SnapbackClient.auth(userId, { permissions }),
      }, connectionTokenHeader(grant)));
      // Ephemeral one-version story (LLP 0034 §3.1): snapshotVersion is the
      // entryVersion, valid WITHIN a scopeEpoch; the epoch rides in the
      // snapback-namespaced field. Privacy (§3.3): never the payload value.
      this.recordReceipt({
        kind: 'ephemeral-publish',
        collection,
        outcome: 'confirmed',
        snapshotVersion: outcome.entry_version,
        snapback: { scopeEpoch: outcome.scope_epoch, key: outcome.key },
        receivedAtMs: Date.now(),
      }, outcome?.[AUTHORITY_CAPTURE] ?? null);
      return outcome;
    } catch (error) {
      this.recordReceipt({
        kind: 'ephemeral-publish',
        collection,
        outcome: 'rejected',
        rollbackReason: error?.diagnostic?.code ?? 'SNAPBACK_EPHEMERAL_PUBLISH_FAILED',
        receivedAtMs: Date.now(),
      }, error?.[AUTHORITY_CAPTURE] ?? operationCapture);
      throw error;
    }
  }

  // ENG-22527 item 3 / SECURITY: stop observing a room (published entries
  // untouched). Carried over the shared live socket, NOT a public HTTP route:
  // the server binds the requester to this socket's connection
  // (SNAPBACK_WEBSOCKET_SENDER_MISMATCH otherwise), so a participant cannot
  // evict another connection's subscription by asserting its id. Best-effort —
  // if the socket is not open the registration is left to disconnect/reap, and
  // an unknown room/registration is a quiet no-op server-side (removed:false).
  async unsubscribeEphemeral(ref, { connectionId, scope = {}, userId, permissions = [] } = {}) {
    scope = normalizeEphemeralScope(ref, scope);
    // Teardown must observe an existing manager, never manufacture new socket
    // state after an explicit disconnect merely to discover that no socket is
    // available.
    const manager = this.__liveStreamManagers?.get(connectionId) ?? null;
    if (!manager?.isOpen()) {
      return { removed: false, skipped: 'socket-not-open' };
    }
    // The socket's path identity is the GRANTED id (the manager connected
    // with it), so the frame must carry the same — the server's sender gate
    // compares them. The grant is already resolved here (the manager is open).
    const grant = await this.connectionGrant(connectionId);
    const ack = await manager.request({
      type: 'ephemeral_unsubscribe',
      request: {
        collection: collectionName(ref),
        scope,
        connection_id: grant.id,
        auth: SnapbackClient.auth(userId, { permissions }),
      },
    });
    if (ack?.kind === LIVE_SOCKET_KINDS.EPHEMERAL_ERROR) {
      const diag = ack.diagnostic ?? { code: 'SNAPBACK_EPHEMERAL_UNSUBSCRIBE_FAILED', message: '' };
      const error = new Error(`${diag.code}: ${diag.message ?? ''}`);
      error.diagnostic = diag;
      throw error;
    }
    if (ack?.receipt) {
      this.recordReceipt(ack.receipt, ack?.[AUTHORITY_CAPTURE] ?? null);
    }
    return { removed: ack?.removed ?? false, receipt: ack?.receipt };
  }

  async deleteEphemeral(ref, {
    connectionId,
    scope = {},
    userId,
    permissions = [],
    sessionId = null,
    ownerUserId = null,
    customKey = null,
    expectedScopeEpoch = null,
    expectedEntryVersion = null,
    authorityCapture = null,
  } = {}) {
    scope = normalizeEphemeralScope(ref, scope);
    if ((expectedScopeEpoch === null) !== (expectedEntryVersion === null)) {
      throw snapbackDiagnosticError(
        'SNAPBACK_EPHEMERAL_WITHDRAWAL_FENCE_INVALID',
        'ephemeral withdrawal requires scopeEpoch and entryVersion together',
        {},
        { operation: 'ephemeral-delete', effectCommitted: false, effectMayHaveCommitted: false },
      );
    }
    if (expectedScopeEpoch !== null && (
      !Number.isSafeInteger(expectedScopeEpoch)
      || expectedScopeEpoch < 1
      || !Number.isSafeInteger(expectedEntryVersion)
      || expectedEntryVersion < 1
    )) {
      throw snapbackDiagnosticError(
        'SNAPBACK_EPHEMERAL_WITHDRAWAL_FENCE_INVALID',
        'ephemeral withdrawal fence values must be positive safe integers',
        {},
        { operation: 'ephemeral-delete', effectCommitted: false, effectMayHaveCommitted: false },
      );
    }
    const operationCapture = authorityCapture ?? this.authorityFence?.capture?.() ?? null;
    return this.#withGrant(connectionId, (grant) => this.#req('POST', '/ephemeral/delete', {
      collection: collectionName(ref),
      scope,
      connection_id: grant.id,
      session_id: sessionId,
      user_id: ownerUserId,
      custom_key: customKey,
      ...(expectedScopeEpoch === null ? {} : {
        expected_scope_epoch: expectedScopeEpoch,
        expected_entry_generation: expectedEntryVersion,
      }),
      auth: SnapbackClient.auth(userId, { permissions }),
    }, connectionTokenHeader(grant), {
      expectedAuthorityCapture: operationCapture,
    }));
  }

  // @ref LLP 0031#resolved-decisions — D2: connection teardown is system/control,
  //   moved under the gated /_snapback/api/* namespace.
  async disconnect(connectionId) {
    // Admin teardown addresses the WIRE id; do not open a grant just to tear
    // one down — an unopened label falls through verbatim.
    const cached = this.__connectionGrants.has(connectionId);
    const grant = cached ? await this.connectionGrant(connectionId) : null;
    try {
      return await this.#adminReq(
        'POST',
        `/_snapback/api/connections/${encodeURIComponent(grant?.id ?? connectionId)}/disconnect`,
      );
    } finally {
      const manager = this.__liveStreamManagers?.get(connectionId);
      manager?.close();
      this.__liveStreamManagers?.delete(connectionId);
      this.__connectionGrants.delete(connectionId);
      this.__laneConsumers.delete(connectionId);
    }
  }

  /**
   * Release a connection grant this client already owns without using the
   * AdminWrite disconnect route. A pending registered-bundle owner first
   * attaches through its one-use grant; closing that exact socket then invokes
   * the server's connection-owned teardown. The bounded pending-owner reaper
   * remains authoritative when attach cannot complete.
   *
   * @ref LLP 0112#authority-races-and-cleanup — ordinary client cleanup keeps
   * grant custody and never depends on admin authority.
   * @ref LLP 0031#resolved-decisions — raw-id disconnect remains system
   * control; this method can release only a grant already in this client.
   */
  async releaseConnection(connectionId, {
    attachDeadline = null,
    timeoutMs = 2_000,
    ifIdle = false,
  } = {}) {
    if (!this.__connectionGrants.has(connectionId)) {
      return { released: false, reason: 'not-owned' };
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new TypeError('releaseConnection timeoutMs must be a positive safe integer');
    }
    if (typeof ifIdle !== 'boolean') {
      throw new TypeError('releaseConnection ifIdle must be a boolean');
    }
    const existingManager = this.__liveStreamManagers?.get(connectionId) ?? null;
    if (
      ifIdle
      && (existingManager?.inspection?.().socketDemand ?? 0) > 0
    ) {
      return { released: false, reason: 'shared-demand' };
    }
    const remaining = Number.isSafeInteger(attachDeadline)
      ? Math.max(1, Math.min(timeoutMs, attachDeadline - Date.now()))
      : timeoutMs;
    const manager = this.liveStreamManager(connectionId, {
      freshnessBudgetMs: remaining,
    });
    let attached = false;
    try {
      await manager.waitUntilReady({ timeoutMs: remaining });
      attached = true;
    } catch {
      // Expiry, refusal, process death, and network loss are all covered by
      // the server's bounded pending-owner reaper. Cleanup remains best-effort.
    } finally {
      if (!ifIdle || (manager.inspection?.().socketDemand ?? 0) === 0) {
        manager.close();
        this.__liveStreamManagers?.delete(connectionId);
        this.__connectionGrants.delete(connectionId);
        this.__laneConsumers.delete(connectionId);
      }
    }
    if (ifIdle && (manager.inspection?.().socketDemand ?? 0) > 0) {
      return { released: false, attached, reason: 'shared-demand' };
    }
    return { released: true, attached };
  }

  async drainEnvelopes(connectionId) {
    return this.#withGrant(connectionId, (grant) => this.#req('GET', `/outbox/${grant.id}`, undefined, connectionTokenHeader(grant)));
  }

  // The shared drain choke point (LLP 0034 §10.1 residual / ENG-22478): a
  // connection's outbox is ONE queue carrying both lanes, so every drain
  // routes each envelope to the registered consumers of ITS lane instead of
  // destructively discarding the other lane's traffic. The sole cross-lane
  // control is a connection-wide clear-retained resync, which must blank both
  // stores. Returns the decoded durable updates and the raw ephemeral
  // envelopes of this drain, plus the structured diagnostics of any envelopes
  // that failed to decode.
  //
  // GET /outbox/:id is a LEASED-BATCH drain with an ownership-transfer cut
  // (LLP 0059): the server selects without removing, removes the batch only
  // once ownership transfer is accepted, and a drain cancelled before the
  // cut releases the batch for redelivery — so this client stays
  // duplicate-tolerant across cancelled drains. Once this response body has
  // arrived, the cut has happened and the batch will never be re-drained, so
  // nothing per-envelope may abort the loop (ENG-23391): each consumer
  // invocation is isolated (a throwing app callback must never discard the
  // envelopes behind it, including a resync_required sentinel — the
  // ENG-22478 fix-G principle applied to delivery), and a payload that
  // fails to decode is surfaced as a SNAPBACK_ENVELOPE_DECODE_FAILED
  // diagnostic in `decodeFailures` instead of an aborted batch. Because the
  // malformed durable item is already acknowledged and cannot be attributed
  // to one subscription, it also routes the same connection-wide
  // clear-retained resync sentinel as a socket durable_bytes frame; processing
  // then continues with the acknowledged batch remainder.
  //
  // @ref LLP 0059#durable-and-ephemeral-outboxes — leased selection,
  //   acknowledged removal at the ownership cut, redelivery on cancellation.
  // @ref LLP 0095#4.3 —
  //   post-cut poll decode loss forces the T-DB-P resync transition.
  async drainConnection(connectionId) {
    const envelopes = await this.drainEnvelopes(connectionId);
    const consumers = this.__laneConsumers.get(connectionId);
    const durable = [];
    const ephemeral = [];
    const decodeFailures = [];
    for (const env of envelopes) {
      if (!env) continue;
      const capture = env[AUTHORITY_CAPTURE] ?? null;
      const committed = await this.commitAuthorityPublication(capture, () => {
        if (env.Durable) {
          let update;
          try {
            update = JSON.parse(decodeDurablePayload(env.Durable.payload));
            markAuthorityCapture(update, capture);
          } catch (error) {
            decodeFailures.push({
              code: 'SNAPBACK_ENVELOPE_DECODE_FAILED',
              message: `durable envelope payload did not decode as JSON: ${error?.message ?? error}`,
            });
            const sentinel = markAuthorityCapture(durableBytesResyncSentinel(), capture);
            routeDurableLaneFrame(consumers, sentinel);
            return;
          }
          durable.push(update);
          routeDurableLaneFrame(consumers, update);
          return;
        }
        ephemeral.push(env);
        for (const consumer of [...(consumers?.ephemeral ?? [])]) deliverIsolated(consumer, env);
      });
      if (!committed.committed && this.authorityFence) {
        // The drain's ownership cut has already completed server-side, but
        // stale predecessor data must not become visible. The authority
        // barrier owns resubscription/recovery for the successor.
        continue;
      }
    }
    return { durable, ephemeral, decodeFailures };
  }

  // Drains a connection's outbox and decodes durable live-query updates.
  // Ephemeral envelopes in the same drain are ROUTED to registered ephemeral
  // consumers (e.g. an EphemeralOverlay on this connection), never discarded.
  async drainUpdates(connectionId) {
    return (await this.drainConnection(connectionId)).durable;
  }

  openLiveStream(connectionId, {
    setTimeout: scheduleTimeout = globalThis.setTimeout,
    clearTimeout: cancelTimeout = globalThis.clearTimeout,
  } = {}) {
    const queue = [];
    const waiters = [];
    let streamError = null;
    let wsRef = null;
    let authorityCapture = null;
    const removeWaiter = (waiter) => {
      const index = waiters.indexOf(waiter);
      if (index !== -1) waiters.splice(index, 1);
    };
    const waitForUpdate = (timeoutMs) => new Promise((resolve, reject) => {
      const waiter = {
        active: true,
        timer: null,
        resolve(value) {
          if (!waiter.active) return;
          waiter.active = false;
          cancelTimeout(waiter.timer);
          resolve(value);
        },
        reject(error) {
          if (!waiter.active) return;
          waiter.active = false;
          cancelTimeout(waiter.timer);
          reject(error);
        },
      };
      waiters.push(waiter);
      waiter.timer = scheduleTimeout(() => {
        if (!waiter.active) return;
        removeWaiter(waiter);
        waiter.reject(new Error(`timed out waiting for Snapback live stream update on ${connectionId}`));
      }, timeoutMs);
    });
    const fail = (error) => {
      streamError ??= error; // first failure wins; a later close never masks it
      while (waiters.length > 0) waiters.shift().reject(streamError);
    };
    // The grant resolves before the socket exists (ENG-23442): the upgrade
    // carries the connection token as a subprotocol, and the URL addresses
    // the granted wire id.
    const wsPromise = this.authSession({ force: true })
      .then((session) => {
        const unavailable = authAvailabilityError(session);
        if (unavailable) throw unavailable;
        authorityCapture = this.authorityFence?.capture?.() ?? null;
        return this.connectionGrant(connectionId);
      })
      .then(async (grant) => {
      authorityCapture = this.authorityFence?.capture?.()
        ?? grant?.[AUTHORITY_CAPTURE]
        ?? authorityCapture;
      const path = `/live/${grant.id}/stream`;
      const url = `${this.baseUrl.replace(/^http/, 'ws')}${path}`;
      let senderFlight = null;
      let senderFlightTimer = null;
      const releaseSenderFlight = () => {
        if (senderFlightTimer !== null) {
          cancelTimeout(senderFlightTimer);
          senderFlightTimer = null;
        }
        const releasing = senderFlight;
        senderFlight = null;
        if (releasing !== null) void releasing.release().catch(fail);
      };
      let offeredProtocols;
      try {
        if (this.senderConstrained) {
          senderFlight = await this.authCoordinator.beginSenderRequestSerialization(
            authorityCapture,
          );
          authorityCapture = senderFlight.capture;
        }
        offeredProtocols = await this.liveStreamProtocolsFor(
          grant,
          path,
          authorityCapture,
          senderFlight?.credential ?? null,
        );
      } catch (error) {
        releaseSenderFlight();
        throw error;
      }
      let ws;
      try {
        ws = new WebSocket(url, offeredProtocols);
      } catch (error) {
        releaseSenderFlight();
        throw error;
      }
      wsRef = ws;
      let senderSocketOpened = false;
      if (senderFlight !== null) {
        // Decision 5's observable machine: the first server frame carrying
        // the successor nonce is the release event. The single freshness
        // budget bounds both a dangling upgrade (never opened: the socket is
        // a loss) and an open-without-frame stall (the flight releases as
        // consumed-unknown while the healthy socket lives on; the next
        // protected request resynchronizes through the bounded challenge).
        senderFlightTimer = scheduleTimeout(() => {
          const opened = senderSocketOpened;
          releaseSenderFlight();
          if (!opened) {
            try { ws.close(); } catch { /* the failed constructor owns refusal */ }
            fail(new Error('Snapback sender-constrained live stream timed out before opening'));
          }
        }, LIVE_FRESHNESS_BUDGET_MS);
        senderFlightTimer.unref?.();
        ws.addEventListener('open', () => { senderSocketOpened = true; }, { once: true });
        ws.addEventListener('error', releaseSenderFlight, { once: true });
        ws.addEventListener('close', releaseSenderFlight, { once: true });
      }
      ws.addEventListener('message', async (event) => {
        try {
          const update = JSON.parse(
            await websocketText(event.data, this.ingressLimits.liveFrame),
          );
          if (update?.kind === LIVE_SOCKET_KINDS.SENDER_NONCE) {
            // Transport-internal: commit-and-release on the flight-holding
            // socket; swallow late or unexpected copies without ever
            // surfacing nonce material to the application.
            const flight = senderFlight;
            if (flight !== null) {
              const successor = await this.commitSenderSocketNonce(flight, update?.nonce);
              if (successor !== null) authorityCapture = successor;
              releaseSenderFlight();
            }
            return;
          }
          if (update?.kind === LIVE_SOCKET_KINDS.AUTH_ERROR) {
            const error = liveTerminalAuthError(update);
            fail(error);
            const closedByClient = this.handleTerminalAuthLoss(authorityCapture, error);
            if (
              error.terminalAuth
              && error.authorityDisposition === 'durableDelete'
              && authorityCapture
              && this.authCoordinator?.isCurrent?.(authorityCapture)
            ) {
              void this.authCoordinator.compareAndClear(authorityCapture, update.code).catch(() => {});
            }
            if (!closedByClient) {
              try { ws.close(4401, 'auth_error'); } catch { /* terminal latch already owns failure */ }
            }
            return;
          }
          const committed = await this.commitAuthorityPublication(authorityCapture, () => {
            markAuthorityCapture(update, authorityCapture);
            const waiter = waiters.shift();
            if (waiter) waiter.resolve(update);
            else queue.push(update);
          });
          if (!committed.committed) throw staleAuthorityError();
        } catch (error) {
          fail(error);
        }
      });
      ws.addEventListener('error', () => fail(new Error(`Snapback live stream failed: ${url}`)), { once: true });
      // @ref LLP 0032#confirmed-defect-register — S5.D7: latch unconditionally on
      //   close (not just when waiters are pending) so a later nextUpdate() rejects
      //   immediately instead of hanging until its timeout.
      ws.addEventListener('close', (event) => {
        if (event?.code === 4401 && event?.reason === 'auth_error') {
          const error = liveTerminalAuthCloseError();
          fail(error);
          this.handleTerminalAuthLoss(authorityCapture, error);
          if (
            error.authorityDisposition === 'durableDelete'
            && authorityCapture
            && this.authCoordinator?.isCurrent?.(authorityCapture)
          ) {
            void this.authCoordinator.compareAndClear(authorityCapture, error.code).catch(() => {});
          }
          return;
        }
        fail(new Error(`Snapback live stream closed: ${url}`));
      }, { once: true });
      return ws;
      });
    wsPromise.catch((error) => fail(error));

    const ready = wsPromise.then((ws) => new Promise((resolve, reject) => {
      if (ws.readyState === 1) return resolve(undefined); // already OPEN
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('Snapback live stream failed to open')), { once: true });
      ws.addEventListener('close', () => reject(new Error('Snapback live stream closed before opening')), { once: true });
    }));
    // `ready` is optional for callers that only consume nextUpdate(); keep its
    // rejection observable to awaiters without turning an ignored close into
    // a process-level unhandled rejection.
    ready.catch(() => {});

    const stream = {
      ready,
      close: () => {
        this.__rawLiveStreams.delete(stream);
        return wsPromise.then((ws) => ws.close(), () => {});
      },
      sendJson: (message) => {
        if (!wsRef) {
          throw clientCodedError(
            new Error('Snapback live stream is not open yet (await ready first)'),
            'SNAPBACK_LIVE_STREAM_NOT_READY',
          );
        }
        wsRef.send(JSON.stringify(message));
      },
      nextUpdate: (timeoutMs = 2_000) => {
        if (queue.length > 0) return Promise.resolve(queue.shift());
        if (streamError) return Promise.reject(streamError);
        return waitForUpdate(timeoutMs);
      },
    };
    this.__rawLiveStreams.add(stream);
    return stream;
  }

  // The shared managed live socket for one connection (LLP 0034 §2.1: a
  // connection opens at most one live socket; it carries durable deltas AND
  // ephemeral push). Created on first use; reference-counted by attached
  // consumers; reconnects with backoff while demand exists.
  liveStreamManager(connectionId, options = {}) {
    this.__liveStreamManagers ??= new Map();
    let manager = this.__liveStreamManagers.get(connectionId);
    if (!manager) {
      manager = new LiveStreamManager(this, connectionId, options, () => {
        this.__liveStreamManagers.delete(connectionId);
      });
      this.__liveStreamManagers.set(connectionId, manager);
    }
    return manager;
  }

  // @ref LLP 0114#closed-connection-and-cancellation-protocol — registries
  // receive a cancellation handle before asynchronous subscription admission.
  startLiveQuery(ref, options = {}) {
    let current = null;
    let disposed = false;
    let cleanup = Promise.resolve();
    const {
      supersedes = null,
      supersedesSubscriptionId = null,
      ...liveOptions
    } = options;
    const start = this.liveQuery(ref, {
      ...liveOptions,
      supersedesSubscriptionId:
        supersedes?.current?.subscriptionId ?? supersedesSubscriptionId,
    }).then(async (handle) => {
      current = handle;
      if (disposed) {
        try {
          handle.dispose();
        } finally {
          cleanup = Promise.resolve(handle.settled?.()).catch(() => {});
          await cleanup;
        }
      }
    });
    const observedStart = start.catch(() => {});
    return Object.freeze({
      get current() { return current; },
      started() { return start; },
      dispose() {
        if (disposed) return;
        disposed = true;
        if (current) {
          try {
            current.dispose();
          } finally {
            cleanup = Promise.resolve(current.settled?.()).catch(() => {});
          }
        }
      },
      async settled() {
        await observedStart;
        await cleanup;
      },
    });
  }

  // The "current value + subscription" seam as a live handle: holds the latest
  // rows, starting from the authoritative snapshot (snapshot-with-subscribe,
  // one operation — LLP 0034 §1 / Exact LLP 0284 §2.1 rule 1).
  //
  // transport:'poll' (default, pre-D1 behavior): the caller drains updates
  // manually via handle.poll(); nothing else runs.
  //
  // transport:'stream' (LLP 0034 D1): updates are pushed over the managed
  // shared live socket; on socket loss the handle falls back to draining the
  // HTTP outbox at `pollCadenceMs` (unless fallbackToPoll:false) while the
  // socket retries with backoff; reconnect always re-enters through a fresh
  // subscribe_live and emits a 'resubscribed' subscription event.
  async liveQuery(ref, {
    connectionId,
    args = {},
    userId,
    transport = 'poll',
    pollCadenceMs = DEFAULT_POLL_CADENCE_MS,
    fallbackToPoll = true,
    onUpdate = null,
    onConnectionChange = null,
    onSubscriptionEvent = null,
    onAuthorizationBoundary = null,
    onAuthorizationError = null,
    authorizationQueue = null,
    authorizationNamespace = null,
    authorityCapture: expectedAuthorityCapture = null,
    correlation = null,
    stream: streamOptions = {},
    ownerLabel = null,
    // Internal React/provider seam. Unlike public ownerLabel, this string is
    // framework-minted and may remain verbatim on gated local inspection.
    __frameworkOwnerLabel = null,
    // Channel B (LLP 0090 D3): per-subscription persist opt-out — the
    // client-option stand-in for the per-manifest-entry `persist: false`
    // until rollout cluster 0C carries it in the manifest.
    persistResume = true,
    // Channel A seam: an inlined/preloaded candidate ({ rows, resume }) to
    // arbitrate against the persisted entry per LLP 0090 D3.
    preloadedResume = null,
    // Channel C register-mode seam (LLP 0090 D4 rollout step 7): a
    // subscription this connection ALREADY owns from a register-mode bundle
    // (`{ subscriptionId, rows, version, resume, attachDeadline }` — see rqs-preload.mjs
    // createRqsRegisteredRegistry). The bundle response IS the LLP
    // 0053-mandated fresh snapshot taken at the registration cut, so the
    // handle adopts it as current state and opens NO fresh
    // snapshot-with-subscribe; the socket attach presents the bundle grant
    // (adopted by fetchBundle) and receives only deltas. Any later socket
    // loss or resync re-enters through the ordinary fresh subscribe,
    // superseding the adopted registration.
    registeredSubscription = null,
    // Provider-registry-only one-for-one predecessor handoff. Ordinary
    // callers leave this null.
    supersedesSubscriptionId = null,
    // First-party React owns the row-oriented external-store projection and
    // therefore consumes the transport carrier directly. This is deliberately
    // absent from the public declarations: typed headless callers receive the
    // authored single value promised by FunctionResult<Ref>.
    __internalRawResultCarrier = false,
  } = {}) {
    assertClientReferenceKind({
      reference: ref,
      acceptedKinds: ['Query', 'LiveQuery'],
      invokedVerb: 'liveQuery',
      diagnosticsChannel: this.__clientDiagnosticsChannel,
    });
    if (this.__externalBearerTransition) {
      await this.__externalBearerTransition;
    }
    if (registeredSubscription?.bootDelivery === 'read-only') {
      const error = new TypeError(
        'SNAPBACK_RQS_READ_ONLY_RESULT: a mixed read-only child is an ordinary one-shot result and cannot be adopted as a subscription',
      );
      error.code = 'SNAPBACK_RQS_READ_ONLY_RESULT';
      throw error;
    }
    if (
      registeredSubscription
      && Object.hasOwn(registeredSubscription, 'bootDelivery')
      && registeredSubscription.bootDelivery !== 'registered-live'
    ) {
      const error = new TypeError(
        'SNAPBACK_RQS_MIXED_GROUP_INVALID: registeredSubscription carries an unknown mixed delivery kind',
      );
      error.code = 'SNAPBACK_RQS_MIXED_GROUP_INVALID';
      throw error;
    }
    if (registeredSubscription && transport !== 'stream') {
      const error = new Error(
        "SNAPBACK_REGISTERED_SUBSCRIPTION_STREAM_REQUIRED: registered bundle adoption requires transport:'stream'",
      );
      error.code = 'SNAPBACK_REGISTERED_SUBSCRIPTION_STREAM_REQUIRED';
      throw error;
    }
    const name = functionName(ref);
    if (ownerLabel !== null && (typeof ownerLabel !== 'string' || ownerLabel.length === 0)) {
      throw new TypeError('liveQuery ownerLabel must be null or a non-empty string');
    }
    if (
      __frameworkOwnerLabel !== null
      && (typeof __frameworkOwnerLabel !== 'string' || __frameworkOwnerLabel.length === 0)
    ) {
      throw new TypeError('liveQuery __frameworkOwnerLabel must be null or a non-empty string');
    }
    if (ownerLabel !== null && __frameworkOwnerLabel !== null) {
      throw new TypeError('liveQuery owner labels must have exactly one provenance');
    }
    // Generated argument validation is a call-boundary refusal. Keep it ahead
    // of auth discovery, local-store preparation, and every establishment
    // transport so an offline caller never sees availability mask bad args.
    args = validateGeneratedArguments(ref, args, name);
    const client = this;
    authorizationQueue = this.#authorizationQueueAdapter(authorizationQueue);
    let activeRegistration = Object.freeze({
      registrationId: null,
      publishLiveAnswer: () => false,
      clearLiveAnswer: () => false,
      release: () => {},
    });
    const preparedMaterialization = await this.__prepareGeneratedMaterializationBridge(
      ref,
      args,
      userId,
      persistResume,
    );
    const legacySingleTableAdoption = persistResume === true
      && preparedMaterialization?.bridge?.retentionClass
        === 'rqs-authority-independent-snapshot-v1';
    // @ref LLP 0053#client-fences — every auth-scoped materialization owns a
    //   never-reused query identity and a synchronous publication fence.
    const authorizationProtocolEnabled = this.authProtocols.authInvalidation != null;
    const queryKey = retainedQueryKey(name, args);
    // Ordinary generated LiveQueries share the RQS carrier domain, but protected
    // bytes use their own namespace and prepare before subscribe_live.
    // @ref LLP 0043#jsreact-owned-carrier-composition-2026-08-10 — per-query lease admission
    const protectedLeaseEligible = ref?.retention === 'opaque-authorized-snapshot-v1';
    let preparedProtectedRetention = null;
    if (
      preparedMaterialization === null
      && !this.__externalBearerRetainedReadsFenced()
      && persistResume === true
      && authorizationNamespace === null
      && this.authProtocols.authInvalidation === 1
      && this.authProtocols.authorizedLease === 1
      && protectedLeaseEligible
      && this.rqsStoreInfo.durable === true
      && expectedGeneration(ref) !== null
    ) {
      try {
        preparedProtectedRetention = await this.__storeRuntimeInvoke(
          'prepareProtectedQueryRetention',
          { ref, args, name },
        );
      } catch {
        // A store/runtime refusal cannot make an online query unusable. It
        // leaves the handle honestly non-retainable and takes the volatile
        // namespace path below.
        preparedProtectedRetention = null;
      }
    }
    let queryNamespace = preparedMaterialization
      ? createLiveQueryNamespace({
          clientStoreId: preparedMaterialization.bridge.address[1],
          queryKey: preparedMaterialization.bridge.address[2],
          queryInstanceId: preparedMaterialization.record.queryInstanceId,
        })
      : preparedProtectedRetention
        ? createLiveQueryNamespace(preparedProtectedRetention.namespace)
      : authorizationProtocolEnabled
        ? authorizationNamespace === null
        ? createLiveQueryNamespace({
            clientStoreId: this.clientStoreId,
            queryKey,
            queryInstanceId: this.__liveQueryAllocator.allocate(),
          })
        : createLiveQueryNamespace(authorizationNamespace)
        : null;
    let authorizationFence = null;
    let authorizationFaulted = false;
    let authorizationTail = Promise.resolve();
    let authorizationTaskGeneration = 0;
    // Every app-visible async publication for this handle captures this
    // generation. A resync cut advances it synchronously, before any
    // replacement subscribe can yield, so already-queued predecessor work
    // cannot publish after the cut.
    let subscriptionPublicationGeneration = 0;
    const authorizationTaskErrorState = Symbol('snapback.authorizationTaskErrorState');
    const authorizationResolutionTasks = new Map();
    // A resolution token proves one exact obligation/ticket/snapshot frame.
    // Keep successful identities for the active subscription scope so delayed
    // exact redelivery can re-ACK without reapplying, while any token or
    // scope/revision reuse with changed fields is diagnosed fail-closed.
    const appliedAuthorizationResolutionsByToken = new Map();
    const appliedAuthorizationResolutionsByScope = new Map();

    let connection = 'connecting';
    let disposed = false;
    let disposing = false;
    let paused = false;
    let resubscribing = false;
    let fallbackTimer = null;
    let detachStream = null;
    let streamedSinceSubscribe = false;
    // True while the HTTP drain fallback owns delivery (socket down).
    let fellBack = false;
    // True when the server has (or may have) dropped this connection's durable
    // subscriptions and a fresh snapshot-with-subscribe has not landed yet.
    // ANY socket death can trigger the server-side disconnect that drops
    // them: live_stream registers on upgrade completion, before any frame,
    // so even a socket that never fired client 'open' may have reached the
    // server (ENG-23428).
    let needsResubscribe = false;
    // Bumped on every socket loss; a subscribe that was in flight across a
    // loss must not clear needsResubscribe (the dying socket's server-side
    // disconnect may have destroyed the subscription it just created).
    let socketLossEpoch = 0;
    // Bumped when a resubscribe demand arrives while another resubscribe is
    // already in flight (ENG-23429). The server's overflow sentinel is
    // one-shot per episode (src/ephemeral.rs OutboundQueue::overflow —
    // pushes are dropped while overflowed and the flag resets only on
    // drain), so a resync_required consumed mid-resubscribe is the ONLY
    // signal for the deltas dropped after the in-flight snapshot was taken.
    // A subscribe that was in flight when the demand landed must not clear
    // needsResubscribe, and the in-flight resubscribe loops for another
    // fresh subscribe once it resolves.
    let resubscribeDemandEpoch = 0;
    let pendingResubscribeReason = 'reconnect';
    let resubscribeRetryTimer = null;
    let resubscribeAttempts = 0;
    // The 'established' receipt is emitted once, AFTER the transport settles
    // (ENG-22478 review fix E): a stream binding whose subscribe POST beats
    // the socket open must not claim transport 'poll' on its receipt.
    let establishedEmitted = false;
    let establishTimer = null;
    // @ref LLP 0034#108-hosted-stream-establishment-reconciles-through-current-socket-readiness-2026-07-12
    //   — lifecycle-cancelable readiness and serialized supersession are one
    //   safety contract around the only permitted hosted subscribe replays.
    // Every pause/resume/dispose boundary invalidates older subscribe work.
    // The signal cancels only this handle's readiness wrapper; the manager's
    // shared ping/pong remains available to other handles on the connection.
    let subscribeLifecycleEpoch = 0;
    let subscribeLifecycleController = new AbortController();
    // All snapshot-with-subscribe attempts for one handle are serialized.
    // Resume, reconnect, resync, and fallback paths must capture `supersedes`
    // only after the prior path has committed its subscription id.
    let freshSubscribeTail = Promise.resolve();
    let freshSubscribePending = 0;
    // The server may emit CurrentAsOf/replay on the already-open socket before
    // the subscribe POST returns the new id. Only one fresh subscribe runs at a
    // time for this handle, so one attempt-scoped buffer covers the ordering
    // boundary without weakening subscription-id isolation.
    let preSubscribeDurableAttempt = null;
    // Unlike the pre-response durable buffer, this marker spans the complete
    // exclusive attempt through asynchronous snapshot/authority installation.
    // An unscoped resync uses it to give that attempt sole replacement ownership.
    let exclusiveSubscribeAttempt = null;
    // An installing subscription can itself be retired before its POST
    // response publishes. It remains useful only as the supersedes witness
    // for the next serialized attempt.
    let pendingSupersedesSubscriptionId = null;
    let handleAuthorityCapture = null;
    const freshSubscribeQueueGenerations = new WeakMap();
    let pauseReleasePromise = Promise.resolve();
    let initialSupersedes = supersedesSubscriptionId;
    let cleanupTail = Promise.resolve();
    let currentSubscriptionId = null;
    let knownRetiredSubscriptionId = null;
    // A same-mode watch reload keeps the stream carrier but retires each
    // durable subscription. Preserve the predecessor id solely for the
    // supersedes request; it is synchronously ineligible for delivery after
    // the first scoped resync sentinel.
    let resyncFencedSubscriptionId = null;
    let disposalTask = null;
    let ownerInspectionToken = null;
    let unregisterOutboxBarrierProvider = () => {};
    // Cardinality alone cannot distinguish a lifecycle blank from a malformed
    // server snapshot. Keep provenance on the exact client-created carriers so
    // wrapped callbacks preserve it without tagging server-owned row arrays.
    const clientOwnedLifecycleBlankCarriers = new WeakSet();
    const createClientOwnedLifecycleBlankCarrier = () => {
      const rows = [];
      clientOwnedLifecycleBlankCarriers.add(rows);
      return rows;
    };
    let authoritativeRows = createClientOwnedLifecycleBlankCarrier();
    let presentedRows = authoritativeRows;
    let optimisticPresentationSnapshot = null;
    let authoritativeAnswerClass = 'unknown';

    const projectRowsForConsumer = (rows) => (
      __internalRawResultCarrier
        ? rows
        : projectTypedLiveQueryRows(ref, rows, {
            clientOwnedLifecycleBlank: clientOwnedLifecycleBlankCarriers.has(rows),
          })
    );
    const handle = {
      get subscriptionId() {
        return currentSubscriptionId;
      },
      version: 0,
      // Ruling-6 delivery facts advance only on authoritative publication;
      // retained seeds and authority blanking never impersonate delivery.
      // @ref LLP 0059#dated-amendment-total-client-authority-transition-state-and-settlement-matrix-2026-08-21-llp-0295-d02 — delivery time and authoritative revision are distinct public subscription facts.
      lastDeliveryAtMs: null,
      authoritativeRevision: 0,
      deliveryLagMs: null,
      suppressedEqualSnapshots: 0,
      terminalDiagnosticCode: null,
      __coveredMutationCostObservationSequences: new Set(),
      get inspectionSubscriptionId() {
        return currentSubscriptionId
          ?? pendingSupersedesSubscriptionId
          ?? resyncFencedSubscriptionId
          ?? knownRetiredSubscriptionId;
      },
      get inspectionSupersedesSubscriptionId() {
        return pendingSupersedesSubscriptionId
          ?? resyncFencedSubscriptionId
          ?? initialSupersedes
          ?? null;
      },
      get inspectionSubscriptionState() {
        if (disposed) return 'RELEASED';
        if (authorizationFaulted) return 'RESYNC_PENDING';
        if (needsResubscribe) return connection === 'stale' ? 'DROPPED' : 'RESYNC_PENDING';
        if (currentSubscriptionId === null) return 'PENDING';
        return 'LIVE';
      },
      get inspectionConnectionState() {
        if (disposed) return 'CLOSED';
        if (this.terminalDiagnosticCode !== null) return 'TERMINAL_AUTH';
        if (connection === 'live') return 'ATTACHED_LIVE';
        if (connection === 'polling') return 'ATTACHED_POLL';
        if (connection === 'stale') return 'RECOVERING';
        if (connection === 'connecting') return 'GRANTED';
        return 'IDLE';
      },
      get rows() {
        return projectRowsForConsumer(presentedRows);
      },
      set rows(rows) {
        authoritativeRows = __internalRawResultCarrier
          ? (Array.isArray(rows) ? rows : [])
          : typedQueryCarrierRows(ref, rows);
        presentedRows = authoritativeRows;
      },
      get authoritativeRows() {
        return projectRowsForConsumer(authoritativeRows);
      },
      get optimisticPresentation() {
        if (optimisticPresentationSnapshot === null) {
          return Object.freeze({
            status: 'none',
            materializationIdentity: null,
            revision: 0,
            layers: Object.freeze([]),
            queuedOnly: Object.freeze([]),
          });
        }
        const layers = optimisticPresentationSnapshot.layers;
        const queuedOnly = optimisticPresentationSnapshot.queuedOnly;
        return Object.freeze({
          status: layers.length > 0
            ? 'predicted'
            : queuedOnly.length > 0 ? 'pending-without-prediction' : 'none',
          materializationIdentity:
            automaticOptimisticView?.materializationIdentity ?? null,
          revision: optimisticPresentationSnapshot.revision,
          layers,
          queuedOnly,
        });
      },
      // Latest RQS resume object ({ token, meta }) for this subscription.
      // Adopted from subscribe outputs and refreshed envelopes per the LLP
      // 0091 §0B.3 transition table; cleared on digest mismatch. (Named
      // rqsResume because handle.resume is the pause/resume lifecycle
      // method — step 1 stored this under handle.resume, where the method
      // assignment clobbered it before the first subscribe ever read it.)
      rqsResume: null,
      // Channel B freshness state (LLP 0090 D1): rows delivered from
      // persistence/preload surface 'retained' until the first authoritative
      // answer (CurrentAsOf, replay completion, or fresh LiveReplace) makes
      // them 'current'; null while nothing authoritative-or-retained is held.
      freshness: null,
      // @ref LLP 0166#d4--completeness-honest-local-answers — legacy resume remains
      // labeled-retained until an authoritative wire answer arrives.
      get answerClass() {
        const status = this.optimisticPresentation.status;
        return status === 'predicted'
          ? 'optimistic'
          : status === 'pending-without-prediction'
            ? 'pending-without-prediction'
            : authoritativeAnswerClass;
      },
      set answerClass(value) {
        authoritativeAnswerClass = value;
      },
      get authoritativeAnswerClass() {
        return authoritativeAnswerClass;
      },
      // Retainability fact (LLP 0129 Phase 0 / LLP 0053's retainability
      // invariant): null until the first subscribe response classifies this
      // subscription; then a frozen {retainable, code, reason, store}
      // record. Refuse-with-clarity — a non-retainable subscription names
      // WHY it will never render cold instead of silently acting online.
      retention: null,
      // Explicit pending-intent fact (LLP 0090 D3 dated note, 2026-08-01):
      // when a relaunch seeds retained rows while the durable outbox holds
      // queued intent, this records how many intents were pending at seed
      // time — the retained rows are PRE-intent and the UI must say so.
      // 0 whenever the seed ran with an empty outbox (or never ran). The
      // live queue state is client.outboxStatus(), not this boot-scoped fact.
      pendingIntentsAtSeed: 0,
      authorizationDisposition: 'retain',
      // Renderable denial fact (0137 A1-Expo f4): when a fresh subscribe is
      // ANSWERED with an authorization refusal (e.g. after a bearer custody
      // transition to a lesser-privileged successor), the frozen
      // { code, message, atMs } lands here instead of hiding inside a
      // rejected transition. Cleared by the next successful fresh subscribe
      // and by the custody blank barrier.
      authorizationDenial: null,
      get connection() {
        return connection;
      },
      get paused() {
        return paused;
      },
      get authorizationNamespace() {
        return queryNamespace;
      },
      authorizationState() {
        return authorizationFence?.snapshot?.() ?? null;
      },
    };

    const setHandleFreshness = (next) => {
      const previous = handle.freshness;
      handle.freshness = next;
      if (next === 'current' && previous !== 'current') {
        // A retained/stale handle may become authoritative long after
        // liveQuery() returned. The freshness transition, rather than only
        // initial establishment, owns target-capability discovery.
        void client.#observeOfflineMutationReplayCapabilityFromLifecycle().catch(() => {});
      }
    };

    const applicationOnUpdate = onUpdate;
    const optimisticCoverage = preparedMaterialization?.bridge?.localReadCoverage
      ?? ref?.localReadCoverage
      ?? null;
    // The rebase engine folds table writes, so a query result is a compatible
    // materialization only when owner IR proves it is the complete table. A
    // filtered/limited result needs the later query-projection evaluator;
    // treating a generated insert as a member here would fabricate a row.
    // @ref LLP 0270#d3-derive-and-attach-optimistic-presentation-by-default
    //   — attach generated effects only to compatible local materializations.
    const optimisticTable = typeof optimisticCoverage?.table === 'string'
      && optimisticCoverage.table.length > 0
      ? optimisticCoverage.table
      : generatedQueryProjectionTable(ref);
    const optimisticProjectionMode = optimisticCoverage?.absence === 'table-complete'
      ? 'project'
      : 'pending-only';
    const optimisticMaterializationIdentity = preparedMaterialization === null
      || optimisticTable === null
      ? null
      : Object.freeze({
          address: Object.freeze([...preparedMaterialization.bridge.address]),
          materializationKey: preparedMaterialization.bridge.address[2],
          planHash: preparedMaterialization.bridge.identities.planHash,
          resultContractHash: preparedMaterialization.bridge.resultContractHash,
          authorityPartitionDigest: preparedMaterialization.bridge.authorityPartitionDigest,
          queryInstanceId: preparedMaterialization.record.queryInstanceId,
        });
    let automaticOptimisticView = null;
    let automaticOptimisticViewOpening = null;
    let automaticOptimisticViewUnsubscribe = null;
    let automaticOptimisticViewGeneration = 0;
    let optimisticPresentationTail = Promise.resolve();
    let suppressOptimisticViewNotification = false;
    let authoritativeDeliveryRevision = 0;
    const bridgingFirstSeenAtRevision = new Map();
    // ACK GC may remove the durable settlement before this query observes the
    // canonical write. Retain only this handle's already-admitted matcher
    // evidence so the private bridge remains both visible and retireable.
    const bridgingSettlementEvidence = new Map();
    let lastAuthoritativeDetail = null;

    // Authority fencing annotates each delivered row with a non-enumerable
    // symbol. Keep that metadata on the live handle, but never feed it into
    // the optimistic engine's CanonicalClientValueV1 boundary: the engine
    // consumes the public row projection, not transport-private custody.
    // This is required for public rows too when the client advertises auth
    // invalidation v1, because their request/response still carries an
    // authority capture even though no authorization scope is installed.
    // @ref LLP 0053#client-fences — capture metadata fences publication; it
    //   is not part of an authority-independent query's canonical answer.
    const optimisticAuthoritativeRows = () => authoritativeRows.map((row) => (
      row !== null && typeof row === 'object' && !Array.isArray(row)
        ? { ...row }
        : row
    ));

    const closeAutomaticOptimisticView = () => {
      automaticOptimisticViewGeneration += 1;
      automaticOptimisticViewUnsubscribe?.();
      automaticOptimisticViewUnsubscribe = null;
      automaticOptimisticView?.close();
      automaticOptimisticView = null;
      automaticOptimisticViewOpening = null;
      optimisticPresentationSnapshot = null;
      bridgingFirstSeenAtRevision.clear();
      bridgingSettlementEvidence.clear();
    };

    const publishOptimisticPresentation = (detail) => {
      const snapshot = automaticOptimisticView?.getSnapshot() ?? null;
      optimisticPresentationSnapshot = snapshot;
      presentedRows = optimisticTable === null || optimisticProjectionMode === 'pending-only'
        ? authoritativeRows
        : snapshot?.visibleRows?.[optimisticTable] ?? authoritativeRows;
      if (typeof applicationOnUpdate !== 'function') return;
      const nextDetail = {
        ...(detail ?? {}),
        freshness: detail?.freshness ?? handle.freshness,
        answerClass: handle.answerClass,
        authoritativeRows,
        optimisticPresentation: handle.optimisticPresentation,
      };
      deliverIsolated(applicationOnUpdate, projectRowsForConsumer(presentedRows), nextDetail);
    };

    const captureOptimisticPublicationFence = () => Object.freeze({
      viewGeneration: automaticOptimisticViewGeneration,
      subscriptionPublicationGeneration,
      authorizationFence,
      authorizationCapture: authorizationFence?.capture() ?? null,
      authorityCapture: handleAuthorityCapture,
    });

    const publishOptimisticPresentationIfCurrent = async (publicationFence, detail) => {
      const published = await client.commitAuthorityPublication(
        publicationFence.authorityCapture,
        () => {
          // @ref LLP 0053#client-fences — an async optimistic reconciliation
          //   may publish only under the exact query and authority generations
          //   it captured before awaiting its rebase.
          if (
            disposed
            || automaticOptimisticViewGeneration !== publicationFence.viewGeneration
            || subscriptionPublicationGeneration
              !== publicationFence.subscriptionPublicationGeneration
            || authorizationFence !== publicationFence.authorizationFence
            || (
              publicationFence.authorizationFence !== null
              && !publicationFence.authorizationFence.isRenderable(
                publicationFence.authorizationCapture,
              )
            )
          ) return false;
          publishOptimisticPresentation(detail);
          return true;
        },
      );
      return published.committed && published.value === true;
    };

    const settlementWriteReflection = (layer, record, settlement) => {
      if (record === null || record === undefined) return null;
      const { replacements, unresolved } = settlementIdResolution(record, settlement);
      const claimed = (record.settlementClaims?.mints ?? [])
        .map((mint) => mint?.claimed)
        .filter((id) => typeof id === 'string');
      if (unresolved.size > 0 || replacements.size !== new Set(claimed).size) return null;
      const remap = (id) => replacements.get(id) ?? id;
      const same = (left, right) => stableJson(left) === stableJson(right);
      const remappedLayer = rewriteOptimisticLayerIdsV1(layer?.layer, {
        operation: record.optimisticOperation,
        argsContract: record.argsContract,
        replacements,
      });
      const allWrites = remappedLayer?.writes ?? [];
      if (!Array.isArray(allWrites) || allWrites.length === 0) return null;
      // This handle can prove reflection only for its observed table. Writes to
      // other tables are covered by the successful settlement plus the full
      // logical-mint map above; requiring their rows here makes every valid
      // multi-table plan immortal on a single-table materialization.
      const writes = allWrites.filter((write) => write?.table === optimisticTable);
      if (writes.length === 0) return null;
      const effects = new Map();
      for (const write of writes) {
        if (typeof write.id !== 'string') return null;
        const authoritativeId = remap(write.id);
        if (write.operation === 'delete') {
          effects.set(authoritativeId, null);
          continue;
        }
        const values = write.operation === 'insert' ? write.row : write.values;
        if (values === null || typeof values !== 'object' || Array.isArray(values)) return null;
        const prior = effects.get(authoritativeId);
        effects.set(authoritativeId, {
          ...(prior && typeof prior === 'object' ? prior : {}),
          ...values,
          _id: authoritativeId,
        });
      }
      const reflected = [...effects].every(([authoritativeId, expected]) => {
        const row = authoritativeRows.find((candidate) => candidate?._id === authoritativeId);
        if (expected === null) return row === undefined;
        if (row === undefined) return false;
        return Object.entries(expected).every(([field, value]) => (
          Object.hasOwn(row, field) && same(row[field], value)
        ));
      });
      return reflected ? replacements : null;
    };

    const settlementRetirements = async (snapshot, { authoritativeDelivery }) => {
      const retired = [];
      const idReplacements = new Map();
      for (const layer of snapshot?.layers ?? []) {
        if (layer.layerStatus !== 'bridging') continue;
        const identity = layer.clientMutationId;
        const disposition = await client.__optimisticMutationDisposition(identity);
        if (disposition.status === 'settled') {
          bridgingSettlementEvidence.set(identity, Object.freeze({
            record: disposition.record,
            settlement: disposition.settlement,
          }));
        }
        const evidence = bridgingSettlementEvidence.get(identity) ?? null;
        if (evidence === null) continue;
        const firstSeen = bridgingFirstSeenAtRevision.get(identity);
        if (firstSeen === undefined) {
          bridgingFirstSeenAtRevision.set(identity, authoritativeDeliveryRevision);
        }
        if (!authoritativeDelivery) continue;
        const settlement = evidence.settlement ?? {};
        const settlementVersion = Number.isSafeInteger(settlement.version)
          ? settlement.version
          : Number.isSafeInteger(settlement.receipt?.snapshotVersion)
            ? settlement.receipt.snapshotVersion
            : null;
        const deliveryEligible = settlementVersion !== null
          ? handle.version >= settlementVersion
          : firstSeen !== undefined && authoritativeDeliveryRevision > firstSeen;
        const replacements = deliveryEligible
          ? settlementWriteReflection(layer, evidence.record, settlement)
          : null;
        if (replacements !== null) {
          retired.push(identity);
          for (const [speculative, authoritative] of replacements) {
            idReplacements.set(speculative, authoritative);
          }
        }
      }
      return { retired, idReplacements: Object.fromEntries(idReplacements) };
    };

    const reconcileAutomaticOptimisticView = async (cause, detail, {
      authoritativeDelivery = false,
    } = {}) => {
      const view = automaticOptimisticView;
      const publicationFence = captureOptimisticPublicationFence();
      if (view === null || disposed) {
        presentedRows = authoritativeRows;
        await publishOptimisticPresentationIfCurrent(publicationFence, detail);
        return;
      }
      if (authoritativeDelivery) authoritativeDeliveryRevision += 1;
      const snapshot = view.getSnapshot();
      const retirements = await settlementRetirements(snapshot, {
        authoritativeDelivery,
      });
      suppressOptimisticViewNotification = true;
      try {
        await view.rebase({
          authoritativeRows: { [optimisticTable]: optimisticAuthoritativeRows() },
          retiredSettlementIdentities: retirements.retired,
          settlementIdReplacements: retirements.idReplacements,
          connected: connection === 'live' || connection === 'polling',
          cause,
        });
      } finally {
        suppressOptimisticViewNotification = false;
      }
      for (const identity of retirements.retired) {
        bridgingFirstSeenAtRevision.delete(identity);
        bridgingSettlementEvidence.delete(identity);
      }
      await publishOptimisticPresentationIfCurrent(publicationFence, detail);
    };

    const ensureAutomaticOptimisticView = async () => {
      if (automaticOptimisticView !== null) return automaticOptimisticView;
      if (automaticOptimisticViewOpening !== null) return automaticOptimisticViewOpening;
      if (optimisticTable === null || disposed) return null;
      const openingGeneration = automaticOptimisticViewGeneration;
      const opening = client
        .__createGeneratedOptimisticMaterializationView({
          authoritativeRows: { [optimisticTable]: optimisticAuthoritativeRows() },
          connected: connection === 'live' || connection === 'polling',
          materializationIdentity: optimisticMaterializationIdentity,
          table: optimisticTable,
          projectionMode: optimisticProjectionMode,
        })
        .then((view) => {
          if (disposed || automaticOptimisticViewGeneration !== openingGeneration) {
            view?.close();
            return null;
          }
          automaticOptimisticView = view;
          if (view !== null) {
            automaticOptimisticViewUnsubscribe = view.subscribe(() => {
              if (suppressOptimisticViewNotification || disposed) return;
              optimisticPresentationTail = optimisticPresentationTail
                .then(() => reconcileAutomaticOptimisticView(
                  'generated-ir-presentation-transition',
                  {
                    ...(lastAuthoritativeDetail ?? {}),
                    kind: 'optimistic_projection',
                  },
                ))
                .catch(() => {});
            });
          }
          return view;
        })
        .finally(() => {
          if (automaticOptimisticViewOpening === opening) {
            automaticOptimisticViewOpening = null;
          }
        });
      automaticOptimisticViewOpening = opening;
      return automaticOptimisticViewOpening;
    };

    onUpdate = (rows, detail = {}) => {
      const authorizationBoundary = detail?.kind === 'authorization_delete'
        || detail?.kind === 'authorization_denied'
        || detail?.kind === 'authorization_quarantine'
        || detail?.kind === 'authorization_error';
      if (!authorizationBoundary && detail?.freshness !== 'retained') {
        const deliveredAtMs = Date.now();
        const deliveredVersion = Number.isSafeInteger(detail?.version)
          ? detail.version
          : Number.isSafeInteger(handle.version) ? handle.version : null;
        handle.lastDeliveryAtMs = deliveredAtMs;
        if (deliveredVersion !== null) handle.authoritativeRevision = deliveredVersion;
        client.#observeCoveringLiveDelivery(handle, deliveredVersion, deliveredAtMs);
      }
      authoritativeRows = Array.isArray(rows) ? rows : [];
      // Preserve the synchronous liveQuery handle contract: canonical
      // delivery is readable immediately, while the serialized projection
      // pass may replace it with rebased rows before notifying the adapter.
      presentedRows = authoritativeRows;
      lastAuthoritativeDetail = detail;
      if (authorizationBoundary) {
        closeAutomaticOptimisticView();
        presentedRows = authoritativeRows;
        publishOptimisticPresentation(detail);
        return;
      }
      optimisticPresentationTail = optimisticPresentationTail.then(async () => {
        const fallbackPublicationFence = captureOptimisticPublicationFence();
        try {
          await ensureAutomaticOptimisticView();
          await reconcileAutomaticOptimisticView(
            'authoritative-delivery',
            detail,
            { authoritativeDelivery: detail?.freshness !== 'retained' },
          );
        } catch {
          presentedRows = authoritativeRows;
          await publishOptimisticPresentationIfCurrent(fallbackPublicationFence, detail);
        }
      }).catch(() => {
        // Authority publication refusal and adapter failures are fail-closed.
      });
    };

    // Move-3 admission reads the active registration's exact current row set,
    // never an unproved rewrite of the durable materialization. The ledger
    // owns the volatile sidecar so release/authority/transport transitions
    // synchronously revoke it before a later mutation can admit stale rows.
    //
    // @ref LLP 0155#local-read-admission — demanded current live rows are the
    //   admitted materialization while their registration remains active.
    // @ref LLP 0166#d4--completeness-honest-local-answers — live delivery
    //   authority does not mint or update a durable completeness proof.
    const syncLiveRegistrationAnswer = () => {
      const current = !disposed
        && !paused
        && !authorizationFaulted
        && !needsResubscribe
        && handle.authorizationDisposition === 'retain'
        && authoritativeAnswerClass === 'authoritative'
        && handle.freshness === 'current'
        && currentSubscriptionId !== null
        && (connection === 'live' || connection === 'polling');
      if (!current) {
        activeRegistration.clearLiveAnswer();
        return;
      }
      try {
        activeRegistration.publishLiveAnswer({
          rows: authoritativeRows,
          version: handle.version,
          subscriptionId: currentSubscriptionId,
        });
      } catch {
        // A malformed current row set remains visible only to the existing
        // live handle contract; it cannot become mutation input.
        activeRegistration.clearLiveAnswer();
      }
    };
    const markKnownSubscriptionRetired = (subscriptionId) => {
      if (
        typeof subscriptionId === 'string'
        && subscriptionId.length > 0
        && currentSubscriptionId === subscriptionId
      ) {
        knownRetiredSubscriptionId = subscriptionId;
      }
    };
    const isKnownSubscriptionRetired = (subscriptionId) => (
      typeof subscriptionId === 'string'
      && subscriptionId === knownRetiredSubscriptionId
    );
    const alreadyRetiredResponse = (subscriptionId) => ({
      subscription_id: subscriptionId,
      disposed: false,
      alreadyRetired: true,
      retirementCode: 'SNAPBACK_LIVE_SUBSCRIPTION_ALREADY_RETIRED',
    });
    const terminalQueryDeleted = () => (
      authorizationFence?.snapshot?.().terminalDeleted === true
    );
    const reportTerminalReuse = (kind) => {
      const error = new Error(
        `SNAPBACK_AUTH_QUERY_FENCE_STALE: ${kind} cannot reuse a terminally deleted query instance`,
      );
      error.code = 'SNAPBACK_AUTH_QUERY_FENCE_STALE';
      error.diagnostic = {
        code: error.code,
        message: `${kind} cannot reuse a terminally deleted query instance`,
      };
      reportAuthorizationError(error);
    };

    const deliverAuthorityObservation = (effect, capture = handleAuthorityCapture) => {
      if (!client.authorityFence) {
        effect();
        return;
      }
      void client.commitAuthorityPublication(capture, effect).catch(() => {});
    };

    // -----------------------------------------------------------------
    // Channel B persisted resume state (LLP 0090 D3, LLP 0091 §0A.5/§0B.3,
    // rollout step 5). Store-agnostic: the web/IndexedDB arm injects
    // rqs-store.mjs, the native/DK-9 arm rqs-store-file.mjs; cadence and
    // budget are the same on both (LLP 0091 step-5 native amendment), with
    // the pagehide/visibility flush below mapped on native to the host
    // lifecycle calling handle.flushResumeState() on background/inactive.
    // -----------------------------------------------------------------
    const resumeStore = persistResume
      && !client.__externalBearerRetainedReadsFenced()
      && (preparedMaterialization === null || legacySingleTableAdoption)
      ? client.rqsStore
      : null;
    const resumeStoreKey = resumeStore ? rqsEntryKey(name, args) : null;
    let persistTimer = null;
    let persistFirstDirtyAt = null;
    // Store writes are serialized so an in-progress marker can never land
    // after the commit that should clear it.
    let persistChain = Promise.resolve();
    // True between a subscribe seeded from PERSISTED state and the rung-1
    // CurrentAsOf that confirms it — the "last successful authoritative
    // resume" recency bookkeeping (LLP 0091 §0A.5 eviction rule).
    let pendingResumeConfirmation = false;
    let seededFromResumeState = false;
    // True once any retained seed frame reached onUpdate. An
    // establishment that lands AFTER that frame must re-deliver the
    // authoritative rows through onUpdate: frame-driven consumers (the React
    // binding) otherwise keep rendering the retained seed while the handle
    // is already current (found by the 2026-08-07 browser-carrier public
    // witness: warm online reload over a retained IndexedDB entry).
    let seedFrameDelivered = false;
    let seededFromMaterialization = false;
    let seededFromProtectedRetention = false;
    let legacyAdoptionCandidate = null;

    const chainStoreWrite = (write) => {
      if (!resumeStore || !resumeStoreKey) return Promise.resolve();
      persistChain = persistChain.then(write).catch(() => {});
      return persistChain;
    };

    const removePersistedEntry = () => chainStoreWrite(() => resumeStore.remove(resumeStoreKey));

    const persistResumeStateNow = () => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      persistFirstDirtyAt = null;
      if (!resumeStore || !resumeStoreKey) return Promise.resolve();
      // The generated QMK path may read the legacy alias exactly once for
      // staged adoption, but it never writes a new legacy successor. The only
      // valid deletion is the same-transaction QMK switch (apart from corrupt
      // entry cleanup below).
      if (legacySingleTableAdoption) return Promise.resolve();
      return chainStoreWrite(async () => {
        if (resumeStore.isWriter?.() !== true) return;
        const held = handle.rqsResume;
        // Write-time eligibility gate (LLP 0090 Authorization scope): only a
        // server-minted token proves rqsEligible — auth-scoped subscriptions
        // never hold one — and the digest recompute keeps every persisted
        // entry self-consistent (an authority-blanked or partially applied
        // row set simply refuses to persist).
        if (!held || authorizationFence || authorizationFaulted) return;
        if (handle.freshness !== 'current') return;
        if (!rowsMatchDigest(authoritativeRows, held.meta?.contentDigest)) return;
        try {
          await resumeStore.commit(resumeStoreKey, {
            rows: authoritativeRows,
            meta: held.meta,
            token: held.token,
          });
        } catch {
          // §0B.3 T9: a failed persistence write never blocks rendering or
          // the live subscription — invalidate best-effort so the next
          // relaunch takes the fresh path, and never surface the failure.
          try { await resumeStore.remove(resumeStoreKey); } catch { /* best effort */ }
        }
      });
    };

    const schedulePersist = () => {
      if (!resumeStore || !resumeStoreKey || disposed || legacySingleTableAdoption) return;
      const nowMs = Date.now();
      if (persistFirstDirtyAt === null) persistFirstDirtyAt = nowMs;
      // Trailing 1 s debounce with a 10 s continuous-change cap (§0A.5).
      const delay = Math.max(0, Math.min(
        RQS_PERSIST_DEBOUNCE_MS,
        persistFirstDirtyAt + RQS_PERSIST_MAX_DELAY_MS - nowMs,
      ));
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        persistFirstDirtyAt = null;
        void persistResumeStateNow();
      }, delay);
      persistTimer.unref?.();
    };

    const flushPersistOnHide = () => { void persistResumeStateNow(); };
    const onVisibilityHidden = () => {
      if (globalThis.document?.visibilityState === 'hidden') flushPersistOnHide();
    };
    if (resumeStore && resumeStoreKey && typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('pagehide', flushPersistOnHide);
      globalThis.document?.addEventListener?.('visibilitychange', onVisibilityHidden);
    }
    const detachResumePersistence = () => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      if (resumeStore && resumeStoreKey && typeof globalThis.removeEventListener === 'function') {
        globalThis.removeEventListener('pagehide', flushPersistOnHide);
        globalThis.document?.removeEventListener?.('visibilitychange', onVisibilityHidden);
      }
    };

    // Relaunch seeding (§0B.3 T1/T2 + the LLP 0090 D3 outbox rule and A-vs-B
    // arbitration): verify, render-first as retained, and let the ordinary
    // fresh subscribe carry the token (§0B.4 dispatch rule 2).
    const seedFromResumeState = async () => {
      let persisted = null;
      // LLP 0090 D3 outbox rule (LLP 0043 milestone boundary), rendering-side
      // presentation per LLP 0270 D3: a relaunching client with a non-empty
      // mutation outbox never holds or sends a resume token — reconnect takes
      // the full-resync-then-ordered-replay path — but verified retained rows
      // still render as the canonical base. Generated operations are replayed
      // as private presentation only after read admission; neither the layer
      // nor the retained base is promoted to current authority.
      let pendingIntentsAtSeed = 0;
      if (resumeStore && resumeStoreKey) {
        let entry = null;
        try { entry = await resumeStore.load(resumeStoreKey); } catch { entry = null; }
        if (entry) {
          if (verifyPersistedResumeEntry(entry, { args }).ok) {
            persisted = { rows: entry.rows, resume: { token: entry.token, meta: entry.meta } };
            if (legacySingleTableAdoption) legacyAdoptionCandidate = structuredClone(entry);
          } else {
            // Corrupt, truncated, digest-mismatched, or in-progress persisted
            // state fails closed to a fresh subscribe (T2).
            void removePersistedEntry();
          }
        }
        if (persisted) {
          let outboxEmpty = false;
          try { outboxEmpty = (await resumeStore.outboxEmpty()) === true; } catch { outboxEmpty = false; }
          if (!outboxEmpty) {
            // An unreadable outbox counts as pending (fail closed to the
            // full-resync path); the count is best-effort display honesty.
            try {
              pendingIntentsAtSeed = Math.max(1, (await resumeStore.outboxPending()).length);
            } catch {
              pendingIntentsAtSeed = 1;
            }
          }
        }
      }
      let preloaded = null;
      if (preloadedResume?.resume) {
        const candidateRows = Array.isArray(preloadedResume.rows) ? preloadedResume.rows : [];
        const verdict = verifyPersistedResumeEntry({
          rows: candidateRows,
          meta: preloadedResume.resume.meta,
          token: preloadedResume.resume.token,
          inProgress: false,
        }, { args });
        if (verdict.ok) preloaded = { rows: candidateRows, resume: preloadedResume.resume };
      }
      let winner = null;
      if (persisted && preloaded) {
        winner = arbitrateResumeCandidates(preloaded, persisted);
        // Identity mismatch discards BOTH candidates (LLP 0090 D3).
        if (winner === null) void removePersistedEntry();
      } else {
        winner = persisted ?? preloaded;
      }
      if (!winner || disposed) return;
      authoritativeRows = winner.rows;
      presentedRows = authoritativeRows;
      handle.version = winner.resume.meta.version;
      // D3: a non-empty outbox never resumes. With pending intent the handle
      // withholds the token entirely (the fresh subscribe takes the full
      // snapshot; replay drains only after it completes), so the retained
      // render can never turn into a resume attempt.
      handle.rqsResume = pendingIntentsAtSeed > 0 ? null : winner.resume;
      const retainedAnswer = deriveLegacyResumeAnswerV1({
        connected: false,
        verified: true,
        outboxPending: pendingIntentsAtSeed > 0,
      });
      handle.freshness = retainedAnswer.freshness;
      handle.answerClass = retainedAnswer.answerClass;
      handle.pendingIntentsAtSeed = pendingIntentsAtSeed;
      seededFromResumeState = winner === persisted;
      seedFrameDelivered = true;
      deliverAuthorityObservation(() => {
        onUpdate?.(authoritativeRows, {
          version: handle.version,
          kind: 'persisted',
          freshness: 'retained',
          answerClass: 'labeled-retained',
          ...(pendingIntentsAtSeed > 0 ? { pendingIntents: pendingIntentsAtSeed } : {}),
        });
      });
    };

    // LLP 0166 D4 row 1: only L2 bytes that revalidate against the generated
    // activation, proof, witness, fence, and lease are projected at relaunch.
    const seedFromMaterializationState = async () => {
      if (!preparedMaterialization || disposed) return;
      const result = await client.__storeRuntimeInvoke('seedFromMaterializationState', {
        preparedMaterialization,
        handle,
        deliverAuthorityObservation,
        onUpdate,
      });
      if (result?.seeded === true) {
        seededFromMaterialization = true;
        // @ref LLP 0166#d4--completeness-honest-local-answers — a retained
        // QMK frame must be superseded by the next fresh establishment.
        seedFrameDelivered = true;
      }
    };

    const seedFromProtectedRetentionState = async () => {
      if (!preparedProtectedRetention || disposed) return;
      const result = await client.__storeRuntimeInvoke('seedProtectedQueryRetentionState', {
        prepared: preparedProtectedRetention,
        handle,
        deliverAuthorityObservation,
        onUpdate,
      });
      if (result?.seeded === true && !disposed) {
        seededFromProtectedRetention = true;
        seedFrameDelivered = true;
      }
    };

    const installMaterializationSnapshot = async (sub) => {
      if (!preparedMaterialization) return null;
      const result = await client.__storeRuntimeInvoke('installMaterializationSnapshot', {
        preparedMaterialization,
        sub,
        ref,
        args,
        userId,
        queryNamespace,
        resumeStoreKey,
        legacyAdoptionCandidate,
        handleRows: authoritativeRows,
        authorityCapture: sub[AUTHORITY_CAPTURE] ?? null,
      });
      if (result?.adoptedLegacy === true) legacyAdoptionCandidate = null;
      return result;
    };

    const installProtectedRetentionSnapshot = async (sub) => {
      if (!preparedProtectedRetention || !sub.authorizationScope || !sub.snapshot) return null;
      return client.__storeRuntimeInvoke('installProtectedRetentionSnapshot', {
        prepared: preparedProtectedRetention,
        connection: sub[AUTHORIZATION_CONNECTION],
        snapshot: sub.snapshot,
        ref,
        args,
        userId,
        queryNamespace,
        deploymentIdentity: expectedGeneration(ref),
        authorityCapture: sub[AUTHORITY_CAPTURE] ?? null,
      });
    };

    const setConnection = (next) => {
      if (disposed && next !== 'disconnected') {
        syncLiveRegistrationAnswer();
        return;
      }
      const previous = connection;
      connection = next;
      syncLiveRegistrationAnswer();
      if (previous === next) return;
      if (onConnectionChange) {
        deliverAuthorityObservation(() => {
          deliverIsolated(onConnectionChange, next, { previous });
        });
      }
    };

    const authorizationSnapshot = (value) => ({
      rows: value?.rows,
      version: value?.version,
    });

    const commitAuthorizationBoundary = (event) => {
      const previousRows = authoritativeRows;
      const previousVersion = handle.version;
      const previousDisposition = handle.authorizationDisposition;
      try {
        if (event.kind === 'snapshot') {
          authoritativeRows = event.rows;
          presentedRows = authoritativeRows;
          handle.version = event.version;
          handle.authorizationDisposition = 'retain';
          // An authorization-fenced snapshot is authoritative whether or not
          // this client installed an optional durable materialization adapter.
          // Freshness describes the server answer, not its retention owner.
          handle.answerClass = 'authoritative';
          setHandleFreshness('current');
        } else if (event.kind === 'quarantine' || event.kind === 'delete') {
          authoritativeRows = createClientOwnedLifecycleBlankCarrier();
          presentedRows = authoritativeRows;
          handle.authorizationDisposition = event.kind;
          handle.answerClass = 'unknown';
          handle.freshness = null;
        } else if (event.kind === 'retain') {
          handle.authorizationDisposition = 'retain';
        } else {
          throw new TypeError(`unknown query authorization boundary kind: ${event.kind}`);
        }
        markAuthorityCapture(authoritativeRows, handleAuthorityCapture);
        const detail = {
          version: handle.version,
          kind: `authorization_${event.kind}`,
          authorization: event,
        };
        const boundaryResult = onAuthorizationBoundary?.(authoritativeRows, detail);
        if (boundaryResult && typeof boundaryResult.then === 'function') {
          throw new TypeError('onAuthorizationBoundary must commit synchronously');
        }
        if (event.kind !== 'retain') deliverIsolated(onUpdate, authoritativeRows, detail);
        syncLiveRegistrationAnswer();
      } catch (error) {
        authoritativeRows = previousRows;
        presentedRows = authoritativeRows;
        handle.version = previousVersion;
        handle.authorizationDisposition = previousDisposition;
        throw error;
      }
    };

    const reportAuthorizationError = (error) => {
      authorizationFaulted = true;
      authoritativeRows = createClientOwnedLifecycleBlankCarrier();
      presentedRows = authoritativeRows;
      handle.authorizationDisposition = 'quarantine';
      if (preparedMaterialization) {
        handle.answerClass = 'unknown';
        handle.freshness = null;
      }
      markAuthorityCapture(authoritativeRows, handleAuthorityCapture);
      const detail = {
        version: handle.version,
        kind: 'authorization_error',
        error,
      };
      try {
        onAuthorizationBoundary?.(authoritativeRows, detail);
      } catch {
        // The handle itself remains blank even if an adapter boundary failed.
      }
      deliverIsolated(onUpdate, authoritativeRows, detail);
      deliverIsolated(onAuthorizationError, error);
      if (!disposed && !paused) setConnection('stale');
    };

    // 0137 A1-Expo f4: a server-answered authorization denial on a fresh
    // subscribe becomes a renderable handle fact. Rows are already blank
    // (the custody barrier blanked them before any successor work); this
    // projects WHY the handle holds nothing so hooks can render the denial
    // instead of a silent ready-with-zero-rows. The handle stays paused;
    // a later authority transition (or an app resume) re-enters it.
    const recordAuthorizationDenial = (error) => {
      const code = error?.diagnostic?.code ?? error?.code ?? null;
      handle.authorizationDenial = Object.freeze({
        code,
        message: error?.diagnostic?.message ?? error?.message ?? null,
        atMs: Date.now(),
      });
      const detail = {
        version: handle.version,
        kind: 'authorization_denied',
        authorization: { kind: 'denied', code },
        error,
      };
      deliverIsolated(onUpdate, authoritativeRows, detail);
      emitEvent('authorization-denied', { code });
    };

    const captureQueueAuthorityGeneration = async () => (
      authorizationQueue?.captureAuthorityGeneration?.() ?? null
    );

    const applyQueueObligation = async (value, expectedAuthorityGeneration = null) => {
      if (value.maxDisposition === 'retain') return null;
      if (preparedProtectedRetention) {
        await client.__storeRuntimeInvoke(
          'deleteProtectedQueryRetention',
          preparedProtectedRetention,
        );
      }
      return authorizationQueue?.applyObligation?.(
        value,
        expectedAuthorityGeneration,
      ) ?? null;
    };

    const resolveQueueObligation = async (
      value,
      snapshotValue = null,
      expectedAuthorityGeneration = null,
    ) => {
      if (value.maxDisposition === 'retain') return null;
      return authorizationQueue?.resolveObligation?.(
        value,
        snapshotValue === null ? null : authorizationSnapshot(snapshotValue),
        expectedAuthorityGeneration,
      ) ?? null;
    };

    const prepareQueueResolution = async (value, snapshotValue = null) => {
      if (value.maxDisposition === 'retain') return null;
      return authorizationQueue?.prepareResolution?.(
        value,
        snapshotValue === null ? null : authorizationSnapshot(snapshotValue),
      ) ?? null;
    };

    const retireQueueScopes = async (
      retired,
      snapshotValue = null,
      expectedAuthorityGeneration = null,
    ) => {
      if (retired.length === 0) return null;
      if (preparedProtectedRetention) {
        await client.__storeRuntimeInvoke(
          'deleteProtectedQueryRetention',
          preparedProtectedRetention,
        );
      }
      return authorizationQueue?.retireScopes?.(
        retired,
        snapshotValue === null ? null : authorizationSnapshot(snapshotValue),
        expectedAuthorityGeneration,
      ) ?? null;
    };

    const advanceAuthorizationTaskGeneration = () => {
      authorizationTaskGeneration = safeNextCounter(
        authorizationTaskGeneration,
        'SNAPBACK_CLIENT_AUTHORIZATION_TASK_GENERATION_EXHAUSTED',
        'authorization task generation',
      );
      appliedAuthorizationResolutionsByToken.clear();
      appliedAuthorizationResolutionsByScope.clear();
    };

    const advanceSubscriptionPublicationGeneration = () => {
      subscriptionPublicationGeneration = safeNextCounter(
        subscriptionPublicationGeneration,
        'SNAPBACK_CLIENT_SUBSCRIPTION_PUBLICATION_GENERATION_EXHAUSTED',
        'subscription publication generation',
      );
    };

    const authorizationTaskState = (capture, { allowPaused = false } = {}) => Object.freeze({
      capture,
      lifecycleEpoch: subscribeLifecycleEpoch,
      authorizationGeneration: authorizationTaskGeneration,
      subscriptionPublicationGeneration,
      authorizationFence,
      allowPaused,
    });

    const authorizationTaskIsCurrent = (taskState) => (
      !disposed
      && (!paused || taskState.allowPaused === true)
      && taskState.lifecycleEpoch === subscribeLifecycleEpoch
      && taskState.authorizationGeneration === authorizationTaskGeneration
      && taskState.subscriptionPublicationGeneration === subscriptionPublicationGeneration
      && taskState.authorizationFence === authorizationFence
    );

    const tagAuthorizationTaskError = (error, taskState) => {
      if (error && (typeof error === 'object' || typeof error === 'function')) {
        try {
          Object.defineProperty(error, authorizationTaskErrorState, {
            value: taskState,
            configurable: true,
          });
        } catch { /* the fallback reporting state remains fail-closed */ }
      }
      return error;
    };

    const conflictingAuthorizationResolutionError = () => {
      const error = new Error(
        'SNAPBACK_AUTH_INVALIDATION_CORRUPT: one acknowledgement token or scope revision named conflicting resolution frames',
      );
      error.code = 'SNAPBACK_AUTH_INVALIDATION_CORRUPT';
      error.diagnostic = {
        code: error.code,
        message: 'one acknowledgement token or scope revision named conflicting resolution frames',
      };
      return error;
    };

    const resolutionFrameIdentity = (projection, snapshotValue) => stableJson({
      obligation: projection.obligation,
      resolution: projection.resolution,
      snapshot: snapshotValue,
    });

    const cloneAuthorizationBoundary = (event) => (
      event?.kind === 'snapshot'
        ? {
            kind: 'snapshot',
            rows: structuredClone(event.rows),
            version: event.version,
          }
        : { kind: event?.kind ?? authorizationFence.disposition() }
    );

    const resolutionRecordIsCurrent = (record, resolution) => {
      const state = authorizationFence.snapshot();
      const key = scopeKey(resolution.scopeId);
      if (record.locallyAcknowledged) {
        return state.scopeState?.[key]?.lastAckToken === resolution.ackToken;
      }
      const applied = state.pendingByScope?.[key]?.resolution;
      return applied?.applied === true
        && stableJson(applied.ticket) === stableJson(resolution);
    };

    const forgetAppliedResolution = (ackToken, resolution, record) => {
      if (appliedAuthorizationResolutionsByToken.get(ackToken) === record) {
        appliedAuthorizationResolutionsByToken.delete(ackToken);
      }
      const key = stableJson(resolution.scopeId);
      if (appliedAuthorizationResolutionsByScope.get(key) === record) {
        appliedAuthorizationResolutionsByScope.delete(key);
      }
    };

    const restorationBoundaryFor = (record) => {
      const state = authorizationFence.snapshot();
      if (state.terminalDeleted) return { kind: 'delete' };
      if (authorizationFence.isRenderable() && record.boundary?.kind === 'snapshot') {
        return cloneAuthorizationBoundary(record.boundary);
      }
      return { kind: authorizationFence.disposition() };
    };

    const trackAuthorizationResolutionTask = (
      ackToken,
      identity,
      taskState,
      promise,
    ) => {
      const entry = { promise, taskState, identity };
      authorizationResolutionTasks.set(ackToken, entry);
      void promise.finally(() => {
        if (authorizationResolutionTasks.get(ackToken) === entry) {
          authorizationResolutionTasks.delete(ackToken);
        }
      }).catch(() => {});
      return promise;
    };

    const commitAuthorizationTask = async (taskState, commit) => {
      if (!authorizationTaskIsCurrent(taskState)) throw staleAuthorityError();
      const outcome = await client.commitAuthorityPublication(taskState.capture, () => {
        if (!authorizationTaskIsCurrent(taskState)) return { accepted: false };
        return { accepted: true, value: commit() };
      });
      if (!outcome.committed || outcome.value?.accepted !== true) {
        throw staleAuthorityError();
      }
      return outcome.value.value;
    };

    const reportAuthorizationErrorFor = async (error, taskState) => {
      const errorCode = error?.code ?? error?.diagnostic?.code;
      if (
        !authorizationTaskIsCurrent(taskState)
        || errorCode === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
        || [
          'SNAPBACK_AUTH_QUERY_FENCE_STALE',
          'SNAPBACK_AUTH_QUERY_VERSION_STALE',
          'SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE',
          'SNAPBACK_AUTH_INVALIDATION_RETIREMENT_STALE',
          'SNAPBACK_AUTH_INVALIDATION_SNAPSHOT_STALE',
          'SNAPBACK_OUTBOX_NOT_WRITER',
          'SNAPBACK_OUTBOX_AUTHORIZATION_DEFERRED',
          'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE',
          'SNAPBACK_OUTBOX_AUTHORIZATION_STALE',
        ].includes(errorCode)
      ) return;
      if (errorCode === 'SNAPBACK_AUTH_INVALIDATION_SCOPE_INVALID') {
        try {
          await commitAuthorizationTask(
            taskState,
            () => deliverIsolated(onAuthorizationError, error),
          );
        } catch {
          // A later lifecycle owns both rows and diagnostics.
        }
        return;
      }
      try {
        await commitAuthorizationTask(taskState, () => reportAuthorizationError(error));
      } catch {
        // A transition/terminal cut suppresses predecessor diagnostics just
        // like predecessor rows. The blanking barrier owns the visible state.
      }
    };

    const enqueueAuthorizationTask = (task, taskState) => {
      const attempted = authorizationTail.then(task);
      authorizationTail = attempted.catch(() => {});
      return attempted;
    };

    const rejectStaleAcknowledgement = async (
      ackToken,
      taskState,
      expectedAuthorityGeneration,
    ) => {
      const rejected = await commitAuthorizationTask(taskState, () => (
        authorizationFence.rejectAcknowledgement(ackToken, {
          commit: commitAuthorizationBoundary,
        })
      ));
      if (rejected.status === 'rejected') {
        await applyQueueObligation(rejected.obligation, expectedAuthorityGeneration);
      }
      return rejected;
    };

    const receiveAuthorizationProjection = (
      projection,
      snapshotValue = null,
      capture = handleAuthorityCapture,
    ) => {
      if (!authorizationFence) {
        return Promise.reject(new Error(
          'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED: invalidation arrived before its authenticated query expectation',
        ));
      }
      const resolutionTaskKey = projection.resolution?.ackToken ?? null;
      const taskState = authorizationTaskState(capture);
      const resolutionIdentity = resolutionTaskKey === null
        ? null
        : resolutionFrameIdentity(projection, snapshotValue);
      const existing = resolutionTaskKey === null
        ? null
        : authorizationResolutionTasks.get(resolutionTaskKey);
      if (existing && authorizationTaskIsCurrent(existing.taskState)) {
        if (existing.identity !== resolutionIdentity) {
          return Promise.reject(tagAuthorizationTaskError(
            conflictingAuthorizationResolutionError(),
            existing.taskState,
          ));
        }
        return existing.promise;
      }
      if (existing) authorizationResolutionTasks.delete(resolutionTaskKey);

      let appliedByToken = resolutionTaskKey === null
        ? null
        : appliedAuthorizationResolutionsByToken.get(resolutionTaskKey);
      if (
        appliedByToken
        && (
          !authorizationTaskIsCurrent(appliedByToken.taskState)
          || !resolutionRecordIsCurrent(appliedByToken, projection.resolution)
        )
      ) {
        forgetAppliedResolution(
          resolutionTaskKey,
          projection.resolution,
          appliedByToken,
        );
        appliedByToken = null;
      }
      if (appliedByToken) {
        if (appliedByToken.identity !== resolutionIdentity) {
          return Promise.reject(tagAuthorizationTaskError(
            conflictingAuthorizationResolutionError(),
            taskState,
          ));
        }
        const reacknowledgement = (async () => {
          if (!appliedByToken.queueResolved) {
            await resolveQueueObligation(
              projection.resolution,
              snapshotValue,
              appliedByToken.queueAuthorityGeneration,
            );
            await commitAuthorizationTask(taskState, () => {
              appliedByToken.queueResolved = true;
            });
          }
          await commitAuthorizationTask(taskState, () => {
            if (authorizationFaulted) {
              commitAuthorizationBoundary(restorationBoundaryFor(appliedByToken));
              authorizationFaulted = false;
            }
          });
          const acknowledged = await client.acknowledgeAuthorizationInvalidation(
            connectionId,
            resolutionTaskKey,
          );
          if (
            acknowledged?.outcome === 'discharged'
            || acknowledged?.outcome === 'duplicate'
          ) {
            let newlyAcknowledged = false;
            await commitAuthorizationTask(taskState, () => {
              if (!appliedByToken.locallyAcknowledged) {
                authorizationFence.acknowledge(resolutionTaskKey);
                appliedByToken.locallyAcknowledged = true;
                newlyAcknowledged = true;
              }
            });
            if (newlyAcknowledged) {
              await authorizationQueue?.acknowledged?.(
                projection.resolution,
                acknowledged,
                appliedByToken.queueAuthorityGeneration,
              );
            }
            return {
              status: 'duplicate',
              ackToken: resolutionTaskKey,
              fence: authorizationFence.capture(),
            };
          }
          if (acknowledged?.outcome === 'stale') {
            await rejectStaleAcknowledgement(
              resolutionTaskKey,
              taskState,
              appliedByToken.queueAuthorityGeneration,
            );
            forgetAppliedResolution(
              resolutionTaskKey,
              projection.resolution,
              appliedByToken,
            );
            return {
              status: 'stale-acknowledgement',
              ackToken: resolutionTaskKey,
              fence: authorizationFence.capture(),
            };
          }
          await rejectStaleAcknowledgement(
            resolutionTaskKey,
            taskState,
            appliedByToken.queueAuthorityGeneration,
          );
          forgetAppliedResolution(
            resolutionTaskKey,
            projection.resolution,
            appliedByToken,
          );
          throw new Error(
            'SNAPBACK_AUTH_INVALIDATION_CORRUPT: acknowledgement returned an unknown outcome',
          );
        })().catch((error) => {
          throw tagAuthorizationTaskError(error, taskState);
        });
        return trackAuthorizationResolutionTask(
          resolutionTaskKey,
          resolutionIdentity,
          taskState,
          reacknowledgement,
        );
      }

      if (projection.resolution) {
        const scopeIdentity = stableJson(projection.resolution.scopeId);
        const appliedByScope = appliedAuthorizationResolutionsByScope.get(scopeIdentity);
        if (appliedByScope && !authorizationTaskIsCurrent(appliedByScope.taskState)) {
          appliedAuthorizationResolutionsByScope.delete(scopeIdentity);
        } else if (
          appliedByScope
          && projection.resolution.revision === appliedByScope.revision
          && appliedByScope.identity !== resolutionIdentity
        ) {
          return Promise.reject(tagAuthorizationTaskError(
            conflictingAuthorizationResolutionError(),
            taskState,
          ));
        }
      }
      // Independent scope obligations coexist. Their per-scope fences decide
      // staleness; only query expectation/lifecycle replacement advances the
      // generation. Advancing here let scope B cancel scope A's durable queue
      // suspension before A's serialized task ran.
      const work = (async () => {
        let received;
        try {
          // @ref LLP 0200#24-the-authorization-lane-splits-in-two--by-declared-classification
          // — a usable same-envelope SNAPSHOT ticket defers only the observable
          // boundary; the fence receipt and durable queue obligation retain
          // their order. A terminalDelete proof never defers: the revocation
          // contract (blankBeforeMutationReturn, LLP 0200 §6a receipt) requires
          // the boundary to blank at obligation receipt, ahead of the awaits
          // that precede resolution application.
          received = await commitAuthorizationTask(taskState, () => (
            authorizationFence.receiveObligation(projection.obligation, {
              commit: commitAuthorizationBoundary,
              deferCommit: projection.resolution?.kind === 'snapshot',
            })
          ));
        } catch (error) {
          throw tagAuthorizationTaskError(error, taskState);
        }
        if (['stale-expectation', 'retired', 'acknowledged'].includes(received.status)) {
          return received;
        }
        let deferredBoundaryPending = projection.resolution?.kind === 'snapshot'
          && received.status === 'accepted';
        return enqueueAuthorizationTask(async () => {
          const queueAuthorityGeneration = await captureQueueAuthorityGeneration();
          await commitAuthorizationTask(taskState, () => true);
          await applyQueueObligation(
            projection.obligation,
            queueAuthorityGeneration,
          );
          if (projection.resolution == null) return received;
          // A durable retained-query adapter commits the successor snapshot and
          // its no-lease fence before the process boundary can reveal it. The
          // later ACK still waits for mutation-queue resolution as well.
          await prepareQueueResolution(projection.resolution, snapshotValue);
          // The shared queue proof must be durable before the local fence can
          // publish its successor snapshot. A reader that cannot commit or
          // observe this exact token remains on the fail-closed boundary and
          // retries through the writer; it never flashes proof rows without
          // releasing the matching mutation suspension root.
          await resolveQueueObligation(
            projection.resolution,
            snapshotValue,
            queueAuthorityGeneration,
          );
          let appliedRecord = null;
          const applied = await commitAuthorizationTask(taskState, () => {
            let appliedBoundary = null;
            const value = authorizationFence.applyResolution({
              fence: received.fence,
              resolution: projection.resolution,
              snapshot: snapshotValue === null
                ? null
                : authorizationSnapshot(snapshotValue),
              commit: (event) => {
                commitAuthorizationBoundary(event);
                appliedBoundary = cloneAuthorizationBoundary(event);
              },
            });
            deferredBoundaryPending = false;
            appliedRecord = {
              identity: resolutionIdentity,
              revision: projection.resolution.revision,
              taskState,
              queueAuthorityGeneration,
              boundary: appliedBoundary ?? (
                snapshotValue === null
                  ? { kind: 'delete' }
                  : {
                      kind: authorizationFence.isRenderable() ? 'snapshot' : authorizationFence.disposition(),
                      ...(authorizationFence.isRenderable()
                        ? {
                            rows: structuredClone(snapshotValue.rows),
                            version: snapshotValue.version,
                          }
                        : {}),
                    }
              ),
              queueResolved: true,
              locallyAcknowledged: false,
            };
            appliedAuthorizationResolutionsByToken.set(value.ackToken, appliedRecord);
            appliedAuthorizationResolutionsByScope.set(
              stableJson(projection.resolution.scopeId),
              appliedRecord,
            );
            authorizationFaulted = false;
            return value;
          });
          let acknowledged;
          try {
            acknowledged = await client.acknowledgeAuthorizationInvalidation(
              connectionId,
              applied.ackToken,
            );
          } catch (error) {
            // Delivery is level-triggered. Preserve the applied ticket so the
            // next re-fire resends the same ACK instead of inventing a release.
            throw error;
          }
          if (acknowledged?.outcome === 'discharged' || acknowledged?.outcome === 'duplicate') {
            let newlyAcknowledged = false;
            await commitAuthorizationTask(
              taskState,
              () => {
                const local = authorizationFence.acknowledge(applied.ackToken);
                if (!appliedRecord.locallyAcknowledged) {
                  appliedRecord.locallyAcknowledged = true;
                  newlyAcknowledged = true;
                }
                return local;
              },
            );
            if (newlyAcknowledged) {
              await authorizationQueue?.acknowledged?.(
                projection.resolution,
                acknowledged,
                queueAuthorityGeneration,
              );
            }
            return applied;
          }
          await rejectStaleAcknowledgement(
            applied.ackToken,
            taskState,
            queueAuthorityGeneration,
          );
          forgetAppliedResolution(
            applied.ackToken,
            projection.resolution,
            appliedRecord,
          );
          if (acknowledged?.outcome !== 'stale') {
            throw new Error(
              'SNAPBACK_AUTH_INVALIDATION_CORRUPT: acknowledgement returned an unknown outcome',
            );
          }
          return { ...applied, status: 'stale-acknowledgement' };
        }, taskState).catch(async (error) => {
          if (deferredBoundaryPending && authorizationTaskIsCurrent(taskState)) {
            try {
              // Capture inside the serialized commit cut: an intervening fence
              // advance makes the receipt capture stale, but must not suppress
              // the current effective fail-closed disposition.
              await commitAuthorizationTask(taskState, () => {
                authorizationFence.commitCurrentDisposition({
                  fence: authorizationFence.capture(),
                  commit: commitAuthorizationBoundary,
                });
                deferredBoundaryPending = false;
              });
            } catch (repairError) {
              throw tagAuthorizationTaskError(repairError, taskState);
            }
          }
          throw tagAuthorizationTaskError(error, taskState);
        });
      })();
      if (resolutionTaskKey !== null) {
        return trackAuthorizationResolutionTask(
          resolutionTaskKey,
          resolutionIdentity,
          taskState,
          work,
        );
      }
      return work;
    };

    const applyRetirement = (kind, retirement, freshSnapshot, taskState) => (
      enqueueAuthorizationTask(async () => {
        // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — exact queue retirement precedes successor presentation; reader deferral stays blank.
        const queueAuthorityGeneration = await captureQueueAuthorityGeneration();
        const preview = await commitAuthorizationTask(taskState, () => (
          kind === 'issuer'
            ? authorizationFence.previewRetireIssuer({ retirement, freshSnapshot })
            : authorizationFence.previewRetireScopes({ retirement, freshSnapshot })
        ));
        if (preview.status === 'retired') {
          await retireQueueScopes(
            preview.retired,
            freshSnapshot,
            queueAuthorityGeneration,
          );
        }
        const result = await commitAuthorizationTask(taskState, () => (
          kind === 'issuer'
            ? authorizationFence.retireIssuer({
                retirement,
                freshSnapshot,
                commit: commitAuthorizationBoundary,
              })
            : authorizationFence.retireScopes({
                retirement,
                freshSnapshot,
                commit: commitAuthorizationBoundary,
              })
        ));
        return result;
      }, taskState)
    );

    const installAuthorizationSubscription = async (sub) => {
      const scopeValue = sub.authorizationScope ?? null;
      const connectionValue = sub[AUTHORIZATION_CONNECTION] ?? null;
      if (scopeValue === null) return;
      if (queryNamespace === null || connectionValue === null) {
        throw new Error(
          'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED: auth-scoped live response lacks the negotiated query expectation',
        );
      }
      const normalizedScope = validateScopeId(scopeValue, 'authorizationScope');
      if (
        normalizedScope.kind !== 'subscription'
        || JSON.stringify(normalizedScope.namespace) !== JSON.stringify(queryNamespace)
        || normalizedScope.subscriptionId !== sub.subscription_id
      ) {
        throw new Error(
          'SNAPBACK_AUTH_INVALIDATION_CORRUPT: subscribe response crossed live query scope identity',
        );
      }
      const normalizedConnection = validateAuthorizationInvalidationConnection(connectionValue);
      const freshSnapshot = authorizationSnapshot(sub.snapshot);
      advanceAuthorizationTaskGeneration();
      let taskState = authorizationTaskState(sub[AUTHORITY_CAPTURE] ?? handleAuthorityCapture);
      await commitAuthorizationTask(taskState, () => {
        if (!authorizationFence) {
          const authorityGeneration = taskState.capture?.authorityEpoch ?? 0;
          authorizationFence = createLiveQueryAuthorizationFence({
            namespace: queryNamespace,
            authorityGeneration,
            issuerId: normalizedConnection.issuerId,
            authorizationScope: normalizedScope,
            connectionGeneration: normalizedConnection.connectionGeneration,
            authorization: normalizedConnection.authorization,
            versionStream: normalizedConnection.versionStream,
            initialSnapshot: freshSnapshot,
          });
        } else {
          authorizationFence.replaceAuthenticatedExpectation({
            issuerId: normalizedConnection.issuerId,
            authorizationScope: normalizedScope,
            connectionGeneration: normalizedConnection.connectionGeneration,
            authorization: normalizedConnection.authorization,
            versionStream: normalizedConnection.versionStream,
            snapshot: freshSnapshot,
            commit: commitAuthorizationBoundary,
          });
        }
      });
      taskState = authorizationTaskState(taskState.capture);
      if (sub.authorizationInvalidation) {
        await receiveAuthorizationProjection(
          sub.authorizationInvalidation,
          sub.snapshot,
          taskState.capture,
        );
        taskState = authorizationTaskState(taskState.capture);
      }
      if (normalizedConnection.issuerRetirement) {
        await applyRetirement(
          'issuer',
          normalizedConnection.issuerRetirement,
          freshSnapshot,
          taskState,
        );
      }
      for (const retirement of sub.scopeRetirements ?? []) {
        await applyRetirement('scope', retirement, freshSnapshot, taskState);
      }
      await commitAuthorizationTask(taskState, () => {
        if (
          authorizationFence.isRenderable()
          && (
            handle.version !== sub.snapshot.version
            || JSON.stringify(authoritativeRows) !== JSON.stringify(sub.snapshot.rows)
          )
        ) {
          authorizationFence.applyLiveSnapshot({
            fence: authorizationFence.capture(),
            snapshot: freshSnapshot,
            commit: commitAuthorizationBoundary,
          });
        }
        if (authorizationFence.isRenderable()) authorizationFaulted = false;
      });
    };

    // Full SubscriptionReceipts (LLP 0034 §3.2 / ENG-22478): the kit is the
    // provider half that knows the actual transport; scope is REQUIRED (the
    // subscription's routing/scope args); versions are the server's durable
    // commit versions (§3.1 — one version story, nothing invented); the
    // adapter's opaque correlation is echoed verbatim. Receipts are retained
    // in the client ring and handed to onSubscriptionEvent.
    const emitEvent = (event, extra = {}) => {
      const receipt = {
        kind: 'subscription',
        bindingId: handle.subscriptionId,
        subscriptionId: handle.subscriptionId,
        event,
        transport: transport === 'stream' && streamedSinceSubscribe ? 'push' : 'poll',
        scope: { ...args },
        snapshotVersion: handle.version,
        lastDeltaVersion: handle.version,
        correlation: cappedCorrelation(correlation),
        receivedAtMs: Date.now(),
        ...extra,
      };
      deliverAuthorityObservation(() => {
        client.recordReceipt(receipt, handleAuthorityCapture);
        if (onSubscriptionEvent) deliverIsolated(onSubscriptionEvent, receipt);
      });
    };

    const emitEstablishedOnce = () => {
      if (establishedEmitted || disposed || handle.subscriptionId === null) return;
      establishedEmitted = true;
      if (establishTimer) {
        clearTimeout(establishTimer);
        establishTimer = null;
      }
      emitEvent('established');
    };

    const unsubscribeLiveForLifecycle = (
      subscriptionId,
      retirementState = authorizationTaskState(handleAuthorityCapture),
      externalBearerTransitionPermit = null,
    ) => {
      if (!subscriptionId) return Promise.resolve();
      // A query-scoped terminal invalidation has already destroyed this
      // exact server subscription and its authorization fence. Unlike a
      // whole-session terminal blank, it does not pass through the global
      // auth-materialization callback below, so recognize it here before
      // attempting a second retirement under an intentionally stale capture.
      if (terminalQueryDeleted()) {
        markKnownSubscriptionRetired(subscriptionId);
        return Promise.resolve(alreadyRetiredResponse(subscriptionId));
      }
      if (isKnownSubscriptionRetired(subscriptionId)) {
        return Promise.resolve(alreadyRetiredResponse(subscriptionId));
      }
      const retiringFence = retirementState.authorizationFence;
      return Promise.resolve()
        .then(() => {
          const options = {
            subscriptionId,
            connectionId,
            userId,
            authorityCapture: retirementState.capture,
          };
          return externalBearerTransitionPermit === EXTERNAL_BEARER_TRANSITION_PERMIT
            ? client.#unsubscribeLive(name, options, externalBearerTransitionPermit)
            : client.unsubscribeLive(name, options);
        })
        .catch((error) => {
          if (error?.diagnostic?.code !== 'SNAPBACK_UNKNOWN_SUBSCRIPTION') {
            throw error;
          }
          // Only this handle's captured generation may translate
          // server-confirmed absence into completed local retirement. The
          // public unsubscribe API remains strict, so foreign ids and
          // ownership/session mismatches still fail closed.
          markKnownSubscriptionRetired(subscriptionId);
          return alreadyRetiredResponse(subscriptionId);
        })
        .then(async (response) => {
          if (
            response?.subscription_id === subscriptionId
            && typeof response?.disposed === 'boolean'
          ) {
            markKnownSubscriptionRetired(subscriptionId);
          }
          if (response?.scopeRetirement && authorizationFence !== null) {
            // Pause serializes resume behind this promise, so the current
            // active fence is still the exact released subscription's fence.
            // Capture after the HTTP response to keep the retirement task
            // current while paused; only query retirement itself is allowed
            // to finish the fence lifecycle below.
            const scopeRetirementState = authorizationTaskState(
              retirementState.capture,
              { allowPaused: true },
            );
            await applyRetirement(
              'scope',
              response.scopeRetirement,
              null,
              scopeRetirementState,
            );
          }
          if (
            retiringFence !== null
            && authorizationFence === retiringFence
            && retiringFence.snapshot?.().lifecycle === 'retiring'
          ) {
            await commitAuthorizationTask(retirementState, () => retiringFence.finishRetirement());
          }
          return response;
        });
    };

    const bestEffortUnsubscribeLive = (
      subscriptionId,
      retirementState = authorizationTaskState(handleAuthorityCapture),
    ) => {
      const cleanup = unsubscribeLiveForLifecycle(subscriptionId, retirementState)
        .catch(() => {
          // Best-effort: the subscription may already be gone (disconnect,
          // supersession) or the server unreachable — the reaper covers it.
          // Never finish a retiring predecessor after its lifecycle/fence was
          // replaced; owner continuity remains until authoritative cleanup.
        });
      cleanupTail = Promise.allSettled([cleanupTail, cleanup]).then(() => {});
      return cleanup;
    };

    const subscribeLifecycleError = (state) => {
      const code = state === 'disposed'
        ? 'SNAPBACK_LIVE_QUERY_DISPOSED_DURING_SUBSCRIBE'
        : 'SNAPBACK_LIVE_QUERY_PAUSED_DURING_SUBSCRIBE';
      return clientCodedError(new Error(
        `${code}: Snapback live query subscribe was cancelled because the handle was ${state}.`,
      ), code);
    };

    const subscribeQueueInvalidatedError = () => clientCodedError(new Error(
      'SNAPBACK_LIVE_QUERY_SUBSCRIBE_QUEUE_INVALIDATED: queued fresh subscribe was invalidated by the preceding attempt failure',
    ), 'SNAPBACK_LIVE_QUERY_SUBSCRIBE_QUEUE_INVALIDATED');

    const invalidateSubscribeLifecycle = (state) => {
      subscribeLifecycleEpoch = safeNextCounter(
        subscribeLifecycleEpoch,
        'SNAPBACK_CLIENT_SUBSCRIPTION_GENERATION_EXHAUSTED',
        'subscription lifecycle generation',
      );
      if (!subscribeLifecycleController.signal.aborted) {
        subscribeLifecycleController.abort(subscribeLifecycleError(state));
      }
    };

    const beginSubscribeLifecycle = () => {
      if (!subscribeLifecycleController.signal.aborted) {
        subscribeLifecycleController.abort(subscribeLifecycleError('paused'));
      }
      subscribeLifecycleEpoch = safeNextCounter(
        subscribeLifecycleEpoch,
        'SNAPBACK_CLIENT_SUBSCRIPTION_GENERATION_EXHAUSTED',
        'subscription lifecycle generation',
      );
      subscribeLifecycleController = new AbortController();
    };

    const currentSubscribeLifecycle = () => ({
      epoch: subscribeLifecycleEpoch,
      signal: subscribeLifecycleController.signal,
    });

    const assertSubscribeLifecycle = (lifecycle) => {
      if (
        disposed ||
        paused ||
        lifecycle.epoch !== subscribeLifecycleEpoch ||
        lifecycle.signal !== subscribeLifecycleController.signal ||
        lifecycle.signal.aborted
      ) {
        if (lifecycle.signal.reason instanceof Error) throw lifecycle.signal.reason;
        throw subscribeLifecycleError(disposed ? 'disposed' : 'paused');
      }
    };

    const classifyRqsRetention = () => {
      handle.retention = Object.freeze({
        retainable: resumeStore !== null,
        code: resumeStore === null ? 'SNAPBACK_RETENTION_STORE_DISABLED' : null,
        reason: resumeStore === null
          ? 'rqsEligible, but this client has no persistence store'
          : null,
        store: client.rqsStoreInfo,
      });
    };

    const repairRqsRetentionFromDurable = () => {
      // Generated materializations have their own owner-authority
      // classification. A refreshed RQS token repairs only the Channel B
      // retention fact governed by this handle's resume store.
      if (preparedMaterialization === null) classifyRqsRetention();
    };

    const supersededSubscriptionInstallationError = () => clientCodedError(new Error(
      'SNAPBACK_LIVE_QUERY_INSTALLATION_SUPERSEDED: the installing subscription was retired before publication',
    ), 'SNAPBACK_LIVE_QUERY_INSTALLATION_SUPERSEDED');

    const supersedeInstallingSubscription = (attempt, update) => {
      if (attempt.superseded) return;
      attempt.superseded = true;
      attempt.supersedingReason = resyncReason(update.reason);
      if (attempt.subscriptionId !== null) {
        pendingSupersedesSubscriptionId = attempt.subscriptionId;
      }
      // @ref LLP 0053#client-fences — the resync sentinel is a synchronous
      // publication cut. Advance the shared handle generation before any
      // queued authorization or optimistic task can resume and publish.
      advanceSubscriptionPublicationGeneration();
      needsResubscribe = true;
      pendingResubscribeReason = attempt.supersedingReason;
      if (handle.freshness !== null) {
        handle.freshness = 'retained';
        handle.answerClass = 'labeled-retained';
      }
      setConnection('stale');
      syncLiveRegistrationAnswer();
      if (update.clear_retained === true || update.clearRetained === true) {
        handle.rqsResume = null;
        void removePersistedEntry();
      }
    };

    const bufferPreSubscribeDurable = (update) => {
      const attempt = preSubscribeDurableAttempt;
      if (
        attempt === null
        || (
          update.kind !== LIVE_DURABLE_KINDS.RESYNC_REQUIRED
          && update.function !== name
        )
        || typeof update.subscription_id !== 'string'
        || (
          update.kind !== LIVE_DURABLE_KINDS.CURRENT_AS_OF
          && update.kind !== LIVE_DURABLE_KINDS.LIVE_DELTA
          && update.kind !== LIVE_DURABLE_KINDS.LIVE_REPLACE
          && update.kind !== LIVE_DURABLE_KINDS.RESYNC_REQUIRED
        )
      ) return false;
      const targetsInstallingSubscription = attempt.subscriptionId !== null
        && update.subscription_id === attempt.subscriptionId;
      if (!targetsInstallingSubscription && update.subscription_id === handle.subscriptionId) {
        return false;
      }
      if (
        targetsInstallingSubscription
        && update.kind === LIVE_DURABLE_KINDS.RESYNC_REQUIRED
      ) {
        supersedeInstallingSubscription(attempt, update);
        return true;
      }
      if (attempt.envelopes.length >= RQS_PRE_SUBSCRIBE_DURABLE_BUFFER_CAP) {
        attempt.overflowed = true;
        if (attempt.subscriptionId !== null) {
          supersedeInstallingSubscription(attempt, {
            reason: 'pre_subscribe_durable_overflow',
          });
        }
        return true;
      }
      attempt.envelopes.push(update);
      return true;
    };

    const applyDurable = (update) => {
      if (disposed || paused || !update || typeof update !== 'object') return;
      const updateCapture = update[AUTHORITY_CAPTURE] ?? handleAuthorityCapture;
      if (
        client.authorityFence
        && (!updateCapture || !client.authorityFence.isCurrent(updateCapture))
      ) return;
      // @ref LLP 0091#0b2-currentasof-envelope — rowless completion is a
      //   durable-lane answer and therefore may overtake the HTTP subscribe
      //   acknowledgement that names its new subscription id.
      if (bufferPreSubscribeDurable(update)) return;
      if (
        resyncFencedSubscriptionId !== null
        && update.subscription_id === resyncFencedSubscriptionId
      ) return;
      if (update.kind === LIVE_DURABLE_KINDS.AUTHORIZATION_INVALIDATION) {
        // Purge the persisted RQS copy, not just in-memory state (LLP 0090
        // D3 storage lifecycle). Auth-scoped data is never in the store, so
        // this is belt-and-braces for a query whose declaration changed.
        handle.answerClass = 'unknown';
        syncLiveRegistrationAnswer();
        void removePersistedEntry();
        const reportingState = authorizationTaskState(updateCapture);
        void receiveAuthorizationProjection({
            obligation: update.obligation,
            resolution: update.resolution ?? null,
          }, update.snapshot ?? null, updateCapture)
          .catch((error) => reportAuthorizationErrorFor(
            error,
            error?.[authorizationTaskErrorState] ?? reportingState,
          ));
        return;
      }
      if (update.kind === LIVE_DURABLE_KINDS.LIVE_REPLACE) {
        // Updates for a superseded (pre-resubscribe) subscription id are
        // ignored; versions strictly increase per subscription (the global
        // durable commit version assigned at fan-out). Asset lifecycle rows
        // are the one existing exception: they are durable system-row writes
        // outside the app commit clock, and their reserved projection can
        // therefore move at the same app version. The connection lane is
        // FIFO, so accepting that projection's equal-version replacement is
        // ordered while lower versions and every ordinary equal-version
        // replay remain ignored.
        // @ref LLP 0044#live-asset-lifecycle — trusted asset transitions must
        //   update the reserved live projection without polling.
        if (update.subscription_id !== handle.subscriptionId) return;
        if (terminalQueryDeleted()) {
          reportTerminalReuse(LIVE_DURABLE_KINDS.LIVE_REPLACE);
          return;
        }
        const equalVersionAssetLifecycle = update.function === '_snapback.assetRecord'
          && Number.isSafeInteger(update.version)
          && update.version === handle.version;
        if (!durableVersionAdvances(handle.version, update.version) && !equalVersionAssetLifecycle) {
          return;
        }
        if (authorizationFaulted) return;
        if (authorizationFence) {
          try {
            authorizationFence.applyLiveSnapshot({
              fence: authorizationFence.capture(),
              snapshot: authorizationSnapshot(update),
              commit: commitAuthorizationBoundary,
            });
          } catch (error) {
            reportAuthorizationError(error);
          }
        } else {
          authoritativeRows = update.rows;
          presentedRows = authoritativeRows;
          handle.version = update.version;
          // T6 (LLP 0091 §0B.3): adopt the refreshed token with the
          // replacement rows it was minted from. A replacement is always
          // authoritative — retained/pending state ends here.
          if (update.resume && !legacySingleTableAdoption) {
            handle.rqsResume = update.resume;
            repairRqsRetentionFromDurable();
          }
          setHandleFreshness('current');
          handle.answerClass = 'authoritative';
          syncLiveRegistrationAnswer();
          schedulePersist();
          deliverAuthorityObservation(() => {
            onUpdate?.(authoritativeRows, {
              version: handle.version,
              kind: LIVE_DURABLE_KINDS.LIVE_REPLACE,
            });
          }, updateCapture);
        }
        return;
      }
      if (update.kind === LIVE_DURABLE_KINDS.CURRENT_AS_OF) {
        // LLP 0091 §0B.3 T3-T5: "your held rows are current as of N" —
        // advance version and adopt the mandatory fresh token without
        // touching rows; never regress on a lower version (T5); duplicate
        // delivery of the same frame is an idempotent no-op (T4).
        if (update.subscription_id !== handle.subscriptionId) return;
        if (terminalQueryDeleted()) {
          reportTerminalReuse(LIVE_DURABLE_KINDS.CURRENT_AS_OF);
          return;
        }
        if (typeof update.version === 'number' && update.version < handle.version) return;
        if (authorizationFaulted) return;
        handle.version = update.version;
        if (update.resume && !legacySingleTableAdoption) {
          handle.rqsResume = update.resume;
          repairRqsRetentionFromDurable();
        }
        // The rung-1 authoritative answer: held (persisted-seeded) rows are
        // proved current without touching them.
        setHandleFreshness('current');
        handle.answerClass = 'authoritative';
        syncLiveRegistrationAnswer();
        if (pendingResumeConfirmation) {
          // Least-recently-resumed bookkeeping (LLP 0091 §0A.5): recency is
          // the last SUCCESSFUL authoritative resume of the persisted entry.
          pendingResumeConfirmation = false;
          void chainStoreWrite(() => resumeStore.markResumed(resumeStoreKey));
        }
        schedulePersist();
        deliverAuthorityObservation(() => {
          onUpdate?.(authoritativeRows, {
            version: handle.version,
            kind: LIVE_DURABLE_KINDS.CURRENT_AS_OF,
          });
        }, updateCapture);
        return;
      }
      if (update.kind === LIVE_DURABLE_KINDS.LIVE_DELTA) {
        // DK-3 op-log delta (LLP 0008 §Decision DK-3): the server sends only
        // the rows that entered/left/changed this subscription's result, for
        // the analyzable unordered subset. Apply by _id: add/update upsert,
        // remove drops. Same subscription-id and strictly-newer version guards
        // as live_replace. Unordered by contract (ordered queries fall back to
        // live_replace), so preserving existing order and appending new rows is
        // correct.
        if (update.subscription_id !== handle.subscriptionId) return;
        if (terminalQueryDeleted()) {
          reportTerminalReuse(LIVE_DURABLE_KINDS.LIVE_DELTA);
          return;
        }
        if (!durableVersionAdvances(handle.version, update.version)) return;
        if (authorizationFaulted) return;
        const nextRows = applyLiveDeltaById(authoritativeRows, update.ops);
        if (authorizationFence) {
          try {
            authorizationFence.applyLiveSnapshot({
              fence: authorizationFence.capture(),
              snapshot: { rows: nextRows, version: update.version },
              commit: commitAuthorizationBoundary,
            });
          } catch (error) {
            reportAuthorizationError(error);
          }
        } else {
          // Mark the persisted entry in-progress before mutating the held
          // rows (LLP 0091 §0A.5): a crash between this application and the
          // debounced commit leaves the marker set, and the relaunch
          // verifier refuses the entry instead of resuming from a base the
          // server no longer recognizes.
          void chainStoreWrite(() => resumeStore.markInProgress(resumeStoreKey));
          authoritativeRows = nextRows;
          presentedRows = authoritativeRows;
          handle.version = update.version;
          // T7/T8 (LLP 0091 §0B.3): verify the post-apply digest against the
          // refreshed token's meta before adopting it. For a rung-2 replay
          // answer this is exactly T8's independent post-replay verification
          // — the state is authoritative only after the recomputed digest
          // matches. A mismatch means the held base has diverged from the
          // server's accumulator — discard the token and take the
          // client-side rung 3 (fresh subscribe).
          if (update.resume) {
            const digest = update.resume.meta?.contentDigest;
            if (digest && rowsMatchDigest(authoritativeRows, digest)) {
              if (!legacySingleTableAdoption) {
                handle.rqsResume = update.resume;
                repairRqsRetentionFromDurable();
              }
              if (pendingResumeConfirmation) {
                // Rung-2 replay completion is a successful authoritative
                // resume: bump the persisted entry's LRU recency exactly as
                // a rung-1 CurrentAsOf does (LLP 0091 §0A.5).
                pendingResumeConfirmation = false;
                void chainStoreWrite(() => resumeStore.markResumed(resumeStoreKey));
              }
            } else {
              handle.rqsResume = null;
              handle.answerClass = 'unknown';
              syncLiveRegistrationAnswer();
              void removePersistedEntry();
              void resubscribe('rqs_digest_mismatch');
              return;
            }
          }
          setHandleFreshness('current');
          handle.answerClass = 'authoritative';
          syncLiveRegistrationAnswer();
          schedulePersist();
          deliverAuthorityObservation(() => {
            onUpdate?.(authoritativeRows, {
              version: handle.version,
              kind: LIVE_DURABLE_KINDS.LIVE_DELTA,
            });
          }, updateCapture);
        }
        return;
      }
      if (update.kind === LIVE_DURABLE_KINDS.RESYNC_REQUIRED) {
        // Connection-wide outbox overflow carries no subscription_id
        // (src/ephemeral.rs OutboundQueue::overflow); subscription-scoped
        // resyncs (permission epoch changes, fan-out failures) do. Either
        // way the recovery is the same: fresh snapshot-with-subscribe.
        if (update.subscription_id && update.subscription_id !== handle.subscriptionId) return;
        if (terminalQueryDeleted()) {
          reportTerminalReuse(LIVE_DURABLE_KINDS.RESYNC_REQUIRED);
          return;
        }
        // A connection-wide sentinel cannot name the installing subscription,
        // but it still retires that exact attempt. Let the exclusive install
        // loop own its replacement; entering resubscribe() as well would add a
        // second demand owner for the same cut.
        if (
          typeof update.subscription_id !== 'string'
          && exclusiveSubscribeAttempt !== null
        ) {
          supersedeInstallingSubscription(exclusiveSubscribeAttempt, update);
          return;
        }
        // @ref LLP 0059#dated-amendment-total-client-authority-transition-state-and-settlement-matrix-2026-08-21-llp-0295-d02 — an in-band watch reload is retain-stale + one successor: fence the predecessor before yielding, project the bounded resync state, and retain its id only as the supersedes witness for the fresh subscribe below.
        if (typeof update.subscription_id === 'string') {
          resyncFencedSubscriptionId = update.subscription_id;
        }
        advanceSubscriptionPublicationGeneration();
        needsResubscribe = true;
        pendingResubscribeReason = resyncReason(update.reason);
        if (handle.freshness !== null) {
          handle.freshness = 'retained';
          handle.answerClass = 'labeled-retained';
        }
        setConnection('stale');
        syncLiveRegistrationAnswer();
        // clear_retained purges the persisted RQS copy too (LLP 0090 D3):
        // retained continuity is gone, so relaunch must not resume from it.
        if (update.clear_retained === true || update.clearRetained === true) {
          handle.rqsResume = null;
          handle.answerClass = deriveLegacyResumeAnswerV1({
            connected: true,
            verified: true,
            clearRetained: true,
          }).answerClass;
          void removePersistedEntry();
        }
        void resubscribe(pendingResubscribeReason);
      }
    };

    const replayPreSubscribeDurable = (attempt, subscriptionId) => {
      if (preSubscribeDurableAttempt === attempt) preSubscribeDurableAttempt = null;
      // Once the bound was exceeded, no prefix can prove continuity. Avoid a
      // transient current publication from the retained prefix; the caller
      // will clear the token and force a fresh snapshot below.
      if (attempt.overflowed) return true;
      for (const update of attempt.envelopes) {
        if (update.subscription_id === subscriptionId) applyDurable(update);
      }
      return false;
    };

    const subscribeFreshExclusive = async (
      lifecycle,
      externalBearerTransitionPermit = null,
    ) => {
      assertSubscribeLifecycle(lifecycle);
      // This handle's OWN previous subscription (reconnect/resync/resume
      // paths) is explicitly superseded; the first establish has none.
      // Capture only after acquiring the per-handle subscribe queue.
      let readinessRetries = 0;
      let ownedExclusiveAttempt = null;
      try {
        for (;;) {
          assertSubscribeLifecycle(lifecycle);
          const supersedes = pendingSupersedesSubscriptionId
            ?? handle.subscriptionId
            ?? initialSupersedes;
          const epochAtStart = socketLossEpoch;
          const demandEpochAtStart = resubscribeDemandEpoch;
          const durableAttempt = {
            envelopes: [],
            overflowed: false,
            subscriptionId: null,
            superseded: false,
            supersedingReason: null,
            publicationGeneration: subscriptionPublicationGeneration,
          };
          preSubscribeDurableAttempt = durableAttempt;
          exclusiveSubscribeAttempt = durableAttempt;
          ownedExclusiveAttempt = durableAttempt;
        let heldResume = null;
        let sub = null;
        try {
          // RQS dispatch rule 2 (LLP 0091 §0B.4): a fresh subscribe holding
          // verified rows + a resume token seeds the request with it —
          // reconnect still ALWAYS re-enters through this fresh subscribe
          // (the LLP 0034 §2.4 amendment: maybe-CurrentAsOf-with-subscribe).
          // Auth-scoped handles never hold a token (the server never mints
          // one for them); on relaunch the token comes from the persisted
          // Channel B entry seeded above.
          //
          // LLP 0090 D3 outbox rule, applied to EVERY fresh subscribe (not
          // only relaunch seeding): a client with pending queued intent
          // never resumes — it takes the LLP 0043 path (full snapshot, then
          // ordered replay). Delta-resume with pending mutations is the
          // explicitly deferred milestone. An unreadable outbox counts as
          // pending (fail closed to the full-resync path).
          let outboxHasPending = false;
          if (handle.rqsResume && resumeStore) {
            try {
              outboxHasPending = (await resumeStore.outboxEmpty()) !== true;
            } catch {
              outboxHasPending = true;
            }
          }
          heldResume = outboxHasPending ? null : handle.rqsResume;
          // Rung-2 membership witness (LLP 0090 D1.3 / LLP 0091 rung-2
          // amendment): for an mset1 result within the cap, name the exact
          // (rowId, oldRowHash) pairs so the server can prove predicate
          // exits and replay deltas. A non-witnessable result (seq1, over
          // cap, digest drift) still resumes — rung 1 and rung 3 remain.
          const membershipWitness = heldResume && legacyAdoptionCandidate === null
            ? membershipWitnessOfRows(authoritativeRows, heldResume.meta?.contentDigest)
            : null;
          const subscribeOptions = {
            connectionId,
            args,
            userId,
            correlation,
            supersedes,
            authorizationNamespace: queryNamespace,
            authorityCapture: expectedAuthorityCapture,
            resumeFromToken: heldResume
              ? {
                resume: heldResume,
                ...(membershipWitness ? { membershipWitness } : {}),
              }
              : null,
          };
          // Keep the generated reference through the last call boundary.
          // Collapsing it to `name` here silently drops argument validation
          // and expectedGeneration from fresh live admissions.
          // @ref LLP 0012#call-time-generation-binding — generated live
          //   subscriptions repeat the complete artifact generation tuple.
          sub = externalBearerTransitionPermit === EXTERNAL_BEARER_TRANSITION_PERMIT
            ? await client.#subscribeLive(
                ref,
                subscribeOptions,
                externalBearerTransitionPermit,
              )
            : await client.subscribeLive(ref, subscribeOptions);
          // Keep matching new-id frames buffered through asynchronous
          // materialization/authority installation, not merely through fetch.
          durableAttempt.subscriptionId = sub.subscription_id;
          if (durableAttempt.overflowed) {
            supersedeInstallingSubscription(durableAttempt, {
              reason: 'pre_subscribe_durable_overflow',
            });
          }
          for (const envelope of durableAttempt.envelopes) {
            if (
              envelope.kind === LIVE_DURABLE_KINDS.RESYNC_REQUIRED
              && envelope.subscription_id === sub.subscription_id
            ) {
              supersedeInstallingSubscription(durableAttempt, envelope);
              break;
            }
          }
          try {
            assertSubscribeLifecycle(lifecycle);
          } catch (error) {
            // The HTTP request cannot be cancelled after persistence. If its
            // owner paused/disposed meanwhile, explicitly retire the late id.
            bestEffortUnsubscribeLive(sub?.subscription_id);
            throw error;
          }
          if (durableAttempt.superseded) {
            if (preSubscribeDurableAttempt === durableAttempt) {
              preSubscribeDurableAttempt = null;
            }
            pendingSupersedesSubscriptionId = sub.subscription_id;
            initialSupersedes = null;
            continue;
          }
        } catch (error) {
          if (preSubscribeDurableAttempt === durableAttempt) {
            preSubscribeDurableAttempt = null;
          }
          const code = error?.diagnostic?.code;
          if (
            transport !== 'stream' ||
            error?.status !== 409 ||
            !LIVE_SUBSCRIBE_READINESS_RETRY_CODES.has(code) ||
            readinessRetries >= LIVE_SUBSCRIBE_READINESS_RETRIES
          ) {
            throw error;
          }
          readinessRetries += 1;
          const manager = client.liveStreamManager(connectionId, streamOptions);
          // A SOCKET_REQUIRED response commonly means the optimistic HTTP
          // subscribe beat the socket upgrade. SESSION_REPLACED means the
          // socket changed while the snapshot was loading. Both responses
          // are effect-free by server contract, so wait for a correlated
          // ping/pong on the current generation and retry only then. If a
          // generation had already been proven ready, revalidate it (or let
          // its loss move the wait to the replacement generation).
          await manager.waitUntilReady({
            revalidate: manager.isReady(),
            signal: lifecycle.signal,
          });
          // Cancellation and readiness can settle in adjacent microtasks.
          // Re-check immediately before the only replaying POST.
          assertSubscribeLifecycle(lifecycle);
          continue;
        }
        initialSupersedes = null;
        assertSubscribeLifecycle(lifecycle);
        const responseCapture = sub[AUTHORITY_CAPTURE] ?? null;
        const installationPublicationIsCurrent = () => (
          !durableAttempt.superseded
          && durableAttempt.publicationGeneration === subscriptionPublicationGeneration
        );
        let materializedSnapshot = null;
        let protectedRetentionSnapshot = null;
        try {
          if (preparedMaterialization) {
            // The proof commit is asynchronous, so admit its exact authority
            // capture first and carry the synchronous transport generation into
            // L2's final carrier transaction. A same-context or peer barrier
            // increments that generation during quiesce; an already-queued L2
            // commit then either precedes the barrier's store wipe or refuses
            // inside its transaction, never reintroducing predecessor bytes
            // after the wipe.
            // @ref LLP 0059#exposure-invariant — async hydration may publish only beneath the exact authority capture and participant barrier.
            const admission = await client.commitAuthorityPublication(
              responseCapture,
              () => client.__authTransportGeneration,
            );
            if (!admission.committed) throw staleAuthorityError();
            preparedMaterialization.context.publicationGuard = () => (
              client.__authTransportGeneration === admission.value
              && installationPublicationIsCurrent()
            );
          }
          materializedSnapshot = await installMaterializationSnapshot(sub);
          if (!installationPublicationIsCurrent()) {
            throw supersededSubscriptionInstallationError();
          }
          const installed = await client.commitAuthorityPublication(responseCapture, () => {
            assertSubscribeLifecycle(lifecycle);
            if (!installationPublicationIsCurrent()) {
              throw supersededSubscriptionInstallationError();
            }
            const predecessorSubscriptionId = currentSubscriptionId;
            currentSubscriptionId = sub.subscription_id;
            if (resyncFencedSubscriptionId === predecessorSubscriptionId) {
              resyncFencedSubscriptionId = null;
            }
            knownRetiredSubscriptionId = null;
            pendingSupersedesSubscriptionId = null;
            // Any successful fresh subscribe supersedes an earlier denial
            // fact (0137 A1-Expo f4): the presented authority is authorized.
            handle.authorizationDenial = null;
            handle.terminalDiagnosticCode = null;
            handleAuthorityCapture = responseCapture;
            if (!sub.authorizationScope) {
              if (sub.snapshot) {
                handle.version = sub.snapshot.version;
                authoritativeRows = materializedSnapshot?.rows ?? sub.snapshot.rows;
                presentedRows = authoritativeRows;
                // A fresh LiveReplace answer (rung 3 or a plain subscribe) is
                // authoritative (LLP 0090 D1 freshness rule).
                setHandleFreshness('current');
                handle.answerClass = 'authoritative';
              } else if (materializedSnapshot?.adoptedLegacy) {
                // The ordinary proof already established the exact held rows
                // under the QMK identity. After the one-transaction switch the
                // legacy token is discarded; v1 QMK re-entry is fresh.
                authoritativeRows = materializedSnapshot.rows;
                presentedRows = authoritativeRows;
                handle.version = sub.completenessProof.version.commit;
                handle.rqsResume = null;
                setHandleFreshness('current');
                handle.answerClass = 'authoritative';
                pendingResumeConfirmation = false;
              } else if (heldResume) {
                // Rung-1 or rung-2 answer pending: held rows stay retained
                // until the current_as_of (or replay live_delta) durable
                // envelope advances version + token.
                pendingResumeConfirmation = seededFromResumeState;
              }
              if (sub.resume && !legacySingleTableAdoption) handle.rqsResume = sub.resume;
              markAuthorityCapture(authoritativeRows, handleAuthorityCapture);
            }
            return true;
          });
          if (!installed.committed) throw staleAuthorityError();
          const preSubscribeDurableOverflowed = replayPreSubscribeDurable(
            durableAttempt,
            sub.subscription_id,
          );
          if (sub.authorizationScope) {
            await installAuthorizationSubscription(sub);
            protectedRetentionSnapshot = await installProtectedRetentionSnapshot(sub);
          } else if (preparedProtectedRetention) {
            // Public/rqsEligible queries keep using their server-minted RQS
            // token. Remove the metadata-only protected candidate so the two
            // persistence grammars never both claim the same query key.
            void client.__storeRuntimeInvoke(
              'deleteProtectedQueryRetention',
              preparedProtectedRetention,
            ).catch(() => {});
          }
          // Retainability classification (LLP 0129 Phase 0, refuse-with-
          // clarity). Only what LLP 0053 admits is retained: an auth-scoped
          // subscription's retained display is exclusively the LLP 0043/0053
          // lease machinery's decision (not carried by this arm), and a query
          // the server minted no resume token for is not rqsEligible
          // (authority-independent + closed inputs).
          if (materializedSnapshot) {
            handle.retention = Object.freeze({
              retainable: materializedSnapshot.retained,
              code: materializedSnapshot.retained
                ? null
                : 'SNAPBACK_RETENTION_OWNER_AUTHORITY_UNAVAILABLE',
              reason: materializedSnapshot.retained
                ? null
                : 'proof-validated live materialization is current, but no admissible durable retention authority was installed',
              store: client.rqsStoreInfo,
            });
          } else if (sub.authorizationScope) {
            handle.retention = Object.freeze({
              retainable: protectedRetentionSnapshot?.retained === true,
              code: protectedRetentionSnapshot?.retained === true
                ? null
                : 'SNAPBACK_RETENTION_NOT_RETAINABLE',
              reason: protectedRetentionSnapshot?.retained === true
                ? null
                : protectedRetentionSnapshot?.reason
                  ?? 'authority-scoped query: no valid LLP 0043/0053 AuthorizedLease was installed',
              store: client.rqsStoreInfo,
            });
          } else if (sub.resume || (heldResume && !sub.snapshot)) {
            // A rung-1/rung-2 acknowledgement is intentionally rowless and
            // tokenless: the fresh token rides CurrentAsOf/replay. The verified
            // server-minted token that seeded this accepted subscribe remains an
            // eligibility proof while that durable completion is pending.
            classifyRqsRetention();
          } else {
            handle.retention = Object.freeze({
              retainable: false,
              code: 'SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE',
              reason: rqsRetentionIneligibilityReason(ref),
              store: client.rqsStoreInfo,
            });
          }
          if (sub.authorizationScope) {
            // Eligibility gate at write time (LLP 0090 Authorization scope): an
            // auth-scoped subscription persists no RQS resume state, and any
            // stale persisted entry for it (a query whose declaration changed)
            // is invalidated rather than trusted on the next relaunch.
            if (seededFromResumeState) void removePersistedEntry();
          } else if (sub.snapshot) {
            if (sub.resume) {
              // Fresh authoritative state with a fresh token: persist at the
              // §0A.5 cadence. When the subscribe was seeded with a stale token
              // (refused generation/versionStream/expiry -> rung 3), this
              // commit is what discards the refused persisted state.
              schedulePersist();
            } else if (seededFromResumeState || handle.rqsResume) {
              // The server minted no token for this subscription (no longer —
              // or never — rqsEligible): drop the held token and the persisted
              // entry so relaunches subscribe fresh.
              handle.rqsResume = null;
              void removePersistedEntry();
            }
          }
          if (preSubscribeDurableOverflowed) {
            // The response id is known, but at least one establishment-era frame
            // was lost to the bound. Do not claim current or reuse the token:
            // force the next serialized subscribe down rung 3 for a fresh
            // authoritative snapshot.
            handle.rqsResume = null;
            pendingResumeConfirmation = false;
            handle.freshness = 'retained';
            handle.answerClass = 'labeled-retained';
            void removePersistedEntry();
            resubscribeDemandEpoch = safeNextCounter(
              resubscribeDemandEpoch,
              'SNAPBACK_CLIENT_RESUBSCRIBE_GENERATION_EXHAUSTED',
              'resubscribe demand generation',
            );
            needsResubscribe = true;
            pendingResubscribeReason = 'pre_subscribe_durable_overflow';
            syncLiveRegistrationAnswer();
          }
          assertSubscribeLifecycle(lifecycle);
        } catch (error) {
          if (
            error?.code === 'SNAPBACK_LIVE_QUERY_INSTALLATION_SUPERSEDED'
            || !installationPublicationIsCurrent()
          ) {
            pendingSupersedesSubscriptionId = sub.subscription_id;
            continue;
          }
          bestEffortUnsubscribeLive(sub.subscription_id);
          throw error;
        } finally {
          if (preSubscribeDurableAttempt === durableAttempt) {
            preSubscribeDurableAttempt = null;
          }
          if (preparedMaterialization) {
            preparedMaterialization.context.publicationGuard = null;
          }
        }
        // Any successful fresh subscribe satisfies an outstanding need — clear
        // it here so every path (establish, resume, resubscribe) agrees —
        // UNLESS a socket loss raced the in-flight request (ENG-23428): the
        // lost socket's server-side disconnect may have destroyed the very
        // subscription this call created, so the need persists and the
        // retry/grace/drain paths re-enter with a fresh subscribe. A resync
        // demand that landed while this request was in flight persists the
        // need the same way (ENG-23429): this snapshot may predate the state
        // the demand signals, and the sentinel is never re-emitted.
        if (socketLossEpoch === epochAtStart && resubscribeDemandEpoch === demandEpochAtStart) {
          needsResubscribe = false;
          resubscribeAttempts = 0;
          clearResubscribeRetry();
        }
        syncLiveRegistrationAnswer();
        // LLP 0129 Phase 0: a landed fresh snapshot is this subscription's
        // full-resync barrier — schedule the single-flight outbox drain
        // (LLP 0008 §Mutation Replay: resync first, then ordered replay).
        if (sub.snapshot) client.#scheduleOutboxReplay();
        // Every fresh snapshot is a new canonical base, including pause/resume
        // and reconnect. Re-deliver it through the wrapped update owner so
        // generated layers replay after every subscribeFresh transition rather
        // than only during first establishment or retained-seed replacement.
        // Auth-scoped delivery stays with the fence machinery.
        if (sub.snapshot && !sub.authorizationScope && !disposed) {
          seedFrameDelivered = false;
          if (installationPublicationIsCurrent()) {
            deliverAuthorityObservation(() => {
              onUpdate?.(authoritativeRows, {
                version: handle.version,
                kind: 'snapshot',
                freshness: 'current',
                answerClass: 'authoritative',
              });
            });
          }
        }
        return sub;
        }
      } finally {
        if (exclusiveSubscribeAttempt === ownedExclusiveAttempt) {
          exclusiveSubscribeAttempt = null;
        }
      }
    };

    const subscribeFresh = (externalBearerTransitionPermit = null) => {
      const lifecycle = currentSubscribeLifecycle();
      const queueGeneration = freshSubscribeQueueGenerations.get(lifecycle.signal) ?? 0;
      freshSubscribePending += 1;
      const attempted = freshSubscribeTail.then(() => {
        // A same-lifecycle predecessor may have failed ambiguously after this
        // work was queued. Do not let the tail's neutralized rejection release
        // a sibling POST that captured the same old `supersedes` value. A new
        // lifecycle has a new signal and is intentionally not poisoned.
        if (
          queueGeneration !== (freshSubscribeQueueGenerations.get(lifecycle.signal) ?? 0)
        ) {
          throw subscribeQueueInvalidatedError();
        }
        return subscribeFreshExclusive(lifecycle, externalBearerTransitionPermit);
      });
      const queued = attempted.then(
        (value) => value,
        (error) => {
          if (
            error?.code !== 'SNAPBACK_LIVE_QUERY_SUBSCRIBE_QUEUE_INVALIDATED' &&
            queueGeneration === (freshSubscribeQueueGenerations.get(lifecycle.signal) ?? 0)
          ) {
            // Advance this lifecycle before releasing the FIFO tail. Its
            // already-queued work is rejected before the first POST; later
            // explicit recovery (or a new lifecycle) captures a fresh
            // generation and can proceed.
            freshSubscribeQueueGenerations.set(lifecycle.signal, queueGeneration + 1);
          }
          throw error;
        },
      );
      // Keep the mutex usable after rejection, while attaching a rejection
      // handler immediately so a cancelled queued attempt is never unhandled.
      freshSubscribeTail = queued.then(() => undefined, () => undefined);
      return queued.then(
        (value) => {
          freshSubscribePending -= 1;
          return value;
        },
        (error) => {
          freshSubscribePending -= 1;
          throw error;
        },
      );
    };

    // After a successful (re)subscribe, settle the connection value from the
    // actual transport state — never promote to 'live' on hope.
    const settleConnectionAfterSubscribe = () => {
      if (disposed || paused) return;
      if (transport !== 'stream') {
        setConnection('polling');
        return;
      }
      const manager = client.liveStreamManager(connectionId, streamOptions);
      if (manager.isOpen()) {
        streamedSinceSubscribe = true;
        setConnection('live');
      } else if (fellBack) {
        setConnection('polling');
      } else if (!fallbackToPoll) {
        setConnection('stale');
      }
      // else: the socket is still in flight; stay 'connecting' until the
      // manager reports open/lost.
    };

    const clearResubscribeRetry = () => {
      if (resubscribeRetryTimer) {
        clearTimeout(resubscribeRetryTimer);
        resubscribeRetryTimer = null;
      }
    };

    // Retry while the need persists (LLP 0034 review fix 2): a failed
    // re-subscribe schedules a bounded-backoff retry, and the drain path
    // below ALSO re-enters on every poll tick — a transient server error can
    // never strand the handle without a subscription.
    const scheduleResubscribeRetry = (reason) => {
      if (disposed || paused || resubscribeRetryTimer || !needsResubscribe) return;
      const delay = Math.min(
        LIVE_RECONNECT_BASE_DELAY_MS * 2 ** resubscribeAttempts,
        LIVE_RECONNECT_MAX_DELAY_MS,
      );
      resubscribeAttempts += 1;
      resubscribeRetryTimer = setTimeout(() => {
        resubscribeRetryTimer = null;
        if (!disposed && !paused && needsResubscribe) void resubscribe(reason);
      }, delay);
      resubscribeRetryTimer.unref?.();
    };

    // Reconnect/resync re-entry: always a fresh subscribe_live (see the policy
    // block at the top of this file — the server drops a connection's durable
    // subscriptions on socket close, so there is nothing to resume). Returns
    // whether the fresh subscribe LANDED; a failure keeps needsResubscribe set
    // and schedules a retry — the connection value is only ever promoted after
    // a success (via settleConnectionAfterSubscribe). Note: on in-band resyncs
    // (overflow, permission epoch) the superseded subscription may remain
    // registered server-side until the connection disconnects or is reaped;
    // its updates are ignored by subscription-id filtering above.
    const resubscribe = async (reason) => {
      if (disposed || paused) return false;
      if (terminalQueryDeleted()) {
        needsResubscribe = false;
        clearResubscribeRetry();
        setConnection('disconnected');
        return false;
      }
      if (resubscribing) {
        // A resync demand arrived while another fresh subscribe is in
        // flight (e.g. the connection's one-shot overflow sentinel drained
        // mid-resubscribe, ENG-23429). Swallowing it would lose the only
        // signal for the deltas dropped after the in-flight snapshot was
        // taken (LLP 0008: overflow is a resync signal, never a drop) —
        // record the demand so the in-flight run loops for another fresh
        // subscribe once its POST resolves, and keep the need visible to
        // the retry/drain paths in case that run fails instead.
        resubscribeDemandEpoch = safeNextCounter(
          resubscribeDemandEpoch,
          'SNAPBACK_CLIENT_RESUBSCRIBE_GENERATION_EXHAUSTED',
          'resubscribe demand generation',
        );
        needsResubscribe = true;
        pendingResubscribeReason = reason;
        syncLiveRegistrationAnswer();
        return false;
      }
      // Resume/establish also use the fresh-subscribe queue. A resync demand
      // that arrives while either is pending must remain visible if that
      // older snapshot was already in flight, just like a demand arriving
      // during the traditional resubscribe loop.
      if (freshSubscribePending > 0) {
        resubscribeDemandEpoch = safeNextCounter(
          resubscribeDemandEpoch,
          'SNAPBACK_CLIENT_RESUBSCRIBE_GENERATION_EXHAUSTED',
          'resubscribe demand generation',
        );
      }
      resubscribing = true;
      needsResubscribe = true;
      pendingResubscribeReason = reason;
      syncLiveRegistrationAnswer();
      let attemptReason = reason;
      try {
        for (;;) {
          const demandEpochBefore = resubscribeDemandEpoch;
          await subscribeFresh();
          emitEvent('resubscribed', { reason: attemptReason });
          settleConnectionAfterSubscribe();
          if (disposed || paused || resubscribeDemandEpoch === demandEpochBefore) return true;
          // A demand landed while that subscribe was in flight: its
          // snapshot may be stale relative to the demand — go around with
          // another fresh subscribe (which supersedes the one just landed).
          attemptReason = pendingResubscribeReason;
        }
      } catch (error) {
        if (error?.code === 'SNAPBACK_LIVE_QUERY_SUBSCRIBE_QUEUE_INVALIDATED') {
          return false;
        }
        if (!disposed && !paused) {
          if (onConnectionChange) {
            deliverAuthorityObservation(() => {
              deliverIsolated(onConnectionChange, connection, { previous: connection, error });
            });
          }
          if (isTerminalLiveProtocolRefusal(error)) {
            needsResubscribe = false;
            clearResubscribeRetry();
            setConnection('disconnected');
          } else {
            scheduleResubscribeRetry(pendingResubscribeReason);
          }
        }
        return false;
      } finally {
        resubscribing = false;
      }
    };

    const drainOnce = async () => {
      // A broken subscription drains nothing (a disconnect-destroyed outbox
      // returns [] and looks healthy): re-enter the fresh subscribe on every
      // drain tick until it lands (LLP 0034 review fix 2, polling variant).
      if (needsResubscribe && !resubscribing) {
        await resubscribe(pendingResubscribeReason);
      }
      // HTTP outbox drain through the shared choke point: one bounded queue
      // per connection, durable lane first, then resync, then coalesced
      // ephemeral (OutboundQueue::drain — durable-over-ephemeral priority,
      // LLP 0013 §delivery-lanes). Routing applies durable updates to this
      // handle via its registered consumer AND delivers both lanes to every
      // other registered consumer on the connection — no cross-lane or
      // cross-handle discards (LLP 0034 §10.1 / ENG-22478).
      await client.drainConnection(connectionId);
      if (fellBack && fallbackToPoll && !needsResubscribe) {
        // A transient drain failure reports 'stale'. The declared poll
        // fallback becomes healthy again after the next successful drain.
        setConnection('polling');
      }
      return handle.rows;
    };

    const stopFallback = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const startFallback = () => {
      if (fallbackTimer || disposed || paused) return;
      fallbackTimer = setInterval(() => {
        drainOnce().catch(() => {
          // Poll failures while the socket also retries: budget missed.
          setConnection('stale');
        });
      }, pollCadenceMs);
      // Background timers never hold a headless process open (no-op in browsers).
      fallbackTimer.unref?.();
    };

    const attachStream = () => {
      const manager = client.liveStreamManager(connectionId, streamOptions);
      // Durable socket frames arrive through the connection's lane registry
      // (this handle registered applyDurable there), the same path HTTP
      // drains use — one delivery pipeline for both transports (ENG-22478
      // review: mixed-transport unification).
      const offState = manager.onState((state, detail = {}) => {
        if (disposed || paused) return;
        if (state === 'open') {
          streamedSinceSubscribe = true;
          stopFallback();
          if (handle.subscriptionId === null) return; // establishment still in flight
          emitEstablishedOnce(); // transport settled: push
          fellBack = false;
          if (needsResubscribe) {
            // The lost socket's server-side disconnect dropped this
            // connection's subscriptions and no fresh subscribe has landed
            // yet: re-enter through snapshot-with-subscribe. Promotion to
            // 'live' happens INSIDE resubscribe, only on success; on failure
            // the handle stays 'connecting' and the retry loop re-enters.
            setConnection('connecting');
            void resubscribe('reconnect');
          } else {
            // The current subscription is valid (re-created since the last
            // loss by the fallback/grace/retry paths, or the original when no
            // constructed socket has died since it landed); the regained
            // socket drains the same connection outbox — no second snapshot.
            setConnection('live');
          }
          return;
        }
        if (state === 'lost') {
          streamedSinceSubscribe = false;
          emitEstablishedOnce(); // transport settled: poll fallback
          // Unconfirmed-resume self-heal (0137 A1-Expo f7, the permanent
          // public-blanking mechanism): a token-seeded subscribe can be
          // answered without a snapshot (rung 1/2 "answer pending"), holding
          // whatever rows the handle already had until CurrentAsOf/replay
          // confirms. If the socket dies BEFORE confirmation, those held
          // rows were never proved current — and re-seeding the next
          // subscribe from the same token can re-present a poisoned (blank)
          // hold forever on a cycling carrier. Drop the unconfirmed token:
          // the fresh subscribe then requests a full snapshot (rung 3) and
          // re-primes rows authoritatively within one cycle. Freshness
          // honestly returns to 'retained' for the held presentation.
          if (pendingResumeConfirmation) {
            pendingResumeConfirmation = false;
            handle.rqsResume = null;
            if (handle.freshness === 'current') {
              handle.freshness = 'retained';
              handle.answerClass = 'labeled-retained';
            }
          }
          // EVERY loss requires a fresh subscribe (ENG-23428): the server
          // registers the stream task at upgrade completion, before any
          // frame, and its teardown runs disconnect — dropping this
          // connection's durable subscriptions AND its outbox. So a socket
          // that never fired client 'open' (stalled 101, connect-budget
          // force-close) may still have destroyed them, and the client
          // cannot tell. A redundant fresh subscribe is safe — it
          // explicitly supersedes its own predecessor — while a skipped one
          // is permanent silent staleness on a destroyed outbox. (When a
          // reconnect superseded this socket server-side the generation
          // guard skips the drop; the subscribe is then merely redundant.)
          socketLossEpoch = safeNextCounter(
            socketLossEpoch,
            'SNAPBACK_CLIENT_SOCKET_LOSS_GENERATION_EXHAUSTED',
            'socket-loss generation',
          );
          needsResubscribe = true;
          pendingResubscribeReason = 'reconnect';
          if (fallbackToPoll) {
            setConnection('polling');
            fellBack = true;
            // First re-subscribe attempt after a short grace so the server
            // has processed the close; failures are covered by the retry
            // loop AND every fallback drain tick (needsResubscribe gates
            // all of them, so exactly one fresh subscribe lands).
            setTimeout(() => {
              if (!disposed && !paused && needsResubscribe && handle.subscriptionId !== null) {
                void resubscribe('reconnect');
              }
            }, RESUBSCRIBE_AFTER_LOSS_DELAY_MS).unref?.();
            startFallback();
          } else {
            // Fallback disabled: hold at 'stale' with last-known rows; the
            // fresh subscribe re-enters on socket regain (open handler), and
            // a failure there is covered by the retry loop.
            setConnection('stale');
          }
          return;
        }
        if (state === 'budget-missed') {
          setConnection('stale');
          return;
        }
        if (state === 'closed') {
          setConnection('disconnected');
        }
      });
      return () => {
        offState();
      };
    };

    const unregisterAuthMaterialization = client.registerAuthMaterialization({
      capture: () => handleAuthorityCapture,
      blank: (context = {}) => {
        if (disposed) return;
        // @ref LLP 0059#typed-terminal-auth-error — terminal authority loss
        // has an independent server cleanup owner. Record only this handle's
        // exact generation so later unmount/dispose is local and idempotent.
        if (context.terminal === true) {
          markKnownSubscriptionRetired(handle.subscriptionId);
        }
        paused = true;
        needsResubscribe = true;
        invalidateSubscribeLifecycle('authority-blanked');
        stopFallback();
        clearResubscribeRetry();
        detachStream?.();
        detachStream = null;
        authoritativeRows = createClientOwnedLifecycleBlankCarrier();
        presentedRows = authoritativeRows;
        // Delivery facts belong to the retired authority. A custody blank is
        // not an authoritative publication and starts the successor world at
        // the same null/zero baseline as a newly created headless handle.
        // @ref LLP 0059#dated-amendment-total-client-authority-transition-state-and-settlement-matrix-2026-08-21-llp-0295-d02 — auth blank retires predecessor delivery facts.
        handle.lastDeliveryAtMs = null;
        handle.authoritativeRevision = 0;
        handle.deliveryLagMs = null;
        handle.__coveredMutationCostObservationSequences.clear();
        handle.freshness = null;
        handle.answerClass = 'unknown';
        handle.authorizationDisposition = 'delete';
        // The custody blank opens a new authority world: a predecessor
        // world's denial fact must not linger into it (0137 A1-Expo f4).
        handle.authorizationDenial = null;
        markAuthorityCapture(authoritativeRows, handleAuthorityCapture);
        const terminalError = context.terminal === true
          ? context.terminalError ?? staleAuthorityError()
          : null;
        handle.terminalDiagnosticCode = terminalError?.diagnostic?.code
          ?? terminalError?.code
          ?? null;
        const detail = {
          version: handle.version,
          kind: terminalError === null ? 'authorization_delete' : 'authorization_error',
          terminal: terminalError !== null,
          authorization: {
            kind: context.disposition ?? 'delete',
            reason: context.reason ?? 'authority_blanked',
          },
          ...(terminalError === null ? {} : { error: terminalError }),
        };
        try { onAuthorizationBoundary?.(authoritativeRows, detail); } catch { /* blank remains */ }
        deliverIsolated(onUpdate, authoritativeRows, detail);
        setConnection('disconnected');
      },
    });

    // Drained durable updates reach this handle through the connection's
    // lane router (covers manual poll(), the fallback timer, AND any other
    // consumer's drain on the same connection — the pre-D2 "whoever drains
    // first steals the updates" gap).
    const unregisterDurable = client.registerDurableConsumer(connectionId, applyDurable);

    // Register-mode adoption (LLP 0090 D4 / LLP 0031 dated amendment): the
    // bundle already created this subscription at its single-commit cut and
    // returned the fresh snapshot in the same response — adopting it here is
    // what makes "no duplicate fresh snapshot" true on the wire.
    // @ref LLP 0112#registered-boot — auth-scoped registered entries install
    // the exact scope/invalidation and connection expectation before their
    // rows become observable; adoption never fresh-subscribes around a
    // partial authorization projection.
    const adoptRegisteredSubscription = async () => {
      if (!registeredSubscription) return false;
      const {
        subscriptionId,
        rows,
        version,
        resume,
        authorization = null,
      } = registeredSubscription;
      if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) return false;
      if (authorization !== null) {
        if (!authorizationProtocolEnabled) {
          throw new Error(
            'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED: registered auth-scoped rows require the negotiated invalidation protocol',
          );
        }
        const normalizedScope = validateScopeId(
          authorization.scope,
          'registeredSubscription.authorization.scope',
        );
        if (
          normalizedScope.kind !== 'subscription'
          || queryNamespace === null
          || JSON.stringify(normalizedScope.namespace) !== JSON.stringify(queryNamespace)
          || normalizedScope.subscriptionId !== subscriptionId
        ) {
          throw new Error(
            'SNAPBACK_AUTH_INVALIDATION_CORRUPT: registered authorization scope crossed subscription identity',
          );
        }
        const grant = await client.connectionGrant(connectionId);
        const syntheticSubscribe = {
          subscription_id: subscriptionId,
          snapshot: {
            rows: Array.isArray(rows) ? rows : [],
            version: typeof version === 'number' ? version : 0,
          },
          authorizationScope: authorization.scope,
          authorizationInvalidation: authorization.invalidation ?? null,
          scopeRetirements: [],
        };
        Object.defineProperty(syntheticSubscribe, AUTHORIZATION_CONNECTION, {
          value: grant.authorizationInvalidation,
        });
        await installAuthorizationSubscription(syntheticSubscribe);
      } else {
        // Authority-independent registered children own no LLP 0053 query
        // namespace. Their later recovery subscribe re-enters without one.
        queryNamespace = null;
      }
      currentSubscriptionId = subscriptionId;
      knownRetiredSubscriptionId = null;
      authoritativeRows = Array.isArray(rows) ? rows : [];
      presentedRows = authoritativeRows;
      handle.version = typeof version === 'number' ? version : 0;
      // Auth-scoped entries carry `resume: null` in both modes (LLP 0092
      // §0D.1) — the handle simply holds no token, exactly like a fresh
      // subscribe that minted none.
      handle.rqsResume = !legacySingleTableAdoption
        && resume && typeof resume.token === 'string' ? resume : null;
      // The bundle snapshot is authoritative (LLP 0053's fresh snapshot,
      // taken once): 'current', never retained/pending.
      setHandleFreshness('current');
      handle.answerClass = 'authoritative';
      schedulePersist();
      deliverAuthorityObservation(() => {
        onUpdate?.(authoritativeRows, {
          version: handle.version,
          kind: 'registered',
          freshness: 'current',
        });
      });
      return true;
    };

    // On subscribe failure the attached stream must not leak (LLP 0034 review
    // fix 5): detach (dropping manager demand closes the shared socket when
    // this was its only consumer), mark the handle disposed, and rethrow —
    // liveQuery() fails loudly and leaves nothing running.
    const establishUnchecked = async () => {
      setConnection('connecting');
      if (registeredSubscription) {
        detachStream = attachStream();
        const attachDeadline = registeredSubscription.attachDeadline;
        const remaining = Number.isSafeInteger(attachDeadline)
          ? attachDeadline - Date.now()
          : 0;
        if (remaining <= 0) {
          const error = new Error(
            'SNAPBACK_REACT_GROUP_ATTACH_EXPIRED: registered bundle attach deadline elapsed',
          );
          error.code = 'SNAPBACK_REACT_GROUP_ATTACH_EXPIRED';
          throw error;
        }
        try {
          await client.liveStreamManager(connectionId, streamOptions).waitUntilReady({
            timeoutMs: remaining,
          });
        } catch (cause) {
          if (Date.now() >= attachDeadline) {
            const error = new Error(
              'SNAPBACK_REACT_GROUP_ATTACH_EXPIRED: registered bundle could not attach before its deadline',
              { cause },
            );
            error.code = 'SNAPBACK_REACT_GROUP_ATTACH_EXPIRED';
            throw error;
          }
          throw cause;
        }
      }
      const adoptedRegistration = await adoptRegisteredSubscription();
      if (!adoptedRegistration && preparedMaterialization) {
        try { await seedFromMaterializationState(); } catch { /* invalid retained state stays unknown */ }
      }
      if (!adoptedRegistration && !seededFromMaterialization && preparedProtectedRetention) {
        try { await seedFromProtectedRetentionState(); } catch { /* delete/refusal stays unknown */ }
      }
      // Channel B relaunch flow (LLP 0090 D3): load + verify the persisted
      // entry, render-first as retained, and let the fresh subscribe below
      // carry the seeded token. Seeding failures leave today's cold boot.
      // An adopted register-mode bundle IS the fresh authoritative state, so
      // persisted/preloaded candidates are not consulted for it.
      if (
        !adoptedRegistration
        && !seededFromMaterialization
        && !seededFromProtectedRetention
        && ((resumeStore && resumeStoreKey) || preloadedResume)
      ) {
        try { await seedFromResumeState(); } catch { /* cold boot */ }
      }
      if (transport === 'stream' && detachStream === null) {
        detachStream = attachStream();
      }
      if (adoptedRegistration) {
        // No fresh subscribe: the registration is live server-side under the
        // pending owner (or, after attach, the socket session); deltas reach
        // this handle through the shared lane router by subscription id.
        if (transport === 'stream') {
          const manager = client.liveStreamManager(connectionId, streamOptions);
          if (manager.isOpen()) {
            streamedSinceSubscribe = true;
            setConnection('live');
            emitEstablishedOnce();
          } else if (fellBack) {
            emitEstablishedOnce();
          } else {
            const budget = streamOptions.freshnessBudgetMs ?? LIVE_FRESHNESS_BUDGET_MS;
            establishTimer = setTimeout(() => {
              establishTimer = null;
              emitEstablishedOnce();
            }, budget);
            establishTimer.unref?.();
          }
        } else {
          setConnection('polling');
          emitEstablishedOnce();
        }
        return;
      }
      try {
        await subscribeFresh();
        if (needsResubscribe) {
          await resubscribe(pendingResubscribeReason);
        }
      } catch (error) {
        // Cold-boot offline survival (LLP 0129 Phase 0): when this handle
        // was seeded from a VERIFIED persisted entry and the first fresh
        // subscribe was refused by connectivity (server unreachable), the
        // handle stays alive rendering retained rows — the exact scenario
        // Diary 0027 recorded as Convex's cold-boot GAP — and re-enters
        // through the ordinary bounded-backoff fresh-subscribe retry when
        // the server returns. Every other failure (server refusals, auth,
        // protocol) keeps the LLP 0034 contract: fail loudly, run nothing.
        if (
          !disposed
          && (
            seededFromResumeState
            || seededFromMaterialization
            || seededFromProtectedRetention
          )
          && handle.freshness === 'retained'
          && isConnectivityFailureError(error)
        ) {
          handle.retention ??= Object.freeze({
            retainable: true,
            code: null,
            reason: 'offline boot from verified persisted entry',
            store: client.rqsStoreInfo,
          });
          needsResubscribe = true;
          pendingResubscribeReason = 'offline_boot';
          setConnection('stale');
          scheduleResubscribeRetry('offline_boot');
          emitEstablishedOnce();
          return;
        }
        disposed = true;
        invalidateSubscribeLifecycle('disposed');
        stopFallback();
        clearResubscribeRetry();
        unregisterAuthMaterialization();
        unregisterExternalBearerHandle();
        unregisterDurable();
        detachStream?.();
        detachStream = null;
        setConnection('disconnected');
        throw error;
      }
      if (transport === 'stream') {
        const manager = client.liveStreamManager(connectionId, streamOptions);
        if (manager.isOpen()) {
          streamedSinceSubscribe = true;
          setConnection('live');
          emitEstablishedOnce(); // push, deterministically
        } else if (fellBack) {
          emitEstablishedOnce(); // the socket already failed: poll fallback
        } else {
          // Socket still in flight: defer the receipt until it settles
          // (open -> push, lost -> poll), with the freshness budget as the
          // bound so the receipt cannot dangle on a swallowed connect.
          const budget = streamOptions.freshnessBudgetMs ?? LIVE_FRESHNESS_BUDGET_MS;
          establishTimer = setTimeout(() => {
            establishTimer = null;
            emitEstablishedOnce();
          }, budget);
          establishTimer.unref?.();
        }
      } else {
        setConnection('polling');
        emitEstablishedOnce();
      }
    };

    const establish = async () => {
      try {
        await establishUnchecked();
      } catch (error) {
        // Registered adoption can fail before the ordinary subscribe branch
        // (missing/expired attach authority or a failed socket readiness
        // proof). Tear down the same resources as a failed fresh subscribe;
        // no rejected boot may retain client demand past the server's bounded
        // pending owner.
        //
        // @ref LLP 0092#0d4-attach-grace-reaping-and-pending-owner-bounds
        if (isSubscribeAuthorizationDenial(error, {
          authorityFence: client.authorityFence,
          capture: error?.[AUTHORITY_CAPTURE] ?? handleAuthorityCapture,
        })) recordAuthorizationDenial(error);
        disposed = true;
        invalidateSubscribeLifecycle('disposed');
        stopFallback();
        clearResubscribeRetry();
        unregisterAuthMaterialization();
        unregisterExternalBearerHandle();
        unregisterDurable();
        detachStream?.();
        detachStream = null;
        setConnection('disconnected');
        throw error;
      }
    };

    handle.poll = async () => {
      if (disposed || paused) return handle.rows;
      return drainOnce();
    };

    // Immediate Channel B flush — the pagehide/visibility-hidden path made
    // callable (embedders with their own lifecycle events, and tests).
    handle.flushResumeState = () => persistResumeStateNow();

    // Host lifecycle is provider/kit policy, not view logic (Exact LLP 0284
    // §2.1 rule 4): pause quiesces this handle's transports (no retry is
    // scheduled -> 'disconnected'); resume re-enters through a fresh
    // snapshot-with-subscribe and a 'resubscribed' event.
    handle.pause = (externalBearerTransitionPermit = null) => {
      if (disposed) return Promise.resolve();
      if (paused) return pauseReleasePromise;
      paused = true;
      const staleSubscriptionId = handle.subscriptionId;
      // Backgrounding analog of the visibility-hidden flush (§0A.5).
      void persistResumeStateNow();
      invalidateSubscribeLifecycle('paused');
      stopFallback();
      clearResubscribeRetry();
      detachStream?.();
      detachStream = null;
      setConnection('disconnected');
      // T-UNSUB is the durable demand-release transition. Detaching from a
      // shared manager only releases local socket demand; the exact server
      // subscription must be retired independently before resume re-enters.
      const pausedRetirementState = authorizationTaskState(
        handleAuthorityCapture,
        { allowPaused: true },
      );
      pauseReleasePromise = unsubscribeLiveForLifecycle(
        staleSubscriptionId,
        pausedRetirementState,
        externalBearerTransitionPermit,
      );
      return pauseReleasePromise;
    };

    handle.resume = async (externalBearerTransitionPermit = null) => {
      if (disposed || !paused) return;
      // A caller may invoke resume without awaiting pause. Serialize the
      // fresh superseding subscribe after the old demand-release attempt.
      try { await pauseReleasePromise; } catch { /* fresh supersession can recover */ }
      if (terminalQueryDeleted()) {
        setConnection('disconnected');
        return;
      }
      paused = false;
      beginSubscribeLifecycle();
      const resumeLifecycleEpoch = subscribeLifecycleEpoch;
      setConnection('connecting');
      if (transport === 'stream') {
        detachStream = attachStream();
      }
      try {
        await subscribeFresh(externalBearerTransitionPermit);
      } catch (error) {
        // A pause/dispose (or a newer resume after that pause) already owns
        // cleanup. This stale continuation must not detach the newer stream
        // or force its handle back into the paused state.
        if (
          disposed ||
          paused ||
          subscribeLifecycleEpoch !== resumeLifecycleEpoch
        ) {
          throw error;
        }
        // Do not leak the re-attached stream (LLP 0034 review fix 5): return
        // to the paused state so the caller may retry resume() later.
        stopFallback();
        clearResubscribeRetry();
        detachStream?.();
        detachStream = null;
        paused = true;
        invalidateSubscribeLifecycle('paused');
        setConnection('disconnected');
        // An ANSWERED authorization refusal is this handle's completed
        // outcome under the presented authority — project it as a
        // renderable fact before the throw (0137 A1-Expo f4).
        if (isSubscribeAuthorizationDenial(error, {
          authorityFence: client.authorityFence,
          capture: error?.[AUTHORITY_CAPTURE] ?? handleAuthorityCapture,
        })) recordAuthorizationDenial(error);
        throw error;
      }
      const manager = transport === 'stream' ? client.liveStreamManager(connectionId, streamOptions) : null;
      if (manager?.isOpen()) {
        streamedSinceSubscribe = true;
        setConnection('live');
      } else if (transport === 'stream' && fallbackToPoll) {
        fellBack = true;
        setConnection('polling');
        startFallback();
      } else {
        setConnection(transport === 'stream' ? 'stale' : 'polling');
      }
      emitEvent('resubscribed', { reason: 'resume' });
    };

    const unregisterExternalBearerHandle =
      client.__registerExternalBearerHandle(handle);

    handle.dispose = () => {
      if (disposed || disposing) return disposalTask ?? Promise.resolve();
      disposing = true;
      const staleSubscriptionId = handle.subscriptionId;
      let firstCleanupError = null;
      let activeDemandRelease = Promise.resolve();
      const attempt = (cleanup) => {
        try {
          cleanup();
        } catch (error) {
          firstCleanupError ??= error;
        }
      };
      try {
        if (ownerInspectionToken !== null) {
          client.__unregisterRuntimeCostSubscription(ownerInspectionToken);
          client.__liveQueryOwners.delete(ownerInspectionToken);
          ownerInspectionToken = null;
        }
        if (authorizationFence?.snapshot?.().lifecycle === 'active') {
          attempt(() => authorizationFence.beginRetirement({
            fence: authorizationFence.capture(),
            commit: commitAuthorizationBoundary,
          }));
        }
        // Receipt ordering remains established-before-disposed. Observer
        // delivery is isolated, and the `disposing` guard makes a callback
        // that re-enters dispose idempotent instead of recursively tearing
        // down the same handle.
        attempt(() => emitEstablishedOnce());
        attempt(() => emitEvent('disposed'));
      } finally {
        // @ref LLP 0034#109-observational-callbacks-and-failed-optimistic-work-cannot-own-lifecycle-2026-07-12
        //   — app observation never owns transport/resource lifetime. Attempt
        //   every cleanup even if an internal teardown step itself fails.
        disposed = true;
        // Final Channel B flush (dispose is the SPA-navigation analog of
        // pagehide), then stop observing lifecycle events.
        attempt(() => { void persistResumeStateNow(); });
        attempt(detachResumePersistence);
        attempt(() => invalidateSubscribeLifecycle('disposed'));
        attempt(stopFallback);
        attempt(clearResubscribeRetry);
        attempt(closeAutomaticOptimisticView);
        if (establishTimer) {
          clearTimeout(establishTimer);
          establishTimer = null;
        }
        attempt(unregisterDurable);
        attempt(() => {
          activeDemandRelease = Promise.resolve(activeRegistration.release());
        });
        attempt(unregisterAuthMaterialization);
        attempt(unregisterExternalBearerHandle);
        attempt(unregisterOutboxBarrierProvider);
        attempt(() => detachStream?.());
        detachStream = null;
        attempt(() => setConnection('disconnected'));
        // Unmount-safe server-side disposal (ENG-22478 review fix F): without
        // this, unmounting a handle while the connection lives leaves the
        // §10.1 zombie fanning out until connection teardown. Ignoring the
        // returned task remains safe; awaiting it preserves typed failures.
        const unsubscribeTask = unsubscribeLiveForLifecycle(staleSubscriptionId);
        disposalTask = Promise.all([activeDemandRelease, unsubscribeTask])
          .then(([, result]) => result);
        // UI unmount callbacks intentionally do not await cleanup. Attach an
        // observation-only rejection handler so that use remains safe, while
        // returning the original task lets explicit callers receive genuine
        // ownership/session/network failures.
        void disposalTask.catch(() => {});
        disposing = false;
      }
      if (firstCleanupError) throw firstCleanupError;
      return disposalTask;
    };

    handle.settled = async () => {
      await Promise.allSettled([
        freshSubscribeTail,
        pauseReleasePromise,
        cleanupTail,
      ]);
      // A live manager is shared by every store/provider using this
      // connection id. Local disposal settles when this handle has detached
      // and retired its subscription; waiting for the whole manager would
      // hang behind a still-live sibling and turn one provider's cleanup into
      // connection ownership.
    };

    activeRegistration = await this.__registerActiveQueryDemand(
      ref,
      args,
      persistResume,
      preparedMaterialization,
      userId ?? null,
    );
    try { await ensureAutomaticOptimisticView(); } catch { /* query remains authoritative-only */ }
    try {
      await establish();
      await optimisticPresentationTail;
      // Establishment normally publishes through onUpdate, which already
      // scheduled the one authoritative rebase above. Do not count that same
      // delivery twice: a settled bridge retires only after genuinely newer
      // authority. Hosts with no establishment frame still need one
      // presentation publication, but it is not an authority delivery.
      if (lastAuthoritativeDetail === null) {
        await reconcileAutomaticOptimisticView(
          'initial-presentation-establishment',
          {
            version: handle.version,
            kind: 'optimistic_projection',
            freshness: handle.freshness,
          },
        );
      }
      const outboxBarrierProvider = () => resubscribe('outbox-drain-barrier');
      client.__outboxBarrierProviders.add(outboxBarrierProvider);
      unregisterOutboxBarrierProvider = () => {
        client.__outboxBarrierProviders.delete(outboxBarrierProvider);
      };
      ownerInspectionToken = {};
      const inspectedOwnerLabel = __frameworkOwnerLabel
        ?? (ownerLabel === null ? `headless:${name}` : argsHash(ownerLabel));
      client.__liveQueryOwners.set(ownerInspectionToken, Object.freeze({
        owner: inspectedOwnerLabel,
        connectionId,
        functionName: name,
        handle,
      }));
      client.__registerRuntimeCostSubscription(ownerInspectionToken, {
        functionId: typeof ref?.id === 'string' ? ref.id : name,
        args,
        ownerLabel: inspectedOwnerLabel,
        ownershipTuple: client.#runtimeCostOwnershipIdentityTuple({
          authorityCapture: handleAuthorityCapture,
          userId: userId ?? null,
          appId: ref?.appId ?? null,
        }),
      });
    } catch (error) {
      closeAutomaticOptimisticView();
      activeRegistration.release();
      if (isConnectivityFailureError(error)) {
        throw queryOfflineUnavailableError({
          cause: error,
          name,
          ref,
          persistResume,
          preparedMaterialization,
        });
      }
      throw error;
    }
    return handle;
  }
}

/// One managed WebSocket per connection, multiplexing durable live-query
/// updates and ephemeral push (the lanes the server's outbox already carries;
/// durable drains before ephemeral within each tick — LLP 0013
/// §delivery-lanes; the manager dispatches frames strictly in arrival order,
/// preserving that priority). Reference-counted by listeners; reconnects with
/// exponential backoff while demand exists; sends app-level pings to make the
/// Exact LLP 0284 §2.2 freshness budget observable.
///
/// @ref LLP 0034#22-one-socket-both-lanes--with-the-priority-invariant
class LiveStreamManager {
  constructor(client, connectionId, options = {}, onRelease = () => {}) {
    this.client = client;
    this.connectionId = connectionId;
    this.onRelease = onRelease;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? LIVE_HEARTBEAT_INTERVAL_MS;
    this.freshnessBudgetMs = options.freshnessBudgetMs ?? LIVE_FRESHNESS_BUDGET_MS;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? LIVE_RECONNECT_BASE_DELAY_MS;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? LIVE_RECONNECT_MAX_DELAY_MS;

    this.durableListeners = new Set();
    this.ephemeralListeners = new Set();
    this.stateListeners = new Set();
    // Readiness probes observe socket state without owning socket demand.
    // A paused/disposed handle must be able to detach its last real listener
    // and close the manager even while a caller is awaiting readiness.
    this.readinessStateListeners = new Set();
    this.pendingRequests = new Map();
    this.settlementWaiters = new Set();
    this.demandLeases = new Set();

    this.ws = null;
    this.open = false;
    this.closed = false;
    this.attempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.lastActivityMs = Date.now();
    this.requestSeq = 0;
    // Socket-session readiness is generation-scoped. A correlated ping/pong
    // proves that the server is processing frames on the same generation the
    // client will pair with its HTTP subscribe; a stale socket's pong cannot
    // satisfy a later generation because #dispatch ignores non-current ws.
    this.socketGeneration = 0;
    this.readyGeneration = 0;
    // One correlated ping/pong probe is shared by parallel callers. Each
    // caller still gets its own abortable wrapper, so canceling one binding
    // never cancels another binding's readiness wait.
    this.readinessProbe = null;
    // True while the ENG-23442 grant handshake for a connect is in flight
    // (there is no this.ws yet, so #ensureSocket needs its own latch).
    this.connectPending = false;
    // Set when a socket fails WITHOUT ever opening — the signature of a
    // stale grant (restarted server): the next connect refreshes the grant.
    this.grantSuspect = false;
    this.authorityCapture = null;
    this.grantEstablishedAtMs = null;
    this.declaredDevStreamEpisode = null;
  }

  #endDeclaredDevStreamEpisode() {
    const episode = this.declaredDevStreamEpisode;
    this.declaredDevStreamEpisode = null;
    this.client.__endDeclaredDevStandingStreamEpisode(episode);
  }

  #demand() {
    return this.durableListeners.size
      + this.ephemeralListeners.size
      + this.stateListeners.size
      + this.demandLeases.size;
  }

  #listen(set, listener) {
    set.add(listener);
    this.#ensureSocket();
    return () => {
      set.delete(listener);
      if (this.#demand() === 0) this.close();
    };
  }

  onDurable(listener) {
    return this.#listen(this.durableListeners, listener);
  }

  onEphemeral(listener) {
    return this.#listen(this.ephemeralListeners, listener);
  }

  onState(listener) {
    return this.#listen(this.stateListeners, listener);
  }

  /// Own managed-socket demand without registering an observational callback.
  /// Used by subscriptions whose lane delivery routes through the client's
  /// shared consumer registry rather than a manager listener.
  acquireDemand() {
    if (this.closed) {
      throw liveStreamReadinessError(
        'SNAPBACK_LIVE_STREAM_CLOSED',
        `Snapback live stream for ${this.connectionId} is closed`,
      );
    }
    const lease = {};
    this.demandLeases.add(lease);
    this.#ensureSocket();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.demandLeases.delete(lease);
      if (this.#demand() === 0) this.close();
    };
  }

  isOpen() {
    return this.open;
  }

  isReady() {
    return this.open && this.readyGeneration === this.socketGeneration;
  }

  inspection() {
    return Object.freeze({
      connectionId: this.connectionId,
      open: this.open,
      closed: this.closed,
      socketDemand: this.#demand(),
      durableListeners: this.durableListeners.size,
      ephemeralListeners: this.ephemeralListeners.size,
      stateListeners: this.stateListeners.size,
      readinessListeners: this.readinessStateListeners.size,
      pendingRequests: this.pendingRequests.size,
      reconnectTimer: this.reconnectTimer === null ? 0 : 1,
      heartbeatTimer: this.heartbeatTimer === null ? 0 : 1,
      grantAgeMs: this.grantEstablishedAtMs === null
        ? null
        : Math.max(0, Date.now() - this.grantEstablishedAtMs),
    });
  }

  settled() {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => this.settlementWaiters.add(resolve));
  }

  /// Prove the CURRENT socket generation through a correlated ping/pong.
  /// Raw WebSocket `open` is not a sufficient cross-target witness: a local
  /// upgrade callback may still be registering its delivery task. Hosted
  /// subscribe recovery waits here only after an explicit, pre-persistence
  /// session diagnostic; generic HTTP outcomes are never replayed.
  ///
  /// @ref LLP 0034#23-connection-axis-mapping-kit-derived-policy-over-d0-signals
  waitUntilReady({ timeoutMs = this.freshnessBudgetMs, revalidate = false, signal } = {}) {
    const cancellationError = () => signal?.reason instanceof Error
      ? signal.reason
      : liveStreamReadinessError(
        'SNAPBACK_LIVE_STREAM_READINESS_CANCELLED',
        `Snapback live stream readiness for ${this.connectionId} was cancelled`,
      );
    if (signal?.aborted) return Promise.reject(cancellationError());
    if (this.closed) {
      return Promise.reject(liveStreamReadinessError(
        'SNAPBACK_LIVE_STREAM_CLOSED',
        `Snapback live stream for ${this.connectionId} is closed`,
      ));
    }
    if (!revalidate && this.isReady()) return Promise.resolve(this.socketGeneration);
    if (revalidate) this.readyGeneration = 0;
    let shared = this.readinessProbe;
    if (!shared) {
      shared = {
        promise: null,
        cancel: () => {},
        settled: false,
        waiters: 0,
      };
      const pending = new Promise((resolve, reject) => {
        let settled = false;
        let probing = false;
        let timer = null;
        let offState = () => {};
        const finish = (outcome, value) => {
          if (settled) return;
          settled = true;
          if (timer !== null) clearTimeout(timer);
          offState();
          outcome(value);
        };
        shared.cancel = (error) => finish(reject, error);
        const deadline = Date.now() + timeoutMs;
        const probe = () => {
          if (settled || probing || !this.open) return;
          const generation = this.socketGeneration;
          if (this.readyGeneration === generation) {
            finish(resolve, generation);
            return;
          }
          probing = true;
          const remainingMs = Math.max(1, deadline - Date.now());
          const probeTimeoutMs = Math.min(this.heartbeatIntervalMs, remainingMs);
          this.request({ type: 'ping' }, probeTimeoutMs).then(
            (frame) => {
              probing = false;
              if (settled) return;
              if (!this.open || this.socketGeneration !== generation) {
                probe();
                return;
              }
              if (frame?.kind !== LIVE_SOCKET_KINDS.PONG) {
                this.debugCloseSocket();
                return;
              }
              this.readyGeneration = generation;
              finish(resolve, generation);
            },
            () => {
              probing = false;
              if (settled) return;
              // A raw-open socket that cannot answer the readiness ping is
              // not usable authority. Force ordinary loss/reconnect; the
              // same bounded wait continues on the replacement generation.
              if (this.open && this.socketGeneration === generation) {
                this.debugCloseSocket();
              }
            },
          );
        };
        timer = setTimeout(() => {
          finish(
            reject,
            liveStreamReadinessError(
              'SNAPBACK_LIVE_STREAM_READINESS_TIMEOUT',
              `Snapback live stream for ${this.connectionId} did not become ready within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        const stateListener = (state) => {
          if (state === 'open') {
            probe();
          } else if (state === 'closed') {
            finish(
              reject,
              liveStreamReadinessError(
                'SNAPBACK_LIVE_STREAM_CLOSED',
                `Snapback live stream for ${this.connectionId} closed before it became ready`,
              ),
            );
          }
        };
        this.readinessStateListeners.add(stateListener);
        offState = () => this.readinessStateListeners.delete(stateListener);
        this.#ensureSocket();
        if (settled) offState();
        probe();
      });
      shared.promise = pending;
      this.readinessProbe = shared;
      const clear = () => {
        shared.settled = true;
        if (this.readinessProbe === shared) this.readinessProbe = null;
      };
      pending.then(clear, clear);
    }

    shared.waiters += 1;
    const caller = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (outcome, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        outcome(value);
      };
      const onAbort = () => finish(reject, cancellationError());
      signal?.addEventListener('abort', onAbort, { once: true });
      shared.promise.then(
        (generation) => finish(resolve, generation),
        (error) => finish(reject, error),
      );
      // Abort may have raced listener registration.
      if (signal?.aborted) onAbort();
    });
    return caller.finally(() => {
      shared.waiters -= 1;
      if (shared.waiters === 0 && !shared.settled) {
        shared.cancel(liveStreamReadinessError(
          'SNAPBACK_LIVE_STREAM_READINESS_CANCELLED',
          `Snapback live stream readiness for ${this.connectionId} has no active waiters`,
        ));
      }
    });
  }

  #emitState(state, detail = {}) {
    for (const listener of [...this.stateListeners]) deliverIsolated(listener, state, detail);
    for (const listener of [...this.readinessStateListeners]) deliverIsolated(listener, state, detail);
    this.client.__notifyAuthorityTransitionStatus();
  }

  #ensureSocket() {
    if (this.closed || this.ws || this.reconnectTimer || this.connectPending) return;
    this.#connect();
  }

  /// The stream endpoint as an absolute ws(s) URL. A browser surface may
  /// construct the client with a page-relative base (e.g. '/snapback' behind
  /// the Vite proxy, which needs `ws: true` to upgrade), which `new WebSocket`
  /// cannot take — resolve against the page origin first; headless clients
  /// always pass absolute bases.
  #socketUrl(grant) {
    const base = this.client.baseUrl;
    const absolute = /^https?:/i.test(base) || !globalThis.location
      ? base
      : new URL(base, globalThis.location.href).toString().replace(/\/$/, '');
    return `${absolute.replace(/^http/, 'ws')}/live/${grant.id}/stream`;
  }

  /// Resolve the connection grant, then open the socket. A failed handshake
  /// (server down, restarted server that lost the grant namespace) is a loss
  /// like any other: fallback engages and the backoff loop retries — and the
  /// grant cache self-clears on failure, so a retry re-opens the handshake.
  #connect() {
    if (this.connectPending) return;
    this.connectPending = true;
    this.#emitState('connecting');
    const refreshGrant = this.grantSuspect;
    this.grantSuspect = false;
    const grantPromise = this.client.__beginDeclaredDevStandingStreamEpisode()
      .then((episode) => {
        this.declaredDevStreamEpisode = episode;
        if (this.closed) {
          this.#endDeclaredDevStreamEpisode();
          throw liveStreamReadinessError(
            'SNAPBACK_LIVE_STREAM_CLOSED',
            `Snapback live stream for ${this.connectionId} closed during identity verification`,
          );
        }
        return this.client.authSession({ force: true });
      })
      .then((session) => {
      const unavailable = authAvailabilityError(session);
      if (unavailable) throw unavailable;
      const authorityCapture = this.client.authorityFence?.capture?.() ?? null;
      return (refreshGrant
        ? this.client.refreshConnectionGrant(this.connectionId)
        : this.client.connectionGrant(this.connectionId))
        .then(async (grant) => {
          this.grantEstablishedAtMs = Date.now();
          let captured = this.client.authorityFence?.capture?.()
            ?? grant?.[AUTHORITY_CAPTURE]
            ?? authorityCapture;
          let senderFlight = null;
          if (this.client.senderConstrained) {
            senderFlight = await this.client.authCoordinator
              .beginSenderRequestSerialization(captured);
            captured = senderFlight.capture;
          }
          const path = `/live/${grant.id}/stream`;
          try {
            return {
              grant,
              authorityCapture: captured,
              offeredProtocols: await this.client.liveStreamProtocolsFor(
                grant,
                path,
                captured,
                senderFlight?.credential ?? null,
              ),
              senderFlight,
            };
          } catch (error) {
            await senderFlight?.release().catch(() => {});
            throw error;
          }
        });
    });
    grantPromise.then(
      ({ grant, authorityCapture, offeredProtocols, senderFlight }) => {
        this.connectPending = false;
        if (this.closed) {
          void senderFlight?.release().catch(() => {});
          return;
        }
        this.#openSocket(grant, authorityCapture, offeredProtocols, senderFlight);
      },
      (error) => {
        this.connectPending = false;
        this.#endDeclaredDevStreamEpisode();
        if (this.closed) return;
        if ([
          'SNAPBACK_APP_BINDING_IDENTITY_MISMATCH',
          'SNAPBACK_APP_IDENTITY_FACT_INVALID',
        ].includes(error?.diagnostic?.code ?? error?.code)) {
          this.close(error, {
            error,
            terminal: true,
            code: error?.diagnostic?.code ?? error?.code,
            reason: 'declared_dev_identity_refused',
          });
          return;
        }
        if (isTerminalLiveProtocolRefusal(error)) {
          this.close(error, {
            error,
            terminal: true,
            code: error?.diagnostic?.code ?? error?.code ?? null,
            reason: 'protocol_refusal',
          });
          return;
        }
        if (this.attempts === 0) this.#emitState('lost', { wasOpen: false });
        this.#scheduleReconnect();
      },
    );
  }

  #openSocket(
    grant,
    authorityCapture = null,
    offeredProtocols = null,
    senderFlight = null,
  ) {
    const url = this.#socketUrl(grant);
    let releasingSenderFlight = senderFlight;
    let senderFrameTimer = null;
    const releaseSenderFlight = () => {
      if (senderFrameTimer !== null) {
        clearTimeout(senderFrameTimer);
        senderFrameTimer = null;
      }
      const releasing = releasingSenderFlight;
      releasingSenderFlight = null;
      if (releasing !== null) {
        void releasing.release().catch((error) => {
          if (this.ws) this.#loseSocket(this.ws, error);
        });
      }
    };
    let ws;
    try {
      ws = new WebSocket(
        url,
        offeredProtocols ?? liveStreamProtocols(grant, this.client.authProtocols),
      );
    } catch {
      releaseSenderFlight();
      this.#endDeclaredDevStreamEpisode();
      // Constructor failure (bad URL, blocked context) is a loss like any
      // other: let consumers engage their fallback on the first failure.
      if (this.attempts === 0) this.#emitState('lost', { wasOpen: false });
      this.#scheduleReconnect();
      return;
    }
    try {
      this.socketGeneration = safeNextCounter(
        this.socketGeneration,
        'SNAPBACK_CLIENT_SOCKET_GENERATION_EXHAUSTED',
        'live socket generation',
      );
    } catch (error) {
      this.closed = true;
      releaseSenderFlight();
      this.#endDeclaredDevStreamEpisode();
      try { ws.close(); } catch { /* fail closed */ }
      this.#emitState('closed', { error });
      return;
    }
    this.authorityCapture = authorityCapture;
    this.ws = ws;

    // Connect budget: a dangling upgrade (a proxy that swallows it, a dead
    // route) fires neither open nor close, which would otherwise leave
    // consumers in 'connecting' forever with no fallback. Treat it as a loss.
    const connectTimer = setTimeout(() => {
      if (this.ws === ws && !this.open) {
        releaseSenderFlight();
        try {
          ws.close();
        } catch {
          // close() on a connecting socket may throw; the close event follows.
        }
      }
    }, this.freshnessBudgetMs);
    connectTimer.unref?.();

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      clearTimeout(connectTimer);
      if (!this.client.__markDeclaredDevStandingStreamOpen(this.declaredDevStreamEpisode)) {
        this.#loseSocket(ws, liveStreamReadinessError(
          'SNAPBACK_APP_BINDING_UNAVAILABLE',
          'The declared-development identity episode changed before the live stream opened.',
        ));
        return;
      }
      // Decision 5: the flight is NOT released on open — the first server
      // frame carrying the successor nonce is the release event. An
      // open-without-frame stall releases as consumed-unknown at the
      // freshness budget while the healthy socket lives on; the next
      // protected request resynchronizes through the bounded challenge.
      if (releasingSenderFlight !== null) {
        senderFrameTimer = setTimeout(releaseSenderFlight, this.freshnessBudgetMs);
        senderFrameTimer.unref?.();
      }
      this.open = true;
      this.openedAtMs = Date.now();
      this.attempts = 0;
      this.lastActivityMs = Date.now();
      this.#startHeartbeat();
      this.#emitState('open');
    });
    ws.addEventListener('message', async (event) => {
      if (this.ws !== ws) return;
      this.lastActivityMs = Date.now();
      let frame;
      try {
        frame = JSON.parse(await websocketText(
          event.data,
          this.client.ingressLimits?.liveFrame ?? null,
        ));
      } catch (error) {
        if (error?.code === 'SNAPBACK_INGRESS_LIMIT_EXCEEDED') {
          // An oversized frame is a transport-class refusal, not a silent
          // drop: close as 1009 (message too big) so the ordinary loss and
          // reconnect policy owns recovery with bounded memory.
          try { ws.close(1009, 'ingress_limit'); } catch { /* loss path owns state */ }
        } else {
          this.#loseSocket(ws, error);
        }
        return;
      }
      if (frame?.kind === LIVE_SOCKET_KINDS.SENDER_NONCE) {
        // Transport-internal (decision 5): commit the in-band successor,
        // release the per-custody flight, and never surface the frame.
        const flight = releasingSenderFlight;
        if (flight !== null) {
          const successor = await this.client.commitSenderSocketNonce(flight, frame?.nonce);
          if (successor !== null) this.authorityCapture = successor;
          releaseSenderFlight();
        }
        return;
      }
      await this.#receiveFrame(ws, frame);
    });
    let errorEventSeen = false;
    const onLoss = (event) => {
      clearTimeout(connectTimer);
      releaseSenderFlight();
      if (event?.code === 4401 && event?.reason === 'auth_error') {
        this.#closeForAuthClose(ws);
        return;
      }
      this.#loseSocket(ws, new Error(`Snapback live stream lost: ${url}`), {
        closeCode: typeof event?.code === 'number' ? event.code : null,
        closeReason: typeof event?.reason === 'string' && event.reason !== ''
          ? event.reason
          : null,
        errorPreceded: errorEventSeen,
      });
    };
    ws.addEventListener('close', onLoss, { once: true });
    ws.addEventListener('error', () => {
      errorEventSeen = true;
      releaseSenderFlight();
      // Browser and undici sockets normally follow `error` with `close`, but
      // React Native may report a refused upgrade only as `error`. Waiting for
      // a close that never comes wedges the manager with a non-open socket and
      // prevents grant refresh after a server restart. #loseSocket is
      // idempotent, so the usual later close event is harmless.
      this.#loseSocket(ws, new Error(`Snapback live stream errored: ${url}`), {
        errorPreceded: true,
      });
    });
  }

  // The shared post-parse receive path: every decoded server frame (except
  // the transport-internal sender_nonce, which needs the connect closure's
  // flight state) enters #dispatch through here, inside the authority-fence
  // commit gate. Shared by the live 'message' listener and debugInjectFrame,
  // so the test seam exercises the REAL wiring rather than a replica of it.
  async #receiveFrame(ws, frame) {
    if (frame?.kind === LIVE_SOCKET_KINDS.AUTH_ERROR) {
      this.#closeForAuthError(ws, frame);
      return;
    }
    try {
      const committed = await this.client.commitAuthorityPublication(
        this.authorityCapture,
        () => {
          markAuthorityCapture(frame, this.authorityCapture);
          this.#dispatch(frame);
        },
      );
      if (!committed.committed) this.#loseSocket(ws, staleAuthorityError());
    } catch (error) {
      this.#loseSocket(ws, error);
    }
  }

  // Idempotent loss transition shared by close events and synchronous send
  // failures. WebSocket.send() may throw after the socket passes our `open`
  // check but enters CLOSING; treating that as immediate loss prevents an
  // orphaned correlated request and starts bounded reconnect without waiting
  // for a later close event that a custom implementation may never deliver.
  #loseSocket(ws, error, lossDetail = {}) {
    if (this.ws !== ws) return;
    this.#endDeclaredDevStreamEpisode();
    const wasOpen = this.open;
    // Loss forensics for carrier diagnosis (0137 A1-Expo f7): the close
    // code/reason, whether an `error` event preceded, and how long the
    // socket had been open split an RN-stack death from a server close or a
    // never-opened upgrade refusal without a simulator attached.
    const sinceOpenMs = wasOpen && typeof this.openedAtMs === 'number'
      ? Math.max(0, Date.now() - this.openedAtMs)
      : null;
    this.open = false;
    this.ws = null;
    this.#stopHeartbeat();
    this.#failPendingRequests(error instanceof Error
      ? error
      : new Error(`Snapback live stream lost: ${ws?.url ?? this.connectionId}`));
    try {
      ws.close();
    } catch {
      // The failed socket may already be closing.
    }
    if (this.closed) return;
    // A socket that never opened may have been refused at the upgrade gate
    // (stale grant after a server restart): re-run the handshake next try.
    if (!wasOpen) this.grantSuspect = true;
    // Emit on EVERY death of a constructed socket, retries included
    // (ENG-23428): the server registers the stream task at upgrade
    // completion, before any frame, so a retry socket that died without
    // firing client 'open' may still have reached the server and triggered
    // the disconnect that destroys the connection's subscriptions and
    // outbox. Consumers must hear about every such loss to know a fresh
    // subscribe is needed; swallowing retry failures left handles
    // fake-healthy on a destroyed outbox.
    this.#emitState('lost', {
      wasOpen,
      sinceOpenMs,
      closeCode: lossDetail.closeCode ?? null,
      closeReason: lossDetail.closeReason ?? null,
      errorPreceded: lossDetail.errorPreceded === true,
    });
    this.#scheduleReconnect();
  }

  #closeForAuthError(ws, frame) {
    if (this.ws !== ws) return;
    const error = liveTerminalAuthError(frame);
    const capture = this.authorityCapture;
    this.client.handleTerminalAuthLoss(capture, error);
    this.close(error, {
      error,
      terminal: true,
      code: error.code,
      reason: frame?.reason ?? null,
    });
    if (
      error.terminalAuth
      && error.authorityDisposition === 'durableDelete'
      && capture
      && this.client.authCoordinator?.isCurrent?.(capture)
    ) {
      void this.client.authCoordinator.compareAndClear(capture, frame.code).catch(() => {});
    }
  }

  #closeForAuthClose(ws) {
    if (this.ws !== ws) return;
    const error = liveTerminalAuthCloseError();
    const capture = this.authorityCapture;
    this.client.handleTerminalAuthLoss(capture, error);
    this.close(error, {
      error,
      terminal: true,
      code: error.code,
      reason: 'auth_error',
    });
    if (
      error.authorityDisposition === 'durableDelete'
      && capture
      && this.client.authCoordinator?.isCurrent?.(capture)
    ) {
      void this.client.authCoordinator.compareAndClear(capture, error.code).catch(() => {});
    }
  }

  #scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    if (this.#demand() === 0) return;
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** this.attempts,
      this.reconnectMaxDelayMs,
    );
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed && this.#demand() > 0) this.#connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  #startHeartbeat() {
    this.#stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.open) return;
      if (Date.now() - this.lastActivityMs > this.freshnessBudgetMs) {
        // Freshness budget missed while the socket claims to be open: declare
        // it, then force the loss path so reconnect begins ('stale' is
        // budget-missed-while-retrying — LLP 0034 §2.2).
        this.#emitState('budget-missed');
        this.debugCloseSocket();
        return;
      }
      try {
        this.requestSeq = safeNextCounter(
          this.requestSeq,
          'SNAPBACK_CLIENT_SOCKET_REQUEST_GENERATION_EXHAUSTED',
          'socket request generation',
        );
      } catch (error) {
        this.#loseSocket(this.ws, error);
        return;
      }
      const requestId = `ping_${this.requestSeq}`;
      const ws = this.ws;
      if (!ws) return;
      try {
        ws.send(JSON.stringify({ type: 'ping', requestId }));
      } catch (error) {
        this.#loseSocket(ws, error);
      }
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  #stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  #dispatch(frame) {
    if (!frame || typeof frame !== 'object') return;
    if (frame.requestId && this.pendingRequests.has(frame.requestId)) {
      const pending = this.pendingRequests.get(frame.requestId);
      this.pendingRequests.delete(frame.requestId);
      pending.resolve(frame);
      return;
    }
    if (
      frame.kind === LIVE_SOCKET_KINDS.PONG ||
      frame.kind === LIVE_SOCKET_KINDS.EPHEMERAL_ACK ||
      frame.kind === LIVE_SOCKET_KINDS.EPHEMERAL_ERROR
    ) {
      return; // uncorrelated control frames only refresh lastActivityMs
    }
    if (frame.kind === LIVE_SOCKET_KINDS.DURABLE_BYTES) {
      dispatchDurableBytesFrame(this, frame);
      return;
    }
    // Every fan-out below is isolated per consumer (ENG-23391): #dispatch
    // runs inside an async 'message' listener, so an uncaught consumer throw
    // would both starve the remaining consumers of this frame and escape as
    // an unhandled rejection (fatal to a headless Node process by default).
    if (frame.kind === LIVE_SOCKET_KINDS.EPHEMERAL) {
      for (const listener of [...this.ephemeralListeners]) deliverIsolated(listener, frame);
      // The lane registry is transport-agnostic (LLP 0034 §10.1 / ENG-22478):
      // when the socket owns the connection's outbox, registered ephemeral
      // consumers (EphemeralOverlays) still receive their lane's frames.
      const consumers = this.client.__laneConsumers?.get(this.connectionId);
      for (const consumer of [...(consumers?.ephemeral ?? [])]) deliverIsolated(consumer, frame);
      return;
    }
    // Durable-lane payloads arrive unwrapped (live_replace / resync_required)
    // and route through the SAME lane registry HTTP drains use, so a
    // poll-transport handle sharing this connection is never starved by the
    // socket owning the outbox (ENG-22478 review: mixed-transport
    // unification). liveQuery handles consume durable traffic ONLY via the
    // registry — onDurable is for external socket-frame listeners and must
    // not be combined with a registry registration (double delivery).
    for (const listener of [...this.durableListeners]) deliverIsolated(listener, frame);
    const consumers = this.client.__laneConsumers?.get(this.connectionId);
    routeDurableLaneFrame(consumers, frame);
  }

  /// Send a live-socket request (ephemeral_subscribe/publish/delete or ping)
  /// and await its correlated response envelope.
  request(message, timeoutMs = 2_000) {
    if (!this.open || !this.ws) {
      return Promise.reject(new Error('Snapback live stream is not open'));
    }
    const ws = this.ws;
    this.requestSeq = safeNextCounter(
      this.requestSeq,
      'SNAPBACK_CLIENT_SOCKET_REQUEST_GENERATION_EXHAUSTED',
      'socket request generation',
    );
    const requestId = message.requestId ?? `req_${this.requestSeq}`;
    let encoded;
    try {
      encoded = JSON.stringify({ ...message, requestId });
    } catch (error) {
      return Promise.reject(error);
    }
    let pending;
    const response = new Promise((resolve, reject) => {
      pending = { resolve, reject };
      this.pendingRequests.set(requestId, pending);
    });
    const timed = withTimeout(
      response,
      timeoutMs,
      `timed out waiting for live-socket response ${requestId}`,
    ).finally(() => {
      this.pendingRequests.delete(requestId);
    });
    try {
      ws.send(encoded);
    } catch (error) {
      // Remove/reject this exact record before the socket-wide loss rejects
      // the remaining requests. Never rethrow synchronously: callers always
      // receive the Promise-shaped request failure they registered for.
      if (this.pendingRequests.get(requestId) === pending) {
        this.pendingRequests.delete(requestId);
        pending.reject(error);
      }
      this.#loseSocket(ws, error);
    }
    return timed;
  }

  #failPendingRequests(error) {
    for (const [, pending] of this.pendingRequests) pending.reject(error);
    this.pendingRequests.clear();
  }

  /// Test hook (issues/closed/20260725-durable-bytes-dispatch-test-seam.md,
  /// mirroring debugCloseSocket): inject a decoded server frame through the
  /// REAL receive path — #receiveFrame's authority-fence commit into
  /// #dispatch — as if the current socket had delivered it. Exists so the
  /// dispatch WIRING (not just the helpers below it) is regression-testable:
  /// the original durable_bytes silent-staleness defect was precisely a
  /// wiring gap that helper-level tests could not catch.
  debugInjectFrame(frame) {
    const ws = this.ws;
    if (!ws || !this.open) {
      return Promise.reject(new Error('Snapback live stream is not open'));
    }
    this.lastActivityMs = Date.now();
    return this.#receiveFrame(ws, frame);
  }

  /// Test hook (conformance check 3): force-close the underlying socket
  /// without releasing demand — the manager treats it as a loss and retries.
  debugCloseSocket() {
    const ws = this.ws;
    if (ws) {
      try {
        ws.close();
      } catch {
        // close() on a connecting socket may throw in some implementations.
      }
    }
  }

  close(error = null, detail = {}) {
    if (this.closed) return;
    this.closed = true;
    this.#endDeclaredDevStreamEpisode();
    this.#stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.open = false;
    if (ws) {
      try {
        ws.close();
      } catch {
        // best-effort teardown
      }
    }
    this.#failPendingRequests(error ?? new Error('Snapback live stream closed'));
    this.#emitState('closed', detail);
    this.durableListeners.clear();
    this.ephemeralListeners.clear();
    this.stateListeners.clear();
    this.readinessStateListeners.clear();
    this.demandLeases.clear();
    this.onRelease();
    for (const resolve of this.settlementWaiters) resolve();
    this.settlementWaiters.clear();
  }
}

// Cap the correlation echoed on kit receipts (ENG-22478 review fix H): the
// ring is count-bounded; an unbounded echo could still pin large payloads.
const CORRELATION_ECHO_MAX_BYTES = 4_096;
function cappedCorrelation(correlation) {
  if (correlation == null) return correlation;
  let size = Infinity;
  try {
    size = JSON.stringify(correlation).length;
  } catch {
    // Unserializable correlation: keep the honest marker.
  }
  return size > CORRELATION_ECHO_MAX_BYTES ? { correlationTruncated: true, bytes: size } : correlation;
}

// Consumer isolation at the delivery choke points (ENG-23391), mirroring
// recordReceipt's receipt-listener isolation (ENG-22478 review fix G) and
// EphemeralOverlay.#notifyChange: a throwing app callback must never discard
// the rest of a destructively drained batch or escape an async socket
// listener as an unhandled rejection.
function deliverIsolated(consumer, ...payload) {
  try {
    consumer(...payload);
  } catch {
    // Consumer errors are the consumer's problem, not the delivery's.
  }
}

// Outbox poison/overflow is a connection-wide loss of retained continuity,
// even though its wire envelope travels on the durable lane. Route only that
// exact control shape across the lane boundary so every in-memory ephemeral
// overlay blanks too. Subscription-scoped resyncs remain durable-only. The
// historical pre-typed frame used clearRetained; accepting that spelling here
// cannot broaden scope because the absent-subscription check is independent.
//
// @ref LLP 0059#fenced-effects-and-live-closure — all-authority poison is
//   consumed once by the current fence and clears both retained client lanes.
function isConnectionWideClearRetainedResync(frame) {
  return frame?.kind === LIVE_DURABLE_KINDS.RESYNC_REQUIRED
    && frame.subscription_id == null
    && frame.subscriptionId == null
    && (frame.clear_retained === true || frame.clearRetained === true);
}

function routeDurableLaneFrame(consumers, frame) {
  for (const consumer of [...(consumers?.durable ?? [])]) deliverIsolated(consumer, frame);
  if (!isConnectionWideClearRetainedResync(frame)) return;
  // Deliver the SAME object to both lanes. Its non-enumerable authority
  // capture was attached before routing and must remain available to every
  // consumer's compare-and-commit gate.
  for (const consumer of [...(consumers?.ephemeral ?? [])]) deliverIsolated(consumer, frame);
}

// A durable payload that failed UTF-8 decoding server-side arrives as a
// durable_bytes socket frame, and its outbox lease was already released at
// the WebSocket handoff — the update is gone and cannot be re-drained, and
// which subscription it belonged to is unrecoverable from the raw bytes.
// Recovery is therefore connection-wide: synthesize the same clear-retained
// resync shape the server emits for outbox poison, driving every durable
// handle through fresh snapshot-with-subscribe and blanking every ephemeral
// overlay via the cross-lane routing above
// (issues/closed/20260724-durable-bytes-silent-staleness.md).
//
// @ref LLP 0093#d3--protocol-visible-lifecycle-facts — fact 2b: ignoring
//   durable_bytes is non-conformant; the required transition is forced resync.
// Conformance-relevant surface: the sentinel SHAPE and reason constant
// (clients may observe the synthesized frame). dispatchDurableBytesFrame
// is exported plumbing for the kit's own tests — do not bind to it.
export const DURABLE_BYTES_RESYNC_REASON = 'durable_bytes_undecodable';
export function durableBytesResyncSentinel() {
  return {
    kind: LIVE_DURABLE_KINDS.RESYNC_REQUIRED,
    reason: DURABLE_BYTES_RESYNC_REASON,
    clear_retained: true,
  };
}
export function dispatchDurableBytesFrame(stream, frame) {
  // Raw frame to external onDurable listeners (unchanged observability);
  // the synthetic sentinel — carrying the stream's authority capture, like
  // every frame the socket listener marks — to the lane registry.
  for (const listener of [...stream.durableListeners]) deliverIsolated(listener, frame);
  const sentinel = markAuthorityCapture(durableBytesResyncSentinel(), stream.authorityCapture);
  routeDurableLaneFrame(stream.client.__laneConsumers?.get(stream.connectionId), sentinel);
}

function liveStreamReadinessError(code, message) {
  return clientCodedError(new Error(`${code}: ${message}`), code);
}

function resyncReason(serverReason) {
  if (serverReason === 'outbox_overflow') return 'overflow';
  if (serverReason === 'permission_epoch_changed') return 'permission-epoch';
  return 'resync';
}

function clientDiagnosticFromError(error) {
  const existing = error?.diagnostic;
  if (existing && typeof existing.code === 'string') {
    return Object.freeze({
      schemaVersion: 'snapback.client-diagnostic.v1',
      code: existing.code,
      severity: 'error',
      message: existing.message ?? error?.message ?? existing.code,
      details: Object.freeze({ ...(existing.details ?? {}) }),
    });
  }
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: error?.code ?? 'SNAPBACK_EPHEMERAL_ROOM_FAILED',
    severity: 'error',
    message: error instanceof Error ? error.message : String(error),
    details: Object.freeze({}),
  });
}

function clientDiagnosticFromEphemeralErrorFrame(frame) {
  const ephemeralCode = frame?.error?.code;
  const code = ephemeralCode === 'PermissionDenied'
    ? 'SNAPBACK_AUTH_PERMISSION_DENIED'
    : 'SNAPBACK_EPHEMERAL_ROOM_FAILED';
  const roomAuthorityGeneration = frame?.room_authority_generation
    ?? frame?.roomAuthorityGeneration
    ?? null;
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message: frame?.error?.message ?? code,
    details: Object.freeze({
      ...(typeof ephemeralCode === 'string' ? { ephemeralCode } : {}),
      ...(Number.isSafeInteger(roomAuthorityGeneration) ? { roomAuthorityGeneration } : {}),
      ...(ephemeralCode === 'PermissionDenied' ? { reason: 'AuthRevoked' } : {}),
    }),
  });
}

function deepFreezeEphemeralValue(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeEphemeralValue(child, seen);
  return Object.freeze(value);
}

function compareRawUtf8(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function freezeEphemeralRoomSnapshot(snapshot) {
  const entries = [...(snapshot.entries ?? [])]
    .sort((a, b) => compareRawUtf8(a.key, b.key))
    .map((entry) => Object.freeze({
      ...entry,
      value: deepFreezeEphemeralValue(structuredClone(entry.value)),
    }));
  return Object.freeze({
    ...snapshot,
    entries: Object.freeze(entries),
  });
}

export class EphemeralOverlay {
  // @ref LLP 0013#client-overlay-store — generated clients keep ephemeral
  // entries in memory, apply scope/version checks, and prune by server TTL.
  constructor(client, ref, { connectionId, scope, userId, permissions, snapshot }) {
    this.client = client;
    this.ref = ref;
    // The app-facing connectionId is only a readable, label-keyed registry
    // handle. Connection-owned entry keys use the opaque id granted for the
    // exact subscribe request; collision and mint-only containment can make
    // those two strings diverge. subscribeEphemeral binds this before the
    // overlay is returned, including on its one grant-refresh retry.
    //
    // @ref LLP 0031#connection-capability-grants — wire identity comes from
    //   the server grant, never from the caller's readable label.
    this.grantedConnectionId = null;
    this.connectionId = connectionId;
    this.scope = scope;
    this.userId = userId;
    this.permissions = permissions;
    this.scopeEpoch = null;
    this.ephemeralAuthorityInstance = null;
    this.__retiredEphemeralAuthorities = new Set();
    this.highWaterVersion = 0;
    this.entries = new Map();
    this.tombstones = new Map();
    this.needsResync = false;
    this.terminalDiagnostic = null;
    // A connection-wide clear-retained signal is stronger than an ordinary
    // room resync: no frame already in flight for this overlay generation can
    // prove it was captured after the connection-continuity loss. Keep that
    // generation permanently closed; recovery constructs a successor overlay
    // through a fresh subscribe instead of reopening this object with a
    // delayed Snapshot.
    this.__connectionContinuityLost = false;
    // Any continuity-loss result is level-triggered until an authoritative
    // snapshot restores this overlay (connection-wide loss never restores this
    // generation). subscribeEphemeral can consume buffered frames before it
    // returns, so the app's first listener must still see the exact reason.
    this.__continuityLossResult = null;
    this.room = null; // captured from OUR subscribe snapshot (room identity)
    this.authorityCapture = null;
    this.__preSnapshotEnvelopes = [];
    this.__preSnapshotOverflowed = false;
    this.__drainCaptures = new Set();
    this.__changeListeners = new Set();
    this.__releaseStreamDemand = null;
    this.__unregisterAuthMaterialization = client.registerAuthMaterialization?.({
      capture: () => this.authorityCapture,
      blank: () => this.#blankForAuthority(),
    }) ?? null;
    // Cross-lane routing (LLP 0034 §10.1 / ENG-22478): the overlay is this
    // connection's registered ephemeral consumer, so a durable drain on the
    // same connection routes ephemeral envelopes here instead of dropping
    // them (and this overlay's drain routes durable envelopes to the durable
    // consumers symmetrically). The same registry receives socket-delivered
    // ephemeral frames when a live stream owns the connection's outbox.
    this.__unregister = client.registerEphemeralConsumer(connectionId, (envelope) => {
      if (this.__preSnapshotEnvelopes !== null) {
        if (this.__preSnapshotEnvelopes.length >= EPHEMERAL_PRE_SNAPSHOT_BUFFER_CAP) {
          this.__preSnapshotOverflowed = true;
          return;
        }
        this.__preSnapshotEnvelopes.push(envelope);
        return;
      }
      this.#consume(envelope);
    });
    if (snapshot) this.applyInitialSnapshot(snapshot);
  }

  #blankForAuthority() {
    if (this.terminalDiagnostic !== null) return;
    this.entries.clear();
    this.tombstones.clear();
    this.highWaterVersion = 0;
    this.needsResync = true;
    this.__connectionContinuityLost = true;
    this.__continuityLossResult = 'needs_resync';
    if (this.__preSnapshotEnvelopes !== null) {
      this.__preSnapshotEnvelopes.length = 0;
      this.__preSnapshotOverflowed = true;
    }
    this.#notifyChange('needs_resync');
  }

  #consume(envelope) {
    const capture = envelope?.[AUTHORITY_CAPTURE] ?? this.authorityCapture;
    if (
      this.client.authorityFence
      && (!capture || !this.client.authorityFence.isCurrent(capture))
    ) return 'stale_authority';
    const result = this.apply(envelope);
    for (const capture of this.__drainCaptures) capture.push(result);
    return result;
  }

  /// Establish the snapshot boundary, then replay every delta the shared
  /// connection delivered after server registration but before the response
  /// reached this client. JavaScript runs this transition synchronously, so a
  /// newly arriving frame observes the post-snapshot path and cannot overtake
  /// the buffered batch.
  applyInitialSnapshot(snapshot) {
    if (this.__preSnapshotEnvelopes === null) {
      throw new TypeError('Snapback ephemeral overlay already has an initial snapshot');
    }
    const buffered = this.__preSnapshotEnvelopes;
    const overflowed = this.__preSnapshotOverflowed;
    this.__preSnapshotEnvelopes = null;
    this.__preSnapshotOverflowed = false;
    const snapshotCapture = snapshot?.[AUTHORITY_CAPTURE] ?? null;
    if (
      this.client.authorityFence
      && (!snapshotCapture || !this.client.authorityFence.isCurrent(snapshotCapture))
    ) throw staleAuthorityError();
    this.authorityCapture = snapshotCapture;
    const snapshotResult = this.apply(snapshot);
    for (const envelope of buffered) this.#consume(envelope);
    if (overflowed) {
      this.entries.clear();
      this.tombstones.clear();
      this.highWaterVersion = 0;
      this.needsResync = true;
      const error = new Error(
        `SNAPBACK_EPHEMERAL_SUBSCRIBE_BUFFER_OVERFLOW: more than ${EPHEMERAL_PRE_SNAPSHOT_BUFFER_CAP} deltas arrived before the initial snapshot`,
      );
      error.diagnostic = {
        code: 'SNAPBACK_EPHEMERAL_SUBSCRIBE_BUFFER_OVERFLOW',
        message: `more than ${EPHEMERAL_PRE_SNAPSHOT_BUFFER_CAP} ephemeral deltas arrived before the initial snapshot`,
      };
      throw error;
    }
    return snapshotResult;
  }

  /// Detach from the connection's lane router.
  dispose() {
    this.__unregister?.();
    this.__unregister = null;
    this.__unregisterAuthMaterialization?.();
    this.__unregisterAuthMaterialization = null;
    this.__changeListeners.clear();
    this.__releaseStreamDemand?.();
    this.__releaseStreamDemand = null;
  }

  /// Transfer the subscription's managed-socket lease to this overlay after
  /// its authoritative initial snapshot commits. Before that point the
  /// subscribe operation retains ownership so failure cleanup can still use
  /// the socket after detaching the abandoned overlay.
  adoptStreamDemand(release) {
    if (typeof release !== 'function') {
      throw new TypeError('Snapback ephemeral stream demand release must be a function');
    }
    if (this.__releaseStreamDemand) {
      throw new TypeError('Snapback ephemeral overlay already owns stream demand');
    }
    this.__releaseStreamDemand = release;
  }

  /// Observe state changes (applied snapshots/upserts/removes and resync
  /// boundaries) — the hook the Contract adapter's ephemeral source uses to
  /// re-emit EphemeralMapCells (ENG-22479).
  onChange(listener) {
    this.__changeListeners.add(listener);
    // @ref LLP 0013#authorization-and-privacy — a denied subscriber's
    // terminal PermissionDenied/AuthRevoked boundary is level-triggered for
    // late consumers and may never reopen this overlay generation.
    if (this.terminalDiagnostic !== null) {
      try {
        listener('terminal_error', this);
      } catch {
        // Observer errors never poison the overlay's terminal path.
      }
      return () => this.__changeListeners.delete(listener);
    }
    // The poison is level-triggered for this overlay generation. It can land
    // while the initial snapshot response is in flight, before Contract has
    // attached its change listener; replay the closed state so that late
    // attachment still replaces this overlay through a fresh subscribe.
    if (this.__continuityLossResult !== null) {
      try {
        listener(this.__continuityLossResult, this);
      } catch {
        // Observer errors never poison the overlay's recovery path.
      }
    }
    return () => this.__changeListeners.delete(listener);
  }

  #notifyChange(result) {
    for (const listener of [...this.__changeListeners]) {
      try {
        listener(result, this);
      } catch {
        // Observer errors never poison the overlay's apply path.
      }
    }
  }

  publish(value, options = {}) {
    // @ref LLP 0013#capability-fixture-obligations — a membership-denied
    // overlay generation is terminal. Refuse locally from the trusted
    // diagnostic so a writer cannot depend on a later server round trip to
    // rediscover the revocation.
    if (this.terminalDiagnostic !== null) {
      return Promise.reject(new SnapbackDiagnosticError(this.terminalDiagnostic, {
        operation: 'ephemeral-publish',
        refKind: 'ephemeralCollectionReference',
        effectCommitted: false,
        effectMayHaveCommitted: false,
      }));
    }
    return this.client.publishEphemeral(this.ref, {
      connectionId: options.connectionId ?? this.connectionId,
      scope: this.scope,
      value,
      ttlMs: options.ttlMs ?? null,
      userId: options.userId ?? this.userId,
      permissions: options.permissions ?? this.permissions,
      sessionId: options.sessionId ?? null,
      ownerUserId: options.ownerUserId ?? null,
      customKey: options.customKey ?? null,
    });
  }

  delete(options = {}) {
    return this.client.deleteEphemeral(this.ref, {
      connectionId: options.connectionId ?? this.connectionId,
      scope: this.scope,
      userId: options.userId ?? this.userId,
      permissions: options.permissions ?? this.permissions,
      sessionId: options.sessionId ?? null,
      ownerUserId: options.ownerUserId ?? null,
      customKey: options.customKey ?? null,
      expectedScopeEpoch: options.expectedScopeEpoch ?? null,
      expectedEntryVersion: options.expectedEntryVersion ?? null,
      authorityCapture: options.authorityCapture ?? this.authorityCapture,
    });
  }

  async drain() {
    // Drain through the shared choke point: this overlay's registered
    // consumer applies the ephemeral envelopes (captured for the return
    // value; captures are re-entrant — overlapping drains each collect what
    // was applied while they were in flight), while durable envelopes in the
    // same drain are routed to the connection's durable consumers instead of
    // being discarded.
    const capture = [];
    this.__drainCaptures.add(capture);
    try {
      await this.client.drainConnection(this.connectionId);
      return capture.filter((result) => result !== 'not_ephemeral');
    } finally {
      this.__drainCaptures.delete(capture);
    }
  }

  apply(input) {
    if (this.terminalDiagnostic !== null) return 'terminal_error';
    if (isConnectionWideClearRetainedResync(input)) {
      // The server discarded continuity for the whole connection, not merely
      // one durable subscription. Blank every overlay immediately and remain
      // closed to every later envelope. Recovery establishes a new high-water
      // boundary on a successor overlay created by a fresh subscribe.
      this.entries.clear();
      this.tombstones.clear();
      this.highWaterVersion = 0;
      this.needsResync = true;
      this.__connectionContinuityLost = true;
      this.__continuityLossResult = 'needs_resync';
      this.#notifyChange('needs_resync');
      return 'needs_resync';
    }
    const message = unwrapEphemeralMessage(input);
    if (!message) return 'not_ephemeral';
    const serverObservedAtMs = ephemeralServerObservedAtMs(input, message);
    const receivedMonotonicMs = monotonicNowMs();
    const authority = input?.ephemeralAuthorityInstance
      ?? input?.ephemeral_authority_instance
      ?? Object.values(message)[0]?.ephemeralAuthorityInstance
      ?? Object.values(message)[0]?.ephemeral_authority_instance
      ?? null;
    const requiresAuthority = this.client.authProtocols?.ephemeralAuthority != null;
    if (requiresAuthority && (typeof authority !== 'string' || authority.length === 0)) {
      this.entries.clear();
      this.tombstones.clear();
      this.highWaterVersion = 0;
      this.needsResync = true;
      this.__continuityLossResult = 'authority_missing';
      this.#notifyChange('authority_missing');
      return 'authority_missing';
    }
    if (typeof authority === 'string' && authority.length > 0) {
      if (this.__retiredEphemeralAuthorities.has(authority)) return 'ignored_stale_authority';
      if (
        this.ephemeralAuthorityInstance !== null
        && this.ephemeralAuthorityInstance !== authority
      ) {
        const isSnapshot = message.Snapshot !== undefined;
        if (!isSnapshot) {
          this.entries.clear();
          this.tombstones.clear();
          this.highWaterVersion = 0;
          this.needsResync = true;
          this.__continuityLossResult = 'authority_changed';
          this.#notifyChange('authority_changed');
          return 'authority_changed';
        }
        this.__retiredEphemeralAuthorities.add(this.ephemeralAuthorityInstance);
        this.entries.clear();
        this.tombstones.clear();
        this.scopeEpoch = null;
        this.highWaterVersion = 0;
      }
      this.ephemeralAuthorityInstance = authority;
    }
    if (this.__connectionContinuityLost) {
      // A delayed predecessor Snapshot is no more trustworthy than a delayed
      // delta after connection-wide continuity loss. Ordinary room-scoped
      // resync leaves this latch false and may still recover in place.
      return 'needs_resync';
    }
    // Room isolation (ENG-22478 review fix B): a connection's outbox carries
    // EVERY room's traffic, and the lane registry fans it to every overlay —
    // so each message must match THIS overlay's room identity (captured from
    // our own subscribe snapshot). A foreign room's snapshot/upsert/remove
    // must never contaminate this overlay's entries or scopeEpoch.
    const room = messageRoom(message);
    if (this.room && room && !sameRoom(this.room, room)) return 'foreign_room';
    if (this.needsResync && (message.Upsert || message.Remove)) {
      return 'needs_resync';
    }
    if (message.Snapshot) {
      if (!this.room && message.Snapshot.room) this.room = message.Snapshot.room;
      const snapshotEpoch = message.Snapshot.scope_epoch;
      const snapshotHighWater = Number.isSafeInteger(message.Snapshot.high_water_version)
        ? message.Snapshot.high_water_version
        : snapshotMaxEntryVersion(message.Snapshot);
      if ((message.Snapshot.entries ?? []).some((entry) => entry.entry_version > snapshotHighWater)) {
        this.entries.clear();
        this.tombstones.clear();
        this.needsResync = true;
        this.__continuityLossResult = 'needs_resync';
        this.#notifyChange('needs_resync');
        return 'needs_resync';
      }
      if (this.scopeEpoch !== null) {
        if (snapshotEpoch < this.scopeEpoch) return 'ignored_stale';
        if (
          snapshotEpoch === this.scopeEpoch
          && snapshotHighWater < this.highWaterVersion
        ) {
          return 'ignored_stale';
        }
      }
      const previousEpoch = this.scopeEpoch;
      this.scopeEpoch = snapshotEpoch;
      this.highWaterVersion = snapshotHighWater;
      this.entries.clear();
      this.tombstones.clear();
      for (const entry of message.Snapshot.entries ?? []) {
        this.entries.set(
          entry.key,
          normalizeEntry(entry, serverObservedAtMs, receivedMonotonicMs),
        );
      }
      this.needsResync = false;
      this.__continuityLossResult = null;
      // Ephemeral one-version story (LLP 0034 §3.1): entry versions are valid
      // WITHIN a scopeEpoch; an epoch bump is a resubscription boundary and
      // is receipted as such. The first snapshot is the establishment.
      // Privacy (§3.3): scope/epoch/keys only — never entry values.
      this.client.recordReceipt?.({
        kind: 'subscription',
        lane: 'ephemeral',
        // The binding id for an ephemeral map IS the collection name — the
        // adapter joins overlay receipts to bindings by it (ENG-22479).
        bindingId: collectionName(this.ref),
        collection: collectionName(this.ref),
        event: previousEpoch === null ? 'established' : 'resubscribed',
        ...(previousEpoch === null ? {} : { reason: 'resync' }),
        scope: { ...this.scope },
        snapback: { scopeEpoch: this.scopeEpoch },
        receivedAtMs: Date.now(),
      }, this.authorityCapture);
      this.#notifyChange('applied');
      return 'applied';
    }
    if (message.Upsert) {
      const entry = normalizeEntry(
        message.Upsert.entry,
        serverObservedAtMs,
        receivedMonotonicMs,
      );
      if (this.scopeEpoch !== entry.scopeEpoch) {
        this.needsResync = true;
        this.__continuityLossResult = 'needs_resync';
        this.#notifyChange('needs_resync');
        return 'needs_resync';
      }
      if (
        entry.entryVersion <= this.highWaterVersion
        || (this.tombstones.get(entry.key) ?? 0) >= entry.entryVersion
      ) return 'ignored_stale';
      this.highWaterVersion = entry.entryVersion;
      this.tombstones.delete(entry.key);
      this.entries.set(entry.key, entry);
      this.#notifyChange('applied');
      return 'applied';
    }
    if (message.Remove) {
      const remove = message.Remove;
      if (this.scopeEpoch !== remove.scope_epoch) {
        this.needsResync = true;
        this.__continuityLossResult = 'needs_resync';
        this.#notifyChange('needs_resync');
        return 'needs_resync';
      }
      if (remove.entry_version <= this.highWaterVersion) return 'ignored_stale';
      this.highWaterVersion = remove.entry_version;
      this.entries.delete(remove.key);
      this.tombstones.set(remove.key, remove.entry_version);
      while (this.tombstones.size > 1024) {
        let oldestKey = null;
        let oldestVersion = Number.POSITIVE_INFINITY;
        for (const [key, version] of this.tombstones) {
          if (version < oldestVersion) {
            oldestKey = key;
            oldestVersion = version;
          }
        }
        if (oldestKey === null) break;
        this.tombstones.delete(oldestKey);
      }
      this.#notifyChange('applied');
      return 'applied';
    }
    if (message.ResyncRequired) {
      this.entries.clear();
      this.tombstones.clear();
      this.highWaterVersion = 0;
      this.needsResync = true;
      this.__continuityLossResult = 'needs_resync';
      this.#notifyChange('needs_resync');
      return 'needs_resync';
    }
    if (message.Error) {
      // @ref LLP 0107#resync-authority-and-lifecycle — revocation exposes no
      // denied entries and surfaces the trusted diagnostic as a terminal room
      // state; later frames cannot reopen this overlay generation.
      this.entries.clear();
      this.tombstones.clear();
      this.highWaterVersion = 0;
      this.needsResync = false;
      this.terminalDiagnostic = clientDiagnosticFromEphemeralErrorFrame(message.Error);
      this.#notifyChange('terminal_error');
      return 'terminal_error';
    }
    return 'not_ephemeral';
  }

  pruneExpired(nowMs = Date.now(), monotonicMs = monotonicNowMs()) {
    for (const [key, entry] of this.entries) {
      if (
        entry.monotonicExpiresAtMs === null
          ? entry.expiresAtMs <= nowMs
          : entry.monotonicExpiresAtMs <= monotonicMs
      ) this.entries.delete(key);
    }
  }

  msUntilEarliestExpiry(monotonicMs = monotonicNowMs()) {
    let delay = Number.POSITIVE_INFINITY;
    for (const entry of this.entries.values()) {
      if (entry.monotonicExpiresAtMs !== null) {
        delay = Math.min(delay, entry.monotonicExpiresAtMs - monotonicMs);
      }
    }
    return delay;
  }

  currentEntries({ prune = true } = {}) {
    if (prune) this.pruneExpired();
    return [...this.entries.values()].map((entry) => ({
      key: entry.key,
      value: entry.value,
      expiresAtMs: entry.expiresAtMs,
      receivedAtMs: entry.receivedAtMs,
      scopeEpoch: entry.scopeEpoch,
      entryVersion: entry.entryVersion,
    }));
  }
}

// ENG-23442 transports: HTTP carries the grant token as a header; a WebSocket
// upgrade carries it as the `snapback.connection-token.<token>` subprotocol
// (browser WebSockets cannot set headers), alongside `snapback.v1` so the
// server has a legal subprotocol to echo.
function connectionTokenHeader(grant) {
  return {
    [CONNECTION_TOKEN_HEADER]: grant.token,
    ...(typeof grant.ephemeralAuthorityInstance === 'string'
      ? { [EPHEMERAL_AUTHORITY_INSTANCE_HEADER]: grant.ephemeralAuthorityInstance }
      : {}),
  };
}

function liveStreamProtocols(grant, protocols = {}) {
  const offered = ['snapback.v1', `snapback.connection-token.${grant.token}`];
  if (typeof grant.ephemeralAuthorityInstance === 'string') {
    offered.push(
      `snapback.ephemeral-authority-instance.${grant.ephemeralAuthorityInstance}`,
    );
  }
  if (protocols.authClient != null) {
    offered.push(`snapback.auth-client.${protocols.authClient}`);
  }
  if (protocols.authInvalidation != null) {
    offered.push(`snapback.auth-invalidation.${protocols.authInvalidation}`);
  }
  if (protocols.authorityDescriptor != null) {
    offered.push(`snapback.authority-descriptor.${protocols.authorityDescriptor}`);
  }
  if (protocols.authorizedLease != null) {
    offered.push(`snapback.authorized-lease.${protocols.authorizedLease}`);
  }
  return offered;
}

function functionName(ref) {
  const name = typeof ref === 'string' ? ref : ref?.name;
  // Reserved system live queries are server-admitted by exact name and never
  // generated identifiers. Keep this allowlist aligned with local.rs rather
  // than forcing product clients to bypass the headless arm.
  // @ref LLP 0100#product-receipt — Team Chat observes the caller's own seat
  // drop through the ordinary client at the same authorization cut.
  if (name === '_snapback.assetRecord' || name === '_snapback.myMemberships') return name;
  if (isOperationName(name)) return name;
  if (typeof name === 'string') {
    throw new TypeError(`Snapback function name must match ${OPERATION_NAME_PATTERN}, got ${JSON.stringify(name)}`);
  }
  throw new TypeError(`Snapback function reference must be a string or generated ref, got ${JSON.stringify(ref)}`);
}

function generatedMutationWriteTables(plan) {
  const tables = new Set();
  for (const step of plan?.steps ?? []) {
    if (step === null || typeof step !== 'object' || Array.isArray(step)) continue;
    for (const kind of ['Insert', 'Patch', 'Delete']) {
      const table = step[kind]?.table;
      if (typeof table === 'string' && table.length > 0) tables.add(table);
    }
  }
  return [...tables].sort();
}

function generatedQueryProjectionTable(ref) {
  const nodes = ref?.composition?.normalizedCompositePlan?.nodes;
  if (!Array.isArray(nodes) || nodes.length !== 1) return null;
  const table = nodes[0]?.nodePlan?.normalizedPlan?.query?.table;
  return typeof table === 'string' && table.length > 0 ? table : null;
}

const EXPECTED_GENERATION_KEYS = Object.freeze([
  'schemaVersion',
  'appId',
  'schemaHash',
  'bundleHash',
  'inputsHash',
]);

function normalizeExpectedGeneration(value, label) {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || Object.keys(value).length !== EXPECTED_GENERATION_KEYS.length
    || Object.keys(value).some((key) => !EXPECTED_GENERATION_KEYS.includes(key))
    || EXPECTED_GENERATION_KEYS.some(
      (key) => typeof value[key] !== 'string' || value[key].length === 0,
    )
  ) {
    throw new TypeError(`${label} must be the complete generated artifact identity`);
  }
  return Object.fromEntries(EXPECTED_GENERATION_KEYS.map((key) => [key, value[key]]));
}

const sameArtifactGeneration = (left, right) => (
  EXPECTED_GENERATION_KEYS.every((key) => left?.[key] === right?.[key])
);

function artifactGenerationFromInspection(inspection) {
  const schema = inspection?.schema;
  const functions = inspection?.functions;
  const value = {
    schemaVersion: schema?.schemaVersion,
    appId: schema?.appId,
    schemaHash: schema?.schemaHash,
    bundleHash: functions?.bundleHash,
    inputsHash: schema?.inputsHash,
  };
  if (
    schema?.appId !== functions?.appId
    || schema?.schemaVersion !== functions?.schemaVersion
    || schema?.inputsHash !== functions?.inputsHash
  ) return null;
  try {
    return normalizeExpectedGeneration(value, 'candidate inspection generation');
  } catch {
    return null;
  }
}

function normalizeOutboxFreshSnapshotBarrier(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== 3
    || value.schemaVersion !== 'snapback.outbox-fresh-snapshot-barrier.v1'
    || value.status !== 'passed'
    || value.kind !== 'full-snapshot'
  ) return null;
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    status: value.status,
    kind: value.kind,
  });
}

function expectedGeneration(ref) {
  if (typeof ref !== 'object' || ref === null || ref.expectedGeneration == null) return null;
  return normalizeExpectedGeneration(
    ref.expectedGeneration,
    'Snapback function reference expectedGeneration',
  );
}

function outboxReplayReference(record) {
  if (record.expectedGeneration == null) return record.function;
  return {
    artifactKind: 'functionReference',
    // @ref LLP 0238#d1-generated-references-are-nominal-by-operation-kind —
    // durable outbox records are mutation authority even when they predate
    // persisted generated-reference kinds.
    kind: 'Mutation',
    name: record.function,
    expectedGeneration: record.expectedGeneration,
    ...(record.argsContract == null ? {} : { argsContract: record.argsContract }),
    ...(record.argumentSchema == null ? {} : { argumentSchema: record.argumentSchema }),
  };
}

function validateGeneratedArguments(ref, args, name = functionName(ref)) {
  const normalized = normalizeGeneratedArgumentsV1(ref, args);
  if (typeof ref === 'string') return normalized;
  if (ref.argumentSchema == null) return normalized;
  const problems = [];
  validateArgumentSchemaNode(ref.argumentSchema, normalized, 'args', problems);
  if (problems.length === 0) return normalized;
  const diagnostic = {
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: 'SNAPBACK_ARGUMENT_VALIDATION_FAILED',
    severity: 'error',
    subsystem: 'client',
    message: `arguments for ${name} do not match the generated operation schema`,
    details: { function: name, problems },
  };
  throw new SnapbackDiagnosticError(diagnostic, {
    message: diagnostic.message,
    operation: 'argument-validation',
    refKind: ref.kind ?? null,
    effectCommitted: false,
    effectMayHaveCommitted: false,
  });
}

function validateArgumentSchemaNode(schema, value, path, problems) {
  const type = schema?.type;
  if (type === undefined) return;
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      problems.push(`${path} must be an object`);
      return;
    }
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required) || value[required] === undefined) {
        problems.push(`${path}.${required} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) problems.push(`${path}.${key} is not declared`);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key) && value[key] !== undefined) {
        validateArgumentSchemaNode(child, value[key], `${path}.${key}`, problems);
      }
    }
    return;
  }
  if (type === 'string' && typeof value !== 'string') {
    problems.push(`${path} must be a string`);
  } else if (type === 'boolean' && typeof value !== 'boolean') {
    problems.push(`${path} must be a boolean`);
  } else if (
    type === 'number'
    && (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    problems.push(`${path} must be a finite number`);
  } else if (type === 'integer' && !Number.isSafeInteger(value)) {
    problems.push(`${path} must be a safe integer`);
  }
}

function collectionName(ref) {
  const name = typeof ref === 'string' ? ref : ref?.name;
  if (typeof name === 'string' && GENERATED_IDENTIFIER.test(name)) return name;
  if (typeof name === 'string') {
    throw new TypeError(`Snapback collection name must match ${GENERATED_IDENTIFIER}, got ${JSON.stringify(name)}`);
  }
  throw new TypeError(`Snapback ephemeral collection reference must be a string or generated ref, got ${JSON.stringify(ref)}`);
}

function normalizeEphemeralScope(ref, scope) {
  if (typeof ref === 'string') return scope;
  if (ref?.artifactKind !== 'ephemeralCollectionReference') {
    throw snapbackDiagnosticError(
      'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED',
      'generated ephemeral collection reference is required',
      { path: 'ref' },
      { operation: 'argument-normalization', effectCommitted: false, effectMayHaveCommitted: false },
    );
  }
  return normalizeArgumentsAgainstContractV1(scope, ref.scopeContract, { path: 'scope' });
}

function normalizeEphemeralValue(ref, value) {
  if (typeof ref === 'string') return value;
  return normalizeArgumentsAgainstContractV1(value, ref?.valueContract, { path: 'value' });
}

function encodeEphemeralValue(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  return [...bytes];
}

function decodeEphemeralValue(bytes) {
  const text = new TextDecoder().decode(Uint8Array.from(bytes ?? []));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function decodeDurablePayload(payload) {
  if (typeof payload === 'string') return payload;
  return new TextDecoder().decode(Uint8Array.from(payload ?? []));
}

function unwrapEphemeralMessage(input) {
  if (!input) return null;
  if (input.Ephemeral) return input.Ephemeral;
  if (input.kind === LIVE_SOCKET_KINDS.EPHEMERAL) return input.message;
  if (input.message) return input.message;
  if (input.Snapshot || input.Upsert || input.Remove || input.ResyncRequired || input.Error) return input;
  return null;
}

function messageRoom(message) {
  return (
    message.Snapshot?.room
    ?? message.Upsert?.room
    ?? message.Remove?.room
    ?? message.ResyncRequired?.room
    ?? message.Error?.room
    ?? null
  );
}

function sameRoom(a, b) {
  if (
    typeof a?.collection !== 'string'
    || typeof b?.collection !== 'string'
    || typeof a?.routing_key !== 'string'
    || typeof b?.routing_key !== 'string'
    || a?.scope === null
    || b?.scope === null
    || typeof a?.scope !== 'object'
    || typeof b?.scope !== 'object'
    || Array.isArray(a.scope)
    || Array.isArray(b.scope)
  ) return false;
  let leftScope;
  let rightScope;
  try {
    leftScope = canonicalizeClientValueV1(a.scope);
    rightScope = canonicalizeClientValueV1(b.scope);
  } catch {
    return false;
  }
  // @ref LLP 0013#routing-and-rooms — routing selects the room authority but
  // RoomId identity includes the complete normalized scope. Two documents may
  // share a narrower routing key without sharing authorization or overlay state.
  return a.collection === b.collection
    && a.routing_key === b.routing_key
    && leftScope === rightScope;
}

function monotonicNowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function ephemeralServerObservedAtMs(input, message) {
  const direct = input?.serverObservedAtMs ?? input?.server_observed_at_ms;
  if (Number.isSafeInteger(direct) && direct >= 0) return direct;
  const body = Object.values(message ?? {})[0];
  const nested = body?.serverObservedAtMs ?? body?.server_observed_at_ms;
  return Number.isSafeInteger(nested) && nested >= 0 ? nested : null;
}

function normalizeEntry(entry, serverObservedAtMs = null, receivedMonotonicMs = monotonicNowMs()) {
  const remainingTtlMs = Number.isSafeInteger(serverObservedAtMs)
    && Number.isSafeInteger(entry.expires_at_ms)
    ? Math.max(0, entry.expires_at_ms - serverObservedAtMs)
    : null;
  const normalized = {
    key: entry.key,
    value: decodeEphemeralValue(entry.value),
    receivedAtMs: entry.received_at_ms,
    expiresAtMs: entry.expires_at_ms,
    scopeEpoch: entry.scope_epoch,
    entryVersion: entry.entry_version,
  };
  Object.defineProperty(normalized, 'monotonicExpiresAtMs', {
    value: remainingTtlMs === null ? null : receivedMonotonicMs + remainingTtlMs,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return normalized;
}

function snapshotMaxEntryVersion(snapshot) {
  let max = 0;
  for (const entry of snapshot?.entries ?? []) {
    if (typeof entry?.entry_version === 'number' && entry.entry_version > max) max = entry.entry_version;
  }
  return max;
}

function entriesMaxEntryVersion(entries) {
  let max = 0;
  for (const entry of entries?.values?.() ?? []) {
    if (typeof entry?.entryVersion === 'number' && entry.entryVersion > max) max = entry.entryVersion;
  }
  return max;
}

function normalizedScopeKey(scope) {
  return Object.entries(scope)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${String(key).length}:${key}=${String(value).length}:${value}`)
    .join('|');
}

function bodySnippet(text, limit = 200) {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`;
}

// The optional limit is the liveFrame decoded-byte ingress bound (LLP 0062),
// checked before the frame text reaches JSON materialization. For text frames
// the UTF-16 code-unit count is the pre-materialization proxy for size; binary
// frames are checked on their exact byte length before decoding.
async function websocketText(data, ingressLimitBytes = null) {
  if (typeof data === 'string') {
    if (ingressLimitBytes !== null && data.length > ingressLimitBytes) {
      throw ingressLimitExceededError('liveFrame', ingressLimitBytes);
    }
    return data;
  }
  if (data instanceof ArrayBuffer) {
    if (ingressLimitBytes !== null && data.byteLength > ingressLimitBytes) {
      throw ingressLimitExceededError('liveFrame', ingressLimitBytes);
    }
    return new TextDecoder().decode(data);
  }
  if (data && typeof data.text === 'function') {
    if (
      ingressLimitBytes !== null
      && typeof data.size === 'number'
      && data.size > ingressLimitBytes
    ) {
      throw ingressLimitExceededError('liveFrame', ingressLimitBytes);
    }
    return data.text();
  }
  return String(data);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// @ref LLP 0108#query-single-value-egress--2026-08-15 — query transport and
// live delivery keep their one-row carrier, while the typed headless consumer
// exposes the authored document/value promised by FunctionResult<Ref>.
function hasSingleValueQueryContract(ref) {
  const kind = typeof ref === 'object' && ref !== null
    ? ref.resultContract?.kind
    : null;
  return kind === 'document' || kind === 'value';
}

function projectTypedQueryRows(ref, rows) {
  if (!hasSingleValueQueryContract(ref)) return rows;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new TypeError(
      `single-value query delivery for ${ref.name ?? '<unknown>'} must carry exactly one internal row`,
    );
  }
  return rows[0];
}

// @ref LLP 0059#exposure-invariant — a client-owned custody/invalidation blank
// uses an empty carrier to make predecessor data synchronously unreadable. It
// is not a server result-contract delivery: typed headless single-value handles
// expose that transient lifecycle state as null, while every server carrier
// retains LLP 0108's strict exactly-one-row projection above.
function projectTypedLiveQueryRows(ref, rows, { clientOwnedLifecycleBlank = false } = {}) {
  if (
    clientOwnedLifecycleBlank && hasSingleValueQueryContract(ref)
    && Array.isArray(rows)
    && rows.length === 0
  ) return null;
  return projectTypedQueryRows(ref, rows);
}

function typedQueryCarrierRows(ref, value) {
  return hasSingleValueQueryContract(ref) ? [value] : (Array.isArray(value) ? value : []);
}

function projectTypedQueryOutput(ref, output) {
  if (!hasSingleValueQueryContract(ref)) return output;
  return { ...output, rows: projectTypedQueryRows(ref, output?.rows) };
}
