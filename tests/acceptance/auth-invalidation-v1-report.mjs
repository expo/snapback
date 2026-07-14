#!/usr/bin/env node

// Composed LLP 0053 acceptance report. This runner executes the production
// Rust authorization/room paths and the production @snapback/contract store
// paths, then compares their machine-readable observations with the committed
// receipt. It measures deterministic protocol transitions, never wall-clock
// latency.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMemorySnapbackClientStore,
} from '../../packages/snapback-contract/client-store.mjs';
import {
  createLiveQueryAuthorizationFence,
} from '../../packages/snapback-contract/query-authorization.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RECEIPT_PATH = resolve(
  ROOT,
  'tests/acceptance/auth-invalidation-v1-composed-receipt.json',
);

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const NEXT_INCARNATION = '018f0d90-7b12-7a22-8c33-445566778899';
const AUTHORITY_INSTANCE = '018f0d90-7b13-7a22-8c33-445566778899';
const USER = '018f0d90-7b14-7a22-8c33-445566778899';
const AUTHORITY_KEY = `sha256:${'a'.repeat(64)}`;
const APP_ID = 'llp-0053-composed-acceptance';
const TARGET_PROFILE_ID = 'local-dev-sqlite-ibex';
const VERSION_STREAM = 'stream-0053';
const ACTIVATION_HASH = `snapback.authorized-lease.activation.v1:sha256:${'b'.repeat(64)}`;
// The epoch is checked against the executed Rust receipt before any client
// measurement runs. The local UUID supplies a structurally valid replacement
// for the receipt's deliberately normalized authenticated incarnation.
const AUTHORIZATION = Object.freeze({ incarnation: INCARNATION, epoch: 8 });
const ISSUER = Object.freeze({
  authorizationIncarnation: INCARNATION,
  bootSequence: 1,
  bootNonce: 'AAAAAAAAAAAAAAAAAAAAAA',
});
const EXPECTED = Object.freeze({ authorityEpoch: 0, authorityKey: AUTHORITY_KEY });
const PRINCIPAL_SCOPE = Object.freeze({
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  userId: USER,
});
const AUTHORITY_DESCRIPTOR = Object.freeze({
  descriptorVersion: 1,
  authorityInstanceId: AUTHORITY_INSTANCE,
  sessionGeneration: 1,
});

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const retainedPayloadBytes = (snapshot) => Object.values(snapshot.retained)
  .reduce((total, record) => total + byteLength(record), 0);

const assertCode = async (code, operation) => {
  await assert.rejects(operation, (error) => error?.code === code);
};

const runRustReceipt = (testName, marker) => {
  const completed = spawnSync(
    'cargo',
    ['test', '--lib', testName, '--', '--exact', '--nocapture'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const output = `${completed.stdout ?? ''}\n${completed.stderr ?? ''}`;
  if (completed.status !== 0) {
    throw new Error(`Rust acceptance ${testName} failed:\n${output}`);
  }
  const prefix = `${marker}=`;
  const line = output.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    throw new Error(`Rust acceptance ${testName} emitted no ${marker} record:\n${output}`);
  }
  return JSON.parse(line.slice(prefix.length));
};

const record = (version, rows, versionStream = VERSION_STREAM) => ({
  rows,
  version,
  versionStreamId: versionStream,
  cursor: { stream: versionStream, version },
});

const lease = ({
  queryKey,
  namespace,
  requestId,
  version,
  durationMs = 1_000,
  authorization = AUTHORIZATION,
  issuerId = ISSUER,
  versionStream = VERSION_STREAM,
}) => ({
  protocolVersion: 1,
  leaseId: `lease_${version}`,
  leaseRequestId: requestId,
  issuerId,
  clientStoreId: namespace.clientStoreId,
  queryKey,
  queryInstanceId: namespace.queryInstanceId,
  principalId: USER,
  sessionIdAtIssue: 'session-0053',
  providerKey: 'email-code',
  authorization,
  data: { versionStream, snapshotCommitVersion: version },
  activationHash: ACTIVATION_HASH,
  issuedAtServerMs: 10_000,
  authorizedUntilServerMs: 10_000 + durationMs,
  sessionNotAfterMs: 10_000 + durationMs,
  providerNotAfterMs: null,
  authorityInstanceId: AUTHORITY_INSTANCE,
  keyId: 'lease-key-0053',
  mac: 'A'.repeat(43),
});

const witness = (
  minCommitVersion,
  authorization = AUTHORIZATION,
  versionStream = VERSION_STREAM,
) => ({
  authorization,
  data: { versionStream, minCommitVersion },
});

const subscriptionScope = (namespace, sequence = 1, issuerId = ISSUER) => ({
  kind: 'subscription',
  issuerId,
  namespace,
  scopeSequence: sequence,
  connectionGeneration: 1,
  subscriptionId: `subscription_${namespace.queryInstanceId}_${sequence}`,
});

const retainedObligation = ({
  namespace,
  revision = 1,
  disposition = 'quarantine',
  minCommitVersion = 101,
  authorization = AUTHORIZATION,
  issuerId = ISSUER,
  versionStream = VERSION_STREAM,
}) => ({
  protocolVersion: 1,
  scopeId: subscriptionScope(namespace, 1, issuerId),
  revision,
  maxDisposition: disposition,
  witness: witness(minCommitVersion, authorization, versionStream),
  ownerContinuityId: `owner_${namespace.queryInstanceId}`,
  retryEpisodeId: null,
});

const retainedResolution = ({
  obligation,
  kind = 'snapshot',
  minCommitVersion = obligation.witness.data.minCommitVersion,
}) => ({
  protocolVersion: 1,
  kind,
  scopeId: obligation.scopeId,
  revision: obligation.revision,
  witness: {
    authorization: obligation.witness.authorization,
    data: {
      versionStream: obligation.witness.data.versionStream,
      minCommitVersion,
    },
  },
  maxDisposition: obligation.maxDisposition,
  ackToken: `ack_${obligation.scopeId.namespace.queryInstanceId}_${obligation.revision}`,
  ownerContinuityId: obligation.ownerContinuityId,
});

const clientQueryScope = (namespace) => ({ kind: 'clientQuery', namespace });
const queueObligation = ({
  namespace,
  revision = 1,
  disposition = 'quarantine',
  minCommitVersion = 101,
  authorization = AUTHORIZATION,
  versionStream = VERSION_STREAM,
}) => ({
  protocolVersion: 1,
  scopeId: clientQueryScope(namespace),
  revision,
  maxDisposition: disposition,
  witness: witness(minCommitVersion, authorization, versionStream),
  retryEpisodeId: null,
});
const queueResolution = ({ obligation, kind = 'snapshot' }) => ({
  protocolVersion: 1,
  kind,
  scopeId: obligation.scopeId,
  revision: obligation.revision,
  witness: obligation.witness,
  maxDisposition: obligation.maxDisposition,
  ackToken: `queue_ack_${obligation.scopeId.namespace.queryInstanceId}_${obligation.revision}`,
});

const createAuthorizedStore = async ({ versionStream = VERSION_STREAM } = {}) => {
  const durable = {};
  const store = createMemorySnapbackClientStore({ state: durable });
  await store.bindAuthority(EXPECTED);
  await store.scopeToArtifacts({
    appId: APP_ID,
    targetProfileId: TARGET_PROFILE_ID,
    versionStreamId: versionStream,
  }, EXPECTED);
  await store.scopeAuthorization({
    principalScope: PRINCIPAL_SCOPE,
    authorityDescriptor: AUTHORITY_DESCRIPTOR,
  }, EXPECTED);
  return { durable, store };
};

const installQuery = async ({
  store,
  queryKey,
  version,
  rows,
  clientNowMs,
  authorization = AUTHORIZATION,
  issuerId = ISSUER,
  versionStream = VERSION_STREAM,
}) => {
  const initialized = await store.initializeAuthorizedRetainedQuery(queryKey, {
    authorization,
    issuerId,
    versionStream,
    principalId: USER,
    activationHash: ACTIVATION_HASH,
    appId: APP_ID,
    targetProfileId: TARGET_PROFILE_ID,
  }, EXPECTED);
  const request = await store.beginAuthorizedLeaseRequest(queryKey, {
    fence: initialized.fence,
    leaseRequestId: `request_${version}`,
    clientNowMs,
  }, EXPECTED);
  const committed = await store.commitAuthorizedRetainedSnapshot(queryKey, {
    fence: request.fence,
    lease: lease({
      queryKey,
      namespace: initialized.namespace,
      requestId: request.request.leaseRequestId,
      version,
      durationMs: 1_000,
      authorization,
      issuerId,
      versionStream,
    }),
    record: record(version, rows, versionStream),
    clientNowMs: clientNowMs + 1,
  }, EXPECTED);
  return { ...initialized, fence: committed.fence };
};

const measureVisibilityLifecycle = async (serverWitnessFloor) => {
  const queryKey = 'privateBoard:{"gameId":"g1"}';
  const { durable, store } = await createAuthorizedStore();
  const installed = await installQuery({
    store,
    queryKey,
    version: 100,
    rows: [{ card: 'ace-updated' }],
    clientNowMs: 1_000,
  });
  const peer = createMemorySnapbackClientStore({ state: durable });
  const peerCapture = await peer.captureAuthorizedRetainedQuery(queryKey, EXPECTED);
  const sharedDurableStore = peerCapture.namespace.clientStoreId
    === installed.namespace.clientStoreId
    && peerCapture.namespace.queryInstanceId === installed.namespace.queryInstanceId;
  assert.equal(sharedDurableStore, true);
  const bytesBeforeQuarantine = byteLength((await store.snapshot()).retained[queryKey]);
  let protocolTransition = 0;

  const pending = retainedObligation({
    namespace: installed.namespace,
    minCommitVersion: serverWitnessFloor.minCommitVersion,
  });
  protocolTransition += 1;
  const hidden = await store.receiveRetainedQueryObligation(
    queryKey,
    pending,
    installed.fence,
    EXPECTED,
  );
  const hiddenAtTransition = protocolTransition;
  assert.equal(hidden.disposition, 'quarantine');
  assert.equal(await store.getAuthorizedRetainedQuery(queryKey, {
    fence: hidden.fence,
    clientNowMs: 1_100,
  }, EXPECTED), null);
  const bytesDuringQuarantine = byteLength((await store.snapshot()).retained[queryKey]);
  assert.equal(bytesDuringQuarantine, bytesBeforeQuarantine);

  let stalePeerWriteCode = null;
  try {
    await peer.putAuthorizedRetainedQuery(queryKey, {
      fence: peerCapture.fence,
      record: record(101, [{ card: 'stale-peer-write' }]),
      clientNowMs: 1_101,
    }, EXPECTED);
  } catch (error) {
    stalePeerWriteCode = error?.code ?? null;
  }
  const stalePeerWriteRejected = stalePeerWriteCode === 'SNAPBACK_AUTH_QUERY_FENCE_STALE';
  assert.equal(stalePeerWriteRejected, true);

  protocolTransition += 1;
  const resolved = await store.applyRetainedQueryResolution(queryKey, {
    fence: hidden.fence,
    resolution: retainedResolution({ obligation: pending }),
    record: record(101, [{ card: 'king' }]),
  }, EXPECTED);
  assert.equal(resolved.disposition, 'retain');
  assert.equal((await store.snapshot()).queryAuthorization[queryKey].lease, null);

  protocolTransition += 1;
  const renewal = await store.beginAuthorizedLeaseRequest(queryKey, {
    fence: resolved.fence,
    leaseRequestId: 'request_recovery_101',
    clientNowMs: 1_600,
  }, EXPECTED);
  protocolTransition += 1;
  const recovered = await store.commitAuthorizedRetainedSnapshot(queryKey, {
    fence: renewal.fence,
    lease: lease({
      queryKey,
      namespace: installed.namespace,
      requestId: renewal.request.leaseRequestId,
      version: 101,
    }),
    record: record(101, [{ card: 'king' }]),
    clientNowMs: 1_601,
  }, EXPECTED);
  const visibleAtTransition = protocolTransition;
  assert.deepEqual((await store.getAuthorizedRetainedQuery(queryKey, {
    fence: recovered.fence,
    clientNowMs: 2_599,
  }, EXPECTED)).rows, [{ card: 'king' }]);

  const bytesBeforeExpiry = byteLength((await store.snapshot()).retained[queryKey]);
  const generationBeforeExpiry = (await store.snapshot()).queryAuthorization[queryKey]
    .queryGeneration;
  await assertCode('SNAPBACK_AUTHORIZED_LEASE_EXPIRED', () => (
    store.getAuthorizedRetainedQuery(queryKey, {
      fence: recovered.fence,
      clientNowMs: 2_600,
    }, EXPECTED)
  ));
  const expired = await store.snapshot();
  assert.equal(expired.retained[queryKey], undefined);
  assert.equal(expired.queryAuthorization[queryKey].effectiveDisposition, 'delete');
  const expiryTombstoneWritten = expired.queryAuthorization[queryKey].queryGeneration
    > generationBeforeExpiry;
  assert.equal(expiryTombstoneWritten, true);

  const afterExpiry = await store.captureAuthorizedRetainedQuery(queryKey, EXPECTED);
  const rollbackRequest = await store.beginAuthorizedLeaseRequest(queryKey, {
    fence: afterExpiry.fence,
    leaseRequestId: 'request_rollback_102',
    clientNowMs: 2_700,
  }, EXPECTED);
  const rollbackReady = await store.commitAuthorizedRetainedSnapshot(queryKey, {
    fence: rollbackRequest.fence,
    lease: lease({
      queryKey,
      namespace: installed.namespace,
      requestId: rollbackRequest.request.leaseRequestId,
      version: 102,
    }),
    record: record(102, [{ card: 'queen' }]),
    clientNowMs: 2_701,
  }, EXPECTED);
  await store.getAuthorizedRetainedQuery(queryKey, {
    fence: rollbackReady.fence,
    clientNowMs: 2_800,
  }, EXPECTED);
  const bytesBeforeRollback = byteLength((await store.snapshot()).retained[queryKey]);
  const generationBeforeRollback = (await store.snapshot()).queryAuthorization[queryKey]
    .queryGeneration;
  await assertCode('SNAPBACK_AUTH_CLOCK_ROLLBACK', () => (
    store.getAuthorizedRetainedQuery(queryKey, {
      fence: rollbackReady.fence,
      clientNowMs: 2_799,
    }, EXPECTED)
  ));
  const rolledBack = await store.snapshot();
  const rollbackTombstoneWritten = rolledBack.queryAuthorization[queryKey].queryGeneration
    > generationBeforeRollback;
  assert.equal(rollbackTombstoneWritten, true);
  assert.equal(rolledBack.retained[queryKey], undefined);

  return {
    intervalUnit: 'committed-client-store-transitions',
    hiddenAtTransition,
    visibleAtTransition,
    hiddenIntervalTransitions: visibleAtTransition - hiddenAtTransition,
    recoveryPath: [
      'quarantine-fence-commit',
      'superseding-snapshot-commit',
      'lease-request-reservation-commit',
      'fresh-authorized-snapshot-commit',
    ],
    wallClockMeasured: false,
    composedServerWitnessFloor: serverWitnessFloor,
    retainedPayloadBytesPreservedDuringQuarantine: bytesDuringQuarantine,
    retainedPayloadBytesDeletedAtLeaseExpiry: bytesBeforeExpiry,
    retainedPayloadBytesDeletedAtClockRollback: bytesBeforeRollback,
    expiryDeleteTombstoneWritten: expiryTombstoneWritten,
    clockRollbackDeleteTombstoneWritten: rollbackTombstoneWritten,
    durableDeleteTombstoneWrites:
      Number(expiryTombstoneWritten) + Number(rollbackTombstoneWritten),
    sharedDurableStore,
    stalePeerWriteRejected,
  };
};

const measureMembershipBlastRadius = async ({
  lifecycleReplay,
  expectedQueryCount,
  productionServerTrafficCounts,
}) => {
  const events = new Map();
  for (const transition of lifecycleReplay) {
    const grouped = events.get(transition.eventIndex) ?? [];
    grouped.push(transition);
    events.set(transition.eventIndex, grouped);
  }
  const perQueryLifecycle = [];
  const perEventQueueLifecycle = [];
  let retainedPayloadBytesBefore = 0;
  let retainedPayloadBytesDuringQuarantine = 0;
  let durableQuarantineFenceWrites = 0;
  let durableDeleteTombstonesWrittenDuringQuarantine = 0;
  let clientObligationApplications = 0;
  let clientResolutionApplications = 0;
  let clientLeaseRequests = 0;
  let clientAuthorizedSnapshotCommits = 0;
  let clientQueueObligationApplications = 0;
  let clientQueueResolutionApplications = 0;

  for (const [eventIndex, rawTransitions] of [...events.entries()].sort(([left], [right]) => (
    left - right
  ))) {
    const transitions = [...rawTransitions].sort((left, right) => (
      left.queryIndex - right.queryIndex
    ));
    assert.equal(transitions.length, expectedQueryCount);
    const epoch = transitions[0].compositeWitness.authorization.epoch;
    const authorization = { incarnation: INCARNATION, epoch };
    const issuerId = { ...ISSUER, authorizationIncarnation: INCARNATION };
    const { store } = await createAuthorizedStore();
    const fixtures = [];
    let clientNowMs = 1_000;

    for (const transition of transitions) {
      assert.equal(transition.compositeWitness.authorization.epoch, epoch);
      const queryKey = [
        transition.query.function,
        transition.query.user,
        `membership-event-${eventIndex}`,
      ].join(':');
      const rows = Array.from(
        { length: transition.snapshot.rowCount },
        (_, rowIndex) => ({ queryKey, rowIndex, authorized: true }),
      );
      const installed = await installQuery({
        store,
        queryKey,
        version: transition.snapshot.commitVersion - 1,
        rows,
        clientNowMs,
        authorization,
        issuerId,
      });
      clientNowMs += 2;
      fixtures.push({ queryKey, rows, installed, transition });
    }

    let queueCapture = await store.captureMutationQueue(EXPECTED);
    const expectedMutationIds = [`cm_membership_${eventIndex}_a`, `cm_membership_${eventIndex}_b`];
    for (const [mutationIndex, mutationId] of expectedMutationIds.entries()) {
      await store.enqueueMutation({
        id: mutationId,
        function: `write${mutationIndex}`,
        args: { eventIndex, mutationIndex },
        authorityDescriptor: AUTHORITY_DESCRIPTOR,
        appId: APP_ID,
        targetProfileId: TARGET_PROFILE_ID,
        versionStreamId: VERSION_STREAM,
        cursor: {
          stream: VERSION_STREAM,
          version: transitions[0].snapshot.commitVersion - 1,
        },
        ...EXPECTED,
        ...queueCapture,
      });
    }
    const before = await store.snapshot();
    const eventBytesBefore = retainedPayloadBytes(before);
    const pendingMutationsBefore = before.pending.length;
    const queueObligations = [];
    const hiddenTransitions = [];

    for (const fixture of fixtures) {
      const { transition, installed, queryKey } = fixture;
      const beforeQueryRecord = (await store.snapshot()).retained[queryKey];
      const bytesBefore = byteLength(beforeQueryRecord);
      const pending = retainedObligation({
        namespace: installed.namespace,
        revision: transition.revision,
        disposition: transition.disposition,
        minCommitVersion: transition.compositeWitness.data.minCommitVersion,
        authorization,
        issuerId,
      });
      const accepted = await store.receiveRetainedQueryObligation(
        queryKey,
        pending,
        installed.fence,
        EXPECTED,
      );
      clientObligationApplications += 1;
      durableQuarantineFenceWrites += Number(accepted.disposition === 'quarantine');
      const hiddenRead = await store.getAuthorizedRetainedQuery(queryKey, {
        fence: accepted.fence,
        clientNowMs,
      }, EXPECTED);
      clientNowMs += 1;
      assert.equal(hiddenRead, null);
      const during = await store.snapshot();
      const bytesDuring = byteLength(during.retained[queryKey]);
      assert.equal(bytesDuring, bytesBefore);
      const deleteTombstoneWritten = during.retained[queryKey] === undefined;
      assert.equal(deleteTombstoneWritten, false);
      durableDeleteTombstonesWrittenDuringQuarantine += Number(deleteTombstoneWritten);

      const queuePending = queueObligation({
        namespace: installed.namespace,
        revision: transition.revision,
        disposition: transition.disposition,
        minCommitVersion: transition.compositeWitness.data.minCommitVersion,
        authorization,
      });
      queueCapture = await store.applyMutationQueueObligation(
        queuePending,
        { ...EXPECTED, ...queueCapture },
      );
      clientQueueObligationApplications += 1;
      queueObligations.push(queuePending);
      hiddenTransitions.push({ fixture, pending, accepted, bytesBefore, bytesDuring });
    }

    const quarantined = await store.snapshot();
    const eventBytesDuring = retainedPayloadBytes(quarantined);
    assert.equal(eventBytesDuring, eventBytesBefore);
    assert.equal(queueCapture.suspended, true);
    assert.equal(queueCapture.pendingScopeCount, fixtures.length);
    await assertCode('SNAPBACK_CLIENT_QUEUE_SUSPENDED', () => (
      store.pendingMutations({ ...EXPECTED, ...queueCapture })
    ));
    assert.equal(quarantined.pending.length, pendingMutationsBefore);

    for (const [queryIndex, hidden] of hiddenTransitions.entries()) {
      const { fixture, pending, accepted, bytesBefore, bytesDuring } = hidden;
      const { transition, queryKey, rows, installed } = fixture;
      const resolved = await store.applyRetainedQueryResolution(queryKey, {
        fence: accepted.fence,
        resolution: retainedResolution({ obligation: pending }),
        record: record(transition.snapshot.commitVersion, rows),
      }, EXPECTED);
      clientResolutionApplications += 1;
      assert.equal(resolved.ackToken, `ack_${installed.namespace.queryInstanceId}_${transition.revision}`);
      assert.equal((await store.snapshot()).queryAuthorization[queryKey].lease, null);
      const request = await store.beginAuthorizedLeaseRequest(queryKey, {
        fence: resolved.fence,
        leaseRequestId: `request_recovery_${eventIndex}_${queryIndex}`,
        clientNowMs,
      }, EXPECTED);
      clientNowMs += 1;
      clientLeaseRequests += 1;
      const recovered = await store.commitAuthorizedRetainedSnapshot(queryKey, {
        fence: request.fence,
        lease: lease({
          queryKey,
          namespace: installed.namespace,
          requestId: request.request.leaseRequestId,
          version: transition.snapshot.commitVersion,
          authorization,
          issuerId,
        }),
        record: record(transition.snapshot.commitVersion, rows),
        clientNowMs,
      }, EXPECTED);
      clientNowMs += 1;
      clientAuthorizedSnapshotCommits += 1;
      assert.deepEqual((await store.getAuthorizedRetainedQuery(queryKey, {
        fence: recovered.fence,
        clientNowMs,
      }, EXPECTED)).rows, rows);
      clientNowMs += 1;

      queueCapture = await store.resolveMutationQueueObligation(
        queueResolution({ obligation: queueObligations[queryIndex] }),
        { ...EXPECTED, ...queueCapture },
      );
      clientQueueResolutionApplications += 1;
      const queueShouldRemainSuspended = queryIndex < hiddenTransitions.length - 1;
      assert.equal(queueCapture.suspended, queueShouldRemainSuspended);
      perQueryLifecycle.push({
        eventIndex,
        eventKind: transition.eventKind,
        queryIndex: transition.queryIndex,
        productionQuery: transition.query,
        productionScope: transition.scope,
        revision: transition.revision,
        compositeWitness: transition.compositeWitness,
        disposition: transition.disposition,
        dispositionReason: transition.dispositionReason,
        proofPath: transition.proofPath,
        fullRequeryAndAuthorizationMatched: transition.fullRequeryAndAuthorizationMatched,
        serverSnapshotCommitVersion: transition.snapshot.commitVersion,
        serverSnapshotRowCount: transition.snapshot.rowCount,
        serverResolutionKind: transition.resolutionKind,
        serverAcknowledgementOutcome: transition.acknowledgementOutcome,
        clientLifecycle: {
          quarantineCommitted: true,
          hiddenReadWasNull: true,
          hiddenIntervalTransitions: 3,
          retainedPayloadBytesBefore: bytesBefore,
          retainedPayloadBytesDuringQuarantine: bytesDuring,
          retainedPayloadBytesDeletedByQuarantine: bytesBefore - bytesDuring,
          durableDeleteTombstonesWrittenDuringQuarantine: 0,
          freshSnapshotCommitted: true,
          leaseRevalidated: true,
          recoveredRows: rows.length,
          ackTokenObserved: resolved.ackToken,
        },
      });
    }

    const releasedMutationIds = (await store.pendingMutations({
      ...EXPECTED,
      ...queueCapture,
    })).map(({ id }) => id);
    assert.deepEqual(releasedMutationIds, expectedMutationIds);
    perEventQueueLifecycle.push({
      eventIndex,
      eventKind: transitions[0].eventKind,
      revision: transitions[0].revision,
      pendingMutationsBefore,
      suspendedMutationCount: quarantined.pending.length,
      pendingScopeCountAtFullSuspension: fixtures.length,
      remainedSuspendedUntilFinalQueryResolution: true,
      releasedMutationIds,
    });
    retainedPayloadBytesBefore += eventBytesBefore;
    retainedPayloadBytesDuringQuarantine += eventBytesDuring;
  }

  assert.equal(perQueryLifecycle.length, lifecycleReplay.length);
  assert.equal(durableDeleteTombstonesWrittenDuringQuarantine, 0);
  return {
    membershipChurnEvents: events.size,
    authScopedQueriesPerEvent: expectedQueryCount,
    completeQueryLifecycles: perQueryLifecycle.length,
    retainedPayloadBytesBefore,
    retainedPayloadBytesDuringQuarantine,
    retainedPayloadBytesDeletedByCoarseQuarantine:
      retainedPayloadBytesBefore - retainedPayloadBytesDuringQuarantine,
    durableQuarantineFenceWrites,
    durableDeleteTombstonesWrittenDuringQuarantine,
    queueSuspensionCycles: perEventQueueLifecycle.length,
    queueReleaseCycles: perEventQueueLifecycle.length,
    trafficCounts: {
      productionServer: productionServerTrafficCounts,
      clientObligationApplications,
      clientResolutionApplications,
      clientLeaseRequests,
      clientAuthorizedSnapshotCommits,
      clientQueueObligationApplications,
      clientQueueResolutionApplications,
    },
    perEventQueueLifecycle,
    perQueryLifecycle,
  };
};

const liveWitness = ({
  authorization = AUTHORIZATION,
  versionStream = VERSION_STREAM,
  minCommitVersion = 300,
} = {}) => ({
  authorization,
  data: { versionStream, minCommitVersion },
});

const liveNamespace = (queryInstanceId = 1) => ({
  clientStoreId: 'store-live-0053',
  queryKey: 'liveBoard:{}',
  queryInstanceId,
});

const liveIssuer = (authorizationIncarnation = INCARNATION, bootSequence = 3) => ({
  authorizationIncarnation,
  bootSequence,
  bootNonce: bootSequence === 3
    ? 'BBBBBBBBBBBBBBBBBBBBBB'
    : 'CCCCCCCCCCCCCCCCCCCCCC',
});

const createLiveFence = ({
  namespace = liveNamespace(),
  authorization = AUTHORIZATION,
  issuerId = liveIssuer(),
  versionStream = VERSION_STREAM,
  rows = [{ id: 'visible' }],
  version = 300,
} = {}) => createLiveQueryAuthorizationFence({
  namespace,
  authorityGeneration: 1,
  authorityInstanceId: AUTHORITY_INSTANCE,
  issuerId,
  authorization,
  versionStream,
  initialSnapshot: {
    rows,
    version,
    witness: liveWitness({ authorization, versionStream, minCommitVersion: version }),
  },
});

const liveScope = ({ namespace = liveNamespace(), issuerId = liveIssuer(), sequence = 1 } = {}) => ({
  kind: 'subscription',
  issuerId,
  namespace,
  scopeSequence: sequence,
  connectionGeneration: 1,
  subscriptionId: `live-sub-${sequence}`,
});

const liveObligation = ({
  namespace = liveNamespace(),
  issuerId = liveIssuer(),
  revision = 1,
  disposition = 'quarantine',
  minCommitVersion = 301,
  sequence = 1,
} = {}) => ({
  protocolVersion: 1,
  scopeId: liveScope({ namespace, issuerId, sequence }),
  revision,
  maxDisposition: disposition,
  witness: liveWitness({ minCommitVersion }),
  retryEpisodeId: null,
  ownerContinuityId: 'live-owner-0053',
});

const liveResolution = (pending, kind = 'snapshot') => ({
  protocolVersion: 1,
  kind,
  scopeId: pending.scopeId,
  revision: pending.revision,
  witness: pending.witness,
  maxDisposition: pending.maxDisposition,
  ackToken: `live-ack-${pending.revision}`,
  ownerContinuityId: pending.ownerContinuityId,
});

const exerciseLiveClientScenarios = () => {
  const deploymentFence = createLiveFence();
  const nextAuthorization = { incarnation: NEXT_INCARNATION, epoch: 0 };
  const nextStream = 'stream-0053-next-deployment';
  const deploymentBoundary = [];
  const deployment = deploymentFence.replaceAuthenticatedExpectation({
    issuerId: liveIssuer(NEXT_INCARNATION, 1),
    authorization: nextAuthorization,
    versionStream: nextStream,
    snapshot: {
      rows: [{ id: 'new-deployment-row' }],
      version: 1,
      witness: liveWitness({
        authorization: nextAuthorization,
        versionStream: nextStream,
        minCommitVersion: 1,
      }),
    },
    commit: (event) => deploymentBoundary.push(event.kind),
  });
  const deploymentFailClosed = deployment.disposition === 'delete'
    && deploymentFence.isRenderable() === false
    && deploymentBoundary.at(-1) === 'delete';
  assert.equal(deploymentFailClosed, true);

  const escalationFence = createLiveFence();
  const quarantine = liveObligation();
  const first = escalationFence.receiveObligation(quarantine, { commit() {} });
  const deletion = liveObligation({ revision: 2, disposition: 'delete' });
  const second = escalationFence.receiveObligation(deletion, { commit() {} });
  assert.equal(escalationFence.disposition(), 'delete');
  const terminal = escalationFence.applyResolution({
    fence: second.fence,
    resolution: liveResolution(deletion, 'terminalDelete'),
    commit: (event) => assert.equal(event.kind, 'delete'),
  });
  const refired = escalationFence.receiveObligation(deletion, {
    commit: () => assert.fail('applied terminal proof must re-fire idempotently'),
  });
  const ackLossRefiredSameToken = refired.status === 'applied'
    && refired.ackToken === terminal.ackToken;
  assert.equal(ackLossRefiredSameToken, true);
  assert.equal(escalationFence.acknowledge(terminal.ackToken).status, 'acknowledged');

  const oldNamespace = liveNamespace(10);
  const disconnected = createLiveFence({ namespace: oldNamespace });
  const disconnectedPending = liveObligation({ namespace: oldNamespace });
  disconnected.receiveObligation(disconnectedPending, { commit() {} });
  const resumedNamespace = liveNamespace(11);
  const resumed = createLiveFence({
    namespace: resumedNamespace,
    rows: [{ id: 'fresh-after-disconnect' }],
    version: 302,
  });
  let delayedPredecessorFrameCode = null;
  try {
    resumed.receiveObligation(disconnectedPending, { commit() {} });
  } catch (error) {
    delayedPredecessorFrameCode = error?.code ?? null;
  }
  const delayedPredecessorFrameRejected =
    delayedPredecessorFrameCode === 'SNAPBACK_AUTH_QUERY_FENCE_STALE';
  assert.equal(delayedPredecessorFrameRejected, true);
  const disconnectFreshSnapshot = resumed.isRenderable()
    && resumed.snapshot().accepted.version === 302;
  assert.equal(disconnectFreshSnapshot, true);

  return {
    deployment: {
      failClosedBoundary: deploymentBoundary.at(-1),
      oldRowsRenderableAfterIdentityChange: deploymentFence.isRenderable(),
      passed: deploymentFailClosed,
    },
    disconnect: {
      predecessorInstance: oldNamespace.queryInstanceId,
      successorInstance: resumedNamespace.queryInstanceId,
      delayedPredecessorFrameRejected,
      successorInstalledFreshSnapshot: disconnectFreshSnapshot,
    },
    dispositionEscalation: {
      initialDisposition: first.disposition,
      terminalDisposition: escalationFence.disposition(),
      ackLossRefiredSameToken,
    },
  };
};

// The reference function owns source rows and authorization predicates. The
// production client paths receive only its full-query result; the executed
// Rust receipt independently proves that production server projection matched
// a fresh Ibex query. Composing both halves avoids treating client protocol
// validation as an application-policy evaluator.
const PROPERTY_SEED = 0x53a11ce;
const PROPERTY_TRIALS_PER_EVENT = 3;
const PROPERTY_EVENT_UNIVERSE = Object.freeze([
  'randomized-writes',
  'deployment-activation',
  'lease-expiry',
  'clock-rollback',
  'overflow',
  'disconnect-and-fresh-resume',
  'response-loss',
  'ack-loss',
  'restart',
  'stale-callback',
  'cross-tab-write',
  'disposition-escalation',
]);

const deterministicRandom = (seed) => {
  let state = seed >>> 0;
  return {
    next() {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    },
    state: () => state,
  };
};

const canonicalRows = (rows) => [...rows].sort((left, right) => left.id.localeCompare(right.id));

const fullAuthorizationRequery = (rows, {
  principalId = USER,
  authorityValid = true,
  leaseValid = true,
  connected = true,
  invalidationPending = false,
  terminal = false,
} = {}) => {
  if (!authorityValid || !leaseValid || !connected || invalidationPending || terminal) return [];
  return canonicalRows(rows.filter((row) => row.ownerId === principalId || row.isPublic === true));
};

const propertyRows = (random, caseIndex) => {
  const rows = Array.from({ length: 6 }, (_, rowIndex) => ({
    id: `case-${caseIndex}-row-${rowIndex}`,
    ownerId: ((random.next() >>> 16) & 1) === 0 ? USER : 'another-principal',
    isPublic: ((random.next() >>> 16) & 3) === 0,
  }));
  rows[0] = { ...rows[0], ownerId: USER, isPublic: false };
  rows[1] = { ...rows[1], ownerId: 'another-principal', isPublic: false };
  return rows;
};

const propertySnapshot = (rows, version, authorization = AUTHORIZATION) => ({
  rows,
  version,
  witness: liveWitness({ authorization, minCommitVersion: version }),
});

const assertOracleRows = (actualRows, expectedRows, scenario) => {
  assert.deepEqual(canonicalRows(actualRows), canonicalRows(expectedRows), `${scenario} oracle rows`);
};

const normalizedPropertyWitness = (version) => ({
  authorization: {
    incarnation: '<authenticated-uuid-v7>',
    epoch: AUTHORIZATION.epoch,
  },
  data: {
    versionStream: '<authenticated-version-stream>',
    minCommitVersion: version,
  },
});

const exercisePropertyCase = async ({
  scenario,
  caseIndex,
  random,
  serverReceipt,
  overflowReceipt,
  deploymentReceipt,
}) => {
  const sourceRows = propertyRows(random, caseIndex);
  const initiallyAuthorized = fullAuthorizationRequery(sourceRows);
  const version = 500 + (caseIndex * 3);
  const revision = 1 + (random.next() % 100);
  const queryInstanceId = 1_000 + caseIndex;
  const namespace = liveNamespace(queryInstanceId);
  const proof = {
    caseIndex,
    randomState: `0x${random.state().toString(16).padStart(8, '0')}`,
    scope: {
      kind: 'subscription',
      namespace: {
        clientStoreId: '<production-client-store-id>',
        queryKey: namespace.queryKey,
        queryInstanceId,
      },
    },
    scopeSource: 'executed-resync-obligation',
    revision,
    revisionSource: 'executed-resync-obligation',
    compositeWitness: normalizedPropertyWitness(version + 1),
    proofPath: [
      'seeded-state-transition',
      'production-protocol-path',
      'independent-full-requery-and-authorization',
      'state-and-row-comparison',
    ],
  };
  let expectedRows;
  let actualRows;
  let productionObservation;
  let dispositionReason;
  let disposition;

  if (scenario === 'randomized-writes') {
    const updatedRows = structuredClone(sourceRows);
    const writeKind = random.next() % 3;
    const target = updatedRows[writeKind === 2 ? 0 : 1];
    if (writeKind === 0) target.isPublic = true;
    else if (writeKind === 1) target.ownerId = USER;
    else target.ownerId = 'another-principal';
    expectedRows = fullAuthorizationRequery(updatedRows);
    const fence = createLiveFence({ namespace, rows: initiallyAuthorized, version });
    let committedRows = null;
    fence.applyLiveSnapshot({
      fence: fence.capture(),
      snapshot: propertySnapshot(expectedRows, version + 1),
      commit: (event) => { committedRows = event.rows; },
    });
    actualRows = committedRows;
    productionObservation = {
      serverOperations: serverReceipt.scenario.randomizedOperations,
      serverFreshQueryComparisons:
        serverReceipt.runtimeAssertions.randomizedFreshQueryComparisons,
      clientLiveSnapshotCommitted: true,
      seededWriteKind: ['public-grant', 'owner-grant', 'owner-revoke'][writeKind],
    };
    proof.revision = null;
    proof.revisionSource = 'ordinary-live-snapshot-has-no-invalidation-revision';
    proof.scope.kind = null;
    proof.scopeSource = 'production-query-namespace-without-a-resync-scope';
    disposition = 'retain';
    dispositionReason = 'ordinary-row-write-matcher-requery';
  } else if (scenario === 'deployment-activation') {
    const fence = createLiveFence({ namespace, rows: initiallyAuthorized, version });
    const nextAuthorization = { incarnation: NEXT_INCARNATION, epoch: 0 };
    const boundary = [];
    const replaced = fence.replaceAuthenticatedExpectation({
      issuerId: liveIssuer(NEXT_INCARNATION, 1),
      authorization: nextAuthorization,
      versionStream: `stream-property-deployment-${caseIndex}`,
      snapshot: {
        rows: fullAuthorizationRequery(sourceRows),
        version: 1,
        witness: liveWitness({
          authorization: nextAuthorization,
          versionStream: `stream-property-deployment-${caseIndex}`,
          minCommitVersion: 1,
        }),
      },
      commit: (event) => boundary.push(event.kind),
    });
    expectedRows = fullAuthorizationRequery(sourceRows, { authorityValid: false });
    actualRows = fence.isRenderable() ? initiallyAuthorized : [];
    productionObservation = {
      disposition: replaced.disposition,
      boundary: boundary.at(-1),
      activationEpoch: deploymentReceipt.activationEpoch,
      missingPredecessorObserved: deploymentReceipt.missingPredecessorObserved,
    };
    proof.scope.kind = null;
    proof.scopeSource = 'authenticated-expectation-replacement-without-a-resync-scope';
    proof.revision = deploymentReceipt.activationEpoch;
    proof.revisionSource = 'production-activation-epoch';
    proof.compositeWitness = {
      authorization: {
        incarnation: '<next-authenticated-uuid-v7>',
        epoch: nextAuthorization.epoch,
      },
      data: {
        versionStream: '<next-authenticated-version-stream>',
        minCommitVersion: 1,
      },
    };
    disposition = 'delete';
    dispositionReason = 'authenticated-deployment-identity-change';
  } else if (scenario === 'lease-expiry' || scenario === 'clock-rollback') {
    const queryKey = `property:${scenario}:${caseIndex}`;
    const { store } = await createAuthorizedStore();
    const clientNowMs = 1_000 + (caseIndex * 20);
    const installed = await installQuery({
      store,
      queryKey,
      version,
      rows: initiallyAuthorized,
      clientNowMs,
    });
    proof.scope.namespace.queryKey = queryKey;
    proof.scope.namespace.queryInstanceId = installed.namespace.queryInstanceId;
    proof.revision = installed.fence.queryGeneration;
    proof.revisionSource = 'production-client-query-generation';
    proof.scope.kind = null;
    proof.scopeSource = 'production-retained-query-namespace-without-a-resync-scope';
    proof.compositeWitness = normalizedPropertyWitness(version);
    if (scenario === 'lease-expiry') {
      await assertCode('SNAPBACK_AUTHORIZED_LEASE_EXPIRED', () => (
        store.getAuthorizedRetainedQuery(queryKey, {
          fence: installed.fence,
          clientNowMs: clientNowMs + 1_001,
        }, EXPECTED)
      ));
      dispositionReason = 'authorized-lease-expired';
    } else {
      await store.getAuthorizedRetainedQuery(queryKey, {
        fence: installed.fence,
        clientNowMs: clientNowMs + 10,
      }, EXPECTED);
      await assertCode('SNAPBACK_AUTH_CLOCK_ROLLBACK', () => (
        store.getAuthorizedRetainedQuery(queryKey, {
          fence: installed.fence,
          clientNowMs: clientNowMs + 9,
        }, EXPECTED)
      ));
      dispositionReason = 'client-clock-rollback';
    }
    const after = await store.snapshot();
    expectedRows = fullAuthorizationRequery(sourceRows, { leaseValid: false });
    actualRows = after.retained[queryKey]?.rows ?? [];
    productionObservation = {
      retainedPayloadDeleted: after.retained[queryKey] === undefined,
      effectiveDisposition: after.queryAuthorization[queryKey].effectiveDisposition,
      durableDeleteTombstoneCommitted:
        after.queryAuthorization[queryKey].queryGeneration > installed.fence.queryGeneration,
    };
    disposition = 'delete';
  } else if (scenario === 'overflow') {
    const children = [0, 1].map((childIndex) => {
      const childNamespace = liveNamespace(queryInstanceId + childIndex);
      const fence = createLiveFence({
        namespace: childNamespace,
        rows: initiallyAuthorized,
        version,
      });
      const obligation = liveObligation({
        namespace: childNamespace,
        revision,
        minCommitVersion: version + 1,
      });
      const accepted = fence.receiveObligation(obligation, { commit() {} });
      return { fence, obligation, accepted };
    });
    const remaining = [children.length];
    for (const child of children) {
      const applied = child.fence.applyResolution({
        fence: child.accepted.fence,
        resolution: liveResolution(child.obligation),
        snapshot: propertySnapshot(initiallyAuthorized, version + 1),
        commit: (event) => { child.committedRows = event.rows; },
      });
      child.fence.acknowledge(applied.ackToken);
      remaining.push(remaining.at(-1) - 1);
    }
    assert.deepEqual(remaining, [2, 1, 0]);
    assert.deepEqual(remaining, [
      overflowReceipt.authScopedChildren,
      overflowReceipt.remainingAfterFirstAck,
      overflowReceipt.remainingAfterAllAcks,
    ]);
    expectedRows = fullAuthorizationRequery(sourceRows);
    actualRows = children.every(({ fence }) => fence.isRenderable())
      ? children[0].committedRows
      : [];
    for (const child of children) assertOracleRows(child.committedRows, expectedRows, scenario);
    productionObservation = {
      overflowSentinelObserved: overflowReceipt.overflowSentinelObserved,
      rootRemainingTrace: remaining,
    };
    disposition = 'retain';
    dispositionReason = 'connection-overflow-root-expanded-to-auth-scoped-children';
  } else if (scenario === 'disconnect-and-fresh-resume' || scenario === 'restart') {
    const predecessor = createLiveFence({ namespace, rows: initiallyAuthorized, version });
    const pending = liveObligation({ namespace, revision, minCommitVersion: version + 1 });
    predecessor.receiveObligation(pending, { commit() {} });
    const successorNamespace = liveNamespace(queryInstanceId + 10_000);
    const successor = createLiveFence({
      namespace: successorNamespace,
      rows: initiallyAuthorized,
      version: version + 1,
    });
    let staleCode = null;
    try {
      successor.receiveObligation(pending, { commit() {} });
    } catch (error) {
      staleCode = error?.code ?? null;
    }
    let committedRows = null;
    successor.applyLiveSnapshot({
      fence: successor.capture(),
      snapshot: propertySnapshot(initiallyAuthorized, version + 2),
      commit: (event) => { committedRows = event.rows; },
    });
    expectedRows = fullAuthorizationRequery(sourceRows);
    actualRows = committedRows;
    productionObservation = {
      predecessorInstance: namespace.queryInstanceId,
      successorInstance: successorNamespace.queryInstanceId,
      delayedPredecessorFrameCode: staleCode,
      ...(scenario === 'restart' ? {
        serverIncarnationPreserved:
          serverReceipt.runtimeAssertions.ordinaryRestartPreservedIncarnation,
        serverNewIssuerInstalled: serverReceipt.runtimeAssertions.restartInstalledNewIssuer,
        serverFreshSnapshotConverged:
          serverReceipt.runtimeAssertions.restartInitialSnapshotConverged,
      } : {}),
    };
    disposition = 'retain';
    dispositionReason = scenario === 'restart'
      ? 'process-local-scope-ended-on-restart'
      : 'connection-ended-and-new-query-instance-installed';
  } else if (scenario === 'response-loss' || scenario === 'ack-loss') {
    const fence = createLiveFence({ namespace, rows: initiallyAuthorized, version });
    const pending = liveObligation({ namespace, revision, minCommitVersion: version + 1 });
    const accepted = fence.receiveObligation(pending, { commit() {} });
    let committedRows = null;
    const applied = fence.applyResolution({
      fence: accepted.fence,
      resolution: liveResolution(pending),
      snapshot: propertySnapshot(initiallyAuthorized, version + 1),
      commit: (event) => { committedRows = event.rows; },
    });
    let replayStatus = null;
    if (scenario === 'ack-loss') {
      const replay = fence.receiveObligation(pending, {
        commit: () => assert.fail('applied proof must re-fire without another commit'),
      });
      replayStatus = replay.status;
      assert.equal(replay.ackToken, applied.ackToken);
    }
    fence.acknowledge(applied.ackToken);
    expectedRows = fullAuthorizationRequery(sourceRows);
    actualRows = committedRows;
    productionObservation = scenario === 'response-loss' ? {
      discardedServerResponseDrains:
        serverReceipt.runtimeMeasurements.membershipChurn.discardedResponseDrains
        + serverReceipt.runtimeMeasurements.randomizedWrites.discardedResponseDrains,
      reprojectedServerSnapshotFrames:
        serverReceipt.runtimeMeasurements.membershipChurn.reprojectedSnapshotFrames
        + serverReceipt.runtimeMeasurements.randomizedWrites.reprojectedSnapshotFrames,
      reprojectedClientResolutionApplied: true,
    } : {
      replayStatus,
      sameAckTokenRefired: replayStatus === 'applied',
      acknowledgementStatus: 'acknowledged',
    };
    disposition = 'retain';
    dispositionReason = scenario === 'response-loss'
      ? 'level-triggered-response-reprojection'
      : 'resolution-applied-before-ack-loss';
  } else if (scenario === 'stale-callback' || scenario === 'cross-tab-write') {
    const queryKey = `property:${scenario}:${caseIndex}`;
    const { durable, store } = await createAuthorizedStore();
    const clientNowMs = 1_000 + (caseIndex * 20);
    const installed = await installQuery({
      store,
      queryKey,
      version,
      rows: initiallyAuthorized,
      clientNowMs,
    });
    proof.scope.namespace.queryKey = queryKey;
    proof.scope.namespace.queryInstanceId = installed.namespace.queryInstanceId;
    const peer = createMemorySnapbackClientStore({ state: durable });
    const peerCapture = await peer.captureAuthorizedRetainedQuery(queryKey, EXPECTED);
    const pending = retainedObligation({
      namespace: installed.namespace,
      revision,
      minCommitVersion: version + 1,
    });
    proof.revision = pending.revision;
    proof.revisionSource = 'executed-resync-obligation';
    const accepted = await store.receiveRetainedQueryObligation(
      queryKey,
      pending,
      installed.fence,
      EXPECTED,
    );
    let staleCode = null;
    try {
      await peer.putAuthorizedRetainedQuery(queryKey, {
        fence: peerCapture.fence,
        record: record(version + 1, initiallyAuthorized),
        clientNowMs: clientNowMs + 10,
      }, EXPECTED);
    } catch (error) {
      staleCode = error?.code ?? null;
    }
    const hidden = await store.getAuthorizedRetainedQuery(queryKey, {
      fence: accepted.fence,
      clientNowMs: clientNowMs + 11,
    }, EXPECTED);
    expectedRows = fullAuthorizationRequery(sourceRows, { invalidationPending: true });
    actualRows = hidden?.rows ?? [];
    productionObservation = {
      sharedDurableStore:
        peerCapture.namespace.clientStoreId === installed.namespace.clientStoreId,
      stalePredecessorCode: staleCode,
      retainedPayloadPhysicallyPresent:
        (await store.snapshot()).retained[queryKey] !== undefined,
    };
    disposition = 'quarantine';
    dispositionReason = scenario === 'stale-callback'
      ? 'predecessor-query-generation-callback'
      : 'cross-tab-predecessor-fence-write';
  } else if (scenario === 'disposition-escalation') {
    const fence = createLiveFence({ namespace, rows: initiallyAuthorized, version });
    const quarantine = liveObligation({
      namespace,
      revision,
      minCommitVersion: version + 1,
    });
    fence.receiveObligation(quarantine, { commit() {} });
    const deletion = liveObligation({
      namespace,
      revision: revision + 1,
      disposition: 'delete',
      minCommitVersion: version + 2,
    });
    const terminal = fence.receiveObligation(deletion, { commit() {} });
    fence.applyResolution({
      fence: terminal.fence,
      resolution: liveResolution(deletion, 'terminalDelete'),
      commit: (event) => assert.equal(event.kind, 'delete'),
    });
    expectedRows = fullAuthorizationRequery(sourceRows, { terminal: true });
    actualRows = fence.isRenderable() ? initiallyAuthorized : [];
    productionObservation = {
      serverTerminalDisposition:
        serverReceipt.runtimeAssertions.terminalEscalationDisposition,
      clientTerminalDisposition: fence.disposition(),
    };
    disposition = 'delete';
    dispositionReason = 'trusted-denial-escalated-quarantine-to-delete';
  } else {
    assert.fail(`unhandled property scenario ${scenario}`);
  }

  assertOracleRows(actualRows, expectedRows, scenario);
  assert.ok(['retain', 'quarantine', 'delete'].includes(disposition));
  return {
    ...proof,
    disposition,
    dispositionReason: {
      value: dispositionReason,
      source: 'executed-state-machine-event',
    },
    oracle: {
      kind: 'independent-full-requery-and-full-authorization-reference-model',
      sourceRowCount: sourceRows.length,
      expectedAuthorizedRowIds: canonicalRows(expectedRows).map(({ id }) => id),
      productionAuthorizedRowIds: canonicalRows(actualRows).map(({ id }) => id),
      matched: true,
    },
    productionObservation,
    passed: true,
  };
};

const runSeededPropertyOracleCorpus = async (receipts) => {
  const random = deterministicRandom(PROPERTY_SEED);
  const schedule = [];
  for (let trial = 0; trial < PROPERTY_TRIALS_PER_EVENT; trial += 1) {
    const events = [...PROPERTY_EVENT_UNIVERSE];
    for (let index = events.length - 1; index > 0; index -= 1) {
      const swap = random.next() % (index + 1);
      [events[index], events[swap]] = [events[swap], events[index]];
    }
    schedule.push(...events);
  }
  const cases = [];
  for (const [caseIndex, scenario] of schedule.entries()) {
    cases.push(await exercisePropertyCase({ scenario, caseIndex, random, ...receipts }));
  }
  const matrix = PROPERTY_EVENT_UNIVERSE.map((scenario) => {
    const scenarioCases = cases.filter((entry) => schedule[entry.caseIndex] === scenario);
    assert.equal(scenarioCases.length, PROPERTY_TRIALS_PER_EVENT);
    assert.equal(scenarioCases.every(({ passed }) => passed), true);
    return { scenario, passed: true, cases: scenarioCases };
  });
  return {
    kind: 'deterministic-seeded-randomized-state-machine',
    seed: `0x${PROPERTY_SEED.toString(16)}`,
    trialsPerEvent: PROPERTY_TRIALS_PER_EVENT,
    eventUniverse: PROPERTY_EVENT_UNIVERSE,
    randomizedSchedule: schedule,
    totalCases: cases.length,
    fullRequeryAndAuthorizationComparisons: cases.length,
    matrix,
  };
};

const main = async () => {
  const serverReceipt = runRustReceipt(
    'local::authorization_acceptance::permission_fields_churn_and_randomized_oracle_emit_the_committed_receipt',
    'SNAPBACK_AUTH_ACCEPTANCE_SERVER_RECEIPT',
  );
  const overflowReceipt = runRustReceipt(
    'local::tests::overflow_root_waits_for_every_auth_scoped_child',
    'SNAPBACK_AUTH_ACCEPTANCE_OVERFLOW_RECEIPT',
  );
  const deploymentReceipt = runRustReceipt(
    'storage::guarded_commit_tests::activation_and_ordinary_writes_preserve_the_closed_event_universe',
    'SNAPBACK_AUTH_ACCEPTANCE_DEPLOYMENT_RECEIPT',
  );
  const roomReceipt = runRustReceipt(
    'local::auth_room_kick_acceptance::card_game_kick_composes_durable_and_room_authority_boundaries',
    'SNAPBACK_AUTH_ACCEPTANCE_ROOM_RECEIPT',
  );
  const serverSample = serverReceipt.serverObligation.sample.compositeWitness;
  const serverWitnessFloor = {
    authorizationEpoch: serverSample.authorization.epoch,
    minCommitVersion: serverSample.data.minCommitVersion,
  };
  assert.equal(AUTHORIZATION.epoch, serverWitnessFloor.authorizationEpoch);
  const visibility = await measureVisibilityLifecycle(serverWitnessFloor);
  const blastRadius = await measureMembershipBlastRadius({
    lifecycleReplay: serverReceipt.membershipLifecycleReplay,
    expectedQueryCount: serverReceipt.scenario.unrelatedQueriesDuringPermissionChurn,
    productionServerTrafficCounts: serverReceipt.runtimeMeasurements.membershipChurn,
  });
  const live = exerciseLiveClientScenarios();
  const propertyCorpus = await runSeededPropertyOracleCorpus({
    serverReceipt,
    overflowReceipt,
    deploymentReceipt,
  });
  const roomPauseValues = Object.values(roomReceipt.pausePoints);
  const protectedRoomPassed = roomPauseValues.length === 5
    && roomPauseValues.every((value) => value === true)
    && roomReceipt.unrelatedRoomProgressWhileAffectedPending.registration
    && roomReceipt.unrelatedRoomProgressWhileAffectedPending.publishAndDrain
    && roomReceipt.postCommit.kickedDurableBoardRows === 0
    && roomReceipt.postCommit.kickedOpponentPresenceFrames === 0;
  assert.equal(protectedRoomPassed, true);

  const report = {
    schemaVersion: 2,
    rfc: 'LLP 0053',
    reportKind: 'composed-production-acceptance',
    measurementSemantics: {
      timingUnit: 'committed-client-store-transitions',
      wallClockLatencyClaimed: false,
      retainedByteDefinition: 'UTF-8 bytes of JSON-serialized retained payload records',
      rustInputs: 'machine-readable receipts emitted by executed production Rust acceptance tests',
      clientInputs: 'measurements collected from production @snapback/contract modules in this process',
      oracleInputs:
        'deterministically seeded source rows evaluated by an independent full-query/full-authorization reference model',
    },
    composedMeasurements: {
      hiddenViewAndRecovery: visibility,
      membershipChurnBlastRadius: blastRadius,
    },
    propertyOracleCorpus: {
      kind: propertyCorpus.kind,
      seed: propertyCorpus.seed,
      trialsPerEvent: propertyCorpus.trialsPerEvent,
      eventUniverse: propertyCorpus.eventUniverse,
      randomizedSchedule: propertyCorpus.randomizedSchedule,
      totalCases: propertyCorpus.totalCases,
      fullRequeryAndAuthorizationComparisons:
        propertyCorpus.fullRequeryAndAuthorizationComparisons,
    },
    propertyOracleMatrix: propertyCorpus.matrix,
    supplementalAssertions: {
      protectedRoomPausePoints: {
        passed: protectedRoomPassed,
        receipt: roomReceipt,
      },
      deterministicSinglePathCompatibility: {
        passed: live.deployment.passed
          && live.disconnect.delayedPredecessorFrameRejected
          && live.dispositionEscalation.ackLossRefiredSameToken,
        observations: live,
      },
    },
    productionRustReceipts: {
      server: serverReceipt,
      deployment: deploymentReceipt,
      overflow: overflowReceipt,
      protectedRoom: roomReceipt,
    },
  };

  if (process.argv.includes('--print')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
  assert.deepEqual(report, expected, 'composed LLP 0053 acceptance receipt drifted');
  console.log(
    `LLP 0053 composed acceptance: ${report.propertyOracleMatrix.length} scenarios passed; receipt matched`,
  );
};

await main();
