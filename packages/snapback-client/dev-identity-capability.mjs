const capabilities = new WeakMap();

const normalizeCapability = (capability) => {
  if (
    capability !== null
    && (typeof capability !== 'string' || capability.length === 0)
  ) {
    throw new TypeError('devIdentityCapability must be null or a non-empty string');
  }
  return capability;
};

// @ref LLP 0262#d1-the-dev-identity-capability — package-private custody keeps
// the bearer out of inspection and serialization while still admitting the
// supervised framework handoff.
// Package-private custody shared by the ordinary client constructor and the
// supervised app-client adoption seam. The bearer never becomes an own or
// prototype property of the inspectable client object.
export function installDevIdentityCapability(client, capability) {
  capabilities.set(client, normalizeCapability(capability));
}

export function devIdentityCapabilityFor(client) {
  return capabilities.get(client) ?? null;
}
