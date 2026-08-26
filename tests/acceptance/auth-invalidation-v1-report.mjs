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
const PROPERTY_CORPUS_PATH = resolve(
  ROOT,
  'tests/acceptance/auth-invalidation-v1-property-corpus.json',
);
const PROPERTY_CORPUS_CONFIG = Object.freeze(JSON.parse(
  readFileSync(PROPERTY_CORPUS_PATH, 'utf8'),
));

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const NEXT_INCARNATION = '018f0d90-7b12-7a22-8c33-445566778899';
const AUTHORITY_INSTANCE = '018f0d90-7b13-7a22-8c33-445566778899';
const USER = '018f0d90-7b14-7a22-8c33-445566778899';
const AUTHORITY_KEY = `sha256:${'a'.repeat(64)}`;
const APP_ID = 'llp-0053-composed-acceptance';
const TARGET_PROFILE_ID = 'local-dev-sqlite-ibex';
const SCHEMA_HASH = 'llp-0053-authorization-shapes-v1';
const INPUTS_HASH = 'llp-0053-authorization-inputs-v1';
const DATABASE_ID = 'llp-0053-composed-acceptance-db';
const VERSION_STREAM = 'stream-0053';
const ACTIVATION_HASH = `snapback.authorized-lease.activation.v1:sha256:${'b'.repeat(64)}`;
const ARTIFACT_SCOPE_FIELDS = Object.freeze([
  'schemaHash',
  'inputsHash',
  'targetProfileId',
  'appId',
  'databaseId',
  'versionStreamId',
]);
// The epoch is checked against the executed Rust receipt before any client
// measurement runs. The local UUID supplies a structurally valid replacement
// for the receipt's deliberately normalized authenticated incarnation.
const AUTHORIZATION = Object.freeze({ incarnation: INCARNATION, epoch: 10 });
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

const runRustReceipts = (packageName, testName, markers) => {
  const completed = spawnSync(
    'cargo',
    ['test', '-p', packageName, '--lib', testName, '--', '--exact', '--nocapture'],
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
  return Object.fromEntries(markers.map((marker) => {
    const prefix = `${marker}=`;
    const line = output.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
    if (line === undefined) {
      throw new Error(`Rust acceptance ${testName} emitted no ${marker} record:\n${output}`);
    }
    return [marker, JSON.parse(line.slice(prefix.length))];
  }));
};

const runRustReceipt = (packageName, testName, marker) => (
  runRustReceipts(packageName, testName, [marker])[marker]
);

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
  principalId = USER,
  authorityInstanceId = AUTHORITY_INSTANCE,
  activationHash = ACTIVATION_HASH,
}) => ({
  protocolVersion: 1,
  leaseId: `lease_${version}`,
  leaseRequestId: requestId,
  issuerId,
  clientStoreId: namespace.clientStoreId,
  queryKey,
  queryInstanceId: namespace.queryInstanceId,
  principalId,
  sessionIdAtIssue: 'session-0053',
  providerKey: 'email-code',
  authorization,
  data: { versionStream, snapshotCommitVersion: version },
  activationHash,
  issuedAtServerMs: 10_000,
  authorizedUntilServerMs: 10_000 + durationMs,
  sessionNotAfterMs: 10_000 + durationMs,
  providerNotAfterMs: null,
  authorityInstanceId,
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

const createAuthorizedStore = async ({
  versionStream = VERSION_STREAM,
  principalScope = PRINCIPAL_SCOPE,
  authorityDescriptor = AUTHORITY_DESCRIPTOR,
  schemaHash = SCHEMA_HASH,
  inputsHash = INPUTS_HASH,
  appId = APP_ID,
  targetProfileId = TARGET_PROFILE_ID,
  databaseId = DATABASE_ID,
  origin = null,
  queryInstanceHighWater = null,
} = {}) => {
  const durable = {};
  // Construct a valid persisted format-5 state first, then replay the exact
  // client-owned namespace that the production server frame names. Reopening
  // this state exercises the normal production hydration/validation path.
  createMemorySnapbackClientStore({ state: durable });
  if (origin !== null) durable.origin = origin;
  if (queryInstanceHighWater !== null) {
    durable.queryInstanceHighWater = queryInstanceHighWater;
  }
  const store = createMemorySnapbackClientStore({ state: durable });
  await store.bindAuthority(EXPECTED);
  await store.scopeToArtifacts({
    schemaHash,
    inputsHash,
    appId,
    targetProfileId,
    databaseId,
    versionStreamId: versionStream,
  }, EXPECTED);
  await store.scopeAuthorization({
    principalScope,
    authorityDescriptor,
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
  principalId = USER,
  authorityInstanceId = AUTHORITY_INSTANCE,
  activationHash = ACTIVATION_HASH,
  appId = APP_ID,
  targetProfileId = TARGET_PROFILE_ID,
}) => {
  const initialized = await store.initializeAuthorizedRetainedQuery(queryKey, {
    authorization,
    issuerId,
    versionStream,
    principalId,
    activationHash,
    appId,
    targetProfileId,
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
      principalId,
      authorityInstanceId,
      activationHash,
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

// @ref LLP 0053#acceptance — replay the server's exact raw lifecycle in the
// principal- and artifact-scoped production client store before normalization.
const measureMembershipBlastRadius = async ({
  rawTransitions,
  normalizedTransitions,
  expectedQueryCount,
  productionServerTrafficCounts,
}) => {
  assert.equal(rawTransitions.length, normalizedTransitions.length);
  const perQueryLifecycle = [];
  const perScopeQueueLifecycle = [];
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

  for (const rawTransition of rawTransitions) {
    const stable = normalizedTransitions.find((candidate) => (
      candidate.eventIndex === rawTransition.eventIndex
      && candidate.queryIndex === rawTransition.queryIndex
    ));
    assert.ok(stable, 'raw production transition has a normalized receipt peer');
    const replay = rawTransition.rawReplay;
    const obligation = replay.obligation;
    const resolution = replay.resolution;
    const snapshot = replay.snapshot;
    const serverAcknowledgement = replay.serverAcknowledgement;
    const namespace = obligation.scopeId.namespace;
    const authorization = obligation.witness.authorization;
    const issuerId = obligation.scopeId.issuerId;
    const obligationVersionStream = obligation.witness.data.versionStream;
    const { principalScope, authorityDescriptor, artifactScope } = replay;
    assert.deepEqual(Object.keys(artifactScope).sort(), [
      ...ARTIFACT_SCOPE_FIELDS,
      'activationHash',
    ].sort());
    assert.deepEqual(replay.scopeId, obligation.scopeId);
    assert.deepEqual(replay.issuerId, obligation.scopeId.issuerId);
    assert.equal(artifactScope.versionStreamId, obligationVersionStream);
    assert.equal(serverAcknowledgement.input.ackToken, resolution.ackToken);
    assert.deepEqual(serverAcknowledgement.connection.issuerId, replay.issuerId);
    assert.equal(serverAcknowledgement.output.outcome, replay.serverAcknowledgementOutcome);
    assert.deepEqual(rawTransition.productionScope, {
      kind: obligation.scopeId.kind,
      queryKey: namespace.queryKey,
      queryInstanceId: namespace.queryInstanceId,
    });
    assert.equal(stable.scope.queryKey, namespace.queryKey);
    assert.equal(stable.scope.queryInstanceId, namespace.queryInstanceId);
    assert.equal(stable.revision, obligation.revision);
    assert.equal(stable.compositeWitness.authorization.epoch, authorization.epoch);
    assert.equal(
      stable.compositeWitness.data.minCommitVersion,
      obligation.witness.data.minCommitVersion,
    );
    assert.equal(stable.snapshot.commitVersion, snapshot.version);
    assert.equal(stable.snapshot.rowCount, snapshot.rows.length);
    assert.equal(stable.acknowledgementOutcome, replay.serverAcknowledgementOutcome);

    const { store } = await createAuthorizedStore({
      versionStream: artifactScope.versionStreamId,
      principalScope,
      authorityDescriptor,
      schemaHash: artifactScope.schemaHash,
      inputsHash: artifactScope.inputsHash,
      appId: artifactScope.appId,
      targetProfileId: artifactScope.targetProfileId,
      databaseId: artifactScope.databaseId,
      origin: namespace.clientStoreId,
      queryInstanceHighWater: namespace.queryInstanceId - 1,
    });
    const scopedStore = await store.snapshot();
    assert.deepEqual(scopedStore.artifactScope, {
      schemaHash: artifactScope.schemaHash,
      inputsHash: artifactScope.inputsHash,
      targetProfileId: artifactScope.targetProfileId,
      appId: artifactScope.appId,
      databaseId: artifactScope.databaseId,
      versionStreamId: artifactScope.versionStreamId,
    });
    const queryKey = namespace.queryKey;
    const clientNowMs = 1_000;
    const installed = await installQuery({
      store,
      queryKey,
      version: replay.initialSnapshot.version,
      rows: replay.initialSnapshot.rows,
      clientNowMs,
      authorization,
      issuerId,
      versionStream: artifactScope.versionStreamId,
      principalId: principalScope.userId,
      authorityInstanceId: authorityDescriptor.authorityInstanceId,
      activationHash: artifactScope.activationHash,
      appId: artifactScope.appId,
      targetProfileId: artifactScope.targetProfileId,
    });
    assert.deepEqual(installed.namespace, namespace);

    let queueCapture = await store.captureMutationQueue(EXPECTED);
    const expectedMutationIds = [0, 1].map((mutationIndex) => (
      `cm_membership_${rawTransition.eventIndex}_${rawTransition.queryIndex}_${mutationIndex}`
    ));
    for (const [mutationIndex, mutationId] of expectedMutationIds.entries()) {
      await store.enqueueMutation({
        id: mutationId,
        function: `write${mutationIndex}`,
        args: {
          eventIndex: rawTransition.eventIndex,
          queryIndex: rawTransition.queryIndex,
          mutationIndex,
        },
        authorityDescriptor,
        schemaHash: artifactScope.schemaHash,
        inputsHash: artifactScope.inputsHash,
        appId: artifactScope.appId,
        targetProfileId: artifactScope.targetProfileId,
        databaseId: artifactScope.databaseId,
        versionStreamId: artifactScope.versionStreamId,
        cursor: {
          stream: artifactScope.versionStreamId,
          version: replay.initialSnapshot.version,
        },
        ...EXPECTED,
        ...queueCapture,
      });
    }
    const before = await store.snapshot();
    for (const queued of before.pending) {
      for (const field of ARTIFACT_SCOPE_FIELDS) {
        assert.equal(queued[field], scopedStore.artifactScope[field]);
      }
    }
    const bytesBefore = byteLength(before.retained[queryKey]);
    const pendingMutationsBefore = before.pending.length;

    const accepted = await store.receiveRetainedQueryObligation(
      queryKey,
      obligation,
      installed.fence,
      EXPECTED,
    );
    clientObligationApplications += 1;
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.disposition, 'quarantine');
    const hiddenRead = await store.getAuthorizedRetainedQuery(queryKey, {
      fence: accepted.fence,
      clientNowMs: clientNowMs + 2,
    }, EXPECTED);
    assert.equal(hiddenRead, null);
    const during = await store.snapshot();
    const bytesDuring = byteLength(during.retained[queryKey]);
    assert.equal(bytesDuring, bytesBefore);
    const queryStateDuring = during.queryAuthorization[queryKey];
    const quarantineFenceCommitted = queryStateDuring.effectiveDisposition === 'quarantine'
      && queryStateDuring.queryGeneration > installed.fence.queryGeneration;
    assert.equal(quarantineFenceCommitted, true);
    durableQuarantineFenceWrites += 1;
    const deleteTombstoneWritten = queryStateDuring.effectiveDisposition === 'delete';
    assert.equal(deleteTombstoneWritten, false);
    durableDeleteTombstonesWrittenDuringQuarantine += Number(deleteTombstoneWritten);

    queueCapture = await store.applyMutationQueueObligation(
      obligation,
      { ...EXPECTED, ...queueCapture },
    );
    clientQueueObligationApplications += 1;
    assert.equal(queueCapture.suspended, true);
    assert.equal(queueCapture.pendingScopeCount, 1);
    await assertCode('SNAPBACK_CLIENT_QUEUE_SUSPENDED', () => (
      store.pendingMutations({ ...EXPECTED, ...queueCapture })
    ));
    assert.equal((await store.snapshot()).pending.length, pendingMutationsBefore);

    const resolved = await store.applyRetainedQueryResolution(queryKey, {
      fence: accepted.fence,
      resolution,
      record: record(snapshot.version, snapshot.rows, artifactScope.versionStreamId),
    }, EXPECTED);
    clientResolutionApplications += 1;
    assert.equal(resolved.ackToken, resolution.ackToken);
    assert.equal(replay.serverAcknowledgementOutcome, 'discharged');
    assert.equal((await store.snapshot()).queryAuthorization[queryKey].lease, null);
    const request = await store.beginAuthorizedLeaseRequest(queryKey, {
      fence: resolved.fence,
      leaseRequestId: `request_recovery_${rawTransition.eventIndex}_${rawTransition.queryIndex}`,
      clientNowMs: clientNowMs + 3,
    }, EXPECTED);
    clientLeaseRequests += 1;
    const recovered = await store.commitAuthorizedRetainedSnapshot(queryKey, {
      fence: request.fence,
      lease: lease({
        queryKey,
        namespace,
        requestId: request.request.leaseRequestId,
        version: snapshot.version,
        authorization,
        issuerId,
        versionStream: artifactScope.versionStreamId,
        principalId: principalScope.userId,
        authorityInstanceId: authorityDescriptor.authorityInstanceId,
        activationHash: artifactScope.activationHash,
      }),
      record: record(snapshot.version, snapshot.rows, artifactScope.versionStreamId),
      clientNowMs: clientNowMs + 4,
    }, EXPECTED);
    clientAuthorizedSnapshotCommits += 1;
    assert.deepEqual((await store.getAuthorizedRetainedQuery(queryKey, {
      fence: recovered.fence,
      clientNowMs: clientNowMs + 5,
    }, EXPECTED)).rows, snapshot.rows);

    queueCapture = await store.resolveMutationQueueObligation(
      resolution,
      { ...EXPECTED, ...queueCapture },
    );
    clientQueueResolutionApplications += 1;
    assert.equal(queueCapture.suspended, false);
    assert.equal(queueCapture.pendingScopeCount, 0);
    const releasedMutationIds = (await store.pendingMutations({
      ...EXPECTED,
      ...queueCapture,
    })).map(({ id }) => id);
    assert.deepEqual(releasedMutationIds, expectedMutationIds);

    retainedPayloadBytesBefore += bytesBefore;
    retainedPayloadBytesDuringQuarantine += bytesDuring;
    perScopeQueueLifecycle.push({
      eventIndex: rawTransition.eventIndex,
      eventKind: rawTransition.eventKind,
      queryIndex: rawTransition.queryIndex,
      principalId: principalScope.userId,
      clientStoreId: namespace.clientStoreId,
      queryInstanceId: namespace.queryInstanceId,
      revision: obligation.revision,
      pendingMutationsBefore,
      suspendedMutationCount: during.pending.length,
      pendingScopeCountAtFullSuspension: 1,
      releasedAfterExactScopeResolution: true,
      releasedMutationIds,
    });
    perQueryLifecycle.push({
      eventIndex: stable.eventIndex,
      eventKind: stable.eventKind,
      queryIndex: stable.queryIndex,
      productionQuery: stable.query,
      productionScope: {
        ...stable.scope,
        clientStoreId: namespace.clientStoreId,
      },
      revision: stable.revision,
      compositeWitness: stable.compositeWitness,
      disposition: stable.disposition,
      dispositionReason: stable.dispositionReason,
      proofPath: stable.proofPath,
      fullRequeryAndAuthorizationMatched: stable.fullRequeryAndAuthorizationMatched,
      serverSnapshotCommitVersion: stable.snapshot.commitVersion,
      serverSnapshotRowCount: stable.snapshot.rowCount,
      serverResolutionKind: stable.resolutionKind,
      serverAcknowledgementOutcome: stable.acknowledgementOutcome,
      clientLifecycle: {
        exactProductionScopeReplayed: true,
        exactProductionArtifactScopeReplayed: true,
        artifactScopeFieldsReplayed: ARTIFACT_SCOPE_FIELDS,
        activationHashMatchedExactProductionReplay: true,
        exactProductionResolutionReplayed: true,
        quarantineCommitted: quarantineFenceCommitted,
        hiddenReadWasNull: true,
        hiddenIntervalTransitions: 3,
        retainedPayloadBytesBefore: bytesBefore,
        retainedPayloadBytesDuringQuarantine: bytesDuring,
        retainedPayloadBytesDeletedByQuarantine: bytesBefore - bytesDuring,
        durableDeleteTombstonesWrittenDuringQuarantine: 0,
        freshSnapshotCommitted: true,
        leaseRevalidated: true,
        recoveredRows: snapshot.rows.length,
        ackTokenMatchedExactProductionResolution: resolved.ackToken === resolution.ackToken,
        serverAcknowledgementRequestAndOutputVerified: true,
        ackTokenNormalization: '<exact-production-ack-token>',
      },
    });
  }

  const eventCount = new Set(rawTransitions.map(({ eventIndex }) => eventIndex)).size;
  assert.equal(perQueryLifecycle.length, rawTransitions.length);
  assert.equal(rawTransitions.length, eventCount * expectedQueryCount);
  assert.equal(durableDeleteTombstonesWrittenDuringQuarantine, 0);
  return {
    membershipChurnEvents: eventCount,
    authScopedQueriesPerEvent: expectedQueryCount,
    completeExactScopeQueryLifecycles: perQueryLifecycle.length,
    retainedPayloadByteAggregation: 'sum-across-nine-isolated-exact-scope-replays',
    retainedPayloadBytesBefore,
    retainedPayloadBytesDuringQuarantine,
    retainedPayloadBytesDeletedByCoarseQuarantine:
      retainedPayloadBytesBefore - retainedPayloadBytesDuringQuarantine,
    durableQuarantineFenceWrites,
    durableDeleteTombstonesWrittenDuringQuarantine,
    perScopeQueueSemantics: 'one principal-owned queue per production client-store scope',
    queueSuspensionCycles: perScopeQueueLifecycle.length,
    queueReleaseCycles: perScopeQueueLifecycle.length,
    trafficCounts: {
      productionServer: productionServerTrafficCounts,
      clientObligationApplications,
      clientResolutionApplications,
      clientLeaseRequests,
      clientAuthorizedSnapshotCommits,
      clientQueueObligationApplications,
      clientQueueResolutionApplications,
    },
    perScopeQueueLifecycle,
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

// The shared corpus owns source rows; the reference function independently
// owns the authorization predicate. Production client paths receive only the
// rows selected by the executed Rust/Ibex result, never the reference result.
// Composing both halves avoids treating client protocol validation as an
// application-policy evaluator.
const PROPERTY_SEED = Number.parseInt(PROPERTY_CORPUS_CONFIG.seed.slice(2), 16);
const PROPERTY_TRIALS_PER_EVENT = PROPERTY_CORPUS_CONFIG.trialsPerEvent;
const PROPERTY_EVENT_UNIVERSE = Object.freeze(PROPERTY_CORPUS_CONFIG.eventUniverse);

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
  const rows = Array.from({ length: PROPERTY_CORPUS_CONFIG.rowsPerCase }, (_, rowIndex) => ({
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

const rowsSelectedByProduction = (sourceRows, productionIds, label) => {
  const byId = new Map(sourceRows.map((row) => [row.id, row]));
  const rows = productionIds.map((id) => {
    assert.equal(byId.has(id), true, `${label} returned an unknown shared-corpus row ${id}`);
    return structuredClone(byId.get(id));
  });
  return canonicalRows(rows);
};

const buildSharedPropertyCases = () => {
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
  const cases = schedule.map((scenario, caseIndex) => {
    const sourceRows = propertyRows(random, caseIndex);
    const revision = 1 + (random.next() % 100);
    const randomState = `0x${random.state().toString(16).padStart(8, '0')}`;
    const writeKind = scenario === 'randomized-writes'
      ? ['public-grant', 'owner-grant', 'owner-revoke'][random.next() % 3]
      : null;
    return { caseIndex, scenario, randomState, revision, sourceRows, writeKind };
  });
  return { schedule, cases };
};

const exercisePropertyCase = async ({
  productionCase,
  serverReceipt,
  overflowReceipt,
  deploymentReceipt,
}) => {
  const {
    scenario,
    caseIndex,
    randomState,
    revision,
    sourceRows,
    writeKind,
    productionInitialAuthorizedRowIds,
    productionRelevantAuthorizedRowIds,
  } = productionCase;
  const initiallyAuthorized = rowsSelectedByProduction(
    sourceRows,
    productionInitialAuthorizedRowIds,
    `${scenario} production initial query`,
  );
  const independentInitial = fullAuthorizationRequery(sourceRows);
  assertOracleRows(initiallyAuthorized, independentInitial, `${scenario} production initial query`);
  if (scenario !== 'randomized-writes') {
    assert.deepEqual(
      productionRelevantAuthorizedRowIds,
      productionInitialAuthorizedRowIds,
      `${scenario} has no production row mutation between source and protocol transition`,
    );
  }
  const version = 500 + (caseIndex * 3);
  const queryInstanceId = 1_000 + caseIndex;
  const namespace = liveNamespace(queryInstanceId);
  const proof = {
    caseIndex,
    randomState,
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
    const target = updatedRows[writeKind === 'owner-revoke' ? 0 : 1];
    if (writeKind === 'public-grant') target.isPublic = true;
    else if (writeKind === 'owner-grant') target.ownerId = USER;
    else target.ownerId = 'another-principal';
    expectedRows = fullAuthorizationRequery(updatedRows);
    const productionRows = rowsSelectedByProduction(
      updatedRows,
      productionRelevantAuthorizedRowIds,
      `${scenario} production post-mutation query`,
    );
    assertOracleRows(productionRows, expectedRows, `${scenario} production post-mutation query`);
    const fence = createLiveFence({ namespace, rows: initiallyAuthorized, version });
    let committedRows = null;
    fence.applyLiveSnapshot({
      fence: fence.capture(),
      snapshot: propertySnapshot(productionRows, version + 1),
      commit: (event) => { committedRows = event.rows; },
    });
    actualRows = committedRows;
    productionObservation = {
      serverOperations: serverReceipt.scenario.randomizedOperations,
      serverFreshQueryComparisons:
        serverReceipt.runtimeAssertions.randomizedFreshQueryComparisons,
      sharedCorpusProductionFreshQueryMatched: true,
      clientLiveSnapshotCommitted: true,
      seededWriteKind: writeKind,
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
        rows: initiallyAuthorized,
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
    scenario,
    disposition,
    dispositionReason: {
      value: dispositionReason,
      source: 'executed-state-machine-event',
    },
    oracle: {
      kind: 'independent-full-requery-and-full-authorization-reference-model',
      sourceRowCount: sourceRows.length,
      rustProductionFreshQueryComparedBeforeClientInjection: true,
      rustProductionRelevantAuthorizedRowIds: productionRelevantAuthorizedRowIds,
      expectedAuthorizedRowIds: canonicalRows(expectedRows).map(({ id }) => id),
      productionAuthorizedRowIds: canonicalRows(actualRows).map(({ id }) => id),
      matched: true,
    },
    productionObservation,
    passed: true,
  };
};

// @ref LLP 0053#acceptance — keep the model independent while injecting only
// the production Rust/Ibex rows into client protocol objects.
const runSeededPropertyOracleCorpus = async (receipts) => {
  const { propertyReceipt } = receipts;
  const shared = buildSharedPropertyCases();
  assert.equal(PROPERTY_CORPUS_CONFIG.cases.length, shared.cases.length);
  assert.deepEqual(PROPERTY_CORPUS_CONFIG.cases, shared.cases);
  assert.equal(propertyReceipt.seed, PROPERTY_CORPUS_CONFIG.seed);
  assert.equal(propertyReceipt.trialsPerEvent, PROPERTY_TRIALS_PER_EVENT);
  assert.equal(propertyReceipt.rowsPerCase, PROPERTY_CORPUS_CONFIG.rowsPerCase);
  assert.deepEqual(propertyReceipt.eventUniverse, PROPERTY_EVENT_UNIVERSE);
  assert.deepEqual(propertyReceipt.randomizedSchedule, shared.schedule);
  assert.equal(propertyReceipt.totalCases, shared.cases.length);
  assert.equal(propertyReceipt.productionMutations, PROPERTY_TRIALS_PER_EVENT);
  const stableRustInputs = propertyReceipt.cases.map((entry) => ({
    caseIndex: entry.caseIndex,
    scenario: entry.scenario,
    randomState: entry.randomState,
    revision: entry.revision,
    sourceRows: entry.sourceRows,
    writeKind: entry.writeKind,
  }));
  assert.deepEqual(stableRustInputs, PROPERTY_CORPUS_CONFIG.cases);

  const cases = [];
  for (const productionCase of propertyReceipt.cases) {
    cases.push(await exercisePropertyCase({ productionCase, ...receipts }));
  }
  const matrix = PROPERTY_EVENT_UNIVERSE.map((scenario) => {
    const scenarioCases = cases.filter((entry) => entry.scenario === scenario);
    assert.equal(scenarioCases.length, PROPERTY_TRIALS_PER_EVENT);
    assert.equal(scenarioCases.every(({ passed }) => passed), true);
    return { scenario, passed: true, cases: scenarioCases };
  });
  return {
    kind: 'deterministic-seeded-randomized-state-machine',
    seed: `0x${PROPERTY_SEED.toString(16)}`,
    trialsPerEvent: PROPERTY_TRIALS_PER_EVENT,
    eventUniverse: PROPERTY_EVENT_UNIVERSE,
    randomizedSchedule: shared.schedule,
    totalCases: cases.length,
    fullRequeryAndAuthorizationComparisons: cases.length,
    rustProductionFreshQueryComparisons: propertyReceipt.productionFreshQueryComparisons,
    rustProductionMutations: propertyReceipt.productionMutations,
    matrix,
  };
};

const main = async () => {
  const serverReceipts = runRustReceipts(
    'snapback-engine',
    'local::engine::authorization_acceptance::permission_fields_churn_and_randomized_oracle_emit_the_committed_receipt',
    [
      'SNAPBACK_AUTH_ACCEPTANCE_SERVER_RECEIPT',
      'SNAPBACK_AUTH_ACCEPTANCE_SERVER_REPLAY',
    ],
  );
  const serverReceipt = serverReceipts.SNAPBACK_AUTH_ACCEPTANCE_SERVER_RECEIPT;
  const serverReplay = serverReceipts.SNAPBACK_AUTH_ACCEPTANCE_SERVER_REPLAY;
  const propertyReceipt = runRustReceipt(
    'snapback-engine',
    'local::engine::authorization_acceptance::shared_property_corpus_emits_production_fresh_query_receipt',
    'SNAPBACK_AUTH_ACCEPTANCE_PROPERTY_RECEIPT',
  );
  const overflowReceipt = runRustReceipt(
    'snapback-engine',
    'local::engine::tests::engine::overflow_root_waits_for_every_auth_scoped_child',
    'SNAPBACK_AUTH_ACCEPTANCE_OVERFLOW_RECEIPT',
  );
  const deploymentReceipt = runRustReceipt(
    'snapback-kernel',
    'storage::tests::guarded_commit_tests::activation_and_ordinary_writes_preserve_the_closed_event_universe',
    'SNAPBACK_AUTH_ACCEPTANCE_DEPLOYMENT_RECEIPT',
  );
  const roomFrameEnqueueReceipt = runRustReceipt(
    'snapback-engine',
    'local::engine::auth_room_kick_acceptance::frame_construction_before_first_enqueue_is_commit_ordered',
    'SNAPBACK_AUTH_ACCEPTANCE_ROOM_FRAME_ENQUEUE_RECEIPT',
  );
  const roomReceipts = runRustReceipts(
    'snapback-engine',
    'local::engine::auth_room_kick_acceptance::card_game_kick_composes_durable_and_room_authority_boundaries',
    [
      'SNAPBACK_AUTH_ACCEPTANCE_ROOM_RECEIPT',
      'SNAPBACK_AUTH_ACCEPTANCE_ROOM_ENQUEUE_DRAIN_RECEIPT',
      'SNAPBACK_AUTH_ACCEPTANCE_ROOM_DRAIN_SEND_RECEIPT',
    ],
  );
  const roomReceipt = roomReceipts.SNAPBACK_AUTH_ACCEPTANCE_ROOM_RECEIPT;
  const roomEnqueueDrainReceipt =
    roomReceipts.SNAPBACK_AUTH_ACCEPTANCE_ROOM_ENQUEUE_DRAIN_RECEIPT;
  const roomDrainSendReceipt =
    roomReceipts.SNAPBACK_AUTH_ACCEPTANCE_ROOM_DRAIN_SEND_RECEIPT;
  const serverSample = serverReceipt.serverObligation.sample.compositeWitness;
  const serverWitnessFloor = {
    authorizationEpoch: serverSample.authorization.epoch,
    minCommitVersion: serverSample.data.minCommitVersion,
  };
  assert.equal(AUTHORIZATION.epoch, serverWitnessFloor.authorizationEpoch);
  const visibility = await measureVisibilityLifecycle(serverWitnessFloor);
  const blastRadius = await measureMembershipBlastRadius({
    rawTransitions: serverReplay.transitions,
    normalizedTransitions: serverReceipt.membershipLifecycleReplay,
    expectedQueryCount: serverReceipt.scenario.unrelatedQueriesDuringPermissionChurn,
    productionServerTrafficCounts: serverReceipt.runtimeMeasurements.membershipChurn,
  });
  const live = exerciseLiveClientScenarios();
  const propertyCorpus = await runSeededPropertyOracleCorpus({
    serverReceipt,
    overflowReceipt,
    deploymentReceipt,
    propertyReceipt,
  });
  const protectedRoomReceipts = {
    integratedKick: roomReceipt,
    frameConstructionBeforeEnqueue: roomFrameEnqueueReceipt,
    enqueueBeforeDestructiveDrain: roomEnqueueDrainReceipt,
    destructiveDrainBeforeFinalSend: roomDrainSendReceipt,
  };
  const protectedRoomPassed =
    roomReceipt.admissionPausePoints.lookupBeforeRoomMutation
    && roomReceipt.admissionPausePoints.registrationAndInitialSnapshot
    && roomFrameEnqueueReceipt.schedule === 'frame-construction-before-first-enqueue'
    && roomFrameEnqueueReceipt.hookObservedConstructedPredecessor
    && roomFrameEnqueueReceipt.pendingCommitBlockedBeforeFirstEnqueue
    && roomFrameEnqueueReceipt.enqueueCompletedWhilePermitHeld
    && roomFrameEnqueueReceipt.commitBlockedAfterEnqueueWhilePermitHeld
    && roomFrameEnqueueReceipt.commitCompletedAfterPermitDrop
    && roomFrameEnqueueReceipt.predecessorFrameRejectedAfterCommit
    && roomFrameEnqueueReceipt.causingCommitVersion === roomReceipt.causingCommitVersion
    && roomEnqueueDrainReceipt.schedule === 'enqueue-before-destructive-drain'
    && roomEnqueueDrainReceipt.predecessorFrameEnqueueCompleted
    && roomEnqueueDrainReceipt.predecessorFrameEntryVersion > 0
    && roomEnqueueDrainReceipt.predecessorGeneration === 1
    && roomEnqueueDrainReceipt.postCommitDrainDiscardedPredecessor
    && roomEnqueueDrainReceipt.causingCommitVersion === roomReceipt.causingCommitVersion
    && roomDrainSendReceipt.schedule === 'destructive-drain-before-final-send'
    && roomDrainSendReceipt.commitBlockedByProtectedRoomSendPermit
    && roomDrainSendReceipt.commitBlockedByDurableBoardSendPermit
    && roomDrainSendReceipt.predecessorProtectedRoomFrameRejectedAfterCommit
    && roomDrainSendReceipt.predecessorDurableBoardFrameRejectedAfterCommit
    && roomDrainSendReceipt.causingCommitVersion === roomReceipt.causingCommitVersion
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
        'one shared corpus evaluated independently by production Rust Ibex queries and the JavaScript full-query/full-authorization reference model',
      normalizationBoundary:
        'raw server scope, obligation, snapshot, resolution, and ACK values execute before nondeterministic identifiers are normalized for this receipt',
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
      rustProductionFreshQueryComparisons:
        propertyCorpus.rustProductionFreshQueryComparisons,
      rustProductionMutations: propertyCorpus.rustProductionMutations,
    },
    propertyOracleMatrix: propertyCorpus.matrix,
    supplementalAssertions: {
      protectedRoomPausePoints: {
        passed: protectedRoomPassed,
        observations: protectedRoomReceipts,
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
      sharedPropertyCorpus: propertyReceipt,
      deployment: deploymentReceipt,
      overflow: overflowReceipt,
      protectedRoom: protectedRoomReceipts,
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
