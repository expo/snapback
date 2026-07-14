// Headless Snapback client adapter — the shared bridge, not per-demo glue.
//
// @ref LLP 0012#contract-artifacts — the bridge is a first-class
//   adapter (one shared client), not ~200 lines re-copied per demo as in Valet.
// @ref LLP 0012#runtime-state — subscribing returns the authoritative initial
//   snapshot *and* the live stream as one "current value + subscription" seam, so
//   no adapter races a manual prime against later updates.
// @ref LLP 0012#react-and-expo-requirements — this is an Online-class adapter
//   (speaks the wire protocol, server-authoritative mutations); it does NOT run
//   handlers locally, so it makes no local-first/Parity claim.
// @ref LLP 0034#2-d0--d1--a-liveness-signal-then-durable-push-to-the-browser — `liveQuery` gains a `stream`
//   transport over the managed shared live socket (one socket, both lanes) with
//   poll fallback, reconnect-by-fresh-subscribe, and the Exact LLP 0284 §2.2
//   connection axis.

import { retainedQueryKey } from '../../packages/snapback-contract/client-store.mjs';
import {
  createLiveQueryAuthorizationFence,
  createLiveQueryInstanceAllocator,
  createLiveQueryNamespace,
} from '../../packages/snapback-contract/query-authorization.mjs';
import {
  validateAuthorizationInvalidationConnection,
  validateScopeId,
} from '../../packages/snapback-contract/auth-invalidation.mjs';

// ---------------------------------------------------------------------------
// D1 freshness + reconnect policy (LLP 0034 §2.2/§2.3; Exact LLP 0284 §2.2).
//
// The server sends nothing on an idle-healthy socket, so freshness is a
// kit-derived policy with explicit timers: the client sends an app-level
// `{"type":"ping"}` every LIVE_HEARTBEAT_INTERVAL_MS while the socket is open
// (the server answers `{"kind":"pong"}` immediately — src/server.rs), and any
// received frame counts as socket activity. The freshness budget is
// LIVE_FRESHNESS_BUDGET_MS = 3x the heartbeat interval; silence past the
// budget is a missed budget: the socket is force-closed and reconnect begins.
//
// Connection-axis mapping (normative table, LLP 0034 §2.2):
//
//   | provider state                                              | value          |
//   |-------------------------------------------------------------|----------------|
//   | socket connecting / (re)subscribe in flight                 | 'connecting'   |
//   | socket open, subscription established, heartbeat in budget  | 'live'         |
//   | no socket; HTTP drain timer active at declared cadence      | 'polling'      |
//   | freshness budget missed while retry/backoff is in progress  | 'stale'        |
//   | closed with no retry scheduled; drain stopped               | 'disconnected' |
//
// Notes against the table as implemented:
// - With poll fallback enabled (the default), losing the socket goes straight
//   to 'polling' — the declared-cadence drain is a healthy declared transport,
//   not a degradation mystery. With fallback disabled, socket loss goes to
//   'stale' (last-known rows renderable, retry in progress).
// - transport:'poll' handles (the pre-D1 behavior, still the default) report
//   'polling' after establish: the cadence is caller-owned there, so the kit
//   claims no freshness budget for them.
//
// Reconnect (LLP 0034 §2.3, amended): the server drops a connection's durable
// subscriptions when its socket closes (src/server.rs live_stream ->
// LocalSnapback::disconnect), so there is nothing to resume across a socket
// loss. Reconnect therefore ALWAYS re-enters through a fresh subscribe_live —
// snapshot-with-subscribe, never a prime race — and emits a 'resubscribed'
// subscription event. `resume_live` is not used across socket loss; a
// subscription-survival grace window is future work.
// ---------------------------------------------------------------------------
export const LIVE_HEARTBEAT_INTERVAL_MS = 5_000;
export const LIVE_FRESHNESS_BUDGET_MS = LIVE_HEARTBEAT_INTERVAL_MS * 3;
export const LIVE_RECONNECT_BASE_DELAY_MS = 250;
export const LIVE_RECONNECT_MAX_DELAY_MS = 10_000;
// Provider poll floor: the declared HTTP outbox drain cadence used as the
// stream fallback and emitted by codegen as the manifest `pollCadenceMs`.
export const DEFAULT_POLL_CADENCE_MS = 1_500;
// Grace before the fallback path re-subscribes after a socket loss, so the
// server has processed the closing socket's disconnect (which drops the
// connection's subscriptions) before the fresh subscribe_live lands.
const RESUBSCRIBE_AFTER_LOSS_DELAY_MS = 300;
// Kit receipt ring bound — mirrors the server-side retention cap (LLP 0034 §3).
const RECEIPT_RING_CAP = 256;
// A subscription registers its lane consumer before dispatching the snapshot
// request, then buffers deltas until that snapshot arrives. Keep a hung request
// from turning the temporary queue into an unbounded client-memory sink.
const EPHEMERAL_PRE_SNAPSHOT_BUFFER_CAP = 1_024;
// Generated function/collection identifiers are URL path components on the
// app-data plane. Keep this grammar in lockstep with codegen's IDENT so a
// caller-supplied reference cannot acquire authority through URL parsing.
// @ref LLP 0031#the-invariant — app-data names must never normalize into the
// privileged system namespace.
const GENERATED_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The live wire kinds this kit dispatches on, pinned to the committed
// Rust-generated schemas (LLP 0051 D4 / ENG-23891):
// demos/_kit/tests/live-wire-schema.mjs asserts these sets exactly match
// schemas/live.envelope.schema.json and
// schemas/live.socket-server.schema.json, so a server-side kind change is a
// failing gate instead of a frame that silently never matches here.
export const LIVE_DURABLE_KINDS = Object.freeze({
  LIVE_REPLACE: 'live_replace',
  LIVE_DELTA: 'live_delta',
  RESYNC_REQUIRED: 'resync_required',
  AUTHORIZATION_INVALIDATION: 'authorization_invalidation',
});
export const LIVE_SOCKET_KINDS = Object.freeze({
  AUTH_ERROR: 'auth_error',
  PONG: 'pong',
  EPHEMERAL_ACK: 'ephemeral_ack',
  EPHEMERAL_ERROR: 'ephemeral_error',
  EPHEMERAL: 'ephemeral',
  // Server-side fallback for a non-UTF-8 durable payload; the kit has no
  // recovery beyond the resync the next drain forces, so it is knowingly
  // ignored (the schema gate lists it as acknowledged-unhandled).
  DURABLE_BYTES: 'durable_bytes',
});
// These hosted subscribe refusals are explicitly pre-persistence: the
// coordinator returns before inserting/replacing a subscription row. They are
// therefore the ONLY subscribe failures the kit may replay after proving a
// current socket session. Network errors, timeouts, 5xx responses, and every
// other diagnostic remain ambiguous and are never retried here.
const LIVE_SUBSCRIBE_READINESS_RETRY_CODES = new Set([
  'SNAPBACK_CONNECTION_SOCKET_REQUIRED',
  'SNAPBACK_CONNECTION_SESSION_REPLACED',
]);
const LIVE_SUBSCRIBE_READINESS_RETRIES = 2;
const AUTH_CLIENT_PROTOCOL_HEADER = 'x-snapback-auth-client-protocol';
const AUTH_INVALIDATION_PROTOCOL_HEADER = 'x-snapback-auth-invalidation-protocol';
const AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER = 'x-snapback-authority-descriptor-protocol';
const AUTHORIZED_LEASE_PROTOCOL_HEADER = 'x-snapback-authorized-lease-protocol';
const AUTHORITY_CAPTURE = Symbol('snapback.authorityCapture');
const AUTHORIZATION_CONNECTION = Symbol('snapback.authorizationConnection');

const processClientStoreId = (() => {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `live_${randomId.replaceAll('-', '')}`;
  const pid = typeof process !== 'undefined' && Number.isSafeInteger(process.pid)
    ? process.pid
    : 0;
  return `live_${Date.now().toString(36)}_${pid.toString(36)}`;
})();
const liveQueryAllocators = new Map();

const allocatorForClientStore = (clientStoreId) => {
  let allocator = liveQueryAllocators.get(clientStoreId);
  if (!allocator) {
    allocator = createLiveQueryInstanceAllocator();
    liveQueryAllocators.set(clientStoreId, allocator);
  }
  return allocator;
};

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const authorityDescriptorIsValid = (descriptor) => (
  descriptor !== null
  && typeof descriptor === 'object'
  && !Array.isArray(descriptor)
  && Object.keys(descriptor).sort().join(',')
    === 'authorityInstanceId,descriptorVersion,sessionGeneration'
  && descriptor.descriptorVersion === 1
  && typeof descriptor.authorityInstanceId === 'string'
  && UUID_V7.test(descriptor.authorityInstanceId)
  && Number.isSafeInteger(descriptor.sessionGeneration)
  && descriptor.sessionGeneration >= 0
);

const requireAuthorityDescriptor = (descriptor, code = 'SNAPBACK_AUTH_HANDSHAKE_INVALID') => {
  if (authorityDescriptorIsValid(descriptor)) {
    return Object.freeze({ ...descriptor });
  }
  const error = new Error(`${code}: authority descriptor is missing or malformed`);
  error.code = code;
  error.diagnostic = { code, message: 'authority descriptor is missing or malformed' };
  throw error;
};

const markAuthorityCapture = (value, capture) => {
  if (!capture || value === null || typeof value !== 'object') return value;
  try {
    Object.defineProperty(value, AUTHORITY_CAPTURE, {
      value: capture,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  } catch {
    // Frozen protocol objects remain usable; their caller must carry capture.
  }
  if (Array.isArray(value)) {
    for (const entry of value) markAuthorityCapture(entry, capture);
  }
  if (value.receipt && typeof value.receipt === 'object') {
    markAuthorityCapture(value.receipt, capture);
  }
  return value;
};

const CLIENT_SECRET_REDACTION = '[REDACTED]';

const normalizedFieldName = (name) => String(name ?? '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[^A-Za-z0-9]+/g, '_')
  .toLowerCase();

const sensitiveProtocolField = (name) => {
  const normalized = normalizedFieldName(name);
  return normalized === 'token'
    || normalized.endsWith('_token')
    || normalized === 'bearer'
    || normalized.endsWith('_bearer')
    || normalized === 'credential'
    || normalized.endsWith('_credential')
    || normalized === 'lease'
    || normalized.endsWith('_lease')
    || normalized === 'proof'
    || normalized.endsWith('_proof')
    || normalized === 'secret'
    || normalized.endsWith('_secret')
    || normalized === 'private_key'
    || normalized.endsWith('_private_key')
    || normalized === 'key_material'
    || normalized.endsWith('_key_material')
    || normalized === 'login_code'
    || normalized === 'challenge_code';
};

const addSecret = (secrets, value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const text = String(value);
  // Very short values create destructive false positives in diagnostic copy;
  // protocol credentials and email codes are always at least four bytes.
  if (text.length >= 4) secrets.add(text);
};

const collectRequestSecrets = (body, headers) => {
  const secrets = new Set();
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = normalizedFieldName(name);
    if (
      normalized === 'authorization'
      || sensitiveProtocolField(name)
    ) {
      addSecret(secrets, value);
      if (normalized === 'authorization') {
        addSecret(secrets, String(value).replace(/^Bearer\s+/i, ''));
      }
    }
  }
  const visit = (value, field = null) => {
    if (field === 'code' || sensitiveProtocolField(field)) addSecret(secrets, value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, field);
    } else if (value && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) visit(item, name);
    }
  };
  visit(body);
  return secrets;
};

const redactKnownSecrets = (text, secrets) => {
  let redacted = String(text ?? '');
  for (const secret of secrets) redacted = redacted.replaceAll(secret, CLIENT_SECRET_REDACTION);
  return redacted;
};

const sanitizeProtocolErrorValue = (value, secrets, field = null) => {
  if (sensitiveProtocolField(field)) return CLIENT_SECRET_REDACTION;
  if (typeof value === 'string') return redactKnownSecrets(value, secrets);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProtocolErrorValue(item, secrets));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [
      name,
      sanitizeProtocolErrorValue(item, secrets, name),
    ]),
  );
};

const sanitizeTransportError = (error, secrets) => {
  const safe = new Error(redactKnownSecrets(error?.message ?? String(error), secrets));
  safe.name = redactKnownSecrets(error?.name ?? 'Error', secrets);
  if (error?.code !== undefined) {
    safe.code = sanitizeProtocolErrorValue(error.code, secrets);
  }
  if (error?.status !== undefined) {
    safe.status = sanitizeProtocolErrorValue(error.status, secrets);
  }
  if (error?.diagnostic !== undefined) {
    safe.diagnostic = sanitizeProtocolErrorValue(error.diagnostic, secrets);
  }
  if (error?.receipt !== undefined) {
    safe.receipt = sanitizeProtocolErrorValue(error.receipt, secrets);
  }
  return safe;
};

const authHandshakeRequired = (path) => !(
  path === '/health'
  || path === '/inspect'
  || path === '/auth/session'
  || path === '/app/ensure'
  || path.startsWith('/_snapback/')
);

const freshAuthHandshakeRequired = (path) => (
  path === '/connection/open'
  || (path.startsWith('/live/') && path.endsWith('/subscribe'))
  || (path.startsWith('/query/') && path.endsWith('/authorized-lease'))
  || path === '/ephemeral/subscribe'
);

// A failed forced probe must not erase the last authenticated projection:
// offline AuthorizedLease reads still need its immutable app/authority facts.
// Online boundaries continue to pass `force: true`, so preserving this cache
// cannot turn a failed freshness probe into online admission.
const isUnavailableAuthTransport = (error) => (
  error instanceof TypeError
  && error?.diagnostic == null
  && error?.status == null
  && error?.code == null
);

const sessionWireBody = (path, body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const wire = { ...body };
  delete wire.auth;
  if (path.startsWith('/live/') && wire.input && typeof wire.input === 'object') {
    wire.input = { ...wire.input };
    delete wire.input.auth;
  }
  if (path.startsWith('/ephemeral/')) {
    delete wire.principal;
    delete wire.session_id;
    delete wire.user_id;
    delete wire.custom_key;
  }
  if (wire.ctx_ledger && typeof wire.ctx_ledger === 'object') {
    wire.ctx_ledger = { ...wire.ctx_ledger };
    delete wire.ctx_ledger.auth_fingerprint;
  }
  return wire;
};

const authAvailabilityError = (handshake) => {
  if (handshake == null) return null;
  const availability = handshake?.availability?.onlineRequestResponse;
  if (availability?.available) return null;
  const code = availability?.reason ?? 'SNAPBACK_AUTH_POLICY_UNAVAILABLE';
  const error = new Error(`${code}: the current auth mode does not admit online app data`);
  error.diagnostic = {
    code,
    message: 'the current auth mode does not admit online app data',
  };
  error.authSession = handshake;
  return error;
};

const TERMINAL_AUTH_CODES = new Set([
  'SNAPBACK_AUTH_REQUIRED',
  'SNAPBACK_AUTH_SESSION_EXPIRED',
  'SNAPBACK_AUTH_SESSION_REVOKED',
  'SNAPBACK_AUTH_FAMILY_REVOKED',
]);

const SUPERSEDED_AUTH_CODES = new Set([
  'SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED',
  'SNAPBACK_AUTH_REFRESH_SUPERSEDED',
]);

const LIVE_TERMINAL_AUTH_CODES = new Set([
  'SNAPBACK_AUTH_SESSION_EXPIRED',
  'SNAPBACK_AUTH_STREAM_RESET',
  'SNAPBACK_AUTH_MODE_PENDING',
]);
const LIVE_TERMINAL_AUTH_REASONS = new Set([
  'expired',
  'revoked',
  'reset',
  'restore',
  'downgrade',
  'mode_transition',
]);

// @ref LLP 0056#typed-terminal-auth-error — the identifier-free frame applies
//   only to the authority capture that owns this socket and never reconnects.
const liveTerminalAuthError = (frame) => {
  const valid = frame?.kind === LIVE_SOCKET_KINDS.AUTH_ERROR
    && LIVE_TERMINAL_AUTH_CODES.has(frame.code)
    && LIVE_TERMINAL_AUTH_REASONS.has(frame.reason);
  const code = valid ? frame.code : 'SNAPBACK_AUTH_LIVE_FRAME_INVALID';
  const message = valid
    ? `the authenticated live transport ended (${frame.reason})`
    : 'the live transport received a malformed terminal auth frame';
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = {
    code,
    message,
    details: valid ? { reason: frame.reason } : {},
  };
  error.terminalAuth = valid;
  return error;
};

const safeNextCounter = (value, code, label) => {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    const error = new Error(`${code}: ${label} is exhausted`);
    error.code = code;
    error.diagnostic = { code, message: `${label} is exhausted` };
    throw error;
  }
  return value + 1;
};

const clientAuthorityFromHandshake = (session) => {
  const base = {
    authMode: session.activeMode,
    authorizationStreamIncarnation: session.authorizationStreamIncarnation,
  };
  return session.authority?.isAuthenticated
    ? {
        kind: 'session',
        ...base,
        sessionId: session.authority.sessionId,
        userId: session.authority.userId,
      }
    : { kind: 'anonymous', ...base };
};

const credentialAuthority = (response, activeMode = 'sessions', incarnation = null) => ({
  kind: 'session',
  authMode: activeMode,
  authorizationStreamIncarnation: incarnation,
  sessionId: response?.session?.id,
  userId: response?.session?.userId,
});

const sameClientAuthority = (left, right) => (
  left?.kind === right?.kind
  && left?.authMode === right?.authMode
  && left?.authorizationStreamIncarnation === right?.authorizationStreamIncarnation
  && (left?.kind !== 'session' || (
    left?.sessionId === right?.sessionId
    && left?.userId === right?.userId
  ))
);

const staleAuthorityError = () => {
  const diagnostic = {
    code: 'SNAPBACK_CLIENT_AUTHORITY_STALE',
    message: 'the operation completed under a stale client authority',
  };
  const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
  error.code = diagnostic.code;
  error.diagnostic = diagnostic;
  return error;
};

export class SnapbackClient {
  constructor(baseUrl, {
    adminToken = (typeof process !== 'undefined' && process.env ? process.env.SNAPBACK_ADMIN_TOKEN : null) ?? null,
    bearerToken = null,
    authClientProtocol = 1,
    authInvalidationProtocol = null,
    authorityDescriptorProtocol = 1,
    authorizedLeaseProtocol = null,
    authCoordinator = null,
    clientStoreId = processClientStoreId,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.adminToken = adminToken;
    if (authCoordinator && bearerToken !== null) {
      throw new TypeError('bearerToken cannot bypass AuthCoordinator custody; use authExchange()');
    }
    this.bearerToken = bearerToken;
    this.authCoordinator = authCoordinator;
    this.clientStoreId = clientStoreId;
    this.__liveQueryAllocator = allocatorForClientStore(clientStoreId);
    this.authProtocols = Object.freeze({
      authClient: authClientProtocol,
      authInvalidation: authInvalidationProtocol,
      authorityDescriptor: authorityDescriptorProtocol,
      authorizedLease: authorizedLeaseProtocol,
    });
    // Keep the last validated projection separate from the current network
    // attempt. A forced offline probe may reject without poisoning or
    // replacing the durable/offline fence's last successful projection.
    this.__authSessionLastSuccessful = null;
    this.__authSessionInFlight = null;
    this.__authSessionCacheGeneration = 0;
    // Receipt retention, kit half (LLP 0034 §3 / ENG-22478): a bounded ring
    // of every receipt this client observed (mutation receipts riding
    // responses, subscription receipts emitted by live handles, ephemeral
    // publish receipts), surfaced to the adapter via receipts()/onReceipt.
    this.__receiptRing = [];
    this.__receiptListeners = new Set();
    // Cross-lane drain routing (LLP 0034 §10.1 residual): per-connection
    // consumer registries so one connection's durable and ephemeral lanes
    // never destructively discard each other's envelopes on drain.
    this.__laneConsumers = new Map();
    // ENG-23442 connection grants: caller label -> Promise<{id, token}>.
    this.__connectionGrants = new Map();
    this.__authControllers = new Set();
    this.__rawLiveStreams = new Set();
    this.__authTransportGeneration = 0;
    this.__authSessionCapture = null;
    this.__authTransportParticipant = {
      name: 'snapback-kit-transport',
      quiesce: async () => {
        this.__authTransportGeneration = safeNextCounter(
          this.__authTransportGeneration,
          'SNAPBACK_CLIENT_AUTH_TRANSPORT_GENERATION_EXHAUSTED',
          'auth transport generation',
        );
        for (const controller of this.__authControllers) controller.abort(staleAuthorityError());
        for (const stream of this.__rawLiveStreams) stream.close();
        for (const manager of this.__liveStreamManagers?.values?.() ?? []) manager.close();
      },
      blank: () => {},
      clearMemory: () => {
        this.clearAuthSession();
        this.__connectionGrants.clear();
        this.__laneConsumers.clear();
        this.__receiptRing.length = 0;
        this.__liveStreamManagers?.clear?.();
      },
      commitDurable: async () => {},
      resume: async (context) => {
        await this.#resumeAuthTransport(context.capture);
      },
    };
    this.__authParticipantUnregister = authCoordinator?.registerParticipant?.(
      this.__authTransportParticipant,
    ) ?? null;
  }

  /// Resolve the current server/mode/authority projection. A successful value
  /// is process- and generation-scoped by the returned nonce/generation; the
  /// cache is cleared on every authority change and terminal mode/credential
  /// diagnostic. Connection and subscribe boundaries request a fresh value.
  // @ref LLP 0055#kit-ordering — no online boundary relies on capability-manifest mode guesses.
  authSession({ force = false } = {}) {
    if (this.authProtocols.authClient == null) return Promise.resolve(null);
    if (!force && this.__authSessionLastSuccessful) {
      if (!this.authCoordinator) return Promise.resolve(this.__authSessionLastSuccessful);
      try {
        const capture = this.authCoordinator.capture();
        if (
          this.__authSessionCapture?.authorityEpoch === capture.authorityEpoch
          && this.__authSessionCapture?.authorityKey === capture.authorityKey
        ) return Promise.resolve(this.__authSessionLastSuccessful);
      } catch {
        // A blank/clearing coordinator must synchronize before cache use.
      }
    }
    if (this.__authSessionInFlight) return this.__authSessionInFlight;
    const cacheGeneration = this.__authSessionCacheGeneration;
    const operation = this.authCoordinator
      ? this.#coordinatedAuthSession({ cacheGeneration })
      : this.#uncoordinatedAuthSession({ cacheGeneration });
    let pending;
    pending = Promise.resolve(operation).finally(() => {
      if (this.__authSessionInFlight === pending) this.__authSessionInFlight = null;
    });
    this.__authSessionInFlight = pending;
    return pending;
  }

  async #uncoordinatedAuthSession({ cacheGeneration }) {
    try {
      const session = await this.#fetchJson(
        'GET',
        '/auth/session',
        undefined,
        this.#authOfferHeaders(true),
      );
      this.#validateAuthSession(session);
      if (this.__authSessionCacheGeneration === cacheGeneration) {
        this.__authSessionLastSuccessful = session;
        this.__authSessionCapture = null;
      }
      return session;
    } catch (error) {
      if (
        this.__authSessionCacheGeneration === cacheGeneration
        && !isUnavailableAuthTransport(error)
      ) {
        this.__authSessionLastSuccessful = null;
        this.__authSessionCapture = null;
      }
      throw error;
    }
  }

  setBearerToken(token) {
    if (this.authCoordinator) {
      throw new TypeError('setBearerToken cannot bypass AuthCoordinator; use authExchange() or authRefresh()');
    }
    if (token === this.bearerToken) return;
    this.bearerToken = token ?? null;
    this.clearAuthSession();
    this.__connectionGrants.clear();
  }

  clearAuthSession() {
    this.__authSessionCacheGeneration = safeNextCounter(
      this.__authSessionCacheGeneration,
      'SNAPBACK_CLIENT_AUTH_SESSION_GENERATION_EXHAUSTED',
      'auth session cache generation',
    );
    this.__authSessionLastSuccessful = null;
    this.__authSessionInFlight = null;
    this.__authSessionCapture = null;
  }

  captureAuthority() {
    return this.authCoordinator?.capture?.() ?? null;
  }

  authorityCaptureFor(value) {
    return value?.[AUTHORITY_CAPTURE] ?? null;
  }

  registerAuthBarrierParticipant(participant) {
    if (!this.authCoordinator) return async () => {};
    // Insert stores/surfaces before the transport. The barrier's reverse
    // resume order then brings the handshake/grant transport up first, while
    // quiesce/blank still run deterministically in the declared list order.
    return this.authCoordinator.registerParticipant(participant, {
      before: this.__authTransportParticipant,
    });
  }

  #authOfferHeaders(includeAll = false, bearerOverride = undefined) {
    const headers = {};
    const add = (name, version) => {
      if (version != null) headers[name] = String(version);
    };
    add(AUTH_CLIENT_PROTOCOL_HEADER, this.authProtocols.authClient);
    if (includeAll) {
      add(AUTH_INVALIDATION_PROTOCOL_HEADER, this.authProtocols.authInvalidation);
      add(AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER, this.authProtocols.authorityDescriptor);
      add(AUTHORIZED_LEASE_PROTOCOL_HEADER, this.authProtocols.authorizedLease);
    }
    const bearer = bearerOverride === undefined
      ? this.authCoordinator
        ? (() => {
            try { return this.authCoordinator.credentialFor(this.authCoordinator.capture()).bearer; }
            catch { return null; }
          })()
        : this.bearerToken
      : bearerOverride;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    return headers;
  }

  #validateAuthSession(session) {
    const descriptorRequired = session?.clientProtocols?.authorityDescriptor === 1
      || session?.availability?.queuedReplay?.minimumAuthorityDescriptorProtocol === 1;
    const valid = session
      && session.protocolVersion === 1
      && typeof session.serverStartupNonce === 'string'
      && session.serverStartupNonce.length > 0
      && Number.isSafeInteger(session.transitionGeneration)
      && session.transitionGeneration >= 0
      && (session.activeMode === 'dev' || session.activeMode === 'sessions')
      && (session.desiredMode === 'dev' || session.desiredMode === 'sessions')
      && session.availability
      && session.authority;
    const descriptorValid = !descriptorRequired
      || authorityDescriptorIsValid(session?.authorityDescriptor);
    const coordinatedValid = !this.authCoordinator || (
      typeof session.authorizationStreamIncarnation === 'string'
      && session.authorizationStreamIncarnation.length > 0
      && typeof session.authority.isAuthenticated === 'boolean'
      && (
        !session.authority.isAuthenticated
        || (
          typeof session.authority.userId === 'string'
          && typeof session.authority.sessionId === 'string'
        )
      )
    );
    if (valid && coordinatedValid && descriptorValid) return;
    const diagnostic = {
      code: 'SNAPBACK_AUTH_HANDSHAKE_INVALID',
      message: 'GET /auth/session returned an invalid protocol-v1 response',
    };
    const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
    error.diagnostic = diagnostic;
    throw error;
  }

  async #trackedFetchJson(method, path, body, headers) {
    const controller = new AbortController();
    this.__authControllers.add(controller);
    try {
      return await this.#fetchJson(method, path, body, headers, { signal: controller.signal });
    } finally {
      this.__authControllers.delete(controller);
    }
  }

  #cacheAuthSession(session, capture, cacheGeneration = this.__authSessionCacheGeneration) {
    if (this.__authSessionCacheGeneration !== cacheGeneration) return session;
    this.__authSessionLastSuccessful = session;
    this.__authSessionCapture = capture
      ? { authorityEpoch: capture.authorityEpoch, authorityKey: capture.authorityKey }
      : null;
    return session;
  }

  async currentAuthorityDescriptor() {
    const session = await this.authSession();
    return requireAuthorityDescriptor(session?.authorityDescriptor);
  }

  async currentAuthorizationScope({ devUserId = null } = {}) {
    const session = await this.authSession();
    const authorityDescriptor = requireAuthorityDescriptor(session?.authorityDescriptor);
    const authorizationStreamIncarnation = session?.authorizationStreamIncarnation
      ?? (session?.activeMode === 'dev' ? authorityDescriptor.authorityInstanceId : null);
    if (!UUID_V7.test(authorizationStreamIncarnation ?? '')) {
      const error = new Error(
        'SNAPBACK_AUTH_HANDSHAKE_INVALID: authorization stream incarnation is missing',
      );
      error.code = 'SNAPBACK_AUTH_HANDSHAKE_INVALID';
      throw error;
    }
    const userId = session.activeMode === 'sessions'
      ? (session.authority?.isAuthenticated ? session.authority.userId : null)
      : devUserId;
    return Object.freeze({
      principalScope: Object.freeze({
        authMode: session.activeMode,
        authorizationStreamIncarnation,
        userId: userId ?? null,
      }),
      authorityDescriptor,
      queryAuthorization: Object.freeze({}),
    });
  }

  async #fetchAuthSessionWithBearer(bearer) {
    const session = await this.#trackedFetchJson(
      'GET',
      '/auth/session',
      undefined,
      this.#authOfferHeaders(true, bearer),
    );
    this.#validateAuthSession(session);
    return session;
  }

  async #coordinatedAuthSession({
    retry = true,
    cacheGeneration = this.__authSessionCacheGeneration,
  } = {}) {
    const coordinator = this.authCoordinator;
    await coordinator.synchronize();
    let capture = null;
    try { capture = coordinator.capture(); } catch { /* fresh custody boot */ }

    if (!capture) {
      const session = await this.#fetchAuthSessionWithBearer(null);
      const authority = clientAuthorityFromHandshake(session);
      if (authority.kind !== 'anonymous') {
        throw staleAuthorityError();
      }
      capture = await coordinator.establishAnonymous(authority);
      return this.#cacheAuthSession(session, capture, cacheGeneration);
    }

    const credential = coordinator.credentialFor(capture);
    try {
      const session = await this.#fetchAuthSessionWithBearer(credential.bearer);
      if (!coordinator.isCurrent(capture)) {
        if (retry) {
          return this.#coordinatedAuthSession({
            retry: false,
            cacheGeneration,
          });
        }
        throw staleAuthorityError();
      }
      const observed = clientAuthorityFromHandshake(session);
      if (!sameClientAuthority(observed, credential.authority)) {
        capture = await coordinator.transition(capture, {
          authority: observed,
          bearer: observed.kind === 'session' ? credential.bearer : null,
          refreshAfterMs: observed.kind === 'session' ? credential.refreshAfterMs : null,
        }, 'handshake_authority_change');
      }
      return this.#cacheAuthSession(session, capture, cacheGeneration);
    } catch (error) {
      if (
        this.__authSessionCacheGeneration === cacheGeneration
        && !isUnavailableAuthTransport(error)
      ) {
        this.__authSessionLastSuccessful = null;
        this.__authSessionCapture = null;
      }
      if (!coordinator.isCurrent(capture) && retry) {
        return this.#coordinatedAuthSession({
          retry: false,
          cacheGeneration,
        });
      }
      throw error;
    }
  }

  async #resumeAuthTransport(capture) {
    const credential = this.authCoordinator.credentialFor(capture);
    const session = await this.#fetchAuthSessionWithBearer(credential.bearer);
    const observed = clientAuthorityFromHandshake(session);
    if (!sameClientAuthority(observed, credential.authority)) {
      const error = new Error(
        'SNAPBACK_AUTH_HANDSHAKE_AUTHORITY_MISMATCH: resume handshake does not match settled custody',
      );
      error.code = 'SNAPBACK_AUTH_HANDSHAKE_AUTHORITY_MISMATCH';
      error.diagnostic = {
        code: error.code,
        message: 'resume handshake does not match settled custody',
      };
      throw error;
    }
    this.#cacheAuthSession(session, capture);
  }

  #validateCredentialResponse(response) {
    const valid = response
      && response.tokenType === 'Bearer'
      && typeof response.token === 'string'
      && response.token.length > 0
      && Number.isSafeInteger(response.refreshAfter)
      && response.session
      && typeof response.session.id === 'string'
      && typeof response.session.userId === 'string'
      && authorityDescriptorIsValid(response.authorityDescriptor);
    if (valid) return response;
    const error = new Error(
      'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: auth provider returned an invalid credential response',
    );
    error.code = 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
    error.diagnostic = {
      code: error.code,
      message: 'auth provider returned an invalid credential response',
    };
    throw error;
  }

  async #familyAlarmWithBearer(bearer) {
    if (!bearer) return { accepted: false };
    return this.#trackedFetchJson(
      'POST',
      '/auth/family-alarm',
      {},
      this.#authOfferHeaders(true, bearer),
    );
  }

  // ENG-23442: connection ids are server-granted capabilities, not bare
  // caller-chosen strings. The kit opens a grant transparently the first time
  // a connection id is used: `POST /connection/open` adopts the caller's
  // readable id in non-prod profiles (demos, acceptance suites, and
  // gated-inspect output keep meaningful ids) or mints an unguessable one
  // (prod, or a suggestion colliding with a live grant). Every wire operation
  // uses the GRANTED id plus its bearer token; callers keep addressing the
  // kit by their own label. Registries (lane consumers, stream managers) stay
  // label-keyed, so a caller never needs to learn the wire id.
  //
  // @ref LLP 0031#connection-capability-grants — the client half of the handshake.
  connectionGrant(connectionId) {
    if (!connectionId) {
      return Promise.reject(new TypeError('Snapback connectionId is required for connection-scoped operations'));
    }
    let grant = this.__connectionGrants.get(connectionId);
    if (!grant) {
      grant = this.#openGrant(connectionId, null);
      this.__connectionGrants.set(connectionId, grant);
    }
    return grant;
  }

  /// Re-run the handshake for a label whose grant looks stale (a rejected
  /// token, a socket that never opened — typically a restarted server whose
  /// grant registry is empty). The previous token rides along so a still-live
  /// server returns the SAME grant idempotently; a restarted server adopts
  /// the label afresh. Either way the connection identity survives.
  refreshConnectionGrant(connectionId) {
    const stale = this.__connectionGrants.get(connectionId) ?? null;
    let grant;
    grant = (stale ? stale.catch(() => null) : Promise.resolve(null)).then(
      (previous) => this.#openGrant(connectionId, previous?.token ?? null, () => grant),
    );
    this.__connectionGrants.set(connectionId, grant);
    return grant;
  }

  #openGrant(connectionId, previousToken, storedAs = null) {
    let grant;
    grant = this.#req('POST', '/connection/open', {
      connectionId,
      ...(previousToken ? { previousToken } : {}),
      ...(this.authProtocols.authInvalidation != null
        ? { authInvalidationProtocol: this.authProtocols.authInvalidation }
        : {}),
    }).then(
      (granted) => {
        const authorizationInvalidation = granted.authorizationInvalidation == null
          ? null
          : validateAuthorizationInvalidationConnection(granted.authorizationInvalidation);
        return markAuthorityCapture({
          id: granted.connectionId,
          token: granted.connectionToken,
          authorizationInvalidation,
        }, granted?.[AUTHORITY_CAPTURE] ?? null);
      },
      (error) => {
        // A failed open must not poison the label: drop the cached promise
        // so the next operation retries the handshake. The cache may hold
        // this promise directly (first open) or a wrapper derived from it
        // (refresh) — compare against whichever the caller stored.
        const stored = this.__connectionGrants.get(connectionId);
        if (stored === grant || (storedAs && stored === storedAs())) {
          this.__connectionGrants.delete(connectionId);
        }
        throw error;
      },
    );
    return grant;
  }

  /// Run one connection-scoped operation; on a token rejection, refresh the
  /// grant once (server restart recovery) and retry the operation.
  async #withGrant(connectionId, run) {
    const cached = this.connectionGrant(connectionId);
    const grant = await cached;
    try {
      return await run(grant);
    } catch (error) {
      if (error?.diagnostic?.code !== 'SNAPBACK_CONNECTION_TOKEN_INVALID') throw error;
      // Another operation may have refreshed the grant already; only refresh
      // when this operation still holds the rejected one.
      if (this.__connectionGrants.get(connectionId) === cached) {
        await this.refreshConnectionGrant(connectionId);
      }
      return run(await this.connectionGrant(connectionId));
    }
  }

  /// Record a receipt into the bounded kit ring and notify listeners.
  recordReceipt(receipt, capture = receipt?.[AUTHORITY_CAPTURE] ?? null) {
    if (!receipt || typeof receipt !== 'object') return receipt;
    if (this.authCoordinator && (!capture || !this.authCoordinator.isCurrent(capture))) {
      return receipt;
    }
    this.__receiptRing.push(receipt);
    while (this.__receiptRing.length > RECEIPT_RING_CAP) this.__receiptRing.shift();
    for (const listener of [...this.__receiptListeners]) {
      // A throwing app listener must never turn a committed operation into a
      // client-side failure (ENG-22478 review fix G).
      try {
        listener(receipt);
      } catch {
        // Listener errors are the listener's problem, not the operation's.
      }
    }
    return receipt;
  }

  /// The receipts this client has observed, oldest first (bounded ring).
  receipts() {
    return [...this.__receiptRing];
  }

  onReceipt(listener) {
    this.__receiptListeners.add(listener);
    return () => this.__receiptListeners.delete(listener);
  }

  #laneConsumersFor(connectionId) {
    let consumers = this.__laneConsumers.get(connectionId);
    if (!consumers) {
      consumers = { durable: new Set(), ephemeral: new Set() };
      this.__laneConsumers.set(connectionId, consumers);
    }
    return consumers;
  }

  registerDurableConsumer(connectionId, consumer) {
    const consumers = this.#laneConsumersFor(connectionId);
    consumers.durable.add(consumer);
    return () => consumers.durable.delete(consumer);
  }

  registerEphemeralConsumer(connectionId, consumer) {
    const consumers = this.#laneConsumersFor(connectionId);
    consumers.ephemeral.add(consumer);
    return () => consumers.ephemeral.delete(consumer);
  }

  static auth(userId, { permissions = [] } = {}) {
    return { principal: userId ?? null, session_id: null, user_id: userId ?? null, permissions };
  }

  static roomPermission(prefix, scope) {
    return `${prefix}:${normalizedScopeKey(scope)}`;
  }

  async #request(method, path, body, headers, {
    admin = false,
    supersededRetry = true,
  } = {}) {
    let session = null;
    let capture = null;
    let bearerUsed = null;
    const transportGeneration = this.__authTransportGeneration;
    try {
      if (this.authCoordinator) {
        await this.authCoordinator.synchronize();
        try { capture = this.authCoordinator.capture(); } catch { /* bootstrap handshake below */ }
      }
      if (
        !admin
        && this.authProtocols.authClient != null
        && authHandshakeRequired(path)
      ) {
        session = await this.authSession({ force: freshAuthHandshakeRequired(path) });
        const unavailable = authAvailabilityError(session);
        if (unavailable) throw unavailable;
      }
      if (this.authCoordinator) {
        // authSession may have bootstrapped or transitioned custody.
        capture = this.authCoordinator.capture();
        bearerUsed = this.authCoordinator.credentialFor(capture).bearer;
      }

      const sessionsMode = session?.activeMode === 'sessions';
      let requestBody = body;
      if (path.startsWith('/mutation/') && body?.clientMutationId) {
        const queuedAvailability = session?.availability?.queuedReplay;
        if (session && queuedAvailability?.available !== true) {
          const code = queuedAvailability?.reason ?? 'SNAPBACK_AUTH_POLICY_UNAVAILABLE';
          const error = new Error(`${code}: queued mutation replay is unavailable`);
          error.code = code;
          error.diagnostic = { code, message: 'queued mutation replay is unavailable' };
          throw error;
        }
        const descriptor = body.authorityDescriptor ?? session?.authorityDescriptor ?? null;
        if (descriptor !== null || sessionsMode) {
          requestBody = {
            ...body,
            authorityDescriptor: requireAuthorityDescriptor(
              descriptor,
              'SNAPBACK_AUTHORITY_DESCRIPTOR_INVALID',
            ),
          };
        }
      }
      const wireBody = sessionsMode ? sessionWireBody(path, requestBody) : requestBody;
      const merged = {
        ...(admin && this.adminToken ? { 'x-snapback-admin-token': this.adminToken } : {}),
        ...(sessionsMode ? this.#sessionRequestHeaders(
          path,
          requestBody,
          this.authCoordinator ? bearerUsed : undefined,
        ) : {}),
        ...(headers ?? {}),
      };
      const result = await this.#trackedFetchJson(method, path, wireBody, merged);
      if (!this.authCoordinator) return result;
      if (
        transportGeneration !== this.__authTransportGeneration
        || !this.authCoordinator.isCurrent(capture)
      ) throw staleAuthorityError();
      const committed = await this.authCoordinator.compareAndCommit(capture, () => (
        markAuthorityCapture(result, capture)
      ));
      if (!committed.committed) throw staleAuthorityError();
      return committed.value;
    } catch (error) {
      const code = error?.diagnostic?.code ?? error?.code;
      if (this.authCoordinator && capture) markAuthorityCapture(error, capture);
      if (this.authCoordinator && capture && !this.authCoordinator.isCurrent(capture)) {
        throw staleAuthorityError();
      }
      if (this.authCoordinator && capture && error?.receipt) {
        markAuthorityCapture(error.receipt, capture);
      }
      if (this.authCoordinator && capture && SUPERSEDED_AUTH_CODES.has(code)) {
        const successor = await this.authCoordinator.waitForNewerRevision(capture);
        if (successor && supersededRetry) {
          this.clearAuthSession();
          return this.#request(method, path, body, headers, { admin, supersededRetry: false });
        }
        try { await this.#familyAlarmWithBearer(bearerUsed); } catch { /* named stolen-successor residual */ }
        await this.authCoordinator.compareAndClear(capture, 'credential_superseded_without_successor');
      } else if (this.authCoordinator && capture && TERMINAL_AUTH_CODES.has(code)) {
        await this.authCoordinator.compareAndClear(capture, code);
      }
      if ([
        'SNAPBACK_AUTH_MODE_PENDING',
        'SNAPBACK_AUTH_REQUIRED',
        'SNAPBACK_AUTH_SESSION_EXPIRED',
        'SNAPBACK_AUTH_SESSION_REVOKED',
        'SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED',
        'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
      ].includes(code)) {
        this.clearAuthSession();
      }
      throw error;
    }
  }

  #sessionRequestHeaders(path, originalBody, bearerOverride = undefined) {
    const headers = this.#authOfferHeaders(false, bearerOverride);
    const authorizedLeaseRequest = path.startsWith('/query/')
      && path.endsWith('/authorized-lease');
    const standaloneAcknowledgement = path === '/client-mutations/acknowledge'
      || path === '/live/authorization-invalidation/acknowledge'
      || path === '/live/authorization-invalidation/manual-retry';
    if (path.startsWith('/live/') || path.startsWith('/ephemeral/') || authorizedLeaseRequest) {
      if (this.authProtocols.authInvalidation != null) {
        headers[AUTH_INVALIDATION_PROTOCOL_HEADER] = String(this.authProtocols.authInvalidation);
      }
    }
    if (authorizedLeaseRequest && this.authProtocols.authorizedLease != null) {
      headers[AUTHORIZED_LEASE_PROTOCOL_HEADER] = String(
        this.authProtocols.authorizedLease,
      );
    }
    if (
      (path.startsWith('/mutation/') && originalBody?.clientMutationId)
      || standaloneAcknowledgement
    ) {
      if (this.authProtocols.authorityDescriptor != null) {
        headers[AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER] = String(
          this.authProtocols.authorityDescriptor,
        );
      }
    }
    return headers;
  }

  async #fetchJson(method, path, body, headers, { signal = undefined } = {}) {
    const merged = {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headers ?? {}),
    };
    const requestSecrets = collectRequestSecrets(body, merged);
    let res;
    let text;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: Object.keys(merged).length > 0 ? merged : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      text = await res.text();
    } catch (error) {
      throw sanitizeTransportError(error, requestSecrets);
    }
    // @ref LLP 0032#confirmed-defect-register — S5.D3: check status before
    //   trusting the body as JSON, so a proxy 502 HTML page surfaces as a
    //   structured diagnostic instead of a bare SyntaxError.
    let json = null;
    let parseError = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        parseError = error;
      }
    }
    if (!res.ok) {
      const rawDiagnostic = json && json.diagnostic
        ? json.diagnostic
        : parseError
          ? { code: 'SNAPBACK_HTTP_ERROR', message: `HTTP ${res.status} with non-JSON body: ${bodySnippet(redactKnownSecrets(text, requestSecrets))}` }
          : { code: `HTTP_${res.status}`, message: text };
      const diag = sanitizeProtocolErrorValue(rawDiagnostic, requestSecrets);
      const error = new Error(`${diag.code}: ${diag.message ?? ''}`);
      error.diagnostic = diag;
      error.status = res.status;
      if (json?.receipt) {
        error.receipt = sanitizeProtocolErrorValue(json.receipt, requestSecrets);
      }
      throw error;
    }
    if (parseError) {
      const diag = {
        code: 'SNAPBACK_RESPONSE_NOT_JSON',
        message: `HTTP ${res.status} response is not JSON: ${bodySnippet(redactKnownSecrets(text, requestSecrets))}`,
      };
      const error = new Error(`${diag.code}: ${diag.message}`);
      error.diagnostic = diag;
      error.status = res.status;
      throw error;
    }
    return json;
  }

  #req(method, path, body, headers) {
    return this.#request(method, path, body, headers);
  }

  #adminReq(method, path, body, headers) {
    return this.#request(method, path, body, headers, { admin: true });
  }

  health() { return this.#req('GET', '/health'); }
  inspect() { return this.#req('GET', '/inspect'); }

  async authRequestCode(email) {
    if (!this.authCoordinator) return this.#req('POST', '/auth/request-code', { email });
    await this.authSession();
    const capture = this.authCoordinator.capture();
    const response = await this.#trackedFetchJson(
      'POST',
      '/auth/request-code',
      { email },
      this.#authOfferHeaders(true, null),
    );
    const committed = await this.authCoordinator.compareAndCommit(capture, () => (
      markAuthorityCapture(response, capture)
    ));
    if (!committed.committed) throw staleAuthorityError();
    return committed.value;
  }

  // The provider returns a bearer, but coordinated clients never publish it
  // to app code. Custody advances and every local participant resumes before
  // this method exposes the non-secret session projection.
  async authExchange({ challengeId, code }) {
    if (!this.authCoordinator) {
      throw new TypeError('authExchange requires AuthCoordinator custody');
    }
    await this.authSession();
    const capture = this.authCoordinator.capture();
    const predecessor = this.authCoordinator.credentialFor(capture);
    if (predecessor.authority.kind !== 'anonymous') {
      throw staleAuthorityError();
    }
    const response = this.#validateCredentialResponse(await this.#trackedFetchJson(
      'POST',
      '/auth/exchange',
      { challengeId, code },
      this.#authOfferHeaders(true, null),
    ));
    const authority = credentialAuthority(
      response,
      'sessions',
      predecessor.authority.authorizationStreamIncarnation,
    );
    await this.authCoordinator.transition(capture, {
      authority,
      bearer: response.token,
      refreshAfterMs: response.refreshAfter,
    }, 'login');
    return {
      tokenType: response.tokenType,
      refreshAfter: response.refreshAfter,
      session: response.session,
      authorityDescriptor: { ...response.authorityDescriptor },
    };
  }

  async authRefresh() {
    if (!this.authCoordinator) {
      throw new TypeError('authRefresh requires AuthCoordinator custody');
    }
    const currentDescriptor = requireAuthorityDescriptor(
      (await this.authSession()).authorityDescriptor,
    );
    const capture = this.authCoordinator.capture();
    const suspect = this.authCoordinator.credentialFor(capture).bearer;
    try {
      const outcome = await this.authCoordinator.withCredentialRotation(
        capture,
        async ({ bearer, authority }) => {
          const response = this.#validateCredentialResponse(await this.#trackedFetchJson(
            'POST',
            '/auth/refresh',
            {},
            this.#authOfferHeaders(true, bearer),
          ));
          const observed = credentialAuthority(
            response,
            'sessions',
            authority.authorizationStreamIncarnation,
          );
          if (!sameClientAuthority(observed, authority)) {
            const error = new Error(
              'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: refresh changed session authority',
            );
            error.code = 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
            throw error;
          }
          if (
            response.authorityDescriptor.authorityInstanceId
            !== currentDescriptor.authorityInstanceId
          ) {
            const error = new Error(
              'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: refresh changed authority instance',
            );
            error.code = 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
            throw error;
          }
          return {
            bearer: response.token,
            refreshAfterMs: response.refreshAfter,
            value: {
              tokenType: response.tokenType,
              refreshAfter: response.refreshAfter,
              session: response.session,
              authorityDescriptor: { ...response.authorityDescriptor },
            },
          };
        },
      );
      if (!outcome.rotated) {
        const successor = await this.authCoordinator.waitForNewerRevision(capture);
        if (successor) return { superseded: true };
        throw staleAuthorityError();
      }
      this.clearAuthSession();
      return outcome.value;
    } catch (error) {
      const errorCode = error?.diagnostic?.code ?? error?.code;
      if (!SUPERSEDED_AUTH_CODES.has(errorCode)) throw error;
      const successor = await this.authCoordinator.waitForNewerRevision(capture);
      if (successor) return { superseded: true };
      try { await this.#familyAlarmWithBearer(suspect); } catch { /* named residual */ }
      await this.authCoordinator.compareAndClear(capture, 'refresh_superseded_without_successor');
      throw error;
    }
  }

  async authLogout() {
    if (!this.authCoordinator) {
      throw new TypeError('authLogout requires AuthCoordinator custody');
    }
    await this.authSession();
    const capture = this.authCoordinator.capture();
    const bearer = this.authCoordinator.credentialFor(capture).bearer;
    const response = await this.#trackedFetchJson(
      'POST',
      '/auth/logout',
      {},
      this.#authOfferHeaders(true, bearer),
    );
    const cleared = await this.authCoordinator.compareAndClear(capture, 'logout');
    if (!cleared.cleared) throw staleAuthorityError();
    return response;
  }

  async closeAuth() {
    for (const controller of this.__authControllers) controller.abort();
    await this.__authParticipantUnregister?.();
    this.__authParticipantUnregister = null;
  }
  // @ref LLP 0031#migration-plan — system writes moved from ungated root
  //   /admin/* aliases to the gated /_snapback/api/* namespace (D5). Per
  //   LLP 0017#security-defaults, served loopback writes now require a local
  //   admin token; the shared server harness supplies it for demos/tests.
  loadSchema(manifest) { return this.#adminReq('POST', '/_snapback/api/schema/load', manifest); }
  ensureEphemeralCollections(manifestOrCollections) {
    const collections = Array.isArray(manifestOrCollections)
      ? manifestOrCollections
      : manifestOrCollections?.ephemeralCollections ?? manifestOrCollections?.collections ?? [];
    return this.#req('POST', '/ephemeral/collections/ensure', {
      collections,
      schemaHash: manifestOrCollections?.schemaHash ?? null,
      inputsHash: manifestOrCollections?.inputsHash ?? null,
    });
  }
  loadFunctions(manifest) { return this.#adminReq('POST', '/_snapback/api/functions/load', manifest); }
  // The single idempotent mount-lifecycle ensure (LLP 0034 §5 / ENG-22527):
  // inspects schemaHash/bundleHash/collections against the posted generated
  // manifests, provisions ONLY what is missing/mismatched, seeds only when
  // the seed's target tables are all empty — never reset-then-seed. Throws a
  // structured diagnostic when the server profile gates a needed half.
  async ensureApp({ schema = null, functions = null, seed = null } = {}) {
    const outcome = await this.#req('POST', '/app/ensure', {
      ...(schema ? { schema } : {}),
      ...(functions ? { functions } : {}),
      ...(seed ? { seed } : {}),
    });
    const gated = ['schema', 'functions', 'seed'].filter((part) => outcome[part] === 'gated');
    if (gated.length > 0) {
      const diag = {
        code: 'SNAPBACK_PROFILE_FORBIDS',
        message: `backend is not provisioned and the '${outcome.profile}' profile gates provisioning: ${gated.join(', ')}`,
      };
      const error = new Error(`${diag.code}: ${diag.message}`);
      error.diagnostic = diag;
      error.outcome = outcome;
      throw error;
    }
    return outcome;
  }
  // app.reset folds seed in as an optional argument (LLP 0031 D5): reset() wipes,
  // reset(seed) / seed(seed) reset-then-seed. There is no seed-without-reset path.
  reset(seed) { return this.#adminReq('POST', '/_snapback/api/app/reset', seed ? { seed } : {}); }
  seed(seed) { return this.#adminReq('POST', '/_snapback/api/app/reset', { seed }); }
  // Forced scheduler tick — an AdminWrite like the other /_snapback/api/*
  // system calls, so it must ride #adminReq for the admin token and fail loudly on
  // a non-2xx instead of a raw fetch silently swallowing a 401 (ENG-23706).
  cronTick() { return this.#adminReq('POST', '/_snapback/api/cron/tick', {}); }

  query(ref, { args = {}, userId, readSet = [] } = {}) {
    const name = functionName(ref);
    return this.#req('POST', `/query/${encodeURIComponent(name)}`, { args, auth: SnapbackClient.auth(userId), read_set: readSet });
  }

  // Item 8's only renewal path: a fresh full query whose rows and exact
  // server-issued AuthorizedLease are returned as one response boundary.
  // The caller reserves leaseRequestId durably before entering this method.
  //
  // @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
  // heartbeat, reconnect, delta delivery, and session refresh never renew.
  authorizedLeaseQuery(ref, {
    args = {},
    userId,
    readSet = [],
    leaseRequestId,
    authorizationNamespace,
  } = {}) {
    const name = functionName(ref);
    const namespace = createLiveQueryNamespace(authorizationNamespace ?? {});
    if (typeof leaseRequestId !== 'string' || leaseRequestId.length === 0) {
      throw new TypeError('authorizedLeaseQuery requires leaseRequestId');
    }
    return this.#req('POST', `/query/${encodeURIComponent(name)}/authorized-lease`, {
      args,
      auth: SnapbackClient.auth(userId),
      read_set: readSet,
      leaseRequestId,
      clientStoreId: namespace.clientStoreId,
      queryKey: namespace.queryKey,
      queryInstanceId: namespace.queryInstanceId,
    });
  }

  action(ref, { args = {}, userId, readSet = [] } = {}) {
    const name = functionName(ref);
    return this.#req('POST', `/action/${encodeURIComponent(name)}`, { args, auth: SnapbackClient.auth(userId), read_set: readSet });
  }

  acknowledgeMutations({ userId, clientMutationIds = [] } = {}) {
    return this.#req('POST', '/client-mutations/acknowledge', {
      auth: SnapbackClient.auth(userId),
      clientMutationIds,
    });
  }

  async mutate(ref, {
    args = {},
    userId,
    readSet = [],
    correlation = null,
    clientMutationId = null,
    acknowledgedClientMutationIds = [],
    ctxLedger = null,
    authorityDescriptor = null,
  } = {}) {
    const name = functionName(ref);
    const body = { args, auth: SnapbackClient.auth(userId), read_set: readSet };
    // Opaque adapter correlation (LLP 0034 §3.2): sent verbatim, echoed on
    // the receipt; the provider never interprets it.
    if (correlation) body.correlation = correlation;
    // LLP 0043 M2: a queued mutation keeps one durable identity and one
    // captured answer ledger across retries/reloads. The server settles the
    // id atomically with data changes and returns the original result on a
    // duplicate delivery.
    if (clientMutationId) body.clientMutationId = clientMutationId;
    if (authorityDescriptor) {
      body.authorityDescriptor = requireAuthorityDescriptor(
        authorityDescriptor,
        'SNAPBACK_AUTHORITY_DESCRIPTOR_INVALID',
      );
    }
    if (acknowledgedClientMutationIds.length > 0) {
      body.acknowledgedClientMutationIds = acknowledgedClientMutationIds;
    }
    if (ctxLedger) body.ctx_ledger = ctxLedger;
    try {
      const json = await this.#req('POST', `/mutation/${encodeURIComponent(name)}`, body);
      if (json?.receipt) this.recordReceipt(json.receipt);
      return json;
    } catch (error) {
      // A REJECTED mutation still produced its receipt (it rides the error
      // envelope) — retain it before rethrowing.
      if (error?.receipt) this.recordReceipt(error.receipt);
      throw error;
    }
  }

  async subscribeLive(ref, {
    connectionId,
    args = {},
    userId,
    correlation = null,
    supersedes = null,
    authorizationNamespace = null,
  } = {}) {
    const name = functionName(ref);
    const input = { args, auth: SnapbackClient.auth(userId), read_set: [] };
    if (correlation) input.correlation = correlation;
    const response = await this.#withGrant(connectionId, (grant) => {
      const body = { connection_id: grant.id, input };
      const namespace = typeof authorizationNamespace === 'function'
        ? authorizationNamespace(grant)
        : authorizationNamespace;
      if (namespace !== null && namespace !== undefined) {
        body.authorizationNamespace = namespace;
      }
      // Explicit supersession (ENG-22478 review fix A): name the subscription
      // this fresh subscribe replaces (the kit's own resubscribe paths only);
      // the server disposes exactly that id. Never inferred — plain duplicate
      // subscribes coexist.
      if (supersedes) body.supersedes = supersedes;
      return this.#req('POST', `/live/${encodeURIComponent(name)}/subscribe`, body, connectionTokenHeader(grant));
    });
    Object.defineProperty(response, AUTHORIZATION_CONNECTION, {
      value: await this.connectionGrant(connectionId).then(
        (grant) => grant.authorizationInvalidation,
      ),
      configurable: false,
      enumerable: false,
      writable: false,
    });
    if (response?.receipt) this.recordReceipt(response.receipt);
    return response;
  }

  async acknowledgeAuthorizationInvalidation(connectionId, ackToken) {
    return this.#withGrant(connectionId, (grant) => this.#req(
      'POST',
      '/live/authorization-invalidation/acknowledge',
      { connectionId: grant.id, ackToken },
      connectionTokenHeader(grant),
    ));
  }

  /// Explicit unsubscribe (LLP 0034 §10.1 residual / ENG-22478): dispose one
  /// live subscription; ownership mirrors resume_live.
  async unsubscribeLive(ref, { subscriptionId, connectionId, userId } = {}) {
    const name = functionName(ref);
    const response = await this.#withGrant(connectionId, (grant) => this.#req('POST', `/live/${encodeURIComponent(name)}/unsubscribe`, {
      subscription_id: subscriptionId,
      connection_id: grant.id,
      auth: SnapbackClient.auth(userId),
    }, connectionTokenHeader(grant)));
    if (response?.receipt) this.recordReceipt(response.receipt);
    return response;
  }

  async subscribeEphemeral(ref, { connectionId, scope = {}, userId, permissions = [] } = {}) {
    const collection = collectionName(ref);
    // @ref LLP 0012#runtime-state — register before the snapshot request so a
    // shared socket cannot destructively drain and discard a post-snapshot
    // delta while the HTTP response is still in flight. The overlay buffers
    // that interval and applies it only after the authoritative snapshot.
    let overlay = null;
    try {
      const snapshot = await this.#withGrant(connectionId, (grant) => {
        // Start buffering immediately before the request is dispatched. Grant
        // acquisition itself cannot create a server-side room registration.
        overlay ??= new EphemeralOverlay(this, ref, { connectionId, scope, userId, permissions });
        return this.#req('POST', '/ephemeral/subscribe', {
          collection,
          scope,
          connection_id: grant.id,
          auth: SnapbackClient.auth(userId, { permissions }),
        }, connectionTokenHeader(grant));
      });
      overlay.applyInitialSnapshot(snapshot);
      return overlay;
    } catch (error) {
      overlay?.dispose();
      if (overlay) {
        // The HTTP subscribe may already have registered the room before a
        // post-response failure (notably a bounded pre-snapshot buffer
        // overflow). Detach locally first, then best-effort the authenticated
        // socket unsubscribe so the abandoned server registration does not
        // linger until connection reap. Cleanup must never mask or delay the
        // original subscribe diagnostic.
        void this.unsubscribeEphemeral(ref, {
          connectionId,
          scope,
          userId,
          permissions,
        }).catch(() => {});
      }
      throw error;
    }
  }

  async publishEphemeral(ref, { connectionId, scope = {}, value, ttlMs = null, userId, permissions = [], sessionId = null, ownerUserId = null, customKey = null } = {}) {
    const collection = collectionName(ref);
    const operationCapture = this.authCoordinator?.capture?.() ?? null;
    try {
      const outcome = await this.#withGrant(connectionId, (grant) => this.#req('POST', '/ephemeral/publish', {
        collection,
        scope,
        connection_id: grant.id,
        session_id: sessionId,
        user_id: ownerUserId,
        custom_key: customKey,
        value: encodeEphemeralValue(value),
        ttl_ms: ttlMs,
        auth: SnapbackClient.auth(userId, { permissions }),
      }, connectionTokenHeader(grant)));
      // Ephemeral one-version story (LLP 0034 §3.1): snapshotVersion is the
      // entryVersion, valid WITHIN a scopeEpoch; the epoch rides in the
      // snapback-namespaced field. Privacy (§3.3): never the payload value.
      this.recordReceipt({
        kind: 'ephemeral-publish',
        collection,
        outcome: 'confirmed',
        snapshotVersion: outcome.entry_version,
        snapback: { scopeEpoch: outcome.scope_epoch, key: outcome.key },
        receivedAtMs: Date.now(),
      }, outcome?.[AUTHORITY_CAPTURE] ?? null);
      return outcome;
    } catch (error) {
      this.recordReceipt({
        kind: 'ephemeral-publish',
        collection,
        outcome: 'rejected',
        rollbackReason: error?.diagnostic?.code ?? 'SNAPBACK_EPHEMERAL_PUBLISH_FAILED',
        receivedAtMs: Date.now(),
      }, error?.[AUTHORITY_CAPTURE] ?? operationCapture);
      throw error;
    }
  }

  // ENG-22527 item 3 / SECURITY: stop observing a room (published entries
  // untouched). Carried over the shared live socket, NOT a public HTTP route:
  // the server binds the requester to this socket's connection
  // (SNAPBACK_WEBSOCKET_SENDER_MISMATCH otherwise), so a participant cannot
  // evict another connection's subscription by asserting its id. Best-effort —
  // if the socket is not open the registration is left to disconnect/reap, and
  // an unknown room/registration is a quiet no-op server-side (removed:false).
  async unsubscribeEphemeral(ref, { connectionId, scope = {}, userId, permissions = [] } = {}) {
    const manager = this.liveStreamManager(connectionId);
    if (!manager.isOpen()) {
      return { removed: false, skipped: 'socket-not-open' };
    }
    // The socket's path identity is the GRANTED id (the manager connected
    // with it), so the frame must carry the same — the server's sender gate
    // compares them. The grant is already resolved here (the manager is open).
    const grant = await this.connectionGrant(connectionId);
    const ack = await manager.request({
      type: 'ephemeral_unsubscribe',
      request: {
        collection: collectionName(ref),
        scope,
        connection_id: grant.id,
        auth: SnapbackClient.auth(userId, { permissions }),
      },
    });
    if (ack?.kind === LIVE_SOCKET_KINDS.EPHEMERAL_ERROR) {
      const diag = ack.diagnostic ?? { code: 'SNAPBACK_EPHEMERAL_UNSUBSCRIBE_FAILED', message: '' };
      const error = new Error(`${diag.code}: ${diag.message ?? ''}`);
      error.diagnostic = diag;
      throw error;
    }
    if (ack?.receipt) this.recordReceipt(ack.receipt);
    return { removed: ack?.removed ?? false, receipt: ack?.receipt };
  }

  async deleteEphemeral(ref, { connectionId, scope = {}, userId, permissions = [], sessionId = null, ownerUserId = null, customKey = null } = {}) {
    return this.#withGrant(connectionId, (grant) => this.#req('POST', '/ephemeral/delete', {
      collection: collectionName(ref),
      scope,
      connection_id: grant.id,
      session_id: sessionId,
      user_id: ownerUserId,
      custom_key: customKey,
      auth: SnapbackClient.auth(userId, { permissions }),
    }, connectionTokenHeader(grant)));
  }

  // @ref LLP 0031#resolved-decisions — D2: connection teardown is system/control,
  //   moved under the gated /_snapback/api/* namespace.
  async disconnect(connectionId) {
    // Admin teardown addresses the WIRE id; do not open a grant just to tear
    // one down — an unopened label falls through verbatim.
    const grant = this.__connectionGrants.has(connectionId)
      ? await this.connectionGrant(connectionId)
      : null;
    return this.#adminReq('POST', `/_snapback/api/connections/${encodeURIComponent(grant?.id ?? connectionId)}/disconnect`);
  }

  async drainEnvelopes(connectionId) {
    return this.#withGrant(connectionId, (grant) => this.#req('GET', `/outbox/${grant.id}`, undefined, connectionTokenHeader(grant)));
  }

  // The shared drain choke point (LLP 0034 §10.1 residual / ENG-22478): a
  // connection's outbox is ONE queue carrying both lanes, so every drain
  // routes each envelope to the registered consumers of ITS lane instead of
  // destructively discarding the other lane's traffic. Returns the decoded
  // durable updates and the raw ephemeral envelopes of this drain, plus the
  // structured diagnostics of any envelopes that failed to decode.
  //
  // GET /outbox/:id is a DESTRUCTIVE drain — the server has already dequeued
  // this whole batch — so nothing per-envelope may abort the loop (ENG-23391):
  // each consumer invocation is isolated (a throwing app callback must never
  // discard the envelopes behind it, including a resync_required sentinel —
  // the ENG-22478 fix-G principle applied to delivery), and a payload that
  // fails to decode is surfaced as a SNAPBACK_ENVELOPE_DECODE_FAILED
  // diagnostic in `decodeFailures` instead of an aborted batch.
  async drainConnection(connectionId) {
    const envelopes = await this.drainEnvelopes(connectionId);
    const consumers = this.__laneConsumers.get(connectionId);
    const durable = [];
    const ephemeral = [];
    const decodeFailures = [];
    for (const env of envelopes) {
      if (env && env.Durable) {
        let update;
        try {
          update = JSON.parse(decodeDurablePayload(env.Durable.payload));
          markAuthorityCapture(update, env[AUTHORITY_CAPTURE] ?? null);
        } catch (error) {
          decodeFailures.push({
            code: 'SNAPBACK_ENVELOPE_DECODE_FAILED',
            message: `durable envelope payload did not decode as JSON: ${error?.message ?? error}`,
          });
          continue;
        }
        durable.push(update);
        for (const consumer of [...(consumers?.durable ?? [])]) deliverIsolated(consumer, update);
      } else if (env) {
        ephemeral.push(env);
        for (const consumer of [...(consumers?.ephemeral ?? [])]) deliverIsolated(consumer, env);
      }
    }
    return { durable, ephemeral, decodeFailures };
  }

  // Drains a connection's outbox and decodes durable live-query updates.
  // Ephemeral envelopes in the same drain are ROUTED to registered ephemeral
  // consumers (e.g. an EphemeralOverlay on this connection), never discarded.
  async drainUpdates(connectionId) {
    return (await this.drainConnection(connectionId)).durable;
  }

  openLiveStream(connectionId, {
    setTimeout: scheduleTimeout = globalThis.setTimeout,
    clearTimeout: cancelTimeout = globalThis.clearTimeout,
  } = {}) {
    const queue = [];
    const waiters = [];
    let streamError = null;
    let wsRef = null;
    let authorityCapture = null;
    const removeWaiter = (waiter) => {
      const index = waiters.indexOf(waiter);
      if (index !== -1) waiters.splice(index, 1);
    };
    const waitForUpdate = (timeoutMs) => new Promise((resolve, reject) => {
      const waiter = {
        active: true,
        timer: null,
        resolve(value) {
          if (!waiter.active) return;
          waiter.active = false;
          cancelTimeout(waiter.timer);
          resolve(value);
        },
        reject(error) {
          if (!waiter.active) return;
          waiter.active = false;
          cancelTimeout(waiter.timer);
          reject(error);
        },
      };
      waiters.push(waiter);
      waiter.timer = scheduleTimeout(() => {
        if (!waiter.active) return;
        removeWaiter(waiter);
        waiter.reject(new Error(`timed out waiting for Snapback live stream update on ${connectionId}`));
      }, timeoutMs);
    });
    const fail = (error) => {
      streamError ??= error; // first failure wins; a later close never masks it
      while (waiters.length > 0) waiters.shift().reject(streamError);
    };
    // The grant resolves before the socket exists (ENG-23442): the upgrade
    // carries the connection token as a subprotocol, and the URL addresses
    // the granted wire id.
    const wsPromise = this.authSession({ force: true })
      .then((session) => {
        const unavailable = authAvailabilityError(session);
        if (unavailable) throw unavailable;
        authorityCapture = this.authCoordinator?.capture?.() ?? null;
        return this.connectionGrant(connectionId);
      })
      .then((grant) => {
      authorityCapture = grant?.[AUTHORITY_CAPTURE] ?? authorityCapture;
      const url = `${this.baseUrl.replace(/^http/, 'ws')}/live/${grant.id}/stream`;
      const ws = new WebSocket(url, liveStreamProtocols(grant, this.authProtocols));
      wsRef = ws;
      ws.addEventListener('message', async (event) => {
        try {
          const update = JSON.parse(await websocketText(event.data));
          if (
            authorityCapture
            && !this.authCoordinator?.isCurrent?.(authorityCapture)
          ) throw staleAuthorityError();
          if (update?.kind === LIVE_SOCKET_KINDS.AUTH_ERROR) {
            const error = liveTerminalAuthError(update);
            fail(error);
            this.clearAuthSession();
            if (
              error.terminalAuth
              && authorityCapture
              && this.authCoordinator?.isCurrent?.(authorityCapture)
            ) {
              void this.authCoordinator.compareAndClear(authorityCapture, update.code).catch(() => {});
            }
            try { ws.close(4401, 'auth_error'); } catch { /* terminal latch already owns failure */ }
            return;
          }
          markAuthorityCapture(update, authorityCapture);
          const waiter = waiters.shift();
          if (waiter) waiter.resolve(update);
          else queue.push(update);
        } catch (error) {
          fail(error);
        }
      });
      ws.addEventListener('error', () => fail(new Error(`Snapback live stream failed: ${url}`)), { once: true });
      // @ref LLP 0032#confirmed-defect-register — S5.D7: latch unconditionally on
      //   close (not just when waiters are pending) so a later nextUpdate() rejects
      //   immediately instead of hanging until its timeout.
      ws.addEventListener('close', () => fail(new Error(`Snapback live stream closed: ${url}`)), { once: true });
      return ws;
      });
    wsPromise.catch((error) => fail(error));

    const ready = wsPromise.then((ws) => new Promise((resolve, reject) => {
      if (ws.readyState === 1) return resolve(undefined); // already OPEN
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('Snapback live stream failed to open')), { once: true });
      ws.addEventListener('close', () => reject(new Error('Snapback live stream closed before opening')), { once: true });
    }));
    // `ready` is optional for callers that only consume nextUpdate(); keep its
    // rejection observable to awaiters without turning an ignored close into
    // a process-level unhandled rejection.
    ready.catch(() => {});

    const stream = {
      ready,
      close: () => {
        this.__rawLiveStreams.delete(stream);
        return wsPromise.then((ws) => ws.close(), () => {});
      },
      sendJson: (message) => {
        if (!wsRef) throw new Error('Snapback live stream is not open yet (await ready first)');
        wsRef.send(JSON.stringify(message));
      },
      nextUpdate: (timeoutMs = 2_000) => {
        if (queue.length > 0) return Promise.resolve(queue.shift());
        if (streamError) return Promise.reject(streamError);
        return waitForUpdate(timeoutMs);
      },
    };
    this.__rawLiveStreams.add(stream);
    return stream;
  }

  // The shared managed live socket for one connection (LLP 0034 §2.1: a
  // connection opens at most one live socket; it carries durable deltas AND
  // ephemeral push). Created on first use; reference-counted by attached
  // consumers; reconnects with backoff while demand exists.
  liveStreamManager(connectionId, options = {}) {
    this.__liveStreamManagers ??= new Map();
    let manager = this.__liveStreamManagers.get(connectionId);
    if (!manager) {
      manager = new LiveStreamManager(this, connectionId, options, () => {
        this.__liveStreamManagers.delete(connectionId);
      });
      this.__liveStreamManagers.set(connectionId, manager);
    }
    return manager;
  }

  // The "current value + subscription" seam as a live handle: holds the latest
  // rows, starting from the authoritative snapshot (snapshot-with-subscribe,
  // one operation — LLP 0034 §1 / Exact LLP 0284 §2.1 rule 1).
  //
  // transport:'poll' (default, pre-D1 behavior): the caller drains updates
  // manually via handle.poll(); nothing else runs.
  //
  // transport:'stream' (LLP 0034 D1): updates are pushed over the managed
  // shared live socket; on socket loss the handle falls back to draining the
  // HTTP outbox at `pollCadenceMs` (unless fallbackToPoll:false) while the
  // socket retries with backoff; reconnect always re-enters through a fresh
  // subscribe_live and emits a 'resubscribed' subscription event.
  async liveQuery(ref, {
    connectionId,
    args = {},
    userId,
    transport = 'poll',
    pollCadenceMs = DEFAULT_POLL_CADENCE_MS,
    fallbackToPoll = true,
    onUpdate = null,
    onConnectionChange = null,
    onSubscriptionEvent = null,
    onAuthorizationBoundary = null,
    onAuthorizationError = null,
    authorizationQueue = null,
    authorizationNamespace = null,
    correlation = null,
    stream: streamOptions = {},
  } = {}) {
    const name = functionName(ref);
    const client = this;
    // @ref LLP 0053#client-fences — every auth-scoped materialization owns a
    //   never-reused query identity and a synchronous publication fence.
    const authorizationProtocolEnabled = this.authProtocols.authInvalidation != null;
    const queryKey = retainedQueryKey(name, args);
    let queryNamespace = authorizationProtocolEnabled
      ? authorizationNamespace === null
        ? createLiveQueryNamespace({
            clientStoreId: this.clientStoreId,
            queryKey,
            queryInstanceId: this.__liveQueryAllocator.allocate(),
          })
        : createLiveQueryNamespace(authorizationNamespace)
      : null;
    let authorizationFence = null;
    let authorizationFaulted = false;
    let authorizationTail = Promise.resolve();
    const authorizationResolutionTasks = new Map();

    let connection = 'connecting';
    let disposed = false;
    let disposing = false;
    let paused = false;
    let resubscribing = false;
    let fallbackTimer = null;
    let detachStream = null;
    let streamedSinceSubscribe = false;
    // True while the HTTP drain fallback owns delivery (socket down).
    let fellBack = false;
    // True when the server has (or may have) dropped this connection's durable
    // subscriptions and a fresh snapshot-with-subscribe has not landed yet.
    // ANY socket death can trigger the server-side disconnect that drops
    // them: live_stream registers on upgrade completion, before any frame,
    // so even a socket that never fired client 'open' may have reached the
    // server (ENG-23428).
    let needsResubscribe = false;
    // Bumped on every socket loss; a subscribe that was in flight across a
    // loss must not clear needsResubscribe (the dying socket's server-side
    // disconnect may have destroyed the subscription it just created).
    let socketLossEpoch = 0;
    // Bumped when a resubscribe demand arrives while another resubscribe is
    // already in flight (ENG-23429). The server's overflow sentinel is
    // one-shot per episode (src/ephemeral.rs OutboundQueue::overflow —
    // pushes are dropped while overflowed and the flag resets only on
    // drain), so a resync_required consumed mid-resubscribe is the ONLY
    // signal for the deltas dropped after the in-flight snapshot was taken.
    // A subscribe that was in flight when the demand landed must not clear
    // needsResubscribe, and the in-flight resubscribe loops for another
    // fresh subscribe once it resolves.
    let resubscribeDemandEpoch = 0;
    let pendingResubscribeReason = 'reconnect';
    let resubscribeRetryTimer = null;
    let resubscribeAttempts = 0;
    // The 'established' receipt is emitted once, AFTER the transport settles
    // (ENG-22478 review fix E): a stream binding whose subscribe POST beats
    // the socket open must not claim transport 'poll' on its receipt.
    let establishedEmitted = false;
    let establishTimer = null;
    // @ref LLP 0034#108-hosted-stream-establishment-reconciles-through-current-socket-readiness-2026-07-12
    //   — lifecycle-cancelable readiness and serialized supersession are one
    //   safety contract around the only permitted hosted subscribe replays.
    // Every pause/resume/dispose boundary invalidates older subscribe work.
    // The signal cancels only this handle's readiness wrapper; the manager's
    // shared ping/pong remains available to other handles on the connection.
    let subscribeLifecycleEpoch = 0;
    let subscribeLifecycleController = new AbortController();
    // All snapshot-with-subscribe attempts for one handle are serialized.
    // Resume, reconnect, resync, and fallback paths must capture `supersedes`
    // only after the prior path has committed its subscription id.
    let freshSubscribeTail = Promise.resolve();
    let freshSubscribePending = 0;
    let handleAuthorityCapture = null;
    const freshSubscribeQueueGenerations = new WeakMap();

    const handle = {
      subscriptionId: null,
      version: 0,
      rows: [],
      authorizationDisposition: 'retain',
      get connection() {
        return connection;
      },
      get authorizationNamespace() {
        return queryNamespace;
      },
      authorizationState() {
        return authorizationFence?.snapshot?.() ?? null;
      },
    };

    const setConnection = (next) => {
      if (disposed && next !== 'disconnected') return;
      if (connection === next) return;
      const previous = connection;
      connection = next;
      if (onConnectionChange) deliverIsolated(onConnectionChange, next, { previous });
    };

    const authorizationSnapshot = (value) => ({
      rows: value?.rows,
      version: value?.version,
    });

    const commitAuthorizationBoundary = (event) => {
      const previousRows = handle.rows;
      const previousVersion = handle.version;
      const previousDisposition = handle.authorizationDisposition;
      try {
        if (event.kind === 'snapshot') {
          handle.rows = event.rows;
          handle.version = event.version;
          handle.authorizationDisposition = 'retain';
        } else if (event.kind === 'quarantine' || event.kind === 'delete') {
          handle.rows = [];
          handle.authorizationDisposition = event.kind;
        } else if (event.kind === 'retain') {
          handle.authorizationDisposition = 'retain';
        } else {
          throw new TypeError(`unknown query authorization boundary kind: ${event.kind}`);
        }
        markAuthorityCapture(handle.rows, handleAuthorityCapture);
        const detail = {
          version: handle.version,
          kind: `authorization_${event.kind}`,
          authorization: event,
        };
        const boundaryResult = onAuthorizationBoundary?.(handle.rows, detail);
        if (boundaryResult && typeof boundaryResult.then === 'function') {
          throw new TypeError('onAuthorizationBoundary must commit synchronously');
        }
        if (event.kind !== 'retain') deliverIsolated(onUpdate, handle.rows, detail);
      } catch (error) {
        handle.rows = previousRows;
        handle.version = previousVersion;
        handle.authorizationDisposition = previousDisposition;
        throw error;
      }
    };

    const reportAuthorizationError = (error) => {
      authorizationFaulted = true;
      handle.rows = [];
      handle.authorizationDisposition = 'quarantine';
      markAuthorityCapture(handle.rows, handleAuthorityCapture);
      const detail = {
        version: handle.version,
        kind: 'authorization_error',
        error,
      };
      try {
        onAuthorizationBoundary?.(handle.rows, detail);
      } catch {
        // The handle itself remains blank even if an adapter boundary failed.
      }
      deliverIsolated(onUpdate, handle.rows, detail);
      deliverIsolated(onAuthorizationError, error);
      if (!disposed && !paused) setConnection('stale');
    };

    const applyQueueObligation = async (value) => {
      if (value.maxDisposition === 'retain') return null;
      return authorizationQueue?.applyObligation?.(value) ?? null;
    };

    const resolveQueueObligation = async (value, snapshotValue = null) => {
      if (value.maxDisposition === 'retain') return null;
      return authorizationQueue?.resolveObligation?.(
        value,
        snapshotValue === null ? null : authorizationSnapshot(snapshotValue),
      ) ?? null;
    };

    const prepareQueueResolution = async (value, snapshotValue = null) => {
      if (value.maxDisposition === 'retain') return null;
      return authorizationQueue?.prepareResolution?.(
        value,
        snapshotValue === null ? null : authorizationSnapshot(snapshotValue),
      ) ?? null;
    };

    const retireQueueScopes = async (retired, snapshotValue = null) => {
      if (retired.length === 0) return null;
      return authorizationQueue?.retireScopes?.(
        retired,
        snapshotValue === null ? null : authorizationSnapshot(snapshotValue),
      ) ?? null;
    };

    const enqueueAuthorizationTask = (task) => {
      const attempted = authorizationTail.then(task);
      authorizationTail = attempted.catch((error) => {
        reportAuthorizationError(error);
      });
      return attempted;
    };

    const rejectStaleAcknowledgement = async (ackToken) => {
      const rejected = authorizationFence.rejectAcknowledgement(ackToken, {
        commit: commitAuthorizationBoundary,
      });
      if (rejected.status === 'rejected') {
        await applyQueueObligation(rejected.obligation);
      }
      return rejected;
    };

    const receiveAuthorizationProjection = (projection, snapshotValue = null) => {
      if (!authorizationFence) {
        throw new Error(
          'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED: invalidation arrived before its authenticated query expectation',
        );
      }
      const received = authorizationFence.receiveObligation(projection.obligation, {
        commit: commitAuthorizationBoundary,
      });
      if (['stale-expectation', 'retired', 'acknowledged'].includes(received.status)) {
        return Promise.resolve(received);
      }
      const resolutionTaskKey = projection.resolution?.ackToken ?? null;
      if (resolutionTaskKey !== null && authorizationResolutionTasks.has(resolutionTaskKey)) {
        return authorizationResolutionTasks.get(resolutionTaskKey);
      }
      const attempted = enqueueAuthorizationTask(async () => {
        await applyQueueObligation(projection.obligation);
        if (projection.resolution == null) return received;
        // A durable retained-query adapter commits the successor snapshot and
        // its no-lease fence before the process boundary can reveal it. The
        // later ACK still waits for mutation-queue resolution as well.
        await prepareQueueResolution(projection.resolution, snapshotValue);
        const applied = authorizationFence.applyResolution({
          fence: received.fence,
          resolution: projection.resolution,
          snapshot: projection.resolution.kind === 'terminalDelete'
            ? null
            : authorizationSnapshot(snapshotValue),
          commit: commitAuthorizationBoundary,
        });
        authorizationFaulted = false;
        await resolveQueueObligation(projection.resolution, snapshotValue);
        let acknowledged;
        try {
          acknowledged = await client.acknowledgeAuthorizationInvalidation(
            connectionId,
            applied.ackToken,
          );
        } catch (error) {
          // Delivery is level-triggered. Preserve the applied ticket so the
          // next re-fire resends the same ACK instead of inventing a release.
          throw error;
        }
        if (acknowledged?.outcome === 'discharged' || acknowledged?.outcome === 'duplicate') {
          authorizationFence.acknowledge(applied.ackToken);
          await authorizationQueue?.acknowledged?.(projection.resolution, acknowledged);
          return applied;
        }
        await rejectStaleAcknowledgement(applied.ackToken);
        if (acknowledged?.outcome !== 'stale') {
          throw new Error(
            'SNAPBACK_AUTH_INVALIDATION_CORRUPT: acknowledgement returned an unknown outcome',
          );
        }
        return { ...applied, status: 'stale-acknowledgement' };
      });
      if (resolutionTaskKey !== null) {
        authorizationResolutionTasks.set(resolutionTaskKey, attempted);
        void attempted.finally(() => {
          if (authorizationResolutionTasks.get(resolutionTaskKey) === attempted) {
            authorizationResolutionTasks.delete(resolutionTaskKey);
          }
        }).catch(() => {});
      }
      return attempted;
    };

    const applyRetirement = (kind, retirement, freshSnapshot) => (
      enqueueAuthorizationTask(async () => {
        const result = kind === 'issuer'
          ? authorizationFence.retireIssuer({
              retirement,
              freshSnapshot,
              commit: commitAuthorizationBoundary,
            })
          : authorizationFence.retireScopes({
              retirement,
              freshSnapshot,
              commit: commitAuthorizationBoundary,
            });
        if (result.status === 'retired') {
          await retireQueueScopes(result.retired, freshSnapshot);
        }
        return result;
      })
    );

    const installAuthorizationSubscription = async (sub) => {
      const scopeValue = sub.authorizationScope ?? null;
      const connectionValue = sub[AUTHORIZATION_CONNECTION] ?? null;
      if (scopeValue === null) return;
      if (queryNamespace === null || connectionValue === null) {
        throw new Error(
          'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED: auth-scoped live response lacks the negotiated query expectation',
        );
      }
      const normalizedScope = validateScopeId(scopeValue, 'authorizationScope');
      if (
        normalizedScope.kind !== 'subscription'
        || JSON.stringify(normalizedScope.namespace) !== JSON.stringify(queryNamespace)
        || normalizedScope.subscriptionId !== sub.subscription_id
      ) {
        throw new Error(
          'SNAPBACK_AUTH_INVALIDATION_CORRUPT: subscribe response crossed live query scope identity',
        );
      }
      const normalizedConnection = validateAuthorizationInvalidationConnection(connectionValue);
      const freshSnapshot = authorizationSnapshot(sub.snapshot);
      if (!authorizationFence) {
        const authorityGeneration = client.captureAuthority?.()?.authorityEpoch ?? 0;
        authorizationFence = createLiveQueryAuthorizationFence({
          namespace: queryNamespace,
          authorityGeneration,
          issuerId: normalizedConnection.issuerId,
          authorization: normalizedConnection.authorization,
          versionStream: normalizedConnection.versionStream,
          initialSnapshot: freshSnapshot,
        });
      } else {
        authorizationFence.replaceAuthenticatedExpectation({
          issuerId: normalizedConnection.issuerId,
          authorization: normalizedConnection.authorization,
          versionStream: normalizedConnection.versionStream,
          snapshot: freshSnapshot,
          commit: commitAuthorizationBoundary,
        });
      }
      if (sub.authorizationInvalidation) {
        await receiveAuthorizationProjection(sub.authorizationInvalidation, sub.snapshot);
      }
      if (normalizedConnection.issuerRetirement) {
        await applyRetirement(
          'issuer',
          normalizedConnection.issuerRetirement,
          freshSnapshot,
        );
      }
      for (const retirement of sub.scopeRetirements ?? []) {
        await applyRetirement('scope', retirement, freshSnapshot);
      }
      if (
        authorizationFence.isRenderable()
        && (
          handle.version !== sub.snapshot.version
          || JSON.stringify(handle.rows) !== JSON.stringify(sub.snapshot.rows)
        )
      ) {
        authorizationFence.applyLiveSnapshot({
          fence: authorizationFence.capture(),
          snapshot: freshSnapshot,
          commit: commitAuthorizationBoundary,
        });
      }
      if (authorizationFence.isRenderable()) authorizationFaulted = false;
    };

    // Full SubscriptionReceipts (LLP 0034 §3.2 / ENG-22478): the kit is the
    // provider half that knows the actual transport; scope is REQUIRED (the
    // subscription's routing/scope args); versions are the server's durable
    // commit versions (§3.1 — one version story, nothing invented); the
    // adapter's opaque correlation is echoed verbatim. Receipts are retained
    // in the client ring and handed to onSubscriptionEvent.
    const emitEvent = (event, extra = {}) => {
      const receipt = {
        kind: 'subscription',
        bindingId: handle.subscriptionId,
        subscriptionId: handle.subscriptionId,
        event,
        transport: transport === 'stream' && streamedSinceSubscribe ? 'push' : 'poll',
        scope: { ...args },
        snapshotVersion: handle.version,
        lastDeltaVersion: handle.version,
        correlation: cappedCorrelation(correlation),
        receivedAtMs: Date.now(),
        ...extra,
      };
      client.recordReceipt(receipt, handleAuthorityCapture);
      if (onSubscriptionEvent) deliverIsolated(onSubscriptionEvent, receipt);
    };

    const emitEstablishedOnce = () => {
      if (establishedEmitted || disposed || handle.subscriptionId === null) return;
      establishedEmitted = true;
      if (establishTimer) {
        clearTimeout(establishTimer);
        establishTimer = null;
      }
      emitEvent('established');
    };

    const bestEffortUnsubscribeLive = (subscriptionId) => {
      if (!subscriptionId) return Promise.resolve();
      return Promise.resolve()
        .then(() => client.unsubscribeLive(name, { subscriptionId, connectionId, userId }))
        .then(async (response) => {
          if (
            response?.scopeRetirement
            && authorizationFence?.snapshot?.().lifecycle === 'retiring'
          ) {
            await applyRetirement('scope', response.scopeRetirement, null);
          }
          if (authorizationFence?.snapshot?.().lifecycle === 'retiring') {
            try { authorizationFence.finishRetirement(); } catch { /* owner continuity remains */ }
          }
        })
        .catch(() => {
          // Best-effort: the subscription may already be gone (disconnect,
          // supersession) or the server unreachable — the reaper covers it.
          if (authorizationFence?.snapshot?.().lifecycle === 'retiring') {
            try { authorizationFence.finishRetirement(); } catch { /* owner continuity remains */ }
          }
        });
    };

    const subscribeLifecycleError = (state) => {
      const code = state === 'disposed'
        ? 'SNAPBACK_LIVE_QUERY_DISPOSED_DURING_SUBSCRIBE'
        : 'SNAPBACK_LIVE_QUERY_PAUSED_DURING_SUBSCRIBE';
      const error = new Error(`${code}: Snapback live query subscribe was cancelled because the handle was ${state}.`);
      error.code = code;
      error.diagnostic = { code, message: error.message.slice(code.length + 2) };
      return error;
    };

    const subscribeQueueInvalidatedError = () => {
      const code = 'SNAPBACK_LIVE_QUERY_SUBSCRIBE_QUEUE_INVALIDATED';
      const message = 'queued fresh subscribe was invalidated by the preceding attempt failure';
      const error = new Error(`${code}: ${message}`);
      error.code = code;
      error.diagnostic = { code, message };
      return error;
    };

    const invalidateSubscribeLifecycle = (state) => {
      subscribeLifecycleEpoch = safeNextCounter(
        subscribeLifecycleEpoch,
        'SNAPBACK_CLIENT_SUBSCRIPTION_GENERATION_EXHAUSTED',
        'subscription lifecycle generation',
      );
      if (!subscribeLifecycleController.signal.aborted) {
        subscribeLifecycleController.abort(subscribeLifecycleError(state));
      }
    };

    const beginSubscribeLifecycle = () => {
      if (!subscribeLifecycleController.signal.aborted) {
        subscribeLifecycleController.abort(subscribeLifecycleError('paused'));
      }
      subscribeLifecycleEpoch = safeNextCounter(
        subscribeLifecycleEpoch,
        'SNAPBACK_CLIENT_SUBSCRIPTION_GENERATION_EXHAUSTED',
        'subscription lifecycle generation',
      );
      subscribeLifecycleController = new AbortController();
    };

    const currentSubscribeLifecycle = () => ({
      epoch: subscribeLifecycleEpoch,
      signal: subscribeLifecycleController.signal,
    });

    const assertSubscribeLifecycle = (lifecycle) => {
      if (
        disposed ||
        paused ||
        lifecycle.epoch !== subscribeLifecycleEpoch ||
        lifecycle.signal !== subscribeLifecycleController.signal ||
        lifecycle.signal.aborted
      ) {
        if (lifecycle.signal.reason instanceof Error) throw lifecycle.signal.reason;
        throw subscribeLifecycleError(disposed ? 'disposed' : 'paused');
      }
    };

    const applyDurable = (update) => {
      if (disposed || paused || !update || typeof update !== 'object') return;
      const updateCapture = update[AUTHORITY_CAPTURE] ?? handleAuthorityCapture;
      if (
        client.authCoordinator
        && (!updateCapture || !client.authCoordinator.isCurrent(updateCapture))
      ) return;
      if (update.kind === LIVE_DURABLE_KINDS.AUTHORIZATION_INVALIDATION) {
        try {
          void receiveAuthorizationProjection({
            obligation: update.obligation,
            resolution: update.resolution ?? null,
          }, update.snapshot ?? null).catch(() => {});
        } catch (error) {
          reportAuthorizationError(error);
        }
        return;
      }
      if (update.kind === LIVE_DURABLE_KINDS.LIVE_REPLACE) {
        // Updates for a superseded (pre-resubscribe) subscription id are
        // ignored; versions are non-decreasing per subscription (the global
        // durable commit version assigned at fan-out).
        if (update.subscription_id !== handle.subscriptionId) return;
        if (typeof update.version === 'number' && update.version < handle.version) return;
        if (authorizationFaulted) return;
        if (authorizationFence) {
          try {
            authorizationFence.applyLiveSnapshot({
              fence: authorizationFence.capture(),
              snapshot: authorizationSnapshot(update),
              commit: commitAuthorizationBoundary,
            });
          } catch (error) {
            reportAuthorizationError(error);
          }
        } else {
          handle.rows = update.rows;
          handle.version = update.version;
          onUpdate?.(handle.rows, { version: handle.version, kind: LIVE_DURABLE_KINDS.LIVE_REPLACE });
        }
        return;
      }
      if (update.kind === LIVE_DURABLE_KINDS.LIVE_DELTA) {
        // DK-3 op-log delta (LLP 0008 §Decision DK-3): the server sends only
        // the rows that entered/left/changed this subscription's result, for
        // the analyzable unordered subset. Apply by _id: add/update upsert,
        // remove drops. Same subscription-id and version-non-decreasing guards
        // as live_replace. Unordered by contract (ordered queries fall back to
        // live_replace), so preserving existing order and appending new rows is
        // correct.
        if (update.subscription_id !== handle.subscriptionId) return;
        if (typeof update.version === 'number' && update.version < handle.version) return;
        if (authorizationFaulted) return;
        const byId = new Map(
          (Array.isArray(handle.rows) ? handle.rows : []).map((row) => [row?._id, row]),
        );
        for (const op of update.ops ?? []) {
          if (op.op === 'remove') byId.delete(op.id);
          else if (op.op === 'add' || op.op === 'update') byId.set(op.id, op.row);
        }
        const nextRows = [...byId.values()];
        if (authorizationFence) {
          try {
            authorizationFence.applyLiveSnapshot({
              fence: authorizationFence.capture(),
              snapshot: { rows: nextRows, version: update.version },
              commit: commitAuthorizationBoundary,
            });
          } catch (error) {
            reportAuthorizationError(error);
          }
        } else {
          handle.rows = nextRows;
          handle.version = update.version;
          onUpdate?.(handle.rows, { version: handle.version, kind: LIVE_DURABLE_KINDS.LIVE_DELTA });
        }
        return;
      }
      if (update.kind === LIVE_DURABLE_KINDS.RESYNC_REQUIRED) {
        // Connection-wide outbox overflow carries no subscription_id
        // (src/ephemeral.rs OutboundQueue::overflow); subscription-scoped
        // resyncs (permission epoch changes, fan-out failures) do. Either
        // way the recovery is the same: fresh snapshot-with-subscribe.
        if (update.subscription_id && update.subscription_id !== handle.subscriptionId) return;
        void resubscribe(resyncReason(update.reason));
      }
    };

    const subscribeFreshExclusive = async (lifecycle) => {
      assertSubscribeLifecycle(lifecycle);
      // This handle's OWN previous subscription (reconnect/resync/resume
      // paths) is explicitly superseded; the first establish has none.
      // Capture only after acquiring the per-handle subscribe queue.
      const supersedes = handle.subscriptionId ?? null;
      let attempt = null;
      let readinessRetries = 0;
      for (;;) {
        assertSubscribeLifecycle(lifecycle);
        const epochAtStart = socketLossEpoch;
        const demandEpochAtStart = resubscribeDemandEpoch;
        try {
          const sub = await client.subscribeLive(name, {
            connectionId,
            args,
            userId,
            correlation,
            supersedes,
            authorizationNamespace: queryNamespace,
          });
          try {
            assertSubscribeLifecycle(lifecycle);
          } catch (error) {
            // The HTTP request cannot be cancelled after persistence. If its
            // owner paused/disposed meanwhile, explicitly retire the late id.
            bestEffortUnsubscribeLive(sub?.subscription_id);
            throw error;
          }
          attempt = { sub, epochAtStart, demandEpochAtStart };
          break;
        } catch (error) {
          const code = error?.diagnostic?.code;
          if (
            transport !== 'stream' ||
            error?.status !== 409 ||
            !LIVE_SUBSCRIBE_READINESS_RETRY_CODES.has(code) ||
            readinessRetries >= LIVE_SUBSCRIBE_READINESS_RETRIES
          ) {
            throw error;
          }
          readinessRetries += 1;
          const manager = client.liveStreamManager(connectionId, streamOptions);
          // A SOCKET_REQUIRED response commonly means the optimistic HTTP
          // subscribe beat the socket upgrade. SESSION_REPLACED means the
          // socket changed while the snapshot was loading. Both responses
          // are effect-free by server contract, so wait for a correlated
          // ping/pong on the current generation and retry only then. If a
          // generation had already been proven ready, revalidate it (or let
          // its loss move the wait to the replacement generation).
          await manager.waitUntilReady({
            revalidate: manager.isReady(),
            signal: lifecycle.signal,
          });
          // Cancellation and readiness can settle in adjacent microtasks.
          // Re-check immediately before the only replaying POST.
          assertSubscribeLifecycle(lifecycle);
        }
      }
      const { sub, epochAtStart, demandEpochAtStart } = attempt;
      assertSubscribeLifecycle(lifecycle);
      handle.subscriptionId = sub.subscription_id;
      handleAuthorityCapture = sub[AUTHORITY_CAPTURE] ?? null;
      try {
        if (sub.authorizationScope) {
          await installAuthorizationSubscription(sub);
        } else {
          handle.version = sub.snapshot.version;
          handle.rows = sub.snapshot.rows;
        }
        assertSubscribeLifecycle(lifecycle);
      } catch (error) {
        bestEffortUnsubscribeLive(sub.subscription_id);
        throw error;
      }
      // Any successful fresh subscribe satisfies an outstanding need — clear
      // it here so every path (establish, resume, resubscribe) agrees —
      // UNLESS a socket loss raced the in-flight request (ENG-23428): the
      // lost socket's server-side disconnect may have destroyed the very
      // subscription this call created, so the need persists and the
      // retry/grace/drain paths re-enter with a fresh subscribe. A resync
      // demand that landed while this request was in flight persists the
      // need the same way (ENG-23429): this snapshot may predate the state
      // the demand signals, and the sentinel is never re-emitted.
      if (socketLossEpoch === epochAtStart && resubscribeDemandEpoch === demandEpochAtStart) {
        needsResubscribe = false;
        resubscribeAttempts = 0;
        clearResubscribeRetry();
      }
      return sub;
    };

    const subscribeFresh = () => {
      const lifecycle = currentSubscribeLifecycle();
      const queueGeneration = freshSubscribeQueueGenerations.get(lifecycle.signal) ?? 0;
      freshSubscribePending += 1;
      const attempted = freshSubscribeTail.then(() => {
        // A same-lifecycle predecessor may have failed ambiguously after this
        // work was queued. Do not let the tail's neutralized rejection release
        // a sibling POST that captured the same old `supersedes` value. A new
        // lifecycle has a new signal and is intentionally not poisoned.
        if (
          queueGeneration !== (freshSubscribeQueueGenerations.get(lifecycle.signal) ?? 0)
        ) {
          throw subscribeQueueInvalidatedError();
        }
        return subscribeFreshExclusive(lifecycle);
      });
      const queued = attempted.then(
        (value) => value,
        (error) => {
          if (
            error?.code !== 'SNAPBACK_LIVE_QUERY_SUBSCRIBE_QUEUE_INVALIDATED' &&
            queueGeneration === (freshSubscribeQueueGenerations.get(lifecycle.signal) ?? 0)
          ) {
            // Advance this lifecycle before releasing the FIFO tail. Its
            // already-queued work is rejected before the first POST; later
            // explicit recovery (or a new lifecycle) captures a fresh
            // generation and can proceed.
            freshSubscribeQueueGenerations.set(lifecycle.signal, queueGeneration + 1);
          }
          throw error;
        },
      );
      // Keep the mutex usable after rejection, while attaching a rejection
      // handler immediately so a cancelled queued attempt is never unhandled.
      freshSubscribeTail = queued.then(() => undefined, () => undefined);
      return queued.then(
        (value) => {
          freshSubscribePending -= 1;
          return value;
        },
        (error) => {
          freshSubscribePending -= 1;
          throw error;
        },
      );
    };

    // After a successful (re)subscribe, settle the connection value from the
    // actual transport state — never promote to 'live' on hope.
    const settleConnectionAfterSubscribe = () => {
      if (disposed || paused) return;
      if (transport !== 'stream') {
        setConnection('polling');
        return;
      }
      const manager = client.liveStreamManager(connectionId, streamOptions);
      if (manager.isOpen()) {
        streamedSinceSubscribe = true;
        setConnection('live');
      } else if (fellBack) {
        setConnection('polling');
      } else if (!fallbackToPoll) {
        setConnection('stale');
      }
      // else: the socket is still in flight; stay 'connecting' until the
      // manager reports open/lost.
    };

    const clearResubscribeRetry = () => {
      if (resubscribeRetryTimer) {
        clearTimeout(resubscribeRetryTimer);
        resubscribeRetryTimer = null;
      }
    };

    // Retry while the need persists (LLP 0034 review fix 2): a failed
    // re-subscribe schedules a bounded-backoff retry, and the drain path
    // below ALSO re-enters on every poll tick — a transient server error can
    // never strand the handle without a subscription.
    const scheduleResubscribeRetry = (reason) => {
      if (disposed || paused || resubscribeRetryTimer || !needsResubscribe) return;
      const delay = Math.min(
        LIVE_RECONNECT_BASE_DELAY_MS * 2 ** resubscribeAttempts,
        LIVE_RECONNECT_MAX_DELAY_MS,
      );
      resubscribeAttempts += 1;
      resubscribeRetryTimer = setTimeout(() => {
        resubscribeRetryTimer = null;
        if (!disposed && !paused && needsResubscribe) void resubscribe(reason);
      }, delay);
      resubscribeRetryTimer.unref?.();
    };

    // Reconnect/resync re-entry: always a fresh subscribe_live (see the policy
    // block at the top of this file — the server drops a connection's durable
    // subscriptions on socket close, so there is nothing to resume). Returns
    // whether the fresh subscribe LANDED; a failure keeps needsResubscribe set
    // and schedules a retry — the connection value is only ever promoted after
    // a success (via settleConnectionAfterSubscribe). Note: on in-band resyncs
    // (overflow, permission epoch) the superseded subscription may remain
    // registered server-side until the connection disconnects or is reaped;
    // its updates are ignored by subscription-id filtering above.
    const resubscribe = async (reason) => {
      if (disposed || paused) return false;
      if (resubscribing) {
        // A resync demand arrived while another fresh subscribe is in
        // flight (e.g. the connection's one-shot overflow sentinel drained
        // mid-resubscribe, ENG-23429). Swallowing it would lose the only
        // signal for the deltas dropped after the in-flight snapshot was
        // taken (LLP 0008: overflow is a resync signal, never a drop) —
        // record the demand so the in-flight run loops for another fresh
        // subscribe once its POST resolves, and keep the need visible to
        // the retry/drain paths in case that run fails instead.
        resubscribeDemandEpoch = safeNextCounter(
          resubscribeDemandEpoch,
          'SNAPBACK_CLIENT_RESUBSCRIBE_GENERATION_EXHAUSTED',
          'resubscribe demand generation',
        );
        needsResubscribe = true;
        pendingResubscribeReason = reason;
        return false;
      }
      // Resume/establish also use the fresh-subscribe queue. A resync demand
      // that arrives while either is pending must remain visible if that
      // older snapshot was already in flight, just like a demand arriving
      // during the traditional resubscribe loop.
      if (freshSubscribePending > 0) {
        resubscribeDemandEpoch = safeNextCounter(
          resubscribeDemandEpoch,
          'SNAPBACK_CLIENT_RESUBSCRIBE_GENERATION_EXHAUSTED',
          'resubscribe demand generation',
        );
      }
      resubscribing = true;
      needsResubscribe = true;
      pendingResubscribeReason = reason;
      let attemptReason = reason;
      try {
        for (;;) {
          const demandEpochBefore = resubscribeDemandEpoch;
          await subscribeFresh();
          emitEvent('resubscribed', { reason: attemptReason });
          onUpdate?.(handle.rows, { version: handle.version, kind: 'snapshot' });
          settleConnectionAfterSubscribe();
          if (disposed || paused || resubscribeDemandEpoch === demandEpochBefore) return true;
          // A demand landed while that subscribe was in flight: its
          // snapshot may be stale relative to the demand — go around with
          // another fresh subscribe (which supersedes the one just landed).
          attemptReason = pendingResubscribeReason;
        }
      } catch (error) {
        if (error?.code === 'SNAPBACK_LIVE_QUERY_SUBSCRIBE_QUEUE_INVALIDATED') {
          return false;
        }
        if (!disposed && !paused) {
          if (onConnectionChange) {
            deliverIsolated(onConnectionChange, connection, { previous: connection, error });
          }
          scheduleResubscribeRetry(pendingResubscribeReason);
        }
        return false;
      } finally {
        resubscribing = false;
      }
    };

    const drainOnce = async () => {
      // A broken subscription drains nothing (a disconnect-destroyed outbox
      // returns [] and looks healthy): re-enter the fresh subscribe on every
      // drain tick until it lands (LLP 0034 review fix 2, polling variant).
      if (needsResubscribe && !resubscribing) {
        await resubscribe(pendingResubscribeReason);
      }
      // HTTP outbox drain through the shared choke point: one bounded queue
      // per connection, durable lane first, then resync, then coalesced
      // ephemeral (OutboundQueue::drain — durable-over-ephemeral priority,
      // LLP 0013 §delivery-lanes). Routing applies durable updates to this
      // handle via its registered consumer AND delivers both lanes to every
      // other registered consumer on the connection — no cross-lane or
      // cross-handle discards (LLP 0034 §10.1 / ENG-22478).
      await client.drainConnection(connectionId);
      if (fellBack && fallbackToPoll && !needsResubscribe) {
        // A transient drain failure reports 'stale'. The declared poll
        // fallback becomes healthy again after the next successful drain.
        setConnection('polling');
      }
      return handle.rows;
    };

    const stopFallback = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const startFallback = () => {
      if (fallbackTimer || disposed || paused) return;
      fallbackTimer = setInterval(() => {
        drainOnce().catch(() => {
          // Poll failures while the socket also retries: budget missed.
          setConnection('stale');
        });
      }, pollCadenceMs);
      // Background timers never hold a headless process open (no-op in browsers).
      fallbackTimer.unref?.();
    };

    const attachStream = () => {
      const manager = client.liveStreamManager(connectionId, streamOptions);
      // Durable socket frames arrive through the connection's lane registry
      // (this handle registered applyDurable there), the same path HTTP
      // drains use — one delivery pipeline for both transports (ENG-22478
      // review: mixed-transport unification).
      const offState = manager.onState((state, detail = {}) => {
        if (disposed || paused) return;
        if (state === 'open') {
          streamedSinceSubscribe = true;
          stopFallback();
          if (handle.subscriptionId === null) return; // establishment still in flight
          emitEstablishedOnce(); // transport settled: push
          fellBack = false;
          if (needsResubscribe) {
            // The lost socket's server-side disconnect dropped this
            // connection's subscriptions and no fresh subscribe has landed
            // yet: re-enter through snapshot-with-subscribe. Promotion to
            // 'live' happens INSIDE resubscribe, only on success; on failure
            // the handle stays 'connecting' and the retry loop re-enters.
            setConnection('connecting');
            void resubscribe('reconnect');
          } else {
            // The current subscription is valid (re-created since the last
            // loss by the fallback/grace/retry paths, or the original when no
            // constructed socket has died since it landed); the regained
            // socket drains the same connection outbox — no second snapshot.
            setConnection('live');
          }
          return;
        }
        if (state === 'lost') {
          streamedSinceSubscribe = false;
          emitEstablishedOnce(); // transport settled: poll fallback
          // EVERY loss requires a fresh subscribe (ENG-23428): the server
          // registers the stream task at upgrade completion, before any
          // frame, and its teardown runs disconnect — dropping this
          // connection's durable subscriptions AND its outbox. So a socket
          // that never fired client 'open' (stalled 101, connect-budget
          // force-close) may still have destroyed them, and the client
          // cannot tell. A redundant fresh subscribe is safe — it
          // explicitly supersedes its own predecessor — while a skipped one
          // is permanent silent staleness on a destroyed outbox. (When a
          // reconnect superseded this socket server-side the generation
          // guard skips the drop; the subscribe is then merely redundant.)
          socketLossEpoch = safeNextCounter(
            socketLossEpoch,
            'SNAPBACK_CLIENT_SOCKET_LOSS_GENERATION_EXHAUSTED',
            'socket-loss generation',
          );
          needsResubscribe = true;
          pendingResubscribeReason = 'reconnect';
          if (fallbackToPoll) {
            setConnection('polling');
            fellBack = true;
            // First re-subscribe attempt after a short grace so the server
            // has processed the close; failures are covered by the retry
            // loop AND every fallback drain tick (needsResubscribe gates
            // all of them, so exactly one fresh subscribe lands).
            setTimeout(() => {
              if (!disposed && !paused && needsResubscribe && handle.subscriptionId !== null) {
                void resubscribe('reconnect');
              }
            }, RESUBSCRIBE_AFTER_LOSS_DELAY_MS).unref?.();
            startFallback();
          } else {
            // Fallback disabled: hold at 'stale' with last-known rows; the
            // fresh subscribe re-enters on socket regain (open handler), and
            // a failure there is covered by the retry loop.
            setConnection('stale');
          }
          return;
        }
        if (state === 'budget-missed') {
          setConnection('stale');
          return;
        }
        if (state === 'closed') {
          setConnection('disconnected');
        }
      });
      return () => {
        offState();
      };
    };

    // Drained durable updates reach this handle through the connection's
    // lane router (covers manual poll(), the fallback timer, AND any other
    // consumer's drain on the same connection — the pre-D2 "whoever drains
    // first steals the updates" gap).
    const unregisterDurable = client.registerDurableConsumer(connectionId, applyDurable);

    // On subscribe failure the attached stream must not leak (LLP 0034 review
    // fix 5): detach (dropping manager demand closes the shared socket when
    // this was its only consumer), mark the handle disposed, and rethrow —
    // liveQuery() fails loudly and leaves nothing running.
    const establish = async () => {
      setConnection('connecting');
      if (transport === 'stream') {
        detachStream = attachStream();
      }
      try {
        await subscribeFresh();
      } catch (error) {
        disposed = true;
        invalidateSubscribeLifecycle('disposed');
        stopFallback();
        clearResubscribeRetry();
        unregisterDurable();
        detachStream?.();
        detachStream = null;
        setConnection('disconnected');
        throw error;
      }
      if (transport === 'stream') {
        const manager = client.liveStreamManager(connectionId, streamOptions);
        if (manager.isOpen()) {
          streamedSinceSubscribe = true;
          setConnection('live');
          emitEstablishedOnce(); // push, deterministically
        } else if (fellBack) {
          emitEstablishedOnce(); // the socket already failed: poll fallback
        } else {
          // Socket still in flight: defer the receipt until it settles
          // (open -> push, lost -> poll), with the freshness budget as the
          // bound so the receipt cannot dangle on a swallowed connect.
          const budget = streamOptions.freshnessBudgetMs ?? LIVE_FRESHNESS_BUDGET_MS;
          establishTimer = setTimeout(() => {
            establishTimer = null;
            emitEstablishedOnce();
          }, budget);
          establishTimer.unref?.();
        }
      } else {
        setConnection('polling');
        emitEstablishedOnce();
      }
    };

    handle.poll = async () => {
      if (disposed || paused) return handle.rows;
      return drainOnce();
    };

    // Host lifecycle is provider/kit policy, not view logic (Exact LLP 0284
    // §2.1 rule 4): pause quiesces this handle's transports (no retry is
    // scheduled -> 'disconnected'); resume re-enters through a fresh
    // snapshot-with-subscribe and a 'resubscribed' event.
    handle.pause = () => {
      if (disposed || paused) return;
      paused = true;
      invalidateSubscribeLifecycle('paused');
      stopFallback();
      clearResubscribeRetry();
      detachStream?.();
      detachStream = null;
      setConnection('disconnected');
    };

    handle.resume = async () => {
      if (disposed || !paused) return;
      paused = false;
      beginSubscribeLifecycle();
      const resumeLifecycleEpoch = subscribeLifecycleEpoch;
      setConnection('connecting');
      if (transport === 'stream') {
        detachStream = attachStream();
      }
      try {
        await subscribeFresh();
      } catch (error) {
        // A pause/dispose (or a newer resume after that pause) already owns
        // cleanup. This stale continuation must not detach the newer stream
        // or force its handle back into the paused state.
        if (
          disposed ||
          paused ||
          subscribeLifecycleEpoch !== resumeLifecycleEpoch
        ) {
          throw error;
        }
        // Do not leak the re-attached stream (LLP 0034 review fix 5): return
        // to the paused state so the caller may retry resume() later.
        stopFallback();
        clearResubscribeRetry();
        detachStream?.();
        detachStream = null;
        paused = true;
        invalidateSubscribeLifecycle('paused');
        setConnection('disconnected');
        throw error;
      }
      const manager = transport === 'stream' ? client.liveStreamManager(connectionId, streamOptions) : null;
      if (manager?.isOpen()) {
        streamedSinceSubscribe = true;
        setConnection('live');
      } else if (transport === 'stream' && fallbackToPoll) {
        fellBack = true;
        setConnection('polling');
        startFallback();
      } else {
        setConnection(transport === 'stream' ? 'stale' : 'polling');
      }
      emitEvent('resubscribed', { reason: 'resume' });
    };

    handle.dispose = () => {
      if (disposed || disposing) return;
      disposing = true;
      const staleSubscriptionId = handle.subscriptionId;
      let firstCleanupError = null;
      const attempt = (cleanup) => {
        try {
          cleanup();
        } catch (error) {
          firstCleanupError ??= error;
        }
      };
      try {
        if (authorizationFence?.snapshot?.().lifecycle === 'active') {
          attempt(() => authorizationFence.beginRetirement({
            fence: authorizationFence.capture(),
            commit: commitAuthorizationBoundary,
          }));
        }
        // Receipt ordering remains established-before-disposed. Observer
        // delivery is isolated, and the `disposing` guard makes a callback
        // that re-enters dispose idempotent instead of recursively tearing
        // down the same handle.
        attempt(() => emitEstablishedOnce());
        attempt(() => emitEvent('disposed'));
      } finally {
        // @ref LLP 0034#109-observational-callbacks-and-failed-optimistic-work-cannot-own-lifecycle-2026-07-12
        //   — app observation never owns transport/resource lifetime. Attempt
        //   every cleanup even if an internal teardown step itself fails.
        disposed = true;
        attempt(() => invalidateSubscribeLifecycle('disposed'));
        attempt(stopFallback);
        attempt(clearResubscribeRetry);
        if (establishTimer) {
          clearTimeout(establishTimer);
          establishTimer = null;
        }
        attempt(unregisterDurable);
        attempt(() => detachStream?.());
        detachStream = null;
        attempt(() => setConnection('disconnected'));
        // Best-effort server-side disposal (ENG-22478 review fix F): without
        // this, unmounting a handle while the connection lives leaves the
        // §10.1 zombie fanning out until connection teardown.
        bestEffortUnsubscribeLive(staleSubscriptionId);
        disposing = false;
      }
      if (firstCleanupError) throw firstCleanupError;
    };

    await establish();
    return handle;
  }
}

/// One managed WebSocket per connection, multiplexing durable live-query
/// updates and ephemeral push (the lanes the server's outbox already carries;
/// durable drains before ephemeral within each tick — LLP 0013
/// §delivery-lanes; the manager dispatches frames strictly in arrival order,
/// preserving that priority). Reference-counted by listeners; reconnects with
/// exponential backoff while demand exists; sends app-level pings to make the
/// Exact LLP 0284 §2.2 freshness budget observable.
///
/// @ref LLP 0034#22-one-socket-both-lanes--with-the-priority-invariant
class LiveStreamManager {
  constructor(client, connectionId, options = {}, onRelease = () => {}) {
    this.client = client;
    this.connectionId = connectionId;
    this.onRelease = onRelease;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? LIVE_HEARTBEAT_INTERVAL_MS;
    this.freshnessBudgetMs = options.freshnessBudgetMs ?? LIVE_FRESHNESS_BUDGET_MS;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? LIVE_RECONNECT_BASE_DELAY_MS;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? LIVE_RECONNECT_MAX_DELAY_MS;

    this.durableListeners = new Set();
    this.ephemeralListeners = new Set();
    this.stateListeners = new Set();
    // Readiness probes observe socket state without owning socket demand.
    // A paused/disposed handle must be able to detach its last real listener
    // and close the manager even while a caller is awaiting readiness.
    this.readinessStateListeners = new Set();
    this.pendingRequests = new Map();

    this.ws = null;
    this.open = false;
    this.closed = false;
    this.attempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.lastActivityMs = Date.now();
    this.requestSeq = 0;
    // Socket-session readiness is generation-scoped. A correlated ping/pong
    // proves that the server is processing frames on the same generation the
    // client will pair with its HTTP subscribe; a stale socket's pong cannot
    // satisfy a later generation because #dispatch ignores non-current ws.
    this.socketGeneration = 0;
    this.readyGeneration = 0;
    // One correlated ping/pong probe is shared by parallel callers. Each
    // caller still gets its own abortable wrapper, so canceling one binding
    // never cancels another binding's readiness wait.
    this.readinessProbe = null;
    // True while the ENG-23442 grant handshake for a connect is in flight
    // (there is no this.ws yet, so #ensureSocket needs its own latch).
    this.connectPending = false;
    // Set when a socket fails WITHOUT ever opening — the signature of a
    // stale grant (restarted server): the next connect refreshes the grant.
    this.grantSuspect = false;
    this.authorityCapture = null;
  }

  #demand() {
    return this.durableListeners.size + this.ephemeralListeners.size + this.stateListeners.size;
  }

  #listen(set, listener) {
    set.add(listener);
    this.#ensureSocket();
    return () => {
      set.delete(listener);
      if (this.#demand() === 0) this.close();
    };
  }

  onDurable(listener) {
    return this.#listen(this.durableListeners, listener);
  }

  onEphemeral(listener) {
    return this.#listen(this.ephemeralListeners, listener);
  }

  onState(listener) {
    return this.#listen(this.stateListeners, listener);
  }

  isOpen() {
    return this.open;
  }

  isReady() {
    return this.open && this.readyGeneration === this.socketGeneration;
  }

  /// Prove the CURRENT socket generation through a correlated ping/pong.
  /// Raw WebSocket `open` is not a sufficient cross-target witness: a local
  /// upgrade callback may still be registering its delivery task. Hosted
  /// subscribe recovery waits here only after an explicit, pre-persistence
  /// session diagnostic; generic HTTP outcomes are never replayed.
  ///
  /// @ref LLP 0034#23-connection-axis-mapping-kit-derived-policy-over-d0-signals
  waitUntilReady({ timeoutMs = this.freshnessBudgetMs, revalidate = false, signal } = {}) {
    const cancellationError = () => signal?.reason instanceof Error
      ? signal.reason
      : liveStreamReadinessError(
        'SNAPBACK_LIVE_STREAM_READINESS_CANCELLED',
        `Snapback live stream readiness for ${this.connectionId} was cancelled`,
      );
    if (signal?.aborted) return Promise.reject(cancellationError());
    if (this.closed) {
      return Promise.reject(liveStreamReadinessError(
        'SNAPBACK_LIVE_STREAM_CLOSED',
        `Snapback live stream for ${this.connectionId} is closed`,
      ));
    }
    if (!revalidate && this.isReady()) return Promise.resolve(this.socketGeneration);
    if (revalidate) this.readyGeneration = 0;
    let shared = this.readinessProbe;
    if (!shared) {
      shared = {
        promise: null,
        cancel: () => {},
        settled: false,
        waiters: 0,
      };
      const pending = new Promise((resolve, reject) => {
        let settled = false;
        let probing = false;
        let timer = null;
        let offState = () => {};
        const finish = (outcome, value) => {
          if (settled) return;
          settled = true;
          if (timer !== null) clearTimeout(timer);
          offState();
          outcome(value);
        };
        shared.cancel = (error) => finish(reject, error);
        const deadline = Date.now() + timeoutMs;
        const probe = () => {
          if (settled || probing || !this.open) return;
          const generation = this.socketGeneration;
          if (this.readyGeneration === generation) {
            finish(resolve, generation);
            return;
          }
          probing = true;
          const remainingMs = Math.max(1, deadline - Date.now());
          const probeTimeoutMs = Math.min(this.heartbeatIntervalMs, remainingMs);
          this.request({ type: 'ping' }, probeTimeoutMs).then(
            (frame) => {
              probing = false;
              if (settled) return;
              if (!this.open || this.socketGeneration !== generation) {
                probe();
                return;
              }
              if (frame?.kind !== LIVE_SOCKET_KINDS.PONG) {
                this.debugCloseSocket();
                return;
              }
              this.readyGeneration = generation;
              finish(resolve, generation);
            },
            () => {
              probing = false;
              if (settled) return;
              // A raw-open socket that cannot answer the readiness ping is
              // not usable authority. Force ordinary loss/reconnect; the
              // same bounded wait continues on the replacement generation.
              if (this.open && this.socketGeneration === generation) {
                this.debugCloseSocket();
              }
            },
          );
        };
        timer = setTimeout(() => {
          finish(
            reject,
            liveStreamReadinessError(
              'SNAPBACK_LIVE_STREAM_READINESS_TIMEOUT',
              `Snapback live stream for ${this.connectionId} did not become ready within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        const stateListener = (state) => {
          if (state === 'open') {
            probe();
          } else if (state === 'closed') {
            finish(
              reject,
              liveStreamReadinessError(
                'SNAPBACK_LIVE_STREAM_CLOSED',
                `Snapback live stream for ${this.connectionId} closed before it became ready`,
              ),
            );
          }
        };
        this.readinessStateListeners.add(stateListener);
        offState = () => this.readinessStateListeners.delete(stateListener);
        this.#ensureSocket();
        if (settled) offState();
        probe();
      });
      shared.promise = pending;
      this.readinessProbe = shared;
      const clear = () => {
        shared.settled = true;
        if (this.readinessProbe === shared) this.readinessProbe = null;
      };
      pending.then(clear, clear);
    }

    shared.waiters += 1;
    const caller = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (outcome, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        outcome(value);
      };
      const onAbort = () => finish(reject, cancellationError());
      signal?.addEventListener('abort', onAbort, { once: true });
      shared.promise.then(
        (generation) => finish(resolve, generation),
        (error) => finish(reject, error),
      );
      // Abort may have raced listener registration.
      if (signal?.aborted) onAbort();
    });
    return caller.finally(() => {
      shared.waiters -= 1;
      if (shared.waiters === 0 && !shared.settled) {
        shared.cancel(liveStreamReadinessError(
          'SNAPBACK_LIVE_STREAM_READINESS_CANCELLED',
          `Snapback live stream readiness for ${this.connectionId} has no active waiters`,
        ));
      }
    });
  }

  #emitState(state, detail = {}) {
    for (const listener of [...this.stateListeners]) deliverIsolated(listener, state, detail);
    for (const listener of [...this.readinessStateListeners]) deliverIsolated(listener, state, detail);
  }

  #ensureSocket() {
    if (this.closed || this.ws || this.reconnectTimer || this.connectPending) return;
    this.#connect();
  }

  /// The stream endpoint as an absolute ws(s) URL. A browser surface may
  /// construct the client with a page-relative base (e.g. '/snapback' behind
  /// the Vite proxy, which needs `ws: true` to upgrade), which `new WebSocket`
  /// cannot take — resolve against the page origin first; headless clients
  /// always pass absolute bases.
  #socketUrl(grant) {
    const base = this.client.baseUrl;
    const absolute = /^https?:/i.test(base) || !globalThis.location
      ? base
      : new URL(base, globalThis.location.href).toString().replace(/\/$/, '');
    return `${absolute.replace(/^http/, 'ws')}/live/${grant.id}/stream`;
  }

  /// Resolve the connection grant, then open the socket. A failed handshake
  /// (server down, restarted server that lost the grant namespace) is a loss
  /// like any other: fallback engages and the backoff loop retries — and the
  /// grant cache self-clears on failure, so a retry re-opens the handshake.
  #connect() {
    if (this.connectPending) return;
    this.connectPending = true;
    this.#emitState('connecting');
    const refreshGrant = this.grantSuspect;
    this.grantSuspect = false;
    const grantPromise = this.client.authSession({ force: true }).then((session) => {
      const unavailable = authAvailabilityError(session);
      if (unavailable) throw unavailable;
      const authorityCapture = this.client.authCoordinator?.capture?.() ?? null;
      return (refreshGrant
        ? this.client.refreshConnectionGrant(this.connectionId)
        : this.client.connectionGrant(this.connectionId))
        .then((grant) => ({
          grant,
          authorityCapture: grant?.[AUTHORITY_CAPTURE] ?? authorityCapture,
        }));
    });
    grantPromise.then(
      ({ grant, authorityCapture }) => {
        this.connectPending = false;
        if (this.closed) return;
        this.#openSocket(grant, authorityCapture);
      },
      () => {
        this.connectPending = false;
        if (this.closed) return;
        if (this.attempts === 0) this.#emitState('lost', { wasOpen: false });
        this.#scheduleReconnect();
      },
    );
  }

  #openSocket(grant, authorityCapture = null) {
    const url = this.#socketUrl(grant);
    let ws;
    try {
      ws = new WebSocket(url, liveStreamProtocols(grant, this.client.authProtocols));
    } catch {
      // Constructor failure (bad URL, blocked context) is a loss like any
      // other: let consumers engage their fallback on the first failure.
      if (this.attempts === 0) this.#emitState('lost', { wasOpen: false });
      this.#scheduleReconnect();
      return;
    }
    try {
      this.socketGeneration = safeNextCounter(
        this.socketGeneration,
        'SNAPBACK_CLIENT_SOCKET_GENERATION_EXHAUSTED',
        'live socket generation',
      );
    } catch (error) {
      this.closed = true;
      try { ws.close(); } catch { /* fail closed */ }
      this.#emitState('closed', { error });
      return;
    }
    this.authorityCapture = authorityCapture;
    this.ws = ws;

    // Connect budget: a dangling upgrade (a proxy that swallows it, a dead
    // route) fires neither open nor close, which would otherwise leave
    // consumers in 'connecting' forever with no fallback. Treat it as a loss.
    const connectTimer = setTimeout(() => {
      if (this.ws === ws && !this.open) {
        try {
          ws.close();
        } catch {
          // close() on a connecting socket may throw; the close event follows.
        }
      }
    }, this.freshnessBudgetMs);
    connectTimer.unref?.();

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      clearTimeout(connectTimer);
      this.open = true;
      this.attempts = 0;
      this.lastActivityMs = Date.now();
      this.#startHeartbeat();
      this.#emitState('open');
    });
    ws.addEventListener('message', async (event) => {
      if (this.ws !== ws) return;
      this.lastActivityMs = Date.now();
      let frame;
      try {
        frame = JSON.parse(await websocketText(event.data));
      } catch {
        return;
      }
      if (
        this.authorityCapture
        && !this.client.authCoordinator?.isCurrent?.(this.authorityCapture)
      ) {
        this.#loseSocket(ws, staleAuthorityError());
        return;
      }
      if (frame?.kind === LIVE_SOCKET_KINDS.AUTH_ERROR) {
        this.#closeForAuthError(ws, frame);
        return;
      }
      markAuthorityCapture(frame, this.authorityCapture);
      this.#dispatch(frame);
    });
    const onLoss = () => {
      clearTimeout(connectTimer);
      this.#loseSocket(ws, new Error(`Snapback live stream lost: ${url}`));
    };
    ws.addEventListener('close', onLoss, { once: true });
    ws.addEventListener('error', () => {
      // 'close' follows 'error' in both browser and undici WebSockets; loss
      // handling is centralized in the close handler.
    });
  }

  // Idempotent loss transition shared by close events and synchronous send
  // failures. WebSocket.send() may throw after the socket passes our `open`
  // check but enters CLOSING; treating that as immediate loss prevents an
  // orphaned correlated request and starts bounded reconnect without waiting
  // for a later close event that a custom implementation may never deliver.
  #loseSocket(ws, error) {
    if (this.ws !== ws) return;
    const wasOpen = this.open;
    this.open = false;
    this.ws = null;
    this.#stopHeartbeat();
    this.#failPendingRequests(error instanceof Error
      ? error
      : new Error(`Snapback live stream lost: ${ws?.url ?? this.connectionId}`));
    try {
      ws.close();
    } catch {
      // The failed socket may already be closing.
    }
    if (this.closed) return;
    // A socket that never opened may have been refused at the upgrade gate
    // (stale grant after a server restart): re-run the handshake next try.
    if (!wasOpen) this.grantSuspect = true;
    // Emit on EVERY death of a constructed socket, retries included
    // (ENG-23428): the server registers the stream task at upgrade
    // completion, before any frame, so a retry socket that died without
    // firing client 'open' may still have reached the server and triggered
    // the disconnect that destroys the connection's subscriptions and
    // outbox. Consumers must hear about every such loss to know a fresh
    // subscribe is needed; swallowing retry failures left handles
    // fake-healthy on a destroyed outbox.
    this.#emitState('lost', { wasOpen });
    this.#scheduleReconnect();
  }

  #closeForAuthError(ws, frame) {
    if (this.ws !== ws) return;
    const error = liveTerminalAuthError(frame);
    const capture = this.authorityCapture;
    this.client.clearAuthSession();
    this.close(error, {
      error,
      terminal: true,
      code: error.code,
      reason: frame?.reason ?? null,
    });
    if (
      error.terminalAuth
      && capture
      && this.client.authCoordinator?.isCurrent?.(capture)
    ) {
      void this.client.authCoordinator.compareAndClear(capture, frame.code).catch(() => {});
    }
  }

  #scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    if (this.#demand() === 0) return;
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** this.attempts,
      this.reconnectMaxDelayMs,
    );
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed && this.#demand() > 0) this.#connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  #startHeartbeat() {
    this.#stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.open) return;
      if (Date.now() - this.lastActivityMs > this.freshnessBudgetMs) {
        // Freshness budget missed while the socket claims to be open: declare
        // it, then force the loss path so reconnect begins ('stale' is
        // budget-missed-while-retrying — LLP 0034 §2.2).
        this.#emitState('budget-missed');
        this.debugCloseSocket();
        return;
      }
      try {
        this.requestSeq = safeNextCounter(
          this.requestSeq,
          'SNAPBACK_CLIENT_SOCKET_REQUEST_GENERATION_EXHAUSTED',
          'socket request generation',
        );
      } catch (error) {
        this.#loseSocket(this.ws, error);
        return;
      }
      const requestId = `ping_${this.requestSeq}`;
      const ws = this.ws;
      if (!ws) return;
      try {
        ws.send(JSON.stringify({ type: 'ping', requestId }));
      } catch (error) {
        this.#loseSocket(ws, error);
      }
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  #stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  #dispatch(frame) {
    if (!frame || typeof frame !== 'object') return;
    if (frame.requestId && this.pendingRequests.has(frame.requestId)) {
      const pending = this.pendingRequests.get(frame.requestId);
      this.pendingRequests.delete(frame.requestId);
      pending.resolve(frame);
      return;
    }
    if (
      frame.kind === LIVE_SOCKET_KINDS.PONG ||
      frame.kind === LIVE_SOCKET_KINDS.EPHEMERAL_ACK ||
      frame.kind === LIVE_SOCKET_KINDS.EPHEMERAL_ERROR
    ) {
      return; // uncorrelated control frames only refresh lastActivityMs
    }
    // Every fan-out below is isolated per consumer (ENG-23391): #dispatch
    // runs inside an async 'message' listener, so an uncaught consumer throw
    // would both starve the remaining consumers of this frame and escape as
    // an unhandled rejection (fatal to a headless Node process by default).
    if (frame.kind === LIVE_SOCKET_KINDS.EPHEMERAL) {
      for (const listener of [...this.ephemeralListeners]) deliverIsolated(listener, frame);
      // The lane registry is transport-agnostic (LLP 0034 §10.1 / ENG-22478):
      // when the socket owns the connection's outbox, registered ephemeral
      // consumers (EphemeralOverlays) still receive their lane's frames.
      const consumers = this.client.__laneConsumers?.get(this.connectionId);
      for (const consumer of [...(consumers?.ephemeral ?? [])]) deliverIsolated(consumer, frame);
      return;
    }
    // Durable-lane payloads arrive unwrapped (live_replace / resync_required)
    // and route through the SAME lane registry HTTP drains use, so a
    // poll-transport handle sharing this connection is never starved by the
    // socket owning the outbox (ENG-22478 review: mixed-transport
    // unification). liveQuery handles consume durable traffic ONLY via the
    // registry — onDurable is for external socket-frame listeners and must
    // not be combined with a registry registration (double delivery).
    for (const listener of [...this.durableListeners]) deliverIsolated(listener, frame);
    const consumers = this.client.__laneConsumers?.get(this.connectionId);
    for (const consumer of [...(consumers?.durable ?? [])]) deliverIsolated(consumer, frame);
  }

  /// Send a live-socket request (ephemeral_subscribe/publish/delete or ping)
  /// and await its correlated response envelope.
  request(message, timeoutMs = 2_000) {
    if (!this.open || !this.ws) {
      return Promise.reject(new Error('Snapback live stream is not open'));
    }
    const ws = this.ws;
    this.requestSeq = safeNextCounter(
      this.requestSeq,
      'SNAPBACK_CLIENT_SOCKET_REQUEST_GENERATION_EXHAUSTED',
      'socket request generation',
    );
    const requestId = message.requestId ?? `req_${this.requestSeq}`;
    let encoded;
    try {
      encoded = JSON.stringify({ ...message, requestId });
    } catch (error) {
      return Promise.reject(error);
    }
    let pending;
    const response = new Promise((resolve, reject) => {
      pending = { resolve, reject };
      this.pendingRequests.set(requestId, pending);
    });
    const timed = withTimeout(
      response,
      timeoutMs,
      `timed out waiting for live-socket response ${requestId}`,
    ).finally(() => {
      this.pendingRequests.delete(requestId);
    });
    try {
      ws.send(encoded);
    } catch (error) {
      // Remove/reject this exact record before the socket-wide loss rejects
      // the remaining requests. Never rethrow synchronously: callers always
      // receive the Promise-shaped request failure they registered for.
      if (this.pendingRequests.get(requestId) === pending) {
        this.pendingRequests.delete(requestId);
        pending.reject(error);
      }
      this.#loseSocket(ws, error);
    }
    return timed;
  }

  #failPendingRequests(error) {
    for (const [, pending] of this.pendingRequests) pending.reject(error);
    this.pendingRequests.clear();
  }

  /// Test hook (conformance check 3): force-close the underlying socket
  /// without releasing demand — the manager treats it as a loss and retries.
  debugCloseSocket() {
    const ws = this.ws;
    if (ws) {
      try {
        ws.close();
      } catch {
        // close() on a connecting socket may throw in some implementations.
      }
    }
  }

  close(error = null, detail = {}) {
    if (this.closed) return;
    this.closed = true;
    this.#stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.open = false;
    if (ws) {
      try {
        ws.close();
      } catch {
        // best-effort teardown
      }
    }
    this.#failPendingRequests(error ?? new Error('Snapback live stream closed'));
    this.#emitState('closed', detail);
    this.durableListeners.clear();
    this.ephemeralListeners.clear();
    this.stateListeners.clear();
    this.readinessStateListeners.clear();
    this.onRelease();
  }
}

// Cap the correlation echoed on kit receipts (ENG-22478 review fix H): the
// ring is count-bounded; an unbounded echo could still pin large payloads.
const CORRELATION_ECHO_MAX_BYTES = 4_096;
function cappedCorrelation(correlation) {
  if (correlation == null) return correlation;
  let size = Infinity;
  try {
    size = JSON.stringify(correlation).length;
  } catch {
    // Unserializable correlation: keep the honest marker.
  }
  return size > CORRELATION_ECHO_MAX_BYTES ? { correlationTruncated: true, bytes: size } : correlation;
}

// Consumer isolation at the delivery choke points (ENG-23391), mirroring
// recordReceipt's receipt-listener isolation (ENG-22478 review fix G) and
// EphemeralOverlay.#notifyChange: a throwing app callback must never discard
// the rest of a destructively drained batch or escape an async socket
// listener as an unhandled rejection.
function deliverIsolated(consumer, ...payload) {
  try {
    consumer(...payload);
  } catch {
    // Consumer errors are the consumer's problem, not the delivery's.
  }
}

function liveStreamReadinessError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message };
  return error;
}

function resyncReason(serverReason) {
  if (serverReason === 'outbox_overflow') return 'overflow';
  if (serverReason === 'permission_epoch_changed') return 'permission-epoch';
  return 'resync';
}

export class EphemeralOverlay {
  // @ref LLP 0013#client-overlay-store — generated clients keep ephemeral
  // entries in memory, apply scope/version checks, and prune by server TTL.
  constructor(client, ref, { connectionId, scope, userId, permissions, snapshot }) {
    this.client = client;
    this.ref = ref;
    this.connectionId = connectionId;
    this.scope = scope;
    this.userId = userId;
    this.permissions = permissions;
    this.scopeEpoch = null;
    this.highWaterVersion = 0;
    this.entries = new Map();
    this.tombstones = new Map();
    this.needsResync = false;
    this.room = null; // captured from OUR subscribe snapshot (room identity)
    this.authorityCapture = null;
    this.__preSnapshotEnvelopes = [];
    this.__preSnapshotOverflowed = false;
    this.__drainCaptures = new Set();
    this.__changeListeners = new Set();
    // Cross-lane routing (LLP 0034 §10.1 / ENG-22478): the overlay is this
    // connection's registered ephemeral consumer, so a durable drain on the
    // same connection routes ephemeral envelopes here instead of dropping
    // them (and this overlay's drain routes durable envelopes to the durable
    // consumers symmetrically). The same registry receives socket-delivered
    // ephemeral frames when a live stream owns the connection's outbox.
    this.__unregister = client.registerEphemeralConsumer(connectionId, (envelope) => {
      if (this.__preSnapshotEnvelopes !== null) {
        if (this.__preSnapshotEnvelopes.length >= EPHEMERAL_PRE_SNAPSHOT_BUFFER_CAP) {
          this.__preSnapshotOverflowed = true;
          return;
        }
        this.__preSnapshotEnvelopes.push(envelope);
        return;
      }
      this.#consume(envelope);
    });
    if (snapshot) this.applyInitialSnapshot(snapshot);
  }

  #consume(envelope) {
    const capture = envelope?.[AUTHORITY_CAPTURE] ?? this.authorityCapture;
    if (
      this.client.authCoordinator
      && (!capture || !this.client.authCoordinator.isCurrent(capture))
    ) return 'stale_authority';
    const result = this.apply(envelope);
    for (const capture of this.__drainCaptures) capture.push(result);
    return result;
  }

  /// Establish the snapshot boundary, then replay every delta the shared
  /// connection delivered after server registration but before the response
  /// reached this client. JavaScript runs this transition synchronously, so a
  /// newly arriving frame observes the post-snapshot path and cannot overtake
  /// the buffered batch.
  applyInitialSnapshot(snapshot) {
    if (this.__preSnapshotEnvelopes === null) {
      throw new TypeError('Snapback ephemeral overlay already has an initial snapshot');
    }
    const buffered = this.__preSnapshotEnvelopes;
    const overflowed = this.__preSnapshotOverflowed;
    this.__preSnapshotEnvelopes = null;
    this.__preSnapshotOverflowed = false;
    const snapshotCapture = snapshot?.[AUTHORITY_CAPTURE] ?? null;
    if (
      this.client.authCoordinator
      && (!snapshotCapture || !this.client.authCoordinator.isCurrent(snapshotCapture))
    ) throw staleAuthorityError();
    this.authorityCapture = snapshotCapture;
    const snapshotResult = this.apply(snapshot);
    for (const envelope of buffered) this.#consume(envelope);
    if (overflowed) {
      this.entries.clear();
      this.tombstones.clear();
      this.highWaterVersion = 0;
      this.needsResync = true;
      const error = new Error(
        `SNAPBACK_EPHEMERAL_SUBSCRIBE_BUFFER_OVERFLOW: more than ${EPHEMERAL_PRE_SNAPSHOT_BUFFER_CAP} deltas arrived before the initial snapshot`,
      );
      error.diagnostic = {
        code: 'SNAPBACK_EPHEMERAL_SUBSCRIBE_BUFFER_OVERFLOW',
        message: `more than ${EPHEMERAL_PRE_SNAPSHOT_BUFFER_CAP} ephemeral deltas arrived before the initial snapshot`,
      };
      throw error;
    }
    return snapshotResult;
  }

  /// Detach from the connection's lane router.
  dispose() {
    this.__unregister?.();
    this.__unregister = null;
    this.__changeListeners.clear();
  }

  /// Observe state changes (applied snapshots/upserts/removes and resync
  /// boundaries) — the hook the Contract adapter's ephemeral source uses to
  /// re-emit EphemeralMapCells (ENG-22479).
  onChange(listener) {
    this.__changeListeners.add(listener);
    return () => this.__changeListeners.delete(listener);
  }

  #notifyChange(result) {
    for (const listener of [...this.__changeListeners]) {
      try {
        listener(result, this);
      } catch {
        // Observer errors never poison the overlay's apply path.
      }
    }
  }

  publish(value, options = {}) {
    return this.client.publishEphemeral(this.ref, {
      connectionId: options.connectionId ?? this.connectionId,
      scope: this.scope,
      value,
      ttlMs: options.ttlMs ?? null,
      userId: options.userId ?? this.userId,
      permissions: options.permissions ?? this.permissions,
      sessionId: options.sessionId ?? null,
      ownerUserId: options.ownerUserId ?? null,
      customKey: options.customKey ?? null,
    });
  }

  delete(options = {}) {
    return this.client.deleteEphemeral(this.ref, {
      connectionId: options.connectionId ?? this.connectionId,
      scope: this.scope,
      userId: options.userId ?? this.userId,
      permissions: options.permissions ?? this.permissions,
      sessionId: options.sessionId ?? null,
      ownerUserId: options.ownerUserId ?? null,
      customKey: options.customKey ?? null,
    });
  }

  async drain() {
    // Drain through the shared choke point: this overlay's registered
    // consumer applies the ephemeral envelopes (captured for the return
    // value; captures are re-entrant — overlapping drains each collect what
    // was applied while they were in flight), while durable envelopes in the
    // same drain are routed to the connection's durable consumers instead of
    // being discarded.
    const capture = [];
    this.__drainCaptures.add(capture);
    try {
      await this.client.drainConnection(this.connectionId);
      return capture.filter((result) => result !== 'not_ephemeral');
    } finally {
      this.__drainCaptures.delete(capture);
    }
  }

  apply(input) {
    const message = unwrapEphemeralMessage(input);
    if (!message) return 'not_ephemeral';
    // Room isolation (ENG-22478 review fix B): a connection's outbox carries
    // EVERY room's traffic, and the lane registry fans it to every overlay —
    // so each message must match THIS overlay's room identity (captured from
    // our own subscribe snapshot). A foreign room's snapshot/upsert/remove
    // must never contaminate this overlay's entries or scopeEpoch.
    const room = messageRoom(message);
    if (this.room && room && !sameRoom(this.room, room)) return 'foreign_room';
    if (message.Snapshot) {
      if (!this.room && message.Snapshot.room) this.room = message.Snapshot.room;
      const snapshotEpoch = message.Snapshot.scope_epoch;
      const snapshotHighWater = Number.isSafeInteger(message.Snapshot.high_water_version)
        ? message.Snapshot.high_water_version
        : snapshotMaxEntryVersion(message.Snapshot);
      if ((message.Snapshot.entries ?? []).some((entry) => entry.entry_version > snapshotHighWater)) {
        this.entries.clear();
        this.tombstones.clear();
        this.needsResync = true;
        return 'needs_resync';
      }
      if (this.scopeEpoch !== null) {
        if (snapshotEpoch < this.scopeEpoch) return 'ignored_stale';
        if (
          snapshotEpoch === this.scopeEpoch
          && snapshotHighWater < this.highWaterVersion
        ) {
          return 'ignored_stale';
        }
      }
      const previousEpoch = this.scopeEpoch;
      this.scopeEpoch = snapshotEpoch;
      this.highWaterVersion = snapshotHighWater;
      this.entries.clear();
      this.tombstones.clear();
      for (const entry of message.Snapshot.entries ?? []) {
        this.entries.set(entry.key, normalizeEntry(entry));
      }
      this.needsResync = false;
      // Ephemeral one-version story (LLP 0034 §3.1): entry versions are valid
      // WITHIN a scopeEpoch; an epoch bump is a resubscription boundary and
      // is receipted as such. The first snapshot is the establishment.
      // Privacy (§3.3): scope/epoch/keys only — never entry values.
      this.client.recordReceipt?.({
        kind: 'subscription',
        lane: 'ephemeral',
        // The binding id for an ephemeral map IS the collection name — the
        // adapter joins overlay receipts to bindings by it (ENG-22479).
        bindingId: collectionName(this.ref),
        collection: collectionName(this.ref),
        event: previousEpoch === null ? 'established' : 'resubscribed',
        ...(previousEpoch === null ? {} : { reason: 'resync' }),
        scope: { ...this.scope },
        snapback: { scopeEpoch: this.scopeEpoch },
        receivedAtMs: Date.now(),
      });
      this.#notifyChange('applied');
      return 'applied';
    }
    if (message.Upsert) {
      const entry = normalizeEntry(message.Upsert.entry);
      if (this.scopeEpoch !== entry.scopeEpoch) {
        this.needsResync = true;
        return 'needs_resync';
      }
      if (
        entry.entryVersion <= this.highWaterVersion
        || (this.tombstones.get(entry.key) ?? 0) >= entry.entryVersion
      ) return 'ignored_stale';
      this.highWaterVersion = entry.entryVersion;
      this.tombstones.delete(entry.key);
      this.entries.set(entry.key, entry);
      this.#notifyChange('applied');
      return 'applied';
    }
    if (message.Remove) {
      const remove = message.Remove;
      if (this.scopeEpoch !== remove.scope_epoch) {
        this.needsResync = true;
        return 'needs_resync';
      }
      if (remove.entry_version <= this.highWaterVersion) return 'ignored_stale';
      this.highWaterVersion = remove.entry_version;
      this.entries.delete(remove.key);
      this.tombstones.set(remove.key, remove.entry_version);
      while (this.tombstones.size > 1024) {
        let oldestKey = null;
        let oldestVersion = Number.POSITIVE_INFINITY;
        for (const [key, version] of this.tombstones) {
          if (version < oldestVersion) {
            oldestKey = key;
            oldestVersion = version;
          }
        }
        if (oldestKey === null) break;
        this.tombstones.delete(oldestKey);
      }
      this.#notifyChange('applied');
      return 'applied';
    }
    if (message.ResyncRequired) {
      this.entries.clear();
      this.tombstones.clear();
      this.highWaterVersion = 0;
      this.needsResync = true;
      this.#notifyChange('needs_resync');
      return 'needs_resync';
    }
    return 'not_ephemeral';
  }

  pruneExpired(nowMs = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= nowMs) this.entries.delete(key);
    }
  }

  currentEntries({ prune = true } = {}) {
    if (prune) this.pruneExpired();
    return [...this.entries.values()].map((entry) => ({
      key: entry.key,
      value: entry.value,
      expiresAtMs: entry.expiresAtMs,
      receivedAtMs: entry.receivedAtMs,
      scopeEpoch: entry.scopeEpoch,
      entryVersion: entry.entryVersion,
    }));
  }
}

// ENG-23442 transports: HTTP carries the grant token as a header; a WebSocket
// upgrade carries it as the `snapback.connection-token.<token>` subprotocol
// (browser WebSockets cannot set headers), alongside `snapback.v1` so the
// server has a legal subprotocol to echo.
function connectionTokenHeader(grant) {
  return { 'x-snapback-connection-token': grant.token };
}

function liveStreamProtocols(grant, protocols = {}) {
  const offered = ['snapback.v1', `snapback.connection-token.${grant.token}`];
  if (protocols.authClient != null) {
    offered.push(`snapback.auth-client.${protocols.authClient}`);
  }
  if (protocols.authInvalidation != null) {
    offered.push(`snapback.auth-invalidation.${protocols.authInvalidation}`);
  }
  if (protocols.authorityDescriptor != null) {
    offered.push(`snapback.authority-descriptor.${protocols.authorityDescriptor}`);
  }
  if (protocols.authorizedLease != null) {
    offered.push(`snapback.authorized-lease.${protocols.authorizedLease}`);
  }
  return offered;
}

function functionName(ref) {
  const name = typeof ref === 'string' ? ref : ref?.name;
  if (typeof name === 'string' && GENERATED_IDENTIFIER.test(name)) return name;
  if (typeof name === 'string') {
    throw new TypeError(`Snapback function name must match ${GENERATED_IDENTIFIER}, got ${JSON.stringify(name)}`);
  }
  throw new TypeError(`Snapback function reference must be a string or generated ref, got ${JSON.stringify(ref)}`);
}

function collectionName(ref) {
  const name = typeof ref === 'string' ? ref : ref?.name;
  if (typeof name === 'string' && GENERATED_IDENTIFIER.test(name)) return name;
  if (typeof name === 'string') {
    throw new TypeError(`Snapback collection name must match ${GENERATED_IDENTIFIER}, got ${JSON.stringify(name)}`);
  }
  throw new TypeError(`Snapback ephemeral collection reference must be a string or generated ref, got ${JSON.stringify(ref)}`);
}

function encodeEphemeralValue(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  return [...bytes];
}

function decodeEphemeralValue(bytes) {
  const text = new TextDecoder().decode(Uint8Array.from(bytes ?? []));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function decodeDurablePayload(payload) {
  if (typeof payload === 'string') return payload;
  return new TextDecoder().decode(Uint8Array.from(payload ?? []));
}

function unwrapEphemeralMessage(input) {
  if (!input) return null;
  if (input.Ephemeral) return input.Ephemeral;
  if (input.kind === LIVE_SOCKET_KINDS.EPHEMERAL) return input.message;
  if (input.message) return input.message;
  if (input.Snapshot || input.Upsert || input.Remove || input.ResyncRequired || input.Error) return input;
  return null;
}

function messageRoom(message) {
  return (
    message.Snapshot?.room
    ?? message.Upsert?.room
    ?? message.Remove?.room
    ?? message.ResyncRequired?.room
    ?? null
  );
}

function sameRoom(a, b) {
  return a.collection === b.collection && a.routing_key === b.routing_key;
}

function normalizeEntry(entry) {
  return {
    key: entry.key,
    value: decodeEphemeralValue(entry.value),
    receivedAtMs: entry.received_at_ms,
    expiresAtMs: entry.expires_at_ms,
    scopeEpoch: entry.scope_epoch,
    entryVersion: entry.entry_version,
  };
}

function snapshotMaxEntryVersion(snapshot) {
  let max = 0;
  for (const entry of snapshot?.entries ?? []) {
    if (typeof entry?.entry_version === 'number' && entry.entry_version > max) max = entry.entry_version;
  }
  return max;
}

function entriesMaxEntryVersion(entries) {
  let max = 0;
  for (const entry of entries?.values?.() ?? []) {
    if (typeof entry?.entryVersion === 'number' && entry.entryVersion > max) max = entry.entryVersion;
  }
  return max;
}

function normalizedScopeKey(scope) {
  return Object.entries(scope)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${String(key).length}:${key}=${String(value).length}:${value}`)
    .join('|');
}

function bodySnippet(text, limit = 200) {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`;
}

async function websocketText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data && typeof data.text === 'function') return data.text();
  return String(data);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
