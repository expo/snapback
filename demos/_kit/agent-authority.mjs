// Headless agent credential custody and stale-work fencing.
//
// This is deliberately separate from AuthCoordinator: CLI and daemon agents
// own scoped-token custody, while AuthCoordinator owns interactive browser
// session custody and its cross-surface clearing barrier.
//
// @ref LLP 0055#grant-backed-live-and-queued-replay — durable queued work is
// keyed by the grant tuple while live publication is additionally fenced by
// the exact token carrier generation.

import {
  canonicalAgentAuthorityKey,
  deriveServiceAuthorityInstanceId,
} from '../../packages/snapback-contract/auth-coordinator.mjs';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const requireUuid = (value, name) => {
  if (!UUID_V7.test(value ?? '')) throw new TypeError(`${name} must be a UUIDv7`);
  return value;
};

const requireGeneration = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('credentialGeneration must be a non-negative safe integer');
  }
  return value;
};

const requireBearer = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('bearerToken must be a non-empty string');
  }
  return value;
};

const durableAuthority = ({ actorUserId, credentialId, credentialGeneration, grantId }) => (
  Object.freeze({
    kind: 'servicePrincipal',
    authMode: 'sessions',
    actorUserId,
    credentialId,
    credentialGeneration,
    grantId,
  })
);

const authorityCapture = (authorityEpoch, authorityKey, carrierGeneration, tokenId) => (
  Object.freeze({ authorityEpoch, authorityKey, carrierGeneration, tokenId })
);

const sameAuthorityCapture = (left, right) => (
  left !== null
  && right !== null
  && left !== undefined
  && right !== undefined
  && left?.authorityEpoch === right?.authorityEpoch
  && left?.authorityKey === right?.authorityKey
  && left?.carrierGeneration === right?.carrierGeneration
  && left?.tokenId === right?.tokenId
);

const normalizeCredential = (value) => Object.freeze({
  actorUserId: requireUuid(value?.actorUserId, 'actorUserId'),
  credentialId: requireUuid(value?.credentialId, 'credentialId'),
  credentialGeneration: requireGeneration(value?.credentialGeneration),
  grantId: requireUuid(value?.grantId, 'grantId'),
  tokenId: requireUuid(value?.tokenId, 'tokenId'),
  bearerToken: requireBearer(value?.bearerToken),
});

const descriptorKey = (descriptor) => {
  if (
    descriptor?.descriptorVersion !== 1
    || !UUID_V7.test(descriptor?.authorityInstanceId ?? '')
    || descriptor?.sessionGeneration !== 0
  ) {
    throw new TypeError('agent authority descriptor must be a protocol-v1 service descriptor');
  }
  return descriptor.authorityInstanceId;
};

const fenceError = (code, message, details = undefined) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
};

const stale = (message = 'the operation completed under a stale agent authority') => (
  fenceError('SNAPBACK_CLIENT_AUTHORITY_STALE', message)
);

const credentialValidationRequired = () => fenceError(
  'SNAPBACK_CLIENT_AGENT_CREDENTIAL_VALIDATION_REQUIRED',
  'an agent credential must complete a service-principal handshake before durable custody can initialize, adopt, recover, or replace it',
);

const custodyCorrupt = (message, details = undefined) => (
  fenceError('SNAPBACK_AUTH_CUSTODY_CORRUPT', message, details)
);

const clone = (value) => (value === null || value === undefined
  ? value
  : JSON.parse(JSON.stringify(value)));

const exactKeys = (value, expected, where) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw custodyCorrupt(`${where} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw custodyCorrupt(`${where} has an invalid field set`, { fields: actual });
  }
};

const normalizeCustodyId = (value) => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 512
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new TypeError('custodyId must be a stable non-empty string without control characters');
  }
  return value;
};

const normalizeDurableAuthority = (value) => {
  exactKeys(value, [
    'kind',
    'authMode',
    'actorUserId',
    'credentialId',
    'credentialGeneration',
    'grantId',
  ], 'agent custody authority');
  if (value.kind !== 'servicePrincipal' || value.authMode !== 'sessions') {
    throw custodyCorrupt('agent custody authority must be a sessions service principal');
  }
  return durableAuthority({
    actorUserId: requireUuid(value.actorUserId, 'actorUserId'),
    credentialId: requireUuid(value.credentialId, 'credentialId'),
    credentialGeneration: requireGeneration(value.credentialGeneration),
    grantId: requireUuid(value.grantId, 'grantId'),
  });
};

const sameDurableAuthority = (left, right) => (
  left?.kind === right?.kind
  && left?.authMode === right?.authMode
  && left?.actorUserId === right?.actorUserId
  && left?.credentialId === right?.credentialId
  && left?.credentialGeneration === right?.credentialGeneration
  && left?.grantId === right?.grantId
);

const transitionIdFor = ({
  custodyId,
  expectedRevision,
  expectedEpoch,
  expectedAuthorityKey,
  previousStatus,
  nextEpoch,
  nextAuthorityKey,
  nextStatus,
  reason,
  disposition,
}) => `agent-transition-v1:${JSON.stringify({
  custodyId,
  expectedRevision,
  expectedEpoch,
  expectedAuthorityKey,
  previousStatus,
  nextEpoch,
  nextAuthorityKey,
  nextStatus,
  reason,
  disposition,
})}`;

const validateTransition = (value, custodyId) => {
  exactKeys(value, [
    'formatVersion',
    'transitionId',
    'expectedRevision',
    'expectedEpoch',
    'expectedAuthorityKey',
    'previousStatus',
    'previousAuthority',
    'nextEpoch',
    'nextAuthorityKey',
    'nextStatus',
    'nextAuthority',
    'reason',
    'disposition',
  ], 'agent custody transition');
  if (value.formatVersion !== 1) {
    throw custodyCorrupt('agent custody transition formatVersion must be 1');
  }
  const hasPredecessor = value.expectedRevision !== null;
  if (hasPredecessor) {
    if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision <= 0) {
      throw custodyCorrupt('agent custody transition expectedRevision must be positive or null');
    }
    if (!Number.isSafeInteger(value.expectedEpoch) || value.expectedEpoch < 0) {
      throw custodyCorrupt('agent custody transition expectedEpoch must be non-negative');
    }
    if (value.previousStatus !== 'active' && value.previousStatus !== 'deleted') {
      throw custodyCorrupt('agent custody transition previousStatus is invalid');
    }
  } else if (
    value.expectedEpoch !== null
    || value.expectedAuthorityKey !== null
    || value.previousStatus !== null
    || value.previousAuthority !== null
  ) {
    throw custodyCorrupt('fresh agent custody transition must have a null predecessor');
  }
  const previousAuthority = hasPredecessor
    ? normalizeDurableAuthority(value.previousAuthority)
    : null;
  if (
    hasPredecessor
    && canonicalAgentAuthorityKey(previousAuthority) !== value.expectedAuthorityKey
  ) {
    throw custodyCorrupt('agent custody transition predecessor key is inconsistent');
  }
  if (!Number.isSafeInteger(value.nextEpoch) || value.nextEpoch < 0) {
    throw custodyCorrupt('agent custody transition nextEpoch must be non-negative');
  }
  if (
    (hasPredecessor && value.nextEpoch !== value.expectedEpoch + 1)
    || (!hasPredecessor && value.nextEpoch !== 0)
  ) {
    throw custodyCorrupt('agent custody transition epochs must be consecutive (or begin at zero)');
  }
  if (value.nextStatus !== 'active' && value.nextStatus !== 'deleted') {
    throw custodyCorrupt('agent custody transition nextStatus is invalid');
  }
  const nextAuthority = normalizeDurableAuthority(value.nextAuthority);
  if (canonicalAgentAuthorityKey(nextAuthority) !== value.nextAuthorityKey) {
    throw custodyCorrupt('agent custody transition successor key is inconsistent');
  }
  if (hasPredecessor) {
    const validEnding = value.previousStatus === 'active'
      && value.nextStatus === 'deleted'
      && value.expectedAuthorityKey === value.nextAuthorityKey;
    const validReplacement = value.nextStatus === 'active'
      && value.expectedAuthorityKey !== value.nextAuthorityKey;
    if (!validEnding && !validReplacement) {
      throw custodyCorrupt('agent custody transition is neither an exact deletion nor a distinct tuple replacement');
    }
  } else if (value.nextStatus !== 'active') {
    throw custodyCorrupt('fresh agent custody transition cannot initialize deleted authority');
  }
  if (typeof value.reason !== 'string' || value.reason.length === 0) {
    throw custodyCorrupt('agent custody transition reason is missing');
  }
  if (value.disposition !== 'retain' && value.disposition !== 'delete') {
    throw custodyCorrupt('agent custody transition disposition is invalid');
  }
  const normalized = {
    formatVersion: 1,
    transitionId: value.transitionId,
    expectedRevision: value.expectedRevision,
    expectedEpoch: value.expectedEpoch,
    expectedAuthorityKey: value.expectedAuthorityKey,
    previousStatus: value.previousStatus,
    previousAuthority,
    nextEpoch: value.nextEpoch,
    nextAuthorityKey: value.nextAuthorityKey,
    nextStatus: value.nextStatus,
    nextAuthority,
    reason: value.reason,
    disposition: value.disposition,
  };
  if (value.transitionId !== transitionIdFor({ custodyId, ...normalized })) {
    throw custodyCorrupt('agent custody transitionId does not bind its exact target');
  }
  // Validate the partition here too, even though it is not repeated in the
  // intent. This keeps adapter errors attributed to the owning custody row.
  normalizeCustodyId(custodyId);
  return Object.freeze(normalized);
};

const validateCustodyRecord = (value, expectedCustodyId) => {
  exactKeys(value, [
    'formatVersion',
    'custodyId',
    'authorityEpoch',
    'revision',
    'phase',
    'status',
    'authorityKey',
    'authority',
    'transition',
  ], 'agent custody record');
  if (value.formatVersion !== 1) {
    throw custodyCorrupt('agent custody formatVersion must be 1');
  }
  const custodyId = normalizeCustodyId(value.custodyId);
  if (custodyId !== expectedCustodyId) {
    throw custodyCorrupt('agent custody record belongs to a different custodyId');
  }
  if (!Number.isSafeInteger(value.authorityEpoch) || value.authorityEpoch < 0) {
    throw custodyCorrupt('agent custody authorityEpoch must be a safe non-negative integer');
  }
  if (!Number.isSafeInteger(value.revision) || value.revision <= 0) {
    throw custodyCorrupt('agent custody revision must be a safe positive integer');
  }
  if (value.phase !== 'settled' && value.phase !== 'clearing') {
    throw custodyCorrupt('agent custody phase must be settled or clearing');
  }
  if (value.status !== 'active' && value.status !== 'deleted') {
    throw custodyCorrupt('agent custody status must be active or deleted');
  }
  const authority = normalizeDurableAuthority(value.authority);
  const authorityKey = canonicalAgentAuthorityKey(authority);
  if (value.authorityKey !== authorityKey) {
    throw custodyCorrupt('agent custody authorityKey does not bind its durable tuple');
  }
  const transition = value.phase === 'clearing'
    ? validateTransition(value.transition, custodyId)
    : value.transition;
  if (value.phase === 'settled' && transition !== null) {
    throw custodyCorrupt('settled agent custody cannot retain a clearing transition');
  }
  if (value.phase === 'clearing') {
    if (
      transition.nextEpoch !== value.authorityEpoch
      || transition.nextStatus !== value.status
      || transition.nextAuthorityKey !== authorityKey
      || !sameDurableAuthority(transition.nextAuthority, authority)
    ) {
      throw custodyCorrupt('clearing agent custody does not match its transition successor');
    }
    const expectedRevision = transition.expectedRevision === null
      ? 1
      : transition.expectedRevision + 1;
    if (!Number.isSafeInteger(expectedRevision) || value.revision !== expectedRevision) {
      throw custodyCorrupt('clearing agent custody revision does not follow its predecessor');
    }
  }
  return Object.freeze({
    formatVersion: 1,
    custodyId,
    authorityEpoch: value.authorityEpoch,
    revision: value.revision,
    phase: value.phase,
    status: value.status,
    authorityKey,
    authority,
    transition,
  });
};

const custodyRecord = ({
  custodyId,
  authorityEpoch,
  revision,
  phase = 'settled',
  status,
  authority,
  transition = null,
}) => (
  validateCustodyRecord({
    formatVersion: 1,
    custodyId,
    authorityEpoch,
    revision,
    phase,
    status,
    authorityKey: canonicalAgentAuthorityKey(authority),
    authority,
    transition,
  }, custodyId)
);

const sameCustodyRecord = (left, right) => (
  left === null || right === null
    ? left === right
    : left.formatVersion === right.formatVersion
      && left.custodyId === right.custodyId
      && left.authorityEpoch === right.authorityEpoch
      && left.revision === right.revision
      && left.phase === right.phase
      && left.status === right.status
      && left.authorityKey === right.authorityKey
      && sameDurableAuthority(left.authority, right.authority)
      && JSON.stringify(left.transition) === JSON.stringify(right.transition)
);

const custodyTransitionRecords = ({
  custodyId,
  predecessor,
  nextEpoch,
  nextStatus,
  nextAuthority,
  reason,
  disposition,
}) => {
  const clearingRevision = predecessor === null
    ? 1
    : nextSafeCounter(
      predecessor.revision,
      'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
      'agent custody revision',
    );
  const settledRevision = nextSafeCounter(
    clearingRevision,
    'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
    'agent custody revision',
  );
  const nextAuthorityKey = canonicalAgentAuthorityKey(nextAuthority);
  const transition = Object.freeze({
    formatVersion: 1,
    transitionId: transitionIdFor({
      custodyId,
      expectedRevision: predecessor?.revision ?? null,
      expectedEpoch: predecessor?.authorityEpoch ?? null,
      expectedAuthorityKey: predecessor?.authorityKey ?? null,
      previousStatus: predecessor?.status ?? null,
      nextEpoch,
      nextAuthorityKey,
      nextStatus,
      reason,
      disposition,
    }),
    expectedRevision: predecessor?.revision ?? null,
    expectedEpoch: predecessor?.authorityEpoch ?? null,
    expectedAuthorityKey: predecessor?.authorityKey ?? null,
    previousStatus: predecessor?.status ?? null,
    previousAuthority: predecessor?.authority ?? null,
    nextEpoch,
    nextAuthorityKey,
    nextStatus,
    nextAuthority,
    reason,
    disposition,
  });
  const clearing = custodyRecord({
    custodyId,
    authorityEpoch: nextEpoch,
    revision: clearingRevision,
    phase: 'clearing',
    status: nextStatus,
    authority: nextAuthority,
    transition,
  });
  const settled = custodyRecord({
    custodyId,
    authorityEpoch: nextEpoch,
    revision: settledRevision,
    phase: 'settled',
    status: nextStatus,
    authority: nextAuthority,
  });
  return Object.freeze({ transition, clearing, settled });
};

const settledRecordForClearing = (record) => {
  if (record?.phase !== 'clearing') {
    throw custodyCorrupt('agent custody recovery requires a clearing record');
  }
  return custodyRecord({
    custodyId: record.custodyId,
    authorityEpoch: record.authorityEpoch,
    revision: nextSafeCounter(
      record.revision,
      'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
      'agent custody revision',
    ),
    phase: 'settled',
    status: record.status,
    authority: record.authority,
  });
};

const nextSafeCounter = (
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
    throw fenceError(code, `${label} cannot advance without losing comparison identity`);
  }
  return value + 1;
};

const memoryLocks = new WeakMap();

const memoryLockFor = (state, custodyId) => {
  let locks = memoryLocks.get(state);
  if (!locks) {
    locks = new Map();
    memoryLocks.set(state, locks);
  }
  let lock = locks.get(custodyId);
  if (!lock) {
    lock = { tail: Promise.resolve() };
    locks.set(custodyId, lock);
  }
  return lock;
};

/**
 * Deterministic transactional storage for tests and native/headless adapters.
 * Share the same `state` object across fixtures to model independent processes.
 */
export function createMemoryAgentAuthorityCustodyStorage({
  state = { custody: Object.create(null) },
} = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('createMemoryAgentAuthorityCustodyStorage requires a shared state object');
  }
  if (!state.custody || typeof state.custody !== 'object' || Array.isArray(state.custody)) {
    state.custody = Object.create(null);
  }
  return Object.freeze({
    async withOwnership(rawCustodyId, operation) {
      const custodyId = normalizeCustodyId(rawCustodyId);
      if (typeof operation !== 'function') {
        throw new TypeError('agent custody ownership requires an operation callback');
      }
      const lock = memoryLockFor(state, custodyId);
      let release;
      const prior = lock.tail;
      lock.tail = new Promise((resolve) => { release = resolve; });
      await prior;
      let active = true;
      const owner = Object.freeze({
        async read() {
          if (!active) throw fenceError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'agent custody ownership was released');
          const raw = Object.hasOwn(state.custody, custodyId) ? state.custody[custodyId] : null;
          return raw === null ? null : clone(validateCustodyRecord(raw, custodyId));
        },
        async replace(expectedRevision, nextValue) {
          if (!active) throw fenceError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'agent custody ownership was released');
          const currentRaw = Object.hasOwn(state.custody, custodyId) ? state.custody[custodyId] : null;
          const current = currentRaw === null ? null : validateCustodyRecord(currentRaw, custodyId);
          const actualRevision = current?.revision ?? null;
          if (actualRevision !== expectedRevision) {
            throw fenceError(
              'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
              'durable agent custody changed before compare-and-swap',
              { expectedRevision, actualRevision },
            );
          }
          const next = validateCustodyRecord(nextValue, custodyId);
          if (current === null) {
            if (
              next.authorityEpoch !== 0
              || next.revision !== 1
              || next.status !== 'active'
              || (
                next.phase === 'clearing'
                && next.transition.expectedRevision !== null
              )
            ) {
              throw custodyCorrupt('fresh agent custody must begin active at epoch 0 and revision 1');
            }
          } else {
            if (
              current.revision === Number.MAX_SAFE_INTEGER
              || next.revision !== current.revision + 1
            ) {
              throw custodyCorrupt('agent custody replacement must advance revision exactly once');
            }
            if (current.phase === 'settled') {
              if (
                next.phase !== 'clearing'
                || current.authorityEpoch === Number.MAX_SAFE_INTEGER
                || next.authorityEpoch !== current.authorityEpoch + 1
              ) {
                throw custodyCorrupt('settled agent custody must advance into the next clearing epoch');
              }
              if (
                next.transition.expectedRevision !== current.revision
                || next.transition.expectedEpoch !== current.authorityEpoch
                || next.transition.expectedAuthorityKey !== current.authorityKey
                || next.transition.previousStatus !== current.status
                || !sameDurableAuthority(next.transition.previousAuthority, current.authority)
              ) {
                throw custodyCorrupt('agent custody clearing transition does not bind its exact predecessor');
              }
              if (
                current.status === 'deleted'
                && next.status === 'active'
                && current.authorityKey === next.authorityKey
              ) {
                throw custodyCorrupt('deleted agent custody cannot revive the same durable authority tuple');
              }
            } else if (
              next.phase !== 'settled'
              || next.authorityEpoch !== current.authorityEpoch
              || next.status !== current.status
              || next.authorityKey !== current.authorityKey
              || !sameDurableAuthority(next.authority, current.authority)
            ) {
              throw custodyCorrupt('clearing agent custody may only settle its exact successor');
            }
          }
          Object.defineProperty(state.custody, custodyId, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: clone(next),
          });
          return clone(next);
        },
      });
      try {
        return await operation(owner);
      } finally {
        active = false;
        release();
      }
    },
    snapshot(rawCustodyId) {
      const custodyId = normalizeCustodyId(rawCustodyId);
      const raw = Object.hasOwn(state.custody, custodyId) ? state.custody[custodyId] : null;
      return raw === null ? null : clone(validateCustodyRecord(raw, custodyId));
    },
  });
}

export class AgentAuthorityFence {
  #credential;
  #durableKey;
  #durableEpoch = 0;
  #durableRecord = null;
  #storage = null;
  #custodyId = null;
  #publicationOpen = true;
  #carrierGeneration = 0;
  #authorityDescriptor = null;
  #participants = [];
  #barrierGeneration = 0;
  #barrierActive = false;
  #barrierPhase = null;
  #barrierPromise = Promise.resolve();
  #barrierError = null;
  #terminated = false;
  #synchronizing = null;
  #inCommit = false;
  #carrierCounterCeiling;
  #barrierCounterCeiling;
  #handshakeOffers = new WeakSet();
  #terminalCapture = null;
  #terminalHandle = null;
  #terminalDisposition = null;
  #durableDeletionScheduled = false;

  constructor(credential, {
    storage = null,
    custodyId = null,
    volatileCounterCeiling = Number.MAX_SAFE_INTEGER,
    carrierCounterCeiling = volatileCounterCeiling,
    barrierCounterCeiling = volatileCounterCeiling,
  } = {}) {
    this.#credential = normalizeCredential(credential);
    this.#durableKey = canonicalAgentAuthorityKey(this.#credential);
    if (!Number.isSafeInteger(volatileCounterCeiling) || volatileCounterCeiling < 1) {
      throw new TypeError('volatileCounterCeiling must be a positive safe integer');
    }
    if (!Number.isSafeInteger(carrierCounterCeiling) || carrierCounterCeiling < 1) {
      throw new TypeError('carrierCounterCeiling must be a positive safe integer');
    }
    if (!Number.isSafeInteger(barrierCounterCeiling) || barrierCounterCeiling < 1) {
      throw new TypeError('barrierCounterCeiling must be a positive safe integer');
    }
    this.#carrierCounterCeiling = carrierCounterCeiling;
    this.#barrierCounterCeiling = barrierCounterCeiling;
    if (storage === null) {
      if (custodyId !== null) {
        throw new TypeError('custodyId requires transactional agent custody storage');
      }
      return;
    }
    if (typeof storage?.withOwnership !== 'function') {
      throw new TypeError('agent custody storage must provide withOwnership(custodyId, operation)');
    }
    this.#storage = storage;
    this.#custodyId = normalizeCustodyId(custodyId);
    // Durable configurations begin blank. The first synchronization owns
    // initialization/adoption and runs the full local publication barrier.
    this.#publicationOpen = false;
  }

  get hasDurableCustody() {
    return this.#storage !== null;
  }

  get authority() {
    return durableAuthority(this.#credential);
  }

  get authorityDescriptor() {
    return this.#authorityDescriptor === null
      ? null
      : Object.freeze({ ...this.#authorityDescriptor });
  }

  capture() {
    if (this.#inCommit) {
      throw fenceError(
        'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
        'agent custody operations are forbidden inside compareAndCommit',
      );
    }
    if (
      !this.#publicationOpen
      || this.#barrierActive
      || this.#barrierError !== null
      || this.#terminated
    ) {
      throw stale('agent authority custody is not synchronized for publication');
    }
    return this.#captureUnchecked();
  }

  #captureUnchecked() {
    return authorityCapture(
      this.#durableEpoch,
      this.#durableKey,
      this.#carrierGeneration,
      this.#credential.tokenId,
    );
  }

  async synchronize() {
    return this.#synchronizeWithValidation(null);
  }

  async #synchronizeWithValidation(validatedAuthorityInstanceId) {
    if (this.#inCommit) {
      throw fenceError(
        'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
        'agent custody synchronization is forbidden inside compareAndCommit',
      );
    }
    if (this.#synchronizing !== null) {
      const active = this.#synchronizing;
      try {
        return await active;
      } catch (error) {
        if (
          validatedAuthorityInstanceId === null
          || error?.code !== 'SNAPBACK_CLIENT_AGENT_CREDENTIAL_VALIDATION_REQUIRED'
        ) {
          throw error;
        }
        // A validated caller may have joined an unvalidated first-sync read.
        // That read is side-effect free on this diagnostic, so retry it with
        // the caller's service descriptor proof instead of making callers
        // race the internal promise cleanup.
        if (this.#synchronizing === active) this.#synchronizing = null;
      }
    }
    const pending = this.#synchronizeInternal(validatedAuthorityInstanceId);
    this.#synchronizing = pending;
    try {
      return await pending;
    } finally {
      if (this.#synchronizing === pending) this.#synchronizing = null;
    }
  }

  isCurrent(capture) {
    return !this.#terminated
      && this.#publicationOpen
      && !this.#barrierActive
      && this.#barrierError === null
      && capture?.authorityEpoch === this.#durableEpoch
      && capture?.authorityKey === this.#durableKey
      && capture?.carrierGeneration === this.#carrierGeneration
      && capture?.tokenId === this.#credential.tokenId;
  }

  credentialFor(capture) {
    if (!this.isCurrent(capture)) throw stale();
    return Object.freeze({
      bearer: this.#credential.bearerToken,
      tokenId: this.#credential.tokenId,
    });
  }

  credentialOfferForHandshake() {
    if (this.#inCommit) {
      throw fenceError(
        'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
        'agent credential offers are forbidden inside compareAndCommit',
      );
    }
    if (
      this.#terminated
      || this.#barrierActive
      || this.#barrierError !== null
    ) {
      throw stale('agent credential is unavailable during a custody transition');
    }
    if (this.#storage === null && !this.#publicationOpen) {
      throw stale('agent credential is unavailable while publication is closed');
    }
    // @ref LLP 0059#durable-custody-record — this is a narrowly scoped carrier
    // offer for /auth/session validation. It deliberately returns neither an
    // authority capture nor publication permission, and never reads or writes
    // the durable custody record.
    const offer = Object.freeze({
      bearer: this.#credential.bearerToken,
      tokenId: this.#credential.tokenId,
    });
    this.#handshakeOffers.add(offer);
    return offer;
  }

  credentialOfferForReplacement(credential) {
    if (this.#inCommit) {
      throw fenceError(
        'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
        'agent credential replacement offers are forbidden inside compareAndCommit',
      );
    }
    const next = normalizeCredential(credential);
    const previousCapture = this.capture();
    // This is a validation-only carrier offer. It grants no publication or
    // custody mutation authority; replaceCredentialValidated binds the server
    // proof back to this exact predecessor before it can enter a barrier.
    return Object.freeze({
      previousCapture,
      bearer: next.bearerToken,
      tokenId: next.tokenId,
    });
  }

  async synchronizeValidated(descriptor) {
    const authorityInstanceId = descriptorKey(descriptor);
    if (authorityInstanceId !== deriveServiceAuthorityInstanceId(this.#credential)) {
      throw stale('agent handshake descriptor does not match the configured credential');
    }
    return this.#synchronizeWithValidation(authorityInstanceId);
  }

  bindHandshake(capture, descriptor) {
    if (!this.isCurrent(capture)) throw stale();
    const authorityInstanceId = descriptorKey(descriptor);
    if (authorityInstanceId !== deriveServiceAuthorityInstanceId(this.#credential)) {
      throw stale('agent handshake descriptor does not match durable credential/grant custody');
    }
    if (
      this.#authorityDescriptor !== null
      && this.#authorityDescriptor.authorityInstanceId !== authorityInstanceId
    ) {
      throw stale();
    }
    this.#authorityDescriptor = Object.freeze({ ...descriptor });
    return this.capture();
  }

  replaceCredential() {
    throw credentialValidationRequired();
  }

  replaceCredentialValidated(expected, credential, descriptor) {
    const next = normalizeCredential(credential);
    const authorityInstanceId = descriptorKey(descriptor);
    if (authorityInstanceId !== deriveServiceAuthorityInstanceId(next)) {
      throw stale('agent handshake descriptor does not match the proposed credential');
    }
    if (!this.isCurrent(expected)) {
      throw stale('agent authority changed while its replacement carrier was validating');
    }
    return this.#replaceCredentialValidated(next, descriptor);
  }

  #replaceCredentialValidated(next, descriptor) {
    if (
      !this.#publicationOpen
      || this.#barrierActive
      || this.#barrierError
      || this.#terminated
    ) {
      throw stale('agent authority is clearing and cannot replace its credential');
    }
    const nextDurableKey = canonicalAgentAuthorityKey(next);
    const previousCapture = this.#captureUnchecked();
    const previousAuthority = this.authority;
    const durableChanged = nextDurableKey !== this.#durableKey;
    let nextEpoch = this.#durableEpoch;
    let nextCarrierGeneration;
    let targetRecord = this.#durableRecord;
    let durableTransition = null;
    try {
      nextCarrierGeneration = nextSafeCounter(
        this.#carrierGeneration,
        'SNAPBACK_CLIENT_AUTH_CARRIER_GENERATION_EXHAUSTED',
        'agent carrier generation',
        this.#carrierCounterCeiling,
      );
      if (durableChanged) {
        nextEpoch = nextSafeCounter(
          this.#durableEpoch,
          'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
          'agent authority epoch',
        );
        if (this.#storage !== null) {
          if (
            this.#durableRecord === null
            || this.#durableRecord.phase !== 'settled'
            || this.#durableRecord.status !== 'active'
          ) {
            throw stale('durable agent custody must synchronize before tuple replacement');
          }
          durableTransition = custodyTransitionRecords({
            custodyId: this.#custodyId,
            predecessor: this.#durableRecord,
            nextEpoch,
            nextStatus: 'active',
            nextAuthority: durableAuthority(next),
            reason: 'agent_authority_changed',
            disposition: 'delete',
          });
          targetRecord = durableTransition.settled;
        }
      }
    } catch (error) {
      this.#wedgeSync(error, {
        reason: error?.code === 'SNAPBACK_CLIENT_AUTH_CARRIER_GENERATION_EXHAUSTED'
          ? 'agent_carrier_generation_exhausted'
          : error?.code === 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'
            ? 'agent_custody_revision_exhausted'
            : error?.code === 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'
              ? 'agent_authority_epoch_exhausted'
              : 'agent_authority_transition_failed',
        disposition: 'delete',
        authorityDisposition: 'durableDelete',
        previousAuthority,
        nextAuthority: null,
        previousCapture,
        capture: previousCapture,
        expectedEpoch: previousCapture.authorityEpoch,
        nextEpoch: previousCapture.authorityEpoch,
        nextAuthorityKey: previousCapture.authorityKey,
      });
      throw error;
    }
    const capture = authorityCapture(
      nextEpoch,
      nextDurableKey,
      nextCarrierGeneration,
      next.tokenId,
    );
    const nextAuthority = durableAuthority(next);
    const context = Object.freeze({
      capture,
      authority: nextAuthority,
      previousAuthority,
      nextAuthority,
      previousCapture,
      expectedEpoch: previousCapture.authorityEpoch,
      nextEpoch,
      nextAuthorityKey: nextDurableKey,
      disposition: durableChanged ? 'delete' : 'retain',
      ...(durableTransition ? { transitionId: durableTransition.transition.transitionId } : {}),
      reason: durableChanged ? 'agent_authority_changed' : 'agent_token_rotated',
    });
    const barrier = this.#beginBarrier({ clearMemory: durableChanged, context });
    // The visibility cut above happens before either the staged in-memory
    // successor or the asynchronous durable CAS can become observable.
    this.#carrierGeneration = nextCarrierGeneration;
    this.#durableEpoch = nextEpoch;
    this.#durableKey = nextDurableKey;
    this.#authorityDescriptor = Object.freeze({ ...descriptor });
    this.#credential = next;
    this.#terminated = false;
    const prepare = async () => {
      if (this.#storage === null) return null;
      const confirmed = durableChanged
        ? await this.#replaceDurableExact(this.#durableRecord, durableTransition.clearing)
        : await this.#confirmDurableExact(this.#durableRecord);
      this.#installDurableRecord(confirmed);
      return confirmed;
    };
    const settle = async (prepared) => {
      if (this.#storage === null || !durableChanged) return prepared;
      const confirmed = await this.#replaceDurableExact(
        durableTransition.clearing,
        targetRecord,
      );
      this.#installDurableRecord(confirmed);
      return confirmed;
    };
    if (this.#storage === null && barrier.entries.length === 0) {
      this.#completeBarrierImmediate(barrier, { open: true });
    } else {
      this.#finishBarrier(barrier, context, {
        prepare,
        settle,
        commitDurable: durableChanged,
        resume: true,
        open: true,
      });
    }
    return this.#awaitBarrierCapture(capture);
  }

  terminateValidatedCredential(offer, disposition = {}) {
    const authorityDisposition = typeof disposition === 'string'
      ? disposition
      : disposition?.authorityDisposition ?? 'carrier';
    const terminalError = typeof disposition === 'object'
      ? disposition?.terminalError ?? null
      : null;
    if (authorityDisposition !== 'carrier' && authorityDisposition !== 'durableDelete') {
      throw new TypeError('validated closed-custody termination requires carrier or durableDelete');
    }
    if (
      !this.#handshakeOffers.has(offer)
      || offer?.bearer !== this.#credential.bearerToken
      || offer?.tokenId !== this.#credential.tokenId
    ) {
      throw stale('the classified terminal result does not bind the current credential offer');
    }
    if (authorityDisposition === 'durableDelete' && this.#storage === null) {
      throw stale('validated closed-custody termination requires durable custody');
    }
    if (this.#terminalHandle !== null) {
      if (
        authorityDisposition === 'durableDelete'
        && this.#terminalDisposition === 'carrier'
      ) {
        return this.#scheduleDurableDeletion({ previousCapture: null, terminalError });
      }
      return authorityDisposition === this.#terminalDisposition
        ? this.#terminalHandle
        : false;
    }
    if (this.#publicationOpen && !this.#barrierActive && this.#barrierError === null) {
      return this.terminate(this.#captureUnchecked(), { authorityDisposition, terminalError });
    }
    this.#publicationOpen = false;
    this.#terminated = true;
    this.#authorityDescriptor = null;
    const settlement = (async () => {
      await this.#barrierPromise;
      if (this.#barrierError) throw this.#barrierError;
    })();
    void settlement.catch(() => {});
    this.#terminalDisposition = 'carrier';
    this.#terminalHandle = Object.freeze({
      accepted: true,
      authorityDisposition: 'carrier',
      settlement,
    });
    if (authorityDisposition === 'carrier') return this.#terminalHandle;
    return this.#scheduleDurableDeletion({
      previousCapture: null,
      terminalError,
    });
  }

  terminate(capture, disposition = 'carrier') {
    const authorityDisposition = typeof disposition === 'string'
      ? disposition
      : disposition?.authorityDisposition ?? 'carrier';
    const terminalError = typeof disposition === 'object'
      ? disposition?.terminalError ?? null
      : null;
    if (authorityDisposition !== 'carrier' && authorityDisposition !== 'durableDelete') {
      throw new TypeError('agent termination authorityDisposition must be carrier or durableDelete');
    }
    if (sameAuthorityCapture(capture, this.#terminalCapture)) {
      if (
        authorityDisposition === 'durableDelete'
        && this.#terminalDisposition === 'carrier'
      ) {
        return this.#scheduleDurableDeletion({ previousCapture: capture, terminalError });
      }
      return authorityDisposition === this.#terminalDisposition
        ? this.#terminalHandle ?? false
        : false;
    }
    if (!this.isCurrent(capture)) return false;
    // @ref LLP 0055#ending-authority-revocation-expiry-deactivation — a
    // carrier result retires only the exact token generation. A durableDelete
    // additionally advances and tombstones the durable tuple so restart cannot
    // re-admit queued authority under the same grant.
    let nextCarrierGeneration;
    let nextEpoch = this.#durableEpoch;
    let targetRecord = this.#durableRecord;
    let durableTransition = null;
    try {
      nextCarrierGeneration = nextSafeCounter(
        this.#carrierGeneration,
        'SNAPBACK_CLIENT_AUTH_CARRIER_GENERATION_EXHAUSTED',
        'agent carrier generation',
        this.#carrierCounterCeiling,
      );
      if (authorityDisposition === 'durableDelete') {
        nextEpoch = nextSafeCounter(
          this.#durableEpoch,
          'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
          'agent authority epoch',
        );
        if (this.#storage !== null) {
          durableTransition = custodyTransitionRecords({
            custodyId: this.#custodyId,
            predecessor: this.#durableRecord,
            nextEpoch,
            nextStatus: 'deleted',
            nextAuthority: this.#durableRecord.authority,
            reason: 'agent_durable_authority_deleted',
            disposition: 'delete',
          });
          targetRecord = durableTransition.settled;
        }
      }
    } catch (error) {
      this.#wedgeSync(error, {
        reason: error?.code === 'SNAPBACK_CLIENT_AUTH_CARRIER_GENERATION_EXHAUSTED'
          ? 'agent_carrier_generation_exhausted'
          : error?.code === 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'
            ? 'agent_custody_revision_exhausted'
            : error?.code === 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'
              ? 'agent_authority_epoch_exhausted'
              : 'agent_authority_termination_failed',
        disposition: authorityDisposition === 'carrier' ? 'retain' : 'delete',
        authorityDisposition,
        previousAuthority: this.authority,
        nextAuthority: authorityDisposition === 'carrier' ? this.authority : null,
        previousCapture: capture,
        capture,
        expectedEpoch: capture.authorityEpoch,
        nextEpoch: capture.authorityEpoch,
        nextAuthorityKey: capture.authorityKey,
      });
      this.#rememberTerminalFailure(capture, authorityDisposition, error);
      if (authorityDisposition === 'durableDelete') {
        return this.#scheduleDurableDeletion({ previousCapture: capture, terminalError });
      }
      throw error;
    }
    const nextCapture = authorityCapture(
      nextEpoch,
      this.#durableKey,
      nextCarrierGeneration,
      this.#credential.tokenId,
    );
    const previousAuthority = this.authority;
    const context = Object.freeze({
      capture: nextCapture,
      authority: authorityDisposition === 'carrier' ? previousAuthority : null,
      previousAuthority,
      nextAuthority: authorityDisposition === 'carrier' ? previousAuthority : null,
      previousCapture: capture,
      expectedEpoch: capture.authorityEpoch,
      nextEpoch,
      nextAuthorityKey: capture.authorityKey,
      disposition: authorityDisposition === 'carrier' ? 'retain' : 'delete',
      authorityDisposition,
      ...(terminalError ? { terminalError } : {}),
      ...(durableTransition ? { transitionId: durableTransition.transition.transitionId } : {}),
      reason: authorityDisposition === 'carrier'
        ? 'agent_carrier_terminated'
        : 'agent_durable_authority_deleted',
    });
    let barrier;
    try {
      barrier = this.#beginBarrier({
        clearMemory: true,
        context,
        deferSyncError: true,
      });
    } catch (error) {
      this.#rememberTerminalFailure(capture, authorityDisposition, error);
      if (authorityDisposition === 'durableDelete') {
        return this.#scheduleDurableDeletion({ previousCapture: capture, terminalError });
      }
      throw error;
    }
    this.#carrierGeneration = nextCapture.carrierGeneration;
    this.#durableEpoch = nextEpoch;
    this.#authorityDescriptor = null;
    this.#terminated = true;
    const prepare = async () => {
      if (this.#storage === null) return null;
      const confirmed = authorityDisposition === 'durableDelete'
        ? await this.#replaceDurableExact(this.#durableRecord, durableTransition.clearing)
        : await this.#confirmDurableExact(this.#durableRecord);
      this.#installDurableRecord(confirmed);
      this.#terminated = true;
      return confirmed;
    };
    const settle = async (prepared) => {
      if (this.#storage === null || authorityDisposition !== 'durableDelete') return prepared;
      const confirmed = await this.#replaceDurableExact(
        durableTransition.clearing,
        targetRecord,
      );
      this.#installDurableRecord(confirmed);
      this.#terminated = true;
      return confirmed;
    };
    if (
      this.#storage === null
      && barrier.entries.length === 0
      && barrier.syncError === null
    ) {
      this.#completeBarrierImmediate(barrier, { open: false });
    } else {
      this.#finishBarrier(barrier, context, {
        prepare,
        settle,
        commitDurable: authorityDisposition === 'durableDelete',
        resume: false,
        open: false,
      });
    }
    const barrierPromise = this.#barrierPromise;
    const settlement = this.#awaitTerminationSettlement({
      barrier,
      barrierPromise,
      expectedRecord: targetRecord,
    });
    // WebSocket terminal handling is deliberately best-effort and may ignore
    // the handle after the synchronous confidentiality cut. Mark the Promise
    // observed without changing what an HTTP caller receives when it awaits.
    void settlement.catch(() => {});
    const handle = Object.freeze({
      accepted: true,
      authorityDisposition,
      settlement,
    });
    this.#terminalCapture = capture;
    this.#terminalDisposition = authorityDisposition;
    if (authorityDisposition === 'durableDelete') this.#durableDeletionScheduled = true;
    this.#terminalHandle = handle;
    return handle;
  }

  #rememberTerminalFailure(capture, authorityDisposition, error) {
    const settlement = Promise.reject(error);
    void settlement.catch(() => {});
    const handle = Object.freeze({
      accepted: true,
      authorityDisposition,
      settlement,
    });
    this.#publicationOpen = false;
    this.#terminated = true;
    this.#authorityDescriptor = null;
    this.#terminalCapture = capture;
    this.#terminalDisposition = authorityDisposition;
    this.#terminalHandle = handle;
    return handle;
  }

  #scheduleDurableDeletion({ previousCapture, terminalError }) {
    if (this.#durableDeletionScheduled && this.#terminalHandle) {
      return this.#terminalHandle;
    }
    const predecessorSettlement = this.#terminalHandle?.settlement ?? Promise.resolve();
    const settlement = (async () => {
      let predecessorError = null;
      try {
        await predecessorSettlement;
      } catch (error) {
        predecessorError = error;
      }
      // A failed carrier cut is already permanently closed. Preserve its
      // eventual public error, but do not let that local callback failure veto
      // a later exact server-classified durable tombstone.
      if (this.#barrierError !== null) {
        this.#barrierError = null;
        this.#barrierActive = false;
        this.#barrierPhase = null;
      }
      await this.#deleteConfiguredDurableAuthority({ previousCapture, terminalError });
      if (predecessorError) throw predecessorError;
    })();
    void settlement.catch(() => {});
    const handle = Object.freeze({
      accepted: true,
      authorityDisposition: 'durableDelete',
      settlement,
    });
    if (previousCapture !== null && this.#terminalCapture === null) {
      this.#terminalCapture = previousCapture;
    }
    this.#durableDeletionScheduled = true;
    this.#terminalDisposition = 'durableDelete';
    this.#terminalHandle = handle;
    return handle;
  }

  async #deleteConfiguredDurableAuthority({ previousCapture, terminalError }) {
    if (this.#storage === null) return;
    const observed = await this.#readDurable();
    if (observed === null) {
      this.#publicationOpen = false;
      this.#terminated = true;
      return;
    }
    if (
      observed.authorityKey !== this.#durableKey
      || !sameDurableAuthority(observed.authority, this.authority)
    ) {
      throw stale('classified durable deletion does not match the observed configured tuple');
    }
    this.#durableRecord = observed;
    this.#durableEpoch = observed.authorityEpoch;
    this.#durableKey = observed.authorityKey;
    this.#publicationOpen = false;
    this.#terminated = true;
    this.#authorityDescriptor = null;
    if (observed.phase === 'settled' && observed.status === 'deleted') return;

    if (observed.phase === 'clearing' && observed.status === 'active') {
      let recovered;
      try {
        recovered = settledRecordForClearing(observed);
      } catch (error) {
        this.#failTerminalDurable(error);
        throw error;
      }
      const transition = observed.transition;
      // This intent already replaced its predecessor. Replaying its exact
      // durable participant is required before another transition may use the
      // successor as a CAS predecessor. Publication remains permanently closed
      // throughout; recovery does not resurrect the classified credential.
      const recoveryContext = Object.freeze({
        capture: authorityCapture(
          recovered.authorityEpoch,
          recovered.authorityKey,
          this.#carrierGeneration,
          this.#credential.tokenId,
        ),
        authority: transition.nextAuthority,
        previousAuthority: transition.previousAuthority,
        nextAuthority: transition.nextAuthority,
        previousCapture,
        expectedEpoch: transition.expectedEpoch,
        nextEpoch: transition.nextEpoch,
        nextAuthorityKey: transition.nextAuthorityKey,
        disposition: transition.disposition,
        transitionId: transition.transitionId,
        reason: transition.reason,
      });
      await this.#runTerminalDurableTransition({
        observed,
        clearing: observed,
        target: recovered,
        context: recoveryContext,
      });
      return this.#deleteConfiguredDurableAuthority({ previousCapture, terminalError });
    }

    let clearing;
    let target;
    if (observed.phase === 'clearing') {
      try {
        target = settledRecordForClearing(observed);
      } catch (error) {
        this.#failTerminalDurable(error);
        throw error;
      }
      clearing = observed;
    } else if (observed.status === 'active') {
      try {
        const nextEpoch = nextSafeCounter(
          observed.authorityEpoch,
          'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
          'agent authority epoch',
        );
        const transition = custodyTransitionRecords({
          custodyId: this.#custodyId,
          predecessor: observed,
          nextEpoch,
          nextStatus: 'deleted',
          nextAuthority: observed.authority,
          reason: 'agent_durable_authority_deleted_after_validation',
          disposition: 'delete',
        });
        clearing = transition.clearing;
        target = transition.settled;
      } catch (error) {
        this.#failTerminalDurable(error);
        throw error;
      }
    } else {
      throw stale('classified durable deletion found an invalid durable status');
    }

    const transition = clearing.transition;
    const context = Object.freeze({
      capture: previousCapture,
      authority: null,
      previousAuthority: transition.previousAuthority,
      nextAuthority: null,
      previousCapture,
      expectedEpoch: transition.expectedEpoch,
      nextEpoch: transition.nextEpoch,
      nextAuthorityKey: transition.nextAuthorityKey,
      disposition: transition.disposition,
      authorityDisposition: 'durableDelete',
      ...(terminalError ? { terminalError } : {}),
      transitionId: transition.transitionId,
      reason: transition.reason,
    });
    await this.#runTerminalDurableTransition({ observed, clearing, target, context });
  }

  async #runTerminalDurableTransition({ observed, clearing, target, context }) {
    const barrier = this.#beginBarrier({
      clearMemory: false,
      context,
      deferSyncError: true,
      skipLocalPhases: true,
    });
    const prepare = async () => {
      const confirmed = observed.phase === 'clearing'
        ? await this.#confirmDurableExact(clearing)
        : await this.#replaceDurableExact(observed, clearing);
      this.#installDurableRecord(confirmed);
      this.#terminated = true;
      return confirmed;
    };
    const settle = async () => {
      const confirmed = await this.#replaceDurableExact(clearing, target);
      this.#installDurableRecord(confirmed);
      this.#terminated = true;
      return confirmed;
    };
    this.#finishBarrier(barrier, context, {
      prepare,
      settle,
      commitDurable: true,
      resume: false,
      open: false,
    });
    await this.#awaitTerminationSettlement({
      barrier,
      barrierPromise: this.#barrierPromise,
      expectedRecord: target,
    });
  }

  #failTerminalDurable(error) {
    this.#publicationOpen = false;
    this.#terminated = true;
    this.#authorityDescriptor = null;
    this.#barrierActive = true;
    this.#barrierPhase = 'failed';
    this.#barrierError = error;
    this.#barrierPromise = Promise.resolve();
  }

  compareAndCommit(capture, commit) {
    if (typeof commit !== 'function') {
      throw new TypeError('compareAndCommit requires a commit callback');
    }
    if (!this.isCurrent(capture)) return Promise.resolve({ committed: false });
    if (this.#storage === null) {
      const value = commit(Object.freeze({
        ...capture,
        authorityDescriptor: this.authorityDescriptor,
      }));
      if (value && typeof value.then === 'function') {
        throw new TypeError('compareAndCommit callback must be synchronous');
      }
      return Promise.resolve({ committed: true, value });
    }
    return this.#compareAndCommitDurable(capture, commit);
  }

  registerParticipant(participant) {
    if (!participant || typeof participant !== 'object') {
      throw new TypeError('participant must be an object');
    }
    if (this.#barrierActive || this.#barrierError || this.#terminated) {
      throw stale('agent authority is unavailable for participant registration');
    }
    // Agent replacement and terminal loss are synchronous carrier cuts. Their
    // local participants must therefore finish quiescence before this method
    // can synchronously blank every boundary. Browser AuthCoordinator retains
    // the broader awaited participant contract for cross-context transitions.
    for (const method of ['quiesce', 'blank', 'clearMemory']) {
      if (participant[method]?.constructor?.name === 'AsyncFunction') {
        throw new TypeError(`agent authority participant ${method}() must be synchronous`);
      }
    }
    const entry = { participant, removed: false };
    this.#participants.push(entry);
    if (!this.#publicationOpen && this.#storage !== null && this.#durableRecord === null) {
      let firstError = null;
      for (const method of ['quiesce', 'blank']) {
        try {
          this.#invokeSyncParticipant(participant, method, Object.freeze({
            reason: 'agent_custody_initializing',
            disposition: 'retain',
            authorityDisposition: 'carrier',
          }));
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError) {
        this.#barrierError = firstError;
        this.#barrierPhase = 'failed';
        throw firstError;
      }
    }
    return async () => {
      entry.removed = true;
      await this.#barrierPromise;
      this.#participants = this.#participants.filter((candidate) => candidate !== entry);
    };
  }

  #beginBarrier({
    clearMemory,
    context,
    deferSyncError = false,
    skipLocalPhases = false,
  }) {
    if (this.#barrierActive) {
      throw stale('an agent authority transition is already active');
    }
    const entries = this.#participants.filter((entry) => !entry.removed);
    if (skipLocalPhases) {
      if (!this.#terminated || this.#publicationOpen) {
        throw stale('a terminal-only durable barrier requires permanently closed publication');
      }
      // The exact durable transitionId/CAS predecessor is the identity for
      // this closed-custody operation. It must remain available even after the
      // volatile local barrier counter is exhausted; no local phase can be
      // admitted or replayed through this path.
      this.#barrierActive = true;
      this.#publicationOpen = false;
      this.#barrierPhase = 'preparing-durable';
      return {
        entries,
        generation: null,
        syncError: null,
        terminalOnly: true,
      };
    }
    try {
      this.#barrierGeneration = nextSafeCounter(
        this.#barrierGeneration,
        'SNAPBACK_CLIENT_AUTH_BARRIER_GENERATION_EXHAUSTED',
        'agent barrier generation',
        this.#barrierCounterCeiling,
      );
    } catch (error) {
      // An exhausted barrier id cannot be reused, but confidentiality still
      // requires an immediate visibility cut. There is no successor barrier
      // to resume: close publication permanently and attempt every local
      // quiesce/blank/clear callback before surfacing the stable diagnostic.
      this.#barrierActive = true;
      this.#publicationOpen = false;
      this.#barrierPhase = 'quiescing';
      for (const { participant } of entries) {
        try { this.#invokeSyncParticipant(participant, 'quiesce', context); } catch { /* preserve counter failure */ }
      }
      this.#barrierPhase = 'blanking';
      for (const { participant } of entries) {
        try { this.#invokeSyncParticipant(participant, 'blank', context); } catch { /* preserve counter failure */ }
      }
      if (clearMemory) {
        this.#barrierPhase = 'clearing-memory';
        for (const { participant } of entries) {
          try { this.#invokeSyncParticipant(participant, 'clearMemory', context); } catch { /* preserve counter failure */ }
        }
      }
      this.#barrierError = error;
      this.#barrierPhase = 'failed';
      this.#barrierPromise = Promise.resolve();
      throw error;
    }
    const generation = this.#barrierGeneration;
    this.#barrierActive = true;
    this.#publicationOpen = false;
    this.#barrierPhase = 'quiescing';
    // @ref LLP 0059#transition-barrier — even this local carrier-only owner
    // completes quiescence before synchronous blanking; otherwise an in-flight
    // callback could repopulate a boundary after the terminal cut returned.
    let firstError = null;
    const invoke = (participant, method) => {
      try {
        return this.#invokeSyncParticipant(participant, method, context);
      } catch (error) {
        firstError ??= error;
        return undefined;
      }
    };
    for (const { participant } of entries) {
      invoke(participant, 'quiesce');
    }
    // A throwing participant cannot veto confidentiality for every surface.
    // The active fence already rejects new publication; continue through all
    // synchronous blank/clear callbacks, then wedge and surface the first
    // failure without changing the credential.
    this.#barrierPhase = 'blanking';
    for (const { participant } of entries) invoke(participant, 'blank');
    if (clearMemory) {
      this.#barrierPhase = 'clearing-memory';
      for (const { participant } of entries) invoke(participant, 'clearMemory');
    }
    if (firstError) {
      if (!deferSyncError) {
        this.#barrierError = firstError;
        this.#barrierPhase = 'failed';
        throw firstError;
      }
    }
    return { entries, generation, syncError: firstError };
  }

  #finishBarrier(barrier, context, {
    prepare,
    settle = async (record) => record,
    commitDurable,
    resume,
    open,
  }) {
    const frozenContext = Object.freeze({ ...context });
    const ownsBarrier = () => barrier.terminalOnly === true
      ? this.#barrierActive
      : barrier.generation === this.#barrierGeneration;
    const complete = async () => {
      let durableRecord = await prepare();
      if (commitDurable) {
        this.#barrierPhase = 'committing-durable';
        for (const { participant } of barrier.entries) {
          await participant.commitDurable?.(frozenContext);
        }
      }
      this.#barrierPhase = 'settling-durable';
      durableRecord = await settle(durableRecord);
      if (resume && this.#terminalDisposition === null) {
        this.#barrierPhase = 'resuming';
        for (const { participant } of [...barrier.entries].reverse()) {
          await participant.resume?.(frozenContext);
        }
      }
      if (this.#storage !== null && durableRecord !== null) {
        this.#barrierPhase = 'confirming-durable';
        await this.#confirmDurableExact(durableRecord);
      }
      // Terminal deletion deliberately continues through its durable phases
      // after a synchronous participant failure. The tombstone may settle,
      // but the public settlement must still reject so callers never mistake
      // a partially failed local cut for a clean terminal transition.
      if (barrier.syncError) throw barrier.syncError;
      if (ownsBarrier()) {
        this.#barrierActive = false;
        this.#barrierPhase = null;
        this.#publicationOpen = open && !this.#terminated;
      }
    };
    this.#barrierPromise = complete().catch((error) => {
      if (ownsBarrier()) {
        this.#barrierError = error;
        this.#barrierActive = true;
        this.#publicationOpen = false;
        this.#barrierPhase = 'failed';
        if (barrier.terminalOnly !== true) {
          for (const { participant } of barrier.entries) {
            try { this.#invokeSyncParticipant(participant, 'blank', frozenContext); } catch { /* preserve first failure */ }
          }
        }
      }
    });
  }

  #completeBarrierImmediate(barrier, { open }) {
    if (barrier.generation !== this.#barrierGeneration) return;
    this.#barrierActive = false;
    this.#barrierPhase = null;
    this.#publicationOpen = open && !this.#terminated;
    this.#barrierPromise = Promise.resolve();
  }

  async #awaitBarrierCapture(expected) {
    await this.#barrierPromise;
    if (this.#barrierError) throw this.#barrierError;
    if (this.#terminated || !this.isCurrent(expected)) {
      throw stale('agent authority transition did not settle on its exact successor');
    }
    return this.#captureUnchecked();
  }

  async #awaitTerminationSettlement({ barrier, barrierPromise, expectedRecord }) {
    await barrierPromise;
    if (this.#barrierError) throw this.#barrierError;
    if (
      (barrier.terminalOnly !== true && barrier.generation !== this.#barrierGeneration)
      || this.#barrierActive
      || !this.#terminated
      || this.#publicationOpen
    ) {
      throw stale('agent terminal authority did not complete its exact local barrier');
    }
    // The barrier already confirms its final durable state under ownership.
    // Reread once more at the public settlement boundary so a resolved handle
    // is an exact statement about the tombstone/retained record, rather than
    // merely an observation that participant callbacks stopped running.
    if (this.#storage !== null && expectedRecord !== null) {
      await this.#confirmDurableExact(expectedRecord);
    }
  }

  #invokeSyncParticipant(participant, method, context) {
    if (typeof participant?.[method] !== 'function') return undefined;
    const result = participant[method](context);
    if (result && typeof result.then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw new TypeError(`agent authority participant ${method}() must be synchronous`);
    }
    return result;
  }

  #wedgeSync(error, context) {
    if (!this.#barrierActive) {
      try {
        this.#beginBarrier({ clearMemory: true, context: Object.freeze({ ...context }) });
      } catch {
        // The original counter/custody failure owns the stable diagnosis.
      }
    }
    this.#publicationOpen = false;
    this.#barrierActive = true;
    this.#barrierPhase = 'failed';
    this.#barrierError = error;
    this.#barrierPromise = Promise.resolve();
  }

  async #synchronizeInternal(validatedAuthorityInstanceId) {
    if (this.#barrierActive) {
      await this.#barrierPromise;
      if (this.#barrierError) throw this.#barrierError;
      if (this.#terminated) throw stale('durable agent authority has terminated');
      return this.capture();
    }
    if (this.#barrierError) throw this.#barrierError;
    if (this.#terminated) throw stale('agent authority has terminated');
    if (this.#storage === null) {
      return this.capture();
    }

    let observed;
    try {
      observed = await this.#readDurable();
    } catch (error) {
      this.#wedgeSync(error, {
        reason: 'agent_custody_read_failed',
        disposition: 'delete',
        previousAuthority: this.authority,
        nextAuthority: null,
        previousCapture: this.#captureUnchecked(),
        capture: this.#captureUnchecked(),
        expectedEpoch: this.#durableEpoch,
        nextEpoch: this.#durableEpoch,
        nextAuthorityKey: this.#durableKey,
      });
      throw error;
    }

    if (
      this.#durableRecord !== null
      && this.#publicationOpen
      && sameCustodyRecord(observed, this.#durableRecord)
    ) {
      if (observed.phase !== 'settled' || observed.status === 'deleted') {
        this.#terminated = true;
        this.#publicationOpen = false;
        throw stale('durable agent authority is not settled and active');
      }
      return this.#captureUnchecked();
    }

    let plan;
    try {
      plan = this.#synchronizationPlan(observed, validatedAuthorityInstanceId);
    } catch (error) {
      if (error?.code === 'SNAPBACK_CLIENT_AGENT_CREDENTIAL_VALIDATION_REQUIRED') {
        // The configured bearer remains usable only for the narrow handshake
        // offer. Publication stays closed and, critically, settled predecessor
        // custody remains byte-for-byte untouched.
        this.#publicationOpen = false;
        throw error;
      }
      this.#wedgeSync(error, {
        reason: 'agent_custody_synchronization_failed',
        disposition: 'delete',
        previousAuthority: this.authority,
        nextAuthority: null,
        previousCapture: this.#captureUnchecked(),
        capture: this.#captureUnchecked(),
        expectedEpoch: this.#durableEpoch,
        nextEpoch: this.#durableEpoch,
        nextAuthorityKey: this.#durableKey,
      });
      throw error;
    }
    await this.#executeSynchronizationPlan(plan);
    if (this.#barrierError) throw this.#barrierError;
    if (this.#terminated) throw stale('durable agent authority is deleted');
    return this.capture();
  }

  #synchronizationPlan(observed, validatedAuthorityInstanceId) {
    const desiredAuthority = this.authority;
    const desiredKey = this.#durableKey;
    const desiredIsValidated = validatedAuthorityInstanceId
      === deriveServiceAuthorityInstanceId(this.#credential);
    const desiredMatches = observed !== null
      && observed.authorityKey === desiredKey
      && sameDurableAuthority(observed.authority, desiredAuthority);

    // A process with no locally established durable record has no authority
    // to initialize, adopt, recover, or replace custody until the exact bearer
    // has completed a protocol-v1 service-principal handshake. Merely knowing
    // the durable tuple is not proof that its current carrier is valid.
    if (this.#durableRecord === null && !desiredIsValidated) {
      throw credentialValidationRequired();
    }

    if (observed?.phase === 'clearing') {
      if (!desiredMatches) {
        return {
          observed,
          target: observed,
          reason: 'agent_custody_clearing_mismatch',
          disposition: 'delete',
          error: stale('durable agent custody is clearing toward a tuple unavailable in this process'),
        };
      }
      return {
        observed,
        clearing: observed,
        target: settledRecordForClearing(observed),
        writeClearing: false,
        commitDurable: true,
        transition: observed.transition,
        reason: observed.transition.reason,
        disposition: observed.transition.disposition,
      };
    }

    if (this.#durableRecord === null) {
      if (observed === null) {
        return {
          observed,
          target: custodyRecord({
            custodyId: this.#custodyId,
            authorityEpoch: 0,
            revision: 1,
            phase: 'settled',
            status: 'active',
            authority: desiredAuthority,
          }),
          writeDirect: true,
          commitDurable: false,
          reason: 'agent_custody_initialized',
          disposition: 'retain',
        };
      }
      if (desiredMatches) {
        return {
          observed,
          target: observed,
          commitDurable: false,
          reason: observed.status === 'deleted'
            ? 'agent_custody_deleted_restart'
            : 'agent_custody_restart_adopted',
          disposition: observed.status === 'deleted' ? 'delete' : 'retain',
        };
      }
      const nextEpoch = nextSafeCounter(
        observed.authorityEpoch,
        'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
        'agent authority epoch',
      );
      const transition = custodyTransitionRecords({
        custodyId: this.#custodyId,
        predecessor: observed,
        nextEpoch,
        nextStatus: 'active',
        nextAuthority: desiredAuthority,
        reason: 'agent_custody_restart_replaced',
        disposition: 'delete',
      });
      return {
        observed,
        clearing: transition.clearing,
        target: transition.settled,
        writeClearing: true,
        commitDurable: true,
        transition: transition.transition,
        reason: 'agent_custody_restart_replaced',
        disposition: 'delete',
      };
    }

    if (desiredMatches) {
      return {
        observed,
        target: observed,
        commitDurable: !sameCustodyRecord(observed, this.#durableRecord),
        reason: observed.status === 'deleted'
          ? 'agent_custody_peer_deleted'
          : 'agent_custody_peer_adopted',
        disposition: observed.status === 'deleted' ? 'delete' : 'delete',
      };
    }

    return {
      observed,
      target: observed,
      write: false,
      reason: 'agent_custody_peer_mismatch',
      disposition: 'delete',
      error: stale('durable agent custody changed to a tuple unavailable in this process'),
    };
  }

  async #executeSynchronizationPlan(plan) {
    const previousRecord = this.#durableRecord;
    const contextPredecessor = previousRecord ?? plan.observed;
    const target = plan.target;
    const targetEpoch = target?.authorityEpoch ?? this.#durableEpoch;
    const targetKey = target?.authorityKey ?? this.#durableKey;
    const targetIsDesired = target !== null
      && target.authorityKey === this.#durableKey
      && sameDurableAuthority(target.authority, this.authority);
    const nextAuthority = targetIsDesired && target.status === 'active' ? this.authority : null;
    const context = Object.freeze({
      capture: authorityCapture(
        targetEpoch,
        targetKey,
        this.#carrierGeneration,
        this.#credential.tokenId,
      ),
      authority: nextAuthority,
      previousAuthority: plan.transition
        ? plan.transition.previousAuthority
        : contextPredecessor?.status === 'active'
          ? contextPredecessor.authority
          : null,
      nextAuthority,
      previousCapture: this.#captureUnchecked(),
      expectedEpoch: plan.transition?.expectedEpoch
        ?? previousRecord?.authorityEpoch
        ?? plan.observed?.authorityEpoch
        ?? targetEpoch,
      nextEpoch: targetEpoch,
      nextAuthorityKey: targetKey,
      disposition: plan.disposition,
      ...(plan.transition ? { transitionId: plan.transition.transitionId } : {}),
      ...(target?.status === 'deleted' ? { authorityDisposition: 'durableDelete' } : {}),
      reason: plan.reason,
    });
    const barrier = this.#beginBarrier({ clearMemory: true, context });
    const prepare = async () => {
      if (plan.error) throw plan.error;
      const confirmed = plan.clearing
        ? plan.writeClearing
          ? await this.#replaceDurableExact(plan.observed, plan.clearing)
          : await this.#confirmDurableExact(plan.clearing)
        : plan.writeDirect
          ? await this.#replaceDurableExact(plan.observed, target)
          : await this.#confirmDurableExact(target);
      this.#installDurableRecord(confirmed);
      return confirmed;
    };
    const settle = async (prepared) => {
      if (!plan.clearing) return prepared;
      const confirmed = await this.#replaceDurableExact(plan.clearing, target);
      this.#installDurableRecord(confirmed);
      return confirmed;
    };
    this.#finishBarrier(barrier, context, {
      prepare,
      settle,
      commitDurable: plan.commitDurable === true,
      resume: target?.status === 'active' && !plan.error,
      open: target?.status === 'active' && !plan.error,
    });
    await this.#barrierPromise;
  }

  async #readDurable() {
    return this.#storage.withOwnership(this.#custodyId, async (owner) => {
      if (!owner || typeof owner.read !== 'function' || typeof owner.replace !== 'function') {
        throw new TypeError('agent custody owner must provide read() and replace()');
      }
      const value = await owner.read();
      return value === null ? null : validateCustodyRecord(value, this.#custodyId);
    });
  }

  async #confirmDurableExact(expected) {
    if (expected === null) {
      throw custodyCorrupt('agent custody confirmation requires an exact target record');
    }
    return this.#storage.withOwnership(this.#custodyId, async (owner) => {
      const currentValue = await owner.read();
      const current = currentValue === null
        ? null
        : validateCustodyRecord(currentValue, this.#custodyId);
      if (!sameCustodyRecord(current, expected)) {
        throw stale('durable agent custody changed before exact confirmation');
      }
      return current;
    });
  }

  async #replaceDurableExact(expected, target) {
    let firstError;
    try {
      return await this.#storage.withOwnership(this.#custodyId, async (owner) => {
        const currentValue = await owner.read();
        const current = currentValue === null
          ? null
          : validateCustodyRecord(currentValue, this.#custodyId);
        if (sameCustodyRecord(current, target)) return current;
        if (!sameCustodyRecord(current, expected)) {
          throw stale('durable agent custody no longer matches the exact CAS predecessor');
        }
        const replaced = await owner.replace(expected?.revision ?? null, clone(target));
        const validated = validateCustodyRecord(replaced, this.#custodyId);
        if (!sameCustodyRecord(validated, target)) {
          throw custodyCorrupt('agent custody CAS returned a record other than its exact target');
        }
        return validated;
      });
    } catch (error) {
      firstError = error;
    }

    // A storage adapter may throw after its transaction committed but before
    // the response reached this process. Only an exact target reread converts
    // that ambiguous outcome to success; every other shape preserves failure.
    try {
      const confirmed = await this.#confirmDurableExact(target);
      if (sameCustodyRecord(confirmed, target)) return confirmed;
    } catch (confirmationError) {
      if (confirmationError?.code !== 'SNAPBACK_CLIENT_AUTHORITY_STALE') {
        throw fenceError(
          'SNAPBACK_AUTH_CUSTODY_AMBIGUOUS',
          'agent custody CAS failed and its exact target could not be confirmed',
          {
            causeCode: firstError?.code ?? null,
            confirmationCode: confirmationError?.code ?? null,
          },
        );
      }
    }
    throw firstError;
  }

  #installDurableRecord(record) {
    const validated = validateCustodyRecord(record, this.#custodyId);
    if (
      validated.authorityKey !== this.#durableKey
      || !sameDurableAuthority(validated.authority, this.authority)
    ) {
      throw stale('durable agent custody does not match the process credential tuple');
    }
    this.#durableRecord = validated;
    this.#durableEpoch = validated.authorityEpoch;
    this.#durableKey = validated.authorityKey;
    if (validated.phase === 'clearing') this.#authorityDescriptor = null;
    if (validated.status === 'deleted') {
      this.#authorityDescriptor = null;
      this.#terminated = true;
    } else if (this.#terminalDisposition === null) {
      this.#terminated = false;
    }
  }

  async #compareAndCommitDurable(capture, commit) {
    let durableMismatch = false;
    let observedMismatch = null;
    let callbackInvoked = false;
    try {
      const result = await this.#storage.withOwnership(this.#custodyId, async (owner) => {
        const currentValue = await owner.read();
        const current = currentValue === null
          ? null
          : validateCustodyRecord(currentValue, this.#custodyId);
        if (
          !sameCustodyRecord(current, this.#durableRecord)
          || current?.phase !== 'settled'
          || current?.status !== 'active'
        ) {
          durableMismatch = true;
          observedMismatch = current;
          return { committed: false };
        }
        if (!this.isCurrent(capture)) return { committed: false };
        callbackInvoked = true;
        this.#inCommit = true;
        try {
          const value = commit(Object.freeze({
            ...capture,
            authorityDescriptor: this.authorityDescriptor,
          }));
          if (value && typeof value.then === 'function') {
            throw new TypeError('compareAndCommit callback must be synchronous');
          }
          return { committed: true, value };
        } finally {
          this.#inCommit = false;
        }
      });
      if (durableMismatch) {
        this.#wedgeSync(
          stale('durable agent custody changed before publication'),
          {
            reason: 'agent_custody_missed_wakeup',
            disposition: 'delete',
            previousAuthority: this.authority,
            nextAuthority: null,
            previousCapture: capture,
            capture,
            expectedEpoch: capture.authorityEpoch,
            nextEpoch: observedMismatch?.authorityEpoch ?? capture.authorityEpoch,
            nextAuthorityKey: observedMismatch?.authorityKey ?? capture.authorityKey,
          },
        );
      }
      return result;
    } catch (error) {
      this.#inCommit = false;
      if (!callbackInvoked) {
        this.#wedgeSync(error, {
          reason: 'agent_custody_compare_failed',
          disposition: 'delete',
          previousAuthority: this.authority,
          nextAuthority: null,
          previousCapture: capture,
          capture,
          expectedEpoch: capture.authorityEpoch,
          nextEpoch: capture.authorityEpoch,
          nextAuthorityKey: capture.authorityKey,
        });
      }
      throw error;
    }
  }
}
