import { createRemoteJWKSet, jwtVerify } from 'jose';

const APPLE_ISSUER = 'https://appleid.apple.com';
const GOOGLE_ISSUERS = Object.freeze([
  'https://accounts.google.com',
  'accounts.google.com',
]);
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function verifiedIdentity({ provider, issuer, payload, displayName, picture }) {
  if (typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 256) {
    throw new TypeError(`${provider} identity token has no valid subject`);
  }
  return Object.freeze({
    provider,
    issuer,
    subject: payload.sub,
    email: text(payload.email),
    displayName: text(displayName, text(payload.name, provider === 'apple' ? 'Apple user' : 'Google user')),
    avatarUrl: text(picture, text(payload.picture)),
  });
}

// @ref LLP 0151#provider-specifics — Apple is an executable OIDC-shaped
// profile. This local broker verifies signature, issuer, audience, expiry,
// and the caller-bound nonce. Refresh-token deletion custody remains outside
// this demo and is an explicit nonclaim.
export async function verifyAppleIdentityToken(token, {
  audience,
  nonce,
  displayName,
} = {}) {
  if (!text(audience)) throw new TypeError('Apple verification requires an audience');
  if (!text(nonce)) throw new TypeError('Apple verification requires a nonce');
  const { payload } = await jwtVerify(token, appleKeys, {
    issuer: APPLE_ISSUER,
    audience,
  });
  if (payload.nonce !== nonce) throw new TypeError('Apple identity token nonce does not match');
  return verifiedIdentity({
    provider: 'apple',
    issuer: APPLE_ISSUER,
    payload,
    displayName,
  });
}

// @ref LLP 0151#provider-specifics — Google is the first data-driven OIDC
// preset. The stable identity is issuer plus sub; mutable email and name do
// not select the Snapback principal.
export async function verifyGoogleIdentityToken(token, {
  audience,
  nonce,
} = {}) {
  if (!text(audience)) throw new TypeError('Google verification requires an audience');
  const { payload } = await jwtVerify(token, googleKeys, {
    issuer: GOOGLE_ISSUERS,
    audience,
  });
  if (text(nonce) && payload.nonce !== nonce) {
    throw new TypeError('Google identity token nonce does not match');
  }
  return verifiedIdentity({
    provider: 'google',
    issuer: String(payload.iss),
    payload,
  });
}

export async function exchangeGoogleAuthorizationCode({
  code,
  codeVerifier,
  redirectUri,
  clientId,
}) {
  for (const [name, value] of Object.entries({ code, codeVerifier, redirectUri, clientId })) {
    if (!text(value)) throw new TypeError(`Google code exchange requires ${name}`);
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.id_token !== 'string') {
    throw new TypeError('Google authorization code exchange was refused');
  }
  return verifyGoogleIdentityToken(body.id_token, { audience: clientId });
}

const FIXTURES = Object.freeze({
  apple: Object.freeze({
    provider: 'apple',
    issuer: APPLE_ISSUER,
    subject: 'fixture-apple-user-001',
    email: 'relay-user@privaterelay.appleid.com',
    displayName: 'Apple Fixture',
    avatarUrl: 'https://api.dicebear.com/9.x/thumbs/png?seed=apple-fixture',
  }),
  google: Object.freeze({
    provider: 'google',
    issuer: 'https://accounts.google.com',
    subject: 'fixture-google-user-001',
    email: 'google-user@example.test',
    displayName: 'Google Fixture',
    avatarUrl: 'https://api.dicebear.com/9.x/thumbs/png?seed=google-fixture',
  }),
});

export function fixtureIdentity(provider) {
  const identity = FIXTURES[provider];
  if (!identity) throw new TypeError('fixture provider must be apple or google');
  return identity;
}
