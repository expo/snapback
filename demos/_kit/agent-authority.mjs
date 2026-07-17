// Headless agent credential custody and stale-work fencing.
//
// This is deliberately separate from AuthCoordinator: CLI and daemon agents
// own scoped-token custody, while AuthCoordinator owns interactive browser
// session custody and its cross-surface clearing barrier.
//
// @ref LLP 0055#grant-backed-live-and-queued-replay — durable queued work is
// keyed by the grant tuple while live publication is additionally fenced by
// the exact token carrier generation.

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

const tupleKey = ({ actorUserId, credentialId, credentialGeneration, grantId }) => (
  `${actorUserId}\u0000${credentialId}\u0000${credentialGeneration}\u0000${grantId}`
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

  constructor(credential) {
    this.#credential = normalizeCredential(credential);
    this.#durableKey = tupleKey(this.#credential);
  }

  get authorityDescriptor() {
    return this.#authorityDescriptor === null
      ? null
      : Object.freeze({ ...this.#authorityDescriptor });
  }

  capture() {
    return Object.freeze({
      authorityEpoch: this.#durableEpoch,
      authorityKey: this.#durableKey,
      carrierGeneration: this.#carrierGeneration,
      tokenId: this.#credential.tokenId,
    });
  }

  synchronize() { return Promise.resolve(this.capture()); }

  isCurrent(capture) {
    return capture?.authorityEpoch === this.#durableEpoch
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
    const next = normalizeCredential(credential);
    const nextDurableKey = tupleKey(next);
    this.#carrierGeneration += 1;
    if (nextDurableKey !== this.#durableKey) {
      this.#durableEpoch += 1;
      this.#durableKey = nextDurableKey;
      this.#authorityDescriptor = null;
    }
    this.#credential = next;
    return this.capture();
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
    this.#carrierGeneration += 1;
    this.#authorityDescriptor = null;
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
}
