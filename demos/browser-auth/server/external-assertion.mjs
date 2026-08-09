import { createHmac, timingSafeEqual } from 'node:crypto';

const EXACT_CLAIM_KEYS = Object.freeze([
  'audience',
  'displayName',
  'email',
  'expiresAtMs',
  'issuedAtMs',
  'issuer',
  'nonce',
  'subject',
]);

const encode = (value) => Buffer.from(value).toString('base64url');

export function externalIdentityKey({ issuer, subject }) {
  if (typeof issuer !== 'string' || !issuer.startsWith('https://')) {
    throw new TypeError('external identity issuer must be an https URL');
  }
  if (typeof subject !== 'string' || subject.length < 1 || subject.length > 256) {
    throw new TypeError('external identity subject must be 1..256 characters');
  }
  return `${issuer}\0${subject}`;
}

export function signFixtureAssertion(claims, secret) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) {
    throw new TypeError('fixture assertion secret must contain at least 256 bits');
  }
  const payload = encode(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

// Replace this fixture verifier with the app's real provider SDK/server-side
// verifier. It is intentionally not advertised as generic OIDC conformance.
// @ref LLP 0151#architecture-an-oidc-substrate-with-presets — a first-party
// adapter additionally owes discovery/JWKS/PKCE/mix-up/adversarial coverage;
// this local fixture proves only the app-owned verified-assertion seam.
export function verifyExternalAssertion(token, {
  secret,
  expectedIssuer,
  expectedAudience,
  expectedNonce,
  nowMs = Date.now(),
}) {
  if (typeof token !== 'string' || token.length > 8_192) {
    throw new TypeError('external assertion is malformed');
  }
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra !== undefined) throw new TypeError('external assertion is malformed');
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(supplied, 'base64url');
  } catch {
    throw new TypeError('external assertion signature is malformed');
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new TypeError('external assertion signature is invalid');
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new TypeError('external assertion payload is malformed');
  }
  if (
    !claims
    || typeof claims !== 'object'
    || Array.isArray(claims)
    || Object.keys(claims).sort().join('\0') !== [...EXACT_CLAIM_KEYS].sort().join('\0')
    || claims.issuer !== expectedIssuer
    || claims.audience !== expectedAudience
    || claims.nonce !== expectedNonce
    || !Number.isSafeInteger(claims.issuedAtMs)
    || !Number.isSafeInteger(claims.expiresAtMs)
    || claims.issuedAtMs > nowMs + 30_000
    || claims.expiresAtMs <= nowMs
    || claims.expiresAtMs - claims.issuedAtMs > 10 * 60_000
    || typeof claims.email !== 'string'
    || typeof claims.displayName !== 'string'
  ) throw new TypeError('external assertion claims are invalid');
  externalIdentityKey(claims);
  return Object.freeze({ ...claims });
}
