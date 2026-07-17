// Headless agent credential custody and stale-work fencing.
//
// This is deliberately separate from AuthCoordinator: CLI and daemon agents
// own scoped-token custody, while AuthCoordinator owns interactive browser
// session custody and its cross-surface clearing barrier.
//
// @ref LLP 0055#grant-backed-live-and-queued-replay — durable queued work is
// keyed by the grant tuple while live publication is additionally fenced by
// the exact token carrier generation.

import { canonicalAgentAuthorityKey } from '../../packages/snapback-contract/auth-coordinator.mjs';

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

const stale = () => {
  const error = new Error(
    'SNAPBACK_CLIENT_AUTHORITY_STALE: the operation completed under a stale agent authority',
  );
  error.code = 'SNAPBACK_CLIENT_AUTHORITY_STALE';
  error.diagnostic = {
    code: error.code,
    message: 'the operation completed under a stale agent authority',
  };
  return error;
};

export class AgentAuthorityFence {
  #credential;
  #durableKey;
  #durableEpoch = 0;
  #carrierGeneration = 0;
  #authorityDescriptor = null;
  #participants = [];
  #barrierGeneration = 0;
  #barrierActive = false;
  #barrierPhase = null;
  #barrierPromise = Promise.resolve();
  #barrierError = null;
  #terminated = false;

  constructor(credential) {
    this.#credential = normalizeCredential(credential);
    this.#durableKey = canonicalAgentAuthorityKey(this.#credential);
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
    return authorityCapture(
      this.#durableEpoch,
      this.#durableKey,
      this.#carrierGeneration,
      this.#credential.tokenId,
    );
  }

  async synchronize() {
    if (this.#barrierActive) await this.#barrierPromise;
    if (this.#barrierError) throw this.#barrierError;
    return this.capture();
  }

  isCurrent(capture) {
    return !this.#terminated
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

  bindHandshake(capture, descriptor) {
    if (!this.isCurrent(capture)) throw stale();
    const authorityInstanceId = descriptorKey(descriptor);
    if (
      this.#authorityDescriptor !== null
      && this.#authorityDescriptor.authorityInstanceId !== authorityInstanceId
    ) {
      throw stale();
    }
    this.#authorityDescriptor = Object.freeze({ ...descriptor });
    return this.capture();
  }

  replaceCredential(credential) {
    if (this.#barrierActive || this.#barrierError) {
      throw stale('agent authority is clearing and cannot replace its credential');
    }
    const next = normalizeCredential(credential);
    const nextDurableKey = canonicalAgentAuthorityKey(next);
    const previousCapture = this.capture();
    const previousAuthority = this.authority;
    const durableChanged = nextDurableKey !== this.#durableKey;
    const nextEpoch = this.#durableEpoch + (durableChanged ? 1 : 0);
    const nextCarrierGeneration = this.#carrierGeneration + 1;
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
      disposition: 'delete',
      reason: durableChanged ? 'agent_authority_changed' : 'agent_token_rotated',
    });
    const barrier = this.#beginBarrier({ clearMemory: durableChanged, context });
    this.#carrierGeneration = nextCarrierGeneration;
    this.#durableEpoch = nextEpoch;
    this.#durableKey = nextDurableKey;
    if (durableChanged) this.#authorityDescriptor = null;
    this.#credential = next;
    this.#terminated = false;
    this.#finishBarrier(barrier, context, { commitDurable: durableChanged, resume: true });
    return capture;
  }

  terminate(capture) {
    if (!this.isCurrent(capture)) return false;
    // @ref LLP 0055#ending-authority-revocation-expiry-deactivation — a
    // terminal scoped-token result closes its exact carrier generation.
    // A terminal carrier outcome must retire the exact token generation
    // before any transport teardown can synchronously re-enter the client.
    // The durable grant tuple remains available to a separately supplied
    // successor credential, but no work captured under this carrier can
    // publish again.
    const nextCapture = authorityCapture(
      this.#durableEpoch,
      this.#durableKey,
      this.#carrierGeneration + 1,
      this.#credential.tokenId,
    );
    const context = Object.freeze({
      capture: nextCapture,
      authority: this.authority,
      previousAuthority: this.authority,
      nextAuthority: null,
      previousCapture: capture,
      expectedEpoch: capture.authorityEpoch,
      nextEpoch: capture.authorityEpoch,
      nextAuthorityKey: capture.authorityKey,
      disposition: 'delete',
      reason: 'agent_carrier_terminated',
    });
    const barrier = this.#beginBarrier({ clearMemory: true, context });
    this.#carrierGeneration = nextCapture.carrierGeneration;
    this.#authorityDescriptor = null;
    this.#terminated = true;
    this.#finishBarrier(barrier, context, { commitDurable: false, resume: false });
    return true;
  }

  compareAndCommit(capture, commit) {
    if (typeof commit !== 'function') {
      throw new TypeError('compareAndCommit requires a commit callback');
    }
    if (!this.isCurrent(capture)) return Promise.resolve({ committed: false });
    const value = commit(Object.freeze({
      ...capture,
      authorityDescriptor: this.authorityDescriptor,
    }));
    if (value && typeof value.then === 'function') {
      throw new TypeError('compareAndCommit callback must be synchronous');
    }
    return Promise.resolve({ committed: true, value });
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
    return async () => {
      entry.removed = true;
      await this.#barrierPromise;
      this.#participants = this.#participants.filter((candidate) => candidate !== entry);
    };
  }

  #beginBarrier({ clearMemory, context }) {
    const entries = this.#participants.filter((entry) => !entry.removed);
    if (entries.length === 0) return null;
    this.#barrierGeneration += 1;
    const generation = this.#barrierGeneration;
    this.#barrierActive = true;
    this.#barrierPhase = 'quiescing';
    // @ref LLP 0059#transition-barrier — even this local carrier-only owner
    // completes quiescence before synchronous blanking; otherwise an in-flight
    // callback could repopulate a boundary after the terminal cut returned.
    let firstError = null;
    const invoke = (participant, method) => {
      if (typeof participant?.[method] !== 'function') return undefined;
      try {
        const result = participant[method](context);
        if (result && typeof result.then === 'function') {
          void Promise.resolve(result).catch(() => {});
          throw new TypeError(`agent authority participant ${method}() must be synchronous`);
        }
        return result;
      } catch (error) {
        firstError ??= error;
        return undefined;
      }
    };
    for (const { participant } of entries) {
      invoke(participant, 'quiesce');
    }
    if (firstError) {
      this.#barrierError = firstError;
      this.#barrierPhase = 'failed';
      throw firstError;
    }
    this.#barrierPhase = 'blanking';
    for (const { participant } of entries) invoke(participant, 'blank');
    if (firstError) {
      this.#barrierError = firstError;
      this.#barrierPhase = 'failed';
      throw firstError;
    }
    if (clearMemory) {
      this.#barrierPhase = 'clearing-memory';
      for (const { participant } of entries) invoke(participant, 'clearMemory');
    }
    if (firstError) {
      this.#barrierError = firstError;
      this.#barrierPhase = 'failed';
      throw firstError;
    }
    return { entries, generation };
  }

  #finishBarrier(barrier, context, { commitDurable, resume }) {
    if (!barrier) return;
    const frozenContext = Object.freeze({ ...context });
    const complete = async () => {
      if (commitDurable) {
        this.#barrierPhase = 'committing-durable';
        for (const { participant } of barrier.entries) {
          await participant.commitDurable?.(frozenContext);
        }
      }
      if (resume) {
        this.#barrierPhase = 'resuming';
        for (const { participant } of [...barrier.entries].reverse()) {
          await participant.resume?.(frozenContext);
        }
      }
      if (barrier.generation === this.#barrierGeneration) {
        this.#barrierActive = false;
        this.#barrierPhase = null;
      }
    };
    this.#barrierPromise = complete().catch((error) => {
      if (barrier.generation === this.#barrierGeneration) {
        this.#barrierError = error;
        this.#barrierActive = true;
        this.#barrierPhase = 'failed';
      }
    });
  }
}
