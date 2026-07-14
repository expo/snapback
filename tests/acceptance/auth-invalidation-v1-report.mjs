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

const record = (version, rows) => ({
  rows,
  version,
  versionStreamId: VERSION_STREAM,
  cursor: { stream: VERSION_STREAM, version },
});

const lease = ({ queryKey, namespace, requestId, version, durationMs = 1_000 }) => ({
  protocolVersion: 1,
  leaseId: `lease_${version}`,
  leaseRequestId: requestId,
  issuerId: ISSUER,
  clientStoreId: namespace.clientStoreId,
  queryKey,
  queryInstanceId: namespace.queryInstanceId,
  principalId: USER,
  sessionIdAtIssue: 'session-0053',
  providerKey: 'email-code',
  authorization: AUTHORIZATION,
  data: { versionStream: VERSION_STREAM, snapshotCommitVersion: version },
  activationHash: ACTIVATION_HASH,
  issuedAtServerMs: 10_000,
  authorizedUntilServerMs: 10_000 + durationMs,
  sessionNotAfterMs: 10_000 + durationMs,
  providerNotAfterMs: null,
  authorityInstanceId: AUTHORITY_INSTANCE,
  keyId: 'lease-key-0053',
  mac: 'A'.repeat(43),
});

const witness = (minCommitVersion) => ({
  authorization: AUTHORIZATION,
  data: { versionStream: VERSION_STREAM, minCommitVersion },
});

const subscriptionScope = (namespace, sequence = 1) => ({
  kind: 'subscription',
  issuerId: ISSUER,
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
}) => ({
  protocolVersion: 1,
  scopeId: subscriptionScope(namespace),
  revision,
  maxDisposition: disposition,
  witness: witness(minCommitVersion),
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
  witness: witness(minCommitVersion),
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
}) => ({
  protocolVersion: 1,
  scopeId: clientQueryScope(namespace),
  revision,
  maxDisposition: disposition,
  witness: witness(minCommitVersion),
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

const createAuthorizedStore = async () => {
  const durable = {};
  const store = createMemorySnapbackClientStore({ state: durable });
  await store.bindAuthority(EXPECTED);
  await store.scopeToArtifacts({
    appId: APP_ID,
    targetProfileId: TARGET_PROFILE_ID,
    versionStreamId: VERSION_STREAM,
  }, EXPECTED);
  await store.scopeAuthorization({
    principalScope: PRINCIPAL_SCOPE,
    authorityDescriptor: AUTHORITY_DESCRIPTOR,
  }, EXPECTED);
  return { durable, store };
};

const installQuery = async ({ store, queryKey, version, rows, clientNowMs }) => {
  const initialized = await store.initializeAuthorizedRetainedQuery(queryKey, {
    authorization: AUTHORIZATION,
    issuerId: ISSUER,
    versionStream: VERSION_STREAM,
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
    }),
    record: record(version, rows),
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

const measureMembershipBlastRadius = async ({ serverWitnessFloor, expectedQueryCount }) => {
  const { store } = await createAuthorizedStore();
  const fixtures = [];
  for (const [index, queryKey] of [
    'lobby:{"kind":"mine"}',
    'profile:{"kind":"mine"}',
    'notes:{"kind":"mine"}',
  ].entries()) {
    fixtures.push({
      queryKey,
      installed: await installQuery({
        store,
        queryKey,
        version: 200 + index,
        rows: [{ queryKey, private: true }],
        clientNowMs: 3_000 + (index * 10),
      }),
    });
  }
  assert.equal(fixtures.length, expectedQueryCount);

  let queueCapture = await store.captureMutationQueue(EXPECTED);
  await store.enqueueMutation({
    id: 'cm_membership_a',
    function: 'writeA',
    args: { secret: 'a' },
    authorityDescriptor: AUTHORITY_DESCRIPTOR,
    appId: APP_ID,
    targetProfileId: TARGET_PROFILE_ID,
    versionStreamId: VERSION_STREAM,
    cursor: { stream: VERSION_STREAM, version: 202 },
    ...EXPECTED,
    ...queueCapture,
  });
  await store.enqueueMutation({
    id: 'cm_membership_b',
    function: 'writeB',
    args: { secret: 'b' },
    authorityDescriptor: AUTHORITY_DESCRIPTOR,
    appId: APP_ID,
    targetProfileId: TARGET_PROFILE_ID,
    versionStreamId: VERSION_STREAM,
    cursor: { stream: VERSION_STREAM, version: 202 },
    ...EXPECTED,
    ...queueCapture,
  });
  const before = await store.snapshot();
  const retainedBytesBefore = retainedPayloadBytes(before);
  const pendingMutationsBefore = before.pending.length;
  const queueObligations = [];
  let durableQuarantineFenceWrites = 0;

  for (const { queryKey, installed } of fixtures) {
    const queryPending = retainedObligation({
      namespace: installed.namespace,
      minCommitVersion: serverWitnessFloor.minCommitVersion,
    });
    const accepted = await store.receiveRetainedQueryObligation(
      queryKey,
      queryPending,
      installed.fence,
      EXPECTED,
    );
    if (accepted.disposition === 'quarantine') durableQuarantineFenceWrites += 1;
    const queuePending = queueObligation({
      namespace: installed.namespace,
      minCommitVersion: serverWitnessFloor.minCommitVersion,
    });
    queueObligations.push(queuePending);
    queueCapture = await store.applyMutationQueueObligation(
      queuePending,
      { ...EXPECTED, ...queueCapture },
    );
  }

  const quarantined = await store.snapshot();
  const retainedBytesDuringQuarantine = retainedPayloadBytes(quarantined);
  assert.equal(retainedBytesDuringQuarantine, retainedBytesBefore);
  assert.equal(queueCapture.suspended, true);
  assert.equal(queueCapture.pendingScopeCount, fixtures.length);
  await assertCode('SNAPBACK_CLIENT_QUEUE_SUSPENDED', () => (
    store.pendingMutations({ ...EXPECTED, ...queueCapture })
  ));
  const suspendedMutationCount = quarantined.pending.length;
  assert.equal(suspendedMutationCount, pendingMutationsBefore);

  queueCapture = await store.resolveMutationQueueObligation(
    queueResolution({ obligation: queueObligations[0] }),
    { ...EXPECTED, ...queueCapture },
  );
  const suspendedAfterOneRootResolves = queueCapture.suspended;
  const suspendedMutationCountAfterOneRoot = (await store.snapshot()).pending.length;
  assert.equal(suspendedAfterOneRootResolves, true);
  assert.equal(suspendedMutationCountAfterOneRoot, pendingMutationsBefore);

  for (const pending of queueObligations.slice(1)) {
    queueCapture = await store.resolveMutationQueueObligation(
      queueResolution({ obligation: pending }),
      { ...EXPECTED, ...queueCapture },
    );
  }
  assert.equal(queueCapture.suspended, false);
  const releasedMutationIds = (await store.pendingMutations({
    ...EXPECTED,
    ...queueCapture,
  })).map(({ id }) => id);
  assert.deepEqual(releasedMutationIds, ['cm_membership_a', 'cm_membership_b']);

  const deleteRoot = queueObligation({
    namespace: fixtures[0].installed.namespace,
    revision: 2,
    disposition: 'delete',
    minCommitVersion: 211,
  });
  const deleted = await store.applyMutationQueueObligation(
    deleteRoot,
    { ...EXPECTED, ...queueCapture },
  );
  const afterDelete = await store.snapshot();
  const pendingMutationsRemovedByDelete = pendingMutationsBefore - afterDelete.pending.length;
  const stranded = await store.strandedMutations(EXPECTED);
  const redactedDiscardOnlyRecordsCreated = stranded.filter((entry) => (
    entry.discardOnly === true
      && entry.replayable === false
      && !Object.hasOwn(entry, 'args')
  )).length;
  assert.equal(pendingMutationsRemovedByDelete, pendingMutationsBefore);
  assert.equal(redactedDiscardOnlyRecordsCreated, pendingMutationsBefore);
  const terminal = await store.resolveMutationQueueObligation(
    queueResolution({ obligation: deleteRoot, kind: 'terminalDelete' }),
    { ...EXPECTED, ...deleted },
  );
  const discarded = (await store.strandedMutations(EXPECTED)).length;
  await store.discardStranded({ ...EXPECTED, ...terminal });
  assert.deepEqual(await store.strandedMutations(EXPECTED), []);

  return {
    authScopedQueries: fixtures.length,
    composedServerWitnessFloor: serverWitnessFloor,
    retainedPayloadBytesBefore: retainedBytesBefore,
    retainedPayloadBytesDuringQuarantine: retainedBytesDuringQuarantine,
    retainedPayloadBytesDeletedByCoarseQuarantine:
      retainedBytesBefore - retainedBytesDuringQuarantine,
    durableQuarantineFenceWrites,
    pendingMutationsBefore,
    suspendedMutationCount,
    suspendedAfterOneRootResolves,
    suspendedMutationCountAfterOneRoot,
    releasedMutationIds,
    pendingMutationsRemovedByDelete,
    redactedDiscardOnlyRecordsCreated,
    discardOnlyRecordsDeleted: discarded,
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

const passedEntry = (scenario, observations, predicate) => {
  assert.equal(predicate, true, `${scenario} scenario did not satisfy its oracle`);
  return { scenario, passed: predicate, observations };
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
    serverWitnessFloor,
    expectedQueryCount: serverReceipt.scenario.unrelatedQueriesDuringPermissionChurn,
  });
  const live = exerciseLiveClientScenarios();

  const membership = serverReceipt.runtimeMeasurements.membershipChurn;
  const randomized = serverReceipt.runtimeMeasurements.randomizedWrites;
  const runtime = serverReceipt.runtimeAssertions;
  const roomPauseValues = Object.values(roomReceipt.pausePoints);

  const report = {
    schemaVersion: 1,
    rfc: 'LLP 0053',
    reportKind: 'composed-production-acceptance',
    measurementSemantics: {
      timingUnit: 'committed-client-store-transitions',
      wallClockLatencyClaimed: false,
      retainedByteDefinition: 'UTF-8 bytes of JSON-serialized retained payload records',
      rustInputs: 'machine-readable receipts emitted by executed production Rust acceptance tests',
      clientInputs: 'measurements collected from production @snapback/contract modules in this process',
    },
    composedMeasurements: {
      hiddenViewAndRecovery: visibility,
      membershipChurnBlastRadius: blastRadius,
    },
    propertyOracleMatrix: [
      passedEntry('randomized-writes', {
        operations: serverReceipt.scenario.randomizedOperations,
        convergenceRounds: runtime.randomizedAllQueryConvergenceRounds,
        freshQueryComparisons: runtime.randomizedFreshQueryComparisons,
      }, runtime.randomizedAllQueryConvergenceRounds === serverReceipt.scenario.randomizedOperations
        && runtime.randomizedFreshQueryComparisons
          === serverReceipt.scenario.randomizedOperations
            * serverReceipt.scenario.authScopedQueries),
      passedEntry('deployment-identity-change', live.deployment, live.deployment.passed),
      passedEntry('lease-expiry', {
        retainedBytesDeleted: visibility.retainedPayloadBytesDeletedAtLeaseExpiry,
        deleteTombstoneWritten: visibility.expiryDeleteTombstoneWritten,
      }, visibility.retainedPayloadBytesDeletedAtLeaseExpiry > 0
        && visibility.expiryDeleteTombstoneWritten),
      passedEntry('clock-rollback', {
        retainedBytesDeleted: visibility.retainedPayloadBytesDeletedAtClockRollback,
        deleteTombstoneWritten: visibility.clockRollbackDeleteTombstoneWritten,
      }, visibility.retainedPayloadBytesDeletedAtClockRollback > 0
        && visibility.clockRollbackDeleteTombstoneWritten),
      passedEntry('overflow', overflowReceipt, overflowReceipt.overflowSentinelObserved
        && overflowReceipt.authScopedChildren === 2
        && overflowReceipt.remainingAfterFirstAck === 1
        && overflowReceipt.remainingAfterAllAcks === 0),
      passedEntry('disconnect-and-fresh-resume', live.disconnect,
        live.disconnect.delayedPredecessorFrameRejected
          && live.disconnect.successorInstalledFreshSnapshot),
      passedEntry('response-loss', {
        discardedResponseDrains: membership.discardedResponseDrains
          + randomized.discardedResponseDrains,
        reprojectedSnapshotFrames: membership.reprojectedSnapshotFrames
          + randomized.reprojectedSnapshotFrames,
      }, membership.discardedResponseDrains + randomized.discardedResponseDrains > 0
        && membership.reprojectedSnapshotFrames + randomized.reprojectedSnapshotFrames > 0),
      passedEntry('ack-loss', {
        clientRefiredSameAckToken: live.dispositionEscalation.ackLossRefiredSameToken,
        serverAcknowledgements: membership.acknowledgements + randomized.acknowledgements,
      }, live.dispositionEscalation.ackLossRefiredSameToken
        && membership.acknowledgements + randomized.acknowledgements > 0),
      passedEntry('restart', {
        incarnationPreserved: runtime.ordinaryRestartPreservedIncarnation,
        newIssuerInstalled: runtime.restartInstalledNewIssuer,
        distinctQueryInstance: runtime.restartAcceptedDistinctCallerSuppliedQueryInstance,
        freshSnapshotConverged: runtime.restartInitialSnapshotConverged,
      }, runtime.ordinaryRestartPreservedIncarnation
        && runtime.restartInstalledNewIssuer
        && runtime.restartAcceptedDistinctCallerSuppliedQueryInstance
        && runtime.restartInitialSnapshotConverged),
      passedEntry('stale-callback', {
        rejected: visibility.stalePeerWriteRejected,
      }, visibility.stalePeerWriteRejected),
      passedEntry('cross-tab-write', {
        sharedDurableStore: visibility.sharedDurableStore,
        predecessorFenceRejected: visibility.stalePeerWriteRejected,
      }, visibility.sharedDurableStore && visibility.stalePeerWriteRejected),
      passedEntry('disposition-escalation', live.dispositionEscalation,
        runtime.terminalEscalationDisposition === 'delete'
          && live.dispositionEscalation.terminalDisposition === 'delete'),
      passedEntry('room-pause-points', roomReceipt,
        roomPauseValues.length === 5
          && roomPauseValues.every((value) => value === true)
          && roomReceipt.unrelatedRoomProgressWhileAffectedPending.registration
          && roomReceipt.unrelatedRoomProgressWhileAffectedPending.publishAndDrain
          && roomReceipt.postCommit.kickedDurableBoardRows === 0
          && roomReceipt.postCommit.kickedOpponentPresenceFrames === 0),
    ],
    productionRustReceipts: {
      server: serverReceipt,
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
