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
import {
  beginProtectedQueryLease,
  commitProtectedQueryLease,
  prepareProtectedQueryRetention,
  seedProtectedQueryRetention,
} from './protected-query-retention.mjs';
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
  assert.equal(
    handle.retention?.retainable,
    false,
    'auth-scoped rows without the lease protocol are not retainable',
  );
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

test('authorized-lease offer degrades per query across the retainability matrix', async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const { SnapbackClient } = await import('./index.mjs');
  const identity = {
    schemaVersion: 'snapback.v1',
    appId: 'lease-offer-matrix',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  };
  const incarnation = '018f0d90-7b11-7a22-8c33-4455667788aa';
  const principalId = '018f0d90-7b12-7a22-8c33-4455667788aa';
  const sessionId = '018f0d90-7b13-7a22-8c33-4455667788aa';
  const authorityInstanceId = '018f0d90-7b14-7a22-8c33-4455667788aa';
  const issuerId = {
    authorizationIncarnation: incarnation,
    bootSequence: 3,
    bootNonce: 'CCCCCCCCCCCCCCCCCCCCCC',
  };
  const authorization = { incarnation, epoch: 6 };

  for (const leaseOffered of [false, true]) {
    for (const retainable of [false, true]) {
      await t.test(`lease=${leaseOffered ? 'offered' : 'absent'} query=${retainable ? 'retainable' : 'non-retainable'}`, async () => {
        const suffix = `${leaseOffered ? 'offer' : 'absent'}-${retainable ? 'retained' : 'volatile'}`;
        const queryName = retainable ? 'retainedRows' : 'ordinaryRows';
        const ref = Object.freeze({
          artifactKind: 'functionReference',
          schemaVersion: 'snapback.v0',
          appId: identity.appId,
          id: `${identity.appId}:${queryName}`,
          name: queryName,
          kind: 'LiveQuery',
          ...(retainable ? { retention: 'opaque-authorized-snapshot-v1' } : {}),
          implementationHash: `sha256:${'d'.repeat(64)}`,
          argsContractHash: `sha256:${'e'.repeat(64)}`,
          resultContractHash: `sha256:${'f'.repeat(64)}`,
          expectedGeneration: identity,
          argumentSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
          },
        });
        const rows = [{ _id: `row-${suffix}`, value: suffix }];
        const indexedDB = new IDBFactory();
        const lockManager = createLockManagerDouble();
        const store = createIndexedDbRqsResumeStore({ indexedDB, lockManager });
        await tick();
        const leaseRequests = [];
        const leaseRefusals = [];
        const handshake = {
          protocolVersion: 1,
          serverStartupNonce: `startup-${suffix}`,
          authorizationStreamIncarnation: incarnation,
          transitionGeneration: 1,
          activeMode: 'sessions',
          desiredMode: 'sessions',
          modeState: 'settled',
          appDataAvailability: 'available',
          quarantineCode: null,
          clientProtocols: {
            authClient: 1,
            authInvalidation: 1,
            authorityDescriptor: 1,
            authorizedLease: leaseOffered ? 1 : null,
          },
          availability: {
            onlineRequestResponse: { available: true, reason: null },
            authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
            retainedReads: {
              available: leaseOffered,
              minimumAuthInvalidationProtocol: 1,
              minimumAuthorizedLeaseProtocol: 1,
              reason: leaseOffered ? null : 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
            },
            queuedReplay: {
              available: true,
              minimumAuthorityDescriptorProtocol: 1,
              reason: null,
            },
          },
          provider: { key: 'email-code', available: true },
          transports: ['bearer'],
          authority: {
            kind: 'humanSession',
            userId: principalId,
            sessionId,
            isAuthenticated: true,
          },
          authorityDescriptor: {
            descriptorVersion: 1,
            authorityInstanceId,
            sessionGeneration: 1,
          },
          deploymentIdentity: { ...identity, authMode: 'sessions' },
          authorizedLease: leaseOffered ? {
            protocolVersion: 1,
            defaultMs: 86_400_000,
            hardMaxMs: 86_400_000,
            configuredMs: 60_000,
            clamps: ['session', 'provider'],
            renewal: 'full-revalidation',
            timeBasis: 'server-absolute+client-request-elapsed',
            clockRollback: 'delete-before-read',
          } : null,
        };
        let subscribedNamespace = null;
        globalThis.fetch = async (url, init = {}) => {
          const path = new URL(url).pathname;
          if (path === '/auth/session') return Response.json(handshake);
          if (path === '/connection/open') {
            return Response.json({
              connectionId: `connection-${suffix}`,
              connectionToken: `sct_${suffix}`,
              wireVersion: 'snapback.v1',
              authorizationInvalidation: {
                protocolVersion: 1,
                issuerId,
                connectionGeneration: 1,
                authorization,
                versionStream: 'lease-offer-matrix-stream',
              },
            });
          }
          if (path === `/live/${queryName}/subscribe`) {
            const body = JSON.parse(init.body);
            subscribedNamespace = body.authorizationNamespace;
            return Response.json({
              subscription_id: `sub-${suffix}`,
              snapshot: { version: 13, rows },
              permission_epochs: {},
              authorizationScope: {
                kind: 'subscription',
                issuerId,
                namespace: subscribedNamespace,
                scopeSequence: 1,
                connectionGeneration: 1,
                subscriptionId: `sub-${suffix}`,
              },
            });
          }
          if (path === `/query/${queryName}/authorized-lease`) {
            leaseRequests.push(path);
            if (!retainable) {
              const code = 'SNAPBACK_AUTHORIZED_LEASE_QUERY_NOT_RETAINABLE';
              leaseRefusals.push({ path, code });
              return Response.json({
                diagnostic: {
                  code,
                  message: 'authorized leases require a declared userId-only retainable query',
                },
              }, { status: 400 });
            }
            const body = JSON.parse(init.body);
            return Response.json({
              version: 13,
              rows,
              authorizedLease: {
                protocolVersion: 1,
                leaseId: `lease-${suffix}`,
                leaseRequestId: body.leaseRequestId,
                issuerId,
                clientStoreId: body.clientStoreId,
                queryKey: body.queryKey,
                queryInstanceId: body.queryInstanceId,
                principalId,
                sessionIdAtIssue: sessionId,
                providerKey: 'email-code',
                authorization,
                data: {
                  versionStream: 'lease-offer-matrix-stream',
                  snapshotCommitVersion: 13,
                },
                activationHash: (await import('@expo/snapback-contract/authorized-lease'))
                  .authorizedLeaseActivationHash({ ...identity, authMode: 'sessions' }),
                issuedAtServerMs: Date.now(),
                authorizedUntilServerMs: Date.now() + 60_000,
                sessionNotAfterMs: Date.now() + 60_000,
                providerNotAfterMs: null,
                authorityInstanceId,
                keyId: 'lease-key-matrix',
                mac: 'A'.repeat(43),
              },
            });
          }
          if (path === `/live/${queryName}/unsubscribe`) {
            return Response.json({ subscription_id: `sub-${suffix}`, disposed: true });
          }
          throw new Error(`unexpected lease-offer matrix request: ${path}`);
        };

        const client = new SnapbackClient('http://lease-offer-matrix.test', {
          bearerToken: `bearer-${suffix}`,
          authClientProtocol: 1,
          authInvalidationProtocol: 1,
          authorizedLeaseProtocol: leaseOffered ? 1 : null,
          clientStoreId: `store-${suffix}`,
          rqsStore: store,
          offlineQueue: false,
        });
        let handle = null;
        try {
          handle = await client.liveQuery(ref, {
            connectionId: `connection-${suffix}`,
          });
          assert.deepEqual(handle.rows, rows, 'ordinary online rows remain usable');
          assert.equal(
            handle.retention?.retainable,
            leaseOffered && retainable,
            'only an offered lease for a retainable query installs protected custody',
          );
          assert.deepEqual(
            leaseRefusals,
            [],
            'no ordinary query reaches the backend refusal path merely because leases were offered',
          );
          assert.deepEqual(
            leaseRequests,
            leaseOffered && retainable ? [`/query/${queryName}/authorized-lease`] : [],
            'a session-level offer never promotes a non-retainable query into lease admission',
          );
        } finally {
          handle?.dispose();
          if (handle) await handle.settled();
          await store.close();
        }
      });
    }
  }
});

// LLP 0043 M1 / LLP 0053 item 8 cold-carrier matrix. These are deliberately
// not RQS-token tests: the same IndexedDB carrier holds a separate format-6-
// disciplined query authorization + AuthorizedLease record, and a fresh store
// instance models the next JS process/tab accepting those bytes.
test('protected query custody renders only inside its lease and deletes before expiry/mismatch exposure', async () => {
  const identity = {
    schemaVersion: 'snapback.v1',
    appId: 'protected-retention-test',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
  };
  const ref = Object.freeze({
    artifactKind: 'functionReference',
    kind: 'LiveQuery',
    name: 'protectedRows',
    expectedGeneration: identity,
  });
  const args = { boardId: 'board-1' };
  const incarnation = '018f0d90-7b11-7a22-8c33-445566778899';
  const principalId = '018f0d90-7b12-7a22-8c33-445566778899';
  const sessionId = '018f0d90-7b13-7a22-8c33-445566778899';
  const authorityInstanceId = '018f0d90-7b14-7a22-8c33-445566778899';
  const issuerId = {
    authorizationIncarnation: incarnation,
    bootSequence: 1,
    bootNonce: 'AAAAAAAAAAAAAAAAAAAAAA',
  };
  const authorization = { incarnation, epoch: 4 };
  const rows = [{ _id: 'private-1', value: 'lease-bound' }];

  const makeCommittedContext = async () => {
    const indexedDB = new IDBFactory();
    const lockManager = createLockManagerDouble();
    const owner = createIndexedDbRqsResumeStore({ indexedDB, lockManager });
    await tick();
    const prepared = await prepareProtectedQueryRetention({
      ref,
      args,
      name: ref.name,
      storeHandle: owner,
    });
    const startedClientMs = 1_000;
    const leaseRequestId = 'lease-request-protected-1';
    const reserved = await beginProtectedQueryLease({
      prepared,
      storeHandle: owner,
      leaseRequestId,
      clientNowMs: startedClientMs,
      principalId,
      issuerId,
      authorization,
      versionStream: 'protected-stream-1',
      authorityInstanceId,
    });
    assert.equal(reserved.retained, true, 'lease timer is durably reserved');
    const committed = await commitProtectedQueryLease({
      prepared,
      storeHandle: owner,
      rows,
      version: 9,
      clientNowMs: startedClientMs + 1,
      lease: {
        protocolVersion: 1,
        leaseId: 'lease-protected-1',
        leaseRequestId,
        issuerId,
        clientStoreId: prepared.namespace.clientStoreId,
        queryKey: prepared.queryKey,
        queryInstanceId: prepared.namespace.queryInstanceId,
        principalId,
        sessionIdAtIssue: sessionId,
        providerKey: 'email-code',
        authorization,
        data: { versionStream: 'protected-stream-1', snapshotCommitVersion: 9 },
        activationHash: prepared.activationHash,
        issuedAtServerMs: 10_000,
        authorizedUntilServerMs: 70_000,
        sessionNotAfterMs: 70_000,
        providerNotAfterMs: null,
        authorityInstanceId,
        keyId: 'lease-key-1',
        mac: 'A'.repeat(43),
      },
    });
    assert.equal(
      committed.retained,
      true,
      `lease and protected rows commit together (${committed.reason ?? 'no refusal reason'})`,
    );
    await owner.close();
    await tick();
    const cold = createIndexedDbRqsResumeStore({ indexedDB, lockManager });
    await tick();
    const coldPrepared = await prepareProtectedQueryRetention({
      ref,
      args,
      name: ref.name,
      storeHandle: cold,
    });
    return { cold, prepared: coldPrepared, clientDeadlineMs: committed.clientDeadlineMs };
  };

  {
    const { cold, prepared, clientDeadlineMs } = await makeCommittedContext();
    try {
      const valid = await seedProtectedQueryRetention({
        prepared,
        storeHandle: cold,
        clientNowMs: clientDeadlineMs - 1,
      });
      assert.equal(valid.retained, true, 'lease-valid cold bytes are accepted');
      assert.deepEqual(valid.rows, rows, 'lease-valid rows cross the cold boundary');
      const equality = await seedProtectedQueryRetention({
        prepared,
        storeHandle: cold,
        clientNowMs: clientDeadlineMs,
      });
      assert.equal(equality.retained, false, 'deadline equality is expired');
      const afterExpiry = await cold.materializationTransaction('readonly', (view) => (
        view.storeMeta.authorizedQueryRetention[prepared.queryKey] ?? null
      ));
      assert.equal(afterExpiry, null, 'expiry deletes custody and rows before returning');
    } finally {
      await cold.close();
    }
  }

  {
    const { cold, prepared } = await makeCommittedContext();
    try {
      await cold.materializationTransaction('readwrite', (view) => {
        view.storeMeta.authorizedQueryRetention[prepared.queryKey]
          .retained.authorizedLeaseHash = 'sha256:tampered';
      });
      const mismatch = await seedProtectedQueryRetention({
        prepared,
        storeHandle: cold,
        clientNowMs: 1_002,
      });
      assert.equal(mismatch.retained, false, 'composite custody mismatch never renders');
      const afterMismatch = await cold.materializationTransaction('readonly', (view) => (
        view.storeMeta.authorizedQueryRetention[prepared.queryKey] ?? null
      ));
      assert.equal(afterMismatch, null, 'mismatch deletes custody and rows before returning');
    } finally {
      await cold.close();
    }
  }
});

test('SnapbackClient projects a lease-valid protected record on a cold offline handle', async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const { SnapbackClient } = await import('./index.mjs');
  const indexedDB = new IDBFactory();
  const lockManager = createLockManagerDouble();
  const identity = {
    schemaVersion: 'snapback.v1',
    appId: 'protected-live-client',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'4'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'5'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'6'.repeat(64)}`,
  };
  const ref = Object.freeze({
    artifactKind: 'functionReference',
    schemaVersion: 'snapback.v0',
    appId: identity.appId,
    id: `${identity.appId}:protectedRows`,
    name: 'protectedRows',
    kind: 'LiveQuery',
    implementationHash: `sha256:${'7'.repeat(64)}`,
    argsContractHash: `sha256:${'8'.repeat(64)}`,
    resultContractHash: `sha256:${'9'.repeat(64)}`,
    expectedGeneration: identity,
    retention: 'opaque-authorized-snapshot-v1',
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { boardId: { type: 'string' } },
      required: ['boardId'],
    },
  });
  const args = { boardId: 'board-1' };
  const incarnation = '018f0d90-7b21-7a22-8c33-445566778899';
  const principalId = '018f0d90-7b22-7a22-8c33-445566778899';
  const sessionId = '018f0d90-7b23-7a22-8c33-445566778899';
  const authorityInstanceId = '018f0d90-7b24-7a22-8c33-445566778899';
  const issuerId = {
    authorizationIncarnation: incarnation,
    bootSequence: 2,
    bootNonce: 'BBBBBBBBBBBBBBBBBBBBBB',
  };
  const authorization = { incarnation, epoch: 5 };
  const rows = [{ _id: 'private-live-1', value: 'cold-render' }];
  const handshake = {
    protocolVersion: 1,
    serverStartupNonce: 'startup-protected-live-client',
    authorizationStreamIncarnation: incarnation,
    transitionGeneration: 1,
    activeMode: 'sessions',
    desiredMode: 'sessions',
    modeState: 'settled',
    appDataAvailability: 'available',
    quarantineCode: null,
    clientProtocols: {
      authClient: 1,
      authInvalidation: 1,
      authorityDescriptor: 1,
      authorizedLease: 1,
    },
    availability: {
      onlineRequestResponse: { available: true, reason: null },
      authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
      retainedReads: {
        available: true,
        minimumAuthInvalidationProtocol: 1,
        minimumAuthorizedLeaseProtocol: 1,
        reason: null,
      },
      queuedReplay: {
        available: true,
        minimumAuthorityDescriptorProtocol: 1,
        reason: null,
      },
    },
    provider: { key: 'email-code', available: true },
    transports: ['bearer'],
    authority: {
      kind: 'humanSession',
      userId: principalId,
      sessionId,
      isAuthenticated: true,
    },
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId,
      sessionGeneration: 1,
    },
    deploymentIdentity: { ...identity, authMode: 'sessions' },
    authorizedLease: {
      protocolVersion: 1,
      defaultMs: 86_400_000,
      hardMaxMs: 86_400_000,
      configuredMs: 60_000,
      clamps: ['session', 'provider'],
      renewal: 'full-revalidation',
      timeBasis: 'server-absolute+client-request-elapsed',
      clockRollback: 'delete-before-read',
    },
  };
  let subscribedNamespace = null;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return Response.json(handshake);
    if (path === '/connection/open') {
      return Response.json({
        connectionId: 'protected-live-connection',
        connectionToken: 'sct_protected_live',
        wireVersion: 'snapback.v1',
        authorizationInvalidation: {
          protocolVersion: 1,
          issuerId,
          connectionGeneration: 1,
          authorization,
          versionStream: 'protected-live-stream',
        },
      });
    }
    if (path === '/live/protectedRows/subscribe') {
      const body = JSON.parse(init.body);
      subscribedNamespace = body.authorizationNamespace;
      return Response.json({
        subscription_id: 'sub_protected_live',
        snapshot: { version: 12, rows },
        permission_epochs: {},
        authorizationScope: {
          kind: 'subscription',
          issuerId,
          namespace: subscribedNamespace,
          scopeSequence: 1,
          connectionGeneration: 1,
          subscriptionId: 'sub_protected_live',
        },
      });
    }
    if (path === '/query/protectedRows/authorized-lease') {
      const body = JSON.parse(init.body);
      assert.deepEqual(
        {
          clientStoreId: body.clientStoreId,
          queryKey: body.queryKey,
          queryInstanceId: body.queryInstanceId,
        },
        subscribedNamespace,
        'lease request reuses the exact live query namespace',
      );
      return Response.json({
        version: 12,
        rows,
        authorizedLease: {
          protocolVersion: 1,
          leaseId: 'lease-protected-live',
          leaseRequestId: body.leaseRequestId,
          issuerId,
          clientStoreId: body.clientStoreId,
          queryKey: body.queryKey,
          queryInstanceId: body.queryInstanceId,
          principalId,
          sessionIdAtIssue: sessionId,
          providerKey: 'email-code',
          authorization,
          data: { versionStream: 'protected-live-stream', snapshotCommitVersion: 12 },
          activationHash: (await import('@expo/snapback-contract/authorized-lease'))
            .authorizedLeaseActivationHash({ ...identity, authMode: 'sessions' }),
          issuedAtServerMs: Date.now(),
          authorizedUntilServerMs: Date.now() + 60_000,
          sessionNotAfterMs: Date.now() + 60_000,
          providerNotAfterMs: null,
          authorityInstanceId,
          keyId: 'lease-key-live',
          mac: 'A'.repeat(43),
        },
      });
    }
    if (path === '/live/protectedRows/unsubscribe') {
      return Response.json({ subscription_id: 'sub_protected_live', disposed: true });
    }
    throw new Error(`unexpected protected-live request: ${path}`);
  };

  const ownerStore = createIndexedDbRqsResumeStore({ indexedDB, lockManager });
  await tick();
  const online = new SnapbackClient('http://protected-live.test', {
    bearerToken: 'protected-live-bearer',
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorizedLeaseProtocol: 1,
    rqsStore: ownerStore,
    offlineQueue: false,
  });
  const onlineHandle = await online.liveQuery(ref, {
    connectionId: 'protected-live-connection',
    args,
  });
  assert.equal(
    onlineHandle.retention?.retainable,
    true,
    `fresh full query installs lease custody (${onlineHandle.retention?.reason ?? 'no reason'})`,
  );
  onlineHandle.dispose();
  await onlineHandle.settled();
  await ownerStore.close();
  await tick();

  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const coldStore = createIndexedDbRqsResumeStore({ indexedDB, lockManager });
  await tick();
  const cold = new SnapbackClient('http://protected-live.test', {
    bearerToken: 'protected-live-bearer',
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorizedLeaseProtocol: 1,
    rqsStore: coldStore,
    offlineQueue: false,
  });
  const updates = [];
  const coldHandle = await cold.liveQuery(ref, {
    connectionId: 'protected-cold-connection',
    args,
    onUpdate: (nextRows, detail) => updates.push({ rows: nextRows, detail }),
  });
  assert.equal(updates[0]?.detail.kind, 'authorized_lease_retained');
  assert.deepEqual(coldHandle.rows, rows, 'fresh client instance renders protected rows offline');
  assert.equal(coldHandle.freshness, 'retained', 'protected cold rows are never current');
  assert.equal(coldHandle.retention?.retainable, true);
  coldHandle.dispose();
  await coldHandle.settled();
  await coldStore.close();
});

// --- Refuse-with-the-failed-rule (issues/20260807-arg-filtered-retention-
// --- none-maze.md): the NOT_RQS_ELIGIBLE fact derives its reason from the
// --- generated reference's codegen-derived retention classification, so a
// --- builder can tell "never opted in" from "class volatile by design" from
// --- "eligible declaration on a target that did not activate the class".
test('rqsRetentionIneligibilityReason names the failed eligibility layer from the generated reference', async () => {
  const { rqsRetentionIneligibilityReason } = await import('./index.mjs');
  const withRetention = (retention) => ({
    artifactKind: 'functionReference',
    composition: { normalizedCompositePlan: { classification: { retention } } },
  });
  assert.match(
    rqsRetentionIneligibilityReason(withRetention('rqs-authority-independent-snapshot-v1')),
    /retention-eligible \(single_table_v1\).*did not advertise or activate/su,
    'eligible declaration, inactive target: names the target, not the declaration',
  );
  assert.match(
    rqsRetentionIneligibilityReason(withRetention('none')),
    /'none' is\s+deliberately volatile/su,
    'a composition class of none is named volatile-by-design',
  );
  assert.match(
    rqsRetentionIneligibilityReason({ artifactKind: 'functionReference' }),
    /carries no retention classification.*auth: 'public'.*explicit args are allowed.*JS handlers are never/su,
    'an unclassified generated declaration names the declaration rules (and that args are fine)',
  );
  assert.match(
    rqsRetentionIneligibilityReason('byNameOnly'),
    /minted no resume token.*LLP 0090/su,
    'a by-name reference keeps the generic reason: the client cannot inspect a string',
  );
});
