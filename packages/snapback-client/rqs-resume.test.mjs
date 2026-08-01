// Channel B relaunch/resume acceptance — web/IndexedDB arm (LLP 0090 rollout
// step 5, ENG-25456): the step-5 acceptance list from rqs-resume-suite.mjs
// driven against the real IndexedDB store under a Web-Lock double, plus the
// store-independent witness unit. The native/DK-9 file arm runs the same
// suite in rqs-resume-native.test.mjs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import {
  base64UrlNoPad,
  digestOfRows,
  membershipWitnessOfRows,
  rowHash,
} from './rqs.mjs';
import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';
import { defineChannelBResumeSuite, tick } from './rqs-resume-suite.mjs';

// --- Web Locks double (queued exclusive, AbortSignal-aware) -----------------

function createLockManagerDouble() {
  const states = new Map();
  const stateFor = (name) => {
    let state = states.get(name);
    if (!state) {
      state = { held: false, queue: [] };
      states.set(name, state);
    }
    return state;
  };
  const pump = (name) => {
    const state = stateFor(name);
    if (state.held) return;
    while (state.queue.length > 0) {
      const next = state.queue.shift();
      if (next.aborted) continue;
      state.held = true;
      Promise.resolve()
        .then(() => next.callback({ name, mode: 'exclusive' }))
        .then(next.resolve, next.reject)
        .finally(() => {
          state.held = false;
          pump(name);
        });
      return;
    }
  };
  return {
    request(name, options, callback) {
      const state = stateFor(name);
      return new Promise((resolve, reject) => {
        const entry = { callback, resolve, reject, aborted: false };
        const signal = options?.signal;
        if (signal) {
          if (signal.aborted) {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            return;
          }
          signal.addEventListener('abort', () => {
            entry.aborted = true;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }
        state.queue.push(entry);
        pump(name);
      });
    },
  };
}

// One context = one same-origin browser profile: stores share one IndexedDB
// and one Web-Lock domain; a fresh store over them models a tab relaunch.
defineChannelBResumeSuite({
  arm: 'web/indexeddb',
  createContext: async () => {
    const indexedDB = new IDBFactory();
    const lockManager = createLockManagerDouble();
    return {
      async makeStore({ relaunchOutboxEmpty = null } = {}) {
        const store = createIndexedDbRqsResumeStore({ indexedDB, lockManager, relaunchOutboxEmpty });
        await tick();
        return store;
      },
      async settleOwnership() {
        // The closed holder's Web Lock grants to the queued reader.
        await tick();
      },
    };
  },
});

// --- store-independent unit -------------------------------------------------

test('membershipWitnessOfRows is exact, sorted, capped, and fail-closed (unit)', () => {
  const rows = [{ _id: 'b', v: 2 }, { _id: 'a', v: 1 }];
  const digest = digestOfRows('mset1', rows);
  const witness = membershipWitnessOfRows(rows, digest);
  assert.equal(witness.count, 2);
  assert.deepEqual(witness.entries.map((entry) => entry.id), ['a', 'b'], 'ascending UTF-16 id order');
  assert.deepEqual(
    witness.entries.map((entry) => entry.oldRowHash),
    [base64UrlNoPad(rowHash(rows[1])), base64UrlNoPad(rowHash(rows[0]))],
    'exact (rowId, oldRowHash) pairs',
  );
  // seq1 results are never witnessable.
  assert.equal(membershipWitnessOfRows(rows, digestOfRows('seq1', rows)), null);
  // Over the entry cap: not sent (the server would refuse it to rung 3).
  assert.equal(membershipWitnessOfRows(rows, digest, { maxEntries: 1 }), null);
  // Held rows that no longer reproduce the digest are never witnessed.
  assert.equal(membershipWitnessOfRows([rows[0]], digest), null);
  // Mint-refusable rows (missing id) fail closed to null.
  assert.equal(membershipWitnessOfRows([{ v: 1 }], digestOfRows('mset1', [])), null);
});

// --- interim Node-carrier receipt (LLP 0129 super-refine round-1 gap;
// --- issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md third half):
// --- the auth-scoped retention refusal SNAPBACK_RETENTION_NOT_RETAINABLE —
// --- the refusal LLP 0053's retainability invariant actually governs — was
// --- produced in index.mjs and asserted by no test on any carrier. This
// --- pins it on the Node carrier: an auth-scoped subscription names WHY it
// --- will never render cold, and nothing persists.
test('an auth-scoped subscription refuses retention with SNAPBACK_RETENTION_NOT_RETAINABLE and persists nothing', async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const { SnapbackClient } = await import('./index.mjs');
  const { createMemoryRqsResumeStore } = await import('./rqs-store-memory.mjs');
  const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
  const issuerId = {
    authorizationIncarnation: INCARNATION,
    bootSequence: 7,
    bootNonce: 'ABCDEFGHIJKLMNOPQRSTUV',
  };
  const authorization = { incarnation: INCARNATION, epoch: 4 };
  const handshake = {
    protocolVersion: 1,
    serverStartupNonce: 'startup-retention-refusal',
    authorizationStreamIncarnation: INCARNATION,
    transitionGeneration: 1,
    activeMode: 'sessions',
    desiredMode: 'sessions',
    modeState: 'settled',
    appDataAvailability: 'available',
    quarantineCode: null,
    clientProtocols: {
      authClient: 1,
      authInvalidation: 1,
      authorityDescriptor: null,
      authorizedLease: null,
    },
    availability: {
      onlineRequestResponse: { available: true, reason: null },
      authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
      retainedReads: {
        available: false,
        minimumAuthInvalidationProtocol: 1,
        minimumAuthorizedLeaseProtocol: 1,
        reason: null,
      },
      queuedReplay: {
        available: false,
        minimumAuthorityDescriptorProtocol: 1,
        reason: null,
      },
    },
    provider: { key: 'email-code', available: true },
    transports: ['bearer'],
    authority: { userId: 'user_ret', sessionId: 'session_ret', isAuthenticated: true },
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: INCARNATION,
      sessionGeneration: 1,
    },
    authorizedLease: null,
  };
  const witnessData = { versionStream: 'stream-ret', minCommitVersion: 3 };
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return Response.json(handshake);
    if (path === '/connection/open') {
      return Response.json({
        connectionId: 'granted-retention-refusal',
        connectionToken: 'sct_retention_refusal',
        wireVersion: 'snapback.v1',
        authorizationInvalidation: {
          protocolVersion: 1,
          issuerId,
          connectionGeneration: 2,
          authorization,
          versionStream: 'stream-ret',
        },
      });
    }
    if (path === '/live/secrets/subscribe') {
      const body = JSON.parse(init.body);
      const scopeId = {
        kind: 'subscription',
        issuerId,
        namespace: body.authorizationNamespace,
        scopeSequence: 1,
        connectionGeneration: 2,
        subscriptionId: 'sub_retention_refusal',
      };
      const obligation = {
        protocolVersion: 1,
        scopeId,
        revision: 1,
        maxDisposition: 'quarantine',
        witness: { authorization, data: witnessData },
        retryEpisodeId: null,
        ownerContinuityId: 'owner_retention_refusal',
      };
      return Response.json({
        subscription_id: 'sub_retention_refusal',
        snapshot: { version: 3, rows: [{ _id: 'secret-1', owner: 'user_ret' }] },
        permission_epochs: {},
        authorizationScope: scopeId,
        authorizationInvalidation: {
          obligation,
          resolution: {
            protocolVersion: 1,
            kind: 'snapshot',
            scopeId,
            revision: 1,
            witness: obligation.witness,
            maxDisposition: 'quarantine',
            ackToken: 'ack_retention_1',
            ownerContinuityId: 'owner_retention_refusal',
          },
        },
      });
    }
    if (path === '/live/authorization-invalidation/acknowledge') {
      return Response.json({ outcome: 'discharged' });
    }
    if (path === '/live/secrets/unsubscribe') {
      const body = JSON.parse(init.body);
      return Response.json({ subscription_id: body.subscription_id, disposed: true });
    }
    throw new Error(`unexpected retention-refusal request: ${path}`);
  };
  const store = createMemoryRqsResumeStore();
  const client = new SnapbackClient('http://retention-refusal.test', {
    bearerToken: 'session-retention-refusal',
    authInvalidationProtocol: 1,
    clientStoreId: 'store_retention_refusal',
    rqsStore: store,
  });
  const handle = await client.liveQuery('secrets', {
    connectionId: 'c-ret',
    transport: 'poll',
    pollCadenceMs: 60_000,
  });
  assert.deepEqual(handle.rows, [{ _id: 'secret-1', owner: 'user_ret' }]);
  assert.equal(handle.retention?.retainable, false, 'auth-scoped rows are never retainable on this arm');
  assert.equal(
    handle.retention?.code,
    'SNAPBACK_RETENTION_NOT_RETAINABLE',
    'the refusal names the LLP 0053 retainability invariant, not a generic ineligibility',
  );
  assert.match(
    String(handle.retention?.reason ?? ''),
    /lease/iu,
    'the refusal names the missing lease machinery',
  );
  await handle.flushResumeState();
  assert.equal((await store.inspection()).entries, 0, 'nothing persisted for the auth-scoped subscription');
  handle.dispose();
});
