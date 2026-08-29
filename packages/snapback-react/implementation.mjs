// Shared implementation for the statically composed public entries. The root
// selects the complete capability set; ./core selects the provider/query/
// mutation projection without retaining surfaces, commands, or assets.
// @ref LLP 0145#option-2--static-capability-modules-around-a-shared-kernel —
// public React entries statically select capabilities while sharing this one
// provider/store owner.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  applicationDescriptorForAppClient,
  createSnapbackAppClientWithBootstrapObserver,
} from '@expo/snapback-client/app-client-internal';
import {
  SnapbackDiagnosticError,
  asSnapbackDiagnosticError,
} from '@expo/snapback-client/diagnostic-error';
import {
  inspectionPseudonymV1,
  isTerminalLiveProtocolRefusal,
  projectOwnershipTupleInspectionV1,
} from '@expo/snapback-client';

import {
  admittedReactCommand,
  admittedReactEphemeralDefinition,
  admittedReactQueryGroup,
  admittedReactReference,
  admittedReactSurface,
  assertPreparedReactBinding,
  classifyRegeneratedReactReference,
  handoffPreparedReactBindingGeneration,
  preparedReactResultContract,
  preparedReactBindingClient,
  isPreparedReactQueryGroup,
  consumePreparedReactQueryGroup,
  abandonConsumedReactQueryGroup,
} from '@expo/snapback-client/react-binding';
import {
  canonicalizeClientValueV1,
  canonicalReactStoreKeyV1,
} from '@expo/snapback-client/canonical-client-value';
import {
  normalizeArgumentsAgainstContractV1,
  normalizeGeneratedArgumentsV1,
} from '@expo/snapback-client/argument-normalization';
import {
  positiveDevelopmentEnvironment,
  projectDiagnosticV1,
} from '@expo/snapback-client/client-diagnostics';
import { SNAPBACK_PUBLIC_BUDGETS_V1 } from '@expo/snapback-contract/limits';
import { placeholderToDataURL, thumbHashToApproximateAspectRatio } from './thumbhash.mjs';

// @ref LLP 0114#prepared-binding-and-provider-ownership — the provider owns
// its registry and barrier participant while borrowing the prepared client's
// transport.
// @ref LLP 0114#exact-saturated-replacement-semantics — group admission is
// transactional, with only unique one-for-one supersession at saturation.

export const skip = Symbol.for('snapback.react.skip.v1');

const ACTIVITY_PRESENCE_INTERNAL = Symbol.for(
  'snapback.react.activity-presence.internal.v1',
);
const ACTIVITY_PRESENCE_SESSION_EPOCH = Symbol(
  'snapback.react.activity-presence.session-epoch',
);
const ACTIVITY_CAPTURE_EMPTY = Symbol('snapback.react.activity-presence.capture-empty');
const ACTIVITY_IDLE_MIN_MS = 250;
const ACTIVITY_IDLE_MAX_MS = 2_147_483_647;

function readActivityPresenceSessionEpoch(provider) {
  return provider.registry[ACTIVITY_PRESENCE_SESSION_EPOCH]?.() ?? 0;
}

export const REACT_QUERY_STORE_CEILING = SNAPBACK_PUBLIC_BUDGETS_V1.react.queryStores;
export const REACT_QUERY_CONSUMER_CEILING = SNAPBACK_PUBLIC_BUDGETS_V1.react.queryConsumers;
export const REACT_VIEW_SUBSCRIPTION_WARNING_BUDGET = SNAPBACK_PUBLIC_BUDGETS_V1.react.viewSubscriptionWarning;
export const REACT_SERVER_SUBSCRIPTION_CEILING = SNAPBACK_PUBLIC_BUDGETS_V1.react.serverSubscriptions;
const QUERY_CACHE_CAP = REACT_QUERY_STORE_CEILING;
const CONSUMER_CAP = REACT_QUERY_CONSUMER_CEILING;
const VIEW_SUBSCRIPTION_BUDGET = REACT_VIEW_SUBSCRIPTION_WARNING_BUDGET;
const SERVER_SUBSCRIPTION_CAP = REACT_SERVER_SUBSCRIPTION_CEILING;
const PRESENCE_ROOM_CACHE_CAP = 128;
const PRESENCE_SUBSCRIPTION_CAP = 64;
const PRESENCE_CONSUMER_CAP = 256;
const PRESENCE_PUBLISHER_CAP = 64;
const OPTIMISTIC_LAYER_CAP = 256;
const REACT_RUNTIME_FALLBACK_RETRY_MS = 250;
const DEFAULT_HOOK_CHURN_TRANSITION_THRESHOLD = 8;
const DEFAULT_HOOK_CHURN_WINDOW_MS = 2_000;
const DEFAULT_OUTBOX_DRAIN_OPTIONS = Object.freeze({});
const AUTHORITY_CURSOR_INVALID = 'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID';
const AUTHORITY_EMPTY_ROWS = Object.freeze([]);
const AUTHORITY_PAGE_TASK_ABORTED = Symbol('snapback.react.authority-page-task-aborted');
const AUTHORITY_MUTATION_UNKNOWN = Object.freeze({ status: 'unknown' });
const AUTHORITY_CALLER_UNKNOWN = Object.freeze({ status: 'loading' });
const providerContext = createContext(null);
const appClientContext = createContext(null);
let providerSequence = 0;
// Local-uniqueness labels (provider instances, optimistic-layer ids): NOT
// security-bearing identity, so a carrier with no WebCrypto (React
// Native/Hermes — 0137 A1-Expo f1) falls back to time+sequence+Math.random
// uniqueness, mirroring the headless client's processClientStoreId and the
// contract arm's createClientMutationId. Never used for custody or
// server-visible idempotency claims.
let localLabelSequence = 0;
const localUniqueLabel = () => globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${(localLabelSequence += 1).toString(36)}-${Math.random().toString(36).slice(2)}`;
const preparedGroupReadersByRegistry = new WeakMap();
const providerOutboxDrainStates = new WeakMap();
const hookDiagnosticsOptionsByProvider = new WeakMap();

function preparedGroupForProvider(provider) {
  return preparedGroupReadersByRegistry.get(provider.registry)?.() ?? null;
}

const HANDOFF_DEFERRED_REFERENCE = Symbol('snapback.react.hmr-deferred-reference.v1');
const HOOK_CHURN_UNINITIALIZED = Symbol('snapback.react.hook-churn-uninitialized');
const HOOK_CHURN_DISABLED = Symbol('snapback.react.hook-churn-disabled');
const HANDOFF_PENDING = Object.freeze({
  status: 'pending',
  data: undefined,
  error: null,
  connection: 'connecting',
  freshness: 'unknown',
  answerClass: 'unknown',
  retention: null,
});

const CONNECTION_ORDER = Object.freeze({
  error: 0,
  closed: 1,
  disconnected: 2,
  stale: 3,
  connecting: 4,
  polling: 5,
  live: 6,
  idle: 7,
});

function diagnostic(code, message, details = {}) {
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({ ...details }),
  });
}

function warningDiagnostic(code, message, details = {}) {
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'warning',
    message,
    details: Object.freeze({ ...details }),
  });
}

function diagnosticError(code, message, details = {}) {
  const value = diagnostic(code, message, details);
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = value;
  return error;
}

function errorFromDiagnostic(value, fallbackCode, fallbackMessage) {
  const projected = value?.schemaVersion === 'snapback.client-diagnostic.v1'
    && typeof value.code === 'string'
    ? value
    : diagnostic(fallbackCode, fallbackMessage);
  const error = new Error(`${projected.code}: ${projected.message}`);
  error.code = projected.code;
  error.diagnostic = projected;
  return error;
}

function committedEffectError(error, clientMutationId) {
  const source = error?.diagnostic;
  const committed = diagnosticError(
    source?.code ?? error?.code ?? 'SNAPBACK_REACT_OPTIMISTIC_POST_DISPATCH_FAILED',
    source?.message ?? error?.message ?? String(error),
    {
      ...(source?.details ?? {}),
      effectCommitted: true,
      clientMutationId,
    },
  );
  committed.effectCommitted = true;
  committed.clientMutationId = clientMutationId;
  committed.cause = error;
  return committed;
}

function diagnosticsChannelForClient(client) {
  try {
    const channel = client?.diagnosticsChannel?.();
    return channel
      && typeof channel.emit === 'function'
      && typeof channel.subscribe === 'function'
      && typeof channel.snapshot === 'function'
      ? channel
      : null;
  } catch {
    return null;
  }
}

function emitReactDiagnostic(channel, event) {
  if (channel === null) return false;
  try {
    return channel.emit({
      schemaVersion: 'snapback.client-diagnostic.v2',
      subsystem: 'react',
      ...event,
    }) !== null;
  } catch {
    return false;
  }
}

function hookDiagnosticsOptions(options) {
  const transitionThreshold = options.__diagnosticsChurnTransitionThreshold
    ?? DEFAULT_HOOK_CHURN_TRANSITION_THRESHOLD;
  const windowMs = options.__diagnosticsChurnWindowMs ?? DEFAULT_HOOK_CHURN_WINDOW_MS;
  if (!Number.isSafeInteger(transitionThreshold) || transitionThreshold < 1) {
    throw new TypeError('__diagnosticsChurnTransitionThreshold must be a positive safe integer');
  }
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new TypeError('__diagnosticsChurnWindowMs must be a non-negative finite number');
  }
  return Object.freeze({ transitionThreshold, windowMs });
}

function captureHookCallSite() {
  const stack = new Error().stack;
  if (typeof stack !== 'string') return '<unknown application hook site>';
  const frames = stack.split('\n').slice(1);
  for (const entry of frames) {
    const frame = entry.trim();
    if (
      frame.length === 0
      || frame.includes(import.meta.url)
      || frame.startsWith('at captureHookCallSite ')
      || frame.startsWith('captureHookCallSite@')
      || frame.startsWith('at createHookChurnDetector ')
      || frame.startsWith('createHookChurnDetector@')
      || frame.startsWith('at useSnapbackQuery ')
      || frame.startsWith('useSnapbackQuery@')
      || frame.startsWith('at useSnapbackPresence ')
      || frame.startsWith('useSnapbackPresence@')
      || frame.includes('/node_modules/react/')
      || frame.includes('/node_modules/react-test-renderer/')
      || frame.includes('node:internal')
    ) continue;
    return frame.startsWith('at ') ? frame.slice(3) : frame;
  }
  return '<unknown application hook site>';
}

function createHookChurnDetector(provider, hookKind) {
  if (!positiveDevelopmentEnvironment()) return HOOK_CHURN_DISABLED;
  let channel = null;
  try {
    channel = diagnosticsChannelForClient(preparedReactBindingClient(provider.binding));
  } catch { /* legacy/fake providers have no bound client channel */ }
  if (channel === null) return HOOK_CHURN_DISABLED;
  const config = hookDiagnosticsOptionsByProvider.get(provider)
    ?? Object.freeze({
      transitionThreshold: DEFAULT_HOOK_CHURN_TRANSITION_THRESHOLD,
      windowMs: DEFAULT_HOOK_CHURN_WINDOW_MS,
    });
  return {
    channel,
    hookKind,
    callSite: captureHookCallSite(),
    transitionThreshold: config.transitionThreshold,
    windowMs: config.windowMs,
    committed: false,
    primaryIdentity: null,
    secondaryIdentity: null,
    transitionTimes: new Array(config.transitionThreshold),
    transitionCount: 0,
    transitionCursor: 0,
  };
}

function recordCommittedHookDescriptor(
  detector,
  { primaryIdentity, secondaryIdentity = null, referenceName, hmrHandoff = false },
) {
  if (detector === HOOK_CHURN_DISABLED) return;
  // @ref LLP 0219#producers-pilot-scoped-detectors — a transition is a
  // committed descriptor-identity change. Same-descriptor Strict Mode
  // unsubscribe/resubscribe and the mounted-provider HMR handoff are excluded.
  if (hmrHandoff || primaryIdentity === null) {
    detector.committed = false;
    detector.primaryIdentity = null;
    detector.secondaryIdentity = null;
    return;
  }
  if (!detector.committed) {
    detector.committed = true;
    detector.primaryIdentity = primaryIdentity;
    detector.secondaryIdentity = secondaryIdentity;
    return;
  }
  if (
    detector.primaryIdentity === primaryIdentity
    && detector.secondaryIdentity === secondaryIdentity
  ) return;
  detector.primaryIdentity = primaryIdentity;
  detector.secondaryIdentity = secondaryIdentity;

  const atMs = Date.now();
  detector.transitionTimes[detector.transitionCursor] = atMs;
  detector.transitionCursor = (
    detector.transitionCursor + 1
  ) % detector.transitionThreshold;
  detector.transitionCount = Math.min(
    detector.transitionCount + 1,
    detector.transitionThreshold,
  );
  if (detector.transitionCount < detector.transitionThreshold) return;
  const firstAtMs = detector.transitionTimes[detector.transitionCursor];
  const elapsedMs = Math.max(0, atMs - firstAtMs);
  if (elapsedMs > detector.windowMs) return;

  const hookName = detector.hookKind === 'query'
    ? 'useSnapbackQuery'
    : 'useSnapbackPresence';
  const code = detector.hookKind === 'query'
    ? 'SNAPBACK_REACT_SUBSCRIPTION_CHURN'
    : 'SNAPBACK_REACT_PRESENCE_PUBLISH_CHURN';
  const site = `${detector.callSite} :: ${referenceName}`;
  emitReactDiagnostic(detector.channel, {
    code,
    severity: 'warning',
    message: `React live-hook stability rule: ${hookName} arguments must remain stable or content-equal across renders. Observed ${detector.transitionThreshold} committed ${detector.hookKind} descriptor transitions in ${elapsedMs}ms for ${referenceName}. Memoize or hoist the hook arguments; content-keying means only genuinely-changing inputs churn. See guide/clients/react.md.`,
    details: {
      hookKind: detector.hookKind,
      referenceName,
      transitionCount: detector.transitionThreshold,
      windowElapsedMs: elapsedMs,
      windowMs: detector.windowMs,
      transitionThreshold: detector.transitionThreshold,
      callSite: detector.callSite,
    },
    site,
  });
}

function serializeError(error) {
  return (error?.schemaVersion === 'snapback.client-diagnostic.v1' ? error : error?.diagnostic) ?? diagnostic(
    error?.code ?? 'SNAPBACK_REACT_QUERY_FAILED',
    error instanceof Error ? error.message : String(error),
  );
}

function pending(connection = 'idle') {
  return Object.freeze({
    status: 'pending',
    data: undefined,
    error: null,
    connection,
    freshness: 'unknown',
    answerClass: 'unknown',
    retention: null,
    lastDeliveryAtMs: null,
    authoritativeRevision: 0,
  });
}

const AUTH_TRANSITION_OWNER = 'auth-coordinator';

const AUTHENTICATION_REQUIRED_BLOCKED = Object.freeze({
  status: 'blocked',
  reason: 'authentication-required',
  transitionOwner: AUTH_TRANSITION_OWNER,
  data: undefined,
  error: null,
  connection: 'idle',
  freshness: 'unknown',
  answerClass: 'unknown',
  retention: null,
  lastDeliveryAtMs: null,
  authoritativeRevision: 0,
});

const AUTHENTICATION_NOT_SETTLED_BLOCKED = Object.freeze({
  status: 'blocked',
  reason: 'authentication-not-settled',
  transitionOwner: AUTH_TRANSITION_OWNER,
  data: undefined,
  error: null,
  connection: 'idle',
  freshness: 'unknown',
  answerClass: 'unknown',
  retention: null,
  lastDeliveryAtMs: null,
  authoritativeRevision: 0,
});

const generatedAuthScopedLiveReference = (reference) => (
  reference?.artifactKind === 'functionReference'
  && (
    reference.authRequirement === 'authenticated'
    || reference.authRequirement === 'optional-user'
  )
);

function authOwnedDiagnostic(error) {
  const projected = serializeError(error);
  return Object.freeze({
    ...projected,
    details: Object.freeze({
      ...(projected?.details ?? {}),
      transitionOwner: AUTH_TRANSITION_OWNER,
    }),
  });
}

function generatedAuthenticatedAuthorityState(client, reference, authority = undefined) {
  if (
    reference?.artifactKind !== 'functionReference'
    || reference.authRequirement !== 'authenticated'
  ) return 'not-applicable';
  if (client.custody === 'anonymous-public') return 'anonymous';
  if (authority !== undefined) {
    return authority?.kind === 'anonymous' ? 'anonymous' : 'authenticated';
  }
  const coordinator = client.authCoordinator;
  if (!coordinator) return 'unknown';
  try {
    const capture = coordinator.capture();
    const authority = coordinator.credentialFor(capture)?.authority;
    return authority?.kind === 'anonymous' ? 'anonymous' : 'authenticated';
  } catch (error) {
    const code = error?.diagnostic?.code ?? error?.code;
    return code === 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
      || code === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
      ? 'settling'
      : 'unknown';
  }
}

function projectedAuthorityContext(capture, authority) {
  if (capture == null || authority == null) return null;
  return Object.freeze({
    capture: Object.freeze({
      authorityEpoch: capture.authorityEpoch,
      custodyRevision: capture.custodyRevision,
      authorityKey: capture.authorityKey,
    }),
    authority: Object.freeze({ kind: authority.kind }),
  });
}

function generatedLiveAuthorityAdmission(
  client,
  reference,
  authorityContext = null,
) {
  const authRequirement = reference?.authRequirement;
  if (
    reference?.artifactKind !== 'functionReference'
    || (authRequirement !== 'authenticated' && authRequirement !== 'optional-user')
  ) return Object.freeze({ state: 'not-applicable', authorityContext: null });
  if (client.custody === 'anonymous-public') {
    return Object.freeze({
      state: authRequirement === 'authenticated' ? 'anonymous' : 'optional-user',
      authorityContext: null,
    });
  }
  if (authorityContext !== null) {
    return Object.freeze({
      state: authRequirement === 'authenticated'
        ? authorityContext.authority?.kind === 'anonymous'
          ? 'anonymous'
          : 'authenticated'
        : 'optional-user',
      authorityContext,
    });
  }
  const coordinator = client.authCoordinator;
  if (!coordinator) return Object.freeze({ state: 'unknown', authorityContext: null });
  try {
    const capture = coordinator.capture();
    const authority = coordinator.credentialFor(capture)?.authority;
    return Object.freeze({
      state: authRequirement === 'authenticated'
        ? authority?.kind === 'anonymous'
          ? 'anonymous'
          : 'authenticated'
        : 'optional-user',
      authorityContext: projectedAuthorityContext(capture, authority),
    });
  } catch (error) {
    const code = error?.diagnostic?.code ?? error?.code;
    return Object.freeze({
      state: code === 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
        || code === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
        || code === 'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT'
        ? 'settling'
        : 'unknown',
      authorityContext: null,
    });
  }
}

function authTransitionSuccessorError(store, error, details = {}) {
  if ((error?.diagnostic?.code ?? error?.code) === 'SNAPBACK_AUTH_TRANSITION_FAILED') {
    return error;
  }
  const causeCode = error?.diagnostic?.code ?? error?.code ?? null;
  const failure = diagnosticError(
    'SNAPBACK_AUTH_TRANSITION_FAILED',
    'a live query could not establish its successor under the settled authority',
    {
      phase: 'react-live-query-successor',
      transitionOwner: AUTH_TRANSITION_OWNER,
      functionName: store.reference?.name ?? null,
      authRequirement: store.reference?.authRequirement ?? null,
      ...(causeCode === null ? {} : { causeCode }),
      ...details,
    },
  );
  failure.cause = error;
  return failure;
}

function isAnonymousProtectedAuthorizationDenial(client, reference, error) {
  const code = error?.diagnostic?.code ?? error?.code;
  return generatedAuthenticatedAuthorityState(client, reference) === 'anonymous'
    && (error?.status === 401 || error?.status === 403)
    && code === 'SNAPBACK_AUTH_REQUIRED';
}

const SKIPPED = Object.freeze({
  status: 'skipped',
  data: undefined,
  error: null,
  connection: 'idle',
  freshness: 'unknown',
  answerClass: 'unknown',
  retention: null,
});
const SERVER_PENDING = pending();
const PRESENCE_SERVER_PENDING = Object.freeze({
  status: 'pending',
  entries: Object.freeze([]),
  selfKey: null,
  diagnostic: null,
  connection: 'idle',
  publisher: Object.freeze({ status: 'observing', diagnostic: null }),
  publish: async () => {},
  delete: async () => {},
});

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immutableClone(value) {
  return deepFreeze(structuredClone(value));
}

function validateResultContract(contract, value, {
  requireKnown = false,
  violationCode = 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED',
} = {}) {
  if (!contract?.descriptor || (requireKnown && contract.descriptor.kind === 'unknown')) {
    throw diagnosticError(
      'SNAPBACK_REACT_OPTIMISTIC_RESULT_CONTRACT_REQUIRED',
      'optimistic projection requires a generated query result contract',
    );
  }
  const result = contract.validator.validate(value);
  if (!result.ok) {
    throw diagnosticError(
      violationCode,
      'value did not satisfy the generated result contract',
      { resultContractHash: contract.hash, path: result.path },
    );
  }
  return deepFreeze(result.value);
}

const singleValueQueryContract = (contract) => (
  contract?.descriptor?.kind === 'value' || contract?.descriptor?.kind === 'document'
);

function validateQueryRows(contract, rows, options = {}) {
  if (!singleValueQueryContract(contract)) {
    return validateResultContract(contract, rows, options);
  }
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw diagnosticError(
      options.violationCode ?? 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED',
      'single-value query delivery must carry exactly one internal row',
      { resultContractHash: contract?.hash ?? null, rowCount: Array.isArray(rows) ? rows.length : null },
    );
  }
  return deepFreeze([validateResultContract(contract, rows[0], options)]);
}

const validateQueryProjection = (contract, value, options = {}) => (
  singleValueQueryContract(contract)
    ? deepFreeze([validateResultContract(contract, value, options)])
    : validateResultContract(contract, value, options)
);

const projectQueryRows = (contract, rows) => (
  singleValueQueryContract(contract) ? rows[0] : rows
);

function heartbeatInterval(ttlMs) {
  return Math.max(250, Math.min(Math.floor(ttlMs / 2), 10_000));
}

function weakConnection(values) {
  let current = 'idle';
  for (const value of values) {
    if (CONNECTION_ORDER[value] < CONNECTION_ORDER[current]) current = value;
  }
  return current;
}

function normalizeConnection(value, detail = {}) {
  const order = CONNECTION_ORDER[value];
  if (order >= 2 && order <= 6) return value;
  if (value === 'closed') return 'closed';
  if (value === 'error' || detail?.error) return 'error';
  return 'disconnected';
}

// Latest retainability classification from the live handle (LLP 0129
// Phase 0 refuse-with-clarity fact; frozen on the headless handle). Facts
// are surfaced, never synthesized: null stays null until the client
// classifies the subscription.
function captureRetention(store) {
  const retention = store.handle?.current?.retention ?? null;
  if (retention !== null) store.retention = retention;
}

function queryStateForConnection(store, connection, detail = {}) {
  const snapshot = store.snapshot;
  if (snapshot.status === 'blocked') return snapshot;
  if (connection === 'error') {
    return Object.freeze({
      status: 'error',
      data: undefined,
      error: serializeError(detail.error ?? new Error('live query connection failed')),
      connection,
      freshness: 'unknown',
      retention: store.retention,
    });
  }
  if (connection === 'closed') {
    return Object.freeze({
      status: 'error',
      data: undefined,
      error: diagnostic('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed'),
      connection,
      freshness: 'unknown',
      retention: store.retention,
    });
  }
  if (snapshot.status === 'ready' || snapshot.status === 'refreshing') {
    return Object.freeze({
      // Retained rows are never presented as settled: 'ready' requires both
      // a live connection AND authoritative freshness (LLP 0043's
      // never-presented-as-current rule projected onto the status axis).
      status: connection === 'live' && snapshot.freshness !== 'retained'
        ? 'ready'
        : 'refreshing',
      data: snapshot.data,
      error: null,
      connection,
      freshness: snapshot.freshness,
      answerClass: snapshot.answerClass,
      retention: store.retention,
      optimisticPresentation:
        snapshot.optimisticPresentation ?? store.generatedPresentation,
    });
  }
  if (snapshot.status === 'error') {
    // An error snapshot (e.g. an authorization denial after a bearer custody
    // transition — 0137 A1-Expo f4) survives ordinary connection movement;
    // only fresh authoritative rows clear it. Pre-fix the trailing
    // 'disconnected' event wiped the denial back to pending, so the hook
    // presented zero rows with no error fact.
    return Object.freeze({ ...snapshot, connection });
  }
  return pending(connection);
}

function assertProvider(provider) {
  if (provider?.kind === 'snapback.react-provider.v1') return provider;
  throw diagnosticError(
    'SNAPBACK_REACT_PROVIDER_REQUIRED',
    'a SnapbackProvider with a prepared binding is required',
  );
}

function createRegistry(binding, providerInstanceId, options = {}) {
  const client = preparedReactBindingClient(binding);
  const clientDiagnosticsChannel = diagnosticsChannelForClient(client);
  const presenceValueChurnConfig = positiveDevelopmentEnvironment()
    && clientDiagnosticsChannel !== null
    ? hookDiagnosticsOptions(options)
    : null;
  const stores = new Map();
  const rooms = new Map();
  const leases = new Set();
  const roomLeases = new Set();
  const diagnostics = [];
  const connectionListeners = new Set();
  const allHandles = new Set();
  const loadReactRuntime = typeof options.__loadReactRuntime === 'function'
    ? options.__loadReactRuntime
    : () => import('./react-runtime.mjs');
  let preparedGroup = options.preparedGroup ?? null;
  if (preparedGroup !== null && !isPreparedReactQueryGroup(preparedGroup)) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_PREPARATION_INVALID',
      'preparedGroup must come from binding.prepareQueryGroup()',
    );
  }
  if (preparedGroup !== null) admittedReactQueryGroup(binding, preparedGroup.reference);
  const preparedDevUserId = preparedGroup?.devUserId ?? null;
  const preparedPersistResume = preparedGroup?.reference?.persist !== false;
  if (
    preparedGroup?.connectionId
    && options.connectionId
    && preparedGroup.connectionId !== options.connectionId
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_CONNECTION_MISMATCH',
      'provider connectionId must match the register-mode query-group bundle',
      {
        expected: preparedGroup.connectionId,
        actual: options.connectionId,
      },
    );
  }
  const connectionId = options.connectionId
    ?? preparedGroup?.connectionId
    ?? `snapback_react_${providerInstanceId}`;
  const preparedRegistrations = new Map(
    (preparedGroup?.entries ?? [])
      .filter((entry) => entry.registeredSubscription !== null)
      .map((entry) => [
        entry.name,
        entry.registeredSubscription,
      ]),
  );
  const unadoptedPreparedSubscriptions = new Map(
    (preparedGroup?.entries ?? [])
      .filter((entry) => entry.registeredSubscription !== null)
      .map((entry) => [
        entry.registeredSubscription.subscriptionId,
        Object.freeze({
          registration: entry.registeredSubscription,
          reference: entry.ref,
        }),
      ]),
  );
  let manager = typeof client.liveStreamManager === 'function'
    ? client.liveStreamManager(connectionId)
    : null;
  let consumers = 0;
  let presenceConsumers = 0;
  let publishers = 0;
  let terminal = false;
  let custodyPaused = false;
  let hostPaused = false;
  let activityPresenceSessionEpoch = 0;
  // The staged publication callback is a level as well as an edge: stores
  // may register after its one synchronous registry walk but before the
  // coordinator reopens public capture. Retain only the confirmed capture and
  // non-secret authority kind through that synchronous cut; registration in
  // later turns re-reads the coordinator's current exposed authority.
  // @ref LLP 0059#cross-context-ownership — every staged effect remains
  // fenced to the exact successor capture confirmed by the coordinator.
  let confirmedAuthorityContext = null;
  const runtimePaused = () => custodyPaused || hostPaused;
  let leaseSequence = 0;
  let presenceDiagnosticSequence = 0;
  let registeredConnectionAttached = false;
  let registeredRecovery = null;
  let registeredRetirement = Promise.resolve();
  let deliveryCallbackDepth = 0;
  let viewBudgetWarningActive = false;
  const dirtyPreparedSubscriptions = new Set();
  let connectionSnapshotKey = null;
  let connectionSnapshot = Object.freeze({
    status: 'idle',
    diagnostic: null,
    activeSubscriptions: 0,
  });
  // Mounted-provider HMR generation handoff (development only) — LLP 0114
  // dated amendment 2026-08-05. `generationHandoff` tracks at most one
  // in-flight or settled handoff; handoff descriptors resolve to real
  // admitted descriptors once the binding's generation overlay swaps.
  const developmentHmr = options.developmentHmr ?? null;
  if (
    developmentHmr !== null
    && (typeof developmentHmr !== 'object' || Array.isArray(developmentHmr))
  ) {
    throw new TypeError('developmentHmr must be an options object');
  }
  let generationHandoff = null;
  const handoffResolutions = new WeakMap();

  const notifyConnection = () => {
    for (const listener of [...connectionListeners]) {
      try { listener(); } catch { /* observation cannot own lifecycle */ }
    }
  };
  const recordDiagnostic = (error) => {
    const serialized = serializeError(error);
    const projected = serialized?.schemaVersion === 'snapback.client-diagnostic.v1'
      ? serialized
      : projectDiagnosticV1(serialized);
    const legacy = projected ?? diagnostic(
      serialized?.code ?? error?.code ?? 'SNAPBACK_REACT_QUERY_FAILED',
      serialized?.message ?? (error instanceof Error ? error.message : String(error)),
      serialized?.details ?? {},
    );
    diagnostics.push(legacy);
    if (diagnostics.length > 64) diagnostics.shift();
    // @ref LLP 0219#consumers-and-compatibility — the 64-entry inspection
    // ring and onDiagnostic remain frozen v1 projections while the same error
    // fact also enters the bound client's v2 diagnostics channel.
    emitReactDiagnostic(clientDiagnosticsChannel, {
      code: legacy.code,
      severity: legacy.severity ?? 'error',
      message: legacy.message,
      details: legacy.details,
    });
    try { options.onDiagnostic?.(legacy); } catch { /* observational */ }
    notifyConnection();
  };
  const retireUnadoptedPreparedSubscriptions = () => {
    const pending = [...unadoptedPreparedSubscriptions.values()];
    unadoptedPreparedSubscriptions.clear();
    if (pending.length === 0 || typeof client.unsubscribeLive !== 'function') {
      return registeredRetirement;
    }
    registeredRetirement = registeredRetirement.then(async () => {
      await Promise.allSettled(pending.map(async ({ registration, reference }) => {
        try {
          await client.unsubscribeLive(reference, {
            subscriptionId: registration.subscriptionId,
            connectionId,
            ...(preparedDevUserId === null ? {} : { userId: preparedDevUserId }),
          });
        } catch (error) {
          recordDiagnostic(error);
        }
      }));
    });
    return registeredRetirement;
  };
  const invalidatePreparedRegistrations = (reason) => {
    if (
      preparedGroup === null
      || (
        unadoptedPreparedSubscriptions.size === 0
        && !preparedGroup.entries.some(
          (entry) => entry.registeredSubscription !== null,
        )
      )
    ) return;
    const retirement = retireUnadoptedPreparedSubscriptions();
    preparedRegistrations.clear();
    for (const store of stores.values()) store.registeredSubscription = null;
    preparedGroup = Object.freeze({
      ...preparedGroup,
      source: 'live-recovery',
      reason,
      connectionId: null,
      boot: null,
      entries: Object.freeze(preparedGroup.entries.map((entry) => Object.freeze({
        name: entry.name,
        ref: entry.ref,
        args: entry.args,
        registeredSubscription: null,
        readOnlySnapshot: entry.readOnlySnapshot ?? null,
        ...(entry.bootDelivery === undefined ? {} : { bootDelivery: entry.bootDelivery }),
      }))),
    });
    return retirement;
  };
  const markPreparedGroupRecovery = (reason) => {
    if (preparedGroup?.source !== 'registered-bundle') return;
    preparedGroup = Object.freeze({
      ...preparedGroup,
      source: 'live-recovery',
      reason,
      boot: null,
    });
  };
  // @ref LLP 0112#registered-boot — once the shared connection attaches,
  // frames for a not-yet-demanded child cannot be dropped and followed by an
  // older bundle snapshot presented as current. Mark it for a fresh
  // superseding subscribe before its first store can publish.
  const unregisterPreparedFrameGuard = typeof client.registerDurableConsumer === 'function'
    ? client.registerDurableConsumer(
      connectionId,
      (frame) => {
        const subscriptionId = frame?.subscription_id ?? frame?.subscriptionId ?? null;
        if (typeof subscriptionId !== 'string') return;
        const pending = unadoptedPreparedSubscriptions.get(subscriptionId);
        if (!pending) return;
        if (dirtyPreparedSubscriptions.has(subscriptionId)) return;
        dirtyPreparedSubscriptions.add(subscriptionId);
        markPreparedGroupRecovery('unadopted-delta');
        const claimedStore = [...stores.values()].find(
          (store) => store.unadoptedSubscriptionId === subscriptionId,
        );
        if (claimedStore) {
          claimedStore.blockedPreparedPublication = true;
          queueMicrotask(() => {
            if (
              terminal
              || claimedStore.unadoptedSubscriptionId !== subscriptionId
            ) return;
            unadoptedPreparedSubscriptions.delete(subscriptionId);
            claimedStore.unadoptedSubscriptionId = null;
            stopStore(claimedStore, { blank: true });
            claimedStore.registeredSubscription = null;
            claimedStore.supersedesSubscriptionId = subscriptionId;
            claimedStore.blockedPreparedPublication = false;
            startStore(claimedStore);
          });
        }
      },
    )
    : () => {};
  const recoverExpiredRegisteredConnection = () => {
    if (registeredRecovery !== null) return registeredRecovery;
    custodyPaused = true;
    const attachDeadline = preparedGroup?.boot?.attachDeadline
      ?? preparedGroup?.entries.find(
        (entry) => Number.isSafeInteger(entry.registeredSubscription?.attachDeadline),
      )?.registeredSubscription?.attachDeadline
      ?? null;
    const retirement = invalidatePreparedRegistrations('attach-deadline-expired');
    const connectionRelease = Promise.resolve(client.releaseConnection?.(connectionId, {
        attachDeadline,
        ifIdle: true,
      }));
    registeredRecovery = Promise.allSettled([retirement, connectionRelease])
      .then((settlements) => {
        for (const settlement of settlements) {
          if (settlement.status === 'rejected') recordDiagnostic(settlement.reason);
        }
      })
      .catch(recordDiagnostic)
      .then(() => {
        if (terminal) return;
        manager = typeof client.liveStreamManager === 'function'
          ? client.liveStreamManager(connectionId)
          : null;
        custodyPaused = false;
        if (hostPaused) return;
        for (const store of stores.values()) startStore(store);
        for (const room of rooms.values()) startRoom(room);
      })
      .finally(() => { registeredRecovery = null; });
    return registeredRecovery;
  };
  const activeStores = () => [...stores.values()].filter((store) => store.handle !== null);

  const warnSubscriptionBudget = (projectedSubscriptions) => {
    if (projectedSubscriptions <= VIEW_SUBSCRIPTION_BUDGET) {
      viewBudgetWarningActive = false;
      return;
    }
    if (viewBudgetWarningActive) return;
    viewBudgetWarningActive = true;
    recordDiagnostic(warningDiagnostic(
      'SNAPBACK_REACT_SUBSCRIPTION_VIEW_BUDGET_EXCEEDED',
      `provider view ${providerInstanceId} is composing ${projectedSubscriptions} independent live subscriptions; this remains supported through ${SERVER_SUBSCRIPTION_CAP}`,
      {
        owner: `provider:${providerInstanceId}`,
        count: projectedSubscriptions,
        budget: VIEW_SUBSCRIPTION_BUDGET,
        hardCeiling: SERVER_SUBSCRIPTION_CAP,
        independentSupported: true,
        atomicCrossSetAlternative: 'defineSetKeyedAggregate',
        fanoutAlternative: 'defineChunkedSemiJoin',
      },
    ));
  };

  const consumerVisibleSnapshotKey = (snapshot) => canonicalizeClientValueV1({
    status: snapshot.status,
    data: snapshot.data ?? null,
    error: snapshot.error ?? null,
    connection: snapshot.connection ?? null,
    freshness: snapshot.freshness ?? null,
    answerClass: snapshot.answerClass ?? null,
    retention: snapshot.retention ?? null,
    optimisticPresentation: snapshot.optimisticPresentation ?? null,
  });

  const notifyStoreListeners = (store) => {
    for (const listener of [...store.listeners.values()]) {
      deliveryCallbackDepth += 1;
      try { listener(); } catch { /* one consumer cannot starve siblings */ }
      finally { deliveryCallbackDepth -= 1; }
    }
  };

  const publish = (store, snapshot, generation = store.generation) => {
    if (terminal || generation !== store.generation) return;
    const presentation = snapshot.optimisticPresentation ?? store.generatedPresentation;
    const predicted = presentation?.status === 'predicted'
      || store.optimisticLayers.some((layer) => !layer.failed && !layer.retired);
    const answerClass = snapshot.answerClass ?? (
      predicted && snapshot.data !== undefined
        ? 'optimistic'
        : presentation?.status === 'pending-without-prediction'
          ? 'pending-without-prediction'
        : snapshot.freshness === 'retained'
          ? 'labeled-retained'
          : snapshot.freshness === 'current' || snapshot.freshness === 'snapshot'
            ? 'authoritative'
            : 'unknown'
    );
    const nextSnapshot = Object.freeze({
      ...snapshot,
      answerClass,
      lastDeliveryAtMs: store.lastDeliveryAtMs,
      authoritativeRevision: store.authoritativeRevision,
      ...(presentation === undefined ? {} : { optimisticPresentation: presentation }),
    });
    const nextVisibleKey = consumerVisibleSnapshotKey(nextSnapshot);
    const consumerVisibleChange = store.consumerVisibleSnapshotKey !== nextVisibleKey;
    store.snapshot = nextSnapshot;
    store.consumerVisibleSnapshotKey = nextVisibleKey;
    if (consumerVisibleChange) notifyStoreListeners(store);
    notifyConnection();
  };

  const releaseLayerPin = (store, layer) => {
    if (typeof layer.mutationSubscription === 'function') {
      const unsubscribe = layer.mutationSubscription;
      layer.mutationSubscription = null;
      try { unsubscribe(); } catch { /* observation teardown cannot own layer state */ }
    }
    if (layer.pinReleased) return;
    layer.pinReleased = true;
    store.pins = Math.max(0, store.pins - 1);
    if (store.consumers !== 0 || store.pins !== 0) return;
    const idleEpoch = ++store.idleEpoch;
    queueMicrotask(() => {
      if (
        store.consumers !== 0
        || store.pins !== 0
        || store.idleEpoch !== idleEpoch
        || store.handoffPending !== 0
      ) return;
      stopStore(store);
      void Promise.allSettled([...allHandles].map((handle) => handle.settled()))
        .then(() => {
          if (
            store.consumers === 0
            && store.pins === 0
            && store.idleEpoch === idleEpoch
          ) stores.delete(store.key);
          notifyConnection();
        });
    });
  };

  const materializeStore = (store) => {
    if (store.authorizationProjectionSuspended) return store.authoritativeData;
    let rows = store.generatedData ?? store.authoritativeData;
    for (const layer of store.optimisticLayers) {
      if (layer.failed) continue;
      try {
        rows = validateQueryProjection(
          store.resultContract,
          layer.update(
            immutableClone(projectQueryRows(store.resultContract, rows)),
            immutableClone(layer.mutationArgs),
          ),
          { requireKnown: true },
        );
      } catch (error) {
        layer.failed = true;
        layer.retired = true;
        store.pendingMutations.delete(layer.id);
        releaseLayerPin(store, layer);
        recordDiagnostic(diagnosticError(
          'SNAPBACK_REACT_OPTIMISTIC_REBASE_FAILED',
          'an optimistic reducer failed while rebasing over newer authority',
          { attemptId: layer.id, cause: error?.code ?? error?.message ?? String(error) },
        ));
      }
    }
    store.optimisticLayers = store.optimisticLayers.filter((layer) => !layer.failed);
    return rows;
  };

  const freezeBootDelivery = (source, snapshot) => Object.freeze({
    ...snapshot,
    ...(source.bootDelivery === null ? {} : { bootDelivery: source.bootDelivery }),
  });

  // Channel B retained delivery (LLP 0090 D3 / LLP 0114 freshness axis): a
  // persisted/preloaded frame renders marked 'retained' — status stays
  // 'refreshing', never 'ready' — WITHOUT advancing the authoritative
  // revision, so app-authored reducer admission still requires a current
  // authoritative store and no layer retirement can key on a retained frame.
  // Generated-IR presentation is admitted by the headless owner and may
  // reconstruct over retained rows without promoting them to authority.
  const publishRetained = (
    store,
    rows,
    generation = store.generation,
    presentedRows = rows,
  ) => {
    store.authoritativeData = validateQueryRows(store.resultContract, rows);
    store.generatedData = validateQueryRows(store.resultContract, presentedRows);
    store.freshness = 'retained';
    captureRetention(store);
    publish(store, freezeBootDelivery(store, {
      status: 'refreshing',
      data: projectQueryRows(store.resultContract, store.generatedData),
      error: null,
      connection: normalizeConnection(store.handle?.current?.connection ?? 'connecting'),
      freshness: 'retained',
      answerClass: store.generatedPresentation?.status === 'predicted'
        ? 'optimistic'
        : store.generatedPresentation?.status === 'pending-without-prediction'
          ? 'pending-without-prediction'
        : 'labeled-retained',
      retention: store.retention,
      optimisticPresentation: store.generatedPresentation,
    }), generation);
  };

  const publishAuthoritative = (
    store,
    rows,
    generation = store.generation,
    presentedRows = rows,
    detail = null,
  ) => {
    const deliveredVersion = Number.isSafeInteger(detail?.version)
      ? detail.version
      : Number.isSafeInteger(store.handle?.current?.authoritativeRevision)
        ? store.handle.current.authoritativeRevision
        : store.authoritativeRevision + 1;
    store.authoritativeRevision = deliveredVersion;
    store.lastDeliveryAtMs = Number.isFinite(store.handle?.current?.lastDeliveryAtMs)
      ? store.handle.current.lastDeliveryAtMs
      : Date.now();
    store.deliveryLagMs = Number.isFinite(store.handle?.current?.deliveryLagMs)
      ? store.handle.current.deliveryLagMs
      : null;
    store.authoritativeData = validateQueryRows(store.resultContract, rows);
    store.generatedData = validateQueryRows(store.resultContract, presentedRows);
    store.freshness = 'current';
    captureRetention(store);
    observeOptimisticCreateAuthority(store);
    for (const layer of store.optimisticLayers) {
      if (!layer.confirmed) continue;
      try {
        const matched = layer.isAuthoritative
          ? layer.isAuthoritative(
              immutableClone(store.authoritativeData),
              immutableClone(layer.result),
            ) === true
          : store.authoritativeRevision > layer.confirmedRevision;
        // @ref LLP 0107#replay-safety-affordances — 2026-08-07 ruling: a projectRecordFields
        // layer's claim is moot when its identified row is absent from an authoritative
        // delivery (field projection on an absent row has nothing to project); custom
        // matchers keep complete-receipt semantics.
        const recordAbsent = !matched
          && layer.recordProjection !== null
          && !store.authoritativeData.some(
            (row) => row?.[layer.recordProjection.idField] === layer.recordProjection.recordId,
          );
        if (matched || recordAbsent) {
          layer.retired = true;
          releaseLayerPin(store, layer);
        }
      } catch (error) {
        layer.retired = true;
        layer.failed = true;
        releaseLayerPin(store, layer);
        recordDiagnostic(diagnosticError(
          'SNAPBACK_REACT_OPTIMISTIC_REBASE_FAILED',
          'an optimistic authority matcher failed after dispatch',
          { attemptId: layer.id, cause: error?.code ?? error?.message ?? String(error) },
        ));
      }
    }
    store.optimisticLayers = store.optimisticLayers.filter((layer) => !layer.retired);
    const authoritativeConnection = normalizeConnection(
      store.handle?.current?.connection ?? 'live',
    );
    const nextSnapshot = freezeBootDelivery(store, {
      status: authoritativeConnection === 'live' ? 'ready' : 'refreshing',
      data: projectQueryRows(store.resultContract, materializeStore(store)),
      error: null,
      connection: authoritativeConnection,
      freshness: 'current',
      answerClass: store.generatedPresentation?.status === 'predicted'
        ? 'optimistic'
        : store.generatedPresentation?.status === 'pending-without-prediction'
          ? 'pending-without-prediction'
        : 'authoritative',
      retention: store.retention,
      optimisticPresentation: store.generatedPresentation,
    });
    const nextVisibleKey = consumerVisibleSnapshotKey(nextSnapshot);
    if (store.consumerVisibleSnapshotKey === nextVisibleKey) {
      // @ref LLP 0278#d05-subscription-budgets-provisional — value-equal
      // authoritative frames still advance delivery/revision bookkeeping,
      // but do not republish an unchanged consumer-visible snapshot. A
      // reconnect/custody lifecycle cut changes the key and therefore cannot
      // be swallowed by this branch.
      store.suppressedEqualSnapshots += 1;
      store.snapshot = Object.freeze({
        ...store.snapshot,
        lastDeliveryAtMs: store.lastDeliveryAtMs,
        authoritativeRevision: store.authoritativeRevision,
      });
      notifyConnection();
      return;
    }
    publish(store, nextSnapshot, generation);
  };

  const publishAuthorizationBoundary = (store, detail, generation) => {
    const blank = validateQueryRows(store.resultContract, []);
    store.authorizationProjectionSuspended = true;
    store.authoritativeData = blank;
    store.generatedData = blank;
    store.generatedPresentation = null;
    store.freshness = 'unknown';
    store.retention = null;
    if (store.optimisticCreate !== null) {
      if (detail?.kind === 'authorization_delete') {
        closeOptimisticCreate(store, store.optimisticCreate, { force: true });
      } else {
        store.optimisticCreate.authorizationGeneration += 1;
        store.optimisticCreate.proofReleaseGeneration = null;
        store.optimisticCreate.suspended = true;
        store.optimisticCreate.deferred = true;
        store.optimisticCreate.cache = null;
      }
    }
    if (detail?.kind === 'authorization_delete') {
      for (const layer of store.optimisticLayers) {
        layer.retired = true;
        releaseLayerPin(store, layer);
      }
      store.optimisticLayers = [];
      store.pendingMutations.clear();
    }
    const terminalError = detail?.kind === 'authorization_error' && detail?.terminal === true
      ? detail.error ?? detail.authorization
      : null;
    const refusal = detail?.refusal ?? null;
    const surfacedError = terminalError ?? refusal;
    // @ref LLP 0059#typed-terminal-auth-error — terminal authority loss is a
    // classified error owned by the coordinator, never a successful empty
    // answer. Nonterminal quarantine/delete keeps the existing blank fence.
    publish(store, freezeBootDelivery(store, {
      status: surfacedError === null ? 'ready' : 'error',
      data: surfacedError === null
        ? projectQueryRows(store.resultContract, blank)
        : undefined,
      error: surfacedError === null
        ? null
        : terminalError === null ? serializeError(refusal) : authOwnedDiagnostic(terminalError),
      ...(terminalError === null ? {} : { transitionOwner: AUTH_TRANSITION_OWNER }),
      connection: normalizeConnection(store.handle?.current?.connection ?? 'disconnected'),
      freshness: 'unknown',
      answerClass: 'unknown',
      retention: null,
      optimisticPresentation: null,
    }), generation);
  };

  const publishAuthTransitionSuccessorFailure = (
    store,
    error,
    generation,
    details = {},
  ) => {
    const failure = authTransitionSuccessorError(store, error, details);
    store.authoritativeData = validateQueryRows(store.resultContract, []);
    store.generatedData = store.authoritativeData;
    store.generatedPresentation = null;
    store.freshness = 'unknown';
    store.retention = null;
    publish(store, Object.freeze({
      status: 'error',
      data: undefined,
      error: serializeError(failure),
      transitionOwner: AUTH_TRANSITION_OWNER,
      connection: 'error',
      freshness: 'unknown',
      retention: null,
      optimisticPresentation: null,
    }), generation);
    recordDiagnostic(failure);
    return failure;
  };

  const publishGeneratedPresentation = (store, rows, detail, generation) => {
    store.generatedPresentation = detail?.optimisticPresentation ?? null;
    store.generatedData = validateQueryRows(store.resultContract, rows);
    publish(store, freezeBootDelivery(store, {
      status: store.freshness === 'retained' ? 'refreshing' : 'ready',
      data: projectQueryRows(store.resultContract, materializeStore(store)),
      error: null,
      connection: normalizeConnection(store.handle?.current?.connection ?? 'live'),
      freshness: store.freshness,
      answerClass: detail?.optimisticPresentation?.status === 'predicted'
        ? 'optimistic'
        : detail?.optimisticPresentation?.status === 'pending-without-prediction'
          ? 'pending-without-prediction'
        : detail?.answerClass
          ?? (store.freshness === 'retained' ? 'labeled-retained' : 'authoritative'),
      retention: store.retention,
      optimisticPresentation: detail?.optimisticPresentation ?? null,
    }), generation);
  };

  const clearUnadoptedSubscription = (store) => {
    if (store.unadoptedSubscriptionId === null) return;
    unadoptedPreparedSubscriptions.delete(store.unadoptedSubscriptionId);
    store.unadoptedSubscriptionId = null;
  };

  // @ref LLP 0114#bounded-subscribe-failure-window--2026-08-04 — a store whose
  // subscribe rejects holds its error snapshot behind a timer-owned failure
  // window (the client's 250ms→10s reconnect ladder, held at the cap while
  // demanded). Render- and mutation-driven startStore calls during the window
  // are inert, so render cadence can never set subscribe-attempt cadence
  // (RN carrier storm, issues/closed/20260803-rn-carrier-bricked-tosorted-
  // registration-ledger.md). Success, supersession, or any stopStore
  // lifecycle event (idle release, custody movement, dispose) clears it.
  const clearSubscribeFailureWindow = (store) => {
    store.retry?.();
    store.retry = null;
  };

  const classifySubscribeFailure = (
    store,
    error,
    generation,
    handle,
    terminalProtocolRefusal,
    failureAlreadyPublished = false,
    cause = error,
    retryAuthorityContext = null,
  ) => {
    if (store.generation !== generation || store.handle !== handle) return;
    store.retry ??= () => {};
    void loadReactRuntime().then(({ handleSubscribeFailure }) => (
      handleSubscribeFailure([
        store, error, generation, handle, clearUnadoptedSubscription,
        allHandles, recoverExpiredRegisteredConnection, publish, serializeError,
        () => !terminal && !runtimePaused(),
        () => startStore(store, null, retryAuthorityContext),
        () => isAnonymousProtectedAuthorizationDenial(
          client,
          store.reference,
          cause,
        ) ? AUTHENTICATION_REQUIRED_BLOCKED : null,
        recordDiagnostic,
        terminalProtocolRefusal,
        failureAlreadyPublished,
      ])
    )).catch((loadError) => {
      recordDiagnostic(loadError);
      if (
        store.retry === null
        || store.generation !== generation
        || store.handle !== handle
      ) return;
      // The optional failure helper is an optimization, never the owner of
      // correctness. If its chunk cannot load, synchronously cut the dead
      // handle and publish the subscribe failure, then use a deliberately
      // simple fixed-delay retry so the query remains recoverable.
      clearUnadoptedSubscription(store);
      store.handle = null;
      allHandles.delete(handle);
      if (isAnonymousProtectedAuthorizationDenial(client, store.reference, cause)) {
        store.retry = null;
        store.freshness = 'unknown';
        store.retention = null;
        publish(store, AUTHENTICATION_REQUIRED_BLOCKED, generation);
        return;
      }
      if (!failureAlreadyPublished) {
        publish(store, Object.freeze({
          status: 'error',
          data: undefined,
          error: serializeError(error),
          connection: 'error',
          freshness: 'unknown',
          retention: store.retention,
        }), generation);
      }
      if (terminalProtocolRefusal) {
        // Keep a no-op failure-window sentinel while this mounted demand
        // remains. Render-driven re-subscribe calls must not turn a
        // terminal negotiation refusal into an immediate retry loop.
        store.retry = () => {};
        if (!failureAlreadyPublished) recordDiagnostic(error);
        return;
      }
      let retryHandle = setTimeout(() => {
        retryHandle = null;
        if (store.retry !== cancelRetry) return;
        store.retry = null;
        if (!terminal && !runtimePaused() && (store.consumers > 0 || store.pins > 0)) {
          startStore(store, null, retryAuthorityContext);
        }
      }, REACT_RUNTIME_FALLBACK_RETRY_MS);
      retryHandle?.unref?.();
      const cancelRetry = () => {
        if (retryHandle !== null) clearTimeout(retryHandle);
        retryHandle = null;
      };
      store.retry = cancelRetry;
    });
  };

  const stopStore = (store, { blank = false } = {}) => {
    store.generation += 1;
    clearSubscribeFailureWindow(store);
    const handle = store.handle;
    store.handle = null;
    if (blank) {
      store.snapshot = pending('idle');
      store.consumerVisibleSnapshotKey = consumerVisibleSnapshotKey(store.snapshot);
      store.freshness = 'unknown';
      store.retention = null;
      // Delivery facts belong to the retired authority. The blank frame is a
      // real confidentiality cut, not a presentation that may inherit the
      // predecessor's delivery time or authoritative revision.
      store.lastDeliveryAtMs = null;
      store.authoritativeRevision = 0;
      store.deliveryLagMs = null;
    }
    if (handle) {
      try { handle.dispose(); } catch (error) { recordDiagnostic(error); }
      allHandles.add(handle);
      void handle.settled().catch(recordDiagnostic).finally(() => allHandles.delete(handle));
    }
    if (blank) {
      notifyStoreListeners(store);
    }
    notifyConnection();
  };

  const publishLevelTriggeredAuthAdmission = (store) => {
    if (!generatedAuthScopedLiveReference(store.reference)) return false;
    const terminalStatus = typeof client.authTerminalStatus === 'function'
      ? client.authTerminalStatus()
      : null;
    if (terminalStatus?.terminated === true) {
      const code = terminalStatus.code ?? 'SNAPBACK_AUTH_TRANSITION_FAILED';
      if (
        store.snapshot.status !== 'error'
        || store.snapshot.transitionOwner !== AUTH_TRANSITION_OWNER
        || store.snapshot.error?.code !== code
      ) {
        const generation = ++store.generation;
        const terminalError = diagnosticError(
          code,
          'the live query authority terminated',
          {
            ...(terminalStatus.authorityDisposition == null
              ? {}
              : { authorityDisposition: terminalStatus.authorityDisposition }),
          },
        );
        store.freshness = 'unknown';
        store.retention = null;
        publish(store, Object.freeze({
          status: 'error',
          data: undefined,
          error: authOwnedDiagnostic(terminalError),
          transitionOwner: AUTH_TRANSITION_OWNER,
          connection: 'error',
          freshness: 'unknown',
          answerClass: 'unknown',
          retention: null,
          optimisticPresentation: null,
        }), generation);
      }
      return true;
    }
    if (!custodyPaused) return false;
    if (
      store.snapshot.status !== 'blocked'
      || store.snapshot.reason !== 'authentication-not-settled'
    ) {
      const generation = ++store.generation;
      store.freshness = 'unknown';
      store.retention = null;
      publish(store, AUTHENTICATION_NOT_SETTLED_BLOCKED, generation);
    }
    return true;
  };

  const startStore = (store, supersedes = null, authorityContext = null) => {
    if (terminal || store.handle || (store.consumers === 0 && store.pins === 0)) return;
    // @ref LLP 0059#exposure-invariant — auth admission is level-triggered:
    // a store created after blank() must still observe the closed barrier, and
    // a store created after a terminal cut must recover the recorded terminal
    // classification even though it missed that cut's registry walk.
    if (publishLevelTriggeredAuthAdmission(store)) return null;
    if (runtimePaused()) return;
    if (store.readOnlySnapshot !== null) return null;
    const settledAuthorityContext = authorityContext ?? confirmedAuthorityContext;
    const authorityAdmission = generatedLiveAuthorityAdmission(
      client,
      store.reference,
      settledAuthorityContext,
    );
    const authorityState = authorityAdmission.state;
    if (authorityState === 'settling') {
      if (
        store.snapshot.status !== 'blocked'
        || store.snapshot.reason !== 'authentication-not-settled'
      ) {
        const generation = ++store.generation;
        store.freshness = 'unknown';
        store.retention = null;
        publish(store, AUTHENTICATION_NOT_SETTLED_BLOCKED, generation);
      }
      return null;
    }
    if (authorityState === 'anonymous') {
      if (
        store.snapshot.status !== 'blocked'
        || store.snapshot.reason !== 'authentication-required'
      ) {
        const generation = ++store.generation;
        store.freshness = 'unknown';
        store.retention = null;
        publish(store, AUTHENTICATION_REQUIRED_BLOCKED, generation);
      }
      return null;
    }
    // A one-for-one supersession must carry its exact predecessor witness to
    // the server now; it is an explicit invalidation, so it resets any held
    // failure window rather than waiting behind it.
    if (supersedes !== null) clearSubscribeFailureWindow(store);
    else if (store.retry !== null) return;
    if (
      store.registeredSubscription !== null
      && !registeredConnectionAttached
      && Number.isSafeInteger(store.registeredSubscription.attachDeadline)
      && Date.now() >= store.registeredSubscription.attachDeadline
    ) {
      void recoverExpiredRegisteredConnection();
      return;
    }
    const generation = ++store.generation;
    store.authorizationProjectionSuspended = false;
    store.snapshot = pending('connecting');
    // Even though construction does not publish this intermediate frame, it
    // is the lifecycle predecessor for dedup. The first equal-row successor
    // delivery must therefore compare against connecting, not against the
    // retired ready snapshot.
    store.consumerVisibleSnapshotKey = consumerVisibleSnapshotKey(store.snapshot);
    store.freshness = 'unknown';
    // @ref LLP 0059#exposure-invariant — a staged participant-resume capture
    // is the exact successor witness. Optional-user queries consume it just
    // like authenticated queries; the distinction is admission while the
    // settled authority is anonymous. This branch completes a restart the
    // registry already elected; it does not define the shared restart policy
    // now adopted by LLP 0059's LLP 0295 W2 amendment.
    let transitionSuccessorPending = settledAuthorityContext !== null
      && (
        store.reference?.authRequirement === 'authenticated'
        || store.reference?.authRequirement === 'optional-user'
      );
    const notifyLivePublish = () => {
      if (terminal || generation !== store.generation) return;
      for (const listener of [...store.livePublishListeners.values()]) {
        try { listener(); } catch { /* observation cannot own publication */ }
      }
    };
    let handle;
    try {
      handle = client.startLiveQuery(store.reference, {
        connectionId,
        __frameworkOwnerLabel: `provider:${providerInstanceId}/query:${store.reference?.name ?? store.reference?.id ?? 'unknown'}`,
        args: store.args,
        transport: 'stream',
        fallbackToPoll: false,
        supersedes,
        ...(preparedDevUserId === null ? {} : { userId: preparedDevUserId }),
        persistResume: preparedPersistResume,
        ...(authorityAdmission.authorityContext?.capture == null
          ? {}
          : { authorityCapture: authorityAdmission.authorityContext.capture }),
        ...(store.registeredSubscription?.authorizationNamespace == null
          ? {}
          : { authorizationNamespace: store.registeredSubscription.authorizationNamespace }),
        ...(store.supersedesSubscriptionId === null
          ? {}
          : { supersedesSubscriptionId: store.supersedesSubscriptionId }),
        ...(store.registeredSubscription === null
          ? {}
          : { registeredSubscription: store.registeredSubscription }),
        // React's external store validates and projects the internal row carrier
        // itself (including blank/retained lifecycle states). Public headless
        // live handles project single-value contracts in snapback-client.
        __internalRawResultCarrier: true,
        onUpdate(rows, detail) {
        // Fence before touching any store-owned projection state. publish()
        // also checks this generation, but predecessor callbacks mutate rows
        // before publishing and therefore need this synchronous ingress cut.
        if (
          terminal
          || generation !== store.generation
          || (handle !== undefined && store.handle !== handle)
        ) return;
        if (store.blockedPreparedPublication) return;
        notifyLivePublish();
        clearUnadoptedSubscription(store);
        if (
          detail?.kind === 'authorization_quarantine'
          || detail?.kind === 'authorization_delete'
          || detail?.kind === 'authorization_error'
          || detail?.kind === 'live_refused'
        ) {
          publishAuthorizationBoundary(store, detail, generation);
          return;
        }
        const authorityBearingFrame = (
          detail?.kind === 'authorization_snapshot'
          || detail?.kind === 'authorization_denied'
          || detail?.kind === 'live_replace'
          || detail?.kind === 'live_delta'
          || detail?.kind === 'snapshot'
          || detail?.kind === 'persisted'
        );
        if (authorityBearingFrame) {
          transitionSuccessorPending = false;
          store.authorizationProjectionSuspended = false;
          if (store.optimisticCreate !== null) {
            if (detail?.kind === 'authorization_denied') {
              closeOptimisticCreate(store, store.optimisticCreate, { force: true });
            } else if (store.optimisticCreate.suspended) {
              store.optimisticCreate.authorizationGeneration += 1;
              store.optimisticCreate.proofReleaseGeneration =
                store.optimisticCreate.authorizationGeneration;
              store.optimisticCreate.cache = null;
            }
          }
        } else if (store.authorizationProjectionSuspended) {
          publishAuthorizationBoundary(store, detail, generation);
          return;
        }
        if (detail?.optimisticPresentation !== undefined) {
          store.generatedPresentation = detail.optimisticPresentation;
        }
        if (detail?.kind === 'optimistic_projection') {
          transitionSuccessorPending = false;
          if (store.freshness === 'unknown' && Array.isArray(detail?.authoritativeRows)) {
            if (detail.freshness === 'retained') {
              publishRetained(store, detail.authoritativeRows, generation, rows ?? []);
            } else {
              publishAuthoritative(
                store,
                detail.authoritativeRows,
                generation,
                rows ?? [],
                detail,
              );
            }
          } else {
            publishGeneratedPresentation(store, rows ?? [], detail, generation);
          }
          return;
        }
        if (detail?.kind === 'authorization_denied') {
          // A server-answered authorization denial (0137 A1-Expo f4: e.g. a
          // bearer custody transition to a lesser-privileged successor) is a
          // renderable outcome, not an empty 'ready'. Rows are already blank;
          // project the denial on the error axis. Fresh authoritative rows
          // (a later authorized subscribe) clear it below.
          if (isAnonymousProtectedAuthorizationDenial(
            client,
            store.reference,
            detail.error ?? detail.authorization,
          )) {
            store.freshness = 'unknown';
            store.retention = null;
            publish(store, AUTHENTICATION_REQUIRED_BLOCKED, generation);
            return;
          }
          captureRetention(store);
          publish(store, Object.freeze({
            status: 'error',
            data: undefined,
            error: serializeError(detail.error ?? detail.authorization),
            connection: normalizeConnection(store.handle?.current?.connection ?? 'disconnected'),
            freshness: 'unknown',
            retention: store.retention,
          }), generation);
          return;
        }
        if (detail?.freshness === 'retained') {
          transitionSuccessorPending = false;
          publishRetained(
            store,
            detail?.authoritativeRows ?? rows ?? [],
            generation,
            rows ?? [],
          );
          return;
        }
        transitionSuccessorPending = false;
        publishAuthoritative(
          store,
          detail?.authoritativeRows ?? rows ?? [],
          generation,
          rows ?? [],
          detail,
        );
      },
      onConnectionChange(connection, detail) {
        if (
          terminal
          || generation !== store.generation
          || (handle !== undefined && store.handle !== handle)
        ) return;
        notifyLivePublish();
        const normalized = normalizeConnection(connection, detail);
        captureRetention(store);
        publish(
          store,
          queryStateForConnection(store, normalized, detail),
          generation,
        );
      },
      });
    } catch (error) {
      // Arm the held failure window before notifying subscribers. A render
      // synchronously prompted by the error snapshot must not turn the
      // retryable creation failure into an immediate subscribe loop.
      store.retry = () => {};
      const subscribeError = transitionSuccessorPending
        ? publishAuthTransitionSuccessorFailure(
          store,
          error,
          generation,
          { creation: 'synchronous' },
        )
        : error;
      classifySubscribeFailure(
        store,
        subscribeError,
        generation,
        null,
        isTerminalLiveProtocolRefusal(error),
        transitionSuccessorPending,
        error,
        settledAuthorityContext,
      );
      return null;
    }
    if (store.registeredSubscription !== null) registeredConnectionAttached = true;
    store.registeredSubscription = null;
    store.handle = handle;
    allHandles.add(handle);
    void handle.started().then(() => {
      if (store.generation !== generation || store.handle !== handle) return;
      clearSubscribeFailureWindow(store);
      if (store.blockedPreparedPublication) return;
      clearUnadoptedSubscription(store);
      if (store.snapshot.status === 'pending' && Array.isArray(handle.current?.rows)) {
        transitionSuccessorPending = false;
        // A handle that established holding only retained rows (offline boot
        // survival — LLP 0129 Phase 0) must not have them republished as
        // authoritative here.
        if (handle.current.freshness === 'retained') {
          publishRetained(
            store,
            handle.current.authoritativeRows ?? handle.current.rows,
            generation,
            handle.current.rows,
          );
        } else {
          publishAuthoritative(
            store,
            handle.current.authoritativeRows ?? handle.current.rows,
            generation,
            handle.current.rows,
            handle.current,
          );
        }
        return;
      }
      // The retainability classification lands on the handle only once the
      // subscribe settles; refresh an already-published snapshot with it.
      captureRetention(store);
      if (
        (store.snapshot.status === 'ready' || store.snapshot.status === 'refreshing')
        && store.snapshot.retention !== store.retention
      ) {
        publish(store, Object.freeze({
          ...store.snapshot,
          retention: store.retention,
        }), generation);
      }
    }, (error) => {
      if (store.generation !== generation || store.handle !== handle) return;
      const terminalProtocolRefusal = isTerminalLiveProtocolRefusal(error);
      const subscribeError = transitionSuccessorPending
        ? authTransitionSuccessorError(store, error, { creation: 'asynchronous' })
        : error;
      if (transitionSuccessorPending) recordDiagnostic(subscribeError);
      classifySubscribeFailure(
        store,
        subscribeError,
        generation,
        handle,
        terminalProtocolRefusal,
        false,
        error,
        settledAuthorityContext,
      );
    });
    void handle.settled().finally(() => allHandles.delete(handle));
    notifyConnection();
    return handle;
  };

  const createStore = (descriptor) => {
    if (stores.size >= QUERY_CACHE_CAP) {
      throw diagnosticError(
        'SNAPBACK_REACT_STORE_CAPACITY',
        `React provider has reached its ${QUERY_CACHE_CAP}-store cache cap`,
        { cap: QUERY_CACHE_CAP },
      );
    }
    const preparedRegistration = preparedRegistrations.get(
      descriptor.preparedEntryName,
    ) ?? null;
    const readOnlySnapshot = descriptor.readOnlySnapshot ?? null;
    const mustResubscribe = preparedRegistration !== null
      && dirtyPreparedSubscriptions.has(preparedRegistration.subscriptionId);
    const store = {
      key: descriptor.key,
      reference: descriptor.reference,
      args: descriptor.args,
      snapshot: readOnlySnapshot === null
        ? pending()
        : freezeBootDelivery(descriptor, {
            status: 'ready',
            data: projectQueryRows(descriptor.resultContract, readOnlySnapshot.rows),
            error: null,
            connection: 'idle',
            freshness: 'snapshot',
            answerClass: 'authoritative',
            retention: null,
          }),
      consumers: 0,
      listeners: new Map(),
      livePublishListeners: new Map(),
      handle: null,
      generation: 0,
      idleEpoch: 0,
      handoffPending: 0,
      retry: null,
      resultContract: descriptor.resultContract,
      authoritativeData: readOnlySnapshot?.rows ?? Object.freeze([]),
      generatedData: readOnlySnapshot?.rows ?? Object.freeze([]),
      generatedPresentation: null,
      authoritativeRevision: readOnlySnapshot === null ? 0 : 1,
      lastDeliveryAtMs: null,
      deliveryLagMs: null,
      suppressedEqualSnapshots: 0,
      freshness: readOnlySnapshot === null ? 'unknown' : 'snapshot',
      retention: null,
      authorizationProjectionSuspended: false,
      optimisticLayers: [],
      pendingMutations: new Map(),
      optimisticCreate: null,
      pins: 0,
      registeredSubscription: mustResubscribe ? null : preparedRegistration,
      readOnlySnapshot,
      bootDelivery: descriptor.bootDelivery,
      unadoptedSubscriptionId: preparedRegistration?.subscriptionId ?? null,
      blockedPreparedPublication: false,
      supersedesSubscriptionId: mustResubscribe
        ? preparedRegistration.subscriptionId
        : null,
      consumerVisibleSnapshotKey: null,
    };
    store.consumerVisibleSnapshotKey = consumerVisibleSnapshotKey(store.snapshot);
    preparedRegistrations.delete(
      descriptor.preparedEntryName,
    );
    stores.set(store.key, store);
    return store;
  };

  const connectedForOptimisticCreate = (store) => (
    ['live', 'polling'].includes(store.snapshot.connection)
  );

  const optimisticCreateTable = (descriptor) => {
    const contract = descriptor.resultContract?.descriptor;
    if (contract?.kind !== 'documents' || typeof contract.table !== 'string') {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_CREATE_QUERY_UNSUPPORTED',
        'optimistic create requires a generated documents query for exactly one table',
        { queryId: descriptor.reference.id },
      );
    }
    return contract.table;
  };

  const admittedOptimisticCreateMutation = (reference, table) => {
    const admitted = admittedReactReference(binding, reference, 'Mutation');
    const ir = reference.mutationIr;
    const steps = ir?.plan?.steps;
    const inserts = Array.isArray(steps)
      ? steps.filter((step) => step?.Insert != null)
      : [];
    if (
      ir?.format !== 'snapback.generated-mutation-ir.v1'
      || ir.capabilityClass !== 'local-executable'
      || !Array.isArray(steps)
      || steps.length !== 1
      || inserts.length !== 1
      || inserts[0].Insert?.table !== table
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_CREATE_INSERT_REQUIRED',
        'optimistic create requires one generated local-executable Insert for the query table',
        { mutationId: admitted.id, table },
      );
    }
    // Admission owns the authorization/deployment check, but its compact
    // reference intentionally omits the generated IR carrier. Dispatch the
    // exact generated reference after that check so sourceIdentity continues
    // to compare against the codegen-owned expectedGeneration bytes.
    return reference;
  };

  const closeOptimisticCreate = (store, state, { force = false } = {}) => {
    if (store.optimisticCreate !== state) return;
    state.generation += 1;
    state.unsubscribe?.();
    state.unsubscribe = null;
    state.view?.close();
    state.view = null;
    state.opening = null;
    state.snapshot = null;
    state.confirmed.clear();
    state.deferred = false;
    state.cache = null;
    if (state.pinReleased === false) releaseLayerPin(store, state);
    if (force || state.consumers === 0) store.optimisticCreate = null;
  };

  const optimisticCreateHasWork = (state) => (
    state.unresolved > 0
    || (state.snapshot?.layers.length ?? 0) > 0
    || (state.snapshot?.queuedOnly.length ?? 0) > 0
  );

  const syncOptimisticCreatePin = (store, state) => {
    const needsPin = optimisticCreateHasWork(state);
    if (needsPin && state.pinReleased) {
      state.pinReleased = false;
      store.pins += 1;
      store.idleEpoch += 1;
      if (!store.handle) startStore(store);
    } else if (!needsPin && !state.pinReleased) {
      releaseLayerPin(store, state);
    }
    if (!needsPin && state.consumers === 0) {
      const generation = state.generation;
      queueMicrotask(() => {
        if (
          store.optimisticCreate === state
          && state.generation === generation
          && state.consumers === 0
          && !optimisticCreateHasWork(state)
        ) closeOptimisticCreate(store, state);
      });
    }
  };

  const notifyOptimisticCreate = (store, state) => {
    if (store.optimisticCreate !== state || terminal) return;
    state.snapshot = state.view?.getSnapshot() ?? null;
    state.cache = null;
    syncOptimisticCreatePin(store, state);
    notifyStoreListeners(store);
    notifyConnection();
    if (state.snapshot?.layers.some((layer) => layer.layerStatus === 'bridging')) {
      void discoverOptimisticCreateSettlements(store, state);
    }
  };

  const settlementAuthoritativeIds = (settlement) => Object.freeze(
    (settlement?.receipt?.idMap ?? [])
      .filter((entry) => entry?.disposition === 'mapped' && typeof entry.authoritative === 'string')
      .map((entry) => entry.authoritative),
  );

  const reflectedOptimisticCreate = (store, confirmation) => (
    confirmation.authoritativeIds.some((id) => (
      store.authoritativeData.some((row) => row?._id === id)
    ))
    || store.authoritativeRevision > confirmation.revision
  );

  const applyOptimisticCreateAuthority = async (store, state, cause) => {
    const proofReleaseGeneration = state.proofReleaseGeneration;
    const releaseAfterProof = state.suspended
      && Number.isSafeInteger(proofReleaseGeneration);
    if (
      store.optimisticCreate !== state
      || state.view === null
      || state.unresolved > 0
      || (state.suspended && !releaseAfterProof)
      || runtimePaused()
    ) {
      if (state.unresolved > 0) state.deferred = true;
      return;
    }
    const retiredSettlementIdentities = [...state.confirmed]
      .filter(([, confirmation]) => reflectedOptimisticCreate(store, confirmation))
      .map(([identity]) => identity);
    state.deferred = false;
    await state.view.rebase({
      authoritativeRows: { [state.table]: store.authoritativeData },
      retiredSettlementIdentities,
      connected: connectedForOptimisticCreate(store),
      cause,
    });
    if (store.optimisticCreate !== state) return;
    if (
      releaseAfterProof
      && (
        state.proofReleaseGeneration !== proofReleaseGeneration
        || state.authorizationGeneration !== proofReleaseGeneration
        || store.authorizationProjectionSuspended
      )
    ) return;
    for (const identity of retiredSettlementIdentities) state.confirmed.delete(identity);
    if (releaseAfterProof) {
      state.proofReleaseGeneration = null;
      state.suspended = false;
      state.cache = null;
    }
    notifyOptimisticCreate(store, state);
  };

  const discoverOptimisticCreateSettlements = async (store, state) => {
    if (
      state.settlementDiscovery !== null
      || typeof client.settledMutations !== 'function'
      || store.optimisticCreate !== state
    ) return state.settlementDiscovery;
    state.settlementDiscovery = Promise.resolve(client.settledMutations()).then(async (entries) => {
      if (store.optimisticCreate !== state || !Array.isArray(entries)) return;
      const bridging = new Set(
        (state.snapshot?.layers ?? [])
          .filter((layer) => layer.layerStatus === 'bridging')
          .map((layer) => layer.clientMutationId),
      );
      for (const entry of entries) {
        if (!bridging.has(entry?.clientMutationId) || state.confirmed.has(entry.clientMutationId)) continue;
        state.confirmed.set(entry.clientMutationId, Object.freeze({
          revision: store.authoritativeRevision,
          authoritativeIds: settlementAuthoritativeIds(entry.settlement),
        }));
      }
      await applyOptimisticCreateAuthority(store, state, 'react-provider-settlement-recovered');
    }).catch(recordDiagnostic).finally(() => {
      if (store.optimisticCreate === state) state.settlementDiscovery = null;
    });
    return state.settlementDiscovery;
  };

  const ensureOptimisticCreateView = async (store, state) => {
    if (state.view !== null) return state.view;
    if (state.opening !== null) return state.opening;
    const stagedProofOpen = state.suspended
      && Number.isSafeInteger(state.proofReleaseGeneration);
    if (
      terminal
      || runtimePaused()
      || (state.suspended && !stagedProofOpen)
      || store.authoritativeRevision === 0
      || store.freshness !== 'current'
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING',
        'optimistic create requires a current authoritative query store',
        { queryId: store.reference.id },
      );
    }
    if (typeof client.createOptimisticMutationView !== 'function') {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_CREATE_UNSUPPORTED',
        'the prepared client does not provide generated-IR optimistic mutation views',
      );
    }
    const generation = ++state.generation;
    state.opening = client.createOptimisticMutationView({
      authoritativeRows: { [state.table]: store.authoritativeData },
      connected: connectedForOptimisticCreate(store),
    }).then(async (view) => {
      if (
        terminal
        || runtimePaused()
        || store.optimisticCreate !== state
        || state.generation !== generation
      ) {
        view.close();
        throw diagnosticError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'optimistic create view opened under stale provider authority',
        );
      }
      state.view = view;
      state.unsubscribe = view.subscribe(() => notifyOptimisticCreate(store, state));
      notifyOptimisticCreate(store, state);
      // A quarantine proof can arrive while the view promise is still open.
      // Re-run the proof release after installation so that opening latency
      // cannot strand suspended optimistic-create custody indefinitely.
      await applyOptimisticCreateAuthority(store, state, 'react-provider-view-opened');
      return view;
    }).catch((error) => {
      if (store.optimisticCreate === state && state.generation === generation) {
        state.opening = null;
      }
      throw error;
    });
    return state.opening;
  };

  const optimisticCreateState = (store, descriptor) => {
    const table = optimisticCreateTable(descriptor);
    if (store.optimisticCreate !== null) {
      if (store.optimisticCreate.table !== table) {
        throw diagnosticError(
          'SNAPBACK_REACT_OPTIMISTIC_CREATE_QUERY_CONFLICT',
          'one canonical query store cannot project optimistic creates for two tables',
          { queryId: descriptor.reference.id },
        );
      }
      return store.optimisticCreate;
    }
    const startsSuspended = store.authorizationProjectionSuspended === true;
    const state = {
      table,
      consumers: 0,
      generation: 0,
      view: null,
      opening: null,
      unsubscribe: null,
      snapshot: null,
      cache: null,
      unresolved: 0,
      confirmed: new Map(),
      deferred: startsSuspended,
      suspended: startsSuspended,
      authorizationGeneration: 0,
      proofReleaseGeneration: null,
      pinReleased: true,
      settlementDiscovery: null,
    };
    store.optimisticCreate = state;
    return state;
  };

  const observeOptimisticCreateAuthority = (store) => {
    const state = store.optimisticCreate;
    if (state === null) return;
    state.cache = null;
    if (state.view === null) {
      if (state.consumers > 0) void ensureOptimisticCreateView(store, state).catch(recordDiagnostic);
      return;
    }
    void applyOptimisticCreateAuthority(store, state, 'react-provider-authoritative-delivery')
      .catch(recordDiagnostic);
  };

  const publishMaterialized = (store) => {
    publish(store, freezeBootDelivery(store, {
      status: 'ready',
      data: materializeStore(store),
      error: null,
      connection: normalizeConnection(store.handle?.current?.connection ?? 'live'),
      freshness: store.freshness,
      retention: store.retention,
    }));
  };

  // @ref LLP 0107#replay-safety-affordances — dev-only advisory: an
  // optimistic update is a replayable projection, so a reducer that diverges
  // over its own output is action-shaped (toggle/increment) and would re-run
  // the user action during rebase. Observational only — warns once per
  // (mutation, query) pair and never changes admission or layer state.
  // @ref LLP 0219#consumers-and-compatibility — rerouting through the bound
  // client channel preserves LLP 0107's once-per-pair-per-provider pin.
  const replayAdvisoryKeys = new Set();
  const warnIfReplayDivergent = (
    mutationReference,
    queryReference,
    layer,
    store,
    initialProjection,
  ) => {
    void import('./react-runtime.mjs').then((module) => module.warnIfReplayDivergent({
        replayAdvisoryKeys,
        mutationReference,
        queryReference,
        layer,
        store,
        initialProjection,
        validateResultContract,
        diagnosticsChannel: clientDiagnosticsChannel,
        providerInstanceId,
      })).catch(recordDiagnostic);
  };

  // @ref LLP 0218#44-dev-diagnostic — the first queued dispatch in this
  // provider session is promoted in positive dev mode with the mutation,
  // relinquishment reason class, and provider-owned drain mode.
  const promoteQueuedMutationDiagnostic = (mutationReference, outcome) => {
    if (!positiveDevelopmentEnvironment()) return;
    // @ref LLP 0219#consumers-and-compatibility — this is a compatibility
    // projection of SNAPBACK_OFFLINE_MUTATION_QUEUED. The shared
    // clientMutationId is the reporter's queued-pair dedup key. React does not
    // schedule a wedge timer; the client channel owns that condition.
    const delivered = emitReactDiagnostic(clientDiagnosticsChannel, {
      code: 'SNAPBACK_REACT_MUTATION_QUEUED',
      severity: 'warning',
      message: `Offline queue compatibility rule: mutation "${mutationReference.name}" is durably queued, so settlement remains pending. Keep pending UI visible and replay via useSnapbackOutbox().drainNow(); roll back only for a declared server refusal. See guide/sync/offline-and-retention.md#replay-and-settle-without-guessing.`,
      details: {
        mutation: mutationReference.name,
        clientMutationId: outcome.clientMutationId,
        sequence: outcome.sequence,
        status: 'queued',
        presentation: outcome.presentation,
      },
      site: `${mutationReference.name}:${outcome.clientMutationId}`,
    });
    if (!delivered) {
      console.warn(
        `SNAPBACK_REACT_MUTATION_QUEUED: mutation "${mutationReference.name}" was durably queued as `
        + `${outcome.clientMutationId} (sequence ${outcome.sequence}); keep pending UI until `
        + 'the provider-owned drain settles it, and roll back only for a declared server refusal.',
      );
    }
  };

  const emitQueuedPresentationDiagnostic = (mutationReference, outcome, code, cause) => {
    const event = Object.freeze({
      code,
      mutation: mutationReference.name,
      clientMutationId: outcome.clientMutationId,
      sequence: outcome.sequence,
      presentation: 'unavailable',
      causeCode: cause?.diagnostic?.code ?? cause?.code ?? null,
    });
    try { client.__emitDevDiagnosticsEvent?.(event); } catch { /* diagnostics are observational */ }
    recordDiagnostic(diagnosticError(
      code,
      'accepted queued intent could not retain its local presentation bookkeeping',
      event,
    ));
  };

  const dispatchQueuedOutcome = (
    mutationReference,
    outcome,
    presentation,
    diagnosticCode = null,
  ) => {
    const queued = Object.freeze({
      ...outcome,
      status: 'queued',
      presentation,
      ...(diagnosticCode === null ? {} : { diagnosticCode }),
    });
    try { promoteQueuedMutationDiagnostic(mutationReference, queued); } catch {
      // A development diagnostic can never turn accepted durable intent into
      // a rejected dispatch.
    }
    return queued;
  };

  const retireOptimisticLayer = (store, layer, { failed = false } = {}) => {
    if (layer.retired) return;
    layer.retired = true;
    layer.failed = failed;
    store.pendingMutations.delete(layer.id);
    store.optimisticLayers = store.optimisticLayers.filter((entry) => entry !== layer);
    releaseLayerPin(store, layer);
    publishMaterialized(store);
  };

  // The foreground response and the durable status channel converge here, so
  // replay settlement (including another writer context) runs the exact same
  // LLP 0107 matcher/record-absence path as an immediate response.
  // @ref LLP 0218#42-the-optimistic-contract-exact — retained queued layers
  // are correlated by clientMutationId and retire only from authoritative
  // disposition evidence or authority loss.
  const confirmOptimisticLayer = (store, layer, result) => {
    if (layer.retired) return;
    layer.result = result;
    layer.confirmed = true;
    layer.orphaned = false;
    layer.confirmedRevision = store.authoritativeRevision;
    store.pendingMutations.delete(layer.id);
    try {
      const matched = layer.isAuthoritative?.(
        immutableClone(store.authoritativeData),
        immutableClone(result),
      ) === true;
      const recordAbsent = !matched
        && layer.recordProjection !== null
        && store.freshness === 'current'
        && !store.authoritativeData.some(
          (row) => row?.[layer.recordProjection.idField] === layer.recordProjection.recordId,
        );
      if (matched || recordAbsent) retireOptimisticLayer(store, layer);
    } catch (error) {
      recordDiagnostic(diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_REBASE_FAILED',
        'an optimistic authority matcher failed after dispatch',
        { attemptId: layer.id, cause: error?.code ?? error?.message ?? String(error) },
      ));
      retireOptimisticLayer(store, layer, { failed: true });
    }
  };

  const installQueuedLayerSubscription = (
    store,
    layer,
    mutationReference,
    mutationContract,
    outcome,
  ) => {
    if (typeof client.subscribeMutation !== 'function') {
      throw diagnosticError(
        'SNAPBACK_REACT_QUEUED_PRESENTATION_UNAVAILABLE',
        'queued optimistic presentation requires subscribeMutation',
      );
    }
    layer.clientMutationId = outcome.clientMutationId;
    layer.dispositionTask = Promise.resolve();
    let active = true;
    const off = client.subscribeMutation(outcome.clientMutationId, (disposition) => {
      layer.dispositionTask = layer.dispositionTask.then(async () => {
        if (!active || layer.retired || terminal) return;
        layer.disposition = disposition.status;
        if (disposition.status === 'pending') {
          layer.orphaned = false;
          return;
        }
        if (disposition.status === 'unknown') {
          // Absence of a durable record licenses no settlement inference. Keep
          // the visible layer and expose the orphaned fact for inspection.
          layer.orphaned = true;
          return;
        }
        if (disposition.status === 'settled') {
          const result = validateResultContract(
            mutationContract,
            disposition.settlement?.result,
            { violationCode: 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED' },
          );
          confirmOptimisticLayer(store, layer, result);
          return;
        }
        if (disposition.status === 'failed') {
          retireOptimisticLayer(store, layer, { failed: true });
          return;
        }
        if (['stranded', 'quarantined', 'resultGone'].includes(disposition.status)) {
          // Custody-terminal outcomes retire the local claim while their
          // durable facts and recovery affordances remain visible in outbox.
          retireOptimisticLayer(store, layer);
          return;
        }
        // A future/invalid status is not settlement evidence. Fail closed like
        // unknown: retain the layer and make the orphan visible for inspection.
        layer.orphaned = true;
      }).catch((error) => {
        if (!active || layer.retired) return;
        recordDiagnostic(error);
        retireOptimisticLayer(store, layer, { failed: true });
      });
    });
    layer.mutationSubscription = () => {
      if (!active) return;
      active = false;
      off();
    };
  };

  const runMutation = async (
    mutationReference,
    mutationArgs,
    optimistic = null,
    dispatchOptions = {},
  ) => {
    if (terminal) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed');
    if (deliveryCallbackDepth > 0) {
      const error = diagnosticError(
        'SNAPBACK_REACT_DELIVERY_REENTRANCY_UNSUPPORTED',
        'mutation dispatch is not supported synchronously from a live-delivery callback; defer it to a scheduler boundary',
        { owner: `provider:${providerInstanceId}`, operation: 'mutation' },
      );
      recordDiagnostic(error);
      throw error;
    }
    if (mutationReference?.[HANDOFF_DEFERRED_REFERENCE] === true) {
      mutationReference = mutationReference.reference;
    }
    // Admission stays synchronous on the settled path (the optimistic layer
    // must install in the same frame as the user action). Only a recoverable
    // development generation mismatch awaits the handoff; a reference that
    // still fails afterwards rejects this promise (a handled mutation
    // outcome), never an uncaught render error.
    let admittedMutation;
    try {
      admittedMutation = admittedReactReference(binding, mutationReference, 'Mutation');
    } catch (error) {
      const target = recoverableGeneration(error, mutationReference);
      if (target === null) throw error;
      await beginGenerationHandoff(target).promise;
      if (terminal) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed');
      admittedMutation = admittedReactReference(binding, mutationReference, 'Mutation');
    }
    mutationArgs = normalizeGeneratedArgumentsV1(admittedMutation, mutationArgs);
    canonicalizeClientValueV1(mutationArgs);
    if (
      dispatchOptions === null
      || typeof dispatchOptions !== 'object'
      || Array.isArray(dispatchOptions)
    ) throw new TypeError('mutation dispatch options must be an object');
    if (dispatchOptions.queue !== undefined && dispatchOptions.queue !== false) {
      throw new TypeError('React mutation queue option must be false when supplied');
    }
    const queue = dispatchOptions.queue === false ? false : 'auto';
    const includeAuthorityTransitions = dispatchOptions.authorityTransitions === true;
    const mutationContract = preparedReactResultContract(binding, admittedMutation);
    if (optimistic === null) {
      // @ref LLP 0100#product-receipt — the admitted local-dev
      // persona must bind writes at the same product boundary as live reads.
      const output = await client.mutate(admittedMutation, {
        args: mutationArgs,
        queue,
        ...(preparedDevUserId === null ? {} : { userId: preparedDevUserId }),
      });
      if (output?.status === 'queued') {
        if (queue === false) {
          throw diagnosticError(
            'SNAPBACK_REACT_QUEUE_FALSE_VIOLATED',
            'headless client returned queued after queue:false',
          );
        }
        return dispatchQueuedOutcome(
          admittedMutation,
          output,
          output.presentation ?? 'withheld',
        );
      }
      const result = validateResultContract(
        mutationContract,
        output.result,
        { violationCode: 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED' },
      );
      return queue === false
        ? result
        : Object.freeze({
            status: 'settled',
            result,
            ...(includeAuthorityTransitions
              ? {
                  authorityTransitions: Object.freeze([
                    ...(output.authorityTransitions ?? []),
                  ]),
                }
              : {}),
          });
    }

    if (
      typeof optimistic !== 'object'
      || typeof optimistic.update !== 'function'
    ) throw new TypeError('optimistic mutation options require query, args, and update');
    let queryReference;
    try {
      queryReference = admittedReactReference(binding, optimistic.query, 'LiveQuery');
    } catch (error) {
      const target = recoverableGeneration(error, optimistic.query);
      if (target === null) throw error;
      await beginGenerationHandoff(target).promise;
      if (terminal) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed');
      queryReference = admittedReactReference(binding, optimistic.query, 'LiveQuery');
    }
    const queryKey = canonicalReactStoreKeyV1(
      providerInstanceId,
      queryReference,
      optimistic.args,
    );
    const store = stores.get(queryKey);
    if (
      runtimePaused()
      || !store
      || store.authoritativeRevision === 0
      || !['ready', 'refreshing'].includes(store.snapshot.status)
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING',
        'optimistic projection requires a current authoritative query store',
        { queryId: queryReference.id },
      );
    }
    if (store.resultContract?.descriptor?.kind === 'unknown') {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_RESULT_CONTRACT_REQUIRED',
        'optimistic projection requires a generated query result contract',
        { queryId: queryReference.id },
      );
    }
    const activeLayerCount = [...stores.values()]
      .reduce((sum, value) => sum + value.optimisticLayers.length, 0);
    if (activeLayerCount >= OPTIMISTIC_LAYER_CAP) {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_LAYER_LIMIT',
        `React provider has reached its ${OPTIMISTIC_LAYER_CAP}-layer optimistic cap`,
        { cap: OPTIMISTIC_LAYER_CAP },
      );
    }
    const capture = client.authorityFence?.capture?.() ?? null;
    if (capture && !client.authorityFence?.isCurrent?.(capture)) {
      throw diagnosticError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'optimistic mutation authority is no longer current',
      );
    }
    const id = localUniqueLabel();
    const frozenArgs = immutableClone(mutationArgs);
    const layer = {
      id,
      mutationId: admittedMutation.id,
      queryId: queryReference.id,
      mutationArgs: frozenArgs,
      update: optimistic.update,
      isAuthoritative: typeof optimistic.isAuthoritative === 'function'
        ? optimistic.isAuthoritative
        : null,
      recordProjection: typeof optimistic.isAuthoritative === 'function'
        ? optimistic.isAuthoritative[RECORD_FIELD_PROJECTION] ?? null
        : null,
      result: undefined,
      confirmed: false,
      confirmedRevision: null,
      failed: false,
      retired: false,
      orphaned: false,
      disposition: null,
      dispositionTask: null,
      mutationSubscription: null,
      pinReleased: false,
    };

    // Admission is side-effect free through validation. The first reducer run
    // uses the exact displayed same-authority base; only a valid projection is
    // installed and dispatched.
    const initialProjection = validateResultContract(
      store.resultContract,
      layer.update(immutableClone(store.snapshot.data), frozenArgs),
      { requireKnown: true },
    );
    if (process.env.NODE_ENV !== 'production') {
      warnIfReplayDivergent(
        admittedMutation,
        queryReference,
        layer,
        store,
        initialProjection,
      );
    }
    store.optimisticLayers.push(layer);
    store.pendingMutations.set(id, layer);
    store.pins += 1;
    store.idleEpoch += 1;
    if (!store.handle) startStore(store);
    publish(store, Object.freeze({
      status: 'ready',
      data: initialProjection,
      error: null,
      connection: normalizeConnection(store.handle?.current?.connection ?? 'live'),
      freshness: store.freshness,
      retention: store.retention,
    }));

    let effectCommitted = false;
    let committedMutationId = id;
    try {
      if (capture && !client.authorityFence?.isCurrent?.(capture)) {
        throw diagnosticError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'optimistic mutation authority was replaced before dispatch',
        );
      }
      const output = await client.mutate(admittedMutation, {
        args: mutationArgs,
        clientMutationId: id,
        authorityCapture: capture,
        queue,
        // The app-authored reducer is the compatibility owner for this call;
        // do not also install generated projection beneath it.
        __generatedOptimistic: false,
        ...(preparedDevUserId === null ? {} : { userId: preparedDevUserId }),
      });
      effectCommitted = true;
      committedMutationId = output?.clientMutationId ?? id;
      layer.clientMutationId = committedMutationId;
      if (output?.status === 'queued') {
        let presentation = 'installed';
        let diagnosticCode = null;
        try {
          installQueuedLayerSubscription(
            store,
            layer,
            admittedMutation,
            mutationContract,
            output,
          );
        } catch (error) {
          presentation = 'unavailable';
          diagnosticCode = 'SNAPBACK_REACT_QUEUED_PRESENTATION_UNAVAILABLE';
          layer.orphaned = true;
          emitQueuedPresentationDiagnostic(admittedMutation, output, diagnosticCode, error);
        }
        if (queue === false) {
          throw diagnosticError(
            'SNAPBACK_REACT_QUEUE_FALSE_VIOLATED',
            'headless client returned queued after queue:false',
          );
        }
        return dispatchQueuedOutcome(admittedMutation, output, presentation, diagnosticCode);
      }
      const result = validateResultContract(
        mutationContract,
        output.result,
        { violationCode: 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED' },
      );
      if (capture && !client.authorityFence?.isCurrent?.(capture)) {
        throw diagnosticError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'optimistic mutation completed under stale authority',
        );
      }
      confirmOptimisticLayer(store, layer, result);
      return queue === false ? result : Object.freeze({ status: 'settled', result });
    } catch (error) {
      // @ref LLP 0180#mutation-ambiguity — once mutate returns accepted work,
      // a local presentation/authority failure cannot advertise non-commit or
      // invite a fresh mutation identity.
      if (effectCommitted) {
        store.pendingMutations.delete(id);
        if (!layer.retired && layer.mutationSubscription === null) layer.orphaned = true;
        publishMaterialized(store);
        throw committedEffectError(error, committedMutationId);
      }
      store.pendingMutations.delete(id);
      store.optimisticLayers = store.optimisticLayers.filter((entry) => entry !== layer);
      releaseLayerPin(store, layer);
      publishMaterialized(store);
      throw error;
    }
  };

  const runCommandMutation = async (mutationReference, mutationArgs, {
    clientMutationId,
    authorityCapture,
    mediaCommand,
  }) => {
    // @ref LLP 0180#mutation-ambiguity — these terminal checks refuse before
    // client.mutate, proving that no mutation effect left this provider.
    if (terminal) {
      throw diagnosticError(
        'SNAPBACK_REACT_PROVIDER_CLOSED',
        'React provider is closed',
        { effectCommitted: false },
      );
    }
    if (deliveryCallbackDepth > 0) {
      const error = diagnosticError(
        'SNAPBACK_REACT_DELIVERY_REENTRANCY_UNSUPPORTED',
        'command dispatch is not supported synchronously from a live-delivery callback; defer it to a scheduler boundary',
        { owner: `provider:${providerInstanceId}`, operation: 'command' },
      );
      recordDiagnostic(error);
      throw error;
    }
    let admittedMutation;
    try {
      admittedMutation = admittedReactReference(binding, mutationReference, 'Mutation');
    } catch (error) {
      const target = recoverableGeneration(error, mutationReference);
      if (target === null) throw error;
      await beginGenerationHandoff(target).promise;
      if (terminal) {
        throw diagnosticError(
          'SNAPBACK_REACT_PROVIDER_CLOSED',
          'React provider is closed',
          { effectCommitted: false },
        );
      }
      admittedMutation = admittedReactReference(binding, mutationReference, 'Mutation');
    }
    mutationArgs = normalizeGeneratedArgumentsV1(admittedMutation, mutationArgs);
    canonicalizeClientValueV1(mutationArgs);
    const output = await client.mutate(admittedMutation, {
      args: mutationArgs,
      clientMutationId,
      authorityCapture,
      ...(mediaCommand === undefined ? {} : { mediaCommand }),
      // @ref LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit —
      // carry the finalized item plan into the existing mutation/outbox owner;
      // legacy one-asset commands retain their online-only posture.
      queue: mediaCommand === undefined ? false : 'auto',
      ...(preparedDevUserId === null ? {} : { userId: preparedDevUserId }),
    });
    return validateResultContract(
      preparedReactResultContract(binding, admittedMutation),
      output.result,
      { violationCode: 'SNAPBACK_REACT_COMMAND_RESULT_INVALID' },
    );
  };

  const releaseLease = (lease) => {
    if (!lease || lease.released) return;
    lease.released = true;
    leases.delete(lease);
    for (const cleanup of lease.cleanups ?? []) {
      try { cleanup(); } catch { /* observational */ }
    }
    consumers -= lease.edges.length;
    for (const edge of lease.edges) {
      const store = stores.get(edge.key);
      if (!store) continue;
      store.listeners.delete(edge.edgeId);
      store.livePublishListeners.delete(edge.edgeId);
      store.consumers -= 1;
      if (store.consumers === 0 && store.pins === 0) {
        const idleEpoch = ++store.idleEpoch;
        queueMicrotask(() => {
          if (
            store.consumers !== 0
            || store.pins !== 0
            || store.idleEpoch !== idleEpoch
            || store.handoffPending !== 0
          ) return;
          stopStore(store);
          void Promise.allSettled([...allHandles].map((handle) => handle.settled()))
            .then(() => {
              if (
                store.consumers === 0
                && store.pins === 0
                && store.idleEpoch === idleEpoch
              ) stores.delete(store.key);
              notifyConnection();
            });
        });
      }
    }
    if (activeStores().length <= VIEW_SUBSCRIPTION_BUDGET) {
      viewBudgetWarningActive = false;
    }
    notifyConnection();
  };

  const subscribeMany = (
    descriptors,
    listener,
    previousLease = null,
    livePublishListener = null,
  ) => {
    if (terminal) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed');
    if (deliveryCallbackDepth > 0) {
      const error = diagnosticError(
        'SNAPBACK_REACT_DELIVERY_REENTRANCY_UNSUPPORTED',
        'subscription changes are not supported synchronously from a live-delivery callback; defer them to a scheduler boundary',
        { owner: `provider:${providerInstanceId}`, operation: 'subscription' },
      );
      recordDiagnostic(error);
      throw error;
    }
    const admitted = [];
    const pendingHandoffs = [];
    for (const entry of descriptors) {
      if (entry.skipped) continue;
      if (entry.handoff === undefined) {
        admitted.push(entry);
        continue;
      }
      // A handoff descriptor may already be resolvable (the atomic rebind
      // completed between render and subscribe): adopt the real admitted
      // descriptor now; otherwise park it on the handoff completion.
      const real = resolveHandoffDescriptor(entry);
      if (real !== null && !real.skipped) admitted.push(real);
      else if (real === null) pendingHandoffs.push(entry);
    }
    const previous = previousLease && !previousLease.released ? previousLease : null;
    const previousEdges = previous?.edges ?? [];
    const projectedConsumers = consumers - previousEdges.length + admitted.length;
    if (projectedConsumers > CONSUMER_CAP) {
      throw diagnosticError(
        'SNAPBACK_REACT_STORE_CAPACITY',
        `React provider has reached its ${CONSUMER_CAP}-consumer cap`,
        { cap: CONSUMER_CAP },
      );
    }
    const uniqueNew = new Map();
    for (const descriptor of admitted) uniqueNew.set(descriptor.key, descriptor);
    const active = activeStores();
    const netNew = [...uniqueNew.entries()]
      .filter(([, descriptor]) => descriptor.reference.kind === 'LiveQuery')
      .map(([key]) => key)
      .filter((key) => !stores.get(key)?.handle);
    const retiring = [...new Set(previousEdges.map((edge) => edge.key))]
      .filter((key) => !uniqueNew.has(key))
      .map((key) => stores.get(key))
      .filter(Boolean);
    const projectedSubscriptions = active.length + netNew.length;
    warnSubscriptionBudget(projectedSubscriptions);
    let supersession = null;
    if (projectedSubscriptions > SERVER_SUBSCRIPTION_CAP) {
      const predecessor = retiring.length === 1 ? retiring[0] : null;
      if (
        active.length === SERVER_SUBSCRIPTION_CAP
        && netNew.length === 1
        && predecessor?.handle
        && predecessor.consumers === previousEdges.filter((edge) => edge.key === predecessor.key).length
      ) {
        supersession = { successorKey: netNew[0], predecessor };
      } else {
        throw diagnosticError(
          'SNAPBACK_REACT_GROUP_CAPACITY',
          'query-group transition exceeds the 64-subscription cap',
          {
            cap: SERVER_SUBSCRIPTION_CAP,
            active: active.length,
            netNew: netNew.length,
            retiring: retiring.length,
          },
        );
      }
    }

    // Validation above is side-effect free. Store allocation and edge
    // installation happen only after the entire transaction is admitted.
    const edgeIdPrefix = `lease-${++leaseSequence}`;
    const next = {
      id: edgeIdPrefix,
      edges: [],
      cleanups: [],
      released: false,
      release() { releaseLease(next); },
    };
    try {
      for (let index = 0; index < admitted.length; index += 1) {
        const descriptor = admitted[index];
        const store = stores.get(descriptor.key) ?? createStore(descriptor);
        const edgeId = `${edgeIdPrefix}:${index}`;
        store.idleEpoch += 1;
        store.consumers += 1;
        store.listeners.set(edgeId, listener);
        if (livePublishListener !== null) {
          store.livePublishListeners.set(edgeId, livePublishListener);
        }
        next.edges.push({ key: store.key, edgeId });
      }
      leases.add(next);
      consumers += next.edges.length;
      for (const entry of pendingHandoffs) {
        attachHandoffWaiter(next, entry, listener, livePublishListener);
      }
      let successorHandle = null;
      if (supersession) supersession.predecessor.handoffPending += 1;
      for (const key of uniqueNew.keys()) {
        const store = stores.get(key);
        const handle = startStore(
          store,
          supersession?.successorKey === key ? supersession.predecessor.handle : null,
        );
        if (supersession?.successorKey === key) successorHandle = handle;
      }
      if (previous) releaseLease(previous);
      if (supersession) {
        // Releasing the predecessor's final consumer must not dispose its
        // handle before the successor subscribe has carried the exact
        // supersession witness to the server. Once admission settles, the
        // predecessor wrapper can retire locally whether admission succeeded
        // or failed; the successor store owns any surfaced failure.
        void successorHandle.started().catch(() => {}).finally(() => {
          const predecessor = supersession.predecessor;
          predecessor.handoffPending -= 1;
          if (predecessor.consumers !== 0 || predecessor.handoffPending !== 0) return;
          const idleEpoch = ++predecessor.idleEpoch;
          stopStore(predecessor);
          void Promise.allSettled([...allHandles].map((handle) => handle.settled()))
            .then(() => {
              if (
                predecessor.consumers === 0
                && predecessor.handoffPending === 0
                && predecessor.idleEpoch === idleEpoch
              ) stores.delete(predecessor.key);
              notifyConnection();
            });
        });
      }
      return next;
    } catch (error) {
      releaseLease(next);
      throw error;
    }
  };

  const snapshot = (descriptor) => {
    if (descriptor.skipped) return SKIPPED;
    if (descriptor.handoff !== undefined) {
      const real = resolveHandoffDescriptor(descriptor);
      if (real !== null) {
        return real.skipped ? SKIPPED : (stores.get(real.key)?.snapshot ?? SERVER_PENDING);
      }
      if (generationHandoff?.status === 'failed') return generationHandoff.failureSnapshot;
      return HANDOFF_PENDING;
    }
    return stores.get(descriptor.key)?.snapshot ?? SERVER_PENDING;
  };

  const presenceErrorSnapshot = (code, message, connection = 'idle') => Object.freeze({
    status: code === 'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED' ? 'unsupported' : 'error',
    entries: Object.freeze([]),
    selfKey: null,
    diagnostic: diagnostic(code, message),
    connection,
  });
  const roomPublisherState = (room, token) => {
    if (token?.publisherDiagnostic) {
      return Object.freeze({
        status: 'publish-error',
        diagnostic: token.publisherDiagnostic,
      });
    }
    if (!room?.desired || !token?.desired) {
      return Object.freeze({ status: 'observing', diagnostic: null });
    }
    return Object.freeze({
      status: room.publishing || room.acknowledgedPair === null ? 'publishing' : 'published',
      diagnostic: null,
    });
  };
  const presenceView = (room, token) => {
    if (!room) return PRESENCE_SERVER_PENDING;
    if (token.viewVersion === room.version && token.view) return token.view;
    const raw = room.raw;
    const base = raw.status === 'ready' || raw.status === 'stale'
      ? {
          status: raw.status,
          entries: raw.entries,
          selfKey: raw.selfKey,
          diagnostic: null,
          connection: raw.connection,
        }
      : raw.status === 'error' || raw.status === 'unsupported'
        ? {
            status: raw.status,
            entries: Object.freeze([]),
            selfKey: null,
            diagnostic: raw.diagnostic,
            connection: raw.connection,
          }
        : {
            status: raw.status === 'resyncing' ? 'resyncing' : 'pending',
            entries: Object.freeze([]),
            selfKey: null,
            diagnostic: null,
            connection: raw.connection,
          };
    token.view = Object.freeze({
      ...base,
      publisher: roomPublisherState(room, token),
      publish: token.actions.publish,
      delete: token.actions.delete,
    });
    token.viewVersion = room.version;
    return token.view;
  };
  const notifyRoom = (room) => {
    room.version += 1;
    for (const token of room.tokens.values()) {
      token.view = null;
      for (const listener of [...token.listeners]) {
        try { listener(); } catch { /* observational */ }
      }
    }
    notifyConnection();
  };
  const clearRoomHeartbeat = (room) => {
    if (room.heartbeatTimer !== null) clearTimeout(room.heartbeatTimer);
    room.heartbeatTimer = null;
  };
  const activePublisherRooms = (collectionId, excluding = null) => [...rooms.values()]
    .filter((room) => (
      room !== excluding
      && room.definition.reference.id === collectionId
      && room.desired !== null
    ));
  const admitRoomIntent = (room, token, value, ttlMs) => {
    const effectiveTtlMs = ttlMs ?? room.definition.reference.defaultTtlMs;
    if (
      !Number.isSafeInteger(effectiveTtlMs)
      || effectiveTtlMs < 500
      || effectiveTtlMs > room.definition.reference.maxTtlMs
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_PRESENCE_HEARTBEAT_UNSUPPORTED',
        'managed presence TTL must be an integer from 500ms through the generated maximum',
        { ttlMs: effectiveTtlMs, maxTtlMs: room.definition.reference.maxTtlMs },
      );
    }
    const normalizedValue = normalizeArgumentsAgainstContractV1(
      value,
      room.definition.reference.valueContract,
      { path: 'value' },
    );
    const validated = room.definition.valueValidator.validate(normalizedValue);
    if (!validated.ok) {
      throw diagnosticError(
        'SNAPBACK_REACT_PRESENCE_VALUE_INVALID',
        'managed presence value does not satisfy the generated value contract',
        { collection: room.definition.reference.name, path: validated.path },
      );
    }
    const encoded = canonicalizeClientValueV1(validated.value);
    if (new TextEncoder().encode(encoded).byteLength > room.definition.reference.maxValueBytes) {
      throw diagnosticError(
        'SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE',
        'managed presence value exceeds the generated byte budget',
        { maxValueBytes: room.definition.reference.maxValueBytes },
      );
    }
    for (const sibling of room.tokens.values()) {
      if (sibling === token || sibling.desired === null) continue;
      if (
        sibling.desired.encoded !== encoded
        || sibling.desired.ttlMs !== effectiveTtlMs
      ) {
        throw diagnosticError(
          'SNAPBACK_REACT_PRESENCE_VALUE_CONFLICT',
          'same-room managed presence consumers must publish the same value and TTL',
          { collection: room.definition.reference.name },
        );
      }
    }
    const interval = heartbeatInterval(effectiveTtlMs);
    const other = activePublisherRooms(room.definition.reference.id, room);
    const sustained = other.reduce(
      (sum, entry) => sum + Math.ceil(1_000 / entry.desired.intervalMs),
      Math.ceil(1_000 / interval),
    );
    const activeCount = other.length + 1;
    const rate = room.definition.reference.publishRate;
    if (sustained > rate.sustainedHz || 2 * activeCount > rate.burst) {
      throw diagnosticError(
        'SNAPBACK_REACT_PRESENCE_HEARTBEAT_UNSUPPORTED',
        'managed presence publishers exceed the generated sustained or burst budget',
        {
          sustainedRequiredHz: sustained,
          sustainedHz: rate.sustainedHz,
          burstRequired: 2 * activeCount,
          burst: rate.burst,
        },
      );
    }
    return Object.freeze({
      value: deepFreeze(validated.value),
      encoded,
      ttlMs: effectiveTtlMs,
      intervalMs: interval,
    });
  };
  const recomputeRoomDesired = (room) => {
    const previous = room.desired;
    room.desired = [...room.tokens.values()].find((token) => token.desired !== null)?.desired ?? null;
    if (previous === null && room.desired !== null) publishers += 1;
    if (previous !== null && room.desired === null) publishers = Math.max(0, publishers - 1);
  };
  const desiredTokenForRoom = (room) => [...room.tokens.values()].find(
    (token) => token.desired === room.desired,
  ) ?? null;
  const resetChangedValuePublishChurn = (room) => {
    const detector = room.changedValuePublishChurn;
    if (detector === null) return;
    detector.publishCount = 0;
    detector.publishCursor = 0;
  };
  const observePresencePublish = (room, encoded, cause) => {
    const detector = room.changedValuePublishChurn;
    if (detector === null) return;
    const previousEncoded = detector.lastPublishEncoded;
    detector.lastPublishEncoded = encoded;
    if (cause !== 'changed-value') {
      if (cause !== 'heartbeat') resetChangedValuePublishChurn(room);
      return;
    }
    if (previousEncoded === null || previousEncoded === encoded) {
      resetChangedValuePublishChurn(room);
      return;
    }
    // @ref LLP 0219#producers-pilot-scoped-detectors — the provider reports
    // actual changed-value publish attempts through the payload-safe client
    // diagnostics channel. Superseded intents and heartbeat replays do not
    // count, and the application value never enters the event.
    const atMs = Date.now();
    detector.publishTimes[detector.publishCursor] = atMs;
    detector.publishCursor = (
      detector.publishCursor + 1
    ) % detector.transitionThreshold;
    detector.publishCount = Math.min(
      detector.publishCount + 1,
      detector.transitionThreshold,
    );
    if (detector.publishCount < detector.transitionThreshold) return;
    const firstAtMs = detector.publishTimes[detector.publishCursor];
    const elapsedMs = Math.max(0, atMs - firstAtMs);
    if (elapsedMs > detector.windowMs) return;

    const key = room.definition.reference.name;
    emitReactDiagnostic(clientDiagnosticsChannel, {
      code: 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      severity: 'warning',
      message: `Presence publish stability rule: key ${JSON.stringify(key)} produced ${detector.transitionThreshold} consecutive changed-value publishes in ${elapsedMs}ms. The presence value thunk appears volatile; memoize a stable bound value and keep timestamps, counters, and draft text out of it. See guide/recipes/activity-presence.md#keep-presence-values-stable.`,
      details: {
        key,
        changedPublishCount: detector.transitionThreshold,
        windowElapsedMs: elapsedMs,
        windowMs: detector.windowMs,
        publishThreshold: detector.transitionThreshold,
      },
      site: detector.site,
    });
  };
  const scheduleRoomHeartbeat = (room, generation = room.intentGeneration) => {
    clearRoomHeartbeat(room);
    if (
      room.desired === null
      || room.suspended
      || room.raw.status !== 'ready'
      || room.intentGeneration !== generation
    ) return;
    room.heartbeatTimer = setTimeout(() => {
      room.heartbeatTimer = null;
      if (
        room.desired === null
        || room.suspended
        || room.raw.status !== 'ready'
        || room.intentGeneration !== generation
      ) return;
      void enqueueRoomPublish(room, generation, 'heartbeat');
    }, room.desired.intervalMs);
    room.heartbeatTimer.unref?.();
  };
  const acknowledgedPairFromOutcome = (outcome) => {
    const scopeEpoch = outcome?.scope_epoch;
    const entryVersion = outcome?.entry_version;
    if (
      !Number.isSafeInteger(scopeEpoch)
      || scopeEpoch < 1
      || !Number.isSafeInteger(entryVersion)
      || entryVersion < 1
    ) {
      throw diagnosticError(
        'SNAPBACK_EPHEMERAL_PUBLISH_OUTCOME_INVALID',
        'managed presence publish omitted its acknowledged epoch/version pair',
      );
    }
    return Object.freeze({
      scopeEpoch,
      entryVersion,
      authorityCapture: client.authorityCaptureFor?.(outcome) ?? client.captureAuthority?.() ?? null,
    });
  };
  const enqueuePairWithdrawal = (room, pair, handle = room.handle) => {
    if (pair === null || !handle) return Promise.resolve({ status: 'absent' });
    if (
      pair.authorityCapture !== null
      && client.isAuthorityCaptureCurrent?.(pair.authorityCapture) !== true
    ) {
      return Promise.resolve({ status: 'superseded', reason: 'authority-generation' });
    }
    const task = Promise.resolve(handle.delete({
      expectedScopeEpoch: pair.scopeEpoch,
      expectedEntryVersion: pair.entryVersion,
      authorityCapture: pair.authorityCapture,
    })).then((outcome) => {
      if (outcome?.status === 'dropped') {
        // @ref LLP 0257#result-and-error-surface — a best-effort transport
        // drop is still an observable withdrawal failure at the activity
        // boundary; resolving it as success would erase lastError.
        throw errorFromDiagnostic(
          outcome.diagnostic,
          'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED',
          'managed presence withdrawal was dropped because the transport is offline',
        );
      }
      return outcome;
    });
    room.withdrawalTasks.add(task);
    void task.finally(() => room.withdrawalTasks.delete(task)).catch(() => {});
    return task;
  };
  const withdrawAcknowledgedPair = (room, handle = room.handle) => {
    const pair = room.acknowledgedPair;
    room.acknowledgedPair = null;
    return enqueuePairWithdrawal(room, pair, handle);
  };
  const enqueueRoomPublish = (
    room,
    generation = room.intentGeneration,
    cause = 'lifecycle',
    originToken = desiredTokenForRoom(room),
  ) => {
    if (originToken) originToken.publisherDiagnostic = null;
    room.publishing = true;
    notifyRoom(room);
    const desired = room.desired;
    const task = room.workTail.then(async () => {
      if (
        room.closed
        || room.intentGeneration !== generation
        || room.desired !== desired
        || room.raw.status !== 'ready'
      ) return;
      try {
        const handle = room.handle;
        observePresencePublish(room, desired.encoded, cause);
        const outcome = await handle.publish(desired.value, { ttlMs: desired.ttlMs });
        if (outcome?.status === 'dropped' && outcome?.reason === 'offline') {
          // @ref LLP 0257#offline — preserve provider-memory desired intent.
          // The dropped attempt is never queued; reconnect-before-idle retries.
          room.acknowledgedPair = null;
          room.publishing = false;
          room.suspended = true;
          if (originToken) originToken.publisherDiagnostic = outcome.diagnostic;
          clearRoomHeartbeat(room);
          notifyRoom(room);
          return;
        }
        const pair = acknowledgedPairFromOutcome(outcome);
        if (
          room.closed
          || room.intentGeneration !== generation
          || room.desired !== desired
        ) {
          void enqueuePairWithdrawal(room, pair, handle).catch(recordDiagnostic);
          return;
        }
        room.acknowledgedPair = pair;
        room.publishing = false;
        room.suspended = false;
        if (originToken) originToken.publisherDiagnostic = null;
        notifyRoom(room);
        scheduleRoomHeartbeat(room, generation);
      } catch (error) {
        if (
          room.closed
          || room.intentGeneration !== generation
          || room.desired !== desired
        ) return;
        room.suspended = true;
        room.publishing = false;
        if (originToken) originToken.publisherDiagnostic = serializeError(error);
        clearRoomHeartbeat(room);
        notifyRoom(room);
      }
    });
    room.workTail = task.catch(() => {});
    return task;
  };
  const setTokenIntent = (room, token, value, ttlMs, source) => {
    const next = admitRoomIntent(room, token, value, ttlMs);
    const unchanged = token.desired?.encoded === next.encoded
      && token.desired?.ttlMs === next.ttlMs;
    token.source = source;
    if (unchanged && !room.suspended) return Promise.resolve();
    const previousRoomDesired = room.desired;
    token.desired = next;
    recomputeRoomDesired(room);
    const changedValue = previousRoomDesired !== null
      && room.desired !== null
      && previousRoomDesired.encoded !== room.desired.encoded;
    room.intentGeneration += 1;
    room.suspended = false;
    room.publishing = false;
    clearRoomHeartbeat(room);
    notifyRoom(room);
    return room.raw.status === 'ready'
      ? enqueueRoomPublish(
          room,
          room.intentGeneration,
          changedValue ? 'changed-value' : 'intent',
          token,
        )
      : Promise.resolve();
  };
  const deleteTokenIntent = async (room, token) => {
    if (token.source === 'declarative') {
      throw diagnosticError(
        'SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT',
        'imperative actions cannot replace a non-skip declarative presence value',
      );
    }
    // One provider owns one connection-scoped backend entry for the room.
    // An observing token that never published has no entry of its own to
    // delete, and a publisher that shares the same admitted intent with
    // another token may relinquish only its lease. Deleting the shared backend
    // entry here would erase the sibling's presence and strand its heartbeat.
    if (token.desired === null) return;
    resetChangedValuePublishChurn(room);
    if (room.changedValuePublishChurn !== null) {
      room.changedValuePublishChurn.lastPublishEncoded = null;
    }
    const siblingDesired = [...room.tokens.values()].some(
      (sibling) => sibling !== token && sibling.desired !== null,
    );
    if (siblingDesired) {
      token.desired = null;
      token.source = 'observer';
      recomputeRoomDesired(room);
      notifyRoom(room);
      scheduleRoomHeartbeat(room);
      return;
    }
    const generation = ++room.intentGeneration;
    clearRoomHeartbeat(room);
    token.desired = null;
    recomputeRoomDesired(room);
    room.publishing = false;
    notifyRoom(room);
    try {
      await withdrawAcknowledgedPair(room);
      if (room.closed || room.intentGeneration !== generation) return;
      room.suspended = false;
      token.publisherDiagnostic = null;
      notifyRoom(room);
    } catch (error) {
      if (room.closed || room.intentGeneration !== generation) return;
      room.suspended = true;
      token.publisherDiagnostic = serializeError(error);
      notifyRoom(room);
      throw error;
    }
  };
  const pauseRoom = (room) => {
    room.generation += 1;
    clearRoomHeartbeat(room);
    resetChangedValuePublishChurn(room);
    if (room.changedValuePublishChurn !== null) {
      room.changedValuePublishChurn.lastPublishEncoded = null;
    }
    room.handleOff?.();
    room.handleOff = null;
    room.republisher?.dispose?.();
    room.republisher = null;
    const handle = room.handle;
    room.handle = null;
    room.acknowledgedPair = null;
    room.publishing = false;
    handle?.dispose?.();
    room.cleanup = Promise.allSettled([
      room.workTail,
      ...room.withdrawalTasks,
      handle?.settled?.() ?? Promise.resolve(),
    ]).then(async (results) => {
      for (const result of results) {
        if (result.status === 'rejected') recordDiagnostic(result.reason);
      }
      const lateWithdrawals = await Promise.allSettled([...room.withdrawalTasks]);
      for (const result of lateWithdrawals) {
        if (result.status === 'rejected') recordDiagnostic(result.reason);
      }
    });
  };
  const stopRoom = (room) => {
    if (room.closed) return;
    room.closed = true;
    pauseRoom(room);
  };
  const startRoom = (room) => {
    if (room.closed || room.handle || terminal || runtimePaused()) return;
    const generation = ++room.generation;
    room.raw = PRESENCE_SERVER_PENDING;
    const handle = client.startEphemeralRoom(
      { ...room.definition, connectionId },
      room.scope,
    );
    room.handle = handle;
    room.handleOff = handle.subscribe(() => {
      if (room.closed || room.generation !== generation || room.handle !== handle) return;
      const previous = room.raw;
      room.raw = handle.getSnapshot();
      if (room.raw.reason) room.resyncReasons.push(room.raw.reason);
      if (room.resyncReasons.length > 32) room.resyncReasons.shift();
      if (room.raw.status !== 'ready') clearRoomHeartbeat(room);
      if (room.raw.status === 'ready' && previous.status !== 'ready') {
        resetChangedValuePublishChurn(room);
        if (room.changedValuePublishChurn !== null) {
          room.changedValuePublishChurn.lastPublishEncoded = null;
        }
        room.suspended = false;
      }
      notifyRoom(room);
      if (
        room.raw.status === 'ready'
        && room.desired !== null
        && !room.suspended
        && (
          previous.status !== 'ready'
          || previous.selfKey !== room.raw.selfKey
          || previous.status === 'resyncing'
        )
      ) void enqueueRoomPublish(room);
    });
    const scopeKey = canonicalizeClientValueV1(room.scope);
    room.republisher = client.registerEphemeralRepublisher(
      room.definition.reference,
      async (context) => {
        if (
          room.closed
          || room.desired === null
          || canonicalizeClientValueV1(context.scope ?? {}) !== scopeKey
        ) return;
        const originToken = desiredTokenForRoom(room);
        if (originToken) originToken.publisherDiagnostic = null;
        const outcome = await context.publish(room.desired.value, { ttlMs: room.desired.ttlMs });
        if (outcome?.status === 'dropped' && outcome?.reason === 'offline') {
          // @ref LLP 0257#offline — keep provider-memory intent for the
          // next ready transition; an ephemeral refusal never becomes an outbox.
          room.acknowledgedPair = null;
          room.publishing = false;
          room.suspended = true;
          if (originToken) originToken.publisherDiagnostic = outcome.diagnostic;
          clearRoomHeartbeat(room);
          notifyRoom(room);
          return;
        }
        room.acknowledgedPair = acknowledgedPairFromOutcome(outcome);
        room.publishing = false;
        if (originToken) originToken.publisherDiagnostic = null;
        notifyRoom(room);
      },
    );
    void handle.started().catch((error) => {
      if (room.closed || room.generation !== generation) return;
      recordDiagnostic(error);
    });
  };
  const createRoom = (descriptor) => {
    if (
      rooms.size >= PRESENCE_ROOM_CACHE_CAP
      || [...rooms.values()].filter((room) => room.handle !== null).length
        >= PRESENCE_SUBSCRIPTION_CAP
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_PRESENCE_ROOM_LIMIT',
        'React provider has reached its room-store or subscription cap',
        {
          roomCap: PRESENCE_ROOM_CACHE_CAP,
          subscriptionCap: PRESENCE_SUBSCRIPTION_CAP,
        },
      );
    }
    const room = {
      key: descriptor.key,
      definition: descriptor.definition,
      scope: descriptor.scope,
      raw: PRESENCE_SERVER_PENDING,
      tokens: new Map(),
      handle: null,
      handleOff: null,
      republisher: null,
      heartbeatTimer: null,
      desired: null,
      acknowledgedPair: null,
      publishing: false,
      suspended: false,
      intentGeneration: 0,
      generation: 0,
      version: 0,
      idleEpoch: 0,
      workTail: Promise.resolve(),
      withdrawalTasks: new Set(),
      cleanup: Promise.resolve(),
      resyncReasons: [],
      changedValuePublishChurn: presenceValueChurnConfig === null
        ? null
        : {
            transitionThreshold: presenceValueChurnConfig.transitionThreshold,
            windowMs: presenceValueChurnConfig.windowMs,
            publishTimes: new Array(presenceValueChurnConfig.transitionThreshold),
            publishCount: 0,
            publishCursor: 0,
            lastPublishEncoded: null,
            site: `provider:${providerInstanceId}:presence-value:${++presenceDiagnosticSequence}`,
          },
      closed: false,
    };
    rooms.set(room.key, room);
    return room;
  };
  const releasePresenceToken = (token) => {
    const room = token.room;
    if (!room || token.released) return;
    token.released = true;
    room.tokens.delete(token.id);
    roomLeases.delete(token);
    presenceConsumers = Math.max(0, presenceConsumers - 1);
    const wasDesired = token.desired !== null;
    token.listeners.clear();
    token.room = null;
    token.desired = null;
    token.publisherDiagnostic = null;
    recomputeRoomDesired(room);
    if (wasDesired && room.desired === null) {
      room.intentGeneration += 1;
      clearRoomHeartbeat(room);
      room.publishing = false;
      void withdrawAcknowledgedPair(room).catch((error) => recordDiagnostic(error));
    }
    notifyRoom(room);
    if (room.tokens.size !== 0) return;
    const idleEpoch = ++room.idleEpoch;
    queueMicrotask(() => {
      if (room.tokens.size !== 0 || room.idleEpoch !== idleEpoch) return;
      stopRoom(room);
      void room.cleanup.finally(() => {
        if (room.tokens.size === 0 && room.idleEpoch === idleEpoch) rooms.delete(room.key);
        notifyConnection();
      });
    });
  };
  const subscribePresence = (descriptor, token, listener) => {
    if (terminal) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed');
    if (descriptor.unsupported) {
      token.unsupported = descriptor.unsupported;
      token.listeners.add(listener);
      return Object.freeze({
        release() { token.listeners.delete(listener); },
      });
    }
    if (token.room && token.room.key !== descriptor.key) releasePresenceToken(token);
    let room = rooms.get(descriptor.key);
    const created = !room;
    if (!room) {
      if (presenceConsumers >= PRESENCE_CONSUMER_CAP) {
        throw diagnosticError(
          'SNAPBACK_REACT_PRESENCE_CONSUMER_LIMIT',
          `React provider has reached its ${PRESENCE_CONSUMER_CAP}-consumer cap`,
          { cap: PRESENCE_CONSUMER_CAP },
        );
      }
      room = createRoom(descriptor);
    }
    const attaching = !token.room;
    if (attaching) {
      if (presenceConsumers >= PRESENCE_CONSUMER_CAP) {
        if (created) rooms.delete(room.key);
        throw diagnosticError(
          'SNAPBACK_REACT_PRESENCE_CONSUMER_LIMIT',
          `React provider has reached its ${PRESENCE_CONSUMER_CAP}-consumer cap`,
          { cap: PRESENCE_CONSUMER_CAP },
        );
      }
      room.tokens.set(token.id, token);
      roomLeases.add(token);
      token.room = room;
      token.released = false;
      presenceConsumers += 1;
    }
    token.listeners.add(listener);
    room.idleEpoch += 1;
    try {
      if (descriptor.intent !== null) {
        if (!token.desired && room.desired === null && publishers >= PRESENCE_PUBLISHER_CAP) {
          throw diagnosticError(
            'SNAPBACK_REACT_PRESENCE_PUBLISHER_LIMIT',
            `React provider has reached its ${PRESENCE_PUBLISHER_CAP}-publisher cap`,
            { cap: PRESENCE_PUBLISHER_CAP },
          );
        }
        const publishTask = setTokenIntent(
          room,
          token,
          descriptor.intent.value,
          descriptor.intent.ttlMs,
          'declarative',
        );
        void publishTask.catch(recordDiagnostic);
      } else if (token.source === 'declarative') {
        const wasDesired = token.desired !== null;
        token.source = 'observer';
        token.desired = null;
        recomputeRoomDesired(room);
        if (wasDesired && room.desired === null) {
          room.intentGeneration += 1;
          clearRoomHeartbeat(room);
          room.publishing = false;
          void withdrawAcknowledgedPair(room).catch(recordDiagnostic);
        }
      }
      startRoom(room);
    } catch (error) {
      token.listeners.delete(listener);
      if (attaching) {
        room.tokens.delete(token.id);
        roomLeases.delete(token);
        token.room = null;
        token.desired = null;
        token.released = true;
        presenceConsumers = Math.max(0, presenceConsumers - 1);
        recomputeRoomDesired(room);
      }
      if (created) {
        rooms.delete(room.key);
      }
      throw error;
    }
    notifyRoom(room);
    let released = false;
    return Object.freeze({
      release() {
        if (released) return;
        released = true;
        token.listeners.delete(listener);
        queueMicrotask(() => {
          if (token.listeners.size === 0) releasePresenceToken(token);
        });
      },
    });
  };
  const createPresenceToken = () => {
    const token = {
      id: `presence-${++leaseSequence}`,
      room: null,
      listeners: new Set(),
      desired: null,
      source: 'observer',
      publisherDiagnostic: null,
      released: false,
      unsupported: null,
      view: null,
      viewVersion: -1,
      actions: null,
      detachedView: null,
      unsupportedView: null,
    };
    token.actions = Object.freeze({
      async publish(value, publishOptions = {}) {
        if (token.source === 'declarative') {
          throw diagnosticError(
            'SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT',
            'imperative actions cannot replace a non-skip declarative presence value',
          );
        }
        if (!token.room) {
          throw diagnosticError(
            'SNAPBACK_REACT_PRESENCE_NOT_AUTHORITATIVE',
            'presence observer is not attached to a room',
          );
        }
        if (token.desired === null && publishers >= PRESENCE_PUBLISHER_CAP) {
          throw diagnosticError(
            'SNAPBACK_REACT_PRESENCE_PUBLISHER_LIMIT',
            `React provider has reached its ${PRESENCE_PUBLISHER_CAP}-publisher cap`,
            { cap: PRESENCE_PUBLISHER_CAP },
          );
        }
        return setTokenIntent(token.room, token, value, publishOptions.ttlMs, 'observer');
      },
      async delete() {
        if (!token.room) return;
        return deleteTokenIntent(token.room, token);
      },
    });
    // useSyncExternalStore reads before subscribing. Keep that detached read
    // referentially stable so React does not treat it as a changing store.
    token.detachedView = Object.freeze({
      ...PRESENCE_SERVER_PENDING,
      publisher: Object.freeze({ status: 'observing', diagnostic: null }),
      publish: token.actions.publish,
      delete: token.actions.delete,
    });
    return token;
  };
  const presenceDescriptor = (reference, scope, value, ttlMs) => {
    const definition = admittedReactEphemeralDefinition(binding, reference);
    const admittedScope = normalizeArgumentsAgainstContractV1(
      scope,
      definition.reference.scopeContract,
      { path: 'scope' },
    );
    const scopeResult = definition.scopeValidator.validate(admittedScope);
    if (!scopeResult.ok) {
      throw diagnosticError(
        'SNAPBACK_REACT_ARGS_INVALID',
        'presence scope does not satisfy the generated scope contract',
        { collection: reference.name, path: scopeResult.path },
      );
    }
    const normalizedScope = deepFreeze(scopeResult.value);
    const key = [
      providerInstanceId,
      reference.id,
      canonicalizeClientValueV1(normalizedScope),
    ].join('\u0000');
    const unsupported = binding.profile === 'local-dev-sqlite-ibex'
      ? null
      : diagnostic(
        'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED',
        'React presence v1 is currently proven only on the local target',
        { targetProfileId: binding.profile },
      );
    return Object.freeze({
      key,
      definition,
      scope: normalizedScope,
      unsupported,
      intent: value === skip ? null : Object.freeze({ value, ttlMs }),
    });
  };
  const presenceSnapshot = (descriptor, token) => {
    if (descriptor.unsupported || token.unsupported) {
      const unsupported = descriptor.unsupported ?? token.unsupported;
      if (token.unsupportedView?.diagnostic !== unsupported) {
        token.unsupportedView = Object.freeze({
          status: 'unsupported',
          entries: Object.freeze([]),
          selfKey: null,
          diagnostic: unsupported,
          connection: 'idle',
          publisher: Object.freeze({ status: 'observing', diagnostic: null }),
          publish: token.actions.publish,
          delete: token.actions.delete,
        });
      }
      return token.unsupportedView;
    }
    const room = token.room ?? rooms.get(descriptor.key);
    if (!room) return token.detachedView;
    return presenceView(room, token);
  };

  const aggregateConnection = () => {
    const active = activeStores();
    const status = weakConnection(active.map((store) => store.snapshot.connection));
    const currentDiagnostic = status === 'error' ? diagnostics.at(-1) ?? null : null;
    const key = `${status}\u0000${active.length}\u0000${currentDiagnostic?.code ?? ''}`;
    if (key === connectionSnapshotKey) return connectionSnapshot;
    connectionSnapshotKey = key;
    connectionSnapshot = Object.freeze({
      status,
      diagnostic: currentDiagnostic,
      activeSubscriptions: active.length,
    });
    return connectionSnapshot;
  };

  const quiesceRegistry = async () => {
    for (const store of stores.values()) stopStore(store);
    for (const room of rooms.values()) pauseRoom(room);
    await Promise.allSettled([
      ...[...allHandles].map((handle) => handle.settled()),
      ...[...rooms.values()].map((room) => room.cleanup),
      ...(registeredRecovery === null ? [] : [registeredRecovery]),
    ]);
  };
  const resumeRegistry = (authorityContext = null) => {
    if (terminal || runtimePaused()) return;
    manager = typeof client.liveStreamManager === 'function'
      ? client.liveStreamManager(connectionId)
      : null;
    for (const store of stores.values()) startStore(store, null, authorityContext);
    for (const room of rooms.values()) startRoom(room);
  };

  const barrierParticipant = {
    name: `snapback-react:${providerInstanceId}`,
    async quiesce() {
      custodyPaused = true;
      confirmedAuthorityContext = null;
      // @ref LLP 0310.000#ruling-3--one-typing-episode-is-one-presence-generation
      // — session replacement is an activity-episode boundary. Advance before
      // awaiting predecessor work so its settlement cannot flush a queued value.
      activityPresenceSessionEpoch += 1;
      for (const room of rooms.values()) notifyRoom(room);
      await quiesceRegistry();
    },
    blank(context = {}) {
      custodyPaused = true;
      confirmedAuthorityContext = null;
      for (const store of stores.values()) {
        if (store.optimisticCreate !== null) {
          closeOptimisticCreate(store, store.optimisticCreate, { force: true });
        }
        store.generation += 1;
        store.authorizationProjectionSuspended = false;
        if (context.terminal === true) {
          store.snapshot = Object.freeze({
            status: 'error',
            data: undefined,
            error: authOwnedDiagnostic(
              context.terminalError
                ?? diagnosticError(
                  'SNAPBACK_AUTH_TRANSITION_FAILED',
                  'the live query authority terminated',
                ),
            ),
            transitionOwner: AUTH_TRANSITION_OWNER,
            connection: 'error',
            freshness: 'unknown',
            answerClass: 'unknown',
            retention: null,
            optimisticPresentation: null,
          });
        } else {
          store.snapshot = generatedAuthScopedLiveReference(store.reference)
            ? AUTHENTICATION_NOT_SETTLED_BLOCKED
            : pending('idle');
        }
        store.consumerVisibleSnapshotKey = consumerVisibleSnapshotKey(store.snapshot);
        store.generatedData = Object.freeze([]);
        store.generatedPresentation = null;
        store.freshness = 'unknown';
        store.retention = null;
        // @ref LLP 0107#resync-authority-and-lifecycle — authority
        // replacement blanks every predecessor projection; queued layers may
        // survive enqueue, but never cross into a successor authority.
        for (const layer of store.optimisticLayers) {
          layer.retired = true;
          releaseLayerPin(store, layer);
        }
        store.optimisticLayers = [];
        store.pendingMutations.clear();
        notifyStoreListeners(store);
      }
      for (const room of rooms.values()) {
        room.raw = PRESENCE_SERVER_PENDING;
        room.acknowledgedPair = null;
        room.publishing = false;
        for (const token of room.tokens.values()) token.publisherDiagnostic = null;
        notifyRoom(room);
      }
      notifyConnection();
    },
    clearMemory() {
      // @ref LLP 0112#authority-races-and-cleanup — a successor authority
      // may never lazily adopt predecessor bundle registrations or boot rows.
      invalidatePreparedRegistrations('authority-replaced');
    },
    async commitDurable() {},
    async resume(context = {}) {
      if (terminal) return;
      const resumeConfirmedAuthority = (authorityContext = null) => {
        custodyPaused = false;
        resumeRegistry(authorityContext);
      };
      if (
        typeof context.stagePublication === 'function'
        && context.capture !== undefined
      ) {
        // @ref LLP 0059#exposure-invariant — coordinator capture() remains
        // deliberately closed during participant resume. Stage query re-entry
        // at the final exact confirmation and carry that successor capture into
        // live admission; otherwise an authenticated store observes
        // AUTHORITY_CLEARING once and never receives another start edge.
        const stagedCapture = context.capture;
        context.stagePublication(stagedCapture, (view = null) => {
          const publishedAuthorityContext = projectedAuthorityContext(
            view ?? stagedCapture,
            view?.authority ?? context.authority,
          );
          confirmedAuthorityContext = publishedAuthorityContext;
          // The real coordinator exposes publication immediately after all
          // synchronous staged callbacks return. A later hook registration
          // must prove the then-current level through capture(), rather than
          // retaining this callback's once-only witness indefinitely.
          queueMicrotask(() => {
            if (confirmedAuthorityContext === publishedAuthorityContext) {
              confirmedAuthorityContext = null;
            }
          });
          resumeConfirmedAuthority(publishedAuthorityContext);
        });
        return;
      }
      resumeConfirmedAuthority();
    },
  };
  const unregisterBarrier = client.registerAuthBarrierParticipant(barrierParticipant);

  const admittedDescriptor = (reference, args, groupBoot = null, preparedEntryName = null) => {
    const preparedEntry = preparedEntryName === null
      ? null
      : preparedGroup?.entries.find((entry) => entry.name === preparedEntryName) ?? null;
    const admitted = admittedReactReference(
      binding,
      reference,
      preparedEntry?.readOnlySnapshot == null ? 'LiveQuery' : ['Query', 'LiveQuery'],
    );
    const resultContract = preparedReactResultContract(binding, admitted);
    if (args === skip) return Object.freeze({
      skipped: true,
      reference: admitted,
      args,
      key: null,
      resultContract,
      groupBoot,
      preparedEntryName,
      readOnlySnapshot: preparedEntry?.readOnlySnapshot ?? null,
      bootDelivery: preparedEntry?.bootDelivery ?? null,
    });
    const key = canonicalReactStoreKeyV1(providerInstanceId, admitted, args);
    return Object.freeze({
      skipped: false,
      reference: admitted,
      args,
      key,
      resultContract,
      groupBoot,
      preparedEntryName,
      readOnlySnapshot: preparedEntry?.readOnlySnapshot ?? null,
      bootDelivery: preparedEntry?.bootDelivery ?? null,
    });
  };

  // --- Mounted-provider HMR generation handoff (development only) -----------
  // @ref LLP 0114#mounted-provider-hmr-generation-handoff-dated-amendment-2026-08-05
  // — a regenerated same-app reference in a positively identified development
  // environment becomes a provider-boundary invalidation with an atomic
  // rebind, never an uncaught render error; every other refusal (foreign
  // reference, production build) stays strict and loud.
  const recoverableGeneration = (error, reference) => {
    if (terminal || error?.code !== 'SNAPBACK_REACT_REFERENCE_INVALID') return null;
    if (!positiveDevelopmentEnvironment()) return null;
    return classifyRegeneratedReactReference(binding, reference);
  };

  const triggerControlledDevelopmentReload = (failure) => {
    const reloadMessage = `${failure.message} (reason: ${failure.details?.reason ?? 'unknown'}). `
      + 'Snapback is triggering a full dev reload so the mounted provider realigns with the '
      + 'regenerated api module. If no reload mechanism is available on this host, reload '
      + 'manually (press "r" in the Metro terminal or refresh the page).';
    const delivered = emitReactDiagnostic(clientDiagnosticsChannel, {
      code: failure.code,
      severity: 'error',
      message: reloadMessage,
      details: failure.details,
      site: `provider:${providerInstanceId}:hmr-reload`,
    });
    // A reload notice is failure-recovery infrastructure: if the bound client
    // has no reachable diagnostics channel, preserve one direct fallback.
    if (!delivered) console.error(`${failure.code}: ${reloadMessage}`);
    try {
      if (typeof developmentHmr?.onReloadRequired === 'function') {
        developmentHmr.onReloadRequired(failure);
        return;
      }
    } catch { /* observational */ }
    try { globalThis.DevSettings?.reload?.('SNAPBACK_REACT_HMR_REBIND_FAILED'); } catch { /* best effort */ }
    try { globalThis.location?.reload?.(); } catch { /* best effort */ }
  };

  const beginGenerationHandoff = (target) => {
    const key = canonicalizeClientValueV1(target);
    if (generationHandoff !== null && generationHandoff.key === key) return generationHandoff;
    const state = {
      key,
      status: 'active',
      failure: null,
      failureSnapshot: null,
      waiters: new Set(),
      promise: null,
    };
    // A newer generation supersedes an in-flight handoff (rapid successive
    // HMR edits): its parked waiters move to the successor so their hooks
    // still resolve or fail when the newest handoff settles.
    if (generationHandoff !== null && generationHandoff.status === 'active') {
      for (const waiter of generationHandoff.waiters) state.waiters.add(waiter);
      generationHandoff.waiters.clear();
    }
    const settle = (outcome) => {
      if (terminal || generationHandoff !== state) return outcome;
      if (outcome?.ok === true) {
        state.status = 'ok';
      } else {
        state.status = 'failed';
        state.failure = diagnostic(
          'SNAPBACK_REACT_HMR_REBIND_FAILED',
          'HMR delivered regenerated Snapback references, but the mounted provider could not atomically rebind to the new generation',
          {
            reason: outcome?.reason ?? 'handoff-error',
            ...(outcome?.cause === undefined ? {} : { cause: outcome.cause }),
          },
        );
        state.failureSnapshot = Object.freeze({
          status: 'error',
          data: undefined,
          error: state.failure,
          connection: 'error',
          freshness: 'unknown',
          answerClass: 'unknown',
          retention: null,
        });
        triggerControlledDevelopmentReload(state.failure);
      }
      const waiters = [...state.waiters];
      state.waiters.clear();
      for (const waiter of waiters) {
        try { waiter(); } catch { /* observational */ }
      }
      notifyConnection();
      return outcome;
    };
    state.promise = handoffPreparedReactBindingGeneration(binding, target, {
      ...(Number.isSafeInteger(developmentHmr?.timeoutMs)
        ? { timeoutMs: developmentHmr.timeoutMs }
        : {}),
      ...(Number.isSafeInteger(developmentHmr?.pollIntervalMs)
        ? { pollIntervalMs: developmentHmr.pollIntervalMs }
        : {}),
    }).then(settle, (error) => settle({
      ok: false,
      reason: 'handoff-error',
      cause: error?.code ?? String(error),
    }));
    generationHandoff = state;
    return state;
  };

  const resolveHandoffDescriptor = (descriptor) => {
    const resolved = handoffResolutions.get(descriptor);
    if (resolved) return resolved;
    try {
      const real = admittedDescriptor(
        descriptor.handoff.reference,
        descriptor.handoff.args,
        descriptor.handoff.groupBoot,
        descriptor.handoff.preparedEntryName,
      );
      handoffResolutions.set(descriptor, real);
      return real;
    } catch {
      return null;
    }
  };

  const handoffDescriptor = (reference, args, groupBoot, preparedEntryName, target) => {
    beginGenerationHandoff(target);
    return Object.freeze({
      skipped: args === skip,
      handoff: Object.freeze({ reference, args, groupBoot, preparedEntryName }),
      reference,
      args,
      key: null,
      resultContract: null,
      groupBoot,
      preparedEntryName,
      readOnlySnapshot: null,
      bootDelivery: null,
    });
  };

  const attachHandoffWaiter = (
    lease,
    descriptor,
    listener,
    livePublishListener = null,
  ) => {
    const state = generationHandoff;
    const waiter = () => {
      if (lease.released || terminal) return;
      const real = resolveHandoffDescriptor(descriptor);
      if (real !== null && !real.skipped) {
        try {
          if (consumers + 1 > CONSUMER_CAP) {
            throw diagnosticError(
              'SNAPBACK_REACT_STORE_CAPACITY',
              `React provider has reached its ${CONSUMER_CAP}-consumer cap`,
              { cap: CONSUMER_CAP },
            );
          }
          const store = stores.get(real.key) ?? createStore(real);
          const edgeId = `${lease.id}:handoff${lease.edges.length}`;
          store.idleEpoch += 1;
          store.consumers += 1;
          store.listeners.set(edgeId, listener);
          if (livePublishListener !== null) {
            store.livePublishListeners.set(edgeId, livePublishListener);
          }
          lease.edges.push({ key: store.key, edgeId });
          consumers += 1;
          startStore(store);
        } catch (error) {
          recordDiagnostic(error);
        }
      }
      try { listener(); } catch { /* observational */ }
    };
    if (state === null || state.status !== 'active') {
      queueMicrotask(waiter);
      return;
    }
    state.waiters.add(waiter);
    lease.cleanups.push(() => state.waiters.delete(waiter));
  };

  const optimisticCreateEntities = (store, state) => {
    if (state?.suspended === true) return Object.freeze([]);
    const authoritative = Array.isArray(store.authoritativeData)
      ? store.authoritativeData
      : [];
    const canonicalById = new Map(authoritative.map((row) => [row?._id, row]));
    const intentByMint = new Map();
    for (const entry of state?.snapshot?.layers ?? []) {
      if (typeof entry?.clientMutationId !== 'string') continue;
      for (const write of entry?.layer?.writes ?? []) {
        if (
          write?.operation === 'insert'
          && write.table === state.table
          && typeof write.id === 'string'
        ) intentByMint.set(write.id, entry.clientMutationId);
      }
    }
    const rows = state?.snapshot?.visibleRows?.[state.table] ?? authoritative;
    return deepFreeze(rows.map((row) => {
      const canonical = canonicalById.get(row?._id);
      if (canonical !== undefined) {
        return {
          kind: 'canonical',
          identity: { kind: 'canonical', id: canonical._id },
          fields: canonical,
        };
      }
      const intentId = intentByMint.get(row?._id);
      if (intentId === undefined) {
        throw diagnosticError(
          'SNAPBACK_REACT_OPTIMISTIC_CREATE_IDENTITY_MISSING',
          'a provisional insert has no durable intent identity',
          { table: state.table },
        );
      }
      const fields = { ...row };
      delete fields._id;
      delete fields._version;
      delete fields._createdAt;
      delete fields._updatedAt;
      return {
        kind: 'provisional',
        identity: { kind: 'provisional', id: intentId, intentId },
        fields,
      };
    }));
  };

  const optimisticCreateSnapshot = (descriptor) => {
    if (descriptor.skipped) return SKIPPED;
    const store = stores.get(descriptor.key);
    if (!store) return SERVER_PENDING;
    const base = store.snapshot;
    if (!['ready', 'refreshing'].includes(base.status)) return base;
    const state = store.optimisticCreate;
    if (
      state?.cache?.base === base
      && state.cache.view === state.snapshot
      && state.cache.suspended === state.suspended
    ) return state.cache.value;
    const value = Object.freeze({
      ...base,
      data: optimisticCreateEntities(store, state),
    });
    if (state !== null) {
      state.cache = { base, view: state.snapshot, suspended: state.suspended, value };
    }
    return value;
  };

  const subscribeOptimisticCreate = (descriptor, listener, previousLease = null) => {
    if (descriptor.skipped) {
      throw new TypeError('optimistic create query args cannot be skip');
    }
    const lease = subscribeMany(
      [descriptor],
      listener,
      previousLease?._queryLease ?? previousLease,
    );
    const store = stores.get(descriptor.key);
    const state = optimisticCreateState(store, descriptor);
    state.consumers += 1;
    if (store.authoritativeRevision > 0 && store.freshness === 'current') {
      void ensureOptimisticCreateView(store, state).catch(recordDiagnostic);
    }
    let released = false;
    return Object.freeze({
      _queryLease: lease,
      release() {
        if (released) return;
        released = true;
        state.consumers = Math.max(0, state.consumers - 1);
        lease.release();
        syncOptimisticCreatePin(store, state);
      },
    });
  };

  // @ref LLP 0155#identity-model — the paved React create surface exposes
  // durable intent identity as a provisional type and keeps the generated
  // speculative mint private to the headless rebase engine.
  // @ref LLP 0133#divergence-on-settle — response-first confirmations bridge
  // until authoritative delivery; query-first rows are held behind the same
  // identity map, and rejection removes only the durable layer it owns.
  const runOptimisticCreate = async (mutationReference, mutationArgs, descriptor) => {
    if (terminal) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'React provider is closed');
    if (mutationReference?.[HANDOFF_DEFERRED_REFERENCE] === true) {
      mutationReference = mutationReference.reference;
    }
    if (descriptor.skipped) throw new TypeError('optimistic create query args cannot be skip');
    const store = stores.get(descriptor.key);
    if (
      runtimePaused()
      || !store
      || store.authoritativeRevision === 0
      || store.freshness !== 'current'
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING',
        'optimistic create requires a current authoritative query store',
        { queryId: descriptor.reference.id },
      );
    }
    const state = optimisticCreateState(store, descriptor);
    let admittedMutation;
    try {
      admittedMutation = admittedOptimisticCreateMutation(mutationReference, state.table);
    } catch (error) {
      const target = recoverableGeneration(error, mutationReference);
      if (target === null) throw error;
      await beginGenerationHandoff(target).promise;
      admittedMutation = admittedOptimisticCreateMutation(mutationReference, state.table);
    }
    mutationArgs = normalizeGeneratedArgumentsV1(admittedMutation, mutationArgs);
    canonicalizeClientValueV1(mutationArgs);
    const mutationContract = preparedReactResultContract(binding, admittedMutation);
    const view = await ensureOptimisticCreateView(store, state);
    const capture = client.authorityFence?.capture?.() ?? null;
    if (capture && !client.authorityFence?.isCurrent?.(capture)) {
      throw diagnosticError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'optimistic create authority is no longer current',
      );
    }
    state.unresolved += 1;
    syncOptimisticCreatePin(store, state);
    let output;
    try {
      output = await client.mutate(admittedMutation, {
        args: mutationArgs,
        authorityCapture: capture,
        ...(preparedDevUserId === null ? {} : { userId: preparedDevUserId }),
      });
    } catch (error) {
      state.unresolved = Math.max(0, state.unresolved - 1);
      if (store.optimisticCreate !== state || (capture && !client.authorityFence?.isCurrent?.(capture))) {
        throw diagnosticError(
          'SNAPBACK_CLIENT_AUTHORITY_STALE',
          'optimistic create completed under stale authority',
        );
      }
      try {
        await view.refresh({
          connected: connectedForOptimisticCreate(store),
          cause: 'react-provider-create-rejected',
        });
      } finally {
        notifyOptimisticCreate(store, state);
        await applyOptimisticCreateAuthority(store, state, 'react-provider-rejection-rebase');
      }
      throw error;
    }
    state.unresolved = Math.max(0, state.unresolved - 1);
    if (store.optimisticCreate !== state || (capture && !client.authorityFence?.isCurrent?.(capture))) {
      throw diagnosticError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'optimistic create completed under stale authority',
      );
    }
    if (output?.status === 'queued') {
      // @ref LLP 0218#42-the-optimistic-contract-exact — durable acceptance
      // cannot become a rejected intent because local presentation refresh
      // failed after enqueue.
      let presentation = 'installed';
      let diagnosticCode = null;
      try {
        await view.refresh({
          connected: connectedForOptimisticCreate(store),
          cause: 'react-provider-create-queued',
        });
        notifyOptimisticCreate(store, state);
        await applyOptimisticCreateAuthority(store, state, 'react-provider-queued-rebase');
      } catch (error) {
        presentation = 'unavailable';
        diagnosticCode = 'SNAPBACK_REACT_QUEUED_PRESENTATION_UNAVAILABLE';
        emitQueuedPresentationDiagnostic(admittedMutation, output, diagnosticCode, error);
      }
      return dispatchQueuedOutcome(admittedMutation, output, presentation, diagnosticCode);
    }
    const result = validateResultContract(
      mutationContract,
      output.result,
      { violationCode: 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED' },
    );
    if (typeof output.clientMutationId !== 'string') {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_CREATE_IDENTITY_MISSING',
        'generated optimistic create settlement omitted its durable intent identity',
      );
    }
    state.confirmed.set(output.clientMutationId, Object.freeze({
      revision: store.authoritativeRevision,
      authoritativeIds: settlementAuthoritativeIds(output),
    }));
    await view.refresh({
      connected: connectedForOptimisticCreate(store),
      cause: 'react-provider-create-confirmed',
    });
    notifyOptimisticCreate(store, state);
    await applyOptimisticCreateAuthority(store, state, 'react-provider-confirmation-rebase');
    return Object.freeze({ status: 'settled', result });
  };

  const registry = Object.freeze({
    descriptor(reference, args, groupBoot = null, preparedEntryName = null) {
      try {
        return admittedDescriptor(reference, args, groupBoot, preparedEntryName);
      } catch (error) {
        const target = recoverableGeneration(error, reference);
        if (target === null) throw error;
        return handoffDescriptor(reference, args, groupBoot, preparedEntryName, target);
      }
    },
    mutationReference(reference) {
      try {
        return admittedReactReference(binding, reference, 'Mutation');
      } catch (error) {
        const target = recoverableGeneration(error, reference);
        if (target === null) throw error;
        beginGenerationHandoff(target);
        const deferred = { reference };
        Object.defineProperty(deferred, HANDOFF_DEFERRED_REFERENCE, { value: true });
        return Object.freeze(deferred);
      }
    },
    subscribe(descriptor, listener, previousLease = null, livePublishListener = null) {
      return subscribeMany([descriptor], listener, previousLease, livePublishListener);
    },
    subscribeMany,
    warnSubscriptionBudget,
    subscribeOptimisticCreate,
    runMutation,
    runOptimisticCreate,
    runCommandMutation,
    createPresenceToken,
    presenceDescriptor,
    subscribePresence,
    presenceSnapshot,
    [ACTIVITY_PRESENCE_SESSION_EPOCH]() { return activityPresenceSessionEpoch; },
    snapshot,
    optimisticCreateSnapshot,
    get connectionId() { return connectionId; },
    aggregateConnection,
    subscribeConnection(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    recordDiagnostic,
    // Host lifecycle is projected through the same registry operations as
    // the auth barrier, with an independent reason bit so a host resume
    // cannot race an authority transition (or vice versa).
    // @ref LLP 0181#provider — the Expo lifecycle shell delegates to the
    // existing React/client machinery.
    async pause() {
      hostPaused = true;
      await quiesceRegistry();
    },
    async resume() {
      hostPaused = false;
      resumeRegistry();
    },
    inspection() {
      const clientResources = typeof client.localResourceInspection === 'function'
        ? client.localResourceInspection([connectionId])
        : null;
      // The exact raw label was used to select this manager, but the gated
      // client snapshot has already projected that caller-influencable label.
      const clientManager = clientResources?.managers?.[0] ?? null;
      const authority = typeof client.authorityTransitionStatus === 'function'
        ? client.authorityTransitionStatus()
        : null;
      const ownershipTuple = clientResources?.ownershipTuple
        ?? projectOwnershipTupleInspectionV1({
          canonicalAppId: binding.appId,
          storagePartition: typeof client.clientStoreId === 'string'
            ? client.clientStoreId
            : 'unavailable',
          settledAuthority: Object.freeze({
            state: authority?.state ?? 'unknown',
            settled: authority?.settled === true,
          }),
        });
      const grantAgeMs = clientManager?.grantAgeMs ?? null;
      const outboxSuspensionReason = runtimePaused()
        ? custodyPaused ? 'authority-transition' : 'host-paused'
        : options.__outboxDrainMode?.() === 'manual'
          ? 'manual-policy'
          : clientResources?.outboxSuspensionReason ?? null;
      const projectedConnectionId = clientManager?.connectionId
        ?? inspectionPseudonymV1(connectionId);
      const subscriptions = Object.freeze(activeStores().map((store) => {
        const liveHandle = store.handle?.current ?? null;
        return Object.freeze({
          owner: `provider:${providerInstanceId}/query:${store.reference?.name ?? store.reference?.id ?? 'unknown'}`,
          connectionId: projectedConnectionId,
          subscriptionId: liveHandle?.inspectionSubscriptionId
            ?? liveHandle?.subscriptionId
            ?? null,
          functionName: store.reference?.name ?? null,
          state: store.snapshot.status,
          subscriptionState: liveHandle?.inspectionSubscriptionState
            ?? (store.snapshot.status === 'pending' ? 'PENDING' : 'LIVE'),
          connection: store.snapshot.connection,
          connectionState: liveHandle?.inspectionConnectionState
            ?? (store.snapshot.connection === 'live'
              ? 'ATTACHED_LIVE'
              : store.snapshot.connection === 'polling' ? 'ATTACHED_POLL' : 'GRANTED'),
          supersedesSubscriptionId: liveHandle?.inspectionSupersedesSubscriptionId ?? null,
          snapshotVersion: store.authoritativeRevision,
          lastDeliveryAtMs: store.lastDeliveryAtMs,
          authoritativeRevision: store.authoritativeRevision,
          deliveryLagMs: store.deliveryLagMs,
          suppressedEqualSnapshots: store.suppressedEqualSnapshots,
          terminalCode: liveHandle?.terminalDiagnosticCode ?? null,
          readiness: store.snapshot.status === 'ready' ? 'ready' : 'waiting',
          authBarrier: custodyPaused ? 'closed' : 'open',
          outboxSuspensionReason,
          ownershipTuple,
          grantAgeMs,
        });
      }));
      return Object.freeze({
        providerInstanceId,
        terminal,
        custodyPaused: runtimePaused(),
        hostPaused,
        stores: stores.size,
        optimisticLayers: [...stores.values()].reduce(
          (sum, store) => sum + store.optimisticLayers.length,
          0,
        ),
        optimisticCreateViews: [...stores.values()].filter(
          (store) => store.optimisticCreate?.view !== null,
        ).length,
        optimisticCreateConsumers: [...stores.values()].reduce(
          (sum, store) => sum + (store.optimisticCreate?.consumers ?? 0),
          0,
        ),
        provisionalCreates: [...stores.values()].reduce(
          (sum, store) => sum + (store.optimisticCreate?.snapshot?.layers.length ?? 0),
          0,
        ),
        confirmedOptimisticLayers: Object.freeze([...stores.values()].flatMap((store) => (
          store.optimisticLayers
            .filter((layer) => layer.confirmed === true)
            .map((layer) => Object.freeze({
              attemptId: layer.id,
              mutationId: layer.mutationId,
              queryId: layer.queryId,
              confirmedRevision: layer.confirmedRevision,
              storeRevision: store.authoritativeRevision,
            }))
        ))),
        orphanedOptimisticLayers: Object.freeze([...stores.values()].flatMap((store) => (
          store.optimisticLayers
            .filter((layer) => layer.orphaned === true)
            .map((layer) => Object.freeze({
              attemptId: layer.id,
              clientMutationId: layer.clientMutationId ?? layer.id,
              mutationId: layer.mutationId,
              queryId: layer.queryId,
              disposition: 'unknown',
            }))
        ))),
        consumers,
        serverSubscriptions: activeStores().length,
        subscriptionBudget: VIEW_SUBSCRIPTION_BUDGET,
        subscriptionHardCeiling: SERVER_SUBSCRIPTION_CAP,
        connections: Object.freeze([Object.freeze({
          owner: `provider:${providerInstanceId}`,
          connectionId: projectedConnectionId,
          state: aggregateConnection().status,
          authBarrier: custodyPaused ? 'closed' : 'open',
          readiness: aggregateConnection().status === 'live' ? 'ready' : 'waiting',
          outboxSuspensionReason,
          ownershipTuple,
          grantAgeMs,
        })]),
        subscriptions,
        mutationPhaseCosts: clientResources?.mutationPhaseCosts
          ?? (typeof client.mutationPhaseCostInspection === 'function'
            ? client.mutationPhaseCostInspection()
            : null),
        leases: leases.size,
        reservations: 0,
        timers: [...rooms.values()].filter((room) => room.heartbeatTimer !== null).length,
        presenceStores: rooms.size,
        presenceConsumers,
        presenceSubscriptions: [...rooms.values()].filter((room) => room.handle !== null).length,
        publishers,
        presenceTimers: [...rooms.values()].filter((room) => room.heartbeatTimer !== null).length,
        presenceListeners: [...rooms.values()].reduce(
          (sum, room) => sum + [...room.tokens.values()]
            .reduce((tokenSum, token) => tokenSum + token.listeners.size, 0),
          0,
        ),
        resyncReasons: Object.freeze([...rooms.values()].flatMap((room) => room.resyncReasons)),
        listeners: [...stores.values()].reduce((sum, store) => sum + store.listeners.size, 0)
          + connectionListeners.size,
        diagnostics: Object.freeze([...diagnostics]),
        preparedRegistrations: preparedRegistrations.size,
        preparedGroupSource: preparedGroup?.source ?? null,
        preparedGroupReason: preparedGroup?.reason ?? null,
        preparedGroupBoot: preparedGroup?.boot ?? null,
        generationHandoff: generationHandoff?.status ?? null,
      });
    },
    async dispose() {
      if (terminal) return;
      terminal = true;
      custodyPaused = true;
      hostPaused = true;
      const ownsUnadoptedRegisteredOwner = preparedGroup?.connectionId === connectionId
        && (
          preparedRegistrations.size > 0
          || unadoptedPreparedSubscriptions.size > 0
        );
      const pendingAttachDeadline = preparedGroup?.boot?.attachDeadline ?? null;
      const pendingRegisteredRetirement = retireUnadoptedPreparedSubscriptions();
      for (const lease of [...leases]) releaseLease(lease);
      for (const token of [...roomLeases]) releasePresenceToken(token);
      for (const store of stores.values()) {
        if (store.optimisticCreate !== null) {
          closeOptimisticCreate(store, store.optimisticCreate, { force: true });
        }
        for (const layer of store.optimisticLayers) {
          layer.retired = true;
          releaseLayerPin(store, layer);
        }
        store.optimisticLayers = [];
        store.pendingMutations.clear();
        stopStore(store, { blank: true });
      }
      for (const room of rooms.values()) stopRoom(room);
      await Promise.allSettled([
        ...[...allHandles].map((handle) => handle.settled()),
        ...[...rooms.values()].map((room) => room.cleanup),
        ...(registeredRecovery === null ? [] : [registeredRecovery]),
        pendingRegisteredRetirement,
      ]);
      // @ref LLP 0114#closed-connection-and-cancellation-protocol — adopted
      // and ordinary children retire through their own handle refcounts before
      // the provider conditionally releases its grant-owned connection. A
      // sibling's remaining socket demand keeps the shared connection live.
      const connectionStillShared = (
        manager?.inspection?.().socketDemand ?? 0
      ) > 0;
      if (
        !connectionStillShared
        && typeof client.releaseConnection === 'function'
      ) {
        try {
          await client.releaseConnection(connectionId, {
            attachDeadline: ownsUnadoptedRegisteredOwner
              ? pendingAttachDeadline
              : null,
            ifIdle: true,
          });
        } catch (error) {
          recordDiagnostic(error);
        }
      }
      stores.clear();
      preparedRegistrations.clear();
      unadoptedPreparedSubscriptions.clear();
      dirtyPreparedSubscriptions.clear();
      rooms.clear();
      connectionListeners.clear();
      generationHandoff = null;
      unregisterPreparedFrameGuard();
      try { await unregisterBarrier(); } catch (error) { recordDiagnostic(error); }
    },
  });
  preparedGroupReadersByRegistry.set(registry, () => preparedGroup);
  return registry;
}

export function createSnapbackReactFullProvider(binding, options = {}) {
  const prepared = assertPreparedReactBinding(binding);
  const devHookDiagnostics = hookDiagnosticsOptions(options);
  const client = preparedReactBindingClient(prepared);
  const providerInstanceId = `provider-${++providerSequence}-${localUniqueLabel()}`;
  let registry = null;
  let disposePromise = null;
  const constructorDrainMode = ['auto', 'manual'].includes(client.outboxDrainPolicy)
    ? client.outboxDrainPolicy
    : 'auto';
  const initialDrainMode = options.outboxDrain ?? constructorDrainMode;
  if (!['auto', 'manual'].includes(initialDrainMode)) {
    throw new TypeError("outboxDrain must be 'auto' or 'manual'");
  }
  const drainState = {
    mode: initialDrainMode,
    options: options.outboxDrainOptions ?? {},
    handle: null,
    cleanups: [],
  };
  const clientOwnsDrainLifecycle = (
    typeof client.__configureOutboxDrain === 'function'
    && ['auto', 'manual'].includes(client.outboxDrainPolicy)
  );
  if (
    drainState.options === null
    || typeof drainState.options !== 'object'
    || Array.isArray(drainState.options)
  ) throw new TypeError('outboxDrainOptions must be an object');

  const stopOutboxDrain = () => {
    for (const cleanup of drainState.cleanups.splice(0)) {
      try { cleanup(); } catch { /* deterministic best-effort host teardown */ }
    }
    try {
      if (clientOwnsDrainLifecycle) {
        // @ref LLP 0270#d4-queue-and-settle-offline-intent-by-default — the
        // headless client now owns the store lifecycle through close(); a
        // provider only lends its mounted auto/manual policy and restores the
        // constructor policy instead of terminating that client-owned lease.
        client.__configureOutboxDrain(client.outboxDrainPolicy);
      } else {
        drainState.handle?.stop();
      }
    } catch { /* controller cleanup remains idempotent */ }
    drainState.handle = null;
  };
  const wakeOutboxDrain = () => {
    if (drainState.mode !== 'auto' || drainState.handle?.status?.().running !== true) return;
    void drainState.handle.drainNow().catch(() => {});
  };
  const startOutboxDrain = () => {
    if (drainState.handle?.status?.().running === true) return drainState.handle;
    if (
      client.rqsStoreInfo?.durable !== true
      || typeof client.startOutboxDrain !== 'function'
    ) return null;
    const drainOptions = drainState.options;
    try {
      // @ref LLP 0218#43-the-platform-owned-drain — the provider owns one P2
      // controller for its durable writer store. Manual mode disables only
      // automatic scheduling; timer/eventTarget carrier seams pass through.
      drainState.handle = clientOwnsDrainLifecycle
        ? client.__configureOutboxDrain(drainState.mode, drainOptions)
        : client.startOutboxDrain({
            ...drainOptions,
            automatic: drainState.mode === 'auto',
          });
    } catch (error) {
      if (![
        'SNAPBACK_OFFLINE_QUEUE_DISABLED',
        'SNAPBACK_OFFLINE_QUEUE_STORE_INCAPABLE',
      ].includes(error?.code)) {
        try { options.onDiagnostic?.(serializeError(error)); } catch { /* observational */ }
      }
      drainState.handle = null;
      return null;
    }
    if (drainState.mode === 'auto') {
      const focusTarget = drainOptions.eventTarget === undefined
        ? (typeof globalThis.addEventListener === 'function' ? globalThis : null)
        : drainOptions.eventTarget;
      const visibilityTarget = focusTarget === null
        ? null
        : focusTarget?.document
          ?? (focusTarget?.visibilityState === undefined ? globalThis.document ?? null : focusTarget);
      if (
        focusTarget !== null
        && typeof focusTarget?.addEventListener === 'function'
        && typeof focusTarget?.removeEventListener === 'function'
      ) {
        focusTarget.addEventListener('focus', wakeOutboxDrain);
        drainState.cleanups.push(() => focusTarget.removeEventListener('focus', wakeOutboxDrain));
      }
      if (
        visibilityTarget !== null
        && typeof visibilityTarget?.addEventListener === 'function'
        && typeof visibilityTarget?.removeEventListener === 'function'
      ) {
        const onVisibility = () => {
          if (visibilityTarget.visibilityState !== 'hidden') wakeOutboxDrain();
        };
        visibilityTarget.addEventListener('visibilitychange', onVisibility);
        drainState.cleanups.push(
          () => visibilityTarget.removeEventListener('visibilitychange', onVisibility),
        );
      }
    }
    return drainState.handle;
  };
  const configureOutboxDrain = (mode = 'auto', drainOptions = {}) => {
    if (!['auto', 'manual'].includes(mode)) {
      throw new TypeError("outboxDrain must be 'auto' or 'manual'");
    }
    if (drainOptions === null || typeof drainOptions !== 'object' || Array.isArray(drainOptions)) {
      throw new TypeError('outboxDrainOptions must be an object');
    }
    const changed = drainState.mode !== mode || drainState.options !== drainOptions;
    drainState.mode = mode;
    drainState.options = drainOptions;
    if (changed) stopOutboxDrain();
    if (registry !== null) startOutboxDrain();
  };
  const start = () => {
    if (registry !== null) {
      startOutboxDrain();
      return provider;
    }
    const preparedGroup = options.preparedGroup == null
      ? null
      : consumePreparedReactQueryGroup(prepared, options.preparedGroup);
    try {
      registry = createRegistry(prepared, providerInstanceId, {
        ...options,
        __outboxDrainMode: () => drainState.mode,
        ...(preparedGroup === null ? {} : { preparedGroup }),
      });
    } catch (error) {
      if (preparedGroup !== null) void abandonConsumedReactQueryGroup(preparedGroup);
      throw error;
    }
    startOutboxDrain();
    return provider;
  };
  const activeRegistry = () => (start(), registry);
  const provider = {
    kind: 'snapback.react-provider.v1',
    providerInstanceId,
    binding: prepared,
    get registry() { return activeRegistry(); },
    assets: options.assets ?? null,
    assetSourceAdapter: options.assetSourceAdapter ?? null,
    start,
    registerEphemeralRepublisher(reference, callback) {
      start();
      return preparedReactBindingClient(prepared).registerEphemeralRepublisher(reference, callback);
    },
    pause: () => activeRegistry().pause(),
    resume: async () => {
      await activeRegistry().resume();
      wakeOutboxDrain();
    },
    inspection: () => Object.freeze({
      ...activeRegistry().inspection(),
      commandTasks: commandClients.get(provider)?.inspection().activeCommandTasks ?? 0,
      outboxDrain: drainState.handle?.status?.() ?? null,
    }),
    dispose() {
      if (registry === null) return Promise.resolve();
      return disposePromise ??= (async () => {
        stopOutboxDrain();
        await disposeCommandClientFor(provider);
        await disposeAssetRegistryFor(provider);
        return registry.dispose();
      })();
    },
  };
  provider.surface = (surface, params, surfaceOptions = {}) => (
    bindSnapbackSurface(provider, surface, params, surfaceOptions)
  );
  providerOutboxDrainStates.set(provider, Object.freeze({
    configure: configureOutboxDrain,
    stop: stopOutboxDrain,
    async drainNow() {
      if (drainState.handle?.status?.().running === true) {
        return drainState.handle.drainNow();
      }
      return client.replayQueuedMutations();
    },
  }));
  hookDiagnosticsOptionsByProvider.set(provider, devHookDiagnostics);
  return Object.freeze(provider);
}

export function createSnapbackReactCoreProvider(binding, options = {}) {
  const prepared = assertPreparedReactBinding(binding);
  const devHookDiagnostics = hookDiagnosticsOptions(options);
  const providerInstanceId = `provider-${++providerSequence}-${localUniqueLabel()}`;
  let registry = null;
  let disposePromise = null;
  const start = () => {
    if (registry !== null) return provider;
    const preparedGroup = options.preparedGroup == null
      ? null
      : consumePreparedReactQueryGroup(prepared, options.preparedGroup);
    try {
      registry = createRegistry(prepared, providerInstanceId, {
        ...options,
        ...(preparedGroup === null ? {} : { preparedGroup }),
      });
    } catch (error) {
      if (preparedGroup !== null) void abandonConsumedReactQueryGroup(preparedGroup);
      throw error;
    }
    return provider;
  };
  const activeRegistry = () => (start(), registry);
  const provider = {
    kind: 'snapback.react-provider.v1',
    providerInstanceId,
    binding: prepared,
    get registry() { return activeRegistry(); },
    start,
    registerEphemeralRepublisher(reference, callback) {
      start();
      return preparedReactBindingClient(prepared).registerEphemeralRepublisher(reference, callback);
    },
    pause: () => activeRegistry().pause(),
    resume: () => activeRegistry().resume(),
    inspection: () => Object.freeze(activeRegistry().inspection()),
    dispose() {
      if (registry === null) return Promise.resolve();
      disposePromise ??= registry.dispose();
      return disposePromise;
    },
  };
  hookDiagnosticsOptionsByProvider.set(provider, devHookDiagnostics);
  return Object.freeze(provider);
}

function renderSnapbackProvider(
  { binding = null, provider = null, children = null },
  createProvider,
) {
  const supplied = provider === null ? null : assertProvider(provider);
  const prepared = supplied === null ? assertPreparedReactBinding(binding) : null;
  const lifecycle = useMemo(() => {
    const listeners = new Set();
    let current = null;
    return Object.freeze({
      getSnapshot: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publish(next) {
        current = next;
        for (const listener of [...listeners]) listener();
      },
    });
  }, [prepared, supplied]);
  const current = useSyncExternalStore(
    lifecycle.subscribe,
    lifecycle.getSnapshot,
    lifecycle.getSnapshot,
  );
  useEffect(() => {
    if (supplied !== null) {
      supplied.start();
      return undefined;
    }
    const next = createProvider(prepared);
    next.start();
    lifecycle.publish(next);
    return () => {
      lifecycle.publish(null);
      void next.dispose();
    };
  }, [createProvider, lifecycle, prepared, supplied]);
  const active = supplied ?? current;
  if (active === null) return null;
  return React.createElement(providerContext.Provider, { value: active }, children);
}

function AdvancedSnapbackCoreProvider(props) {
  return renderSnapbackProvider(props, createSnapbackReactCoreProvider);
}

function AdvancedSnapbackFullProvider({
  binding = null,
  provider = null,
  children = null,
  outboxDrain = 'auto',
  outboxDrainOptions = DEFAULT_OUTBOX_DRAIN_OPTIONS,
}) {
  const supplied = provider === null ? null : assertProvider(provider);
  const prepared = supplied === null ? assertPreparedReactBinding(binding) : null;
  const lifecycle = useMemo(() => {
    const listeners = new Set();
    let current = null;
    return Object.freeze({
      getSnapshot: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publish(next) {
        current = next;
        for (const listener of [...listeners]) listener();
      },
    });
  }, [prepared, supplied]);
  const current = useSyncExternalStore(
    lifecycle.subscribe,
    lifecycle.getSnapshot,
    lifecycle.getSnapshot,
  );
  useEffect(() => {
    if (supplied !== null) {
      supplied.start();
      // @ref LLP 0218#43-the-platform-owned-drain — the full provider owns the
      // drain lifecycle even when the provider instance is caller-supplied.
      providerOutboxDrainStates.get(supplied)?.configure(outboxDrain, outboxDrainOptions);
      return () => providerOutboxDrainStates.get(supplied)?.stop();
    }
    const next = createSnapbackReactFullProvider(prepared, { outboxDrain, outboxDrainOptions });
    next.start();
    lifecycle.publish(next);
    return () => {
      lifecycle.publish(null);
      void next.dispose();
    };
  }, [lifecycle, outboxDrain, outboxDrainOptions, prepared, supplied]);
  const active = supplied ?? current;
  if (active === null) return null;
  return React.createElement(providerContext.Provider, { value: active }, children);
}

function reactAuthOwnerRefusal(message, details = {}) {
  const error = diagnosticError(
    'SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID',
    message,
    details,
  );
  error.remediations = Object.freeze([]);
  return error;
}

function declaredDevProviderRefusal() {
  const error = diagnosticError(
    'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED',
    'The declared-dev capability is accepted only from the imported generated app object.',
    { suppliedAsOption: true },
  );
  error.remediations = Object.freeze([]);
  return error;
}

function ordinaryProviderController({
  appClient,
  app,
  binding,
  url,
  platform,
  storagePartition,
  now,
  onDiagnostic,
}) {
  let generation = 0;
  let retained = appClient;
  let acquisition = null;
  const constructionListeners = new Set();
  const owned = appClient === null;
  const publishConstruction = (snapshot) => {
    for (const listener of [...constructionListeners]) listener(snapshot);
  };
  const acquire = () => {
    if (retained !== null) return Promise.resolve(retained);
    acquisition ??= createSnapbackAppClientWithBootstrapObserver(
      {
        app,
        ...(binding === null ? {} : { binding }),
        ...(url === undefined ? {} : { url }),
        platform,
        ...(storagePartition === undefined ? {} : { storagePartition }),
        ...(now === undefined ? {} : { now }),
        ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
      },
      publishConstruction,
    ).then((next) => {
      retained = next;
      return next;
    });
    return acquisition;
  };
  return Object.freeze({
    acquire,
    subscribeConstruction(listener) {
      constructionListeners.add(listener);
      return () => constructionListeners.delete(listener);
    },
    begin() {
      generation += 1;
      return generation;
    },
    releaseAfterReplayWindow(token, providerDisposal) {
      queueMicrotask(async () => {
        try { await providerDisposal; } catch { /* app-owner cleanup still proceeds */ }
        if (!owned || generation !== token) return;
        let current = retained;
        if (current === null && acquisition !== null) {
          try { current = await acquisition; } catch { return; }
        }
        if (generation !== token || current === null) return;
        retained = null;
        acquisition = null;
        await current.dispose();
      });
    },
  });
}

function failedBootstrapSnapshot(error) {
  if (error?.bootstrapState) return error.bootstrapState;
  return Object.freeze({
    status: 'error',
    diagnostic: serializeError(error),
    remediations: Object.freeze([...(error?.remediations ?? [])]),
  });
}

function OrdinarySnapbackProvider({
  appClient = null,
  app = null,
  binding = null,
  url = undefined,
  platform = null,
  storagePartition = undefined,
  now = undefined,
  onDiagnostic = undefined,
  fallback = null,
  children = null,
  createProvider,
  full = false,
  outboxDrain = 'auto',
  outboxDrainOptions = DEFAULT_OUTBOX_DRAIN_OPTIONS,
}) {
  const controller = useMemo(() => ordinaryProviderController({
    appClient,
    app,
    binding,
    url,
    platform,
    storagePartition,
    now,
    onDiagnostic,
  }), [app, appClient, binding, now, onDiagnostic, platform, storagePartition, url]);
  const store = useMemo(() => {
    const listeners = new Set();
    let current = Object.freeze({
      bootstrap: appClient?.bootstrapState?.()
        ?? Object.freeze({ status: 'starting', stage: 'binding' }),
      appClient: null,
      provider: null,
    });
    return Object.freeze({
      getSnapshot: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publish(next) {
        current = Object.freeze(next);
        for (const listener of [...listeners]) listener();
      },
    });
  }, [appClient, controller]);
  const current = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const token = controller.begin();
    let active = true;
    let projection = null;
    let provider = null;
    let unsubscribeBootstrap = null;
    const unsubscribeConstruction = controller.subscribeConstruction((snapshot) => {
      if (!active || snapshot.status === 'ready') return;
      store.publish({
        bootstrap: snapshot,
        appClient: null,
        provider: null,
      });
    });
    void (async () => {
      try {
        projection = await controller.acquire();
        if (!active) return;
        const syncBootstrap = () => {
          if (!active) return;
          const bootstrap = projection.bootstrapState();
          if (provider === null && bootstrap.status === 'ready') return;
          store.publish({
            bootstrap,
            appClient: projection,
            provider,
          });
        };
        unsubscribeBootstrap = projection.subscribeBootstrap(syncBootstrap);
        syncBootstrap();
        const generatedApp = app ?? applicationDescriptorForAppClient(projection);
        const prepared = await projection.client.prepareReactBinding({
          generatedManifest: generatedApp,
        });
        if (!active) return;
        provider = createProvider(prepared, { onDiagnostic });
        provider.start?.();
        syncBootstrap();
      } catch (error) {
        if (!active) return;
        store.publish({
          bootstrap: failedBootstrapSnapshot(error),
          appClient: null,
          provider: null,
        });
      }
    })();
    return () => {
      active = false;
      unsubscribeConstruction();
      unsubscribeBootstrap?.();
      const providerDisposal = Promise.resolve(provider?.dispose?.());
      controller.releaseAfterReplayWindow(token, providerDisposal);
    };
  }, [app, controller, createProvider, onDiagnostic, store]);

  if (current.provider === null || current.appClient === null) {
    return typeof fallback === 'function' ? fallback(current.bootstrap) : fallback;
  }
  const projected = full
    ? React.createElement(AdvancedSnapbackFullProvider, {
        provider: current.provider,
        outboxDrain,
        outboxDrainOptions,
      }, children)
    : React.createElement(AdvancedSnapbackCoreProvider, {
        provider: current.provider,
      }, children);
  return React.createElement(
    appClientContext.Provider,
    { value: current.appClient },
    projected,
  );
}

function providerOwnershipMode({
  appClient = null,
  app = null,
  binding = null,
  url = undefined,
  provider = null,
}) {
  const hasRealUrl = url !== undefined && url !== null && url !== '';
  // @ref LLP 0258#d6-react-and-expo-project-the-same-owner — a provider
  // instance selects exactly one construction owner. Mixing app-client/app
  // ownership with the prepared/provider injection seam refuses synchronously.
  if (appClient !== null && app !== null) {
    throw reactAuthOwnerRefusal(
      'Pass either appClient or app + AppBinding, not both ordinary owner forms.',
      { ordinaryForms: Object.freeze(['appClient', 'app+binding']) },
    );
  }
  if (appClient !== null && (binding !== null || hasRealUrl || provider !== null)) {
    throw reactAuthOwnerRefusal(
      'appClient ownership cannot be combined with prepared binding or provider injection.',
      { ordinary: 'appClient', advanced: provider !== null ? 'provider' : 'binding' },
    );
  }
  if (app !== null && provider !== null) {
    throw reactAuthOwnerRefusal(
      'app + AppBinding ownership cannot be combined with provider injection.',
      { ordinary: 'app+binding', advanced: 'provider' },
    );
  }
  if (app === null && hasRealUrl) {
    throw reactAuthOwnerRefusal('url ownership requires a generated app.', {
      ordinary: 'app+url',
    });
  }
  if (app !== null && binding === null && !hasRealUrl) {
    throw reactAuthOwnerRefusal('app ownership requires an admitted AppBinding or the declared-development url option.', {
      ordinary: 'app+binding-or-url',
    });
  }
  return appClient !== null || app !== null ? 'ordinary' : 'advanced';
}

function assertProjectedAppClientOwnership(props) {
  const appClient = props.__appClientProjection;
  if (appClient === null) return;
  let prepared = null;
  if (props.provider !== null && props.provider !== undefined) {
    prepared = assertProvider(props.provider).binding;
  } else if (props.binding !== null && props.binding !== undefined) {
    prepared = assertPreparedReactBinding(props.binding);
  }
  if (prepared === null) return;
  const boundClient = preparedReactBindingClient(prepared);
  if (appClient?.client !== boundClient) {
    throw reactAuthOwnerRefusal(
      'The projected app client and prepared React provider must be owned by the same Snapback client.',
      { ordinary: 'appClientProjection', advanced: 'prepared-provider-client' },
    );
  }
}

export function SnapbackCoreProvider(props) {
  if (Object.hasOwn(props, 'declaredDev') || Object.hasOwn(props, 'declaredDevCapability')) {
    throw declaredDevProviderRefusal();
  }
  if (props.__appClientProjection !== undefined) {
    assertProjectedAppClientOwnership(props);
    return React.createElement(
      appClientContext.Provider,
      { value: props.__appClientProjection },
      React.createElement(AdvancedSnapbackCoreProvider, props),
    );
  }
  if (providerOwnershipMode(props) === 'advanced') {
    return React.createElement(AdvancedSnapbackCoreProvider, props);
  }
  return React.createElement(OrdinarySnapbackProvider, {
    ...props,
    createProvider: createSnapbackReactCoreProvider,
    full: false,
  });
}

export function SnapbackFullProvider(props) {
  if (Object.hasOwn(props, 'declaredDev') || Object.hasOwn(props, 'declaredDevCapability')) {
    throw declaredDevProviderRefusal();
  }
  if (props.__appClientProjection !== undefined) {
    assertProjectedAppClientOwnership(props);
    return React.createElement(
      appClientContext.Provider,
      { value: props.__appClientProjection },
      React.createElement(AdvancedSnapbackFullProvider, props),
    );
  }
  if (providerOwnershipMode(props) === 'advanced') {
    return React.createElement(AdvancedSnapbackFullProvider, props);
  }
  return React.createElement(OrdinarySnapbackProvider, {
    ...props,
    createProvider: createSnapbackReactFullProvider,
    full: true,
  });
}

function useProvider() {
  return assertProvider(useContext(providerContext));
}

// Narrow projection for aliases that must execute through the provider's
// already-prepared client. It deliberately exposes no provider lifecycle or
// registry constructor.
// @ref LLP 0252#d1-two-source-profiles-one-semantic-and-runtime-pipeline — familiar aliases borrow
// the canonical provider/client owner; they never create a parallel client.
export function useSnapbackProviderClient() {
  return preparedReactBindingClient(useProvider().binding);
}

function useSnapbackAppClient() {
  const appClient = useContext(appClientContext);
  if (appClient === null) {
    throw diagnosticError(
      'SNAPBACK_REACT_AUTH_PROVIDER_REQUIRED',
      'Auth hooks require the ordinary Snapback app-client provider path.',
    );
  }
  return appClient;
}

/**
 * Projects the app client's exact closed principal snapshot. Official
 * providers withhold hook consumers until client readiness. A custom SSR
 * ownership tree that renders this hook must keep its server snapshot
 * deterministic and identical to the first hydration snapshot.
 * @ref LLP 0238#d6-current-principal-is-a-first-class-projection
 */
export function useSnapbackCurrentPrincipal() {
  const auth = useSnapbackAppClient().auth;
  const subscribe = useCallback(
    (listener) => auth.subscribeCurrentPrincipal(listener),
    [auth],
  );
  const snapshot = useCallback(() => auth.currentPrincipal(), [auth]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// The facade is stable for one app-client projection. Returning it by identity
// preserves every exact action/result contract and keeps composition in the
// framework-neutral owner.
export function useSnapbackAuth() {
  return useSnapbackAppClient().auth;
}
// @ref LLP 0114#exact-identity-bytes-and-limits — hook dependency identity
// follows the same canonical content grammar as registry store identity, so
// fresh but equal inline values cannot rotate committed subscriptions.
const canonicalHookInputKey = (value) => (
  value === skip ? skip : canonicalizeClientValueV1(value)
);
const canonicalFunctionArgsKey = (reference, value) => (
  value === skip
    ? skip
    : canonicalizeClientValueV1(normalizeGeneratedArgumentsV1(reference, value))
);
const canonicalContractInputKey = (contract, value, path) => (
  value === skip
    ? skip
    : canonicalizeClientValueV1(
        normalizeArgumentsAgainstContractV1(value, contract, { path }),
      )
);

function useSnapbackQueryProjection(reference, args, onLivePublish) {
  const provider = useProvider();
  const lease = useRef(null);
  const livePublishListener = useRef(onLivePublish);
  livePublishListener.current = onLivePublish;
  const observesLivePublish = onLivePublish !== null;
  const churnDetectorRef = useRef(HOOK_CHURN_UNINITIALIZED);
  if (churnDetectorRef.current === HOOK_CHURN_UNINITIALIZED) {
    churnDetectorRef.current = createHookChurnDetector(provider, 'query');
  }
  const argsKey = canonicalFunctionArgsKey(reference, args);
  if (
    positiveDevelopmentEnvironment()
    && args !== skip
    && typeof args === 'object'
    && args !== null
  ) {
    // Development-only diagnostics share the existing lazy failure/HMR
    // runtime. The production entry allocates no detector state or hook; the
    // existing lease ref supplies stable mounted-hook identity. Delivery
    // rides the bound client's diagnostics channel when one exists
    // (LLP 0219), with the LLP 0043 M1 semantics unchanged.
    const site = new Error('Snapback live-hook args allocation site').stack ?? null;
    const identityChurnChannel = churnDetectorRef.current === HOOK_CHURN_DISABLED
      ? null
      : churnDetectorRef.current.channel;
    void import('./react-runtime.mjs').then((module) => {
      module.diagnoseLiveHookArgsIdentity({
        hookRef: lease,
        reference,
        args,
        argsKey,
        site,
        diagnosticsChannel: identityChurnChannel,
      });
    }).catch(() => {});
  }
  const descriptor = useMemo(
    () => provider.registry.descriptor(reference, args),
    [provider, reference, argsKey],
  );
  const subscribe = useCallback((listener) => {
    const next = provider.registry.subscribe(
      descriptor,
      listener,
      lease.current,
      observesLivePublish ? () => livePublishListener.current?.() : null,
    );
    lease.current = next;
    recordCommittedHookDescriptor(churnDetectorRef.current, {
      primaryIdentity: descriptor.key,
      referenceName: descriptor.reference?.name ?? reference?.name ?? '<unknown query>',
      hmrHandoff: descriptor.handoff !== undefined,
    });
    return () => {
      const releasing = next;
      queueMicrotask(() => {
        if (lease.current === releasing) lease.current = null;
        releasing.release();
      });
    };
  }, [provider, descriptor, observesLivePublish]);
  return useSyncExternalStore(
    subscribe,
    () => provider.registry.snapshot(descriptor),
    () => (descriptor.skipped ? SKIPPED : SERVER_PENDING),
  );
}

export function useSnapbackQuery(reference, args) {
  return useSnapbackQueryProjection(reference, args, null);
}

function authorityProfileReferences(profile) {
  if (
    profile === null
    || typeof profile !== 'object'
    || profile.list?.kind !== 'LiveQuery'
    || profile.myRole?.kind !== 'LiveQuery'
  ) {
    throw new TypeError(
      'authority hooks require a generated profile with list and myRole live references',
    );
  }
  return profile;
}

function authorityRosterFirstArgs(scopeId, limit) {
  return Object.freeze({
    scopeId,
    ...(limit === undefined ? {} : { page: Object.freeze({ limit }) }),
  });
}

function authorityRosterNextArgs(scopeId, limit, cursor) {
  return Object.freeze({
    scopeId,
    page: Object.freeze({
      after: cursor,
      ...(limit === undefined ? {} : { limit }),
    }),
  });
}

function authorityReferenceGenerationIdentity(reference) {
  return canonicalizeClientValueV1({
    appId: reference.appId,
    id: reference.id,
    implementationHash: reference.implementationHash,
    expectedGeneration: reference.expectedGeneration ?? null,
  });
}

function authorityCallerKey(principal) {
  return canonicalizeClientValueV1(principal);
}

function useAuthorityCaller(client) {
  const auth = client?.auth;
  const subscribe = useCallback(
    (listener) => (
      typeof auth?.subscribeCurrentPrincipal === 'function'
        ? auth.subscribeCurrentPrincipal(listener)
        : () => {}
    ),
    [auth],
  );
  const snapshot = useCallback(
    () => (
      typeof auth?.currentPrincipal === 'function'
        ? auth.currentPrincipal()
        : AUTHORITY_CALLER_UNKNOWN
    ),
    [auth],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function emptyAuthorityRosterPage(identity) {
  return {
    identity,
    rows: AUTHORITY_EMPTY_ROWS,
    cursor: null,
    loaded: false,
    loadingInitial: false,
    loadingMore: false,
    initialError: null,
    pageError: null,
  };
}

function abortableAuthorityPageQuery(client, reference, args, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(AUTHORITY_PAGE_TASK_ABORTED);
      return;
    }
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, AUTHORITY_PAGE_TASK_ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      Promise.resolve(client.query(reference, { args, signal })).then(
        (output) => finish(resolve, output),
        (error) => finish(reject, error),
      );
    } catch (error) {
      finish(reject, error);
    }
  });
}

function authorityPageOutput(output) {
  if (!Array.isArray(output?.rows)) {
    throw diagnosticError(
      'SNAPBACK_REACT_AUTHORITY_PAGE_INVALID',
      'authority roster query returned an invalid page',
    );
  }
  if (output.cursor !== undefined && output.cursor !== null && typeof output.cursor !== 'string') {
    throw diagnosticError(
      'SNAPBACK_REACT_AUTHORITY_PAGE_INVALID',
      'authority roster query returned an invalid continuation',
    );
  }
  return Object.freeze({
    rows: Object.freeze([...output.rows]),
    cursor: output.cursor ?? null,
  });
}

function authorityErrorCode(error) {
  return error?.diagnostic?.code ?? error?.code ?? null;
}

/**
 * Dedicated authority-roster projection over the canonical live query and
 * one-shot QueryOutput cursor carrier. The server owns cursor meaning; React
 * only retains the opaque token while scope, caller, and generation identity
 * remain unchanged.
 *
 * @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — generated
 * profile references remain the only authority API and the dedicated hook
 * adds lifecycle convenience without a parallel protocol.
 * @ref LLP 0238#d3-one-observable-handle-grammar — the live reference owns
 * authorization wakeups and query state; pagination adds controls to that
 * same projection.
 * @ref LLP 0053#client-fences — live publications synchronously advance the
 * request epoch; other accumulator replacements and unmount fence delayed
 * continuation callbacks through that same epoch.
 */
export function useSnapbackAuthorityRoster(profile, scopeId, options = {}) {
  const references = authorityProfileReferences(profile);
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('useSnapbackAuthorityRoster options must be an object');
  }
  const { limit } = options;
  if (
    limit !== undefined
    && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
  ) {
    throw new TypeError('authority roster limit must be an integer in 1..1000');
  }
  const client = useSnapbackProviderClient();
  const caller = useAuthorityCaller(client);
  const scopeKey = canonicalHookInputKey(scopeId);
  const firstArgs = useMemo(
    () => authorityRosterFirstArgs(scopeId, limit),
    [scopeKey, limit],
  );
  const firstArgsKey = canonicalFunctionArgsKey(references.list, firstArgs);
  const generationKey = authorityReferenceGenerationIdentity(references.list);
  const callerKey = authorityCallerKey(caller);
  const identity = `${generationKey}\u0000${scopeKey}\u0000${callerKey}`;
  const [page, setPage] = useState(() => emptyAuthorityRosterPage(identity));
  const [resetRevision, setResetRevision] = useState(0);
  const requestEpoch = useRef(0);
  const loadMoreTask = useRef(null);
  const mounted = useRef(false);
  const pendingPageTasks = useRef(new Set());

  const invalidateAccumulator = useCallback(() => {
    requestEpoch.current += 1;
    for (const controller of pendingPageTasks.current) controller.abort();
    pendingPageTasks.current.clear();
    loadMoreTask.current = null;
    return requestEpoch.current;
  }, []);
  const live = useSnapbackQueryProjection(
    references.list,
    firstArgs,
    invalidateAccumulator,
  );
  const identityRef = useRef(identity);
  const pageRef = useRef(page);
  identityRef.current = identity;
  pageRef.current = page.identity === identity ? page : emptyAuthorityRosterPage(identity);

  const publishAccumulator = useCallback((next) => {
    if (!mounted.current) return null;
    pageRef.current = next;
    setPage(next);
    return requestEpoch.current;
  }, []);

  const replaceAccumulator = useCallback((next) => {
    invalidateAccumulator();
    return publishAccumulator(next);
  }, [invalidateAccumulator, publishAccumulator]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidateAccumulator();
    };
  }, [invalidateAccumulator]);

  useEffect(() => {
    if (live.status === 'refreshing') {
      publishAccumulator({
        ...emptyAuthorityRosterPage(identity),
        rows: Object.freeze([...live.data]),
      });
      return undefined;
    }
    if (live.status !== 'ready') {
      publishAccumulator(emptyAuthorityRosterPage(identity));
      return undefined;
    }
    const epoch = publishAccumulator({
      ...emptyAuthorityRosterPage(identity),
      rows: Object.freeze([...live.data]),
      loadingInitial: true,
    });
    if (epoch === null) return undefined;
    const controller = new AbortController();
    pendingPageTasks.current.add(controller);
    void abortableAuthorityPageQuery(
      client,
      references.list,
      firstArgs,
      controller.signal,
    ).then((output) => {
      if (
        !mounted.current
        || controller.signal.aborted
        || requestEpoch.current !== epoch
        || identityRef.current !== identity
      ) {
        return;
      }
      const initial = authorityPageOutput(output);
      replaceAccumulator({
        ...emptyAuthorityRosterPage(identity),
        rows: initial.rows,
        cursor: initial.cursor,
        loaded: true,
      });
    }).catch((error) => {
      if (
        error === AUTHORITY_PAGE_TASK_ABORTED
        || !mounted.current
        || controller.signal.aborted
        || requestEpoch.current !== epoch
        || identityRef.current !== identity
      ) {
        return;
      }
      replaceAccumulator({
        ...emptyAuthorityRosterPage(identity),
        initialError: serializeError(error),
      });
    }).finally(() => {
      pendingPageTasks.current.delete(controller);
    });
    return () => {
      controller.abort();
      pendingPageTasks.current.delete(controller);
    };
  }, [
    client,
    references.list,
    firstArgsKey,
    identity,
    live,
    publishAccumulator,
    resetRevision,
  ]);

  const reset = useCallback(() => {
    if (!mounted.current) return;
    replaceAccumulator(emptyAuthorityRosterPage(identityRef.current));
    setResetRevision((revision) => revision + 1);
  }, [replaceAccumulator]);

  const loadMore = useCallback(() => {
    if (loadMoreTask.current !== null) return loadMoreTask.current;
    const capturedIdentity = identityRef.current;
    const current = pageRef.current;
    if (!current.loaded || current.cursor === null) {
      return Promise.resolve(Object.freeze({ status: 'complete' }));
    }
    const cursor = current.cursor;
    const epoch = replaceAccumulator({
      ...current,
      loadingMore: true,
      pageError: null,
    });
    if (epoch === null) {
      return Promise.resolve(Object.freeze({ status: 'reset', reason: 'identity-changed' }));
    }
    const controller = new AbortController();
    pendingPageTasks.current.add(controller);
    const task = abortableAuthorityPageQuery(
      client,
      references.list,
      authorityRosterNextArgs(scopeId, limit, cursor),
      controller.signal,
    ).then((output) => {
      if (
        !mounted.current
        || controller.signal.aborted
        || requestEpoch.current !== epoch
        || identityRef.current !== capturedIdentity
      ) {
        return Object.freeze({ status: 'reset', reason: 'identity-changed' });
      }
      const next = authorityPageOutput(output);
      const value = pageRef.current;
      if (value.identity !== capturedIdentity) {
        return Object.freeze({ status: 'reset', reason: 'identity-changed' });
      }
      replaceAccumulator({
        ...value,
        rows: Object.freeze([...value.rows, ...next.rows]),
        cursor: next.cursor,
        loadingMore: false,
        pageError: null,
      });
      return Object.freeze({
        status: 'appended',
        rows: next.rows.length,
        cursor: next.cursor,
        hasMore: next.cursor !== null,
      });
    }).catch((error) => {
      if (
        error === AUTHORITY_PAGE_TASK_ABORTED
        || !mounted.current
        || controller.signal.aborted
        || requestEpoch.current !== epoch
        || identityRef.current !== capturedIdentity
      ) {
        return Object.freeze({ status: 'reset', reason: 'identity-changed' });
      }
      if (authorityErrorCode(error) === AUTHORITY_CURSOR_INVALID) {
        reset();
        return Object.freeze({ status: 'reset', reason: 'cursor-invalid' });
      }
      const value = pageRef.current;
      if (value.identity !== capturedIdentity) {
        return Object.freeze({ status: 'reset', reason: 'identity-changed' });
      }
      replaceAccumulator({
        ...value,
        loadingMore: false,
        pageError: serializeError(error),
      });
      throw error;
    }).finally(() => {
      pendingPageTasks.current.delete(controller);
      if (loadMoreTask.current === task) loadMoreTask.current = null;
    });
    loadMoreTask.current = task;
    return task;
  }, [client, references.list, scopeKey, limit, replaceAccumulator, reset]);

  const currentPage = page.identity === identity ? page : emptyAuthorityRosterPage(identity);
  return useMemo(() => {
    const controls = {
      cursor: currentPage.cursor,
      hasMore: currentPage.cursor !== null,
      loadingInitial: currentPage.loadingInitial,
      loadingMore: currentPage.loadingMore,
      pageError: currentPage.pageError,
      loadMore,
      reset,
    };
    if (currentPage.initialError !== null) {
      return Object.freeze({
        status: 'error',
        data: undefined,
        error: currentPage.initialError,
        connection: live.connection,
        freshness: 'unknown',
        answerClass: 'unknown',
        retention: live.retention,
        optimisticPresentation: null,
        ...controls,
      });
    }
    if (!['ready', 'refreshing'].includes(live.status)) {
      return Object.freeze({ ...live, ...controls });
    }
    return Object.freeze({
      ...live,
      data: currentPage.loaded ? currentPage.rows : live.data,
      ...controls,
    });
  }, [currentPage, live, loadMore, reset]);
}

/** The caller's generated role/status row, projected as one nullable value. */
export function useSnapbackAuthorityMyRole(profile, scopeId) {
  const references = authorityProfileReferences(profile);
  const state = useSnapbackQuery(references.myRole, { scopeId });
  return useMemo(() => {
    if (!['ready', 'refreshing'].includes(state.status)) return state;
    return Object.freeze({ ...state, data: state.data[0] ?? null });
  }, [state]);
}

/** Authority mutation dispatch with post-commit transition receipts retained. */
export function useSnapbackAuthorityMutation(reference) {
  const provider = useProvider();
  const admitted = useMemo(
    () => provider.registry.mutationReference(reference),
    [provider, reference],
  );
  return useCallback(async (args) => {
    try {
      return await provider.registry.runMutation(
        admitted,
        args,
        null,
        { authorityTransitions: true },
      );
    } catch (error) {
      throw asSnapbackDiagnosticError(error, {
        operation: 'authority-mutation',
        refKind: 'Mutation',
        fallbackCode: 'SNAPBACK_AUTHORITY_MUTATION_REFUSED',
      });
    }
  }, [provider, admitted]);
}

function projectAuthorityMutationDisposition(disposition) {
  if (disposition?.status !== 'settled') return disposition;
  return Object.freeze({
    ...disposition,
    settlement: Object.freeze({
      ...disposition.settlement,
      authorityTransitions: Object.freeze([
        ...(disposition.settlement?.authorityTransitions ?? []),
      ]),
    }),
  });
}

/** Live durable settlement/refusal projection for a queued authority intent. */
export function useSnapbackAuthorityMutationStatus(clientMutationId) {
  const client = useSnapbackProviderClient();
  if (
    clientMutationId !== null
    && clientMutationId !== undefined
    && (typeof clientMutationId !== 'string' || clientMutationId.length === 0)
  ) {
    throw new TypeError('authority mutation status requires a non-empty mutation id');
  }
  if (
    clientMutationId !== null
    && clientMutationId !== undefined
    && typeof client.subscribeMutation !== 'function'
  ) {
    throw asSnapbackDiagnosticError(
      diagnosticError(
        'SNAPBACK_REACT_OUTBOX_AFFORDANCE_UNSUPPORTED',
        'the bound client does not expose subscribeMutation',
      ),
      { operation: 'authority-mutation-status' },
    );
  }
  const store = useMemo(() => {
    let snapshot = AUTHORITY_MUTATION_UNKNOWN;
    return Object.freeze({
      getSnapshot: () => snapshot,
      subscribe(listener) {
        if (clientMutationId === null || clientMutationId === undefined) return () => {};
        return client.subscribeMutation(clientMutationId, (disposition) => {
          snapshot = projectAuthorityMutationDisposition(disposition);
          listener();
        });
      },
    });
  }, [client, clientMutationId]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useSnapbackPresence(reference, options) {
  const provider = useProvider();
  if (!options || typeof options !== 'object') {
    throw new TypeError('useSnapbackPresence requires scope and value options');
  }
  const tokenRef = useRef(null);
  if (tokenRef.current === null) tokenRef.current = provider.registry.createPresenceToken();
  const token = tokenRef.current;
  const churnDetectorRef = useRef(HOOK_CHURN_UNINITIALIZED);
  if (churnDetectorRef.current === HOOK_CHURN_UNINITIALIZED) {
    churnDetectorRef.current = createHookChurnDetector(provider, 'presence');
  }
  const scopeKey = canonicalContractInputKey(reference.scopeContract, options.scope, 'scope');
  const valueKey = canonicalContractInputKey(reference.valueContract, options.value, 'value');
  const descriptor = useMemo(
    () => provider.registry.presenceDescriptor(
      reference,
      options.scope,
      options.value,
      options.ttlMs,
    ),
    [provider, reference, scopeKey, valueKey, options.ttlMs],
  );
  const subscribe = useCallback((listener) => {
    const lease = provider.registry.subscribePresence(descriptor, token, listener);
    recordCommittedHookDescriptor(churnDetectorRef.current, {
      primaryIdentity: descriptor.key,
      secondaryIdentity: valueKey,
      referenceName: descriptor.definition?.reference?.name
        ?? reference?.name
        ?? '<unknown presence>',
    });
    return () => lease.release();
  }, [provider, descriptor, token, valueKey]);
  return useSyncExternalStore(
    subscribe,
    () => provider.registry.presenceSnapshot(descriptor, token),
    () => provider.registry.presenceSnapshot(descriptor, token),
  );
}

function activityPresenceDiagnostic(code, message, details = {}) {
  return diagnostic(code, message, details);
}

function assertActivityPresenceIdleMs(idleMs) {
  if (
    !Number.isSafeInteger(idleMs)
    || idleMs < ACTIVITY_IDLE_MIN_MS
    || idleMs > ACTIVITY_IDLE_MAX_MS
  ) {
    const value = activityPresenceDiagnostic(
      'SNAPBACK_REACT_ACTIVITY_IDLE_MS_INVALID',
      'activity presence idleMs must be a safe integer from 250ms through 2147483647ms',
      {
        idleMs,
        minIdleMs: ACTIVITY_IDLE_MIN_MS,
        maxIdleMs: ACTIVITY_IDLE_MAX_MS,
      },
    );
    throw new SnapbackDiagnosticError(value, {
      operation: 'activity-presence',
      refKind: 'ephemeralCollection',
    });
  }
}

function activityThunkDiagnostic(error) {
  const cause = serializeError(error);
  return activityPresenceDiagnostic(
    'SNAPBACK_REACT_ACTIVITY_VALUE_FAILED',
    'activity presence value thunk failed',
    {
      causeCode: cause.code,
      causeMessage: cause.message,
    },
  );
}

/**
 * Activity-scoped projection over the canonical observer-mode presence hook.
 * The third argument is an intentionally untyped package-private seam used by
 * the Expo facade to gate admission while its lifecycle source is resolving.
 */
export function useSnapbackActivityPresence(reference, options, internalOptions = null) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'useSnapbackActivityPresence requires scope, value, and idleMs options',
    );
  }
  if (typeof options.value !== 'function') {
    throw new TypeError('useSnapbackActivityPresence value must be a function');
  }
  if (options.onError !== undefined && typeof options.onError !== 'function') {
    throw new TypeError('useSnapbackActivityPresence onError must be a function');
  }
  if (options.excludeSelf !== undefined && typeof options.excludeSelf !== 'boolean') {
    throw new TypeError('useSnapbackActivityPresence excludeSelf must be a boolean');
  }
  // @ref LLP 0257#design — invalid idle configuration is an unconditional,
  // typed render-time refusal, outside the constructed hook's error algebra.
  assertActivityPresenceIdleMs(options.idleMs);

  const provider = useProvider();
  const presence = useSnapbackPresence(reference, {
    scope: options.scope,
    value: skip,
  });
  const scopeKey = canonicalContractInputKey(reference.scopeContract, options.scope, 'scope');
  const sessionEpoch = readActivityPresenceSessionEpoch(provider);
  const lifecycleGated = internalOptions?.[ACTIVITY_PRESENCE_INTERNAL]?.gated === true;
  const [, forceRender] = useState(0);
  const activityRef = useRef(null);
  if (activityRef.current === null) {
    activityRef.current = {
      provider,
      reference,
      scopeKey,
      sessionEpoch,
      generation: 0,
      episodeEpoch: 0,
      active: false,
      deadlineMs: null,
      captured: ACTIVITY_CAPTURE_EMPTY,
      queuedCaptured: ACTIVITY_CAPTURE_EMPTY,
      publishInFlight: null,
      deferredWithdrawalGeneration: null,
      timer: null,
      mounted: false,
      disposed: false,
      mountEpoch: 0,
      lastError: null,
      lastPublisherError: null,
      lifecycle: lifecycleGated ? 'pending' : 'active',
      lifecycleGated,
      latest: null,
      internal: null,
    };
  }
  const activity = activityRef.current;
  activity.latest = {
    idleMs: options.idleMs,
    onError: options.onError,
    presence,
    ttlMs: options.ttlMs,
    value: options.value,
  };

  const clearActivityTimer = useCallback(() => {
    if (activity.timer !== null) clearTimeout(activity.timer);
    activity.timer = null;
  }, [activity]);

  const notifyActivity = useCallback(() => {
    if (!activity.mounted || activity.disposed) return;
    forceRender((revision) => revision + 1);
  }, [activity]);

  const reportActivityError = useCallback((value) => {
    const projected = value?.schemaVersion === 'snapback.client-diagnostic.v1'
      ? value
      : serializeError(value);
    activity.lastError = projected;
    notifyActivity();
    try { activity.latest.onError?.(projected); } catch { /* observational */ }
  }, [activity, notifyActivity]);

  const attemptActivityWithdrawal = useCallback((generation, {
    clearErrorOnSuccess = true,
  } = {}) => {
    let task;
    try {
      task = activity.latest.presence.delete();
    } catch (error) {
      reportActivityError(error);
      return Promise.resolve();
    }
    // @ref LLP 0257#result-and-error-surface — attach both settlement arms
    // immediately: base withdrawal rejection is otherwise absent from the
    // level-triggered publisher state.
    return Promise.resolve(task).then(
      () => {
        if (
          clearErrorOnSuccess
          && activity.generation === generation
          && activity.lifecycle !== 'failed'
          && activity.lastError !== null
        ) {
          activity.lastError = null;
          notifyActivity();
        }
      },
      (error) => {
        reportActivityError(error);
      },
    ).then(() => undefined);
  }, [activity, notifyActivity, reportActivityError]);

  const discardQueuedActivityPublish = useCallback(() => {
    // @ref LLP 0310.000#ruling-3--one-typing-episode-is-one-presence-generation
    // — idle expiry does not advance the activity generation, so the distinct
    // episode epoch is the load-bearing fence for queued coalesced values.
    activity.episodeEpoch += 1;
    activity.queuedCaptured = ACTIVITY_CAPTURE_EMPTY;
    activity.publishInFlight = null;
  }, [activity]);

  const expireActivity = useCallback((generation, deadlineMs, {
    notify = true,
    deferWithdrawal = false,
  } = {}) => {
    if (
      activity.disposed
      || !activity.mounted
      || !activity.active
      || activity.generation !== generation
      || activity.deadlineMs !== deadlineMs
    ) return false;
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs > 0) return false;
    if (!deferWithdrawal) clearActivityTimer();
    discardQueuedActivityPublish();
    activity.active = false;
    activity.deadlineMs = null;
    activity.captured = ACTIVITY_CAPTURE_EMPTY;
    if (notify) notifyActivity();
    if (deferWithdrawal) activity.deferredWithdrawalGeneration = generation;
    else void attemptActivityWithdrawal(generation);
    return true;
  }, [
    activity,
    attemptActivityWithdrawal,
    clearActivityTimer,
    discardQueuedActivityPublish,
    notifyActivity,
  ]);

  const scheduleActivityDeadline = useCallback((generation, deadlineMs) => {
    clearActivityTimer();
    const schedule = () => {
      if (
        activity.disposed
        || !activity.mounted
        || !activity.active
        || activity.generation !== generation
        || activity.deadlineMs !== deadlineMs
      ) return;
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) {
        expireActivity(generation, deadlineMs);
        return;
      }
      // @ref LLP 0257#activity-model-absolute-deadline-plus-generation-fence
      // — a stale or late timer must prove both the activity generation and
      // the absolute deadline before withdrawing.
      activity.timer = setTimeout(schedule, remainingMs);
      activity.timer.unref?.();
    };
    schedule();
  }, [activity, clearActivityTimer, expireActivity]);

  const admitCapturedActivity = useCallback((
    generation,
    captured,
    episodeEpoch = activity.episodeEpoch,
  ) => {
    if (
      activity.disposed
      || !activity.mounted
      || activity.lifecycle !== 'active'
      || !activity.active
      || activity.generation !== generation
      || activity.episodeEpoch !== episodeEpoch
      || readActivityPresenceSessionEpoch(provider) !== activity.sessionEpoch
      || activity.captured !== captured
    ) return;
    const deadlineMs = activity.deadlineMs;
    if (deadlineMs === null || deadlineMs <= Date.now()) {
      expireActivity(generation, deadlineMs);
      return;
    }
    if (activity.publishInFlight !== null) {
      activity.queuedCaptured = captured;
      return;
    }
    const admittedSessionEpoch = activity.sessionEpoch;
    const flight = Object.freeze({ generation, episodeEpoch, admittedSessionEpoch });
    activity.publishInFlight = flight;
    let task;
    try {
      task = activity.latest.presence.publish(
        captured,
        activity.latest.ttlMs === undefined
          ? undefined
          : { ttlMs: activity.latest.ttlMs },
      );
    } catch (error) {
      if (activity.publishInFlight === flight) activity.publishInFlight = null;
      reportActivityError(error);
      return;
    }
    // Admission executes synchronously inside the async base action. Install
    // the rejection handler in this same call stack so its already-rejected
    // promise can never become an unhandled rejection.
    const settle = () => {
      if (activity.publishInFlight !== flight) return;
      activity.publishInFlight = null;
      if (
        activity.disposed
        || !activity.mounted
        || !activity.active
        || activity.generation !== generation
        || activity.episodeEpoch !== episodeEpoch
        || readActivityPresenceSessionEpoch(provider) !== admittedSessionEpoch
      ) return;
      const queuedCaptured = activity.queuedCaptured;
      activity.queuedCaptured = ACTIVITY_CAPTURE_EMPTY;
      if (queuedCaptured !== ACTIVITY_CAPTURE_EMPTY) {
        // Coalesce to the latest captured value, but only after this episode's
        // predecessor publish has settled. The base publisher sees the same
        // activity generation throughout the episode.
        activity.admitCapturedActivity(generation, queuedCaptured, episodeEpoch);
      }
    };
    void Promise.resolve(task).then(
      () => {
        if (
          activity.generation === generation
          && activity.episodeEpoch === episodeEpoch
          && readActivityPresenceSessionEpoch(provider) === admittedSessionEpoch
          && activity.lastError !== null
        ) {
          activity.lastError = null;
          notifyActivity();
        }
        settle();
      },
      (error) => {
        reportActivityError(error);
        settle();
      },
    );
  }, [activity, expireActivity, notifyActivity, provider, reportActivityError]);

  const withdraw = useCallback(() => {
    if (activity.disposed || !activity.mounted) return Promise.resolve();
    clearActivityTimer();
    activity.generation += 1;
    const generation = activity.generation;
    discardQueuedActivityPublish();
    activity.active = false;
    activity.deadlineMs = null;
    activity.captured = ACTIVITY_CAPTURE_EMPTY;
    activity.deferredWithdrawalGeneration = null;
    notifyActivity();
    return attemptActivityWithdrawal(generation);
  }, [
    activity,
    attemptActivityWithdrawal,
    clearActivityTimer,
    discardQueuedActivityPublish,
    notifyActivity,
  ]);

  const touch = useCallback(() => {
    if (
      activity.disposed
      || !activity.mounted
      || activity.lifecycle === 'failed'
      || activity.lifecycle === 'inactive'
    ) return;
    const currentSessionEpoch = readActivityPresenceSessionEpoch(provider);
    if (activity.sessionEpoch !== currentSessionEpoch) {
      // Auth-barrier quiescence is the session boundary even if React has not
      // rendered the provider notification yet. Start any concurrent touch as
      // a successor episode; never let it flush predecessor queued work.
      clearActivityTimer();
      activity.sessionEpoch = currentSessionEpoch;
      activity.generation += 1;
      discardQueuedActivityPublish();
      activity.active = false;
      activity.deadlineMs = null;
      activity.captured = ACTIVITY_CAPTURE_EMPTY;
      activity.deferredWithdrawalGeneration = null;
      // Do not episode-fence this delete. It synchronously relinquishes the
      // predecessor base intent; LLP 0247's authority pair fences wire cleanup.
      void attemptActivityWithdrawal(activity.generation);
    }
    const now = Date.now();
    if (
      activity.active
      && activity.deadlineMs !== null
      && activity.deadlineMs <= now
    ) {
      const expiredGeneration = activity.generation;
      clearActivityTimer();
      discardQueuedActivityPublish();
      activity.active = false;
      activity.deadlineMs = null;
      activity.captured = ACTIVITY_CAPTURE_EMPTY;
      activity.deferredWithdrawalGeneration = null;
      // Clear the predecessor intent synchronously before admitting a new
      // generation. LLP 0247 D3 fences the in-flight wire withdrawal.
      void attemptActivityWithdrawal(expiredGeneration);
    }

    let captured;
    try {
      captured = activity.latest.value();
    } catch (error) {
      reportActivityError(activityThunkDiagnostic(error));
      return;
    }
    if (!activity.active) {
      activity.generation += 1;
      activity.episodeEpoch += 1;
    }
    const generation = activity.generation;
    const episodeEpoch = activity.episodeEpoch;
    const deadlineMs = now + activity.latest.idleMs;
    activity.active = true;
    activity.deadlineMs = deadlineMs;
    activity.captured = captured;
    activity.deferredWithdrawalGeneration = null;
    scheduleActivityDeadline(generation, deadlineMs);
    notifyActivity();
    if (activity.lifecycle === 'active') {
      admitCapturedActivity(generation, captured, episodeEpoch);
    }
  }, [
    activity,
    admitCapturedActivity,
    attemptActivityWithdrawal,
    clearActivityTimer,
    discardQueuedActivityPublish,
    notifyActivity,
    provider,
    reportActivityError,
    scheduleActivityDeadline,
  ]);

  activity.admitCapturedActivity = admitCapturedActivity;
  activity.attemptActivityWithdrawal = attemptActivityWithdrawal;
  activity.clearActivityTimer = clearActivityTimer;
  activity.expireActivity = expireActivity;
  activity.notifyActivity = notifyActivity;
  activity.withdraw = withdraw;

  if (activity.internal === null) {
    activity.internal = Object.freeze({
      setLifecycleActive(active) {
        if (activity.disposed || !activity.mounted || activity.lifecycle === 'failed') return;
        if (active !== true) {
          activity.lifecycle = 'inactive';
          void activity.withdraw();
          return;
        }
        activity.lifecycle = 'active';
        if (!activity.active) {
          activity.notifyActivity();
          return;
        }
        const generation = activity.generation;
        const deadlineMs = activity.deadlineMs;
        const captured = activity.captured;
        if (deadlineMs === null || deadlineMs <= Date.now()) {
          activity.expireActivity(generation, deadlineMs);
          return;
        }
        if (captured !== ACTIVITY_CAPTURE_EMPTY) {
          // @ref LLP 0257#expo-backgrounding-and-resume — deferred Expo
          // admission uses the value captured by touch(), never the current
          // thunk or a re-evaluation during lifecycle resolution.
          activity.admitCapturedActivity(generation, captured);
        }
        activity.notifyActivity();
      },
      failLifecycle(diagnosticValue) {
        if (activity.disposed || activity.lifecycle === 'failed') return;
        activity.lifecycle = 'failed';
        activity.clearActivityTimer();
        activity.generation += 1;
        const generation = activity.generation;
        discardQueuedActivityPublish();
        activity.active = false;
        activity.deadlineMs = null;
        activity.captured = ACTIVITY_CAPTURE_EMPTY;
        activity.deferredWithdrawalGeneration = null;
        reportActivityError(diagnosticValue);
        void activity.attemptActivityWithdrawal(generation, {
          clearErrorOnSuccess: false,
        });
      },
    });
  }

  const routingBoundary = activity.provider !== provider
    || activity.reference !== reference
    || activity.scopeKey !== scopeKey;
  const sessionBoundary = activity.sessionEpoch !== sessionEpoch;
  if (routingBoundary || sessionBoundary) {
    // @ref LLP 0257#scope-identity-and-scope-change — activity never migrates
    // with the base token into a successor room; the old base lease owns its
    // fenced withdrawal and the new room starts locally withdrawn.
    clearActivityTimer();
    activity.provider = provider;
    activity.reference = reference;
    activity.scopeKey = scopeKey;
    activity.sessionEpoch = sessionEpoch;
    activity.generation += 1;
    discardQueuedActivityPublish();
    activity.active = false;
    activity.deadlineMs = null;
    activity.captured = ACTIVITY_CAPTURE_EMPTY;
    // Scope/provider replacement releases the predecessor base token itself.
    // A same-room session cut retains that token, so passive work must clear
    // its desired intent without performing a render-time side effect.
    activity.deferredWithdrawalGeneration = sessionBoundary && !routingBoundary
      ? activity.generation
      : null;
    activity.lastError = null;
    activity.lastPublisherError = null;
  }

  // Render-time absolute-deadline backstop. The synchronous local transition
  // prevents stale activity presentation; the base delete is generation- and
  // entry-version-fenced if a successor touch wins before the passive action.
  if (
    activity.active
    && activity.deadlineMs !== null
    && activity.deadlineMs <= Date.now()
  ) {
    const generation = activity.generation;
    const deadlineMs = activity.deadlineMs;
    expireActivity(generation, deadlineMs, {
      notify: false,
      deferWithdrawal: true,
    });
  }

  useEffect(() => {
    activity.disposed = false;
    activity.mounted = true;
    const mountedEpoch = ++activity.mountEpoch;
    if (activity.active && activity.deadlineMs !== null && activity.timer === null) {
      scheduleActivityDeadline(activity.generation, activity.deadlineMs);
    }
    return () => {
      activity.mounted = false;
      clearActivityTimer();
      const cleanupEpoch = ++activity.mountEpoch;
      queueMicrotask(() => {
        if (
          activity.mounted
          || activity.mountEpoch !== cleanupEpoch
          || mountedEpoch >= cleanupEpoch
        ) return;
        activity.disposed = true;
        activity.generation += 1;
        const generation = activity.generation;
        discardQueuedActivityPublish();
        activity.active = false;
        activity.deadlineMs = null;
        activity.captured = ACTIVITY_CAPTURE_EMPTY;
        activity.deferredWithdrawalGeneration = null;
        void attemptActivityWithdrawal(generation);
      });
    };
  }, [
    activity,
    attemptActivityWithdrawal,
    clearActivityTimer,
    discardQueuedActivityPublish,
    scheduleActivityDeadline,
  ]);

  useEffect(() => {
    const generation = activity.deferredWithdrawalGeneration;
    if (generation === null) return;
    activity.deferredWithdrawalGeneration = null;
    if (activity.generation === generation && !activity.active) {
      // Render owns the synchronous deadline backstop; passive work performs
      // the fenced base action so rendering itself stays side-effect free.
      void attemptActivityWithdrawal(generation);
    }
  });

  useEffect(() => {
    if (activity.active && activity.deadlineMs !== null) {
      if (!expireActivity(activity.generation, activity.deadlineMs) && activity.timer === null) {
        scheduleActivityDeadline(activity.generation, activity.deadlineMs);
      }
    }
  }, [
    activity,
    expireActivity,
    presence.connection,
    presence.publisher.status,
    presence.status,
    scheduleActivityDeadline,
  ]);

  useEffect(() => {
    if (presence.publisher.status !== 'publish-error') {
      activity.lastPublisherError = null;
      return;
    }
    const publisherDiagnostic = presence.publisher.diagnostic;
    if (activity.lastPublisherError === publisherDiagnostic) return;
    activity.lastPublisherError = publisherDiagnostic;
    // @ref LLP 0257#result-and-error-surface — transport failures are
    // level-triggered; report each distinct publisher transition React
    // actually observes, without claiming wire-occurrence cardinality.
    reportActivityError(publisherDiagnostic);
  }, [activity, presence.publisher, reportActivityError]);

  const peers = useMemo(() => Object.freeze(
    options.excludeSelf === false || presence.selfKey === null
      ? [...presence.entries]
      : presence.entries.filter((entry) => entry.key !== presence.selfKey),
  ), [options.excludeSelf, presence.entries, presence.selfKey]);

  const result = {
    status: presence.status,
    active: activity.active,
    touch,
    withdraw,
    peers,
    publisher: presence.publisher,
    connection: presence.connection,
    diagnostic: presence.diagnostic,
    lastError: activity.lastError,
  };
  Object.defineProperty(result, ACTIVITY_PRESENCE_INTERNAL, {
    value: activity.internal,
    enumerable: false,
  });
  return Object.freeze(result);
}

function validateEntries(provider, entries) {
  const suppliedGroup = isPreparedReactQueryGroup(entries) ? entries : null;
  if (suppliedGroup !== null) {
    // Provider construction may deliberately convert a just-expired
    // registered boot into a visible live-recovery group. Consumers keep the
    // original one-shot capability, so descriptor creation must use the
    // provider-owned effective group rather than resurrecting expired rows.
    const providerGroup = preparedGroupForProvider(provider);
    const preparedGroup = providerGroup?.reference?.id === suppliedGroup.reference?.id
      ? providerGroup
      : suppliedGroup;
    const admitted = admittedReactQueryGroup(provider.binding, preparedGroup.reference);
    if (
      admitted.id !== preparedGroup.reference.id
      || (
        preparedGroup.connectionId !== null
        && provider.registry.connectionId !== preparedGroup.connectionId
      )
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_GROUP_CONNECTION_MISMATCH',
        'prepared query group belongs to a different provider connection',
        { groupId: admitted.id },
      );
    }
    return Object.freeze(preparedGroup.entries.map((entry) => Object.freeze({
      name: entry.name,
      ...provider.registry.descriptor(
        entry.ref,
        entry.args,
        preparedGroup.boot,
        entry.name,
      ),
    })));
  }
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new TypeError('useSnapbackQueries requires an object map');
  }
  const descriptors = Object.keys(entries).sort().map((name) => {
    if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(name)) {
      throw new TypeError(`invalid query-group entry name ${name}`);
    }
    const entry = entries[name];
    return Object.freeze({
      name,
      ...provider.registry.descriptor(entry?.ref, entry?.args ?? {}, null),
    });
  });
  provider.registry.warnSubscriptionBudget(descriptors.length);
  if (descriptors.length < 1 || descriptors.length > 64) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_CAPACITY',
      'query groups contain 1 through 64 entries',
      { entries: descriptors.length },
    );
  }
  return Object.freeze(descriptors);
}

function groupSnapshot(provider, descriptors) {
  const queries = {};
  for (const descriptor of descriptors) {
    queries[descriptor.name] = provider.registry.snapshot(descriptor);
  }
  Object.freeze(queries);
  const active = descriptors
    .filter((descriptor) => !descriptor.skipped)
    .map((descriptor) => queries[descriptor.name]);
  const firstError = descriptors
    .filter((descriptor) => queries[descriptor.name].status === 'error')
    .map((descriptor) => queries[descriptor.name].error)[0] ?? null;
  const status = active.some((query) => query.status === 'error')
    ? 'error'
    : active.some((query) => query.status === 'blocked')
      ? 'blocked'
      : active.some((query) => query.status === 'pending')
        ? 'pending'
        : active.some((query) => query.status === 'refreshing')
          ? 'refreshing'
          : 'ready';
  const preparedGroup = descriptors.length > 0
    && descriptors.every((descriptor) => descriptor.preparedEntryName !== null)
    ? preparedGroupForProvider(provider)
    : null;
  const boot = preparedGroup !== null
    ? preparedGroup.boot
    : descriptors.length > 0
      && descriptors.every((descriptor) => descriptor.groupBoot !== null)
      && descriptors.every(
        (descriptor) => descriptor.groupBoot === descriptors[0].groupBoot,
      )
      ? descriptors[0].groupBoot
      : null;
  return Object.freeze({
    queries,
    status,
    connection: descriptors.some((descriptor) => descriptor.readOnlySnapshot !== null)
      ? 'idle'
      : weakConnection(active.map((query) => query.connection)),
    error: firstError,
    boot,
  });
}

export function useSnapbackQueries(entries) {
  const provider = useProvider();
  const descriptors = useMemo(() => validateEntries(provider, entries), [provider, entries]);
  const lease = useRef(null);
  const lastSnapshot = useRef(null);
  const subscribe = useCallback((listener) => {
    const next = provider.registry.subscribeMany(descriptors, listener, lease.current);
    lease.current = next;
    return () => {
      const releasing = next;
      queueMicrotask(() => {
        if (lease.current === releasing) lease.current = null;
        releasing.release();
      });
    };
  }, [provider, descriptors]);
  const read = useCallback(() => {
    const next = groupSnapshot(provider, descriptors);
    const previous = lastSnapshot.current;
    if (
      previous
      && previous.status === next.status
      && previous.connection === next.connection
      && previous.error === next.error
      && previous.boot === next.boot
      && Object.keys(previous.queries).length === descriptors.length
      && descriptors.every(({ name }) => previous.queries[name] === next.queries[name])
    ) return previous;
    lastSnapshot.current = next;
    return next;
  }, [provider, descriptors]);
  return useSyncExternalStore(subscribe, read, read);
}

const RECORD_FIELD_PROJECTION = Symbol('snapback.react.recordFieldProjection');

// @ref LLP 0107#replay-safety-affordances — declarative capture-and-set
// projection over the records result shape: one declaration derives an
// idempotent update and a complete-receipt matcher, so the paved toggle
// recipe cannot express the replay hazard or the partial-receipt dip.
export function projectRecordFields(recordId, fields, { idField = '_id' } = {}) {
  const refuse = (message) => { throw new TypeError(`projectRecordFields ${message}`); };
  if (typeof recordId !== 'string' || recordId.length === 0) {
    refuse('requires a non-empty string record id');
  }
  if (typeof idField !== 'string' || idField.length === 0) {
    refuse('requires a non-empty string idField');
  }
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    refuse('requires an object of intended field values');
  }
  const names = Object.keys(fields);
  if (names.length === 0) {
    refuse('requires at least one intended field');
  }
  if (names.includes(idField)) {
    refuse('must not project the id field it matches rows by');
  }
  for (const name of names) {
    const value = fields[name];
    if (value !== null && !['boolean', 'number', 'string'].includes(typeof value)) {
      refuse(`field "${name}" must be a primitive intended outcome`);
    }
  }
  const intended = Object.freeze({ ...fields });
  const matches = (row) => row?.[idField] === recordId;
  const isAuthoritative = (rows, receipt) => Array.isArray(rows) && rows.some((row) => {
    if (!matches(row)) return false;
    return names.every((name) => {
      const expected = receipt !== null && typeof receipt === 'object' && Object.hasOwn(receipt, name)
        ? receipt[name]
        : intended[name];
      return row[name] === expected;
    });
  });
  Object.defineProperty(isAuthoritative, RECORD_FIELD_PROJECTION, {
    value: Object.freeze({ recordId, idField }),
    writable: false,
    enumerable: false,
  });
  return Object.freeze({
    update: (rows) => {
      if (!Array.isArray(rows)) {
        refuse('projects over a records query result');
      }
      return rows.map((row) => (matches(row) ? { ...row, ...intended } : row));
    },
    isAuthoritative,
  });
}

export function useSnapbackMutation(reference, options = {}) {
  const provider = useProvider();
  // Registry-owned admission: in a positively identified development/HMR
  // environment a regenerated same-app reference defers to the generation
  // handoff instead of throwing through the render tree; runMutation
  // re-admits at call time.
  const admitted = useMemo(
    () => provider.registry.mutationReference(reference),
    [provider, reference],
  );
  const optimistic = options?.optimistic ?? null;
  const queue = options?.queue;
  return useCallback(
    (args) => provider.registry.runMutation(admitted, args, optimistic, { queue }),
    [provider, admitted, optimistic, queue],
  );
}

/** Explicit connectivity-required mutation surface retaining the historical
 * bare validated-result resolution. */
export function useSnapbackSettledMutation(reference, options = {}) {
  return useSnapbackMutation(reference, { ...options, queue: false });
}

const selectOptimisticCreateState = (state, select) => {
  if (!['ready', 'refreshing'].includes(state.status) || typeof select !== 'function') return state;
  return Object.freeze({ ...state, data: deepFreeze(select(state.data)) });
};

/** Provider-owned generated-IR optimistic create over the exact canonical
 * query store identified by `query` + `args`. The returned query data uses a
 * canonical/provisional entity union; provisional identity is durable intent
 * identity and never the evaluator's speculative row mint. */
export function useSnapbackOptimisticCreate(reference, options) {
  const provider = useProvider();
  if (!options || typeof options !== 'object' || options.query == null) {
    throw new TypeError('useSnapbackOptimisticCreate requires query and args options');
  }
  const lease = useRef(null);
  const argsKey = canonicalFunctionArgsKey(options.query, options.args);
  const descriptor = useMemo(
    () => provider.registry.descriptor(options.query, options.args),
    [provider, options.query, argsKey],
  );
  const subscribe = useCallback((listener) => {
    const next = provider.registry.subscribeOptimisticCreate(
      descriptor,
      listener,
      lease.current,
    );
    lease.current = next;
    return () => {
      const releasing = next;
      queueMicrotask(() => {
        if (lease.current === releasing) lease.current = null;
        releasing.release();
      });
    };
  }, [provider, descriptor]);
  const state = useSyncExternalStore(
    subscribe,
    () => provider.registry.optimisticCreateSnapshot(descriptor),
    () => SERVER_PENDING,
  );
  const selected = useMemo(
    () => selectOptimisticCreateState(state, options.select),
    [state, options.select],
  );
  const create = useCallback(
    (args) => provider.registry.runOptimisticCreate(reference, args, descriptor),
    [provider, reference, descriptor],
  );
  return useMemo(() => Object.freeze({ query: selected, create }), [selected, create]);
}

// @ref LLP 0180#react-and-surface-projections — the hook is a named
// projection of the same provider-owned asset and mutation children used by
// surfaces. It owns no command transport or authority lane of its own.
export function useSnapbackCommand(reference) {
  const provider = useProvider();
  const admitted = useMemo(
    () => admittedReactCommand(provider.binding, reference),
    [provider, reference],
  );
  return useCallback(
    (args) => commandClientFor(provider).start(admitted, args),
    [provider, admitted],
  );
}

export function useSnapbackConnection() {
  const provider = useProvider();
  return useSyncExternalStore(
    provider.registry.subscribeConnection,
    provider.registry.aggregateConnection,
    provider.registry.aggregateConnection,
  );
}

/// Register the mounted component as an active producer for one ephemeral
/// collection. React owns disposal with the component lifecycle; the headless
/// client owns authority replacement, empty-snapshot, acknowledgement, and
/// generation fencing.
export function useEphemeralRepublisher(reference, callback) {
  const provider = useProvider();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    const registration = provider.registerEphemeralRepublisher(
      reference,
      (context) => callbackRef.current(context),
    );
    return () => registration.dispose();
  }, [provider, reference]);
}

/**
 * Framework-neutral harness for acceptance adapters. Applications should use
 * useSnapbackQueries; this seam lets packed starters and backend receipts
 * exercise the exact same provider registry without manufacturing a React
 * renderer around non-UI acceptance code.
 */
export function observeSnapbackQueries(providerValue, entries, listener) {
  const provider = assertProvider(providerValue);
  let descriptors = validateEntries(provider, entries);
  let lease = null;
  let closed = false;
  const emit = () => {
    if (!closed) listener(groupSnapshot(provider, descriptors));
  };
  lease = provider.registry.subscribeMany(descriptors, emit);
  emit();
  return Object.freeze({
    update(nextEntries) {
      if (closed) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'query observer is closed');
      const nextDescriptors = validateEntries(provider, nextEntries);
      const nextLease = provider.registry.subscribeMany(nextDescriptors, emit, lease);
      descriptors = nextDescriptors;
      lease = nextLease;
      emit();
    },
    snapshot() { return groupSnapshot(provider, descriptors); },
    dispose() {
      if (closed) return;
      closed = true;
      lease?.release();
      lease = null;
    },
  });
}

/** Framework-neutral acceptance projection of useSnapbackOptimisticCreate. */
export function observeSnapbackOptimisticCreate(
  providerValue,
  mutationReference,
  options,
  listener,
) {
  const provider = assertProvider(providerValue);
  if (!options || typeof options !== 'object' || options.query == null) {
    throw new TypeError('observeSnapbackOptimisticCreate requires query and args options');
  }
  const descriptor = provider.registry.descriptor(options.query, options.args);
  let closed = false;
  const snapshot = () => selectOptimisticCreateState(
    provider.registry.optimisticCreateSnapshot(descriptor),
    options.select,
  );
  const emit = () => {
    if (!closed) listener(snapshot());
  };
  const lease = provider.registry.subscribeOptimisticCreate(descriptor, emit);
  emit();
  return Object.freeze({
    snapshot,
    create(args) {
      if (closed) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'optimistic create observer is closed');
      return provider.registry.runOptimisticCreate(mutationReference, args, descriptor);
    },
    dispose() {
      if (closed) return;
      closed = true;
      lease.release();
    },
  });
}

export function observeSnapbackPresence(providerValue, reference, options, listener) {
  const provider = assertProvider(providerValue);
  const token = provider.registry.createPresenceToken();
  let descriptor = provider.registry.presenceDescriptor(
    reference,
    options.scope,
    Object.prototype.hasOwnProperty.call(options, 'value') ? options.value : skip,
    options.ttlMs,
  );
  let lease = null;
  let closed = false;
  const emit = () => {
    if (!closed) listener(provider.registry.presenceSnapshot(descriptor, token));
  };
  lease = provider.registry.subscribePresence(descriptor, token, emit);
  emit();
  return Object.freeze({
    update(nextOptions) {
      if (closed) throw diagnosticError('SNAPBACK_REACT_PROVIDER_CLOSED', 'presence observer is closed');
      lease.release();
      descriptor = provider.registry.presenceDescriptor(
        reference,
        nextOptions.scope,
        Object.prototype.hasOwnProperty.call(nextOptions, 'value') ? nextOptions.value : skip,
        nextOptions.ttlMs,
      );
      lease = provider.registry.subscribePresence(descriptor, token, emit);
      emit();
    },
    snapshot() { return provider.registry.presenceSnapshot(descriptor, token); },
    publish(value, publishOptions) { return token.actions.publish(value, publishOptions); },
    delete() { return token.actions.delete(); },
    async dispose() {
      if (closed) return;
      closed = true;
      const room = token.room;
      lease.release();
      lease = null;
      await Promise.resolve();
      await room?.cleanup;
    },
  });
}

function surfaceRefusal(code, message, details = {}) {
  throw diagnosticError(code, message, details);
}

const SURFACE_REACT_LIFECYCLE = Symbol('snapback.surfaceReactLifecycle');

function assertSurfaceGenerationCurrent(binding) {
  if (binding.closed || binding.retired) {
    surfaceRefusal(
      'SNAPBACK_REACT_SURFACE_GENERATION_STALE',
      'surface member call belongs to a retired parameter generation',
      { surfaceId: binding.surface.id },
    );
  }
}

function admittedSurfaceParams(surface, params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    surfaceRefusal('SNAPBACK_REACT_SURFACE_PARAMS_INVALID', 'surface params must be an object map');
  }
  const expected = Object.keys(surface.params).sort();
  const actual = Object.keys(params).sort();
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    surfaceRefusal(
      'SNAPBACK_REACT_SURFACE_PARAMS_INVALID',
      'surface params must exactly match the generated declaration',
      { expected, actual },
    );
  }
  canonicalizeClientValueV1(params);
  return immutableClone(params);
}

function surfaceOptions(surface, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    surfaceRefusal('SNAPBACK_REACT_SURFACE_OPTIONS_INVALID', 'surface options must be an object');
  }
  const unknownOptions = Object.keys(options).filter((name) => name !== 'presence');
  if (unknownOptions.length > 0) {
    surfaceRefusal('SNAPBACK_REACT_SURFACE_OPTIONS_INVALID', 'surface options contain unknown members', { members: unknownOptions });
  }
  const presence = options.presence ?? {};
  if (!presence || typeof presence !== 'object' || Array.isArray(presence)) {
    surfaceRefusal('SNAPBACK_REACT_SURFACE_OPTIONS_INVALID', 'surface presence options must be an object map');
  }
  const unknownPresence = Object.keys(presence).filter((name) => !Object.hasOwn(surface.presence, name));
  if (unknownPresence.length > 0) {
    surfaceRefusal('SNAPBACK_REACT_SURFACE_OPTIONS_INVALID', 'surface presence options name unknown members', { members: unknownPresence });
  }
  const normalized = {};
  for (const name of Object.keys(surface.presence).sort()) {
    const value = Object.hasOwn(presence, name) ? presence[name] : skip;
    // @ref LLP 0179#react-projection — a presence publish value is application
    // presence only. Self identity comes from the adopted session/connection,
    // never from a userId smuggled in the declarative payload.
    if (value !== skip && value && typeof value === 'object' && Object.hasOwn(value, 'userId')) {
      surfaceRefusal(
        'SNAPBACK_REACT_SURFACE_PRESENCE_IDENTITY_INPUT',
        'surface presence payloads cannot carry userId; self identity is session-derived',
        { member: name },
      );
    }
    if (value !== skip) canonicalizeClientValueV1(value);
    normalized[name] = value === skip ? skip : immutableClone(value);
  }
  return Object.freeze({ presence: Object.freeze(normalized) });
}

const SURFACE_INPUT_OMITTED = Symbol('surface input omitted');

function resolveSurfaceBindingValue(value, params, inputValues) {
  if (value.kind === 'param') return params[value.name];
  if (value.kind === 'input') {
    return Object.hasOwn(inputValues, value.name)
      ? inputValues[value.name]
      : SURFACE_INPUT_OMITTED;
  }
  if (value.kind === 'literal') return value.value;
  if (value.kind === 'scope') {
    return Object.fromEntries(Object.entries(value.fields).flatMap(([name, child]) => {
      const resolved = resolveSurfaceBindingValue(child, params, inputValues);
      return resolved === SURFACE_INPUT_OMITTED ? [] : [[name, resolved]];
    }));
  }
  surfaceRefusal('SNAPBACK_REACT_SURFACE_INVALID', `unsupported generated surface binding ${String(value.kind)}`);
}

function surfaceMemberArgs(member, params, inputs = {}, { command = false } = {}) {
  const expected = Object.keys(member.inputs).sort();
  const actual = Object.keys(inputs ?? {}).sort();
  const required = expected.filter((name) => member.inputs[name].optional !== true);
  if (
    actual.some((name) => !Object.hasOwn(member.inputs, name))
    || required.some((name) => !Object.hasOwn(inputs, name))
  ) {
    surfaceRefusal(
      'SNAPBACK_REACT_SURFACE_INPUT_INVALID',
      'surface member inputs do not match the generated binding',
      { expected, required, actual },
    );
  }
  const portableInputs = command
    ? Object.fromEntries(Object.entries(inputs).filter(([name]) => (
      member.inputs[name]?.contract?.kind !== 'commandAssetSource'
    )))
    : inputs;
  canonicalizeClientValueV1(portableInputs);
  // @ref LLP 0179#closed-grammar — an omitted optional input is omitted from
  // the composed payload; explicit undefined is refused by the canonical gate above.
  return Object.fromEntries(Object.entries(member.bindings).flatMap(([target, value]) => {
    const resolved = resolveSurfaceBindingValue(value, params, inputs);
    return resolved === SURFACE_INPUT_OMITTED ? [] : [[target, resolved]];
  }));
}

function presenceSurfaceView(state) {
  return Object.freeze({ ...state, members: state.entries });
}

function surfaceSnapshot(binding) {
  const group = binding.queryObserver?.snapshot()
    ?? groupSnapshot(binding.provider, binding.readDescriptors);
  const state = {};
  const data = {};
  for (const name of Object.keys(binding.surface.reads).sort()) {
    state[name] = group.queries[name];
    // Compact data is strictly a mechanical projection of owner state. An
    // unready/error child remains undefined; retained/current rows remain
    // distinguishable through state rather than being fabricated as [].
    data[name] = state[name].data;
  }
  const presence = {};
  for (const name of Object.keys(binding.surface.presence).sort()) {
    const child = binding.presenceObservers[name]?.snapshot() ?? PRESENCE_SERVER_PENDING;
    const cached = binding.presenceViews.get(child);
    presence[name] = cached ?? presenceSurfaceView(child);
    if (!cached && child && typeof child === 'object') binding.presenceViews.set(child, presence[name]);
  }
  const previous = binding.lastSnapshot;
  if (
    previous
    && Object.keys(state).every((name) => previous.state[name] === state[name])
    && Object.keys(presence).every((name) => previous.presence[name] === presence[name])
  ) return previous;
  binding.lastSnapshot = Object.freeze({
    data: Object.freeze(data),
    state: Object.freeze(state),
    presence: Object.freeze(presence),
    mutations: binding.mutations,
    commands: binding.commands,
    assets: binding.assets,
    descriptor: binding.surface,
  });
  return binding.lastSnapshot;
}

function startSurfaceBinding(binding) {
  if (binding.started || binding.closed) return;
  binding.started = true;
  const emit = () => {
    binding.lastSnapshot = null;
    for (const listener of [...binding.listeners]) listener();
  };
  if (binding.readDescriptors.length > 0) {
    binding.queryObserver = observeSnapbackQueries(binding.provider, binding.readEntries, emit);
  }
  for (const [name, member] of Object.entries(binding.surface.presence)) {
    binding.presenceObservers[name] = observeSnapbackPresence(
      binding.provider,
      member.reference,
      {
        scope: surfaceMemberArgs(member, binding.params).scope,
        value: binding.options.presence[name],
      },
      emit,
    );
  }
  emit();
}

function stopSurfaceBinding(binding) {
  binding.queryObserver?.dispose();
  binding.queryObserver = null;
  const cleanups = Object.values(binding.presenceObservers).map((observer) => observer.dispose());
  binding.presenceObservers = {};
  binding.started = false;
  binding.lastSnapshot = null;
  return Promise.allSettled(cleanups);
}

// @ref LLP 0114#named-projections-from-accepted-rfcs — a surface is only a
// projection over the provider registry. Reads use descriptor()/subscribeMany,
// presence uses presenceDescriptor()/subscribePresence, and mutations use
// runMutation, so low-level and surface consumers converge on canonical keys.
export function bindSnapbackSurface(providerValue, surfaceReference, params, options = {}) {
  const provider = assertProvider(providerValue);
  const surface = admittedReactSurface(provider.binding, surfaceReference);
  const binding = {
    provider,
    surface,
    params: admittedSurfaceParams(surface, params),
    options: surfaceOptions(surface, options),
    listeners: new Set(),
    started: false,
    closed: false,
    retired: false,
    queryObserver: null,
    presenceObservers: {},
    presenceViews: new WeakMap(),
    lastSnapshot: null,
    mutations: null,
    commands: null,
    assets: null,
    readEntries: null,
    readDescriptors: null,
    readSubscribers: Object.create(null),
  };
  const replaceReadProjection = () => {
    binding.readEntries = Object.freeze(Object.fromEntries(
      Object.entries(surface.reads).map(([name, member]) => [name, Object.freeze({
        ref: member.reference,
        args: surfaceMemberArgs(member, binding.params),
      })]),
    ));
    binding.readDescriptors = Object.keys(binding.readEntries).length === 0
      ? Object.freeze([])
      : validateEntries(provider, binding.readEntries);
  };
  replaceReadProjection();
  for (const name of Object.keys(surface.reads)) binding.readSubscribers[name] = new Set();
  const migrateReadSubscribers = () => {
    for (const [name, subscribers] of Object.entries(binding.readSubscribers)) {
      const descriptor = binding.readDescriptors.find((candidate) => candidate.name === name);
      for (const subscription of subscribers) {
        const emit = () => subscription.listener(provider.registry.snapshot(descriptor));
        const successor = provider.registry.subscribe(descriptor, emit);
        subscription.lease.release();
        subscription.descriptor = descriptor;
        subscription.lease = successor;
        subscription.listener(provider.registry.snapshot(descriptor));
      }
    }
  };
  binding.mutations = Object.freeze(Object.fromEntries(
    Object.entries(surface.mutations).map(([name, member]) => [name, (inputs = {}) => {
      assertSurfaceGenerationCurrent(binding);
      return provider.registry.runMutation(
        member.reference,
        surfaceMemberArgs(member, binding.params, inputs),
        null,
      );
    }]),
  ));
  binding.commands = Object.freeze(Object.fromEntries(
    Object.entries(surface.commands ?? {}).map(([name, member]) => [name, (inputs = {}) => {
      assertSurfaceGenerationCurrent(binding);
      return commandClientFor(provider).start(
        member.reference,
        surfaceMemberArgs(member, binding.params, inputs, { command: true }),
      );
    }]),
  ));
  binding.assets = Object.freeze(Object.fromEntries(
    Object.entries(surface.assets ?? {}).map(([name, member]) => [name, Object.freeze({
      reference: member.reference,
      start(call) {
        assertSurfaceGenerationCurrent(binding);
        if (!call || typeof call !== 'object' || Array.isArray(call) || !Object.hasOwn(call, 'file')) {
          surfaceRefusal('SNAPBACK_REACT_SURFACE_INPUT_INVALID', `surface asset ${name} requires a file`);
        }
        const allowed = new Set([
          ...Object.keys(member.inputs),
          'file', 'declaredFilename', 'declaredContentType', 'previewUrl',
        ]);
        const unknown = Object.keys(call).filter((field) => !allowed.has(field));
        if (unknown.length > 0) {
          surfaceRefusal('SNAPBACK_REACT_SURFACE_INPUT_INVALID', `surface asset ${name} has unknown call members`, { members: unknown });
        }
        const inputValues = Object.fromEntries(
          Object.keys(member.inputs)
            .filter((field) => Object.hasOwn(call, field))
            .map((field) => [field, call[field]]),
        );
        return assetRegistryFor(provider).assets.start({
          upload: member.reference,
          args: surfaceMemberArgs(member, binding.params, inputValues),
          file: call.file,
          declaredFilename: call.declaredFilename ?? null,
          declaredContentType: call.declaredContentType ?? null,
          previewUrl: call.previewUrl ?? null,
        });
      },
    })]),
  ));
  const reads = Object.freeze(Object.fromEntries(Object.keys(surface.reads).map((name) => [
    name,
    Object.freeze({
      snapshot: () => provider.registry.snapshot(
        binding.readDescriptors.find((descriptor) => descriptor.name === name),
      ),
      subscribe(listener) {
        if (binding.closed) surfaceRefusal('SNAPBACK_REACT_PROVIDER_CLOSED', 'surface binding is closed');
        const descriptor = binding.readDescriptors.find((candidate) => candidate.name === name);
        const emit = () => listener(provider.registry.snapshot(descriptor));
        const lease = provider.registry.subscribe(descriptor, emit);
        const subscription = { listener, descriptor, lease };
        binding.readSubscribers[name].add(subscription);
        listener(provider.registry.snapshot(descriptor));
        return () => {
          if (!binding.readSubscribers[name].delete(subscription)) return;
          subscription.lease.release();
        };
      },
    }),
  ])));
  const publicBinding = {
    artifactKind: 'boundSnapbackSurface',
    descriptor: surface,
    reads,
    mutations: binding.mutations,
    commands: binding.commands,
    assets: binding.assets,
    [SURFACE_REACT_LIFECYCLE]: Object.freeze({
      activate() {
        if (!binding.closed) binding.retired = false;
      },
      retire() {
        binding.retired = true;
      },
    }),
    update(nextParams, nextOptions = undefined) {
      if (binding.closed) surfaceRefusal('SNAPBACK_REACT_PROVIDER_CLOSED', 'surface binding is closed');
      binding.params = admittedSurfaceParams(surface, nextParams);
      if (nextOptions !== undefined) binding.options = surfaceOptions(surface, nextOptions);
      replaceReadProjection();
      migrateReadSubscribers();
      if (binding.queryObserver) binding.queryObserver.update(binding.readEntries);
      if (binding.started) {
        const emit = () => {
          binding.lastSnapshot = null;
          for (const listener of [...binding.listeners]) listener();
        };
        const predecessors = binding.presenceObservers;
        const successors = {};
        for (const [name, member] of Object.entries(surface.presence)) {
          successors[name] = observeSnapbackPresence(
            provider,
            member.reference,
            {
              scope: surfaceMemberArgs(member, binding.params).scope,
              value: binding.options.presence[name],
            },
            emit,
          );
        }
        binding.presenceObservers = successors;
        for (const observer of Object.values(predecessors)) void observer.dispose();
      }
      binding.lastSnapshot = null;
      for (const listener of [...binding.listeners]) listener();
    },
    subscribe(listener) {
      if (binding.closed) surfaceRefusal('SNAPBACK_REACT_PROVIDER_CLOSED', 'surface binding is closed');
      binding.listeners.add(listener);
      startSurfaceBinding(binding);
      return () => {
        binding.listeners.delete(listener);
        if (binding.listeners.size !== 0) return;
        queueMicrotask(() => {
          if (binding.listeners.size === 0 && !binding.closed) void stopSurfaceBinding(binding);
        });
      };
    },
    snapshot: () => surfaceSnapshot(binding),
    async dispose() {
      if (binding.closed) return;
      binding.closed = true;
      binding.retired = true;
      binding.listeners.clear();
      for (const subscribers of Object.values(binding.readSubscribers)) {
        for (const subscription of subscribers) subscription.lease.release();
        subscribers.clear();
      }
      await stopSurfaceBinding(binding);
    },
  };
  return Object.freeze(publicBinding);
}

export function observeSnapbackSurface(provider, surface, params, options, listener) {
  const binding = bindSnapbackSurface(provider, surface, params, options);
  const unsubscribe = binding.subscribe(() => listener(binding.snapshot()));
  listener(binding.snapshot());
  return Object.freeze({
    snapshot: binding.snapshot,
    reads: binding.reads,
    mutations: binding.mutations,
    commands: binding.commands,
    assets: binding.assets,
    update: binding.update,
    async dispose() {
      unsubscribe();
      await binding.dispose();
    },
  });
}

function surfaceHookOptionsKey(options) {
  const presence = Object.fromEntries(Object.entries(options?.presence ?? {}).map(([name, child]) => (
    [name, child === skip ? { $snapbackSurfaceSkip: true } : child]
  )));
  return canonicalizeClientValueV1({ ...(options ?? {}), presence });
}

export function useSurface(surface, params, options = {}) {
  const provider = useProvider();
  const paramKey = canonicalizeClientValueV1(params);
  const optionsKey = surfaceHookOptionsKey(options);
  const binding = useMemo(
    () => bindSnapbackSurface(provider, surface, params, options),
    [provider, surface, paramKey, optionsKey],
  );
  useEffect(() => {
    const lifecycle = binding[SURFACE_REACT_LIFECYCLE];
    lifecycle.activate();
    return lifecycle.retire;
  }, [binding]);
  return useSyncExternalStore(binding.subscribe, binding.snapshot, binding.snapshot);
}

export async function invokeSnapbackMutation(providerValue, reference, args, options = {}) {
  const provider = assertProvider(providerValue);
  // runMutation owns admission (including the development generation-handoff
  // wait), so adapters get the exact hook-path behavior: a strict rejection
  // stays a rejected promise here, never a synchronous throw.
  return provider.registry.runMutation(
    reference,
    args,
    options.optimistic ?? null,
    { queue: options.queue },
  );
}

export function invokeSnapbackCommand(providerValue, reference, args) {
  const provider = assertProvider(providerValue);
  const admitted = admittedReactCommand(provider.binding, reference);
  return commandClientFor(provider).start(admitted, args);
}

// ---------------------------------------------------------------------------
// Client diagnostics (LLP 0219). React owns only the provider-bound
// useSyncExternalStore projection; the client channel owns history,
// coalescing, active conditions, reporters, and deadline scheduling.

const diagnosticsStores = new WeakMap();

function diagnosticsStoreFor(provider) {
  let store = diagnosticsStores.get(provider);
  if (store) return store;
  let client;
  try { client = preparedReactBindingClient(provider.binding); } catch { client = null; }
  const channel = diagnosticsChannelForClient(client);
  if (channel === null) {
    throw diagnosticError(
      'SNAPBACK_REACT_DIAGNOSTICS_UNSUPPORTED',
      'the bound client does not expose diagnosticsChannel(); use a current @expo/snapback-client and see guide/clients/react.md',
      { capability: 'client-diagnostics' },
    );
  }
  store = Object.freeze({
    getSnapshot: () => channel.snapshot(),
    subscribe(listener) {
      return channel.subscribe(() => listener());
    },
  });
  diagnosticsStores.set(provider, store);
  return store;
}

export function useSnapbackDiagnostics() {
  const provider = useProvider();
  const store = useMemo(() => diagnosticsStoreFor(provider), [provider]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/// Framework-neutral diagnostics observer: acceptance adapters and the React
/// hook read the exact same frozen client-channel projection.
export function observeSnapbackDiagnostics(providerValue, listener) {
  const provider = assertProvider(providerValue);
  if (typeof listener !== 'function') {
    throw new TypeError('observeSnapbackDiagnostics requires a listener function');
  }
  const store = diagnosticsStoreFor(provider);
  let closed = false;
  const off = store.subscribe(() => {
    if (!closed) listener(store.getSnapshot());
  });
  listener(store.getSnapshot());
  return Object.freeze({
    snapshot: () => store.getSnapshot(),
    dispose() {
      if (closed) return;
      closed = true;
      off();
    },
  });
}

// ---------------------------------------------------------------------------
// Outbox (LLP 0043 M2 queue on the JS arm — LLP 0129 Phase 0). The React
// projection of the headless client's OWN facts: `outboxStatus()` counts,
// drain-controller phase, custody affordances, and the `subscribeOutbox` seam.
// It never derives an overlay, reorders replay, or claims settlement — LLP
// 0090 D3's full-resync-before-replay ordering stays entirely the headless
// client's.
// @ref LLP 0218#41-the-dispatch-union-headless-contract — React mirrors the
// total durable disposition and recovery surface without inventing outcomes.

const OUTBOX_LOADING = Object.freeze({
  status: 'loading',
  supported: false,
  pending: 0,
  failed: 0,
  stranded: 0,
  quarantined: 0,
  resultGone: 0,
  depth: 0,
  replaying: false,
  oldestPendingAtMs: null,
  drainPhase: 'idle',
  lastAttemptAtMs: null,
  nextRetryAtMs: null,
  blockedReason: null,
});

const outboxStores = new WeakMap();

function outboxStoreFor(provider) {
  let store = outboxStores.get(provider);
  if (store) return store;
  const client = preparedReactBindingClient(provider.binding);
  if (
    typeof client.outboxStatus !== 'function'
    || typeof client.subscribeOutbox !== 'function'
    || typeof client.replayQueuedMutations !== 'function'
  ) {
    // Capability honesty (LLP 0114): a client without the projection seam
    // refuses — reporting `supported: false` for a client whose queue state
    // is merely unreadable would be a false claim.
    throw diagnosticError(
      'SNAPBACK_REACT_OUTBOX_UNSUPPORTED',
      'the bound client does not expose the outbox projection surface',
    );
  }
  const listeners = new Set();
  let snapshot = OUTBOX_LOADING;
  let refreshing = false;
  let dirty = false;
  let clientOff = null;
  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observational */ }
    }
  };
  const refresh = () => {
    if (refreshing) {
      dirty = true;
      return;
    }
    refreshing = true;
    void client.outboxStatus().then((status) => {
      snapshot = Object.freeze({
        status: 'ready',
        ...status,
        depth: status.pending + status.failed + status.stranded
          + status.quarantined + status.resultGone,
      });
      notify();
    }).catch(() => { /* the durable store stays the authority */ }).finally(() => {
      refreshing = false;
      if (dirty) {
        dirty = false;
        refresh();
      }
    });
  };
  store = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (clientOff === null) {
        clientOff = client.subscribeOutbox(refresh);
        refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && clientOff !== null) {
          clientOff();
          clientOff = null;
        }
      };
    },
    async drainNow() {
      const owner = providerOutboxDrainStates.get(provider);
      const outcome = owner === undefined
        ? await client.replayQueuedMutations()
        : await owner.drainNow();
      refresh();
      return outcome;
    },
  };
  store.replay = store.drainNow;
  const action = (name) => async (...args) => {
    if (typeof client[name] !== 'function') {
      throw diagnosticError(
        'SNAPBACK_REACT_OUTBOX_AFFORDANCE_UNSUPPORTED',
        `the bound client does not expose ${name}`,
      );
    }
    try {
      return await client[name](...args);
    } finally {
      refresh();
    }
  };
  store.mutationStatus = action('mutationStatus');
  store.strandedMutations = action('strandedMutations');
  store.discardStrandedMutations = action('discardStrandedMutations');
  store.reRecordStrandedMutation = action('reRecordStrandedMutation');
  store.quarantinedMutations = action('quarantinedMutations');
  store.reenterQuarantinedMutations = action('reenterQuarantinedMutations');
  store.acknowledgeResultGoneMutations = action('acknowledgeResultGoneMutations');
  outboxStores.set(provider, store);
  return store;
}

export function useSnapbackOutbox() {
  const provider = useProvider();
  const store = useMemo(() => outboxStoreFor(provider), [provider]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return useMemo(
    () => Object.freeze({
      ...state,
      drainNow: store.drainNow,
      replay: store.replay,
      mutationStatus: store.mutationStatus,
      strandedMutations: store.strandedMutations,
      discardStrandedMutations: store.discardStrandedMutations,
      reRecordStrandedMutation: store.reRecordStrandedMutation,
      quarantinedMutations: store.quarantinedMutations,
      reenterQuarantinedMutations: store.reenterQuarantinedMutations,
      acknowledgeResultGoneMutations: store.acknowledgeResultGoneMutations,
    }),
    [state, store],
  );
}

/// Framework-neutral outbox observer (the observeSnapbackQueries pattern):
/// acceptance adapters read the exact same projection the hook renders.
export function observeSnapbackOutbox(providerValue, listener) {
  const provider = assertProvider(providerValue);
  const store = outboxStoreFor(provider);
  let closed = false;
  const off = store.subscribe(() => {
    if (!closed) listener(store.getSnapshot());
  });
  listener(store.getSnapshot());
  return Object.freeze({
    snapshot: () => store.getSnapshot(),
    drainNow: () => store.drainNow(),
    replay: () => store.replay(),
    mutationStatus: (...args) => store.mutationStatus(...args),
    strandedMutations: (...args) => store.strandedMutations(...args),
    discardStrandedMutations: (...args) => store.discardStrandedMutations(...args),
    reRecordStrandedMutation: (...args) => store.reRecordStrandedMutation(...args),
    quarantinedMutations: (...args) => store.quarantinedMutations(...args),
    reenterQuarantinedMutations: (...args) => store.reenterQuarantinedMutations(...args),
    acknowledgeResultGoneMutations: (...args) => store.acknowledgeResultGoneMutations(...args),
    dispose() {
      if (closed) return;
      closed = true;
      off();
    },
  });
}

// ---------------------------------------------------------------------------
// Assets (LLP 0044 §Client upload surface — the React projection over the
// framework-neutral asset client; LLP 0107 optimistic lifecycle).
//
// The hooks below own no transport, cache, or auth of their own: every byte
// and every decision rides the headless `SnapbackAssetClient`, and authority
// replacement blanks through the same barrier-participant contract the query
// registry uses. Late task events after a blank are generation-fenced.

const BLANKED_UPLOAD = Object.freeze({
  assetId: null,
  assetRef: null,
  attemptId: null,
  attemptExpiresAtMs: null,
  status: 'blanked',
  diagnostic: null,
  bytesTransferred: 0,
  totalBytes: 0,
  previewUrl: null,
  integrityBasis: null,
});
const IDLE_UPLOAD = Object.freeze({ ...BLANKED_UPLOAD, status: 'idle' });

export const assetRegistries = /* @__PURE__ */ new WeakMap();

export const commandClients = /* @__PURE__ */ new WeakMap();

function commandClientFor(provider) {
  let commands = commandClients.get(provider);
  if (commands) return commands;
  const client = preparedReactBindingClient(provider.binding);
  commands = commandClients.f(client, {
    assets: assetRegistryFor(provider).assets,
    assetSourceAdapter: provider.assetSourceAdapter,
    invokeMutation: (reference, args, options) => (
      provider.registry.runCommandMutation(reference, args, options)
    ),
  });
  commandClients.set(provider, commands);
  return commands;
}

function disposeCommandClientFor(provider) {
  const commands = commandClients.get(provider);
  commandClients.delete(provider);
  return commands?.dispose();
}

function assetRegistryFor(provider) {
  let registry = assetRegistries.get(provider);
  if (registry) return registry;
  const client = preparedReactBindingClient(provider.binding);
  const assets = provider.assets
    ?? assetRegistries.f(client);
  const stores = new Set();
  const issuedUrlGenerationListeners = new Set();
  let generation = 0;
  let issuedUrlGeneration = 0;
  const advanceIssuedUrlGeneration = () => {
    issuedUrlGeneration += 1;
    for (const listener of [...issuedUrlGenerationListeners]) {
      try { listener(); } catch { /* observational */ }
    }
  };
  const participant = {
    name: `snapback-react-assets:${provider.providerInstanceId}`,
    async quiesce() {},
    blank() {
      generation += 1;
      for (const store of [...stores]) store._blank();
    },
    clearMemory() {},
    async commitDurable() {},
    async resume() { advanceIssuedUrlGeneration(); },
  };
  const unregister = typeof client.registerAuthBarrierParticipant === 'function'
    ? client.registerAuthBarrierParticipant(participant)
    : () => {};
  // External-bearer custody uses the client's materialization cut rather
  // than the coordinator participant above. Wait for that transition to
  // settle before asking the asset client for the successor authority's
  // store; lookup during the synchronous blank would recapture the
  // predecessor.
  const unregisterIssuedUrlMaterialization = typeof client.registerAuthMaterialization === 'function'
    ? client.registerAuthMaterialization({
        capture: () => null,
        blank() {
          const transition = client.__externalBearerTransition;
          if (transition && typeof transition.then === 'function') {
            const advanceAfterTransition = () => queueMicrotask(advanceIssuedUrlGeneration);
            void transition.then(advanceAfterTransition, advanceAfterTransition);
          }
        },
      })
    : () => {};
  registry = {
    assets,
    stores,
    warnedStrictDeliveryAssetIds: new Set(),
    get generation() { return generation; },
    getIssuedUrlGeneration: () => issuedUrlGeneration,
    subscribeIssuedUrlGeneration(listener) {
      issuedUrlGenerationListeners.add(listener);
      return () => issuedUrlGenerationListeners.delete(listener);
    },
    async dispose() {
      unregisterIssuedUrlMaterialization();
      issuedUrlGenerationListeners.clear();
      await unregister();
    },
  };
  assetRegistries.set(provider, registry);
  return registry;
}

function disposeAssetRegistryFor(provider) {
  const assetRegistry = assetRegistries.get(provider);
  assetRegistries.delete(provider);
  return assetRegistry?.dispose();
}

const EMPTY_ASSET_URL_SNAPSHOT = Object.freeze({
  url: null,
  status: 'empty',
  diagnostic: null,
  expiresAt: null,
  rendition: null,
});
const EMPTY_ASSET_URL_STORE = Object.freeze({
  getSnapshot: () => EMPTY_ASSET_URL_SNAPSHOT,
  getServerSnapshot: () => EMPTY_ASSET_URL_SNAPSHOT,
  subscribe: () => () => {},
  refresh: async () => {},
});

/**
 * Project the framework-neutral issued-URL controller into React. The asset
 * client owns empty-state selection, issuance, refresh/retry timers, authority
 * fencing, and keyed sharing; React owns only subscription and render identity.
 *
 * @ref LLP 0210#d1--client-arm-signed-issuance-and-ttl-refresh-projection —
 * the hook is a content-keyed external-store projection, not a second URL
 * cache or refresh state machine.
 */
export function useSnapbackAssetUrl(assetIdOrNull, options = {}) {
  const provider = useProvider();
  const registry = assetRegistryFor(provider);
  const client = preparedReactBindingClient(provider.binding);
  const optionsKey = assetIdOrNull == null ? null : canonicalHookInputKey(options);
  const authorityGeneration = useSyncExternalStore(
    registry.subscribeIssuedUrlGeneration,
    registry.getIssuedUrlGeneration,
    registry.getIssuedUrlGeneration,
  );
  const store = useMemo(
    () => (assetIdOrNull == null
      ? EMPTY_ASSET_URL_STORE
      : registry.assets.issuedUrlStore(assetIdOrNull, options)),
    [registry, assetIdOrNull, optionsKey, authorityGeneration],
  );
  // @ref LLP 0267#76-reactprovider-and-asset-multiplicity-consumes-d05-budgets--decided — a hook
  // issuance reports only opaque identity plus framework-minted ownership to
  // the client's positively gated bounded recorder.
  useEffect(() => {
    if (assetIdOrNull == null) return;
    client.__recordRuntimeCostAssetIssuance?.({
      assetIdentity: assetIdOrNull,
      ownerLabel: `provider:${provider.providerInstanceId}/hook:useSnapbackAssetUrl`,
    });
  }, [client, provider.providerInstanceId, assetIdOrNull, authorityGeneration]);
  const subscribe = useCallback(
    (listener) => store.subscribe(listener),
    [store],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const getServerSnapshot = useCallback(() => store.getServerSnapshot(), [store]);
  const refresh = useCallback(() => store.refresh(), [store]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => Object.freeze({ ...snapshot, refresh }), [snapshot, refresh]);
}

/**
 * Empty-safe React projection of the neutral media store. In particular,
 * React does not special-case issuance or own a second URL state machine:
 * even the inert null spelling is supplied by the headless asset client.
 *
 * @ref LLP 0239#d5-one-media-projection-handles-empty-image-video-denial-and-refresh —
 * null is a synchronous external-store snapshot with zero transport work;
 * non-empty media inherits issued-URL refresh and authority blanking.
 */
export function useSnapbackMedia(mediaRefOrNull, options = {}) {
  const provider = useProvider();
  const registry = assetRegistryFor(provider);
  const mediaKey = canonicalHookInputKey(mediaRefOrNull ?? null);
  const optionsKey = canonicalHookInputKey(options);
  const authorityGeneration = useSyncExternalStore(
    registry.subscribeIssuedUrlGeneration,
    registry.getIssuedUrlGeneration,
    registry.getIssuedUrlGeneration,
  );
  const store = useMemo(
    () => registry.assets.mediaStore(mediaRefOrNull, options),
    [registry, mediaKey, optionsKey, authorityGeneration],
  );
  const subscribe = useCallback((listener) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const getServerSnapshot = useCallback(() => store.getServerSnapshot(), [store]);
  const refresh = useCallback(() => store.refresh(), [store]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => Object.freeze({ ...snapshot, refresh }), [snapshot, refresh]);
}

/**
 * Bounded collection projection over the neutral media collection store.
 * Stable item ids and child refresh functions come from that store; React
 * owns only content-keyed subscription identity.
 *
 * @ref LLP 0239#d5-one-media-projection-handles-empty-image-video-denial-and-refresh —
 * one denied or unavailable child remains a local item state and cannot erase
 * authorized siblings.
 */
export function useSnapbackMediaCollection(items, options = {}) {
  const provider = useProvider();
  const registry = assetRegistryFor(provider);
  const itemsKey = canonicalHookInputKey(items);
  const optionsKey = canonicalHookInputKey(options);
  const authorityGeneration = useSyncExternalStore(
    registry.subscribeIssuedUrlGeneration,
    registry.getIssuedUrlGeneration,
    registry.getIssuedUrlGeneration,
  );
  const store = useMemo(
    () => registry.assets.mediaCollectionStore(items, options),
    [registry, itemsKey, optionsKey, authorityGeneration],
  );
  const subscribe = useCallback((listener) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const getServerSnapshot = useCallback(() => store.getServerSnapshot(), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function createAssetUploadStore(registry, upload) {
  const listeners = new Set();
  let snapshot = IDLE_UPLOAD;
  let task = null;
  let taskOff = null;
  let boundGeneration = registry.generation;
  const publish = (next) => {
    snapshot = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observational */ }
    }
  };
  const detach = () => {
    taskOff?.();
    taskOff = null;
    task = null;
  };
  const adopt = (nextTask) => {
    detach();
    task = nextTask;
    boundGeneration = registry.generation;
    const bound = task;
    const boundAt = boundGeneration;
    taskOff = task.subscribe((taskSnapshot) => {
      // Generation fence: an authority change orphans in-flight tasks; their
      // late events must not repopulate a blanked surface.
      if (task !== bound || boundAt !== registry.generation) return;
      publish(taskSnapshot);
    });
  };
  const store = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(file, options = {}) {
      const nextTask = registry.assets.start({ upload, file, ...options });
      adopt(nextTask);
      return nextTask;
    },
    resumePersisted(options) {
      const nextTask = registry.assets.resumePersisted(options);
      if (nextTask !== null) adopt(nextTask);
      return nextTask;
    },
    pause: () => task?.pause(),
    resume: () => task?.resume(),
    cancel: (options) => task?.cancel(options) ?? Promise.resolve(snapshot),
    async retry() {
      if (!task) return null;
      const successor = await task.retry();
      adopt(successor);
      publish(successor.snapshot());
      return successor;
    },
    _blank() {
      detach();
      publish(BLANKED_UPLOAD);
    },
    release() {
      registry.stores.delete(store);
      detach();
      listeners.clear();
    },
  };
  return store;
}

export function useSnapbackAssetUpload(options) {
  const provider = useProvider();
  if (!options || typeof options !== 'object' || !options.upload) {
    throw new TypeError('useSnapbackAssetUpload requires a generated upload reference');
  }
  const registry = assetRegistryFor(provider);
  const store = useMemo(
    () => createAssetUploadStore(registry, options.upload),
    [registry, options.upload],
  );
  useEffect(() => {
    registry.stores.add(store);
    return () => store.release();
  }, [registry, store]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return useMemo(() => Object.freeze({
    state,
    start: store.start,
    resumePersisted: store.resumePersisted,
    pause: store.pause,
    resume: store.resume,
    cancel: store.cancel,
    retry: store.retry,
  }), [state, store]);
}

const ASSET_IMAGE_IDLE = Object.freeze({
  phase: 'empty',
  src: null,
  strictSrc: null,
  delivery: null,
  aspectRatio: null,
  placeholderSrc: null,
  record: null,
});

function bestReadyRenditionVariant(record, maxWidth) {
  const ready = Array.isArray(record?.renditions)
    ? record.renditions
      .filter((rendition) => (
        rendition?.ready === true
        && typeof rendition.variant === 'string'
      ))
    : [];
  const sized = ready
    .filter((rendition) => Number.isFinite(rendition.width))
    .map((rendition) => ({ variant: rendition.variant, width: rendition.width }))
    .sort((left, right) => left.width - right.width);
  return sized.slice().reverse().find((rendition) => rendition.width <= maxWidth)?.variant
    ?? sized[0]?.variant
    ?? ready[0]?.variant
    ?? null;
}

function warnAssetStrictDeliverySessions(registry, provider, assetId) {
  if (
    provider.binding.authMode !== 'sessions'
    || registry.warnedStrictDeliveryAssetIds.has(assetId)
  ) return;
  registry.warnedStrictDeliveryAssetIds.add(assetId);
  try {
    globalThis.console?.warn?.(
      `SNAPBACK_REACT_ASSET_STRICT_DELIVERY_SESSIONS: asset ${assetId}'s policy grants only strict delivery, but this server runs sessions auth; a plain <img>/<Image> cannot send the required x-snapback-auth-client-protocol header, so rendering src directly shows empty pixels. Declare delivery: { kind: 'public-immutable' } on the upload intent for a pasteable URL, or fetch the bytes with the authenticated client using strictSrc. See guide/backend/assets.md#deliver.`,
    );
  } catch {
    // A missing or throwing console must never affect asset rendering.
  }
}

/**
 * The renderer ladder as a headless hook (Expo-ready — no DOM API in this
 * path): local preview → ThumbHash placeholder → best delivered rendition.
 * Readiness arrives over the reserved record projection with no polling
 * where the client supports the frame lane.
 */
export function useSnapbackAssetImage({
  assetId = null,
  placeholder = null,
  previewUrl = null,
  maxWidth = 512,
  userId = null,
} = {}) {
  const provider = useProvider();
  const registry = assetRegistryFor(provider);
  const watchRef = useRef(null);
  const [watchTick, setWatchTick] = React.useState(0);
  useEffect(() => {
    watchRef.current?.dispose();
    watchRef.current = null;
    if (assetId !== null && typeof registry.assets.watchStore === 'function') {
      const watch = registry.assets.watchStore(assetId, { userId });
      watchRef.current = watch;
      const off = watch.subscribe(() => setWatchTick((tick) => tick + 1));
      return () => {
        off();
        watch.dispose();
        if (watchRef.current === watch) watchRef.current = null;
      };
    }
    return undefined;
  }, [registry, assetId, userId]);
  return useMemo(() => {
    void watchTick;
    const record = watchRef.current?.getSnapshot() ?? null;
    // The server-provided placeholder (the record view's media block) wins
    // over the prop, which stays as the fallback for pre-establishment
    // renders and older servers.
    const media = record?.record?.media ?? null;
    const serverPlaceholder =
      media?.placeholder?.algo === 'thumbhash.v1'
        && typeof media.placeholder.value === 'string'
        ? media.placeholder.value
        : null;
    const effectivePlaceholder = serverPlaceholder ?? placeholder;
    const placeholderState = (recordForPhase) => {
      try {
        const bytes = Uint8Array.from(
          typeof atob === 'function'
            ? atob(effectivePlaceholder).split('').map((char) => char.charCodeAt(0))
            : Buffer.from(effectivePlaceholder, 'base64'),
        );
        return {
          src: placeholderToDataURL(effectivePlaceholder),
          aspectRatio: thumbHashToApproximateAspectRatio(bytes),
          record: recordForPhase,
        };
      } catch {
        return null;
      }
    };
    const ready = record?.status === 'ready'
      && (record.record?.availability ?? 'ready') === 'ready';
    const blanked = record?.status === 'blank';
    if (ready && assetId !== null && !blanked) {
      const underlay = effectivePlaceholder !== null
        ? placeholderState(record.record)
        : null;
      const profile = record.record?.deliveryProfile ?? null;
      const strictSrc = registry.assets.deliveryUrl(assetId, { maxWidth });
      // @ref LLP 0044#delivery-profiles — choose the most-permissive URL the
      // policy grants; URL selection does not change server authorization.
      // A public asset can be ready before an optional rendition publishes,
      // so that race stays on the existing underlay ladder.
      if (profile === 'public-immutable') {
        const publicVariant = bestReadyRenditionVariant(record.record, maxWidth);
        if (publicVariant !== null) {
          return Object.freeze({
            phase: 'rendition',
            src: registry.assets.publicDeliveryUrl(assetId, { variant: publicVariant }),
            strictSrc,
            delivery: 'public',
            aspectRatio: underlay?.aspectRatio ?? null,
            placeholderSrc: underlay?.src ?? null,
            record: record.record,
          });
        }
        if (previewUrl !== null) {
          return Object.freeze({
            phase: 'preview',
            src: previewUrl,
            strictSrc,
            delivery: 'pending',
            aspectRatio: null,
            placeholderSrc: underlay?.src ?? null,
            record: record.record,
          });
        }
        if (underlay !== null) {
          return Object.freeze({
            phase: 'placeholder',
            src: underlay.src,
            strictSrc,
            delivery: 'pending',
            aspectRatio: underlay.aspectRatio,
            placeholderSrc: underlay.src,
            record: record.record,
          });
        }
        return Object.freeze({
          phase: 'empty',
          src: null,
          strictSrc,
          delivery: 'pending',
          aspectRatio: null,
          placeholderSrc: null,
          record: record.record,
        });
      }
      warnAssetStrictDeliverySessions(registry, provider, assetId);
      return Object.freeze({
        phase: 'rendition',
        src: strictSrc,
        strictSrc,
        delivery: 'strict',
        aspectRatio: underlay?.aspectRatio ?? null,
        placeholderSrc: underlay?.src ?? null,
        record: record.record,
      });
    }
    if (blanked) return ASSET_IMAGE_IDLE;
    if (previewUrl !== null) {
      return Object.freeze({
        phase: 'preview',
        src: previewUrl,
        strictSrc: null,
        delivery: null,
        aspectRatio: null,
        placeholderSrc: null,
        record: null,
      });
    }
    if (effectivePlaceholder !== null) {
      const state = placeholderState(null);
      if (state === null) return ASSET_IMAGE_IDLE;
      return Object.freeze({
        phase: 'placeholder',
        src: state.src,
        strictSrc: null,
        delivery: null,
        aspectRatio: state.aspectRatio,
        placeholderSrc: state.src,
        record: state.record,
      });
    }
    return ASSET_IMAGE_IDLE;
  }, [provider, registry, assetId, placeholder, previewUrl, maxWidth, watchTick]);
}

/**
 * Web convenience component over the headless ladder (`img` is DOM-only;
 * React Native consumers use `useSnapbackAssetImage` with their own
 * `Image`).
 */
export function SnapbackAssetImage({
  assetId = null,
  placeholder = null,
  previewUrl = null,
  maxWidth = 512,
  userId = null,
  alt = '',
  ...rest
}) {
  const image = useSnapbackAssetImage({ assetId, placeholder, previewUrl, maxWidth, userId });
  if (image.src === null) return null;
  return React.createElement('img', {
    src: image.src,
    alt,
    'data-snapback-asset-phase': image.phase,
    ...rest,
  });
}
