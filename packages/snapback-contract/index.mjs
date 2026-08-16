// Snapback <-> Contract adapter.
//
// @ref LLP 0005#contractexact-integration - the generated Contract adapter owns
//   the boring seams Valet demos copied by hand: boot, query-boundary wiring,
//   mutation invocation, initial snapshot, pending state, and provider wiring.
// @ref LLP 0012#capability-manifest — adapters report Online versus Parity honestly.
// @ref LLP 0051#d6-clients-by-class-online-fallback-parity-by-construction — the
//   adapter's Parity slice is the closed IR tier: derived local overlays plus a
//   D1-ledgered durable queue. Surfaces without a configured client store report Online.

export const SNAPBACK_CONTRACT_ADAPTER_VERSION = 1;
// Legacy/default and every non-offline surface stay Online. Parity is a
// per-surface earned result, never a package-wide default.
export const SNAPBACK_CONTRACT_CAPABILITY_CLASS = 'Online';
export const SNAPBACK_CONTRACT_PARITY_CAPABILITY_CLASS = 'Parity';

export {
  compileResultContractValidator,
  RESULT_CONTRACT_LIMITS_V1,
} from './result-contract-validator.mjs';

export {
  createSnapbackProviderDiagnostic,
  createSnapbackProviderDiagnosticCollector,
  createSnapbackProviderDiagnosticError,
} from './diagnostics.mjs';

export {
  AUTH_DEFAULT_STORAGE_PARTITION,
  AuthCoordinator,
  authAppIdHash,
  authCustodyOwnerKeyHash,
  canonicalAgentAuthorityKey,
  canonicalAuthorityKey,
  createMemoryAuthCustodyStorage,
  deriveServiceAuthorityInstanceId,
  normalizeClientAuthority,
  normalizeAuthCustodyOwnerKey,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
  validateAuthCustody,
  validateAuthCustodySenderKeys,
} from './auth-coordinator.mjs';

export { createIndexedDbAuthCustodyStorage } from './auth-custody-indexeddb.mjs';

export {
  AUTH_INVALIDATION_REFIRE_MAX_MS,
  effectiveDisposition,
  mergeResyncObligation,
  nextInvalidationGeneration,
  nextQueryInstanceId,
  resolutionSatisfies,
  scopeKey,
  SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
  validateAuthorizationVersion,
  validateAuthenticatedBootIssuer,
  validateAuthorizationInvalidationConnection,
  validateCompositeWitness,
  validateDataWitness,
  validateIssuerId,
  validateIssuerRetirement,
  validateQueryNamespace,
  validateResolutionTicket,
  validateResyncObligation,
  validateScopeId,
  validateScopeRetirement,
} from './auth-invalidation.mjs';

export {
  createLiveQueryAuthorizationFence,
  createLiveQueryInstanceAllocator,
  createLiveQueryNamespace,
} from './query-authorization.mjs';

export {
  authorizedLeaseActivationHash,
  authorizedLeaseHash,
  deriveAuthorizedLeaseCommit,
  SNAPBACK_AUTHORIZED_LEASE_DEFAULT_MS,
  SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS,
  SNAPBACK_AUTHORIZED_LEASE_PROTOCOL_VERSION,
  validateAuthorizedLease,
  validateAuthorizedLeaseCapability,
} from './authorized-lease.mjs';

export {
  CONTRACT_RECEIPT_CAPABILITY,
  contractReceiptCapability,
  SNAPBACK_CONTRACT_RECEIPT_CAPABILITY,
} from './capabilities.mjs';

export {
  SUPPORTED_CONTRACT_DATA_MANIFEST_VERSIONS,
  validateSnapbackContractArtifacts,
} from './artifact-validation.mjs';

// Render-first mode (ENG-23736): links synchronously, backend attaches behind
// the mounted app. Lives in ./render-first.mjs; re-exported so the package
// root stays the single import site.
export { createDeferredContractLinks, createRenderFirstSnapbackContractSurface } from './render-first.mjs';

// LLP 0063 Step 1: binding-time keyed scopes. Exact owns logical identity and
// deduplication; this provider owns one Snapback transport attempt per logical
// Exact subscription.
export { createKeyedSnapbackContractProvider } from './keyed-provider.mjs';

// Derived optimistic overlays (Exact LLP 0329 E-B): generated default
// reducers for IR-tier mutations whose manifest embeds the plan. Lives in
// ./derived-overlay.mjs; re-exported so the package root stays the single
// import site.
export {
  canonicalizeJsonValue,
  DATA_TIER_PROFILE_VERSION,
  deriveOptimisticReducer,
  deriveOptimisticReducers,
  evalValueExpr,
  MAX_EXPR_DEPTH,
  MAX_INSERT_EACH_FANOUT,
  MAX_PLAN_STEPS,
  planDerivableForTable,
  OVERLAY_CLASSES,
  truthy,
  valuesEqual,
} from './derived-overlay.mjs';

export {
  createClientMutationId,
  createLocalStorageSnapbackClientStore,
  createMemorySnapbackClientStore,
  createSnapbackClientStoreAuthParticipant,
  retainedQueryKey,
  snapbackAuthFingerprint,
  SNAPBACK_CLIENT_STORE_VERSION,
} from './client-store.mjs';

import { canonicalizeJsonValue, deriveOptimisticReducers } from './derived-overlay.mjs';
import {
  createClientMutationId,
  createSnapbackClientStoreAuthParticipant,
  MAX_OFFLINE_LEDGER_IDS,
  retainedQueryKey,
  snapbackAuthFingerprint,
} from './client-store.mjs';
import {
  authorizedLeaseActivationHash,
  validateAuthorizedLeaseCapability,
} from './authorized-lease.mjs';
import { createKeyedSnapbackContractProvider } from './keyed-provider.mjs';
import { createSnapbackProviderDiagnostic } from './diagnostics.mjs';
import { normalizeContractMutationOutput } from './mutation-output.mjs';
import { validateSnapbackContractArtifacts } from './artifact-validation.mjs';

// A physical format-6 store is one durable barrier participant even when an
// app mounts several Contract surfaces over it. The coordinator owns the
// transition; surfaces merely hold references to this shared registration.
// @ref LLP 0059#participant-contract — duplicate surfaces must not race the
//   store's expected-epoch transition CAS.
const durableStoreRegistrations = new WeakMap();
const durableQueryAuthorizationTails = new WeakMap();

// Sequence-atomic descriptors come only from the normalized
// write-with-activity profile. That profile forbids authored RuntimeId sites;
// its fixed ctx-ledger consumption is one host-minted row id for every
// top-level Insert (activity plus, for an insert source, the source row).
// Capture those ids without evaluating AllocateSequence or publishing rows.
function atomicWithheldLedgerIdCount(plan) {
  const steps = plan?.steps;
  if (!Array.isArray(steps)) return null;
  const allocations = steps.filter((step) => step?.AllocateSequence !== undefined).length;
  const inserts = steps.filter((step) => step?.Insert !== undefined).length;
  return allocations === 1 && (inserts === 1 || inserts === 2) ? inserts : null;
}

// @ref LLP 0053#client-fences — render/query generations and queued-mutation
//   custody advance independently, serialized through the shared client store.
function createContractQueryAuthorizationQueue(store, capture, authorizedQuery = null) {
  if (!store) return null;
  const authority = capture
    ? { authorityEpoch: capture.authorityEpoch, authorityKey: capture.authorityKey }
    : {};
  const serialize = (operation) => {
    const previous = durableQueryAuthorizationTails.get(store) ?? Promise.resolve();
    const attempted = previous.then(operation, operation);
    durableQueryAuthorizationTails.set(
      store,
      attempted.then(() => undefined, () => undefined),
    );
    return attempted;
  };
  const withQueueCapture = async (operation) => {
    const queue = await store.captureMutationQueue(authority);
    return operation({ ...authority, ...queue });
  };
  return Object.freeze({
    applyObligation(obligation) {
      if (obligation.maxDisposition === 'retain') return Promise.resolve(null);
      return serialize(async () => {
        await authorizedQuery?.applyObligation?.(obligation);
        return withQueueCapture((expected) => (
          store.applyMutationQueueObligation(obligation, expected)
        ));
      });
    },
    prepareResolution(resolution, snapshot) {
      if (resolution.maxDisposition === 'retain') return Promise.resolve(null);
      return serialize(() => authorizedQuery?.prepareResolution?.(resolution, snapshot) ?? null);
    },
    resolveObligation(resolution) {
      if (resolution.maxDisposition === 'retain') return Promise.resolve(null);
      return serialize(() => withQueueCapture((expected) => (
        store.resolveMutationQueueObligation(resolution, expected)
      )));
    },
    retireScopes(retired, snapshot) {
      const scopes = retired.map((entry) => entry.scopeId).filter(Boolean);
      return serialize(async () => {
        await authorizedQuery?.retireScopes?.(retired, snapshot);
        return withQueueCapture((expected) => (
          store.retireMutationQueueScopes(scopes, expected)
        ));
      });
    },
    acknowledged(resolution, acknowledgement) {
      return authorizedQuery?.acknowledged?.(resolution, acknowledgement) ?? null;
    },
  });
}

function registerContractParticipant(client, coordinator, participant) {
  return clientOwnsAuthorityFence(client, coordinator)
    && typeof client?.registerAuthBarrierParticipant === 'function'
    ? client.registerAuthBarrierParticipant(participant)
    : coordinator.registerParticipant(participant);
}

async function acquireDurableStoreRegistration(client, coordinator, store) {
  if (!coordinator || !store) return null;
  let stores = durableStoreRegistrations.get(coordinator);
  if (!stores) {
    stores = new WeakMap();
    durableStoreRegistrations.set(coordinator, stores);
  }
  let entry = stores.get(store);
  if (entry?.closing) {
    await entry.closing;
    entry = stores.get(store);
  }
  if (!entry) {
    entry = {
      references: 0,
      unregister: registerContractParticipant(
        client,
        coordinator,
        createSnapbackClientStoreAuthParticipant(store),
      ),
      closing: null,
    };
    stores.set(store, entry);
  }
  entry.references += 1;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    entry.references -= 1;
    if (entry.references !== 0) return;
    entry.closing = Promise.resolve(entry.unregister()).finally(() => {
      if (stores.get(store) === entry) stores.delete(store);
    });
    await entry.closing;
  };
}

function staleContractAuthorityError() {
  const diagnostic = {
    code: 'SNAPBACK_CLIENT_AUTHORITY_STALE',
    message: 'the Contract operation completed under a stale client authority',
  };
  const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
  error.code = diagnostic.code;
  error.diagnostic = diagnostic;
  return error;
}

// @ref LLP 0081#6-compatibility-and-deployment-ordering — the two stable
//   migration-boundary refusals a client can receive across a schema
//   publication. They are lifecycle states, not mutation outcomes: the
//   quarantined write is preserved for resync-before-replay (or for replay
//   after the app runs successor artifacts) and is never settled `failed`
//   or silently dropped, unlike an ordinary receipted rejection.
const CONTRACT_MIGRATION_BOUNDARY_KINDS = Object.freeze({
  SNAPBACK_MIGRATION_RESYNC_REQUIRED: 'resync-required',
  SNAPBACK_MIGRATION_UPGRADE_REQUIRED: 'upgrade-required',
});
const migrationBoundaryKindOf = (error) => (
  CONTRACT_MIGRATION_BOUNDARY_KINDS[error?.diagnostic?.code ?? error?.code] ?? null
);

const CONTRACT_LIFECYCLE_GENERATION_MAX = Number.MAX_SAFE_INTEGER;
const CONTRACT_LIFECYCLE_GENERATION_EXHAUSTED =
  'SNAPBACK_CONTRACT_LIFECYCLE_GENERATION_EXHAUSTED';

function contractLifecycleGenerationError(axis) {
  const diagnostic = contractDiagnostic(
    CONTRACT_LIFECYCLE_GENERATION_EXHAUSTED,
    'Contract lifecycle generation space is exhausted; the affected surface is terminally closed.',
    { axis, maximum: CONTRACT_LIFECYCLE_GENERATION_MAX },
  );
  const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
  error.code = diagnostic.code;
  error.diagnostic = diagnostic;
  return error;
}

// @ref LLP 0059#participant-contract — every process-local lifecycle identity
// in this adapter advances through the same checked allocator. Reusing
// MAX_SAFE_INTEGER would make two distinct
// async generations compare equal, so callers must catch this error and
// synchronously terminalize their publication surface.
function nextContractLifecycleGeneration(current, axis) {
  if (
    !Number.isSafeInteger(current)
    || current < 0
    || current >= CONTRACT_LIFECYCLE_GENERATION_MAX
  ) {
    throw contractLifecycleGenerationError(axis);
  }
  return current + 1;
}

function normalizeTestLifecycleGenerationSeeds(seeds) {
  if (seeds == null) return Object.freeze({});
  const allowed = new Set(['resume', 'socketLoss', 'ephemeralWiring']);
  if (
    typeof seeds !== 'object'
    || Array.isArray(seeds)
    || Object.keys(seeds).some((key) => !allowed.has(key))
    || Object.values(seeds).some((value) => (
      !Number.isSafeInteger(value)
      || value < 0
      || value > CONTRACT_LIFECYCLE_GENERATION_MAX
    ))
  ) {
    throw new TypeError('testLifecycleGenerationSeeds must contain non-negative safe integer resume, socketLoss, or ephemeralWiring seeds');
  }
  return Object.freeze({ ...seeds });
}

function effectiveContractUserId(coordinator, authSession, explicitUserId) {
  if (authSession?.authority?.kind === 'servicePrincipal') {
    const effectiveUserId = authSession.authority.userId;
    if (typeof effectiveUserId !== 'string' || effectiveUserId.length === 0) {
      const diagnostic = contractDiagnostic(
        'SNAPBACK_CONTRACT_SERVICE_PRINCIPAL_USER_INVALID',
        'service-principal auth handshake did not provide an effective user id',
      );
      const error = new Error(diagnostic.message);
      error.code = diagnostic.code;
      error.diagnostic = diagnostic;
      throw error;
    }
    if (explicitUserId != null && explicitUserId !== effectiveUserId) {
      const diagnostic = contractDiagnostic(
        'SNAPBACK_CONTRACT_SERVICE_PRINCIPAL_USER_MISMATCH',
        'the explicit Contract userId does not match the service principal effective user',
        { explicitUserId, effectiveUserId },
      );
      const error = new Error(diagnostic.message);
      error.code = diagnostic.code;
      error.diagnostic = diagnostic;
      throw error;
    }
    return effectiveUserId;
  }
  if (coordinator?.authority?.kind === 'session') {
    return coordinator.authority.userId;
  }
  return explicitUserId;
}

function resolveAuthCoordinator(client, explicit) {
  const coordinator = explicit
    ?? client?.authCoordinator
    ?? client?.agentAuthority
    ?? null;
  if (!coordinator) {
    if (client?.authProtocols?.authClient === 1) {
      throw new TypeError('auth-client protocol v1 requires browser or agent authority custody');
    }
    return null;
  }
  for (const method of ['capture', 'isCurrent', 'compareAndCommit', 'registerParticipant']) {
    if (typeof coordinator[method] !== 'function') {
      throw new TypeError(`authCoordinator requires ${method}()`);
    }
  }
  return coordinator;
}

const isUnavailableAuthTransport = (error) => (
  error instanceof TypeError
  && error?.diagnostic == null
  && error?.status == null
  && error?.code == null
);

// @ref LLP 0058#bootstrap-handshake — capability axes come only from echoes of
// this client's own protocol offer. When the transport publishes its offer
// tuple (`client.authProtocols`, as the kit does), a non-null echo the client
// never offered is unsolicited and cannot enable queued replay, authority
// descriptors, invalidation-backed surfaces, or retained reads. A generic
// coordinator test double may omit authProtocols; its validated projection is
// then its own responsibility.
const offeredProtocolEchoV1 = (client, session, axis) => (
  session?.clientProtocols?.[axis] === 1
  && (client?.authProtocols == null || client.authProtocols[axis] === 1)
);

const clientOwnsAuthorityFence = (client, coordinator) => (
  client?.authorityFence === coordinator
  || client?.authCoordinator === coordinator
  || client?.agentAuthority === coordinator
);

async function bootContractAuthority(client, coordinator, { durableOffline = false } = {}) {
  if (!coordinator) return { capture: null, durableAuthorityRestored: false };
  if (durableOffline && typeof coordinator.restoreOffline === 'function') {
    const restored = await coordinator.restoreOffline();
    if (restored) {
      return {
        capture: clientOwnsAuthorityFence(client, coordinator)
          && typeof client?.captureAuthority === 'function'
          ? client.captureAuthority()
          : restored,
        durableAuthorityRestored: true,
      };
    }
  }
  // The kit owns handshake/custody reconciliation. A generic coordinator test
  // double may omit authSession and arrive already settled.
  if (clientOwnsAuthorityFence(client, coordinator) && typeof client?.authSession === 'function') {
    await client.authSession();
  } else if (typeof coordinator.synchronize === 'function') {
    await coordinator.synchronize();
  }
  return {
    capture: clientOwnsAuthorityFence(client, coordinator) && typeof client?.captureAuthority === 'function'
      ? client.captureAuthority()
      : coordinator.capture(),
    durableAuthorityRestored: false,
  };
}

function captureForTransportValue(client, fallback, value) {
  return client?.authorityCaptureFor?.(value) ?? fallback;
}

async function compareContractCommit(client, coordinator, capture, commit) {
  if (!coordinator) return { committed: true, value: commit() };
  if (!capture) return { committed: false };
  if (
    clientOwnsAuthorityFence(client, coordinator)
    && typeof client?.commitAuthorityPublication === 'function'
  ) {
    return client.commitAuthorityPublication(capture, commit);
  }
  return coordinator.compareAndCommit(capture, commit);
}

// @ref LLP 0059#cross-context-ownership — isCurrent() is an in-memory hint
// only; a context that missed the wakeup must reload durable custody under
// ownership at every publication/lifecycle gate. This confirmer runs the
// coordinator's mandatory synchronize gate: when a peer durably settled a
// successor, the reload runs the local quiesce/blank barrier before any
// observer or mount can receive predecessor data. Failure is fail-closed and
// stays rejected so an awaited lifecycle gate cannot continue into dispatch;
// intentionally non-blocking hints attach their own rejection handler.
function createDurableAuthorityConfirmer(coordinator) {
  if (!coordinator || typeof coordinator.synchronize !== 'function') {
    return () => Promise.resolve();
  }
  let inFlight = null;
  return () => {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() => coordinator.synchronize())
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}

export function mountSnapbackContractHeadless(runtime, component, options = {}) {
  if (!runtime || typeof runtime.mount !== 'function') {
    throw new Error('mountSnapbackContractHeadless requires a Contract runtime with mount().');
  }
  if (!component) {
    throw new Error('mountSnapbackContractHeadless requires a compiled Contract component.');
  }
  const mountOptions = normalizeContractMountOptions(options);
  return wrapMountHandle(runtime.mount(component, mountOptions), { runtime, mountOptions });
}

export async function createSnapbackContractSurface({
  runtime,
  client,
  userId,
  // Explicit injection is useful for native/test clients; ordinary kit
  // callers expose the same instance as client.authCoordinator.
  authCoordinator = null,
  manifest,
  artifactIndex = null,
  schemaManifest = null,
  functionManifest = null,
  // LLP 0043 DK-9: async store contract for retained rows + monotonic queued
  // mutations. Configure memory in tests, localStorage/IndexedDB on web, and
  // SQLite on native. Omit it for the pre-offline Online-class behavior.
  clientStore = null,
  // LLP 0012's opaque retained cursor is (versionStreamId, version), scoped
  // by app/database and target. Generated artifacts supply app/target where
  // possible; callers may provide the database/reset-stream facts explicitly.
  retainedIdentity = null,
  // Single-query mode binds one named manifest query to one boundary key.
  // Both are app facts with no product default (LLP 0032 P5 removed the
  // todo-demo defaults this generic package used to ship); multi-query
  // surfaces pass `liveQueries` instead.
  queryName,
  boundaryKey,
  queryArgs = {},
  // Optimistic reducers are app logic (how this app's mutations transform
  // its rows during the in-flight window); the package ships none. Contract
  // (ENG-23385): a reducer MUST be idempotent — while its mutation is in
  // flight it is re-applied to every authoritative server-rows write, and
  // those rows may already contain the mutation's committed effect (the
  // server can commit and fan out before the mutate() response resolves).
  // Update/delete reducers keyed by row id are naturally idempotent; insert
  // reducers must skip appending when a committed match is already present —
  // ctx.baseVersion (the server rows' max durable version when the mutation
  // fired) distinguishes "my commit landed" from a pre-existing look-alike.
  optimisticReducers = {},
  // LLP 0034 D1 (Exact LLP 0284 §2.3): live descriptors bind with server push
  // by default; `livePush: false` opts the surface out (poll/reconcile only).
  livePush = true,
  // Maintained transport witnesses may disable the ordinary HTTP drain
  // fallback so an observed update proves socket delivery. Product callers
  // keep the resilient default.
  liveFallbackToPoll = true,
  connectionId = null,
  liveStreamOptions = {},
  onConnectionChange = null,
  onSubscriptionEvent = null,
  // Receipt stitching (LLP 0034 §3.2 / ENG-22478): the adapter owns the
  // Exact-runtime join keys. rootId identifies this mounted surface;
  // actionInvocationId / optimisticWaveId are supplied per-mutation once the
  // Exact LLP 0231 action log / LLP 0278 wave integration lands (TODO seam —
  // pass them via the correlation the runtime provides at that point).
  rootId = null,
  onReceipt = null,
  // Ephemeral wiring (ENG-22479): permissions per collection+scope, and the
  // zero-scope prewarm keeps the conformance gate's synchronous-snapshot
  // expectation honest.
  ephemeralPermissions = null,
  ephemeralIdleLingerMs = EPHEMERAL_IDLE_LINGER_MS,
  // Deterministic near-limit coverage only. Production callers omit this;
  // lifecycle identities otherwise start at zero.
  testLifecycleGenerationSeeds = null,
  // Multi-query mode (LLP 0034 §6 ownership row 3 — the All Aboard proof):
  // name the manifest's live queries to bind each over the shared stream with
  // its own boundary key and per-query connection axis. An entry is a name or
  // `{ name, args }` for scoped live queries (the graffiti wall's board-scoped
  // listCells). Legacy single-query options (queryName/boundaryKey/queryArgs/
  // optimisticReducers) do not apply.
  liveQueries = null,
  // Compiler/bootstrap-known bindings for the component being mounted. This
  // is separate from manifest.queries because one generated manifest can
  // serve multiple component entrypoints (for example Shindig feed/detail).
  // Every required binding must be configured before construction succeeds.
  requiredQueries = null,
  // LLP 0063 Step 1: make liveQueries a descriptor allowlist and open one
  // transport per binding-time logical key. Exact owns canonical identity,
  // deduplication, refcounts, and fencing. Legacy name-keyed/preopened mode
  // remains the default until published Exact packages carry that runtime.
  keyedQueryScopes = false,
  // Channel A preload lookup (LLP 0090 D2 rollout step 3): a
  // `(name, args) => ({ rows, resume } | null)` function over the inlined
  // boot payload (see @expo/snapback-client rqs-preload.mjs). Each multi-live
  // subscription passes its candidate to the kit's `preloadedResume` seam,
  // which verifies, arbitrates against Channel B state, renders the winner
  // retained-first, and subscribes with `resumeFromToken`.
  rqsPreload = null,
  // Channel C register-mode lookup (LLP 0090 D4 rollout step 7): a
  // `(name, args) => ({ subscriptionId, rows, version, resume } | null)`
  // function over a register-mode bundle response (see @expo/snapback-client
  // rqs-preload.mjs createRqsRegisteredRegistry). A hit is adopted through
  // the kit's `registeredSubscription` seam — the bundle snapshot is the
  // authoritative first state and NO fresh snapshot-with-subscribe is
  // opened; pass the bundle's `connection.connectionId` as `connectionId`
  // so the shared socket attaches under the bundle-minted grant.
  rqsRegistered = null,
}) {
  const lifecycleGenerationSeeds = normalizeTestLifecycleGenerationSeeds(
    testLifecycleGenerationSeeds,
  );
  const coordinator = resolveAuthCoordinator(client, authCoordinator);
  const clientFences = new Set([
    client?.authorityFence,
    client?.authCoordinator,
    client?.agentAuthority,
  ].filter(Boolean));
  if ([...clientFences].some((fence) => fence !== coordinator)) {
    const diagnostic = Object.freeze({
      code: 'SNAPBACK_CONTRACT_AUTH_COORDINATOR_MISMATCH',
      message: 'Contract and client transport authority fences must be one identity',
    });
    const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
    error.code = diagnostic.code;
    error.diagnostic = diagnostic;
    throw error;
  }
  const confirmDurableAuthority = createDurableAuthorityConfirmer(coordinator);
  let authorityCapture = null;
  let durableAuthorityRestored = false;
  let releaseDurableStoreRegistration = null;
  let unregisterSurfaceParticipant = null;
  const pending = new Set();
  const mountedHandles = new Set();
  const diagnostics = validateSnapbackContractArtifacts({
    manifest,
    artifactIndex,
    schemaManifest,
    functionManifest,
  });
  const stableDiagnosticCount = diagnostics.length;
  const blockingDiagnostic = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (blockingDiagnostic) {
    const error = new Error(blockingDiagnostic.message);
    error.diagnostic = blockingDiagnostic;
    throw error;
  }
  if (
    coordinator
    && clientStore
    && client?.agentAuthority === coordinator
    && coordinator.hasDurableCustody !== true
  ) {
    const diagnostic = contractDiagnostic(
      'SNAPBACK_CONTRACT_AGENT_DURABLE_CUSTODY_REQUIRED',
      'agent-backed offline replay requires transactional durable authority custody',
    );
    const error = new Error(diagnostic.message);
    error.code = diagnostic.code;
    error.diagnostic = diagnostic;
    throw error;
  }
  const surfaceRootId = rootId ?? defaultContractRootId();
  // Per-mutation overlay class (Exact LLP 0329 §E5 / EQ5): 'reducer'
  // (app-supplied), 'derived' (generated from the manifest-embedded IR plan),
  // or 'none' (pending-without-overlay). Populated when the surface builds
  // its mutation links; mutation receipts matching this surface's correlation
  // echo it so apps and LLP 0278 clauses can assert tier-appropriately.
  const mutationOverlayClass = Object.create(null);
  const enrichReceipt = (receipt) => {
    if (
      receipt?.kind === 'mutation'
      && typeof receipt.mutation === 'string'
      && receipt?.correlation?.rootId === surfaceRootId
      && mutationOverlayClass[receipt.mutation]
    ) {
      return { ...receipt, overlayClass: mutationOverlayClass[receipt.mutation] };
    }
    return receipt;
  };
  let detachReceiptListener = null;
  const attachReceiptListener = () => {
    if (!onReceipt || typeof client.onReceipt !== 'function' || detachReceiptListener) return;
    detachReceiptListener = client.onReceipt((receipt, publication = null) => {
      const enriched = enrichReceipt(receipt);
      // SnapbackClient invokes receipt listeners synchronously inside its final
      // authority publication callback. Re-entering AuthCoordinator here is
      // forbidden and used to drop every browser-custody receipt. Preserve
      // that already-held fence and deliver the app callback in the same turn.
      if (
        !coordinator
        || (
          publication?.authorityFenced === true
          && clientOwnsAuthorityFence(client, coordinator)
        )
      ) {
        onReceipt(enriched);
        return;
      }
      const capture = publication?.authorityCapture
        ?? captureForTransportValue(client, null, receipt);
      if (!capture) return;
      // Generic clients that do not advertise an already-held receipt fence
      // run the complete app effect inside the final durable comparison.
      void compareContractCommit(client, coordinator, capture, () => onReceipt(enriched))
        .then((outcome) => {
          if (!outcome.committed) {
            void confirmDurableAuthority().catch(() => {});
          }
        })
        .catch(() => {});
    });
  };
  let liveHandle = null;
  let ephemeralWiring = null;
  try {
    if (coordinator && clientStore) {
      releaseDurableStoreRegistration = await acquireDurableStoreRegistration(
        client,
        coordinator,
        clientStore,
      );
    }
    // Durable agent custody may be recovering a persisted clearing intent.
    // Register the physical store before synchronize/authSession so recovery
    // cannot settle the intent without replaying this store's commitDurable.
    ({ capture: authorityCapture, durableAuthorityRestored } = await bootContractAuthority(
      client,
      coordinator,
      { durableOffline: Boolean(clientStore && !Array.isArray(liveQueries)) },
    ));
    attachReceiptListener();
    if (coordinator && clientStore) {
      try {
        await clientStore.bindAuthority({
          authorityEpoch: authorityCapture.authorityEpoch,
          authorityKey: authorityCapture.authorityKey,
          authMode: coordinator.authority?.authMode ?? 'sessions',
        });
      } catch (error) {
        if (
          error?.code !== 'SNAPBACK_CLIENT_STORE_AUTHORITY_STALE'
          || typeof clientStore.authorityBindingCapture !== 'function'
        ) throw error;
        const binding = await clientStore.authorityBindingCapture();
        if (!binding.terminallyUnbound) throw error;
        // A terminal callback may win while an initially empty store is
        // between durable authority boot and its direct bind. Only an exact
        // still-current coordinator capture may consume that marker, and the
        // store-generation CAS prevents a terminal cut after this observation
        // from being rebound by the delayed adoption.
        const current = await compareContractCommit(
          client,
          coordinator,
          authorityCapture,
          () => undefined,
        );
        if (!current.committed) throw staleContractAuthorityError();
        await clientStore.transitionAuthority({
          expectedEpoch: authorityCapture.authorityEpoch,
          nextEpoch: authorityCapture.authorityEpoch,
          nextAuthorityKey: authorityCapture.authorityKey,
          expectedStoreGeneration: binding.storeGeneration,
        });
      }
      const bound = await compareContractCommit(client, coordinator, authorityCapture, () => undefined);
      if (!bound.committed) throw staleContractAuthorityError();
    }
    if (Array.isArray(liveQueries)) {
      if (keyedQueryScopes) {
        if (!livePush || typeof client.liveQuery !== 'function') {
          const error = new Error(
            'SNAPBACK_CONTRACT_KEYED_LIVE_TRANSPORT_REQUIRED: keyed query scopes currently require Snapback liveQuery push',
          );
          error.code = 'SNAPBACK_CONTRACT_KEYED_LIVE_TRANSPORT_REQUIRED';
          throw error;
        }
        if (clientStore) {
          const error = new Error(
            'SNAPBACK_CONTRACT_KEYED_OFFLINE_PENDING: keyed query scopes do not yet claim retained/offline behavior',
          );
          error.code = 'SNAPBACK_CONTRACT_KEYED_OFFLINE_PENDING';
          throw error;
        }
        const configured = new Set(liveQueries.map((entry) => (
          typeof entry === 'string' ? entry : entry?.name
        )));
        const requiredQueryNames = (requiredQueries ?? [])
          .map((entry) => typeof entry === 'string' ? entry : entry?.name);
        const requiredEphemeralNames = requiredQueryNames.filter((name) => (
          manifest?.queries?.[name]?.ephemeral === true
        ));
        const missingRequired = requiredQueryNames.filter((name) => (
          manifest?.queries?.[name]?.ephemeral !== true && !configured.has(name)
        ));
        if (missingRequired.length > 0) {
          const diagnostic = contractDiagnostic(
            'SNAPBACK_CONTRACT_QUERY_UNCONFIGURED',
            `Contract query bindings are required by the mounted component but omitted from keyed liveQueries: ${missingRequired.join(', ')}.`,
            { queries: missingRequired, configuredQueries: [...configured], configurationSurface: 'liveQueries' },
          );
          const error = new Error(diagnostic.message);
          error.code = diagnostic.code;
          error.diagnostic = diagnostic;
          throw error;
        }
        let disposed = false;
        let barrierPaused = false;
        let lifecycleTerminalError = null;
        let unregisterKeyedParticipant = null;
        let keyedDisposeTask = null;
        let keyed = null;
        let currentCapture = authorityCapture;
        let activeUserId = effectiveContractUserId(coordinator, null, userId);
        let resumeGeneration = lifecycleGenerationSeeds.resume ?? 0;
        let resumeTimer = null;
        let resumeTimerResolve = null;
        let resumeTask = Promise.resolve();
        const sharedConnectionId = connectionId ?? surfaceRootId;
        const surfaceDiagnostics = [...diagnostics];
        const cancelResumeTimer = () => {
          const settle = resumeTimerResolve;
          if (resumeTimer !== null) clearTimeout(resumeTimer);
          resumeTimer = null;
          resumeTimerResolve = null;
          settle?.();
        };
        const recordLifecycleDiagnostic = (error) => {
          const diagnostic = error?.diagnostic;
          if (!diagnostic) return;
          if (!surfaceDiagnostics.some((entry) => (
            entry.code === diagnostic.code
            && entry.details?.axis === diagnostic.details?.axis
          ))) surfaceDiagnostics.push(diagnostic);
        };
        const terminalizeKeyedSurfaceLifecycle = (error) => {
          if (lifecycleTerminalError) return;
          lifecycleTerminalError = error;
          barrierPaused = true;
          cancelResumeTimer();
          detachReceiptListener?.();
          detachReceiptListener = null;
          try {
            if (keyed && !keyed.authorityPaused) keyed.quiesceAuthority();
          } catch { /* the terminal error remains the surface refusal */ }
          try { ephemeralWiring?.blank?.(); } catch { /* fail closed */ }
          try { ephemeralWiring?.dispose?.(); } catch { /* fail closed */ }
          recordLifecycleDiagnostic(error);
        };
        const assertKeyedSurfaceActive = () => {
          if (lifecycleTerminalError) throw lifecycleTerminalError;
          if (disposed) throw new Error('Snapback Contract surface was used after dispose().');
          if (barrierPaused || (coordinator && !coordinator.isCurrent(currentCapture))) {
            throw staleContractAuthorityError();
          }
        };
        const operationCapture = () => {
          if (!coordinator) return null;
          if (barrierPaused) throw staleContractAuthorityError();
          return clientOwnsAuthorityFence(client, coordinator) && typeof client?.captureAuthority === 'function'
            ? client.captureAuthority()
            : coordinator.capture();
        };
        const commitCurrent = async (capture, commit) => {
          const outcome = await compareContractCommit(client, coordinator, capture, commit);
          if (!outcome.committed) {
            await confirmDurableAuthority();
            throw staleContractAuthorityError();
          }
          return outcome.value;
        };
        const preflightDurable = async (capture) => {
          if (!coordinator) return;
          await confirmDurableAuthority();
          const outcome = await compareContractCommit(
            client,
            coordinator,
            capture,
            () => undefined,
          );
          if (!outcome.committed) throw staleContractAuthorityError();
        };
        // The ephemeral lane takes its own connection, never the durable keyed
        // surface's. Sharing one connection across both lanes leaves every
        // predecessor durable subscription registered server-side forever after
        // a re-key: the ephemeral consumer holds connection demand, and the
        // durable unsubscribe is never delivered (proved on the pointing-room
        // contract-browser arm — 4 live subscriptions after a room switch, at
        // 10 s and still at 45 s; separate connections restore 2). The kit-level
        // question is issues/20260810-durable-unsubscribe-withheld-behind-shared-connection-demand.md;
        // this surface does not depend on its answer.
        const ephemeralConnectionId = defaultContractConnectionId();
        const buildKeyedEphemeralWiring = (capture, effectiveUserId) => buildEphemeralWiring({
          client,
          manifest,
          connectionId: ephemeralConnectionId,
          userId: effectiveUserId,
          ephemeralPermissions,
          ephemeralIdleLingerMs,
          authorityCapture: capture,
          commitAuthorityPublication: coordinator
            ? (candidate, commit) => compareContractCommit(client, coordinator, candidate, commit)
            : null,
          preflightAuthorityDispatch: coordinator
            ? (candidate) => preflightDurable(candidate)
            : null,
          onAuthorityRefused: () => {
            void confirmDurableAuthority().catch(() => {});
          },
          socketLossGenerationSeed: lifecycleGenerationSeeds.socketLoss ?? 0,
          onLifecycleTerminal: recordLifecycleDiagnostic,
        });

        try {
          // @ref LLP 0034#1011-keyed-contract-surfaces-serve-the-ephemeral-link-family-2026-08-10 — the keyed allowlist selects durable scopes; ephemeral bindings retain their separate generated read/publish family and barrier lifecycle.
          ephemeralWiring = createSwappableEphemeralWiring(
            buildKeyedEphemeralWiring(currentCapture, activeUserId),
            {
              generationSeed: lifecycleGenerationSeeds.ephemeralWiring ?? 0,
              onLifecycleTerminal: terminalizeKeyedSurfaceLifecycle,
            },
          );
          const manifestEphemeralNames = ephemeralWiring.descriptors.map(([name]) => name);
          const ephemeralsToServe = requiredEphemeralNames.length > 0
            ? requiredEphemeralNames
            : manifestEphemeralNames;
          if (ephemeralsToServe.length > 0 && !ephemeralWiring.supportsEphemeral) {
            const missingLinks = ephemeralsToServe.flatMap((name) => [name, `${name}Publish`]);
            const diagnostic = contractDiagnostic(
              'SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED',
              `Keyed Contract surface cannot serve ephemeral collections: ${ephemeralsToServe.join(', ')}. Missing generated link family: ${missingLinks.join(', ')}. The client must provide subscribeEphemeral() and liveStreamManager().`,
              {
                collections: ephemeralsToServe,
                missingLinks,
                missingClientCapabilities: ['subscribeEphemeral', 'liveStreamManager'],
              },
            );
            const error = new Error(diagnostic.message);
            error.code = diagnostic.code;
            error.diagnostic = diagnostic;
            throw error;
          }

          await ephemeralWiring.prewarm();
          keyed = createKeyedSnapbackContractProvider({
            runtime,
            client,
            manifest,
            userId: activeUserId,
            initialAuthorityCapture: currentCapture,
            keyedQueries: liveQueries,
            livePush,
            liveFallbackToPoll,
            connectionId: sharedConnectionId,
            liveStreamOptions,
            onConnectionChange,
            onSubscriptionEvent,
            ephemerals: ephemeralWiring.sources,
            rootId: surfaceRootId,
          });
          surfaceDiagnostics.push(...keyed.diagnostics);

          const links = {};
          for (const [name, link] of Object.entries(keyed.links)) {
            links[name] = (args) => {
              assertKeyedSurfaceActive();
              return link(args);
            };
          }
          const ephemeralLinks = ephemeralWiring.buildLinks(keyed.provider, runtime);
          for (const [name, link] of Object.entries(ephemeralLinks)) {
            if (!name.endsWith('Publish')) {
              links[name] = (args) => {
                assertKeyedSurfaceActive();
                return link(args);
              };
              continue;
            }
            links[name] = (args) => {
              assertKeyedSurfaceActive();
              const capture = operationCapture();
              const result = link(args);
              if (!coordinator) return result;
              return Promise.resolve(result).then(async (value) => {
                const resultCapture = captureForTransportValue(client, capture, value);
                return commitCurrent(resultCapture, () => value);
              });
            };
          }

          const advanceResumeGeneration = () => {
            try {
              resumeGeneration = nextContractLifecycleGeneration(
                resumeGeneration,
                'keyed-surface-resume',
              );
              return true;
            } catch (error) {
              terminalizeKeyedSurfaceLifecycle(error);
              return false;
            }
          };
          const scheduleAuthorityRefresh = (context) => {
            if (disposed || lifecycleTerminalError) return;
            const generation = resumeGeneration;
            resumeTask = new Promise((resolve) => {
              const settle = () => {
                if (resumeTimerResolve === settle) {
                  resumeTimer = null;
                  resumeTimerResolve = null;
                }
                resolve();
              };
              resumeTimerResolve = settle;
              resumeTimer = setTimeout(settle, 0);
            }).then(async () => {
              if (generation !== resumeGeneration || disposed || lifecycleTerminalError) return;
              currentCapture = context.capture;
              const authSession = context.authority?.kind === 'servicePrincipal'
                && typeof client.authSession === 'function'
                ? await client.authSession()
                : null;
              const successorUserId = effectiveContractUserId(
                coordinator,
                authSession,
                userId,
              );
              const ephemeralMayResume = ephemeralWiringMayResume(
                ephemeralWiring,
                context.authority,
              );
              if (ephemeralMayResume) {
                ephemeralWiring.prepare(buildKeyedEphemeralWiring(
                  context.capture,
                  successorUserId,
                ));
                await ephemeralWiring.prewarm();
              }
              if (
                generation !== resumeGeneration
                || disposed
                || lifecycleTerminalError
                || !coordinator.isCurrent(context.capture)
              ) return;
              const exposed = await compareContractCommit(
                client,
                coordinator,
                context.capture,
                () => {
                  if (
                    disposed
                    || lifecycleTerminalError
                    || generation !== resumeGeneration
                  ) return;
                  activeUserId = successorUserId;
                  keyed.resumeAuthority({
                    userId: activeUserId,
                    authorityCapture: context.capture,
                  });
                  if (ephemeralMayResume) ephemeralWiring.expose();
                  attachReceiptListener();
                  barrierPaused = false;
                },
              );
              if (!exposed.committed) throw staleContractAuthorityError();
            }).catch(() => {
              // Remain blank and paused until a later authority transition.
            });
          };

          if (coordinator) {
            unregisterKeyedParticipant = registerContractParticipant(client, coordinator, {
              name: `snapback-contract-keyed-surface:${surfaceRootId}`,
              quiesce() {
                barrierPaused = true;
                if (!advanceResumeGeneration()) return;
                cancelResumeTimer();
                detachReceiptListener?.();
                detachReceiptListener = null;
                try {
                  keyed.quiesceAuthority();
                } finally {
                  ephemeralWiring?.quiesce?.();
                }
              },
              blank() {
                if (disposed) return;
                ephemeralWiring?.blank?.();
              },
              clearMemory() {},
              async commitDurable() {},
              async resume(context) {
                currentCapture = context.capture;
                if (lifecycleTerminalError || disposed) return;
                if (client?.authCoordinator === coordinator) await coordinator.synchronize();
                scheduleAuthorityRefresh(context);
              },
            });
            const current = await compareContractCommit(
              client,
              coordinator,
              currentCapture,
              () => undefined,
            );
            if (!current.committed) throw staleContractAuthorityError();
          }

          return {
            adapterVersion: SNAPBACK_CONTRACT_ADAPTER_VERSION,
            capabilityClass: SNAPBACK_CONTRACT_CAPABILITY_CLASS,
            links,
            provider: keyed.provider,
            diagnostics: surfaceDiagnostics,
            pendingCount: () => 0,
            declaredQueries: Object.keys(manifest?.queries ?? {}),
            declaredMutations: Object.keys(manifest?.mutations ?? {}),
            livePush: true,
            liveQueries: [...configured],
            rootId: surfaceRootId,
            receipts: () => typeof client.receipts === 'function' ? client.receipts() : [],
            ephemeralSourceStarts: ephemeralWiring.sourceStarts,
            prewarmEphemeral: ephemeralWiring.prewarmScope,
            connection: () => null,
            connections: () => ({}),
            rotateAuthority: (next) => keyed.rotateAuthority(next),
            mount: (component, options = {}) => {
              void confirmDurableAuthority().catch(() => {});
              assertKeyedSurfaceActive();
              const handle = mountSnapbackContractHeadless(runtime, component, options);
              return rememberMountHandle(mountedHandles, handle);
            },
            flush: async () => {
              await resumeTask;
            },
            dispose: () => {
              if (keyedDisposeTask) return keyedDisposeTask;
              disposed = true;
              barrierPaused = true;
              cancelResumeTimer();
              ephemeralWiring.dispose();
              keyed.dispose();
              detachReceiptListener?.();
              detachReceiptListener = null;
              for (const handle of [...mountedHandles]) handle.dispose();
              mountedHandles.clear();
              const unregister = unregisterKeyedParticipant?.();
              unregisterKeyedParticipant = null;
              const releaseStore = releaseDurableStoreRegistration?.();
              releaseDurableStoreRegistration = null;
              keyedDisposeTask = Promise.all([unregister, releaseStore].filter(Boolean));
              return keyedDisposeTask;
            },
          };
        } catch (error) {
          try { keyed?.dispose?.(); } catch { /* preserve construction error */ }
          try { ephemeralWiring?.dispose?.(); } catch { /* preserve construction error */ }
          try { await unregisterKeyedParticipant?.(); } catch { /* preserve construction error */ }
          unregisterKeyedParticipant = null;
          throw error;
        }
      }
      return await createMultiLiveContractSurface({
        runtime,
        client,
        userId,
        coordinator,
        authorityCapture,
        manifest,
        clientStore,
        liveQueries,
        requiredQueries,
        livePush,
        liveFallbackToPoll,
        connectionId,
        liveStreamOptions,
        onConnectionChange,
        onSubscriptionEvent,
        rootId: surfaceRootId,
        detachReceiptListener: () => {
          detachReceiptListener?.();
          detachReceiptListener = null;
        },
        attachReceiptListener,
        releaseStoreRegistration: releaseDurableStoreRegistration,
        ephemeralPermissions,
        ephemeralIdleLingerMs,
        lifecycleGenerationSeeds,
        diagnostics,
        pending,
        mountedHandles,
        rqsPreload,
        rqsRegistered,
      });
    }
    if (!queryName || !boundaryKey) {
      const diagnostic = contractDiagnostic(
        'SNAPBACK_CONTRACT_SURFACE_BINDING_REQUIRED',
        'createSnapbackContractSurface requires queryName and boundaryKey in single-query mode (or liveQueries: [...] for a multi-query surface).',
        { queryName: queryName ?? null, boundaryKey: boundaryKey ?? null },
      );
      const error = new Error(diagnostic.message);
      error.diagnostic = diagnostic;
      throw error;
    }
    // The adapter-stitched correlation (LLP 0034 §3.2): echoed verbatim on
    // every receipt this surface's operations produce.
    const surfaceCorrelation = { rootId: surfaceRootId, bindingIds: [boundaryKey] };
    const surfaceConnectionId = connectionId ?? defaultContractConnectionId();
    let optimisticSeq = 0;
    let disposed = false;
    let barrierPaused = false;
    let barrierBlanking = false;
    let barrierPreparing = false;
    let activeUserId = effectiveContractUserId(coordinator, null, userId);
    const queryNames = Object.keys(manifest?.queries ?? {});
    const mutationNames = Object.keys(manifest?.mutations ?? {});
    const boundQueryNames = new Set([queryName]);
    const publishDiagnostic = (code, message, details = {}) => {
      const diagnostic = contractDiagnostic(code, message, details);
      diagnostics.push(diagnostic);
      return diagnostic;
    };
    // The C1 fix (LLP 0034 D1; Exact LLP 0284 §5.3): when the bound descriptor
    // is live (manifest v2 `mode`/`defaultLive`, or the legacy `subscription`
    // field), the surface subscribes over the kit's stream transport and pushes
    // server-authored rows into the Contract boundary as they arrive — no
    // app-code pump. The initial rows come from the same snapshot-with-subscribe
    // operation, so there is no prime race. Non-live descriptors keep the
    // pre-D1 behavior: one snapshot read plus reconcile-on-mutate.
    const boundDescriptor = manifest?.queries?.[queryName] ?? null;
    const descriptorIsLive = Boolean(
      boundDescriptor
        && (boundDescriptor.mode === 'live' || boundDescriptor.subscription === 'initial-snapshot')
        && boundDescriptor.defaultLive !== false,
    );
    const wantLivePush = livePush && descriptorIsLive && typeof client.liveQuery === 'function';
    const boundTable = boundDescriptor?.reads?.[0] ?? null;
    const derivedReducers = deriveOptimisticReducers({
      manifest,
      table: boundTable,
      onError: publishDiagnostic,
    });
    // Durable queue replay is authorized by the server plan. Optimistic
    // overlay availability is a separate axis: atomic-withholding mutations
    // intentionally have no derived reducer, but a plan-backed descriptor can
    // still restore and submit the queued mutation after restart.
    const everyMutationReplayable = mutationNames.length > 0
      && mutationNames.every((name) => manifest?.mutations?.[name]?.plan !== undefined);
    const storeIdentity = {
      appId: retainedIdentity?.appId
        ?? artifactIndex?.appId
        ?? schemaManifest?.appId
        ?? functionManifest?.appId
        ?? manifest?.appId
        ?? null,
      databaseId: retainedIdentity?.databaseId
        ?? client?.databaseId
        ?? null,
      targetProfileId: retainedIdentity?.targetProfileId
        ?? schemaManifest?.targetProfileId
        ?? schemaManifest?.targetProfile
        ?? manifest?.targetProfileId
        ?? null,
      versionStreamId: retainedIdentity?.versionStreamId
        ?? client?.versionStreamId
        ?? null,
    };
    const retainedIdentityComplete = Object.values(storeIdentity)
      .every((value) => typeof value === 'string' && value.length > 0);
    const retainedQueryEligible = Boolean(
      clientStore
      && descriptorIsLive
      && manifest?.capabilities?.offlineReplay === true
    );
    const offlineReplayEligible = retainedQueryEligible && everyMutationReplayable;
    // Retained reads and queued writes are independent authorization axes.
    // Sessions-mode replay requires the exact current descriptor, while only
    // the exact AuthorizedLease capability enables session retention.
    // @ref LLP 0039#replay-parity-and-the-authority-instance-id — principal
    // scope and authority-instance scope fence different durable material.
    let coordinatedSessionsMode = coordinator?.authority?.authMode === 'sessions';
    if (retainedQueryEligible && !retainedIdentityComplete) {
      publishDiagnostic(
        'SNAPBACK_RETAINED_IDENTITY_INCOMPLETE',
        'Offline retention requires appId, databaseId, targetProfileId, and versionStreamId; retained rows and queued writes are disabled.',
        { identity: storeIdentity, severity: 'warning' },
      );
    }
    let storeAuthFingerprint = snapbackAuthFingerprint(activeUserId ?? null);
    const storeQueryKey = retainedQueryKey(queryName, queryArgs);
    const storeExpectation = {
      authFingerprint: storeAuthFingerprint,
      schemaHash: schemaManifest?.schemaHash ?? manifest?.schemaHash ?? null,
      inputsHash: manifest?.inputsHash ?? null,
      ...storeIdentity,
      ...(authorityCapture
        ? {
            authorityEpoch: authorityCapture.authorityEpoch,
            authorityKey: authorityCapture.authorityKey,
          }
        : {}),
    };
    const storeAuthorityCapture = {
      ...(Number.isSafeInteger(storeExpectation.authorityEpoch)
        ? {
            authorityEpoch: storeExpectation.authorityEpoch,
            authorityKey: storeExpectation.authorityKey,
          }
        : {}),
    };
    // @ref LLP 0058#kit-ordering — a cold offline boot reads the last durable
    // mode/authorization tuple before attempting discovery. That tuple can
    // authorize only lease-validated retained bytes; it never admits online
    // work or queued replay.
    const durableStoreAuthorizationCandidate = durableAuthorityRestored
      && (offlineReplayEligible || retainedQueryEligible)
      && typeof clientStore?.authorizationScope === 'function'
      ? await clientStore.authorizationScope(storeAuthorityCapture)
      : null;
    const durableStoreAuthorization = durableStoreAuthorizationCandidate?.principalScope?.authMode
      === 'sessions'
      && durableStoreAuthorizationCandidate?.authorityDescriptor?.descriptorVersion === 1
      ? durableStoreAuthorizationCandidate
      : null;
    let authSession = null;
    let authSessionUnavailable = false;
    if (coordinatedSessionsMode && typeof client.authSession === 'function') {
      try {
        authSession = await client.authSession();
      } catch (error) {
        if (!durableAuthorityRestored || !isUnavailableAuthTransport(error)) throw error;
        authSessionUnavailable = true;
      }
    }
    activeUserId = effectiveContractUserId(coordinator, authSession, userId);
    storeAuthFingerprint = snapbackAuthFingerprint(activeUserId ?? null);
    storeExpectation.authFingerprint = storeAuthFingerprint;
    let storeAuthorization = null;
    if (offlineReplayEligible || retainedQueryEligible) {
      storeAuthorization = (
        !coordinatedSessionsMode
        || authSession !== null
      ) && typeof client.currentAuthorizationScope === 'function'
        ? await client.currentAuthorizationScope({ devUserId: userId ?? null })
        : durableStoreAuthorization;
    }
    const sessionQueueCapable = Boolean(
      coordinatedSessionsMode
      && authSession?.availability?.queuedReplay?.available === true
      && offeredProtocolEchoV1(client, authSession, 'authorityDescriptor')
      && storeAuthorization?.authorityDescriptor?.descriptorVersion === 1
    );
    let authorizedLeaseFacts = null;
    if (
      coordinatedSessionsMode
      && authSession?.availability?.retainedReads?.available === true
      && offeredProtocolEchoV1(client, authSession, 'authInvalidation')
      && offeredProtocolEchoV1(client, authSession, 'authorizedLease')
    ) {
      try {
        authorizedLeaseFacts = validateAuthorizedLeaseCapability(authSession.authorizedLease);
      } catch (error) {
        publishDiagnostic(
          'SNAPBACK_AUTHORIZED_LEASE_CLIENT_UNSUPPORTED',
          error instanceof Error ? error.message : String(error),
          { query: queryName, severity: 'warning' },
        );
      }
    }
    const functionDescriptor = functionManifest?.functions?.find?.(
      (entry) => entry?.name === queryName || entry?.exportedName === queryName,
    ) ?? null;
    const authorizationDependence = boundDescriptor?.authorizationDependence
      ?? functionDescriptor?.authorizationDependence
      ?? [];
    const retainableUserOnly = boundDescriptor?.retainable === true
      && JSON.stringify([...authorizationDependence].sort()) === '["userId"]';
    const activationIdentity = {
      schemaVersion: schemaManifest?.schemaVersion
        ?? artifactIndex?.schemaVersion
        ?? manifest?.schemaVersion
        ?? null,
      authMode: 'sessions',
      appId: storeIdentity.appId,
      schemaHash: storeExpectation.schemaHash,
      bundleHash: functionManifest?.bundleHash
        ?? artifactIndex?.bundleHash
        ?? manifest?.bundleHash
        ?? null,
      inputsHash: functionManifest?.inputsHash
        ?? schemaManifest?.inputsHash
        ?? artifactIndex?.inputsHash
        ?? manifest?.inputsHash
        ?? null,
    };
    const activationIdentityComplete = Object.values(activationIdentity)
      .every((value) => typeof value === 'string' && value.length > 0);
    const durableAuthorizedQuery = Boolean(authSessionUnavailable
      && storeAuthorization?.principalScope?.authMode === 'sessions'
      && storeAuthorization?.queryAuthorization
      && Object.hasOwn(storeAuthorization.queryAuthorization, storeQueryKey));
    let offlineReplayEnabled = offlineReplayEligible
      && retainedIdentityComplete
      && (!coordinatedSessionsMode || sessionQueueCapable);
    let retainedReadsEnabled = retainedQueryEligible
      && retainedIdentityComplete
      && (
        !coordinatedSessionsMode
        || Boolean(
          (authorizedLeaseFacts || durableAuthorizedQuery)
          && retainableUserOnly
          && activationIdentityComplete
          && typeof activeUserId === 'string'
          && storeAuthorization?.principalScope?.userId === activeUserId
          && typeof client.authorizedLeaseQuery === 'function'
          && typeof client.connectionGrant === 'function'
          && typeof clientStore.initializeAuthorizedRetainedQuery === 'function'
          && typeof clientStore.beginAuthorizedLeaseRequest === 'function'
          && typeof clientStore.commitAuthorizedRetainedSnapshot === 'function'
          && typeof clientStore.getAuthorizedRetainedQuery === 'function'
        )
      );
    if (coordinatedSessionsMode && retainedQueryEligible && !retainedReadsEnabled) {
      publishDiagnostic(
        'SNAPBACK_AUTHORIZED_RETENTION_UNAVAILABLE',
        'Session retention requires a userId-only retainable live query, exact item-6/item-8 negotiation, and complete activation identity.',
        {
          query: queryName,
          retainableUserOnly,
          activationIdentityComplete,
          retainedReadsAvailable: authSession?.availability?.retainedReads?.available === true
            || durableAuthorizedQuery,
          severity: 'warning',
        },
      );
    }
    if (clientStore) {
      if (
        authSession !== null
        && storeAuthorization
        && typeof clientStore.scopeAuthorization === 'function'
      ) {
        await clientStore.scopeAuthorization(storeAuthorization, storeAuthorityCapture);
      }
      await clientStore.scopeToAuth(storeAuthFingerprint, storeAuthorityCapture);
      await clientStore.scopeToArtifacts({
        schemaHash: storeExpectation.schemaHash,
        inputsHash: storeExpectation.inputsHash,
        targetProfileId: storeExpectation.targetProfileId,
        appId: storeExpectation.appId,
        databaseId: storeExpectation.databaseId,
        versionStreamId: storeExpectation.versionStreamId,
      }, storeAuthorityCapture);
    }
    let authorizedActivationHash = null;
    let authorizedQueryNamespace = null;
    let authorizedQueryFence = null;
    let retained = null;
    if (coordinatedSessionsMode && retainedReadsEnabled) {
      authorizedActivationHash = authorizedLeaseActivationHash(activationIdentity);
      try {
        const captured = await clientStore.captureAuthorizedRetainedQuery(
          storeQueryKey,
          storeAuthorityCapture,
        );
        authorizedQueryNamespace = captured.namespace;
        authorizedQueryFence = captured.fence;
      } catch (error) {
        if (error?.code !== 'SNAPBACK_AUTH_QUERY_FENCE_STALE') throw error;
      }
    }
    let durablePendingCount = 0;
    let retainedOffline = false;
    // @ref LLP 0081#6-compatibility-and-deployment-ordering — the surface's
    // observable migration-boundary state. Non-null exactly while queued
    // work is quarantined behind a schema publication: `resync-required`
    // clears when the refused record settles through resync-before-replay
    // (same clientMutationId, baselines refreshed from the successor
    // snapshot — the server settlement contract); `upgrade-required` is
    // stable for the lifetime of this artifact-bound surface, holding the
    // queue intact without retry storms or failed-settles. Payload custody
    // across the artifact upgrade itself is the client store's committed
    // privacy boundary (`scopeToArtifacts`): the successor surface receives
    // explicit redacted `SNAPBACK_CLIENT_ARTIFACT_STALE` tombstones for app
    // re-entry — never silent loss, and never blind cross-artifact replay
    // (mutation-wire artifact identity is the LLP 0093-lane successor).
    let migrationBoundary = null;
    const rebaselineMutationIds = new Set();
    const enterMigrationBoundary = (kind, error, details = {}) => {
      const code = error?.diagnostic?.code ?? error?.code ?? null;
      if (migrationBoundary?.kind !== kind) {
        publishDiagnostic(code ?? 'SNAPBACK_MIGRATION_BOUNDARY', (
          error?.diagnostic?.message
          ?? (error instanceof Error ? error.message : String(error))
        ), { boundary: kind, ...details });
      }
      migrationBoundary = { kind, code, since: Date.now(), ...details };
    };
    const clearMigrationBoundary = () => {
      migrationBoundary = null;
      rebaselineMutationIds.clear();
    };
    let lastServerVersion = 0;
    const initialMutationQueueCapture = offlineReplayEnabled
      ? await clientStore.captureMutationQueue({
          authorityEpoch: storeExpectation.authorityEpoch,
          authorityKey: storeExpectation.authorityKey,
        })
      : {};
    const restoredPending = offlineReplayEnabled
      ? await clientStore.pendingMutations({
          ...storeExpectation,
          ...initialMutationQueueCapture,
        })
      : [];
    durablePendingCount = restoredPending.length;

    let boundary = null;
    const liveCellObservers = new Set();
    ephemeralWiring = createSwappableEphemeralWiring(buildEphemeralWiring({
      client,
      manifest,
      connectionId: surfaceConnectionId,
      userId: activeUserId,
      ephemeralPermissions,
      ephemeralIdleLingerMs,
      authorityCapture,
      commitAuthorityPublication: coordinator
        ? (capture, commit) => compareContractCommit(client, coordinator, capture, commit)
        : null,
      preflightAuthorityDispatch: coordinator
        ? (capture) => preflightDurable(capture)
        : null,
      onAuthorityRefused: () => {
        void confirmDurableAuthority().catch(() => {});
      },
      socketLossGenerationSeed: lifecycleGenerationSeeds.socketLoss ?? 0,
      onLifecycleTerminal: (error) => {
        if (!diagnostics.some((entry) => (
          entry.code === error.code
          && entry.details?.axis === error.diagnostic.details.axis
        ))) diagnostics.push(error.diagnostic);
      },
    }), {
      generationSeed: lifecycleGenerationSeeds.ephemeralWiring ?? 0,
      onLifecycleTerminal: (error) => terminalizeSurfaceLifecycle(error),
    });

    // In-flight optimistic mutations (LLP 0034 review fix 3): with live push, a
    // concurrent live_replace can arrive DURING a local mutation's in-flight
    // window carrying authoritative rows that legitimately lack the optimistic
    // row (it is not committed yet) at a valid higher version — so version
    // checks cannot help. Every boundary write of server rows re-applies the
    // still-in-flight optimistic reducers on top, so the user's own row never
    // flashes out. The dual hazard (ENG-23385): those server rows may already
    // CONTAIN the mutation's committed row (the server can commit and fan out
    // before the mutate() response resolves — own live_replace racing the HTTP
    // response, or a concurrent mutation's reconcile), so reducers are spec'd
    // idempotent and each op records baseVersion at mutation time so insert
    // reducers can recognize their own landed commit. Interim until D2
    // receipts correlate fan-outs to mutations. Successful settlement now
    // records the response's committed version on the op; the op remains here
    // until this subscription observes and applies server version >= it.
    // @ref LLP 0200#21-settlement-is-decoupled-from-subscriber-work — release
    //   is watermark-gated and occurs after the gating server frame applies.
    const inFlightOptimistic = new Set();

    // The highest durable commit version among the given server rows (0 when
    // none carries one). Recorded per-op when its mutation fires: a committed
    // row matching an insert reducer's args at a version ABOVE the op's
    // baseVersion is the mutation's own landed commit (or an equivalent
    // concurrent one), not a pre-existing look-alike row (ENG-23385).
    const maxServerRowVersion = (rows) => {
      let max = 0;
      for (const row of rows ?? []) {
        if (typeof row?._version === 'number' && row._version > max) max = row._version;
      }
      return max;
    };

    // Last authoritative server rows (ENG-23384): when a reconcile after a
    // failed mutation cannot reach the server either (same outage, usually),
    // these are the local rollback source — otherwise the boundary keeps the
    // failed mutation's optimistic row as ready data with no overlay pass
    // owning it (non-live mode never rewrites the boundary again on its own).
    let lastServerRows = [];
    let queryAuthorizationHidden = false;

    const isServerVersion = (version) => (
      Number.isSafeInteger(version) && version >= 0
    );

    const convergedOptimisticOps = (
      observedVersion,
      { releaseVersionlessSettlements = false } = {},
    ) => {
      const convergedOps = new Set();
      for (const op of inFlightOptimistic) {
        const converged = isServerVersion(op.committedVersion)
          && isServerVersion(observedVersion)
          && observedVersion >= op.committedVersion;
        if (converged || (releaseVersionlessSettlements && op.settledWithoutVersion === true)) {
          convergedOps.add(op);
        }
      }
      return convergedOps;
    };

    const releaseConvergedOptimistic = (convergedOps) => {
      for (const op of convergedOps) inFlightOptimistic.delete(op);
    };

    const markOptimisticSettled = (optimisticOp, output) => {
      if (!optimisticOp) return;
      if (isServerVersion(output?.version)) {
        optimisticOp.committedVersion = output.version;
      } else {
        // Compatibility for non-protocol test/legacy clients that omit the
        // contractual mutation version: only the mandatory post-settlement
        // reconcile may release this op, after applying its authoritative pull.
        optimisticOp.settledWithoutVersion = true;
      }
    };

    const markOptimisticMutationSettled = (mutationId, output) => {
      for (const op of inFlightOptimistic) {
        if (op.mutationId === mutationId) markOptimisticSettled(op, output);
      }
    };

    const applyOptimisticOverlay = (rows, excludedOps = null) => {
      let out = rows;
      for (const op of inFlightOptimistic) {
        if (excludedOps?.has(op)) continue;
        let ledgerCursor = 0;
        const ledgerRuntimeId = op.ctxLedger
          ? () => {
              const id = op.ctxLedger.ids[ledgerCursor++];
              if (id !== undefined) return id;
              const error = new Error('optimistic replay consumed past its captured id ledger');
              error.code = 'SNAPBACK_CTX_LEDGER_EXHAUSTED';
              throw error;
            }
          : null;
        const ctx = {
          userId: activeUserId,
          optimisticId: op.optimisticId,
          baseVersion: op.baseVersion,
          nowMs: op.ctxLedger?.now,
          runtimeId: ledgerRuntimeId,
        };
        if (op.ledgerReducer && op.reducer !== op.ledgerReducer) {
          op.ledgerReducer(out, op.args, ctx);
        }
        out = op.reducer(out, op.args, {
          ...ctx,
          runtimeId: op.reducer === op.ledgerReducer ? ledgerRuntimeId : null,
        });
      }
      return out;
    };

    const expectationForCapture = (capture = authorityCapture) => ({
      ...storeExpectation,
      authFingerprint: storeAuthFingerprint,
      ...(capture
        ? { authorityEpoch: capture.authorityEpoch, authorityKey: capture.authorityKey }
        : {}),
    });
    const authorityExpectation = (capture = authorityCapture) => capture
      ? { authorityEpoch: capture.authorityEpoch, authorityKey: capture.authorityKey }
      : {};
    const captureMutationQueue = (capture = authorityCapture) => (
      clientStore.captureMutationQueue(authorityExpectation(capture))
    );
    const operationCapture = () => {
      if (!coordinator) return null;
      if (barrierPaused) throw staleContractAuthorityError();
      return clientOwnsAuthorityFence(client, coordinator) && typeof client?.captureAuthority === 'function'
        ? client.captureAuthority()
        : coordinator.capture();
    };
    const commitCurrent = async (capture, commit) => {
      const outcome = await compareContractCommit(client, coordinator, capture, commit);
      if (!outcome.committed) {
        await confirmDurableAuthority();
        throw staleContractAuthorityError();
      }
      return outcome.value;
    };
    const preflightDurable = async (capture) => {
      if (!coordinator) return;
      // @ref LLP 0059#cross-context-ownership — generic app-data dispatch
      // cannot use a process-local authority hint after a missed peer wakeup.
      // A compare failure proves only that this capture cannot commit. Reload
      // first so a missed cross-context wakeup also drives the local
      // quiesce/blank barrier before any transport is allowed to start.
      await confirmDurableAuthority();
      const outcome = await compareContractCommit(client, coordinator, capture, () => undefined);
      if (!outcome.committed) throw staleContractAuthorityError();
    };

    const retainedRecord = (rows, version, capture = authorityCapture) => {
      const expectation = expectationForCapture(capture);
      return {
        rows,
        version,
        cursor: { stream: expectation.versionStreamId, version },
        ...expectation,
      };
    };

    const ensureAuthorizedQueryOnline = async (capture = authorityCapture) => {
      if (!coordinatedSessionsMode || !retainedReadsEnabled) return null;
      const predecessorNamespace = authorizedQueryNamespace;
      if (coordinator) await preflightDurable(capture);
      const grant = await client.connectionGrant(surfaceConnectionId);
      const grantCapture = captureForTransportValue(client, capture, grant);
      await preflightDurable(grantCapture);
      const projection = grant.authorizationInvalidation;
      if (!projection) {
        const error = new Error(
          'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED: connection grant lacks the negotiated authorization expectation',
        );
        error.code = 'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED';
        throw error;
      }
      const initialized = await clientStore.initializeAuthorizedRetainedQuery(
        storeQueryKey,
        {
          authorization: projection.authorization,
          issuerId: projection.issuerId,
          versionStream: projection.versionStream,
          principalId: activeUserId,
          activationHash: authorizedActivationHash,
          appId: storeIdentity.appId,
          targetProfileId: storeIdentity.targetProfileId,
        },
        authorityExpectation(grantCapture),
      );
      authorizedQueryNamespace = initialized.namespace;
      authorizedQueryFence = initialized.fence;
      if (
        predecessorNamespace
        && predecessorNamespace.queryInstanceId !== initialized.namespace.queryInstanceId
      ) {
        // A fresh authenticated expectation replaced the offline instance.
        // Its deleted predecessor bytes cannot become a fallback merely
        // because the subsequent full revalidation loses connectivity.
        retained = null;
      }
      return initialized;
    };

    const renewAuthorizedSnapshot = async (capture = authorityCapture) => {
      await ensureAuthorizedQueryOnline(capture);
      const startedClientMs = Date.now();
      const leaseRequestId = createClientMutationId('lease');
      const reservation = await clientStore.beginAuthorizedLeaseRequest(
        storeQueryKey,
        {
          fence: authorizedQueryFence,
          leaseRequestId,
          clientNowMs: startedClientMs,
        },
        authorityExpectation(capture),
      );
      authorizedQueryFence = reservation.fence;
      if (coordinator) await preflightDurable(capture);
      const response = await client.authorizedLeaseQuery(queryName, {
        args: queryArgs,
        userId: activeUserId,
        leaseRequestId,
        authorizationNamespace: authorizedQueryNamespace,
        authorityCapture: capture,
      });
      const resultCapture = captureForTransportValue(client, capture, response);
      await preflightDurable(resultCapture);
      const version = response.version ?? maxServerRowVersion(response.rows);
      const committed = await clientStore.commitAuthorizedRetainedSnapshot(
        storeQueryKey,
        {
          fence: authorizedQueryFence,
          lease: response.authorizedLease,
          record: retainedRecord(response.rows, version, resultCapture),
          clientNowMs: Date.now(),
        },
        authorityExpectation(resultCapture),
      );
      authorizedQueryFence = committed.fence;
      return {
        rows: response.rows,
        version,
        capture: resultCapture,
      };
    };

    let authorizationRenewalTail = Promise.resolve();
    const scheduleAuthorizedRenewal = (capture = authorityCapture) => {
      if (!coordinatedSessionsMode || !retainedReadsEnabled) return authorizationRenewalTail;
      authorizationRenewalTail = authorizationRenewalTail.then(async () => {
        if (disposed || barrierPaused || (coordinator && !coordinator.isCurrent(capture))) return;
        const renewed = await renewAuthorizedSnapshot(capture);
        const overlaid = applyOptimisticOverlay(renewed.rows);
        await commitCurrent(renewed.capture, () => {
          lastServerRows = renewed.rows;
          lastServerVersion = renewed.version;
          queryAuthorizationHidden = false;
          retainedOffline = false;
          if (!disposed && boundary) boundary.write(boundaryKey, () => overlaid);
        });
      }).catch((error) => {
        if (!coordinator || coordinator.isCurrent(capture)) {
          publishDiagnostic(
            'SNAPBACK_AUTHORIZED_LEASE_RENEWAL_FAILED',
            error instanceof Error ? error.message : String(error),
            { query: queryName },
          );
        }
      });
      return authorizationRenewalTail;
    };

    const authorizedQueryController = () => (
      coordinatedSessionsMode && retainedReadsEnabled && authorizedQueryFence
        ? {
            async applyObligation(obligation) {
              const result = await clientStore.receiveRetainedQueryObligation(
                storeQueryKey,
                obligation,
                authorizedQueryFence,
                authorityExpectation(authorityCapture),
              );
              authorizedQueryFence = result.fence;
              return result;
            },
            async prepareResolution(resolution, snapshot) {
              const result = await clientStore.applyRetainedQueryResolution(
                storeQueryKey,
                {
                  fence: authorizedQueryFence,
                  resolution,
                  record: resolution.kind === 'terminalDelete'
                    ? null
                    : retainedRecord(snapshot.rows, snapshot.version, authorityCapture),
                },
                authorityExpectation(authorityCapture),
              );
              authorizedQueryFence = result.fence;
              return result;
            },
            async retireScopes(retired, snapshot) {
              const result = await clientStore.retireRetainedQueryScopes(
                storeQueryKey,
                {
                  fence: authorizedQueryFence,
                  retired,
                  record: retainedRecord(snapshot.rows, snapshot.version, authorityCapture),
                },
                authorityExpectation(authorityCapture),
              );
              authorizedQueryFence = result.fence;
              scheduleAuthorizedRenewal(authorityCapture);
              return result;
            },
            acknowledged() {
              scheduleAuthorizedRenewal(authorityCapture);
            },
          }
        : null
    );

    let retainedWriteTail = Promise.resolve();
    const retainRows = (rows, version = maxServerRowVersion(rows), capture = authorityCapture) => {
      if (!retainedReadsEnabled) return retainedWriteTail;
      const record = retainedRecord(rows, version, capture);
      // Serialize per surface/query key. A slower older persistence call can
      // never finish after and overwrite a newer version; the store also
      // compare-and-sets by (stream, version) for cross-instance races.
      retainedWriteTail = retainedWriteTail
        .then(async () => {
          await preflightDurable(capture);
          if (coordinatedSessionsMode) {
            if (!authorizedQueryFence) return null;
            const retained = await clientStore.putAuthorizedRetainedQuery(
              storeQueryKey,
              {
                fence: authorizedQueryFence,
                record,
                clientNowMs: Date.now(),
              },
              authorityExpectation(capture),
            );
            authorizedQueryFence = retained.fence;
            return retained;
          }
          return clientStore.putRetainedQuery(storeQueryKey, record);
        })
        .catch((error) => {
          if (!coordinator || coordinator.isCurrent(capture)) {
            publishDiagnostic(
              'SNAPBACK_CLIENT_STORE_WRITE_FAILED',
              error instanceof Error ? error.message : String(error),
              { query: queryName },
            );
          }
        });
      return retainedWriteTail;
    };

    const writeServerRows = (
      rows,
      version = maxServerRowVersion(rows),
      capture = authorityCapture,
      releaseOptions = {},
    ) => {
      const resolvedVersion = version ?? maxServerRowVersion(rows);
      if (
        isServerVersion(resolvedVersion)
        && isServerVersion(lastServerVersion)
        && resolvedVersion < lastServerVersion
      ) return lastServerRows;
      const convergedOps = convergedOptimisticOps(resolvedVersion, releaseOptions);
      // Reducers are app code and may mutate their input. Compute the
      // post-release view from an isolated authoritative copy before applying
      // the still-registered overlay to the gating frame itself.
      const releasedView = convergedOps.size > 0
        ? applyOptimisticOverlay(JSON.parse(JSON.stringify(rows)), convergedOps)
        : null;
      const overlaid = applyOptimisticOverlay(rows);
      lastServerRows = rows;
      lastServerVersion = resolvedVersion;
      if (!disposed && boundary && !queryAuthorizationHidden) {
        boundary.write(boundaryKey, () => overlaid);
      }
      // Release-after-apply: the gating frame is fully reflected in the
      // boundary before its optimistic op leaves the overlay set.
      releaseConvergedOptimistic(convergedOps);
      if (releasedView && !disposed && boundary && !queryAuthorizationHidden) {
        boundary.write(boundaryKey, () => releasedView);
      }
      if (!queryAuthorizationHidden) retainRows(rows, lastServerVersion, capture);
      return overlaid;
    };

    const publishServerRows = async (
      capture,
      rows,
      version = maxServerRowVersion(rows),
      releaseOptions = {},
    ) => {
      const resolvedVersion = version ?? maxServerRowVersion(rows);
      if (
        isServerVersion(resolvedVersion)
        && isServerVersion(lastServerVersion)
        && resolvedVersion < lastServerVersion
      ) return lastServerRows;
      if (!coordinator) return writeServerRows(rows, resolvedVersion, capture, releaseOptions);
      // Run app reducers before entering the non-reentrant custody commit.
      // A transition after preparation simply makes the commit stale.
      const convergedOps = convergedOptimisticOps(resolvedVersion, releaseOptions);
      const releasedView = convergedOps.size > 0
        ? applyOptimisticOverlay(JSON.parse(JSON.stringify(rows)), convergedOps)
        : null;
      const overlaid = applyOptimisticOverlay(rows);
      let applied = false;
      const outcome = await compareContractCommit(client, coordinator, capture, () => {
        // Another authoritative callback may have advanced the boundary while
        // the durable authority comparison yielded. Recheck at the exact
        // commit cut so an older frame can never overwrite it.
        if (
          isServerVersion(resolvedVersion)
          && isServerVersion(lastServerVersion)
          && resolvedVersion < lastServerVersion
        ) return lastServerRows;
        applied = true;
        lastServerRows = rows;
        lastServerVersion = resolvedVersion;
        if (!disposed && boundary && !queryAuthorizationHidden) {
          boundary.write(boundaryKey, () => overlaid);
        }
        releaseConvergedOptimistic(convergedOps);
        if (releasedView && !disposed && boundary && !queryAuthorizationHidden) {
          boundary.write(boundaryKey, () => releasedView);
        }
        return overlaid;
      });
      if (!outcome.committed) {
        // The durable reload inside the failed commit observed a successor
        // this context has not adopted yet (missed/lost wakeup): run the
        // mandatory reload so the surface blanks instead of retaining the
        // predecessor boundary.
        void confirmDurableAuthority().catch(() => {});
        return null;
      }
      if (applied) retainRows(rows, resolvedVersion, capture);
      return outcome.value;
    };

    const surfaceConnection = () => (
      wantLivePush
        ? retainedOffline ? 'stale' : liveHandle?.connection ?? 'connecting'
        : null
    );

    const openLive = async (capture = operationCapture()) => {
      if (coordinator) await preflightDurable(capture);
      // Channel C register-mode adoption (LLP 0090 D4 step 7): a bundle
      // registration for the bound query is adopted instead of opening a
      // fresh snapshot-with-subscribe; best-effort, never boot-fatal.
      let registeredSubscription = null;
      if (typeof rqsRegistered === 'function') {
        try {
          registeredSubscription = rqsRegistered(queryName, queryArgs) ?? null;
        } catch {
          registeredSubscription = null;
        }
      }
      const handle = await client.liveQuery(queryName, {
        connectionId: surfaceConnectionId,
        args: queryArgs,
        userId: activeUserId,
        authorityCapture: capture,
        registeredSubscription,
        transport: 'stream',
        fallbackToPoll: liveFallbackToPoll,
        stream: liveStreamOptions,
        correlation: surfaceCorrelation,
        authorizationNamespace: authorizedQueryNamespace,
        authorizationQueue: createContractQueryAuthorizationQueue(
          clientStore,
          capture,
          authorizedQueryController(),
        ),
        onAuthorizationBoundary: (rows, detail = {}) => {
          if (detail.kind === 'authorization_retain') return;
          if (
            detail.kind === 'authorization_quarantine'
            || detail.kind === 'authorization_delete'
            || detail.kind === 'authorization_error'
          ) {
            queryAuthorizationHidden = true;
            if (detail.kind === 'authorization_delete') {
              lastServerRows = [];
              lastServerVersion = detail.version ?? 0;
              inFlightOptimistic.clear();
            }
            if (!disposed && boundary) boundary.write(boundaryKey, () => []);
            return;
          }
          if (detail.kind === 'authorization_snapshot') {
            if (coordinatedSessionsMode && retainedReadsEnabled) {
              // Resolution snapshots carry no lease. Keep the Contract
              // boundary blank until the post-ACK full revalidation commits a
              // replacement AuthorizedLease; the queue adapter schedules it.
              queryAuthorizationHidden = true;
              if (!disposed && boundary) boundary.write(boundaryKey, () => []);
              return;
            }
            queryAuthorizationHidden = false;
            writeServerRows(rows, detail.version, capture);
          }
        },
        onUpdate: (rows, detail = {}) => {
          if (String(detail.kind).startsWith('authorization_')) return;
          if (coordinator && barrierPaused) return;
          const callbackCapture = captureForTransportValue(client, capture, rows);
          void publishServerRows(callbackCapture, rows, detail.version)
            .then((published) => {
              if (published !== null) retainedOffline = false;
            })
            .catch(() => {});
        },
        onConnectionChange: (connection, detail) => {
          const callbackCapture = captureForTransportValue(client, capture, detail);
          // @ref LLP 0059#cross-context-ownership — observer emission is the
          // app-visible effect, so it runs synchronously inside the durable
          // comparison instead of after an await plus an in-memory hint.
          void compareContractCommit(client, coordinator, callbackCapture, () => {
            const observers = [...liveCellObservers]
              .filter((record) => record.confirmed && record.lastCell);
            for (const record of observers) {
              if (!record.lastCell) continue;
              try { record.emit({ ...record.lastCell, connection }); } catch { /* isolate */ }
            }
            try { onConnectionChange?.(connection, detail); } catch { /* isolate */ }
          }).then((outcome) => {
            if (!outcome.committed) {
              void confirmDurableAuthority().catch(() => {});
            }
          }).catch(() => {});
        },
        onSubscriptionEvent: onSubscriptionEvent
          ? (event) => {
              const callbackCapture = captureForTransportValue(client, capture, event);
              void compareContractCommit(client, coordinator, callbackCapture, () => {
                try { onSubscriptionEvent(event); } catch { /* isolate */ }
              })
                .then((outcome) => {
                  if (!outcome.committed) {
                    void confirmDurableAuthority().catch(() => {});
                  }
                })
                .catch(() => {});
            }
          : null,
      });
      const resultCapture = captureForTransportValue(client, capture, handle);
      const installed = await compareContractCommit(client, coordinator, resultCapture, () => {
        liveHandle = handle;
        retainedOffline = false;
      });
      if (!installed.committed) {
        handle.dispose?.();
        throw staleContractAuthorityError();
      }
      return handle;
    };

    let initial;
    if (retainedReadsEnabled) {
      if (coordinatedSessionsMode && authorizedQueryFence) {
        try {
          retained = await clientStore.getAuthorizedRetainedQuery(
            storeQueryKey,
            { fence: authorizedQueryFence, clientNowMs: Date.now() },
            expectationForCapture(authorityCapture),
          );
          if (retained?.fence) authorizedQueryFence = retained.fence;
        } catch (error) {
          // Missing, expired, rolled-back, or mismatched lease state has
          // already been deleted by the store before this catch. Refresh the
          // fence so an online full revalidation may establish new bytes.
          const current = await clientStore.captureAuthorizedRetainedQuery(
            storeQueryKey,
            authorityExpectation(authorityCapture),
          );
          authorizedQueryNamespace = current.namespace;
          authorizedQueryFence = current.fence;
          publishDiagnostic(
            error?.code ?? 'SNAPBACK_AUTHORIZED_LEASE_INVALID',
            error instanceof Error ? error.message : String(error),
            { query: queryName, deletedBeforeRead: true },
          );
        }
      } else if (!coordinatedSessionsMode) {
        retained = await clientStore.getRetainedQuery(
          storeQueryKey,
          expectationForCapture(authorityCapture),
        );
      }
    }
    try {
      if (coordinatedSessionsMode && retainedReadsEnabled) {
        const renewed = await renewAuthorizedSnapshot(authorityCapture);
        initial = renewed.rows;
        lastServerVersion = renewed.version;
        if (wantLivePush) {
          const handle = await openLive(authorityCapture);
          initial = handle.rows;
          lastServerVersion = handle.version ?? maxServerRowVersion(initial);
        }
      } else if (wantLivePush) {
        const handle = await openLive(authorityCapture);
        initial = handle.rows;
        lastServerVersion = handle.version ?? maxServerRowVersion(initial);
      } else {
        const initialCapture = authorityCapture ?? operationCapture();
        if (coordinator) await preflightDurable(initialCapture);
        const snapshot = await client.query(queryName, {
          args: queryArgs,
          userId: activeUserId,
          authorityCapture: initialCapture,
        });
        const resultCapture = captureForTransportValue(client, initialCapture, snapshot);
        const current = await compareContractCommit(client, coordinator, resultCapture, () => undefined);
        if (!current.committed) throw staleContractAuthorityError();
        initial = snapshot.rows;
        lastServerVersion = snapshot.version ?? maxServerRowVersion(initial);
      }
      if (!queryAuthorizationHidden) retainRows(initial, lastServerVersion, authorityCapture);
    } catch (error) {
      if (!retained) throw error;
      initial = retained.rows;
      lastServerVersion = retained.version ?? maxServerRowVersion(initial);
      retainedOffline = true;
      publishDiagnostic(
        'SNAPBACK_RETAINED_QUERY_STALE',
        'Serving retained authorized rows while the server is unavailable.',
        { query: queryName, version: lastServerVersion },
      );
    }
    lastServerRows = initial;
    boundary = runtime.createContractMockQueryBoundary({ [boundaryKey]: initial });
    if (wantLivePush && liveHandle && liveHandle.rows !== initial) {
      // An update that raced boundary creation is not lost: rewrite from the
      // handle's latest rows (idempotent when nothing changed).
      lastServerRows = liveHandle.rows;
      const racedRows = liveHandle.rows;
      const racedCapture = captureForTransportValue(client, authorityCapture, liveHandle);
      const committed = await compareContractCommit(client, coordinator, racedCapture, () => {
        if (!queryAuthorizationHidden) boundary.write(boundaryKey, () => racedRows);
      });
      if (!committed.committed) throw staleContractAuthorityError();
    }
    for (const record of restoredPending) {
      const descriptor = manifest?.mutations?.[record.function];
      const reducer = descriptor?.atomicOptimisticWithholding === true
        ? null
        : typeof optimisticReducers[record.function] === 'function'
          ? optimisticReducers[record.function]
          : derivedReducers[record.function] ?? null;
      if (!reducer) continue;
      inFlightOptimistic.add({
        mutationId: record.id,
        reducer,
        ledgerReducer: derivedReducers[record.function],
        args: record.args,
        optimisticId: record.optimisticId ?? record.ctxLedger?.ids?.[0] ?? record.id,
        baseVersion: record.baseVersion ?? lastServerVersion,
        ctxLedger: record.ctxLedger,
      });
    }
    if (restoredPending.length > 0) writeServerRows(lastServerRows, lastServerVersion);
    // Zero-scope presence rooms subscribe once up front so an `ephemeral`
    // binding's first snapshot delivers synchronously (ENG-22479).
    await ephemeralWiring.prewarm();

    // isCurrent() here is only the synchronous fast hint; publication and
    // lifecycle gates reload durable custody through confirmDurableAuthority.
    const assertActive = () => {
      if (lifecycleTerminalError) throw lifecycleTerminalError;
      if (disposed) {
        throw new Error('Snapback Contract surface was used after dispose().');
      }
      if (barrierPaused || (coordinator && !coordinator.isCurrent(authorityCapture))) {
        throw staleContractAuthorityError();
      }
    };

    const assertMutationAuthorizationVisible = () => {
      if (!queryAuthorizationHidden) return;
      const error = new Error(
        'SNAPBACK_AUTH_QUERY_QUARANTINED: mutation cannot publish an optimistic boundary while authorization is unresolved',
      );
      error.code = 'SNAPBACK_AUTH_QUERY_QUARANTINED';
      error.diagnostic = contractDiagnostic(
        error.code,
        'Mutation is suspended while this query authorization is unresolved.',
        { query: queryName },
      );
      throw error;
    };

    // Reconcile fetches authoritative rows and writes them with the in-flight
    // optimistic overlay applied (other mutations may still be in flight);
    // returns the rows as written.
    const reconcile = async (capture = operationCapture()) => {
      if (coordinator) await preflightDurable(capture);
      const snapshot = await client.query(queryName, {
        args: queryArgs,
        userId: activeUserId,
        authorityCapture: capture,
      });
      const resultCapture = captureForTransportValue(client, capture, snapshot);
      const published = await publishServerRows(
        resultCapture,
        snapshot.rows,
        snapshot.version ?? maxServerRowVersion(snapshot.rows),
        { releaseVersionlessSettlements: true },
      );
      if (published === null) throw staleContractAuthorityError();
      return published;
    };

    const track = (promise) => {
      const task = Promise.resolve(promise);
      pending.add(task);
      task.then(
        () => pending.delete(task),
        () => pending.delete(task),
      );
      return task;
    };

    const isConnectivityFailure = (error) => (
      error?.status === undefined
      && error?.diagnostic === undefined
      && error?.code !== 'SNAPBACK_AUTH_STALE_RESULT'
    );

    const confirmSentAcknowledgements = async (ids, capture = operationCapture()) => {
      if (ids.length === 0) return;
      try {
        await preflightDurable(capture);
        await clientStore.confirmMutationAcknowledgements(
          ids,
          storeAuthFingerprint,
          authorityExpectation(capture),
        );
      } catch (error) {
        // The server response proves these acknowledgements were received.
        // A local persistence failure must not turn that successful mutation
        // into an apparent connectivity failure; retaining the ids simply
        // makes the next delivery idempotently acknowledge them again.
        if (!coordinator || coordinator.isCurrent(capture)) {
          publishDiagnostic(
            'SNAPBACK_CLIENT_STORE_WRITE_FAILED',
            error instanceof Error ? error.message : String(error),
            { operation: 'confirmMutationAcknowledgements' },
          );
        }
      }
    };

    // A confirmed mutation may be the last write this browser ever sends.
    // Flush consumed settlement ids over their own authenticated app-data
    // route instead of relying on a future mutation to piggyback them. Failed
    // delivery is harmless and durable: the auth-tagged ids remain in the
    // store and are retried when this authority next constructs/reconnects.
    const flushPendingAcknowledgements = async (capture = operationCapture()) => {
      if (!offlineReplayEnabled || typeof client.acknowledgeMutations !== 'function') {
        return false;
      }
      const expectation = authorityExpectation(capture);
      const ids = await clientStore.pendingMutationAcknowledgements(
        MAX_OFFLINE_LEDGER_IDS,
        storeAuthFingerprint,
        expectation,
      );
      if (ids.length === 0) return true;
      let deliveryStarted = false;
      try {
        if (coordinator) await preflightDurable(capture);
        deliveryStarted = true;
        await client.acknowledgeMutations({
          userId: activeUserId,
          clientMutationIds: ids,
          authorityCapture: capture,
        });
        await confirmSentAcknowledgements(ids, capture);
        return true;
      } catch (error) {
        // Mandatory custody confirmation is not a best-effort ACK failure.
        // Only a failure after dispatch started may leave ids for retry.
        if (!deliveryStarted) throw error;
        if (!coordinator || coordinator.isCurrent(capture)) {
          publishDiagnostic(
            'SNAPBACK_CLIENT_MUTATION_ACK_DEFERRED',
            error instanceof Error ? error.message : String(error),
            { count: ids.length },
          );
        }
        return false;
      }
    };

    // Covers reloads and artifact transitions where the previous session
    // consumed a result but closed before its standalone ACK completed.
    await flushPendingAcknowledgements();

    const persistMutation = async (
      name,
      args,
      optimisticOp = null,
      capture = operationCapture(),
    ) => {
      let queued = null;
      let mutationQueueCapture = null;
      let mutationCommitted = false;
      let mutationOutput = null;
      let mutationDeliveryStarted = false;
      let sentAcknowledgements = [];
      try {
        if (offlineReplayEnabled && optimisticOp?.ctxLedger) {
          const expectation = expectationForCapture(capture);
          await preflightDurable(capture);
          mutationQueueCapture = await captureMutationQueue(capture);
          queued = await clientStore.enqueueMutation({
            id: optimisticOp.mutationId,
            function: name,
            args,
            readSet: [],
            ctxLedger: optimisticOp.ctxLedger,
            authFingerprint: storeAuthFingerprint,
            optimisticId: optimisticOp.optimisticId,
            baseVersion: optimisticOp.baseVersion,
            schemaHash: expectation.schemaHash,
            inputsHash: expectation.inputsHash,
            targetProfileId: expectation.targetProfileId,
            appId: expectation.appId,
            databaseId: expectation.databaseId,
            versionStreamId: expectation.versionStreamId,
            authorityEpoch: expectation.authorityEpoch,
            authorityKey: expectation.authorityKey,
            ...mutationQueueCapture,
            cursor: {
              stream: expectation.versionStreamId,
              version: optimisticOp.baseVersion,
            },
            ...(storeAuthorization
              ? { authorityDescriptor: storeAuthorization.authorityDescriptor }
              : {}),
          });
          durablePendingCount += 1;
        }
        if (offlineReplayEnabled) {
          sentAcknowledgements = await clientStore.pendingMutationAcknowledgements(
            MAX_OFFLINE_LEDGER_IDS,
            storeAuthFingerprint,
            authorityExpectation(capture),
          );
        }
        if (queued) {
          await clientStore.assertMutationQueueCapture(
            mutationQueueCapture,
            authorityExpectation(capture),
          );
        }
        // Store reads/CAS checks above may yield long enough for another
        // context to settle A -> B. The true transport boundary gets its own
        // exact durable predecessor confirmation.
        if (coordinator) await preflightDurable(capture);
        mutationDeliveryStarted = true;
        // TODO(Exact LLP 0231/0278): thread actionInvocationId/optimisticWaveId
        // into this correlation when the runtime supplies them.
        const rawOutput = await client.mutate(name, {
          args,
          userId: activeUserId,
          queue: false,
          correlation: surfaceCorrelation,
          clientMutationId: queued?.id ?? null,
          acknowledgedClientMutationIds: sentAcknowledgements,
          ctxLedger: queued?.ctxLedger ?? null,
          authorityDescriptor: queued?.authorityDescriptor ?? null,
          authorityCapture: capture,
        });
        const resultCapture = captureForTransportValue(client, capture, rawOutput);
        const output = normalizeContractMutationOutput(rawOutput);
        await commitCurrent(resultCapture, () => {
          mutationCommitted = true;
          mutationOutput = output;
          markOptimisticSettled(optimisticOp, output);
        });
        await confirmSentAcknowledgements(sentAcknowledgements, resultCapture);
        if (queued) {
          await preflightDurable(resultCapture);
          await clientStore.settleMutation(queued.id, {
            status: 'confirmed',
            output,
            authorityEpoch: resultCapture?.authorityEpoch ?? null,
            authorityKey: resultCapture?.authorityKey ?? null,
            ...mutationQueueCapture,
          });
          await commitCurrent(resultCapture, () => {
            durablePendingCount = Math.max(0, durablePendingCount - 1);
          });
          await flushPendingAcknowledgements(resultCapture);
        }
        // Settlement records V above; the op stays overlaid until a live frame,
        // current_as_of, or the reconcile pull below applies version >= V.
        await reconcile(resultCapture);
        return output;
      } catch (error) {
        const errorCapture = captureForTransportValue(client, capture, error);
        if (coordinator && !coordinator.isCurrent(errorCapture)) {
          throw staleContractAuthorityError();
        }
        if (!mutationDeliveryStarted) {
          // The optimistic row is visible before this async path starts. If
          // durable enqueue fails, the mutation was never safe to deliver and
          // no later server write may keep re-applying that phantom overlay.
          if (optimisticOp) {
            await commitCurrent(errorCapture, () => inFlightOptimistic.delete(optimisticOp));
          }
          const diagnostic = publishDiagnostic(
            'SNAPBACK_CLIENT_STORE_WRITE_FAILED',
            error instanceof Error ? error.message : String(error),
            { mutation: name, operation: 'enqueueMutation' },
          );
          await publishServerRows(errorCapture, lastServerRows, lastServerVersion);
          if (error && typeof error === 'object' && error.diagnostic === undefined) {
            error.diagnostic = diagnostic;
          }
          throw error;
        }
        if (mutationCommitted) {
          if (isConnectivityFailure(error)) retainedOffline = true;
          publishDiagnostic(
            'SNAPBACK_CONTRACT_RECONCILE_FAILED',
            error instanceof Error ? error.message : String(error),
            { mutation: name, args, committed: true },
          );
          // The mutation result is confirmed. A failed client-store settle
          // leaves its entry queued for idempotent redelivery; a failed query
          // leaves the last authoritative rows marked stale. Neither may be
          // misreported as a rejected mutation.
          await publishServerRows(errorCapture, lastServerRows, lastServerVersion);
          return mutationOutput;
        }
        // A migration-boundary refusal is receipted but NOT a mutation
        // outcome: the write intent survives the schema publication. Keep
        // the record queued (never settle `failed`), surface the stable
        // boundary state, and let the reconnect replay settle it through
        // resync-before-replay (LLP 0081 §6).
        const deliveryBoundaryKind = queued ? migrationBoundaryKindOf(error) : null;
        if (deliveryBoundaryKind) {
          retainedOffline = true;
          if (deliveryBoundaryKind === 'resync-required') rebaselineMutationIds.add(queued.id);
          await commitCurrent(errorCapture, () => enterMigrationBoundary(
            deliveryBoundaryKind,
            error,
            { mutation: name, clientMutationId: queued.id },
          ));
          return { queued: true, clientMutationId: queued.id };
        }
        if (
          queued
          && error?.code !== 'SNAPBACK_CONTRACT_INNER_MUTATION_QUEUED'
          && (isConnectivityFailure(error) || !error?.receipt)
        ) {
          retainedOffline = true;
          publishDiagnostic(
            'SNAPBACK_OFFLINE_MUTATION_QUEUED',
            'Mutation delivery is unproven; retained for ordered replay after reconnect.',
            { mutation: name, clientMutationId: queued.id, sequence: queued.sequence },
          );
          return { queued: true, clientMutationId: queued.id };
        }
        if (queued) {
          // A provider-core receipt proves the origin ran its piggyback ACK
          // stage even when it rejected this mutation. Persist that proof
          // before settling the current record: if the failed-settlement
          // write itself errors, retrying already-consumed ACK ids is safe,
          // but retaining them as the only server-GC proof is unnecessary.
          await confirmSentAcknowledgements(sentAcknowledgements, errorCapture);
          await preflightDurable(errorCapture);
          await clientStore.settleMutation(queued.id, {
            status: 'failed',
            diagnostic: error?.diagnostic ?? { message: error instanceof Error ? error.message : String(error) },
            authorityEpoch: errorCapture?.authorityEpoch ?? null,
            authorityKey: errorCapture?.authorityKey ?? null,
            ...mutationQueueCapture,
          });
          await commitCurrent(errorCapture, () => {
            durablePendingCount = Math.max(0, durablePendingCount - 1);
          });
        }
        if (optimisticOp) {
          await commitCurrent(errorCapture, () => inFlightOptimistic.delete(optimisticOp));
        }
        publishDiagnostic('SNAPBACK_CONTRACT_MUTATION_FAILED', error instanceof Error ? error.message : String(error), {
          mutation: name,
          args,
        });
        try {
          await reconcile(errorCapture);
        } catch (reconcileError) {
          // ENG-23384: a mutation that failed because the server is
          // unreachable almost always takes reconcile's query down with it.
          // The failed op is already out of inFlightOptimistic, so no later
          // overlay pass owns its row — without a local rollback the boundary
          // presents the phantom row as ready data indefinitely, and the
          // caller would receive the reconcile error instead of the mutation
          // failure. Rewrite the boundary from the last known server rows
          // (surviving in-flight ops re-overlay on top) and surface the
          // mutation error with the reconcile failure attached as cause.
          publishDiagnostic(
            'SNAPBACK_CONTRACT_RECONCILE_FAILED',
            reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
            { mutation: name, args },
          );
          await publishServerRows(errorCapture, lastServerRows);
          if (error instanceof Error && error.cause === undefined) {
            error.cause = reconcileError;
          }
        }
        throw error;
      }
    };

    const links = {};
    for (const name of queryNames) {
      if (!boundQueryNames.has(name)) continue;
      links[name] = (_args) => {
        assertActive();
        if (coordinator) {
          // A synchronous direct boundary read cannot atomically reload
          // cross-context custody. Coordinated callers consume this query
          // through the provider/mount path, whose first delivery is held
          // until durable confirmation; keep this convenience link blank.
          void confirmDurableAuthority().catch(() => {});
          return [];
        }
        return boundary.query(boundaryKey, (rows) => rows, { key: boundaryKey });
      };
    }
    // Derived optimistic overlays (Exact LLP 0329 §E5): IR-tier mutations
    // whose manifest embeds a plan derivable for this boundary's table get a
    // generated default reducer. App reducers stay first-class and override
    // per name; mutations touching tables this boundary cannot see stay
    // pending-without-overlay (no overlay beats a wrong prediction).
    for (const name of mutationNames) {
      const descriptor = manifest?.mutations?.[name];
      const appReducer = optimisticReducers[name];
      const optimisticWithheld = descriptor?.atomicOptimisticWithholding === true;
      const activeReducer = optimisticWithheld
        ? null
        : typeof appReducer === 'function' ? appReducer : derivedReducers[name] ?? null;
      mutationOverlayClass[name] = !optimisticWithheld && typeof appReducer === 'function'
        ? 'reducer'
        : activeReducer
          ? 'derived'
          : 'none';
      links[name] = (args) => {
        assertActive();
        const capture = operationCapture();
        const publishOptimistic = () => {
          // The optimistic boundary write is itself app-visible publication.
          // Recheck the local barrier and perform the complete synchronous
          // reducer/write turn inside the final durable authority comparison.
          assertActive();
          assertMutationAuthorizationVisible();
          const reducer = activeReducer;
          // A derived plan runs against serde_json::Value on the server. Take
          // one canonical snapshot and reuse it for the prediction, durable
          // queue, and transport; evaluating raw args and serializing them
          // again could underfill the RuntimeId ledger.
          let mutationArgs = args;
          if (descriptor?.plan !== undefined) {
            try {
              mutationArgs = canonicalizeJsonValue(args ?? {});
            } catch (error) {
              return { error };
            }
          }
          let optimisticOp = null;
          let nowMs = null;
          let runtimeId = null;
          const withheldReplayable = optimisticWithheld && descriptor?.plan !== undefined;
          const withheldLedgerIds = withheldReplayable
            ? atomicWithheldLedgerIdCount(descriptor?.plan)
            : null;
          if (withheldReplayable && withheldLedgerIds === null) {
            const error = new Error(
              `Atomic optimistic withholding for ${name} requires a generated sequence write-with-activity plan`,
            );
            error.code = 'SNAPBACK_CONTRACT_MANIFEST_INVALID';
            return { error };
          }
          if (typeof reducer === 'function' || withheldLedgerIds !== null) {
            // The mutation id no longer embeds the function name: the queued
            // record stores `function` beside the id, so carrying it twice only
            // bought a prefix that breaks the LLP 0148 grammar.
            const mutationId = createClientMutationId();
            const ledgerIds = [];
            nowMs = Date.now();
            runtimeId = () => {
              if (ledgerIds.length >= 1024) {
                const error = new Error('offline replay ledger exceeded 1024 ids');
                error.code = 'SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED';
                throw error;
              }
              const id = `${mutationId}_id_${ledgerIds.length + 1}`;
              ledgerIds.push(id);
              return id;
            };
            optimisticOp = {
              mutationId,
              reducer,
              ledgerReducer: derivedReducers[name],
              args: mutationArgs,
              optimisticId: `optimistic_${++optimisticSeq}`,
              baseVersion: maxServerRowVersion(lastServerRows),
              ctxLedger: derivedReducers[name] || withheldLedgerIds !== null
                ? { version: 1, ids: ledgerIds, now: nowMs }
                : null,
            };
            if (withheldLedgerIds !== null) {
              for (let index = 0; index < withheldLedgerIds; index += 1) runtimeId();
            }
          }
          if (typeof reducer === 'function') {
            let rollbackRows = lastServerRows;
            try {
              // Reducers are app code and may mutate their input before
              // throwing. Preserve an isolated rollback source.
              rollbackRows = JSON.parse(JSON.stringify(canonicalizeJsonValue(lastServerRows)));
              inFlightOptimistic.add(optimisticOp);
              boundary.write(boundaryKey, (rows) => {
                const ledgerCtx = {
                  userId: activeUserId,
                  optimisticId: optimisticOp.optimisticId,
                  baseVersion: optimisticOp.baseVersion,
                  nowMs,
                  runtimeId,
                };
                if (derivedReducers[name] && reducer !== derivedReducers[name]) {
                  derivedReducers[name](rows, mutationArgs, ledgerCtx);
                }
                return reducer(rows, mutationArgs, {
                  ...ledgerCtx,
                  runtimeId: reducer === derivedReducers[name] ? runtimeId : null,
                });
              });
            } catch (cause) {
              // @ref LLP 0034#109-observational-callbacks-and-failed-optimistic-work-cannot-own-lifecycle-2026-07-12
              inFlightOptimistic.delete(optimisticOp);
              const message = cause instanceof Error ? cause.message : String(cause);
              const diagnostic = publishDiagnostic(
                'SNAPBACK_CONTRACT_OPTIMISTIC_REDUCER_FAILED',
                `Optimistic reducer for ${name} failed before mutation delivery: ${message}`,
                { mutation: name, overlayClass: mutationOverlayClass[name] },
              );
              const error = new Error(diagnostic.message);
              error.code = diagnostic.code;
              error.diagnostic = diagnostic;
              error.cause = cause;
              lastServerRows = rollbackRows;
              try {
                writeServerRows(rollbackRows, lastServerVersion);
              } catch (rollbackCause) {
                diagnostic.details.rollbackFailure = rollbackCause instanceof Error
                  ? rollbackCause.message
                  : String(rollbackCause);
              }
              return { error };
            }
          }
          return { mutationArgs, optimisticOp };
        };
        const persistPrepared = async (prepared) => {
          if (prepared.error) return Promise.reject(prepared.error);
          // The final publication comparison may complete before its Promise
          // continuation runs. Refuse transport if a transition blanked the
          // just-published optimistic row in that intervening turn.
          if (coordinator) {
            await preflightDurable(capture);
            assertActive();
          }
          return persistMutation(name, prepared.mutationArgs, prepared.optimisticOp, capture);
        };
        if (!coordinator) {
          return track(persistPrepared(publishOptimistic()));
        }
        return track(
          preflightDurable(capture)
            .then(() => commitCurrent(capture, publishOptimistic))
            .then(persistPrepared),
        );
      };
    }

    const providerQueries = {};
    for (const name of queryNames) {
      if (!boundQueryNames.has(name)) continue;
      providerQueries[name] = (_args, qb) => qb.query(boundaryKey, (rows) => rows, { key: boundaryKey });
    }
    const providerMutations = {};
    for (const name of mutationNames) {
      providerMutations[name] = async (args, _qb) => {
        assertActive();
        await links[name](args);
      };
    }

    // Manifest v2 is declared natively: Exact's runtime/conformance accepts
    // manifestVersion 1 | 2 since the LLP 0284 connection-axis merge (the interim
    // v1 projection this adapter carried is gone).
    const baseProvider = runtime.createBoundaryContractDataProvider(manifest, boundary, {
      queries: providerQueries,
      mutations: providerMutations,
      ephemerals: ephemeralWiring.sources,
      rowSyncState: async (_table, rowId) => {
        const capture = operationCapture();
        if (coordinator) await preflightDurable(capture);
        const result = await client.query(queryName, {
          args: queryArgs,
          userId: activeUserId,
          authorityCapture: capture,
        });
        const resultCapture = captureForTransportValue(client, capture, result);
        const current = await compareContractCommit(client, coordinator, resultCapture, () => result.rows);
        if (!current.committed) throw staleContractAuthorityError();
        const rows = current.value;
        const row = rows.find((r) => r._id === rowId);
        return row
          ? {
              syncedVersion: row._version,
              approxSyncedAt: null,
              pendingMutations: pending.size > 0 || durablePendingCount > 0,
            }
          : null;
      },
    });

    // DataCellV2 connection axis (Exact LLP 0284 §2.2): cells emitted for the
    // live-bound descriptor carry `connection`; the field is absent for
    // non-subscription descriptors — its absence is itself a fact. Additive: a
    // consumer that ignores the extra field behaves exactly as before.
    // Cells for the live-bound descriptor carry `connection`; the field stays
    // absent for non-subscription descriptors — its absence is itself a fact.
    const decorateCell = (cell) => (
      wantLivePush ? { ...cell, connection: surfaceConnection() } : cell
    );
    const provider = coordinator || wantLivePush
      ? {
          ...baseProvider,
          subscribe(subscribedQuery, args, observer) {
            if (subscribedQuery !== queryName) {
              return baseProvider.subscribe(subscribedQuery, args, observer);
            }
            const record = {
              lastCell: null,
              // Initial publication to a new observer waits for a durable
              // custody reload; in-memory currency alone cannot authorize it.
              confirmed: !coordinator,
              emit: (cell) => observer(cell),
            };
            liveCellObservers.add(record);
            const subscription = baseProvider.subscribe(subscribedQuery, args, (cell) => {
              if (coordinator && !record.confirmed && !barrierBlanking) {
                // Buffer until the durable reload confirms this authority.
                // Blank cells still pass below: a barrier's blank must reach
                // observers before any successor exposure.
                record.lastCell = cell;
                return;
              }
              if (coordinator && barrierPreparing && !barrierBlanking) {
                record.lastCell = cell;
                return;
              }
              if (
                coordinator
                && !barrierBlanking
                && (barrierPaused || !coordinator.isCurrent(authorityCapture))
              ) return;
              record.lastCell = cell;
              observer(decorateCell(cell));
            });
            if (coordinator && !record.confirmed) {
              void confirmDurableAuthority().then(() => {
                const confirmationCapture = authorityCapture;
                return compareContractCommit(client, coordinator, confirmationCapture, () => {
                  if (record.confirmed || disposed || !liveCellObservers.has(record)) return;
                  record.confirmed = true;
                  if (record.lastCell && !barrierPaused && !barrierPreparing) {
                    try { observer(decorateCell(record.lastCell)); } catch { /* isolate */ }
                  }
                });
              }).catch(() => {});
            }
            return {
              dispose() {
                liveCellObservers.delete(record);
                subscription.dispose();
              },
            };
          },
        }
      : baseProvider;

    // Ephemeral binding + publish links resolve through the finished provider
    // (the `ephemeral` grammar's initializer expects a provider-backed handle).
    const installEphemeralLinks = (wiring) => {
      const built = wiring.buildLinks(provider, runtime);
      for (const [name, link] of Object.entries(built)) {
        if (!name.endsWith('Publish')) {
          links[name] = (args) => {
            assertActive();
            return link(args);
          };
          continue;
        }
        links[name] = (args) => {
          assertActive();
          const capture = operationCapture();
          const result = link(args);
          if (!coordinator) return result;
          return Promise.resolve(result).then(async (value) => {
            const resultCapture = captureForTransportValue(client, capture, value);
            return commitCurrent(resultCapture, () => value);
          });
        };
      }
    };
    installEphemeralLinks(ephemeralWiring);

    let resumeGeneration = lifecycleGenerationSeeds.resume ?? 0;
    let resumeTimer = null;
    let resumeTimerResolve = null;
    let resumeTask = Promise.resolve();
    let lifecycleTerminalError = null;
    let disposeTask = null;
    const recordLifecycleDiagnostic = (error) => {
      if (!diagnostics.some((entry) => (
        entry.code === error.code
        && entry.details?.axis === error.diagnostic.details.axis
      ))) diagnostics.push(error.diagnostic);
    };
    const cancelResumeTimer = () => {
      const settle = resumeTimerResolve;
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      resumeTimer = null;
      resumeTimerResolve = null;
      settle?.();
    };
    const terminalizeSurfaceLifecycle = (error) => {
      if (lifecycleTerminalError) return;
      lifecycleTerminalError = error;
      barrierPaused = true;
      barrierPreparing = false;
      cancelResumeTimer();
      detachReceiptListener?.();
      detachReceiptListener = null;
      liveHandle?.dispose?.();
      liveHandle = null;
      barrierBlanking = true;
      try {
        if (boundary) boundary.write(boundaryKey, () => []);
        ephemeralWiring?.blank?.();
      } finally {
        barrierBlanking = false;
      }
      ephemeralWiring?.dispose?.();
      lastServerRows = [];
      lastServerVersion = 0;
      for (const record of liveCellObservers) record.lastCell = null;
      recordLifecycleDiagnostic(error);
    };
    const advanceResumeGeneration = () => {
      try {
        resumeGeneration = nextContractLifecycleGeneration(
          resumeGeneration,
          'single-surface-resume',
        );
        return true;
      } catch (error) {
        terminalizeSurfaceLifecycle(error);
        return false;
      }
    };
    const refreshAfterAuthorityTransition = async (context, generation) => {
      if (
        generation !== resumeGeneration
        || disposed
        || lifecycleTerminalError
      ) return;
      const capture = context.capture;
      authorityCapture = capture;
      coordinatedSessionsMode = context.authority?.authMode === 'sessions';
      authSession = coordinatedSessionsMode && typeof client.authSession === 'function'
        ? await client.authSession()
        : null;
      activeUserId = effectiveContractUserId(coordinator, authSession, userId);
      const refreshedAuthorization = typeof client.currentAuthorizationScope === 'function'
        ? await client.currentAuthorizationScope({ devUserId: userId ?? null })
        : null;
      const refreshedQueueCapable = Boolean(
        coordinatedSessionsMode
        && authSession?.availability?.queuedReplay?.available === true
        && offeredProtocolEchoV1(client, authSession, 'authorityDescriptor')
        && refreshedAuthorization?.authorityDescriptor?.descriptorVersion === 1
      );
      let refreshedLeaseFacts = null;
      if (
        coordinatedSessionsMode
        && authSession?.availability?.retainedReads?.available === true
        && offeredProtocolEchoV1(client, authSession, 'authInvalidation')
        && offeredProtocolEchoV1(client, authSession, 'authorizedLease')
      ) {
        try {
          refreshedLeaseFacts = validateAuthorizedLeaseCapability(authSession.authorizedLease);
        } catch {
          refreshedLeaseFacts = null;
        }
      }
      offlineReplayEnabled = offlineReplayEligible
        && retainedIdentityComplete
        && (!coordinatedSessionsMode || refreshedQueueCapable);
      retainedReadsEnabled = retainedQueryEligible
        && retainedIdentityComplete
        && (
          !coordinatedSessionsMode
          || Boolean(
            refreshedLeaseFacts
            && retainableUserOnly
            && activationIdentityComplete
            && typeof activeUserId === 'string'
            && refreshedAuthorization?.principalScope?.userId === activeUserId
          )
        );
      storeAuthFingerprint = snapbackAuthFingerprint(activeUserId ?? null);
      Object.assign(storeExpectation, {
        authFingerprint: storeAuthFingerprint,
        authorityEpoch: capture.authorityEpoch,
        authorityKey: capture.authorityKey,
      });
      if (clientStore) {
        if (refreshedAuthorization && typeof clientStore.scopeAuthorization === 'function') {
          await clientStore.scopeAuthorization(
            refreshedAuthorization,
            expectationForCapture(capture),
          );
        }
        await clientStore.scopeToAuth(storeAuthFingerprint, expectationForCapture(capture));
        await clientStore.scopeToArtifacts({
          schemaHash: storeExpectation.schemaHash,
          inputsHash: storeExpectation.inputsHash,
          targetProfileId: storeExpectation.targetProfileId,
          appId: storeExpectation.appId,
          databaseId: storeExpectation.databaseId,
          versionStreamId: storeExpectation.versionStreamId,
        }, expectationForCapture(capture));
      }
      // The predecessor descriptor has already been retired/stranded by the
      // durable store transition above. Only now may new enqueues capture the
      // settled successor descriptor.
      storeAuthorization = refreshedAuthorization;

      authorizedQueryNamespace = null;
      authorizedQueryFence = null;
      if (coordinatedSessionsMode && retainedReadsEnabled) {
        try {
          const current = await clientStore.captureAuthorizedRetainedQuery(
            storeQueryKey,
            authorityExpectation(capture),
          );
          authorizedQueryNamespace = current.namespace;
          authorizedQueryFence = current.fence;
        } catch (error) {
          if (error?.code !== 'SNAPBACK_AUTH_QUERY_FENCE_STALE') throw error;
        }
      }

      let rows;
      let version;
      if (coordinatedSessionsMode && retainedReadsEnabled) {
        const renewed = await renewAuthorizedSnapshot(capture);
        rows = renewed.rows;
        version = renewed.version;
        if (wantLivePush) {
          const handle = await openLive(capture);
          rows = handle.rows;
          version = handle.version ?? maxServerRowVersion(rows);
        }
      } else if (wantLivePush) {
        const handle = await openLive(capture);
        rows = handle.rows;
        version = handle.version ?? maxServerRowVersion(rows);
      } else {
        if (coordinator) await preflightDurable(capture);
        const snapshot = await client.query(queryName, {
          args: queryArgs,
          userId: activeUserId,
          authorityCapture: capture,
        });
        const resultCapture = captureForTransportValue(client, capture, snapshot);
        if (
          resultCapture.authorityEpoch !== capture.authorityEpoch
          || resultCapture.authorityKey !== capture.authorityKey
        ) throw staleContractAuthorityError();
        rows = snapshot.rows;
        version = snapshot.version ?? maxServerRowVersion(rows);
      }
      if (generation !== resumeGeneration || disposed || lifecycleTerminalError) return;

      // Item 5 does not resume auth-scoped live/ephemeral state in sessions
      // mode. Dev/authority-independent surfaces rebuild only after the fresh
      // durable snapshot above has established their successor boundary.
      const ephemeralMayResume = ephemeralWiringMayResume(
        ephemeralWiring,
        context.authority,
      );
      if (ephemeralMayResume) {
        const successorEphemeral = buildEphemeralWiring({
          client,
          manifest,
          connectionId: surfaceConnectionId,
          userId: activeUserId,
          ephemeralPermissions,
          ephemeralIdleLingerMs,
          authorityCapture: capture,
          commitAuthorityPublication: (candidate, commit) => (
            compareContractCommit(client, coordinator, candidate, commit)
          ),
          preflightAuthorityDispatch: (candidate) => preflightDurable(candidate),
          onAuthorityRefused: () => {
            void confirmDurableAuthority().catch(() => {});
          },
          socketLossGenerationSeed: lifecycleGenerationSeeds.socketLoss ?? 0,
          onLifecycleTerminal: recordLifecycleDiagnostic,
        });
        ephemeralWiring.prepare(successorEphemeral);
        await ephemeralWiring.prewarm();
      }
      if (
        generation !== resumeGeneration
        || disposed
        || lifecycleTerminalError
        || !coordinator.isCurrent(capture)
      ) return;
      // The handle may have advanced while successor ephemerals were prepared.
      // Read its latest snapshot once at the atomic exposure turn.
      if (wantLivePush && liveHandle) {
        rows = liveHandle.rows;
        version = liveHandle.version ?? maxServerRowVersion(rows);
      }
      const resolvedVersion = version ?? maxServerRowVersion(rows);
      barrierPreparing = true;
      const exposed = await compareContractCommit(client, coordinator, capture, () => {
        if (disposed || lifecycleTerminalError || generation !== resumeGeneration) {
          barrierPreparing = false;
          return;
        }
        lastServerRows = rows;
        lastServerVersion = resolvedVersion;
        if (!disposed && !lifecycleTerminalError && boundary && !queryAuthorizationHidden) {
          boundary.write(boundaryKey, () => rows);
        }
        barrierPreparing = false;
        if (!lifecycleTerminalError && ephemeralMayResume) ephemeralWiring.expose();
        attachReceiptListener();
        if (!lifecycleTerminalError) barrierPaused = false;
        for (const record of liveCellObservers) {
          // Exposure and observer delivery are one synchronous authority turn.
          record.confirmed = true;
          if (record.lastCell) {
            try { record.emit(decorateCell(record.lastCell)); } catch { /* isolate */ }
          }
        }
      });
      if (
        !exposed.committed
        || disposed
        || lifecycleTerminalError
        || generation !== resumeGeneration
      ) return;
      retainRows(rows, resolvedVersion, capture);
    };

    const scheduleAuthorityRefresh = (context) => {
      if (disposed || lifecycleTerminalError) return;
      const generation = resumeGeneration;
      resumeTask = new Promise((resolve) => {
        const settle = () => {
          if (resumeTimerResolve === settle) {
            resumeTimer = null;
            resumeTimerResolve = null;
          }
          resolve();
        };
        resumeTimerResolve = settle;
        resumeTimer = setTimeout(settle, 0);
      }).then(() => {
        return refreshAfterAuthorityTransition(context, generation);
      }).catch((error) => {
        // Stay blank/paused. A later transition or explicit surface retry can
        // establish a fresh successor; stale work never becomes a diagnostic
        // owned by that successor.
        if (
          !lifecycleTerminalError
          && generation === resumeGeneration
          && coordinator.isCurrent(context.capture)
        ) {
          publishDiagnostic(
            'SNAPBACK_CONTRACT_AUTH_RESUME_FAILED',
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    };

    const removeOptimisticMutation = (mutationId) => {
      for (const op of inFlightOptimistic) {
        if (op.mutationId === mutationId) inFlightOptimistic.delete(op);
      }
    };

    // LLP 0043 M2 reconnect order is load-bearing: authoritative full resync
    // first, then the durable queue strictly by client sequence. Reads are
    // never replay-ledgered; every mutation executes against current server
    // state and each settle is followed by a fresh authoritative snapshot.
    const replayAfterReconnect = async () => {
      // Foreground resume is a mandatory lifecycle gate: reload durable
      // custody under ownership before trusting the in-memory hint below. A
      // missed A -> B settle blanks here and the stale surface refuses.
      await confirmDurableAuthority();
      assertActive();
      if (!offlineReplayEnabled) return { replayed: 0, failed: 0 };
      const capture = operationCapture();

      if (coordinator) await preflightDurable(capture);
      let initialResync;
      try {
        initialResync = await client.query(queryName, {
          args: queryArgs,
          userId: activeUserId,
          authorityCapture: capture,
        });
      } catch (error) {
        // An incompatible client refuses even the resync read: enter the
        // stable upgrade-required boundary (queue intact, nothing settled)
        // instead of surfacing a generic query failure the app might retry
        // blindly (LLP 0081 §6).
        const boundaryKind = migrationBoundaryKindOf(error);
        if (boundaryKind) enterMigrationBoundary(boundaryKind, error, { operation: 'resync' });
        throw error;
      }
      const resyncCapture = captureForTransportValue(client, capture, initialResync);
      const resynced = await publishServerRows(
        resyncCapture,
        initialResync.rows,
        initialResync.version ?? maxServerRowVersion(initialResync.rows),
      );
      if (resynced === null) throw staleContractAuthorityError();
      retainedOffline = false;

      const replayQueueCapture = await captureMutationQueue(resyncCapture);
      const queued = await clientStore.pendingMutations({
        ...expectationForCapture(resyncCapture),
        ...replayQueueCapture,
      });
      let replayed = 0;
      let failed = 0;
      const resyncedVersions = new Map(
        (initialResync.rows ?? []).map((row) => [row._id, row._version]),
      );
      // A record previously refused `resync-required` re-presents the SAME
      // logical mutation under the SAME clientMutationId with baselines
      // refreshed from the successor snapshot — the server settlement
      // contract's resync-before-replay form. Deps outside the bound
      // surface stay as recorded for the server to adjudicate; records
      // never refused keep their recorded baselines so ordinary conflict
      // detection is not eroded.
      const rebaselineReadSet = (record) => {
        const readSet = record.readSet ?? [];
        if (!rebaselineMutationIds.has(record.id) || readSet.length === 0) return readSet;
        return readSet.map((dependency) => (
          dependency.table === boundTable && resyncedVersions.has(dependency.id)
            ? { ...dependency, version: resyncedVersions.get(dependency.id) }
            : dependency
        ));
      };
      for (const record of queued) {
        const sentAcknowledgements = await clientStore.pendingMutationAcknowledgements(
          MAX_OFFLINE_LEDGER_IDS,
          storeAuthFingerprint,
          authorityExpectation(resyncCapture),
        );
        try {
          await clientStore.assertMutationQueueCapture(
            replayQueueCapture,
            authorityExpectation(resyncCapture),
          );
          if (coordinator) await preflightDurable(resyncCapture);
          const rawOutput = await client.mutate(record.function, {
            args: record.args,
            userId: activeUserId,
            queue: false,
            readSet: rebaselineReadSet(record),
            correlation: surfaceCorrelation,
            clientMutationId: record.id,
            acknowledgedClientMutationIds: sentAcknowledgements,
            ctxLedger: record.ctxLedger,
            authorityDescriptor: record.authorityDescriptor ?? null,
            authorityCapture: resyncCapture,
          });
          const resultCapture = captureForTransportValue(client, resyncCapture, rawOutput);
          const output = normalizeContractMutationOutput(rawOutput);
          await commitCurrent(resultCapture, () => {
            markOptimisticMutationSettled(record.id, output);
          });
          await confirmSentAcknowledgements(sentAcknowledgements, resultCapture);
          await preflightDurable(resultCapture);
          await clientStore.settleMutation(record.id, {
            status: 'confirmed',
            output,
            authorityEpoch: resultCapture?.authorityEpoch ?? null,
            authorityKey: resultCapture?.authorityKey ?? null,
            ...replayQueueCapture,
          });
          await commitCurrent(resultCapture, () => {
            durablePendingCount = Math.max(0, durablePendingCount - 1);
            // A settle under the current artifacts proves the boundary
            // passed: resync-before-replay completed (or the upgraded
            // client attested) for this queue position.
            rebaselineMutationIds.delete(record.id);
            if (migrationBoundary) clearMigrationBoundary();
          });
          await flushPendingAcknowledgements(resultCapture);
          replayed += 1;
        } catch (error) {
          const errorCapture = captureForTransportValue(client, resyncCapture, error);
          if (coordinator && !coordinator.isCurrent(errorCapture)) {
            throw staleContractAuthorityError();
          }
          // Migration-boundary refusals preserve the record: quarantine is
          // a lifecycle state, not a failure. Halt the pass (queue and
          // order intact); the next reconnect resyncs first and re-baselines
          // exactly the refused record (LLP 0081 §6).
          const boundaryKind = migrationBoundaryKindOf(error);
          if (boundaryKind) {
            retainedOffline = true;
            if (boundaryKind === 'resync-required') rebaselineMutationIds.add(record.id);
            await commitCurrent(errorCapture, () => enterMigrationBoundary(
              boundaryKind,
              error,
              { mutation: record.function, clientMutationId: record.id },
            ));
            throw error;
          }
          // Only a provider-core mutation receipt proves the request crossed
          // the origin handler's ACK stage. A proxy/load-balancer 4xx/5xx may
          // carry status + diagnostic while never reaching Snapback; deleting
          // local ACK proofs or marking the current mutation failed would then
          // strand settlements and lose an ambiguously delivered write.
          if (
            error?.code !== 'SNAPBACK_CONTRACT_INNER_MUTATION_QUEUED'
            && (isConnectivityFailure(error) || !error?.receipt)
          ) {
            retainedOffline = true;
            throw error;
          }
          await confirmSentAcknowledgements(sentAcknowledgements, errorCapture);
          await preflightDurable(errorCapture);
          await clientStore.settleMutation(record.id, {
            status: 'failed',
            diagnostic: error?.diagnostic ?? { message: error instanceof Error ? error.message : String(error) },
            authorityEpoch: errorCapture?.authorityEpoch ?? null,
            authorityKey: errorCapture?.authorityKey ?? null,
            ...replayQueueCapture,
          });
          await commitCurrent(errorCapture, () => {
            durablePendingCount = Math.max(0, durablePendingCount - 1);
            // Refused replay writes have no convergence version; failure
            // settlement remains the immediate overlay-release boundary.
            removeOptimisticMutation(record.id);
          });
          failed += 1;
          publishDiagnostic(
            'SNAPBACK_OFFLINE_MUTATION_FAILED',
            error instanceof Error ? error.message : String(error),
            { mutation: record.function, clientMutationId: record.id },
          );
        }
        await reconcile(resyncCapture);
      }

      if (wantLivePush && !liveHandle) {
        const handle = await openLive(resyncCapture);
        const published = await publishServerRows(resyncCapture, handle.rows, handle.version);
        if (published === null) throw staleContractAuthorityError();
      }
      await flushPendingAcknowledgements(resyncCapture);
      return { replayed, failed };
    };

    if (coordinator) {
      // @ref LLP 0059#exposure-invariant — a surface is either entirely at its
      //   settled capture or explicitly blank while the successor is prepared.
      unregisterSurfaceParticipant = registerContractParticipant(client, coordinator, {
        name: `snapback-contract-surface:${surfaceRootId}`,
        quiesce() {
          barrierPaused = true;
          if (!advanceResumeGeneration()) return;
          cancelResumeTimer();
          detachReceiptListener?.();
          detachReceiptListener = null;
          liveHandle?.dispose?.();
          liveHandle = null;
          ephemeralWiring?.quiesce?.();
        },
        blank() {
          if (!boundary || disposed) return;
          barrierBlanking = true;
          try {
            boundary.write(boundaryKey, () => []);
            ephemeralWiring?.blank?.();
          } finally {
            barrierBlanking = false;
          }
        },
        clearMemory() {
          lastServerRows = [];
          lastServerVersion = 0;
          retainedOffline = false;
          durablePendingCount = 0;
          inFlightOptimistic.clear();
          retainedWriteTail = Promise.resolve();
          authorizationRenewalTail = Promise.resolve();
          authorizedQueryNamespace = null;
          authorizedQueryFence = null;
          const terminalDiagnostics = diagnostics.filter((entry) => (
            entry.code === CONTRACT_LIFECYCLE_GENERATION_EXHAUSTED
          ));
          diagnostics.splice(stableDiagnosticCount);
          for (const diagnostic of terminalDiagnostics) {
            if (!diagnostics.includes(diagnostic)) diagnostics.push(diagnostic);
          }
          for (const record of liveCellObservers) record.lastCell = null;
        },
        // The physical store participant owns the single expected-epoch CAS.
        // Per-surface durable phases are intentionally idempotent no-ops.
        async commitDurable() {},
        async resume(context) {
          authorityCapture = context.capture;
          if (lifecycleTerminalError || disposed) return;
          // Browser custody performs the mandatory cross-context reload while
          // its exposure barrier is still closed. Agent custody has no peer
          // browser owner; its local fence keeps compareAndCommit closed until
          // this participant returns and the carrier barrier completes.
          // @ref LLP 0059#cross-context-ownership — browser Contract resume
          // cannot defer its authority check until after the barrier reopens.
          if (client?.authCoordinator === coordinator) {
            await coordinator.synchronize();
          }
          scheduleAuthorityRefresh(context);
        },
      });
      const current = await compareContractCommit(client, coordinator, authorityCapture, () => undefined);
      if (!current.committed) throw staleContractAuthorityError();
    }

    return {
      adapterVersion: SNAPBACK_CONTRACT_ADAPTER_VERSION,
      get capabilityClass() {
        return offlineReplayEnabled && retainedReadsEnabled
          ? SNAPBACK_CONTRACT_PARITY_CAPABILITY_CLASS
          : SNAPBACK_CONTRACT_CAPABILITY_CLASS;
      },
      boundary,
      links,
      provider,
      // Contract delegates the complete republisher lifecycle to its owned
      // headless client; it does not create a second authority or publish
      // transport.
      //
      // @ref LLP 0111#complete-carriers-and-remaining-exact-assignments —
      // Contract shares headless registration, replacement, empty-snapshot,
      // generation-fence, acknowledgement, inspection, and disposal.
      registerEphemeralRepublisher: (reference, callback) => (
        client.registerEphemeralRepublisher(reference, callback)
      ),
      diagnostics,
      pendingCount: () => Math.max(pending.size, durablePendingCount),
      retained: () => retainedOffline,
      // @ref LLP 0081#6-compatibility-and-deployment-ordering — the
      // app-renderable quarantine state. Null in normal operation;
      // `{ kind: 'resync-required' | 'upgrade-required', code, since, ... }`
      // while queued work is held behind a schema publication. A boundary
      // refusal never terminally fails or drops the record: payloads stay
      // durable in the pending queue (visible via pendingCount) for this
      // surface's artifact generation, and `resync-required` settles on the
      // next reconnect. After an artifact upgrade the store's privacy
      // boundary surfaces undelivered predecessor writes as redacted
      // `SNAPBACK_CLIENT_ARTIFACT_STALE` entries in failedMutations().
      migrationBoundary: () => (migrationBoundary ? { ...migrationBoundary } : null),
      reconnect: () => track(replayAfterReconnect()),
      failedMutations: async () => {
        if (!clientStore?.failedMutations) return [];
        const capture = operationCapture();
        const failures = await clientStore.failedMutations(expectationForCapture(capture));
        return commitCurrent(capture, () => failures);
      },
      declaredQueries: queryNames,
      declaredMutations: mutationNames,
      // LLP 0034 D1 facts: whether the bound descriptor streams server push, and
      // the current Exact LLP 0284 §2.2 connection value (null when not
      // subscription-backed).
      livePush: wantLivePush,
      connection: surfaceConnection,
      // Receipt surface (LLP 0034 §3 / ENG-22478): the kit ring, adapter-facing.
      // Mutation receipts this surface produced are enriched with their
      // overlay class (LLP 0329 §E5).
      rootId: surfaceRootId,
      receipts: () => {
        if (typeof client.receipts !== 'function') return [];
        if (coordinator) {
          // Like direct query links, this synchronous accessor has no place to
          // await the mandatory durable reload. `onReceipt` is the fenced
          // coordinated receipt surface; snapshots remain blank here.
          void confirmDurableAuthority().catch(() => {});
          return [];
        }
        return client.receipts().map(enrichReceipt);
      },
      // Ephemeral facts (ENG-22479): the conformance gate's LOCAL-ONLY probe
      // reads source starts; prewarmScope subscribes a scoped room up front.
      ephemeralSourceStarts: ephemeralWiring.sourceStarts,
      prewarmEphemeral: ephemeralWiring.prewarmScope,
      mount: (component, options = {}) => {
        // Mount initiates the mandatory durable reload; assertActive is only
        // the synchronous fast hint. The mounted component's query bindings
        // subscribe through the gated provider above, so no cell reaches it
        // before the reload confirms (or blanks) this authority.
        void confirmDurableAuthority().catch(() => {});
        assertActive();
        return rememberMountHandle(mountedHandles, mountSnapbackContractHeadless(runtime, component, options));
      },
      flush: async () => {
        await Promise.all([
          ...pending,
          retainedWriteTail,
          authorizationRenewalTail,
          resumeTask,
        ]);
      },
      dispose: () => {
        if (disposeTask) return disposeTask;
        disposed = true;
        barrierPaused = true;
        cancelResumeTimer();
        detachReceiptListener?.();
        detachReceiptListener = null;
        ephemeralWiring?.dispose?.();
        liveHandle?.dispose();
        liveHandle = null;
        liveCellObservers.clear();
        inFlightOptimistic.clear();
        for (const handle of [...mountedHandles]) {
          handle.dispose();
        }
        mountedHandles.clear();
        pending.clear();
        const unregister = unregisterSurfaceParticipant?.();
        unregisterSurfaceParticipant = null;
        const releaseStore = releaseDurableStoreRegistration?.();
        releaseDurableStoreRegistration = null;
        disposeTask = Promise.all([unregister, releaseStore].filter(Boolean));
        return disposeTask;
      },
    };
  } catch (error) {
    // ENG-23383: the receipt listener attaches before any fallible work, so
    // every construction failure past this point must detach it and release
    // whatever the attempt already established, or app-level retries
    // accumulate receipt listeners and leak live server subscriptions.
    try {
      liveHandle?.dispose();
    } catch {
      // Best-effort teardown: the construction error is the one to surface.
    }
    try {
      ephemeralWiring?.dispose();
    } catch {
      // Best-effort teardown: the construction error is the one to surface.
    }
    detachReceiptListener?.();
    detachReceiptListener = null;
    try {
      await unregisterSurfaceParticipant?.();
    } catch {
      // Best-effort cleanup: preserve the construction error.
    }
    unregisterSurfaceParticipant = null;
    try {
      await releaseDurableStoreRegistration?.();
    } catch {
      // Best-effort cleanup: preserve the construction error.
    }
    releaseDurableStoreRegistration = null;
    throw error;
  }
}


// ---------------------------------------------------------------------------
// Ephemeral read-path wiring (ENG-22479; Exact LLP 0284 §2.5 / LLP 0034 §4)
// ---------------------------------------------------------------------------
//
// For every manifest descriptor with `ephemeral: true`, the surface provides:
// - a BoundaryEphemeralSource (options.ephemerals) mapping the kit's
//   EphemeralOverlay to the normative EphemeralMapCell shape — entries carry
//   key/value/updatedAt/expiresAt/sourceClientId/self per LLP 0034 §4's
//   key-mode rules, plus the §2.2 connection axis; a scope-epoch bump arrives
//   as a fresh snapshot (the kit's D2 receipts already mark the resubscribed
//   boundary);
// - links: `<name>(args)` returns a provider-backed ephemeral handle for the
//   `ephemeral` binding, and `<name>Publish(args)` is the mutation-shaped
//   publish (scope fields + value + ttlMs) until Exact LLP 0281 lands;
// - a per-collection source-start counter (the conformance gate's LOCAL-ONLY
//   probe asserts forced subscribers never start the provider source).
//
// Reconnect (ENG-22541, diary 0011 flip condition 3): the ephemeral lane
// mirrors the kit's durable-lane needsResubscribe-on-open policy — an OPEN
// socket's loss marks every room subscription dead (the server drops a
// connection's subscriptions on socket close, so no in-band needs_resync
// ever arrives after a server restart), socket regain re-enters through a
// fresh snapshot-with-subscribe per room, and the presented connection holds
// 'stale' until that subscribe lands (never 'live' over a dead room).
// Residual race (ENG-23387): the subscribe itself is an HTTP POST, so a
// wasOpen loss can land while one is in flight — its registration dies with
// the old socket, and a resolve from before the loss must not claim
// subscribed. Each record carries a socket-loss epoch; a subscribe resolving
// from a stale epoch keeps the record unsubscribed (still swapping the
// overlay) and immediately re-enters.
//
// Force semantics (forceEphemeralState LOCAL-ONLY, force-reaches-live,
// dispose-restores) come from the Exact runtime's boundary provider force
// plane — the adapter deliberately does NOT wrap subscribeEphemeral or
// forceEphemeralState, so forced cells flow verbatim.
//
// Overlays are SHARED per (collection, scope) and prewarmed at surface
// creation, so a source start delivers its ready snapshot synchronously —
// presence rooms the surface serves are subscribed once, not per observer.
// Idle-room teardown (ENG-22527 item 3): when the LAST observer of a
// (collection, scope) overlay disposes, the shared subscription lingers for
// this window — a re-bind inside it cancels the timer and reuses the room;
// on expiry the overlay is torn down and the server registration is
// best-effort unsubscribed. Overridable per surface (ephemeralIdleLingerMs).
export const EPHEMERAL_IDLE_LINGER_MS = 30_000;

function ephemeralWiringMayResume(wiring, authority) {
  return authority?.authMode !== 'sessions'
    || wiring.descriptors.every(([, descriptor]) => (
      descriptor?.authorityIndependent === true
    ));
}

function buildEphemeralWiring({
  client,
  manifest,
  connectionId,
  userId,
  ephemeralPermissions = null,
  ephemeralIdleLingerMs = EPHEMERAL_IDLE_LINGER_MS,
  authorityCapture = null,
  commitAuthorityPublication = null,
  preflightAuthorityDispatch = null,
  onAuthorityRefused = null,
  socketLossGenerationSeed = 0,
  onLifecycleTerminal = null,
}) {
  const descriptors = Object.entries(manifest?.queries ?? {}).filter(
    ([, descriptor]) => descriptor?.ephemeral === true,
  );
  const sourceStarts = {};
  const sources = {};
  const recordCache = new Map(); // cacheKey -> resolved record (sync attach path)
  const pendingCache = new Map(); // cacheKey -> in-flight Promise<record> (ENG-22479 review fix 1)
  const disposals = new Set();
  // ENG-22479 review fix 4: once the surface is disposed, any late-resolving
  // subscribe must be torn down immediately — it would otherwise re-register
  // a lane consumer and onState demand (reopening the closed socket).
  let disposed = false;
  const supportsEphemeral =
    descriptors.length > 0
    && typeof client.subscribeEphemeral === 'function'
    && typeof client.liveStreamManager === 'function';

  // Resync re-subscribe backoff — mirrors the kit's LIVE_RECONNECT_* policy
  // (ENG-22479 review fix 3; the adapter takes the client by injection, so
  // the constants are mirrored rather than imported).
  const RESYNC_BASE_DELAY_MS = 250;
  const RESYNC_MAX_DELAY_MS = 10_000;

  const publishAuthorityEffect = (capture, effect) => {
    if (typeof commitAuthorityPublication !== 'function') {
      effect();
      return;
    }
    void Promise.resolve(commitAuthorityPublication(capture, effect))
      .then((outcome) => {
        if (!outcome?.committed) onAuthorityRefused?.();
      })
      .catch(() => onAuthorityRefused?.());
  };

  const captureForRecord = (record) => (
    record?.overlay?.authorityCapture
    ?? client?.authorityCaptureFor?.(record?.overlay)
    ?? authorityCapture
  );

  const scopeKeyOf = (args) => JSON.stringify(Object.entries(args ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));

  const selfKeyFor = (record, descriptor) => {
    switch (descriptor.keyMode) {
      case 'User':
        return userId ?? null;
      case 'Connection':
        // The surface connectionId is a readable kit label, not wire
        // identity. The overlay captures the opaque grant id used by its
        // successful subscribe, which is also the connection-owned lease key.
        // Missing metadata on a non-kit injected client degrades to false.
        //
        // @ref LLP 0031#connection-capability-grants — labels and granted ids
        //   may diverge after collision or mint-only containment.
        return record?.overlay?.grantedConnectionId ?? null;
      default:
        // Session/Custom lease identity is not modeled by this kit client;
        // `self` degrades to false rather than guessing (LLP 0034 §4 / OQ6).
        return null;
    }
  };

  const toMapCell = (record, descriptor) => {
    if (record.lifecycleTerminalError) {
      return {
        status: 'ready',
        entries: [],
        connection: 'disconnected',
      };
    }
    // Exact 0284 §2.5: an entry past provider TTL is deleted from `entries`
    // and never exposed again; freeze-at-last-known is reserved for
    // stale/disconnected, where entries may age past TTL locally and the
    // connection axis is the trust signal (ENG-22479 review fix 2).
    const connection = record.subscribed === false ? 'stale' : record.connection;
    const frozen = connection === 'stale' || connection === 'disconnected';
    const now = Date.now();
    const selfKey = selfKeyFor(record, descriptor);
    return {
      status: 'ready',
      entries: record.overlay
        .currentEntries({ prune: false })
        .filter((entry) => frozen || entry.expiresAtMs > now)
        .map((entry) => ({
          key: entry.key,
          value: entry.value,
          updatedAt: entry.receivedAtMs,
          expiresAt: entry.expiresAtMs,
          // The lease key IS the presence provenance (LLP 0034 §4).
          sourceClientId: entry.key,
          // Missing identity metadata on an injected/non-kit overlay is a
          // fail-closed state, even if the injected entry key is malformed.
          self: typeof selfKey === 'string' && entry.key === selfKey,
        }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      connection,
    };
  };

  // Pruning without a change event never re-renders: arm a one-shot timer at
  // the earliest future expiry so the binding re-emits when an entry ages out
  // on an otherwise-quiet room (ENG-22479 review fix 2). Re-armed after every
  // notification; cleared on dispose.
  const scheduleExpiryReemit = (record) => {
    if (record.expiryTimer) {
      clearTimeout(record.expiryTimer);
      record.expiryTimer = null;
    }
    if (disposed) return;
    const now = Date.now();
    let earliest = Infinity;
    for (const entry of record.overlay.currentEntries({ prune: false })) {
      if (entry.expiresAtMs > now && entry.expiresAtMs < earliest) earliest = entry.expiresAtMs;
    }
    if (earliest === Infinity) return;
    record.expiryTimer = setTimeout(() => {
      record.expiryTimer = null;
      record.notify();
    }, Math.max(16, earliest - now + 5));
    record.expiryTimer.unref?.();
  };

  const createRecord = async (name, args, permissions) => {
    // ENG-23387: the subscribe is an HTTP POST independent of the shared
    // socket, so an OPEN socket can be lost while it is in flight — the
    // server's disconnect drops the registration this subscribe just created
    // (src/ephemeral.rs disconnect), and no in-band needs_resync will
    // ever arrive for the dead room. Count wasOpen losses across the initial
    // in-flight window (this listener attaches BEFORE dispatch, closing the
    // gap before record.offState exists); a subscribe that raced one is
    // dead-on-arrival — the record starts unsubscribed and re-enters through
    // attemptResync at the bottom of this function.
    if (typeof preflightAuthorityDispatch === 'function') {
      await preflightAuthorityDispatch(authorityCapture);
    }
    const manager = client.liveStreamManager(connectionId);
    let subscribeLosses = 0;
    // This temporary listener also holds shared-socket demand — detaching a
    // manager's LAST listener closes AND releases it (demos/_kit/client.mjs
    // #listen), so it stays attached until the record's own onState below
    // holds demand. On failure paths it detaches last, releasing the manager
    // exactly as if the record had never existed.
    const offSubscribeLoss = manager.onState((state, detail = {}) => {
      if (state === 'lost' && detail.wasOpen) subscribeLosses += 1;
    });
    let overlay;
    try {
      overlay = await client.subscribeEphemeral(name, {
        connectionId,
        scope: { ...args },
        userId,
        permissions,
      });
      if (disposed) {
        overlay.dispose();
        throw new Error('surface disposed during ephemeral subscribe');
      }
    } catch (error) {
      offSubscribeLoss();
      throw error;
    }
    const record = {
      overlay,
      connection: 'connecting',
      subscribed: subscribeLosses === 0,
      listeners: new Set(),
      offState: null,
      expiryTimer: null,
      resyncTimer: null,
      resyncAttempts: 0,
      lingerTimer: null,
      tornDown: false,
      disposalEntry: null,
      resyncInFlight: false,
      // Socket-loss epoch (ENG-23387): bumped on every wasOpen loss so a
      // subscribe dispatched before the loss can recognize its resolve as
      // stale (the registration it created died with the old socket).
      socketLossEpoch: socketLossGenerationSeed,
      lifecycleTerminalError: null,
      notify: null,
    };
    record.notify = () => publishAuthorityEffect(captureForRecord(record), () => {
      for (const listener of [...record.listeners]) listener();
      scheduleExpiryReemit(record);
    });
    const bestEffortTerminalUnsubscribe = () => {
      try {
        void Promise.resolve(client.unsubscribeEphemeral?.(name, {
          connectionId,
          scope: { ...args },
          userId,
          permissions,
        })).catch(() => {});
      } catch {
        // Disconnect/reap is the terminal fallback.
      }
    };

    // Failed resync re-subscribes retry on bounded backoff while the map
    // presents its honest degraded state — no active subscription while
    // retrying maps to 'stale' per the kit's connection table (ENG-22479
    // review fix 3). A retired subscription emits no further signals, so
    // silence here would freeze the map as empty-but-ready-and-live forever.
    // At most ONE fresh subscribe is ever in flight per record (ENG-22541):
    // the socket-regain trigger below can race the in-band resync retry
    // loop, and overlapping subscribes would double the room's server-side
    // fan-out. Entering a resync also cancels a pending backoff retry — the
    // immediate attempt supersedes it. A torn-down record (idle-linger
    // teardown, ENG-22527) must never resync: its onState detaches only when
    // the best-effort unsubscribe settles, and a fresh registration here
    // would race that unsubscribe and leak (nothing owns it afterwards).
    const attemptResync = () => {
      if (
        disposed
        || record.tornDown
        || record.lifecycleTerminalError
        || record.resyncInFlight
      ) return;
      if (record.resyncTimer) {
        clearTimeout(record.resyncTimer);
        record.resyncTimer = null;
      }
      record.resyncInFlight = true;
      const epochAtDispatch = record.socketLossEpoch;
      const subscribe = () => client.subscribeEphemeral(
        name,
        { connectionId, scope: { ...args }, userId, permissions },
      );
      const resubscribe = typeof preflightAuthorityDispatch === 'function'
        ? Promise.resolve(preflightAuthorityDispatch(captureForRecord(record))).then(subscribe)
        : subscribe();
      void Promise.resolve(resubscribe)
        .then((fresh) => {
          record.resyncInFlight = false;
          if (disposed || record.tornDown) {
            try {
              fresh.dispose(); // fix 4: never leak past surface/record teardown
            } finally {
              if (record.lifecycleTerminalError) bestEffortTerminalUnsubscribe();
            }
            return;
          }
          const superseded = record.overlay;
          record.overlay = fresh;
          superseded.dispose();
          record.resyncAttempts = 0;
          fresh.onChange(handleChange);
          // A connection-wide poison can race the subscribe response and be
          // buffered on `fresh` before this listener exists. EphemeralOverlay
          // replays that level-triggered state synchronously from onChange,
          // which has already started the successor subscribe. Never let this
          // continuation overwrite the replay with `subscribed = true`.
          //
          // @ref LLP 0059#fenced-effects-and-live-closure — a poisoned overlay
          //   generation cannot be promoted live, even transiently.
          if (fresh.needsResync) {
            record.subscribed = false;
            record.notify();
            attemptResync();
            return;
          }
          if (record.socketLossEpoch !== epochAtDispatch) {
            // ENG-23387: a wasOpen loss landed while this HTTP subscribe was
            // in flight — the server's disconnect dropped the registration it
            // created, so this resolve must NOT claim subscribed: the 'open'
            // handler's !record.subscribed guard would then skip the real
            // re-subscribe and freeze the map under a 'live' banner (the
            // ENG-22541 state, resurfacing through this ordering). The
            // overlay still swaps (newest snapshot; the superseded
            // registration is equally dead) but the record stays
            // unsubscribed and re-enters immediately — if the socket already
            // regained, no future 'open' event would trigger it.
            record.subscribed = false;
            record.notify();
            attemptResync();
            return;
          }
          record.subscribed = true;
          record.notify();
        })
        .catch(() => {
          record.resyncInFlight = false;
          if (disposed || record.tornDown) return;
          const delay = Math.min(
            RESYNC_BASE_DELAY_MS * 2 ** record.resyncAttempts,
            RESYNC_MAX_DELAY_MS,
          );
          record.resyncAttempts += 1;
          record.resyncTimer = setTimeout(() => {
            record.resyncTimer = null;
            attemptResync();
          }, delay);
          record.resyncTimer.unref?.();
        });
    };

    const handleChange = (result) => {
      if (record.tornDown || record.lifecycleTerminalError) return;
      if (result === 'needs_resync') {
        // The server retired the room's epoch (collection replace/reset) or
        // the queue overflowed: re-enter through a fresh
        // snapshot-with-subscribe and swap the overlay generation (the D2
        // epoch work guarantees the fresh snapshot's epoch is strictly
        // newer, and the kit receipts the resubscribed boundary). Until the
        // fresh subscribe lands the map presents 'stale' (fix 3).
        record.subscribed = false;
        record.notify();
        attemptResync();
        return;
      }
      record.notify();
    };

    // Connection axis: the shared live socket's state is the map's transport
    // truth (same connection the durable lanes ride).
    record.connection = manager.isOpen() ? 'live' : 'connecting';
    const terminalizeSocketLossGeneration = (error) => {
      if (record.lifecycleTerminalError) return;
      record.lifecycleTerminalError = error;
      record.tornDown = true;
      record.subscribed = false;
      record.connection = 'disconnected';
      // Dispatch cleanup before dropping the manager listener: if it is the
      // last socket demand, disconnect reap is the fallback; if siblings keep
      // the socket alive, the explicit unsubscribe removes this room. A late
      // in-flight subscribe repeats this cleanup when it resolves.
      bestEffortTerminalUnsubscribe();
      try { record.offState?.(); } catch { /* fail-closed local teardown */ }
      record.offState = null;
      for (const timer of ['expiryTimer', 'resyncTimer', 'lingerTimer']) {
        if (record[timer]) {
          clearTimeout(record[timer]);
          record[timer] = null;
        }
      }
      try { record.overlay.dispose(); } catch { /* fail-closed local teardown */ }
      if (record.disposalEntry) disposals.delete(record.disposalEntry);
      // Exhaustion is a local fail-closed event, so the empty terminal cell
      // does not wait behind an authority comparison. No predecessor data is
      // carried by this blank publication.
      for (const listener of [...record.listeners]) {
        try { listener(); } catch { /* isolate */ }
      }
      onLifecycleTerminal?.(error);
    };
    record.offState = manager.onState((state, detail = {}) => {
      if (disposed || record.tornDown || record.lifecycleTerminalError) return;
      // Reconnect policy (ENG-22541): mirror the kit's durable-lane
      // needsResubscribe-on-open rule (demos/_kit/client.mjs attachStream).
      // An OPEN socket's close makes the server drop this connection's
      // subscriptions (src/server.rs live_stream -> disconnect; diary 0007),
      // so the room is dead server-side and NO in-band needs_resync will
      // ever arrive for it — after a server restart the old wiring froze
      // every map under a 'live' banner. A socket that never opened dropped
      // nothing. Any successful fresh subscribe (attemptResync) clears the
      // need, so a resync that landed during the outage is not repeated.
      if (state === 'lost' && detail.wasOpen) {
        try {
          record.socketLossEpoch = nextContractLifecycleGeneration(
            record.socketLossEpoch,
            'ephemeral-socket-loss',
          );
        } catch (error) {
          terminalizeSocketLossGeneration(error);
          return;
        }
        record.subscribed = false;
      }
      if (state === 'open' && !record.subscribed) {
        // Socket regained over a dead room: re-enter through a fresh
        // snapshot-with-subscribe. Until it lands, toMapCell keeps
        // presenting 'stale' (record.subscribed === false), so the map
        // never claims 'live' over a dead room; 'live' arrives with the
        // fresh snapshot via attemptResync's notify (LLP 0034 §2.2 order).
        attemptResync();
      }
      const next = state === 'open' ? 'live'
        : state === 'budget-missed' ? 'stale'
        : state === 'lost' ? 'stale'
        : state === 'closed' ? 'disconnected'
        : record.connection;
      if (next !== record.connection) {
        record.connection = next;
        record.notify();
      }
    });
    // record.offState now holds the socket demand; the in-flight loss
    // listener can detach without closing/releasing the shared manager.
    offSubscribeLoss();
    overlay.onChange(handleChange);
    record.disposalEntry = () => {
      record.tornDown = true;
      record.offState?.();
      for (const timer of ['expiryTimer', 'resyncTimer', 'lingerTimer']) {
        if (record[timer]) {
          clearTimeout(record[timer]);
          record[timer] = null;
        }
      }
      record.overlay.dispose();
    };
    if (record.lifecycleTerminalError) {
      record.offState?.();
      record.offState = null;
      return record;
    }
    disposals.add(record.disposalEntry);
    scheduleExpiryReemit(record);
    if (!record.subscribed) {
      // ENG-23387: the initial subscribe raced a wasOpen loss, so its
      // registration is already dead server-side. Re-enter now — the socket
      // may already have regained (its 'open' fired before this record's
      // onState existed, so nothing else would trigger the re-subscribe).
      attemptResync();
    }
    return record;
  };

  // Idle-room teardown (ENG-22527 item 3): drop the cache entry, send the
  // best-effort server-side unsubscribe (the D2 ephemeral disposal receipt),
  // and detach locally only once the unsubscribe settles. Ordering matters:
  // each record's manager.onState subscription is shared-socket demand, and
  // dropping the LAST one closes the socket — the server's disconnect
  // cleanup would then remove every registration on the connection before
  // the unsubscribe arrives (nondeterministic receipts, and it would
  // silently unregister sibling rooms mid-teardown). So the unsubscribe is
  // dispatched first; offState/overlay detach in its settle. The in-flight
  // teardown is parked in teardownCache so a rebind after expiry subscribes
  // strictly AFTER the old registration is gone (same (room, connectionId)
  // key — a late unsubscribe must never remove a fresh registration).
  const teardownCache = new Map();
  const teardownIdleRecord = (cacheKey, name, args, permissions, record) => {
    if (record.tornDown || disposed) return;
    record.tornDown = true;
    recordCache.delete(cacheKey);
    disposals.delete(record.disposalEntry);
    for (const timer of ['expiryTimer', 'resyncTimer', 'lingerTimer']) {
      if (record[timer]) {
        clearTimeout(record[timer]);
        record[timer] = null;
      }
    }
    const unsubscribe = client.unsubscribeEphemeral?.(name, {
      connectionId,
      scope: { ...args },
      userId,
      permissions,
    });
    const settled = Promise.resolve(unsubscribe)
      .catch(() => {
        // Best-effort: disconnect/reap covers the registration otherwise.
      })
      .finally(() => {
        record.offState?.();
        record.overlay.dispose();
        teardownCache.delete(cacheKey);
      });
    teardownCache.set(cacheKey, settled);
  };

  const armIdleLinger = (cacheKey, name, args, permissions, record) => {
    if (record.tornDown || disposed || record.listeners.size > 0 || record.lingerTimer) return;
    record.lingerTimer = setTimeout(() => {
      record.lingerTimer = null;
      if (record.listeners.size === 0) {
        teardownIdleRecord(cacheKey, name, args, permissions, record);
      }
    }, ephemeralIdleLingerMs);
    record.lingerTimer.unref?.();
  };

  // In-flight dedup (ENG-22479 review fix 1): two bindings of the same
  // (collection, scope) mounting in one flush share ONE server subscription —
  // the in-flight promise is cached before the await, and the resolved
  // record replaces it for the synchronous attach path.
  const ensureOverlay = (name, descriptor, args) => {
    const cacheKey = `${name}\u0000${scopeKeyOf(args)}`;
    const resolved = recordCache.get(cacheKey);
    if (resolved) return Promise.resolve(resolved);
    const inflight = pendingCache.get(cacheKey);
    if (inflight) return inflight;
    const tearing = teardownCache.get(cacheKey);
    if (tearing) {
      // Rebind racing an idle teardown: wait for the old registration to be
      // unsubscribed, then subscribe fresh (ENG-22527 item 3).
      return tearing.then(() => ensureOverlay(name, descriptor, args));
    }
    const permissions = ephemeralPermissions?.(name, args) ?? [];
    const pending = createRecord(name, args, permissions)
      .then((record) => {
        recordCache.set(cacheKey, record);
        return record;
      })
      .finally(() => {
        pendingCache.delete(cacheKey);
      });
    pendingCache.set(cacheKey, pending);
    return pending;
  };

  for (const [name, descriptor] of descriptors) {
    sourceStarts[name] = 0;
    if (!supportsEphemeral) continue;
    sources[name] = (args, emit) => {
      sourceStarts[name] += 1;
      let active = true;
      let offListener = null;
      let initialRetryTimer = null;
      let initialRetryAttempts = 0;
      const cacheKey = `${name}\u0000${scopeKeyOf(args)}`;
      const cached = recordCache.get(cacheKey);
      const permissions = ephemeralPermissions?.(name, args) ?? [];
      const clearInitialRetry = () => {
        if (initialRetryTimer) {
          clearTimeout(initialRetryTimer);
          initialRetryTimer = null;
        }
      };
      const attach = (record) => {
        clearInitialRetry();
        initialRetryAttempts = 0;
        if (!active || disposed) {
          // The observer went away while the subscribe was in flight: give
          // the now-observerless room its linger window (ENG-22527 item 3).
          armIdleLinger(cacheKey, name, args, permissions, record);
          return;
        }
        if (record.lingerTimer) {
          // Re-bind within the linger window: cancel and reuse.
          clearTimeout(record.lingerTimer);
          record.lingerTimer = null;
        }
        const listener = () => emit(toMapCell(record, descriptor));
        record.listeners.add(listener);
        offListener = () => {
          record.listeners.delete(listener);
          if (record.listeners.size === 0) {
            armIdleLinger(cacheKey, name, args, permissions, record);
          }
        };
        publishAuthorityEffect(captureForRecord(record), listener);
      };
      const scheduleInitialRetry = () => {
        if (!active || disposed || initialRetryTimer) return;
        const delay = Math.min(
          RESYNC_BASE_DELAY_MS * 2 ** initialRetryAttempts,
          RESYNC_MAX_DELAY_MS,
        );
        initialRetryAttempts += 1;
        initialRetryTimer = setTimeout(() => {
          initialRetryTimer = null;
          tryAttach();
        }, delay);
        initialRetryTimer.unref?.();
      };
      const tryAttach = () => {
        void ensureOverlay(name, descriptor, args)
          .then((record) => attach(record))
          .catch((error) => {
            if (!active || disposed) return;
            console.warn(`[snapback-contract] ephemeral subscribe failed for "${name}"`, error);
            publishAuthorityEffect(authorityCapture, () => {
              emit({ status: 'error', entries: [] });
            });
            scheduleInitialRetry();
          });
      };
      if (cached) {
        // Prewarmed/shared overlay: the ready snapshot delivers synchronously.
        attach(cached);
      } else {
        tryAttach();
      }
      return () => {
        active = false;
        clearInitialRetry();
        offListener?.();
      };
    };
  }

  return {
    descriptors,
    sources,
    supportsEphemeral,
    sourceStarts: (name) => sourceStarts[name] ?? 0,
    prewarm: async () => {
      if (!supportsEphemeral) return;
      // Prewarm zero-arg scopes only when the descriptor has no scope fields;
      // scoped rooms subscribe on first bind (their args are app data).
      for (const [name, descriptor] of descriptors) {
        if ((descriptor.scopeFields ?? []).length === 0) {
          await ensureOverlay(name, descriptor, {}).catch(() => {});
        }
      }
    },
    prewarmScope: async (name, args) => {
      const descriptor = manifest?.queries?.[name];
      if (!supportsEphemeral || !descriptor) return;
      await ensureOverlay(name, descriptor, args ?? {}).catch(() => {});
    },
    buildLinks: (provider, runtime) => {
      const links = {};
      for (const [name] of descriptors) {
        links[name] = (args = {}) => runtime.createProviderEphemeralHandle(provider, name, args ?? {});
        links[`${name}Publish`] = (args = {}) => {
          const { value, ttlMs = null, ...scope } = args ?? {};
          const permissions = ephemeralPermissions?.(name, scope) ?? [];
          // Presence publishes are not durable mutations: no optimistic
          // layer, no pending/flush participation; the socket's latest-state
          // coalescing owns delivery (LLP 0013).
          const dispatch = () => client.publishEphemeral(name, {
            connectionId,
            scope,
            value,
            ttlMs,
            userId,
            permissions,
          });
          return typeof preflightAuthorityDispatch === 'function'
            ? Promise.resolve(preflightAuthorityDispatch(authorityCapture)).then(dispatch)
            : dispatch();
        };
      }
      return links;
    },
    dispose: () => {
      disposed = true;
      for (const dispose of [...disposals]) {
        try {
          dispose();
        } catch {
          // best-effort teardown
        }
      }
      disposals.clear();
      recordCache.clear();
      pendingCache.clear();
    },
  };
}

// Keep provider source identities stable across an authority transition. Exact
// subscribes to the source function installed when the provider is built; just
// replacing the underlying wiring would otherwise leave mounted components on
// a disposed predecessor source, potentially frozen on predecessor entries.
// The router quiesces callbacks, emits a synchronous empty cell at `blank`,
// prepares successor subscriptions while still hidden, then exposes their
// latest cells only after the caller's authority-fenced snapshot commit.
function createSwappableEphemeralWiring(initialWiring, {
  generationSeed = 0,
  onLifecycleTerminal = null,
} = {}) {
  let current = initialWiring;
  let generation = generationSeed;
  let blanked = false;
  let disposed = false;
  let lifecycleTerminalError = null;
  const records = new Set();
  const sourceStarts = new Map();
  const descriptorNames = initialWiring.descriptors.map(([name]) => name);
  const blankCell = () => ({ status: 'ready', entries: [], connection: 'stale' });

  const detach = (record) => {
    try { record.off?.(); } catch { /* best-effort predecessor teardown */ }
    record.off = null;
  };
  const attach = (record) => {
    detach(record);
    const source = current?.sources?.[record.name];
    if (disposed || typeof source !== 'function') {
      record.lastCell = blankCell();
      return;
    }
    const attachedGeneration = generation;
    record.off = source(record.args, (cell) => {
      if (!record.active || disposed || attachedGeneration !== generation) return;
      record.lastCell = cell;
      if (!blanked) {
        try { record.emit(cell); } catch { /* isolate */ }
      }
    });
  };

  const close = (error = null) => {
    if (disposed) return;
    disposed = true;
    lifecycleTerminalError = error;
    blanked = true;
    for (const record of records) {
      detach(record);
      record.lastCell = blankCell();
      try { record.emit(record.lastCell); } catch { /* isolate */ }
      record.active = false;
    }
    records.clear();
    current?.dispose?.();
    current = null;
    if (error) onLifecycleTerminal?.(error);
  };

  const advance = () => {
    try {
      generation = nextContractLifecycleGeneration(
        generation,
        'ephemeral-wiring',
      );
      return true;
    } catch (error) {
      close(error);
      return false;
    }
  };

  const sources = Object.fromEntries(descriptorNames.map((name) => [name, (args, emit) => {
    sourceStarts.set(name, (sourceStarts.get(name) ?? 0) + 1);
    const record = {
      name,
      args,
      emit,
      active: true,
      off: null,
      lastCell: blankCell(),
    };
    records.add(record);
    attach(record);
    if (blanked) {
      try { emit(blankCell()); } catch { /* isolate */ }
    }
    return () => {
      record.active = false;
      detach(record);
      records.delete(record);
    };
  }]));

  return {
    descriptors: initialWiring.descriptors,
    sources,
    supportsEphemeral: initialWiring.supportsEphemeral === true,
    sourceStarts: (name) => sourceStarts.get(name) ?? 0,
    prewarm: () => current?.prewarm?.() ?? Promise.resolve(),
    prewarmScope: (name, args) => current?.prewarmScope?.(name, args) ?? Promise.resolve(),
    buildLinks(provider, runtime) {
      const links = {};
      for (const name of descriptorNames) {
        links[name] = (args = {}) => runtime.createProviderEphemeralHandle(provider, name, args ?? {});
        links[`${name}Publish`] = (args = {}) => {
          if (!current) throw staleContractAuthorityError();
          const active = current.buildLinks(provider, runtime)[`${name}Publish`];
          if (typeof active !== 'function') throw staleContractAuthorityError();
          return active(args);
        };
      }
      return links;
    },
    quiesce() {
      if (disposed || !advance()) return;
      for (const record of records) detach(record);
      current?.dispose?.();
      current = null;
    },
    blank() {
      if (disposed) return;
      blanked = true;
      for (const record of records) {
        record.lastCell = blankCell();
        try { record.emit(record.lastCell); } catch { /* isolate */ }
      }
    },
    prepare(nextWiring) {
      if (disposed) {
        nextWiring?.dispose?.();
        return;
      }
      if (!advance()) {
        nextWiring?.dispose?.();
        return;
      }
      current?.dispose?.();
      current = nextWiring;
      blanked = true;
      for (const record of records) attach(record);
    },
    expose() {
      if (disposed) return;
      blanked = false;
      for (const record of records) {
        try { record.emit(record.lastCell ?? blankCell()); } catch { /* isolate */ }
      }
    },
    dispose() {
      close();
    },
    get lifecycleTerminalError() { return lifecycleTerminalError; },
  };
}

// Narrow white-box seam for deterministic predecessor-callback testing. App
// code uses createSnapbackContractSurface; this exposes no production state.
export function __createSwappableEphemeralWiringForTests(initialWiring, options) {
  return createSwappableEphemeralWiring(initialWiring, options);
}

// Key-order-insensitive canonical form for args comparison (the multi-live
// binding-args mismatch check): plain objects get sorted keys recursively;
// arrays and primitives pass through.
function sortValueDeep(value) {
  if (Array.isArray(value)) return value.map(sortValueDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortValueDeep(entry)]),
    );
  }
  return value;
}

function defaultContractRootId() {
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  return `root_${unique}`;
}

function defaultContractConnectionId() {
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  return `contract_${unique}`;
}

// Multi-query live surface (LLP 0034 §6 ownership row 3; Exact LLP 0284 §5.3).
//
// Each named live query gets its own boundary key (the query name), its own
// snapshot-with-subscribe over the kit's stream transport (one shared socket
// per connection), and its own connection axis; server-authored live_replace
// rows are written straight into the boundary — no app-code pump. Query links
// return provider-backed handles (runtime.createProviderQueryHandle) whose
// deliveries carry the full cell, so `async … stale rows` sugar and
// `<binding>.connection` work in the .contract. Non-live queries serve empty
// ready cells (nothing in the All Aboard surface consumes them — the static
// schedule ships in the shared model); mutations persist server-side with
// pending tracking and no optimistic layer — freshness for live-bound queries
// is owned by the push, not reconcile-on-mutate.
async function createMultiLiveContractSurface({
  runtime,
  client,
  userId,
  coordinator = null,
  authorityCapture = null,
  manifest,
  clientStore = null,
  liveQueries,
  requiredQueries = null,
  livePush,
  liveFallbackToPoll,
  connectionId,
  liveStreamOptions,
  onConnectionChange,
  onSubscriptionEvent,
  rootId,
  detachReceiptListener = null,
  attachReceiptListener = null,
  releaseStoreRegistration = null,
  ephemeralPermissions = null,
  ephemeralIdleLingerMs = EPHEMERAL_IDLE_LINGER_MS,
  lifecycleGenerationSeeds = Object.freeze({}),
  diagnostics,
  pending,
  mountedHandles,
  rqsPreload = null,
  rqsRegistered = null,
}) {
  const liveHandles = new Map(); // query name -> kit live handle
  const authorizationHidden = new Set();
  let ephemeralWiring = null;
  let currentCapture = authorityCapture;
  let activeUserId = effectiveContractUserId(coordinator, null, userId);
  let unregisterSurfaceParticipant = null;
  try {
    if (typeof runtime.createProviderQueryHandle !== 'function') {
      throw new Error(
        'createSnapbackContractSurface liveQueries mode requires an Exact runtime with createProviderQueryHandle (LLP 0284 §2.2).',
      );
    }
    const queryNames = Object.keys(manifest?.queries ?? {});
    const mutationNames = Object.keys(manifest?.mutations ?? {});
    // A liveQueries entry is a name or `{ name, args }` — a scoped live query
    // (e.g. graffiti's board-scoped listCells) subscribes with its validated
    // args; bare-name entries keep the original zero-arg behavior.
    //
    // INVARIANT (LLP 0034 §10.4): the configured entry's args are the ONLY args
    // that reach the server — one subscription per query name, established here.
    // Binding-site args on the read path are not consulted; a binding whose args
    // deep-differ from the configured entry's gets a structured
    // SNAPBACK_CONTRACT_LIVEQUERY_ARGS_MISMATCH diagnostic (plus a dev warning)
    // instead of silently receiving the other scope's rows unlabeled.
    const liveQueryEntries = liveQueries.map((entry) =>
      typeof entry === 'string' ? { name: entry, args: {} } : { name: entry.name, args: entry.args ?? {} });
    const liveQueryNames = liveQueryEntries.map((entry) => entry.name);
    const configuredLiveArgs = new Map(liveQueryEntries.map((entry) => [entry.name, entry.args]));
    const configuredQueryNames = new Set(liveQueryNames);
    for (const name of liveQueryNames) {
      if (!manifest?.queries?.[name]) {
        throw new Error(`liveQueries names an unknown manifest query "${name}".`);
      }
    }
    // Duplicate names would silently clobber each other (liveHandles and the
    // boundary are keyed by name only) — reject with a structured diagnostic.
    if (configuredLiveArgs.size !== liveQueryEntries.length) {
      const duplicates = [...new Set(liveQueryNames.filter((name, i) => liveQueryNames.indexOf(name) !== i))];
      const diagnostic = contractDiagnostic(
        'SNAPBACK_CONTRACT_LIVEQUERY_DUPLICATE',
        `liveQueries names each query at most once; duplicates: ${duplicates.join(', ')}. One subscription per query name — to scope it, pass { name, args } once.`,
        { duplicates },
      );
      const error = new Error(diagnostic.message);
      error.diagnostic = diagnostic;
      throw error;
    }
    if (requiredQueries !== null) {
      if (!Array.isArray(requiredQueries)) {
        throw new TypeError('createSnapbackContractSurface requiredQueries must be an array when provided.');
      }
      const requiredQueryNames = requiredQueries.map((entry) =>
        typeof entry === 'string' ? entry : entry?.name
      );
      const unknownRequired = requiredQueryNames.filter((name) =>
        typeof name !== 'string' || !manifest?.queries?.[name]
      );
      if (unknownRequired.length > 0) {
        const diagnostic = contractDiagnostic(
          'SNAPBACK_CONTRACT_REQUIRED_QUERY_UNKNOWN',
          `requiredQueries names unknown manifest queries: ${unknownRequired.join(', ')}. Regenerate the Contract data manifest or correct the component binding list.`,
          { queries: unknownRequired, configurationSurface: 'requiredQueries' },
        );
        const error = new Error(diagnostic.message);
        error.code = diagnostic.code;
        error.diagnostic = diagnostic;
        throw error;
      }
      const missingRequired = requiredQueryNames.filter((name) => (
        manifest?.queries?.[name]?.ephemeral !== true
        && !configuredQueryNames.has(name)
      ));
      if (missingRequired.length > 0) {
        const diagnostic = contractDiagnostic(
          'SNAPBACK_CONTRACT_QUERY_UNCONFIGURED',
          `Contract query bindings are required by the mounted component but omitted from liveQueries: ${missingRequired.join(', ')}. Add each query (and its scoped args) to liveQueries before mounting the surface.`,
          {
            queries: missingRequired,
            configuredQueries: [...liveQueryNames],
            configurationSurface: 'liveQueries',
          },
        );
        const error = new Error(diagnostic.message);
        error.code = diagnostic.code;
        error.diagnostic = diagnostic;
        throw error;
      }
    }

    let disposed = false;
    let barrierPaused = false;
    let barrierBlanking = false;
    let barrierPreparing = false;
    let boundary = null;
    let lifecycleTerminalError = null;
    let disposeTask = null;
    if (
      coordinator?.authority?.kind === 'servicePrincipal'
      && typeof client.authSession === 'function'
    ) {
      const authSession = await client.authSession();
      activeUserId = effectiveContractUserId(coordinator, authSession, userId);
    }
    const sharedConnectionId = connectionId ?? defaultContractConnectionId();
    const liveCellObservers = new Map(); // query name -> Set<record>
    const wantLivePush = livePush && typeof client.liveQuery === 'function';
    // A configured entry that will be subscribed live must be a live query in
    // the manifest. A snapshot query configured here could only fail later, at
    // subscribe time, with a transport diagnostic — refuse at construction
    // with the offenders named instead
    // (issues/20260718-refuse-non-live-query-bindings-in-multi-live-contract-surfaces.md).
    if (wantLivePush) {
      const notLive = liveQueryEntries
        .map((entry) => entry.name)
        .filter((name) => {
          const descriptor = manifest?.queries?.[name] ?? {};
          return descriptor.livePush === false || descriptor.mode === 'snapshot';
        });
      if (notLive.length > 0) {
        const diagnostic = contractDiagnostic(
          'SNAPBACK_CONTRACT_LIVEQUERY_NOT_LIVE',
          `liveQueries configures non-live manifest queries: ${notLive.join(', ')}. Author UI-facing reads as live queries, or pass livePush: false for a poll/reconcile surface.`,
          { queries: notLive },
        );
        const error = new Error(diagnostic.message);
        error.diagnostic = diagnostic;
        throw error;
      }
    }
    const confirmDurableAuthority = createDurableAuthorityConfirmer(coordinator);
    const recordLifecycleDiagnostic = (error) => {
      if (!diagnostics.some((entry) => (
        entry.code === error.code
        && entry.details?.axis === error.diagnostic.details.axis
      ))) diagnostics.push(error.diagnostic);
    };
    ephemeralWiring = createSwappableEphemeralWiring(buildEphemeralWiring({
      client,
      manifest,
      connectionId: sharedConnectionId,
      userId: activeUserId,
      ephemeralPermissions,
      ephemeralIdleLingerMs,
      authorityCapture: currentCapture,
      commitAuthorityPublication: coordinator
        ? (capture, commit) => compareContractCommit(client, coordinator, capture, commit)
        : null,
      preflightAuthorityDispatch: coordinator
        ? (capture) => preflightDurable(capture)
        : null,
      onAuthorityRefused: () => {
        void confirmDurableAuthority().catch(() => {});
      },
      socketLossGenerationSeed: lifecycleGenerationSeeds.socketLoss ?? 0,
      onLifecycleTerminal: recordLifecycleDiagnostic,
    }), {
      generationSeed: lifecycleGenerationSeeds.ephemeralWiring ?? 0,
      onLifecycleTerminal: (error) => terminalizeSurfaceLifecycle(error),
    });
    // isCurrent() below is only the synchronous fast hint; publication gates
    // reload durable custody through confirmDurableAuthority.
    const assertActive = () => {
      if (lifecycleTerminalError) throw lifecycleTerminalError;
      if (disposed) {
        throw new Error('Snapback Contract surface was used after dispose().');
      }
      if (barrierPaused || (coordinator && !coordinator.isCurrent(currentCapture))) {
        throw staleContractAuthorityError();
      }
    };
    const operationCapture = () => {
      if (!coordinator) return null;
      if (barrierPaused) throw staleContractAuthorityError();
      return clientOwnsAuthorityFence(client, coordinator) && typeof client?.captureAuthority === 'function'
        ? client.captureAuthority()
        : coordinator.capture();
    };
    const commitCurrent = async (capture, commit) => {
      const outcome = await compareContractCommit(client, coordinator, capture, commit);
      if (!outcome.committed) {
        await confirmDurableAuthority();
        throw staleContractAuthorityError();
      }
      return outcome.value;
    };
    const preflightDurable = async (capture) => {
      if (!coordinator) return;
      // @ref LLP 0059#cross-context-ownership — multi-live app-data transport
      // has the same mandatory durable predecessor gate as single-query mode.
      await confirmDurableAuthority();
      const outcome = await compareContractCommit(
        client,
        coordinator,
        capture,
        () => undefined,
      );
      if (!outcome.committed) throw staleContractAuthorityError();
    };

    const publishDiagnostic = (code, message, details = {}) => {
      const diagnostic = contractDiagnostic(code, message, details);
      diagnostics.push(diagnostic);
      return diagnostic;
    };

    // Binding-site args are not consulted on the multi-live read path (the
    // configured entry owns the one subscription) — so a binding that ASKS for
    // a different scope must be told it is not getting it, not silently served
    // the configured scope's rows (LLP 0034 §10.4). Diagnosed once per
    // (query, distinct binding args).
    const argsMismatchSeen = new Set();
    const unconfiguredSeen = new Set();
    const stableArgsKey = (value) => JSON.stringify(sortValueDeep(value ?? {}));
    const warnOnBindingArgsMismatch = (name, bindingArgs) => {
      const configured = configuredLiveArgs.get(name);
      if (configured === undefined) return;
      const bindingKey = stableArgsKey(bindingArgs);
      if (bindingKey === stableArgsKey(configured)) return;
      const seenKey = `${name}\u0000${bindingKey}`;
      if (argsMismatchSeen.has(seenKey)) return;
      argsMismatchSeen.add(seenKey);
      const diagnostic = publishDiagnostic(
        'SNAPBACK_CONTRACT_LIVEQUERY_ARGS_MISMATCH',
        `query binding "${name}" passed args that differ from the configured liveQueries entry; the subscription serves the configured args only.`,
        { query: name, bindingArgs: bindingArgs ?? {}, configuredArgs: configured },
      );
      console.warn(`[snapback-contract] ${diagnostic.message}`, { bindingArgs, configuredArgs: configured });
    };

    const connectionFor = (name) =>
      (wantLivePush && liveHandles.has(name) ? liveHandles.get(name).connection ?? 'connecting' : null);

    const reemitCells = (name, connection) => {
      for (const record of [...(liveCellObservers.get(name) ?? [])]) {
        if (record.confirmed && record.lastCell) {
          try { record.emit({ ...record.lastCell, connection }); } catch { /* isolate */ }
        }
      }
    };
    const decorateCell = (name, cell) => (
      wantLivePush ? { ...cell, connection: connectionFor(name) } : cell
    );
    const publishRows = async (capture, name, rows) => {
      const outcome = await compareContractCommit(client, coordinator, capture, () => {
        if (!disposed && boundary && !authorizationHidden.has(name)) {
          boundary.write(name, () => rows);
        }
        return rows;
      });
      if (!outcome.committed) {
        // A failed commit's durable reload observed an unadopted successor
        // (missed/lost wakeup): run the mandatory reload so this surface
        // blanks instead of retaining the predecessor boundary.
        void confirmDurableAuthority().catch(() => {});
        return null;
      }
      return outcome.value;
    };

    const openMultiLiveHandle = async ({ name, args }, capture) => {
      if (coordinator) await preflightDurable(capture);
      // Channel A alias-key consumption (LLP 0092 §0C.5): the preload was
      // minted anonymously; this (possibly authenticated) subscription
      // adopts it as its own store seed — one store, one subscription, the
      // kit verifies and arbitrates before rendering it retained.
      let preloadedResume = null;
      if (typeof rqsPreload === 'function') {
        try {
          preloadedResume = rqsPreload(name, args) ?? null;
        } catch {
          preloadedResume = null; // preload is best-effort, never boot-fatal
        }
      }
      // Channel C register-mode adoption (LLP 0090 D4 step 7): a bundle
      // registration for this (name, args) is adopted instead of opening a
      // fresh snapshot-with-subscribe; best-effort like the preload seam.
      let registeredSubscription = null;
      if (typeof rqsRegistered === 'function') {
        try {
          registeredSubscription = rqsRegistered(name, args) ?? null;
        } catch {
          registeredSubscription = null;
        }
      }
      const handle = await client.liveQuery(name, {
        connectionId: sharedConnectionId,
        args,
        userId: activeUserId,
        authorityCapture: capture,
        preloadedResume,
        registeredSubscription,
        transport: 'stream',
        fallbackToPoll: liveFallbackToPoll,
        stream: liveStreamOptions,
        authorizationQueue: createContractQueryAuthorizationQueue(clientStore, capture),
        onAuthorizationBoundary: (rows, detail = {}) => {
          if (detail.kind === 'authorization_retain') return;
          if (
            detail.kind === 'authorization_quarantine'
            || detail.kind === 'authorization_delete'
            || detail.kind === 'authorization_error'
          ) {
            authorizationHidden.add(name);
            if (!disposed && boundary) boundary.write(name, () => []);
            return;
          }
          if (detail.kind === 'authorization_snapshot') {
            authorizationHidden.delete(name);
            if (!disposed && boundary) boundary.write(name, () => rows);
          }
        },
        // Adapter-stitched correlation (LLP 0034 §3.2); TODO(Exact LLP
        // 0231/0278): thread action/wave ids when the runtime supplies them.
        correlation: { rootId, bindingIds: [name] },
        onUpdate: (rows, detail = {}) => {
          if (String(detail.kind).startsWith('authorization_')) return;
          if (coordinator && barrierPaused) return;
          const callbackCapture = captureForTransportValue(client, capture, rows);
          void publishRows(callbackCapture, name, rows).catch(() => {});
        },
        onConnectionChange: (connection, detail) => {
          const callbackCapture = captureForTransportValue(client, capture, detail);
          // @ref LLP 0059#cross-context-ownership — observer re-emission is the
          // app-facing effect and therefore stays inside the durable commit.
          void compareContractCommit(client, coordinator, callbackCapture, () => {
            reemitCells(name, connection);
            try {
              onConnectionChange?.(connection, { ...detail, queryName: name });
            } catch { /* isolate */ }
          })
            .then((outcome) => {
              if (!outcome.committed) {
                void confirmDurableAuthority().catch(() => {});
              }
            }).catch(() => {});
        },
        onSubscriptionEvent: onSubscriptionEvent
          ? (event) => {
              const callbackCapture = captureForTransportValue(client, capture, event);
              void compareContractCommit(client, coordinator, callbackCapture, () => {
                try { onSubscriptionEvent({ ...event, queryName: name }); } catch { /* isolate */ }
              })
                .then((outcome) => {
                  if (!outcome.committed) {
                    void confirmDurableAuthority().catch(() => {});
                  }
                })
                .catch(() => {});
            }
          : null,
      });
      return {
        name,
        handle,
        capture: captureForTransportValue(client, capture, handle),
      };
    };

    // Establish every live subscription (snapshot-with-subscribe each; one
    // shared socket via the connection id) before the boundary exists, then
    // build the boundary from the snapshots. Non-configured queries are not
    // initialized as successful empty cells: binding one receives the typed
    // unavailable diagnostic below instead.
    const initialRows = {};
    if (wantLivePush) {
      const liveCapture = currentCapture ?? operationCapture();
      const subscriptions = liveQueryEntries.map((entry) => (
        openMultiLiveHandle(entry, liveCapture)
      ));
      let liveResults;
      try {
        liveResults = await Promise.all(subscriptions);
      } catch (error) {
        for (const subscription of subscriptions) {
          void subscription.then(({ handle }) => handle.dispose?.()).catch(() => {});
        }
        throw error;
      }
      for (const { name, handle, capture } of liveResults) {
        const current = await compareContractCommit(client, coordinator, capture, () => undefined);
        if (!current.committed) {
          handle.dispose?.();
          throw staleContractAuthorityError();
        }
        liveHandles.set(name, handle);
        liveCellObservers.set(name, new Set());
        initialRows[name] = handle.rows;
      }
    } else {
      // `livePush: false` (or a client without liveQuery()) is the documented
      // poll/reconcile opt-out (LLP 0034 D1) — the same contract single-query
      // mode honors: seed each configured entry from a client.query snapshot
      // here, and reconcile all entries after every mutation below. Without
      // this every cell stayed [] with ready status forever while mutations
      // silently committed server-side (ENG-23386).
      for (const { name, args } of liveQueryEntries) {
        const capture = currentCapture ?? operationCapture();
        if (coordinator) await preflightDurable(capture);
        const snapshot = await client.query(name, {
          args,
          userId: activeUserId,
          authorityCapture: capture,
        });
        const resultCapture = captureForTransportValue(client, capture, snapshot);
        const current = await compareContractCommit(client, coordinator, resultCapture, () => undefined);
        if (!current.committed) throw staleContractAuthorityError();
        // Coordinated poll-mode observers are tracked too: their initial
        // publication waits for the same durable custody confirmation.
        liveCellObservers.set(name, new Set());
        initialRows[name] = snapshot.rows;
      }
    }
    boundary = runtime.createContractMockQueryBoundary(initialRows);
    for (const [name, handle] of liveHandles) {
      if (handle.rows !== initialRows[name]) {
        // An update that raced boundary creation is not lost.
        const capture = captureForTransportValue(client, currentCapture, handle);
        const published = await publishRows(capture, name, handle.rows);
        if (published === null) throw staleContractAuthorityError();
      }
    }

    const track = (promise) => {
      const task = Promise.resolve(promise);
      pending.add(task);
      task.then(
        () => pending.delete(task),
        () => pending.delete(task),
      );
      return task;
    };

    // Without live push there is no server fan-out to refresh the boundary,
    // so mutations reconcile every configured entry from an authoritative
    // snapshot (ENG-23386). Under push this never runs: the subscriptions'
    // onUpdate fan-out owns the boundary.
    const reconcileLiveQueries = async (capture = operationCapture()) => {
      for (const { name, args } of liveQueryEntries) {
        if (coordinator) await preflightDurable(capture);
        const snapshot = await client.query(name, {
          args,
          userId: activeUserId,
          authorityCapture: capture,
        });
        const resultCapture = captureForTransportValue(client, capture, snapshot);
        const published = await publishRows(resultCapture, name, snapshot.rows);
        if (published === null) throw staleContractAuthorityError();
      }
    };

    const persistMutation = async (name, args, capture = operationCapture()) => {
      // Multi-live mutations have no optimistic publication turn to provide an
      // earlier fence. Perform the same mandatory durable reload/preflight as
      // single-query mutations before the transport sees predecessor args.
      await preflightDurable(capture);
      try {
        const rawOutput = await client.mutate(name, {
          args,
          userId: activeUserId,
          queue: false,
          correlation: { rootId, bindingIds: [...liveQueryNames] },
          authorityCapture: capture,
        });
        const resultCapture = captureForTransportValue(client, capture, rawOutput);
        normalizeContractMutationOutput(rawOutput);
        await commitCurrent(resultCapture, () => undefined);
      } catch (error) {
        const errorCapture = captureForTransportValue(client, capture, error);
        if (coordinator && !coordinator.isCurrent(errorCapture)) {
          throw staleContractAuthorityError();
        }
        publishDiagnostic('SNAPBACK_CONTRACT_MUTATION_FAILED', error instanceof Error ? error.message : String(error), {
          mutation: name,
          args,
        });
        throw error;
      }
      if (!wantLivePush) {
        try {
          await reconcileLiveQueries(capture);
        } catch (reconcileError) {
          // The mutation committed; only the refresh failed. Surface that
          // honestly (stale boundary, not a failed mutation) and propagate.
          publishDiagnostic(
            'SNAPBACK_CONTRACT_RECONCILE_FAILED',
            reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
            { mutation: name, args },
          );
          throw reconcileError;
        }
      }
    };

    const providerQueries = {};
    for (const name of queryNames) {
      if (manifest?.queries?.[name]?.ephemeral === true) continue; // §2.4 kind split
      if (!configuredQueryNames.has(name)) continue;
      providerQueries[name] = (_args, qb) => qb.query(name, (rows) => rows, { key: name });
    }
    const providerMutations = {};
    for (const name of mutationNames) {
      providerMutations[name] = async (args) => {
        assertActive();
        const capture = operationCapture();
        await track(persistMutation(name, args, capture));
      };
    }

    await ephemeralWiring.prewarm();

    const baseProvider = runtime.createBoundaryContractDataProvider(manifest, boundary, {
      queries: providerQueries,
      mutations: providerMutations,
      ephemerals: ephemeralWiring.sources,
    });

    // DataCellV2 connection axis: cells for live-bound queries carry their own
    // query's connection; the field stays absent elsewhere.
    const provider = {
      ...baseProvider,
      subscribe(subscribedQuery, args, observer) {
        if (!configuredQueryNames.has(subscribedQuery)) {
          const diagnostic = publishDiagnostic(
            'SNAPBACK_CONTRACT_QUERY_UNCONFIGURED',
            `query binding "${subscribedQuery}" is present in the manifest but omitted from this surface's liveQueries configuration — add { name: '${subscribedQuery}', args } to liveQueries (multi-live surfaces serve configured live queries only; author UI-facing snapshot reads as live queries).`,
            { query: subscribedQuery, configuredQueries: [...liveQueryNames] },
          );
          // The error cell renders through the binding's error branch, which a
          // designed view can make look like ordinary product state — say it
          // loudly once per query where the author is actually looking.
          if (!unconfiguredSeen.has(subscribedQuery)) {
            unconfiguredSeen.add(subscribedQuery);
            console.error(`[snapback-contract] ${diagnostic.message}`);
          }
          observer({
            status: 'error',
            rows: [],
            value: [],
            connection: null,
            diagnostic,
          });
          return { dispose() {} };
        }
        warnOnBindingArgsMismatch(subscribedQuery, args);
        if (!coordinator && !liveHandles.has(subscribedQuery)) {
          return baseProvider.subscribe(subscribedQuery, args, observer);
        }
        const records = liveCellObservers.get(subscribedQuery);
        const record = {
          lastCell: null,
          // Initial publication to a new observer waits for a durable custody
          // reload; in-memory currency alone cannot authorize it.
          confirmed: !coordinator,
          emit: (cell) => observer(cell),
        };
        records.add(record);
        const subscription = baseProvider.subscribe(subscribedQuery, args, (cell) => {
          if (coordinator && !record.confirmed && !barrierBlanking) {
            // Buffer until the durable reload confirms this authority; blank
            // cells still pass below.
            record.lastCell = cell;
            return;
          }
          if (coordinator && barrierPreparing && !barrierBlanking) {
            record.lastCell = cell;
            return;
          }
          if (
            coordinator
            && !barrierBlanking
            && (barrierPaused || !coordinator.isCurrent(currentCapture))
          ) return;
          record.lastCell = cell;
          observer(decorateCell(subscribedQuery, cell));
        });
        if (coordinator && !record.confirmed) {
          void confirmDurableAuthority().then(() => {
            const confirmationCapture = currentCapture;
            return compareContractCommit(client, coordinator, confirmationCapture, () => {
              if (record.confirmed || disposed || !records.has(record)) return;
              record.confirmed = true;
              if (record.lastCell && !barrierPaused && !barrierPreparing) {
                try {
                  observer(decorateCell(subscribedQuery, record.lastCell));
                } catch { /* isolate */ }
              }
            });
          }).catch(() => {});
        }
        return {
          dispose() {
            records.delete(record);
            subscription.dispose();
          },
        };
      },
    };

    const links = {};
    for (const name of queryNames) {
      if (manifest?.queries?.[name]?.ephemeral === true) continue; // bound below
      links[name] = (args = {}) => {
        assertActive();
        if (coordinator) void confirmDurableAuthority().catch(() => {});
        return runtime.createProviderQueryHandle(provider, name, args ?? {});
      };
    }
    for (const name of mutationNames) {
      links[name] = (args) => {
        assertActive();
        const capture = operationCapture();
        return track(persistMutation(name, args, capture));
      };
    }
    const ephemeralLinks = ephemeralWiring.buildLinks(provider, runtime);
    for (const [name, link] of Object.entries(ephemeralLinks)) {
      if (!name.endsWith('Publish')) {
        links[name] = (args) => {
          assertActive();
          return link(args);
        };
        continue;
      }
      links[name] = (args) => {
        assertActive();
        const capture = operationCapture();
        const result = link(args);
        if (!coordinator) return result;
        return Promise.resolve(result).then(async (value) => {
          const resultCapture = captureForTransportValue(client, capture, value);
          return commitCurrent(resultCapture, () => value);
        });
      };
    }

    let resumeGeneration = lifecycleGenerationSeeds.resume ?? 0;
    let resumeTimer = null;
    let resumeTimerResolve = null;
    let resumeTask = Promise.resolve();
    const cancelResumeTimer = () => {
      const settle = resumeTimerResolve;
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      resumeTimer = null;
      resumeTimerResolve = null;
      settle?.();
    };
    const terminalizeSurfaceLifecycle = (error) => {
      if (lifecycleTerminalError) return;
      lifecycleTerminalError = error;
      barrierPaused = true;
      barrierPreparing = false;
      cancelResumeTimer();
      detachReceiptListener?.();
      for (const [, handle] of liveHandles) handle.dispose?.();
      liveHandles.clear();
      barrierBlanking = true;
      try {
        if (boundary) {
          for (const name of liveQueryNames) boundary.write(name, () => []);
        }
        ephemeralWiring?.blank?.();
      } finally {
        barrierBlanking = false;
      }
      ephemeralWiring?.dispose?.();
      for (const records of liveCellObservers.values()) {
        for (const record of records) record.lastCell = null;
      }
      recordLifecycleDiagnostic(error);
    };
    const advanceResumeGeneration = () => {
      try {
        resumeGeneration = nextContractLifecycleGeneration(
          resumeGeneration,
          'multi-surface-resume',
        );
        return true;
      } catch (error) {
        terminalizeSurfaceLifecycle(error);
        return false;
      }
    };
    const scheduleAuthorityRefresh = (context) => {
      if (disposed || lifecycleTerminalError) return;
      const generation = resumeGeneration;
      resumeTask = new Promise((resolve) => {
        const settle = () => {
          if (resumeTimerResolve === settle) {
            resumeTimer = null;
            resumeTimerResolve = null;
          }
          resolve();
        };
        resumeTimerResolve = settle;
        resumeTimer = setTimeout(settle, 0);
      }).then(async () => {
        if (
          generation !== resumeGeneration
          || disposed
          || lifecycleTerminalError
        ) return;
        currentCapture = context.capture;
        const authSession = context.authority?.kind === 'servicePrincipal'
          && typeof client.authSession === 'function'
          ? await client.authSession()
          : null;
        activeUserId = effectiveContractUserId(coordinator, authSession, userId);
        const stagedRows = new Map();
        const opened = [];
        try {
          if (wantLivePush) {
            for (const entry of liveQueryEntries) {
              const result = await openMultiLiveHandle(entry, context.capture);
              if (generation !== resumeGeneration || disposed || lifecycleTerminalError) {
                result.handle.dispose?.();
                return;
              }
              const current = await compareContractCommit(
                client,
                coordinator,
                result.capture,
                () => undefined,
              );
              if (!current.committed) {
                result.handle.dispose?.();
                throw staleContractAuthorityError();
              }
              opened.push(result);
              stagedRows.set(result.name, result.handle.rows);
            }
          } else {
            for (const { name, args } of liveQueryEntries) {
              if (coordinator) await preflightDurable(context.capture);
              const snapshot = await client.query(name, {
                args,
                userId: activeUserId,
                authorityCapture: context.capture,
              });
              const capture = captureForTransportValue(client, context.capture, snapshot);
              const current = await compareContractCommit(client, coordinator, capture, () => undefined);
              if (!current.committed) throw staleContractAuthorityError();
              stagedRows.set(name, snapshot.rows);
            }
          }
        } catch (error) {
          for (const result of opened) result.handle.dispose?.();
          throw error;
        }

        const ephemeralMayResume = ephemeralWiringMayResume(
          ephemeralWiring,
          context.authority,
        );
        if (ephemeralMayResume) {
          const successorEphemeral = buildEphemeralWiring({
            client,
            manifest,
            connectionId: sharedConnectionId,
            userId: activeUserId,
            ephemeralPermissions,
            ephemeralIdleLingerMs,
            authorityCapture: context.capture,
            commitAuthorityPublication: (capture, commit) => (
              compareContractCommit(client, coordinator, capture, commit)
            ),
            preflightAuthorityDispatch: (capture) => preflightDurable(capture),
            onAuthorityRefused: () => {
              void confirmDurableAuthority().catch(() => {});
            },
            socketLossGenerationSeed: lifecycleGenerationSeeds.socketLoss ?? 0,
            onLifecycleTerminal: recordLifecycleDiagnostic,
          });
          ephemeralWiring.prepare(successorEphemeral);
          await ephemeralWiring.prewarm();
        }

        if (
          generation !== resumeGeneration
          || disposed
          || lifecycleTerminalError
          || !coordinator.isCurrent(context.capture)
        ) {
          for (const result of opened) result.handle.dispose?.();
          return;
        }
        let installed = false;
        try {
          barrierPreparing = true;
          const exposed = await compareContractCommit(client, coordinator, context.capture, () => {
            if (
              disposed
              || lifecycleTerminalError
              || generation !== resumeGeneration
            ) {
              barrierPreparing = false;
              return;
            }
            for (const [name, rows] of stagedRows) {
              if (!authorizationHidden.has(name)) boundary.write(name, () => rows);
            }
            for (const result of opened) {
              liveHandles.set(result.name, result.handle);
            }
            installed = true;
            barrierPreparing = false;
            if (ephemeralMayResume) ephemeralWiring.expose();
            attachReceiptListener?.();
            barrierPaused = false;
            for (const [name, records] of liveCellObservers) {
              for (const record of records) {
                record.confirmed = true;
                if (record.lastCell) {
                  try { record.emit(decorateCell(name, record.lastCell)); } catch { /* isolate */ }
                }
              }
            }
          });
          if (!exposed.committed) return;
        } finally {
          if (!installed) {
            for (const result of opened) result.handle.dispose?.();
          }
        }
      }).catch(() => {
        // Remain blank/paused until a later successful authority refresh.
      });
    };

    if (coordinator) {
      unregisterSurfaceParticipant = registerContractParticipant(client, coordinator, {
        name: `snapback-contract-multi-surface:${rootId}`,
        quiesce() {
          barrierPaused = true;
          if (!advanceResumeGeneration()) return;
          cancelResumeTimer();
          detachReceiptListener?.();
          for (const [, handle] of liveHandles) handle.dispose?.();
          liveHandles.clear();
          ephemeralWiring?.quiesce?.();
        },
        blank() {
          if (!boundary || disposed) return;
          barrierBlanking = true;
          try {
            for (const name of liveQueryNames) boundary.write(name, () => []);
            ephemeralWiring?.blank?.();
          } finally {
            barrierBlanking = false;
          }
        },
        clearMemory() {
          for (const records of liveCellObservers.values()) {
            for (const record of records) record.lastCell = null;
          }
          pending.clear();
        },
        async commitDurable() {},
        async resume(context) {
          currentCapture = context.capture;
          if (lifecycleTerminalError || disposed) return;
          // @ref LLP 0059#cross-context-ownership — browser multi-live
          // surfaces share the same exact durable resume fence as the
          // single-query surface. Agent custody is one local carrier fence.
          if (client?.authCoordinator === coordinator) {
            await coordinator.synchronize();
          }
          scheduleAuthorityRefresh(context);
        },
      });
      const current = await compareContractCommit(client, coordinator, currentCapture, () => undefined);
      if (!current.committed) throw staleContractAuthorityError();
    }

    return {
      adapterVersion: SNAPBACK_CONTRACT_ADAPTER_VERSION,
      capabilityClass: SNAPBACK_CONTRACT_CAPABILITY_CLASS,
      boundary,
      links,
      provider,
      registerEphemeralRepublisher: (reference, callback) => (
        client.registerEphemeralRepublisher(reference, callback)
      ),
      diagnostics,
      pendingCount: () => pending.size,
      declaredQueries: queryNames,
      declaredMutations: mutationNames,
      livePush: wantLivePush,
      liveQueries: [...liveQueryNames],
      connectionId: sharedConnectionId,
      rootId,
      receipts: () => {
        if (typeof client.receipts !== 'function') return [];
        if (coordinator) {
          void confirmDurableAuthority().catch(() => {});
          return [];
        }
        return client.receipts();
      },
      ephemeralSourceStarts: ephemeralWiring.sourceStarts,
      prewarmEphemeral: ephemeralWiring.prewarmScope,
      // Per-query connection facts; no argument = the first live query.
      connection: (name = liveQueryNames[0]) => connectionFor(name),
      connections: () => Object.fromEntries(liveQueryNames.map((name) => [name, connectionFor(name)])),
      mount: (component, options = {}) => {
        // Mount initiates the mandatory durable reload; assertActive is only
        // the synchronous fast hint. The mounted component's query bindings
        // subscribe through the gated provider above, so no cell reaches it
        // before the reload confirms (or blanks) this authority.
        void confirmDurableAuthority().catch(() => {});
        assertActive();
        return rememberMountHandle(mountedHandles, mountSnapbackContractHeadless(runtime, component, options));
      },
      flush: async () => {
        await Promise.all([...pending, resumeTask]);
      },
      dispose: () => {
        if (disposeTask) return disposeTask;
        disposed = true;
        barrierPaused = true;
        cancelResumeTimer();
        detachReceiptListener?.();
        ephemeralWiring.dispose();
        for (const [, handle] of liveHandles) {
          handle.dispose();
        }
        liveHandles.clear();
        liveCellObservers.clear();
        for (const handle of [...mountedHandles]) {
          handle.dispose();
        }
        mountedHandles.clear();
        pending.clear();
        const unregister = unregisterSurfaceParticipant?.();
        unregisterSurfaceParticipant = null;
        const releaseStore = releaseStoreRegistration?.();
        releaseStoreRegistration = null;
        disposeTask = Promise.all([unregister, releaseStore].filter(Boolean));
        return disposeTask;
      },
    };
  } catch (error) {
    // ENG-23383: a mid-construction failure (unknown/duplicate liveQueries
    // names, a mid-loop subscribe rejection, a failed prewarm) must not
    // strand the handles already established — each holds a server-side
    // live subscription, a durable-lane consumer, and onState demand on the
    // shared LiveStreamManager, so leaking them leaves the manager
    // reconnecting forever and the server fanning out to a connection nobody
    // drains. Release them (and the ephemeral wiring) before the error
    // surfaces; the caller detaches the receipt listener.
    for (const [, handle] of liveHandles) {
      try {
        handle.dispose();
      } catch {
        // Best-effort teardown: the construction error is the one to surface.
      }
    }
    liveHandles.clear();
    try {
      ephemeralWiring?.dispose();
    } catch {
      // Best-effort teardown: the construction error is the one to surface.
    }
    try {
      await unregisterSurfaceParticipant?.();
    } catch {
      // Best-effort teardown: the construction error is the one to surface.
    }
    unregisterSurfaceParticipant = null;
    throw error;
  }
}

// Shared bridge for Contract system surfaces such as the Snapback admin console.
//
// @ref LLP 0021#phase-4-move-admin-and-demo-surfaces-onto-the-adapter - admin
//   should consume product-shaped adapter code while remaining a system app over
//   the privileged admin API, not an ordinary generated app-table surface.
export async function createSnapbackSystemContractSurface({
  runtime,
  resources,
  commands = {},
  targetSurface = 'Contract/Exact system surface',
} = {}) {
  if (!runtime || typeof runtime.createContractMockQueryBoundary !== 'function') {
    throw new Error('createSnapbackSystemContractSurface requires a Contract runtime.');
  }
  if (!resources || typeof resources !== 'object') {
    throw new Error('createSnapbackSystemContractSurface requires resource definitions.');
  }

  const diagnostics = [];
  const pending = new Set();
  const mountedHandles = new Set();
  let disposed = false;
  const initialRows = {};

  for (const [name, resource] of Object.entries(resources)) {
    const definition = normalizeResourceDefinition(name, resource);
    initialRows[definition.key] = toBoundaryRows(await resolveInitialRows(definition), definition.key);
  }

  const boundary = runtime.createContractMockQueryBoundary(initialRows);

  const assertActive = () => {
    if (disposed) {
      throw new Error('Snapback Contract system surface was used after dispose().');
    }
  };

  const queryRows = (key) => {
    assertActive();
    return boundary.query(key, (rows) => rows, { key });
  };

  const publish = (key, rows) => {
    if (disposed) return [];
    const nextRows = toBoundaryRows(rows, key);
    boundary.write(key, () => nextRows);
    return nextRows;
  };

  const publishOne = (key, row) => publish(key, [row]);

  const addDiagnostic = (code, message, details = {}) => {
    const diagnostic = contractDiagnostic(code, message, {
      target_surface: targetSurface,
      ...details,
    });
    diagnostics.push(diagnostic);
    return diagnostic;
  };

  const track = (promise) => {
    const task = Promise.resolve(promise);
    pending.add(task);
    task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };

  const context = {
    boundary,
    diagnostics,
    addDiagnostic,
    publish,
    publishOne,
    queryRows,
    targetSurface,
  };

  const links = {};
  for (const [name, resource] of Object.entries(resources)) {
    const definition = normalizeResourceDefinition(name, resource);
    links[definition.binding] = (_args) => queryRows(definition.key);
  }
  for (const [name, command] of Object.entries(commands)) {
    const run = typeof command === 'function' ? command : command?.run;
    if (typeof run !== 'function') {
      throw new Error(`System Contract command "${name}" must be a function.`);
    }
    links[name] = (args = {}) => {
      assertActive();
      const promise = Promise.resolve().then(() => run(args, context));
      return command?.track === false ? promise : track(promise);
    };
  }

  return {
    adapterVersion: SNAPBACK_CONTRACT_ADAPTER_VERSION,
    capabilityClass: SNAPBACK_CONTRACT_CAPABILITY_CLASS,
    targetSurface,
    boundary,
    links,
    diagnostics,
    publish,
    publishOne,
    queryRows,
    pendingCount: () => pending.size,
    mount: (component, options = {}) => {
      assertActive();
      return rememberMountHandle(mountedHandles, mountSnapbackContractHeadless(runtime, component, options));
    },
    flush: async () => {
      await Promise.all([...pending]);
    },
    dispose: () => {
      disposed = true;
      for (const handle of [...mountedHandles]) {
        handle.dispose();
      }
      mountedHandles.clear();
      pending.clear();
    },
  };
}

function rememberMountHandle(mountedHandles, handle) {
  if (!handle || typeof handle.dispose !== 'function') {
    throw new Error('Contract runtime mount() did not return a disposable mount handle.');
  }

  let disposed = false;
  const trackedHandle = {
    ...handle,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      mountedHandles.delete(trackedHandle);
      handle.dispose();
    },
  };
  mountedHandles.add(trackedHandle);
  return trackedHandle;
}

function wrapMountHandle(handle, { runtime = null, mountOptions = {} } = {}) {
  if (!handle || typeof handle.dispose !== 'function') {
    throw new Error('Contract runtime mount() did not return a disposable mount handle.');
  }

  let disposed = false;
  return {
    ...handle,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (!mountOptions.container && typeof runtime?.unmount === 'function') {
        runtime.unmount(mountOptions.rootId ?? 0);
      } else {
        handle.dispose();
      }
    },
  };
}

function normalizeContractMountOptions(options = {}) {
  return {
    ...options,
    host: options.host ?? 'headless',
  };
}

function contractDiagnostic(code, message, details = {}) {
  const {
    severity = 'error',
    provider = 'snapback',
    owner = 'provider',
    source,
    queryName = details.query,
    mutationName = details.mutation,
    table,
    suggestedFix,
    target_surface: targetSurface = 'Contract/Exact',
    ...providerDetails
  } = details;
  return createSnapbackProviderDiagnostic(code, message, {
    severity,
    provider,
    owner,
    source,
    queryName,
    mutationName,
    table,
    suggestedFix,
    targetSurface,
    details: providerDetails,
  });
}

function normalizeResourceDefinition(name, resource) {
  if (typeof resource === 'function') {
    return { key: name, binding: name, initial: resource };
  }
  if (resource && typeof resource === 'object') {
    return {
      key: resource.key ?? name,
      binding: resource.binding ?? name,
      initial: resource.initial,
    };
  }
  return { key: name, binding: name, initial: resource };
}

async function resolveInitialRows(resource) {
  return typeof resource.initial === 'function' ? resource.initial() : resource.initial;
}

function toBoundaryRows(value, key) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) {
    throw new Error(`System Contract resource "${key}" resolved no row data.`);
  }
  return [value];
}
