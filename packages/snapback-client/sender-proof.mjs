// Low-level v2 proof primitive. Deliberately not exported from the package:
// browser callers must receive it only through the custody coordinator so an
// app cannot construct a Snapback client from an arbitrary bearer.
//
// @ref LLP 0077#protocol-and-algorithms — exact ES256/JWK/payload shape.

const encoder = new TextEncoder();
const ES256 = Object.freeze({ name: 'ECDSA', hash: 'SHA-256' });
const P256 = Object.freeze({ name: 'ECDSA', namedCurve: 'P-256' });
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const base64url = (bytes) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

const canonicalBase64urlBytes = (value, byteLength) => {
  if (typeof value !== 'string' || !BASE64URL.test(value) || value.includes('=')) return false;
  try {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const decoded = Uint8Array.from(
      atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding),
      (character) => character.charCodeAt(0),
    );
    return decoded.byteLength === byteLength && base64url(decoded) === value;
  } catch {
    return false;
  }
};

const canonicalJwk = (jwk) => {
  if (jwk?.kty !== 'EC' || jwk?.crv !== 'P-256'
      || !canonicalBase64urlBytes(jwk.x, 32)
      || !canonicalBase64urlBytes(jwk.y, 32)) {
    throw new TypeError('sender-constraint public key must be one canonical P-256 JWK');
  }
  return { crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y };
};

export const isCanonicalSenderNonce = (value) => canonicalBase64urlBytes(value, 32);

export const canonicalSenderExternalUri = (baseUrl, path) => {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password
      || (base.pathname !== '/' && base.pathname !== '')
      || base.search || base.hash) {
    throw new TypeError('sender-constrained clients require one canonical HTTPS origin');
  }
  if (typeof path !== 'string'
      || !path.startsWith('/')
      || path.includes('%')
      || path.includes('\\')
      || path.includes('//')
      || path.includes('?')
      || path.includes('#')
      || path.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new TypeError('sender proof route is not canonical for this client origin');
  }
  const candidate = new URL(`${base.origin}${path}`);
  if (candidate.origin !== base.origin
      || candidate.protocol !== 'https:'
      || candidate.pathname !== path
      || candidate.search
      || candidate.hash) {
    throw new TypeError('sender proof route is not canonical for this client origin');
  }
  return `${base.origin}${path}`;
};

const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

export async function generateSenderConstraintKey() {
  const pair = await crypto.subtle.generateKey(P256, false, ['sign', 'verify']);
  if (pair.privateKey.extractable !== false
      || pair.privateKey.type !== 'private'
      || pair.privateKey.algorithm?.name !== 'ECDSA'
      || pair.privateKey.algorithm?.namedCurve !== 'P-256') {
    throw new Error('platform did not create a non-extractable P-256 private key');
  }
  const publicJwk = canonicalJwk(await crypto.subtle.exportKey('jwk', pair.publicKey));
  const thumbprint = base64url(await sha256(encoder.encode(JSON.stringify(publicJwk))));
  return Object.freeze({ privateKey: pair.privateKey, publicKey: pair.publicKey, publicJwk, thumbprint });
}

export async function createSenderProofForCustody({
  privateKey,
  publicJwk,
  method,
  canonicalExternalUri,
  accessToken,
  nonce,
  issuedAtSeconds,
  proofId,
}) {
  if (!(privateKey instanceof CryptoKey) || privateKey.type !== 'private'
      || privateKey.extractable !== false || privateKey.algorithm?.name !== 'ECDSA'
      || privateKey.algorithm?.namedCurve !== 'P-256') {
    throw new TypeError('sender proof requires the installed non-extractable P-256 key');
  }
  if (typeof method !== 'string' || !/^[A-Z]+$/u.test(method)
      || typeof canonicalExternalUri !== 'string'
      || !canonicalExternalUri.startsWith('https://')
      || typeof accessToken !== 'string' || accessToken.length === 0
      || typeof nonce !== 'string' || nonce.length === 0
      || !Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds < 0
      || !(proofId instanceof Uint8Array) || proofId.byteLength !== 16) {
    throw new TypeError('sender proof inputs are malformed');
  }
  const jwk = canonicalJwk(publicJwk);
  const header = base64url(encoder.encode(JSON.stringify({
    alg: 'ES256',
    jwk,
    typ: 'dpop+jwt',
  })));
  const payload = base64url(encoder.encode(JSON.stringify({
    ath: base64url(await sha256(encoder.encode(accessToken))),
    htm: method,
    htu: canonicalExternalUri,
    iat: issuedAtSeconds,
    jti: base64url(proofId),
    nonce,
    version: 2,
  })));
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    ES256,
    privateKey,
    encoder.encode(signingInput),
  ));
  if (signature.byteLength !== 64) {
    throw new Error('platform returned a non-canonical ES256 signature');
  }
  return `${signingInput}.${base64url(signature)}`;
}

export async function createSenderIssuanceProofForCustody({
  privateKey,
  publicJwk,
  challengeId,
  canonicalExchangeUri,
  issuedAtSeconds,
  proofId,
}) {
  if (!(privateKey instanceof CryptoKey) || privateKey.type !== 'private'
      || privateKey.extractable !== false || privateKey.algorithm?.name !== 'ECDSA'
      || privateKey.algorithm?.namedCurve !== 'P-256') {
    throw new TypeError('sender issuance proof requires a non-extractable P-256 key');
  }
  if (typeof challengeId !== 'string' || challengeId.length === 0
      || typeof canonicalExchangeUri !== 'string'
      || !canonicalExchangeUri.startsWith('https://')
      || !Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds < 0
      || !(proofId instanceof Uint8Array) || proofId.byteLength !== 16) {
    throw new TypeError('sender issuance proof inputs are malformed');
  }
  const jwk = canonicalJwk(publicJwk);
  const header = base64url(encoder.encode(JSON.stringify({
    alg: 'ES256',
    jwk,
    typ: 'dpop+jwt',
  })));
  const payload = base64url(encoder.encode(JSON.stringify({
    challengeId,
    htm: 'POST',
    htu: canonicalExchangeUri,
    iat: issuedAtSeconds,
    jti: base64url(proofId),
    protocol: 'snapback.sender-issuance.v2',
    version: 2,
  })));
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    ES256,
    privateKey,
    encoder.encode(signingInput),
  ));
  if (signature.byteLength !== 64) {
    throw new Error('platform returned a non-canonical ES256 issuance signature');
  }
  return `${signingInput}.${base64url(signature)}`;
}
