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
  authFingerprint: null,
  artifactScope: null,
  nextSequence: 1,
  retained: {},
  pending: [],
  failed: [],
});

const normalizeState = (state) => {
  if (!state || state.version !== SNAPBACK_CLIENT_STORE_VERSION) return freshState();
  state.origin ||= newOrigin();
  state.authFingerprint ??= null;
  state.artifactScope ??= null;
  state.nextSequence ||= 1;
  state.retained ||= {};
  state.pending ||= [];
  state.failed ||= [];
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

function createStore({ read, write }) {
  const load = () => normalizeState(read());
  const save = (state) => {
    write(state);
    return state;
  };
  return {
    version: SNAPBACK_CLIENT_STORE_VERSION,

    async scopeToAuth(authFingerprint) {
      const state = load();
      if (state.authFingerprint !== null && state.authFingerprint !== authFingerprint) {
        // LLP 0043/0039: a user switch wipes retained rows and queued writes
        // before the new authority can observe or replay them.
        state.retained = {};
        state.pending = [];
        state.failed = [];
      }
      state.authFingerprint = authFingerprint;
      save(state);
    },

    async scopeToArtifacts({
      schemaHash = null,
      inputsHash = null,
      targetProfileId = null,
      appId = null,
      databaseId = null,
      versionStreamId = null,
    } = {}) {
      const state = load();
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
      const unknownLegacyQueue = state.artifactScope === null && state.pending.length > 0;
      if (changed || unknownLegacyQueue) {
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
      save(state);
    },

    async getRetainedQuery(key, expected = {}) {
      const state = load();
      const record = state.retained[key];
      if (!record || !recordMatchesArtifacts(record, expected)) return null;
      return clone({ ...record, stale: true });
    },

    async putRetainedQuery(key, record) {
      const state = load();
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
      save(state);
      return clone(state.retained[key]);
    },

    async enqueueMutation(record) {
      const state = load();
      const sequence = Number.isSafeInteger(record.sequence)
        ? record.sequence
        : state.nextSequence++;
      const id = record.id ?? `cm_${state.origin}_${sequence}`;
      const existing = state.pending.find((entry) => entry.id === id);
      if (existing) return clone(existing);
      const queued = clone({ ...record, id, sequence, status: 'pending' });
      state.pending.push(queued);
      state.pending.sort((left, right) => left.sequence - right.sequence);
      save(state);
      return clone(queued);
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
      const state = load();
      return clone(state.pending
        .filter((entry) => recordMatchesArtifacts(entry, {
          authFingerprint,
          schemaHash,
          inputsHash,
          targetProfileId,
          appId,
          databaseId,
          versionStreamId,
        }))
        .sort((left, right) => left.sequence - right.sequence));
    },

    async settleMutation(id, { status, output = null, diagnostic = null } = {}) {
      const state = load();
      const index = state.pending.findIndex((entry) => entry.id === id);
      if (index < 0) return null;
      const [entry] = state.pending.splice(index, 1);
      const settled = clone({ ...entry, status, output, diagnostic });
      if (status === 'failed') state.failed.push(settled);
      save(state);
      return settled;
    },

    async failedMutations() {
      return clone(load().failed);
    },

    async snapshot() {
      return clone(load());
    },

    async clear() {
      save(freshState());
    },
  };
}

/**
 * Deterministic reference for tests. Pass the same `state` object to a new
 * store to model an app reload without sharing a live adapter instance.
 */
export function createMemorySnapbackClientStore({ state = freshState() } = {}) {
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

/** Small web implementation; callers may inject a Storage-compatible object. */
export function createLocalStorageSnapbackClientStore({
  storage = globalThis.localStorage,
  key = 'snapback.client-store.v1',
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('createLocalStorageSnapbackClientStore requires a Storage-compatible object.');
  }
  return createStore({
    read: () => {
      const raw = storage.getItem(key);
      if (!raw) return freshState();
      try {
        return JSON.parse(raw);
      } catch {
        return freshState();
      }
    },
    write: (state) => storage.setItem(key, JSON.stringify(state)),
  });
}

export function createClientMutationId(prefix = 'cm') {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? newOrigin();
  return `${prefix}_${random}`;
}
