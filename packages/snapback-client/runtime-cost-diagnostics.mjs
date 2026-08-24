import { positiveDevelopmentEnvironment } from './client-diagnostics.mjs';
import { argsHash } from './rqs.mjs';

const DEFAULT_KEY_CAPACITY = 1_024;
const DEFAULT_WINDOW_MS = 2_000;
const DEFAULT_EQUIVALENT_ENQUEUE_WARNING_THRESHOLD = 8;
const DEFAULT_ASSET_ISSUANCE_WARNING_THRESHOLD = 8;

function positiveInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function finiteWindow(value) {
  if (!Number.isFinite(value) || value < 1) {
    throw new TypeError('windowMs must be a positive finite number');
  }
  return value;
}

function frozenFacts(entries, project) {
  return Object.freeze(
    [...entries.values()]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((entry) => Object.freeze(project(entry))),
  );
}

class BoundedKeyMap {
  constructor(capacity, emptyOther) {
    this.capacity = capacity;
    this.entries = new Map();
    this.other = { ...emptyOther };
    this.evictedKeys = 0;
    this.sequence = 0;
  }

  getOrCreate(key, create, mergeEvicted) {
    this.sequence += 1;
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastObservedSequence = this.sequence;
      return existing;
    }
    if (this.entries.size >= this.capacity) {
      let oldest = null;
      for (const candidate of this.entries.values()) {
        if (oldest === null || candidate.lastObservedSequence < oldest.lastObservedSequence) {
          oldest = candidate;
        }
      }
      if (oldest !== null) {
        this.entries.delete(oldest.key);
        mergeEvicted(this.other, oldest);
        this.evictedKeys += 1;
      }
    }
    const entry = {
      ...create(),
      key,
      lastObservedSequence: this.sequence,
    };
    this.entries.set(key, entry);
    return entry;
  }
}

function emitWarning(channel, event) {
  try { channel?.emit?.(event); } catch { /* warning observation never owns work */ }
}

const EMPTY_SNAPSHOT = Object.freeze({
  enabled: false,
  keyCapacity: DEFAULT_KEY_CAPACITY,
  equivalentEnqueues: Object.freeze({
    facts: Object.freeze([]),
    otherKeys: Object.freeze({ enqueueCount: 0, equivalentEnqueueCount: 0 }),
    evictedKeys: 0,
  }),
  housekeepingSupersessions: Object.freeze({
    facts: Object.freeze([]),
    otherKeys: Object.freeze({ supersededCount: 0 }),
    evictedKeys: 0,
  }),
  duplicateSubscriptions: Object.freeze({
    facts: Object.freeze([]),
    otherKeys: Object.freeze({ registrationCount: 0 }),
    evictedKeys: 0,
  }),
  assetIssuanceMultiplicity: Object.freeze({
    facts: Object.freeze([]),
    otherKeys: Object.freeze({ issuanceCount: 0 }),
    evictedKeys: 0,
  }),
});

/**
 * LLP 0267 §§7.5-7.7 local-only, value-free runtime-cost recorder. Product
 * callers never construct it; the client owns one recorder and React reports
 * framework-minted asset-hook ownership through the client's internal seam.
 *
 * @ref LLP 0267#75-repeated-equivalent-writes-and-effects-bounded-to-what-the-framework-knows
 *   — exact canonical identities, bounded LRU maps, visible overflow, and a
 *   positive local gate keep these warnings observational.
 */
export function createRuntimeCostDiagnostics({
  enabled = positiveDevelopmentEnvironment(),
  diagnosticsChannel = null,
  now = Date.now,
  keyCapacity = DEFAULT_KEY_CAPACITY,
  windowMs = DEFAULT_WINDOW_MS,
  equivalentEnqueueWarningThreshold = DEFAULT_EQUIVALENT_ENQUEUE_WARNING_THRESHOLD,
  assetIssuanceWarningThreshold = DEFAULT_ASSET_ISSUANCE_WARNING_THRESHOLD,
} = {}) {
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const capacity = positiveInteger('keyCapacity', keyCapacity);
  const window = finiteWindow(windowMs);
  const enqueueThreshold = positiveInteger(
    'equivalentEnqueueWarningThreshold',
    equivalentEnqueueWarningThreshold,
  );
  const assetThreshold = positiveInteger(
    'assetIssuanceWarningThreshold',
    assetIssuanceWarningThreshold,
  );
  if (!enabled) {
    const disabledSnapshot = capacity === DEFAULT_KEY_CAPACITY
      ? EMPTY_SNAPSHOT
      : Object.freeze({ ...EMPTY_SNAPSHOT, keyCapacity: capacity });
    return Object.freeze({
      enabled: false,
      recordEquivalentEnqueue() {},
      recordHousekeepingSupersessions() {},
      registerSubscription() {},
      unregisterSubscription() {},
      recordAssetIssuance() {},
      snapshot: () => disabledSnapshot,
    });
  }

  const equivalentEnqueues = new BoundedKeyMap(capacity, {
    enqueueCount: 0,
    equivalentEnqueueCount: 0,
  });
  const housekeepingSupersessions = new BoundedKeyMap(capacity, { supersededCount: 0 });
  const subscriptionGroups = new BoundedKeyMap(capacity, { registrationCount: 0 });
  const subscriptionTokens = new Map();
  const assetIssuances = new BoundedKeyMap(capacity, { issuanceCount: 0 });

  const recordEquivalentEnqueue = ({ functionId, args }) => {
    if (typeof functionId !== 'string' || functionId.length === 0) return;
    const canonicalInputHash = argsHash(args);
    const key = `${functionId}\u0000${canonicalInputHash}`;
    const atMs = now();
    if (!Number.isFinite(atMs)) return;
    const entry = equivalentEnqueues.getOrCreate(
      key,
      () => ({
        functionId,
        canonicalInputHash,
        enqueueCount: 0,
        equivalentEnqueueCount: 0,
        windowStartMs: atMs,
        windowCount: 0,
        warnedWindowStartMs: null,
      }),
      (other, evicted) => {
        other.enqueueCount += evicted.enqueueCount;
        other.equivalentEnqueueCount += evicted.equivalentEnqueueCount;
      },
    );
    entry.enqueueCount += 1;
    if (atMs - entry.windowStartMs >= window) {
      entry.windowStartMs = atMs;
      entry.windowCount = 1;
      entry.warnedWindowStartMs = null;
      return;
    }
    entry.windowCount += 1;
    if (entry.windowCount > 1) entry.equivalentEnqueueCount += 1;
    if (
      entry.windowCount >= enqueueThreshold
      && entry.warnedWindowStartMs !== entry.windowStartMs
    ) {
      entry.warnedWindowStartMs = entry.windowStartMs;
      emitWarning(diagnosticsChannel, {
        code: 'SNAPBACK_EQUIVALENT_MUTATION_ENQUEUE_MULTIPLICITY',
        severity: 'warning',
        subsystem: 'outbox',
        message: 'Equivalent enqueue rule: coalesce identical mutation arguments within one implementation window; see guide/sync/offline-and-retention.md#equivalent-work-diagnostics.',
        site: functionId,
        details: {
          operation: 'mutation.enqueue',
          functionId,
          canonicalInputHash,
          equivalentEnqueueCount: entry.windowCount - 1,
          windowMs: window,
          remediation: 'coalesce-identical-enqueues',
          guideAnchor: 'guide/sync/offline-and-retention.md#equivalent-work-diagnostics',
        },
      });
    }
  };

  const recordHousekeepingSupersessions = (facts) => {
    if (!Array.isArray(facts)) return;
    for (const fact of facts) {
      if (
        typeof fact?.functionId !== 'string'
        || !Number.isSafeInteger(fact?.count)
        || fact.count < 1
      ) continue;
      const entry = housekeepingSupersessions.getOrCreate(
        fact.functionId,
        () => ({ functionId: fact.functionId, supersededCount: 0 }),
        (other, evicted) => { other.supersededCount += evicted.supersededCount; },
      );
      entry.supersededCount += fact.count;
    }
  };

  const registerSubscription = ({ token, functionId, args, ownershipTuple, ownerLabel }) => {
    if (
      token === null
      || (typeof token !== 'object' && typeof token !== 'function')
      || typeof functionId !== 'string'
      || typeof ownerLabel !== 'string'
    ) return;
    const canonicalInputHash = argsHash(args);
    const ownershipTupleHash = argsHash(ownershipTuple);
    // The owner label is deliberately absent from this identity. It is only
    // an attribution fact carried by the members of the duplicate group.
    const key = `${functionId}\u0000${canonicalInputHash}\u0000${ownershipTupleHash}`;
    const entry = subscriptionGroups.getOrCreate(
      key,
      () => ({
        functionId,
        canonicalInputHash,
        ownershipTupleHash,
        owners: new Map(),
        registrationCount: 0,
        warned: false,
      }),
      (other, evicted) => { other.registrationCount += evicted.registrationCount; },
    );
    entry.owners.set(token, ownerLabel);
    entry.registrationCount += 1;
    subscriptionTokens.set(token, key);
    if (entry.owners.size === 2 && !entry.warned) {
      entry.warned = true;
      const ownerLabels = [...entry.owners.values()].sort();
      emitWarning(diagnosticsChannel, {
        code: 'SNAPBACK_LIVE_DUPLICATE_SUBSCRIPTION_MULTIPLICITY',
        severity: 'warning',
        subsystem: 'live',
        message: 'Duplicate subscription rule: share one live query for identical function arguments and ownership; see guide/recipes/provider-lifecycle.md#duplicate-subscription-diagnostics.',
        site: functionId,
        details: {
          operation: 'liveQuery.subscribe',
          functionId,
          canonicalInputHash,
          ownerLabels,
          count: entry.owners.size,
          remediation: 'share-identical-live-query',
          guideAnchor: 'guide/recipes/provider-lifecycle.md#duplicate-subscription-diagnostics',
        },
      });
    }
  };

  const unregisterSubscription = (token) => {
    const key = subscriptionTokens.get(token);
    subscriptionTokens.delete(token);
    if (key === undefined) return;
    const entry = subscriptionGroups.entries.get(key);
    if (!entry) return;
    entry.owners.delete(token);
    if (entry.owners.size === 0) {
      subscriptionGroups.other.registrationCount += entry.registrationCount;
      subscriptionGroups.entries.delete(key);
    }
  };

  const recordAssetIssuance = ({ assetIdentity, ownerLabel }) => {
    if (typeof assetIdentity !== 'string' || typeof ownerLabel !== 'string') return;
    const key = `${assetIdentity}\u0000${ownerLabel}`;
    const atMs = now();
    if (!Number.isFinite(atMs)) return;
    const entry = assetIssuances.getOrCreate(
      key,
      () => ({
        assetIdentity,
        ownerLabel,
        issuanceCount: 0,
        windowStartMs: atMs,
        windowCount: 0,
        warnedWindowStartMs: null,
      }),
      (other, evicted) => { other.issuanceCount += evicted.issuanceCount; },
    );
    entry.issuanceCount += 1;
    if (atMs - entry.windowStartMs >= window) {
      entry.windowStartMs = atMs;
      entry.windowCount = 1;
      entry.warnedWindowStartMs = null;
      return;
    }
    entry.windowCount += 1;
    if (
      entry.windowCount >= assetThreshold
      && entry.warnedWindowStartMs !== entry.windowStartMs
    ) {
      entry.warnedWindowStartMs = entry.windowStartMs;
      emitWarning(diagnosticsChannel, {
        code: 'SNAPBACK_ASSET_ISSUANCE_MULTIPLICITY',
        severity: 'warning',
        subsystem: 'assets',
        message: 'Asset issuance rule: share one issued-URL projection per asset and owner; see guide/backend/assets.md#asset-issuance-multiplicity-diagnostics.',
        site: ownerLabel,
        details: {
          operation: 'asset.issueUrl',
          assetIdentity,
          ownerLabels: [ownerLabel],
          issuanceCount: entry.windowCount,
          windowMs: window,
          remediation: 'share-issued-url-projection',
          guideAnchor: 'guide/backend/assets.md#asset-issuance-multiplicity-diagnostics',
        },
      });
    }
  };

  const snapshot = () => Object.freeze({
    enabled: true,
    keyCapacity: capacity,
    equivalentEnqueues: Object.freeze({
      facts: frozenFacts(equivalentEnqueues.entries, (entry) => ({
        functionId: entry.functionId,
        canonicalInputHash: entry.canonicalInputHash,
        enqueueCount: entry.enqueueCount,
        equivalentEnqueueCount: entry.equivalentEnqueueCount,
      })),
      otherKeys: Object.freeze({ ...equivalentEnqueues.other }),
      evictedKeys: equivalentEnqueues.evictedKeys,
    }),
    housekeepingSupersessions: Object.freeze({
      facts: frozenFacts(housekeepingSupersessions.entries, (entry) => ({
        functionId: entry.functionId,
        supersededCount: entry.supersededCount,
      })),
      otherKeys: Object.freeze({ ...housekeepingSupersessions.other }),
      evictedKeys: housekeepingSupersessions.evictedKeys,
    }),
    duplicateSubscriptions: Object.freeze({
      facts: Object.freeze(
        frozenFacts(subscriptionGroups.entries, (entry) => ({
          functionId: entry.functionId,
          canonicalInputHash: entry.canonicalInputHash,
          ownershipTupleHash: entry.ownershipTupleHash,
          count: entry.owners.size,
          ownerLabels: Object.freeze([...entry.owners.values()].sort()),
        })).filter((fact) => fact.count > 1),
      ),
      otherKeys: Object.freeze({ ...subscriptionGroups.other }),
      evictedKeys: subscriptionGroups.evictedKeys,
    }),
    assetIssuanceMultiplicity: Object.freeze({
      facts: frozenFacts(assetIssuances.entries, (entry) => ({
        assetIdentity: entry.assetIdentity,
        ownerLabel: entry.ownerLabel,
        issuanceCount: entry.issuanceCount,
      })),
      otherKeys: Object.freeze({ ...assetIssuances.other }),
      evictedKeys: assetIssuances.evictedKeys,
    }),
  });

  return Object.freeze({
    enabled: true,
    recordEquivalentEnqueue,
    recordHousekeepingSupersessions,
    registerSubscription,
    unregisterSubscription,
    recordAssetIssuance,
    snapshot,
  });
}
