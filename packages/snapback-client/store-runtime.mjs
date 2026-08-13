// LLP 0166 Full-profile store runtime. This module is loaded only when a
// qmk1 materialization, preload registration, or programmatic registration
// first crosses the client construction seam; it must not enter the root
// static import closure.

import { createDemandBroker } from './demand-broker.mjs';
import {
  createRegistrationLedger,
  derivePreloadQueryRegistrationsV1,
} from './registration-ledger.mjs';
import {
  createStorePolicyController,
  STORE_POLICY_CONSTANTS,
} from './store-policy.mjs';
import {
  createMaterializationStore,
  pageIdentityDigestV1,
} from './materialization-store.mjs';
import {
  authorityStateForWitness,
  commitMaterializationLeaseCustody,
  deriveAuthorityPartitionDigestV1,
  deriveGeneratedMaterializationBridge,
  findRetainedGeneratedMaterializationBridge,
  loadMaterializationLeaseCustody,
  materializationFence,
  retainedFailureTransition,
} from './materialization-bridge.mjs';
import { refuseLocalEvaluation } from './evaluation-floor.mjs';
import {
  RESULT_TRANSFORM_V1_RETENTION_CLASS,
  evaluateAdmittedResultTransformV1,
  resultTransformCarrierContextV1,
} from './result-transform.mjs';
import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { deriveQmk1AnswerV1 } from './answer-classes.mjs';
import {
  admitLocalMutationReadsV1,
  evaluateLocalMutationWithReadAdmissionV1,
} from './local-read-admission.mjs';
import { isConnectivityFailureError } from './outbox-shared.mjs';
import { base64UrlNoPad, jcsBytes, sha256 } from './rqs.mjs';
import { createOptimisticRebaseEngineV1 } from './optimistic-rebase.mjs';
import {
  beginProtectedQueryLease,
  commitProtectedQueryLease,
  deleteProtectedQueryRetention,
  prepareProtectedQueryRetention,
  seedProtectedQueryRetention,
} from './protected-query-retention.mjs';
import {
  generatedMutationIrCapability,
  prepareGeneratedMutationIrV1,
} from './generated-mutation-ir.mjs';
import { createClientMutationId, stableJson } from '@expo/snapback-contract/client-store';
import { validateAuthorizationInvalidationConnection } from '@expo/snapback-contract/auth-invalidation';

function materializationObservation(preparedMaterialization) {
  let observation = null;
  const release = preparedMaterialization.store.observeMaterialization(
    preparedMaterialization.bridge.address,
    (next) => { observation = next; },
  );
  release();
  return observation;
}

function decodeMaterializationRows(value) {
  if (!(value instanceof Uint8Array)) return null;
  try {
    const rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

function policyRegistrationGroups(entries, resolveRegistration) {
  const groups = new Map();
  for (const entry of entries) {
    const resolved = resolveRegistration(entry.registration);
    let group = groups.get(resolved.addressKey);
    if (!group) {
      group = { authorityPartitionDigest: resolved.authorityPartitionDigest, registrations: [] };
      groups.set(resolved.addressKey, group);
    }
    group.registrations.push(entry.registration);
  }
  return groups;
}

function defaultStoreMaintenanceSchedule(callback, delayMs) {
  if (delayMs <= 0 && typeof globalThis.requestIdleCallback === 'function') {
    return Object.freeze({
      kind: 'idle',
      handle: globalThis.requestIdleCallback(callback, { timeout: 1_000 }),
    });
  }
  const handle = globalThis.setTimeout(callback, Math.max(0, delayMs));
  handle?.unref?.();
  return Object.freeze({ kind: 'timeout', handle });
}

function defaultStoreMaintenanceCancel(scheduled) {
  if (scheduled?.kind === 'idle' && typeof globalThis.cancelIdleCallback === 'function') {
    globalThis.cancelIdleCallback(scheduled.handle);
  } else if (scheduled?.handle !== undefined) globalThis.clearTimeout(scheduled.handle);
}

let localRegistrationSequence = 0;
function mintVolatileRegistrationId(randomBytes = undefined, { allowLocalFallback = false } = {}) {
  const source = randomBytes ?? (typeof globalThis.crypto?.getRandomValues === 'function'
    ? (length) => globalThis.crypto.getRandomValues(new Uint8Array(length))
    : null);
  if (source === null) {
    if (allowLocalFallback) {
      localRegistrationSequence += 1;
      return `qreg1_local_${Date.now().toString(36)}_${localRegistrationSequence.toString(36)}`;
    }
    const error = new Error(
      'SNAPBACK_QUERY_REGISTRATION_RANDOM_UNAVAILABLE: active registration identity requires crypto.getRandomValues',
    );
    error.code = 'SNAPBACK_QUERY_REGISTRATION_RANDOM_UNAVAILABLE';
    throw error;
  }
  const bytes = source(16);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    throw new TypeError('query registration randomBytes(16) must return exactly 16 Uint8Array bytes');
  }
  return `qreg1_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function generatedRegistrationReference(ref, bridge) {
  const fields = [
    'artifactKind', 'schemaVersion', 'appId', 'id', 'name', 'kind',
    'implementationHash', 'argsContractHash', 'resultContractHash',
    'expectedGeneration', 'authoredSourceHash', 'authRequirement',
  ];
  const reference = {};
  for (const field of fields) {
    if (Object.hasOwn(ref ?? {}, field)) reference[field] = structuredClone(ref[field]);
  }
  reference.materializationAddress = [...bridge.address];
  reference.authorityPartitionDigest = bridge.authorityPartitionDigest;
  return reference;
}

function containsRouteParameterTemplate(value) {
  if (Array.isArray(value)) return value.some(containsRouteParameterTemplate);
  if (value === null || typeof value !== 'object') return false;
  if (Object.keys(value).length === 1 && typeof value.$param === 'string') return true;
  return Object.values(value).some(containsRouteParameterTemplate);
}

export function initializeStoreRuntimeClient(client, configuration) {
  if (client.__storeRuntimeInitialized === true) return;
  configuration ??= {
    options: null,
    authorityPartitionDigestResolver: null,
    preloadBootPayload: null,
    randomBytes: undefined,
    materializationStore: null,
  };
  if (configuration.options !== null && (
    typeof configuration.options !== 'object' || Array.isArray(configuration.options)
  )) throw new TypeError('__storeRuntimeOptions must be an object');
  if (
    configuration.authorityPartitionDigestResolver !== null
    && typeof configuration.authorityPartitionDigestResolver !== 'function'
  ) throw new TypeError('__authorityPartitionDigestResolver must be a function');
  client.__storeRuntimeInitialized = true;
  const options = configuration.options ?? {};
  client.__registrationContextId = options.contextId ?? null;
  client.__authorityPartitionDigestResolver = configuration.authorityPartitionDigestResolver;
  client.__inlinePreloadBootPayload = configuration.preloadBootPayload;
  client.__preloadRegistrationPromise = client.__preloadRegistrationPromise ?? null;
  client.__registrationRandomBytes = configuration.randomBytes;
  client.__registrationRequiresSecureRandom = client.rqsStore != null
    || configuration.materializationStore !== null;
  client.__rawMaterializationStore = configuration.materializationStore;
  client.__materializationStore = configuration.materializationStore;
  client.__materializationStorePromise = client.__materializationStore
    ? Promise.resolve(client.__materializationStore)
    : null;
  client.__materializationContexts = new Map();
  client.__storeRuntime = null;
  client.__storeRuntimePromise = null;
  client.__storeRuntimeClosed = client.__storeRuntimeClosed === true;
  client.__storeMaintenanceScheduled = null;
  client.__storeMaintenanceDueAt = null;
  client.__storeMaintenanceTask = null;
  client.__storeMaintenanceLastError = null;
  client.__storeRuntimeNow = typeof options.now === 'function' ? options.now : () => Date.now();
  client.__storeRuntimeSchedule = typeof options.schedule === 'function'
    ? options.schedule
    : defaultStoreMaintenanceSchedule;
  client.__storeRuntimeCancel = typeof options.cancel === 'function'
    ? options.cancel
    : defaultStoreMaintenanceCancel;
  client.__storeRuntimeBroadcastChannelFactory = options.broadcastChannelFactory === undefined
    ? (typeof globalThis.BroadcastChannel === 'function'
      ? (name) => new globalThis.BroadcastChannel(name)
      : null)
    : options.broadcastChannelFactory;
  client.__storeRuntimeLockManager = options.lockManager === undefined
    ? (globalThis.navigator?.locks ?? null)
    : options.lockManager;
  client.__storeRuntimeCarrier = options.carrier ?? null;
  client.__storeRuntimePolicyLimits = options.policyLimits ?? null;
  client.__storeRuntimeSetInterval = options.setIntervalFn ?? globalThis.setInterval;
  client.__storeRuntimeClearInterval = options.clearIntervalFn ?? globalThis.clearInterval;
  client.__storeRuntimePendingOutcomes = new Map();
  client.__registrationRevision = 0;
  client.__activeRegistrations = new Map();
  const v3Store = typeof client.rqsStore?.materializationTransaction === 'function'
    ? client.rqsStore
    : null;
  const deferredMaterializationStore = {
    observeMaterialization: (address, listener) => {
      if (client.__materializationStore) {
        return client.__materializationStore.observeMaterialization(address, listener);
      }
      listener({ format: 'snapback.materialization-observation.v1', present: false, generation: null, status: null });
      return () => {};
    },
    beginEstablishment: async (...args) => {
      const store = await client.__materializationStorePromise;
      if (!store) {
        const error = new Error('SNAPBACK_MATERIALIZATION_STORE_UNAVAILABLE');
        error.code = 'SNAPBACK_MATERIALIZATION_STORE_UNAVAILABLE';
        throw error;
      }
      return store.beginEstablishment(...args);
    },
  };
  client.__registrationLedgerPromise = (
    v3Store === null
    && (typeof client.clientStoreId !== 'string' || client.clientStoreId.length === 0)
  )
    ? Promise.resolve(null)
    : Promise.resolve(
        typeof v3Store?.readStoreMeta === 'function' ? v3Store.readStoreMeta() : null,
      ).then((meta) => {
        client.__materializationClientStoreId = meta?.clientStoreId ?? client.clientStoreId;
        return createRegistrationLedger({
          storeHandle: v3Store,
          clientStoreId: client.__materializationClientStoreId,
          resolveAddress: configuration.registrationAddressResolver,
          materializationStore: deferredMaterializationStore,
        });
      });
  for (const [name, method] of Object.entries(storeRuntimeMethods)) {
    if (!(name in client)) Object.defineProperty(client, name, { value: method });
  }
}

export const storeRuntimeMethods = {
  async prepareProtectedQueryRetention(options) {
    await this.__registrationLedgerPromise;
    return prepareProtectedQueryRetention({
      ...options,
      storeHandle: this.rqsStore,
    });
  },

  seedProtectedQueryRetention(prepared, clientNowMs = Date.now()) {
    return seedProtectedQueryRetention({
      prepared,
      storeHandle: this.rqsStore,
      clientNowMs,
    });
  },

  async seedProtectedQueryRetentionState({
    prepared,
    handle,
    deliverAuthorityObservation,
    onUpdate,
  }) {
    const result = await seedProtectedQueryRetention({
      prepared,
      storeHandle: this.rqsStore,
      clientNowMs: Date.now(),
    });
    if (result?.retained !== true) return { seeded: false };
    let pendingIntentsAtSeed = 0;
    try {
      if ((await this.rqsStore.outboxEmpty()) !== true) {
        pendingIntentsAtSeed = Math.max(1, (await this.rqsStore.outboxPending()).length);
      }
    } catch {
      pendingIntentsAtSeed = 1;
    }
    handle.rows = result.rows;
    handle.version = result.version;
    handle.freshness = 'retained';
    handle.answerClass = 'authoritative';
    handle.pendingIntentsAtSeed = pendingIntentsAtSeed;
    handle.retention = Object.freeze({
      retainable: true,
      code: null,
      reason: 'lease-validated protected retained query',
      store: this.rqsStoreInfo,
    });
    deliverAuthorityObservation(() => {
      onUpdate?.(handle.rows, {
        version: handle.version,
        kind: 'authorized_lease_retained',
        freshness: 'retained',
        answerClass: 'authoritative',
        ...(pendingIntentsAtSeed > 0 ? { pendingIntents: pendingIntentsAtSeed } : {}),
      });
    });
    return { seeded: true };
  },

  beginProtectedQueryLease(prepared, options) {
    return beginProtectedQueryLease({
      prepared,
      storeHandle: this.rqsStore,
      ...options,
    });
  },

  commitProtectedQueryLease(prepared, options) {
    return commitProtectedQueryLease({
      prepared,
      storeHandle: this.rqsStore,
      ...options,
    });
  },

  async installProtectedRetentionSnapshot({
    prepared,
    connection,
    snapshot,
    ref,
    args,
    userId,
    queryNamespace,
    deploymentIdentity,
    authorityCapture,
  }) {
    let retained = false;
    let reason = 'authorized lease was not installed';
    try {
      const session = await this.authSession();
      const connectionValue = validateAuthorizationInvalidationConnection(connection);
      const generationFields = ['schemaVersion', 'appId', 'schemaHash', 'bundleHash', 'inputsHash'];
      if (
        session.activeMode !== 'sessions'
        || session.authority?.isAuthenticated !== true
        || session.clientProtocols?.authInvalidation !== 1
        || session.clientProtocols?.authorizedLease !== 1
        || session.authorizedLease?.protocolVersion !== 1
        || session.availability?.retainedReads?.available !== true
        || generationFields.some(
          (field) => session.deploymentIdentity?.[field] !== deploymentIdentity?.[field],
        )
      ) {
        reason = 'server/session did not affirm protected retained-read capability';
        throw new Error('SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE');
      }
      const startedClientMs = Date.now();
      const leaseRequestId = createClientMutationId('lease');
      const reservation = await beginProtectedQueryLease({
        prepared,
        storeHandle: this.rqsStore,
        leaseRequestId,
        clientNowMs: startedClientMs,
        principalId: session.authority.userId,
        issuerId: connectionValue.issuerId,
        authorization: connectionValue.authorization,
        versionStream: connectionValue.versionStream,
        authorityInstanceId: session.authorityDescriptor.authorityInstanceId,
      });
      if (reservation?.retained !== true) {
        reason = `protected query authority changed (${reservation?.reason ?? 'unknown'})`;
        return Object.freeze({ retained: false, reason });
      }
      // The reservation above is durable before this full revalidation
      // request starts. No heartbeat, delta, or session refresh renews it.
      const leaseResponse = await this.authorizedLeaseQuery(ref, {
        args,
        userId,
        leaseRequestId,
        authorizationNamespace: queryNamespace,
        authorityCapture,
      });
      if (
        leaseResponse.version !== snapshot.version
        || stableJson(leaseResponse.rows) !== stableJson(snapshot.rows)
      ) {
        reason = 'authorized lease response did not match the fresh live snapshot';
        throw new Error('SNAPBACK_AUTHORIZED_LEASE_SNAPSHOT_MISMATCH');
      }
      const committed = await commitProtectedQueryLease({
        prepared,
        storeHandle: this.rqsStore,
        lease: leaseResponse.authorizedLease,
        rows: leaseResponse.rows,
        version: leaseResponse.version,
        clientNowMs: Date.now(),
      });
      retained = committed?.retained === true;
      reason = retained
        ? null
        : `authorized lease commit refused (${committed?.reason ?? 'unknown'})`;
    } catch (error) {
      reason = error?.diagnostic?.message ?? error?.message ?? reason;
      try {
        await deleteProtectedQueryRetention({
          prepared,
          storeHandle: this.rqsStore,
        });
      } catch { /* the live snapshot remains current but non-retainable */ }
    }
    return Object.freeze({ retained, reason });
  },

  deleteProtectedQueryRetention(prepared) {
    return deleteProtectedQueryRetention({
      prepared,
      storeHandle: this.rqsStore,
    });
  },

  async __currentAuthorityPartitionDigest(userId = null) {
    let digest;
    if (this.__authorityPartitionDigestResolver !== null) {
      digest = await this.__authorityPartitionDigestResolver({ userId });
    } else {
      const session = await this.authSession();
      const authorizationScope = await this.currentAuthorizationScope({ devUserId: userId ?? null });
      digest = deriveAuthorityPartitionDigestV1({ userId, authorizationScope, session });
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(digest ?? '')) {
      const error = new Error(
        'SNAPBACK_QUERY_REGISTRATION_PARTITION_REQUIRED: owner authority did not issue a partition digest',
      );
      error.code = 'SNAPBACK_QUERY_REGISTRATION_PARTITION_REQUIRED';
      throw error;
    }
    return digest;
  },

  async __replacePreloadRouteBoot(payload, {
    userId = null,
    functionReferences = null,
    persist = true,
    __deriveOnly = false,
    __authorityPartitionDigest = null,
  } = {}) {
    if (functionReferences === null) return Object.freeze({
      committed: true,
      added: 0,
      retired: 0,
      duplicate: true,
      grandfatheredLegacy: true,
    });
    const authorityPartitionDigest = __authorityPartitionDigest
      ?? await this.__currentAuthorityPartitionDigest(userId);
    this.__registrationContextId ??= mintVolatileRegistrationId(
      this.__registrationRandomBytes,
      { allowLocalFallback: !this.__registrationRequiresSecureRandom },
    );
    const entryFunctionReferences = await Promise.all((payload?.entries ?? []).map(
      async (entry) => {
        const supplied = functionReferences?.[entry?.function] ?? null;
        if (supplied === null || typeof supplied !== 'object') return null;
        const prepared = await this.__prepareGeneratedMaterializationBridge(
          supplied,
          entry.args ?? {},
          userId,
          persist !== false,
        );
        if (prepared === null) return { name: entry.function };
        if (prepared.bridge.authorityPartitionDigest !== authorityPartitionDigest) {
          const error = new Error(
            'SNAPBACK_QUERY_REGISTRATION_PARTITION_MISMATCH: preload owner snapshot changed during derivation',
          );
          error.code = 'SNAPBACK_QUERY_REGISTRATION_PARTITION_MISMATCH';
          throw error;
        }
        return generatedRegistrationReference(supplied, prepared.bridge);
      },
    ));
    const derived = derivePreloadQueryRegistrationsV1(payload, {
      authorityPartitionDigest,
      bootId: this.__registrationContextId,
      functionReferences,
      entryFunctionReferences,
      persist,
    });
    if (__deriveOnly) return derived;
    const runtime = await this.__ensureStoreRuntime();
    const ledger = runtime?.ledger ?? await this.__registrationLedgerPromise;
    if (!ledger) return { refused: { code: 'SNAPBACK_QUERY_REGISTRATION_STORE_DISABLED' } };
    return runtime ? runtime.applyPreloadManifest(derived) : ledger.replacePreloadManifest(derived);
  },

  async __replacePreloadManifestInForce(routesManifest, currentPayload, {
    userId = null,
    functionReferences = null,
  } = {}) {
    if (
      routesManifest?.formatVersion !== 1
      || typeof routesManifest.app !== 'string'
      || !Array.isArray(routesManifest.routes)
      || functionReferences === null
    ) return this.__replacePreloadRouteBoot(currentPayload, { userId, functionReferences });
    const currentRoute = currentPayload?.route ?? null;
    if (currentRoute !== null && !routesManifest.routes.some((route) => route?.route === currentRoute)) {
      const error = new Error(
        'SNAPBACK_PRELOAD_MANIFEST_INVALID: concrete boot route is absent from the routes manifest in force',
      );
      error.code = 'SNAPBACK_PRELOAD_MANIFEST_INVALID';
      throw error;
    }
    const authorityPartitionDigest = await this.__currentAuthorityPartitionDigest(userId);
    const derivedRoutes = [];
    for (const route of routesManifest.routes) {
      if (typeof route?.route !== 'string' || !Array.isArray(route.queries)) {
        const error = new Error('SNAPBACK_PRELOAD_MANIFEST_INVALID: routes manifest shape is invalid');
        error.code = 'SNAPBACK_PRELOAD_MANIFEST_INVALID';
        throw error;
      }
      if (route.registerGroupEligible !== true) continue;
      const entries = route.route === currentRoute
        ? currentPayload.entries
        : route.queries.filter((query) => !containsRouteParameterTemplate(query?.args ?? {}));
      derivedRoutes.push(await this.__replacePreloadRouteBoot({
        route: route.route,
        generation: route.route === currentRoute
          ? currentPayload.generation
          : `routes:${routesManifest.app}`,
        entries,
      }, {
        userId,
        functionReferences,
        persist: route.persist !== false,
        __deriveOnly: true,
        __authorityPartitionDigest: authorityPartitionDigest,
      }));
    }
    const manifestIdentity = canonicalizeClientValueV1({
      routesManifest,
      currentBoot: currentPayload == null ? null : {
        route: currentPayload.route,
        generation: currentPayload.generation,
        entries: currentPayload.entries.map((entry) => ({ function: entry.function, args: entry.args ?? {} })),
      },
      authorityPartitionDigest,
    });
    const derived = Object.freeze({
      manifestRevision: `qpmf1_${base64UrlNoPad(sha256(
        new TextEncoder().encode(`snapback:preload-manifest-in-force:v1:${manifestIdentity}`),
      ))}`,
      registrations: Object.freeze(derivedRoutes.flatMap((route) => route.registrations)),
    });
    const runtime = await this.__ensureStoreRuntime();
    const ledger = runtime?.ledger ?? await this.__registrationLedgerPromise;
    if (!ledger) return { refused: { code: 'SNAPBACK_QUERY_REGISTRATION_STORE_DISABLED' } };
    return runtime ? runtime.applyPreloadManifest(derived) : ledger.replacePreloadManifest(derived);
  },

  __ensureInlinePreloadRegistrations() {
    if (this.__preloadRegistrationPromise !== null) return this.__preloadRegistrationPromise;
    if (this.__inlinePreloadBootPayload === null) {
      this.__preloadRegistrationPromise = Promise.resolve(null);
      return this.__preloadRegistrationPromise;
    }
    this.__preloadRegistrationPromise = this.__replacePreloadRouteBoot(
      this.__inlinePreloadBootPayload,
    ).catch((error) => ({
      refused: { code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_STORE_RUNTIME_LOAD_FAILED' },
    }));
    return this.__preloadRegistrationPromise;
  },

  async __synchronizeStorePolicyRegistrationSets(
    policy,
    ledger,
    resolveRegistration,
    beforeEntries = [],
    extraAddresses = [],
  ) {
    if (this.rqsStore?.isWriter?.() !== true) return;
    const before = policyRegistrationGroups(beforeEntries, resolveRegistration);
    const after = policyRegistrationGroups(ledger.registrations(), resolveRegistration);
    for (const entry of extraAddresses) {
      if (!before.has(entry.addressKey)) before.set(entry.addressKey, {
        authorityPartitionDigest: entry.authorityPartitionDigest,
        registrations: [],
      });
    }
    for (const addressKey of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const snapshot = after.get(addressKey) ?? before.get(addressKey);
      const hydration = ledger.hydrationState?.(addressKey) ?? null;
      await policy.updateRegistrationSet({
        addressKey,
        authorityPartitionDigest: snapshot.authorityPartitionDigest,
        registrations: after.get(addressKey)?.registrations ?? [],
        ...(hydration?.lastEstablishedAt === undefined
          ? {}
          : { lastEstablishmentAt: hydration.lastEstablishedAt }),
      });
    }
  },

  // @ref LLP 0166#the-multi-context-demand-broker — a durable forwarded
  // mutation is complete only at its context-bound outcome. Writer handoff
  // therefore replays the same request id against the new generation; the
  // broker's consumed-request memory makes both committed and released
  // outcomes idempotent across the crash cut.
  async __replayPendingStoreRuntimeOutcomes() {
    const runtime = this.__storeRuntime;
    if (runtime === null || this.__storeRuntimePendingOutcomes.size === 0) return false;
    for (const [requestId, pending] of [...this.__storeRuntimePendingOutcomes]) {
      if (this.__storeRuntimePendingOutcomes.get(requestId) !== pending) continue;
      try {
        await pending.replay();
      } catch (error) {
        if (this.__storeRuntimePendingOutcomes.get(requestId) === pending) {
          this.__storeRuntimePendingOutcomes.delete(requestId);
          pending.reject(error);
        }
      }
    }
    return true;
  },

  // @ref LLP 0166#the-multi-context-demand-broker — the dynamic boundary
  // joins before broker construction; all writer and ledger ordering remains
  // inside this single promise.
  async __ensureStoreRuntime() {
    if (this.__storeRuntimeClosed) return null;
    if (this.__storeRuntime) return this.__storeRuntime;
    if (this.__storeRuntimePromise) return this.__storeRuntimePromise;
    if (typeof this.rqsStore?.materializationTransaction !== 'function') return null;
    this.__storeRuntimePromise = (async () => {
      const ledger = await this.__registrationLedgerPromise;
      if (!ledger) return null;
      const compactingMaterializationStore = this.__rawMaterializationStore ?? Object.freeze({
        compactPayload: async (...args) => {
          const store = await this.__ensureMaterializationStore();
          if (!store) throw new Error('SNAPBACK_MATERIALIZATION_STORE_UNAVAILABLE');
          return store.compactPayload(...args);
        },
      });
      const resolveRegistration = (registration) => ledger.resolveRegistration(registration);
      const policy = createStorePolicyController({
        storeHandle: this.rqsStore,
        materializationStore: compactingMaterializationStore,
        resolveRegistration,
        now: this.__storeRuntimeNow,
        ...(this.__storeRuntimePolicyLimits === null ? {} : { limits: this.__storeRuntimePolicyLimits }),
      });
      const persistedBrokerPairs = await this.rqsStore.materializationTransaction(
        'readonly',
        (view) => structuredClone(view.storeMeta.brokerRoster?.pairs ?? {}),
      );
      const brokerDemandSnapshots = new Map(
        Object.entries(persistedBrokerPairs).map(([key, pair]) => [
          key,
          Array.isArray(pair?.demands) ? pair.demands : [],
        ]),
      );
      const applyLedgerMutation = async (mutation, additionalBefore = []) => {
        const before = [...ledger.registrations(), ...additionalBefore];
        const result = await mutation();
        await this.__synchronizeStorePolicyRegistrationSets(policy, ledger, resolveRegistration, before);
        this.__queueStoreMaintenance();
        return result;
      };
      const brokerLedger = Object.freeze({
        applyContextDemands: async (input) => {
          const key = `${input.contextId}\u0000${input.authorityPartitionDigest}`;
          const prior = (brokerDemandSnapshots.get(key) ?? []).map((registration) => ({ registration }));
          const result = await applyLedgerMutation(() => ledger.applyContextDemands(input), prior);
          if (input.demands.length === 0) brokerDemandSnapshots.delete(key);
          else brokerDemandSnapshots.set(key, structuredClone(input.demands));
          return result;
        },
        releaseContextDemands: async (input) => {
          const prefix = `${input.contextId}\u0000`;
          const prior = [];
          for (const [key, demands] of brokerDemandSnapshots) {
            if (!key.startsWith(prefix)) continue;
            prior.push(...demands.map((registration) => ({ registration })));
            brokerDemandSnapshots.delete(key);
          }
          return applyLedgerMutation(() => ledger.releaseContextDemands(input), prior);
        },
        registerDurable: (input) => applyLedgerMutation(() => ledger.registerDurable(input)),
        releaseDurable: (input) => applyLedgerMutation(() => ledger.releaseDurable(input)),
        effectivePolicy: (addressKey) => ledger.effectivePolicy(addressKey),
        demandState: (addressKey) => ledger.demandState(addressKey),
      });
      this.__registrationContextId ??= mintVolatileRegistrationId(
        this.__registrationRandomBytes,
        { allowLocalFallback: !this.__registrationRequiresSecureRandom },
      );
      const implementation = this.rqsStoreInfo.implementation
        ?? this.rqsStore.durability?.().implementation
        ?? null;
      const carrier = this.__storeRuntimeCarrier
        ?? (implementation === 'indexeddb' ? 'browser' : 'file');
      let channel = null;
      if (carrier === 'browser' && typeof this.__storeRuntimeBroadcastChannelFactory === 'function') {
        try {
          channel = this.__storeRuntimeBroadcastChannelFactory(
            `snapback:demand-broker:${this.__materializationClientStoreId}`,
          );
        } catch {
          channel = null;
        }
      }
      const broker = await createDemandBroker({
        storeHandle: this.rqsStore,
        registrationLedger: brokerLedger,
        resolveRegistration,
        channel,
        lockManager: carrier === 'browser' ? this.__storeRuntimeLockManager : null,
        carrier,
        now: this.__storeRuntimeNow,
        randomBytes: this.__registrationRandomBytes,
        contextId: this.__registrationContextId,
        setIntervalFn: this.__storeRuntimeSetInterval,
        clearIntervalFn: this.__storeRuntimeClearInterval,
        onWriterHello: () => this.__replayPendingStoreRuntimeOutcomes(),
        onSuppressionEnd: () => {
          this.__queueStoreMaintenance();
          void this.__replayPendingStoreRuntimeOutcomes();
        },
        onOutcome: (message) => {
          if (message.contextId !== this.__registrationContextId) return;
          const pending = this.__storeRuntimePendingOutcomes.get(message.requestId);
          if (!pending) return;
          this.__storeRuntimePendingOutcomes.delete(message.requestId);
          pending.resolve(message.outcome);
        },
      });
      const runtime = Object.freeze({
        broker,
        ledger,
        brokerLedger,
        policy,
        resolveRegistration,
        carrier,
        applyLocalDemands: async (input) => {
          const result = await applyLedgerMutation(() => ledger.applyContextDemands(input));
          const announced = await broker.announce(input);
          this.__queueStoreMaintenance();
          return { result, announced };
        },
        applyPreloadManifest: (input) => applyLedgerMutation(() => ledger.replacePreloadManifest(input)),
      });
      this.__storeRuntime = runtime;
      if (
        this.rqsStore.isWriter?.() !== true
        && typeof this.rqsStore.whenLockSettled === 'function'
      ) void this.rqsStore.whenLockSettled().then(() => {
        if (this.rqsStore.isWriter?.() === true) this.__queueStoreMaintenance();
      }).catch(() => {});
      if (this.rqsStore.isWriter?.() === true) {
        const storedFacts = await this.rqsStore.materializationTransaction('readonly', (view) => (
          Object.entries(view.storeMeta.policyBudgetFacts?.addresses ?? {}).map(
            ([addressKey, fact]) => ({ addressKey, authorityPartitionDigest: fact.authorityPartitionDigest }),
          )
        ));
        await this.__synchronizeStorePolicyRegistrationSets(
          policy,
          ledger,
          resolveRegistration,
          [],
          storedFacts,
        );
      }
      return runtime;
    })().catch((error) => {
      this.__storeRuntimePromise = null;
      throw error;
    });
    return this.__storeRuntimePromise;
  },

  __queueStoreMaintenance(delayMs = 0) {
    if (this.__storeRuntimeClosed) return false;
    const dueAt = this.__storeRuntimeNow() + Math.max(0, delayMs);
    if (
      this.__storeMaintenanceScheduled !== null
      && this.__storeMaintenanceDueAt !== null
      && this.__storeMaintenanceDueAt <= dueAt
    ) return false;
    if (this.__storeMaintenanceScheduled !== null) {
      this.__storeRuntimeCancel(this.__storeMaintenanceScheduled);
    }
    this.__storeMaintenanceDueAt = dueAt;
    this.__storeMaintenanceScheduled = this.__storeRuntimeSchedule(() => {
      this.__storeMaintenanceScheduled = null;
      this.__storeMaintenanceDueAt = null;
      void this.__runStoreMaintenance().catch((error) => {
        this.__storeMaintenanceLastError = error;
      });
    }, Math.max(0, delayMs));
    return true;
  },

  async __nextStoreMaintenanceAt() {
    const now = this.__storeRuntimeNow();
    const state = await this.rqsStore.materializationTransaction('readonly', (view) => ({
      policy: structuredClone(view.storeMeta.policyBudgetFacts ?? {}),
      broker: structuredClone(view.storeMeta.brokerRoster ?? {}),
    }));
    let next = Infinity;
    for (const fact of Object.values(state.policy.addresses ?? {})) {
      if (fact.graceActive === true && Number.isSafeInteger(fact.graceDeadline)) {
        next = Math.min(next, fact.graceDeadline);
      }
      if (fact.reclaimPending === true) {
        next = Math.min(next, now + STORE_POLICY_CONSTANTS.heartbeatIntervalMs);
      }
    }
    if (state.broker.suppression?.active === true) {
      if (
        state.broker.suppression.unreconciledPairs?.length > 0
        && Number.isSafeInteger(state.broker.suppression.helloAt)
      ) next = Math.min(
        next,
        state.broker.suppression.helloAt + STORE_POLICY_CONSTANTS.heartbeatExpiryMs,
      );
    } else {
      for (const heartbeat of Object.values(state.broker.heartbeats ?? {})) {
        if (Number.isSafeInteger(heartbeat)) {
          next = Math.min(next, heartbeat + STORE_POLICY_CONSTANTS.heartbeatExpiryMs);
        }
      }
    }
    if (
      this.rqsStore.isWriter?.() !== true
      && (this.__activeRegistrations.size > 0 || this.__storeRuntimePendingOutcomes.size > 0)
    ) {
      next = Math.min(next, now + STORE_POLICY_CONSTANTS.heartbeatIntervalMs);
    }
    return Number.isFinite(next) ? next : null;
  },

  async __runStoreMaintenance() {
    if (this.__storeMaintenanceTask) return this.__storeMaintenanceTask;
    if (this.__storeMaintenanceScheduled !== null) {
      this.__storeRuntimeCancel(this.__storeMaintenanceScheduled);
      this.__storeMaintenanceScheduled = null;
      this.__storeMaintenanceDueAt = null;
    }
    const task = (async () => {
      const runtime = await this.__ensureStoreRuntime();
      if (!runtime) return Object.freeze({ broker: false, policy: null });
      await runtime.broker.maintenance();
      const policy = this.rqsStore.isWriter?.() === true
        ? await runtime.policy.maintenance()
        : null;
      const nextAt = await this.__nextStoreMaintenanceAt();
      if (nextAt !== null) this.__queueStoreMaintenance(
        Math.max(0, nextAt - this.__storeRuntimeNow()),
      );
      return Object.freeze({ broker: true, policy });
    })().finally(() => {
      if (this.__storeMaintenanceTask === task) this.__storeMaintenanceTask = null;
    });
    this.__storeMaintenanceTask = task;
    return task;
  },

  async storePolicyInspection({ authorityPartitionDigest } = {}) {
    if (typeof authorityPartitionDigest !== 'string') {
      throw new TypeError('storePolicyInspection requires authorityPartitionDigest');
    }
    const runtime = await this.__ensureStoreRuntime();
    if (!runtime) {
      const error = new Error('SNAPBACK_STORE_POLICY_UNAVAILABLE: client store is disabled');
      error.code = 'SNAPBACK_STORE_POLICY_UNAVAILABLE';
      throw error;
    }
    return runtime.policy.inspection({ authorityPartitionDigest });
  },

  __storePolicyRuntimeInspection() {
    return Object.freeze({
      constructed: this.__storeRuntime !== null,
      scheduled: this.__storeMaintenanceScheduled !== null,
      running: this.__storeMaintenanceTask !== null,
      lastErrorCode: this.__storeMaintenanceLastError?.code ?? null,
    });
  },

  async __ensureMaterializationStore() {
    if (this.__materializationStore) return this.__materializationStore;
    if (!this.__materializationStorePromise) {
      if (typeof this.rqsStore?.materializationTransaction !== 'function') return null;
      this.__materializationStorePromise = createMaterializationStore(this.rqsStore, {
        resolveValidationContext: ({ address, record }) => {
          const base = this.__materializationContexts.get(JSON.stringify(address)) ?? null;
          if (!base) return null;
          let witness = base.authorizationWitness;
          if (witness === null) {
            const proof = record.productState.heldProofs[0] ?? null;
            if (proof) {
              witness = {
                format: 'snapback.authorization-witness.v1',
                queryInstanceId: record.queryInstanceId,
                compositeWitness: {
                  authorization: {
                    incarnation: record.authorityState.expected_authorization.incarnation,
                    epoch: record.authorityState.expected_authorization.epoch,
                  },
                  data: {
                    versionStream: proof.version.stream,
                    minCommitVersion: proof.version.commit,
                  },
                },
              };
            }
          }
          return {
            ...base,
            authorizationWitness: witness,
            publicationAdmitted: typeof base.publicationGuard === 'function'
              ? base.publicationGuard() === true
              : true,
          };
        },
      }).then((store) => {
        this.__rawMaterializationStore = store;
        this.__materializationStore = store;
        return store;
      });
    }
    return this.__materializationStorePromise;
  },

  async __prepareGeneratedMaterializationBridge(ref, args, userId, persistResume) {
    if (
      ref?.artifacts?.trustedCompositionActivation == null
      || ref?.composition == null
      || typeof this.rqsStore?.materializationTransaction !== 'function'
    ) return null;
    // Constructor-time ledger setup used to settle before callers could reach
    // bridge derivation. Join that same store-meta promise after the dynamic
    // module boundary so the QMK address and ledger share one clientStoreId.
    // @ref LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle — the
    // optional import may defer construction, never reorder store identity.
    await this.__registrationLedgerPromise;
    const clientStoreId = this.__materializationClientStoreId ?? this.clientStoreId;
    let bridge;
    try {
      const session = await this.authSession();
      const scope = await this.currentAuthorizationScope({ devUserId: userId ?? null });
      bridge = deriveGeneratedMaterializationBridge({
        ref,
        args,
        userId: userId ?? null,
        clientStoreId,
        authorizationScope: { ...scope, session },
        durableCarrier: this.rqsStoreInfo.durable === true,
        persistResume,
        authorizedLeaseAvailable: this.authProtocols.authInvalidation === 1
          && this.authProtocols.authorizedLease === 1
          && session.clientProtocols?.authInvalidation === 1
          && session.clientProtocols?.authorizedLease === 1
          && session.authorizedLease?.protocolVersion === 1
          && session.availability?.retainedReads?.available === true,
      });
    } catch (error) {
      if (!isConnectivityFailureError(error)) throw error;
      bridge = await findRetainedGeneratedMaterializationBridge({
        ref,
        args,
        clientStoreId,
        storeHandle: this.rqsStore,
        durableCarrier: this.rqsStoreInfo.durable === true,
        persistResume,
      });
    }
    if (bridge === null) return null;
    const lease = await loadMaterializationLeaseCustody(this.rqsStore, bridge);
    const context = {
      trustedActivation: bridge.activation,
      planHash: bridge.identities.planHash,
      nodes: bridge.nodes,
      resultContractHash: bridge.resultContractHash,
      resultContract: bridge.resultContract,
      authorizationWitness: lease.witness,
      authorizationWitnessOwnerProduced: true,
      retentionEligible: true,
      retentionAuthority: bridge.retentionClass === 'rqs-authority-independent-snapshot-v1'
        ? 'rqs-authority-independent-snapshot-v1'
        : 'authorized-lease-v1',
      leaseStatus: lease.leaseStatus,
      authorizedLeaseHash: lease.authorizedLeaseHash,
      ownerTransitionForRetainedFailure: retainedFailureTransition,
    };
    this.__materializationContexts.set(bridge.addressKey, context);
    const store = await this.__ensureMaterializationStore();
    if (!store) return null;
    const record = await store.initialize(bridge.address, bridge.identities, null);
    this.__queueStoreMaintenance();
    return {
      bridge,
      context,
      record,
      store,
      runtime: Object.freeze({
        authorityStateForWitness,
        commitMaterializationLeaseCustody,
        materializationFence,
        pageIdentityDigestV1,
      }),
    };
  },

  // @ref LLP 0166#registration-sources-mapped-to-shipped-machinery — each
  // qmk1 live query joins lazy construction before publishing its demand.
  async __registerActiveQueryDemand(
    ref,
    args,
    persistResume,
    preparedBridge = null,
    userId = null,
  ) {
    const preloadOutcome = await this.__ensureInlinePreloadRegistrations();
    if (preloadOutcome?.refused) {
      const error = new Error(
        `${preloadOutcome.refused.code}: routes-manifest preload registration refused`,
      );
      error.code = preloadOutcome.refused.code;
      throw error;
    }
    const suppliedReference = typeof ref === 'object' && ref !== null ? ref : null;
    const suppliedAddress = suppliedReference?.clientMaterializationAddress
      ?? suppliedReference?.materializationAddress
      ?? null;
    const suppliedQmk = (
      Array.isArray(suppliedAddress)
      && /^qmk1\.[A-Za-z0-9_-]{43}$/u.test(suppliedAddress[2] ?? '')
    ) || /^qmk1\.[A-Za-z0-9_-]{43}$/u.test(suppliedReference?.materializationKey ?? '');
    const suppliedPartition = suppliedQmk
      && /^sha256:[0-9a-f]{64}$/u.test(suppliedReference?.authorityPartitionDigest ?? '')
      ? suppliedReference.authorityPartitionDigest
      : null;
    const partition = preparedBridge?.bridge?.authorityPartitionDigest ?? suppliedPartition;
    if (partition === null) return Object.freeze({
      registrationId: null,
      publishLiveAnswer: () => false,
      clearLiveAnswer: () => false,
      release: () => Promise.resolve(),
    });
    const runtime = await this.__ensureStoreRuntime();
    const ledger = runtime?.ledger ?? await this.__registrationLedgerPromise;
    if (ledger === null) return Object.freeze({
      registrationId: null,
      publishLiveAnswer: () => false,
      clearLiveAnswer: () => false,
      release: () => {},
    });
    const mintRegistrationId = () => mintVolatileRegistrationId(
      this.__registrationRandomBytes,
      { allowLocalFallback: !this.__registrationRequiresSecureRandom },
    );
    this.__registrationContextId ??= mintRegistrationId();
    const registrationId = mintRegistrationId();
    const functionReference = typeof ref === 'object' && ref !== null
      ? structuredClone(ref)
      : { name: this.__storeFunctionName(ref) };
    if (preparedBridge !== null) {
      functionReference.materializationAddress = [...preparedBridge.bridge.address];
    }
    if (preparedBridge?.bridge?.localReadCoverage != null) {
      functionReference.localReadCoverage = structuredClone(preparedBridge.bridge.localReadCoverage);
    }
    functionReference.authorityPartitionDigest = partition;
    const registration = {
      format: 'snapback.query-registration.v1',
      registrationId,
      source: 'active',
      ownerContext: { kind: 'subscription', contextId: this.__registrationContextId },
      functionReference,
      canonicalArgs: structuredClone(args),
      requestedScope: { kind: 'page', input: { kind: 'first' } },
      retentionRequest: persistResume ? 'durable' : 'none',
      idleTtlClass: preparedBridge?.bridge?.retentionClass
        === 'rqs-authority-independent-snapshot-v1' && persistResume
        ? 'pinned'
        : 'default',
    };
    this.__activeRegistrations.set(registrationId, { registration, partition });
    const demands = [...this.__activeRegistrations.values()]
      .filter((entry) => entry.partition === partition)
      .map((entry) => entry.registration);
    try {
      const demandUpdate = {
        contextId: this.__registrationContextId,
        authorityPartitionDigest: partition,
        revision: ++this.__registrationRevision,
        demands,
      };
      if (runtime) await runtime.applyLocalDemands(demandUpdate);
      else ledger.applyContextDemands(demandUpdate);
      if (preparedBridge) await ledger.awaitHydrationIdle();
    } catch (error) {
      this.__activeRegistrations.delete(registrationId);
      throw error;
    }
    const coverage = functionReference.localReadCoverage ?? null;
    const liveMaterialization = coverage === null ? null : {
      materializationKey: coverage.materializationKey,
      queryInstanceId: preparedBridge?.record?.queryInstanceId ?? null,
      planHash: coverage.planHash,
      resultContractHash: coverage.resultContractHash,
      authorityPartitionDigest: partition,
    };
    let released = false;
    const release = () => {
      if (released) return Promise.resolve();
      released = true;
      this.__activeRegistrations.delete(registrationId);
      const remaining = [...this.__activeRegistrations.values()]
        .filter((entry) => entry.partition === partition)
        .map((entry) => entry.registration);
      const demandUpdate = {
        contextId: this.__registrationContextId,
        authorityPartitionDigest: partition,
        revision: ++this.__registrationRevision,
        demands: remaining,
      };
      const task = runtime
        ? runtime.applyLocalDemands(demandUpdate)
        : Promise.resolve(ledger.applyContextDemands(demandUpdate));
      void task.catch((error) => { this.__storeMaintenanceLastError = error; });
      return task;
    };
    return Object.freeze({
      registrationId,
      publishLiveAnswer: ({ rows, version, subscriptionId }) => {
        if (released || liveMaterialization === null) return false;
        return ledger.publishLiveRegistrationAnswer({
          registrationId,
          rows,
          version,
          subscriptionId,
          materialization: liveMaterialization,
        });
      },
      clearLiveAnswer: () => (
        released ? false : ledger.clearLiveRegistrationAnswer(registrationId)
      ),
      release,
    });
  },

  __registerOutcome(requestId, outcome) {
    return Object.freeze({
      format: 'snapback.register-outcome.v1',
      contextId: this.__registrationContextId,
      requestId,
      outcome: Object.freeze({ ...outcome }),
    });
  },

  async registerQuery(ref, {
    registrationId,
    args = {},
    userId = null,
    label = null,
    requestedScope = { kind: 'page', input: { kind: 'first' } },
    retentionRequest = 'durable',
    idleTtlClass = 'default',
  } = {}) {
    if (typeof registrationId !== 'string' || registrationId.length === 0) {
      throw new TypeError('registerQuery requires a stable registrationId');
    }
    this.__storeValidateGeneratedArguments(ref, args);
    if (label !== null && (typeof label !== 'string' || label.length === 0)) {
      throw new TypeError('registerQuery label must be null or a non-empty string');
    }
    if (!['none', 'durable'].includes(retentionRequest)) {
      throw new TypeError("registerQuery retentionRequest must be 'none' or 'durable'");
    }
    if (!['none', 'default', 'pinned'].includes(idleTtlClass)) {
      throw new TypeError("registerQuery idleTtlClass must be 'none', 'default', or 'pinned'");
    }
    this.__registrationContextId ??= mintVolatileRegistrationId(
      this.__registrationRandomBytes,
      { allowLocalFallback: !this.__registrationRequiresSecureRandom },
    );
    const requestId = mintVolatileRegistrationId(this.__registrationRandomBytes);
    const prepared = await this.__prepareGeneratedMaterializationBridge(
      ref,
      args,
      userId,
      retentionRequest === 'durable',
    );
    if (prepared === null) return this.__registerOutcome(requestId, {
      kind: 'refused',
      code: 'SNAPBACK_QUERY_REGISTRATION_UNAVAILABLE',
    });
    if (retentionRequest === 'durable' && prepared.bridge.retentionRequested !== true) {
      return this.__registerOutcome(requestId, {
        kind: 'refused',
        code: 'SNAPBACK_RETENTION_NOT_RETAINABLE',
      });
    }
    const registration = {
      format: 'snapback.query-registration.v1',
      registrationId,
      source: 'programmatic',
      ownerContext: { kind: 'api', label },
      functionReference: generatedRegistrationReference(ref, prepared.bridge),
      canonicalArgs: structuredClone(prepared.bridge.canonicalArgs ?? args),
      requestedScope: structuredClone(requestedScope),
      retentionRequest,
      idleTtlClass,
    };
    const runtime = await this.__ensureStoreRuntime();
    if (!runtime) return this.__registerOutcome(requestId, {
      kind: 'refused',
      code: 'SNAPBACK_QUERY_REGISTRATION_STORE_DISABLED',
    });
    if (this.rqsStore.isWriter?.() === true) {
      return runtime.broker.forwardRegistration({ registration, requestId });
    }
    if (runtime.broker.qualification().qualified !== true) {
      return this.__registerOutcome(requestId, {
        kind: 'refused',
        code: 'SNAPBACK_QUERY_REGISTRATION_VOLATILE_ONLY',
      });
    }
    let replay;
    const outcome = new Promise((resolve, reject) => {
      replay = () => runtime.broker.forwardRegistration({ registration, requestId });
      this.__storeRuntimePendingOutcomes.set(requestId, { resolve, reject, replay });
    });
    try {
      await replay();
      return this.__registerOutcome(requestId, await outcome);
    } catch (error) {
      this.__storeRuntimePendingOutcomes.delete(requestId);
      throw error;
    }
  },

  async evaluateLocalResultTransform(ref, {
    args = {},
    userId = null,
    transformPlan,
    overlayLayers = [],
  } = {}) {
    const retentionClass = ref?.composition
      ?.normalizedCompositePlan?.classification?.retention ?? 'none';
    if (
      retentionClass !== RESULT_TRANSFORM_V1_RETENTION_CLASS
      || resultTransformCarrierContextV1(this.rqsStoreInfo) === null
    ) return refuseLocalEvaluation(transformPlan);
    this.__storeValidateGeneratedArguments(ref, args);
    const prepared = await this.__prepareGeneratedMaterializationBridge(ref, args, userId, true);
    if (
      prepared === null
      || prepared.bridge.retentionClass !== RESULT_TRANSFORM_V1_RETENTION_CLASS
      || prepared.bridge.retentionRequested !== true
    ) return refuseLocalEvaluation(transformPlan);
    const bytes = await prepared.store.readRenderable(
      prepared.bridge.address,
      materializationFence(prepared.record),
    );
    if (bytes === null) return refuseLocalEvaluation(transformPlan);
    const fragments = bytes instanceof Uint8Array ? [bytes] : bytes;
    if (!Array.isArray(fragments) || fragments.length === 0) {
      return refuseLocalEvaluation(transformPlan);
    }
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const rowsByPage = fragments.map((fragment) => JSON.parse(decoder.decode(fragment)));
    const projectedFields = prepared.bridge.resultContract?.record?.fields
      ?.map((field) => field.name) ?? [];
    const base = {
      shape: 'row-sequence',
      mode: rowsByPage.length === 1 ? 'single-page' : 'complete-page-set',
      pages: rowsByPage.map((rows, index) => ({
        version: prepared.bridge.identities.planHash,
        terminal: index === rowsByPage.length - 1,
        rows,
      })),
    };
    return evaluateAdmittedResultTransformV1({
      retentionClass: prepared.bridge.retentionClass,
      carrier: this.rqsStoreInfo,
    }, {
      plan: transformPlan,
      executingMaterializationKey: prepared.bridge.address[2],
      projectedFields,
      base,
      ...(transformPlan?.overlay === 'apply' ? { overlayLayers } : {}),
    });
  },

  async releaseQueryRegistration(registrationId, { userId = null } = {}) {
    if (typeof registrationId !== 'string' || registrationId.length === 0) {
      throw new TypeError('releaseQueryRegistration requires registrationId');
    }
    this.__registrationContextId ??= mintVolatileRegistrationId(
      this.__registrationRandomBytes,
      { allowLocalFallback: !this.__registrationRequiresSecureRandom },
    );
    const requestId = mintVolatileRegistrationId(this.__registrationRandomBytes);
    const runtime = await this.__ensureStoreRuntime();
    if (!runtime) return this.__registerOutcome(requestId, { kind: 'released' });
    const authorityPartitionDigest = await this.__currentAuthorityPartitionDigest(userId);
    if (this.rqsStore.isWriter?.() === true) {
      return runtime.broker.releaseRegistration({ authorityPartitionDigest, registrationId, requestId });
    }
    if (runtime.broker.qualification().qualified !== true) {
      return this.__registerOutcome(requestId, {
        kind: 'refused',
        code: 'SNAPBACK_QUERY_REGISTRATION_VOLATILE_ONLY',
      });
    }
    let replay;
    const outcome = new Promise((resolve, reject) => {
      replay = () => runtime.broker.releaseRegistration({
        authorityPartitionDigest,
        registrationId,
        requestId,
      });
      this.__storeRuntimePendingOutcomes.set(requestId, { resolve, reject, replay });
    });
    try {
      await replay();
      return this.__registerOutcome(requestId, await outcome);
    } catch (error) {
      this.__storeRuntimePendingOutcomes.delete(requestId);
      throw error;
    }
  },

  async __readQmk1LocalAnswer({ address, expectedFence = null, connected, ...ownerFacts }) {
    const materializationStore = await this.__ensureMaterializationStore();
    if (!materializationStore) {
      const error = new Error(
        'SNAPBACK_MATERIALIZATION_STORE_UNAVAILABLE: qmk1 local reads require the L2 store seam',
      );
      error.code = 'SNAPBACK_MATERIALIZATION_STORE_UNAVAILABLE';
      throw error;
    }
    await this.__ensureStoreRuntime();
    this.__queueStoreMaintenance();
    let observation = null;
    const releaseObservation = materializationStore.observeMaterialization(
      address,
      (next) => { observation = next; },
    );
    releaseObservation();
    const admittedFence = expectedFence ?? observation?.generation ?? null;
    const value = admittedFence === null
      ? null
      : await materializationStore.readRenderable(address, admittedFence);
    const classification = deriveQmk1AnswerV1({
      connected,
      ...ownerFacts,
      completenessStatus: observation?.status ?? 'unknown',
      freshness: ownerFacts.freshness ?? observation?.freshness ?? null,
      renderable: value !== null,
    });
    return Object.freeze({
      ...classification,
      value: classification.answerClass === 'authoritative' ? value : null,
      materialization: observation?.materialization ?? null,
    });
  },

  async __admitLocalMutationReads({ operation, connected = false } = {}) {
    const ledger = await this.__registrationLedgerPromise;
    return admitLocalMutationReadsV1({
      operation,
      registrationLedger: ledger,
      readMaterializationAnswer: ({ address }) => this.__readQmk1LocalAnswer({ address, connected }),
    });
  },

  async __evaluateLocalMutationWithReadAdmission({ operation, connected = false } = {}) {
    const ledger = await this.__registrationLedgerPromise;
    return evaluateLocalMutationWithReadAdmissionV1({
      operation,
      registrationLedger: ledger,
      readMaterializationAnswer: ({ address }) => this.__readQmk1LocalAnswer({ address, connected }),
    });
  },

  async __createOptimisticRebaseEngine({
    outboxStore,
    initialAuthoritativeRows = {},
    connected = false,
  } = {}) {
    const ledger = await this.__registrationLedgerPromise;
    return createOptimisticRebaseEngineV1({
      outboxStore,
      registrationLedger: ledger,
      readMaterializationAnswer: ({ address }) => this.__readQmk1LocalAnswer({
        address,
        connected,
      }),
      initialAuthoritativeRows,
    });
  },

  async createOptimisticMutationView(outboxStore, {
    authoritativeRows = {},
    connected = false,
  } = {}) {
    const ledger = await this.__registrationLedgerPromise;
    let connectedState = connected === true;
    const engine = createOptimisticRebaseEngineV1({
      outboxStore,
      registrationLedger: ledger,
      readMaterializationAnswer: ({ address }) => this.__readQmk1LocalAnswer({
        address,
        connected: connectedState,
      }),
      initialAuthoritativeRows: authoritativeRows,
    });
    const entry = { engine, setConnected(value) { connectedState = value === true; } };
    this.__optimisticMutationViews.add(entry);
    let closed = false;
    const prepare = (input = {}) => {
      const { connected: nextConnected, ...rebaseInput } = input;
      if (nextConnected !== undefined) entry.setConnected(nextConnected);
      return rebaseInput;
    };
    const view = Object.freeze({
      format: 'snapback.optimistic-mutation-view.v1',
      rebase: (input = {}) => engine.rebase(prepare(input)),
      reload: (input = {}) => engine.reload(prepare(input)),
      refresh: (input = {}) => engine.refresh(prepare(input)),
      getSnapshot: () => engine.getSnapshot(),
      inspection: () => engine.inspection(),
      subscribe: (listener) => engine.subscribe(listener),
      close: () => {
        if (closed) return;
        closed = true;
        this.__optimisticMutationViews.delete(entry);
        engine.close();
      },
    });
    try {
      await engine.reload({ authoritativeRows, cause: 'boot-ir-replay' });
    } catch (error) {
      view.close();
      throw error;
    }
    return view;
  },

  async seedFromMaterializationState({
    preparedMaterialization,
    handle,
    deliverAuthorityObservation,
    onUpdate,
  }) {
    const observation = materializationObservation(preparedMaterialization);
    if (!observation?.present || !observation.generation) return { seeded: false };
    const answer = await this.__readQmk1LocalAnswer({
      address: preparedMaterialization.bridge.address,
      expectedFence: observation.generation,
      connected: false,
      freshness: 'retained',
      retentionEligible: preparedMaterialization.bridge.retentionRequested,
      leaseStatus: preparedMaterialization.context.leaseStatus,
      witnessStatus: 'valid',
      activationMatches: true,
      fenceCurrent: true,
    });
    const rows = decodeMaterializationRows(answer.value);
    if (answer.answerClass !== 'authoritative' || rows === null) return { seeded: false };
    let pendingIntentsAtSeed = 0;
    try {
      if ((await this.rqsStore.outboxEmpty()) !== true) {
        pendingIntentsAtSeed = Math.max(1, (await this.rqsStore.outboxPending()).length);
      }
    } catch {
      pendingIntentsAtSeed = 1;
    }
    handle.rows = rows;
    handle.version = observation.generation.queryGeneration;
    handle.freshness = answer.freshness;
    handle.answerClass = answer.answerClass;
    // @ref LLP 0043#llp-0157-acceptance-boundary--2026-08-03 — pending intent
    // withholds resume/current promotion, never the verified retained
    // pre-intent display.
    handle.pendingIntentsAtSeed = pendingIntentsAtSeed;
    handle.retention = Object.freeze({
      retainable: true,
      code: null,
      reason: 'proof-validated qmk1 materialization',
      store: this.rqsStoreInfo,
    });
    deliverAuthorityObservation(() => {
      onUpdate?.(handle.rows, {
        version: handle.version,
        kind: 'materialization_retained',
        freshness: 'retained',
        answerClass: 'authoritative',
        ...(pendingIntentsAtSeed > 0 ? { pendingIntents: pendingIntentsAtSeed } : {}),
      });
    });
    return { seeded: true };
  },

  async installMaterializationSnapshot({
    preparedMaterialization,
    sub,
    ref,
    args,
    userId,
    queryNamespace,
    resumeStoreKey,
    legacyAdoptionCandidate,
    handleRows,
    authorityCapture,
  }) {
    const proof = sub.completenessProof ?? null;
    const witness = sub.authorizationWitness ?? null;
    if (proof === null || witness === null) return null;
    // The connected prove arm is rung 1: response rows are absent because
    // the proof names the verified legacy bytes already held. Adoption does
    // not send a rung-2 witness, so a changed head takes the fresh-snapshot
    // arm and never asks this transaction to apply partial operations.
    const establishedRows = Array.isArray(sub.snapshot?.rows)
      ? sub.snapshot.rows
      : legacyAdoptionCandidate !== null
        ? handleRows
        : null;
    if (!Array.isArray(establishedRows)) return null;
    const observation = materializationObservation(preparedMaterialization);
    if (!observation?.present || !observation.generation) {
      throw new Error('SNAPBACK_MATERIALIZATION_NOT_INITIALIZED');
    }
    let record = await preparedMaterialization.store.beginEstablishment(
      preparedMaterialization.bridge.address,
      { kind: 'page', input: { kind: 'first' } },
      observation.generation,
    );
    this.__queueStoreMaintenance();
    preparedMaterialization.context.authorizationWitness = structuredClone(witness);
    if (
      record.authorityState.expected_authorization.incarnation
        !== witness.compositeWitness?.authorization?.incarnation
      || record.authorityState.expected_authorization.epoch
        !== witness.compositeWitness?.authorization?.epoch
      || record.authorityState.expected_authorization.version_stream
        !== witness.compositeWitness?.data?.versionStream
    ) {
      record = await preparedMaterialization.store.applyAuthorizationTransition(
        preparedMaterialization.bridge.address,
        { authorityState: preparedMaterialization.runtime.authorityStateForWitness(record, witness) },
      );
      this.__queueStoreMaintenance();
    }

    let retained = preparedMaterialization.bridge.retentionRequested
      && !preparedMaterialization.bridge.leaseRequired;
    let authorizedLeaseHash = null;
    if (preparedMaterialization.bridge.leaseRequired) {
      const startedClientMs = Date.now();
      const leaseRequestId = createClientMutationId('lease');
      try {
        const leaseResponse = await this.authorizedLeaseQuery(ref, {
          args,
          userId,
          leaseRequestId,
          authorizationNamespace: queryNamespace,
          authorityCapture,
        });
        if (
          leaseResponse.version !== proof.version.commit
          || stableJson(leaseResponse.rows) !== stableJson(establishedRows)
        ) {
          throw new Error('SNAPBACK_AUTHORIZED_LEASE_SNAPSHOT_MISMATCH');
        }
        const leaseFacts = await preparedMaterialization.runtime.commitMaterializationLeaseCustody({
          storeHandle: this.rqsStore,
          bridge: preparedMaterialization.bridge,
          record,
          witness,
          lease: leaseResponse.authorizedLease,
          leaseRequestId,
          startedClientMs,
          clientNowMs: Date.now(),
        });
        preparedMaterialization.context.leaseStatus = leaseFacts.leaseStatus;
        preparedMaterialization.context.authorizedLeaseHash = leaseFacts.authorizedLeaseHash;
        preparedMaterialization.context.authorizationWitness = leaseFacts.witness;
        authorizedLeaseHash = leaseFacts.authorizedLeaseHash;
        retained = true;
      } catch {
        // The live snapshot remains usable, but no missing/mismatched lease
        // is promoted to durable custody. Current bytes are cleared at the
        // next store boot.
        preparedMaterialization.context.leaseStatus = 'invalid';
        preparedMaterialization.context.authorizedLeaseHash = null;
        retained = false;
      }
    } else {
      preparedMaterialization.context.leaseStatus = 'not-required';
      preparedMaterialization.context.authorizedLeaseHash = null;
    }
    const bytes = jcsBytes(establishedRows);
    const fragment = {
      pageIdentityDigest: preparedMaterialization.runtime.pageIdentityDigestV1(proof.page),
      resultContractHash: preparedMaterialization.bridge.resultContractHash,
      bytes,
      authorizedLeaseHash,
      memberships: [],
      freshness: retained ? 'retained' : 'current',
    };
    const adoptingLegacy = legacyAdoptionCandidate !== null;
    try {
      record = legacyAdoptionCandidate === null
        ? await preparedMaterialization.store.commitPage(
            preparedMaterialization.bridge.address,
            fragment,
            proof,
            null,
            preparedMaterialization.runtime.materializationFence(record),
          )
        : await preparedMaterialization.store.commitLegacyAdoption(
            preparedMaterialization.bridge.address,
            resumeStoreKey,
            legacyAdoptionCandidate,
            fragment,
            proof,
            null,
            preparedMaterialization.runtime.materializationFence(record),
          );
      this.__queueStoreMaintenance();
    } catch (error) {
      if (![
        'SNAPBACK_SINGLE_TABLE_ADOPTION_PENDING_OUTBOX',
        'SNAPBACK_SINGLE_TABLE_ADOPTION_LEGACY_MISMATCH',
      ].includes(error?.code)) throw error;
      // A raced enqueue or peer adoption leaves the before-state intact.
      // The held display remains retained-not-current; a later establishment
      // retries from the surviving carrier state once custody is clear.
      return { rows: establishedRows, retained: true, adoptionDeferred: true };
    }
    const answer = await this.__readQmk1LocalAnswer({
      address: preparedMaterialization.bridge.address,
      expectedFence: preparedMaterialization.runtime.materializationFence(record),
      connected: true,
      freshness: 'current',
      retentionEligible: true,
      leaseStatus: preparedMaterialization.context.leaseStatus,
      witnessStatus: 'valid',
      activationMatches: true,
      fenceCurrent: true,
    });
    const rows = decodeMaterializationRows(answer.value);
    if (answer.answerClass !== 'authoritative' || rows === null) {
      throw new Error('SNAPBACK_MATERIALIZATION_RENDER_REFUSED');
    }
    return { rows, retained, adoptedLegacy: adoptingLegacy };
  },

  prepareGeneratedMutation({
    ref,
    args,
    userId,
    clientMutationId,
    optimisticOperation,
    ctxLedger,
    settlementLane,
    settlementIdentity,
    settlementClaims,
    boundedSkew,
    composeLocalExecution = true,
  }) {
    const capability = generatedMutationIrCapability(ref);
    if (capability.generated && optimisticOperation !== null) {
      const error = new Error(
        'SNAPBACK_GENERATED_IR_DUPLICATE_TRANSFORM: a generated mutation cannot accept an app-authored optimistic operation',
      );
      error.code = 'SNAPBACK_GENERATED_IR_DUPLICATE_TRANSFORM';
      throw error;
    }
    let generatedMutation = null;
    if (capability.localExecutable) {
      if (
        ctxLedger !== null
        || settlementLane !== null
        || settlementIdentity !== null
        || settlementClaims !== null
        || boundedSkew !== null
      ) {
        const error = new Error(
          'SNAPBACK_GENERATED_IR_DERIVED_OPTIONS_ONLY: generated local mutation settlement and ctx claims are codegen-owned',
        );
        error.code = 'SNAPBACK_GENERATED_IR_DERIVED_OPTIONS_ONLY';
        throw error;
      }
      if (composeLocalExecution) {
        clientMutationId ??= createClientMutationId();
        generatedMutation = prepareGeneratedMutationIrV1({
          reference: ref,
          args,
          clientMutationId,
          authUserId: typeof userId === 'string' ? userId : null,
        });
        settlementLane = generatedMutation.settlementLane;
        settlementIdentity = generatedMutation.settlementIdentity;
        settlementClaims = generatedMutation.settlementClaims;
        boundedSkew = generatedMutation.boundedSkew;
        optimisticOperation = generatedMutation.optimisticOperation;
      }
    }
    return {
      generatedMutation,
      clientMutationId,
      optimisticOperation,
      ctxLedger,
      settlementLane,
      settlementIdentity,
      settlementClaims,
      boundedSkew,
    };
  },

  async __ledger() {
    return this.__registrationLedgerPromise;
  },

  async __closeStoreRuntime() {
    let firstError = null;
    try {
      const runtime = this.__storeRuntimePromise ? await this.__storeRuntimePromise : null;
      const ledger = await this.__registrationLedgerPromise;
      if (runtime && this.__registrationContextId !== null) {
        const partitions = new Set(
          [...this.__activeRegistrations.values()].map((entry) => entry.partition),
        );
        for (const authorityPartitionDigest of partitions) await runtime.applyLocalDemands({
          contextId: this.__registrationContextId,
          authorityPartitionDigest,
          revision: ++this.__registrationRevision,
          demands: [],
        });
        await runtime.broker.close();
      } else if (this.__registrationContextId !== null) {
        ledger?.releaseContextDemands({ contextId: this.__registrationContextId });
      }
      this.__activeRegistrations.clear();
    } catch (error) {
      firstError ??= error;
    }
    this.__storeRuntimeClosed = true;
    if (this.__storeMaintenanceScheduled !== null) {
      try { this.__storeRuntimeCancel(this.__storeMaintenanceScheduled); } catch (error) {
        firstError ??= error;
      }
      this.__storeMaintenanceScheduled = null;
      this.__storeMaintenanceDueAt = null;
    }
    for (const pending of this.__storeRuntimePendingOutcomes.values()) {
      pending.resolve({ kind: 'refused', code: 'SNAPBACK_CLIENT_CLOSED' });
    }
    this.__storeRuntimePendingOutcomes.clear();
    if (firstError) throw firstError;
  },
};
