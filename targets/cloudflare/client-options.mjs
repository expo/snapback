// Client construction for the intentionally pre-auth Cloudflare proof target.
//
// @ref LLP 0040#capability-report — external auth remains an explicit target gap.
// @ref LLP 0060#d5-hosted-readiness-is-conjunctive — unavailable hosted-auth facts cannot be inferred into support.
const AUTH_PROTOCOL_KEYS = Object.freeze([
  'authClientProtocol',
  'authInvalidationProtocol',
  'authorityDescriptorProtocol',
  'authorizedLeaseProtocol',
]);

export function cloudflareClientOptions(overrides = {}) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Cloudflare client options must be an object');
  }
  // Snapshot accessors/proxies exactly once before validation so a caller
  // cannot return a harmless value to the guard and a credential during spread.
  const options = { ...overrides };
  if (options.bearerToken != null || options.authCoordinator != null) {
    throw new TypeError('the Cloudflare proof target does not support session credential custody');
  }
  for (const key of AUTH_PROTOCOL_KEYS) {
    if (options[key] != null) {
      throw new TypeError(`the Cloudflare proof target does not support ${key}`);
    }
  }
  return Object.freeze({
    ...options,
    // The hosted proof has no session provider. When an operator token is
    // explicitly supplied, carry it on app-data POSTs as the target's honest
    // non-public authority instead of leaving mutation/action requests open.
    __adminDataPlane: typeof options.adminToken === 'string' && options.adminToken.length > 0,
    authClientProtocol: null,
    authInvalidationProtocol: null,
    authorityDescriptorProtocol: null,
    authorizedLeaseProtocol: null,
  });
}
