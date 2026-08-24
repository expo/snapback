// The client half of the shared development auth completion protocol.
//
// This module runs inside the app — browser, Expo web, or React Native — so it
// uses WebCrypto only. The broker half (transaction state, admission, the
// user cap, rehearsal identity derivation) lives in `@expo/snapback-cli` and
// runs under `snapback dev`.
//
// What the client owns, and why:
//
// - It generates the redemption verifier and keeps it. The callback carries
//   only `state` and a short-lived one-use code, so neither the callback URL
//   nor anything logged along the way completes a sign-in on its own.
// - It validates that the broker's authorization URL is on the origin it
//   asked, so a compromised or misconfigured broker response cannot redirect
//   the external user agent somewhere else.
// - It never sees a provider token or a Snapback session credential in a URL.
//
// @ref LLP 0151#shared-development-browser-adapter — the app holds the
// redemption verifier; redemption requires both it and the completion code.

export const SHARED_DEVELOPMENT_AUTH_PROVIDERS = Object.freeze(['apple', 'google']);
export const SHARED_DEVELOPMENT_AUTH_USER_LIMIT = 100;
export const SHARED_DEVELOPMENT_AUTH_REFUSED_CODE = 'SNAPBACK_AUTH_SHARED_DEVELOPMENT_REFUSED';
export const SHARED_DEVELOPMENT_AUTH_ROUTES = Object.freeze({
  start: '/v1/shared/start',
  authorize: '/v1/shared/authorize',
  complete: '/v1/shared/complete',
  redeem: '/v1/shared/redeem',
});

/**
 * One refusal carrier for both halves of the protocol, so the broker and the
 * client speak the same code with a machine-readable `reason`.
 */
export function sharedDevelopmentAuthRefusal(reason, message, details = {}) {
  const error = new Error(message);
  error.code = SHARED_DEVELOPMENT_AUTH_REFUSED_CODE;
  error.reason = reason;
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: SHARED_DEVELOPMENT_AUTH_REFUSED_CODE,
    severity: 'error',
    subsystem: 'auth',
    message,
    details: Object.freeze({ reason, ...details }),
  });
  return error;
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * A PKCE-shaped verifier and its challenge. The verifier stays with the caller
 * and is required at redemption; only the challenge reaches the broker.
 */
export async function createSharedDevelopmentVerifier(cryptoObject = globalThis.crypto) {
  if (typeof cryptoObject?.getRandomValues !== 'function'
    || typeof cryptoObject?.subtle?.digest !== 'function') {
    throw sharedDevelopmentAuthRefusal(
      'webcrypto-unavailable',
      'the shared development Adapter requires WebCrypto for its redemption verifier',
    );
  }
  const verifier = base64url(cryptoObject.getRandomValues(new Uint8Array(48)));
  const digest = await cryptoObject.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Object.freeze({ verifier, codeChallenge: base64url(new Uint8Array(digest)) });
}

/**
 * Validate a broker-returned authorization URL against the origin we asked.
 * A response naming any other origin, or any path outside `/v1/shared/`, is a
 * refusal rather than a redirect the external user agent would follow.
 */
export function sharedDevelopmentAuthorizationUrl(origin, start) {
  const url = new URL(start.authorizationPath, origin);
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/v1/shared/')) {
    throw sharedDevelopmentAuthRefusal(
      'authorization-url-invalid',
      'the shared development broker returned an authorization URL outside its own origin',
      { origin, observed: url.origin },
    );
  }
  return url.toString();
}

/**
 * Read the callback the external user agent returned. The `state` must match
 * the transaction the client started; a mismatch is a refusal, not a warning.
 */
export function readSharedDevelopmentCallback(callbackUrl, start) {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (typeof code !== 'string' || code.length === 0) {
    throw sharedDevelopmentAuthRefusal(
      'callback-code-missing',
      'the shared development callback carried no completion code',
    );
  }
  if (state !== start.state) {
    throw sharedDevelopmentAuthRefusal(
      'callback-state-mismatch',
      'the shared development callback state does not match the transaction this client started',
    );
  }
  return Object.freeze({ code });
}

async function postSharedDevelopmentAuth(origin, path, body, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw sharedDevelopmentAuthRefusal(
      'timeout-invalid',
      'shared development auth timeout must be a positive safe integer',
    );
  }
  const controller = new AbortController();
  const timeoutError = sharedDevelopmentAuthRefusal(
    'broker-timeout',
    `the shared development broker did not answer within ${timeoutMs} ms`,
  );
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) {
      throw sharedDevelopmentAuthRefusal(
        result?.diagnostic?.details?.reason ?? 'broker-refused',
        result?.diagnostic?.message ?? `the shared development broker refused with HTTP ${response.status}`,
        { status: response.status },
      );
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Open one transaction. The broker never receives the verifier. */
export function startSharedDevelopmentAuth(origin, input, options = {}) {
  return postSharedDevelopmentAuth(origin, SHARED_DEVELOPMENT_AUTH_ROUTES.start, input, options);
}

/** Redeem one completion code with the verifier this client kept. */
export function redeemSharedDevelopmentAuth(origin, input, options = {}) {
  return postSharedDevelopmentAuth(origin, SHARED_DEVELOPMENT_AUTH_ROUTES.redeem, input, options);
}
