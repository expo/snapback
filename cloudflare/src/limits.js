// Hosted resource ceilings that are both runtime-enforced and projected into
// the checked-in capability manifest. Keep the generated-manifest drift test
// as the cross-language guard: the Rust emitter must advertise these exact
// values before either artifact can land.
// @ref LLP 0040#acceptance — reject bounded-resource overflow instead of silently evicting live authority.
export const SUBSCRIPTION_LIMITS = Object.freeze({
  globalCount: 2048,
  perConnectionCount: 64,
  canonicalArgsBytes: 32 * 1024,
  legacyProofSockets: 128,
  acceptedSockets: 256,
  socketsPerConnection: 2,
});

export const SUBSCRIPTION_TEST_CEILINGS = Object.freeze({
  globalCount: 8192,
  perConnectionCount: 256,
  canonicalArgsBytes: 256 * 1024,
  legacyProofSockets: 512,
  acceptedSockets: 1024,
  socketsPerConnection: 16,
});
