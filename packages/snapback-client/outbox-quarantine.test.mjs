import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SnapbackClient as InspectingSnapbackClient } from './index.mjs';
import {
  emptyOutboxState,
  OUTBOX_MAX_RECORDS,
  outboxOps,
} from './outbox-shared.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

class SnapbackClient extends InspectingSnapbackClient {
  constructor(baseUrl, options = {}) {
    super(baseUrl, {
      __offlineMutationReplayCapability: true,
      __outboxDrainLifecycle: false,
      ...options,
    });
  }
}

const originalFetch = globalThis.fetch;

const createDurableTestStore = () => {
  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'memory-test-double', durable: true });
  return store;
};

const queueQuarantineFixture = async (client) => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const mint = await client.mutate('mintParent', {
    args: { privateTitle: 'SECRET_PARENT_PAYLOAD' },
    settlementLane: 'replay-accept',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-parent', site: 'insert:parents:id', occurrence: 0 }],
    },
  });
  const dependent = await client.mutate('attachChild', {
    args: { parentId: 'spec-parent', privateNote: 'SECRET_DEPENDENT_PAYLOAD' },
    settlementLane: 're-derive',
  });
  const independent = await client.mutate('renameWorkspace', {
    args: { name: 'SECRET_INDEPENDENT_PAYLOAD' },
  });
  return { mint, dependent, independent };
};

test('upgrade-required replay quarantines every pending intent as a redacted tombstone', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  const queued = await queueQuarantineFixture(client);

  let submissions = 0;
  globalThis.fetch = async () => {
    submissions += 1;
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
        message: 'successor-only publication requires new client artifacts',
      },
    }, { status: 409 });
  };

  // @ref LLP 0081#4-execution-journaling-and-crash-recovery — an incompatible
  //   replay becomes observable tombstones, never failed/dropped records.
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: outcome.replayed,
      failed: outcome.failed,
      quarantined: outcome.quarantined,
      remaining: outcome.remaining,
      stopped: outcome.stopped,
    },
    { replayed: 0, failed: 0, quarantined: 3, remaining: 3, stopped: true },
  );
  assert.equal(submissions, 1, 'upgrade refusal stops the incompatible drain');
  assert.deepEqual(await store.outboxPending(), [], 'quarantined intents are never pending replay');
  assert.equal(await store.outboxEmpty(), false, 'quarantine remains a resync/submission fence');

  const tombstones = await client.quarantinedMutations();
  assert.deepEqual(
    tombstones.map((entry) => [entry.clientMutationId, entry.quarantineDisposition]),
    [
      [queued.mint.clientMutationId, 'upgrade-required-refusal'],
      [queued.dependent.clientMutationId, 'dependent'],
      [queued.independent.clientMutationId, 'compatibility-unclassified'],
    ],
  );
  for (const tombstone of tombstones) {
    assert.equal(tombstone.format, 'snapback.outbox-quarantine-tombstone.v1');
    assert.equal(tombstone.status, 'quarantined');
    assert.equal(tombstone.refusalCode, 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED');
    assert.deepEqual(tombstone.provenance, {
      source: 'server-replay-refusal',
      payload: 'redacted',
    });
    for (const privateField of [
      'args',
      'userId',
      'readSet',
      'correlation',
      'authorityDescriptor',
      'expectedGeneration',
      'settlementClaims',
      'optimisticOperation',
      'quarantine',
    ]) assert.equal(Object.hasOwn(tombstone, privateField), false, privateField);
  }
  const observable = JSON.stringify(await store.outboxRecords());
  assert.doesNotMatch(observable, /SECRET_|spec-parent/u, 'observable store records leak no payload values');

  const second = await client.replayQueuedMutations();
  assert.equal(second.replayed, 0);
  assert.equal(second.remaining, 3);
  assert.equal(submissions, 1, 'a quarantined intent never silently re-enters transport');
  assert.equal(client.outboxDiagnostics.at(-1)?.code, 'SNAPBACK_OFFLINE_MUTATIONS_QUARANTINED');
  assert.equal((await client.outboxStatus()).quarantined, 3);
});

test('explicit successor re-entry restores pending payloads and drains each identity once', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  const queued = await queueQuarantineFixture(client);

  globalThis.fetch = async () => Response.json({
    diagnostic: {
      code: 'SNAPBACK_SUCCESSOR_SCHEMA_UPGRADE_REQUIRED',
      message: 'upgrade required',
    },
  }, { status: 409 });
  await client.replayQueuedMutations();

  const reentry = await client.reenterQuarantinedMutations();
  assert.deepEqual(reentry, {
    reentered: 3,
    clientMutationIds: [
      queued.mint.clientMutationId,
      queued.dependent.clientMutationId,
      queued.independent.clientMutationId,
    ],
  });
  assert.deepEqual(await client.quarantinedMutations(), []);
  const pending = await store.outboxPending();
  assert.deepEqual(pending.map((record) => record.id), reentry.clientMutationIds);
  assert.deepEqual(pending.map((record) => record.args), [
    { privateTitle: 'SECRET_PARENT_PAYLOAD' },
    { parentId: 'spec-parent', privateNote: 'SECRET_DEPENDENT_PAYLOAD' },
    { name: 'SECRET_INDEPENDENT_PAYLOAD' },
  ], 'the private durable intents return unchanged to the pending lane');

  const executions = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    executions.push(body.clientMutationId);
    return Response.json({ result: { ok: true }, version: executions.length });
  };
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: replay.replayed, failed: replay.failed, remaining: replay.remaining },
    { replayed: 3, failed: 0, remaining: 0 },
  );
  await client.replayQueuedMutations();
  assert.deepEqual(executions, reentry.clientMutationIds, 'each durable identity executes exactly once');
  assert.equal(client.outboxDiagnostics.at(-1)?.code, 'SNAPBACK_OFFLINE_MUTATION_REPLAYED');
});

test('non-upgrade replay refusal remains drop-and-mark-failed', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const queued = await client.mutate('createThing', { args: { bad: true } });

  globalThis.fetch = async () => Response.json({
    diagnostic: { code: 'SNAPBACK_VALIDATION', message: 'bad args' },
  }, { status: 400 });
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { failed: outcome.failed, quarantined: outcome.quarantined, remaining: outcome.remaining },
    { failed: 1, quarantined: 0, remaining: 0 },
  );
  const record = (await store.outboxRecords()).find((entry) => entry.id === queued.clientMutationId);
  assert.equal(record.status, 'failed');
  assert.equal(record.failure.code, 'SNAPBACK_VALIDATION');
  assert.deepEqual(await client.quarantinedMutations(), []);
});

test('quarantined records retain the unchanged 1024-record capacity bound', () => {
  let state = emptyOutboxState();
  for (let index = 0; index < OUTBOX_MAX_RECORDS; index += 1) {
    state = outboxOps.enqueue(state, {
      id: `cm-cap-${index}`,
      function: 'boundedMutation',
      args: { index },
    }, index).state;
  }
  const quarantined = outboxOps.markQuarantined(
    state,
    'cm-cap-0',
    { code: 'SNAPBACK_UPGRADE_REQUIRED' },
    OUTBOX_MAX_RECORDS,
  );
  assert.equal(quarantined.result.count, OUTBOX_MAX_RECORDS);
  assert.equal(Object.keys(quarantined.state.records).length, OUTBOX_MAX_RECORDS);
  assert.throws(
    () => outboxOps.enqueue(quarantined.state, {
      id: 'cm-cap-overflow',
      function: 'boundedMutation',
    }, OUTBOX_MAX_RECORDS + 1),
    (error) => error.code === 'SNAPBACK_OUTBOX_FULL',
  );
});
