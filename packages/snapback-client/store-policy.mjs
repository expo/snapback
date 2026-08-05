// LLP 0166 D3/D5 lifecycle, materialization-budget, and policy inspection.
// Owner state is input-only here: this module never invents or weakens an
// LLP 0053 transition, and compaction uses L2's compactPayload operation.

import {
  decodeMaterializationRecordV1,
} from './materialization-store.mjs';
import { BROKER_LIMITS } from './demand-broker.mjs';
import {
  RQS_STORE_MAX_BYTES,
  RQS_STORE_MAX_ENTRIES,
} from './rqs-store.mjs';
import { jcsBytes } from './rqs.mjs';

export const STORE_POLICY_CONSTANTS = Object.freeze({
  materializationByteCeiling: 32 * 1024 * 1024,
  materializationRecordCeiling: 256,
  materializationFragmentCeiling: 1_024,
  durableRegistrationCeiling: 512,
  registrationByteCeiling: 16 * 1024,
  graceDefaultMs: 1_209_600_000,
  establishmentConcurrency: 4,
  ...BROKER_LIMITS,
});

const clone = (value) => structuredClone(value);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownerContextKind = (registration) => registration?.ownerContext?.kind ?? null;
const rank = { none: 0, default: 1, pinned: 2 };

function unsignedUtf8Compare(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function materializationPayloadProjection(recordInput) {
  const record = recordInput?.format === 'snapback.materialization-record.v1'
    && recordInput.fragments?.every((fragment) => fragment.bytes instanceof Uint8Array)
    ? recordInput
    : decodeMaterializationRecordV1(recordInput);
  if (record === null) throw new TypeError('materialization payload projection requires a valid record');
  const fragmentBytes = record.fragments.reduce((sum, fragment) => (
    sum + fragment.bytes.length + jcsBytes(fragment.proof).length
  ), 0);
  const manifestBytes = record.pageSets.reduce((sum, manifest) => sum + jcsBytes(manifest).length, 0);
  const membershipBytes = record.memberships.reduce((sum, membership) => sum + jcsBytes(membership).length, 0);
  return Object.freeze({
    logicalBytes: fragmentBytes + manifestBytes + membershipBytes,
    fragmentCount: record.fragments.length,
  });
}

function envelope(records) {
  let logicalBytes = 0;
  let fragmentCount = 0;
  for (const record of records) {
    const projected = materializationPayloadProjection(record);
    logicalBytes += projected.logicalBytes;
    fragmentCount += projected.fragmentCount;
  }
  return { logicalBytes, recordCount: records.length, fragmentCount };
}

function effectivePolicy(registrations) {
  return {
    retentionRequest: registrations.some((entry) => entry.retentionRequest === 'durable')
      ? 'durable' : 'none',
    idleTtlClass: registrations.reduce(
      (best, entry) => rank[entry.idleTtlClass] > rank[best] ? entry.idleTtlClass : best,
      'none',
    ),
    demandState: registrations.some((entry) => entry.source === 'active')
      ? 'demanded-active'
      : registrations.length > 0 ? 'demanded-idle' : 'undemanded',
  };
}

function factRoot(meta) {
  if (!plain(meta.policyBudgetFacts.addresses)) meta.policyBudgetFacts.addresses = {};
  if (!Number.isSafeInteger(meta.policyBudgetFacts.compactionCount)) {
    meta.policyBudgetFacts.compactionCount = 0;
  }
  if (!Number.isSafeInteger(meta.policyBudgetFacts.lastCompactionAt)) {
    meta.policyBudgetFacts.lastCompactionAt = null;
  }
  return meta.policyBudgetFacts;
}

function policyFact(root, addressKey, partition) {
  const prior = root.addresses[addressKey];
  if (plain(prior)) return prior;
  const next = {
    authorityPartitionDigest: partition,
    registrations: [],
    currentPolicy: { retentionRequest: 'none', idleTtlClass: 'none', demandState: 'undemanded' },
    releaseAt: null,
    graceDeadline: null,
    graceActive: false,
    pendingSuppressionRelease: false,
    pinnedRetentionRequest: null,
    pinnedIdleTtlClass: null,
    lastEstablishmentAt: null,
    blockers: [],
    reclaimPending: false,
  };
  root.addresses[addressKey] = next;
  return next;
}

function redactedRegistration(entry) {
  return {
    registrationId: entry.registrationId,
    source: entry.source,
    ownerContextKind: ownerContextKind(entry),
  };
}

function fence(record) {
  return {
    queryInstanceId: record.queryInstanceId,
    authorityGeneration: record.authorityState.authority_generation,
    queryGeneration: record.authorityState.query_generation,
  };
}

function materializationKey(record) {
  return record.address[2];
}

function ownerAllowsCustodyPolicy(record) {
  return record.productState.lifecycle === 'active'
    && record.productState.effectiveDisposition === 'retain'
    && record.authorityState.query_lifecycle === 'active'
    && record.authorityState.effective_disposition === 'retain';
}

function storedRegistrations(meta, resolveRegistration) {
  const result = [];
  const durable = Object.values(meta.durableRegistrations).flatMap((slot) => (
    slot?.format === 'snapback.query-registration.v1'
      ? [slot]
      : plain(slot) ? Object.values(slot) : []
  ));
  for (const registration of durable) {
    let resolved = null;
    try { resolved = resolveRegistration?.(clone(registration)) ?? null; } catch { /* invalid owner data is omitted */ }
    const addressKey = resolved?.addressKey ?? registration._resolvedAddressKey;
    const authorityPartitionDigest = resolved?.authorityPartitionDigest
      ?? registration._authorityPartitionDigest;
    if (typeof addressKey === 'string' && typeof authorityPartitionDigest === 'string') {
      result.push({ registration, addressKey, authorityPartitionDigest });
    }
  }
  const broker = plain(meta.brokerRoster) ? meta.brokerRoster : {};
  for (const pair of Object.values(plain(broker.pairs) ? broker.pairs : {})) {
    for (const registration of Array.isArray(pair?.demands) ? pair.demands : []) {
      let resolved = null;
      try { resolved = resolveRegistration?.(clone(registration)) ?? null; } catch { /* refused elsewhere */ }
      if (typeof resolved?.addressKey === 'string') result.push({
        registration,
        addressKey: resolved.addressKey,
        authorityPartitionDigest: resolved.authorityPartitionDigest,
      });
    }
  }
  return result;
}

// @ref LLP 0166#d5--query-lifecycle-ttl-and-eviction — release clocks and
// pressure ordering are durable policy facts; owner state always wins.
export function createStorePolicyController({
  storeHandle,
  materializationStore,
  resolveRegistration = null,
  now = () => Date.now(),
  limits = STORE_POLICY_CONSTANTS,
  getOwnerFacts = () => ({}),
  listLegacyEntries = async () => [],
} = {}) {
  if (typeof storeHandle?.materializationTransaction !== 'function') {
    throw new TypeError('store policy requires a v3 store handle');
  }
  limits = Object.freeze({ ...STORE_POLICY_CONSTANTS, ...limits });

  const updateRegistrationSet = async ({
    addressKey,
    authorityPartitionDigest,
    registrations,
    lastEstablishmentAt = undefined,
    suppressionActive = undefined,
  }) => storeHandle.materializationTransaction('readwrite', (view) => {
    if (typeof addressKey !== 'string' || !Array.isArray(registrations)) {
      throw new TypeError('policy registration snapshot requires addressKey and registrations');
    }
    const root = factRoot(view.storeMeta);
    const fact = policyFact(root, addressKey, authorityPartitionDigest);
    const previous = fact.currentPolicy;
    const next = effectivePolicy(registrations);
    const suppressed = suppressionActive ?? view.storeMeta.brokerRoster?.suppression?.active === true;
    if (previous.demandState !== 'undemanded' && next.demandState === 'undemanded') {
      fact.pinnedRetentionRequest = previous.retentionRequest;
      fact.pinnedIdleTtlClass = previous.idleTtlClass;
      fact.releaseAt = suppressed ? null : now();
      fact.pendingSuppressionRelease = suppressed;
      fact.graceDeadline = suppressed || previous.idleTtlClass === 'pinned'
        ? null
        : fact.releaseAt + (previous.idleTtlClass === 'default' ? limits.graceDefaultMs : 0);
      fact.graceActive = true;
    } else if (next.demandState !== 'undemanded') {
      fact.releaseAt = null;
      fact.graceDeadline = null;
      fact.graceActive = false;
      fact.pendingSuppressionRelease = false;
      fact.pinnedRetentionRequest = null;
      fact.pinnedIdleTtlClass = null;
    }
    fact.authorityPartitionDigest = authorityPartitionDigest;
    fact.registrations = registrations.map(redactedRegistration);
    fact.currentPolicy = next;
    fact.registrationSnapshotAuthoritative = true;
    if (lastEstablishmentAt !== undefined) fact.lastEstablishmentAt = lastEstablishmentAt;
    return clone(fact);
  });

  const synchronizeFacts = async () => storeHandle.materializationTransaction('readwrite', (view) => {
    const root = factRoot(view.storeMeta);
    const grouped = new Map();
    for (const entry of storedRegistrations(view.storeMeta, resolveRegistration)) {
      const bucket = grouped.get(entry.addressKey) ?? {
        partition: entry.authorityPartitionDigest, registrations: [],
      };
      bucket.registrations.push(entry.registration);
      grouped.set(entry.addressKey, bucket);
    }
    const records = [...view.materializations.values()]
      .map((stored) => decodeMaterializationRecordV1(stored))
      .filter((record) => record !== null);
    const recordKeys = new Set(records.map(materializationKey));
    for (const record of records) {
      const addressKey = materializationKey(record);
      const fact = policyFact(root, addressKey, record.authorityPartitionDigest);
      if (fact.registrationSnapshotAuthoritative === true) continue;
      const bucket = grouped.get(addressKey) ?? {
        partition: record.authorityPartitionDigest, registrations: [],
      };
      const next = effectivePolicy(bucket.registrations);
      const prior = fact.currentPolicy;
      const suppressed = view.storeMeta.brokerRoster?.suppression?.active === true;
      if (prior.demandState !== 'undemanded' && next.demandState === 'undemanded') {
        fact.pinnedRetentionRequest = prior.retentionRequest;
        fact.pinnedIdleTtlClass = prior.idleTtlClass;
        fact.releaseAt = suppressed ? null : now();
        fact.pendingSuppressionRelease = suppressed;
        fact.graceDeadline = suppressed || prior.idleTtlClass === 'pinned'
          ? null
          : fact.releaseAt + (prior.idleTtlClass === 'default' ? limits.graceDefaultMs : 0);
        fact.graceActive = true;
      }
      if (next.demandState !== 'undemanded') {
        fact.releaseAt = null;
        fact.graceDeadline = null;
        fact.graceActive = false;
        fact.pendingSuppressionRelease = false;
        fact.pinnedRetentionRequest = null;
        fact.pinnedIdleTtlClass = null;
      }
      fact.registrations = bucket.registrations.map(redactedRegistration);
      fact.currentPolicy = next;
    }
    if (view.storeMeta.brokerRoster?.suppression?.active !== true) {
      for (const fact of Object.values(root.addresses)) {
        if (!fact.pendingSuppressionRelease) continue;
        fact.releaseAt = now();
        fact.pendingSuppressionRelease = false;
        fact.graceDeadline = fact.pinnedIdleTtlClass === 'pinned'
          ? null
          : fact.releaseAt + (fact.pinnedIdleTtlClass === 'default' ? limits.graceDefaultMs : 0);
      }
    }
    for (const [addressKey, fact] of Object.entries(root.addresses)) {
      if (
        !recordKeys.has(addressKey)
        && !grouped.has(addressKey)
        && fact.graceActive !== true
        && fact.pendingSuppressionRelease !== true
      ) delete root.addresses[addressKey];
    }
  });

  const blockersFor = async (record) => {
    const facts = await getOwnerFacts(clone(record)) ?? {};
    const blockers = [];
    let pendingOutbox = record.outboxEntryIds.length > 0;
    if (pendingOutbox && typeof storeHandle.outboxRecords === 'function') {
      const pending = await storeHandle.outboxRecords();
      const live = new Set(pending.filter((entry) => entry.status !== 'settled').map((entry) => entry.id));
      pendingOutbox = record.outboxEntryIds.some((id) => live.has(id));
    }
    if (pendingOutbox) blockers.push('pending-intent');
    if (facts.obligationRequiresPayload === true) blockers.push('obligation');
    if (record.settlementIds.length > 0 || facts.settlementDependency === true) {
      blockers.push('settlement-dependency');
    }
    return blockers;
  };

  const compact = async (record, reason) => {
    const hasPayload = record.fragments.length > 0
      || record.pageSets.length > 0
      || record.memberships.length > 0;
    if (hasPayload) {
      if (typeof materializationStore?.compactPayload !== 'function') {
        throw new TypeError('policy compaction requires L2 materializationStore.compactPayload');
      }
      await materializationStore.compactPayload(record.address, fence(record));
    }
    await storeHandle.materializationTransaction('readwrite', (view) => {
      const root = factRoot(view.storeMeta);
      const fact = policyFact(root, materializationKey(record), record.authorityPartitionDigest);
      fact.lastCompactionReason = reason;
      fact.reclaimPending = false;
      fact.graceActive = false;
      fact.blockers = [];
      if (hasPayload) {
        root.compactionCount += 1;
        root.lastCompactionAt = now();
      }
    });
    return hasPayload;
  };

  const snapshot = async () => storeHandle.materializationTransaction('readonly', (view) => {
    const root = factRoot(view.storeMeta);
    return {
      meta: clone(view.storeMeta),
      facts: clone(root),
      records: [...view.materializations.values()]
        .map((stored) => decodeMaterializationRecordV1(stored))
        .filter((record) => record !== null),
    };
  });

  const maintenance = async () => {
    await synchronizeFacts();
    let state = await snapshot();
    if (state.meta.brokerRoster?.suppression?.active === true) {
      return { compacted: [], refused: false, suppressionActive: true };
    }
    const compacted = [];
    for (const record of state.records) {
      if (!ownerAllowsCustodyPolicy(record)) continue;
      const fact = state.facts.addresses[materializationKey(record)];
      if (!fact) continue;
      const blockers = await blockersFor(record);
      const graceExpired = fact.currentPolicy.demandState === 'undemanded'
        && fact.graceActive
        && fact.pinnedIdleTtlClass !== 'pinned'
        && fact.graceDeadline !== null
        && now() >= fact.graceDeadline;
      const durableDowngrade = (
        fact.currentPolicy.demandState !== 'undemanded'
        && fact.currentPolicy.retentionRequest === 'none'
      ) || (
        fact.currentPolicy.demandState === 'undemanded'
        && fact.graceActive
        && fact.pinnedRetentionRequest === 'none'
      );
      const reclaim = graceExpired || durableDowngrade || fact.reclaimPending;
      await storeHandle.materializationTransaction('readwrite', (view) => {
        const current = policyFact(factRoot(view.storeMeta), materializationKey(record), record.authorityPartitionDigest);
        current.blockers = blockers;
        if (reclaim && blockers.length > 0) {
          current.reclaimPending = true;
          current.graceActive = false;
        }
      });
      if (reclaim && blockers.length === 0 && await compact(record, graceExpired ? 'grace-gc' : 'retention-downgrade')) {
        compacted.push(materializationKey(record));
      }
    }

    state = await snapshot();
    let usage = envelope(state.records);
    const over = () => usage.logicalBytes > limits.materializationByteCeiling
      || usage.recordCount > limits.materializationRecordCeiling
      || usage.fragmentCount > limits.materializationFragmentCeiling;
    if (over()) {
      const candidates = [];
      for (const record of state.records) {
        const key = materializationKey(record);
        const fact = state.facts.addresses[key] ?? policyFact(state.facts, key, record.authorityPartitionDigest);
        if (!ownerAllowsCustodyPolicy(record) || fact.currentPolicy.demandState === 'demanded-active') continue;
        const blockers = await blockersFor(record);
        await storeHandle.materializationTransaction('readwrite', (view) => {
          policyFact(factRoot(view.storeMeta), key, record.authorityPartitionDigest).blockers = blockers;
        });
        if (blockers.length > 0) continue;
        let step;
        let primary;
        if (fact.currentPolicy.demandState === 'undemanded' && fact.pinnedIdleTtlClass !== 'pinned') {
          step = 1; primary = fact.releaseAt ?? Number.MAX_SAFE_INTEGER;
        } else if (fact.currentPolicy.demandState === 'demanded-idle'
          && fact.currentPolicy.idleTtlClass !== 'pinned') {
          step = 2; primary = fact.lastEstablishmentAt ?? 0;
        } else if (fact.pinnedIdleTtlClass === 'pinned'
          || fact.currentPolicy.idleTtlClass === 'pinned') {
          step = 3; primary = fact.lastEstablishmentAt ?? 0;
        } else continue;
        candidates.push({ record, key, step, primary });
      }
      candidates.sort((a, b) => a.step - b.step
        || a.primary - b.primary
        || unsignedUtf8Compare(a.key, b.key));
      for (const candidate of candidates) {
        if (!over()) break;
        if (await compact(candidate.record, `budget-step-${candidate.step}`)) {
          compacted.push(candidate.key);
          const projected = materializationPayloadProjection(candidate.record);
          usage.logicalBytes -= projected.logicalBytes;
          usage.fragmentCount -= projected.fragmentCount;
        }
      }
    }
    return { compacted, refused: over(), suppressionActive: false };
  };

  const inspection = async ({ authorityPartitionDigest }) => {
    // The projection is read-only and is available to every context. Only the
    // writer may refresh durable derived facts before taking the snapshot;
    // readers consume the last writer-published policy state.
    if (storeHandle.isWriter?.() === true) await synchronizeFacts();
    const state = await snapshot();
    const legacyEntries = await listLegacyEntries();
    const legacy = legacyEntries.filter((entry) => entry.authorityPartitionDigest === authorityPartitionDigest);
    const legacyInspection = typeof storeHandle.inspection === 'function'
      ? await storeHandle.inspection()
      : { bytes: legacy.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0), entries: legacy.length };
    const materializations = state.records.filter((record) => (
      record.authorityPartitionDigest === authorityPartitionDigest
    ));
    const materializationUsage = envelope(state.records);
    const broker = plain(state.meta.brokerRoster) ? state.meta.brokerRoster : {};
    const brokerPairs = Object.values(plain(broker.pairs) ? broker.pairs : {});
    const brokerContexts = new Set([
      ...Object.keys(plain(broker.heartbeats) ? broker.heartbeats : {}),
      ...brokerPairs.map((pair) => pair.contextId),
    ]);

    const addresses = [];
    for (const record of materializations) {
      const key = materializationKey(record);
      const fact = state.facts.addresses[key] ?? policyFact(state.facts, key, record.authorityPartitionDigest);
      const registrations = fact.registrations ?? [];
      const blockers = fact.blockers ?? [];
      let retainingReason;
      if (registrations.length > 0) retainingReason = { kind: 'registrations', entries: clone(registrations) };
      else if (fact.graceActive) retainingReason = {
        kind: 'release-grace',
        graceDeadline: fact.pinnedIdleTtlClass === 'pinned' ? null : fact.graceDeadline,
      };
      else if (blockers.length > 0) retainingReason = { kind: 'safety-blocker', blockers: clone(blockers) };
      else retainingReason = { kind: 'instance-bookkeeping' };
      addresses.push({
        addressKey: key,
        demandState: fact.currentPolicy.demandState,
        effectiveRetentionRequest: fact.currentPolicy.demandState === 'undemanded'
          ? (fact.pinnedRetentionRequest ?? 'none') : fact.currentPolicy.retentionRequest,
        retainingReason,
        effectiveTtlClass: fact.currentPolicy.demandState === 'undemanded'
          ? (fact.pinnedIdleTtlClass ?? 'none') : fact.currentPolicy.idleTtlClass,
        lastEstablishmentAt: fact.lastEstablishmentAt,
        compacted: record.fragments.length === 0 && record.pageSets.length === 0 && record.memberships.length === 0,
      });
    }
    for (const entry of legacy) addresses.push({
      addressKey: entry.addressKey,
      demandState: 'undemanded',
      effectiveRetentionRequest: null,
      retainingReason: { kind: 'grandfathered-legacy-entry' },
      effectiveTtlClass: null,
      lastEstablishmentAt: null,
      compacted: false,
    });
    addresses.sort((a, b) => unsignedUtf8Compare(a.addressKey, b.addressKey));

    return Object.freeze({
      format: 'snapback.store-policy-inspection.v1',
      clientStoreId: state.meta.clientStoreId,
      authorityPartitionDigest,
      budgets: Object.freeze([
        Object.freeze({
          section: 'materializations', ...materializationUsage,
          byteCeiling: limits.materializationByteCeiling,
          recordCeiling: limits.materializationRecordCeiling,
          fragmentCeiling: limits.materializationFragmentCeiling,
          compactionCount: state.facts.compactionCount,
          lastCompactionAt: state.facts.lastCompactionAt,
        }),
        Object.freeze({
          section: 'legacy-entries', logicalBytes: legacyInspection.bytes,
          byteCeiling: RQS_STORE_MAX_BYTES, recordCount: legacyInspection.entries,
          recordCeiling: RQS_STORE_MAX_ENTRIES, fragmentCount: null,
          fragmentCeiling: null, compactionCount: 0, lastCompactionAt: null,
        }),
      ]),
      registrations: Object.freeze({
        durableCount: Object.keys(state.meta.durableRegistrations).length,
        durableCeiling: limits.durableRegistrationCeiling,
        perRecordByteCeiling: limits.registrationByteCeiling,
      }),
      broker: Object.freeze({
        writerGeneration: state.meta.generationCounters.writerGeneration,
        liveContextCount: brokerContexts.size,
        liveContextCeiling: limits.liveContextCeiling,
        livePairCount: brokerPairs.length,
        livePairCeiling: limits.livePairCeiling,
        reapedContextCount: Array.isArray(broker.reapedContexts) ? broker.reapedContexts.length : 0,
        reapedContextCeiling: limits.reapedContextCeiling,
        consumedRequestCount: Array.isArray(broker.consumedRequests) ? broker.consumedRequests.length : 0,
        consumedRequestCeiling: limits.consumedRequestCeiling,
        releasedRegistrationCount: Array.isArray(broker.releasedRegistrations)
          ? broker.releasedRegistrations.length : 0,
        releasedRegistrationCeiling: limits.releasedRegistrationCeiling,
        suppressionActive: broker.suppression?.active === true,
      }),
      constants: Object.freeze({
        graceDefaultMs: limits.graceDefaultMs,
        heartbeatIntervalMs: limits.heartbeatIntervalMs,
        heartbeatExpiryMs: limits.heartbeatExpiryMs,
        establishmentConcurrency: limits.establishmentConcurrency,
        identifierByteCeiling: limits.identifierByteCeiling,
        messageByteCeiling: limits.messageByteCeiling,
      }),
      addresses: Object.freeze(addresses.map(Object.freeze)),
    });
  };

  return Object.freeze({
    updateRegistrationSet,
    synchronizeFacts,
    maintenance,
    inspection,
  });
}
