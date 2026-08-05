// Carrier-neutral LLP 0166 multi-context demand broker. The browser carrier
// supplies a BroadcastChannel-shaped channel and Web Locks; the file carrier
// deliberately has no cross-process qualification and reports volatile-online
// degradation for unreachable writers (OQ12 remains open).

import * as registrationLedgerModule from './registration-ledger.mjs';

export const BROKER_LIMITS = Object.freeze({
  heartbeatIntervalMs: 15_000,
  heartbeatExpiryMs: 45_000,
  liveContextCeiling: 64,
  livePairCeiling: 128,
  reapedContextCeiling: 256,
  consumedRequestCeiling: 1_024,
  releasedRegistrationCeiling: 1_024,
  identifierByteCeiling: 64,
  messageByteCeiling: 256 * 1_024,
});

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const utf8 = new TextEncoder();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const pairKey = (contextId, partition) => `${contextId}\u0000${partition}`;
const requestKey = (contextId, requestId) => `${contextId}\u0000${requestId}`;
const tombstoneKey = (partition, registrationId) => `${partition}\u0000${registrationId}`;

const refusal = (code) => Object.freeze({ refused: Object.freeze({ code }) });

function exact(value, fields) {
  return plain(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => own(value, field));
}

function boundedIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && utf8.encode(value).length <= BROKER_LIMITS.identifierByteCeiling
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function finiteJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => finiteJson(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype
      && Object.values(value).every((entry) => finiteJson(entry, seen));
  seen.delete(value);
  return valid;
}

function registrationShape(value, source) {
  if (!exact(value, [
    'format', 'registrationId', 'source', 'ownerContext', 'functionReference',
    'canonicalArgs', 'requestedScope', 'retentionRequest', 'idleTtlClass',
  ])) return false;
  if (
    value.format !== 'snapback.query-registration.v1'
    || !boundedIdentifier(value.registrationId)
    || value.source !== source
    || !plain(value.functionReference)
    || !plain(value.requestedScope)
    || !finiteJson(value.canonicalArgs)
    || !['none', 'durable'].includes(value.retentionRequest)
    || !['none', 'default', 'pinned'].includes(value.idleTtlClass)
  ) return false;
  if (source === 'active') {
    return exact(value.ownerContext, ['kind', 'contextId'])
      && value.ownerContext.kind === 'subscription'
      && boundedIdentifier(value.ownerContext.contextId);
  }
  if (source === 'programmatic') {
    return exact(value.ownerContext, ['kind', 'label'])
      && value.ownerContext.kind === 'api'
      && (value.ownerContext.label === null || typeof value.ownerContext.label === 'string');
  }
  return false;
}

function messageBytes(message) {
  try { return utf8.encode(JSON.stringify(message)).length; } catch { return Infinity; }
}

export function validateBrokerMessage(message, { resolveRegistration } = {}) {
  if (!plain(message)) return refusal('SNAPBACK_BROKER_MESSAGE_INVALID');
  if (messageBytes(message) > BROKER_LIMITS.messageByteCeiling) {
    return refusal('SNAPBACK_BROKER_MESSAGE_OVERSIZE');
  }
  if (typeof resolveRegistration !== 'function') {
    throw new TypeError('broker validation requires resolveRegistration(registration)');
  }
  const commonContext = (value) => boundedIdentifier(value.contextId);
  if (message.format === 'snapback.demand-announce.v1') {
    if (!exact(message, ['format', 'contextId', 'revision', 'authorityPartitionDigest', 'demands'])
      || !commonContext(message)
      || !Number.isSafeInteger(message.revision) || message.revision < 0
      || !DIGEST.test(message.authorityPartitionDigest)
      || !Array.isArray(message.demands)) return refusal('SNAPBACK_BROKER_MESSAGE_INVALID');
    for (const demand of message.demands) {
      if (!registrationShape(demand, 'active') || demand.ownerContext.contextId !== message.contextId) {
        return refusal('SNAPBACK_BROKER_MESSAGE_INVALID');
      }
      let resolved;
      try { resolved = resolveRegistration(clone(demand)); } catch { return refusal('SNAPBACK_BROKER_MESSAGE_INVALID'); }
      if (resolved?.authorityPartitionDigest !== message.authorityPartitionDigest) {
        return refusal('SNAPBACK_BROKER_PARTITION_MISMATCH');
      }
    }
    return { admitted: clone(message) };
  }
  if (message.format === 'snapback.register-forward.v1') {
    if (!exact(message, [
      'format', 'contextId', 'requestId', 'writerGeneration',
      'authorityPartitionDigest', 'registration',
    ]) || !commonContext(message) || !boundedIdentifier(message.requestId)
      || !Number.isSafeInteger(message.writerGeneration) || message.writerGeneration < 0
      || !DIGEST.test(message.authorityPartitionDigest)
      || !registrationShape(message.registration, 'programmatic')) {
      return refusal('SNAPBACK_BROKER_MESSAGE_INVALID');
    }
    let resolved;
    try { resolved = resolveRegistration(clone(message.registration)); } catch {
      return refusal('SNAPBACK_BROKER_MESSAGE_INVALID');
    }
    if (resolved?.authorityPartitionDigest !== message.authorityPartitionDigest) {
      return refusal('SNAPBACK_BROKER_PARTITION_MISMATCH');
    }
    return { admitted: clone(message), resolved };
  }
  if (message.format === 'snapback.register-release.v1') {
    if (!exact(message, [
      'format', 'contextId', 'requestId', 'writerGeneration',
      'authorityPartitionDigest', 'registrationId',
    ]) || !commonContext(message) || !boundedIdentifier(message.requestId)
      || !boundedIdentifier(message.registrationId)
      || !Number.isSafeInteger(message.writerGeneration) || message.writerGeneration < 0
      || !DIGEST.test(message.authorityPartitionDigest)) {
      return refusal('SNAPBACK_BROKER_MESSAGE_INVALID');
    }
    return { admitted: clone(message) };
  }
  if (message.format === 'snapback.register-outcome.v1') {
    if (!exact(message, ['format', 'contextId', 'requestId', 'outcome'])
      || !commonContext(message) || !boundedIdentifier(message.requestId) || !plain(message.outcome)) {
      return refusal('SNAPBACK_BROKER_MESSAGE_INVALID');
    }
    const validOutcome = exact(message.outcome, ['kind'])
      && ['committed', 'released'].includes(message.outcome.kind)
      || exact(message.outcome, ['kind', 'code'])
        && message.outcome.kind === 'refused' && boundedIdentifier(message.outcome.code);
    return validOutcome ? { admitted: clone(message) } : refusal('SNAPBACK_BROKER_MESSAGE_INVALID');
  }
  if (message.format === 'snapback.writer-hello.v1') {
    return exact(message, ['format', 'writerGeneration'])
      && Number.isSafeInteger(message.writerGeneration) && message.writerGeneration >= 0
      ? { admitted: clone(message) }
      : refusal('SNAPBACK_BROKER_MESSAGE_INVALID');
  }
  return refusal('SNAPBACK_BROKER_MESSAGE_INVALID');
}

function normalizeBrokerState(value) {
  const state = plain(value) ? clone(value) : {};
  return {
    format: 'snapback.broker-state.v1',
    pairs: plain(state.pairs) ? state.pairs : {},
    heartbeats: plain(state.heartbeats) ? state.heartbeats : {},
    reapedContexts: Array.isArray(state.reapedContexts) ? state.reapedContexts : [],
    consumedRequests: Array.isArray(state.consumedRequests) ? state.consumedRequests : [],
    releasedRegistrations: Array.isArray(state.releasedRegistrations) ? state.releasedRegistrations : [],
    durableBindings: plain(state.durableBindings) ? state.durableBindings : {},
    suppression: plain(state.suppression) ? state.suppression : {
      active: false, helloAt: null, unreconciledPairs: [],
    },
  };
}

function pushBounded(array, entry, ceiling, keyOf) {
  const key = keyOf(entry);
  const next = array.filter((candidate) => keyOf(candidate) !== key);
  next.push(entry);
  if (next.length > ceiling) next.splice(0, next.length - ceiling);
  return next;
}

export function mintBrokerIdentifier(randomBytes = (length) => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}) {
  const bytes = randomBytes(24);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 24) {
    throw new TypeError('broker randomBytes(24) must return exactly 24 Uint8Array bytes');
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// @ref LLP 0166#the-multi-context-demand-broker — full-set pair announces,
// durable replay memories, heartbeat reaping, and pair-scoped handoff.
export async function createDemandBroker({
  storeHandle,
  registrationLedger = null,
  resolveRegistration,
  admitPartition = () => true,
  channel = null,
  lockManager = null,
  carrier = 'browser',
  now = () => Date.now(),
  randomBytes = undefined,
  contextId = null,
  onOutcome = null,
  onWriterHello = null,
  onSuppressionEnd = null,
  crashBeforeOutcome = null,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
} = {}) {
  if (typeof storeHandle?.materializationTransaction !== 'function') {
    throw new TypeError('demand broker requires a v3 store handle');
  }
  if (typeof resolveRegistration !== 'function') {
    throw new TypeError('demand broker requires resolveRegistration(registration)');
  }
  const ledger = registrationLedger ?? (
    typeof registrationLedgerModule.createRegistrationLedger === 'function'
      ? registrationLedgerModule.createRegistrationLedger({ storeHandle, resolveRegistration })
      : registrationLedgerModule
  );
  for (const method of [
    'applyContextDemands', 'releaseContextDemands', 'registerDurable',
    'releaseDurable', 'effectivePolicy', 'demandState',
  ]) if (typeof ledger?.[method] !== 'function') throw new TypeError(`registration ledger lacks ${method}`);

  const localContextId = contextId ?? mintBrokerIdentifier(randomBytes);
  if (!boundedIdentifier(localContextId)) throw new TypeError('contextId exceeds broker identity bounds');
  const localPairs = new Map();
  let stopped = false;
  let writerGeneration = 0;
  let writer = storeHandle.isWriter?.() === true;
  let heartbeatTimer = null;
  let startingWriter = null;

  const transaction = (mode, operation) => storeHandle.materializationTransaction(mode, (view) => {
    const state = normalizeBrokerState(view.storeMeta.brokerRoster);
    const result = operation(state, view);
    if (mode === 'readwrite') view.storeMeta.brokerRoster = state;
    return result;
  });

  const post = (message) => { if (!stopped) channel?.postMessage?.(clone(message)); };
  const stopHeartbeat = () => {
    if (heartbeatTimer === null) return;
    clearIntervalFn(heartbeatTimer);
    heartbeatTimer = null;
  };
  const ensureHeartbeat = () => {
    if (heartbeatTimer !== null || localPairs.size === 0) return;
    heartbeatTimer = setIntervalFn(() => {
      for (const pair of localPairs.values()) {
        if (writer) void receive(pair);
        else post(pair);
      }
    }, BROKER_LIMITS.heartbeatIntervalMs);
    heartbeatTimer?.unref?.();
  };
  const outcomeMessage = (message, outcome) => Object.freeze({
    format: 'snapback.register-outcome.v1',
    contextId: message.contextId,
    requestId: message.requestId,
    outcome: Object.freeze(outcome),
  });

  const refresh = async (contextIdValue) => transaction('readwrite', (state) => {
    state.heartbeats[contextIdValue] = now();
    if (!state.suppression.active) {
      for (const pair of Object.values(state.pairs)) {
        if (pair.contextId === contextIdValue) pair.lastSeenAt = now();
      }
    }
  });

  const contextRefused = (state, incomingContextId, incomingPair = null) => {
    const contexts = new Set([
      ...Object.keys(state.heartbeats),
      ...Object.values(state.pairs).map((entry) => entry.contextId),
    ]);
    if (!contexts.has(incomingContextId) && contexts.size >= BROKER_LIMITS.liveContextCeiling) {
      return 'SNAPBACK_BROKER_CONTEXT_FULL';
    }
    if (incomingPair !== null && !own(state.pairs, incomingPair)
      && Object.keys(state.pairs).length >= BROKER_LIMITS.livePairCeiling) {
      return 'SNAPBACK_BROKER_PAIR_FULL';
    }
    return null;
  };

  const rememberOutcome = async (message, outcome, releasedTombstone = null) => transaction(
    'readwrite',
    (state) => {
      state.consumedRequests = pushBounded(
        state.consumedRequests,
        { contextId: message.contextId, requestId: message.requestId, outcome: clone(outcome) },
        BROKER_LIMITS.consumedRequestCeiling,
        (entry) => requestKey(entry.contextId, entry.requestId),
      );
      if (releasedTombstone !== null && outcome.kind === 'released') {
        state.releasedRegistrations = pushBounded(
          state.releasedRegistrations,
          clone(releasedTombstone),
          BROKER_LIMITS.releasedRegistrationCeiling,
          (entry) => tombstoneKey(entry.authorityPartitionDigest, entry.registrationId),
        );
        delete state.durableBindings[releasedTombstone.registrationId];
      }
    },
  );

  const finishSuppressionIfComplete = async () => {
    const ended = await transaction('readwrite', (state) => {
      if (!state.suppression.active || state.suppression.unreconciledPairs.length > 0) return false;
      state.suppression = { active: false, helloAt: null, unreconciledPairs: [] };
      return true;
    });
    if (ended) await onSuppressionEnd?.(now());
    return ended;
  };

  const applyAnnounce = async (message) => {
    const key = pairKey(message.contextId, message.authorityPartitionDigest);
    const decision = await transaction('readwrite', (state) => {
      if (state.reapedContexts.includes(message.contextId)) return { ignored: true };
      const refused = contextRefused(state, message.contextId, key);
      if (refused !== null) {
        if (own(state.heartbeats, message.contextId)) state.heartbeats[message.contextId] = now();
        return refusal(refused);
      }
      const prior = state.pairs[key];
      state.heartbeats[message.contextId] = now();
      const confirming = state.suppression.active
        && state.suppression.unreconciledPairs.includes(key);
      if (prior && message.revision <= prior.revision && !confirming) {
        return { ignored: true, heartbeatRefreshed: true };
      }
      // LLP 0166 §D2 handoff reconciliation: a same-revision re-announce for
      // an unreconciled pair is the pair's confirmation — it takes the full
      // apply path so the rebuilt ledger regains the confirmed demand set
      // (the ledger's own release cleared its revision bookkeeping).
      const wasUnreconciled = state.suppression.active
        && state.suppression.unreconciledPairs.includes(key);
      state.pairs[key] = {
        contextId: message.contextId,
        authorityPartitionDigest: message.authorityPartitionDigest,
        revision: message.revision,
        demands: clone(message.demands),
        lastSeenAt: now(),
      };
      if (state.suppression.active) {
        state.suppression.unreconciledPairs = state.suppression.unreconciledPairs
          .filter((entry) => entry !== key);
      }
      return { applied: true, prior: prior ?? null, wasUnreconciled };
    });
    if (decision.applied) {
      try {
        await ledger.applyContextDemands({
          contextId: message.contextId,
          authorityPartitionDigest: message.authorityPartitionDigest,
          revision: message.revision,
          demands: clone(message.demands),
        });
      } catch (error) {
        // LLP 0166 §D2: refusal is message-level everywhere. A registration
        // the seam refuses poisons the WHOLE announce — nothing applies and
        // the revision is not consumed — and must never escape the channel
        // handler as an exception.
        if (typeof error?.code === 'string' && error.code.startsWith('SNAPBACK_')) {
          await transaction('readwrite', (state) => {
            if (decision.prior) state.pairs[key] = decision.prior;
            else delete state.pairs[key];
            if (decision.wasUnreconciled && state.suppression.active
              && !state.suppression.unreconciledPairs.includes(key)) {
              state.suppression.unreconciledPairs.push(key);
            }
            return null;
          });
          return { applied: false, refused: error.code };
        }
        throw error;
      }
      await finishSuppressionIfComplete();
    }
    if (decision.applied) return { applied: true };
    return decision;
  };

  const consumed = async (message) => transaction('readonly', (state) => (
    state.consumedRequests.find((entry) => (
      entry.contextId === message.contextId && entry.requestId === message.requestId
    )) ?? null
  ));

  const handleMutation = async (message, resolved = null) => {
    const replay = await consumed(message);
    if (replay !== null) {
      const outgoing = outcomeMessage(message, replay.outcome);
      post(outgoing);
      onOutcome?.(clone(outgoing));
      return outgoing;
    }
    const capacityRefusal = await transaction('readonly', (state) => (
      contextRefused(state, message.contextId)
    ));
    if (capacityRefusal !== null) {
      const outcome = { kind: 'refused', code: capacityRefusal };
      await rememberOutcome(message, outcome);
      const outgoing = outcomeMessage(message, outcome);
      post(outgoing);
      onOutcome?.(clone(outgoing));
      return outgoing;
    }
    await refresh(message.contextId);
    let outcome;
    let tombstone = null;
    if (message.writerGeneration !== writerGeneration) {
      outcome = { kind: 'refused', code: 'SNAPBACK_BROKER_STALE_WRITER_GENERATION' };
    } else if (message.format === 'snapback.register-forward.v1') {
      const blocked = await transaction('readonly', (state) => state.releasedRegistrations.some((entry) => (
        entry.authorityPartitionDigest === message.authorityPartitionDigest
        && entry.registrationId === message.registration.registrationId
      )));
      if (blocked) outcome = { kind: 'refused', code: 'SNAPBACK_REGISTRATION_RELEASED' };
      else {
        const result = await ledger.registerDurable(clone(message.registration));
        outcome = result?.committed === true
          ? { kind: 'committed' }
          : { kind: 'refused', code: result?.refused?.code ?? 'SNAPBACK_REGISTRATION_REFUSED' };
        if (outcome.kind === 'committed') {
          await transaction('readwrite', (state) => {
            state.durableBindings[message.registration.registrationId] = {
              authorityPartitionDigest: message.authorityPartitionDigest,
              addressKey: resolved?.addressKey ?? null,
            };
          });
        }
      }
    } else {
      const stored = await storeHandle.materializationTransaction('readonly', (view) => (
        Object.values(view.storeMeta.durableRegistrations)
          .map((byId) => byId?.[message.registrationId] ?? null)
          .find((registration) => registration !== null)
          ?? null
      ));
      let storedPartition = null;
      if (stored !== null) {
        try { storedPartition = resolveRegistration(clone(stored)).authorityPartitionDigest; } catch {
          storedPartition = stored._authorityPartitionDigest ?? null;
        }
      }
      if (storedPartition === null) {
        storedPartition = await transaction('readonly', (state) => (
          state.durableBindings[message.registrationId]?.authorityPartitionDigest ?? null
        ));
      }
      if (storedPartition !== null && storedPartition !== message.authorityPartitionDigest) {
        outcome = { kind: 'refused', code: 'SNAPBACK_BROKER_PARTITION_MISMATCH' };
      } else if (admitPartition(message.authorityPartitionDigest) !== true) {
        outcome = { kind: 'refused', code: 'SNAPBACK_BROKER_PARTITION_BLOCKED' };
      } else {
        const result = await ledger.releaseDurable({ registrationId: message.registrationId });
        outcome = result?.released === true
          ? { kind: 'released' }
          : { kind: 'refused', code: 'SNAPBACK_REGISTRATION_RELEASE_REFUSED' };
        if (outcome.kind === 'released') tombstone = {
          authorityPartitionDigest: message.authorityPartitionDigest,
          registrationId: message.registrationId,
        };
      }
    }
    await rememberOutcome(message, outcome, tombstone);
    await crashBeforeOutcome?.({ message: clone(message), outcome: clone(outcome) });
    const outgoing = outcomeMessage(message, outcome);
    post(outgoing);
    onOutcome?.(clone(outgoing));
    return outgoing;
  };

  const receive = async (eventOrMessage) => {
    // Real MessageEvent#data is a prototype getter, not an own property —
    // unwrap by presence-in-chain, never by hasOwn (the carrier-exit browser
    // legs caught the fake-vs-real gap here).
    const message = (eventOrMessage !== null && typeof eventOrMessage === 'object'
      && typeof eventOrMessage.format !== 'string'
      && 'data' in eventOrMessage) ? eventOrMessage.data : eventOrMessage;
    const validation = validateBrokerMessage(message, { resolveRegistration });
    if (validation.refused) return validation;
    const admitted = validation.admitted;
    if (admitted.format === 'snapback.writer-hello.v1') {
      writerGeneration = Math.max(writerGeneration, admitted.writerGeneration);
      for (const pair of localPairs.values()) post(pair);
      await onWriterHello?.(writerGeneration);
      return { applied: true };
    }
    if (admitted.format === 'snapback.register-outcome.v1') {
      if (admitted.contextId === localContextId) onOutcome?.(clone(admitted));
      return { applied: admitted.contextId === localContextId };
    }
    if (!writer && storeHandle.isWriter?.() === true) await refreshWriterRole();
    if (!writer) return { degraded: true, profile: 'volatile-online-v1' };
    const reaped = await transaction('readonly', (state) => state.reapedContexts.includes(admitted.contextId));
    if (reaped) return { ignored: true };
    if (admitted.format === 'snapback.demand-announce.v1') return applyAnnounce(admitted);
    return handleMutation(admitted, validation.resolved ?? null);
  };

  const announce = async ({ authorityPartitionDigest, revision, demands }) => {
    const message = {
      format: 'snapback.demand-announce.v1', contextId: localContextId,
      revision, authorityPartitionDigest, demands: clone(demands),
    };
    const validation = validateBrokerMessage(message, { resolveRegistration });
    if (validation.refused) return validation;
    const key = pairKey(localContextId, authorityPartitionDigest);
    if (demands.length === 0) localPairs.delete(key);
    else localPairs.set(key, message);
    if (localPairs.size === 0) stopHeartbeat();
    else ensureHeartbeat();
    if (writer) return receive(message);
    post(message);
    return { forwarded: channel !== null, degraded: channel === null };
  };

  const forwardRegistration = async ({ registration, requestId = mintBrokerIdentifier(randomBytes) }) => {
    const info = resolveRegistration(clone(registration));
    const message = {
      format: 'snapback.register-forward.v1', contextId: localContextId, requestId,
      writerGeneration, authorityPartitionDigest: info.authorityPartitionDigest,
      registration: clone(registration),
    };
    const validation = validateBrokerMessage(message, { resolveRegistration });
    if (validation.refused) {
      const outgoing = outcomeMessage(message, {
        kind: 'refused',
        code: validation.refused.code,
      });
      onOutcome?.(clone(outgoing));
      return outgoing;
    }
    if (writer) return receive(message);
    post(message);
    return message;
  };

  const releaseRegistration = async ({ authorityPartitionDigest, registrationId, requestId = mintBrokerIdentifier(randomBytes) }) => {
    const message = {
      format: 'snapback.register-release.v1', contextId: localContextId, requestId,
      writerGeneration, authorityPartitionDigest, registrationId,
    };
    const validation = validateBrokerMessage(message, { resolveRegistration });
    if (validation.refused) {
      const outgoing = outcomeMessage(message, {
        kind: 'refused',
        code: validation.refused.code,
      });
      onOutcome?.(clone(outgoing));
      return outgoing;
    }
    if (writer) return receive(message);
    post(message);
    return message;
  };

  const reapContext = async (deadContextId) => {
    const changed = await transaction('readwrite', (state) => {
      const keys = Object.entries(state.pairs)
        .filter(([, pair]) => pair.contextId === deadContextId)
        .map(([key]) => key);
      delete state.heartbeats[deadContextId];
      for (const key of keys) delete state.pairs[key];
      state.suppression.unreconciledPairs = state.suppression.unreconciledPairs
        .filter((key) => !keys.includes(key));
      state.reapedContexts = pushBounded(
        state.reapedContexts, deadContextId, BROKER_LIMITS.reapedContextCeiling, (entry) => entry,
      );
      return keys.length > 0;
    });
    await ledger.releaseContextDemands({ contextId: deadContextId });
    await finishSuppressionIfComplete();
    return changed;
  };

  const maintenance = async () => {
    await refreshWriterRole();
    if (!writer) return;
    const current = now();
    const snapshot = await transaction('readonly', (state) => clone(state));
    if (snapshot.suppression.active) {
      for (const key of snapshot.suppression.unreconciledPairs) {
        if (current - snapshot.suppression.helloAt < BROKER_LIMITS.heartbeatExpiryMs) continue;
        const pair = snapshot.pairs[key];
        if (!pair) continue;
        await transaction('readwrite', (state) => {
          delete state.pairs[key];
          state.suppression.unreconciledPairs = state.suppression.unreconciledPairs
            .filter((entry) => entry !== key);
        });
        await ledger.applyContextDemands({
          contextId: pair.contextId,
          authorityPartitionDigest: pair.authorityPartitionDigest,
          revision: pair.revision + 1,
          demands: [],
        });
      }
      await finishSuppressionIfComplete();
      return;
    }
    for (const [deadContextId, lastSeenAt] of Object.entries(snapshot.heartbeats)) {
      if (current - lastSeenAt >= BROKER_LIMITS.heartbeatExpiryMs) await reapContext(deadContextId);
    }
  };

  const startWriter = async () => {
    if (!writer) return false;
    writerGeneration = await transaction('readwrite', (state, view) => {
      view.storeMeta.generationCounters.writerGeneration += 1;
      const generation = view.storeMeta.generationCounters.writerGeneration;
      const pairs = Object.keys(state.pairs);
      state.suppression = {
        active: pairs.length > 0,
        helloAt: now(),
        unreconciledPairs: pairs,
      };
      return generation;
    });
    // Rebuild only from re-announcements; prior roster demand is protected by
    // suppression, not treated as fresh ledger state.
    const rosterContexts = await transaction('readonly', (state) => (
      [...new Set(Object.values(state.pairs).map((entry) => entry.contextId))]
    ));
    for (const priorContextId of rosterContexts) {
      await ledger.releaseContextDemands({ contextId: priorContextId });
    }
    post({ format: 'snapback.writer-hello.v1', writerGeneration });
    // BroadcastChannel does not deliver to self. A context promoted while it
    // owns an unresolved forwarded mutation must observe the generation change
    // through the same hook as its peers so it can replay that request locally.
    await onWriterHello?.(writerGeneration);
    // A channel never delivers to self: the new writer's own live pairs
    // re-announce locally, applying (or same-revision reconciling) through
    // the identical path a peer's re-announcement takes.
    for (const pair of localPairs.values()) await receive(clone(pair));
    return true;
  };

  // A context may construct while queued behind the current store writer and
  // acquire ownership later. Store ownership is authoritative; the broker
  // promotes exactly once, then enters the ordinary WriterHello/roster
  // reconciliation path instead of inventing a parallel handoff protocol.
  const refreshWriterRole = async () => {
    if (writer || storeHandle.isWriter?.() !== true) return writer;
    if (startingWriter !== null) return startingWriter;
    writer = true;
    startingWriter = startWriter().finally(() => { startingWriter = null; });
    await startingWriter;
    return true;
  };

  const listener = (event) => { void receive(event); };
  const disconnectListener = (event) => {
    const disconnectedContextId = event?.contextId ?? event?.data?.contextId;
    if (writer && boundedIdentifier(disconnectedContextId)) void reapContext(disconnectedContextId);
  };
  channel?.addEventListener?.('message', listener);
  channel?.addEventListener?.('disconnect', disconnectListener);
  writerGeneration = await transaction('readonly', (_state, view) => (
    view.storeMeta.generationCounters.writerGeneration
  ));
  if (!writer && storeHandle.isWriter?.() === true) writer = true;
  await startWriter();

  return Object.freeze({
    contextId: localContextId,
    announce,
    forwardRegistration,
    releaseRegistration,
    receive,
    maintenance,
    reapContext,
    writerGeneration: () => writerGeneration,
    suppressionActive: () => transaction('readonly', (state) => state.suppression.active),
    qualification: () => Object.freeze({
      carrier,
      channel: channel !== null,
      webLocks: lockManager !== null,
      qualified: carrier === 'browser' && channel !== null && lockManager !== null,
      profile: carrier === 'file' && channel === null ? 'volatile-online-v1' : 'durable-fragments-v1',
    }),
    close: async () => {
      if (stopped) return;
      stopped = true;
      stopHeartbeat();
      channel?.removeEventListener?.('message', listener);
      channel?.removeEventListener?.('disconnect', disconnectListener);
      channel?.close?.();
      if (writer) {
        try { await reapContext(localContextId); } catch (error) {
          if (error?.code !== 'SNAPBACK_RQS_STORE_CLOSED') throw error;
        }
      }
    },
  });
}
