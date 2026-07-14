// Snapback <-> Contract adapter.
//
// @ref LLP 0005#contractexact-integration - the generated Contract adapter owns
//   the boring seams Valet demos copied by hand: boot, query-boundary wiring,
//   mutation invocation, initial snapshot, pending state, and provider wiring.
// @ref LLP 0012#capability-manifest / LLP 0051 D6 — the adapter's Parity
//   slice is the closed IR tier: derived local overlays + a D1-ledgered durable
//   queue. Surfaces without a configured client store still report Online.

export const SNAPBACK_CONTRACT_ADAPTER_VERSION = 1;
// Legacy/default and every non-offline surface stay Online. Parity is a
// per-surface earned result, never a package-wide default.
export const SNAPBACK_CONTRACT_CAPABILITY_CLASS = 'Online';
export const SNAPBACK_CONTRACT_PARITY_CAPABILITY_CLASS = 'Parity';

export {
  AuthCoordinator,
  authAppIdHash,
  canonicalAuthorityKey,
  createMemoryAuthCustodyStorage,
  normalizeClientAuthority,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  validateAuthCustody,
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
  CONTRACT_RECEIPT_CAPABILITY,
  contractReceiptCapability,
  SNAPBACK_CONTRACT_RECEIPT_CAPABILITY,
} from './capabilities.mjs';

// Render-first mode (ENG-23736): links synchronously, backend attaches behind
// the mounted app. Lives in ./render-first.mjs; re-exported so the package
// root stays the single import site.
export { createDeferredContractLinks, createRenderFirstSnapbackContractSurface } from './render-first.mjs';

// Derived optimistic overlays (Exact LLP 0329 E-B): generated default
// reducers for IR-tier mutations whose manifest embeds the plan. Lives in
// ./derived-overlay.mjs; re-exported so the package root stays the single
// import site.
export {
  deriveOptimisticReducer,
  deriveOptimisticReducers,
  planDerivableForTable,
  OVERLAY_CLASSES,
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

// A physical format-3 store is one durable barrier participant even when an
// app mounts several Contract surfaces over it. The coordinator owns the
// transition; surfaces merely hold references to this shared registration.
// @ref LLP 0056#participant-contract — duplicate surfaces must not race the
//   store's expected-epoch transition CAS.
const durableStoreRegistrations = new WeakMap();
const durableQueryAuthorizationTails = new WeakMap();

// @ref LLP 0053#client-fences — render/query generations and queued-mutation
//   custody advance independently, serialized through the shared client store.
function createContractQueryAuthorizationQueue(store, capture) {
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
  const withQueueCapture = (operation) => serialize(async () => {
    const queue = await store.captureMutationQueue(authority);
    return operation({ ...authority, ...queue });
  });
  return Object.freeze({
    applyObligation(obligation) {
      if (obligation.maxDisposition === 'retain') return Promise.resolve(null);
      return withQueueCapture((expected) => (
        store.applyMutationQueueObligation(obligation, expected)
      ));
    },
    resolveObligation(resolution) {
      if (resolution.maxDisposition === 'retain') return Promise.resolve(null);
      return withQueueCapture((expected) => (
        store.resolveMutationQueueObligation(resolution, expected)
      ));
    },
    retireScopes(scopes) {
      return withQueueCapture((expected) => (
        store.retireMutationQueueScopes(scopes, expected)
      ));
    },
  });
}

function registerContractParticipant(client, coordinator, participant) {
  return typeof client?.registerAuthBarrierParticipant === 'function'
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

function resolveAuthCoordinator(client, explicit) {
  const coordinator = explicit ?? client?.authCoordinator ?? null;
  if (!coordinator) return null;
  for (const method of ['capture', 'isCurrent', 'compareAndCommit', 'registerParticipant']) {
    if (typeof coordinator[method] !== 'function') {
      throw new TypeError(`authCoordinator requires ${method}()`);
    }
  }
  return coordinator;
}

async function bootContractAuthority(client, coordinator) {
  if (!coordinator) return null;
  // The kit owns handshake/custody reconciliation. A generic coordinator test
  // double may omit authSession and arrive already settled.
  if (client?.authCoordinator === coordinator && typeof client?.authSession === 'function') {
    await client.authSession();
  } else if (typeof coordinator.synchronize === 'function') {
    await coordinator.synchronize();
  }
  return client?.authCoordinator === coordinator && typeof client?.captureAuthority === 'function'
    ? client.captureAuthority()
    : coordinator.capture();
}

function captureForTransportValue(client, fallback, value) {
  return client?.authorityCaptureFor?.(value) ?? fallback;
}

async function compareContractCommit(coordinator, capture, commit) {
  if (!coordinator) return { committed: true, value: commit() };
  if (!capture) return { committed: false };
  return coordinator.compareAndCommit(capture, commit);
}

// Contract data manifest versions this adapter accepts. v2 (LLP 0034 D3) is an
// additive extension of v1 per Exact LLP 0284 §2.4: old fields remain valid
// inputs, so v1 manifests keep working unmodified.
export const SUPPORTED_CONTRACT_DATA_MANIFEST_VERSIONS = [1, 2];

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

export function validateSnapbackContractArtifacts({
  manifest,
  contractDataManifest,
  artifactIndex = null,
  schemaManifest = null,
  functionManifest = null,
  expectedManifestVersion = null,
  expectedSchemaVersion = null,
  expectedInputsHash = null,
  expectedSchemaHash = null,
  expectedBundleHash = null,
} = {}) {
  const contractManifest = manifest ?? contractDataManifest;
  const diagnostics = [];
  const diag = (code, message, details = {}) => {
    diagnostics.push(contractDiagnostic(code, message, details));
  };

  if (!contractManifest) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_MANIFEST_MISSING', 'Missing generated Contract data manifest.');
    return diagnostics;
  }

  if (contractManifest.artifactKind !== 'contractDataManifest') {
    diag('SNAPBACK_STALE_CONTRACT_DATA_ARTIFACT_KIND', 'Generated Contract data manifest has the wrong artifact kind.', {
      expectedArtifactKind: 'contractDataManifest',
      actualArtifactKind: contractManifest.artifactKind ?? null,
    });
  }

  const acceptedManifestVersions = expectedManifestVersion === null
    ? SUPPORTED_CONTRACT_DATA_MANIFEST_VERSIONS
    : [expectedManifestVersion];
  if (!acceptedManifestVersions.includes(contractManifest.manifestVersion)) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_MANIFEST_VERSION', 'Generated Contract data manifest has the wrong manifest version.', {
      expectedManifestVersion: acceptedManifestVersions.length === 1 ? acceptedManifestVersions[0] : acceptedManifestVersions,
      actualManifestVersion: contractManifest.manifestVersion ?? null,
    });
  }

  const schemaVersion = expectedSchemaVersion ?? schemaManifest?.schemaVersion ?? artifactIndex?.schemaVersion ?? null;
  if (schemaVersion && contractManifest.schemaVersion !== schemaVersion) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_ARTIFACT_VERSION', 'Generated Contract data manifest schema version does not match the generated Snapback artifacts.', {
      expectedSchemaVersion: schemaVersion,
      actualSchemaVersion: contractManifest.schemaVersion ?? null,
    });
  }

  const inputsHash = expectedInputsHash ?? artifactIndex?.inputsHash ?? schemaManifest?.inputsHash ?? functionManifest?.inputsHash ?? null;
  if (inputsHash && contractManifest.inputsHash !== inputsHash) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH', 'Generated Contract data manifest inputs hash does not match the generated Snapback artifacts.', {
      expectedInputsHash: inputsHash,
      actualInputsHash: contractManifest.inputsHash ?? null,
    });
  }

  const schemaHash = expectedSchemaHash ?? schemaManifest?.schemaHash ?? artifactIndex?.schemaHash ?? null;
  if (schemaHash && contractManifest.schemaHash !== schemaHash) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_SCHEMA_HASH', 'Generated Contract data manifest schema hash does not match the generated schema manifest.', {
      expectedSchemaHash: schemaHash,
      actualSchemaHash: contractManifest.schemaHash ?? null,
    });
  }

  const bundleHash = expectedBundleHash ?? functionManifest?.bundleHash ?? artifactIndex?.bundleHash ?? null;
  if (bundleHash && contractManifest.bundleHash !== bundleHash) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_BUNDLE_HASH', 'Generated Contract data manifest bundle hash does not match the generated function manifest.', {
      expectedBundleHash: bundleHash,
      actualBundleHash: contractManifest.bundleHash ?? null,
    });
  }

  if (artifactIndex?.functions) {
    validateBindingSet(contractManifest, artifactIndex.functions, diag);
  }

  if (artifactIndex?.artifacts) {
    validateDescriptorSet(contractManifest, artifactIndex.artifacts, diag);
  }

  return diagnostics;
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
  // Multi-query mode (LLP 0034 §6 ownership row 3 — the All Aboard proof):
  // name the manifest's live queries to bind each over the shared stream with
  // its own boundary key and per-query connection axis. An entry is a name or
  // `{ name, args }` for scoped live queries (the graffiti wall's board-scoped
  // listCells). Legacy single-query options (queryName/boundaryKey/queryArgs/
  // optimisticReducers) do not apply.
  liveQueries = null,
}) {
  const coordinator = resolveAuthCoordinator(client, authCoordinator);
  let authorityCapture = await bootContractAuthority(client, coordinator);
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
    detachReceiptListener = client.onReceipt((receipt) => {
      const enriched = enrichReceipt(receipt);
      if (!coordinator) {
        onReceipt(enriched);
        return;
      }
      const capture = captureForTransportValue(client, null, receipt);
      if (!capture) return;
      void compareContractCommit(coordinator, capture, () => undefined)
        .then((outcome) => {
          if (outcome.committed && coordinator.isCurrent(capture)) onReceipt(enriched);
        })
        .catch(() => {});
    });
  };
  let liveHandle = null;
  let ephemeralWiring = null;
  try {
    attachReceiptListener();
    if (coordinator && clientStore) {
      releaseDurableStoreRegistration = await acquireDurableStoreRegistration(
        client,
        coordinator,
        clientStore,
      );
      await clientStore.bindAuthority({
        authorityEpoch: authorityCapture.authorityEpoch,
        authorityKey: authorityCapture.authorityKey,
        authMode: coordinator.authority?.authMode ?? 'sessions',
      });
      const bound = await compareContractCommit(coordinator, authorityCapture, () => undefined);
      if (!bound.committed) throw staleContractAuthorityError();
    }
    if (Array.isArray(liveQueries)) {
      return await createMultiLiveContractSurface({
        runtime,
        client,
        userId,
        coordinator,
        authorityCapture,
        manifest,
        clientStore,
        liveQueries,
        livePush,
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
        diagnostics,
        pending,
        mountedHandles,
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
    let optimisticSeq = 0;
    let disposed = false;
    let barrierPaused = false;
    let barrierBlanking = false;
    let barrierPreparing = false;
    let activeUserId = coordinator?.authority?.kind === 'session'
      ? coordinator.authority.userId
      : userId;
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
    const everyMutationReplayable = mutationNames.length > 0
      && mutationNames.every((name) => typeof derivedReducers[name] === 'function');
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
    const offlineReplayEligible = Boolean(
      clientStore
      && descriptorIsLive
      && everyMutationReplayable
      && manifest?.capabilities?.offlineReplay === true
    );
    // Queued replay is the authority-instance axis. Item 7 enables it in
    // sessions mode only when the handshake and current store scope both
    // prove the exact descriptor protocol; retained reads remain independent.
    // @ref LLP 0039#storage-scope-is-two-dimensional — principal data and
    // descriptor-bound queued custody have independent admission facts.
    let coordinatedSessionsMode = coordinator?.authority?.authMode === 'sessions';
    let authSession = coordinatedSessionsMode && typeof client.authSession === 'function'
      ? await client.authSession()
      : null;
    if (offlineReplayEligible && !retainedIdentityComplete) {
      const diagnostic = publishDiagnostic(
        'SNAPBACK_RETAINED_IDENTITY_INCOMPLETE',
        'Offline retention requires appId, databaseId, targetProfileId, and versionStreamId; retained rows and queued writes are disabled.',
        { identity: storeIdentity },
      );
      diagnostic.severity = 'warning';
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
    const storeAuthorization = offlineReplayEligible
      && typeof client.currentAuthorizationScope === 'function'
      ? await client.currentAuthorizationScope({ devUserId: userId ?? null })
      : null;
    const sessionQueueCapable = Boolean(
      coordinatedSessionsMode
      && authSession?.availability?.queuedReplay?.available === true
      && authSession?.clientProtocols?.authorityDescriptor === 1
      && storeAuthorization?.authorityDescriptor?.descriptorVersion === 1
    );
    let offlineReplayEnabled = offlineReplayEligible
      && retainedIdentityComplete
      && (!coordinatedSessionsMode || sessionQueueCapable);
    if (clientStore) {
      if (storeAuthorization && typeof clientStore.scopeAuthorization === 'function') {
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
    let durablePendingCount = 0;
    let retainedOffline = false;
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
    const surfaceConnectionId = connectionId ?? defaultContractConnectionId();
    ephemeralWiring = createSwappableEphemeralWiring(buildEphemeralWiring({
      client,
      manifest,
      connectionId: surfaceConnectionId,
      userId: activeUserId,
      ephemeralPermissions,
      ephemeralIdleLingerMs,
    }));

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
    // receipts correlate fan-outs to mutations.
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

    const applyOptimisticOverlay = (rows) => {
      let out = rows;
      for (const op of inFlightOptimistic) {
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
      return client?.authCoordinator === coordinator && typeof client?.captureAuthority === 'function'
        ? client.captureAuthority()
        : coordinator.capture();
    };
    const commitCurrent = async (capture, commit) => {
      const outcome = await compareContractCommit(coordinator, capture, commit);
      if (!outcome.committed) throw staleContractAuthorityError();
      return outcome.value;
    };
    const preflightDurable = async (capture) => {
      if (!coordinator) return;
      const outcome = await compareContractCommit(coordinator, capture, () => undefined);
      if (!outcome.committed) throw staleContractAuthorityError();
    };

    let retainedWriteTail = Promise.resolve();
    const retainRows = (rows, version = maxServerRowVersion(rows), capture = authorityCapture) => {
      if (!offlineReplayEnabled) return retainedWriteTail;
      const expectation = expectationForCapture(capture);
      const record = {
        rows,
        version,
        cursor: { stream: expectation.versionStreamId, version },
        ...expectation,
      };
      // Serialize per surface/query key. A slower older persistence call can
      // never finish after and overwrite a newer version; the store also
      // compare-and-sets by (stream, version) for cross-instance races.
      retainedWriteTail = retainedWriteTail
        .then(async () => {
          await preflightDurable(capture);
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

    const writeServerRows = (rows, version = maxServerRowVersion(rows), capture = authorityCapture) => {
      lastServerRows = rows;
      lastServerVersion = version ?? maxServerRowVersion(rows);
      if (!queryAuthorizationHidden) retainRows(rows, lastServerVersion, capture);
      if (disposed || !boundary || queryAuthorizationHidden) return rows;
      const overlaid = applyOptimisticOverlay(rows);
      boundary.write(boundaryKey, () => overlaid);
      return overlaid;
    };

    const publishServerRows = async (
      capture,
      rows,
      version = maxServerRowVersion(rows),
    ) => {
      if (!coordinator) return writeServerRows(rows, version, capture);
      // Run app reducers before entering the non-reentrant custody commit.
      // A transition after preparation simply makes the commit stale.
      const overlaid = applyOptimisticOverlay(rows);
      const resolvedVersion = version ?? maxServerRowVersion(rows);
      const outcome = await compareContractCommit(coordinator, capture, () => {
        lastServerRows = rows;
        lastServerVersion = resolvedVersion;
        if (!disposed && boundary && !queryAuthorizationHidden) {
          boundary.write(boundaryKey, () => overlaid);
        }
        return overlaid;
      });
      if (!outcome.committed) return null;
      retainRows(rows, resolvedVersion, capture);
      return outcome.value;
    };

    const surfaceConnection = () => (
      wantLivePush
        ? retainedOffline ? 'stale' : liveHandle?.connection ?? 'connecting'
        : null
    );

    const openLive = async (capture = operationCapture()) => {
      const handle = await client.liveQuery(queryName, {
        connectionId: surfaceConnectionId,
        args: queryArgs,
        userId: activeUserId,
        transport: 'stream',
        stream: liveStreamOptions,
        correlation: surfaceCorrelation,
        authorizationQueue: createContractQueryAuthorizationQueue(clientStore, capture),
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
          void compareContractCommit(coordinator, callbackCapture, () => {
            // Connection is data (Exact LLP 0284 §2.1 rule 2): re-emit each
            // live observer's last cell with the new connection value.
            for (const record of [...liveCellObservers]) {
              if (record.lastCell) record.emit({ ...record.lastCell, connection });
            }
          }).then((outcome) => {
            if (outcome.committed && (!coordinator || coordinator.isCurrent(callbackCapture))) {
              onConnectionChange?.(connection, detail);
            }
          }).catch(() => {});
        },
        onSubscriptionEvent: onSubscriptionEvent
          ? (event) => {
              const callbackCapture = captureForTransportValue(client, capture, event);
              void compareContractCommit(coordinator, callbackCapture, () => undefined)
                .then((outcome) => {
                  if (outcome.committed && (!coordinator || coordinator.isCurrent(callbackCapture))) {
                    onSubscriptionEvent(event);
                  }
                })
                .catch(() => {});
            }
          : null,
      });
      const resultCapture = captureForTransportValue(client, capture, handle);
      const installed = await compareContractCommit(coordinator, resultCapture, () => {
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
    const retained = offlineReplayEnabled
      ? await clientStore.getRetainedQuery(storeQueryKey, expectationForCapture(authorityCapture))
      : null;
    try {
      if (wantLivePush) {
        const handle = await openLive(authorityCapture);
        initial = handle.rows;
        lastServerVersion = handle.version ?? maxServerRowVersion(initial);
      } else {
        const initialCapture = authorityCapture ?? operationCapture();
        const snapshot = await client.query(queryName, { args: queryArgs, userId: activeUserId });
        const resultCapture = captureForTransportValue(client, initialCapture, snapshot);
        const current = await compareContractCommit(coordinator, resultCapture, () => undefined);
        if (!current.committed) throw staleContractAuthorityError();
        initial = snapshot.rows;
        lastServerVersion = snapshot.version ?? maxServerRowVersion(initial);
      }
      retainRows(initial, lastServerVersion, authorityCapture);
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
      const committed = await compareContractCommit(coordinator, racedCapture, () => {
        if (!queryAuthorizationHidden) boundary.write(boundaryKey, () => racedRows);
      });
      if (!committed.committed) throw staleContractAuthorityError();
    }
    for (const record of restoredPending) {
      const reducer = typeof optimisticReducers[record.function] === 'function'
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

    const assertActive = () => {
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
      const snapshot = await client.query(queryName, { args: queryArgs, userId: activeUserId });
      const resultCapture = captureForTransportValue(client, capture, snapshot);
      const published = await publishServerRows(
        resultCapture,
        snapshot.rows,
        snapshot.version ?? maxServerRowVersion(snapshot.rows),
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
      try {
        await client.acknowledgeMutations({ userId: activeUserId, clientMutationIds: ids });
        await confirmSentAcknowledgements(ids, capture);
        return true;
      } catch (error) {
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
        mutationDeliveryStarted = true;
        // TODO(Exact LLP 0231/0278): thread actionInvocationId/optimisticWaveId
        // into this correlation when the runtime supplies them.
        const output = await client.mutate(name, {
          args,
          userId: activeUserId,
          correlation: surfaceCorrelation,
          clientMutationId: queued?.id ?? null,
          acknowledgedClientMutationIds: sentAcknowledgements,
          ctxLedger: queued?.ctxLedger ?? null,
          authorityDescriptor: queued?.authorityDescriptor ?? null,
        });
        const resultCapture = captureForTransportValue(client, capture, output);
        await commitCurrent(resultCapture, () => {
          mutationCommitted = true;
          mutationOutput = output;
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
        // The commit landed: drop the optimistic op BEFORE reconciling so the
        // authoritative row is not doubled by its own overlay.
        if (optimisticOp) {
          await commitCurrent(resultCapture, () => inFlightOptimistic.delete(optimisticOp));
        }
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
        if (queued && (isConnectivityFailure(error) || !error?.receipt)) {
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
        return boundary.query(boundaryKey, (rows) => rows, { key: boundaryKey });
      };
    }
    // Derived optimistic overlays (Exact LLP 0329 §E5): IR-tier mutations
    // whose manifest embeds a plan derivable for this boundary's table get a
    // generated default reducer. App reducers stay first-class and override
    // per name; mutations touching tables this boundary cannot see stay
    // pending-without-overlay (no overlay beats a wrong prediction).
    for (const name of mutationNames) {
      const appReducer = optimisticReducers[name];
      const activeReducer = typeof appReducer === 'function' ? appReducer : derivedReducers[name] ?? null;
      mutationOverlayClass[name] = typeof appReducer === 'function'
        ? 'reducer'
        : activeReducer
          ? 'derived'
          : 'none';
      links[name] = (args) => {
        assertActive();
        const capture = operationCapture();
        const invoke = () => {
          // The durable preflight above may yield before this synchronous
          // optimistic write. Recheck the local barrier at the exact turn that
          // can expose rows so transition blanking cannot be overwritten.
          assertActive();
          assertMutationAuthorizationVisible();
          const reducer = activeReducer;
        // A derived plan runs against serde_json::Value on the server. Take
        // one canonical snapshot and reuse it for the prediction, durable
        // queue, and transport; evaluating raw args and serializing them again
        // would let getters/toJSON/proxies disagree and could underfill the
        // RuntimeId ledger if prediction aborted before the server invocation.
        let mutationArgs = args;
        if (derivedReducers[name]) {
          try {
            mutationArgs = canonicalizeJsonValue(args ?? {});
          } catch (error) {
            return track(Promise.reject(error));
          }
        }
        let optimisticOp = null;
        if (typeof reducer === 'function') {
          const mutationId = createClientMutationId(`cm_${name}`);
          const ledgerIds = [];
          const nowMs = Date.now();
          const runtimeId = () => {
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
            ctxLedger: derivedReducers[name]
              ? { version: 1, ids: ledgerIds, now: nowMs }
              : null,
          };
          let rollbackRows = lastServerRows;
          try {
            // Reducers are app code and may mutate their input before throwing.
            // Keep an isolated JSON-domain copy of server truth so rollback is
            // real even for an impure failed reducer.
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
              // When an app reducer overrides the derived prediction, still run
              // the shared IR evaluator once to capture every RuntimeId/implicit
              // row-id answer for the durable replay ledger.
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
            // A synchronous reducer/derived-evaluator failure occurs before
            // queue persistence or transport. Retire the op immediately so
            // no later authoritative update can re-run it and poison the
            // boundary indefinitely, then publish server truth again.
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
            return track(Promise.reject(error));
          }
        }
          return track(persistMutation(name, mutationArgs, optimisticOp, capture));
        };
        if (!coordinator) return invoke();
        return track(commitCurrent(capture, () => undefined).then(invoke));
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
        const result = await client.query(queryName, { args: queryArgs, userId: activeUserId });
        const resultCapture = captureForTransportValue(client, capture, result);
        const current = await compareContractCommit(coordinator, resultCapture, () => result.rows);
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
    const provider = wantLivePush
      ? {
          ...baseProvider,
          subscribe(subscribedQuery, args, observer) {
            if (subscribedQuery !== queryName) {
              return baseProvider.subscribe(subscribedQuery, args, observer);
            }
            const record = {
              lastCell: null,
              emit: (cell) => observer(cell),
            };
            liveCellObservers.add(record);
            const subscription = baseProvider.subscribe(subscribedQuery, args, (cell) => {
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
              observer({ ...cell, connection: surfaceConnection() });
            });
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

    let resumeGeneration = 0;
    let resumeTimer = null;
    let resumeTask = Promise.resolve();
    const refreshAfterAuthorityTransition = async (context, generation) => {
      const capture = context.capture;
      authorityCapture = capture;
      activeUserId = context.authority?.kind === 'session'
        ? context.authority.userId
        : userId;
      coordinatedSessionsMode = context.authority?.authMode === 'sessions';
      authSession = coordinatedSessionsMode && typeof client.authSession === 'function'
        ? await client.authSession()
        : null;
      const refreshedAuthorization = typeof client.currentAuthorizationScope === 'function'
        ? await client.currentAuthorizationScope({ devUserId: userId ?? null })
        : null;
      const refreshedQueueCapable = Boolean(
        coordinatedSessionsMode
        && authSession?.availability?.queuedReplay?.available === true
        && authSession?.clientProtocols?.authorityDescriptor === 1
        && refreshedAuthorization?.authorityDescriptor?.descriptorVersion === 1
      );
      offlineReplayEnabled = offlineReplayEligible
        && retainedIdentityComplete
        && (!coordinatedSessionsMode || refreshedQueueCapable);
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

      let rows;
      let version;
      if (wantLivePush) {
        const handle = await openLive(capture);
        rows = handle.rows;
        version = handle.version ?? maxServerRowVersion(rows);
      } else {
        const snapshot = await client.query(queryName, { args: queryArgs, userId: activeUserId });
        const resultCapture = captureForTransportValue(client, capture, snapshot);
        if (
          resultCapture.authorityEpoch !== capture.authorityEpoch
          || resultCapture.authorityKey !== capture.authorityKey
        ) throw staleContractAuthorityError();
        rows = snapshot.rows;
        version = snapshot.version ?? maxServerRowVersion(rows);
      }
      if (generation !== resumeGeneration || disposed) return;

      // Item 5 does not resume auth-scoped live/ephemeral state in sessions
      // mode. Dev/authority-independent surfaces rebuild only after the fresh
      // durable snapshot above has established their successor boundary.
      const ephemeralMayResume = context.authority?.authMode !== 'sessions'
        || ephemeralWiring.descriptors.every(([, descriptor]) => (
          descriptor?.authorityIndependent === true
        ));
      if (ephemeralMayResume) {
        const successorEphemeral = buildEphemeralWiring({
          client,
          manifest,
          connectionId: surfaceConnectionId,
          userId: activeUserId,
          ephemeralPermissions,
          ephemeralIdleLingerMs,
        });
        ephemeralWiring.prepare(successorEphemeral);
        await ephemeralWiring.prewarm();
      }
      if (generation !== resumeGeneration || !coordinator.isCurrent(capture)) return;
      // The handle may have advanced while successor ephemerals were prepared.
      // Read its latest snapshot once at the atomic exposure turn.
      if (wantLivePush && liveHandle) {
        rows = liveHandle.rows;
        version = liveHandle.version ?? maxServerRowVersion(rows);
      }
      const resolvedVersion = version ?? maxServerRowVersion(rows);
      barrierPreparing = true;
      await commitCurrent(capture, () => {
        lastServerRows = rows;
        lastServerVersion = resolvedVersion;
        if (!disposed && boundary && !queryAuthorizationHidden) {
          boundary.write(boundaryKey, () => rows);
        }
      });
      if (generation !== resumeGeneration || !coordinator.isCurrent(capture)) return;
      retainRows(rows, resolvedVersion, capture);
      barrierPreparing = false;
      if (ephemeralMayResume) ephemeralWiring.expose();
      attachReceiptListener();
      barrierPaused = false;
      for (const record of liveCellObservers) {
        if (record.lastCell) record.emit({ ...record.lastCell, connection: surfaceConnection() });
      }
    };

    const scheduleAuthorityRefresh = (context) => {
      const generation = resumeGeneration;
      resumeTask = new Promise((resolve) => {
        resumeTimer = setTimeout(resolve, 0);
      }).then(() => {
        resumeTimer = null;
        return refreshAfterAuthorityTransition(context, generation);
      }).catch((error) => {
        // Stay blank/paused. A later transition or explicit surface retry can
        // establish a fresh successor; stale work never becomes a diagnostic
        // owned by that successor.
        if (generation === resumeGeneration && coordinator.isCurrent(context.capture)) {
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
      assertActive();
      if (!offlineReplayEnabled) return { replayed: 0, failed: 0 };
      const capture = operationCapture();

      const initialResync = await client.query(queryName, { args: queryArgs, userId: activeUserId });
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
          const output = await client.mutate(record.function, {
            args: record.args,
            userId: activeUserId,
            readSet: record.readSet ?? [],
            correlation: surfaceCorrelation,
            clientMutationId: record.id,
            acknowledgedClientMutationIds: sentAcknowledgements,
            ctxLedger: record.ctxLedger,
            authorityDescriptor: record.authorityDescriptor ?? null,
          });
          const resultCapture = captureForTransportValue(client, resyncCapture, output);
          await commitCurrent(resultCapture, () => undefined);
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
          });
          await flushPendingAcknowledgements(resultCapture);
          replayed += 1;
        } catch (error) {
          const errorCapture = captureForTransportValue(client, resyncCapture, error);
          if (coordinator && !coordinator.isCurrent(errorCapture)) {
            throw staleContractAuthorityError();
          }
          // Only a provider-core mutation receipt proves the request crossed
          // the origin handler's ACK stage. A proxy/load-balancer 4xx/5xx may
          // carry status + diagnostic while never reaching Snapback; deleting
          // local ACK proofs or marking the current mutation failed would then
          // strand settlements and lose an ambiguously delivered write.
          if (isConnectivityFailure(error) || !error?.receipt) {
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
          });
          failed += 1;
          publishDiagnostic(
            'SNAPBACK_OFFLINE_MUTATION_FAILED',
            error instanceof Error ? error.message : String(error),
            { mutation: record.function, clientMutationId: record.id },
          );
        }
        await commitCurrent(resyncCapture, () => removeOptimisticMutation(record.id));
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
      // @ref LLP 0056#exposure-invariant — a surface is either entirely at its
      //   settled capture or explicitly blank while the successor is prepared.
      unregisterSurfaceParticipant = registerContractParticipant(client, coordinator, {
        name: `snapback-contract-surface:${surfaceRootId}`,
        async quiesce() {
          barrierPaused = true;
          resumeGeneration += 1;
          if (resumeTimer !== null) {
            clearTimeout(resumeTimer);
            resumeTimer = null;
          }
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
          diagnostics.splice(stableDiagnosticCount);
          for (const record of liveCellObservers) record.lastCell = null;
        },
        // The physical store participant owns the single expected-epoch CAS.
        // Per-surface durable phases are intentionally idempotent no-ops.
        async commitDurable() {},
        async resume(context) {
          authorityCapture = context.capture;
          scheduleAuthorityRefresh(context);
        },
      });
      const current = await compareContractCommit(coordinator, authorityCapture, () => undefined);
      if (!current.committed) throw staleContractAuthorityError();
    }

    return {
      adapterVersion: SNAPBACK_CONTRACT_ADAPTER_VERSION,
      get capabilityClass() {
        return offlineReplayEnabled
          ? SNAPBACK_CONTRACT_PARITY_CAPABILITY_CLASS
          : SNAPBACK_CONTRACT_CAPABILITY_CLASS;
      },
      boundary,
      links,
      provider,
      diagnostics,
      pendingCount: () => Math.max(pending.size, durablePendingCount),
      retained: () => retainedOffline,
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
        const receipts = client.receipts();
        if (!coordinator) return receipts.map(enrichReceipt);
        return receipts
          .filter((receipt) => {
            const capture = captureForTransportValue(client, null, receipt);
            return capture && coordinator.isCurrent(capture);
          })
          .map(enrichReceipt);
      },
      // Ephemeral facts (ENG-22479): the conformance gate's LOCAL-ONLY probe
      // reads source starts; prewarmScope subscribes a scoped room up front.
      ephemeralSourceStarts: ephemeralWiring.sourceStarts,
      prewarmEphemeral: ephemeralWiring.prewarmScope,
      mount: (component, options = {}) => {
        assertActive();
        return rememberMountHandle(mountedHandles, mountSnapbackContractHeadless(runtime, component, options));
      },
      flush: async () => {
        await Promise.all([...pending, retainedWriteTail, resumeTask]);
      },
      dispose: () => {
        disposed = true;
        barrierPaused = true;
        resumeGeneration += 1;
        if (resumeTimer !== null) clearTimeout(resumeTimer);
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
        return Promise.all([unregister, releaseStore].filter(Boolean));
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

function buildEphemeralWiring({ client, manifest, connectionId, userId, ephemeralPermissions = null, ephemeralIdleLingerMs = EPHEMERAL_IDLE_LINGER_MS }) {
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

  const scopeKeyOf = (args) => JSON.stringify(Object.entries(args ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));

  const selfKeyFor = (descriptor) => {
    switch (descriptor.keyMode) {
      case 'User':
        return userId ?? null;
      case 'Connection':
        return connectionId;
      default:
        // Session/Custom lease identity is not modeled by this kit client;
        // `self` degrades to false rather than guessing (LLP 0034 §4 / OQ6).
        return null;
    }
  };

  const toMapCell = (record, descriptor) => {
    // Exact 0284 §2.5: an entry past provider TTL is deleted from `entries`
    // and never exposed again; freeze-at-last-known is reserved for
    // stale/disconnected, where entries may age past TTL locally and the
    // connection axis is the trust signal (ENG-22479 review fix 2).
    const connection = record.subscribed === false ? 'stale' : record.connection;
    const frozen = connection === 'stale' || connection === 'disconnected';
    const now = Date.now();
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
          self: entry.key === selfKeyFor(descriptor),
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
      socketLossEpoch: 0,
      notify: null,
    };
    record.notify = () => {
      for (const listener of [...record.listeners]) listener();
      scheduleExpiryReemit(record);
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
      if (disposed || record.tornDown || record.resyncInFlight) return;
      if (record.resyncTimer) {
        clearTimeout(record.resyncTimer);
        record.resyncTimer = null;
      }
      record.resyncInFlight = true;
      const epochAtDispatch = record.socketLossEpoch;
      void client
        .subscribeEphemeral(name, { connectionId, scope: { ...args }, userId, permissions })
        .then((fresh) => {
          record.resyncInFlight = false;
          if (disposed || record.tornDown) {
            fresh.dispose(); // fix 4: never leak past surface/record teardown
            return;
          }
          const superseded = record.overlay;
          record.overlay = fresh;
          superseded.dispose();
          record.resyncAttempts = 0;
          fresh.onChange(handleChange);
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
    record.offState = manager.onState((state, detail = {}) => {
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
        record.socketLossEpoch += 1;
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
        emit(toMapCell(record, descriptor));
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
            emit({ status: 'error', entries: [] });
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
          return client.publishEphemeral(name, {
            connectionId,
            scope,
            value,
            ttlMs,
            userId,
            permissions,
          });
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
function createSwappableEphemeralWiring(initialWiring) {
  let current = initialWiring;
  let generation = 0;
  let blanked = false;
  let disposed = false;
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
      if (!blanked) record.emit(cell);
    });
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
    if (blanked) emit(blankCell());
    return () => {
      record.active = false;
      detach(record);
      records.delete(record);
    };
  }]));

  return {
    descriptors: initialWiring.descriptors,
    sources,
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
      generation += 1;
      for (const record of records) detach(record);
      current?.dispose?.();
      current = null;
    },
    blank() {
      blanked = true;
      for (const record of records) {
        record.lastCell = blankCell();
        record.emit(record.lastCell);
      }
    },
    prepare(nextWiring) {
      current?.dispose?.();
      current = nextWiring;
      generation += 1;
      blanked = true;
      for (const record of records) attach(record);
    },
    expose() {
      blanked = false;
      for (const record of records) record.emit(record.lastCell ?? blankCell());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      blanked = true;
      for (const record of records) {
        detach(record);
        record.lastCell = blankCell();
        record.emit(record.lastCell);
        record.active = false;
      }
      records.clear();
      current?.dispose?.();
      current = null;
    },
  };
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
  livePush,
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
  diagnostics,
  pending,
  mountedHandles,
}) {
  const liveHandles = new Map(); // query name -> kit live handle
  const authorizationHidden = new Set();
  let ephemeralWiring = null;
  let currentCapture = authorityCapture;
  let activeUserId = coordinator?.authority?.kind === 'session'
    ? coordinator.authority.userId
    : userId;
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

    let disposed = false;
    let barrierPaused = false;
    let barrierBlanking = false;
    let barrierPreparing = false;
    let boundary = null;
    const sharedConnectionId = connectionId ?? defaultContractConnectionId();
    const liveCellObservers = new Map(); // query name -> Set<record>
    const wantLivePush = livePush && typeof client.liveQuery === 'function';
    ephemeralWiring = createSwappableEphemeralWiring(buildEphemeralWiring({
      client,
      manifest,
      connectionId: sharedConnectionId,
      userId: activeUserId,
      ephemeralPermissions,
      ephemeralIdleLingerMs,
    }));

    const assertActive = () => {
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
      return client?.authCoordinator === coordinator && typeof client?.captureAuthority === 'function'
        ? client.captureAuthority()
        : coordinator.capture();
    };
    const commitCurrent = async (capture, commit) => {
      const outcome = await compareContractCommit(coordinator, capture, commit);
      if (!outcome.committed) throw staleContractAuthorityError();
      return outcome.value;
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
        if (record.lastCell) record.emit({ ...record.lastCell, connection });
      }
    };
    const publishRows = async (capture, name, rows) => {
      const outcome = await compareContractCommit(coordinator, capture, () => {
        if (!disposed && boundary && !authorizationHidden.has(name)) {
          boundary.write(name, () => rows);
        }
        return rows;
      });
      return outcome.committed ? outcome.value : null;
    };

    const openMultiLiveHandle = async ({ name, args }, capture) => {
      const handle = await client.liveQuery(name, {
        connectionId: sharedConnectionId,
        args,
        userId: activeUserId,
        transport: 'stream',
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
          void compareContractCommit(coordinator, callbackCapture, () => {
            reemitCells(name, connection);
          }).then((outcome) => {
            if (outcome.committed && (!coordinator || coordinator.isCurrent(callbackCapture))) {
              onConnectionChange?.(connection, { ...detail, queryName: name });
            }
          }).catch(() => {});
        },
        onSubscriptionEvent: onSubscriptionEvent
          ? (event) => {
              const callbackCapture = captureForTransportValue(client, capture, event);
              void compareContractCommit(coordinator, callbackCapture, () => undefined)
                .then((outcome) => {
                  if (outcome.committed && (!coordinator || coordinator.isCurrent(callbackCapture))) {
                    onSubscriptionEvent({ ...event, queryName: name });
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
        const current = await compareContractCommit(coordinator, capture, () => undefined);
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
        const snapshot = await client.query(name, { args, userId: activeUserId });
        const resultCapture = captureForTransportValue(client, capture, snapshot);
        const current = await compareContractCommit(coordinator, resultCapture, () => undefined);
        if (!current.committed) throw staleContractAuthorityError();
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
        const snapshot = await client.query(name, { args, userId: activeUserId });
        const resultCapture = captureForTransportValue(client, capture, snapshot);
        const published = await publishRows(resultCapture, name, snapshot.rows);
        if (published === null) throw staleContractAuthorityError();
      }
    };

    const persistMutation = async (name, args, capture = operationCapture()) => {
      try {
        const output = await client.mutate(name, {
          args,
          userId: activeUserId,
          correlation: { rootId, bindingIds: [...liveQueryNames] },
        });
        const resultCapture = captureForTransportValue(client, capture, output);
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
            `query binding "${subscribedQuery}" is present in the manifest but omitted from this surface's liveQueries configuration.`,
            { query: subscribedQuery, configuredQueries: [...liveQueryNames] },
          );
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
        if (!liveHandles.has(subscribedQuery)) {
          return baseProvider.subscribe(subscribedQuery, args, observer);
        }
        const records = liveCellObservers.get(subscribedQuery);
        const record = {
          lastCell: null,
          emit: (cell) => observer(cell),
        };
        records.add(record);
        const subscription = baseProvider.subscribe(subscribedQuery, args, (cell) => {
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
          observer({ ...cell, connection: connectionFor(subscribedQuery) });
        });
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

    let resumeGeneration = 0;
    let resumeTimer = null;
    let resumeTask = Promise.resolve();
    const scheduleAuthorityRefresh = (context) => {
      const generation = resumeGeneration;
      resumeTask = new Promise((resolve) => {
        resumeTimer = setTimeout(resolve, 0);
      }).then(async () => {
        resumeTimer = null;
        currentCapture = context.capture;
        activeUserId = context.authority?.kind === 'session'
          ? context.authority.userId
          : userId;
        const stagedRows = new Map();
        const opened = [];
        try {
          if (wantLivePush) {
            for (const entry of liveQueryEntries) {
              const result = await openMultiLiveHandle(entry, context.capture);
              if (generation !== resumeGeneration || disposed) {
                result.handle.dispose?.();
                return;
              }
              const current = await compareContractCommit(
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
              const snapshot = await client.query(name, { args, userId: activeUserId });
              const capture = captureForTransportValue(client, context.capture, snapshot);
              const current = await compareContractCommit(coordinator, capture, () => undefined);
              if (!current.committed) throw staleContractAuthorityError();
              stagedRows.set(name, snapshot.rows);
            }
          }
        } catch (error) {
          for (const result of opened) result.handle.dispose?.();
          throw error;
        }

        const ephemeralMayResume = context.authority?.authMode !== 'sessions'
          || ephemeralWiring.descriptors.every(([, descriptor]) => (
            descriptor?.authorityIndependent === true
          ));
        if (ephemeralMayResume) {
          const successorEphemeral = buildEphemeralWiring({
            client,
            manifest,
            connectionId: sharedConnectionId,
            userId: activeUserId,
            ephemeralPermissions,
            ephemeralIdleLingerMs,
          });
          ephemeralWiring.prepare(successorEphemeral);
          await ephemeralWiring.prewarm();
        }

        if (
          generation !== resumeGeneration
          || disposed
          || !coordinator.isCurrent(context.capture)
        ) {
          for (const result of opened) result.handle.dispose?.();
          return;
        }
        let installed = false;
        try {
          barrierPreparing = true;
          await commitCurrent(context.capture, () => {
            for (const [name, rows] of stagedRows) {
              if (!authorizationHidden.has(name)) boundary.write(name, () => rows);
            }
          });
          if (
            generation !== resumeGeneration
            || disposed
            || !coordinator.isCurrent(context.capture)
          ) return;
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
              if (record.lastCell) {
                record.emit({ ...record.lastCell, connection: connectionFor(name) });
              }
            }
          }
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
        async quiesce() {
          barrierPaused = true;
          resumeGeneration += 1;
          if (resumeTimer !== null) {
            clearTimeout(resumeTimer);
            resumeTimer = null;
          }
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
          scheduleAuthorityRefresh(context);
        },
      });
      const current = await compareContractCommit(coordinator, currentCapture, () => undefined);
      if (!current.committed) throw staleContractAuthorityError();
    }

    return {
      adapterVersion: SNAPBACK_CONTRACT_ADAPTER_VERSION,
      capabilityClass: SNAPBACK_CONTRACT_CAPABILITY_CLASS,
      boundary,
      links,
      provider,
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
        const receipts = client.receipts();
        if (!coordinator) return receipts;
        return receipts.filter((receipt) => {
          const capture = captureForTransportValue(client, null, receipt);
          return capture && coordinator.isCurrent(capture);
        });
      },
      ephemeralSourceStarts: ephemeralWiring.sourceStarts,
      prewarmEphemeral: ephemeralWiring.prewarmScope,
      // Per-query connection facts; no argument = the first live query.
      connection: (name = liveQueryNames[0]) => connectionFor(name),
      connections: () => Object.fromEntries(liveQueryNames.map((name) => [name, connectionFor(name)])),
      mount: (component, options = {}) => {
        assertActive();
        return rememberMountHandle(mountedHandles, mountSnapbackContractHeadless(runtime, component, options));
      },
      flush: async () => {
        await Promise.all([...pending, resumeTask]);
      },
      dispose: () => {
        disposed = true;
        barrierPaused = true;
        resumeGeneration += 1;
        if (resumeTimer !== null) clearTimeout(resumeTimer);
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
        return Promise.all([unregister, releaseStore].filter(Boolean));
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
  return {
    code,
    severity: 'error',
    subsystem: 'contract-integration',
    message,
    details: {
      target_surface: 'Contract/Exact',
      ...details,
    },
  };
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

function validateBindingSet(manifest, functions, diag) {
  const queries = manifest.queries ?? {};
  const mutations = manifest.mutations ?? {};
  const expectedQueryNames = new Set();
  const expectedMutationNames = new Set();

  for (const fn of functions) {
    // Actions are not Contract data bindings (codegen skips them when
    // emitting descriptors) — cron-run functions like all-aboard's
    // refreshFeed must not be demanded as query bindings.
    if (fn.kind === 'Action') continue;
    if (fn.kind === 'Mutation') expectedMutationNames.add(fn.name);
    else expectedQueryNames.add(fn.name);
  }

  for (const name of expectedQueryNames) {
    if (!queries[name]) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest is missing a query binding declared by the function manifest.', {
        binding: name,
        bindingKind: 'query',
      });
    }
  }
  for (const name of expectedMutationNames) {
    if (!mutations[name]) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest is missing a mutation binding declared by the function manifest.', {
        binding: name,
        bindingKind: 'mutation',
      });
    }
  }
  for (const name of Object.keys(queries)) {
    // Ephemeral read descriptors live in the queries map (Exact LLP 0284
    // §2.5) but are collections, not server functions (ENG-22479).
    if (queries[name]?.ephemeral === true) continue;
    if (!expectedQueryNames.has(name)) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest has a query binding not declared by the function manifest.', {
        binding: name,
        bindingKind: 'query',
      });
    }
  }
  for (const name of Object.keys(mutations)) {
    if (!expectedMutationNames.has(name)) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest has a mutation binding not declared by the function manifest.', {
        binding: name,
        bindingKind: 'mutation',
      });
    }
  }
}

function validateDescriptorSet(manifest, artifacts, diag) {
  const artifactSet = new Set(artifacts);
  for (const name of Object.keys(manifest.queries ?? {})) {
    const expectedFiles = manifest.queries[name]?.ephemeral === true
      ? [
          `contract/${name}.ephemeral.ts`,
          `contract/${name}.ephemeral.contract-meta.ts`,
          `contract/${name}.publish.ts`,
          `contract/${name}.publish.contract-meta.ts`,
        ]
      : [`contract/${name}.query.ts`, `contract/${name}.query.contract-meta.ts`];
    for (const file of expectedFiles) {
      if (!artifactSet.has(file)) {
        diag('SNAPBACK_STALE_CONTRACT_DESCRIPTOR_SET', 'Generated Contract descriptor artifact is missing from the artifact index.', {
          binding: name,
          bindingKind: 'query',
          artifact: file,
        });
      }
    }
  }
  for (const name of Object.keys(manifest.mutations ?? {})) {
    for (const file of [`contract/${name}.mutation.ts`, `contract/${name}.mutation.contract-meta.ts`]) {
      if (!artifactSet.has(file)) {
        diag('SNAPBACK_STALE_CONTRACT_DESCRIPTOR_SET', 'Generated Contract descriptor artifact is missing from the artifact index.', {
          binding: name,
          bindingKind: 'mutation',
          artifact: file,
        });
      }
    }
  }
}
