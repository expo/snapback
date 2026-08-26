// LLP 0043 M2 outbox on the JS arm (LLP 0129 Phase 0) — unit obligations.
//
// Covers the three store arms' shared outbox contract (memory / file /
// IndexedDB), default-store resolution, and the client mutate/replay queue
// behavior over a stubbed fetch. The end-to-end diary-grade proof lives in
// demos/public-dashboard/tests/acceptance/offline-local-first.mjs.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../snapback-contract/auth-coordinator.mjs';
import { createNodeSqliteNamespace } from '../../demos/expo-local-first-carrier/node-sqlite-adapter.mjs';
import { SnapbackClient as InspectingSnapbackClient, isSnapbackDiagnosticError } from './index.mjs';
import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from './rqs-store-memory.mjs';
import {
  createFileRqsResumeStore,
  createNodeFilesAdapter,
  RQS_FILE_STORE_FORMAT_V1,
} from './rqs-store-file.mjs';
import { createIndexedDbRqsResumeStore, rqsEntryKey } from './rqs-store.mjs';
import { makeResume, ROWS_V5 } from './rqs-resume-suite.mjs';
import { createSqliteRqsResumeStore } from './rqs-store-sqlite.mjs';
import {
  createInitialStoreMeta,
  prepareStoreMeta,
  wipeStoreMeta,
} from './rqs-store-meta.mjs';
import {
  clearNativeRqsFiles,
  registerNativeRqsFiles,
  resolveDefaultRqsStore,
} from './rqs-store-default.mjs';
import {
  OUTBOX_MAX_PENDING_ACKS,
  emptyOutboxState,
  isConnectivityFailureError,
  outboxNotWriterError,
  outboxOps,
} from './outbox-shared.mjs';
import { exerciseOutboxAuthorizationFenceCompareAndCommit } from './outbox-authorization-fence.fixture.mjs';

class SnapbackClient extends InspectingSnapbackClient {
  constructor(baseUrl, options = {}) {
    super(baseUrl, {
      __offlineMutationReplayCapability: true,
      __outboxDrainLifecycle: false,
      ...options,
    });
    this.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  }
}

const originalFetch = globalThis.fetch;
const TEST_AUTHORITY_DESCRIPTOR = Object.freeze({
  descriptorVersion: 1,
  authorityInstanceId: '018f0d90-7b24-7a22-8c33-445566778899',
  sessionGeneration: 1,
});
const TEST_SESSION_USER_ID = '018f0d90-7b25-7a22-8c33-445566778899';
const TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR = Object.freeze({
  descriptorVersion: 1,
  authorityInstanceId: '018f0d90-7b24-7a22-8c33-4455667788bb',
  sessionGeneration: 2,
});
const TEST_ARTIFACT_GENERATION = Object.freeze({
  schemaVersion: 'snapback.v0',
  appId: 'outbox-adoption-test',
  schemaHash: `sha256:${'a'.repeat(64)}`,
  bundleHash: `sha256:${'b'.repeat(64)}`,
  inputsHash: `sha256:${'c'.repeat(64)}`,
});
const TEST_CREATE_THING_ARGUMENT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: { title: { type: 'string' } },
  required: ['title'],
});
const TEST_FRESH_SNAPSHOT_BARRIER = Object.freeze({
  schemaVersion: 'snapback.outbox-fresh-snapshot-barrier.v1',
  status: 'passed',
  kind: 'full-snapshot',
});
const TEST_QUEUE_AUTHORIZATION = Object.freeze({
  incarnation: '018f0d90-7b27-7a22-8c33-445566778899',
  epoch: 1,
});
const TEST_QUEUE_SCOPE = Object.freeze({
  kind: 'clientQuery',
  namespace: Object.freeze({
    clientStoreId: 'outbox-store-contract',
    queryKey: 'createThing:{}',
    queryInstanceId: 1,
  }),
});
const testQueueObligation = Object.freeze({
  protocolVersion: 1,
  scopeId: TEST_QUEUE_SCOPE,
  revision: 1,
  maxDisposition: 'quarantine',
  witness: Object.freeze({ authorization: TEST_QUEUE_AUTHORIZATION, data: null }),
  retryEpisodeId: null,
});
const testQueueResolution = Object.freeze({
  protocolVersion: 1,
  kind: 'snapshot',
  scopeId: TEST_QUEUE_SCOPE,
  revision: 1,
  witness: testQueueObligation.witness,
  maxDisposition: 'quarantine',
  ackToken: 'outbox-store-authorization-proof',
});

const currentAuthorityGeneration = async (store) => (
  (await store.outboxAuthorizationStatus()).authorityGeneration
);

const createSuccessorCoordinator = () => new AuthCoordinator({
  appId: TEST_ARTIFACT_GENERATION.appId,
  storage: createMemoryAuthCustodyStorage(),
  broadcastChannelFactory: null,
  hintStorage: null,
});

const settleSuccessorCoordinator = async (coordinator) => {
  const anonymous = await coordinator.establishAnonymous({
    kind: 'anonymous',
    authMode: 'sessions',
    authorizationStreamIncarnation: '018f0d90-7b26-7a22-8c33-445566778899',
  });
  const capture = await coordinator.transition(anonymous, {
    authority: {
      kind: 'session',
      authMode: 'sessions',
      authorizationStreamIncarnation: '018f0d90-7b26-7a22-8c33-445566778899',
      sessionId: '018f0d90-7b27-7a22-8c33-445566778899',
      userId: TEST_SESSION_USER_ID,
    },
    bearer: 'sbs_outbox_target_successor',
    refreshAfterMs: Date.now() + 60_000,
  }, 'test-successor-established');
  return capture;
};

const applyQueueRoot = async (store, obligation, expectedAuthorityGeneration = undefined) => (
  store.outboxApplyAuthorizationObligation(
    obligation,
    expectedAuthorityGeneration === undefined
      ? await currentAuthorityGeneration(store)
      : expectedAuthorityGeneration,
  )
);

const resolveQueueRoot = async (store, resolution, expectedAuthorityGeneration = undefined) => (
  store.outboxResolveAuthorizationObligation(
    resolution,
    expectedAuthorityGeneration === undefined
      ? await currentAuthorityGeneration(store)
      : expectedAuthorityGeneration,
  )
);

const acknowledgeQueueRoot = async (
  store,
  resolution,
  expectedAuthorityGeneration = undefined,
) => store.outboxAcknowledgeAuthorizationResolution(
  resolution,
  expectedAuthorityGeneration === undefined
    ? await currentAuthorityGeneration(store)
    : expectedAuthorityGeneration,
);

const retireQueueScopes = async (store, scopes, expectedAuthorityGeneration = undefined) => (
  store.outboxRetireAuthorizationScopes(
    scopes,
    expectedAuthorityGeneration === undefined
      ? await currentAuthorityGeneration(store)
      : expectedAuthorityGeneration,
  )
);

const reconcileQueueCustody = async (
  store,
  principalScope,
  authorityDescriptor,
  custody,
  expectedAuthorityGeneration = undefined,
) => store.outboxReconcileCustody(
  principalScope,
  authorityDescriptor,
  custody,
  expectedAuthorityGeneration === undefined
    ? await currentAuthorityGeneration(store)
    : expectedAuthorityGeneration,
);

const adoptionInspection = (generation = TEST_ARTIFACT_GENERATION) => ({
  schema: {
    schemaVersion: generation.schemaVersion,
    appId: generation.appId,
    schemaHash: generation.schemaHash,
    inputsHash: generation.inputsHash,
  },
  functions: {
    schemaVersion: generation.schemaVersion,
    appId: generation.appId,
    bundleHash: generation.bundleHash,
    inputsHash: generation.inputsHash,
  },
});

const sessionHandshake = (authorityDescriptor, userId = TEST_SESSION_USER_ID) => ({
  protocolVersion: 1,
  serverStartupNonce: 'outbox-recovery-test',
  authorizationStreamIncarnation: '018f0d90-7b26-7a22-8c33-445566778899',
  transitionGeneration: 1,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: null,
    authorityDescriptor: 1,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
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
    userId,
    sessionId: '018f0d90-7b27-7a22-8c33-445566778899',
    isAuthenticated: true,
  },
  authorityDescriptor,
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: 'outbox-recovery-test',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  },
  authorizedLease: null,
});

// Immediate-grant Web Locks double (single context; enough for the outbox
// contract — ownership contention is rqs-store.test.mjs territory).
const grantingLocks = {
  request: (_name, _options, callback) => Promise.resolve(callback({ mode: 'exclusive' })),
};

const createContendedLockManager = () => {
  const states = new Map();
  const stateFor = (name) => {
    if (!states.has(name)) states.set(name, { held: false, queue: [] });
    return states.get(name);
  };
  const pump = (name) => {
    const state = stateFor(name);
    if (state.held) return;
    const next = state.queue.shift();
    if (!next) return;
    if (next.aborted) {
      pump(name);
      return;
    }
    state.held = true;
    Promise.resolve(next.callback({ name, mode: 'exclusive' }))
      .then(next.resolve, next.reject)
      .finally(() => {
        state.held = false;
        pump(name);
      });
  };
  return {
    request(name, options, callback) {
      const state = stateFor(name);
      if (options?.ifAvailable === true && state.held) {
        return Promise.resolve(callback(null));
      }
      return new Promise((resolve, reject) => {
        const entry = { callback, resolve, reject, aborted: false };
        options?.signal?.addEventListener('abort', () => {
          entry.aborted = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
        state.queue.push(entry);
        pump(name);
      });
    },
  };
};

const createBroadcastHub = () => {
  const channels = new Set();
  return {
    factory() {
      const channel = {
        closed: false,
        onmessage: null,
        postMessage(data) {
          for (const peer of [...channels]) {
            if (peer === this || peer.closed) continue;
            queueMicrotask(() => peer.onmessage?.({ data: structuredClone(data) }));
          }
        },
        close() {
          this.closed = true;
          channels.delete(this);
        },
      };
      channels.add(channel);
      return channel;
    },
  };
};

const createGatedBroadcastFactory = (hub, mayPost) => () => {
  const channel = hub.factory();
  const postMessage = channel.postMessage.bind(channel);
  channel.postMessage = (data) => {
    if (mayPost()) postMessage(data);
  };
  return channel;
};

const createDurableTestStore = (options = undefined) => {
  const store = createMemoryRqsResumeStore(options);
  store.durability = () => ({ implementation: 'memory-test-double', durable: true });
  return store;
};

const offlineReplayCapabilityManifest = ({ supported, targetProfileId }) => ({
  manifestVersion: 1,
  targetProfileId,
  supportedCapabilities: supported ? ['offline_mutation_replay'] : ['live_subscriptions'],
  capabilityGaps: supported ? [] : ['offline_mutation_replay'],
});

const offlineReplayInspection = ({
  supported,
  targetProfileId,
  generation = TEST_ARTIFACT_GENERATION,
  ledgerIncarnation = null,
}) => ({
  targetProfileId,
  ...(ledgerIncarnation === null ? {} : { ledgerIncarnation }),
  schema: {
    schemaVersion: generation.schemaVersion,
    appId: generation.appId,
    schemaHash: generation.schemaHash,
    inputsHash: generation.inputsHash,
  },
  functions: {
    schemaVersion: generation.schemaVersion,
    appId: generation.appId,
    bundleHash: generation.bundleHash,
    inputsHash: generation.inputsHash,
  },
  capabilityManifest: offlineReplayCapabilityManifest({ supported, targetProfileId }),
});

const commitCompleteReplayCapability = async (
  store,
  origin,
  targetProfileId = 'local-dev-sqlite-ibex',
) => store.commitOfflineMutationReplayCapabilityFact({
  schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
  origin,
  supported: true,
  reason: null,
  targetProfileId,
  artifactGeneration: TEST_ARTIFACT_GENERATION,
});

const prepareCompleteReplayTarget = async (
  store,
  origin,
  targetProfileId = 'local-dev-sqlite-ibex',
) => {
  await commitCompleteReplayCapability(store, origin, targetProfileId);
  return currentOutboxTarget({ origin, targetProfileId });
};

const currentOutboxTarget = ({
  origin,
  targetProfileId = 'local-dev-sqlite-ibex',
  generation = TEST_ARTIFACT_GENERATION,
  generated = false,
  ledgerIncarnation = null,
}) => ({
  outboxRecordSchemaVersion: 2,
  enqueueTarget: {
    schemaVersion: 'snapback.outbox-enqueue-target.v1',
    canonicalOrigin: origin,
    targetProfileId,
    ...(ledgerIncarnation === null ? {} : { ledgerIncarnation }),
    artifactIdentity: generated
      ? { kind: 'generated', generation }
      : {
          kind: 'app',
          appId: generation.appId,
          ...(targetProfileId === null ? {} : { generation }),
        },
  },
});

const createForeignTargetSessionFixture = async ({
  label,
  operationIdentityProtocol = null,
}) => {
  const originA = `https://${label}-target-a.example`;
  const originB = `https://${label}-target-b.example`;
  const targetBProfile = `${label}-target-b`;
  const foreignId = `cm-${label}-target-a`;
  const store = createDurableTestStore();
  const coordinator = createSuccessorCoordinator();
  const capture = await settleSuccessorCoordinator(coordinator);
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/auth/session');
    const handshake = sessionHandshake(
      TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
      TEST_SESSION_USER_ID,
    );
    return Response.json({
      ...handshake,
      deploymentIdentity: {
        ...handshake.deploymentIdentity,
        appId: TEST_ARTIFACT_GENERATION.appId,
      },
    });
  };
  const client = new SnapbackClient(originB, {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: store,
    __outboxDrainLifecycle: false,
    ...(operationIdentityProtocol === null ? {} : { operationIdentityProtocol }),
  });
  await client.authSession();
  await store.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin: originB,
    supported: true,
    reason: null,
    targetProfileId: targetBProfile,
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  });
  await store.outboxEnqueue({
    id: foreignId,
    function: 'createThing',
    ...currentOutboxTarget({
      origin: originA,
      targetProfileId: `${label}-target-a`,
      generated: true,
    }),
    args: { title: 'foreign target intent must remain untouched' },
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    principalScope: {
      authMode: 'sessions',
      authorizationStreamIncarnation: '018f0d90-7b26-7a22-8c33-445566778899',
      userId: TEST_SESSION_USER_ID,
    },
    custody: {
      authorityEpoch: capture.authorityEpoch,
      authorityKey: capture.authorityKey,
    },
  });
  const before = structuredClone(
    (await store.outboxRecords()).find((record) => record.id === foreignId),
  );
  return {
    originB,
    targetBProfile,
    foreignId,
    before,
    store,
    coordinator,
    client,
    async close() {
      await client.close();
      await coordinator.close();
      await store.close();
    },
  };
};

const testDigest = (character) => `sha256:${character.repeat(64)}`;
const optimisticCreateCardReference = (generation) => Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: generation.schemaVersion,
  appId: generation.appId,
  id: `${generation.appId}:createCard`,
  name: 'createCard',
  kind: 'Mutation',
  implementationHash: testDigest('4'),
  argsContractHash: testDigest('5'),
  resultContractHash: testDigest('6'),
  expectedGeneration: generation,
  argumentSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({
      title: Object.freeze({ type: 'string' }),
      position: Object.freeze({ type: 'integer' }),
    }),
    required: Object.freeze(['title', 'position']),
  }),
  mutationIr: Object.freeze({
    format: 'snapback.generated-mutation-ir.v1',
    operationHash: testDigest('7'),
    sourceIdentity: Object.freeze({
      functionId: `${generation.appId}:createCard`,
      implementationHash: testDigest('4'),
      activation: generation,
    }),
    schemaIdentity: Object.freeze({
      schemaVersion: generation.schemaVersion,
      appId: generation.appId,
      schemaHash: generation.schemaHash,
    }),
    capabilityClass: 'local-executable',
    capabilityCode: 'SNAPBACK_GENERATED_IR_LOCAL_EXECUTABLE',
    declaredEffectClass: 'snapback.browser-ir.insert-get-guard-patch.v1',
    declaredReads: Object.freeze([]),
    localReadRequirements: Object.freeze([]),
    schema: Object.freeze({
      tables: Object.freeze([Object.freeze({
        name: 'cards',
        fields: Object.freeze(['title', 'position', 'locked'].map((name) => Object.freeze({
          name,
        }))),
      })]),
    }),
    plan: Object.freeze({
      steps: Object.freeze([Object.freeze({
        Insert: Object.freeze({
          table: 'cards',
          values: Object.freeze({
            title: Object.freeze({ Arg: 'title' }),
            position: Object.freeze({ Arg: 'position' }),
            locked: Object.freeze({ Literal: false }),
          }),
          bind_id_as: 'cardId',
        }),
      })]),
      return_value: Object.freeze({ Binding: 'cardId' }),
    }),
    mintSites: Object.freeze(['plan/steps/0/insert/row-id']),
    usesRuntimeNow: false,
    boundedSkew: null,
  }),
});

const waitForOfflineReplayCapabilityFact = async (store, predicate, label) => {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const fact = await store.readOfflineMutationReplayCapabilityFact();
    if (predicate(fact)) return fact;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test('store_meta migration defaults only declared additive fields and fails closed otherwise', () => {
  const initial = createInitialStoreMeta();
  const predecessor = structuredClone(initial);
  delete predecessor.materializationLeaseCustody;
  delete predecessor.authorizedQueryRetention;
  delete predecessor.offlineMutationReplayCapabilityFact;
  delete predecessor.generationCounters.offlineReplayCapabilityRequestHighWater;
  const migrated = prepareStoreMeta(predecessor);
  assert.deepEqual(migrated.materializationLeaseCustody, {});
  assert.deepEqual(migrated.authorizedQueryRetention, {});
  assert.deepEqual(migrated.offlineMutationReplayCapabilityFact, {});
  assert.equal(migrated.generationCounters.offlineReplayCapabilityRequestHighWater, 0);

  for (const slot of [
    'durableRegistrations',
    'policyBudgetFacts',
    'brokerRoster',
    'fenceHighWaters',
    'tombstoneHighWaters',
    'barrierHighWaters',
  ]) {
    const partial = structuredClone(initial);
    delete partial[slot];
    assert.equal(prepareStoreMeta(partial), null, `missing ${slot} refuses instead of resetting`);
  }

  const capabilityFact = { supported: true, storeRevision: 7 };
  const wiped = wipeStoreMeta({
    ...initial,
    offlineMutationReplayCapabilityFact: capabilityFact,
    durableRegistrations: { registration: true },
    fenceHighWaters: { protected: 11 },
  });
  assert.deepEqual(wiped.durableRegistrations, {}, 'wipe names the registration slot explicitly');
  assert.deepEqual(wiped.fenceHighWaters, { protected: 11 }, 'wipe preserves fence high-waters');
  assert.deepEqual(
    wiped.offlineMutationReplayCapabilityFact,
    capabilityFact,
    'authority wipe does not erase target capability evidence',
  );
});

async function exerciseOutboxContract(store, { label }) {
  const contractTarget = currentOutboxTarget({
    origin: 'https://outbox-contract.example',
    targetProfileId: 'outbox-contract',
  });
  assert.equal(await store.outboxEmpty(), true, `${label}: starts empty`);
  const capabilityFact = {
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin: 'https://capability-fact.example',
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  };
  const committedCapabilityFact = await store.commitOfflineMutationReplayCapabilityFact(
    capabilityFact,
  );
  assert.deepEqual(
    committedCapabilityFact,
    { ...capabilityFact, requestSequence: 1, storeRevision: 1 },
    `${label}: commits target-bound offline replay capability evidence`,
  );
  assert.deepEqual(
    await store.readOfflineMutationReplayCapabilityFact(),
    committedCapabilityFact,
    `${label}: reads target-bound offline replay capability evidence`,
  );
  const olderObservation = await store.beginOfflineMutationReplayCapabilityObservation();
  const newerObservation = await store.beginOfflineMutationReplayCapabilityObservation();
  const newerCapabilityFact = await store.commitOfflineMutationReplayCapabilityFact(
    capabilityFact,
    newerObservation,
  );
  assert.equal(
    newerCapabilityFact.requestSequence,
    newerObservation.requestSequence,
    `${label}: the newer capability compare commits its reserved order`,
  );
  const rejectedCapabilityFact = await store.commitOfflineMutationReplayCapabilityFact({
    ...capabilityFact,
    supported: false,
    reason: 'stale-answer',
    targetProfileId: 'cloudflare-do-sqlite-v8',
  }, olderObservation);
  assert.equal(
    rejectedCapabilityFact,
    false,
    `${label}: a stale capability compare is reported as not committed`,
  );
  assert.deepEqual(
    await store.readOfflineMutationReplayCapabilityFact(),
    newerCapabilityFact,
    `${label}: the rejected capability compare leaves the current fact unchanged`,
  );
  assert.equal(
    typeof store.outboxPrepareSubmission,
    'function',
    `${label}: carries the settle-time submission fence`,
  );
  assert.equal(
    typeof store.outboxDiscardPendingInsertion,
    'function',
    `${label}: carries exact pending-insertion compensation`,
  );
  const first = await store.outboxEnqueue({
    id: 'cm-1',
    function: 'createThing',
    ...contractTarget,
    args: { title: 'a' },
    userId: 'user_a',
    capturedNow: 1234,
  });
  const second = await store.outboxEnqueue({
    id: 'cm-2',
    function: 'updateThing',
    ...contractTarget,
    args: { title: 'b' },
    userId: 'user_a',
  });
  assert.equal(first.sequence, 1, `${label}: first sequence`);
  assert.equal(second.sequence, 2, `${label}: monotonic sequence`);
  assert.equal(first.insertionOwned, true, `${label}: first enqueue owns its insertion`);
  assert.equal(second.insertionOwned, true, `${label}: distinct enqueue owns its insertion`);
  assert.equal(first.status, 'pending');
  assert.equal(first.capturedNow, 1234, `${label}: captured clock retained as labeled claim`);
  // Idempotent re-enqueue of the same durable identity.
  const re = await store.outboxEnqueue({
    id: 'cm-1',
    function: 'createThing',
    ...contractTarget,
    args: { title: 'a' },
    userId: 'user_a',
    capturedNow: 1234,
  });
  assert.equal(re.sequence, 1, `${label}: re-enqueue returns the existing record`);
  assert.equal(re.insertionOwned, false, `${label}: idempotent enqueue does not own insertion`);
  await assert.rejects(
    () => store.outboxEnqueue({
      id: 'cm-1',
      function: 'createThing',
      ...contractTarget,
      args: { title: 'different' },
      userId: 'user_a',
      capturedNow: 1234,
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_IDENTITY_MISMATCH',
  );
  assert.equal(await store.outboxEmpty(), false, `${label}: pending -> non-empty`);
  assert.deepEqual(
    (await store.outboxPending()).map((r) => r.id),
    ['cm-1', 'cm-2'],
    `${label}: pending in sequence order`,
  );
  const suspended = await applyQueueRoot(store, testQueueObligation);
  assert.equal(suspended.suspended, true, `${label}: authorization root suspends replay`);
  assert.equal(
    (await store.outboxPrepareSubmission('cm-1')).status,
    'authorization-suspended',
    `${label}: submission checks the persisted root`,
  );
  const released = await resolveQueueRoot(store, testQueueResolution);
  assert.equal(released.suspended, false, `${label}: exact proof releases the root`);
  assert.equal(
    (await store.outboxPrepareSubmission('cm-1')).status,
    'ready',
    `${label}: replay resumes only after exact proof`,
  );
  assert.equal(
    await acknowledgeQueueRoot(store, testQueueResolution),
    true,
    `${label}: acknowledged proof cleanup is durable`,
  );
  // Drop-and-mark-failed stays visible, leaves the pending lane.
  assert.equal(await store.outboxMarkFailed('cm-1', { code: 'X', message: 'refused' }), true);
  assert.deepEqual((await store.outboxPending()).map((r) => r.id), ['cm-2']);
  const failed = (await store.outboxRecords()).find((r) => r.id === 'cm-1');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure.code, 'X');
  // Durable consumption retains the complete settlement and creates its ACK
  // obligation atomically. It leaves the replay lane but remains recoverable
  // until the server confirms ledger GC.
  const settlement = { result: { ok: true }, version: 7 };
  const consumed = await store.outboxDurablyConsume('cm-2', settlement, 'user_a');
  assert.equal(consumed.status, 'settled');
  assert.deepEqual(consumed.settlement, settlement);
  // A failed record is terminal (never replayed), so it does not block the
  // LLP 0090 resume rule — but it stays visible in outboxRecords().
  assert.equal(await store.outboxEmpty(), true, `${label}: only failed records left -> empty for resume`);
  assert.deepEqual((await store.outboxPending()), []);
  assert.deepEqual(await store.outboxPendingAcknowledgements('user_a', 64), []);
  await store.outboxMarkAcknowledgementsReady(
    ['cm-2'], undefined, undefined, null, contractTarget.enqueueTarget,
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      'user_a', 64, null, contractTarget.enqueueTarget,
    ),
    ['cm-2'],
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      'user_b', 64, null, contractTarget.enqueueTarget,
    ),
    [],
    `${label}: another identity never sends this one's ACKs`,
  );
  await store.outboxConfirmAcknowledgements(
    ['cm-2'], undefined, undefined, null, contractTarget.enqueueTarget,
  );
  assert.deepEqual(await store.outboxPendingAcknowledgements('user_a', 64), []);
  assert.equal(
    (await store.outboxRecords()).some((record) => record.id === 'cm-2'),
    false,
    `${label}: confirmation retires the retained settlement`,
  );
  // A store domain may retain settlements for more than one target. Omitted
  // or invalid target custody is never authority to expose every ACK id.
  const ackTargetA = currentOutboxTarget({
    origin: 'https://ack-target-a.example',
    targetProfileId: 'ack-target-a',
  });
  const ackTargetB = currentOutboxTarget({
    origin: 'https://ack-target-b.example',
    targetProfileId: 'ack-target-b',
  });
  for (const [id, target] of [
    ['cm-target-a-ack', ackTargetA],
    ['cm-target-b-ack', ackTargetB],
  ]) {
    await store.outboxEnqueue({ id, function: 'targetedAck', ...target });
    await store.outboxDurablyConsume(id, { result: { ok: true } }, 'user_a');
    await store.outboxMarkAcknowledgementsReady(
      [id], undefined, undefined, null, target.enqueueTarget,
    );
  }
  assert.deepEqual(
    await store.outboxPendingAcknowledgements('user_a', 64),
    [],
    `${label}: omitted ACK target exposes no cross-target ids`,
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements('user_a', 64, null, {}),
    [],
    `${label}: invalid ACK target exposes no cross-target ids`,
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      'user_a', 64, null, ackTargetA.enqueueTarget,
    ),
    ['cm-target-a-ack'],
    `${label}: exact ACK target exposes only its own id`,
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      'user_a', 64, null, ackTargetB.enqueueTarget,
    ),
    ['cm-target-b-ack'],
    `${label}: the foreign ACK target remains isolated`,
  );
  await store.outboxConfirmAcknowledgements(
    ['cm-target-a-ack'], undefined, undefined, null, ackTargetA.enqueueTarget,
  );
  await store.outboxConfirmAcknowledgements(
    ['cm-target-b-ack'], undefined, undefined, null, ackTargetB.enqueueTarget,
  );
  // Outcome-known/payload-gone is a durable fourth state, not pending,
  // failed, or settled. It never re-enters transport and remains an ordered
  // submission fence until explicitly discarded.
  await store.outboxEnqueue({ id: 'cm-result-gone', function: 'createThing' });
  const resultGone = await store.outboxMarkResultGone('cm-result-gone', {
    outcome: 'committed',
    receiptDigest: `sha256:${'e'.repeat(64)}`,
  });
  assert.equal(resultGone.status, 'result-gone');
  assert.deepEqual(resultGone.resultGone, {
    disposition: 'result-expired',
    outcome: 'committed',
    receiptDigest: `sha256:${'e'.repeat(64)}`,
  });
  assert.deepEqual(
    await store.outboxMarkResultGone('cm-result-gone', {
      outcome: 'committed',
      receiptDigest: `sha256:${'e'.repeat(64)}`,
    }),
    resultGone,
    `${label}: exact result-gone retry is idempotent`,
  );
  for (const divergent of [
    { outcome: 'refused', receiptDigest: `sha256:${'e'.repeat(64)}` },
    { outcome: 'committed', receiptDigest: `sha256:${'f'.repeat(64)}` },
  ]) {
    await assert.rejects(
      () => store.outboxMarkResultGone('cm-result-gone', divergent),
      (error) => error.code === 'SNAPBACK_OUTBOX_RESULT_GONE_MISMATCH',
      `${label}: divergent result-gone custody refuses`,
    );
  }
  await store.outboxEnqueue({ id: 'cm-after-result-gone', function: 'updateThing' });
  assert.deepEqual(
    (await store.outboxPending()).map((record) => record.id),
    ['cm-after-result-gone'],
    `${label}: result-gone is not replayable pending work`,
  );
  assert.equal(await store.outboxEmpty(), false, `${label}: result-gone keeps resume fenced`);
  assert.deepEqual(
    await store.outboxPrepareSubmission('cm-after-result-gone'),
    { status: 'blocked', record: null },
    `${label}: missing result blocks ordered successors`,
  );
  await store.outboxDiscard('cm-result-gone');
  assert.equal(
    (await store.outboxPrepareSubmission('cm-after-result-gone')).status,
    'ready',
    `${label}: explicit discard releases the ordered successor`,
  );
  await store.outboxDiscard('cm-after-result-gone');
  // Explicit discard of the failed record; wipe clears everything.
  assert.equal(await store.outboxDiscard('cm-1'), true);
  await store.outboxEnqueue({
    id: 'cm-quarantine',
    function: 'createThing',
    args: { privateValue: 'must-not-project' },
  });
  const quarantine = await store.outboxMarkQuarantined('cm-quarantine', {
    code: 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
  });
  assert.equal(quarantine.count, 1, `${label}: quarantine transition commits`);
  const [quarantinedRecord] = await store.outboxRecords();
  assert.equal(quarantinedRecord.status, 'quarantined');
  assert.equal(Object.hasOwn(quarantinedRecord, 'args'), false);
  assert.deepEqual(quarantinedRecord.effectProvenance, {
    effectCommitted: null,
    effectMayHaveCommitted: null,
  }, `${label}: quarantine without proof preserves unknown effect facts`);
  assert.equal(await store.outboxEmpty(), false, `${label}: quarantine keeps resume fenced`);
  const reentry = await store.outboxReenterQuarantined();
  assert.deepEqual(reentry.clientMutationIds, ['cm-quarantine']);
  assert.deepEqual((await store.outboxPending())[0].args, { privateValue: 'must-not-project' });
  await store.outboxDiscard('cm-quarantine');
  await store.outboxEnqueue({ id: 'cm-3', function: 'createThing' });
  await store.wipe();
  assert.deepEqual(await store.outboxPending(), [], `${label}: wipe clears the queue`);

  const predecessorScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: 'stream-a',
    userId: 'user-a',
  };
  const predecessorDescriptor = {
    descriptorVersion: 1,
    authorityInstanceId: 'authority-a',
    sessionGeneration: 1,
  };
  const fenced = (id) => ({
    id,
    function: 'createThing',
    ...contractTarget,
    args: { privateValue: id },
    authorityDescriptor: predecessorDescriptor,
    principalScope: predecessorScope,
    custody: { authorityEpoch: 1, authorityKey: 'authority-key-a' },
  });
  await store.outboxEnqueue(fenced('cm-custody-scoped-selected'));
  await store.outboxEnqueue(fenced('cm-custody-scoped-preserved'));
  const scopedPreservedBefore = structuredClone(
    (await store.outboxRecords())
      .find((record) => record.id === 'cm-custody-scoped-preserved'),
  );
  await assert.rejects(
    store.outboxReconcileCustodyRecords(
      [],
      predecessorScope,
      predecessorDescriptor,
      { authorityEpoch: 2, authorityKey: 'authority-key-scoped-successor' },
      await currentAuthorityGeneration(store),
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_RECORD_INVALID',
    `${label}: an empty scoped reconciliation set is invalid`,
  );
  const scoped = await store.outboxReconcileCustodyRecords(
    ['cm-custody-scoped-selected'],
    predecessorScope,
    {
      ...predecessorDescriptor,
      authorityInstanceId: 'authority-scoped-successor',
      sessionGeneration: 2,
    },
    { authorityEpoch: 2, authorityKey: 'authority-key-scoped-successor' },
    await currentAuthorityGeneration(store),
  );
  assert.deepEqual(
    scoped.strandedIds,
    ['cm-custody-scoped-selected'],
    `${label}: scoped reconciliation changes only the selected record`,
  );
  assert.deepEqual(
    (await store.outboxRecords())
      .find((record) => record.id === 'cm-custody-scoped-preserved'),
    scopedPreservedBefore,
    `${label}: scoped reconciliation leaves every unselected record byte-identical`,
  );
  await store.outboxDiscardStranded(['cm-custody-scoped-selected'], predecessorScope);
  await store.outboxDiscard('cm-custody-scoped-preserved');
  await store.outboxEnqueue(fenced('cm-strand-pending'));
  await store.outboxEnqueue(fenced('cm-strand-failed'));
  await store.outboxEnqueue(fenced('cm-custody-settled'));
  await store.outboxMarkFailed('cm-strand-failed', { code: 'X', message: 'failed first' });
  await store.outboxDurablyConsume('cm-custody-settled', {
    result: { privateValue: 'settled-predecessor-result' },
    authorityDescriptor: predecessorDescriptor,
  }, predecessorScope.userId);
  await store.outboxMarkAcknowledgementsReady(
    ['cm-custody-settled'],
    undefined,
    undefined,
    null,
    contractTarget.enqueueTarget,
  );
  const stranded = await reconcileQueueCustody(store, predecessorScope, {
    ...predecessorDescriptor,
    authorityInstanceId: 'authority-b',
    sessionGeneration: 2,
  }, { authorityEpoch: 2, authorityKey: 'authority-key-b' });
  assert.equal(stranded.stranded, 2, `${label}: pending and failed strand atomically`);
  assert.deepEqual(await store.outboxPending(), [], `${label}: stranded is never replay pending`);
  assert.equal(await store.outboxEmpty(), true, `${label}: stranded does not hold D3 resume`);
  const strandedRecords = await store.outboxRecords();
  assert.deepEqual(
    strandedRecords.map((record) => record.status),
    ['stranded', 'stranded', 'settled'],
    `${label}: same-principal instance changes retain settled cohorts`,
  );
  assert.equal(
    strandedRecords.filter((record) => record.status === 'stranded')
      .every((record) => record.rerecordable === true),
    true,
  );
  assert.deepEqual(strandedRecords[0].predecessorPrincipalScope, predecessorScope);
  assert.equal(
    strandedRecords
      .filter((record) => record.status === 'stranded')
      .every((record) => (
        record.effectProvenance?.effectCommitted === null
        && record.effectProvenance?.effectMayHaveCommitted === null
      )),
    true,
    `${label}: stranding never invents effect-free provenance`,
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      predecessorScope.userId,
      64,
      predecessorDescriptor,
      contractTarget.enqueueTarget,
    ),
    ['cm-custody-settled'],
    `${label}: same-principal instance changes retain settlement acknowledgements`,
  );
  const discarded = await store.outboxDiscardStranded(
    ['cm-strand-pending'],
    predecessorScope,
  );
  assert.deepEqual(discarded.clientMutationIds, ['cm-strand-pending']);
  const deleted = await reconcileQueueCustody(
    store,
    { ...predecessorScope, userId: 'user-b' },
    { ...predecessorDescriptor, authorityInstanceId: 'authority-c' },
    { authorityEpoch: 3, authorityKey: 'authority-key-c' },
  );
  assert.equal(
    deleted.deleted,
    2,
    `${label}: principal change counts stranded and settled predecessor payloads`,
  );
  assert.deepEqual(await store.outboxRecords(), []);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      predecessorScope.userId,
      64,
      predecessorDescriptor,
    ),
    [],
    `${label}: principal change deletes predecessor acknowledgement rows`,
  );

  const reconcilePredecessorCase = async ({ id, predecessor, successor, expected }) => {
    const descriptor = {
      descriptorVersion: 1,
      authorityInstanceId: `${id}-predecessor`,
      sessionGeneration: 1,
    };
    await store.outboxEnqueue({
      id,
      function: 'predecessorIntent',
      args: { privateValue: id },
      authorityDescriptor: descriptor,
      principalScope: predecessor,
      custody: { authorityEpoch: 10, authorityKey: `${id}-key` },
    });
    const disposition = await reconcileQueueCustody(
      store,
      successor,
      { ...descriptor, authorityInstanceId: `${id}-successor`, sessionGeneration: 2 },
      { authorityEpoch: 11, authorityKey: `${id}-successor-key` },
    );
    assert.deepEqual(disposition[`${expected}Ids`], [id], `${label}: ${id} ${expected}s`);
    if (expected === 'stranded') {
      assert.equal((await store.outboxRecords())[0].status, 'stranded');
      await store.outboxDiscardStranded([id], predecessor);
    } else {
      assert.deepEqual(await store.outboxRecords(), []);
    }
  };
  await reconcilePredecessorCase({
    id: 'cm-anonymous-to-authenticated',
    predecessor: { ...predecessorScope, userId: null },
    successor: predecessorScope,
    expected: 'stranded',
  });
  await reconcilePredecessorCase({
    id: 'cm-dev-to-sessions',
    predecessor: { ...predecessorScope, authMode: 'dev', userId: null },
    successor: predecessorScope,
    expected: 'stranded',
  });
  await reconcilePredecessorCase({
    id: 'cm-incarnation-change',
    predecessor: predecessorScope,
    successor: { ...predecessorScope, authorizationStreamIncarnation: 'stream-successor' },
    expected: 'deleted',
  });

  const agentScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: 'stream-agent',
    userId: 'effective-agent-user',
  };
  await store.outboxEnqueue({
    id: 'cm-agent-grant-change',
    function: 'agentIntent',
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: 'agent-authority-a',
      sessionGeneration: 0,
    },
    principalScope: agentScope,
    custody: { authorityEpoch: 1, authorityKey: 'grant-tuple-a' },
  });
  const agentDeleted = await reconcileQueueCustody(
    store,
    agentScope,
    {
      descriptorVersion: 1,
      authorityInstanceId: 'agent-authority-b',
      sessionGeneration: 0,
    },
    { authorityEpoch: 2, authorityKey: 'grant-tuple-b' },
  );
  assert.equal(agentDeleted.deleted, 1, `${label}: agent grant-tuple change is principal deletion`);
  assert.equal(agentDeleted.stranded, 0, `${label}: agent grant-tuple change never strands`);
  assert.deepEqual(await store.outboxRecords(), []);
}

test('memory arm carries the outbox contract', async () => {
  const store = createMemoryRqsResumeStore();
  await exerciseOutboxContract(store, { label: 'memory' });
  assert.deepEqual(store.durability(), { implementation: 'memory', durable: false });
  await store.close();
});

test('memory arm carries every shared authorization-fence compare-and-commit', async () => {
  const store = createMemoryRqsResumeStore();
  await exerciseOutboxAuthorizationFenceCompareAndCommit(store, { label: 'memory' });
  await store.close();
});

const OPERATION_RANGE = Object.freeze({
  schemaVersion: 1,
  audience: 'authority-a',
  authorityInstanceId: 'authority-a',
  epochId: 'epoch-a',
  epochSequence: 0,
  rangeStart: 10,
  rangeEndExclusive: 12,
  issuedAtMs: 1,
  expiresAtMs: 10_000,
  authorityAuthenticatorDigest: `sha256:${'a'.repeat(64)}`,
});

test('operation range, next counter, and intent move in one outbox transition', () => {
  const first = outboxOps.enqueueWithOperationIdentity(
    emptyOutboxState(),
    { id: 'cm-operation-1', function: 'createThing' },
    2,
    'dev:user-a',
    OPERATION_RANGE,
  );
  assert.equal(first.result.operationIssuance.counter, 10);
  assert.equal(first.result.operationCoverageDisposition, 'covered');
  assert.equal(first.state.operationIdentityRanges['dev:user-a'].nextCounter, 11);

  // A JSON crash/reopen cut cannot preserve the intent without the advanced
  // counter: both live in the same persisted outbox section.
  const reopened = JSON.parse(JSON.stringify(first.state));
  const second = outboxOps.enqueueWithOperationIdentity(
    reopened,
    { id: 'cm-operation-2', function: 'createThing' },
    3,
    'dev:user-a',
  );
  assert.equal(second.result.operationIssuance.counter, 11);
  assert.equal(second.state.operationIdentityRanges['dev:user-a'].nextCounter, 12);

  const exhausted = outboxOps.enqueueWithOperationIdentity(
    second.state,
    { id: 'cm-operation-3', function: 'createThing' },
    4,
    'dev:user-a',
  );
  assert.equal(exhausted.result.operationIssuance, null);
  assert.equal(
    exhausted.result.operationCoverageDisposition,
    'uncovered-range-exhausted',
  );
});

test('ACK pressure refuses settlement publication without losing pending intent', () => {
  const target = currentOutboxTarget({ origin: 'https://ack-pressure.example' });
  const pending = outboxOps.enqueue(
    emptyOutboxState(),
    { id: 'cm-pressure', function: 'createThing', ...target },
    1,
  ).state;
  const full = {
    ...pending,
    acks: Array.from({ length: OUTBOX_MAX_PENDING_ACKS }, (_, index) => ({
      id: `cm-old-${index}`,
      userId: null,
      enqueueTarget: target.enqueueTarget,
    })),
  };
  assert.throws(
    () => outboxOps.durablyConsume(full, 'cm-pressure', { result: { ok: true } }, null, 2),
    (error) => error.code === 'SNAPBACK_OUTBOX_ACK_FULL',
  );
  assert.equal(full.records['cm-pressure'].status, 'pending');
  assert.equal(full.acks[0].id, 'cm-old-0', 'old recovery obligations are never evicted');

  const advanced = outboxOps.durablyConsume(
    full,
    'cm-pressure',
    { result: { ok: true } },
    null,
    2,
    ['cm-old-0'],
  ).state;
  assert.equal(advanced.records['cm-pressure'].status, 'settled');
  assert.equal(advanced.acks.length, OUTBOX_MAX_PENDING_ACKS);
  assert.equal(advanced.acks.some((ack) => ack.id === 'cm-old-0'), false);
  assert.equal(advanced.acks.some((ack) => ack.id === 'cm-pressure'), true);
});

test('settlement ACK obligations persist the record enqueue target', () => {
  const target = currentOutboxTarget({ origin: 'https://ack-target-a.example' });
  const pending = outboxOps.enqueue(
    emptyOutboxState(),
    {
      id: 'cm-targeted-ack',
      function: 'createThing',
      ...target,
    },
    1,
  ).state;
  const settled = outboxOps.durablyConsume(
    pending,
    'cm-targeted-ack',
    { result: { ok: true }, authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR },
    null,
    2,
  ).state;

  assert.deepEqual(settled.acks[0].enqueueTarget, target.enqueueTarget);
});

test('ACK custody is scoped by authority instance as well as user', async () => {
  const first = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b24-7a22-8c33-445566778899',
    sessionGeneration: 1,
  };
  const second = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b25-7a22-8c33-445566778899',
    sessionGeneration: 1,
  };
  const store = createMemoryRqsResumeStore();
  const target = currentOutboxTarget({
    origin: 'https://authority-ack.example',
    targetProfileId: 'authority-ack',
  });
  await store.outboxEnqueue({
    id: 'cm-authority',
    function: 'createThing',
    ...target,
    userId: 'user_a',
    authorityDescriptor: first,
  });
  await store.outboxDurablyConsume('cm-authority', { result: { ok: true } }, 'user_a');
  await store.outboxMarkAcknowledgementsReady(
    ['cm-authority'], undefined, undefined, null, target.enqueueTarget,
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      'user_a', 64, first, target.enqueueTarget,
    ),
    ['cm-authority'],
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      'user_a', 64, second, target.enqueueTarget,
    ),
    [],
  );
  assert.equal(await store.outboxConfirmAcknowledgements(
    ['cm-authority'], 'user_a', second, null, target.enqueueTarget,
  ), 0);
  assert.equal((await store.outboxRecords())[0].status, 'settled');
  assert.equal(await store.outboxConfirmAcknowledgements(
    ['cm-authority'], 'user_a', first, null, target.enqueueTarget,
  ), 1);
  assert.deepEqual(await store.outboxRecords(), []);
});

test('ACK confirmation without an enqueue target is a no-op', async () => {
  const store = createMemoryRqsResumeStore();
  const target = currentOutboxTarget({
    origin: 'https://ack-confirm-target-required.example',
    targetProfileId: 'ack-confirm-target-required',
  });
  await store.outboxEnqueue({
    id: 'cm-ack-confirm-target-required',
    function: 'createThing',
    ...target,
  });
  await store.outboxDurablyConsume(
    'cm-ack-confirm-target-required',
    { result: { ok: true } },
    null,
  );
  await store.outboxMarkAcknowledgementsReady(
    ['cm-ack-confirm-target-required'],
    undefined,
    undefined,
    null,
    target.enqueueTarget,
  );

  assert.equal(
    await store.outboxConfirmAcknowledgements(['cm-ack-confirm-target-required']),
    0,
    'an omitted target cannot collect a target-bound settlement',
  );
  assert.equal((await store.outboxRecords())[0]?.status, 'settled');
  assert.equal(
    await store.outboxConfirmAcknowledgements(
      ['cm-ack-confirm-target-required'],
      undefined,
      undefined,
      null,
      target.enqueueTarget,
    ),
    1,
    'the exact enqueue target collects the settlement',
  );
  assert.deepEqual(await store.outboxRecords(), []);
  await store.close();
});

test('memory arm carries the optional React binding receipt outside entry accounting', async () => {
  const store = createMemoryRqsResumeStore();
  assert.equal(await store.loadReactBindingReceipt(), null);
  const receipt = { binding: 'todos:list', nested: { version: 1 } };
  assert.equal(await store.commitReactBindingReceipt(receipt), true);
  receipt.nested.version = 99;
  const loaded = await store.loadReactBindingReceipt();
  assert.deepEqual(loaded, { binding: 'todos:list', nested: { version: 1 } });
  loaded.nested.version = 2;
  assert.equal((await store.loadReactBindingReceipt()).nested.version, 1, 'loads are detached');
  assert.equal(await store.commitReactBindingReceipt(null), false);
  assert.equal(await store.commitReactBindingReceipt('not-an-object'), false);
  assert.equal(await store.commitReactBindingReceipt([]), false);
  assert.equal(await store.commitReactBindingReceipt({ payload: 'x'.repeat(64 * 1024) }), false);
  assert.equal((await store.loadReactBindingReceipt()).binding, 'todos:list');
  const inspection = await store.inspection();
  assert.deepEqual({ entries: inspection.entries, bytes: inspection.bytes }, { entries: 0, bytes: 0 });
  await store.wipe();
  assert.equal(await store.loadReactBindingReceipt(), null);
  await store.close();
});

test('indexeddb arm carries the outbox contract atomically', async () => {
  const store = createIndexedDbRqsResumeStore({
    indexedDB: new IDBFactory(),
    lockManager: grantingLocks,
  });
  // The web arm's lock callback runs synchronously under the granting
  // double; whenLockSettled() resolves only at close for a granted writer.
  await Promise.resolve();
  assert.equal(store.isWriter(), true);
  await exerciseOutboxContract(store, { label: 'indexeddb' });
  assert.deepEqual(store.durability(), { implementation: 'indexeddb', durable: true });
  const inspection = await store.inspection();
  assert.equal(inspection.outbox.pending, 0);
  await store.close();
});

test('indexeddb follower routes and confirms versioned capability replacement through writer broadcast', async () => {
  const indexedDB = new IDBFactory();
  const lockManager = createContendedLockManager();
  const broadcastHub = createBroadcastHub();
  const options = {
    indexedDB,
    lockManager,
    databaseName: 'outbox-capability-cross-context',
    broadcastChannelFactory: () => broadcastHub.factory(),
  };
  const writer = createIndexedDbRqsResumeStore(options);
  const follower = createIndexedDbRqsResumeStore(options);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(writer.isWriter(), true);
  assert.equal(follower.isWriter(), false);
  const positive = {
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin: 'https://broadcast.example',
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  };
  assert.equal(
    (await writer.commitOfflineMutationReplayCapabilityFact(positive)).storeRevision,
    1,
  );
  const negative = {
    ...positive,
    supported: false,
    reason: 'not-advertised',
    targetProfileId: 'cloudflare-do-sqlite-v8',
  };
  const committed = await follower.commitOfflineMutationReplayCapabilityFact(negative);
  assert.equal(committed.supported, false);
  assert.equal(committed.storeRevision, 2);
  assert.deepEqual(await writer.readOfflineMutationReplayCapabilityFact(), committed);
  await follower.close();
  await writer.close();
});

test('sqlite arm carries the outbox contract atomically', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-outbox-sqlite-'));
  const store = await createSqliteRqsResumeStore({
    sqlite: createNodeSqliteNamespace(directory),
    databaseName: 'outbox.sqlite',
  });
  try {
    await exerciseOutboxContract(store, { label: 'sqlite' });
    assert.deepEqual(store.durability(), { implementation: 'expo-sqlite', durable: true });
    const inspection = await store.inspection();
    assert.equal(inspection.outbox.pending, 0);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sqlite stale-authority compensation deletes only its owned insertion before retry', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = mkdtempSync(join(tmpdir(), 'snapback-outbox-sqlite-stale-enqueue-'));
  const store = await createSqliteRqsResumeStore({
    sqlite: createNodeSqliteNamespace(directory),
    databaseName: 'outbox.sqlite',
  });
  const coordinator = createSuccessorCoordinator();
  const origin = 'https://sqlite-stale-enqueue.example';
  const targetProfileId = 'sqlite-stale-enqueue-sessions';
  let makeFirstInsertionStale = true;
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') {
      return Response.json({
        ...sessionHandshake(TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR),
        deploymentIdentity: {
          ...sessionHandshake(TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR).deploymentIdentity,
          appId: TEST_ARTIFACT_GENERATION.appId,
        },
      });
    }
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId,
      }));
    }
    mutationPosts += 1;
    throw new TypeError('sqlite stale-authority fixture is offline');
  };
  const injectedStore = Object.create(store);
  const enqueue = store.outboxEnqueue.bind(store);
  const isCurrent = coordinator.isCurrent.bind(coordinator);
  let authorityArtificiallyStale = false;
  coordinator.isCurrent = (capture) => (
    authorityArtificiallyStale ? false : isCurrent(capture)
  );
  injectedStore.outboxEnqueue = async (...args) => {
    const stored = await enqueue(...args);
    if (makeFirstInsertionStale) {
      makeFirstInsertionStale = false;
      authorityArtificiallyStale = true;
    }
    return stored;
  };
  const client = new InspectingSnapbackClient(origin, {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: injectedStore,
    __outboxDrainLifecycle: false,
  });
  try {
    await settleSuccessorCoordinator(coordinator);
    await client.authSession();
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'stale owned insertion' },
        clientMutationId: 'cm-sqlite-stale-owned-insertion',
      }),
      (error) => error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
    );
    assert.deepEqual(
      await store.outboxRecords(),
      [],
      'the stale invocation deletes its exact owned insertion',
    );

    authorityArtificiallyStale = false;
    const retry = await client.mutate('createThing', {
      args: { title: 'fresh retry insertion' },
      clientMutationId: 'cm-sqlite-stale-owned-insertion-retry',
    });
    assert.equal(retry.status, 'queued');
    assert.deepEqual(
      (await store.outboxRecords()).map((record) => record.id),
      ['cm-sqlite-stale-owned-insertion-retry'],
      'the fresh retry leaves exactly one durable identity',
    );
    assert.equal(mutationPosts, 1, 'only the fresh retry reaches foreground transport');
  } finally {
    await client.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('authorization generations fence prepare, settlement, late enqueue, and delete redaction', async () => {
  const store = createMemoryRqsResumeStore();
  const initialFence = await store.outboxAuthorizationStatus();
  const before = await store.outboxEnqueue({
    id: 'cm-generation-before',
    function: 'createThing',
    args: { secret: 'before' },
  });
  const preparedBefore = await store.outboxPrepareSubmission(before.id);
  assert.equal(preparedBefore.status, 'ready');
  const suspended = await applyQueueRoot(store, testQueueObligation);
  assert.equal(suspended.suspended, true);
  await assert.rejects(
    () => store.outboxDurablyConsume(
      before.id,
      { result: { ok: true } },
      null,
      [],
      preparedBefore.fence,
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
  );
  const duringQuarantine = await store.outboxEnqueue({
    id: 'cm-generation-during',
    function: 'createThing',
    args: { secret: 'during' },
  });
  assert.equal(
    (await store.outboxPrepareSubmission(duringQuarantine.id)).status,
    'authorization-suspended',
  );
  await resolveQueueRoot(store, testQueueResolution);
  await assert.rejects(
    () => store.outboxEnqueue(
      { id: 'cm-delayed-enqueue', function: 'createThing', args: { secret: 'stale' } },
      initialFence,
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE',
  );
  await assert.rejects(
    () => store.outboxAssignOperationIdentity(
      before.id,
      'delayed-operation-identity',
      null,
      undefined,
      undefined,
      preparedBefore.fence,
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE',
  );
  await assert.rejects(
    () => store.outboxDiscard(before.id, preparedBefore.fence),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE',
  );
  const releasedBefore = await store.outboxPrepareSubmission(before.id);
  const releasedDuring = await store.outboxPrepareSubmission(duringQuarantine.id);
  assert.equal(releasedBefore.status, 'ready');
  assert.equal(releasedDuring.status, 'ready');
  assert.deepEqual(releasedBefore.fence, releasedDuring.fence);

  const deleteRoot = {
    ...testQueueObligation,
    scopeId: {
      kind: 'clientQuery',
      namespace: { ...TEST_QUEUE_SCOPE.namespace, queryInstanceId: 2 },
    },
    maxDisposition: 'delete',
  };
  await applyQueueRoot(store, deleteRoot);
  const admittedUnderDelete = await store.outboxEnqueue({
    id: 'cm-generation-delete',
    function: 'createThing',
    args: { secret: 'must-not-survive' },
  });
  assert.equal(admittedUnderDelete.status, 'stranded');
  assert.equal(admittedUnderDelete.disposition, 'delete');
  assert.equal(Object.hasOwn(admittedUnderDelete, 'args'), false);
  assert.equal(admittedUnderDelete.replayable, false);
  await store.close();
});

test('default foreground mutation mints durable identity before deferring behind an active root', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await applyQueueRoot(store, testQueueObligation);
  let mutationAttempts = 0;
  globalThis.fetch = async () => {
    mutationAttempts += 1;
    throw new Error('authorization-suspended foreground must not reach transport');
  };
  const client = new SnapbackClient('https://default-foreground-root.example', {
    rqsStore: store,
  });
  const deferred = await client.mutate('createThing', {
    args: { title: 'proof-gated default mutation' },
  });
  assert.equal(deferred.status, 'queued');
  assert.equal(deferred.authorizationDisposition, 'authorization-suspended');
  assert.equal(mutationAttempts, 0);
  const [retained] = await store.outboxRecords();
  assert.equal(retained.id, deferred.clientMutationId);
  assert.equal(retained.status, 'pending');
  await store.close();
});

test('delete roots redact quarantined and rerecordable stranded intent before re-entry', async () => {
  const store = createMemoryRqsResumeStore();
  await store.outboxEnqueue({
    id: 'cm-delete-quarantined',
    function: 'createThing',
    args: { secret: 'quarantined-secret' },
  });
  await store.outboxMarkQuarantined('cm-delete-quarantined', {
    code: 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
  });
  const predecessorScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: 'stream-delete-stranded',
    userId: TEST_SESSION_USER_ID,
  };
  await store.outboxEnqueue({
    id: 'cm-delete-stranded',
    function: 'updateThing',
    args: { secret: 'stranded-secret' },
  });
  await store.outboxMarkStranded(
    'cm-delete-stranded',
    'authority_instance_changed',
    predecessorScope,
  );
  await applyQueueRoot(store, {
    ...testQueueObligation,
    maxDisposition: 'delete',
  });
  const deleteFence = await store.outboxAuthorizationStatus();
  const redacted = await store.outboxRecords();
  assert.deepEqual(redacted.map((record) => record.id), [
    'cm-delete-quarantined',
    'cm-delete-stranded',
  ]);
  for (const record of redacted) {
    assert.equal(record.status, 'stranded');
    assert.equal(record.disposition, 'delete');
    assert.equal(record.discardOnly, true);
    assert.equal(record.rerecordable, false);
    assert.equal(Object.hasOwn(record, 'args'), false);
    assert.equal(Object.hasOwn(record, 'quarantine'), false);
  }
  await assert.rejects(
    () => store.outboxReenterQuarantined(deleteFence),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
  );
  assert.deepEqual(await store.outboxPending(), []);
  await store.close();
});

test('delete tombstones survive same-authority observation, discard after proof, and retire on advance', async () => {
  const principalScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: 'stream-delete-tombstone',
    userId: TEST_SESSION_USER_ID,
  };
  const custody = { authorityEpoch: 1, authorityKey: 'delete-tombstone-authority' };
  const enqueueFenced = (store, id) => store.outboxEnqueue({
    id,
    function: 'createThing',
    args: { secret: id },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    principalScope,
    custody,
  });

  const discardStore = createMemoryRqsResumeStore();
  await enqueueFenced(discardStore, 'cm-delete-tombstone-discard');
  await applyQueueRoot(discardStore, {
    ...testQueueObligation,
    maxDisposition: 'delete',
  });
  const rooted = await discardStore.outboxAuthorizationStatus();
  const observed = await reconcileQueueCustody(
    discardStore,
    principalScope,
    TEST_AUTHORITY_DESCRIPTOR,
    custody,
    rooted.authorityGeneration,
  );
  assert.equal(observed.deleted, 0, 'same-authority status reconciliation retains the tombstone');
  assert.equal((await discardStore.outboxRecords())[0].discardOnly, true);
  await resolveQueueRoot(discardStore, {
    ...testQueueResolution,
    maxDisposition: 'delete',
  });
  const discarded = await discardStore.outboxDiscardStranded(
    ['cm-delete-tombstone-discard'],
    principalScope,
    await discardStore.outboxAuthorizationStatus(),
  );
  assert.deepEqual(discarded.clientMutationIds, ['cm-delete-tombstone-discard']);
  assert.deepEqual(await discardStore.outboxRecords(), []);
  await discardStore.close();

  const transitionStore = createMemoryRqsResumeStore();
  await enqueueFenced(transitionStore, 'cm-delete-tombstone-transition');
  await applyQueueRoot(transitionStore, {
    ...testQueueObligation,
    maxDisposition: 'delete',
  });
  await transitionStore.wipeForAuthorityTransition('delete-tombstone:1->2', 2);
  const successor = await transitionStore.outboxAuthorizationStatus();
  const retired = await reconcileQueueCustody(
    transitionStore,
    principalScope,
    { ...TEST_AUTHORITY_DESCRIPTOR, sessionGeneration: 2 },
    { authorityEpoch: 2, authorityKey: 'delete-tombstone-successor' },
    successor.authorityGeneration,
  );
  assert.deepEqual(retired.deletedIds, ['cm-delete-tombstone-transition']);
  assert.deepEqual(await transitionStore.outboxRecords(), []);
  await transitionStore.close();
});

test('active authorization root retains settled ACK collection until proof', async () => {
  const store = createMemoryRqsResumeStore();
  const target = currentOutboxTarget({ origin: 'https://ack-under-root.example' });
  await store.outboxEnqueue({
    id: 'cm-ack-under-root',
    function: 'createThing',
    args: {},
    ...target,
  });
  const prepared = await store.outboxPrepareSubmission('cm-ack-under-root');
  await store.outboxDurablyConsume(
    'cm-ack-under-root',
    { result: { ok: true } },
    null,
    [],
    prepared.fence,
  );
  await store.outboxMarkAcknowledgementsReady(
    ['cm-ack-under-root'],
    undefined,
    undefined,
    null,
    target.enqueueTarget,
  );
  await applyQueueRoot(store, testQueueObligation);
  const suspendedAckFence = await store.outboxAuthorizationStatus();
  await assert.rejects(
    () => store.outboxConfirmAcknowledgements(
      ['cm-ack-under-root'],
      undefined,
      undefined,
      suspendedAckFence,
      target.enqueueTarget,
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
  );
  assert.equal((await store.outboxRecords())[0].status, 'settled');
  await resolveQueueRoot(store, testQueueResolution);
  assert.equal(
    await store.outboxConfirmAcknowledgements(
      ['cm-ack-under-root'],
      undefined,
      undefined,
      await store.outboxAuthorizationStatus(),
      target.enqueueTarget,
    ),
    1,
  );
  assert.deepEqual(await store.outboxRecords(), []);
  await store.close();
});

test('standalone ACK serializes server confirmation and local collection against a root', async (t) => {
  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'ack-race-test', durable: true });
  const origin = 'https://ack-race.test';
  const targetProfileId = 'ack-race-profile';
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await client.closeAuth();
    await store.close();
  });
  await store.outboxEnqueue({
    id: 'cm-ack-root-race',
    function: 'createThing',
    args: {},
    ...currentOutboxTarget({ origin, targetProfileId }),
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  const prepared = await store.outboxPrepareSubmission('cm-ack-root-race');
  await store.outboxDurablyConsume(
    'cm-ack-root-race',
    { result: { ok: true }, authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR },
    TEST_SESSION_USER_ID,
    [],
    prepared.fence,
  );
  await store.outboxMarkAcknowledgementsReady(['cm-ack-root-race']);
  let releaseResponse;
  let requestStarted = false;
  const responseHeld = new Promise((resolve) => { releaseResponse = resolve; });
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({ supported: true, targetProfileId }));
    }
    requestStarted = true;
    await responseHeld;
    return Response.json({ acknowledged: 1 });
  };
  await client.inspect();

  const acknowledgement = client.acknowledgeMutations({
    userId: TEST_SESSION_USER_ID,
    clientMutationIds: ['cm-ack-root-race'],
  });
  while (!requestStarted) await new Promise((resolve) => setImmediate(resolve));
  let rootCommitted = false;
  const root = store.withOutboxAuthorizationDispatch(async () => {
    await applyQueueRoot(store, testQueueObligation);
    rootCommitted = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rootCommitted, false, 'root cannot split remote ACK from local collection');
  releaseResponse();
  await acknowledgement;
  await root;
  assert.equal(rootCommitted, true);
  assert.deepEqual(await store.outboxRecords(), []);
  assert.equal((await store.outboxAuthorizationStatus()).suspended, true);
});

test('authorization dispatch gate makes prepare-to-transport and root installation one order', async () => {
  const store = createMemoryRqsResumeStore();
  await store.outboxEnqueue({ id: 'cm-gated-transport', function: 'createThing', args: {} });
  let releaseTransport;
  let prepared;
  const transportHeld = new Promise((resolve) => { releaseTransport = resolve; });
  const transport = store.withOutboxAuthorizationDispatch(async () => {
    prepared = await store.outboxPrepareSubmission('cm-gated-transport');
    await transportHeld;
    await store.outboxDurablyConsume(
      'cm-gated-transport',
      { result: { ok: true } },
      null,
      [],
      prepared.fence,
    );
  });
  await new Promise((resolve) => setImmediate(resolve));
  let rootCommitted = false;
  const root = store.withOutboxAuthorizationDispatch(async () => {
    await applyQueueRoot(store, testQueueObligation);
    rootCommitted = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prepared.status, 'ready');
  assert.equal(rootCommitted, false, 'root cannot split prepare from settlement');
  releaseTransport();
  await transport;
  await root;
  assert.equal(rootCommitted, true);
  assert.equal((await store.outboxAuthorizationStatus()).suspended, true);
  await store.close();
});

test('active authorization root retains result-gone discard until proof', async () => {
  const store = createMemoryRqsResumeStore();
  await store.outboxEnqueue({
    id: 'cm-result-gone-discard-root',
    function: 'createThing',
    args: { secret: 'retained-until-proof' },
  });
  const prepared = await store.outboxPrepareSubmission('cm-result-gone-discard-root');
  await store.outboxMarkResultGone('cm-result-gone-discard-root', {
    outcome: 'committed',
    receiptDigest: `sha256:${'a'.repeat(64)}`,
  }, prepared.fence);
  await applyQueueRoot(store, testQueueObligation);
  const suspendedFence = await store.outboxAuthorizationStatus();
  await assert.rejects(
    () => store.outboxDiscard('cm-result-gone-discard-root', suspendedFence),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
  );
  assert.equal((await store.outboxRecords())[0].status, 'result-gone');
  await resolveQueueRoot(store, testQueueResolution);
  assert.equal(
    await store.outboxDiscard(
      'cm-result-gone-discard-root',
      await store.outboxAuthorizationStatus(),
    ),
    true,
  );
  assert.deepEqual(await store.outboxRecords(), []);
  await store.close();
});

test('authority transition atomically retires roots and dispositions predecessor records', async () => {
  const store = createMemoryRqsResumeStore();
  await store.outboxEnqueue({
    id: 'cm-predecessor-authority',
    function: 'createThing',
    args: { secret: 'predecessor' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    principalScope: {
      authMode: 'sessions',
      authorizationStreamIncarnation: 'stream-predecessor',
      userId: TEST_SESSION_USER_ID,
    },
    custody: { authorityEpoch: 1, authorityKey: 'predecessor-authority-key' },
  });
  await applyQueueRoot(store, testQueueObligation);
  const predecessor = await store.outboxAuthorizationStatus();
  assert.equal(predecessor.suspended, true);
  assert.equal(await store.wipeForAuthorityTransition(), true);
  const retired = await store.outboxAuthorizationStatus();
  assert.equal(retired.authorityGeneration, predecessor.authorityGeneration + 1);
  assert.equal(retired.suspended, false, 'orphaned subscription root is retired');
  await assert.rejects(
    () => applyQueueRoot(
      store,
      testQueueObligation,
      predecessor.authorityGeneration,
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE',
  );
  await assert.rejects(
    () => resolveQueueRoot(
      store,
      testQueueResolution,
      predecessor.authorityGeneration,
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE',
  );
  await assert.rejects(
    () => retireQueueScopes(
      store,
      [testQueueObligation.scopeId],
      predecessor.authorityGeneration,
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE',
  );
  assert.equal(
    (await store.outboxAuthorizationStatus()).suspended,
    false,
    'a delayed predecessor root cannot enter the successor authority generation',
  );
  const successorDescriptor = {
    ...TEST_AUTHORITY_DESCRIPTOR,
    authorityInstanceId: '018f0d90-7b26-7a22-8c33-445566778899',
    sessionGeneration: 2,
  };
  const disposition = await reconcileQueueCustody(
    store,
    {
      authMode: 'sessions',
      authorizationStreamIncarnation: 'stream-predecessor',
      userId: TEST_SESSION_USER_ID,
    },
    successorDescriptor,
    { authorityEpoch: 2, authorityKey: 'successor-authority-key' },
  );
  assert.deepEqual(disposition.strandedIds, ['cm-predecessor-authority']);
  assert.equal((await store.outboxRecords())[0].status, 'stranded');
  const beforeDiscard = await store.outboxAuthorizationStatus();
  await applyQueueRoot(store, testQueueObligation);
  const activeDiscard = await store.outboxAuthorizationStatus();
  await assert.rejects(
    () => store.outboxDiscardStranded(
      ['cm-predecessor-authority'],
      {
        authMode: 'sessions',
        authorizationStreamIncarnation: 'stream-predecessor',
        userId: TEST_SESSION_USER_ID,
      },
      activeDiscard,
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
  );
  assert.equal((await store.outboxRecords()).length, 1);
  await resolveQueueRoot(store, testQueueResolution);
  await assert.rejects(
    () => store.outboxDiscardStranded(
      ['cm-predecessor-authority'],
      {
        authMode: 'sessions',
        authorizationStreamIncarnation: 'stream-predecessor',
        userId: TEST_SESSION_USER_ID,
      },
      beforeDiscard,
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE',
  );
  const discarded = await store.outboxDiscardStranded(
    ['cm-predecessor-authority'],
    {
      authMode: 'sessions',
      authorizationStreamIncarnation: 'stream-predecessor',
      userId: TEST_SESSION_USER_ID,
    },
    await store.outboxAuthorizationStatus(),
  );
  assert.equal(discarded.discarded, 1);
  await store.close();
});

test('authorization dispatch serializes a delayed predecessor root behind authority advance', async () => {
  const store = createMemoryRqsResumeStore();
  const predecessor = await store.outboxAuthorizationStatus();
  let releaseTransition;
  const held = new Promise((resolve) => { releaseTransition = resolve; });
  const transition = store.withOutboxAuthorizationDispatch(async () => {
    await held;
    return store.wipeForAuthorityTransitionWithinDispatch();
  });
  await new Promise((resolve) => setImmediate(resolve));
  const delayedRoot = store.withOutboxAuthorizationDispatch(() => (
    applyQueueRoot(
      store,
      testQueueObligation,
      predecessor.authorityGeneration,
    )
  ));
  releaseTransition();
  assert.equal(await transition, true);
  await assert.rejects(
    delayedRoot,
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE',
  );
  const successor = await store.outboxAuthorizationStatus();
  assert.equal(successor.authorityGeneration, predecessor.authorityGeneration + 1);
  assert.equal(successor.suspended, false);
  await store.close();
});

test('writer and follower-request memory wipers wait behind the shared dispatch fence', async () => {
  const backing = createMemoryRqsStoreBacking();
  const writer = createMemoryRqsResumeStore({ backing });
  const follower = createMemoryRqsResumeStore({ backing });
  assert.equal(writer.isWriter(), true);
  assert.equal(follower.isWriter(), false);

  const assertWaitsBehindDispatch = async (requestWipe, label) => {
    const before = await writer.outboxAuthorizationStatus();
    let releaseDispatch;
    let markDispatchEntered;
    const dispatchEntered = new Promise((resolve) => { markDispatchEntered = resolve; });
    const dispatchRelease = new Promise((resolve) => { releaseDispatch = resolve; });
    const heldDispatch = writer.withOutboxAuthorizationDispatch(async () => {
      markDispatchEntered();
      await dispatchRelease;
    });
    await dispatchEntered;

    let settled = false;
    const wipe = requestWipe();
    void wipe.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, `${label} bypassed the held authorization-dispatch fence`);
    assert.equal(
      (await follower.outboxAuthorizationStatus()).authorityGeneration,
      before.authorityGeneration,
      `${label} advanced generation before the held dispatch completed`,
    );

    releaseDispatch();
    await heldDispatch;
    assert.equal(await wipe, true);
    assert.equal(
      (await writer.outboxAuthorizationStatus()).authorityGeneration,
      before.authorityGeneration + 1,
    );
  };

  await assertWaitsBehindDispatch(
    () => writer.wipeForAuthorityTransition(
      null,
      null,
      { rebaseUnscopedPending: true },
    ),
    'local writer wipe',
  );
  await assertWaitsBehindDispatch(
    () => follower.requestAuthorityTransitionWipe(
      null,
      null,
      { rebaseUnscopedPending: true },
    ).settlement,
    'follower registry request',
  );

  await follower.close();
  await writer.close();
});

test('root, proof, and retirement rewrites preserve keyed authority-transition idempotency', async () => {
  const store = createMemoryRqsResumeStore();
  const transitionKey = 'sessions:marker-preservation:3->4';
  assert.equal(await store.wipeForAuthorityTransition(transitionKey, 4), true);
  const advanced = await store.outboxAuthorizationStatus();

  await applyQueueRoot(store, testQueueObligation);
  const rooted = await store.outboxAuthorizationStatus();
  assert.equal(await store.wipeForAuthorityTransition(transitionKey, 4), true);
  assert.deepEqual(await store.outboxAuthorizationStatus(), rooted);

  await resolveQueueRoot(store, testQueueResolution);
  const proven = await store.outboxAuthorizationStatus();
  assert.equal(await store.wipeForAuthorityTransition(transitionKey, 4), true);
  assert.deepEqual(await store.outboxAuthorizationStatus(), proven);

  await applyQueueRoot(store, testQueueObligation);
  await retireQueueScopes(store, [testQueueObligation.scopeId]);
  const retired = await store.outboxAuthorizationStatus();
  assert.equal(await store.wipeForAuthorityTransition(transitionKey, 4), true);
  assert.deepEqual(await store.outboxAuthorizationStatus(), retired);
  assert.equal(retired.authorityGeneration, advanced.authorityGeneration);
  await assert.rejects(
    () => store.wipeForAuthorityTransition('sessions:marker-preservation:2->3', 3),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORITY_TRANSITION_STALE',
  );
  await store.close();
});

test('custody reconciliation is bound to the authority generation its transition advanced', async () => {
  const store = createMemoryRqsResumeStore();
  await store.outboxEnqueue({
    id: 'cm-interleaved-transition',
    function: 'createThing',
    args: { secret: 'predecessor' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    principalScope: {
      authMode: 'sessions',
      authorizationStreamIncarnation: 'stream-predecessor',
      userId: TEST_SESSION_USER_ID,
    },
    custody: { authorityEpoch: 1, authorityKey: 'predecessor-authority-key' },
  });

  assert.equal(await store.wipeForAuthorityTransition('transition-a', 2), true);
  const transitionA = await store.outboxAuthorizationStatus();
  assert.equal(await store.wipeForAuthorityTransition('transition-b', 3), true);
  const transitionB = await store.outboxAuthorizationStatus();

  const successorB = await reconcileQueueCustody(
    store,
    {
      authMode: 'sessions',
      authorizationStreamIncarnation: 'stream-predecessor',
      userId: TEST_SESSION_USER_ID,
    },
    {
      ...TEST_AUTHORITY_DESCRIPTOR,
      authorityInstanceId: '018f0d90-7b28-7a22-8c33-445566778899',
      sessionGeneration: 3,
    },
    { authorityEpoch: 3, authorityKey: 'successor-b-authority-key' },
    transitionB.authorityGeneration,
  );
  assert.deepEqual(successorB.strandedIds, ['cm-interleaved-transition']);
  await assert.rejects(
    () => reconcileQueueCustody(
      store,
      {
        authMode: 'sessions',
        authorizationStreamIncarnation: 'stream-predecessor',
        userId: TEST_SESSION_USER_ID,
      },
      {
        ...TEST_AUTHORITY_DESCRIPTOR,
        authorityInstanceId: '018f0d90-7b27-7a22-8c33-445566778899',
        sessionGeneration: 2,
      },
      { authorityEpoch: 2, authorityKey: 'successor-a-authority-key' },
      transitionA.authorityGeneration,
    ),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE',
  );
  const finalStatus = await store.outboxAuthorizationStatus();
  assert.equal(finalStatus.authorityGeneration, transitionB.authorityGeneration);
  assert.equal((await store.outboxRecords())[0].status, 'stranded');
  await assert.rejects(
    () => store.wipeForAuthorityTransition('transition-a', 2),
    (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORITY_TRANSITION_STALE',
  );
  await store.close();
});

test('authority transition leaves quarantined and result-gone records recoverable', async () => {
  const store = createMemoryRqsResumeStore();
  const principalScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: 'stream-terminal-transition',
    userId: TEST_SESSION_USER_ID,
  };
  const predecessorCustody = {
    authorityEpoch: 1,
    authorityKey: 'terminal-transition-predecessor',
  };
  const fencedRecord = (id) => ({
    id,
    function: 'createThing',
    args: { secret: id },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    principalScope,
    custody: predecessorCustody,
  });
  await store.outboxEnqueue(fencedRecord('cm-transition-quarantined'));
  await store.outboxMarkQuarantined('cm-transition-quarantined', {
    code: 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
  });
  await store.outboxEnqueue(fencedRecord('cm-transition-result-gone'));
  const resultGonePreparation = await store.outboxPrepareSubmission('cm-transition-result-gone');
  await store.outboxMarkResultGone('cm-transition-result-gone', {
    outcome: 'committed',
    receiptDigest: `sha256:${'f'.repeat(64)}`,
  }, resultGonePreparation.fence);

  await store.wipeForAuthorityTransition('terminal-records:1->2', 2);
  const successorStatus = await store.outboxAuthorizationStatus();
  const successorDescriptor = {
    ...TEST_AUTHORITY_DESCRIPTOR,
    authorityInstanceId: '018f0d90-7b29-7a22-8c33-445566778899',
    sessionGeneration: 2,
  };
  const reconciled = await reconcileQueueCustody(
    store,
    principalScope,
    successorDescriptor,
    { authorityEpoch: 2, authorityKey: 'terminal-transition-successor' },
    successorStatus.authorityGeneration,
  );
  assert.deepEqual(reconciled.strandedIds, ['cm-transition-quarantined']);
  const records = await store.outboxRecords();
  assert.equal(records.find((record) => record.id === 'cm-transition-quarantined').status, 'stranded');
  const resultGone = records.find((record) => record.id === 'cm-transition-result-gone');
  assert.equal(resultGone.status, 'result-gone');
  assert.equal(resultGone.authorizationAuthorityGeneration, successorStatus.authorityGeneration);
  assert.equal(
    await store.outboxDiscard(
      'cm-transition-result-gone',
      await store.outboxAuthorizationStatus(),
    ),
    true,
  );
  assert.deepEqual(
    (await store.outboxRecords()).map((record) => record.id),
    ['cm-transition-quarantined'],
  );
  await store.close();
});

test('file arm routes peer-negative capability replacement, survives relaunch, and refuses non-writers', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-outbox-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createFileRqsResumeStore({ directory, identity: 'origin:test' });
  await store.whenLockSettled();
  await exerciseOutboxContract(store, { label: 'file' });
  await store.outboxEnqueue({ id: 'cm-durable', function: 'createThing', args: { n: 1 } });
  // A second instance in the same process on the same identity is a reader:
  // enqueue must throw the typed not-writer refusal, never silently drop.
  const reader = createFileRqsResumeStore({ directory, identity: 'origin:test' });
  await reader.whenLockSettled();
  assert.equal(reader.isWriter(), false);
  const positive = {
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin: 'https://file-peer.example',
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  };
  const predecessorRevision = (
    await store.readOfflineMutationReplayCapabilityFact()
  )?.storeRevision ?? 0;
  assert.equal(
    (await store.commitOfflineMutationReplayCapabilityFact(positive)).storeRevision,
    predecessorRevision + 1,
  );
  const peerNegative = await reader.commitOfflineMutationReplayCapabilityFact({
    ...positive,
    supported: false,
    reason: 'not-advertised',
    targetProfileId: 'cloudflare-do-sqlite-v8',
  });
  assert.equal(peerNegative.supported, false);
  assert.equal(peerNegative.storeRevision, predecessorRevision + 2);
  assert.deepEqual(
    await store.readOfflineMutationReplayCapabilityFact(),
    peerNegative,
    'the in-process follower routes the answered negative through the file writer',
  );
  await assert.rejects(
    () => reader.outboxEnqueue({ id: 'cm-x', function: 'createThing' }),
    (error) => error.code === 'SNAPBACK_OUTBOX_NOT_WRITER',
  );
  assert.equal(await reader.outboxEmpty(), false, 'readers still see pending intent');
  await reader.close();
  await store.close();
  // Relaunch (fresh instance): the pending record survived on disk.
  const relaunched = createFileRqsResumeStore({ directory, identity: 'origin:test' });
  await relaunched.whenLockSettled();
  assert.equal(relaunched.isWriter(), true, 'relaunch reclaims writership');
  assert.deepEqual(
    (await relaunched.outboxPending()).map((r) => r.id),
    ['cm-durable'],
    'restart-safe queue: pending intent survives the relaunch',
  );
  await relaunched.close();
});

test('file arm retains a consumed settlement and ACK obligation across relaunch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-outbox-settlement-'));
  const store = createFileRqsResumeStore({ directory, identity: 'origin:settlement' });
  await store.whenLockSettled();
  const target = currentOutboxTarget({
    origin: 'https://file-settlement.example',
    targetProfileId: 'file-settlement',
  });
  await store.outboxEnqueue({
    id: 'cm-settled', function: 'createThing', args: { n: 1 }, ...target,
  });
  await store.outboxDurablyConsume(
    'cm-settled',
    { result: { id: 'thing_1' }, version: 9 },
    'user_a',
  );
  await store.close();

  const relaunched = createFileRqsResumeStore({ directory, identity: 'origin:settlement' });
  await relaunched.whenLockSettled();
  assert.deepEqual(await relaunched.outboxPending(), [], 'settled work is never re-executed');
  const retained = (await relaunched.outboxRecords()).find((record) => record.id === 'cm-settled');
  assert.equal(retained.status, 'settled');
  assert.deepEqual(retained.settlement.result, { id: 'thing_1' });
  assert.deepEqual(await relaunched.outboxPendingAcknowledgements('user_a'), []);
  await relaunched.outboxMarkAcknowledgementsReady(
    ['cm-settled'], undefined, undefined, null, target.enqueueTarget,
  );
  assert.deepEqual(
    await relaunched.outboxPendingAcknowledgements(
      'user_a', 64, null, target.enqueueTarget,
    ),
    ['cm-settled'],
  );
  await relaunched.outboxConfirmAcknowledgements(
    ['cm-settled'], undefined, undefined, null, target.enqueueTarget,
  );
  assert.deepEqual(await relaunched.outboxRecords(), []);
  await relaunched.close();
});

test('file arm migrates a v1 blob in place (entries kept, empty outbox)', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-outbox-v1-'));
  const store = createFileRqsResumeStore({ directory, identity: 'origin:v1' });
  await store.whenLockSettled();
  // Find the blob path by writing once, then rewrite it as a v1 blob.
  await store.outboxEnqueue({ id: 'cm-seed', function: 'seed' });
  const blobName = (await import('node:fs')).readdirSync(directory)
    .find((name) => name.endsWith('.v1.json'));
  const blobPath = join(directory, blobName);
  const v2 = JSON.parse(readFileSync(blobPath, 'utf8'));
  writeFileSync(blobPath, JSON.stringify({
    format: RQS_FILE_STORE_FORMAT_V1,
    entries: v2.entries,
  }));
  assert.deepEqual(await store.outboxPending(), [], 'v1 blob reads as an empty outbox');
  const record = await store.outboxEnqueue({ id: 'cm-after', function: 'seed' });
  assert.equal(record.sequence, 1, 'migrated store restarts its sequence');
  const upgraded = JSON.parse(readFileSync(blobPath, 'utf8'));
  assert.notEqual(upgraded.format, RQS_FILE_STORE_FORMAT_V1, 'write upgrades the format');
  await store.close();
});

test('default store resolution ladder', async () => {
  // Node with a state directory -> durable file store.
  const directory = mkdtempSync(join(tmpdir(), 'snapback-default-'));
  const previousDir = process.env.SNAPBACK_CLIENT_RQS_DIR;
  const previousSwitch = process.env.SNAPBACK_CLIENT_RQS_STORE;
  try {
    process.env.SNAPBACK_CLIENT_RQS_DIR = directory;
    delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    const resolved = resolveDefaultRqsStore({ baseUrl: 'http://127.0.0.1:4400' });
    assert.equal(resolved.info.implementation, 'file');
    assert.equal(resolved.info.durable, true);
    assert.equal(resolved.info.source, 'default');
    await resolved.store.close();
    // An admitted application platform dispatches before the ambient Node
    // file arm.
    const appPlatform = resolveDefaultRqsStore({
      baseUrl: 'http://127.0.0.1:4400',
      appPlatform: { kind: 'memory' },
    });
    assert.equal(appPlatform.info.implementation, 'memory');
    assert.equal(appPlatform.info.reason, 'volatile-platform');
    await appPlatform.store.close();
    // Kill switch -> disabled, no store.
    process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';
    const disabled = resolveDefaultRqsStore({ baseUrl: 'http://127.0.0.1:4400' });
    assert.equal(disabled.store, null);
    assert.equal(disabled.info.source, 'disabled');
  } finally {
    if (previousDir === undefined) delete process.env.SNAPBACK_CLIENT_RQS_DIR;
    else process.env.SNAPBACK_CLIENT_RQS_DIR = previousDir;
    if (previousSwitch === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    else process.env.SNAPBACK_CLIENT_RQS_STORE = previousSwitch;
  }
});

test('platform-admitted browser defaults isolate queue epochs by full app owner key', async () => {
  const previousSwitch = process.env.SNAPBACK_CLIENT_RQS_STORE;
  delete process.env.SNAPBACK_CLIENT_RQS_STORE;
  const indexedDB = new IDBFactory();
  const lockManager = {
    tails: new Map(),
    request(name, _options, operation) {
      const previous = this.tails.get(name) ?? Promise.resolve();
      const result = previous.catch(() => {}).then(operation);
      const tail = result.catch(() => {});
      this.tails.set(name, tail);
      return result.finally(() => {
        if (this.tails.get(name) === tail) this.tails.delete(name);
      });
    },
  };
  const appPlatform = { kind: 'browser', indexedDB, lockManager };
  const ownerA = {
    appId: '018f0d90-7c20-7a22-8c33-445566778899',
    storagePartition: 'default',
  };
  const ownerByPartition = {
    ...ownerA,
    storagePartition: 'preview',
  };
  const ownerByApp = {
    appId: '018f0d90-7c28-7a22-8c33-445566778899',
    storagePartition: 'default',
  };
  const opened = [];
  const openOwner = async (appOwnerKey) => {
    const resolved = resolveDefaultRqsStore({
      baseUrl: 'http://127.0.0.1:4400',
      appPlatform,
      appOwnerKey,
    });
    opened.push(resolved.store);
    assert.equal(resolved.info.implementation, 'indexeddb');
    await resolved.store.whenLockSettled();
    assert.equal(resolved.store.isWriter(), true);
    return resolved.store;
  };
  try {
    let store = await openOwner(ownerA);
    assert.equal(await store.wipeForAuthorityTransition('owner-a:1->2', 2), true);
    await store.outboxEnqueue({ id: 'owner-a-intent', function: 'ownerA' });
    await store.close();

    store = await openOwner(ownerByPartition);
    assert.equal(
      await store.wipeForAuthorityTransition('owner-partition:0->1', 1),
      true,
      'a distinct storage partition accepts its own epoch 1',
    );
    assert.equal(await store.wipeForAuthorityTransition('owner-partition:6->7', 7), true);
    await store.outboxEnqueue({ id: 'owner-partition-intent', function: 'ownerPartition' });
    await store.close();

    store = await openOwner(ownerByApp);
    assert.equal(
      await store.wipeForAuthorityTransition('owner-app:0->1', 1),
      true,
      'a distinct app id accepts its own epoch 1',
    );
    assert.equal(await store.wipeForAuthorityTransition('owner-app:10->11', 11), true);
    await store.close();

    store = await openOwner(ownerA);
    assert.equal(
      await store.wipeForAuthorityTransition('owner-a:1->2', 2),
      true,
      'owner A still sees its own idempotent epoch rather than another owner successor',
    );
    assert.deepEqual(
      (await store.outboxPending()).map(({ id }) => id),
      ['owner-a-intent'],
      'higher transitions in both other owner namespaces do not clear owner A',
    );
    await store.close();

    store = await openOwner(ownerByPartition);
    assert.equal(
      await store.wipeForAuthorityTransition('owner-partition:6->7', 7),
      true,
      'the partition owner retains its own transition epoch',
    );
    assert.deepEqual(
      (await store.outboxPending()).map(({ id }) => id),
      ['owner-partition-intent'],
      'the partition owner retains its own resident queue',
    );
    await store.close();
  } finally {
    await Promise.allSettled(opened.map((store) => store.close()));
    if (previousSwitch === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    else process.env.SNAPBACK_CLIENT_RQS_STORE = previousSwitch;
  }
});

test('platform-admitted native defaults isolate queue epochs by full app owner key', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-native-owner-isolation-'));
  const previousSwitch = process.env.SNAPBACK_CLIENT_RQS_STORE;
  delete process.env.SNAPBACK_CLIENT_RQS_STORE;
  clearNativeRqsFiles();
  registerNativeRqsFiles({
    directory,
    files: createNodeFilesAdapter(),
    implementation: 'test-native-files',
  });
  const appPlatform = { kind: 'expo-native' };
  const ownerA = {
    appId: '018f0d90-7c20-7a22-8c33-445566778899',
    storagePartition: 'default',
  };
  const ownerByPartition = {
    ...ownerA,
    storagePartition: 'preview',
  };
  const ownerByApp = {
    appId: '018f0d90-7c28-7a22-8c33-445566778899',
    storagePartition: 'default',
  };
  const opened = [];
  const openOwner = async (appOwnerKey) => {
    const resolved = resolveDefaultRqsStore({
      baseUrl: 'http://127.0.0.1:4400',
      appPlatform,
      appOwnerKey,
    });
    opened.push(resolved.store);
    assert.equal(resolved.info.implementation, 'file');
    await resolved.store.whenLockSettled();
    assert.equal(resolved.store.isWriter(), true);
    return resolved.store;
  };
  try {
    let store = await openOwner(ownerA);
    assert.equal(await store.wipeForAuthorityTransition('owner-a:1->2', 2), true);
    await store.outboxEnqueue({ id: 'owner-a-intent', function: 'ownerA' });
    await store.close();

    store = await openOwner(ownerByPartition);
    assert.equal(
      await store.wipeForAuthorityTransition('owner-partition:0->1', 1),
      true,
      'a distinct storage partition accepts its own epoch 1',
    );
    assert.equal(await store.wipeForAuthorityTransition('owner-partition:6->7', 7), true);
    await store.outboxEnqueue({ id: 'owner-partition-intent', function: 'ownerPartition' });
    await store.close();

    store = await openOwner(ownerByApp);
    assert.equal(
      await store.wipeForAuthorityTransition('owner-app:0->1', 1),
      true,
      'a distinct app id accepts its own epoch 1',
    );
    assert.equal(await store.wipeForAuthorityTransition('owner-app:10->11', 11), true);
    await store.close();

    store = await openOwner(ownerA);
    assert.equal(
      await store.wipeForAuthorityTransition('owner-a:1->2', 2),
      true,
      'owner A still sees its own idempotent epoch rather than another owner successor',
    );
    assert.deepEqual(
      (await store.outboxPending()).map(({ id }) => id),
      ['owner-a-intent'],
      'higher transitions in both other owner namespaces do not clear owner A',
    );
    await store.close();

    store = await openOwner(ownerByPartition);
    assert.equal(
      await store.wipeForAuthorityTransition('owner-partition:6->7', 7),
      true,
      'the partition owner retains its own transition epoch',
    );
    assert.deepEqual(
      (await store.outboxPending()).map(({ id }) => id),
      ['owner-partition-intent'],
      'the partition owner retains its own resident queue',
    );
    await store.close();
  } finally {
    await Promise.allSettled(opened.map((store) => store.close()));
    clearNativeRqsFiles();
    rmSync(directory, { recursive: true, force: true });
    if (previousSwitch === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    else process.env.SNAPBACK_CLIENT_RQS_STORE = previousSwitch;
  }
});

test('client constructor reports the resolved store (DK-9 degradation fact)', () => {
  const injected = createMemoryRqsResumeStore();
  const client = new SnapbackClient('http://127.0.0.1:4400', { rqsStore: injected });
  assert.deepEqual(
    { ...client.rqsStoreInfo },
    { source: 'injected', implementation: 'memory', durable: false, reason: null },
  );
  const optedOut = new SnapbackClient('http://127.0.0.1:4400', { rqsStore: null });
  assert.equal(optedOut.rqsStore, null);
  assert.equal(optedOut.rqsStoreInfo.source, 'disabled');
});

test('volatile store never claims the durable settlement-publication path', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createMemoryRqsResumeStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new TypeError('fetch failed'); };
  await assert.rejects(
    () => client.mutate('createThing', { args: {}, queue: true }),
    (error) => error.code === 'SNAPBACK_OFFLINE_QUEUE_DURABILITY_REQUIRED',
  );
  assert.equal(calls, 0, 'required durable custody refuses before dispatch');
  await assert.rejects(
    () => client.mutate('createThing', { args: {} }),
    (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
  );
  assert.equal((await store.outboxRecords()).length, 0, 'auto mode never queues into memory');
});

test("queue:'auto' uses online-only dispatch for a ledger-less target and cached-evidence non-writers fail without POST", async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('https://ledgerless.example', { rqsStore: store });
  let mutationCalls = 0;
  let inspectCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      inspectCalls += 1;
      return Response.json(offlineReplayCapabilityManifest({
        supported: false,
        targetProfileId: 'cloudflare-do-sqlite-v8',
      }));
    }
    mutationCalls += 1;
    return Response.json({ result: { acceptedOnlineOnly: true }, version: 1 });
  };

  const onlineOnly = await client.mutate(
    'createThing',
    { args: { title: 'committed-or-not' } },
  );
  assert.equal(onlineOnly.status, 'settled');
  assert.deepEqual(onlineOnly.result, { acceptedOnlineOnly: true });
  assert.equal(mutationCalls, 1, 'an answered capability gap permits one online-only POST');
  assert.equal(inspectCalls, 1, 'the target manifest is checked before durable fallback');
  assert.deepEqual(await store.outboxRecords(), [], 'the online-only delivery is never enqueued');

  const backing = createMemoryRqsStoreBacking();
  const writerStore = createDurableTestStore({ backing });
  const followerStore = createDurableTestStore({ backing });
  assert.equal(writerStore.isWriter(), true);
  assert.equal(followerStore.isWriter(), false);
  await writerStore.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin: 'https://cached-non-writer.example',
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  });
  await writerStore.outboxEnqueue({
    id: 'cm-writer-held-cached',
    function: 'generatedCachedNonWriter',
    args: { title: 'writer-held' },
    expectedGeneration: TEST_ARTIFACT_GENERATION,
  });
  const generatedReference = {
    artifactKind: 'functionReference',
    kind: 'Mutation',
    id: 'outbox-adoption-test:generatedCachedNonWriter',
    name: 'generatedCachedNonWriter',
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
    mutationIr: {
      format: 'snapback.generated-mutation-ir.v1',
      capabilityClass: 'local-executable',
      operationHash: `sha256:${'d'.repeat(64)}`,
      plan: { steps: [] },
    },
  };
  const followerClient = new InspectingSnapbackClient(
    'https://cached-non-writer.example',
    { rqsStore: followerStore, __outboxDrainLifecycle: false },
  );
  const storeRuntimeInvoke = followerClient.__storeRuntimeInvoke.bind(followerClient);
  followerClient.__storeRuntimeInvoke = async (name, ...args) => {
    if (name !== 'prepareGeneratedMutation') return storeRuntimeInvoke(name, ...args);
    const [{ clientMutationId }] = args;
    return {
      generatedMutation: { operationHash: generatedReference.mutationIr.operationHash },
      clientMutationId,
      optimisticOperation: null,
      ctxLedger: null,
      settlementLane: 'replay-accept',
      settlementIdentity: null,
      settlementClaims: null,
      boundedSkew: null,
    };
  };
  let followerInspectCalls = 0;
  let followerMutationCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') followerInspectCalls += 1;
    else followerMutationCalls += 1;
    throw new TypeError('offline cached follower');
  };
  await assert.rejects(
    () => followerClient.mutate(generatedReference, {
      args: { title: 'writer-held' },
      clientMutationId: 'cm-writer-held-cached',
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_NOT_WRITER',
    'cached support preserves the exact enqueue-custody refusal',
  );
  assert.equal(followerInspectCalls, 1, 'the cached path starts with one lost re-probe');
  assert.equal(followerMutationCalls, 0, 'cached evidence never licenses a mutation POST');
  assert.deepEqual(
    (await writerStore.outboxRecords()).map((record) => record.id),
    ['cm-writer-held-cached'],
    'the writer-held record remains the sole custody record',
  );
  await followerStore.close();
  await writerStore.close();
});

test('an uncommitted positive capability fact is enqueue-only for an IndexedDB follower', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const indexedDB = new IDBFactory();
  const lockManager = createContendedLockManager();
  const options = {
    indexedDB,
    lockManager,
    databaseName: 'outbox-uncommitted-positive-follower',
    broadcastChannelFactory: null,
  };
  const writerStore = createIndexedDbRqsResumeStore(options);
  const followerStore = createIndexedDbRqsResumeStore(options);
  await Promise.all([writerStore.whenLockSettled(), followerStore.whenLockSettled()]);
  assert.equal(writerStore.isWriter(), true);
  assert.equal(followerStore.isWriter(), false);
  const origin = 'https://uncommitted-positive-follower.example';
  const targetProfileId = 'local-dev-sqlite-ibex';
  await writerStore.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId,
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  });
  const commitCapabilityFact = followerStore.commitOfflineMutationReplayCapabilityFact.bind(
    followerStore,
  );
  followerStore.commitOfflineMutationReplayCapabilityFact = async () => false;
  const generatedReference = {
    artifactKind: 'functionReference',
    kind: 'Mutation',
    id: 'outbox-adoption-test:uncommittedPositiveFollower',
    name: 'uncommittedPositiveFollower',
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
    mutationIr: {
      format: 'snapback.generated-mutation-ir.v1',
      capabilityClass: 'local-executable',
      operationHash: `sha256:${'e'.repeat(64)}`,
      plan: { steps: [] },
    },
  };
  const followerClient = new InspectingSnapbackClient(origin, {
    rqsStore: followerStore,
    __outboxDrainLifecycle: false,
  });
  followerClient.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  const storeRuntimeInvoke = followerClient.__storeRuntimeInvoke.bind(followerClient);
  followerClient.__storeRuntimeInvoke = async (name, ...args) => {
    if (name !== 'prepareGeneratedMutation') return storeRuntimeInvoke(name, ...args);
    const [{ clientMutationId }] = args;
    return {
      generatedMutation: { operationHash: generatedReference.mutationIr.operationHash },
      clientMutationId,
      optimisticOperation: null,
      ctxLedger: null,
      settlementLane: 'replay-accept',
      settlementIdentity: null,
      settlementClaims: null,
      boundedSkew: null,
    };
  };
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({ supported: true, targetProfileId }));
    }
    mutationPosts += 1;
    return Response.json({ result: { wronglyDispatched: true }, version: 1 });
  };

  try {
    await assert.rejects(
      () => followerClient.mutate(generatedReference, {
        args: { title: 'writer custody is not committed here' },
      }),
      (error) => error.code === 'SNAPBACK_OUTBOX_NOT_WRITER',
      'the uncommitted answer has the same enqueue-only fence as cached evidence',
    );
    assert.equal(mutationPosts, 0, 'uncommitted evidence never licenses an online mutation POST');
    assert.deepEqual(await writerStore.outboxRecords(), [], 'the writer queue remains untouched');
  } finally {
    followerStore.commitOfflineMutationReplayCapabilityFact = commitCapabilityFact;
    await followerClient.close();
    await followerStore.close();
    await writerStore.close();
  }
});

test("queue:'auto' refuses when a newer shared negative wins an in-flight positive inspection", async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://positive-inspection-loses-cas.example';
  const targetProfileId = 'local-dev-sqlite-ibex';
  await commitCompleteReplayCapability(store, origin, targetProfileId);
  const inspectingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  inspectingClient.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  replacingClient.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let resolvePositiveInspection;
  let announcePositiveInspection;
  const positiveInspectionStarted = new Promise((resolve) => {
    announcePositiveInspection = resolve;
  });
  const positiveInspectionResponse = new Promise((resolve) => {
    resolvePositiveInspection = resolve;
  });
  let inspectionMode = 'held-positive';
  let mutationPosts = 0;
  const postedClientMutationIds = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      if (inspectionMode === 'held-positive') {
        announcePositiveInspection();
        return positiveInspectionResponse;
      }
      return Response.json(offlineReplayInspection({
        supported: false,
        targetProfileId,
      }));
    }
    if (path === '/mutation/createThing') {
      mutationPosts += 1;
      postedClientMutationIds.push(JSON.parse(init.body).clientMutationId ?? null);
      return Response.json({ result: { wronglyDispatched: true }, version: 1 });
    }
    throw new Error(`unexpected CAS-loser request ${path}`);
  };

  try {
    const mutating = inspectingClient.mutate('createThing', {
      args: { title: 'stale positive must not mint transport identity' },
      queue: 'auto',
    }).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    await positiveInspectionStarted;
    inspectionMode = 'negative';
    await replacingClient.inspect();
    resolvePositiveInspection(Response.json(offlineReplayInspection({
      supported: true,
      targetProfileId,
    })));

    const outcome = await mutating;
    assert.equal(outcome.value, null);
    assert.equal(
      outcome.error?.code,
      'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
    );
    assert.equal(outcome.error?.diagnostic?.details?.reason, 'inspection-superseded');
    assert.equal(mutationPosts, 0, 'the CAS-losing positive sends no mutation POST');
    assert.deepEqual(postedClientMutationIds, [], 'no clientMutationId reaches transport');
    assert.deepEqual(await store.outboxRecords(), [], 'the refused call creates no durable intent');
  } finally {
    resolvePositiveInspection(Response.json(offlineReplayInspection({
      supported: true,
      targetProfileId,
    })));
    await replacingClient.close();
    await inspectingClient.close();
    await store.close();
  }
});

test("queue:'auto' retains authorization fencing when replay capability is unavailable", async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const generatedReference = {
    artifactKind: 'functionReference',
    kind: 'Mutation',
    id: 'outbox-store-test:generatedLedgerlessMutation',
    name: 'generatedLedgerlessMutation',
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
    mutationIr: {
      format: 'snapback.generated-mutation-ir.v1',
      capabilityClass: 'local-executable',
      operationHash: `sha256:${'e'.repeat(64)}`,
      plan: { steps: [] },
    },
  };
  let mutationCalls = 0;
  globalThis.fetch = async () => {
    mutationCalls += 1;
    throw new Error('authorization-suspended mutation must not reach transport');
  };

  for (const variant of ['explicit-id', 'generated', 'queue-false', 'forged-ownership']) {
    const store = createDurableTestStore();
    await applyQueueRoot(store, {
      ...testQueueObligation,
      scopeId: {
        ...testQueueObligation.scopeId,
        namespace: {
          ...testQueueObligation.scopeId.namespace,
          queryInstanceId: variant === 'explicit-id'
            ? 41
            : variant === 'generated'
              ? 42
              : variant === 'queue-false' ? 43 : 44,
        },
      },
    });
    const client = new InspectingSnapbackClient('https://ledgerless-root.example', {
      rqsStore: store,
      __offlineMutationReplayCapability: false,
      __outboxDrainLifecycle: false,
    });
    if (variant === 'generated') {
      const storeRuntimeInvoke = client.__storeRuntimeInvoke.bind(client);
      client.__storeRuntimeInvoke = async (name, ...args) => {
        if (name !== 'prepareGeneratedMutation') return storeRuntimeInvoke(name, ...args);
        const [{ clientMutationId }] = args;
        return {
          generatedMutation: { operationHash: generatedReference.mutationIr.operationHash },
          clientMutationId,
          optimisticOperation: null,
          ctxLedger: null,
          settlementLane: 'replay-accept',
          settlementIdentity: null,
          settlementClaims: null,
          boundedSkew: null,
        };
      };
    }
    await assert.rejects(
      () => client.mutate(
        variant === 'generated' ? generatedReference : 'explicitLedgerlessMutation',
        {
          args: { title: variant },
          ...(variant === 'explicit-id' ? { clientMutationId: 'cm-ledgerless-root' } : {}),
          ...(variant === 'queue-false' ? { queue: false } : {}),
          ...(variant === 'forged-ownership' ? {
            queue: false,
            __authorizationDispatchOwnership: true,
          } : {}),
        },
      ),
      (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
      `${variant} must remain behind the authorization root`,
    );
    assert.deepEqual(await store.outboxRecords(), []);
    await client.close();
  }
  assert.equal(mutationCalls, 0, 'capability degradation never bypasses the shared root');
});

test('explicit queueing fails with a typed capability error for a ledger-less target', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('https://ledgerless.example', { rqsStore: store });
  let mutationCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayCapabilityManifest({
        supported: false,
        targetProfileId: 'cloudflare-do-sqlite-v8',
      }));
    }
    mutationCalls += 1;
    throw new Error('mutation transport must not run');
  };

  await assert.rejects(
    () => client.mutate('createThing', { args: {}, queue: true }),
    (error) => (
      error.name === 'SnapbackOfflineQueueCapabilityError'
      && error.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED'
      && error.diagnostic?.details?.capability === 'offline_mutation_replay'
      && error.diagnostic?.details?.targetProfileId === 'cloudflare-do-sqlite-v8'
    ),
  );
  assert.equal(mutationCalls, 0, 'explicit queue refusal happens before mutation dispatch');
  assert.deepEqual(await store.outboxRecords(), []);
});

test('offline replay advertisement without a target profile is a coded queue refusal', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('https://malformed-replay-manifest.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let mutationCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: '',
      }));
    }
    mutationCalls += 1;
    throw new TypeError('malformed manifest must not authorize mutation transport');
  };

  await assert.rejects(
    () => client.mutate('createThing', { args: {}, queue: true }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED');
      assert.equal(error.diagnostic?.details?.reason, 'target-profile-required');
      return true;
    },
  );
  assert.equal(mutationCalls, 0);
  assert.deepEqual(await store.outboxRecords(), []);
  await client.close();
  await store.close();
});

test('capability inspection refuses redirects instead of borrowing another origin ledger', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('https://target-a.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let redirectedInspectionCalls = 0;
  let mutationCalls = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (new URL(url).pathname === '/inspect') {
      if (init.redirect === 'manual') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://target-b.example/inspect' },
        });
      }
      redirectedInspectionCalls += 1;
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'target-b-ledger',
      }));
    }
    mutationCalls += 1;
    return Response.json({ result: { unsafe: true }, version: 1 });
  };

  await assert.rejects(
    () => client.mutate('createThing', { args: {}, queue: true }),
    (error) => error.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
  );
  assert.equal(redirectedInspectionCalls, 0, 'the target-B inspection is never followed');
  assert.equal(mutationCalls, 0, 'target-B evidence never licenses a mutation POST to target A');
  assert.deepEqual(
    await store.readOfflineMutationReplayCapabilityFact(),
    {},
    'a proxy redirect is local inspection unavailability, not a durable negative fact',
  );
  assert.deepEqual((await client.outboxStatus()).offlineMutationReplayInspection, {
    status: 'unavailable',
    reason: 'answered-unavailable',
    code: 'SNAPBACK_REDIRECT_REFUSED',
    httpStatus: 302,
  });
  assert.deepEqual(await store.outboxRecords(), []);
});

test('credential-free query POSTs retain ordinary redirect behavior', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = new InspectingSnapbackClient('https://query-post-redirect.example', {
    rqsStore: null,
    __outboxDrainLifecycle: false,
  });
  let queryPosts = 0;
  let followedQueryPosts = 0;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(new URL(url).pathname, '/query/listThings');
    assert.equal(init.method, 'POST');
    queryPosts += 1;
    if (init.redirect === 'manual') {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://query-post-redirect.example/query/listThings/' },
      });
    }
    followedQueryPosts += 1;
    return Response.json({ result: { followed: true }, version: 1 });
  };

  const result = await client.query('listThings');
  assert.deepEqual(result, { result: { followed: true }, version: 1 });
  assert.equal(queryPosts, 1, 'the credential-free query starts one request');
  assert.equal(followedQueryPosts, 1, 'the platform remains free to follow the query redirect');
  await client.close();
});

test('foreground mutations treat 307/308 redirects as answered refusals', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const status of [307, 308]) {
    const store = createDurableTestStore();
    const client = new InspectingSnapbackClient(`https://mutation-redirect-${status}.example`, {
      rqsStore: store,
      __outboxDrainLifecycle: false,
    });
    let mutationPosts = 0;
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/inspect') {
        return Response.json(offlineReplayInspection({
          supported: true,
          targetProfileId: 'local-dev-sqlite-ibex',
        }));
      }
      mutationPosts += 1;
      assert.equal(init.redirect, 'manual', `${status}: mutation POST rejects redirects`);
      return new Response(null, {
        status,
        headers: { location: 'https://redirect-target.example/mutation/createThing' },
      });
    };
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { status },
        clientMutationId: `cm-foreground-redirect-${status}`,
      }),
      (error) => (
        error.code === 'SNAPBACK_REDIRECT_REFUSED'
        && !isConnectivityFailureError(error)
      ),
    );
    assert.equal(mutationPosts, 1, `${status}: no redirected second hop is followed`);
    assert.deepEqual(await store.outboxPending(), [], `${status}: redirect is never queued`);
    const [record] = await store.outboxRecords();
    assert.equal(record.status, 'failed', `${status}: answered refusal is terminal locally`);
    assert.equal(record.failure.code, 'SNAPBACK_REDIRECT_REFUSED');
    await client.close();
    await store.close();
  }
});

test('replay mutations treat 307/308 redirects as answered refusals', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const status of [307, 308]) {
    const store = createDurableTestStore();
    await store.outboxEnqueue({
      id: `cm-replay-redirect-${status}`,
      function: 'createThing',
      ...currentOutboxTarget({ origin: `https://replay-redirect-${status}.example` }),
      args: { status },
    });
    const client = new InspectingSnapbackClient(`https://replay-redirect-${status}.example`, {
      rqsStore: store,
      __outboxDrainLifecycle: false,
    });
    let replayPosts = 0;
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/inspect') {
        return Response.json(offlineReplayInspection({
          supported: true,
          targetProfileId: 'local-dev-sqlite-ibex',
        }));
      }
      replayPosts += 1;
      assert.equal(init.redirect, 'manual', `${status}: replay POST rejects redirects`);
      return new Response(null, {
        status,
        headers: { location: 'https://redirect-target.example/mutation/createThing' },
      });
    };
    const replay = await client.replayQueuedMutations();
    assert.equal(replay.replayed, 0);
    assert.equal(replay.failed, 1);
    assert.equal(replayPosts, 1, `${status}: replay follows no redirected second hop`);
    assert.deepEqual(await store.outboxPending(), [], `${status}: redirect leaves no replay work`);
    const [record] = await store.outboxRecords();
    assert.equal(record.status, 'failed');
    assert.equal(record.failure.code, 'SNAPBACK_REDIRECT_REFUSED');
    await client.close();
    await store.close();
  }
});

test('replay refuses to drain an existing outbox for a ledger-less target', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await store.outboxEnqueue({ id: 'cm-ledgerless', function: 'createThing', args: { n: 1 } });
  const client = new InspectingSnapbackClient('https://ledgerless.example', { rqsStore: store });
  let mutationCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayCapabilityManifest({
        supported: false,
        targetProfileId: 'cloudflare-do-sqlite-v8',
      }));
    }
    mutationCalls += 1;
    throw new Error('mutation transport must not run');
  };

  await assert.rejects(
    () => client.replayQueuedMutations(),
    (error) => (
      error.name === 'SnapbackOfflineQueueCapabilityError'
      && error.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED'
    ),
  );
  const controller = client.startOutboxDrain({ automatic: false, eventTarget: null });
  t.after(() => controller.stop());
  await assert.rejects(
    () => client.replayQueuedMutations(),
    (error) => (
      error.name === 'SnapbackOfflineQueueCapabilityError'
      && error.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED'
    ),
    'the public replay entry remains typed when a drain controller owns the store',
  );
  assert.equal(mutationCalls, 0, 'drain refuses before mutation transport');
  assert.deepEqual(
    (await store.outboxPending()).map((record) => record.id),
    ['cm-ledgerless'],
    'the refusal does not mutate queue custody or disposition',
  );
});

test('a target advertising the settlement ledger still queues and replays', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('http://127.0.0.1:4400', { rqsStore: store });
  let online = false;
  const delivered = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    if (!online) throw new TypeError('offline');
    if (path === '/connection/open') {
      const { connectionId } = JSON.parse(init.body);
      return Response.json({
        connectionId,
        connectionToken: `sct_${connectionId}`,
        wireVersion: 'snapback.v1',
      });
    }
    delivered.push(JSON.parse(init.body));
    return Response.json({ result: { ok: true }, version: 1 });
  };

  const queued = await client.mutate('createThing', { args: { title: 'safe' } });
  assert.equal(queued.status, 'queued');
  assert.equal((await store.outboxPending()).length, 1);

  online = true;
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: replay.replayed, failed: replay.failed, remaining: replay.remaining },
    { replayed: 1, failed: 0, remaining: 0 },
    JSON.stringify({ replay, diagnostics: client.outboxDiagnostics, pending: await store.outboxPending() }),
  );
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].clientMutationId, queued.clientMutationId);
});

test('replay treats a record removed before target selection as a stopped local no-op', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://record-not-local-replay.example';
  const targetProfileId = 'record-not-local-replay-target';
  await commitCompleteReplayCapability(store, origin, targetProfileId);
  await store.outboxEnqueue({
    id: 'cm-record-not-local-replay',
    function: 'createThing',
    ...currentOutboxTarget({ origin, targetProfileId }),
    args: { title: 'removed before the fenced reread' },
  });
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __offlineMutationReplayCapability: true,
    __outboxDrainLifecycle: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const outboxRecords = store.outboxRecords.bind(store);
  const withAuthorizationDispatch = store.withOutboxAuthorizationDispatch.bind(store);
  let hideNextRecordRead = false;
  store.withOutboxAuthorizationDispatch = (operation, options) => (
    withAuthorizationDispatch(async () => {
      hideNextRecordRead = true;
      return operation();
    }, options)
  );
  store.outboxRecords = async () => {
    if (hideNextRecordRead) {
      hideNextRecordRead = false;
      return [];
    }
    return outboxRecords();
  };
  let mutationPosts = 0;
  globalThis.fetch = async () => {
    mutationPosts += 1;
    throw new Error('record-not-local replay must not reach transport');
  };

  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: replay.replayed, remaining: replay.remaining, stopped: replay.stopped },
    { replayed: 0, remaining: 1, stopped: false },
  );
  assert.equal(mutationPosts, 0);
  assert.equal((await store.outboxRecords())[0].status, 'pending');
  assert.equal(
    client.outboxDiagnostics.some((entry) => (
      entry.code === 'SNAPBACK_OUTBOX_TARGET_FENCE_REFUSED'
      && entry.reasons?.includes('record-not-local')
    )),
    true,
  );
  await client.close();
  await store.close();
});

test('cached enqueue preserves a typed store refusal instead of relabeling it as ledger absence', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://cached-enqueue-store-refusal.example';
  await store.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  });
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/inspect');
    throw new TypeError('offline capability refresh');
  };
  const outboxRecords = store.outboxRecords.bind(store);
  const refusal = new Error('SNAPBACK_TEST_STORE_READ_FAILED: retained record is unreadable');
  refusal.code = 'SNAPBACK_TEST_STORE_READ_FAILED';
  store.outboxRecords = async () => { throw refusal; };

  try {
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'preserve the store refusal' },
        clientMutationId: 'cm-cached-enqueue-store-refusal',
      }),
      (error) => error === refusal,
      'the enqueue helper must not collapse typed store failure into custody unavailability',
    );
  } finally {
    store.outboxRecords = outboxRecords;
    await client.close();
    await store.close();
  }
});

test('migrated retained live query discovers on reconnect, publicly settles, then queues offline', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const backing = createMemoryRqsStoreBacking();
  const migratedStore = createDurableTestStore({ backing });
  const resume = makeResume(ROWS_V5, 5);
  await migratedStore.commit(rqsEntryKey('cells', {}), {
    rows: ROWS_V5,
    meta: resume.meta,
    token: resume.token,
  });
  assert.deepEqual(
    await migratedStore.readOfflineMutationReplayCapabilityFact(),
    {},
    'the migrated predecessor has retained rows but no additive capability fact',
  );
  const client = new InspectingSnapbackClient('https://rqs.example.test', {
    rqsStore: migratedStore,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let online = false;
  let inspectCalls = 0;
  let mutationCalls = 0;
  let subscribeCalls = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (!online) {
      if (path === '/inspect') inspectCalls += 1;
      else if (path.startsWith('/mutation/')) mutationCalls += 1;
      throw new TypeError('fetch failed');
    }
    if (path === '/live/cells/subscribe') {
      subscribeCalls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.resumeFromToken?.resume?.token, resume.token);
      return Response.json({
        subscription_id: 'sub-reconnected-capability',
        snapshot: { rows: ROWS_V5, version: 6 },
        resume: makeResume(ROWS_V5, 6),
      });
    }
    if (path === '/inspect') {
      inspectCalls += 1;
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    if (path === '/connection/open') {
      const { connectionId } = JSON.parse(init.body);
      return Response.json({
        connectionId,
        connectionToken: `sct_${connectionId}`,
        wireVersion: 'snapback.v1',
      });
    }
    if (path === '/live/cells/unsubscribe') {
      return Response.json({ subscription_id: 'sub-reconnected-capability', disposed: true });
    }
    if (path.startsWith('/outbox/')) return Response.json([]);
    throw new Error(`unexpected reconnect lifecycle request ${path}`);
  };

  const handle = await client.liveQuery('cells', {
    connectionId: 'capability-reconnect',
    transport: 'poll',
    pollCadenceMs: 60_000,
  });
  assert.equal(handle.freshness, 'retained', 'offline boot renders the migrated retained rows');
  assert.deepEqual(handle.rows, ROWS_V5);
  assert.equal(
    await client.whenOfflineMutationReplayCapabilitySettled(),
    null,
    'retained-only startup has not fabricated a target observation',
  );

  online = true;
  await handle.poll();
  assert.equal(handle.freshness, 'current', 'poll reconnect promotes retained rows to current');
  const discovery = await client.whenOfflineMutationReplayCapabilitySettled();
  assert.deepEqual(discovery, {
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    evidence: 'fresh',
  });
  assert.equal(subscribeCalls, 1, 'the bounded retry re-established the retained handle once');
  assert.equal(
    (await migratedStore.readOfflineMutationReplayCapabilityFact()).supported,
    true,
    'the current transition persisted the discovered positive',
  );

  online = false;
  const queued = await client.mutate('createThing', {
    args: { title: 'offline-after-reconnect' },
    clientMutationId: 'cm-reconnect-cached-enqueue',
  });
  assert.equal(queued.status, 'queued');
  assert.equal((await migratedStore.outboxPending()).length, 1);
  assert.equal(inspectCalls, 2, 'reconnect discovery and offline cached fallback each probe once');
  assert.equal(mutationCalls, 0, 'cached support enqueues without a foreground mutation POST');
  handle.dispose();
  await handle.settled();
  await migratedStore.close();
});

test('a new default client stays online-only without an established app binding', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = mkdtempSync(join(tmpdir(), 'snapback-capability-product-relaunch-'));
  const previousDir = process.env.SNAPBACK_CLIENT_RQS_DIR;
  const previousSwitch = process.env.SNAPBACK_CLIENT_RQS_STORE;
  try {
    process.env.SNAPBACK_CLIENT_RQS_DIR = directory;
    delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    const origin = 'https://product-relaunch-capability.example';
    const first = new InspectingSnapbackClient(origin, {
      __outboxDrainLifecycle: false,
    });
    await first.rqsStore.whenLockSettled();
    globalThis.fetch = async () => Response.json(offlineReplayInspection({
      supported: true,
      targetProfileId: 'local-dev-sqlite-ibex',
    }));
    await first.inspect();
    assert.equal(
      (await first.rqsStore.readOfflineMutationReplayCapabilityFact()).supported,
      true,
    );
    await first.close();

    const second = new InspectingSnapbackClient(origin, {
      __outboxDrainLifecycle: false,
    });
    await second.rqsStore.whenLockSettled();
    let inspectCalls = 0;
    let mutationPosts = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).pathname === '/inspect') inspectCalls += 1;
      else if (new URL(url).pathname.startsWith('/mutation/')) mutationPosts += 1;
      throw new TypeError('fetch failed');
    };
    await assert.rejects(
      () => second.mutate('createThing', {
        args: { title: 'cold-client-cached-capability' },
        clientMutationId: 'cm-product-relaunch-cached-capability',
      }),
      (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
    );
    assert.equal(inspectCalls, 1, 'the successor still attempts one fresh capability probe');
    assert.equal(mutationPosts, 1, 'an unbound successor makes one online-only mutation POST');
    assert.deepEqual(
      (await second.rqsStore.outboxPending()).map((record) => record.id),
      [],
      'the predecessor app identity is never guessed into a new durable record',
    );
    await second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.SNAPBACK_CLIENT_RQS_DIR;
    else process.env.SNAPBACK_CLIENT_RQS_DIR = previousDir;
    if (previousSwitch === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    else process.env.SNAPBACK_CLIENT_RQS_STORE = previousSwitch;
  }
});

test('broker-unavailable peer negative overrides positive before and after IndexedDB writer handoff', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const indexedDB = new IDBFactory();
  const lockManager = createContendedLockManager();
  const options = {
    indexedDB,
    lockManager,
    databaseName: 'outbox-capability-broker-unavailable',
    broadcastChannelFactory: null,
  };
  const writerStore = createIndexedDbRqsResumeStore(options);
  const followerStore = createIndexedDbRqsResumeStore(options);
  await Promise.all([writerStore.whenLockSettled(), followerStore.whenLockSettled()]);
  const positiveClient = new InspectingSnapbackClient('http://127.0.0.1:4400', {
    rqsStore: writerStore,
    __outboxDrainLifecycle: false,
  });
  const negativeClient = new InspectingSnapbackClient('http://127.0.0.1:4400', {
    rqsStore: followerStore,
    __outboxDrainLifecycle: false,
  });
  positiveClient.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  negativeClient.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  assert.equal(writerStore.isWriter(), true);
  assert.equal(followerStore.isWriter(), false);

  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: true,
    targetProfileId: 'local-dev-sqlite-ibex',
  }));
  await positiveClient.inspect();
  assert.equal(
    (await writerStore.readOfflineMutationReplayCapabilityFact()).storeRevision,
    1,
  );

  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: false,
    targetProfileId: 'cloudflare-do-sqlite-v8',
  }));
  await negativeClient.inspect();
  const durablePredecessor = await writerStore.readOfflineMutationReplayCapabilityFact();
  assert.equal(durablePredecessor.supported, true);
  assert.equal(
    durablePredecessor.storeRevision,
    1,
    'without BroadcastChannel the follower cannot coherently replace writer bytes',
  );

  let mutationCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname !== '/inspect') mutationCalls += 1;
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    () => negativeClient.mutate('createThing', {
      args: { title: 'must-not-use-process-positive' },
      clientMutationId: 'cm-peer-negative',
    }),
    (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
  );
  assert.equal(
    mutationCalls,
    0,
    'the bound follower negative supersedes the positive without a mutation POST',
  );
  assert.deepEqual(await writerStore.outboxRecords(), [], 'the bound follower queues no durable intent');

  await writerStore.close();
  const handoffDeadline = Date.now() + 5_000;
  while (!followerStore.isWriter()) {
    if (Date.now() > handoffDeadline) throw new Error('timed out waiting for writer handoff');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const takeoverNegative = await waitForOfflineReplayCapabilityFact(
    followerStore,
    (fact) => fact.supported === false,
    'the takeover writer to flush its locally retained negative',
  );
  assert.equal(
    takeoverNegative.requestSequence,
    durablePredecessor.requestSequence,
    'an unreserved answer stamps the existing allocator floor without minting on takeover',
  );
  assert.equal(takeoverNegative.storeRevision, durablePredecessor.storeRevision + 1);
  mutationCalls = 0;
  await assert.rejects(
    () => negativeClient.mutate('createThing', {
      args: { title: 'must-remain-negative-after-handoff' },
      clientMutationId: 'cm-peer-negative-handoff',
    }),
    (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
  );
  assert.equal(
    mutationCalls,
    0,
    'writer takeover preserves the negative refusal without a mutation POST',
  );
  assert.deepEqual(await followerStore.outboxRecords(), [], 'handoff still queues nothing');

  const newcomerStore = createIndexedDbRqsResumeStore(options);
  await newcomerStore.whenLockSettled();
  assert.equal(newcomerStore.isWriter(), false, 'the new context observes the takeover writer');
  const newcomerClient = new InspectingSnapbackClient('http://127.0.0.1:4400', {
    rqsStore: newcomerStore,
    __outboxDrainLifecycle: false,
  });
  newcomerClient.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let newcomerMutationCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname !== '/inspect') newcomerMutationCalls += 1;
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    () => newcomerClient.mutate('createThing', {
      args: { title: 'new-context-must-observe-takeover-negative' },
      clientMutationId: 'cm-peer-negative-new-context',
    }),
    (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
  );
  assert.equal(
    newcomerMutationCalls,
    0,
    'a new bound client observes the durable negative without a mutation POST',
  );
  assert.deepEqual(
    await newcomerStore.outboxRecords(),
    [],
    'the new context cannot resurrect the predecessor positive after takeover',
  );
  await newcomerClient.close();
  await newcomerStore.close();
  await negativeClient.close();
  await positiveClient.close();
  await followerStore.close();
});

test('unanswered-route negatives publish on takeover across all four RQS stores', async (t) => {
  const origin = 'https://unanswered-route-negative-takeover.example';
  const positive = {
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  };
  const negative = {
    ...positive,
    supported: false,
    reason: 'not-advertised',
    targetProfileId: 'cloudflare-do-sqlite-v8',
  };
  const seedPositive = async (store) => {
    const observation = await store.beginOfflineMutationReplayCapabilityObservation();
    const committed = await store.commitOfflineMutationReplayCapabilityFact(
      positive,
      observation,
    );
    assert.equal(committed.supported, true);
  };
  const expectPublishedNegative = async (store, label) => {
    const fact = await waitForOfflineReplayCapabilityFact(
      store,
      (candidate) => candidate.supported === false,
      `${label} takeover negative`,
    );
    assert.equal(fact.reason, 'not-advertised');
  };

  await Promise.all([
    t.test('IndexedDB', async () => {
      const indexedDB = new IDBFactory();
      const lockManager = createContendedLockManager();
      const options = {
        indexedDB,
        lockManager,
        databaseName: 'unanswered-route-negative-takeover-conformance',
        broadcastChannelFactory: null,
      };
      const writer = createIndexedDbRqsResumeStore(options);
      const follower = createIndexedDbRqsResumeStore(options);
      await Promise.all([writer.whenLockSettled(), follower.whenLockSettled()]);
      try {
        await seedPositive(writer);
        const observation = await follower.beginOfflineMutationReplayCapabilityObservation();
        assert.equal(Object.hasOwn(observation, 'requestSequence'), false);
        assert.equal(
          await follower.commitOfflineMutationReplayCapabilityFact(negative, observation),
          false,
        );
        await writer.close();
        const deadline = Date.now() + 5_000;
        while (!follower.isWriter()) {
          if (Date.now() > deadline) throw new Error('IndexedDB takeover timed out');
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await expectPublishedNegative(follower, 'IndexedDB');
      } finally {
        await follower.close();
        await writer.close();
      }
    }),
    t.test('memory', async () => {
      const backing = createMemoryRqsStoreBacking();
      const writer = createMemoryRqsResumeStore({ backing });
      const follower = createMemoryRqsResumeStore({ backing });
      try {
        assert.equal(writer.isWriter(), true);
        assert.equal(follower.isWriter(), false);
        await seedPositive(writer);
        backing.offlineReplayCapabilityObservers.clear();
        backing.offlineReplayCapabilityCommitters.clear();
        const observation = await follower.beginOfflineMutationReplayCapabilityObservation();
        assert.equal(observation, false);
        assert.equal(
          await follower.commitOfflineMutationReplayCapabilityFact(negative, observation),
          false,
        );
        await writer.close();
        await follower.whenLockSettled();
        await expectPublishedNegative(follower, 'memory');
      } finally {
        await follower.close();
        await writer.close();
      }
    }),
    t.test('file', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'snapback-unanswered-negative-file-'));
      const identity = 'origin:unanswered-route-negative';
      const writer = createFileRqsResumeStore({ directory, identity });
      await writer.whenLockSettled();
      try {
        await seedPositive(writer);
      } finally {
        await writer.close();
      }
      const blobName = readdirSync(directory).find((name) => name.endsWith('.v1.json'));
      assert.equal(typeof blobName, 'string');
      const lockPath = join(directory, blobName.replace(/\.v1\.json$/u, '.v1.lock'));
      const foreignPid = process.pid + 10_000;
      let foreignAlive = true;
      writeFileSync(lockPath, JSON.stringify({
        pid: foreignPid,
        instanceId: 'foreign-unreachable-writer',
        acquiredAt: Date.now(),
      }));
      const baseFiles = createNodeFilesAdapter();
      const files = {
        ...baseFiles,
        processAlive: (pid) => (pid === foreignPid ? foreignAlive : baseFiles.processAlive(pid)),
      };
      const follower = createFileRqsResumeStore({ directory, identity, files });
      try {
        await follower.whenLockSettled();
        assert.equal(follower.isWriter(), false);
        const observation = await follower.beginOfflineMutationReplayCapabilityObservation();
        assert.equal(observation, false);
        assert.equal(
          await follower.commitOfflineMutationReplayCapabilityFact(negative, observation),
          false,
        );
        foreignAlive = false;
        await follower.whenLockSettled();
        assert.equal(follower.isWriter(), true);
        await expectPublishedNegative(follower, 'file');
      } finally {
        await follower.close();
        rmSync(directory, { recursive: true, force: true });
      }
    }),
    t.test('SQLite', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'snapback-unanswered-negative-sqlite-'));
      const open = () => createSqliteRqsResumeStore({
        sqlite: createNodeSqliteNamespace(directory),
        databaseName: 'unanswered-route-negative.sqlite',
      });
      let store = await open();
      try {
        await seedPositive(store);
        assert.equal(
          await store.commitOfflineMutationReplayCapabilityFact(negative, false),
          false,
        );
        await store.close();
        store = await open();
        await expectPublishedNegative(store, 'SQLite');
      } finally {
        await store.close();
        rmSync(directory, { recursive: true, force: true });
      }
    }),
  ]);
});

test('unreserved follower negative cannot overwrite a newer positive after writer takeover', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const indexedDB = new IDBFactory();
  const lockManager = createContendedLockManager();
  const options = {
    indexedDB,
    lockManager,
    databaseName: 'outbox-capability-unreserved-negative-takeover',
    broadcastChannelFactory: null,
  };
  const writerStore = createIndexedDbRqsResumeStore(options);
  const followerStore = createIndexedDbRqsResumeStore(options);
  await Promise.all([writerStore.whenLockSettled(), followerStore.whenLockSettled()]);
  const origin = 'https://unreserved-negative-takeover.example';
  const writerClient = new InspectingSnapbackClient(origin, {
    rqsStore: writerStore,
    __outboxDrainLifecycle: false,
  });
  const followerClient = new InspectingSnapbackClient(origin, {
    rqsStore: followerStore,
    __outboxDrainLifecycle: false,
  });
  assert.equal(writerStore.isWriter(), true);
  assert.equal(followerStore.isWriter(), false);

  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: true,
    targetProfileId: 'local-dev-sqlite-ibex',
  }));
  await writerClient.inspect();
  assert.equal((await writerStore.readOfflineMutationReplayCapabilityFact()).storeRevision, 1);

  let releaseFollowerNegative;
  const followerNegativeRelease = new Promise((resolve) => { releaseFollowerNegative = resolve; });
  let markFollowerNegativeStarted;
  const followerNegativeStarted = new Promise((resolve) => { markFollowerNegativeStarted = resolve; });
  globalThis.fetch = async () => {
    markFollowerNegativeStarted();
    await followerNegativeRelease;
    return Response.json(offlineReplayInspection({
      supported: false,
      targetProfileId: 'cloudflare-do-sqlite-v8',
    }));
  };
  const followerNegative = followerClient.inspect();
  await followerNegativeStarted;
  assert.equal(
    (await writerStore.readOfflineMutationReplayCapabilityFact()).storeRevision,
    1,
    'the follower captured revision 1 before its unreserved answer returned',
  );

  const newerPositiveObservation = await writerStore
    .beginOfflineMutationReplayCapabilityObservation();
  await writerStore.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  }, newerPositiveObservation);
  const newerPositive = await writerStore.readOfflineMutationReplayCapabilityFact();
  assert.equal(newerPositive.supported, true);
  assert.equal(newerPositive.storeRevision, 2);
  releaseFollowerNegative();
  await followerNegative;
  assert.deepEqual(
    await writerStore.readOfflineMutationReplayCapabilityFact(),
    newerPositive,
    'the later follower answer cannot write while it lacks a reservation',
  );

  await writerStore.close();
  const handoffDeadline = Date.now() + 5_000;
  while (!followerStore.isWriter()) {
    if (Date.now() > handoffDeadline) throw new Error('timed out waiting for writer handoff');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    await followerStore.readOfflineMutationReplayCapabilityFact(),
    newerPositive,
    'takeover drops an unreserved answer whose observed shared revision advanced',
  );

  await followerClient.close();
  await writerClient.close();
  await followerStore.close();
});

test('allocator-floor takeover negative defeats a delayed reserved positive after writer death', async () => {
  const indexedDB = new IDBFactory();
  const lockManager = createContendedLockManager();
  const broadcastHub = createBroadcastHub();
  let takeoverMayPost = false;
  const common = {
    indexedDB,
    lockManager,
    databaseName: 'outbox-capability-takeover-order-floor',
    outboxNormalizationTimeoutMs: 50,
  };
  const writerStore = createIndexedDbRqsResumeStore({
    ...common,
    broadcastChannelFactory: () => broadcastHub.factory(),
  });
  const takeoverStore = createIndexedDbRqsResumeStore({
    ...common,
    broadcastChannelFactory: createGatedBroadcastFactory(
      broadcastHub,
      () => takeoverMayPost,
    ),
  });
  const delayedStore = createIndexedDbRqsResumeStore({
    ...common,
    broadcastChannelFactory: () => broadcastHub.factory(),
  });
  await Promise.all([
    writerStore.whenLockSettled(),
    takeoverStore.whenLockSettled(),
    delayedStore.whenLockSettled(),
  ]);
  try {
    assert.equal(writerStore.isWriter(), true);
    assert.equal(takeoverStore.isWriter(), false);
    assert.equal(delayedStore.isWriter(), false);
    const origin = 'https://takeover-order-floor.example';
    const positive = {
      schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
      origin,
      supported: true,
      reason: null,
      targetProfileId: 'local-dev-sqlite-ibex',
      artifactGeneration: TEST_ARTIFACT_GENERATION,
    };
    const firstObservation = await writerStore
      .beginOfflineMutationReplayCapabilityObservation();
    await writerStore.commitOfflineMutationReplayCapabilityFact(
      positive,
      firstObservation,
    );
    const delayedPositiveObservation = await delayedStore
      .beginOfflineMutationReplayCapabilityObservation();
    assert.equal(delayedPositiveObservation.requestSequence, 2);
    assert.equal(delayedPositiveObservation.observedStoreRevision, 1);

    const takeoverNegativeObservation = await takeoverStore
      .beginOfflineMutationReplayCapabilityObservation();
    assert.equal(
      Object.hasOwn(takeoverNegativeObservation, 'requestSequence'),
      false,
      'the future takeover writer answered without reserving another sequence',
    );
    assert.equal(takeoverNegativeObservation.observedStoreRevision, 1);
    await takeoverStore.commitOfflineMutationReplayCapabilityFact({
      ...positive,
      supported: false,
      reason: 'not-advertised',
      targetProfileId: 'cloudflare-do-sqlite-v8',
    }, takeoverNegativeObservation);

    await writerStore.close();
    const handoffDeadline = Date.now() + 5_000;
    while (!takeoverStore.isWriter()) {
      if (Date.now() > handoffDeadline) throw new Error('timed out waiting for writer handoff');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const takeoverNegative = await waitForOfflineReplayCapabilityFact(
      takeoverStore,
      (fact) => fact.supported === false,
      'the takeover negative to become durable',
    );
    takeoverMayPost = true;

    await delayedStore.commitOfflineMutationReplayCapabilityFact(
      positive,
      delayedPositiveObservation,
    );
    const finalFact = await takeoverStore.readOfflineMutationReplayCapabilityFact();
    assert.equal(
      finalFact.supported,
      false,
      'the stale reserved positive cannot overwrite the takeover negative',
    );
    assert.equal(
      takeoverNegative.requestSequence,
      2,
      'the unreserved takeover answer stamps the allocator request high-water',
    );
    assert.deepEqual(finalFact, takeoverNegative);
  } finally {
    await delayedStore.close();
    await takeoverStore.close();
    await writerStore.close();
  }
});

test('closed IndexedDB client refuses a late capability answer', async () => {
  const indexedDB = new IDBFactory();
  const lockManager = createContendedLockManager();
  const broadcastHub = createBroadcastHub();
  const options = {
    indexedDB,
    lockManager,
    databaseName: 'outbox-capability-closed-late-answer',
    broadcastChannelFactory: () => broadcastHub.factory(),
  };
  const writerStore = createIndexedDbRqsResumeStore(options);
  const delayedStore = createIndexedDbRqsResumeStore(options);
  await Promise.all([writerStore.whenLockSettled(), delayedStore.whenLockSettled()]);
  try {
    const origin = 'https://closed-late-answer.example';
    const positive = {
      schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
      origin,
      supported: true,
      reason: null,
      targetProfileId: 'local-dev-sqlite-ibex',
      artifactGeneration: TEST_ARTIFACT_GENERATION,
    };
    const firstObservation = await writerStore
      .beginOfflineMutationReplayCapabilityObservation();
    await writerStore.commitOfflineMutationReplayCapabilityFact(
      positive,
      firstObservation,
    );
    const delayedObservation = await delayedStore
      .beginOfflineMutationReplayCapabilityObservation();
    await delayedStore.close();
    const refused = await delayedStore.commitOfflineMutationReplayCapabilityFact({
      ...positive,
      supported: false,
      reason: 'late-closed-answer',
      targetProfileId: 'cloudflare-do-sqlite-v8',
    }, delayedObservation);
    assert.equal(refused, false, 'close() is a terminal capability-commit fence');
    assert.deepEqual(
      await writerStore.readOfflineMutationReplayCapabilityFact(),
      { ...positive, requestSequence: 1, storeRevision: 1 },
      'a closed client cannot broker its delayed answer to the live writer',
    );
  } finally {
    await delayedStore.close();
    await writerStore.close();
  }
});

test('repointing a client drops a local negative override from the previous origin', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const commitCapabilityFact = store.commitOfflineMutationReplayCapabilityFact.bind(store);
  store.commitOfflineMutationReplayCapabilityFact = async () => false;
  const firstOrigin = 'https://local-override-first.example';
  const secondOrigin = 'https://local-override-second.example';
  const client = new InspectingSnapbackClient(firstOrigin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);

  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: false,
    targetProfileId: 'cloudflare-do-sqlite-v8',
  }));
  await client.inspect();
  store.commitOfflineMutationReplayCapabilityFact = commitCapabilityFact;
  await commitCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin: secondOrigin,
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  });

  client.baseUrl = secondOrigin;
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname.startsWith('/mutation/')) mutationPosts += 1;
    throw new TypeError('second origin offline');
  };
  const queued = await client.mutate('createThing', {
    args: { title: 'second-origin-cached-positive' },
    clientMutationId: 'cm-local-override-origin-change',
  });
  assert.equal(queued.status, 'queued');
  assert.equal(mutationPosts, 0, 'the second origin uses its enqueue-only positive fact');
  assert.deepEqual(
    (await store.outboxPending()).map((record) => record.id),
    ['cm-local-override-origin-change'],
  );
  await client.close();
  await store.close();
});

test('a rejected answered-negative commit refuses and overrides the predecessor positive locally', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://rejected-capability-commit.example';
  const positive = {
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  };
  await store.commitOfflineMutationReplayCapabilityFact(positive);
  const commitCapabilityFact = store.commitOfflineMutationReplayCapabilityFact.bind(store);
  store.commitOfflineMutationReplayCapabilityFact = async () => false;
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let mutationPosts = 0;
  let inspectionMode = 'answered-negative';
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      if (inspectionMode === 'transport-lost') {
        throw new TypeError('follow-up capability inspection lost transport');
      }
      return Response.json(offlineReplayInspection({
        supported: false,
        targetProfileId: 'cloudflare-do-sqlite-v8',
      }));
    }
    mutationPosts += 1;
    return Response.json({ result: { acceptedOnlineOnly: mutationPosts }, version: mutationPosts });
  };

  try {
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'answered negative wins locally' },
        clientMutationId: 'cm-rejected-answered-negative',
      }),
      (error) => (
        error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED'
        && error?.diagnostic?.details?.reason === 'inspection-superseded'
      ),
    );
    assert.equal(mutationPosts, 0, 'the rejected negative CAS permits no mutation POST');
    assert.deepEqual(await store.outboxRecords(), [], 'the answered negative queues no intent');
    assert.equal(
      (await store.readOfflineMutationReplayCapabilityFact()).supported,
      true,
      'the rejected shared commit leaves the predecessor bytes unchanged',
    );
    inspectionMode = 'transport-lost';
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'local negative still wins' },
        clientMutationId: 'cm-rejected-answered-negative-follow-up',
      }),
      (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
    );
    assert.equal(
      mutationPosts,
      0,
      'the local negative override refuses a later unavailable probe without another POST',
    );
    assert.deepEqual(await store.outboxRecords(), [], 'the shared predecessor positive is never queued');
  } finally {
    store.commitOfflineMutationReplayCapabilityFact = commitCapabilityFact;
    await client.close();
    await store.close();
  }
});

test('an answered negative overrides cached support before durable replacement settles', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await store.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin: 'https://interleaved-negative.example',
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  });
  const commitCapabilityFact = store.commitOfflineMutationReplayCapabilityFact.bind(store);
  let releaseNegativeCommit;
  const negativeCommitRelease = new Promise((resolve) => { releaseNegativeCommit = resolve; });
  let markNegativeCommitStarted;
  const negativeCommitStarted = new Promise((resolve) => { markNegativeCommitStarted = resolve; });
  store.commitOfflineMutationReplayCapabilityFact = async (fact) => {
    if (fact.supported === false) {
      markNegativeCommitStarted();
      await negativeCommitRelease;
    }
    return commitCapabilityFact(fact);
  };
  const client = new InspectingSnapbackClient('https://interleaved-negative.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: false,
    targetProfileId: 'cloudflare-do-sqlite-v8',
  }));
  const negativeInspection = client.inspect();
  await negativeCommitStarted;

  let mutationCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname !== '/inspect') mutationCalls += 1;
    throw new TypeError('parallel transport loss');
  };
  try {
    const mutation = client.mutate('createThing', {
      args: { title: 'must-not-use-predecessor-positive' },
      clientMutationId: 'cm-interleaved-negative',
    });
    void mutation.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      mutationCalls,
      0,
      'mutation transport waits behind the in-flight capability replacement commit',
    );
    releaseNegativeCommit();
    await negativeInspection;
    await assert.rejects(
      () => mutation,
      (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
    );
    assert.equal(mutationCalls, 0, 'the parallel mutation sends no POST after replacement');
    assert.deepEqual(await store.outboxRecords(), [], 'the predecessor positive queues nothing');
  } finally {
    releaseNegativeCommit();
    await negativeInspection;
  }
});

test('a delayed positive capability commit cannot overtake a later answered negative', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const commitCapabilityFact = store.commitOfflineMutationReplayCapabilityFact.bind(store);
  let releasePositiveCommit;
  const positiveCommitRelease = new Promise((resolve) => { releasePositiveCommit = resolve; });
  let markPositiveCommitStarted;
  const positiveCommitStarted = new Promise((resolve) => { markPositiveCommitStarted = resolve; });
  store.commitOfflineMutationReplayCapabilityFact = async (fact) => {
    if (fact.supported === true) {
      markPositiveCommitStarted();
      await positiveCommitRelease;
    }
    return commitCapabilityFact(fact);
  };
  const client = new InspectingSnapbackClient('https://inverse-inspection-race.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });

  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: true,
    targetProfileId: 'local-dev-sqlite-ibex',
  }));
  const positiveInspection = client.inspect();
  await positiveCommitStarted;

  let markNegativeAnswered;
  const negativeAnswered = new Promise((resolve) => { markNegativeAnswered = resolve; });
  globalThis.fetch = async () => {
    markNegativeAnswered();
    return Response.json(offlineReplayInspection({
      supported: false,
      targetProfileId: 'cloudflare-do-sqlite-v8',
    }));
  };
  const negativeInspection = client.inspect();
  await negativeAnswered;
  await new Promise((resolve) => setImmediate(resolve));
  releasePositiveCommit();
  await Promise.all([positiveInspection, negativeInspection]);

  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname.startsWith('/mutation/')) mutationPosts += 1;
    throw new TypeError('ambiguous mutation response');
  };
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'ledger-less-target' },
      clientMutationId: 'cm-inverse-inspection-race',
    }),
    (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
  );
  assert.equal(mutationPosts, 1, 'the ledger-less target receives one online-only mutation POST');
  assert.equal(
    (await store.readOfflineMutationReplayCapabilityFact()).supported,
    false,
    'the later answered negative remains the durable capability fact',
  );
  assert.deepEqual(
    await store.outboxRecords(),
    [],
    'an ambiguous ledger-less attempt leaves no duplicate-capable pending mutation',
  );
  await client.close();
  await store.close();
});

test('a delayed earlier inspect response cannot resurrect a later answered negative', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('https://dispatch-ordered-inspection.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let releasePositiveFetch;
  const positiveFetchRelease = new Promise((resolve) => { releasePositiveFetch = resolve; });
  let markPositiveFetchStarted;
  const positiveFetchStarted = new Promise((resolve) => { markPositiveFetchStarted = resolve; });
  let inspectCalls = 0;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/inspect');
    inspectCalls += 1;
    if (inspectCalls === 1) {
      markPositiveFetchStarted();
      await positiveFetchRelease;
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    return Response.json(offlineReplayInspection({
      supported: false,
      targetProfileId: 'cloudflare-do-sqlite-v8',
    }));
  };

  const delayedPositive = client.inspect();
  await positiveFetchStarted;
  await client.inspect();
  releasePositiveFetch();
  await delayedPositive;

  const answered = await store.readOfflineMutationReplayCapabilityFact();
  assert.equal(answered.supported, false, 'dispatch-later negative remains durable');
  assert.equal(answered.requestSequence, 2, 'the store records request order, not arrival order');

  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname.startsWith('/mutation/')) mutationPosts += 1;
    throw new TypeError('offline after dispatch-ordered negative');
  };
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'must-not-resurrect' },
      clientMutationId: 'cm-dispatch-ordered-negative',
    }),
    (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
  );
  assert.equal(mutationPosts, 1, 'the negative target gets one online-only mutation POST');
  assert.deepEqual(await store.outboxRecords(), [], 'the delayed positive queues nothing');
  await client.close();
  await store.close();
});

test('a later connectivity-lost inspect does not discard an in-flight first discovery', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('https://connectivity-does-not-answer.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let releaseFirstInspect;
  const firstInspectRelease = new Promise((resolve) => { releaseFirstInspect = resolve; });
  let markFirstInspectStarted;
  const firstInspectStarted = new Promise((resolve) => { markFirstInspectStarted = resolve; });
  let inspectCalls = 0;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/inspect');
    inspectCalls += 1;
    if (inspectCalls === 1) {
      markFirstInspectStarted();
      await firstInspectRelease;
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    throw new TypeError('later inspect lost transport');
  };

  const firstDiscovery = client.inspect();
  await firstInspectStarted;
  await assert.rejects(() => client.inspect(), (error) => isConnectivityFailureError(error));
  releaseFirstInspect();
  await firstDiscovery;
  assert.equal(
    (await store.readOfflineMutationReplayCapabilityFact()).supported,
    true,
    'a no-Response probe does not advance the answered request high-water',
  );

  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname.startsWith('/mutation/')) mutationPosts += 1;
    throw new TypeError('offline after first discovery');
  };
  const queued = await client.mutate('createThing', {
    args: { title: 'first-discovery-remains-cacheable' },
    clientMutationId: 'cm-first-discovery-remains-cacheable',
  });
  assert.equal(queued.status, 'queued');
  assert.equal(mutationPosts, 0, 'the preserved positive takes the enqueue-only cached path');
  assert.deepEqual(
    (await store.outboxPending()).map((record) => record.id),
    ['cm-first-discovery-remains-cacheable'],
  );
  await client.close();
  await store.close();
});

const exerciseCrossClientCapabilityOrdering = async ({
  label,
  writerStore,
  followerStore,
}) => {
  const origin = `https://${label}-capability-ordering.example`;
  const admittingClient = new InspectingSnapbackClient(origin, {
    rqsStore: writerStore,
    __outboxDrainLifecycle: false,
  });
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: followerStore,
    __outboxDrainLifecycle: false,
  });
  try {
    let mutationPosts = 0;
    let markMutationStarted;
    const mutationStarted = new Promise((resolve) => { markMutationStarted = resolve; });
    let releaseAmbiguousMutation;
    const ambiguousMutationRelease = new Promise((resolve) => {
      releaseAmbiguousMutation = resolve;
    });
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/inspect') {
        return Response.json(offlineReplayInspection({
          supported: true,
          targetProfileId: 'local-dev-sqlite-ibex',
        }));
      }
      mutationPosts += 1;
      markMutationStarted();
      await ambiguousMutationRelease;
      throw new TypeError(`${label} ambiguous mutation response`);
    };
    const mutation = admittingClient.mutate('createThing', {
      args: { title: `${label}-cross-client-negative` },
      clientMutationId: `cm-${label}-cross-client-negative`,
    });
    await mutationStarted;

    globalThis.fetch = async (url) => {
      assert.equal(new URL(url).pathname, '/inspect');
      return Response.json(offlineReplayInspection({
        supported: false,
        targetProfileId: 'cloudflare-do-sqlite-v8',
      }));
    };
    const replacingInspection = replacingClient.inspect();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      (await writerStore.readOfflineMutationReplayCapabilityFact()).supported,
      true,
      `${label}: follower-routed negative waits behind the dispatched mutation`,
    );
    releaseAmbiguousMutation();
    const mutationOutcome = await mutation;
    assert.equal(mutationOutcome.status, 'queued');
    await replacingInspection;
    assert.equal(
      (await writerStore.readOfflineMutationReplayCapabilityFact()).supported,
      false,
      `${label}: follower-routed negative is durable after the ambiguous response`,
    );
    assert.equal(mutationPosts, 1, `${label}: one foreground POST reached the ambiguous cut`);
    assert.deepEqual(
      (await writerStore.outboxPending()).map((record) => record.id),
      [`cm-${label}-cross-client-negative`],
      `${label}: supersession after POST preserves the ambiguous recovery identity`,
    );
    await writerStore.outboxDiscard(`cm-${label}-cross-client-negative`);

    let markDelayedPositiveStarted;
    const delayedPositiveStarted = new Promise((resolve) => {
      markDelayedPositiveStarted = resolve;
    });
    let releaseDelayedPositive;
    const delayedPositiveRelease = new Promise((resolve) => {
      releaseDelayedPositive = resolve;
    });
    let inspectCalls = 0;
    globalThis.fetch = async (url) => {
      assert.equal(new URL(url).pathname, '/inspect');
      inspectCalls += 1;
      if (inspectCalls === 1) {
        markDelayedPositiveStarted();
        await delayedPositiveRelease;
        return Response.json(offlineReplayInspection({
          supported: true,
          targetProfileId: 'local-dev-sqlite-ibex',
        }));
      }
      return Response.json(offlineReplayInspection({
        supported: false,
        targetProfileId: 'cloudflare-do-sqlite-v8',
      }));
    };
    const delayedPositive = admittingClient.inspect();
    await delayedPositiveStarted;
    await replacingClient.inspect();
    const newerNegative = await writerStore.readOfflineMutationReplayCapabilityFact();
    releaseDelayedPositive();
    await delayedPositive;
    assert.deepEqual(
      await writerStore.readOfflineMutationReplayCapabilityFact(),
      newerNegative,
      `${label}: delayed older positive cannot overwrite the newer negative`,
    );

    let offlineMutationPosts = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).pathname.startsWith('/mutation/')) offlineMutationPosts += 1;
      throw new TypeError(`${label} offline after cross-client negative`);
    };
    await assert.rejects(
      () => admittingClient.mutate('createThing', {
        args: { title: `${label}-negative-stays-closed` },
        clientMutationId: `cm-${label}-negative-stays-closed`,
      }),
      (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
    );
    assert.equal(offlineMutationPosts, 0, `${label}: the durable negative licenses no mutation POST`);
    assert.deepEqual(
      await writerStore.outboxPending(),
      [],
      `${label}: the later offline loss remains non-replayable`,
    );

    const replayId = `cm-${label}-replay-shared-generation`;
    await writerStore.outboxEnqueue({
      id: replayId,
      function: 'createThing',
      ...currentOutboxTarget({ origin }),
      args: { title: `${label}-replay-shared-generation` },
    });
    let replayPosts = 0;
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/inspect') {
        return Response.json(offlineReplayInspection({
          supported: false,
          targetProfileId: 'cloudflare-do-sqlite-v8',
        }));
      }
      replayPosts += 1;
      return Response.json({ result: { replayed: true }, version: 1 });
    };
    await replacingClient.inspect();
    await assert.rejects(
      () => admittingClient.replayQueuedMutations(),
      (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
    );
    assert.equal(replayPosts, 0, `${label}: a negative committed before replay licenses no POST`);
    assert.deepEqual(
      (await writerStore.outboxPending()).map((record) => record.id),
      [replayId],
      `${label}: capability supersession preserves pending replay custody`,
    );
    await writerStore.outboxDiscard(replayId);
  } finally {
    await replacingClient.close();
    await admittingClient.close();
  }
};

test('IndexedDB writer/follower share capability ordering across admission and response races', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const indexedDB = new IDBFactory();
  const lockManager = createContendedLockManager();
  const broadcastHub = createBroadcastHub();
  const options = {
    indexedDB,
    lockManager,
    databaseName: 'outbox-capability-two-client-races',
    broadcastChannelFactory: () => broadcastHub.factory(),
  };
  const writerStore = createIndexedDbRqsResumeStore(options);
  const followerStore = createIndexedDbRqsResumeStore(options);
  await Promise.all([writerStore.whenLockSettled(), followerStore.whenLockSettled()]);
  try {
    assert.equal(writerStore.isWriter(), true);
    assert.equal(followerStore.isWriter(), false);
    await exerciseCrossClientCapabilityOrdering({
      label: 'indexeddb',
      writerStore,
      followerStore,
    });
  } finally {
    await followerStore.close();
    await writerStore.close();
  }
});

test('file writer/follower share capability ordering across admission and response races', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = mkdtempSync(join(tmpdir(), 'snapback-capability-ordering-file-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = { directory, identity: 'origin:capability-two-client-races' };
  const writerStore = createFileRqsResumeStore(options);
  await writerStore.whenLockSettled();
  const followerStore = createFileRqsResumeStore(options);
  await followerStore.whenLockSettled();
  try {
    assert.equal(writerStore.isWriter(), true);
    assert.equal(followerStore.isWriter(), false);
    await exerciseCrossClientCapabilityOrdering({
      label: 'file',
      writerStore,
      followerStore,
    });
  } finally {
    await followerStore.close();
    await writerStore.close();
  }
});

test('a newer negative retires positive-admitted custody before ambiguous mutation transport', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('https://transport-epoch-race.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let inspectionSupported = true;
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      if (inspectionSupported === null) throw new TypeError('capability transport lost');
      return Response.json(offlineReplayInspection({
        supported: inspectionSupported,
        targetProfileId: inspectionSupported
          ? 'local-dev-sqlite-ibex'
          : 'cloudflare-do-sqlite-v8',
      }));
    }
    mutationPosts += 1;
    throw new TypeError('ambiguous mutation response');
  };

  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'negative-before-transport' },
      clientMutationId: 'cm-transport-epoch-race',
      __beforeTransportDispatch: async () => {
        inspectionSupported = false;
        await client.inspect();
        inspectionSupported = null;
      },
    }),
    (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
  );
  assert.equal(mutationPosts, 0, 'the superseded positive is retired before any mutation POST');
  assert.equal(
    (await store.readOfflineMutationReplayCapabilityFact()).supported,
    false,
    'the transport boundary preserves the newer answered negative',
  );
  assert.deepEqual(
    await store.outboxPending(),
    [],
    'the record admitted under the superseded positive cannot remain replayable',
  );
  await client.close();
  await store.close();
});

test('a newer identical positive preserves admitted custody through an ambiguous POST', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('https://identical-positive-currency.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    mutationPosts += 1;
    throw new TypeError('ambiguous mutation response after identical positive');
  };

  const queued = await client.mutate('createThing', {
    args: { title: 'identical-positive-remains-authoritative' },
    clientMutationId: 'cm-identical-positive-currency',
    __beforeTransportDispatch: () => client.inspect(),
  });
  assert.equal(queued.status, 'queued');
  assert.equal(mutationPosts, 1, 'exactly one foreground POST reaches the ambiguous cut');
  const fact = await store.readOfflineMutationReplayCapabilityFact();
  assert.equal(fact.supported, true);
  assert.equal(fact.storeRevision, 2, 'the identical positive is a newer durable observation');
  assert.deepEqual(
    (await store.outboxPending()).map((record) => record.id),
    ['cm-identical-positive-currency'],
    'the ambiguously dispatched mutation keeps durable replay custody',
  );
  await client.close();
  await store.close();
});

test('post-loss capability supersession preserves the original pending mutation identity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://post-loss-capability-supersession.example';
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const clientMutationId = 'cm-post-loss-capability-supersession';
  let mutationPosts = 0;
  let mutationTransportLost = false;
  let negativeEnabled = false;
  let negativeCommitted = false;
  let replacingInspection = null;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: !negativeEnabled,
        targetProfileId: negativeEnabled
          ? 'cloudflare-do-sqlite-v8'
          : 'local-dev-sqlite-ibex',
      }));
    }
    mutationPosts += 1;
    mutationTransportLost = true;
    negativeEnabled = true;
    throw new TypeError('mutation response lost after transport start');
  };
  const readOutboxRecords = store.outboxRecords.bind(store);
  store.outboxRecords = async () => {
    if (mutationTransportLost && !negativeCommitted) {
      negativeCommitted = true;
      replacingInspection = replacingClient.inspect();
    }
    return readOutboxRecords();
  };

  try {
    const outcome = await client.mutate('createThing', {
      args: { title: 'retain exactly-once identity after lost POST' },
      clientMutationId,
    });
    assert.equal(outcome.status, 'queued');
    await replacingInspection;
    assert.equal(mutationPosts, 1, 'no POST follows the original ambiguous attempt');
    assert.equal(
      (await store.readOfflineMutationReplayCapabilityFact()).supported,
      false,
      'the replacing negative lands during connectivity fallback',
    );
    assert.deepEqual(
      (await store.outboxPending()).map((record) => record.id),
      [clientMutationId],
      'the original clientMutationId remains pending after transport starts',
    );
  } finally {
    await replacingClient.close();
    await client.close();
    await store.close();
  }
});

test('a capability commit requested during submission preparation waits until after dispatch', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://post-prepare-capability-fence.example';
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const clientMutationId = 'cm-post-prepare-capability-fence';
  let inspectionSupported = true;
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: inspectionSupported,
        targetProfileId: inspectionSupported
          ? 'local-dev-sqlite-ibex'
          : 'cloudflare-do-sqlite-v8',
      }));
    }
    mutationPosts += 1;
    return Response.json({ result: { committed: true }, version: 1 });
  };
  const prepareSubmission = store.outboxPrepareSubmission.bind(store);
  let injectedNegative = false;
  let replacingInspection = null;
  store.outboxPrepareSubmission = async (...args) => {
    const prepared = await prepareSubmission(...args);
    if (
      !injectedNegative
      && args[1]?.authorizationOnly === true
      && args[1]?.markDispatched === true
    ) {
      injectedNegative = true;
      inspectionSupported = false;
      replacingInspection = replacingClient.inspect();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return prepared;
  };

  try {
    const outcome = await client.mutate('createThing', {
      args: { title: 'negative waits behind submission dispatch' },
      clientMutationId,
    });
    await replacingInspection;
    assert.equal(outcome.status, 'settled');
    assert.equal(mutationPosts, 1, 'submission preparation and the final fact read admit one POST');
    assert.equal(
      (await store.readOfflineMutationReplayCapabilityFact()).supported,
      false,
      'the queued peer commit becomes durable after dispatch settlement',
    );
    assert.deepEqual(
      (await store.outboxRecords()).map((record) => ({ id: record.id, status: record.status })),
      [{ id: clientMutationId, status: 'settled' }],
      'the dispatched record settles under the fact read before the ordered replacement',
    );
  } finally {
    await replacingClient.close();
    await client.close();
    await store.close();
  }
});

test('foreground mutation refuses a baseUrl repoint after target inspection', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const originA = 'https://pinned-foreground-a.example';
  const originB = 'https://pinned-foreground-b.example';
  const client = new InspectingSnapbackClient(originA, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const clientMutationId = 'cm-pinned-foreground-target';
  let originAPosts = 0;
  let originBPosts = 0;
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname === '/inspect') {
      assert.equal(target.origin, originA, 'inspection uses the mutation-start target');
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    if (target.origin === originA) originAPosts += 1;
    if (target.origin === originB) originBPosts += 1;
    throw new TypeError('the repointed mutation transport is ambiguous');
  };
  const readCapabilityFact = store.readOfflineMutationReplayCapabilityFact.bind(store);
  let repointOnCapabilityRead = false;
  store.readOfflineMutationReplayCapabilityFact = async () => {
    const fact = await readCapabilityFact();
    if (repointOnCapabilityRead) client.baseUrl = originB;
    return fact;
  };
  const prepareSubmission = store.outboxPrepareSubmission.bind(store);
  store.outboxPrepareSubmission = async (...args) => {
    repointOnCapabilityRead = true;
    return prepareSubmission(...args);
  };

  try {
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'never dispatch under the successor target' },
        clientMutationId,
      }),
      (error) => (
        error?.code === 'SNAPBACK_CLIENT_OPERATION_TARGET_CHANGED'
        && error?.diagnostic?.details?.reason === 'operation-target-changed'
      ),
    );
    assert.equal(originAPosts, 0, 'the refused mutation issues no POST to target A');
    assert.equal(originBPosts, 0, 'the refused mutation issues no POST to target B');
    assert.deepEqual(
      await store.outboxRecords(),
      [],
      'target repointing retires the pre-dispatch record admitted for A',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

test('foreground capability commit cannot cross the final positive read before mutation fetch', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://foreground-capability-commit-dispatch-order.example';
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const clientMutationId = 'cm-foreground-capability-commit-dispatch-order';
  let inspectionSupported = true;
  let mutationPosts = 0;
  let supportedAtMutationPost = null;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: inspectionSupported,
        targetProfileId: inspectionSupported
          ? 'local-dev-sqlite-ibex'
          : 'cloudflare-do-sqlite-v8',
      }));
    }
    mutationPosts += 1;
    supportedAtMutationPost = (
      await store.readOfflineMutationReplayCapabilityFact()
    ).supported;
    throw new TypeError('ambiguous foreground mutation response');
  };
  const prepareSubmission = store.outboxPrepareSubmission.bind(store);
  let finalReadArmed = false;
  store.outboxPrepareSubmission = async (...args) => {
    const prepared = await prepareSubmission(...args);
    if (args[1]?.authorizationOnly === true && args[1]?.markDispatched === true) {
      finalReadArmed = true;
    }
    return prepared;
  };
  const readCapabilityFact = store.readOfflineMutationReplayCapabilityFact.bind(store);
  let injectedNegative = false;
  let replacingInspection = null;
  store.readOfflineMutationReplayCapabilityFact = async () => {
    const fact = await readCapabilityFact();
    if (finalReadArmed && !injectedNegative) {
      injectedNegative = true;
      inspectionSupported = false;
      replacingInspection = replacingClient.inspect();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return fact;
  };

  try {
    const outcome = await client.mutate('createThing', {
      args: { title: 'negative waits behind foreground dispatch' },
      clientMutationId,
    }).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    await replacingInspection;
    assert.equal(mutationPosts, 1, 'the positive final read admits exactly one mutation attempt');
    assert.equal(
      supportedAtMutationPost,
      true,
      'the peer negative cannot commit between the final positive read and mutation fetch',
    );
    assert.equal(outcome.value?.status, 'queued');
    assert.equal(outcome.error, null);
    assert.equal((await readCapabilityFact()).supported, false);
    assert.deepEqual(
      (await store.outboxPending()).map((record) => record.id),
      [clientMutationId],
      'the ambiguous dispatched mutation retains its settlement identity',
    );
    await assert.rejects(
      () => client.replayQueuedMutations(),
      (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
      'the next cycle pauses the record under the now-durable negative fact',
    );
    assert.equal(mutationPosts, 1, 'the paused next cycle sends no second mutation POST');
  } finally {
    await replacingClient.close();
    await client.close();
    await store.close();
  }
});

test('replay final served-target reinspection wins before a delayed peer fact commit', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://replay-capability-commit-dispatch-order.example';
  const clientMutationId = 'cm-replay-capability-commit-dispatch-order';
  await store.outboxEnqueue({
    id: clientMutationId,
    function: 'createThing',
    ...currentOutboxTarget({ origin }),
    args: { title: 'negative waits behind replay dispatch' },
  });
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let inspectionSupported = true;
  let mutationPosts = 0;
  let supportedAtMutationPost = null;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: inspectionSupported,
        targetProfileId: inspectionSupported
          ? 'local-dev-sqlite-ibex'
          : 'cloudflare-do-sqlite-v8',
      }));
    }
    mutationPosts += 1;
    supportedAtMutationPost = (
      await store.readOfflineMutationReplayCapabilityFact()
    ).supported;
    throw new TypeError('ambiguous replay mutation response');
  };
  const prepareSubmission = store.outboxPrepareSubmission.bind(store);
  let finalReadArmed = false;
  store.outboxPrepareSubmission = async (...args) => {
    const prepared = await prepareSubmission(...args);
    if (args[1] === undefined && prepared?.status === 'ready') finalReadArmed = true;
    return prepared;
  };
  const readCapabilityFact = store.readOfflineMutationReplayCapabilityFact.bind(store);
  let injectedNegative = false;
  let replacingInspection = null;
  store.readOfflineMutationReplayCapabilityFact = async () => {
    const fact = await readCapabilityFact();
    if (finalReadArmed && !injectedNegative) {
      injectedNegative = true;
      inspectionSupported = false;
      replacingInspection = replacingClient.inspect();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return fact;
  };

  try {
    const replay = await client.replayQueuedMutations();
    await replacingInspection;
    assert.equal(mutationPosts, 0, 'the final served negative refuses before mutation transport');
    assert.equal(
      supportedAtMutationPost,
      null,
      'no replay POST observes either the predecessor or successor fact',
    );
    assert.equal(replay.replayed, 0);
    assert.equal(replay.stopped, true);
    assert.equal(
      client.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
    );
    assert.equal((await readCapabilityFact()).supported, false);
    assert.deepEqual(
      (await store.outboxPending()).map((record) => record.id),
      [clientMutationId],
      'the ambiguous replay remains pending after the ordered negative commit',
    );
    await assert.rejects(
      () => client.replayQueuedMutations(),
      (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
      'the next replay cycle pauses before transport under the durable negative fact',
    );
    assert.equal(mutationPosts, 0, 'the paused next cycle sends no mutation POST');
  } finally {
    await replacingClient.close();
    await client.close();
    await store.close();
  }
});

test('replay persists a final negative before releasing a waiting foreground dispatch', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://replay-negative-before-dispatch-release.example';
  const targetProfileId = 'local-dev-sqlite-ibex';
  await commitCompleteReplayCapability(store, origin, targetProfileId);
  await store.outboxEnqueue({
    id: 'cm-replay-negative-before-dispatch-release',
    function: 'createThing',
    ...currentOutboxTarget({ origin, targetProfileId }),
    args: { title: 'replay owns the dispatch lock' },
  });
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let inspectRequests = 0;
  let mutationPosts = 0;
  let resolveReplayFinalInspection;
  let resolveReplayFinalInspectionStarted;
  const replayFinalInspectionStartedPromise = new Promise((resolve) => {
    resolveReplayFinalInspectionStarted = resolve;
  });
  const replayFinalInspection = new Promise((resolve) => {
    resolveReplayFinalInspection = resolve;
  });
  let resolveForegroundEnqueue;
  let resolveForegroundEnqueueStarted;
  const foregroundEnqueueStarted = new Promise((resolve) => {
    resolveForegroundEnqueueStarted = resolve;
  });
  const foregroundEnqueueRelease = new Promise((resolve) => {
    resolveForegroundEnqueue = resolve;
  });
  const outboxEnqueue = store.outboxEnqueue.bind(store);
  store.outboxEnqueue = async (record, ...args) => {
    const stored = await outboxEnqueue(record, ...args);
    if (record.id === 'cm-foreground-waits-behind-replay-negative') {
      resolveForegroundEnqueueStarted();
      await foregroundEnqueueRelease;
    }
    return stored;
  };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      inspectRequests += 1;
      if (inspectRequests === 3) {
        resolveReplayFinalInspectionStarted();
        return replayFinalInspection;
      }
      return Response.json(offlineReplayInspection({ supported: true, targetProfileId }));
    }
    if (path === '/mutation/createThing') {
      mutationPosts += 1;
      throw new TypeError('simulated lost response after mutation effect');
    }
    throw new Error(`unexpected replay/foreground request ${path}`);
  };

  try {
    const foregroundOutcome = client.mutate('createThing', {
      args: { title: 'foreground waits behind replay' },
      clientMutationId: 'cm-foreground-waits-behind-replay-negative',
      queue: 'auto',
    }).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    await foregroundEnqueueStarted;
    const replayPromise = client.replayQueuedMutations();
    await replayFinalInspectionStartedPromise;
    resolveForegroundEnqueue();
    await new Promise((resolve) => setImmediate(resolve));
    resolveReplayFinalInspection(Response.json(offlineReplayInspection({
      supported: false,
      targetProfileId,
    })));

    const [replay, foreground] = await Promise.all([replayPromise, foregroundOutcome]);
    assert.equal(replay.replayed, 0);
    assert.equal(replay.stopped, true);
    assert.equal(foreground.value, null);
    assert.equal(
      foreground.error?.code,
      'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
    );
    assert.equal(mutationPosts, 0, 'neither mutation reaches transport');
    assert.equal((await store.readOfflineMutationReplayCapabilityFact()).supported, false);
    assert.equal(
      (await store.outboxRecords()).some((record) => (
        record.id === 'cm-foreground-waits-behind-replay-negative'
        && record.status === 'pending'
        && record.timing?.dispatchedAtMs !== null
      )),
      false,
      'the refused foreground record is not retained as dispatched pending custody',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

test('replay persists a changed positive authority before releasing a waiting foreground dispatch', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://replay-successor-before-dispatch-release.example';
  const targetProfileId = 'local-dev-sqlite-ibex';
  const successorGeneration = Object.freeze({
    ...TEST_ARTIFACT_GENERATION,
    bundleHash: testDigest('d'),
  });
  const successorLedgerIncarnation = 'ledger-incarnation-after-replay-admission';
  await commitCompleteReplayCapability(store, origin, targetProfileId);
  await store.outboxEnqueue({
    id: 'cm-replay-successor-before-dispatch-release',
    function: 'createThing',
    ...currentOutboxTarget({ origin, targetProfileId }),
    args: { title: 'replay owns the dispatch lock' },
  });
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let inspectRequests = 0;
  let mutationPosts = 0;
  let resolveReplayFinalInspection;
  let resolveReplayFinalInspectionStarted;
  const replayFinalInspectionStartedPromise = new Promise((resolve) => {
    resolveReplayFinalInspectionStarted = resolve;
  });
  const replayFinalInspection = new Promise((resolve) => {
    resolveReplayFinalInspection = resolve;
  });
  let resolveForegroundEnqueue;
  let resolveForegroundEnqueueStarted;
  const foregroundEnqueueStarted = new Promise((resolve) => {
    resolveForegroundEnqueueStarted = resolve;
  });
  const foregroundEnqueueRelease = new Promise((resolve) => {
    resolveForegroundEnqueue = resolve;
  });
  const outboxEnqueue = store.outboxEnqueue.bind(store);
  store.outboxEnqueue = async (record, ...args) => {
    const stored = await outboxEnqueue(record, ...args);
    if (record.id === 'cm-foreground-waits-behind-replay-successor') {
      resolveForegroundEnqueueStarted();
      await foregroundEnqueueRelease;
    }
    return stored;
  };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      inspectRequests += 1;
      if (inspectRequests === 3) {
        resolveReplayFinalInspectionStarted();
        return replayFinalInspection;
      }
      return Response.json(offlineReplayInspection({ supported: true, targetProfileId }));
    }
    if (path === '/mutation/createThing') {
      mutationPosts += 1;
      throw new TypeError('simulated lost response after predecessor mutation effect');
    }
    throw new Error(`unexpected replay/foreground request ${path}`);
  };

  try {
    const foregroundOutcome = client.mutate('createThing', {
      args: { title: 'foreground waits behind replay successor' },
      clientMutationId: 'cm-foreground-waits-behind-replay-successor',
      queue: 'auto',
    }).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    await foregroundEnqueueStarted;
    const replayPromise = client.replayQueuedMutations();
    await replayFinalInspectionStartedPromise;
    resolveForegroundEnqueue();
    await new Promise((resolve) => setImmediate(resolve));
    resolveReplayFinalInspection(Response.json(offlineReplayInspection({
      supported: true,
      targetProfileId,
      generation: successorGeneration,
      ledgerIncarnation: successorLedgerIncarnation,
    })));

    const [replay, foreground] = await Promise.all([replayPromise, foregroundOutcome]);
    assert.equal(replay.replayed, 0);
    assert.equal(replay.stopped, true);
    assert.equal(foreground.value, null);
    assert.equal(
      foreground.error?.code,
      'SNAPBACK_CLIENT_OPERATION_TARGET_CHANGED',
    );
    assert.equal(mutationPosts, 0, 'neither predecessor-pinned mutation reaches transport');
    const currentFact = await store.readOfflineMutationReplayCapabilityFact();
    assert.deepEqual(currentFact.artifactGeneration, successorGeneration);
    assert.equal(currentFact.ledgerIncarnation, successorLedgerIncarnation);
  } finally {
    resolveForegroundEnqueue();
    resolveReplayFinalInspection(Response.json(offlineReplayInspection({
      supported: true,
      targetProfileId,
      generation: successorGeneration,
      ledgerIncarnation: successorLedgerIncarnation,
    })));
    await client.close();
    await store.close();
  }
});

test('replay refuses a baseUrl repoint between drain inspection and POST', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const originA = 'https://pinned-replay-a.example';
  const originB = 'https://pinned-replay-b.example';
  const clientMutationId = 'cm-pinned-replay-target';
  await store.outboxEnqueue({
    id: clientMutationId,
    function: 'createThing',
    ...currentOutboxTarget({ origin: originA }),
    args: { title: 'keep replay on its inspected target' },
  });
  const client = new InspectingSnapbackClient(originA, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let originAPosts = 0;
  let originBPosts = 0;
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname === '/inspect') {
      assert.equal(target.origin, originA, 'drain inspection uses the replay-start target');
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    if (target.origin === originA) originAPosts += 1;
    if (target.origin === originB) originBPosts += 1;
    throw new TypeError('the repointed replay transport is ambiguous');
  };
  const readCapabilityFact = store.readOfflineMutationReplayCapabilityFact.bind(store);
  let repointOnCapabilityRead = false;
  store.readOfflineMutationReplayCapabilityFact = async () => {
    const fact = await readCapabilityFact();
    if (repointOnCapabilityRead) client.baseUrl = originB;
    return fact;
  };
  const withAuthorizationDispatch = store.withOutboxAuthorizationDispatch.bind(store);
  store.withOutboxAuthorizationDispatch = (operation, options) => (
    withAuthorizationDispatch(async () => {
      repointOnCapabilityRead = true;
      return operation();
    }, options)
  );

  try {
    const replay = await client.replayQueuedMutations();
    assert.equal(replay.replayed, 0, 'the repointed replay never settles');
    assert.equal(replay.stopped, true, 'the target-change refusal pauses replay');
    assert.equal(originAPosts, 0, 'the refused replay issues no POST to target A');
    assert.equal(originBPosts, 0, 'the refused replay issues no POST to target B');
    const [retained] = await store.outboxPending();
    assert.equal(retained.id, clientMutationId);
    assert.equal(
      retained.timing.dispatchedAtMs,
      null,
      'the target-refused replay is never stamped as dispatched',
    );
    assert.equal(
      client.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_CLIENT_OPERATION_TARGET_CHANGED',
      'the replay target refusal is observable through the diagnostics surface',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

test('cross-target relaunch refuses the persisted enqueue target before POST', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const originA = 'https://persisted-target-a.example';
  const originB = 'https://persisted-target-b.example';
  const appGeneration = {
    ...TEST_ARTIFACT_GENERATION,
    appId: 'persisted-target-app',
  };
  const targetAProfile = 'local-target-a';
  const targetBProfile = 'local-target-b';
  let targetBPosts = 0;
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: target.origin === originA ? targetAProfile : targetBProfile,
        generation: appGeneration,
      }));
    }
    if (target.origin === originA) throw new TypeError('target A went offline after admission');
    targetBPosts += 1;
    return Response.json({ result: { wrongTarget: true }, version: 1 });
  };
  const enqueueClient = new InspectingSnapbackClient(originA, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const queued = await enqueueClient.mutate('createThing', {
    clientMutationId: 'cm-persisted-cross-target-relaunch',
    args: { title: 'belongs to target A' },
  });
  assert.equal(queued.status, 'queued');
  await enqueueClient.close();

  const replayClient = new InspectingSnapbackClient(originB, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const replay = await replayClient.replayQueuedMutations();
    assert.equal(replay.replayed, 0, 'target A intent is not replayed by target B');
    assert.equal(replay.stopped, true, 'target mismatch pauses replay');
    assert.equal(targetBPosts, 0, 'target mismatch sends zero mutation POSTs to target B');
    assert.deepEqual(
      (await store.outboxPending()).map((record) => record.id),
      ['cm-persisted-cross-target-relaunch'],
      'target mismatch leaves the record pending',
    );
    assert.equal(
      replayClient.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
    );
  } finally {
    await replayClient.close();
    await store.close();
  }
});

test('provided ledgerIncarnation fences same-origin same-artifact reset replay before POST', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://same-target-reset.example';
  const targetProfileId = 'same-target-reset-profile';
  const clientMutationId = 'cm-same-target-ledger-reset';
  let ledgerIncarnation = 'ledger-incarnation-before-reset';
  let resetMutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId,
        ledgerIncarnation,
      }));
    }
    if (ledgerIncarnation === 'ledger-incarnation-before-reset') {
      throw new TypeError('mutation response lost before reset');
    }
    resetMutationPosts += 1;
    return Response.json({ result: { appliedAgain: true }, version: 1 });
  };

  const enqueueClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const queued = await enqueueClient.mutate('createThing', {
    clientMutationId,
    args: { title: 'must not apply after ledger reset' },
  });
  assert.equal(queued.status, 'queued');
  const beforeReset = structuredClone((await store.outboxRecords())[0]);
  assert.equal(beforeReset.enqueueTarget.ledgerIncarnation, ledgerIncarnation);
  assert.equal(
    (await store.readOfflineMutationReplayCapabilityFact()).ledgerIncarnation,
    ledgerIncarnation,
  );
  await enqueueClient.close();

  ledgerIncarnation = 'ledger-incarnation-after-reset';
  const replayClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const replay = await replayClient.replayQueuedMutations();
    assert.equal(replay.replayed, 0);
    assert.equal(replay.stopped, true);
    assert.equal(resetMutationPosts, 0, 'a changed ledger incarnation permits zero POSTs');
    assert.deepEqual(
      (await store.outboxRecords())[0],
      beforeReset,
      'the pre-reset record remains byte-identical and pending',
    );
    assert.equal(
      replayClient.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
    );
  } finally {
    await replayClient.close();
    await store.close();
  }
});

test('an initial mixed-target snapshot replays its valid prefix before pausing', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const originA = 'https://initial-mixed-target-a.example';
  const originB = 'https://initial-mixed-target-b.example';
  const generation = { ...TEST_ARTIFACT_GENERATION, appId: 'initial-mixed-target-app' };
  const targetAProfile = 'initial-mixed-target-a';
  const targetBProfile = 'initial-mixed-target-b';
  const targetBPrefix = ['cm-initial-mixed-b-1', 'cm-initial-mixed-b-2'];
  const targetAId = 'cm-initial-mixed-a';
  const targetBSuccessor = 'cm-initial-mixed-b-after-a';
  for (const { id, origin, targetProfileId } of [
    ...targetBPrefix.map((id) => ({ id, origin: originB, targetProfileId: targetBProfile })),
    { id: targetAId, origin: originA, targetProfileId: targetAProfile },
    { id: targetBSuccessor, origin: originB, targetProfileId: targetBProfile },
  ]) {
    await store.outboxEnqueue({
      id,
      function: 'createThing',
      ...currentOutboxTarget({ origin, targetProfileId, generation }),
      args: { title: id },
    });
  }

  const mutationPosts = [];
  globalThis.fetch = async (url, init = {}) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: targetBProfile,
        generation,
      }));
    }
    mutationPosts.push(JSON.parse(init.body).clientMutationId);
    return Response.json({ result: { replayed: true }, version: mutationPosts.length });
  };
  const client = new InspectingSnapbackClient(originB, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const replay = await client.replayQueuedMutations();
    assert.equal(replay.replayed, targetBPrefix.length, 'the valid target-B prefix replays');
    assert.equal(replay.stopped, true, 'the first cross-target record pauses the drain');
    assert.equal(replay.remaining, 2, 'the mismatch and its successor remain pending');
    assert.deepEqual(mutationPosts, targetBPrefix, 'no POST starts at or after the mismatch');
    assert.deepEqual(
      (await store.outboxPending()).map((record) => record.id),
      [targetAId, targetBSuccessor],
      'the mismatched record and its successor retain ordered pending custody',
    );
    assert.equal(
      client.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

test('default drain keeps a session-fenced target mismatch ahead of custody reconciliation', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const coordinator = createSuccessorCoordinator();
  const originA = 'https://session-fenced-target-a.example';
  const originB = 'https://session-fenced-target-b.example';
  const targetAProfile = 'session-fenced-target-a';
  const targetBProfile = 'session-fenced-target-b';
  const principalScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: '018f0d90-7b26-7a22-8c33-445566778899',
    userId: TEST_SESSION_USER_ID,
  };
  const targetBId = 'cm-session-fenced-target-b-prefix';
  const targetAId = 'cm-session-fenced-target-a-mismatch';
  const mutationPosts = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') {
      const handshake = sessionHandshake(
        TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
        TEST_SESSION_USER_ID,
      );
      return Response.json({
        ...handshake,
        deploymentIdentity: {
          ...handshake.deploymentIdentity,
          appId: TEST_ARTIFACT_GENERATION.appId,
        },
      });
    }
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: targetBProfile,
      }));
    }
    if (path === '/connection/open') {
      const connectionId = JSON.parse(init.body).connectionId;
      return Response.json({
        connectionId,
        connectionToken: `sct_${connectionId}`,
        wireVersion: 'snapback.v1',
      });
    }
    const body = JSON.parse(init.body);
    mutationPosts.push(body.clientMutationId);
    return Response.json({
      result: { replayed: true },
      version: mutationPosts.length,
      authorityDescriptor: TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
    });
  };
  const client = new InspectingSnapbackClient(originB, {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: store,
  });
  try {
    const capture = await settleSuccessorCoordinator(coordinator);
    await client.authSession();
    const custody = {
      authorityEpoch: capture.authorityEpoch,
      authorityKey: capture.authorityKey,
    };
    await store.outboxEnqueue({
      id: targetBId,
      function: 'createThing',
      ...currentOutboxTarget({ origin: originB, targetProfileId: targetBProfile }),
      args: { title: targetBId },
      authorityDescriptor: TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
      principalScope,
      custody,
    });
    await store.outboxEnqueue({
      id: targetAId,
      function: 'createThing',
      ...currentOutboxTarget({ origin: originA, targetProfileId: targetAProfile }),
      args: { title: targetAId },
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
      principalScope,
      custody,
    });
    const mismatchedBefore = structuredClone(
      (await store.outboxRecords()).find((record) => record.id === targetAId),
    );
    const replay = await client.replayQueuedMutations();
    assert.equal(replay.replayed, 1, 'the valid target-B prefix replays normally');
    assert.equal(replay.stopped, true, 'the target-A record pauses the target-B drain');
    assert.deepEqual(mutationPosts, [targetBId], 'the target-A record sends zero mutation POSTs');
    const mismatchedAfter = (await store.outboxRecords())
      .find((record) => record.id === targetAId);
    assert.deepEqual(
      mismatchedAfter,
      mismatchedBefore,
      'the target-A record remains byte-identical and pending',
    );
    assert.equal(mismatchedAfter.status, 'pending');
    assert.equal(
      client.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
    );
  } finally {
    await client.close();
    await coordinator.close();
    await store.close();
  }
});

test('a cross-target record injected into the second pending snapshot stays pending', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const originA = 'https://mid-drain-target-a.example';
  const originB = 'https://mid-drain-target-b.example';
  const generation = { ...TEST_ARTIFACT_GENERATION, appId: 'mid-drain-target-app' };
  const targetAProfile = 'mid-drain-target-a';
  const targetBProfile = 'mid-drain-target-b';
  const targetAId = 'cm-mid-drain-target-a';
  const targetBIds = ['cm-mid-drain-target-b-1', 'cm-mid-drain-target-b-2'];
  for (const id of targetBIds) {
    await store.outboxEnqueue({
      id,
      function: 'createThing',
      ...currentOutboxTarget({
        origin: originB,
        targetProfileId: targetBProfile,
        generation,
      }),
      args: { title: id },
    });
  }

  const outboxPending = store.outboxPending.bind(store);
  let pendingReads = 0;
  store.outboxPending = async (...args) => {
    pendingReads += 1;
    if (pendingReads === 2) {
      await store.outboxEnqueue({
        id: targetAId,
        function: 'createThing',
        ...currentOutboxTarget({
          origin: originA,
          targetProfileId: targetAProfile,
          generation,
        }),
        args: { title: targetAId },
      });
    }
    return outboxPending(...args);
  };

  const mutationPosts = [];
  globalThis.fetch = async (url, init = {}) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: targetBProfile,
        generation,
      }));
    }
    mutationPosts.push(JSON.parse(init.body).clientMutationId);
    return Response.json({ result: { replayed: true }, version: mutationPosts.length });
  };
  const client = new InspectingSnapbackClient(originB, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const replay = await client.replayQueuedMutations();
    assert.equal(replay.replayed, 2, 'the target-B records replay normally');
    assert.equal(replay.stopped, true, 'the cross-target record pauses the drain');
    assert.equal(replay.remaining, 1, 'only the cross-target record remains');
    assert.deepEqual(mutationPosts, targetBIds, 'no POST starts for the target-A record');
    assert.deepEqual(
      (await outboxPending()).map((record) => record.id),
      [targetAId],
      'the target-A record remains pending',
    );
    assert.equal(
      client.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

test('same-origin app replacement refuses string-named persisted intent before POST', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://persisted-app-identity.example';
  const appA = { ...TEST_ARTIFACT_GENERATION, appId: 'persisted-app-a' };
  const appB = { ...TEST_ARTIFACT_GENERATION, appId: 'persisted-app-b' };
  let servedGeneration = appA;
  let successorPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'same-origin-local-target',
        generation: servedGeneration,
      }));
    }
    if (servedGeneration === appA) throw new TypeError('app A stopped after admission');
    successorPosts += 1;
    return Response.json({ result: { wrongApp: true }, version: 1 });
  };
  const enqueueClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const queued = await enqueueClient.mutate('createThing', {
    clientMutationId: 'cm-persisted-same-origin-app',
    args: { title: 'belongs to app A' },
  });
  assert.equal(queued.status, 'queued');
  await enqueueClient.close();
  servedGeneration = appB;

  const replayClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const replay = await replayClient.replayQueuedMutations();
    assert.equal(replay.replayed, 0, 'app A intent is not replayed by app B');
    assert.equal(replay.stopped, true, 'app identity mismatch pauses replay');
    assert.equal(successorPosts, 0, 'app identity mismatch sends zero mutation POSTs');
    assert.deepEqual(
      (await store.outboxPending()).map((record) => record.id),
      ['cm-persisted-same-origin-app'],
      'app identity mismatch leaves the record pending',
    );
    assert.equal(
      replayClient.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
    );
  } finally {
    await replayClient.close();
    await store.close();
  }
});

test('same-origin same-app generation replacement refuses string-named persisted intent before POST', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://persisted-string-generation.example';
  const generationOne = {
    ...TEST_ARTIFACT_GENERATION,
    appId: 'persisted-string-generation-app',
  };
  const generationTwo = {
    ...generationOne,
    schemaHash: testDigest('d'),
    bundleHash: testDigest('e'),
    inputsHash: testDigest('f'),
  };
  let servedGeneration = generationOne;
  let successorPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'same-app-generation-target',
        generation: servedGeneration,
      }));
    }
    if (servedGeneration === generationOne) {
      throw new TypeError('generation one stopped after admission');
    }
    successorPosts += 1;
    return Response.json({ result: { wrongGeneration: true }, version: 2 });
  };
  const enqueueClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const clientMutationId = 'cm-persisted-string-generation';
  const queued = await enqueueClient.mutate('createThing', {
    clientMutationId,
    args: { title: 'belongs to served generation one' },
  });
  assert.equal(queued.status, 'queued');
  const persistedBeforeReplay = structuredClone((await store.outboxPending())[0]);
  await enqueueClient.close();
  servedGeneration = generationTwo;

  const replayClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const replay = await replayClient.replayQueuedMutations();
    assert.equal(replay.replayed, 0, 'generation-one intent is not replayed under generation two');
    assert.equal(replay.stopped, true, 'the persisted generation mismatch pauses replay');
    assert.equal(successorPosts, 0, 'the persisted generation mismatch sends zero mutation POSTs');
    assert.deepEqual(
      (await store.outboxPending()).map((record) => record.id),
      [clientMutationId],
      'the persisted generation mismatch leaves the record pending',
    );
    assert.deepEqual(
      persistedBeforeReplay.enqueueTarget.artifactIdentity,
      {
        kind: 'app',
        appId: generationOne.appId,
        generation: generationOne,
      },
      'string-named enqueue persists the complete served artifact generation',
    );
    assert.equal(
      replayClient.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
    );
  } finally {
    await replayClient.close();
    await store.close();
  }
});

test('string-named replay carries its persisted generation across an inspect-to-POST deployment race', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://persisted-string-generation-race.example';
  const generationOne = {
    ...TEST_ARTIFACT_GENERATION,
    appId: 'persisted-string-generation-race-app',
  };
  const generationTwo = {
    ...generationOne,
    schemaHash: testDigest('7'),
    bundleHash: testDigest('8'),
    inputsHash: testDigest('9'),
  };
  let enqueueOffline = true;
  let switchAfterReplayInspect = false;
  let servedGeneration = generationOne;
  let successorEffects = 0;
  let wireExpectedGeneration = null;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      const response = Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'same-app-generation-race-target',
        generation: servedGeneration,
      }));
      if (switchAfterReplayInspect) servedGeneration = generationTwo;
      return response;
    }
    if (enqueueOffline) throw new TypeError('generation one stopped after admission');
    const body = JSON.parse(init.body);
    wireExpectedGeneration = body.expectedGeneration ?? null;
    // v0-dev does not enforce expectedGeneration. The client must catch the
    // inspect-to-POST replacement itself instead of relying on a mocked 409.
    successorEffects += 1;
    return Response.json({ result: { wrongGeneration: true }, version: 2 });
  };
  const enqueueClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const clientMutationId = 'cm-persisted-string-generation-race';
  const queued = await enqueueClient.mutate('createThing', {
    clientMutationId,
    args: { title: 'belongs to generation one' },
  });
  assert.equal(queued.status, 'queued');
  await enqueueClient.close();

  enqueueOffline = false;
  switchAfterReplayInspect = true;
  const replayClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const replay = await replayClient.replayQueuedMutations();
    assert.equal(replay.replayed, 0, 'generation-one intent has no effect on generation two');
    assert.equal(replay.failed, 0, 'an atomic generation refusal pauses rather than fails intent');
    assert.equal(replay.stopped, true, 'the generation race pauses replay');
    assert.equal(replay.remaining, 1, 'the refused record remains recoverable');
    assert.equal(successorEffects, 0, 'generation two executes zero predecessor effects');
    assert.equal(wireExpectedGeneration, null, 'the client refuses before the replay POST');
    assert.equal(
      replayClient.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
    );
    assert.deepEqual(
      (await store.outboxPending()).map((record) => record.id),
      [clientMutationId],
      'the server-refused generation-one record stays pending',
    );
  } finally {
    await replayClient.close();
    await store.close();
  }
});

test('online-only string-named mutation carries the inspected generation across the final-answer deployment race', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const coordinator = createSuccessorCoordinator();
  const origin = 'https://foreground-string-generation-race.example';
  const targetProfileId = 'foreground-string-generation-sessions';
  const generationOne = {
    ...TEST_ARTIFACT_GENERATION,
  };
  const generationTwo = {
    ...generationOne,
    schemaHash: testDigest('1'),
    bundleHash: testDigest('2'),
    inputsHash: testDigest('3'),
  };
  let servedGeneration = generationOne;
  let switchAfterFinalCapabilityAnswer = false;
  let mutationPosts = 0;
  let successorEffects = 0;
  let wireExpectedGeneration = null;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') {
      const handshake = sessionHandshake(TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR);
      return Response.json({
        ...handshake,
        deploymentIdentity: {
          ...handshake.deploymentIdentity,
          appId: generationOne.appId,
        },
      });
    }
    if (path === '/inspect') {
      const response = Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId,
        generation: servedGeneration,
      }));
      if (switchAfterFinalCapabilityAnswer) servedGeneration = generationTwo;
      return response;
    }
    mutationPosts += 1;
    const body = JSON.parse(init.body);
    wireExpectedGeneration = body.expectedGeneration ?? null;
    if (
      wireExpectedGeneration === null
      || JSON.stringify(wireExpectedGeneration) !== JSON.stringify(servedGeneration)
    ) {
      return Response.json({
        diagnostic: {
          code: 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
          message: 'the asserted mutation generation is not active',
        },
      }, { status: 409 });
    }
    successorEffects += 1;
    return Response.json({ result: { wronglyApplied: true }, version: 2 });
  };
  const client = new InspectingSnapbackClient(origin, {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    await settleSuccessorCoordinator(coordinator);
    await client.authSession();
    switchAfterFinalCapabilityAnswer = true;
    await client.inspect();
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'belongs to generation one' },
        clientMutationId: 'cm-foreground-string-generation-race',
        queue: false,
      }),
      (error) => error?.code === 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
    );
    assert.equal(mutationPosts, 1, 'the Sessions target receives one foreground POST');
    assert.deepEqual(
      wireExpectedGeneration,
      generationOne,
      'the online-only string-named foreground carrier asserts its inspected generation',
    );
    assert.equal(successorEffects, 0, 'generation two executes zero predecessor effects');
  } finally {
    await client.close();
    await store.close();
  }
});

test('foreground string-named mutation locally refuses a changed complete dispatch target', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://foreground-string-target-change.example';
  const targetProfileId = 'foreground-string-target-change-profile';
  const generationOne = {
    ...TEST_ARTIFACT_GENERATION,
    appId: 'foreground-string-target-change-app',
  };
  const generationTwo = {
    ...generationOne,
    bundleHash: testDigest('4'),
  };
  let servedGeneration = generationOne;
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId,
        generation: servedGeneration,
      }));
    }
    mutationPosts += 1;
    return Response.json({ result: { wronglyApplied: true }, version: 2 });
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'must remain pinned to generation one' },
        clientMutationId: 'cm-foreground-string-target-change',
        __beforeTransportDispatch: async () => {
          servedGeneration = generationTwo;
          await replacingClient.inspect();
        },
      }),
      (error) => (
        error?.code === 'SNAPBACK_CLIENT_OPERATION_TARGET_CHANGED'
        && error?.diagnostic?.details?.reason === 'operation-target-changed'
      ),
    );
    assert.equal(mutationPosts, 0, 'the changed complete target is refused before POST');
    assert.deepEqual(await store.outboxRecords(), [], 'pre-dispatch custody is retired exactly once');
  } finally {
    await replacingClient.close();
    await client.close();
    await store.close();
  }
});

test('answered pre-POST inspection failure pauses the pending queue without failing records', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://replay-pre-post-inspection-answered-error.example';
  const targetProfileId = 'replay-pre-post-inspection-answered-error-target';
  const clientMutationIds = [
    'cm-replay-pre-post-inspection-answered-error-one',
    'cm-replay-pre-post-inspection-answered-error-two',
  ];
  for (const [index, id] of clientMutationIds.entries()) {
    await store.outboxEnqueue({
      id,
      function: 'createThing',
      args: { title: `pending record ${index + 1}` },
      ...currentOutboxTarget({ origin, targetProfileId }),
    });
  }
  let inspectionRequests = 0;
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      inspectionRequests += 1;
      if (inspectionRequests === 1) {
        return Response.json(offlineReplayInspection({ supported: true, targetProfileId }));
      }
      return Response.json({
        diagnostic: { code: 'HTTP_502', message: 'persistent proxy failure' },
      }, { status: 502 });
    }
    mutationPosts += 1;
    return Response.json({ result: { mustNotRun: true }, version: 1 });
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  try {
    const replay = await client.replayQueuedMutations();
    assert.equal(replay.replayed, 0, 'the answered pre-POST failure settles no record');
    assert.equal(replay.failed, 0, 'the answered pre-POST failure is retriable, not terminal');
    assert.equal(replay.stopped, true, 'the first answered pre-POST failure pauses the lane');
    assert.equal(replay.remaining, 2, 'every pending record remains recoverable');
    assert.equal(inspectionRequests, 2, 'replay stops after the first pre-POST inspect failure');
    assert.equal(mutationPosts, 0, 'the answered pre-POST failure sends no mutation POST');
    assert.deepEqual(
      (await store.outboxRecords()).map((record) => ({ id: record.id, status: record.status })),
      clientMutationIds.map((id) => ({ id, status: 'pending' })),
      'a persistent answered failure cannot walk the pending queue into failed state',
    );
    assert.equal(
      client.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_REPLAY_INSPECTION_UNAVAILABLE',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

const exerciseTargetAwareOptimisticProjection = async ({
  enqueueOrigin,
  projectionOrigin,
  enqueueAppId,
  projectionAppId,
  enqueueGenerationOverrides = {},
  projectionGenerationOverrides = {},
}) => {
  const store = createDurableTestStore();
  const targetProfileId = 'target-aware-optimistic-projection';
  const enqueueGeneration = Object.freeze({
    schemaVersion: 'snapback.v1',
    appId: enqueueAppId,
    schemaHash: testDigest('a'),
    bundleHash: testDigest('b'),
    inputsHash: testDigest('c'),
    ...enqueueGenerationOverrides,
  });
  const projectionGeneration = Object.freeze({
    ...enqueueGeneration,
    appId: projectionAppId,
    ...projectionGenerationOverrides,
  });
  const enqueueClient = new InspectingSnapbackClient(enqueueOrigin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  enqueueClient.__registerInspectionAppId(enqueueGeneration.appId);
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId,
        generation: enqueueGeneration,
      }));
    }
    throw new TypeError('enqueue target is offline');
  };
  const queued = await enqueueClient.mutate(
    optimisticCreateCardReference(enqueueGeneration),
    {
      args: { title: 'card-from-a', position: 1 },
      clientMutationId: `cm-target-projection-${enqueueAppId}`,
    },
  );
  assert.equal(queued.status, 'queued');
  const pendingRecord = (await store.outboxPending()).find((record) => record.id === queued.clientMutationId);
  assert.ok(pendingRecord?.enqueueTarget, 'the optimistic record carries its durable enqueue target');

  const settledId = `cm-target-settlement-${enqueueAppId}`;
  await store.outboxEnqueue({
    id: settledId,
    function: 'createCard',
    ...currentOutboxTarget({
      origin: enqueueOrigin,
      targetProfileId,
      generation: enqueueGeneration,
      generated: true,
    }),
    args: { title: 'settled-on-a', position: 2 },
    userId: null,
  });
  await store.outboxDurablyConsume(
    settledId,
    { result: { id: 'card-settled-on-a' }, version: 1 },
    null,
  );
  await enqueueClient.close();

  const projectionClient = new InspectingSnapbackClient(projectionOrigin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  projectionClient.__registerInspectionAppId(projectionGeneration.appId);
  try {
    globalThis.fetch = async (url) => {
      assert.equal(new URL(url).pathname, '/inspect');
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId,
        generation: projectionGeneration,
      }));
    };
    await projectionClient.inspect();
    const view = await projectionClient.createOptimisticMutationView({
      authoritativeRows: { cards: [] },
    });
    try {
      assert.equal(
        view.getSnapshot().layers.length,
        0,
        'a target-mismatched optimistic layer is excluded without changing durable custody',
      );
      assert.deepEqual(view.getSnapshot().visibleRows.cards, []);
    } finally {
      view.close();
    }
    const status = await projectionClient.mutationStatus(queued.clientMutationId);
    assert.equal(
      status.status,
      'unknown',
      'a foreign id is a target-fenced no-op rather than a predecessor observation',
    );
    assert.equal(status.enqueueTarget, undefined);
    assert.deepEqual(
      await projectionClient.settledMutations(),
      [],
      'a target-mismatched settlement is not projected into the replacement app',
    );
    assert.equal(
      (await store.outboxRecords()).length,
      2,
      'target-aware observation leaves both predecessor records byte-owned by the store',
    );
  } finally {
    await projectionClient.close();
    await store.close();
  }
};

test('cross-origin store reopen filters predecessor optimistic and settlement projections', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  await exerciseTargetAwareOptimisticProjection({
    enqueueOrigin: 'https://optimistic-target-a.example',
    projectionOrigin: 'https://optimistic-target-b.example',
    enqueueAppId: 'optimistic-cross-origin-app',
    projectionAppId: 'optimistic-cross-origin-app',
  });
});

test('same-origin app replacement filters predecessor optimistic and settlement projections', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  await exerciseTargetAwareOptimisticProjection({
    enqueueOrigin: 'https://optimistic-app-replacement.example',
    projectionOrigin: 'https://optimistic-app-replacement.example',
    enqueueAppId: 'optimistic-app-a',
    projectionAppId: 'optimistic-app-b',
  });
});

test('same-origin same-app generation replacement filters predecessor projections', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  await exerciseTargetAwareOptimisticProjection({
    enqueueOrigin: 'https://optimistic-generation-replacement.example',
    projectionOrigin: 'https://optimistic-generation-replacement.example',
    enqueueAppId: 'optimistic-generation-app',
    projectionAppId: 'optimistic-generation-app',
    projectionGenerationOverrides: { schemaHash: testDigest('d') },
  });
});

test('legacy targetless records never project into a current target', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://legacy-targetless-projection.example';
  await store.outboxEnqueue({
    id: 'cm-legacy-targetless-projection',
    function: 'createThing',
    args: { title: 'legacy settlement' },
  });
  await store.outboxDurablyConsume(
    'cm-legacy-targetless-projection',
    { result: { id: 'legacy-result' }, version: 1 },
    null,
  );
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/inspect');
    return Response.json(offlineReplayInspection({
      supported: true,
      targetProfileId: 'legacy-targetless-projection-profile',
    }));
  };
  try {
    await client.inspect();
    const status = await client.mutationStatus('cm-legacy-targetless-projection');
    assert.equal(status.status, 'unknown', 'a targetless legacy id is a target-fenced no-op');
    assert.equal(status.enqueueTarget, undefined);
    assert.deepEqual(
      await client.settledMutations(),
      [],
      'a targetless legacy settlement is excluded from current recovery projection',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

test('matching persisted enqueue target replays exactly once after relaunch', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://persisted-target-match.example';
  const generation = { ...TEST_ARTIFACT_GENERATION, appId: 'persisted-target-match-app' };
  let online = false;
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'persisted-target-match-profile',
        generation,
      }));
    }
    mutationPosts += 1;
    if (!online) throw new TypeError('offline after enqueue admission');
    return Response.json({ result: { matched: true }, version: 1 });
  };
  const enqueueClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const queued = await enqueueClient.mutate('createThing', {
    clientMutationId: 'cm-persisted-target-match',
    args: { title: 'same target only' },
  });
  assert.equal(queued.status, 'queued');
  const [persisted] = await store.outboxPending();
  assert.equal(persisted.outboxRecordSchemaVersion, 2);
  assert.deepEqual(persisted.enqueueTarget, {
    schemaVersion: 'snapback.outbox-enqueue-target.v1',
    canonicalOrigin: origin,
    targetProfileId: 'persisted-target-match-profile',
    artifactIdentity: { kind: 'app', appId: generation.appId, generation },
  });
  await enqueueClient.close();
  online = true;

  const replayClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const replay = await replayClient.replayQueuedMutations();
    assert.deepEqual(
      { replayed: replay.replayed, failed: replay.failed, remaining: replay.remaining },
      { replayed: 1, failed: 0, remaining: 0 },
    );
    assert.equal(mutationPosts, 2, 'one failed foreground POST and one replay POST occur');
    assert.deepEqual(await store.outboxPending(), []);
  } finally {
    await replayClient.close();
    await store.close();
  }
});

test('legacy targetless outbox record fails closed with a distinct replay diagnostic', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await store.outboxEnqueue({
    id: 'cm-legacy-targetless-record',
    function: 'createThing',
    args: { title: 'pre-v2 record' },
  });
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'legacy-targetless-profile',
      }));
    }
    mutationPosts += 1;
    return Response.json({ result: { shouldNotRun: true }, version: 1 });
  };
  const client = new InspectingSnapbackClient('https://legacy-targetless.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const replay = await client.replayQueuedMutations();
    assert.equal(replay.replayed, 0, 'targetless legacy intent is never replayed');
    assert.equal(replay.stopped, true, 'targetless legacy intent pauses replay');
    assert.equal(mutationPosts, 0, 'targetless legacy intent sends zero mutation POSTs');
    assert.deepEqual(
      (await store.outboxPending()).map((record) => record.id),
      ['cm-legacy-targetless-record'],
      'targetless legacy intent remains pending',
    );
    assert.equal(
      client.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_REPLAY_TARGET_MISSING',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

test('replay checks peer capability currency under the dispatch lock before range refresh', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://replay-range-capability-lock.example';
  const clientMutationId = 'cm-replay-range-capability-lock';
  await store.outboxEnqueue({
    id: clientMutationId,
    function: 'createThing',
    ...currentOutboxTarget({ origin, targetProfileId: null }),
    args: { title: 'peer negative precedes range transport' },
    userId: 'user-a',
  });
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    operationIdentityProtocol: 1,
    __outboxDrainLifecycle: false,
  });
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let negativeEnabled = false;
  let rangePosts = 0;
  let mutationPosts = 0;
  const issuedAtMs = Date.now();
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: !negativeEnabled,
        targetProfileId: negativeEnabled
          ? 'cloudflare-do-sqlite-v8'
          : 'local-dev-sqlite-ibex',
      }));
    }
    if (path === '/client-mutations/identity-range') {
      rangePosts += 1;
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'audience-replay-range-capability-lock',
          authorityInstanceId: 'authority-replay-range-capability-lock',
          epochId: 'epoch-replay-range-capability-lock',
          epochSequence: 0,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${'c'.repeat(64)}`,
        },
      });
    }
    mutationPosts += 1;
    return Response.json({ result: { committed: true }, version: 1 });
  };
  const withAuthorizationDispatch = store.withOutboxAuthorizationDispatch.bind(store);
  const readStoreMeta = store.readStoreMeta.bind(store);
  let insideAuthorizationDispatch = false;
  let injectedNegative = false;
  store.withOutboxAuthorizationDispatch = (operation, options) => (
    withAuthorizationDispatch(async () => {
      insideAuthorizationDispatch = true;
      try {
        return await operation();
      } finally {
        insideAuthorizationDispatch = false;
      }
    }, options)
  );
  store.readStoreMeta = async () => {
    const meta = await readStoreMeta();
    if (insideAuthorizationDispatch && !injectedNegative) {
      injectedNegative = true;
      negativeEnabled = true;
      await replacingClient.inspect();
    }
    return meta;
  };

  try {
    const replay = await client.replayQueuedMutations();
    assert.equal(rangePosts, 0, 'a peer negative prevents identity-range transport');
    assert.equal(mutationPosts, 0, 'the superseded replay issues no mutation POST');
    assert.equal(replay.replayed, 0);
    assert.equal(replay.stopped, true);
    const [retained] = await store.outboxPending();
    assert.equal(retained.operationIssuance, null, 'superseded replay remains uncovered');
    assert.equal(
      retained.timing.dispatchedAtMs,
      null,
      'range-skipped replay is never stamped as dispatched',
    );
  } finally {
    await replacingClient.close();
    await client.close();
    await store.close();
  }
});

test('foreground checks peer capability currency under the dispatch lock before range refresh', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://foreground-range-capability-lock.example';
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    operationIdentityProtocol: 1,
    __outboxDrainLifecycle: false,
  });
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  replacingClient.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let negativeEnabled = false;
  let rangePosts = 0;
  let mutationPosts = 0;
  const issuedAtMs = Date.now();
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: !negativeEnabled,
        targetProfileId: negativeEnabled
          ? 'cloudflare-do-sqlite-v8'
          : 'local-dev-sqlite-ibex',
      }));
    }
    if (path === '/client-mutations/identity-range') {
      rangePosts += 1;
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'audience-foreground-range-capability-lock',
          authorityInstanceId: 'authority-foreground-range-capability-lock',
          epochId: 'epoch-foreground-range-capability-lock',
          epochSequence: 0,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: testDigest('8'),
        },
      });
    }
    mutationPosts += 1;
    return Response.json({ result: { committed: true }, version: 1 });
  };
  const enqueueWithIdentity = store.outboxEnqueueWithOperationIdentity.bind(store);
  let injectedNegative = false;
  store.outboxEnqueueWithOperationIdentity = async (...args) => {
    const stored = await enqueueWithIdentity(...args);
    if (!injectedNegative) {
      injectedNegative = true;
      negativeEnabled = true;
      await replacingClient.inspect();
    }
    return stored;
  };

  try {
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'peer negative precedes foreground range transport' },
        clientMutationId: 'cm-foreground-range-capability-lock',
        queue: true,
      }),
      (error) => error.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
    );
    assert.equal(rangePosts, 0, 'a peer negative prevents foreground identity-range transport');
    assert.equal(mutationPosts, 0, 'the superseded foreground issues no mutation POST');
    assert.deepEqual(await store.outboxRecords(), [], 'pre-dispatch supersession retires intent');
  } finally {
    await replacingClient.close();
    await client.close();
    await store.close();
  }
});

test('operation-range transport loss serializes a peer capability replacement through relinquishment', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://operation-range-capability-supersession.example';
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    operationIdentityProtocol: 1,
    __outboxDrainLifecycle: false,
  });
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let negativeEnabled = false;
  let announceRangeRequest;
  const rangeRequested = new Promise((resolve) => { announceRangeRequest = resolve; });
  let rejectRangeRequest;
  const rangeResponse = new Promise((_, reject) => { rejectRangeRequest = reject; });
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: !negativeEnabled,
        targetProfileId: negativeEnabled
          ? 'cloudflare-do-sqlite-v8'
          : 'local-dev-sqlite-ibex',
      }));
    }
    if (path === '/client-mutations/identity-range') {
      announceRangeRequest();
      return rangeResponse;
    }
    mutationPosts += 1;
    throw new Error(`unexpected mutation transport ${path}`);
  };

  try {
    const mutating = client.mutate('createThing', {
      args: { title: 'range request loses transport after target downgrade' },
      clientMutationId: 'cm-range-capability-supersession',
      userId: 'user-a',
    });
    await rangeRequested;
    negativeEnabled = true;
    const replacement = replacingClient.inspect();
    rejectRangeRequest(new TypeError('operation range request lost transport'));
    const outcome = await mutating.then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    assert.equal(outcome.error, null);
    assert.equal(outcome.value?.status, 'queued');
    assert.equal(mutationPosts, 0, 'the failed range path issues no mutation POST');
    await replacement;
    assert.equal(
      (await store.outboxRecords()).find(
        (record) => record.id === 'cm-range-capability-supersession',
      )?.status,
      'pending',
      'the peer negative commits only after range ownership safely relinquishes custody',
    );
  } finally {
    await replacingClient.close();
    await client.close();
    await store.close();
  }
});

test('durable negative capability leaves housekeeping online-only during an auth transition', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://auth-transition-housekeeping-capability.example';
  const observation = await store.beginOfflineMutationReplayCapabilityObservation();
  await store.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: false,
    reason: 'not-advertised',
    targetProfileId: 'cloudflare-do-sqlite-v8',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  }, observation);
  const transitionStatus = Object.freeze({
    state: 'authenticating',
    settled: false,
    subscribeSafe: false,
    ephemeralAuthorityUsable: false,
    transitionOwner: 'auth-coordinator',
    barrierPhase: 'commitDurable',
    authorityEpoch: 1,
    custodyRevision: 2,
    closed: false,
  });
  const authorityFence = {
    authority: null,
    registerParticipant: () => null,
    authorityTransitionStatus: () => transitionStatus,
    subscribeAuthorityTransition(listener) {
      listener(transitionStatus);
      return () => {};
    },
  };
  const client = new InspectingSnapbackClient(origin, {
    authCoordinator: authorityFence,
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') throw new TypeError('capability inspection lost transport');
    mutationPosts += 1;
    throw new Error(`authority barrier must not dispatch ${path}`);
  };

  try {
    const outcome = await client.mutate('refreshCache', {
      args: { route: '/inbox' },
      clientMutationId: 'hk-negative-capability-auth-barrier',
      housekeeping: { key: 'route-inbox', idempotent: true, successorValid: true },
    }).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    assert.equal(
      outcome.error?.code,
      'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
      'queue:auto degrades to online-only before the authority barrier refuses dispatch',
    );
    assert.equal(mutationPosts, 0, 'the refused housekeeping write issues no mutation POST');
    assert.deepEqual(
      await store.outboxRecords(),
      [],
      'the auth-transition special path cannot bypass capability admission',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

test('closing a client fences its late capability answer on an injected shared store', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://closed-client-shared-capability.example';
  const positive = {
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  };
  const initialObservation = await store.beginOfflineMutationReplayCapabilityObservation();
  await store.commitOfflineMutationReplayCapabilityFact(positive, initialObservation);
  const commitCapabilityFact = store.commitOfflineMutationReplayCapabilityFact.bind(store);
  let allowLateCommit;
  const lateCommitAllowed = new Promise((resolve) => { allowLateCommit = resolve; });
  let lateCommitStarted = false;
  store.commitOfflineMutationReplayCapabilityFact = async (...args) => {
    lateCommitStarted = true;
    await lateCommitAllowed;
    return commitCapabilityFact(...args);
  };
  let announceInspection;
  const inspectionStarted = new Promise((resolve) => { announceInspection = resolve; });
  let releaseInspection;
  const inspectionResponse = new Promise((resolve) => { releaseInspection = resolve; });
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/inspect');
    announceInspection();
    return inspectionResponse;
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let secondClient = null;

  try {
    const inspecting = client.inspect();
    await inspectionStarted;
    releaseInspection(Response.json(offlineReplayInspection({
      supported: false,
      targetProfileId: 'cloudflare-do-sqlite-v8',
    })));
    await client.close();
    const lateCommitStartedBeforeCloseResolved = lateCommitStarted;
    allowLateCommit();
    await inspecting;
    const retainedFact = await store.readOfflineMutationReplayCapabilityFact();
    assert.equal(
      lateCommitStartedBeforeCloseResolved,
      false,
      'close synchronously refuses the late client answer before shared commit',
    );
    assert.equal(retainedFact.supported, true, 'the shared store retains its pre-close fact');

    let mutationPosts = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).pathname !== '/inspect') mutationPosts += 1;
      throw new TypeError('successor client is offline');
    };
    secondClient = new InspectingSnapbackClient(origin, {
      rqsStore: store,
      __outboxDrainLifecycle: false,
    });
    secondClient.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
    const queued = await secondClient.mutate('createThing', {
      args: { title: 'successor observes pre-close positive' },
      clientMutationId: 'cm-successor-pre-close-capability',
    });
    assert.equal(queued.status, 'queued');
    assert.equal(mutationPosts, 0, 'cached successor enqueue performs no mutation POST');
  } finally {
    allowLateCommit();
    await secondClient?.close();
    await client.close();
    await store.close();
  }
});

test('successful queries retain a positive lifecycle probe instead of scheduling inspect again', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('https://positive-lifecycle-probe.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let inspectCalls = 0;
  let mutationPhase = false;
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/query/listThings') return Response.json({ rows: [], version: 1 });
    if (path === '/inspect') {
      inspectCalls += 1;
      if (mutationPhase) throw new TypeError('offline capability re-probe');
      if (inspectCalls === 1) {
        return Response.json(offlineReplayInspection({
          supported: true,
          targetProfileId: 'local-dev-sqlite-ibex',
        }));
      }
      return new Response('later proxy failure', { status: 502 });
    }
    mutationPosts += 1;
    throw new TypeError('offline mutation transport');
  };

  try {
    await client.query('listThings');
    await client.whenOfflineMutationReplayCapabilitySettled();
    await client.query('listThings');
    await client.whenOfflineMutationReplayCapabilitySettled();
    assert.equal(
      inspectCalls,
      1,
      'a settled positive lifecycle observation is reused across successful queries',
    );

    mutationPhase = true;
    const queued = await client.mutate('createThing', {
      args: { title: 'offline after repeated successful queries' },
      clientMutationId: 'cm-positive-lifecycle-probe-reuse',
    });
    assert.equal(queued.status, 'queued');
    assert.equal(mutationPosts, 0, 'the retained positive admits enqueue-only custody');
  } finally {
    await client.close();
    await store.close();
  }
});

test('a 502 lifecycle answer is in-flight deduplication only and a later read recovers positive support', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('http://127.0.0.1:4400', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let inspectCalls = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/query/listThings') return Response.json({ rows: [], version: inspectCalls + 1 });
    if (path === '/inspect') {
      inspectCalls += 1;
      if (inspectCalls === 1) return new Response('proxy unavailable', { status: 502 });
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    throw new Error(`unexpected lifecycle recovery request ${path}`);
  };

  await client.query('listThings');
  const unavailable = await client.whenOfflineMutationReplayCapabilitySettled();
  assert.equal(unavailable.supported, false);
  assert.equal(unavailable.reason, 'inspection-unavailable');
  assert.deepEqual(
    await store.readOfflineMutationReplayCapabilityFact(),
    {},
    'the answered 502 leaves the durable fact slot untouched',
  );
  assert.deepEqual((await client.outboxStatus()).offlineMutationReplayInspection, {
    status: 'unavailable',
    reason: 'answered-unavailable',
    code: 'SNAPBACK_HTTP_ERROR',
    httpStatus: 502,
  });

  await client.query('listThings');
  const recovered = await waitForOfflineReplayCapabilityFact(
    store,
    (fact) => fact.supported === true,
    'a later successful lifecycle capability recovery',
  );
  assert.equal(inspectCalls, 2, 'the settled negative promise is not retained as a cache');
  assert.equal(recovered.storeRevision, 1);
  await store.close();
});

test('automatic mode never reuses a positive fact from another canonical origin', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const firstOrigin = new InspectingSnapbackClient('http://127.0.0.1:4400', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: true,
    targetProfileId: 'local-dev-sqlite-ibex',
  }));
  await firstOrigin.inspect();

  const otherOrigin = new InspectingSnapbackClient('http://127.0.0.1:5500', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname.startsWith('/mutation/')) mutationPosts += 1;
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    () => otherOrigin.mutate('createThing', {
      args: { title: 'wrong-origin' },
      clientMutationId: 'cm-wrong-origin',
    }),
    (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
  );
  assert.equal(mutationPosts, 1, 'the mismatched origin falls back to one online-only POST');
  assert.deepEqual(await store.outboxRecords(), [], 'origin mismatch invalidates cached support');
  await store.close();
});

test('replay requires a fresh positive inspection; 404 is durable negative and 502 is unavailable', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });

  for (const status of [404, 502]) {
    const store = createDurableTestStore();
    await store.outboxEnqueue({
      id: `cm-answered-${status}`,
      function: 'createThing',
      args: { status },
    });
    const client = new InspectingSnapbackClient('http://127.0.0.1:4400', {
      rqsStore: store,
      __outboxDrainLifecycle: false,
    });

    globalThis.fetch = async () => Response.json(offlineReplayInspection({
      supported: true,
      targetProfileId: 'local-dev-sqlite-ibex',
    }));
    await client.inspect();

    let mutationCalls = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).pathname === '/inspect') {
        return new Response(`answered ${status}`, { status });
      }
      mutationCalls += 1;
      throw new Error(`HTTP ${status} inspect must refuse before replay transport`);
    };
    await assert.rejects(
      () => client.replayQueuedMutations(),
      (error) => error.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
    );
    assert.equal(mutationCalls, 0, `HTTP ${status} answer prevents mutation POST`);
    assert.equal((await store.outboxPending()).length, 1, 'refusal preserves pending custody');
    const retainedFact = await store.readOfflineMutationReplayCapabilityFact();
    assert.equal(
      retainedFact.supported,
      status === 404 ? false : true,
      status === 404
        ? 'HTTP 404 replaces the cached positive fact'
        : 'HTTP 502 preserves the cached positive fact',
    );
    if (status === 502) {
      assert.deepEqual((await client.outboxStatus()).offlineMutationReplayInspection, {
        status: 'unavailable',
        reason: 'answered-unavailable',
        code: 'SNAPBACK_HTTP_ERROR',
        httpStatus: 502,
      });
    }
    await store.close();
  }
});

test('replay never reuses cached settlement-ledger evidence after transport loss', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await store.outboxEnqueue({ id: 'cm-offline-replay', function: 'createThing', args: {} });
  const client = new InspectingSnapbackClient('http://127.0.0.1:4400', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: true,
    targetProfileId: 'local-dev-sqlite-ibex',
  }));
  await client.inspect();

  let mutationCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname !== '/inspect') mutationCalls += 1;
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    () => client.replayQueuedMutations(),
    (error) => error.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
  );
  assert.equal(mutationCalls, 0, 'transport-lost inspection never licenses replay POST');
  assert.equal((await store.outboxPending()).length, 1);
});

test('automatic mode stays online-only when cached support names a different app generation', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('http://127.0.0.1:4400', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: true,
    targetProfileId: 'local-dev-sqlite-ibex',
  }));
  await client.inspect();

  const successorGeneration = {
    ...TEST_ARTIFACT_GENERATION,
    schemaHash: `sha256:${'d'.repeat(64)}`,
  };
  const successorMutation = {
    artifactKind: 'functionReference',
    kind: 'Mutation',
    id: `${successorGeneration.appId}:createThing`,
    name: 'createThing',
    expectedGeneration: successorGeneration,
    argsContract: {
      fields: [{ name: 'title', required: true, value: { kind: 'string' } }],
    },
    argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
  };
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname.startsWith('/mutation/')) mutationPosts += 1;
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    () => client.mutate(successorMutation, { args: { title: 'wrong-generation' } }),
    (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
  );
  assert.equal(mutationPosts, 1, 'generation mismatch permits one online-only POST');
  assert.deepEqual(await store.outboxRecords(), [], 'identity mismatch invalidates cached support');
});

test('automatic string-named mutation stays online-only for a replaced same-origin app', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://cached-same-origin-app-replacement.example';
  const appA = { ...TEST_ARTIFACT_GENERATION, appId: 'cached-app-a' };
  const appB = { ...TEST_ARTIFACT_GENERATION, appId: 'cached-app-b' };
  await store.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId: 'same-origin-local-target',
    artifactGeneration: appA,
  });
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(appB.appId);
  let inspectCalls = 0;
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') inspectCalls += 1;
    else mutationPosts += 1;
    throw new TypeError('same-origin replacement is offline');
  };

  try {
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'belongs to app B' },
        clientMutationId: 'cm-cached-same-origin-app-replacement',
      }),
      (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
    );
    assert.equal(inspectCalls, 1, 'automatic admission still attempts a fresh capability probe');
    assert.equal(mutationPosts, 1, 'mismatched cached evidence permits one online-only POST');
    assert.deepEqual(
      await store.outboxRecords(),
      [],
      'no durable record is mislabeled with the cached predecessor app identity',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

test('automatic string-named mutation stays online-only with identity-free cached manifest support', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new InspectingSnapbackClient('https://direct-manifest.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  globalThis.fetch = async () => Response.json(offlineReplayCapabilityManifest({
    supported: true,
    targetProfileId: 'remote-service',
  }));
  await client.inspect();
  assert.equal(
    (await store.readOfflineMutationReplayCapabilityFact()).artifactGeneration,
    null,
    'a direct manifest carries no invented artifact generation',
  );

  let inspectCalls = 0;
  let mutationCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') inspectCalls += 1;
    else mutationCalls += 1;
    throw new TypeError('offline after direct manifest');
  };
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'origin-bound' },
      clientMutationId: 'cm-direct-manifest',
    }),
    (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
  );
  assert.equal(inspectCalls, 1, 'the automatic enqueue still performs its fresh re-probe');
  assert.equal(mutationCalls, 1, 'identity-free cached evidence permits one online-only POST');
  assert.deepEqual(
    (await store.outboxPending()).map((record) => record.id),
    [],
  );
});

test('fresh direct manifest cannot durably admit a string-named mutation across same-app redeploy', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://fresh-direct-manifest-generation.example';
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayCapabilityManifest({
        supported: true,
        targetProfileId: 'fresh-direct-manifest-profile',
      }));
    }
    mutationPosts += 1;
    throw new TypeError('same-app generation changed after direct-manifest admission');
  };

  try {
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'generation must be known before enqueue' },
        clientMutationId: 'cm-fresh-direct-manifest-generation',
        queue: true,
      }),
      (error) => (
        error.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED'
        && error.diagnostic?.details?.reason === 'artifact-generation-required'
      ),
    );
    assert.equal(mutationPosts, 0, 'generation-incomplete support sends no mutation POST');
    assert.deepEqual(await store.outboxRecords(), [], 'generation-incomplete support stores no intent');
  } finally {
    await client.close();
    await store.close();
  }
});

test('closeAuth releases an owned default store for the next sequential client', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-client-handoff-'));
  const previousDir = process.env.SNAPBACK_CLIENT_RQS_DIR;
  const previousSwitch = process.env.SNAPBACK_CLIENT_RQS_STORE;
  try {
    process.env.SNAPBACK_CLIENT_RQS_DIR = directory;
    delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    const first = new SnapbackClient('http://127.0.0.1:4400');
    await first.rqsStore.whenLockSettled();
    assert.equal(first.rqsStore.isWriter(), true);
    await first.closeAuth();

    const second = new SnapbackClient('http://127.0.0.1:4400');
    await second.rqsStore.whenLockSettled();
    assert.equal(second.rqsStore.isWriter(), true, 'the successor acquires the released writer role');
    const record = await second.rqsStore.outboxEnqueue({ id: 'cm-successor', function: 'createThing' });
    assert.equal(record.id, 'cm-successor', 'the successor persists instead of silently reading');
    await second.closeAuth();

    let injectedClosed = 0;
    const injected = createMemoryRqsResumeStore();
    const injectedClose = injected.close.bind(injected);
    injected.close = async () => { injectedClosed += 1; await injectedClose(); };
    const callerOwned = new SnapbackClient('http://127.0.0.1:4400', { rqsStore: injected });
    await callerOwned.closeAuth();
    assert.equal(injectedClosed, 0, 'client cleanup never closes an injected store');
    await injected.close();
  } finally {
    if (previousDir === undefined) delete process.env.SNAPBACK_CLIENT_RQS_DIR;
    else process.env.SNAPBACK_CLIENT_RQS_DIR = previousDir;
    if (previousSwitch === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    else process.env.SNAPBACK_CLIENT_RQS_STORE = previousSwitch;
  }
});

test('fresh automatic queue reuses one pre-POST identity after an applied response is lost', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://applied-response-lost.example';
  const targetProfileId = 'applied-response-lost-profile';
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  const settledIds = new Set();
  const mutationBodies = [];
  let effectCount = 0;
  let loseFirstResponse = true;
  globalThis.fetch = async (url, init = {}) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({ supported: true, targetProfileId }));
    }
    const body = JSON.parse(init.body);
    mutationBodies.push(body);
    if (
      typeof body.clientMutationId !== 'string'
      || !settledIds.has(body.clientMutationId)
    ) {
      effectCount += 1;
      if (typeof body.clientMutationId === 'string') settledIds.add(body.clientMutationId);
    }
    if (loseFirstResponse) {
      loseFirstResponse = false;
      throw new TypeError('mutation applied but response lost');
    }
    return Response.json({ result: { effectCount }, version: 1 });
  };

  try {
    const queued = await client.mutate('createThing', {
      args: { title: 'exactly once across response loss' },
    });
    assert.equal(queued.status, 'queued');
    assert.equal(
      mutationBodies[0].clientMutationId,
      queued.clientMutationId,
      'the applied foreground POST and durable fallback share one pre-transport identity',
    );
    const replay = await client.replayQueuedMutations();
    assert.equal(replay.replayed, 1);
    assert.deepEqual(
      mutationBodies.map((body) => body.clientMutationId),
      [queued.clientMutationId, queued.clientMutationId],
      'replay presents the exact identity the applied POST carried',
    );
    assert.equal(effectCount, 1, 'the server observes one logical effect across lost response replay');
  } finally {
    await client.close();
    await store.close();
  }
});

test('capability supersession preserves a pre-existing ambiguous idempotent identity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://ambiguous-idempotent-supersession.example';
  const targetProfileId = 'ambiguous-idempotent-supersession-profile';
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const replacingClient = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  replacingClient.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  const clientMutationId = 'cm-ambiguous-idempotent-supersession';
  let mutationPosts = 0;
  let inspectionSupported = true;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: inspectionSupported,
        targetProfileId,
      }));
    }
    if (path === '/mutation/createThing') {
      mutationPosts += 1;
      throw new TypeError('mutation may have committed before response loss');
    }
    throw new Error(`unexpected idempotent supersession request ${path}`);
  };

  try {
    const queued = await client.mutate('createThing', {
      args: { title: 'one durable settlement identity' },
      clientMutationId,
      queue: 'auto',
    });
    assert.equal(queued.status, 'queued');
    assert.equal(mutationPosts, 1);
    const beforeRetry = structuredClone(await store.outboxPending());
    assert.deepEqual(beforeRetry.map((record) => record.id), [clientMutationId]);

    const outboxEnqueue = store.outboxEnqueue.bind(store);
    let replacementInspection = null;
    store.outboxEnqueue = async (record, ...args) => {
      const stored = await outboxEnqueue(record, ...args);
      if (record.id === clientMutationId) {
        inspectionSupported = false;
        replacementInspection = replacingClient.inspect();
        await replacementInspection;
      }
      return stored;
    };
    await assert.rejects(
      () => client.mutate('createThing', {
        args: { title: 'one durable settlement identity' },
        clientMutationId,
        queue: 'auto',
      }),
      (error) => (
        error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED'
        && error?.diagnostic?.details?.reason === 'inspection-superseded'
      ),
    );
    await replacementInspection;
    assert.equal(mutationPosts, 1, 'the refused idempotent retry sends no second POST');
    assert.deepEqual(
      await store.outboxPending(),
      beforeRetry,
      'supersession preserves the pre-existing possibly committed settlement identity',
    );
  } finally {
    await replacingClient.close();
    await client.close();
    await store.close();
  }
});

test('mutate queues on connectivity failure and replays exactly-once', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const targetProfileId = 'mutate-replay-exactly-once-profile';
  const devDiagnosticsEvents = [];
  const client = new SnapbackClient('http://127.0.0.1:9', {
    rqsStore: store,
    __offlineMutationReplayCapability: null,
    devDiagnosticsChannel: {
      emit(event) { devDiagnosticsEvents.push(event); },
    },
  });

  // Offline: fetch refuses at the transport (TypeError, like undici).
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({ supported: true, targetProfileId }));
    }
    throw new TypeError('fetch failed');
  };
  const queued = await client.mutate('createThing', { args: { title: 'offline' } });
  assert.equal(queued.status, 'queued');
  assert.equal('queued' in queued, false, 'the elapsed compatibility alias is absent');
  assert.equal(queued.presentation, 'withheld');
  assert.match(queued.clientMutationId, /^mut_[0-9a-hjkmnp-tv-z]{26}$/u);
  assert.equal(queued.sequence, 1);
  const queuedUpdate = await client.mutate('updateThing', { args: { title: 'later' } });
  assert.equal(queuedUpdate.sequence, 2);
  assert.equal((await store.outboxPending()).length, 2);
  assert.deepEqual(devDiagnosticsEvents, [
    {
      code: 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
      mutation: 'createThing',
      clientMutationId: queued.clientMutationId,
      sequence: 1,
      queueReasonClass: 'connectivity',
      drainMode: 'none',
      firstInSession: true,
    },
    {
      code: 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
      mutation: 'updateThing',
      clientMutationId: queuedUpdate.clientMutationId,
      sequence: 2,
      queueReasonClass: 'connectivity',
      drainMode: 'none',
      firstInSession: false,
    },
  ], 'the injected stub receives every relinquishment transition');
  assert(devDiagnosticsEvents.every(Object.isFrozen));

  // A server refusal is NOT queued: it throws with its diagnostic.
  globalThis.fetch = async (url) => (
    new URL(url).pathname === '/inspect'
      ? Response.json(offlineReplayInspection({ supported: true, targetProfileId }))
      : Response.json(
          { diagnostic: { code: 'SNAPBACK_VALIDATION', message: 'bad args' } },
          { status: 400 },
        )
  );
  await assert.rejects(
    () => client.mutate('createThing', { args: { bad: true } }),
    /SNAPBACK_VALIDATION/,
  );
  assert.equal((await store.outboxPending()).length, 2, 'refusal did not enqueue');

  // Reconnect: replay drains in sequence order under the SAME minted ids.
  const delivered = [];
  globalThis.fetch = async (url, init) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({ supported: true, targetProfileId }));
    }
    const body = JSON.parse(init.body);
    delivered.push(body);
    return Response.json({
      result: { ok: true },
      version: 7,
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    });
  };
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 2, failed: 0, remaining: 0 },
  );
  assert.deepEqual(
    delivered.map((body) => body.clientMutationId),
    [queued.clientMutationId, queuedUpdate.clientMutationId],
    'replay is ordered by sequence and keeps the minted durable identity',
  );
  // Settlements survive the crash-before-publication cut and do not become
  // ACK-eligible until the application explicitly consumes the recovery API.
  assert.deepEqual(await store.outboxPendingAcknowledgements(null, 64), []);
  const recovered = await client.settledMutations();
  assert.deepEqual(
    recovered.map((entry) => entry.clientMutationId).sort(),
    [queued.clientMutationId, queuedUpdate.clientMutationId].sort(),
  );
  await client.markMutationSettlementsConsumed(
    recovered.map((entry) => entry.clientMutationId),
  );
  // Consumed ids became ACK obligations; the next mutation piggybacks them.
  const acknowledgementTarget = (await store.outboxRecords())
    .find((record) => record.id === queued.clientMutationId).enqueueTarget;
  const acks = await store.outboxPendingAcknowledgements(
    null,
    64,
    TEST_AUTHORITY_DESCRIPTOR,
    acknowledgementTarget,
  );
  assert.deepEqual(
    [...acks].sort(),
    [queued.clientMutationId, queuedUpdate.clientMutationId].sort(),
  );
  delivered.length = 0;
  await client.mutate('createThing', {
    args: { title: 'online' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  assert.deepEqual(
    [...(delivered[0].acknowledgedClientMutationIds ?? [])].sort(),
    [...acks].sort(),
    'next mutation carries the exactly-once ledger GC piggyback',
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      null, 64, TEST_AUTHORITY_DESCRIPTOR, acknowledgementTarget,
    ),
    [],
    'a successful response confirms the sent acknowledgements',
  );
});

test('checked sidecar adoption cannot bypass persisted target without target adoption', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const clientStoreId = (await store.readStoreMeta()).clientStoreId;
  await store.outboxEnqueue({
    id: 'cm-sidecar-adoption',
    function: 'createThing',
    ...currentOutboxTarget({
      origin: 'http://127.0.0.1:41001',
      targetProfileId: 'local-dev-sqlite-ibex',
      generation: TEST_ARTIFACT_GENERATION,
      generated: true,
    }),
    args: { title: 'pending across origin' },
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
  });
  const delivered = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/inspect')) {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
        generation: TEST_ARTIFACT_GENERATION,
      }));
    }
    const body = JSON.parse(init.body);
    delivered.push({ url: String(url), body });
    return Response.json({ result: { ok: true }, version: 7 });
  };
  const candidate = new InspectingSnapbackClient('http://127.0.0.1:41002', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const receipt = await candidate.adoptQueuedMutations({
    expectedClientStoreId: clientStoreId,
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
  });
  assert.equal(receipt.schemaVersion, 'snapback.outbox-adoption.v1');
  assert.equal(receipt.clientStoreId, clientStoreId);
  assert.equal(receipt.writer, true);
  assert.equal(receipt.pendingBefore, 0);
  assert.equal(receipt.replayed, 0, JSON.stringify({
    receipt,
    stop: candidate.__outboxLastReplayStop,
    diagnostics: candidate.outboxDiagnostics,
  }));
  assert.equal(receipt.remaining, 1);
  assert.deepEqual(receipt.outcome, {
    status: 'paused',
    reason: 'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
    retained: 1,
  });
  assert.deepEqual(
    receipt.before,
    { pending: 0, failed: 0, stranded: 0, quarantined: 0, resultGone: 0 },
  );
  assert.deepEqual(
    receipt.after,
    { pending: 0, failed: 0, stranded: 0, quarantined: 0, resultGone: 0 },
  );
  assert.deepEqual(delivered, [], 'target adoption is not inferred from sidecar admission');
  assert.equal(
    candidate.outboxDiagnostics.some(
      (diagnostic) => diagnostic.code === 'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
    ),
    true,
  );
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.before), true);
});

test('checked sidecar adoption names a retained legacy targetless pause', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const clientStoreId = (await store.readStoreMeta()).clientStoreId;
  const clientMutationId = 'cm-sidecar-adoption-legacy-targetless';
  await store.outboxEnqueue({
    id: clientMutationId,
    function: 'createThing',
    args: { title: 'queued before target schema v2' },
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
  });
  const before = structuredClone((await store.outboxRecords())[0]);
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    mutationPosts += 1;
    return Response.json({ result: { wronglyReplayed: true }, version: 1 });
  };
  const candidate = new InspectingSnapbackClient('http://127.0.0.1:41002', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const receipt = await candidate.adoptQueuedMutations({
      expectedClientStoreId: clientStoreId,
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
    });
    assert.deepEqual(receipt.outcome, {
      status: 'paused',
      reason: 'SNAPBACK_OUTBOX_REPLAY_TARGET_MISSING',
      retained: 1,
    });
    assert.equal(mutationPosts, 0, 'legacy targetless adoption sends zero mutation POSTs');
    assert.deepEqual(
      (await store.outboxRecords())[0],
      before,
      'the upgrade-while-offline intent remains byte-identical for the adoption protocol',
    );
  } finally {
    await candidate.close();
    await store.close();
  }
});

test('sidecar adoption target mismatch precedes authority-instance custody reconciliation', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const clientStoreId = (await store.readStoreMeta()).clientStoreId;
  const coordinator = createSuccessorCoordinator();
  const originA = 'http://127.0.0.1:41101';
  const originB = 'http://127.0.0.1:41102';
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') {
      const handshake = sessionHandshake(
        TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
        TEST_SESSION_USER_ID,
      );
      return Response.json({
        ...handshake,
        deploymentIdentity: {
          ...handshake.deploymentIdentity,
          appId: TEST_ARTIFACT_GENERATION.appId,
        },
      });
    }
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    mutationPosts += 1;
    return Response.json({ result: { wrongTarget: true }, version: mutationPosts });
  };
  const candidate = new InspectingSnapbackClient(originB, {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const capture = await settleSuccessorCoordinator(coordinator);
    await candidate.authSession();
    await store.outboxEnqueue({
      id: 'cm-session-fenced-sidecar-target-a',
      function: 'createThing',
      ...currentOutboxTarget({
        origin: originA,
        targetProfileId: 'local-dev-sqlite-ibex',
        generated: true,
      }),
      args: { title: 'pending across authenticated sidecar targets' },
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
      principalScope: {
        authMode: 'sessions',
        authorizationStreamIncarnation: '018f0d90-7b26-7a22-8c33-445566778899',
        userId: TEST_SESSION_USER_ID,
      },
      custody: {
        authorityEpoch: capture.authorityEpoch,
        authorityKey: capture.authorityKey,
      },
    });
    const before = structuredClone((await store.outboxRecords())[0]);
    const receipt = await candidate.adoptQueuedMutations({
      expectedClientStoreId: clientStoreId,
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
    });
    assert.equal(receipt.replayed, 0);
    assert.equal(receipt.remaining, 1);
    assert.deepEqual(receipt.outcome, {
      status: 'paused',
      reason: 'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
      retained: 1,
    });
    assert.equal(mutationPosts, 0, 'adoption sends zero POSTs for the target-A record');
    const status = await candidate.outboxStatus();
    assert.equal(status.pending, 0, 'outboxStatus does not project the target-A record');
    assert.deepEqual(
      (await store.outboxRecords())[0],
      before,
      'adoption and outboxStatus leave the target-A record byte-identical and pending',
    );
    assert.equal(
      candidate.outboxDiagnostics.some(
        (diagnostic) => diagnostic.code === 'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
      ),
      true,
    );
  } finally {
    await candidate.close();
    await coordinator.close();
    await store.close();
  }
});

test('sidecar adoption refuses freshness, store, writer, and artifact divergence before replay', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = mkdtempSync(join(tmpdir(), 'snapback-outbox-adoption-writer-'));
  const firstStore = createFileRqsResumeStore({
    directory,
    identity: 'sidecar-adoption-writer',
    clientStoreId: 'sidecar-adoption-writer-store',
  });
  await firstStore.whenLockSettled();
  await firstStore.outboxEnqueue({
    id: 'cm-sidecar-writer-fence',
    function: 'createThing',
    args: {},
    expectedGeneration: TEST_ARTIFACT_GENERATION,
  });
  const secondStore = createFileRqsResumeStore({
    directory,
    identity: 'sidecar-adoption-writer',
  });
  t.after(async () => {
    await secondStore.close();
    await firstStore.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await secondStore.whenLockSettled();
  assert.equal(secondStore.isWriter(), false);
  const nonWriter = new SnapbackClient('http://127.0.0.1:41003', {
    rqsStore: secondStore,
    offlineQueue: true,
  });
  await assert.rejects(
    () => nonWriter.adoptQueuedMutations({
      expectedClientStoreId: 'sidecar-adoption-writer-store',
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_ADOPTION_NOT_WRITER',
  );
  const fencedReplay = await nonWriter.replayQueuedMutations();
  assert.deepEqual(
    { remaining: fencedReplay.remaining, stopped: fencedReplay.stopped },
    { remaining: 1, stopped: true },
    'a non-writer reports the authoritative visible queue instead of zero',
  );

  const writerClient = new SnapbackClient('http://127.0.0.1:41004', {
    rqsStore: firstStore,
    offlineQueue: true,
  });
  let unexpectedDispatches = 0;
  globalThis.fetch = async () => {
    unexpectedDispatches += 1;
    throw new Error('adoption prerequisite refusal must precede network dispatch');
  };
  await assert.rejects(
    () => writerClient.adoptQueuedMutations({
      expectedClientStoreId: 'sidecar-adoption-writer-store',
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      afterFreshSnapshot: async () => ({
        ...TEST_FRESH_SNAPSHOT_BARRIER,
        kind: 'incremental',
      }),
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_ADOPTION_FRESH_SNAPSHOT_REQUIRED',
  );
  await assert.rejects(
    () => writerClient.adoptQueuedMutations({
      expectedClientStoreId: 'different-sidecar-store',
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_ADOPTION_STORE_ID_MISMATCH',
  );
  assert.equal(unexpectedDispatches, 0);
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/inspect$/u, 'artifact mismatch refuses before mutation dispatch');
    return Response.json(adoptionInspection({
      ...TEST_ARTIFACT_GENERATION,
      bundleHash: `sha256:${'d'.repeat(64)}`,
    }));
  };
  await assert.rejects(
    () => writerClient.adoptQueuedMutations({
      expectedClientStoreId: 'sidecar-adoption-writer-store',
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_ADOPTION_INCOMPATIBLE_SUCCESSOR',
  );
  assert.equal((await firstStore.outboxPending()).length, 1);
});

test('sidecar adoption keeps identity-divergent intent pending for rollback', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const clientStoreId = (await store.readStoreMeta()).clientStoreId;
  await store.outboxEnqueue({
    id: 'cm-sidecar-identity-divergence',
    function: 'createThing',
    ...currentOutboxTarget({
      origin: 'http://127.0.0.1:41005',
      targetProfileId: null,
      generated: true,
    }),
    args: { title: 'different identity' },
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/inspect')) return Response.json(adoptionInspection());
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_CLIENT_MUTATION_ID_REUSED',
        message: 'client mutation identity diverged',
      },
    }, { status: 409 });
  };
  const candidate = new SnapbackClient('http://127.0.0.1:41005', {
    rqsStore: store,
    offlineQueue: true,
  });
  const receipt = await candidate.adoptQueuedMutations({
    expectedClientStoreId: clientStoreId,
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
  });
  assert.deepEqual(
    {
      replayed: receipt.replayed,
      failedDelta: receipt.failedDelta,
      remaining: receipt.remaining,
      outcome: receipt.outcome,
    },
    {
      replayed: 0,
      failedDelta: 0,
      remaining: 1,
      outcome: {
        status: 'paused',
        reason: 'SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH',
        retained: 1,
      },
    },
  );
  const [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'pending');
  assert.equal(retained.id, 'cm-sidecar-identity-divergence');
});

test('cached enqueue defers operation identity range transport until fresh-gated replay', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://cached-operation-range.example';
  await store.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId: 'local-dev-sqlite-ibex',
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  });
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    operationIdentityProtocol: 1,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  let rangePosts = 0;
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') throw new TypeError('offline capability re-probe');
    if (path === '/client-mutations/identity-range') rangePosts += 1;
    else mutationPosts += 1;
    throw new TypeError(`offline ${path}`);
  };

  const queued = await client.mutate('createThing', {
    args: { title: 'cached identity evidence is enqueue-only' },
    userId: 'user-a',
    clientMutationId: 'cm-cached-operation-range',
  });
  assert.equal(queued.status, 'queued');
  assert.equal(rangePosts, 0, 'cached evidence licenses no identity-range POST');
  assert.equal(mutationPosts, 0, 'cached evidence licenses no mutation POST');
  const [uncovered] = await store.outboxPending();
  assert.equal(uncovered.operationIssuance, null);
  assert.equal(
    uncovered.operationCoverageDisposition,
    'uncovered-range-exhausted',
    'the cached path retains an explicitly uncovered pending record',
  );

  const issuedAtMs = Date.now();
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
      }));
    }
    if (path === '/client-mutations/identity-range') {
      rangePosts += 1;
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'audience-cached-replay',
          authorityInstanceId: 'authority-cached-replay',
          epochId: 'epoch-cached-replay',
          epochSequence: 0,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${'b'.repeat(64)}`,
        },
      });
    }
    mutationPosts += 1;
    return Response.json({ result: { ok: true }, version: 1 });
  };

  const replay = await client.replayQueuedMutations();
  assert.equal(replay.replayed, 1);
  assert.equal(rangePosts, 1, 'fresh-gated replay acquires exactly one identity range');
  assert.equal(mutationPosts, 1, 'fresh-gated replay sends the mutation exactly once');
  assert.equal((await store.outboxRecords())[0].status, 'settled');
  await client.close();
  await store.close();
});

test('opt-in client range transport allocates before first mutation and reuses one retry carrier', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'https://operation-range.example');
  const clientAudienceId = (await store.readStoreMeta()).clientStoreId;
  const requests = [];
  const issuedAtMs = Date.now();
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    if (String(url).endsWith('/client-mutations/identity-range')) {
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'dev-user-a',
          authorityInstanceId: 'dev-user-a',
          epochId: 'epoch-client-a',
          epochSequence: 0,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${'c'.repeat(64)}`,
        },
      });
    }
    return Response.json({ result: { ok: true }, version: 1 });
  };
  const client = new SnapbackClient('https://operation-range.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const result = await client.mutate('createThing', {
    args: { title: 'covered' },
    userId: 'user-a',
  });
  assert.deepEqual(result.result, { ok: true });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/client-mutations\/identity-range$/);
  assert.equal(requests[0].body.clientAudienceId, clientAudienceId);
  assert.match(requests[1].url, /\/mutation\/createThing$/);
  assert.match(requests[1].body.clientMutationId, /^mut_/u);
  assert.deepEqual(requests[1].body.operationIssuance, {
    kind: 'clientRange',
    epoch_id: 'epoch-client-a',
    counter: 0,
    range_start: 0,
    range_end_exclusive: 256,
    authority_authenticator_digest: `sha256:${'c'.repeat(64)}`,
  });
  const retained = await store.outboxRecords();
  assert.equal(retained[0].operationIssuance.counter, 0);
  assert.equal(retained[0].status, 'settled');
});

test('equivalent enqueue integration keeps generated function ids from distinct apps separate', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ result: { ok: true }, version: 1 });
  const store = createDurableTestStore();
  const client = new SnapbackClient('https://runtime-enqueue-function-id.test', {
    rqsStore: store,
    __runtimeCostDiagnosticsOptions: {
      enabled: true,
      equivalentEnqueueWarningThreshold: 2,
    },
  });
  const reference = (appId) => Object.freeze({
    artifactKind: 'functionReference',
    schemaVersion: 'snapback.v0',
    appId,
    id: `${appId}:sharedWrite`,
    name: 'sharedWrite',
    kind: 'Mutation',
    argsContract: Object.freeze({ fields: Object.freeze([]) }),
  });
  const appA = reference('runtime-app-a');
  const appB = reference('runtime-app-b');

  await client.mutate(appA, { args: {}, clientMutationId: 'cm-runtime-app-a-1', queue: true });
  await client.mutate(appA, { args: {}, clientMutationId: 'cm-runtime-app-a-2', queue: true });
  await client.mutate(appB, { args: {}, clientMutationId: 'cm-runtime-app-b-1', queue: true });

  const durable = await store.outboxRecords();
  assert.deepEqual(durable.map(({ function: name }) => name), [
    'sharedWrite',
    'sharedWrite',
    'sharedWrite',
  ]);
  const facts = client.localResourceInspection().runtimeCostDiagnostics.equivalentEnqueues.facts;
  assert.deepEqual(facts.map((fact) => ({
    functionId: fact.functionId,
    enqueueCount: fact.enqueueCount,
    equivalentEnqueueCount: fact.equivalentEnqueueCount,
  })), [
    { functionId: 'runtime-app-a:sharedWrite', enqueueCount: 2, equivalentEnqueueCount: 1 },
    { functionId: 'runtime-app-b:sharedWrite', enqueueCount: 1, equivalentEnqueueCount: 0 },
  ]);
});

test('foreground range preparation defers while an authorization root remains active', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'https://operation-foreground-fence.example');
  const issuedAtMs = Date.now();
  let announceRangeRequest;
  const rangeRequested = new Promise((resolve) => { announceRangeRequest = resolve; });
  let releaseRange;
  const rangeResponse = new Promise((resolve) => { releaseRange = resolve; });
  let mutationAttempts = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/client-mutations/identity-range')) {
      announceRangeRequest();
      return rangeResponse;
    }
    mutationAttempts += 1;
    return Response.json({ result: { ok: true }, version: 1 });
  };
  const client = new SnapbackClient('https://operation-foreground-fence.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const mutating = client.mutate('createThing', {
    args: { title: 'foreground fenced during range refresh' },
    userId: 'user-a',
    queue: true,
  });
  await rangeRequested;
  const rootApplication = applyQueueRoot(store, testQueueObligation);
  releaseRange(Response.json({
    schemaVersion: 1,
    range: {
      schemaVersion: 1,
      audience: 'audience-foreground-fence',
      authorityInstanceId: 'authority-foreground-fence',
      epochId: 'epoch-foreground-fence',
      epochSequence: 0,
      rangeStart: 0,
      rangeEndExclusive: 256,
      issuedAtMs,
      expiresAtMs: issuedAtMs + 60_000,
      authorityAuthenticatorDigest: `sha256:${'e'.repeat(64)}`,
    },
  }));
  await rootApplication;
  const deferred = await mutating;
  assert.equal(deferred.status, 'queued');
  assert.equal(deferred.authorizationDisposition, 'authorization-suspended');
  assert.equal(mutationAttempts, 0, 'foreground transport cannot cross an active root');
  const [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'pending');
  assert.equal(retained.operationIssuance, null);
  await resolveQueueRoot(store, testQueueResolution);
});

test('operation-identity enqueue under delete is redacted without range transport', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'https://operation-delete-root.example');
  await applyQueueRoot(store, {
    ...testQueueObligation,
    maxDisposition: 'delete',
  });
  let transportAttempts = 0;
  globalThis.fetch = async () => {
    transportAttempts += 1;
    throw new Error('delete-root enqueue must not reach transport');
  };
  const client = new SnapbackClient('https://operation-delete-root.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { secret: 'must-be-redacted' },
      userId: 'user-a',
      queue: true,
    }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_OUTBOX_AUTHORIZATION_DELETE_TOMBSTONE');
      assert.deepEqual(error.mutationDisposition, {
        status: 'stranded',
        disposition: 'delete',
        discardOnly: true,
        replayable: false,
      });
      return true;
    },
  );
  assert.equal(transportAttempts, 0);
  const [redacted] = await store.outboxRecords();
  assert.equal(redacted.status, 'stranded');
  assert.equal(redacted.disposition, 'delete');
  assert.equal(redacted.discardOnly, true);
  assert.equal(Object.hasOwn(redacted, 'args'), false);
  assert.equal(Object.hasOwn(redacted, 'operationIssuance'), false);
});

test('uncovered offline intent obtains and durably assigns a range before reconnect admission', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'https://operation-reconnect.example');
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const client = new SnapbackClient('https://operation-reconnect.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const queued = await client.mutate('createThing', {
    args: { title: 'offline-before-range' },
    userId: 'user-a',
  });
  assert.equal(queued.operationCoverageDisposition, 'uncovered-range-exhausted');
  assert.equal((await store.outboxPending())[0].operationIssuance, null);

  const requests = [];
  const issuedAtMs = Date.now();
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    if (String(url).endsWith('/client-mutations/identity-range')) {
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'audience-reconnect',
          authorityInstanceId: 'authority-reconnect',
          epochId: 'epoch-reconnect',
          epochSequence: 0,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${'d'.repeat(64)}`,
        },
      });
    }
    assert(body.operationIssuance, 'mutation transport must never see an uncovered replay');
    return Response.json({ result: { ok: true }, version: 1 });
  };
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: replay.replayed, failed: replay.failed, remaining: replay.remaining },
    { replayed: 1, failed: 0, remaining: 0 },
    JSON.stringify({ replay, records: await store.outboxRecords() }),
  );
  assert.equal(
    requests.filter(({ url }) => url.endsWith('/mutation/createThing')).length,
    1,
  );
  assert.equal(requests[1].body.operationIssuance.epoch_id, 'epoch-reconnect');
});

test('replay range preparation pauses while an authorization root remains active', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'https://operation-range-fence.example');
  await store.outboxEnqueue({
    id: 'cm-delayed-range-replay',
    function: 'createThing',
    ...currentOutboxTarget({
      origin: 'https://operation-range-fence.example',
    }),
    args: { title: 'fenced during range refresh' },
    userId: 'user-a',
  });
  const issuedAtMs = Date.now();
  let announceRangeRequest;
  const rangeRequested = new Promise((resolve) => { announceRangeRequest = resolve; });
  let releaseRange;
  const rangeResponse = new Promise((resolve) => { releaseRange = resolve; });
  let mutationAttempts = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/client-mutations/identity-range')) {
      announceRangeRequest();
      return rangeResponse;
    }
    mutationAttempts += 1;
    return Response.json({ result: { ok: true }, version: 1 });
  };
  const client = new SnapbackClient('https://operation-range-fence.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const replaying = client.replayQueuedMutations();
  await rangeRequested;
  const rootApplication = applyQueueRoot(store, testQueueObligation);
  releaseRange(Response.json({
    schemaVersion: 1,
    range: {
      schemaVersion: 1,
      audience: 'audience-delayed-range',
      authorityInstanceId: 'authority-delayed-range',
      epochId: 'epoch-delayed-range',
      epochSequence: 0,
      rangeStart: 0,
      rangeEndExclusive: 256,
      issuedAtMs,
      expiresAtMs: issuedAtMs + 60_000,
      authorityAuthenticatorDigest: `sha256:${'f'.repeat(64)}`,
    },
  }));
  await rootApplication;
  const replay = await replaying;
  assert.equal(replay.stopped, true);
  assert.equal(replay.replayed, 0);
  assert.equal(mutationAttempts, 0, 'replay transport cannot cross an active root');
  const [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'pending');
  assert.equal(retained.operationIssuance, null);
  await resolveQueueRoot(store, testQueueResolution);
});

test('server epoch-capacity refusal keeps uncovered intent queued for fresh authority', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'https://operation-capacity.example');
  const devDiagnosticsEvents = [];
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/client-mutations\/identity-range$/u);
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_OPERATION_RANGE_EXHAUSTED',
        message: 'client identity epoch reached its finite v1 counter capacity',
      },
    }, { status: 409 });
  };
  const client = new SnapbackClient('https://operation-capacity.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
    devDiagnosticsChannel: {
      emit(event) { devDiagnosticsEvents.push(event); },
    },
  });
  const queued = await client.mutate('createThing', {
    args: { title: 'wait-for-fresh-epoch' },
    userId: 'user-a',
  });
  assert.equal(queued.status, 'queued');
  assert.equal('queued' in queued, false, 'the no-attempt branch also omits the alias');
  assert.equal(queued.operationCoverageDisposition, 'uncovered-range-exhausted');
  assert.deepEqual(devDiagnosticsEvents, [{
    code: 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
    mutation: 'createThing',
    clientMutationId: queued.clientMutationId,
    sequence: queued.sequence,
    queueReasonClass: 'no-attempt-policy',
    drainMode: 'none',
    firstInSession: true,
  }], 'the no-attempt relinquishment site emits the same canonical event');
  let [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'pending');
  assert.equal(retained.operationIssuance, null);

  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { failed: replay.failed, remaining: replay.remaining, stopped: replay.stopped },
    { failed: 0, remaining: 1, stopped: true },
  );
  [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'pending');
  assert.equal(retained.operationIssuance, null);
});

test('fresh same-principal authority atomically covers capacity-stranded intent', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'https://operation-successor.example');
  const descriptorA = TEST_AUTHORITY_DESCRIPTOR;
  const descriptorB = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b24-7a22-8c33-4455667788bb',
    sessionGeneration: 2,
  };
  let currentDescriptor = descriptorA;
  let currentPrincipalId = TEST_SESSION_USER_ID;
  const issuedAtMs = Date.now();
  const mutationBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/session')) {
      return Response.json(sessionHandshake(currentDescriptor, currentPrincipalId));
    }
    const body = JSON.parse(init.body);
    if (target.endsWith('/client-mutations/identity-range')) {
      assert.deepEqual(body.authorityDescriptor, currentDescriptor);
      if (currentDescriptor.authorityInstanceId === descriptorA.authorityInstanceId) {
        return Response.json({
          diagnostic: {
            code: 'SNAPBACK_OPERATION_RANGE_EXHAUSTED',
            message: 'predecessor epoch reached its finite v1 counter capacity',
          },
        }, { status: 409 });
      }
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'audience-successor',
          authorityInstanceId: descriptorB.authorityInstanceId,
          epochId: 'epoch-successor',
          epochSequence: 2,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${'e'.repeat(64)}`,
        },
      });
    }
    mutationBodies.push(body);
    return Response.json({
      result: { ok: true },
      version: 2,
      authorityDescriptor: descriptorB,
    });
  };
  const client = new SnapbackClient('https://operation-successor.example', {
    bearerToken: 'sbs_predecessor_authority',
    authClientProtocol: 1,
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const queued = await client.mutate('createThing', {
    args: { title: 'same principal, fresh authority' },
    authorityDescriptor: descriptorA,
  });
  assert.equal(queued.status, 'queued');
  let [retained] = await store.outboxRecords();
  assert.equal(retained.operationIssuance, null);
  assert.equal(retained.operationAuthorityPrincipalId, TEST_SESSION_USER_ID);

  currentDescriptor = descriptorB;
  currentPrincipalId = '018f0d90-7b25-7a22-8c33-4455667788cc';
  client.clearAuthSession();
  const crossPrincipal = await client.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: crossPrincipal.replayed,
      failed: crossPrincipal.failed,
      remaining: crossPrincipal.remaining,
      stopped: crossPrincipal.stopped,
    },
    { replayed: 0, failed: 0, remaining: 1, stopped: true },
  );
  [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'pending');
  assert.equal(retained.operationIssuance, null);
  assert.deepEqual(retained.authorityDescriptor, descriptorA);

  currentPrincipalId = TEST_SESSION_USER_ID;
  client.clearAuthSession();
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: replay.replayed, failed: replay.failed, remaining: replay.remaining },
    { replayed: 1, failed: 0, remaining: 0 },
  );
  [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'settled');
  assert.deepEqual(retained.authorityDescriptor, descriptorB);
  assert.equal(retained.operationIssuance.epoch_id, 'epoch-successor');
  assert.equal(mutationBodies.length, 1);
  assert.deepEqual(mutationBodies[0].authorityDescriptor, descriptorB);
  assert.equal(mutationBodies[0].operationIssuance.epoch_id, 'epoch-successor');
});

test('sessions mode automatically carries authority through range issuance and ACK custody', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const issuedAtMs = Date.now();
  const rangeBodies = [];
  const mutationBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/session')) {
      return Response.json(sessionHandshake(TEST_AUTHORITY_DESCRIPTOR, TEST_SESSION_USER_ID));
    }
    if (target.endsWith('/inspect')) {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'operation-automatic-session-profile',
      }));
    }
    const body = JSON.parse(init.body);
    if (target.endsWith('/client-mutations/identity-range')) {
      rangeBodies.push(body);
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'audience-automatic-session',
          authorityInstanceId: TEST_AUTHORITY_DESCRIPTOR.authorityInstanceId,
          epochId: 'epoch-automatic-session',
          epochSequence: 1,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${'a'.repeat(64)}`,
        },
      });
    }
    mutationBodies.push(body);
    return Response.json({
      result: { ok: true },
      version: 1,
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    });
  };
  const client = new SnapbackClient('https://operation-automatic-session.example', {
    bearerToken: 'sbs_automatic_session',
    authClientProtocol: 1,
    rqsStore: store,
    operationIdentityProtocol: 1,
    __offlineMutationReplayCapability: null,
  });
  const result = await client.mutate('createThing', {
    args: { title: 'automatic session authority' },
  });
  assert.deepEqual(result.result, { ok: true });
  assert.equal(rangeBodies.length, 1);
  assert.deepEqual(rangeBodies[0].authorityDescriptor, TEST_AUTHORITY_DESCRIPTOR);
  assert.equal(mutationBodies.length, 1);
  assert.deepEqual(mutationBodies[0].authorityDescriptor, TEST_AUTHORITY_DESCRIPTOR);
  const [retained] = await store.outboxRecords();
  assert.deepEqual(retained.authorityDescriptor, TEST_AUTHORITY_DESCRIPTOR);
  assert.equal(retained.operationAuthorityPrincipalId, TEST_SESSION_USER_ID);
  assert.equal(retained.operationIssuance.epoch_id, 'epoch-automatic-session');

  const recovered = await client.settledMutations();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].clientMutationId, retained.id);
  await client.markMutationSettlementsConsumed([retained.id]);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      null, 64, TEST_AUTHORITY_DESCRIPTOR, retained.enqueueTarget,
    ),
    [retained.id],
  );

  await client.mutate('createThing', {
    args: { title: 'automatic session acknowledgement' },
  });
  assert.equal(mutationBodies.length, 2);
  assert.deepEqual(mutationBodies[1].authorityDescriptor, TEST_AUTHORITY_DESCRIPTOR);
  assert.deepEqual(mutationBodies[1].acknowledgedClientMutationIds, [retained.id]);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      null, 64, TEST_AUTHORITY_DESCRIPTOR, retained.enqueueTarget,
    ),
    [],
    'the ACK obligation clears only after the second mutation succeeds',
  );
});

test('authority rotation allocates a disjoint range without rebinding old queued identity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'https://operation-rotation.example');
  const descriptorA = TEST_AUTHORITY_DESCRIPTOR;
  const descriptorB = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b24-7a22-8c33-4455667788aa',
    sessionGeneration: 2,
  };
  const rangeRequests = [];
  const issuedAtMs = Date.now();
  let refuseAuthorityAMutation = true;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith('/client-mutations/identity-range')) {
      rangeRequests.push(body);
      const descriptor = body.authorityDescriptor;
      const suffix = descriptor.authorityInstanceId === descriptorA.authorityInstanceId ? 'a' : 'b';
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: `audience-${suffix}`,
          authorityInstanceId: descriptor.authorityInstanceId,
          epochId: `epoch-${suffix}`,
          epochSequence: 0,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${suffix.repeat(64)}`,
        },
      });
    }
    if (body.authorityDescriptor?.authorityInstanceId === descriptorA.authorityInstanceId
        && refuseAuthorityAMutation) {
      refuseAuthorityAMutation = false;
      throw new TypeError('response lost');
    }
    return Response.json({ result: { ok: true }, version: 1 });
  };
  const client = new SnapbackClient('https://operation-rotation.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const oldQueued = await client.mutate('createThing', {
    args: { title: 'old authority' },
    userId: 'user-a',
    authorityDescriptor: descriptorA,
  });
  const oldRecordBefore = (await store.outboxRecords())
    .find(({ id }) => id === oldQueued.clientMutationId);
  assert.equal(oldRecordBefore.operationIssuance.epoch_id, 'epoch-a');

  await client.mutate('createThing', {
    args: { title: 'new authority' },
    userId: 'user-a',
    authorityDescriptor: descriptorB,
  });
  assert.equal(rangeRequests.length, 2);
  assert.equal(rangeRequests[1].previousRange, undefined);
  const oldRecordAfter = (await store.outboxRecords())
    .find(({ id }) => id === oldQueued.clientMutationId);
  assert.equal(oldRecordAfter.authorityDescriptor.authorityInstanceId, descriptorA.authorityInstanceId);
  assert.deepEqual(oldRecordAfter.operationIssuance, oldRecordBefore.operationIssuance);
});

test('mixed lane-Q and lane-L intents replay in sequence with immutable per-item policy', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };

  const laneQ = await client.mutate('createThing', {
    args: { title: 'queued' },
    settlementLane: 'replay-accept',
    ctxLedger: { version: 1, ids: ['client-q-id'], now: 11 },
  });
  const laneL = await client.mutate('createThing', {
    args: { title: 'local' },
    settlementLane: 're-derive',
    settlementIdentity: {
      implementationHash: 'sha256:synthetic-local-handler',
      activation: {
        schemaVersion: 'snapback.v1',
        appId: 'mixed-lane-test',
        schemaHash: 'sha256:schema',
        bundleHash: 'sha256:bundle',
        inputsHash: 'sha256:inputs',
      },
    },
    settlementClaims: {
      version: 1,
      now: 22,
      mints: [{ claimed: 'client-l-id', site: 'insert:things', occurrence: 0 }],
    },
  });
  assert.deepEqual(
    (await store.outboxPending()).map(({ id, sequence, settlementLane }) => ({
      id,
      sequence,
      settlementLane,
    })),
    [
      { id: laneQ.clientMutationId, sequence: 1, settlementLane: 'replay-accept' },
      { id: laneL.clientMutationId, sequence: 2, settlementLane: 're-derive' },
    ],
  );

  const delivered = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    delivered.push(body);
    return Response.json({
      result: { ok: true },
      version: delivered.length,
    });
  };
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 2, failed: 0, remaining: 0 },
  );
  // @ref LLP 0133#the-two-settlement-lanes — queue order is global, but
  //   settlement policy remains attached to each immutable intent.
  assert.deepEqual(
    delivered.map((body) => [body.clientMutationId, body.settlementLane]),
    [
      [laneQ.clientMutationId, 'replay-accept'],
      [laneL.clientMutationId, 're-derive'],
    ],
  );
  assert.deepEqual(delivered[0].ctx_ledger, { version: 1, ids: ['client-q-id'], now: 11 });
  assert.equal(delivered[1].settlementClaims.now, 22);
  assert.equal(delivered[1].ctx_ledger, undefined);
});

test('LLP 0133 sketch 3 rewrites mapped speculative-id leaves before dependent submission', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };

  const mint = await client.mutate('mintParent', {
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-parent', site: 'insert:parents:id', occurrence: 0 }],
    },
  });
  const dependent = await client.mutate('mintChild', {
    args: {
      parentId: 'spec-parent',
      deliberatelyCopiedLabel: 'spec-parent',
      embeddedResidue: 'parent=spec-parent',
    },
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-child', site: 'insert:children:id', occurrence: 0 }],
    },
  });
  const transitive = await client.mutate('attachChild', {
    args: { childId: 'spec-child' },
    settlementLane: 're-derive',
    settlementClaims: { version: 1, mints: [] },
  });

  const delivered = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    delivered.push(body);
    if (body.clientMutationId === mint.clientMutationId) {
      return Response.json({
        result: { id: 'auth-parent' },
        version: 1,
        receipt: {
          kind: 'mutation',
          idMap: [{
            speculative: 'spec-parent',
            authoritative: 'auth-parent',
            site: 'insert:parents:id',
            occurrence: 0,
            disposition: 'mapped',
          }],
        },
      });
    }
    if (body.clientMutationId === dependent.clientMutationId) {
      assert.equal(body.args.parentId, 'auth-parent');
      assert.equal(
        body.args.deliberatelyCopiedLabel,
        'auth-parent',
        'exact-leaf false positives are an intentional v0 scope limit',
      );
      assert.equal(
        body.args.embeddedResidue,
        'parent=spec-parent',
        'embedded/derived ids are neither rewritten nor detected before OQ2',
      );
      return Response.json({
        result: { id: 'auth-child' },
        version: 2,
        receipt: {
          kind: 'mutation',
          idMap: [{
            speculative: 'spec-child',
            authoritative: 'auth-child',
            site: 'insert:children:id',
            occurrence: 0,
            disposition: 'mapped',
          }],
        },
      });
    }
    assert.equal(body.clientMutationId, transitive.clientMutationId);
    assert.equal(body.args.childId, 'auth-child');
    return Response.json({
      result: { ok: true },
      version: 3,
      receipt: { kind: 'mutation', idMap: [] },
    });
  };

  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 3, failed: 0, remaining: 0 },
  );
  assert.deepEqual(
    delivered.map((body) => body.clientMutationId),
    [mint.clientMutationId, dependent.clientMutationId, transitive.clientMutationId],
    'the submission fence remains sequence-serial across both rewrite generations',
  );
});

test('LLP 0133 sketch 3 rejection cascades transitively without dependent submission', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };

  const mint = await client.mutate('mintParent', {
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-parent', site: 'insert:parents:id', occurrence: 0 }],
    },
  });
  await client.mutate('mintChild', {
    args: { parentId: 'spec-parent' },
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-child', site: 'insert:children:id', occurrence: 0 }],
    },
  });
  await client.mutate('attachChild', {
    args: { childId: 'spec-child' },
    settlementLane: 're-derive',
    settlementClaims: { version: 1, mints: [] },
  });

  let submissions = 0;
  globalThis.fetch = async () => {
    submissions += 1;
    return Response.json({
      diagnostic: { code: 'SNAPBACK_MUTATION_CONFLICT', message: 'mint refused' },
      receipt: {
        kind: 'mutation',
        outcome: 'rejected',
        mutationId: mint.clientMutationId,
        idMap: [{
          speculative: 'spec-parent',
          authoritative: null,
          site: 'insert:parents:id',
          occurrence: 0,
          disposition: 'unmapped',
        }],
      },
    }, { status: 409 });
  };
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 0, failed: 3, remaining: 0 },
  );
  assert.equal(submissions, 1, 'neither direct nor transitive dependents cross transport');
  const records = await store.outboxRecords();
  assert.equal(records[0].failure.code, 'SNAPBACK_MUTATION_CONFLICT');
  assert.deepEqual(
    records.slice(1).map((record) => [record.status, record.failure.code]),
    [
      ['failed', 'SNAPBACK_SPECULATIVE_ID_UNRESOLVED'],
      ['failed', 'SNAPBACK_SPECULATIVE_ID_UNRESOLVED'],
    ],
    'cascade failures are terminal and observable with the stable code',
  );
});

test('LLP 0133 sketch 3 unmapped successful mint takes the same local cascade', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({
    id: 'cm-mint-unmapped',
    function: 'mintParent',
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-parent', site: 'insert:parents:id', occurrence: 0 }],
    },
  });
  await store.outboxEnqueue({
    id: 'cm-dependent-unmapped',
    function: 'useParent',
    args: { parentId: 'spec-parent' },
    settlementLane: 're-derive',
  });
  await store.outboxDurablyConsume('cm-mint-unmapped', {
    result: { ok: true },
    receipt: {
      kind: 'mutation',
      idMap: [{
        speculative: 'spec-parent',
        authoritative: null,
        site: 'insert:parents:id',
        occurrence: 0,
        disposition: 'unmapped',
      }],
    },
  });
  const dependent = (await store.outboxRecords())
    .find((record) => record.id === 'cm-dependent-unmapped');
  assert.equal(dependent.status, 'failed');
  assert.equal(dependent.failure.code, 'SNAPBACK_SPECULATIVE_ID_UNRESOLVED');
});

test('LLP 0133 speculative-id submission fence blocks a pending mint predecessor', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({
    id: 'cm-pending-mint',
    function: 'mintParent',
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-parent', site: 'insert:parents:id', occurrence: 0 }],
    },
  });
  await store.outboxEnqueue({
    id: 'cm-blocked-dependent',
    function: 'useParent',
    args: { parentId: 'spec-parent' },
    settlementLane: 're-derive',
  });
  const prepared = await store.outboxPrepareSubmission('cm-blocked-dependent');
  assert.equal(prepared.status, 'blocked');
  assert.equal(
    (await store.outboxRecords()).find((record) => record.id === 'cm-blocked-dependent').status,
    'pending',
    'the fence delays rather than inventing a terminal outcome while the predecessor is pending',
  );
});

test('queued generated mutation retains its call-time artifact generation through replay', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const expectedGeneration = {
    schemaVersion: 'snapback.v1',
    appId: 'generation-bound-outbox',
    schemaHash: 'schema-generation-bound-outbox',
    bundleHash: 'bundle-generation-bound-outbox',
    inputsHash: 'inputs-generation-bound-outbox',
  };
  const ref = {
    artifactKind: 'functionReference',
    kind: 'Mutation',
    name: 'generationBoundMutation',
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: 'integer' } },
      required: ['value'],
    },
    expectedGeneration,
  };
  const client = new InspectingSnapbackClient('http://127.0.0.1:9', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
        generation: expectedGeneration,
      }));
    }
    throw new TypeError('offline');
  };
  await client.mutate(ref, { args: { value: 1 } });
  const [queuedRecord] = await store.outboxPending();
  assert.deepEqual(queuedRecord.expectedGeneration, expectedGeneration);
  assert.deepEqual(
    queuedRecord.enqueueTarget.artifactIdentity,
    { kind: 'generated', generation: expectedGeneration },
  );

  let replayBody;
  globalThis.fetch = async (url, init) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
        generation: expectedGeneration,
      }));
    }
    replayBody = JSON.parse(init.body);
    return Response.json({
      version: 1,
      result: { ok: true },
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    });
  };
  const generationReplay = await client.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: generationReplay.replayed,
      failed: generationReplay.failed,
      remaining: generationReplay.remaining,
    },
    { replayed: 1, failed: 0, remaining: 0 },
    JSON.stringify({
      generationReplay,
      records: await store.outboxRecords(),
    }),
  );
  assert.deepEqual(replayBody.expectedGeneration, expectedGeneration);
  assert.deepEqual(
    (await store.outboxRecords()).map((record) => record.status),
    ['settled'],
    'production reconstruction must not terminally retire the generated intent',
  );
});

test('persisted generated mutation without reference kind replays as Mutation', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const expectedGeneration = {
    schemaVersion: 'snapback.v1',
    appId: 'legacy-kindless-outbox',
    schemaHash: 'schema-legacy-kindless-outbox',
    bundleHash: 'bundle-legacy-kindless-outbox',
    inputsHash: 'inputs-legacy-kindless-outbox',
  };
  await store.outboxEnqueue({
    id: 'cm-legacy-kindless-generated',
    function: 'legacyGenerationBoundMutation',
    ...currentOutboxTarget({
      origin: 'http://127.0.0.1:9',
      generation: expectedGeneration,
      generated: true,
    }),
    args: { value: 2 },
    readSet: [],
    expectedGeneration,
    settlementLane: 'replay-accept',
  });
  const [persisted] = await store.outboxPending();
  assert.equal(Object.hasOwn(persisted, 'kind'), false, 'legacy durable shape has no reference kind');

  let replayBody;
  globalThis.fetch = async (url, init) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'local-dev-sqlite-ibex',
        generation: expectedGeneration,
      }));
    }
    replayBody = JSON.parse(init.body);
    return Response.json({
      version: 1,
      result: { ok: true },
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    });
  };
  const client = new InspectingSnapbackClient('http://127.0.0.1:9', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: replay.replayed, failed: replay.failed, remaining: replay.remaining },
    { replayed: 1, failed: 0, remaining: 0 },
    JSON.stringify({ replay, records: await store.outboxRecords() }),
  );
  assert.deepEqual(replayBody.expectedGeneration, expectedGeneration);
  assert.equal((await store.outboxRecords())[0].status, 'settled');
});

test('explicit-id online publication is durable before delivery and retires only after ACK', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const targetProfileId = 'explicit-id-online-publication-profile';
  const devDiagnosticsEvents = [];
  const client = new SnapbackClient('http://127.0.0.1:9', {
    rqsStore: store,
    __offlineMutationReplayCapability: null,
    devDiagnosticsChannel: {
      emit(event) { devDiagnosticsEvents.push(event); },
    },
  });
  let releaseResponse;
  globalThis.fetch = async (url) => (
    new URL(url).pathname === '/inspect'
      ? Response.json(offlineReplayInspection({ supported: true, targetProfileId }))
      : new Promise((resolve) => { releaseResponse = resolve; })
  );

  const delivery = client.mutate('createThing', {
    args: { title: 'online' },
    clientMutationId: 'cm-online-durable',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const beforeResponse = (await store.outboxRecords()).find(
    (record) => record.id === 'cm-online-durable',
  );
  assert.equal(beforeResponse.status, 'pending', 'intent commits before network publication');
  assert.deepEqual(
    devDiagnosticsEvents,
    [],
    'durable insertion is not the queued diagnostic cadence',
  );

  releaseResponse(Response.json({
    result: { id: 'thing_1' },
    version: 4,
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  }));
  const result = await delivery;
  assert.equal(result.status, 'settled');
  assert.deepEqual(result.result, { id: 'thing_1' });
  assert.equal(result.version, 4);
  assert.deepEqual(
    devDiagnosticsEvents,
    [],
    'an online foreground settlement never crosses the relinquishment cut',
  );
  const retained = (await store.outboxRecords()).find(
    (record) => record.id === 'cm-online-durable',
  );
  assert.equal(retained.status, 'settled');
  assert.deepEqual(retained.settlement.result, { id: 'thing_1' });
  assert.deepEqual(await store.outboxPendingAcknowledgements(null), []);
  assert.deepEqual(
    (await client.settledMutations()).map((entry) => entry.clientMutationId),
    ['cm-online-durable'],
  );

  globalThis.fetch = async (url) => (
    new URL(url).pathname === '/inspect'
      ? Response.json(offlineReplayInspection({ supported: true, targetProfileId }))
      : Response.json({ acknowledged: 1 })
  );
  await client.acknowledgeMutations({ clientMutationIds: ['cm-online-durable'] });
  assert.deepEqual(await store.outboxRecords(), [], 'standalone ACK proof retires recovery state');
});

test('standalone ACK confirms only its exact authority cohort', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const first = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b24-7a22-8c33-445566778899',
    sessionGeneration: 1,
  };
  const second = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b25-7a22-8c33-445566778899',
    sessionGeneration: 1,
  };
  const store = createDurableTestStore();
  const origin = 'https://standalone-ack-cohort.example';
  const targetProfileId = 'standalone-ack-cohort-profile';
  await store.outboxEnqueue({
    id: 'cm-standalone-cohort',
    function: 'createThing',
    userId: 'user_a',
    ...currentOutboxTarget({ origin, targetProfileId }),
    authorityDescriptor: first,
  });
  await store.outboxDurablyConsume(
    'cm-standalone-cohort',
    { result: { ok: true } },
    'user_a',
  );
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({ supported: true, targetProfileId }));
    }
    bodies.push(JSON.parse(init.body));
    return Response.json({ acknowledged: 0 });
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  t.after(async () => {
    await client.close();
    await store.close();
  });
  await client.inspect();
  await client.acknowledgeMutations({
    userId: 'user_a',
    clientMutationIds: ['cm-standalone-cohort'],
    authorityDescriptor: second,
  });
  assert.equal((await store.outboxRecords())[0].status, 'settled');
  assert.deepEqual(bodies[0].authorityDescriptor, second);

  await client.acknowledgeMutations({
    userId: 'user_a',
    clientMutationIds: ['cm-standalone-cohort'],
    authorityDescriptor: first,
  });
  assert.deepEqual(await store.outboxRecords(), []);
  assert.deepEqual(bodies[1].authorityDescriptor, first);
});

test('shared-store recovery APIs never reconcile foreign-target custody', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const strand = async ({ store, foreignId }) => {
    const record = (await store.outboxRecords()).find((entry) => entry.id === foreignId);
    await store.outboxMarkStranded(
      foreignId,
      'foreign-target-fixture',
      record.principalScope,
    );
  };
  const quarantine = async ({ store, foreignId }) => {
    await store.outboxMarkQuarantined(foreignId, {
      code: 'SNAPBACK_TEST_UPGRADE_REQUIRED',
    });
  };
  const resultGone = async ({ store, foreignId }) => {
    await store.outboxMarkResultGone(foreignId, {
      outcome: 'committed',
      receiptDigest: testDigest('9'),
    });
  };
  const settle = async ({ store, foreignId }) => {
    await store.outboxDurablyConsume(
      foreignId,
      {
        result: { foreign: true },
        authorityDescriptor: TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
      },
      null,
    );
  };
  const cases = [
    {
      label: 'outbox-status',
      invoke: async ({ client }) => {
        assert.equal((await client.outboxStatus()).pending, 0);
      },
    },
    {
      label: 'outbox-head-diagnostics',
      invoke: async () => {
        // Client construction schedules the private #outboxHeadFact startup
        // reconstruction. Let that promise chain reach its target-filtered
        // durable read while the foreign row is the only queue head.
        await new Promise((resolve) => setImmediate(resolve));
      },
    },
    {
      label: 'mutation-status',
      invoke: async ({ client, foreignId }) => {
        assert.equal((await client.mutationStatus(foreignId)).status, 'unknown');
      },
    },
    {
      label: 'mutation-subscription',
      invoke: async ({ client, foreignId }) => {
        const statuses = [];
        const unsubscribe = client.subscribeMutation(
          foreignId,
          (status) => statuses.push(status.status),
        );
        await new Promise((resolve) => setImmediate(resolve));
        unsubscribe();
        assert.deepEqual(statuses, ['unknown']);
      },
    },
    {
      label: 'optimistic-projection-and-disposition',
      invoke: async ({ client, foreignId, store }) => {
        const view = await client.createOptimisticMutationView({
          authoritativeRows: { cards: [] },
        });
        try {
          assert.equal(view.getSnapshot().layers.length, 0);
        } finally {
          view.close();
        }
        const withAuthorizationDispatch = store.withOutboxAuthorizationDispatch.bind(store);
        let dispositionDispatchCuts = 0;
        store.withOutboxAuthorizationDispatch = (operation, options) => (
          withAuthorizationDispatch(async () => {
            dispositionDispatchCuts += 1;
            return operation();
          }, options)
        );
        const disposition = await client.__optimisticMutationDisposition(foreignId);
        assert.equal(disposition.status, 'unknown');
        assert.equal(disposition.record, null);
        assert.equal(dispositionDispatchCuts, 1, 'the internal id read owns the shared cut');
        assert.equal(
          client.outboxDiagnostics.at(-1)?.code,
          'SNAPBACK_OUTBOX_TARGET_FENCE_REFUSED',
        );
      },
    },
    {
      label: 'stranded-read',
      prepare: strand,
      invoke: async ({ client }) => {
        assert.deepEqual(await client.strandedMutations(), []);
      },
    },
    {
      label: 'stranded-discard',
      prepare: strand,
      invoke: async ({ client, foreignId }) => {
        assert.deepEqual(
          await client.discardStrandedMutations([foreignId]),
          { discarded: 0, clientMutationIds: [] },
        );
      },
    },
    {
      label: 'stranded-rerecord',
      prepare: strand,
      invoke: async ({ client, foreignId }) => {
        await assert.rejects(
          () => client.reRecordStrandedMutation(foreignId),
          (error) => error.code === 'SNAPBACK_OUTBOX_STRANDED_NOT_CURRENT',
        );
      },
    },
    {
      label: 'quarantine-read',
      prepare: quarantine,
      invoke: async ({ client }) => {
        assert.deepEqual(await client.quarantinedMutations(), []);
      },
    },
    {
      label: 'quarantine-reentry',
      prepare: quarantine,
      invoke: async ({ client }) => {
        assert.deepEqual(
          await client.reenterQuarantinedMutations(),
          { reentered: 0, clientMutationIds: [] },
        );
      },
    },
    {
      label: 'result-gone-acknowledgement',
      prepare: resultGone,
      invoke: async ({ client, foreignId }) => {
        assert.deepEqual(
          await client.acknowledgeResultGoneMutations([foreignId]),
          { acknowledged: 0, clientMutationIds: [] },
        );
      },
    },
    {
      label: 'settlement-read',
      prepare: settle,
      invoke: async ({ client }) => {
        assert.deepEqual(await client.settledMutations(), []);
      },
    },
    {
      label: 'settlement-consumed',
      prepare: settle,
      invoke: async ({ client, foreignId, store }) => {
        assert.equal(await client.markMutationSettlementsConsumed([foreignId]), 0);
        assert.deepEqual(
          await store.outboxPendingAcknowledgements(
            null,
            64,
            TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
          ),
          [],
        );
      },
    },
    {
      label: 'standalone-acknowledgement',
      prepare: settle,
      invoke: async ({ client, foreignId }) => {
        assert.deepEqual(
          await client.acknowledgeMutations({ clientMutationIds: [foreignId] }),
          { acknowledged: 0 },
        );
      },
    },
    {
      label: 'explicit-piggyback-acknowledgement',
      invoke: async ({ client, foreignId, store }) => {
        const enqueue = store.outboxEnqueue.bind(store);
        let replaced = false;
        store.outboxEnqueue = async (...args) => {
          const stored = await enqueue(...args);
          if (!replaced) {
            replaced = true;
            client.baseUrl = 'https://explicit-piggyback-repointed.example';
          }
          return stored;
        };
        await assert.rejects(
          () => client.mutate('createThing', {
            args: { title: 'current target refuses before transport' },
            clientMutationId: 'cm-explicit-piggyback-target-b',
            acknowledgedClientMutationIds: [foreignId],
            queue: true,
          }),
          (error) => error.code === 'SNAPBACK_CLIENT_OPERATION_TARGET_CHANGED',
        );
      },
    },
    {
      label: 'replay-and-terminal-consumers',
      invoke: async ({ client }) => {
        const replay = await client.replayQueuedMutations();
        assert.equal(replay.replayed, 0);
        assert.equal(replay.stopped, true);
      },
    },
    {
      label: 'sidecar-adoption',
      invoke: async ({ client, store }) => {
        client.inspect = async () => offlineReplayInspection({
          supported: true,
          targetProfileId: 'sidecar-adoption-target-b',
        });
        const receipt = await client.adoptQueuedMutations({
          expectedClientStoreId: (await store.readStoreMeta()).clientStoreId,
          expectedGeneration: TEST_ARTIFACT_GENERATION,
          afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
        });
        assert.equal(receipt.replayed, 0);
      },
    },
    {
      label: 'foreground-range-and-disposition',
      fixtureOptions: { operationIdentityProtocol: 1 },
      invoke: async ({ client, store }) => {
        const enqueue = store.outboxEnqueueWithOperationIdentity.bind(store);
        let replaced = false;
        store.outboxEnqueueWithOperationIdentity = async (...args) => {
          const stored = await enqueue(...args);
          if (!replaced) {
            replaced = true;
            client.baseUrl = 'https://foreground-range-repointed.example';
          }
          return stored;
        };
        await assert.rejects(
          () => client.mutate('createThing', {
            args: { title: 'current range refuses before transport' },
            clientMutationId: 'cm-foreground-range-target-b',
            queue: true,
          }),
          (error) => error.code === 'SNAPBACK_CLIENT_OPERATION_TARGET_CHANGED',
        );
      },
    },
  ];
  for (const recoveryCase of cases) {
    await t.test(recoveryCase.label, async () => {
      const fixture = await createForeignTargetSessionFixture({
        label: recoveryCase.label,
        ...recoveryCase.fixtureOptions,
      });
      try {
        await recoveryCase.prepare?.(fixture);
        const before = structuredClone(
          (await fixture.store.outboxRecords())
            .find((record) => record.id === fixture.foreignId),
        );
        const transportRequests = [];
        globalThis.fetch = async (url) => {
          transportRequests.push(String(url));
          throw new Error(`${recoveryCase.label} must not reach transport`);
        };
        await recoveryCase.invoke(fixture);
        assert.deepEqual(
          (await fixture.store.outboxRecords())
            .find((record) => record.id === fixture.foreignId),
          before,
          `${recoveryCase.label} leaves target-A bytes unchanged`,
        );
        assert.deepEqual(transportRequests, [], `${recoveryCase.label} sends zero transport`);
      } finally {
        await fixture.close();
      }
    });
  }
});

test('foreign-target result-gone acknowledgement is a coded no-op', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const fixture = await createForeignTargetSessionFixture({ label: 'result-gone-ack' });
  try {
    await fixture.store.outboxMarkResultGone(fixture.foreignId, {
      outcome: 'committed',
      receiptDigest: testDigest('7'),
    });
    const before = structuredClone(
      (await fixture.store.outboxRecords()).find((record) => record.id === fixture.foreignId),
    );
    assert.deepEqual(
      await fixture.client.acknowledgeResultGoneMutations([fixture.foreignId]),
      { acknowledged: 0, clientMutationIds: [] },
    );
    assert.deepEqual(
      (await fixture.store.outboxRecords()).find((record) => record.id === fixture.foreignId),
      before,
    );
    assert.equal(
      fixture.client.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_TARGET_FENCE_REFUSED',
    );
  } finally {
    await fixture.close();
  }
});

test('foreign-target settlement cannot cross the consumed acknowledgement cut', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const fixture = await createForeignTargetSessionFixture({ label: 'settlement-consumed' });
  try {
    await fixture.store.outboxDurablyConsume(
      fixture.foreignId,
      {
        result: { foreign: true },
        authorityDescriptor: TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
      },
      null,
    );
    const before = structuredClone(
      (await fixture.store.outboxRecords()).find((record) => record.id === fixture.foreignId),
    );
    assert.equal(
      await fixture.client.markMutationSettlementsConsumed([fixture.foreignId]),
      0,
    );
    assert.deepEqual(
      await fixture.store.outboxPendingAcknowledgements(
        null,
        64,
        TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
      ),
      [],
    );
    assert.deepEqual(
      (await fixture.store.outboxRecords()).find((record) => record.id === fixture.foreignId),
      before,
    );
    assert.equal(
      fixture.client.outboxDiagnostics.at(-1)?.code,
      'SNAPBACK_OUTBOX_TARGET_FENCE_REFUSED',
    );
  } finally {
    await fixture.close();
  }
});

test('operation-range authority-unsettled recovery is scoped to the current target record', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const fixture = await createForeignTargetSessionFixture({
    label: 'range-unsettled',
    operationIdentityProtocol: 1,
  });
  try {
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/auth/session') {
        const handshake = sessionHandshake(
          TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
          TEST_SESSION_USER_ID,
        );
        return Response.json({
          ...handshake,
          deploymentIdentity: {
            ...handshake.deploymentIdentity,
            appId: TEST_ARTIFACT_GENERATION.appId,
          },
        });
      }
      assert.equal(path, '/client-mutations/identity-range');
      return Response.json({
        diagnostic: {
          code: 'SNAPBACK_CLIENT_AUTHORITY_STALE',
          message: 'fixture authority became unsettled during range issuance',
        },
      }, { status: 409 });
    };
    await assert.rejects(
      () => fixture.client.mutate('createThing', {
        args: { title: 'current target range request' },
        clientMutationId: 'cm-range-unsettled-target-b',
        queue: true,
      }),
      (error) => error.diagnostic?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
    );
    assert.deepEqual(
      (await fixture.store.outboxRecords())
        .find((record) => record.id === fixture.foreignId),
      fixture.before,
      'the range handler leaves target-A pending bytes unchanged',
    );
  } finally {
    await fixture.close();
  }
});

test('mutation transport authority-unsettled recovery is scoped to the current target record', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const fixture = await createForeignTargetSessionFixture({ label: 'transport-unsettled' });
  try {
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/auth/session') {
        const handshake = sessionHandshake(
          TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
          TEST_SESSION_USER_ID,
        );
        return Response.json({
          ...handshake,
          deploymentIdentity: {
            ...handshake.deploymentIdentity,
            appId: TEST_ARTIFACT_GENERATION.appId,
          },
        });
      }
      assert.match(path, /^\/mutation\//u);
      return Response.json({
        diagnostic: {
          code: 'SNAPBACK_CLIENT_AUTHORITY_STALE',
          message: 'fixture authority became unsettled during mutation transport',
        },
      }, { status: 409 });
    };
    await assert.rejects(
      () => fixture.client.mutate('createThing', {
        args: { title: 'current target mutation request' },
        clientMutationId: 'cm-transport-unsettled-target-b',
        queue: true,
      }),
      (error) => error.diagnostic?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
    );
    assert.deepEqual(
      (await fixture.store.outboxRecords())
        .find((record) => record.id === fixture.foreignId),
      fixture.before,
      'the transport handler leaves target-A pending bytes unchanged',
    );
  } finally {
    await fixture.close();
  }
});

test('standalone ACK refreshes same-origin generation evidence before custody or POST', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const origin = 'https://same-origin-ack-generation.example';
  const targetProfileId = 'same-origin-ack-generation-target';
  const successorGeneration = Object.freeze({
    ...TEST_ARTIFACT_GENERATION,
    bundleHash: `sha256:${'d'.repeat(64)}`,
  });
  const store = createDurableTestStore();
  const clientMutationId = 'cm-same-origin-predecessor-generation-ack';
  await store.outboxEnqueue({
    id: clientMutationId,
    function: 'createThing',
    ...currentOutboxTarget({ origin, targetProfileId }),
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  await store.outboxDurablyConsume(
    clientMutationId,
    { result: { ok: true }, authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR },
    null,
  );
  await store.outboxMarkAcknowledgementsReady(
    [clientMutationId], undefined, undefined, null,
    (await store.outboxRecords())[0].enqueueTarget,
  );
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/inspect');
    return Response.json(offlineReplayInspection({
      supported: true,
      targetProfileId,
      generation: TEST_ARTIFACT_GENERATION,
    }));
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  await client.inspect();
  let acknowledgementPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId,
        generation: successorGeneration,
      }));
    }
    acknowledgementPosts += 1;
    return Response.json({ acknowledged: 1 });
  };
  try {
    assert.deepEqual(
      await client.acknowledgeMutations({ clientMutationIds: [clientMutationId] }),
      { acknowledged: 0 },
    );
    assert.equal(acknowledgementPosts, 0, 'the successor receives no predecessor ACK');
    assert.equal(
      (await store.outboxRecords()).find((record) => record.id === clientMutationId)?.status,
      'settled',
      'the predecessor recovery record survives the same-origin successor probe',
    );
  } finally {
    await client.close();
    await store.close();
  }
});

test('standalone ACK rechecks a same-target positive after acquiring authorization dispatch', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const origin = 'https://standalone-ack-peer-negative.example';
  const targetProfileId = 'standalone-ack-peer-negative-target';
  const store = createDurableTestStore();
  const clientMutationId = 'cm-standalone-ack-peer-negative';
  await store.outboxEnqueue({
    id: clientMutationId,
    function: 'createThing',
    ...currentOutboxTarget({ origin, targetProfileId }),
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  await store.outboxDurablyConsume(
    clientMutationId,
    { result: { ok: true }, authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR },
    null,
  );
  await store.outboxMarkAcknowledgementsReady(
    [clientMutationId], undefined, undefined, null,
    (await store.outboxRecords())[0].enqueueTarget,
  );
  let acknowledgementPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({ supported: true, targetProfileId }));
    }
    acknowledgementPosts += 1;
    return Response.json({ acknowledged: 1 });
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  const withAuthorizationDispatch = store.withOutboxAuthorizationDispatch.bind(store);
  let negativeCommitted = false;
  store.withOutboxAuthorizationDispatch = async (operation, options = undefined) => {
    if (options?.lane === 'foreground' && !negativeCommitted) {
      negativeCommitted = true;
      const observation = await store.beginOfflineMutationReplayCapabilityObservation();
      await store.commitOfflineMutationReplayCapabilityFact({
        schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
        origin,
        supported: false,
        reason: 'answered-negative-before-ack-dispatch',
        targetProfileId,
        artifactGeneration: TEST_ARTIFACT_GENERATION,
      }, observation);
    }
    return withAuthorizationDispatch(operation, options);
  };
  try {
    assert.deepEqual(
      await client.acknowledgeMutations({ clientMutationIds: [clientMutationId] }),
      { acknowledged: 0 },
    );
    assert.equal(negativeCommitted, true, 'the peer negative wins before ACK lock entry');
    assert.equal(acknowledgementPosts, 0, 'a same-target negative licenses no ACK POST');
    assert.equal((await store.outboxRecords())[0].status, 'settled');
  } finally {
    await client.close();
    await store.close();
  }
});

test('durable injected stores without shared capability evidence methods refuse before peer-stale ACK', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const origin = 'https://incomplete-capability-store.example';
  const targetProfileId = 'incomplete-capability-store-target';
  const backingStore = createDurableTestStore();
  const clientMutationId = 'cm-incomplete-capability-store-ack';
  await backingStore.outboxEnqueue({
    id: clientMutationId,
    function: 'createThing',
    ...currentOutboxTarget({ origin, targetProfileId }),
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  await backingStore.outboxDurablyConsume(
    clientMutationId,
    { result: { ok: true }, authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR },
    null,
  );
  await backingStore.outboxMarkAcknowledgementsReady(
    [clientMutationId], undefined, undefined, null,
    (await backingStore.outboxRecords())[0].enqueueTarget,
  );
  const incompleteStore = Object.create(backingStore);
  Object.defineProperties(incompleteStore, {
    beginOfflineMutationReplayCapabilityObservation: { value: undefined },
    readOfflineMutationReplayCapabilityFact: { value: undefined },
    commitOfflineMutationReplayCapabilityFact: { value: undefined },
  });
  const positiveClient = new InspectingSnapbackClient(origin, {
    rqsStore: incompleteStore,
    __outboxDrainLifecycle: false,
  });
  const negativePeer = new InspectingSnapbackClient(origin, {
    rqsStore: incompleteStore,
    __outboxDrainLifecycle: false,
  });
  positiveClient.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  negativePeer.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: true,
    targetProfileId,
  }));
  await positiveClient.inspect();
  globalThis.fetch = async () => Response.json(offlineReplayInspection({
    supported: false,
    targetProfileId,
  }));
  await negativePeer.inspect();
  let acknowledgementPosts = 0;
  globalThis.fetch = async () => {
    acknowledgementPosts += 1;
    return Response.json({ acknowledged: 1 });
  };
  try {
    await assert.rejects(
      () => positiveClient.acknowledgeMutations({ clientMutationIds: [clientMutationId] }),
      (error) => error.code === 'SNAPBACK_OFFLINE_QUEUE_CAPABILITY_STORE_INCAPABLE',
    );
    assert.equal(acknowledgementPosts, 0, 'per-client stale positive licenses no ACK POST');
    assert.equal((await backingStore.outboxRecords())[0].status, 'settled');
  } finally {
    await positiveClient.close();
    await negativePeer.close();
    await backingStore.close();
  }
});

test('standalone ACK never crosses the persisted enqueue target after client repoint', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const originA = 'https://standalone-ack-target-a.example';
  const originB = 'https://standalone-ack-target-b.example';
  const store = createDurableTestStore();
  const clientMutationId = 'cm-standalone-ack-target-a';
  const targetA = currentOutboxTarget({ origin: originA });
  await store.outboxEnqueue({
    id: clientMutationId,
    function: 'createThing',
    ...targetA,
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  await store.outboxDurablyConsume(
    clientMutationId,
    { result: { ok: true }, authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR },
    null,
  );
  await store.outboxMarkAcknowledgementsReady(
    [clientMutationId], undefined, undefined, null,
    (await store.outboxRecords())[0].enqueueTarget,
  );
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ acknowledged: 0 });
  };
  const client = new InspectingSnapbackClient(originB, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  t.after(async () => {
    await client.close();
    await store.close();
  });

  assert.deepEqual(
    await client.acknowledgeMutations({ clientMutationIds: [clientMutationId] }),
    { acknowledged: 0 },
  );
  assert.deepEqual(requests, [], 'target B receives no standalone ACK for target A');
  assert.equal(
    (await store.outboxRecords()).find((record) => record.id === clientMutationId)?.status,
    'settled',
    'target A recovery state survives the foreign standalone ACK attempt',
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      null, 64, TEST_AUTHORITY_DESCRIPTOR, targetA.enqueueTarget,
    ),
    [clientMutationId],
    'target A keeps its local ACK obligation',
  );
});

test('foreign-target standalone ACK never reconciles that record under a different authority', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const originA = 'https://authority-scoped-ack-target-a.example';
  const originB = 'https://authority-scoped-ack-target-b.example';
  const store = createDurableTestStore();
  const coordinator = createSuccessorCoordinator();
  let acknowledgementPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') {
      const handshake = sessionHandshake(
        TEST_SUCCESSOR_AUTHORITY_DESCRIPTOR,
        TEST_SESSION_USER_ID,
      );
      return Response.json({
        ...handshake,
        deploymentIdentity: {
          ...handshake.deploymentIdentity,
          appId: TEST_ARTIFACT_GENERATION.appId,
        },
      });
    }
    if (path === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'authority-scoped-ack-target-b',
      }));
    }
    acknowledgementPosts += 1;
    return Response.json({ acknowledged: 1 });
  };
  const client = new InspectingSnapbackClient(originB, {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  try {
    const capture = await settleSuccessorCoordinator(coordinator);
    await client.authSession();
    const clientMutationId = 'cm-authority-scoped-ack-target-a';
    await store.outboxEnqueue({
      id: clientMutationId,
      function: 'createThing',
      ...currentOutboxTarget({ origin: originA, generated: true }),
      args: { title: 'target A authority must stay untouched' },
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
      principalScope: {
        authMode: 'sessions',
        authorizationStreamIncarnation: '018f0d90-7b26-7a22-8c33-445566778899',
        userId: TEST_SESSION_USER_ID,
      },
      custody: {
        authorityEpoch: capture.authorityEpoch,
        authorityKey: capture.authorityKey,
      },
    });
    const before = structuredClone((await store.outboxRecords())[0]);

    assert.deepEqual(
      await client.acknowledgeMutations({ clientMutationIds: [clientMutationId] }),
      { acknowledged: 0 },
    );
    assert.equal(acknowledgementPosts, 0, 'target B receives no ACK for target A');
    assert.deepEqual(
      (await store.outboxRecords())[0],
      before,
      'target eligibility precedes custody, so B cannot strand or delete A records',
    );
  } finally {
    await client.close();
    await coordinator.close();
    await store.close();
  }
});

test('legacy targetless standalone ACK never crosses origin after client repoint', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const originB = 'https://legacy-standalone-ack-target-b.example';
  const store = createDurableTestStore();
  const clientMutationId = 'cm-legacy-standalone-ack-target-a';
  await store.outboxEnqueue({
    id: clientMutationId,
    function: 'createThing',
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  await store.outboxDurablyConsume(
    clientMutationId,
    { result: { ok: true }, authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR },
    null,
  );
  await store.outboxMarkAcknowledgementsReady([clientMutationId]);
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ acknowledged: 1 });
  };
  const client = new InspectingSnapbackClient(originB, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  t.after(async () => {
    await client.close();
    await store.close();
  });

  assert.deepEqual(
    await client.acknowledgeMutations({ clientMutationIds: [clientMutationId] }),
    { acknowledged: 0 },
  );
  assert.deepEqual(requests, [], 'target B receives no standalone ACK for targetless intent');
  assert.equal(
    (await store.outboxRecords()).find((record) => record.id === clientMutationId)?.status,
    'settled',
    'targetless recovery state survives the foreign standalone ACK attempt',
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(null, 64, TEST_AUTHORITY_DESCRIPTOR),
    [],
    'targetless legacy intent cannot become an ACK obligation',
  );
});

test('standalone ACK drops caller ids with no local recovery record', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ acknowledged: 1 });
  };
  const client = new InspectingSnapbackClient('https://missing-local-ack.example', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  t.after(async () => {
    await client.close();
    await store.close();
  });

  assert.deepEqual(
    await client.acknowledgeMutations({ clientMutationIds: ['cm-missing-local-ack'] }),
    { acknowledged: 0 },
  );
  assert.deepEqual(requests, [], 'an unowned caller id never reaches the current origin');
});

test('piggyback ACK never crosses the persisted enqueue target after client repoint', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const originA = 'https://piggyback-ack-target-a.example';
  const originB = 'https://piggyback-ack-target-b.example';
  const store = createDurableTestStore();
  const clientMutationId = 'cm-piggyback-ack-target-a';
  const targetA = currentOutboxTarget({ origin: originA });
  await store.outboxEnqueue({
    id: clientMutationId,
    function: 'createThing',
    ...targetA,
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  await store.outboxDurablyConsume(
    clientMutationId,
    { result: { ok: true }, authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR },
    null,
  );
  await store.outboxMarkAcknowledgementsReady(
    [clientMutationId], undefined, undefined, null,
    (await store.outboxRecords())[0].enqueueTarget,
  );
  const mutationBodies = [];
  globalThis.fetch = async (url, init) => {
    if (new URL(url).pathname === '/inspect') {
      return Response.json(offlineReplayInspection({
        supported: true,
        targetProfileId: 'target-b-ledger',
      }));
    }
    const body = JSON.parse(init.body);
    mutationBodies.push(body);
    return Response.json({
      result: { acceptedByTargetB: true },
      version: 1,
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    });
  };
  const client = new InspectingSnapbackClient(originB, {
    rqsStore: store,
    __offlineMutationReplayCapability: null,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(TEST_ARTIFACT_GENERATION.appId);
  t.after(async () => {
    await client.close();
    await store.close();
  });

  const outcome = await client.mutate('createThing', {
    args: { title: 'target B write' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    acknowledgedClientMutationIds: [clientMutationId],
  });
  assert.equal(outcome.status, 'settled');
  assert.equal(mutationBodies.length, 1);
  assert.equal(
    mutationBodies[0].acknowledgedClientMutationIds,
    undefined,
    'target B mutation carries no target A ACK',
  );
  assert.equal(
    (await store.outboxRecords()).find((record) => record.id === clientMutationId)?.status,
    'settled',
    'target A recovery state survives the foreign piggyback opportunity',
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      null, 64, TEST_AUTHORITY_DESCRIPTOR, targetA.enqueueTarget,
    ),
    [clientMutationId],
    'target A keeps its local ACK obligation',
  );
});

test('explicit-id server refusal is failed locally and never acknowledged', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => Response.json(
    { diagnostic: { code: 'SNAPBACK_VALIDATION', message: 'bad args' } },
    { status: 400 },
  );
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { bad: true },
      clientMutationId: 'cm-online-refused',
    }),
    /SNAPBACK_VALIDATION/,
  );
  const record = (await store.outboxRecords()).find((item) => item.id === 'cm-online-refused');
  assert.equal(record.status, 'failed');
  assert.deepEqual(await store.outboxPendingAcknowledgements(null), []);
});

test('mutate teardown preserves the real refusal when failure marking races store close', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', {
    rqsStore: store,
    offlineQueue: true,
  });
  let markFetchEntered;
  const fetchEntered = new Promise((resolve) => { markFetchEntered = resolve; });
  let releaseResponse;
  globalThis.fetch = async () => {
    markFetchEntered();
    return new Promise((resolve) => { releaseResponse = resolve; });
  };

  const pending = client.mutate('teardownRefusal', {
    args: { value: 1 },
    clientMutationId: 'cm-teardown-store-close',
    queue: true,
  });
  const refusal = assert.rejects(
    pending,
    (error) => error?.diagnostic?.code === 'SNAPBACK_TEST_MUTATION_REFUSED',
  );
  await fetchEntered;
  await store.close();
  releaseResponse(Response.json({
    diagnostic: {
      code: 'SNAPBACK_TEST_MUTATION_REFUSED',
      message: 'server refusal won the race',
    },
  }, { status: 409 }));
  await refusal;
  assert.equal(
    client.outboxDiagnostics.at(-1)?.code,
    'SNAPBACK_OUTBOX_FAILURE_MARK_SKIPPED_STORE_CLOSED',
  );
  assert.equal(
    client.outboxDiagnostics.at(-1)?.clientMutationId,
    'cm-teardown-store-close',
  );
});

test('explicit id cannot be rebound to another durable replay identity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await store.outboxEnqueue({
    id: 'cm-bound-once',
    function: 'createThing',
    args: { title: 'first' },
    userId: null,
    readSet: [],
    correlation: null,
    authorityDescriptor: null,
    ctxLedger: null,
    capturedNow: 1,
  });
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'different' },
      clientMutationId: 'cm-bound-once',
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_IDENTITY_MISMATCH',
  );
  assert.equal(calls, 0, 'identity mismatch refuses before delivery');
  assert.deepEqual((await store.outboxPending())[0].args, { title: 'first' });
});

test('server settlement descriptor enriches ACK custody without rebinding request identity', async () => {
  const store = createDurableTestStore();
  const intent = {
    id: 'cm-descriptor-enrichment',
    function: 'createThing',
    args: { title: 'same request' },
    userId: null,
    readSet: [],
    correlation: null,
    authorityDescriptor: null,
    ctxLedger: null,
    capturedNow: 1,
  };
  await store.outboxEnqueue(intent);
  await store.outboxDurablyConsume(
    intent.id,
    { result: { id: 'thing_1' }, authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR },
    null,
  );
  const retained = await store.outboxEnqueue({ ...intent, capturedNow: 2 });
  assert.equal(retained.status, 'settled');
  assert.equal(retained.authorityDescriptor, null, 'captured request identity stays immutable');
  assert.deepEqual(retained.settlementAuthorityDescriptor, TEST_AUTHORITY_DESCRIPTOR);
});

test('crash recovery exposes and consumes only the re-attested authority cohort', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://recovery.example';
  const targetProfileId = 'crash-recovery-projection-profile';
  const target = currentOutboxTarget({ origin, targetProfileId });
  const predecessor = {
    ...TEST_AUTHORITY_DESCRIPTOR,
    authorityInstanceId: '018f0d90-7b28-7a22-8c33-445566778899',
  };
  for (const [id, descriptor, secret] of [
    ['cm-predecessor-settlement', predecessor, 'predecessor-only'],
    ['cm-current-settlement', TEST_AUTHORITY_DESCRIPTOR, 'current-only'],
  ]) {
    await store.outboxEnqueue({
      id,
      function: 'createThing',
      ...target,
      args: {},
      userId: null,
      authorityDescriptor: null,
    });
    await store.outboxDurablyConsume(
      id,
      { result: { secret }, authorityDescriptor: descriptor },
      null,
    );
  }
  await store.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId,
    artifactGeneration: TEST_ARTIFACT_GENERATION,
  });
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/auth\/session$/);
    return Response.json(sessionHandshake(TEST_AUTHORITY_DESCRIPTOR));
  };
  const client = new SnapbackClient(origin, {
    bearerToken: 'sbs_current_recovery_bearer',
    authClientProtocol: 1,
    rqsStore: store,
  });
  const recovered = await client.settledMutations();
  assert.deepEqual(
    recovered.map((entry) => entry.clientMutationId),
    ['cm-current-settlement'],
  );
  assert.deepEqual(recovered[0].settlement.result, { secret: 'current-only' });
  assert.equal(
    await client.markMutationSettlementsConsumed([
      'cm-predecessor-settlement',
      'cm-current-settlement',
    ]),
    1,
    'a successor cannot make its predecessor settlement ACK-eligible',
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      null, 64, TEST_AUTHORITY_DESCRIPTOR, target.enqueueTarget,
    ),
    ['cm-current-settlement'],
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      null, 64, predecessor, target.enqueueTarget,
    ),
    [],
  );
});

test('post-response persistence failure remains pending and is never published as failed', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const consume = store.outboxDurablyConsume.bind(store);
  store.outboxDurablyConsume = async () => {
    const error = new Error('simulated fsync failure');
    error.code = 'EIO';
    throw error;
  };
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => Response.json({ result: { id: 'thing_1' }, version: 4 });
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'online' },
      clientMutationId: 'cm-persist-failure',
    }),
    (error) => error.code === 'EIO',
  );
  let record = (await store.outboxRecords()).find((item) => item.id === 'cm-persist-failure');
  assert.equal(record.status, 'pending');
  assert.deepEqual(await store.outboxPendingAcknowledgements(null), []);

  store.outboxDurablyConsume = consume;
  const replayed = await client.replayQueuedMutations();
  assert.equal(replayed.replayed, 1);
  record = (await store.outboxRecords()).find((item) => item.id === 'cm-persist-failure');
  assert.equal(record.status, 'settled', 'same id recovers the committed server settlement');
});

test('replay persistence failure stops without drop-and-mark-failed', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const queued = await client.mutate('createThing', { args: { title: 'offline' } });
  store.outboxDurablyConsume = async () => {
    const error = new Error('simulated fsync failure');
    error.code = 'EIO';
    throw error;
  };
  globalThis.fetch = async () => Response.json({ result: { id: 'thing_1' }, version: 4 });
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining, stopped: outcome.stopped },
    { replayed: 0, failed: 0, remaining: 1, stopped: true },
  );
  const record = (await store.outboxRecords()).find((item) => item.id === queued.clientMutationId);
  assert.equal(record.status, 'pending');
});

test('identity horizon outcome-unknown remains pending online and during replay', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => Response.json({
    diagnostic: {
      code: 'SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED',
      message: 'the identity epoch is below the retained outcome horizon',
      details: {
        disposition: 'identity-horizon-passed',
        outcome: 'unknown',
        terminal: false,
      },
    },
  }, { status: 409 });

  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'ambiguous' },
      clientMutationId: 'cm-outcome-unknown',
    }),
    (error) => (
      error.diagnostic.code === 'SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED'
      && error.operationOutcome === 'unknown'
    ),
  );
  let record = (await store.outboxRecords()).find((item) => item.id === 'cm-outcome-unknown');
  assert.equal(record.status, 'pending', 'online horizon refusal is not terminal failed state');

  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: replay.replayed,
      failed: replay.failed,
      remaining: replay.remaining,
      stopped: replay.stopped,
    },
    { replayed: 0, failed: 0, remaining: 1, stopped: true },
  );
  record = (await store.outboxRecords()).find((item) => item.id === 'cm-outcome-unknown');
  assert.equal(record.status, 'pending', 'replay horizon refusal remains operator-visible pending');
});

test('committed result-expired becomes durable result-gone and blocks ordered successors', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const target = await prepareCompleteReplayTarget(store, 'http://127.0.0.1:9');
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_OPERATION_RESULT_EXPIRED',
        message: 'the committed operation result payload was reclaimed',
        details: {
          disposition: 'result-expired',
          outcome: 'committed',
          receiptDigest: `sha256:${'e'.repeat(64)}`,
        },
      },
    }, { status: 410 });
  };

  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'known-committed' },
      clientMutationId: 'cm-result-expired',
    }),
    (error) => (
      error.operationOutcome === 'committed'
      && error.operationResult === 'expired'
    ),
  );
  await store.outboxEnqueue({
    id: 'cm-after-result-expired',
    function: 'updateThing',
    ...target,
    args: { title: 'must-wait' },
  });
  calls = 0;
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: replay.replayed,
      failed: replay.failed,
      remaining: replay.remaining,
      stopped: replay.stopped,
      calls,
    },
    { replayed: 0, failed: 0, remaining: 2, stopped: true, calls: 0 },
    'durable payload loss is never retried and keeps successors behind the submission fence',
  );
  assert.deepEqual(
    (await store.outboxRecords()).map((record) => [record.id, record.status]),
    [
      ['cm-result-expired', 'result-gone'],
      ['cm-after-result-expired', 'pending'],
    ],
  );
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'known-committed' },
      clientMutationId: 'cm-result-expired',
    }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_OUTBOX_MUTATION_NOT_REPLAYABLE');
      assert.equal(error.mutationDisposition.status, 'result-gone');
      assert.equal(error.effectCommitted, true);
      assert.equal(error.effectMayHaveCommitted, true);
      assert.equal(error.diagnostic.details.effectCommitted, true);
      assert.equal(error.diagnostic.details.effectMayHaveCommitted, true);
      return true;
    },
  );
  assert.equal(calls, 0, 'committed result-gone redispatch never reaches transport');
  assert.deepEqual(
    { ...(await client.outboxStatus()) },
    {
      supported: true, pending: 1, failed: 0, stranded: 0,
      quarantined: 0, resultGone: 1, replaying: false, drainMode: 'none',
      oldestPendingAtMs: (await store.outboxRecords())
        .find((record) => record.status === 'pending').enqueuedAt,
      drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null, blockedReason: null,
    },
  );
});

test('failed and missing-record redispatch preserve their distinct effect facts', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('https://outbox-disposition.example', { rqsStore: store });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_FIXTURE_REFUSED',
        message: 'fixture refusal',
        details: { effectCommitted: false },
      },
    }, { status: 409 });
  };
  const input = {
    args: { title: 'known-refused' },
    clientMutationId: 'cm-failed-redispatch',
  };
  await assert.rejects(() => client.mutate('createThing', input));
  assert.equal((await store.outboxRecords())[0].status, 'failed');
  assert.deepEqual((await store.outboxRecords())[0].effectProvenance, {
    effectCommitted: false,
    effectMayHaveCommitted: false,
  });
  const callsBeforeRedispatch = calls;
  await assert.rejects(
    () => client.mutate('createThing', input),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_OUTBOX_MUTATION_NOT_REPLAYABLE');
      assert.equal(error.mutationDisposition.status, 'failed');
      assert.equal(error.effectCommitted, false);
      assert.equal(error.effectMayHaveCommitted, false);
      assert.equal(error.diagnostic.details.effectCommitted, false);
      assert.equal(error.diagnostic.details.effectMayHaveCommitted, false);
      return true;
    },
  );
  assert.equal(calls, callsBeforeRedispatch, 'failed redispatch never reaches transport');

  const missingStore = Object.create(createDurableTestStore());
  missingStore.outboxEnqueue = async () => null;
  const missingClient = new SnapbackClient('https://outbox-missing.example', {
    rqsStore: missingStore,
  });
  globalThis.fetch = async () => {
    throw new Error('missing durable record must refuse before transport');
  };
  await assert.rejects(
    () => missingClient.mutate('createThing', {
      args: { title: 'missing' },
      clientMutationId: 'cm-missing-redispatch',
    }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_OUTBOX_MUTATION_NOT_REPLAYABLE');
      assert.equal(error.mutationDisposition.status, 'unknown');
      assert.equal(error.effectCommitted, null);
      assert.equal(error.effectMayHaveCommitted, null);
      assert.equal(Object.hasOwn(error.diagnostic.details, 'effectCommitted'), false);
      assert.equal(Object.hasOwn(error.diagnostic.details, 'effectMayHaveCommitted'), false);
      return true;
    },
  );
});

test('malformed 2xx failure redispatch preserves possibly-committed durable provenance', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('https://outbox-malformed-success.example', {
    rqsStore: store,
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{ malformed-success', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const input = {
    args: { title: 'possibly-committed' },
    clientMutationId: 'cm-malformed-2xx-provenance',
  };
  await assert.rejects(
    () => client.mutate('createThing', input),
    (error) => {
      assert.equal(error.effectCommitted, null);
      assert.equal(error.effectMayHaveCommitted, true);
      return true;
    },
  );
  const [failed] = await store.outboxRecords();
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.effectProvenance, {
    effectCommitted: null,
    effectMayHaveCommitted: true,
  });
  const callsBeforeRedispatch = calls;
  await assert.rejects(
    () => client.mutate('createThing', input),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_OUTBOX_MUTATION_NOT_REPLAYABLE');
      assert.equal(error.effectCommitted, null);
      assert.equal(error.effectMayHaveCommitted, true);
      assert.equal(Object.hasOwn(error.diagnostic.details, 'effectCommitted'), false);
      assert.equal(error.diagnostic.details.effectMayHaveCommitted, true);
      return true;
    },
  );
  assert.equal(calls, callsBeforeRedispatch, 'redispatch uses durable proof without transport');
});

test('recreated file-backed client preserves result-gone without redelivery', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = mkdtempSync(join(tmpdir(), 'snapback-result-gone-relaunch-'));
  const firstStore = createFileRqsResumeStore({
    directory,
    identity: 'origin:result-gone-relaunch',
  });
  await firstStore.whenLockSettled();
  const target = await prepareCompleteReplayTarget(
    firstStore,
    'https://result-gone.example',
  );
  const firstClient = new SnapbackClient('https://result-gone.example', {
    rqsStore: firstStore,
  });
  globalThis.fetch = async () => Response.json({
    diagnostic: {
      code: 'SNAPBACK_OPERATION_RESULT_EXPIRED',
      message: 'the committed operation result payload was reclaimed',
      details: {
        disposition: 'result-expired',
        outcome: 'committed',
        receiptDigest: `sha256:${'f'.repeat(64)}`,
      },
    },
  }, { status: 410 });
  await assert.rejects(
    () => firstClient.mutate('createThing', {
      args: { title: 'restored-operation' },
      clientMutationId: 'cm-result-gone-relaunch',
    }),
    (error) => error.operationOutcome === 'committed' && error.operationResult === 'expired',
  );
  await firstStore.close();

  const reopenedStore = createFileRqsResumeStore({
    directory,
    identity: 'origin:result-gone-relaunch',
  });
  await reopenedStore.whenLockSettled();
  await reopenedStore.outboxEnqueue({
    id: 'cm-after-result-gone-relaunch',
    function: 'updateThing',
    ...target,
    args: { title: 'must remain fenced' },
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('result-gone relaunch must not dispatch');
  };
  const recreatedClient = new SnapbackClient('https://result-gone.example', {
    rqsStore: reopenedStore,
  });
  assert.deepEqual(
    { ...(await recreatedClient.outboxStatus()) },
    {
      supported: true, pending: 1, failed: 0, stranded: 0,
      quarantined: 0, resultGone: 1, replaying: false, drainMode: 'none',
      oldestPendingAtMs: (await reopenedStore.outboxRecords())
        .find((record) => record.status === 'pending').enqueuedAt,
      drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null, blockedReason: null,
    },
  );
  const replay = await recreatedClient.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: replay.replayed,
      failed: replay.failed,
      remaining: replay.remaining,
      stopped: replay.stopped,
      calls,
    },
    { replayed: 0, failed: 0, remaining: 2, stopped: true, calls: 0 },
  );
  const restored = (await reopenedStore.outboxRecords())
    .find((record) => record.id === 'cm-result-gone-relaunch');
  assert.equal(restored.status, 'result-gone');
  assert.equal(restored.resultGone.outcome, 'committed');
  assert.equal(restored.settlement, undefined, 'payload-gone never fabricates a settlement');
  await reopenedStore.close();
});

test('replay drop-and-mark-failed on server refusal, pending kept on connectivity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const a = await client.mutate('createThing', { args: { n: 1 } });
  const b = await client.mutate('createThing', { args: { n: 2 } });
  assert.equal(a.status, 'queued');
  assert.equal(b.status, 'queued');

  // First replay attempt: still offline -> stops with both records pending.
  const offline = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: offline.replayed, failed: offline.failed, remaining: offline.remaining },
    { replayed: 0, failed: 0, remaining: 2 },
  );

  // Reconnect: the first record is refused by the server (handler throw /
  // conflict class) -> dropped and marked failed, never retried; the second
  // still replays (LLP 0008 drop-and-mark-failed).
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json(
        {
          diagnostic: { code: 'SNAPBACK_MUTATION_CONFLICT', message: 'conflict' },
          receipt: { kind: 'mutation', outcome: 'REJECTED', mutationId: a.clientMutationId },
        },
        { status: 409 },
      );
    }
    return Response.json({ result: { ok: true }, version: 3 });
  };
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 1, failed: 1, remaining: 0 },
  );
  const failedRecord = (await store.outboxRecords()).find((r) => r.id === a.clientMutationId);
  assert.equal(failedRecord.status, 'failed', 'refused replay is visible failed client state');
  assert.equal(failedRecord.failure.code, 'SNAPBACK_MUTATION_CONFLICT');

  // queue:false restores fail-loud delivery.
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(
    () => client.mutate('createThing', { args: { n: 3 }, queue: false }),
    (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
  );
});

// Regression: 0137 A1-Expo f2 — connectivity classification must be transport
// provenance (the fetch dispatch itself rejected: no HTTP status, no server
// diagnostic, no receipt), not constructor identity. Expo/RN fetch rejects
// connection failures with a PLAIN Error, so the pre-fix
// `instanceof TypeError` gate meant the M2 queue could never engage on that
// carrier — the raw transport error surfaced instead of {status:'queued'}.
test('mutate queues when the carrier fetch rejects a plain Error (Expo shape)', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  // The exact witnessed Expo simulator rejection shape: name 'Error'.
  globalThis.fetch = async () => {
    throw new Error(
      'fetch failed: UnexpectedException: Could not connect to the server. '
      + '(at ExpoModulesCore/Promise.swift:56)',
    );
  };
  const queued = await client.mutate('createThing', { args: { title: 'expo-offline' } });
  assert.equal(queued.status, 'queued', 'Expo-shaped transport rejection engages the queue');
  assert.match(queued.clientMutationId, /^mut_[0-9a-hjkmnp-tv-z]{26}$/u);
  assert.equal(queued.sequence, 1);
  assert.equal((await store.outboxPending()).length, 1);

  // Replay drains it exactly like the undici-shaped path.
  const delivered = [];
  globalThis.fetch = async (_url, init) => {
    delivered.push(JSON.parse(init.body));
    return Response.json({ result: { ok: true }, version: 1 });
  };
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 1, failed: 0, remaining: 0 },
  );
  assert.equal(delivered[0].clientMutationId, queued.clientMutationId);
});

test('caller aborts and server answers are never classified as connectivity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  // A caller-owned abort is not an outage: fail loud, never enqueue.
  globalThis.fetch = async () => {
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    throw abort;
  };
  await assert.rejects(
    () => client.mutate('createThing', { args: { title: 'aborted' } }),
    (error) => isSnapbackDiagnosticError(error) && error.cause?.name === 'AbortError',
  );
  assert.equal((await store.outboxPending()).length, 0, 'abort did not enqueue');

  // A server-answered refusal keeps failing loud even with a plain-Error
  // carrier (the answered diagnostic is the proof the transport worked).
  globalThis.fetch = async () => Response.json(
    { diagnostic: { code: 'SNAPBACK_VALIDATION', message: 'bad args' } },
    { status: 400 },
  );
  await assert.rejects(
    () => client.mutate('createThing', { args: { bad: true } }),
    /SNAPBACK_VALIDATION/,
  );
  assert.equal((await store.outboxPending()).length, 0, 'refusal did not enqueue');
});

test('connectivity classification excludes custody and answered refusals', () => {
  const offlineQueueRefusal = new Error('offline queue disabled');
  offlineQueueRefusal.code = 'SNAPBACK_OFFLINE_QUEUE_DISABLED';
  offlineQueueRefusal.diagnostic = {
    code: 'SNAPBACK_OFFLINE_QUEUE_DISABLED',
    message: 'offline queue disabled',
  };
  const serverRefusal = new Error('server refused mutation');
  serverRefusal.status = 409;
  serverRefusal.diagnostic = {
    code: 'SNAPBACK_MUTATION_CONFLICT',
    message: 'conflict',
  };
  const dispatchFailure = new Error('fetch failed');
  dispatchFailure.fetchDispatchFailed = true;

  assert.equal(isConnectivityFailureError(outboxNotWriterError()), false);
  assert.equal(isConnectivityFailureError(offlineQueueRefusal), false);
  assert.equal(isConnectivityFailureError(serverRefusal), false);
  assert.equal(isConnectivityFailureError(dispatchFailure), true);
});

test('mutationStatus reports pending durable intent without inferring outcome-unknown', async () => {
  const store = createDurableTestStore();
  const target = await prepareCompleteReplayTarget(store, 'http://127.0.0.1:9');
  await store.outboxEnqueue({
    id: 'cm-status-pending', function: 'createThing', ...target,
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  const disposition = await client.mutationStatus('cm-status-pending');
  assert.equal(disposition.targetMatchesCurrent, true);
  assert.deepEqual(
    { ...disposition, timing: undefined, enqueueTarget: undefined, targetMatchesCurrent: undefined },
    {
      status: 'pending', blockedReason: null, timing: undefined,
      enqueueTarget: undefined, targetMatchesCurrent: undefined,
    },
  );
  assert.equal(Number.isSafeInteger(disposition.timing.enqueuedAtMs), true);
  assert.equal(Object.isFrozen(disposition), true);
});

test('restart settlement recovery reports settled with the complete retained payload', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const first = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const queued = await first.mutate('createThing', { args: { title: 'restart' } });
  const settlement = {
    version: 17,
    changed_count: 1,
    result: { id: 'thing_restart' },
    receipt: { kind: 'mutation', outcome: 'CONFIRMED' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  };
  globalThis.fetch = async () => Response.json(settlement);
  assert.equal((await first.replayQueuedMutations()).replayed, 1);

  const restarted = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  const disposition = await restarted.mutationStatus(queued.clientMutationId);
  assert.equal(disposition.status, 'settled');
  assert.deepEqual(disposition.settlement, settlement);
  assert.equal(Number.isSafeInteger(disposition.settledAt), true);
  assert.equal(Object.isFrozen(disposition), true);
  assert.equal(Object.isFrozen(disposition.settlement), true);
});

test('mutationStatus reports a retained terminal failure', async () => {
  const store = createDurableTestStore();
  const target = await prepareCompleteReplayTarget(store, 'http://127.0.0.1:9');
  await store.outboxEnqueue({ id: 'cm-status-failed', function: 'createThing', ...target });
  await store.outboxMarkFailed('cm-status-failed', {
    code: 'SNAPBACK_TEST_REFUSAL',
    message: 'fixture refusal',
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  const disposition = await client.mutationStatus('cm-status-failed');
  assert.equal(disposition.targetMatchesCurrent, true);
  assert.deepEqual({
    ...disposition,
    timing: undefined,
    enqueueTarget: undefined,
    targetMatchesCurrent: undefined,
  }, {
    status: 'failed',
    failure: { code: 'SNAPBACK_TEST_REFUSAL', message: 'fixture refusal' },
    timing: undefined,
    enqueueTarget: undefined,
    targetMatchesCurrent: undefined,
  });
  assert.equal(Number.isSafeInteger(disposition.timing.enqueuedAtMs), true);
});

test('mutationStatus reports a payload-free quarantined disposition', async () => {
  const store = createDurableTestStore();
  const target = await prepareCompleteReplayTarget(store, 'http://127.0.0.1:9');
  await store.outboxEnqueue({ id: 'cm-status-quarantined', function: 'createThing', ...target });
  await store.outboxMarkQuarantined('cm-status-quarantined', {
    code: 'SNAPBACK_TEST_UPGRADE_REQUIRED',
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  const disposition = await client.mutationStatus('cm-status-quarantined');
  assert.equal(disposition.targetMatchesCurrent, true);
  assert.deepEqual({
    ...disposition,
    timing: undefined,
    enqueueTarget: undefined,
    targetMatchesCurrent: undefined,
  }, {
    status: 'quarantined', timing: undefined,
    enqueueTarget: undefined, targetMatchesCurrent: undefined,
  });
});

test('mutationStatus maps result-gone and carries its retained outcome facts', async () => {
  const store = createDurableTestStore();
  const target = await prepareCompleteReplayTarget(store, 'http://127.0.0.1:9');
  await store.outboxEnqueue({ id: 'cm-status-result-gone', function: 'createThing', ...target });
  const receiptDigest = `sha256:${'d'.repeat(64)}`;
  await store.outboxMarkResultGone('cm-status-result-gone', {
    outcome: 'committed',
    receiptDigest,
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  const disposition = await client.mutationStatus('cm-status-result-gone');
  assert.equal(disposition.targetMatchesCurrent, true);
  assert.deepEqual({
    ...disposition,
    timing: undefined,
    enqueueTarget: undefined,
    targetMatchesCurrent: undefined,
  }, {
    status: 'resultGone',
    disposition: 'result-expired',
    outcome: 'committed',
    receiptDigest,
    timing: undefined,
    enqueueTarget: undefined,
    targetMatchesCurrent: undefined,
  });
});

test('result-gone acknowledgement is payload-free and releases its ordered-successor fence', async () => {
  const store = createDurableTestStore();
  const target = await prepareCompleteReplayTarget(store, 'http://127.0.0.1:9');
  await store.outboxEnqueue({ id: 'cm-ack-result-gone', function: 'createThing', ...target });
  await store.outboxMarkResultGone('cm-ack-result-gone', {
    outcome: 'committed',
    receiptDigest: `sha256:${'e'.repeat(64)}`,
  });
  await store.outboxEnqueue({
    id: 'cm-after-ack-result-gone', function: 'updateThing', ...target,
  });
  assert.equal(
    (await store.outboxPrepareSubmission('cm-after-ack-result-gone')).status,
    'blocked',
  );
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  assert.deepEqual(await client.acknowledgeResultGoneMutations(['cm-ack-result-gone']), {
    acknowledged: 1,
    clientMutationIds: ['cm-ack-result-gone'],
  });
  assert.equal((await client.mutationStatus('cm-ack-result-gone')).status, 'unknown');
  assert.equal(
    (await store.outboxPrepareSubmission('cm-after-ack-result-gone')).status,
    'ready',
  );
  await assert.rejects(
    () => client.acknowledgeResultGoneMutations(['cm-after-ack-result-gone']),
    (error) => error?.code === 'SNAPBACK_OUTBOX_RESULT_GONE_NOT_CURRENT',
  );
});

test('mutationStatus reports unknown after ACK consumption and collection', async () => {
  const store = createDurableTestStore();
  const target = await prepareCompleteReplayTarget(store, 'http://127.0.0.1:9');
  await store.outboxEnqueue({ id: 'cm-status-collected', function: 'createThing', ...target });
  await store.outboxDurablyConsume('cm-status-collected', {
    version: 1,
    changed_count: 1,
    result: { ok: true },
    receipt: { kind: 'mutation', outcome: 'CONFIRMED' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  assert.equal((await client.mutationStatus('cm-status-collected')).status, 'settled');
  await client.markMutationSettlementsConsumed(['cm-status-collected']);
  assert.equal(await store.outboxConfirmAcknowledgements(
    ['cm-status-collected'], undefined, undefined, null, target.enqueueTarget,
  ), 1);

  const disposition = await client.mutationStatus('cm-status-collected');
  assert.deepEqual({ ...disposition, timing: undefined }, { status: 'unknown', timing: undefined });
  assert.equal(Object.isFrozen(disposition), true);
});

test('subscribeMutation delivers current pending then settled during replay', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const queued = await client.mutate('createThing', { args: { title: 'subscribe' } });

  const statuses = [];
  let subscribing = true;
  const unsubscribe = client.subscribeMutation(queued.clientMutationId, (disposition) => {
    assert.equal(subscribing, false, 'initial mutation disposition is never sync-reentrant');
    statuses.push(disposition.status);
  });
  const unsubscribeThrowing = client.subscribeMutation(
    queued.clientMutationId,
    () => { throw new Error('observer failure'); },
  );
  assert.deepEqual(statuses, []);
  subscribing = false;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(statuses, ['pending']);

  globalThis.fetch = async () => Response.json({
    version: 2,
    changed_count: 1,
    result: { ok: true },
    receipt: { kind: 'mutation', outcome: 'CONFIRMED' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  assert.equal((await client.replayQueuedMutations()).replayed, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(statuses, ['pending', 'settled']);
  assert.equal((await client.mutationStatus(queued.clientMutationId)).status, 'settled');
  unsubscribe();
  unsubscribeThrowing();
});

test('subscribeMutation publishes target disposition changes while status stays pending', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const origin = 'https://mutation-subscription-target-replacement.example';
  const targetProfileId = 'mutation-subscription-target-profile';
  const generationA = Object.freeze({
    ...TEST_ARTIFACT_GENERATION,
    appId: 'mutation-subscription-target-app',
  });
  const generationB = Object.freeze({
    ...generationA,
    bundleHash: testDigest('d'),
  });
  await store.outboxEnqueue({
    id: 'cm-subscription-target-replacement',
    function: 'createThing',
    ...currentOutboxTarget({
      origin,
      targetProfileId,
      generation: generationA,
      generated: true,
    }),
    args: { title: 'belongs to generation A' },
  });
  await store.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId,
    artifactGeneration: generationA,
  });
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(generationA.appId);
  const dispositions = [];
  const unsubscribe = client.subscribeMutation(
    'cm-subscription-target-replacement',
    (disposition) => dispositions.push(disposition),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    dispositions.map(({ status, targetMatchesCurrent }) => ({ status, targetMatchesCurrent })),
    [{ status: 'pending', targetMatchesCurrent: true }],
  );

  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/inspect');
    return Response.json(offlineReplayInspection({
      supported: true,
      targetProfileId,
      generation: generationB,
    }));
  };
  await client.inspect();
  await new Promise((resolve) => setImmediate(resolve));
  unsubscribe();
  assert.deepEqual(
    dispositions.map(({ status, targetMatchesCurrent }) => ({ status, targetMatchesCurrent })),
    [
      { status: 'pending', targetMatchesCurrent: true },
      { status: 'unknown', targetMatchesCurrent: undefined },
    ],
    'capability replacement publishes the foreign-id no-op disposition',
  );
  await client.close();
  await store.close();
});

test('mutation observation never consumes settlement or changes ACK eligibility', async () => {
  const store = createDurableTestStore();
  const target = await prepareCompleteReplayTarget(store, 'http://127.0.0.1:9');
  await store.outboxEnqueue({ id: 'cm-status-observed', function: 'createThing', ...target });
  await store.outboxDurablyConsume('cm-status-observed', {
    version: 3,
    changed_count: 1,
    result: { observed: true },
    receipt: { kind: 'mutation', outcome: 'CONFIRMED' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  const recoveredBefore = await client.settledMutations();
  assert.deepEqual(await store.outboxPendingAcknowledgements(null, 64), []);

  assert.equal((await client.mutationStatus('cm-status-observed')).status, 'settled');
  const observed = [];
  const unsubscribe = client.subscribeMutation(
    'cm-status-observed',
    (disposition) => observed.push(disposition.status),
  );
  await new Promise((resolve) => setImmediate(resolve));
  unsubscribe();
  assert.deepEqual(observed, ['settled']);
  assert.deepEqual(await client.settledMutations(), recoveredBefore);
  assert.deepEqual(await store.outboxPendingAcknowledgements(null, 64), []);

  await client.markMutationSettlementsConsumed(['cm-status-observed']);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      null, 64, TEST_AUTHORITY_DESCRIPTOR, target.enqueueTarget,
    ),
    ['cm-status-observed'],
  );
});

test('outboxStatus and subscribeOutbox project the queue facts (LLP 0114 React-arm seam)', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await commitCompleteReplayCapability(store, 'http://127.0.0.1:9');
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  // No outbox-capable store -> supported: false, never a guessed empty queue.
  const disabled = new SnapbackClient('http://127.0.0.1:9', { rqsStore: null });
  assert.deepEqual(
    { ...(await disabled.outboxStatus()) },
    {
      supported: false, pending: 0, failed: 0, stranded: 0,
      quarantined: 0, resultGone: 0, replaying: false, drainMode: 'none',
      oldestPendingAtMs: null, drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null,
      blockedReason: null,
    },
  );

  const events = [];
  const unsubscribe = client.subscribeOutbox(() => events.push('event'));
  assert.deepEqual(
    { ...(await client.outboxStatus()) },
    {
      supported: true, pending: 0, failed: 0, stranded: 0,
      quarantined: 0, resultGone: 0, replaying: false, drainMode: 'none',
      oldestPendingAtMs: null, drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null,
      blockedReason: null,
    },
  );

  // Queue two intents offline: each transition notifies subscribers.
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const a = await client.mutate('createThing', { args: { n: 1 } });
  await client.mutate('createThing', { args: { n: 2 } });
  assert(events.length >= 2, 'queue transitions notified subscribers');
  const queuedStatus = await client.outboxStatus();
  const oldestPendingAtMs = Math.min(...(await store.outboxPending())
    .map((record) => record.enqueuedAt));
  assert.deepEqual(
    { ...queuedStatus },
    {
      supported: true, pending: 2, failed: 0, stranded: 0,
      quarantined: 0, resultGone: 0, replaying: false, drainMode: 'none',
      oldestPendingAtMs, drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null,
      blockedReason: null,
    },
  );

  // Replay: first record refused (drop-and-mark-failed), second settles.
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json(
        {
          diagnostic: { code: 'SNAPBACK_MUTATION_CONFLICT', message: 'conflict' },
          receipt: { kind: 'mutation', outcome: 'REJECTED', mutationId: a.clientMutationId },
        },
        { status: 409 },
      );
    }
    return Response.json({ result: { ok: true }, version: 3 });
  };
  const drained = events.length;
  const replayTask = client.replayQueuedMutations();
  assert.equal(
    (await client.outboxStatus()).replaying,
    true,
    'the single-flight drain is visible while it runs',
  );
  assert.equal((await client.outboxStatus()).drainPhase, 'replaying');
  await replayTask;
  assert(events.length > drained, 'replay transitions notified subscribers');
  assert.deepEqual(
    { ...(await client.outboxStatus()) },
    {
      supported: true, pending: 0, failed: 1, stranded: 0,
      quarantined: 0, resultGone: 0, replaying: false, drainMode: 'none',
      oldestPendingAtMs: null, drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null,
      blockedReason: null,
    },
    'failed records stay visible; settled records leave the counts',
  );

  unsubscribe();
  const afterUnsubscribe = events.length;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await client.mutate('createThing', { args: { n: 3 } });
  assert.equal(events.length, afterUnsubscribe, 'unsubscribed listeners hear nothing');
});

console.log('snapback client outbox store tests pass');
