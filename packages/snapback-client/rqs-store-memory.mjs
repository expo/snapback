// Channel B persisted RQS resume store — in-memory fallback arm.
//
// The graceful-degradation arm of the default client store (LLP 0129
// Phase 0 / LLP 0008 DK-9: "if a persistent store is unavailable, the client
// should degrade to in-memory rather than fail silently"). Same observable
// contract as the IndexedDB and file arms — including the LLP 0043 M2
// outbox — but nothing survives the process: `durable: false` is the honest
// capability fact callers must project (no cold-boot retention claim, no
// restart-safe queue claim, warm-session queueing only).

import {
  allOutboxRecords,
  createOutboxAuthorizationDispatchGate,
  emptyOutboxState,
  outboxAuthorizationStatus,
  outboxNotWriterError,
  outboxOps,
  pendingAcknowledgementsFor,
  pendingOutboxRecords,
  quarantinedOutboxRecordTargets,
  unresolvedOutboxRecords,
} from './outbox-shared.mjs';
import {
  prepareReactBindingReceipt,
  rqsEntryRecordBytes,
  rqsEvictionOrder,
  RQS_STORE_MAX_BYTES,
  RQS_STORE_MAX_ENTRIES,
} from './rqs-store.mjs';
import {
  allocateOfflineMutationReplayCapabilityObservationInMeta,
  allocateQueryInstanceIdInMeta,
  compareAndVersionOfflineMutationReplayCapabilityFact,
  createInitialStoreMeta,
  mintClientStoreId,
  prepareOfflineMutationReplayCapabilityObservation,
  prepareStoreMeta,
  wipeStoreMeta,
} from './rqs-store-meta.mjs';

export function createMemoryRqsResumeStore({
  now = () => Date.now(),
  maxBytes = RQS_STORE_MAX_BYTES,
  maxEntries = RQS_STORE_MAX_ENTRIES,
  relaunchOutboxEmpty = null,
  backing = null,
  clientStoreId = null,
  randomBytes = undefined,
  onBeforeStoreIdentityRotation = null,
} = {}) {
  const state = backing ?? createMemoryRqsStoreBacking({ clientStoreId, randomBytes });
  state.authorizationDispatchGate ??= createOutboxAuthorizationDispatchGate();
  const instance = {};
  let resolveOwnership;
  const ownership = new Promise((resolve) => { resolveOwnership = resolve; });
  let closed = false;
  const writerLockListeners = new Set();
  const notifyWriterLock = (writer) => {
    for (const listener of [...writerLockListeners]) {
      try { listener(writer); } catch { /* observation cannot own the lock */ }
    }
  };

  if (state.writer === null) {
    state.writer = instance;
    resolveOwnership();
  } else {
    state.waiters.push({
      instance,
      resolve: resolveOwnership,
      closed: () => closed,
      notify: notifyWriterLock,
    });
  }

  const requireOpen = () => {
    if (closed) {
      const error = new Error('SNAPBACK_RQS_STORE_CLOSED: RQS resume store is closed');
      error.code = 'SNAPBACK_RQS_STORE_CLOSED';
      throw error;
    }
  };

  const requireWriter = () => {
    requireOpen();
    return state.writer === instance;
  };

  const withAuthorizationDispatch = (operation, options = undefined) => {
    requireOpen();
    return state.authorizationDispatchGate(operation, options);
  };

  const commitAuthorityTransitionAsWriter = async (
    authorityTransitionKey = null,
    authorityTransitionEpoch = null,
    options = undefined,
  ) => {
    if (!requireWriter()) return false;
    const advanced = outboxOps.advanceAuthorizationAuthority(
      state.outbox,
      authorityTransitionKey,
      authorityTransitionEpoch,
      options,
    );
    if (advanced.result.status === 'authority-current') return true;
    const storeMeta = wipeStoreMeta(state.storeMeta, { randomBytes });
    if (storeMeta === null) return false;
    state.entries.clear();
    state.reactBindingReceipt = null;
    state.materializations.clear();
    state.pageSets.clear();
    state.memberships.clear();
    state.outbox = advanced.state;
    state.storeMeta = storeMeta;
    return true;
  };
  const authorityTransitionWipeWithinDispatch = async (
    authorityTransitionKey = null,
    authorityTransitionEpoch = null,
    options = undefined,
  ) => {
    requireOpen();
    if (state.writer === instance) {
      return commitAuthorityTransitionAsWriter(
        authorityTransitionKey,
        authorityTransitionEpoch,
        options,
      );
    }
    // Main's external-bearer contract needs the follower to report refusal so
    // its caller installs a predecessor fence before waking the writer. Keyed
    // coordinator transitions retain the lane's direct same-backing broker.
    if (authorityTransitionKey === null) return false;
    const request = state.authorityTransitionWipers.get(state.writer);
    if (typeof request !== 'function') return false;
    return request(authorityTransitionKey, authorityTransitionEpoch, options);
  };
  state.authorityTransitionWipers ??= new Map();
  state.authorityTransitionWipers.set(instance, (...args) => (
    commitAuthorityTransitionAsWriter(...args)
  ));
  state.offlineReplayCapabilityObservers ??= new Map();
  state.offlineReplayCapabilityCommitters ??= new Map();
  const beginOfflineReplayCapabilityObservationAsWriter = async () => {
    if (!requireWriter()) return false;
    const allocated = allocateOfflineMutationReplayCapabilityObservationInMeta(
      state.storeMeta,
    );
    if (allocated === null) {
      const error = new Error(
        'SNAPBACK_RQS_STORE_CORRUPT: refusing invalid offline replay capability observation',
      );
      error.code = 'SNAPBACK_RQS_STORE_CORRUPT';
      throw error;
    }
    state.storeMeta = allocated.meta;
    return allocated.observation;
  };
  const commitOfflineReplayCapabilityAsWriter = async (fact, observation = null) => {
    if (!requireWriter()) return false;
    if (observation === false) return false;
    let workingMeta = state.storeMeta;
    let preparedObservation = prepareOfflineMutationReplayCapabilityObservation(observation);
    if (preparedObservation === null) {
      const allocated = allocateOfflineMutationReplayCapabilityObservationInMeta(workingMeta);
      if (allocated === null) return false;
      workingMeta = allocated.meta;
      preparedObservation = allocated.observation;
    }
    if (
      preparedObservation.requestSequence
      > workingMeta.generationCounters.offlineReplayCapabilityRequestHighWater
    ) return false;
    const versioned = compareAndVersionOfflineMutationReplayCapabilityFact(
      state.storeMeta.offlineMutationReplayCapabilityFact,
      fact,
      preparedObservation,
    );
    if (versioned?.committed === false) return false;
    const replacement = versioned === null ? null : prepareStoreMeta({
      ...workingMeta,
      offlineMutationReplayCapabilityFact: versioned.fact,
    });
    if (replacement === null) {
      const error = new Error(
        'SNAPBACK_RQS_STORE_CORRUPT: refusing invalid offline replay capability fact',
      );
      error.code = 'SNAPBACK_RQS_STORE_CORRUPT';
      throw error;
    }
    state.storeMeta = replacement;
    return structuredClone(versioned.fact);
  };
  state.offlineReplayCapabilityObservers.set(
    instance,
    beginOfflineReplayCapabilityObservationAsWriter,
  );
  state.offlineReplayCapabilityCommitters.set(
    instance,
    commitOfflineReplayCapabilityAsWriter,
  );
  // @ref LLP 0053#client-fences — a public wipe cannot advance the shared
  // generation while predecessor authorization dispatch remains in flight.
  const authorityTransitionWipe = (...args) => withAuthorizationDispatch(
    () => authorityTransitionWipeWithinDispatch(...args),
  );

  // @ref LLP 0166#d6--resume-delta-and-the-shipped-rqs-machinery — legacy
  // entries, outbox, and QMK sections share the adoption commit domain.
  const materializationTransaction = (mode, operation) => import(
    './materialization-store-runtime.mjs'
  ).then(({ memoryMaterializationTransaction }) => memoryMaterializationTransaction([
    mode, operation, requireOpen, state, instance,
  ]));

  return {
    /// One process-local backing mirrors the durable carriers' single-writer
    /// domain while remaining honestly volatile across process restart.
    isWriter() {
      return !closed && state.writer === instance;
    },

    whenLockSettled() {
      return ownership;
    },

    withOutboxAuthorizationDispatch(operation, options = undefined) {
      return withAuthorizationDispatch(operation, options);
    },

    // @ref LLP 0218#43-the-platform-owned-drain — lock takeover is a level
    //   wake for pending durable work; listeners observe role changes only.
    subscribeWriterLock(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('subscribeWriterLock requires a listener function');
      }
      writerLockListeners.add(listener);
      return () => writerLockListeners.delete(listener);
    },

    /// Degradation-mode capability fact (DK-9: capability reports name the
    /// store implementation and degradation mode in force).
    durability() {
      return { implementation: 'memory', durable: false };
    },

    materializationTransaction,

    async outboxEmpty() {
      requireOpen();
      if (relaunchOutboxEmpty !== null && (await relaunchOutboxEmpty()) !== true) return false;
      return unresolvedOutboxRecords(state.outbox).length === 0
        && outboxAuthorizationStatus(state.outbox).suspended === false;
    },

    async loadReactBindingReceipt() {
      requireOpen();
      return state.reactBindingReceipt === null
        ? null
        : structuredClone(state.reactBindingReceipt);
    },

    async commitReactBindingReceipt(receipt) {
      if (!requireWriter()) return false;
      const stored = prepareReactBindingReceipt(receipt);
      if (stored === null) return false;
      state.reactBindingReceipt = stored;
      return true;
    },

    async readOfflineMutationReplayCapabilityFact() {
      requireOpen();
      const meta = prepareStoreMeta(state.storeMeta);
      if (meta === null) {
        const error = new Error('SNAPBACK_RQS_STORE_CORRUPT: RQS store metadata is invalid');
        error.code = 'SNAPBACK_RQS_STORE_CORRUPT';
        throw error;
      }
      return structuredClone(meta.offlineMutationReplayCapabilityFact);
    },

    async beginOfflineMutationReplayCapabilityObservation() {
      requireOpen();
      if (state.writer === instance) {
        return beginOfflineReplayCapabilityObservationAsWriter();
      }
      const request = state.offlineReplayCapabilityObservers.get(state.writer);
      if (typeof request !== 'function') return false;
      return request();
    },

    async commitOfflineMutationReplayCapabilityFact(fact, observation = null) {
      requireOpen();
      if (state.writer === instance) {
        return commitOfflineReplayCapabilityAsWriter(fact, observation);
      }
      const request = state.offlineReplayCapabilityCommitters.get(state.writer);
      if (typeof request !== 'function') return false;
      return request(fact, observation);
    },

    async readStoreMeta() {
      requireOpen();
      const meta = prepareStoreMeta(state.storeMeta);
      if (meta === null) {
        const error = new Error('SNAPBACK_RQS_STORE_CORRUPT: RQS store metadata is invalid');
        error.code = 'SNAPBACK_RQS_STORE_CORRUPT';
        throw error;
      }
      return meta;
    },

    async writeStoreMeta(value) {
      if (!requireWriter()) return false;
      const replacement = prepareStoreMeta(value);
      if (replacement === null) {
        const error = new Error('SNAPBACK_RQS_STORE_CORRUPT: refusing invalid RQS store metadata');
        error.code = 'SNAPBACK_RQS_STORE_CORRUPT';
        throw error;
      }
      if (
        replacement.clientStoreId !== state.storeMeta.clientStoreId
        || replacement.queryInstanceIdHighWater < state.storeMeta.queryInstanceIdHighWater
        || [
          'writerGeneration',
          'authorityGenerationHighWater',
          'queryGenerationHighWater',
          'offlineReplayCapabilityRequestHighWater',
        ].some((field) => (
          replacement.generationCounters[field] < state.storeMeta.generationCounters[field]
        ))
      ) {
        const error = new Error(
          'SNAPBACK_RQS_STORE_META_REGRESSION: store metadata cannot rotate identity or lower monotone high-waters',
        );
        error.code = 'SNAPBACK_RQS_STORE_META_REGRESSION';
        throw error;
      }
      state.storeMeta = replacement;
      return true;
    },

    async allocateQueryInstanceId() {
      if (!requireWriter()) return null;
      const allocated = allocateQueryInstanceIdInMeta(state.storeMeta);
      if (allocated === null) {
        const error = new Error('SNAPBACK_RQS_STORE_CORRUPT: RQS store metadata is invalid');
        error.code = 'SNAPBACK_RQS_STORE_CORRUPT';
        throw error;
      }
      state.storeMeta = allocated.meta;
      return allocated.queryInstanceId;
    },

    async load(key) {
      requireOpen();
      if (typeof key !== 'string' || key.length === 0) return null;
      const record = state.entries.get(key);
      return record === undefined ? null : structuredClone(record);
    },

    async commit(key, { rows, meta, token }) {
      if (!requireWriter()) return { persisted: false, reason: 'not_writer' };
      if (typeof key !== 'string' || key.length === 0) return { persisted: false, reason: 'key' };
      const bytes = rqsEntryRecordBytes({ rows, meta, token });
      if (bytes > maxBytes) {
        state.entries.delete(key);
        return { persisted: false, reason: 'oversize' };
      }
      const existing = state.entries.get(key);
      state.entries.set(key, structuredClone({
        rows,
        meta,
        token,
        bytes,
        savedAt: now(),
        resumedAt: existing?.resumedAt ?? 0,
        inProgress: false,
      }));
      const evicted = [];
      let totalBytes = [...state.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
      const evictable = [...state.entries.entries()]
        .filter(([candidateKey]) => candidateKey !== key)
        .map(([candidateKey, entry]) => ({ key: candidateKey, ...entry }))
        .sort(rqsEvictionOrder);
      while ((totalBytes > maxBytes || state.entries.size > maxEntries) && evictable.length > 0) {
        const victim = evictable.shift();
        state.entries.delete(victim.key);
        totalBytes -= victim.bytes;
        evicted.push(victim.key);
      }
      return { persisted: true, reason: null, bytes, evicted };
    },

    async markInProgress(key) {
      if (!requireWriter()) return false;
      const existing = state.entries.get(key);
      if (existing === undefined) return false;
      state.entries.set(key, { ...existing, inProgress: true });
      return true;
    },

    async markResumed(key, at = now()) {
      if (!requireWriter()) return false;
      const existing = state.entries.get(key);
      if (existing === undefined) return false;
      state.entries.set(key, { ...existing, resumedAt: at });
      return true;
    },

    async remove(key) {
      if (!requireWriter()) return false;
      state.entries.delete(key);
      return true;
    },

    /// User-switch wipe (LLP 0053 semantics): retained entries AND the
    /// queued-intent outbox — another identity must never replay this one's
    /// queued mutations.
    async wipe() {
      if (!requireWriter()) return false;
      const storeMeta = wipeStoreMeta(state.storeMeta, { randomBytes });
      if (storeMeta === null) return false;
      state.entries.clear();
      state.outbox = emptyOutboxState();
      state.reactBindingReceipt = null;
      state.materializations.clear();
      state.pageSets.clear();
      state.memberships.clear();
      state.storeMeta = storeMeta;
      return true;
    },

    /// AuthCoordinator transitions clear retained/read projections while the
    /// per-record LLP 0043 custody matrix keeps ownership of outbox bytes.
    wipeForAuthorityTransition: authorityTransitionWipe,

    wipeForAuthorityTransitionWithinDispatch: authorityTransitionWipeWithinDispatch,

    requestAuthorityTransitionWipe(...args) {
      requireOpen();
      const request = state.authorityTransitionWipers.get(state.writer);
      if (typeof request !== 'function') return null;
      return Object.freeze({
        settlement: withAuthorizationDispatch(() => request(...args)),
      });
    },

    async resetCorruptStoreIdentity() {
      if (!requireWriter()) return { reset: false, reason: 'not_writer' };
      if (prepareStoreMeta(state.storeMeta) !== null) {
        return { reset: false, reason: 'not_corrupt' };
      }
      const previousClientStoreId = state.storeMeta?.clientStoreId ?? clientStoreId;
      const nextClientStoreId = mintClientStoreId(randomBytes);
      await onBeforeStoreIdentityRotation?.({
        carrier: 'memory',
        previousClientStoreId,
        nextClientStoreId,
      });
      state.entries.clear();
      state.outbox = emptyOutboxState();
      state.reactBindingReceipt = null;
      state.materializations.clear();
      state.pageSets.clear();
      state.memberships.clear();
      state.storeMeta = createInitialStoreMeta({
        clientStoreId: nextClientStoreId,
        randomBytes,
      });
      return { reset: true, previousClientStoreId, clientStoreId: nextClientStoreId };
    },

    // ---- LLP 0043 M2 outbox ----

    async outboxEnqueue(record, expectedAuthorizationFence = null) {
      if (!requireWriter()) throw outboxNotWriterError();
      const applied = outboxOps.enqueue(
        state.outbox,
        record,
        now(),
        expectedAuthorizationFence,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxEnqueueWithOperationIdentity(
      record,
      authorityCohortKey,
      range = null,
      expectedAuthorizationFence = null,
    ) {
      if (!requireWriter()) throw outboxNotWriterError();
      const applied = outboxOps.enqueueWithOperationIdentity(
        state.outbox,
        record,
        now(),
        authorityCohortKey,
        range,
        expectedAuthorizationFence,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxAssignOperationIdentity(
      id,
      authorityCohortKey,
      range = null,
      authorityDescriptor = undefined,
      authorityPrincipalId = undefined,
      expectedAuthorizationFence = null,
    ) {
      if (!requireWriter()) return false;
      const applied = outboxOps.assignOperationIdentity(
        state.outbox,
        id,
        now(),
        authorityCohortKey,
        range,
        authorityDescriptor,
        authorityPrincipalId,
        expectedAuthorizationFence,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxOperationIdentityRange(authorityCohortKey) {
      requireOpen();
      return structuredClone(
        outboxOps.operationIdentityRange(state.outbox, authorityCohortKey).result,
      );
    },

    async outboxPending() {
      requireOpen();
      return structuredClone(pendingOutboxRecords(state.outbox));
    },

    async outboxAuthorizationStatus() {
      requireOpen();
      return structuredClone(outboxAuthorizationStatus(state.outbox));
    },

    async outboxAuthorizationTransitionVisible(
      kind,
      payload,
      expectedAuthorityGeneration = null,
    ) {
      requireOpen();
      return outboxOps.authorizationTransitionVisible(
        state.outbox,
        kind,
        payload,
        expectedAuthorityGeneration,
      ).result;
    },

    async outboxApplyAuthorizationObligation(obligation, expectedAuthorityGeneration = null) {
      requireOpen();
      const applied = outboxOps.applyAuthorizationObligation(
        state.outbox,
        obligation,
        expectedAuthorityGeneration,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxResolveAuthorizationObligation(resolution, expectedAuthorityGeneration = null) {
      requireOpen();
      const applied = outboxOps.resolveAuthorizationObligation(
        state.outbox,
        resolution,
        expectedAuthorityGeneration,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxAcknowledgeAuthorizationResolution(
      resolution,
      expectedAuthorityGeneration = null,
    ) {
      requireOpen();
      const applied = outboxOps.acknowledgeAuthorizationResolution(
        state.outbox,
        resolution,
        expectedAuthorityGeneration,
      );
      state.outbox = applied.state;
      return applied.result;
    },

    async outboxRetireAuthorizationScopes(scopes, expectedAuthorityGeneration = null) {
      requireOpen();
      const applied = outboxOps.retireAuthorizationScopes(
        state.outbox,
        scopes,
        expectedAuthorityGeneration,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxPrepareSubmission(id, options = undefined) {
      if (!requireWriter()) return false;
      const applied = outboxOps.prepareSubmission(
        state.outbox,
        id,
        { ...(options ?? {}), now: now() },
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxRecords() {
      requireOpen();
      return structuredClone(allOutboxRecords(state.outbox));
    },

    async outboxQuarantinedRecordTargets() {
      requireOpen();
      return structuredClone(quarantinedOutboxRecordTargets(state.outbox));
    },

    async outboxSettle(id, expectedAuthorizationFence = null) {
      if (!requireWriter()) return false;
      const applied = outboxOps.settle(state.outbox, id, expectedAuthorizationFence);
      state.outbox = applied.state;
      return applied.result;
    },

    async outboxDurablyConsume(
      id,
      settlement,
      userId = null,
      confirmedAcknowledgements = [],
      expectedAuthorizationFence = null,
    ) {
      if (!requireWriter()) return false;
      const applied = outboxOps.durablyConsume(
        state.outbox,
        id,
        settlement,
        userId,
        now(),
        confirmedAcknowledgements,
        expectedAuthorizationFence,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxMarkFailed(id, failure, expectedAuthorizationFence = null) {
      if (!requireWriter()) return false;
      const applied = outboxOps.markFailed(
        state.outbox,
        id,
        failure,
        expectedAuthorizationFence,
      );
      state.outbox = applied.state;
      return applied.result;
    },

    async outboxMarkStranded(
      id,
      reason,
      predecessorPrincipalScope = null,
      expectedAuthorizationFence = null,
      effectProvenance = null,
    ) {
      if (!requireWriter()) return false;
      const applied = outboxOps.markStranded(
        state.outbox,
        id,
        reason,
        now(),
        predecessorPrincipalScope,
        expectedAuthorizationFence,
        effectProvenance,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxReconcileCustody(
      principalScope,
      authorityDescriptor,
      custody,
      expectedAuthorityGeneration = null,
    ) {
      requireOpen();
      const applied = outboxOps.reconcileCustody(
        state.outbox,
        principalScope,
        authorityDescriptor,
        custody,
        now(),
        expectedAuthorityGeneration,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxReconcileCustodyRecords(
      recordIds,
      principalScope,
      authorityDescriptor,
      custody,
      expectedAuthorityGeneration = null,
    ) {
      requireOpen();
      const applied = outboxOps.reconcileCustody(
        state.outbox,
        principalScope,
        authorityDescriptor,
        custody,
        now(),
        expectedAuthorityGeneration,
        recordIds,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxDiscardStranded(ids, principalScope, expectedAuthorizationFence = null) {
      if (!requireWriter()) return false;
      const applied = outboxOps.discardStranded(
        state.outbox,
        ids,
        principalScope,
        expectedAuthorizationFence,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxMarkQuarantined(id, refusal, expectedAuthorizationFence = null) {
      if (!requireWriter()) return false;
      const applied = outboxOps.markQuarantined(
        state.outbox,
        id,
        refusal,
        now(),
        expectedAuthorizationFence,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxReenterQuarantined(expectedAuthorizationFence = null, recordIds = null) {
      if (!requireWriter()) return false;
      const applied = outboxOps.reenterQuarantined(
        state.outbox,
        expectedAuthorizationFence,
        recordIds,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxMarkResultGone(id, resultGone, expectedAuthorizationFence = null) {
      if (!requireWriter()) return false;
      const applied = outboxOps.markResultGone(
        state.outbox,
        id,
        resultGone,
        expectedAuthorizationFence,
      );
      state.outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxDiscard(id, expectedAuthorizationFence = null) {
      if (!requireWriter()) return false;
      const applied = outboxOps.discard(state.outbox, id, expectedAuthorizationFence);
      state.outbox = applied.state;
      return applied.result;
    },

    async outboxDiscardPendingInsertion(
      id,
      insertionSequence,
      expectedAuthorizationFence = null,
    ) {
      if (!requireWriter()) return false;
      const applied = outboxOps.discardPendingInsertion(
        state.outbox,
        id,
        insertionSequence,
        expectedAuthorizationFence,
      );
      state.outbox = applied.state;
      return applied.result;
    },

    async outboxRecordAcknowledgement(id, userId = null, authorityDescriptor = null) {
      if (!requireWriter()) return false;
      const applied = outboxOps.recordAck(state.outbox, id, userId, authorityDescriptor);
      state.outbox = applied.state;
      return applied.result;
    },

    async outboxPendingAcknowledgements(
      userId = null,
      limit = 64,
      authorityDescriptor = null,
      enqueueTarget = undefined,
    ) {
      requireOpen();
      return pendingAcknowledgementsFor(
        state.outbox,
        userId,
        limit,
        authorityDescriptor,
        enqueueTarget,
      );
    },

    async outboxMarkAcknowledgementsReady(ids, userId = undefined, authorityDescriptor = undefined) {
      if (!requireWriter()) return false;
      const applied = outboxOps.markAcksReady(state.outbox, ids, userId, authorityDescriptor);
      state.outbox = applied.state;
      return applied.result;
    },

    async outboxConfirmAcknowledgements(
      ids,
      userId = undefined,
      authorityDescriptor = undefined,
      expectedAuthorizationFence = null,
      enqueueTarget = undefined,
    ) {
      if (!requireWriter()) return false;
      const applied = outboxOps.confirmAcks(
        state.outbox,
        ids,
        userId,
        authorityDescriptor,
        expectedAuthorizationFence,
        enqueueTarget,
      );
      state.outbox = applied.state;
      return applied.result;
    },

    async inspection() {
      requireOpen();
      const all = [...state.entries.values()];
      return Object.freeze({
        writer: this.isWriter(),
        entries: state.entries.size,
        bytes: all.reduce((sum, entry) => sum + entry.bytes, 0),
        maxBytes,
        maxEntries,
        outbox: Object.freeze({
          pending: pendingOutboxRecords(state.outbox).length,
          failed: allOutboxRecords(state.outbox).filter((r) => r.status === 'failed').length,
          stranded: allOutboxRecords(state.outbox)
            .filter((r) => r.status === 'stranded').length,
          quarantined: allOutboxRecords(state.outbox)
            .filter((r) => r.status === 'quarantined').length,
          resultGone: allOutboxRecords(state.outbox)
            .filter((r) => r.status === 'result-gone').length,
          pendingAcknowledgements: state.outbox.acks.length,
        }),
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      state.authorityTransitionWipers.delete(instance);
      state.offlineReplayCapabilityObservers.delete(instance);
      state.offlineReplayCapabilityCommitters.delete(instance);
      if (state.writer !== instance) {
        writerLockListeners.clear();
        return;
      }
      // Match the asynchronous handoff cut of Web Locks/file locks so work
      // already queued by the closing owner settles before a successor can
      // publish through the shared volatile domain.
      await new Promise((resolve) => setTimeout(resolve, 0));
      state.writer = null;
      notifyWriterLock(false);
      while (state.waiters.length > 0) {
        const next = state.waiters.shift();
        if (next.closed()) continue;
        state.writer = next.instance;
        next.resolve();
        next.notify?.(true);
        break;
      }
      writerLockListeners.clear();
    },
  };
}

/// Process-local domain used when callers need independently constructed
/// memory contexts to share one volatile store (for example, the S4 carrier
/// parity suite). The object is deliberately opaque outside this module.
export function createMemoryRqsStoreBacking({ clientStoreId = null, randomBytes = undefined } = {}) {
  return {
    entries: new Map(),
    outbox: emptyOutboxState(),
    reactBindingReceipt: null,
    materializations: new Map(),
    pageSets: new Map(),
    memberships: new Map(),
    storeMeta: createInitialStoreMeta({ clientStoreId, randomBytes }),
    writer: null,
    waiters: [],
    authorizationDispatchGate: createOutboxAuthorizationDispatchGate(),
    authorityTransitionWipers: new Map(),
    offlineReplayCapabilityObservers: new Map(),
    offlineReplayCapabilityCommitters: new Map(),
  };
}

// The not-writer error is constructed here so arm-specific stores share one
// exact refusal shape; a shared memory domain elects one process-local writer.
export { outboxNotWriterError };
