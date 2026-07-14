// Cross-context browser authority custody and the local exposure barrier.
//
// @ref LLP 0059#client-custody-and-authcoordinator — bearer custody is one
//   durable, serialized state machine per canonical app id; app participants
//   never own independent current-auth state.

export const SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION = 1;
export const AUTH_CUSTODY_DATABASE_NAME = 'snapback-auth-custody';
export const AUTH_CUSTODY_DATABASE_VERSION = 1;
export const AUTH_CUSTODY_LEASE_MS = 5_000;
export const AUTH_CUSTODY_LEASE_RENEW_MS = 1_000;
export const AUTH_CUSTODY_SUPERSEDED_WAIT_MS = 2_000;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUTHORITY_KEY = /^sha256:[0-9a-f]{64}$/;
const PHASES = new Set(['settled', 'clearing']);
const AUTH_MODES = new Set(['dev', 'sessions']);

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === expected.length
    && actual.every((key) => typeof key === 'string' && expected.includes(key));
}

function assertExactKeys(value, expected, path) {
  if (!hasExactKeys(value, expected)) {
    throw corrupt(`${path} has missing or unknown fields`, { field: path });
  }
}

function coordinatorError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

const corrupt = (message, details = {}) => coordinatorError(
  'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  message,
  details,
);

function assertSafeInteger(value, field, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw corrupt(`custody field ${field} is not a safe ${positive ? 'positive' : 'nonnegative'} integer`, { field });
  }
}

function nextRevision(revision) {
  assertSafeInteger(revision, 'revision', { positive: true });
  if (revision === MAX_SAFE) {
    throw corrupt('custody revision is exhausted and the custody store must be replaced', {
      field: 'revision',
    });
  }
  return revision + 1;
}

function nextAuthorityEpoch(epoch) {
  assertSafeInteger(epoch, 'authorityEpoch');
  if (epoch === MAX_SAFE) {
    throw coordinatorError(
      'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
      'authority epoch is exhausted and the custody store must be replaced',
      { authorityEpoch: epoch },
    );
  }
  return epoch + 1;
}

// Synchronous SHA-256 keeps capture() and authority-key comparison synchronous
// in browsers, Node, and native JS shells. Input is always UTF-8 protocol text.
function sha256Hex(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const bitLength = BigInt(bytes.length) * 8n;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  for (let shift = 56n; shift >= 0n; shift -= 8n) {
    bytes.push(Number((bitLength >> shift) & 0xffn));
  }
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351,
    0x14292967, 0x27b70a85,
    0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585,
    0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa,
    0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const rotr = (value, count) => (value >>> count) | (value << (32 - count));
  const w = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      w[i] = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function canonicalAppId(appId) {
  if (typeof appId !== 'string' || appId.length === 0 || appId.trim() !== appId) {
    throw corrupt('canonical app id must be a non-empty, already-normalized string', { field: 'appId' });
  }
  return appId;
}

export function normalizeClientAuthority(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    throw corrupt('client authority is not an object', { field: 'authority' });
  }
  const kind = authority.kind;
  if (kind !== 'anonymous' && kind !== 'session') {
    throw corrupt('client authority kind is invalid', { field: 'authority.kind' });
  }
  if (!AUTH_MODES.has(authority.authMode)) {
    throw corrupt('client authority authMode is invalid', { field: 'authority.authMode' });
  }
  if (!UUID_V7.test(authority.authorizationStreamIncarnation ?? '')) {
    throw corrupt('authorization stream incarnation is not a canonical UUIDv7', {
      field: 'authority.authorizationStreamIncarnation',
    });
  }
  if (kind === 'anonymous') {
    assertExactKeys(authority, [
      'kind',
      'authMode',
      'authorizationStreamIncarnation',
    ], 'authority');
    return {
      kind,
      authMode: authority.authMode,
      authorizationStreamIncarnation: authority.authorizationStreamIncarnation,
    };
  }
  if (authority.authMode !== 'sessions') {
    throw corrupt('session authority requires sessions mode', { field: 'authority.authMode' });
  }
  assertExactKeys(authority, [
    'kind',
    'authMode',
    'authorizationStreamIncarnation',
    'sessionId',
    'userId',
  ], 'authority');
  for (const field of ['sessionId', 'userId']) {
    if (!UUID_V7.test(authority[field] ?? '')) {
      throw corrupt(`session authority ${field} is not a canonical UUIDv7`, { field: `authority.${field}` });
    }
  }
  return {
    kind,
    authMode: 'sessions',
    authorizationStreamIncarnation: authority.authorizationStreamIncarnation,
    sessionId: authority.sessionId,
    userId: authority.userId,
  };
}

export function canonicalAuthorityKey(appId, authority) {
  const canonicalId = canonicalAppId(appId);
  const normalized = normalizeClientAuthority(authority);
  const ordered = normalized.kind === 'anonymous'
    ? {
        appId: canonicalId,
        kind: normalized.kind,
        authMode: normalized.authMode,
        authorizationStreamIncarnation: normalized.authorizationStreamIncarnation,
      }
    : {
        appId: canonicalId,
        kind: normalized.kind,
        authMode: normalized.authMode,
        authorizationStreamIncarnation: normalized.authorizationStreamIncarnation,
        sessionId: normalized.sessionId,
        userId: normalized.userId,
      };
  return `sha256:${sha256Hex(`snapback.auth-authority.v1\n${JSON.stringify(ordered)}`)}`;
}

export function authAppIdHash(appId) {
  return sha256Hex(`snapback.auth-app.v1\n${canonicalAppId(appId)}`);
}

function validateRefreshTime(value, field = 'refreshAfterMs') {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw corrupt(`custody field ${field} is not a safe nonnegative integer timestamp or null`, { field });
  }
}

export function validateAuthCustody(record, expectedAppId = null) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw corrupt('durable custody is not an object');
  }
  assertExactKeys(record, [
    'formatVersion',
    'appId',
    'authorityEpoch',
    'revision',
    'phase',
    'authority',
    'pendingAuthority',
    'bearer',
    'pendingBearer',
    'refreshAfterMs',
  ], 'custody');
  if (record.formatVersion !== SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION) {
    throw corrupt('durable custody format version is unsupported', {
      storedVersion: record.formatVersion ?? null,
      supportedVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
    });
  }
  const appId = canonicalAppId(record.appId);
  if (expectedAppId !== null && appId !== expectedAppId) {
    throw corrupt('durable custody belongs to another app', { expectedAppId, actualAppId: appId });
  }
  assertSafeInteger(record.authorityEpoch, 'authorityEpoch');
  assertSafeInteger(record.revision, 'revision', { positive: true });
  if (!PHASES.has(record.phase)) throw corrupt('durable custody phase is invalid', { field: 'phase' });
  validateRefreshTime(record.refreshAfterMs);
  const authority = record.authority === null ? null : normalizeClientAuthority(record.authority);
  const pendingAuthority = record.pendingAuthority === null
    ? null
    : normalizeClientAuthority(record.pendingAuthority);
  const bearerValid = (value) => value === null || (typeof value === 'string' && value.length > 0);
  if (!bearerValid(record.bearer) || !bearerValid(record.pendingBearer)) {
    throw corrupt('custody bearer fields must be non-empty strings or null');
  }
  if (record.phase === 'settled') {
    if (authority === null || pendingAuthority !== null || record.pendingBearer !== null) {
      throw corrupt('settled custody has inconsistent current or pending fields');
    }
    if (authority.kind === 'anonymous' && (record.bearer !== null || record.refreshAfterMs !== null)) {
      throw corrupt('anonymous settled custody cannot contain bearer custody or a refresh time');
    }
    if (authority.kind === 'session' && (record.bearer === null || record.refreshAfterMs === null)) {
      throw corrupt('session settled custody requires a bearer and refresh time');
    }
  } else {
    if (record.authorityEpoch < 1) {
      throw corrupt('clearing custody must advance to a positive authority epoch', {
        field: 'authorityEpoch',
      });
    }
    if (authority !== null || record.bearer !== null || pendingAuthority === null) {
      throw corrupt('clearing custody has inconsistent current or pending fields');
    }
    if (pendingAuthority.kind === 'anonymous' && (record.pendingBearer !== null || record.refreshAfterMs !== null)) {
      throw corrupt('anonymous clearing successor cannot contain bearer custody or a refresh time');
    }
    if (pendingAuthority.kind === 'session' && (record.pendingBearer === null || record.refreshAfterMs === null)) {
      throw corrupt('session clearing successor requires a bearer and refresh time');
    }
  }
  return clone({
    formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
    appId,
    authorityEpoch: record.authorityEpoch,
    revision: record.revision,
    phase: record.phase,
    authority,
    pendingAuthority,
    bearer: record.bearer,
    pendingBearer: record.pendingBearer,
    refreshAfterMs: record.refreshAfterMs,
  });
}

function normalizeSuccessor(successor) {
  const candidate = successor?.authority ? successor : { authority: successor };
  const authority = normalizeClientAuthority(candidate.authority);
  const bearer = candidate.bearer ?? null;
  const refreshAfterMs = candidate.refreshAfterMs ?? null;
  validateRefreshTime(refreshAfterMs, 'successor.refreshAfterMs');
  if (authority.kind === 'anonymous') {
    if (bearer !== null || refreshAfterMs !== null) {
      throw corrupt('anonymous successor cannot contain a bearer or refresh time');
    }
  } else if (typeof bearer !== 'string' || bearer.length === 0 || refreshAfterMs === null) {
    throw corrupt('session successor requires a non-empty bearer and refresh time');
  }
  return { authority, bearer, refreshAfterMs };
}

function captureFor(appId, record) {
  if (record.phase !== 'settled') {
    throw coordinatorError(
      'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
      'authority custody is clearing; app-visible work is paused',
      { authorityEpoch: record.authorityEpoch },
    );
  }
  return Object.freeze({
    authorityEpoch: record.authorityEpoch,
    custodyRevision: record.revision,
    authorityKey: canonicalAuthorityKey(appId, record.authority),
  });
}

function captureMatches(appId, record, capture, { revision = false } = {}) {
  if (!record || record.phase !== 'settled' || !capture) return false;
  if (record.authorityEpoch !== capture.authorityEpoch) return false;
  if (canonicalAuthorityKey(appId, record.authority) !== capture.authorityKey) return false;
  return !revision || record.revision === capture.custodyRevision;
}

function createSerialOwner(readRecord, replaceRecord) {
  let active = true;
  return {
    read: async () => {
      if (!active) throw coordinatorError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'custody ownership was released');
      return clone(await readRecord());
    },
    replace: async (expectedRevision, next) => {
      if (!active) throw coordinatorError('SNAPBACK_AUTH_CUSTODY_LOCK_LOST', 'custody ownership was released');
      return clone(await replaceRecord(expectedRevision, clone(next)));
    },
    release: () => { active = false; },
  };
}

const memoryLocks = new WeakMap();

function memoryLockFor(state, appId) {
  let locks = memoryLocks.get(state);
  if (!locks) {
    locks = new Map();
    memoryLocks.set(state, locks);
  }
  let lock = locks.get(appId);
  if (!lock) {
    lock = { tail: Promise.resolve() };
    locks.set(appId, lock);
  }
  return lock;
}

/** Deterministic transactional custody storage for unit tests and native shims. */
export function createMemoryAuthCustodyStorage({ state = { custody: {} } } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('createMemoryAuthCustodyStorage requires a shared state object');
  }
  if (!state.custody) state.custody = {};
  return {
    async withOwnership(appId, operation) {
      const canonicalId = canonicalAppId(appId);
      const lock = memoryLockFor(state, canonicalId);
      let release;
      const prior = lock.tail;
      lock.tail = new Promise((resolve) => { release = resolve; });
      await prior;
      const owner = createSerialOwner(
        () => Object.hasOwn(state.custody, canonicalId) ? state.custody[canonicalId] : null,
        (expectedRevision, next) => {
          const current = Object.hasOwn(state.custody, canonicalId)
            ? state.custody[canonicalId]
            : null;
          const actualRevision = current?.revision ?? null;
          if (actualRevision !== expectedRevision) {
            throw coordinatorError(
              'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
              'durable custody changed before compare-and-swap',
              { expectedRevision, actualRevision },
            );
          }
          const validated = validateAuthCustody(next, canonicalId);
          if (current !== null) {
            const previous = validateAuthCustody(current, canonicalId);
            if (validated.revision !== previous.revision + 1) {
              throw corrupt('custody replacement did not increment revision exactly once');
            }
            if (
              validated.authorityEpoch < previous.authorityEpoch
              || validated.authorityEpoch > previous.authorityEpoch + 1
            ) {
              throw corrupt('custody replacement regressed or skipped authority epoch');
            }
          } else if (validated.revision !== 1 || validated.authorityEpoch !== 0) {
            throw corrupt('fresh custody must begin at epoch 0 and revision 1');
          }
          Object.defineProperty(state.custody, canonicalId, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: clone(validated),
          });
          return validated;
        },
      );
      try {
        return await operation(owner);
      } finally {
        owner.release();
        release();
      }
    },
    snapshot(appId) {
      const canonicalId = canonicalAppId(appId);
      return clone(Object.hasOwn(state.custody, canonicalId) ? state.custody[canonicalId] : null);
    },
  };
}

function participantMethod(participant, method, context) {
  const fn = participant?.[method];
  if (typeof fn !== 'function') return method === 'blank' || method === 'clearMemory' ? undefined : Promise.resolve();
  return fn.call(participant, context);
}

/**
 * One context's view of the shared custody state and its ordered local barrier.
 * Storage is injected so tests, browsers, and native shells use the same state
 * machine without pretending localStorage is an atomic authority source.
 */
export class AuthCoordinator {
  #appId;
  #appIdHash;
  #storage;
  #record = null;
  #participants = [];
  #participantSequence = 0;
  #broadcast = null;
  #hintStorage = null;
  #publicationPaused = true;
  #activeBarrier = null;
  #closed = false;
  #synchronizing = null;
  #inCommit = false;

  constructor({
    appId,
    storage,
    broadcastChannelFactory = globalThis.BroadcastChannel
      ? (name) => new globalThis.BroadcastChannel(name)
      : null,
    hintStorage = globalThis.localStorage ?? null,
  }) {
    this.#appId = canonicalAppId(appId);
    this.#appIdHash = authAppIdHash(this.#appId);
    if (!storage || typeof storage.withOwnership !== 'function') {
      throw new TypeError('AuthCoordinator requires transactional custody storage');
    }
    this.#storage = storage;
    this.#hintStorage = hintStorage;
    if (broadcastChannelFactory) {
      this.#broadcast = broadcastChannelFactory(`snapback-auth-custody:${this.#appIdHash}`);
      if (this.#broadcast) {
        this.#broadcast.onmessage = (event) => this.#receiveWakeup(event?.data);
      }
    }
  }

  get appId() { return this.#appId; }

  get phase() { return this.#record?.phase ?? 'blank'; }

  get authority() {
    return this.#record?.phase === 'settled' ? clone(this.#record.authority) : null;
  }

  capture() {
    this.#assertUsable();
    if (this.#inCommit) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
        'coordinator operations are forbidden inside compareAndCommit',
      );
    }
    if (this.#publicationPaused || this.#record === null) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'authority custody is not settled for app-visible work',
      );
    }
    return captureFor(this.#appId, this.#record);
  }

  isCurrent(capture) {
    return !this.#publicationPaused && captureMatches(this.#appId, this.#record, capture);
  }

  settledView() {
    const capture = this.capture();
    return Object.freeze({
      ...capture,
      authority: clone(this.#record.authority),
      refreshAfterMs: this.#record.refreshAfterMs,
    });
  }

  /** Narrow transport read used during the post-settle resume barrier. */
  credentialFor(capture) {
    this.#assertUsable();
    if (!captureMatches(this.#appId, this.#record, capture)) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTHORITY_STALE',
        'credential capture does not name current settled custody',
      );
    }
    return Object.freeze({
      authority: clone(this.#record.authority),
      bearer: this.#record.bearer,
      refreshAfterMs: this.#record.refreshAfterMs,
      revision: this.#record.revision,
    });
  }

  /** Establish a fresh store only from a successful anonymous handshake. */
  async establishAnonymous(authority) {
    this.#assertOperationAllowed();
    const normalized = normalizeClientAuthority(authority);
    if (normalized.kind !== 'anonymous') {
      throw coordinatorError(
        'SNAPBACK_AUTH_CUSTODY_BOOTSTRAP_INVALID',
        'fresh custody may be established only from an anonymous server handshake',
      );
    }
    return this.#storage.withOwnership(this.#appId, async (owner) => {
      let record = await owner.read();
      if (record === null) {
        record = await owner.replace(null, {
          formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
          appId: this.#appId,
          authorityEpoch: 0,
          revision: 1,
          phase: 'settled',
          authority: normalized,
          pendingAuthority: null,
          bearer: null,
          pendingBearer: null,
          refreshAfterMs: null,
        });
        this.#publish(record);
      } else {
        record = validateAuthCustody(record, this.#appId);
      }
      if (record.phase === 'clearing') return this.#recoverOwned(owner, record, 'bootstrap_recovery');
      this.#adoptSettled(record);
      return captureFor(this.#appId, record);
    });
  }

  /** Mandatory lifecycle/publication gate; reloads durable custody under ownership. */
  async synchronize() {
    this.#assertOperationAllowed();
    if (this.#synchronizing) return this.#synchronizing;
    const work = this.#storage.withOwnership(this.#appId, async (owner) => {
      const record = await owner.read();
      if (record === null) {
        this.#publicationPaused = true;
        this.#record = null;
        return null;
      }
      const validated = validateAuthCustody(record, this.#appId);
      if (validated.phase === 'clearing') {
        return this.#recoverOwned(owner, validated, 'peer_recovery');
      }
      if (
        this.#record === null
        || this.#record.revision !== validated.revision
        || this.#record.authorityEpoch !== validated.authorityEpoch
        || this.#publicationPaused
      ) {
        await this.#adoptPeerSettled(validated);
      }
      return captureFor(this.#appId, validated);
    });
    const tracked = work.finally(() => {
      if (this.#synchronizing === tracked) this.#synchronizing = null;
    });
    this.#synchronizing = tracked;
    return tracked;
  }

  /**
   * Cold-process restore for lease-bounded offline reads. This deliberately
   * does not run participant resume: no transport becomes online, and the
   * caller may use the returned capture only to validate durable retained
   * state. Every later online boundary still enters synchronize/authSession.
   *
   * @ref LLP 0058#kit-ordering — offline cold boot is authorized by the last
   *   durable mode/authority metadata, not by a fabricated handshake.
   */
  async restoreOffline() {
    this.#assertOperationAllowed();
    try {
      return await this.#storage.withOwnership(this.#appId, async (owner) => {
        let record;
        try {
          record = await owner.read();
        } catch (error) {
          // A mandatory durable read that cannot establish the current authority
          // invalidates every previously exposed local capture. In particular,
          // an offline caller must never fall back to the last in-memory record.
          await this.#failClosedOfflineExposure('offline_custody_read_failed');
          throw error;
        }
        if (record === null) {
          if (this.#record === null) return null;
          await this.#failClosedOfflineExposure('offline_custody_missing');
          throw corrupt('durable custody disappeared during offline restore');
        }
        let validated;
        try {
          validated = validateAuthCustody(record, this.#appId);
        } catch (error) {
          // Validation is part of the mandatory gate. Pause and blank the
          // predecessor before surfacing malformed durable bytes to the caller.
          await this.#failClosedOfflineExposure('offline_custody_malformed');
          throw error;
        }
        if (validated.phase !== 'settled') {
          await this.#failClosedOfflineExposure('offline_custody_clearing');
          throw coordinatorError(
            'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
            'offline authority requires settled durable custody',
            { authorityEpoch: validated.authorityEpoch },
          );
        }
        if (this.#record !== null) {
          if (this.#publicationPaused || this.#record.phase !== 'settled') {
            throw coordinatorError(
              'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
              'offline authority cannot be restored over an in-progress local barrier',
            );
          }
          const current = validateAuthCustody(this.#record, this.#appId);
          if (
            validated.revision < current.revision
            || validated.authorityEpoch < current.authorityEpoch
          ) {
            await this.#failClosedOfflineExposure('offline_custody_regressed');
            throw corrupt('durable custody regressed during offline restore');
          }
          const sameAuthority = validated.authorityEpoch === current.authorityEpoch
            && canonicalAuthorityKey(this.#appId, validated.authority)
              === canonicalAuthorityKey(this.#appId, current.authority);
          if (sameAuthority) {
            // A bearer rotation may advance only the custody revision. It does
            // not change the offline authorization identity, but adopting the
            // durable record prevents a missed wakeup from retaining stale
            // credential custody for the next online boundary.
            this.#adoptSettled(validated);
            return captureFor(this.#appId, validated);
          }
          return this.#adoptPeerOfflineSettled(validated);
        }
        // A fresh context has no predecessor app-visible state to clear. Its
        // participants were registered while publication was paused and are
        // already blank; exposing this capture grants no online transport.
        this.#adoptSettled(validated);
        return captureFor(this.#appId, validated);
      });
    } catch (error) {
      // withOwnership can fail before it invokes the callback (for example,
      // when the browser cannot acquire durable custody). That is also a
      // mandatory-gate failure, so a formerly exposed predecessor must stop.
      if (!this.#publicationPaused) {
        await this.#failClosedOfflineExposure('offline_custody_ownership_failed');
      }
      throw error;
    }
  }

  async compareAndCommit(capture, commit) {
    this.#assertOperationAllowed();
    if (typeof commit !== 'function') throw new TypeError('compareAndCommit requires a commit callback');
    return this.#storage.withOwnership(this.#appId, async (owner) => {
      const record = await owner.read();
      if (!captureMatches(this.#appId, record, capture)) return { committed: false };
      const validated = validateAuthCustody(record, this.#appId);
      this.#adoptSettled(validated);
      this.#inCommit = true;
      try {
        const value = commit(Object.freeze({
          ...captureFor(this.#appId, validated),
          authority: clone(validated.authority),
          bearer: validated.bearer,
          refreshAfterMs: validated.refreshAfterMs,
        }));
        if (value && typeof value.then === 'function') {
          throw coordinatorError(
            'SNAPBACK_CLIENT_AUTH_COMMIT_ASYNC',
            'compareAndCommit callback must be synchronous and non-reentrant',
          );
        }
        return { committed: true, value };
      } finally {
        this.#inCommit = false;
      }
    });
  }

  async compareAndRotateBearer(capture, { bearer, refreshAfterMs }) {
    this.#assertOperationAllowed();
    if (typeof bearer !== 'string' || bearer.length === 0) {
      throw new TypeError('compareAndRotateBearer requires a non-empty bearer');
    }
    validateRefreshTime(refreshAfterMs, 'refreshAfterMs');
    if (refreshAfterMs === null) throw new TypeError('compareAndRotateBearer requires refreshAfterMs');
    return this.#storage.withOwnership(this.#appId, async (owner) => {
      const record = await owner.read();
      if (!captureMatches(this.#appId, record, capture, { revision: true })) {
        return { rotated: false };
      }
      const current = validateAuthCustody(record, this.#appId);
      if (current.authority.kind !== 'session') {
        throw coordinatorError('SNAPBACK_CLIENT_AUTHORITY_STALE', 'anonymous custody cannot rotate a bearer');
      }
      const next = await owner.replace(current.revision, {
        ...current,
        revision: nextRevision(current.revision),
        bearer,
        refreshAfterMs,
      });
      this.#adoptSettled(next);
      this.#publish(next);
      return { rotated: true, capture: captureFor(this.#appId, next) };
    });
  }

  /**
   * Serialize refresh across contexts and keep successor plaintext private
   * until the exact predecessor revision is durably replaced.
   */
  async withCredentialRotation(capture, rotate) {
    this.#assertOperationAllowed();
    if (typeof rotate !== 'function') throw new TypeError('withCredentialRotation requires a callback');
    return this.#storage.withOwnership(this.#appId, async (owner) => {
      const record = await owner.read();
      if (!captureMatches(this.#appId, record, capture, { revision: true })) {
        return { rotated: false };
      }
      const current = validateAuthCustody(record, this.#appId);
      if (current.authority.kind !== 'session') {
        throw coordinatorError('SNAPBACK_CLIENT_AUTHORITY_STALE', 'anonymous custody cannot refresh a bearer');
      }
      const candidate = await rotate(Object.freeze({
        bearer: current.bearer,
        authority: clone(current.authority),
        refreshAfterMs: current.refreshAfterMs,
      }));
      if (!candidate || typeof candidate.bearer !== 'string' || candidate.bearer.length === 0) {
        throw coordinatorError('SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID', 'refresh returned no successor bearer');
      }
      validateRefreshTime(candidate.refreshAfterMs, 'refreshAfterMs');
      if (candidate.refreshAfterMs === null) {
        throw coordinatorError('SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID', 'refresh returned no refresh schedule');
      }
      const next = await owner.replace(current.revision, {
        ...current,
        revision: nextRevision(current.revision),
        bearer: candidate.bearer,
        refreshAfterMs: candidate.refreshAfterMs,
      });
      this.#adoptSettled(next);
      this.#publish(next);
      return {
        rotated: true,
        capture: captureFor(this.#appId, next),
        value: candidate.value,
      };
    });
  }

  async waitForNewerRevision(capture, {
    timeoutMs = AUTH_CUSTODY_SUPERSEDED_WAIT_MS,
    pollMs = 25,
    monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) {
    this.#assertOperationAllowed();
    const deadline = monotonicNow() + timeoutMs;
    for (;;) {
      try {
        await this.synchronize();
      } catch (error) {
        if (
          error?.code === 'SNAPBACK_AUTH_CUSTODY_CORRUPT'
          || error?.code === 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'
        ) throw error;
        // A peer may still own a clearing transition; retry until the bounded
        // monotonic deadline and let the caller choose the family-alarm path.
      }
      if (
        this.#record?.phase === 'settled'
        && this.#record.authorityEpoch === capture.authorityEpoch
        && canonicalAuthorityKey(this.#appId, this.#record.authority) === capture.authorityKey
        && this.#record.revision > capture.custodyRevision
      ) {
        return captureFor(this.#appId, this.#record);
      }
      if (
        this.#record?.phase === 'settled'
        && (
          this.#record.authorityEpoch !== capture.authorityEpoch
          || canonicalAuthorityKey(this.#appId, this.#record.authority) !== capture.authorityKey
        )
      ) return null;
      const remaining = deadline - monotonicNow();
      if (remaining <= 0) return null;
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
    }
  }

  async compareAndClear(capture, reason = 'terminal_auth_error') {
    this.#assertOperationAllowed();
    const current = this.#record;
    if (!captureMatches(this.#appId, current, capture)) return { cleared: false };
    const authority = current.authority;
    const anonymous = {
      kind: 'anonymous',
      authMode: authority.authMode,
      authorizationStreamIncarnation: authority.authorizationStreamIncarnation,
    };
    try {
      await this.transition(capture, { authority: anonymous, bearer: null, refreshAfterMs: null }, reason);
      return { cleared: true };
    } catch (error) {
      if (error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE') return { cleared: false };
      throw error;
    }
  }

  async transition(expected, successor, reason = 'authority_change') {
    this.#assertOperationAllowed();
    const normalized = normalizeSuccessor(successor);
    return this.#storage.withOwnership(this.#appId, async (owner) => {
      let current = await owner.read();
      if (current === null) {
        throw coordinatorError('SNAPBACK_CLIENT_AUTHORITY_STALE', 'no durable predecessor custody exists');
      }
      current = validateAuthCustody(current, this.#appId);
      const successorKey = canonicalAuthorityKey(this.#appId, normalized.authority);
      if (current.phase === 'settled' && canonicalAuthorityKey(this.#appId, current.authority) === successorKey) {
        this.#adoptSettled(current);
        return captureFor(this.#appId, current);
      }
      if (current.phase === 'clearing') {
        if (canonicalAuthorityKey(this.#appId, current.pendingAuthority) !== successorKey) {
          throw coordinatorError('SNAPBACK_CLIENT_AUTHORITY_STALE', 'another authority transition is already clearing');
        }
        return this.#recoverOwned(owner, current, reason);
      }
      if (!captureMatches(this.#appId, current, expected)) {
        throw coordinatorError('SNAPBACK_CLIENT_AUTHORITY_STALE', 'authority changed before transition');
      }
      const nextEpoch = nextAuthorityEpoch(current.authorityEpoch);
      const clearing = await owner.replace(current.revision, {
        formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
        appId: this.#appId,
        authorityEpoch: nextEpoch,
        revision: nextRevision(current.revision),
        phase: 'clearing',
        authority: null,
        pendingAuthority: normalized.authority,
        bearer: null,
        pendingBearer: normalized.bearer,
        refreshAfterMs: normalized.refreshAfterMs,
      });
      return this.#finishClearingOwned(owner, clearing, {
        expectedEpoch: current.authorityEpoch,
        expectedAuthorityKey: canonicalAuthorityKey(this.#appId, current.authority),
        nextEpoch,
        nextAuthorityKey: successorKey,
        reason,
        disposition: 'delete',
        previousAuthority: clone(current.authority),
        nextAuthority: clone(normalized.authority),
      });
    });
  }

  registerParticipant(participant, { before = null } = {}) {
    this.#assertUsable();
    if (!participant || typeof participant !== 'object') throw new TypeError('participant must be an object');
    const entry = {
      participant,
      order: this.#participantSequence += 1,
      removed: false,
      active: Promise.resolve(),
    };
    const beforeIndex = before === null
      ? -1
      : this.#participants.findIndex((candidate) => candidate.participant === before);
    if (beforeIndex === -1) this.#participants.push(entry);
    else this.#participants.splice(beforeIndex, 0, entry);
    if (this.#publicationPaused) {
      // Registration while blank/clearing must not briefly expose predecessor
      // state. Synchronous phases run before registration returns; awaited
      // quiescence joins the active transition before its next phase.
      try {
        participantMethod(participant, 'blank', this.#barrierContext());
        participantMethod(participant, 'clearMemory', this.#barrierContext());
      } catch (error) {
        entry.registrationError = error;
      }
    }
    return async () => {
      entry.removed = true;
      await entry.active;
      this.#participants = this.#participants.filter((candidate) => candidate !== entry);
    };
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#publicationPaused = true;
    if (this.#broadcast) {
      this.#broadcast.onmessage = null;
      this.#broadcast.close?.();
    }
  }

  async #recoverOwned(owner, clearing, reason) {
    return this.#finishClearingOwned(owner, clearing, {
      expectedEpoch: clearing.authorityEpoch - 1,
      expectedAuthorityKey: null,
      nextEpoch: clearing.authorityEpoch,
      nextAuthorityKey: canonicalAuthorityKey(this.#appId, clearing.pendingAuthority),
      reason,
      disposition: 'delete',
      recovery: true,
      previousAuthority: null,
      nextAuthority: clone(clearing.pendingAuthority),
    });
  }

  async #finishClearingOwned(owner, clearing, context) {
    const validated = validateAuthCustody(clearing, this.#appId);
    this.#record = validated;
    this.#publicationPaused = true;
    this.#activeBarrier = { phase: 'clearing', context };
    this.#publish(validated);
    const barrier = Object.freeze({
      appId: this.#appId,
      expectedEpoch: context.expectedEpoch,
      expectedAuthorityKey: context.expectedAuthorityKey,
      nextEpoch: context.nextEpoch,
      nextAuthorityKey: context.nextAuthorityKey,
      reason: context.reason,
      disposition: context.disposition,
      recovery: context.recovery === true,
      previousAuthority: clone(context.previousAuthority),
      nextAuthority: clone(context.nextAuthority),
    });
    try {
      await this.#runAwaitedPhase('quiesce', barrier);
      this.#runSyncPhase('blank', barrier);
      this.#runSyncPhase('clearMemory', barrier);
      await this.#runAwaitedPhase('commitDurable', barrier);
      const settled = await owner.replace(validated.revision, {
        ...validated,
        revision: nextRevision(validated.revision),
        phase: 'settled',
        authority: validated.pendingAuthority,
        pendingAuthority: null,
        bearer: validated.pendingBearer,
        pendingBearer: null,
      });
      this.#adoptSettled(settled, { expose: false });
      this.#publish(settled);
      await this.#runAwaitedPhase('resume', Object.freeze({
        ...barrier,
        capture: captureFor(this.#appId, settled),
        authority: clone(settled.authority),
      }), { reverse: true });
      this.#publicationPaused = false;
      return captureFor(this.#appId, settled);
    } catch (error) {
      this.#publicationPaused = true;
      throw coordinatorError(
        'SNAPBACK_AUTH_TRANSITION_FAILED',
        'authority transition barrier did not settle',
        { phase: this.#activeBarrier?.phase ?? 'unknown', causeCode: error?.code ?? null },
      );
    } finally {
      this.#activeBarrier = null;
    }
  }

  async #adoptPeerOfflineSettled(record) {
    const previous = validateAuthCustody(this.#record, this.#appId);
    this.#publicationPaused = true;
    const context = Object.freeze({
      appId: this.#appId,
      expectedEpoch: previous.authorityEpoch,
      expectedAuthorityKey: canonicalAuthorityKey(this.#appId, previous.authority),
      nextEpoch: record.authorityEpoch,
      nextAuthorityKey: canonicalAuthorityKey(this.#appId, record.authority),
      reason: 'offline_durable_reload',
      disposition: 'delete',
      recovery: true,
      previousAuthority: clone(previous.authority),
      nextAuthority: clone(record.authority),
    });
    this.#activeBarrier = { phase: 'offline_durable_reload', context };
    try {
      await this.#runAwaitedPhase('quiesce', context);
      this.#runSyncPhase('blank', context);
      this.#runSyncPhase('clearMemory', context);
      await this.#runAwaitedPhase('commitDurable', context);
      this.#adoptSettled(record, { expose: false });
      // No participant resume runs here: a durable offline authority can
      // validate retained leases, but it cannot establish an online transport.
      this.#publicationPaused = false;
      return captureFor(this.#appId, record);
    } finally {
      this.#activeBarrier = null;
    }
  }

  async #failClosedOfflineExposure(reason) {
    this.#publicationPaused = true;
    if (this.#record === null) return;
    const context = Object.freeze({
      ...this.#barrierContext(),
      reason,
      disposition: 'delete',
    });
    this.#activeBarrier = { phase: reason, context };
    try {
      await this.#runAwaitedPhase('quiesce', context);
      this.#runSyncPhase('blank', context);
      this.#runSyncPhase('clearMemory', context);
    } finally {
      this.#activeBarrier = null;
    }
  }

  async #adoptPeerSettled(record) {
    const previous = this.#record;
    const authorityChanged = previous === null
      || previous.phase !== 'settled'
      || previous.authorityEpoch !== record.authorityEpoch
      || canonicalAuthorityKey(this.#appId, previous.authority) !== canonicalAuthorityKey(this.#appId, record.authority);
    if (!authorityChanged && !this.#publicationPaused) {
      this.#adoptSettled(record);
      return;
    }
    this.#publicationPaused = true;
    const context = Object.freeze({
      appId: this.#appId,
      expectedEpoch: previous?.authorityEpoch ?? Math.max(0, record.authorityEpoch - 1),
      expectedAuthorityKey: previous?.phase === 'settled'
        ? canonicalAuthorityKey(this.#appId, previous.authority)
        : null,
      nextEpoch: record.authorityEpoch,
      nextAuthorityKey: canonicalAuthorityKey(this.#appId, record.authority),
      reason: 'peer_transition',
      disposition: 'delete',
      recovery: true,
      previousAuthority: clone(previous?.authority ?? null),
      nextAuthority: clone(record.authority),
    });
    this.#activeBarrier = { phase: 'peer_transition', context };
    try {
      await this.#runAwaitedPhase('quiesce', context);
      this.#runSyncPhase('blank', context);
      this.#runSyncPhase('clearMemory', context);
      this.#adoptSettled(record, { expose: false });
      await this.#runAwaitedPhase('resume', Object.freeze({
        ...context,
        capture: captureFor(this.#appId, record),
        authority: clone(record.authority),
      }), { reverse: true });
      this.#publicationPaused = false;
    } finally {
      this.#activeBarrier = null;
    }
  }

  #runSyncPhase(method, context) {
    this.#activeBarrier.phase = method;
    for (const entry of this.#participants) {
      if (entry.removed) continue;
      if (entry.registrationError) throw entry.registrationError;
      const result = participantMethod(entry.participant, method, context);
      if (result && typeof result.then === 'function') {
        throw coordinatorError(
          'SNAPBACK_AUTH_PARTICIPANT_ASYNC_SYNC_PHASE',
          `participant ${entry.participant.name ?? entry.order} returned a promise from ${method}`,
        );
      }
    }
  }

  async #runAwaitedPhase(method, context, { reverse = false } = {}) {
    this.#activeBarrier.phase = method;
    const completed = new Set();
    for (;;) {
      const ordered = reverse ? [...this.#participants].reverse() : [...this.#participants];
      const entry = ordered
        .filter((candidate) => !candidate.removed && !completed.has(candidate))
        [0];
      if (!entry) break;
      completed.add(entry);
      if (entry.removed) continue;
      if (entry.registrationError) throw entry.registrationError;
      const call = Promise.resolve().then(() => participantMethod(entry.participant, method, context));
      entry.active = call.catch(() => {});
      await call;
    }
  }

  #adoptSettled(record, { expose = true } = {}) {
    const validated = validateAuthCustody(record, this.#appId);
    if (validated.phase !== 'settled') throw corrupt('attempted to adopt non-settled custody');
    if (this.#record) {
      if (validated.authorityEpoch < this.#record.authorityEpoch || validated.revision < this.#record.revision) {
        throw corrupt('durable custody regressed relative to this context');
      }
    }
    this.#record = validated;
    if (expose) this.#publicationPaused = false;
  }

  #publish(record) {
    const message = {
      formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
      appIdHash: this.#appIdHash,
      authorityEpoch: record.authorityEpoch,
      revision: record.revision,
      phase: record.phase,
    };
    try { this.#broadcast?.postMessage(message); } catch { /* wakeup loss is harmless */ }
    try {
      this.#hintStorage?.setItem?.(
        `snapback:auth-custody-hint:${this.#appIdHash}`,
        JSON.stringify({
          formatVersion: message.formatVersion,
          appId: this.#appId,
          authorityEpoch: message.authorityEpoch,
          revision: message.revision,
          phase: message.phase,
        }),
      );
    } catch {
      // The hint is deliberately non-authoritative.
    }
  }

  #receiveWakeup(message) {
    if (
      !message
      || !hasExactKeys(message, [
        'formatVersion',
        'appIdHash',
        'authorityEpoch',
        'revision',
        'phase',
      ])
      || message.formatVersion !== SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION
      || message.appIdHash !== this.#appIdHash
      || !Number.isSafeInteger(message.authorityEpoch)
      || message.authorityEpoch < 0
      || !Number.isSafeInteger(message.revision)
      || message.revision < 1
      || !PHASES.has(message.phase)
    ) return;
    if (this.#record && message.revision <= this.#record.revision) return;
    if (
      message.phase === 'clearing'
      || this.#record === null
      || message.authorityEpoch !== this.#record.authorityEpoch
    ) {
      // Stop new app-visible work synchronously; the durable reload is the
      // authority and runs asynchronously under cross-context ownership.
      this.#publicationPaused = true;
    }
    void this.synchronize().catch(() => { this.#publicationPaused = true; });
  }

  #barrierContext() {
    return Object.freeze({
      appId: this.#appId,
      expectedEpoch: this.#record ? Math.max(0, this.#record.authorityEpoch - 1) : 0,
      expectedAuthorityKey: null,
      nextEpoch: this.#record?.authorityEpoch ?? 0,
      nextAuthorityKey: this.#record?.phase === 'settled'
        ? canonicalAuthorityKey(this.#appId, this.#record.authority)
        : this.#record?.pendingAuthority
          ? canonicalAuthorityKey(this.#appId, this.#record.pendingAuthority)
          : null,
      reason: 'registration_while_blank',
      disposition: 'delete',
    });
  }

  #assertUsable() {
    if (this.#closed) throw coordinatorError('SNAPBACK_AUTH_COORDINATOR_CLOSED', 'auth coordinator is closed');
  }

  #assertOperationAllowed() {
    this.#assertUsable();
    if (this.#inCommit) {
      throw coordinatorError(
        'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
        'coordinator operations are forbidden inside compareAndCommit',
      );
    }
  }
}
