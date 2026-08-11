const CLIENT_DIAGNOSTIC_SCHEMA_VERSION = 'snapback.client-diagnostic.v2';
const LEGACY_CLIENT_DIAGNOSTIC_SCHEMA_VERSION = 'snapback.client-diagnostic.v1';
const DEFAULT_HISTORY_LIMIT = 256;
const DEFAULT_ACTIVE_CONDITION_LIMIT = 64;
const DEFAULT_COOLDOWN_MS = 1_000;
export const DEFAULT_QUEUED_MUTATION_WEDGE_WARNING_MS = 30_000;
const MAX_STRING_LENGTH = 512;
const MAX_DETAIL_ENTRIES = 32;
const MAX_DETAIL_DEPTH = 2;
const DIAGNOSTIC_CODE = /^SNAPBACK_[A-Z0-9_]+$/u;
// P2 producer reservations are registered with the generated diagnostic
// vocabulary in P1 so adapters can type their events before those producers land.
const RESERVED_CHANNEL_CODES = new Set([
  'SNAPBACK_REACT_PRESENCE_PUBLISH_CHURN',
  'SNAPBACK_REACT_SUBSCRIPTION_CHURN',
]);

const OUTBOX_QUEUED_TRANSITION_CODES = new Set([
  'SNAPBACK_OFFLINE_MUTATION_QUEUED',
  // LLP 0218 §4.4 retains canonical-code unification; consume P1's landed
  // uncovered-range queued transition without synthesizing another event.
  'SNAPBACK_OPERATION_RANGE_UNCOVERED_QUEUED',
]);
const QUEUED_DIAGNOSTIC_CODES = new Set([
  ...OUTBOX_QUEUED_TRANSITION_CODES,
  'SNAPBACK_REACT_MUTATION_QUEUED',
]);
const WEDGED_DIAGNOSTIC_CODE = 'SNAPBACK_REACT_MUTATION_QUEUE_WEDGED';
const OUTBOX_GUIDE = 'guide/sync/offline-and-retention.md#replay-and-settle-without-guessing';

// Positive development/HMR identification is shared by every client host.
// Absence of a production marker is deliberately not evidence of development.
// @ref LLP 0219#decision — the default reporter is gated by an affirmative
// development signal and is never enabled merely because production is absent.
/* global __DEV__ */
export function positiveDevelopmentEnvironment() {
  if (typeof __DEV__ === 'boolean') return __DEV__ === true;
  if (import.meta.hot != null) return true;
  if (typeof module !== 'undefined' && module?.hot != null) return true;
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
}

const FORBIDDEN_DETAIL_KEY_PART = /^(?:args?|arguments?|variables?|inputs?|payloads?|presence|credentials?|passwords?|passcodes?|secrets?|tokens?|authorization|cookies?|headers?|body|bodies|keymaterial|values?|data)$/u;

const freezeRecord = (entries) => Object.freeze(Object.fromEntries(entries));

function cappedString(value) {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH - 1)}…`;
}

function safeError(error) {
  const entries = [];
  let code;
  try { code = error.code; } catch { code = undefined; }
  if (typeof code === 'string') entries.push(['code', cappedString(code)]);
  let message;
  try { message = error.message; } catch { message = 'Error'; }
  entries.push(['message', cappedString(typeof message === 'string' ? message : 'Error')]);
  return freezeRecord(entries);
}

function isPromiseLike(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  try {
    return typeof value.then === 'function';
  } catch {
    return true;
  }
}

function forbiddenDetailKey(key) {
  const parts = key
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/gu, '_')
    .toLowerCase()
    .split('_')
    .filter(Boolean);
  // Hashed canonical-input identities are expressly payload-safe under LLP
  // 0219; the input itself is not.
  if (
    parts.join('_') === 'hashed_canonical_input_identity'
    || parts.join('_') === 'canonical_input_hash'
    || parts.join('_') === 'canonical_input_digest'
  ) return false;
  const compact = parts.join('');
  if (
    compact === 'apikey'
    || compact === 'accesskey'
    || compact === 'privatekey'
    || compact === 'secretkey'
    || compact === 'keymaterial'
  ) return true;
  return parts.some((part) => FORBIDDEN_DETAIL_KEY_PART.test(part));
}

function normalizeDetailValue(value, depth) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return cappedString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined;
  }
  try {
    if (isPromiseLike(value)) return undefined;
    if (value instanceof Error) return safeError(value);
    if (depth >= MAX_DETAIL_DEPTH) {
      return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]';
    }
    if (Array.isArray(value)) {
      const result = [];
      const length = Math.min(value.length, MAX_DETAIL_ENTRIES);
      for (let index = 0; index < length; index += 1) {
        const normalized = normalizeDetailValue(value[index], depth + 1);
        if (normalized !== undefined) result.push(normalized);
      }
      return Object.freeze(result);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const entries = [];
    let inspected = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (inspected >= MAX_DETAIL_ENTRIES) break;
      inspected += 1;
      const normalizedKey = cappedString(key);
      if (forbiddenDetailKey(normalizedKey)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
      const normalized = normalizeDetailValue(descriptor.value, depth + 1);
      if (normalized !== undefined) entries.push([normalizedKey, normalized]);
    }
    return freezeRecord(entries);
  } catch {
    return undefined;
  }
}

// @ref LLP 0219#channel-semantics — payload-bearing keys and unsafe value
// kinds are rejected before an event can enter either channel collection.
function normalizeDetails(details) {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) {
    return Object.freeze({});
  }
  const normalized = normalizeDetailValue(details, 0);
  return normalized && !Array.isArray(normalized) ? normalized : Object.freeze({});
}

function validatedLimit(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function validatedCooldown(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('diagnostic cooldown must be a non-negative finite number');
  }
  return value;
}

function normalizeEvent(event, atMs, previousOccurrence = null) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('client diagnostic event must be an object');
  }
  if (
    event.schemaVersion !== undefined
    && event.schemaVersion !== CLIENT_DIAGNOSTIC_SCHEMA_VERSION
  ) {
    throw new TypeError(`client diagnostic events must use ${CLIENT_DIAGNOSTIC_SCHEMA_VERSION}`);
  }
  if (
    typeof event.code !== 'string'
    || event.code.length > MAX_STRING_LENGTH
    || (!RESERVED_CHANNEL_CODES.has(event.code) && !DIAGNOSTIC_CODE.test(event.code))
  ) {
    throw new TypeError('client diagnostic code must be a registered SNAPBACK_* code');
  }
  if (event.severity !== 'error' && event.severity !== 'warning') {
    throw new TypeError("client diagnostic severity must be 'error' or 'warning'");
  }
  if (typeof event.subsystem !== 'string' || event.subsystem.length === 0) {
    throw new TypeError('client diagnostic subsystem must be a non-empty string');
  }
  if (typeof event.message !== 'string' || event.message.length === 0) {
    throw new TypeError('client diagnostic message must be a non-empty string');
  }
  if (event.site !== undefined && typeof event.site !== 'string') {
    throw new TypeError('client diagnostic site must be a string when present');
  }
  const occurrence = Object.freeze({
    firstAtMs: previousOccurrence?.firstAtMs ?? atMs,
    lastAtMs: atMs,
    count: (previousOccurrence?.count ?? 0) + 1,
  });
  const normalized = {
    // @ref LLP 0219#channel-semantics — warning severity and occurrence
    // metadata live only under the distinct v2 carrier discriminator.
    schemaVersion: CLIENT_DIAGNOSTIC_SCHEMA_VERSION,
    code: event.code,
    severity: event.severity,
    subsystem: cappedString(event.subsystem),
    message: cappedString(event.message),
    details: normalizeDetails(event.details),
    occurrence,
  };
  if (event.site !== undefined) normalized.site = cappedString(event.site);
  return Object.freeze(normalized);
}

function coalescingKey(event) {
  return `${event.code}\u0000${event.site ?? ''}`;
}

/**
 * Create one bounded, process-local diagnostics channel for one client.
 */
export function createClientDiagnosticsChannel({
  historyLimit = DEFAULT_HISTORY_LIMIT,
  activeConditionLimit = DEFAULT_ACTIVE_CONDITION_LIMIT,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  cooldownFor = null,
  now = Date.now,
  setTimeout: setTimeoutFn = globalThis.setTimeout,
  clearTimeout: clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  const capacity = validatedLimit('historyLimit', historyLimit);
  const conditionCapacity = validatedLimit('activeConditionLimit', activeConditionLimit);
  const defaultCooldown = validatedCooldown(cooldownMs);
  if (cooldownFor !== null && typeof cooldownFor !== 'function') {
    throw new TypeError('cooldownFor must be a function');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
    throw new TypeError('setTimeout and clearTimeout must be functions');
  }

  const ring = new Array(capacity);
  const coalescingSlots = new Map();
  const activeConditions = new Map();
  const listeners = new Set();
  let ringStart = 0;
  let ringSize = 0;
  let emitted = 0;
  let coalesced = 0;
  let dropped = 0;
  let disposed = false;
  let snapshotCache = null;
  let lastAtMs = Number.NEGATIVE_INFINITY;
  let deadlineHandle = null;
  let deadlineGeneration = 0;

  const readNow = () => {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('now() must return a finite number');
    lastAtMs = Math.max(lastAtMs, value);
    return lastAtMs;
  };

  const invalidateSnapshot = () => { snapshotCache = null; };

  const notify = (event) => {
    for (const listener of listeners) {
      try { listener(event); } catch { /* observation never owns diagnostics */ }
    }
  };

  const append = (event, key) => {
    let index;
    if (ringSize < capacity) {
      index = (ringStart + ringSize) % capacity;
      ringSize += 1;
    } else {
      index = ringStart;
      const evicted = ring[index];
      const evictedKey = coalescingKey(evicted);
      if (coalescingSlots.get(evictedKey) === index) coalescingSlots.delete(evictedKey);
      ringStart = (ringStart + 1) % capacity;
      dropped += 1;
    }
    ring[index] = event;
    coalescingSlots.set(key, index);
  };

  const channel = {
    emit(input) {
      if (disposed) {
        emitted += 1;
        dropped += 1;
        invalidateSnapshot();
        return null;
      }
      const atMs = readNow();
      const initial = normalizeEvent(input, atMs);
      const key = coalescingKey(initial);
      const existingIndex = coalescingSlots.get(key);
      const configuredCooldown = cooldownFor === null
        ? defaultCooldown
        : validatedCooldown(cooldownFor(initial.code, initial.site));
      emitted += 1;
      if (existingIndex !== undefined) {
        const existing = ring[existingIndex];
        if (existing && atMs - existing.occurrence.lastAtMs < configuredCooldown) {
          const next = normalizeEvent(existing, atMs, existing.occurrence);
          ring[existingIndex] = next;
          coalesced += 1;
          invalidateSnapshot();
          notify(next);
          return next;
        }
      }
      append(initial, key);
      invalidateSnapshot();
      notify(initial);
      return initial;
    },

    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('diagnostics subscribe requires a listener function');
      }
      if (disposed) return () => {};
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },

    snapshot() {
      if (snapshotCache !== null) return snapshotCache;
      const events = [];
      for (let offset = 0; offset < ringSize; offset += 1) {
        events.push(ring[(ringStart + offset) % capacity]);
      }
      const conditionEntries = [];
      for (const [key, event] of activeConditions) conditionEntries.push([key, event]);
      snapshotCache = Object.freeze({
        events: Object.freeze(events),
        activeConditions: freezeRecord(conditionEntries),
        counters: Object.freeze({ emitted, coalesced, dropped }),
      });
      return snapshotCache;
    },

    setActiveCondition(key, input) {
      if (typeof key !== 'string' || key.length === 0 || key.length > MAX_STRING_LENGTH) {
        throw new TypeError(`active diagnostic condition key must be 1-${MAX_STRING_LENGTH} characters`);
      }
      if (disposed) {
        dropped += 1;
        invalidateSnapshot();
        return null;
      }
      const existing = activeConditions.get(key);
      const event = normalizeEvent(input, readNow(), existing?.occurrence ?? null);
      if (!existing && activeConditions.size >= conditionCapacity) {
        const oldestKey = activeConditions.keys().next().value;
        activeConditions.delete(oldestKey);
        dropped += 1;
      } else if (existing) {
        activeConditions.delete(key);
      }
      activeConditions.set(key, event);
      invalidateSnapshot();
      notify(event);
      return event;
    },

    clearActiveCondition(key) {
      if (!activeConditions.delete(key)) return false;
      invalidateSnapshot();
      notify(null);
      return true;
    },

    // @ref LLP 0219#producers-pilot-scoped-detectors — all deadline users
    // re-arm this one channel-owned handle; adapters cannot create wedge timers.
    scheduleDeadline(atMs, fn = null) {
      deadlineGeneration += 1;
      const generation = deadlineGeneration;
      if (deadlineHandle !== null) {
        clearTimeoutFn(deadlineHandle);
        deadlineHandle = null;
      }
      if (disposed || atMs === null) return;
      if (!Number.isFinite(atMs) || typeof fn !== 'function') {
        throw new TypeError('scheduleDeadline requires a finite deadline and callback');
      }
      deadlineHandle = setTimeoutFn(() => {
        if (disposed || generation !== deadlineGeneration) return;
        deadlineHandle = null;
        fn();
      }, Math.max(0, atMs - readNow()));
      deadlineHandle?.unref?.();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      deadlineGeneration += 1;
      if (deadlineHandle !== null) {
        clearTimeoutFn(deadlineHandle);
        deadlineHandle = null;
      }
      activeConditions.clear();
      invalidateSnapshot();
      listeners.clear();
    },
  };

  return Object.freeze(channel);
}

// @ref LLP 0219#channel-semantics — v1 is frozen at error-only; warnings are
// filtered rather than widened beneath the legacy discriminator.
export function projectDiagnosticV1(event) {
  if (
    event?.schemaVersion !== CLIENT_DIAGNOSTIC_SCHEMA_VERSION
    || event.severity !== 'error'
  ) return null;
  return Object.freeze({
    schemaVersion: LEGACY_CLIENT_DIAGNOSTIC_SCHEMA_VERSION,
    severity: 'error',
    code: event.code,
    message: event.message,
    details: event.details,
  });
}

function rememberBounded(set, value, limit = 1_024) {
  if (set.has(value)) return false;
  if (set.size >= limit) set.delete(set.values().next().value);
  set.add(value);
  return true;
}

function clientMutationIdFrom(event) {
  return typeof event?.details?.clientMutationId === 'string'
    ? event.details.clientMutationId
    : null;
}

function queuedConsoleLine(event, loud) {
  const mutation = typeof event.details.mutation === 'string'
    ? ` Mutation: ${event.details.mutation}.`
    : '';
  const promotion = loud ? '[QUEUED — ACTION REQUIRED] ' : '';
  const code = event.code === 'SNAPBACK_REACT_MUTATION_QUEUED'
    ? 'SNAPBACK_OFFLINE_MUTATION_QUEUED'
    : event.code;
  return `[Snapback] ${promotion}${code}: `
    + `Offline queue rule: queued is pending, not settled.${mutation} `
    + 'Keep pending UI visible; the provider-owned drain runs automatically, '
    + 'or request a cycle with useSnapbackOutbox().drainNow() / '
    + `client.replayQueuedMutations(); see ${OUTBOX_GUIDE}.`;
}

function blockedReasonMessage(blockedReason) {
  if (blockedReason === 'not-writer') {
    return 'Blocked reason: not-writer — another tab/process owns the queue.';
  }
  if (blockedReason === 'custody-unsettled') {
    return 'Blocked reason: custody-unsettled — custody must reconcile first.';
  }
  return typeof blockedReason === 'string'
    ? `Blocked reason: ${blockedReason}.`
    : '';
}

function wedgeConsoleLine(event) {
  const recoveryPath = typeof event.details.recoveryPath === 'string'
    ? event.details.recoveryPath
    : 'useSnapbackOutbox().drainNow() / client.replayQueuedMutations()';
  const queueDepth = Number.isSafeInteger(event.details.queueDepth)
    ? event.details.queueDepth
    : 'unknown';
  const clientMutationId = typeof event.details.clientMutationId === 'string'
    ? event.details.clientMutationId
    : 'unknown';
  const headSequence = Number.isSafeInteger(event.details.headSequence)
    ? event.details.headSequence
    : 'unknown';
  const blocked = blockedReasonMessage(event.details.blockedReason);
  return `[Snapback] ${WEDGED_DIAGNOSTIC_CODE}: Durable outbox queue-head rule: `
    + 'the queue head has not advanced within the warning window. '
    + `Queue depth: ${queueDepth}. Head clientMutationId: ${clientMutationId}; `
    + `sequence: ${headSequence}. `
    + (blocked === '' ? '' : `${blocked} `)
    + `Recover with ${recoveryPath}; see ${OUTBOX_GUIDE}.`;
}

/**
 * Attach the default line-oriented console projection. The caller owns the
 * returned disposable; disposing the channel also detaches its listener.
 */
export function createClientDevConsoleReporter(channel, {
  console: consoleOutput = globalThis.console,
} = {}) {
  if (!channel || typeof channel.subscribe !== 'function') {
    throw new TypeError('dev diagnostics reporter requires a diagnostics channel');
  }
  if (
    !consoleOutput
    || typeof consoleOutput.warn !== 'function'
    || typeof consoleOutput.error !== 'function'
  ) {
    throw new TypeError('dev diagnostics reporter requires console.warn and console.error');
  }

  const reportedQueuedTransitions = new Set();
  const reportedWedgedHeads = new Set();
  // @ref LLP 0219#producers-pilot-scoped-detectors — "session" is the
  // client-instance lifetime, so this pin belongs to one attached reporter.
  let firstQueuedTransition = true;
  let disposed = false;
  const unsubscribe = channel.subscribe((event) => {
    if (disposed || event === null) return;
    // A channel coalescing update is occurrence accounting, not another line.
    if (event.occurrence.count > 1) return;

    let line;
    if (QUEUED_DIAGNOSTIC_CODES.has(event.code)) {
      const clientMutationId = clientMutationIdFrom(event);
      // @ref LLP 0219#consumers-and-compatibility — the React queued code is
      // a compatibility projection of the canonical durable event; one
      // clientMutationId produces exactly one console line for the pair.
      if (
        clientMutationId !== null
        && !rememberBounded(reportedQueuedTransitions, clientMutationId)
      ) return;
      line = queuedConsoleLine(event, firstQueuedTransition);
      firstQueuedTransition = false;
    } else if (event.code === WEDGED_DIAGNOSTIC_CODE) {
      const headKey = typeof event.site === 'string'
        ? event.site
        : clientMutationIdFrom(event) ?? 'unknown-head';
      if (!rememberBounded(reportedWedgedHeads, headKey)) return;
      line = wedgeConsoleLine(event);
    } else {
      const site = typeof event.site === 'string' ? ` Site: ${event.site}.` : '';
      line = `[Snapback] ${event.code}: ${event.message}${site}`;
    }

    const write = event.severity === 'error' ? consoleOutput.error : consoleOutput.warn;
    try { write.call(consoleOutput, line); } catch { /* reporting owns no client behavior */ }
  });

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      reportedQueuedTransitions.clear();
      reportedWedgedHeads.clear();
    },
  });
}

function validatedWedgeWarningMs(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('queuedMutationWedgeWarningMs must be a non-negative finite number');
  }
  return value;
}

function outboxHeadKey(head) {
  return `queue-head:${head.clientMutationId}:${head.sequence}`;
}

function wedgeDetails(fact, atMs) {
  const { head } = fact;
  const resultGone = head.status === 'result-gone';
  // LLP 0218 P1 attachment consumed: its status-level age, blocked reason,
  // drain phase, and retry fact now enrich the existing recovery cuts.
  const recoveryPath = resultGone
    ? 'useSnapbackOutbox().acknowledgeResultGoneMutations([...]) / client.acknowledgeResultGoneMutations([...])'
    : 'useSnapbackOutbox().drainNow() / client.replayQueuedMutations()';
  const details = {
    queueDepth: fact.pending,
    clientMutationId: head.clientMutationId,
    headSequence: head.sequence,
    headStatus: head.status,
    mutationFunction: head.function,
    recoveryPath,
  };
  const oldestPendingAtMs = Number.isFinite(fact.oldestPendingAtMs)
    ? fact.oldestPendingAtMs
    : head.enqueuedAtMs;
  if (Number.isFinite(oldestPendingAtMs)) {
    details.oldestPendingAgeMs = Math.max(0, atMs - oldestPendingAtMs);
  }
  if (typeof fact.blockedReason === 'string') {
    details.blockedReason = fact.blockedReason;
  }
  if (typeof fact.drainPhase === 'string') {
    details.drainPhase = fact.drainPhase;
  }
  if (Object.hasOwn(fact, 'nextRetryAtMs')) {
    // P1 currently reports null; carry the fact without inventing retry semantics.
    details.nextRetryAtMs = fact.nextRetryAtMs;
  }
  if (head.transportProvenance !== undefined) {
    details.transportProvenance = head.transportProvenance;
  }
  return details;
}

/**
 * Bind the outbox active-condition producer to one client-owned channel.
 * Diagnostic events only wake the producer; readHeadFact is the durable truth.
 */
export function attachOutboxDiagnosticsProducer({
  channel,
  subscribeOutbox,
  readHeadFact,
  queuedMutationWedgeWarningMs = DEFAULT_QUEUED_MUTATION_WEDGE_WARNING_MS,
  now = Date.now,
}) {
  if (!channel || typeof channel.subscribe !== 'function') {
    throw new TypeError('outbox diagnostics producer requires a diagnostics channel');
  }
  if (typeof subscribeOutbox !== 'function' || typeof readHeadFact !== 'function') {
    throw new TypeError('outbox diagnostics producer requires outbox subscribe/read seams');
  }
  if (typeof now !== 'function') throw new TypeError('outbox diagnostics now must be a function');
  const warningMs = validatedWedgeWarningMs(queuedMutationWedgeWarningMs);

  let disposed = false;
  let engaged = false;
  let observedHeadKey = null;
  let activeConditionKey = null;
  let activeSignature = null;
  let deadlineHeadKey = null;
  let work = Promise.resolve();

  const readNow = () => {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('outbox diagnostics now() must be finite');
    return value;
  };

  const clearObservedHead = () => {
    deadlineHeadKey = null;
    channel.scheduleDeadline(null);
    if (activeConditionKey !== null) channel.clearActiveCondition(activeConditionKey);
    observedHeadKey = null;
    activeConditionKey = null;
    activeSignature = null;
  };

  const enqueueReconcile = (request = {}) => {
    if (disposed) return;
    work = work.then(
      () => reconcile(request),
      () => reconcile(request),
    ).catch(() => {
      // An unreadable durable store cannot prove head advance or emptiness.
      // Preserve the current condition until a later authoritative notification.
    });
  };

  const arm = (headKey, fromMs) => {
    deadlineHeadKey = headKey;
    // @ref LLP 0219#producers-pilot-scoped-detectors — the client channel's
    // one owned scheduler is re-armed per durable head; adapters own no timer.
    channel.scheduleDeadline(fromMs + warningMs, () => {
      if (disposed || observedHeadKey !== headKey) return;
      deadlineHeadKey = null;
      enqueueReconcile({ activateHeadKey: headKey });
    });
  };

  const activateOrRefresh = (fact, headKey) => {
    const atMs = readNow();
    const details = wedgeDetails(fact, atMs);
    const signature = JSON.stringify(details);
    if (activeConditionKey === headKey && activeSignature === signature) return;
    const recovery = details.recoveryPath;
    const blocked = blockedReasonMessage(details.blockedReason);
    channel.setActiveCondition(headKey, {
      schemaVersion: CLIENT_DIAGNOSTIC_SCHEMA_VERSION,
      code: WEDGED_DIAGNOSTIC_CODE,
      severity: 'warning',
      subsystem: 'outbox',
      message: `Durable outbox queue-head rule: the head has not advanced within ${warningMs}ms. ${blocked === '' ? '' : `${blocked} `}Recover with ${recovery}; see ${OUTBOX_GUIDE}.`,
      details,
      site: headKey,
    });
    activeConditionKey = headKey;
    activeSignature = signature;
  };

  async function reconcile({ queuedAtMs = null, activateHeadKey = null } = {}) {
    if (disposed) return;
    const fact = await readHeadFact();
    if (disposed) return;
    const head = fact?.head ?? null;
    const conditionHeld = head !== null
      && (fact.pending > 0 || head.status === 'result-gone');
    if (!conditionHeld) {
      clearObservedHead();
      engaged = false;
      return;
    }
    engaged = true;

    const headKey = outboxHeadKey(head);
    if (headKey !== observedHeadKey) {
      if (activeConditionKey !== null) channel.clearActiveCondition(activeConditionKey);
      observedHeadKey = headKey;
      activeConditionKey = null;
      activeSignature = null;
      arm(headKey, queuedAtMs ?? readNow());
      return;
    }

    if (activeConditionKey === headKey) {
      // Unchanged-head notifications (including failed replay) update facts
      // but never clear the active condition or restart its lifecycle.
      activateOrRefresh(fact, headKey);
      return;
    }
    if (activateHeadKey === headKey) {
      activateOrRefresh(fact, headKey);
      return;
    }
    if (deadlineHeadKey === null) arm(headKey, queuedAtMs ?? readNow());
  }

  const unsubscribeDiagnostics = channel.subscribe((event) => {
    if (!OUTBOX_QUEUED_TRANSITION_CODES.has(event?.code)) return;
    engaged = true;
    enqueueReconcile({ queuedAtMs: event.occurrence.lastAtMs });
  });
  // @ref LLP 0219#channel-semantics — observation cannot add durable-store
  // custody traffic to flows with no queued intent: outbox notifications
  // re-read the head only while a queued transition or tracked head keeps
  // this producer engaged; the startup reconstruction read below re-engages
  // it when a pre-existing durable condition is found.
  const unsubscribeOutbox = subscribeOutbox(() => {
    if (!engaged) return;
    enqueueReconcile();
  });
  // Reconstruct a pre-existing durable condition on client startup without
  // treating process-local diagnostic history as evidence.
  enqueueReconcile();

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeDiagnostics();
      unsubscribeOutbox();
      clearObservedHead();
    },
  });
}
