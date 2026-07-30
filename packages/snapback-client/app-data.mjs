// App-data-only façade over the full headless client.
//
// @ref LLP 0062#position-among-existing-surfaces — the app CLI engine operates
// on the application plane, never the operator plane: its client façade has no
// admin methods and no ambient SNAPBACK_ADMIN_TOKEN pickup (the full headless
// client reads that env var by default, so the engine explicitly does not
// construct it that way).

import { DEFAULT_INGRESS_LIMIT_BYTES, SnapbackClient } from './index.mjs';

export { DEFAULT_INGRESS_LIMIT_BYTES };

// The delegated surface, stated as a closed list: the app-data call paths
// (query/mutation/action/live/ephemeral), the sessions flow, agent-fence
// custody transitions, connection lifecycle, and local observability. Admin
// and operator methods (loadSchema, loadFunctions, ensureApp, reset, seed,
// cronTick, versioned seeds, ensureEphemeralCollections) are deliberately not
// in this list, so the façade lacks them by construction rather than by
// runtime refusal.
export const APP_DATA_CLIENT_METHODS = Object.freeze([
  // Public projections and health.
  'health',
  'inspect',
  'localResourceInspection',
  // Sessions flow.
  'authSession',
  'authRequestCode',
  'authExchange',
  'authRefresh',
  'authLogout',
  'closeAuth',
  'clearAuthSession',
  'setBearerToken',
  'replaceBearerToken',
  'currentAuthorityDescriptor',
  'currentAuthorizationScope',
  // Agent-fence integration.
  'replaceAgentCredential',
  'captureAuthority',
  'isAuthorityCaptureCurrent',
  'authorityCaptureFor',
  'allocateLiveQueryNamespace',
  // Request/response app-data calls.
  'query',
  'search',
  'mutate',
  'action',
  'acknowledgeMutations',
  'authorizedLeaseQuery',
  'fetchBundle',
  // Live paths.
  'subscribeLive',
  'unsubscribeLive',
  'liveQuery',
  'startLiveQuery',
  'openLiveStream',
  'liveStreamManager',
  'acknowledgeAuthorizationInvalidation',
  // Ephemeral paths.
  'subscribeEphemeral',
  'publishEphemeral',
  'unsubscribeEphemeral',
  'deleteEphemeral',
  'startEphemeralRoom',
  'registerEphemeralRepublisher',
  // Connection lifecycle.
  'connectionGrant',
  'refreshConnectionGrant',
  'disconnect',
  'releaseConnection',
  'drainEnvelopes',
  'drainConnection',
  'drainUpdates',
  // Receipts and diagnostics.
  'receipts',
  'onReceipt',
  'reservationRetryDiagnostics',
]);

const INNER = new WeakMap();

const inner = (facade) => {
  const client = INNER.get(facade);
  if (!client) throw new TypeError('not a SnapbackAppDataClient');
  return client;
};

export class SnapbackAppDataClient {
  constructor(baseUrl, options = {}) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('SnapbackAppDataClient options must be an object');
    }
    if ('adminToken' in options) {
      // Passing one — even null — signals a caller on the wrong plane.
      throw new TypeError(
        'SnapbackAppDataClient is app-data-only: it never accepts an admin token',
      );
    }
    // adminToken pinned to null: the full client's constructor default reads
    // process.env.SNAPBACK_ADMIN_TOKEN ambiently, and this façade must not.
    INNER.set(this, new SnapbackClient(baseUrl, { ...options, adminToken: null }));
    Object.freeze(this);
  }

  get baseUrl() { return inner(this).baseUrl; }
  get authProtocols() { return inner(this).authProtocols; }
  get agentAuthority() { return inner(this).agentAuthority; }
  get ingressLimits() { return inner(this).ingressLimits; }
  get wireVersionDiagnostics() { return inner(this).wireVersionDiagnostics; }
}

for (const name of APP_DATA_CLIENT_METHODS) {
  if (typeof SnapbackClient.prototype[name] !== 'function') {
    throw new TypeError(`SnapbackClient no longer implements app-data method '${name}'`);
  }
  Object.defineProperty(SnapbackAppDataClient.prototype, name, {
    value: {
      [name](...args) {
        return inner(this)[name](...args);
      },
    }[name],
    writable: false,
    enumerable: false,
    configurable: false,
  });
}
Object.freeze(SnapbackAppDataClient.prototype);
Object.freeze(SnapbackAppDataClient);

export function createAppDataClient(baseUrl, options = {}) {
  return new SnapbackAppDataClient(baseUrl, options);
}

const artifactError = (code, message, details = undefined) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = Object.freeze({
    code,
    message,
    ...(details === undefined ? {} : { details: Object.freeze({ ...details }) }),
  });
  return error;
};

const REDIRECT_STATUSES = new Set([300, 301, 302, 303, 305, 307, 308]);

// Bare, credential-free, non-redirecting fetch for the public artifact routes
// (discovery documents and content-addressed envelopes).
//
// @ref LLP 0062#5-distribution-the-server-advertises-the-server-is-the-version-authority —
// no admin, session, agent, connection, or cookie carrier ever attaches to
// these public requests; the response must arrive in identity content coding
// (the envelope's integrity story is the SHA-256 of the served bytes), and a
// transformed body is refused rather than normalized into the expected
// envelope identity.
export async function fetchPublicArtifact(baseUrl, path, {
  ingressClass = 'artifact',
  limitBytes = null,
  signal = undefined,
} = {}) {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new TypeError('fetchPublicArtifact requires a base URL string');
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError('fetchPublicArtifact requires an absolute route path');
  }
  if (!Object.hasOwn(DEFAULT_INGRESS_LIMIT_BYTES, ingressClass)) {
    throw new TypeError(`unknown ingress class '${ingressClass}'`);
  }
  const limit = limitBytes ?? DEFAULT_INGRESS_LIMIT_BYTES[ingressClass];
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError('limitBytes must be a positive safe integer');
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'GET',
    // Explicitly request identity encoding: the artifact identity is the
    // digest of untransformed bytes, so no transport compression is invited.
    headers: { 'accept-encoding': 'identity' },
    redirect: 'manual',
    credentials: 'omit',
    signal,
  });
  if (res.type === 'opaqueredirect' || REDIRECT_STATUSES.has(res.status)) {
    try { await res.body?.cancel?.(); } catch { /* the refusal owns cleanup */ }
    throw artifactError(
      'SNAPBACK_REDIRECT_REFUSED',
      'public artifact fetches are non-redirecting',
      { status: res.type === 'opaqueredirect' ? null : res.status },
    );
  }
  const contentEncoding = res.headers?.get?.('content-encoding');
  if (contentEncoding && contentEncoding.trim().toLowerCase() !== 'identity') {
    // Reject unexpected content coding outright: the platform may already
    // have decoded the body, and normalized bytes must never stand in for
    // the identity-coded envelope whose digest the caller will verify.
    try { await res.body?.cancel?.(); } catch { /* the refusal owns cleanup */ }
    throw artifactError(
      'SNAPBACK_ARTIFACT_ENCODING_UNEXPECTED',
      'public artifact responses must use identity content coding',
      { contentEncoding: contentEncoding.trim() },
    );
  }
  const declared = Number(res.headers?.get?.('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > limit) {
    try { await res.body?.cancel?.(); } catch { /* the refusal owns cleanup */ }
    throw artifactError(
      'SNAPBACK_INGRESS_LIMIT_EXCEEDED',
      `${ingressClass} response exceeds the ${limit}-byte decoded ingress bound`,
      { ingressClass, limitBytes: limit },
    );
  }
  const chunks = [];
  let receivedBytes = 0;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value?.byteLength ?? value?.length ?? 0;
      if (receivedBytes > limit) {
        try { await reader.cancel(); } catch { /* bounded refusal */ }
        throw artifactError(
          'SNAPBACK_INGRESS_LIMIT_EXCEEDED',
          `${ingressClass} response exceeds the ${limit}-byte decoded ingress bound`,
          { ingressClass, limitBytes: limit },
        );
      }
      chunks.push(value);
    }
  } else {
    const buffered = new Uint8Array(await res.arrayBuffer());
    receivedBytes = buffered.byteLength;
    if (receivedBytes > limit) {
      throw artifactError(
        'SNAPBACK_INGRESS_LIMIT_EXCEEDED',
        `${ingressClass} response exceeds the ${limit}-byte decoded ingress bound`,
        { ingressClass, limitBytes: limit },
      );
    }
    chunks.push(buffered);
  }
  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength ?? chunk.length ?? 0;
  }
  return Object.freeze({
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    bytes,
    bodyText() { return new TextDecoder().decode(bytes); },
  });
}
