// Store-agnostic retained-query + offline-mutation state (LLP 0043 M1/M2).
//
// The adapter depends only on this async contract. Tests use the deterministic
// memory implementation; web can use the localStorage implementation. Native
// SQLite/OPFS implementations can preserve the same records without changing
// replay semantics (DK-9).

export const SNAPBACK_CLIENT_STORE_VERSION = 1;
export const MAX_OFFLINE_LEDGER_IDS = 1024;

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

export const stableJson = (value) => JSON.stringify(canonical(value));

export const retainedQueryKey = (name, args = {}) => `${name}:${stableJson(args)}`;

/** FNV-1a over the canonical AuthInput tuple; mirrors src/manifest.rs. */
export const snapbackAuthFingerprint = (authOrUserId = null) => {
  const auth = typeof authOrUserId === 'string' || authOrUserId === null
    // Mirrors demos/_kit/client.mjs SnapbackClient.auth(userId).
    ? { principal: authOrUserId, session_id: null, user_id: authOrUserId }
    : authOrUserId ?? {};
  let hash = 0xcbf29ce484222325n;
  const eat = (byte) => {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  };
  for (const value of [auth.principal, auth.session_id ?? auth.sessionId, auth.user_id ?? auth.userId]) {
    if (value === null || value === undefined) {
      eat(0);
    } else {
      eat(1);
      for (const byte of new TextEncoder().encode(String(value))) eat(byte);
    }
    eat(0xff);
  }
  return `fnv1a:${hash.toString(16).padStart(16, '0')}`;
};

const newOrigin = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
};

const freshState = () => ({
  version: SNAPBACK_CLIENT_STORE_VERSION,
  origin: newOrigin(),
  generation: 0,
  authFingerprint: null,
  artifactScope: null,
  nextSequence: 1,
  retained: {},
  pending: [],
  failed: [],
});

function clientStoreStateError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = {
    code,
    message,
    details,
  };
  return error;
}

function assertStateField(condition, field) {
  if (!condition) {
    throw clientStoreStateError(
      'SNAPBACK_CLIENT_STORE_CORRUPT',
      `persisted client-store field ${field} has an invalid shape`,
      { field },
    );
  }
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertMutationRecord(entry, path, expectedStatus) {
  assertStateField(isRecord(entry), path);
  assertStateField(typeof entry.id === 'string' && entry.id.length > 0, `${path}.id`);
  assertStateField(typeof entry.function === 'string' && entry.function.length > 0, `${path}.function`);
  assertStateField(
    Number.isSafeInteger(entry.sequence) && entry.sequence >= 1,
    `${path}.sequence`,
  );
  assertStateField(entry.status === expectedStatus, `${path}.status`);
  if (entry.cursor !== undefined && entry.cursor !== null) {
    assertStateField(isRecord(entry.cursor), `${path}.cursor`);
  }
  if (entry.ctxLedger !== undefined && entry.ctxLedger !== null) {
    assertStateField(isRecord(entry.ctxLedger), `${path}.ctxLedger`);
    assertStateField(
      Number.isSafeInteger(entry.ctxLedger.version) && entry.ctxLedger.version >= 1,
      `${path}.ctxLedger.version`,
    );
    assertStateField(
      Array.isArray(entry.ctxLedger.ids)
        && entry.ctxLedger.ids.every((id) => typeof id === 'string'),
      `${path}.ctxLedger.ids`,
    );
    assertStateField(
      Number.isSafeInteger(entry.ctxLedger.now) && entry.ctxLedger.now >= 0,
      `${path}.ctxLedger.now`,
    );
  }
}

const normalizeState = (state) => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw clientStoreStateError(
      'SNAPBACK_CLIENT_STORE_CORRUPT',
      'persisted client-store state is not an object',
    );
  }
  if (state.version !== SNAPBACK_CLIENT_STORE_VERSION) {
    const storedVersion = state.version ?? null;
    throw clientStoreStateError(
      'SNAPBACK_CLIENT_STORE_VERSION_UNSUPPORTED',
      `persisted client-store version ${JSON.stringify(storedVersion)} is not supported by version ${SNAPBACK_CLIENT_STORE_VERSION}`,
      {
        storedVersion,
        supportedVersion: SNAPBACK_CLIENT_STORE_VERSION,
        direction: typeof storedVersion === 'number'
          ? storedVersion > SNAPBACK_CLIENT_STORE_VERSION ? 'future' : 'legacy'
          : 'unknown',
      },
    );
  }
  // `generation` is the one additive field introduced after v1 shipped; an
  // absent value has an explicit migration. Every other field was present in
  // the original v1 shape, so defaulting it would turn truncated durable JSON
  // into empty success and let the next write destroy the only copy.
  if (!Object.hasOwn(state, 'generation')) state.generation = 0;
  assertStateField(typeof state.origin === 'string' && state.origin.length > 0, 'origin');
  assertStateField(Number.isSafeInteger(state.generation) && state.generation >= 0, 'generation');
  assertStateField(
    state.authFingerprint === null || typeof state.authFingerprint === 'string',
    'authFingerprint',
  );
  assertStateField(
    state.artifactScope === null
      || (typeof state.artifactScope === 'object' && !Array.isArray(state.artifactScope)),
    'artifactScope',
  );
  assertStateField(Number.isSafeInteger(state.nextSequence) && state.nextSequence >= 1, 'nextSequence');
  assertStateField(
    typeof state.retained === 'object' && state.retained !== null && !Array.isArray(state.retained),
    'retained',
  );
  assertStateField(Array.isArray(state.pending), 'pending');
  assertStateField(Array.isArray(state.failed), 'failed');
  Object.values(state.retained).forEach((record, index) => {
    // Query keys can contain canonicalized user arguments. Diagnostics name
    // only the structural position, never the potentially sensitive key.
    const path = `retained.${index}`;
    assertStateField(isRecord(record), path);
    assertStateField(Array.isArray(record.rows), `${path}.rows`);
    if (record.cursor !== undefined && record.cursor !== null) {
      assertStateField(isRecord(record.cursor), `${path}.cursor`);
    }
  });
  state.pending.forEach((entry, index) => {
    assertMutationRecord(entry, `pending.${index}`, 'pending');
  });
  state.failed.forEach((entry, index) => {
    assertMutationRecord(entry, `failed.${index}`, 'failed');
  });
  return state;
};

// @ref LLP 0012#versioning — retained versions are meaningful only inside
//   the full app/database/target stream identity; never compare a bare number.
const recordMatchesArtifacts = (record, expected = {}) => (
  (!expected.authFingerprint || record.authFingerprint === expected.authFingerprint)
  && (!expected.schemaHash || record.schemaHash === expected.schemaHash)
  && (!expected.inputsHash || record.inputsHash === expected.inputsHash)
  && (!expected.targetProfileId || record.targetProfileId === expected.targetProfileId)
  && (!expected.appId || record.appId === expected.appId)
  && (!expected.databaseId || record.databaseId === expected.databaseId)
  && (!expected.versionStreamId || record.versionStreamId === expected.versionStreamId)
  && (!expected.versionStreamId || record.cursor?.stream === expected.versionStreamId)
);

const recordMatchesCurrentScope = (state, record) => recordMatchesArtifacts(record, {
  authFingerprint: state.authFingerprint,
  ...(state.artifactScope ?? {}),
});

function staleStoreScopeError(operation) {
  const error = new Error(`${operation} belongs to a stale client-store auth/artifact stream scope`);
  error.code = 'SNAPBACK_CLIENT_STORE_SCOPE_STALE';
  return error;
}

function createStore({ read, write, withExclusive = (operation) => operation() }) {
  const load = () => normalizeState(read());
  const save = (state) => {
    state.generation += 1;
    write(state);
    return state;
  };
  const transact = (operation) => withExclusive(() => operation(load(), save));
  return {
    version: SNAPBACK_CLIENT_STORE_VERSION,

    async scopeToAuth(authFingerprint) {
      return transact((state, commit) => {
        if (state.authFingerprint !== null && state.authFingerprint !== authFingerprint) {
          // LLP 0043/0039: a user switch wipes retained rows and queued writes
          // before the new authority can observe or replay them.
          state.retained = {};
          state.pending = [];
          state.failed = [];
        }
        state.authFingerprint = authFingerprint;
        commit(state);
      });
    },

    async scopeToArtifacts({
      schemaHash = null,
      inputsHash = null,
      targetProfileId = null,
      appId = null,
      databaseId = null,
      versionStreamId = null,
    } = {}) {
      return transact((state, commit) => {
        const nextScope = {
          schemaHash,
          inputsHash,
          targetProfileId,
          appId,
          databaseId,
          versionStreamId,
        };
        const changed = state.artifactScope !== null
          && stableJson(state.artifactScope) !== stableJson(nextScope);
        const unknownLegacyState = state.artifactScope === null
          && (state.pending.length > 0 || Object.keys(state.retained).length > 0);
        if (changed || unknownLegacyState) {
          state.retained = {};
          // Failed records can contain the original args. An artifact boundary
          // is also a privacy boundary: discard old failures, then retain only
          // redacted tombstones for writes this transition quarantines.
          state.failed = [];
          for (const entry of state.pending) {
            state.failed.push({
              id: entry.id,
              function: entry.function,
              sequence: entry.sequence,
              authFingerprint: entry.authFingerprint,
              schemaHash: entry.schemaHash,
              inputsHash: entry.inputsHash,
              status: 'failed',
              diagnostic: {
                code: 'SNAPBACK_CLIENT_ARTIFACT_STALE',
                message: 'queued mutation belongs to another schema/artifact revision',
                previous: state.artifactScope,
                current: nextScope,
              },
            });
          }
          state.pending = [];
        }
        state.artifactScope = nextScope;
        commit(state);
      });
    },

    async getRetainedQuery(key, expected = {}) {
      return transact((state) => {
        const record = state.retained[key];
        if (!record || !recordMatchesArtifacts(record, expected)) return null;
        return clone({ ...record, stale: true });
      });
    },

    async putRetainedQuery(key, record) {
      return transact((state, commit) => {
        if (!recordMatchesCurrentScope(state, record)) {
          throw staleStoreScopeError('retained query write');
        }
        const current = state.retained[key];
        if (
          current
          && current.versionStreamId === record.versionStreamId
          && current.cursor?.stream === record.cursor?.stream
          && Number.isFinite(current.version)
          && Number.isFinite(record.version)
          && current.version > record.version
        ) {
          return clone(current);
        }
        state.retained[key] = clone({ ...record, stale: false });
        commit(state);
        return clone(state.retained[key]);
      });
    },

    async enqueueMutation(record) {
      return transact((state, commit) => {
        if (!recordMatchesCurrentScope(state, record)) {
          throw staleStoreScopeError('queued mutation write');
        }
        const sequence = Number.isSafeInteger(record.sequence)
          ? record.sequence
          : state.nextSequence;
        const id = record.id ?? `cm_${state.origin}_${sequence}`;
        const existing = state.pending.find((entry) => entry.id === id);
        if (existing) return clone(existing);
        state.nextSequence = Math.max(state.nextSequence, sequence + 1);
        const queued = clone({ ...record, id, sequence, status: 'pending' });
        state.pending.push(queued);
        state.pending.sort((left, right) => left.sequence - right.sequence);
        commit(state);
        return clone(queued);
      });
    },

    async pendingMutations({
      authFingerprint = null,
      schemaHash = null,
      inputsHash = null,
      targetProfileId = null,
      appId = null,
      databaseId = null,
      versionStreamId = null,
    } = {}) {
      return transact((state) => clone(state.pending
        .filter((entry) => recordMatchesArtifacts(entry, {
          authFingerprint,
          schemaHash,
          inputsHash,
          targetProfileId,
          appId,
          databaseId,
          versionStreamId,
        }))
        .sort((left, right) => left.sequence - right.sequence)));
    },

    async settleMutation(id, { status, output = null, diagnostic = null } = {}) {
      return transact((state, commit) => {
        const index = state.pending.findIndex((entry) => entry.id === id);
        if (index < 0) return null;
        const [entry] = state.pending.splice(index, 1);
        const settled = clone({ ...entry, status, output, diagnostic });
        if (status === 'failed') state.failed.push(settled);
        commit(state);
        return settled;
      });
    },

    async failedMutations() {
      return transact((state) => clone(state.failed));
    },

    async snapshot() {
      return transact((state) => clone(state));
    },

    async clear() {
      // Explicit reset is the sole operation allowed to replace bytes that
      // the current implementation cannot parse or migrate.
      return withExclusive(() => save(freshState()));
    },
  };
}

/**
 * Deterministic reference for tests. Pass the same `state` object to a new
 * store to model an app reload without sharing a live adapter instance.
 */
export function createMemorySnapbackClientStore({ state = freshState() } = {}) {
  if (
    state
    && typeof state === 'object'
    && !Array.isArray(state)
    && Object.keys(state).length === 0
  ) {
    Object.assign(state, freshState());
  }
  let current = normalizeState(state);
  return createStore({
    read: () => current,
    write: (next) => {
      current = next;
      // Preserve caller identity so a second store constructed with the same
      // state object observes commits (reload proof).
      if (state !== next) {
        for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, clone(next));
        current = state;
      }
    },
  });
}

/** Web implementation; callers may inject Storage/Web-Locks-compatible test doubles. */
export function createLocalStorageSnapbackClientStore({
  storage = globalThis.localStorage,
  key = 'snapback.client-store.v1',
  lockManager = globalThis.navigator?.locks,
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('createLocalStorageSnapbackClientStore requires a Storage-compatible object.');
  }
  if (!lockManager || typeof lockManager.request !== 'function') {
    throw clientStoreStateError(
      'SNAPBACK_CLIENT_STORE_LOCK_UNAVAILABLE',
      'the localStorage client store requires the Web Locks API for cross-context serialization',
      { key },
    );
  }
  const lockName = `snapback:client-store:${key}`;
  return createStore({
    read: () => {
      const raw = storage.getItem(key);
      if (raw === null) return freshState();
      try {
        return JSON.parse(raw);
      } catch {
        throw clientStoreStateError(
          'SNAPBACK_CLIENT_STORE_CORRUPT',
          'persisted client-store bytes are not valid JSON; original bytes were left untouched',
          { key, byteLength: new TextEncoder().encode(raw).length },
        );
      }
    },
    write: (state) => storage.setItem(key, JSON.stringify(state)),
    // @ref LLP 0008#local-store — all web durable-store access is serialized
    //   through a same-origin correctness mutex; Web Locks release on context
    //   loss, so another tab can take over without a timing-based lease.
    withExclusive: (operation) => lockManager.request(
      lockName,
      { mode: 'exclusive' },
      operation,
    ),
  });
}

export function createClientMutationId(prefix = 'cm') {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? newOrigin();
  return `${prefix}_${random}`;
}
