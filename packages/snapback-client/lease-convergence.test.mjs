import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMemorySnapbackClientStore } from '@expo/snapback-contract/client-store';

import {
  SNAPBACK_LEASE_CONVERGENCE_CONNECTION_REQUIRED,
  SNAPBACK_LEASE_CONVERGENCE_PENDING_INTENT,
  createLeaseConvergenceCoordinator,
} from './lease-convergence.mjs';
import { createMaterializationTestHarness } from './materialization-test-support.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const AUTHORITY_INSTANCE = '018f0d90-7b12-7a22-8c33-445566778899';
const USER = '018f0d90-7b13-7a22-8c33-445566778899';
const AUTHORITY_KEY = `sha256:${'a'.repeat(64)}`;
const QUERY_KEY = 'legacyLease:{"id":"one"}';
const VERSION_STREAM = 'stream_1';
const ACTIVATION_HASH = `snapback.authorized-lease.activation.v1:sha256:${'a'.repeat(64)}`;
const APP_ID = 'lease-convergence';
const TARGET_PROFILE_ID = 'local-dev-sqlite-ibex';
const EXPECTED = { authorityEpoch: 0, authorityKey: AUTHORITY_KEY };
const AUTHORIZATION = { incarnation: INCARNATION, epoch: 0 };
const ISSUER = {
  authorizationIncarnation: INCARNATION,
  bootSequence: 1,
  bootNonce: 'AAAAAAAAAAAAAAAAAAAAAA',
};
const AUTHORITY_DESCRIPTOR = {
  descriptorVersion: 1,
  authorityInstanceId: AUTHORITY_INSTANCE,
  sessionGeneration: 1,
};

async function createPredecessor({ pendingIntent = false } = {}) {
  const store = createMemorySnapbackClientStore();
  await store.bindAuthority({ authorityEpoch: 0, authorityKey: AUTHORITY_KEY });
  await store.scopeToArtifacts({
    appId: APP_ID,
    targetProfileId: TARGET_PROFILE_ID,
    versionStreamId: VERSION_STREAM,
  }, EXPECTED);
  await store.scopeAuthorization({
    principalScope: {
      authMode: 'sessions',
      authorizationStreamIncarnation: INCARNATION,
      userId: USER,
    },
    authorityDescriptor: AUTHORITY_DESCRIPTOR,
  }, EXPECTED);
  const initialized = await store.initializeAuthorizedRetainedQuery(QUERY_KEY, {
    authorization: AUTHORIZATION,
    issuerId: ISSUER,
    versionStream: VERSION_STREAM,
    principalId: USER,
    activationHash: ACTIVATION_HASH,
    appId: APP_ID,
    targetProfileId: TARGET_PROFILE_ID,
  }, EXPECTED);
  const request = await store.beginAuthorizedLeaseRequest(QUERY_KEY, {
    fence: initialized.fence,
    leaseRequestId: 'lease-request-1',
    clientNowMs: 1_000,
  }, EXPECTED);
  const committed = await store.commitAuthorizedRetainedSnapshot(QUERY_KEY, {
    fence: request.fence,
    lease: {
      protocolVersion: 1,
      leaseId: 'lease-1',
      leaseRequestId: request.request.leaseRequestId,
      issuerId: ISSUER,
      clientStoreId: initialized.namespace.clientStoreId,
      queryKey: QUERY_KEY,
      queryInstanceId: initialized.namespace.queryInstanceId,
      principalId: USER,
      sessionIdAtIssue: 'session-1',
      providerKey: 'email-code',
      authorization: AUTHORIZATION,
      data: { versionStream: VERSION_STREAM, snapshotCommitVersion: 7 },
      activationHash: ACTIVATION_HASH,
      issuedAtServerMs: 10_000,
      authorizedUntilServerMs: 11_000,
      sessionNotAfterMs: 11_000,
      providerNotAfterMs: null,
      authorityInstanceId: AUTHORITY_INSTANCE,
      keyId: 'lease-key-1',
      mac: 'A'.repeat(43),
    },
    record: {
      rows: [{ source: 'legacy-predecessor' }],
      version: 7,
      versionStreamId: VERSION_STREAM,
      cursor: { stream: VERSION_STREAM, version: 7 },
    },
    clientNowMs: 1_001,
  }, EXPECTED);

  let queued = null;
  let queueCapture = null;
  if (pendingIntent) {
    queueCapture = await store.captureMutationQueue(EXPECTED);
    queued = await store.enqueueMutation({
      id: 'dependent-intent-1',
      function: 'mutateLegacyResult',
      dependsOnQueryInstanceIds: [initialized.namespace.queryInstanceId],
      authorityDescriptor: AUTHORITY_DESCRIPTOR,
      appId: APP_ID,
      targetProfileId: TARGET_PROFILE_ID,
      versionStreamId: VERSION_STREAM,
      cursor: { stream: VERSION_STREAM, version: 7 },
      ...EXPECTED,
      ...queueCapture,
    });
  }

  return {
    store,
    committed,
    predecessor: {
      queryKey: QUERY_KEY,
      queryInstanceId: initialized.namespace.queryInstanceId,
    },
    queued,
    queueCapture,
  };
}

async function createScenario({ pendingIntent = false, crashAfter = null } = {}) {
  const predecessorFixture = await createPredecessor({ pendingIntent });
  const successorHandle = createMemoryRqsResumeStore({ clientStoreId: 'client-store-1' });
  await successorHandle.whenLockSettled();
  const successorHarness = await createMaterializationTestHarness(
    successorHandle,
    `lease-convergence-${crashAfter ?? 'normal'}-${pendingIntent}`,
  );
  let successorRecord = null;
  let pendingCrash = crashAfter;
  let activeArtifact = null;
  const commits = [];

  const runOwnerOperation = async (artifact, name, operation) => {
    assert.equal(activeArtifact, null, 'owner commits must never nest across artifacts');
    activeArtifact = artifact;
    try {
      const value = await operation();
      commits.push(`${artifact}:${name}`);
      if (pendingCrash === name) {
        pendingCrash = null;
        const error = new Error(`simulated crash after ${name}`);
        error.code = 'SNAPBACK_TEST_SIMULATED_CRASH';
        throw error;
      }
      return value;
    } finally {
      activeArtifact = null;
    }
  };

  const leaseOwner = {
    hasDependentPendingIntent: (predecessor) => runOwnerOperation(
      'lease',
      'pending-check',
      async () => {
        const state = await predecessorFixture.store.snapshot();
        if (pendingCrash === 'before-begin') {
          pendingCrash = null;
          const error = new Error('simulated crash before begin');
          error.code = 'SNAPBACK_TEST_SIMULATED_CRASH';
          throw error;
        }
        return state.pending.some((intent) => (
          intent.dependsOnQueryInstanceIds?.includes(predecessor.queryInstanceId)
        ));
      },
    ),
    beginTerminalRetirement: (predecessor) => runOwnerOperation(
      'lease',
      'begin',
      async () => {
        const state = await predecessorFixture.store.snapshot();
        const query = state.queryAuthorization[predecessor.queryKey];
        if (!query) {
          return { phase: 'absent', queryInstanceId: predecessor.queryInstanceId };
        }
        assert.equal(query.queryInstanceId, predecessor.queryInstanceId);
        if (query.lifecycle === 'retiring') {
          return {
            phase: 'retiring',
            queryInstanceId: query.queryInstanceId,
            fence: {
              queryInstanceId: query.queryInstanceId,
              authorityGeneration: query.authorityGeneration,
              queryGeneration: query.queryGeneration,
              authorityInstanceId: query.authorityInstanceId,
            },
          };
        }
        const capture = await predecessorFixture.store.captureAuthorizedRetainedQuery(
          predecessor.queryKey,
          EXPECTED,
        );
        const begun = await predecessorFixture.store.beginAuthorizedQueryRetirement(
          predecessor.queryKey,
          capture.fence,
          EXPECTED,
        );
        return { phase: 'retiring', ...begun };
      },
    ),
    finalizeRetirement: ({ predecessor, retirement }) => runOwnerOperation(
      'lease',
      'finalize',
      () => predecessorFixture.store.finishAuthorizedQueryRetirement(
        predecessor.queryKey,
        retirement.queryInstanceId,
        EXPECTED,
      ),
    ),
  };
  const successorOwner = {
    establishFreshSuccessor: () => runOwnerOperation(
      'successor',
      'successor',
      async () => {
        successorRecord = await successorHarness.establish();
        return {
          address: successorHarness.address,
          fence: successorHarness.fence(successorRecord),
        };
      },
    ),
  };
  const coordinator = createLeaseConvergenceCoordinator({ leaseOwner, successorOwner });

  const renderState = async () => {
    const leaseState = await predecessorFixture.store.snapshot();
    const query = leaseState.queryAuthorization[QUERY_KEY];
    const predecessorRenderable = query?.lifecycle === 'active'
      && leaseState.retained[QUERY_KEY] !== undefined;
    const successorBytes = successorRecord === null
      ? null
      : await successorHarness.store.readOpaqueSnapshot(
        successorHarness.address,
        successorHarness.fence(successorRecord),
      );
    return {
      predecessor: predecessorRenderable,
      successor: successorBytes !== null,
      count: Number(predecessorRenderable) + Number(successorBytes !== null),
    };
  };

  return {
    ...predecessorFixture,
    close: () => successorHandle.close(),
    commits,
    coordinator,
    renderState,
    successor: { address: successorHarness.address },
  };
}

for (const cut of ['before-begin', 'begin', 'successor', 'finalize']) {
  test(`S5 convergence resumes monotonically after crash cut ${cut}`, async (t) => {
    const scenario = await createScenario({ crashAfter: cut });
    t.after(scenario.close);
    assert.deepEqual(await scenario.renderState(), {
      predecessor: true,
      successor: false,
      count: 1,
    });

    await assert.rejects(
      scenario.coordinator.converge({
        connected: true,
        predecessor: scenario.predecessor,
        successor: scenario.successor,
      }),
      { code: 'SNAPBACK_TEST_SIMULATED_CRASH' },
    );
    const atCut = await scenario.renderState();
    if (cut === 'before-begin') {
      assert.deepEqual(atCut, { predecessor: true, successor: false, count: 1 });
    } else if (cut === 'begin') {
      assert.deepEqual(atCut, { predecessor: false, successor: false, count: 0 });
    } else {
      assert.deepEqual(atCut, { predecessor: false, successor: true, count: 1 });
    }
    assert.ok(atCut.count <= 1, 'no crash cut may make both artifacts renderable');

    const converged = await scenario.coordinator.converge({
      connected: true,
      predecessor: scenario.predecessor,
      successor: scenario.successor,
    });
    assert.equal(converged.status, 'converged');
    assert.deepEqual(await scenario.renderState(), {
      predecessor: false,
      successor: true,
      count: 1,
    });

    // A completed attempt is repeatable without reviving the predecessor or
    // publishing a distinct successor instance.
    await scenario.coordinator.converge({
      connected: true,
      predecessor: scenario.predecessor,
      successor: scenario.successor,
    });
    assert.deepEqual(await scenario.renderState(), {
      predecessor: false,
      successor: true,
      count: 1,
    });
    assert.equal(scenario.commits.some((entry) => entry === 'lease:begin'), true);
    assert.equal(scenario.commits.some((entry) => entry === 'successor:successor'), true);
    assert.equal(scenario.commits.some((entry) => entry === 'lease:finalize'), true);
    assert.ok(
      scenario.commits.indexOf('lease:begin')
        < scenario.commits.indexOf('successor:successor'),
      'the lease artifact commits non-renderability before successor publication',
    );
    assert.ok(
      scenario.commits.indexOf('successor:successor')
        < scenario.commits.indexOf('lease:finalize'),
      'final retirement follows the independently committed successor',
    );
  });
}

test('S5 pending-intent and connectivity refusals touch neither intent nor owner state', async (t) => {
  const scenario = await createScenario({ pendingIntent: true });
  t.after(scenario.close);
  const before = await scenario.store.snapshot();

  await assert.rejects(
    scenario.coordinator.converge({
      connected: false,
      predecessor: scenario.predecessor,
      successor: scenario.successor,
    }),
    { code: SNAPBACK_LEASE_CONVERGENCE_CONNECTION_REQUIRED },
  );
  assert.deepEqual(await scenario.store.snapshot(), before);

  await assert.rejects(
    scenario.coordinator.converge({
      connected: true,
      predecessor: scenario.predecessor,
      successor: scenario.successor,
    }),
    { code: SNAPBACK_LEASE_CONVERGENCE_PENDING_INTENT },
  );
  assert.deepEqual(await scenario.store.snapshot(), before);
  assert.deepEqual(await scenario.renderState(), {
    predecessor: true,
    successor: false,
    count: 1,
  });

  await scenario.store.settleMutation(scenario.queued.id, {
    status: 'confirmed',
    output: { ok: true },
    ...EXPECTED,
    ...scenario.queueCapture,
  });
  await scenario.coordinator.converge({
    connected: true,
    predecessor: scenario.predecessor,
    successor: scenario.successor,
  });
  assert.deepEqual(await scenario.renderState(), {
    predecessor: false,
    successor: true,
    count: 1,
  });
});
