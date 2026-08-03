import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createRegistrationLedger,
  DURABLE_REGISTRATION_BYTE_CEILING,
  DURABLE_REGISTRATION_RECORD_CEILING,
  prepareQueryRegistrationV1,
} from './registration-ledger.mjs';
import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from './rqs-store-memory.mjs';

const CLIENT_STORE_ID = 'registration-ledger-test-store';
const PARTITION = `sha256:${'1'.repeat(64)}`;
const PAGE_SET = Object.freeze({ kind: 'page-set', from: 'first', through: 'terminal' });
const page = (label) => ({
  kind: 'page',
  input: label === 'first'
    ? { kind: 'first' }
    : { kind: 'cursor', profileId: 'relational-query.v1', digest: `sha256:${label.repeat(64)}` },
});
const qmk = (index) => `qmk1.${String.fromCharCode(65 + (index % 26)).repeat(43)}`;

function registration({
  id,
  source = 'active',
  context = 'context-1',
  address = null,
  scope = PAGE_SET,
  retentionRequest = 'durable',
  idleTtlClass = 'default',
  args = {},
} = {}) {
  const ownerContext = source === 'active'
    ? { kind: 'subscription', contextId: context }
    : source === 'preload'
      ? { kind: 'route', routeId: context }
      : { kind: 'api', label: context };
  return {
    format: 'snapback.query-registration.v1',
    registrationId: id,
    source,
    ownerContext,
    functionReference: address === null
      ? { name: 'listTodos' }
      : { name: `query${id}`, materializationKey: address },
    canonicalArgs: args,
    requestedScope: scope,
    retentionRequest,
    idleTtlClass,
  };
}

async function memoryLedger(options = {}) {
  const backing = options.backing ?? createMemoryRqsStoreBacking({ clientStoreId: CLIENT_STORE_ID });
  const store = createMemoryRqsResumeStore({ backing });
  await store.whenLockSettled();
  const ledger = await createRegistrationLedger({
    storeHandle: store,
    clientStoreId: CLIENT_STORE_ID,
    materializationStore: options.materializationStore ?? null,
    now: options.now,
  });
  return { backing, store, ledger };
}

test('S1 registration record is closed and source x ownerContext pairing refuses exactly', () => {
  const valid = registration({ id: 'active-1' });
  assert.deepEqual(prepareQueryRegistrationV1(valid), valid);
  assert.throws(
    () => prepareQueryRegistrationV1({ ...valid, priority: 'high' }),
    { code: 'SNAPBACK_QUERY_REGISTRATION_INVALID' },
  );
  assert.throws(
    () => prepareQueryRegistrationV1({
      ...valid,
      ownerContext: { kind: 'route', routeId: 'route-1' },
    }),
    { code: 'SNAPBACK_QUERY_REGISTRATION_SOURCE_OWNER_MISMATCH' },
  );
});

test('S1 qmk1 and grandfathered legacy registrations resolve into one exact sync set', async (t) => {
  const { store, ledger } = await memoryLedger();
  t.after(() => store.close());
  const materializationKey = qmk(0);
  const active = registration({ id: 'qmk-active', address: materializationKey });
  const legacy = registration({ id: 'legacy-active' });
  assert.deepEqual(ledger.applyContextDemands({
    contextId: 'context-1', authorityPartitionDigest: PARTITION, revision: 1,
    demands: [active, legacy],
  }), { applied: true });
  const entries = ledger.registrations();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.resolution.family).sort(), ['legacy-resume', 'qmk1']);
  assert.equal(ledger.demandState(materializationKey), 'demanded-active');
  assert.equal(ledger.effectivePolicy(materializationKey).retentionRequest, 'durable');
  assert.deepEqual(ledger.applyContextDemands({
    contextId: 'context-1', authorityPartitionDigest: PARTITION, revision: 1,
    demands: [],
  }), { applied: false }, 'a stale full-set announce changes nothing');
});

test('S1 source durability is exact across restart', async () => {
  const backing = createMemoryRqsStoreBacking({ clientStoreId: CLIENT_STORE_ID });
  const first = await memoryLedger({ backing });
  const active = registration({ id: 'active-restart' });
  const preload = registration({ id: 'preload-restart', source: 'preload', context: 'route-1' });
  const durable = registration({ id: 'durable-restart', source: 'programmatic', context: 'saved' });
  first.ledger.applyContextDemands({
    contextId: 'context-1', authorityPartitionDigest: PARTITION, revision: 1,
    demands: [active, preload],
  });
  assert.deepEqual(await first.ledger.registerDurable(durable), { committed: true });
  await first.store.close();

  const second = await memoryLedger({ backing });
  assert.deepEqual(
    second.ledger.registrations().map((entry) => entry.registration.registrationId),
    ['durable-restart'],
    'active is volatile and preload is manifest-derived; only programmatic reloads',
  );
  second.ledger.applyContextDemands({
    contextId: 'boot-2', authorityPartitionDigest: PARTITION, revision: 1,
    demands: [registration({ id: 'preload-boot-2', source: 'preload', context: 'route-1' })],
  });
  assert.equal(second.ledger.registrations().length, 2, 'boot re-derives preload demand');
  await second.store.close();
});

test('S1 durable registration caps refuse the 513th and a >16 KiB record without mutation', async (t) => {
  const { store, ledger } = await memoryLedger();
  t.after(() => store.close());
  for (let index = 0; index < DURABLE_REGISTRATION_RECORD_CEILING; index += 1) {
    const outcome = await ledger.registerDurable(registration({
      id: `durable-${index}`,
      source: 'programmatic',
      context: null,
      args: { index },
    }));
    assert.deepEqual(outcome, { committed: true });
  }
  assert.deepEqual(
    await ledger.registerDurable(registration({
      id: 'durable-513', source: 'programmatic', context: null,
    })),
    { refused: { code: 'SNAPBACK_QUERY_REGISTRATION_LIMIT' } },
  );
  assert.equal(ledger.registrations().length, DURABLE_REGISTRATION_RECORD_CEILING);
  await ledger.releaseDurable({ registrationId: 'durable-0' });
  const oversize = registration({
    id: 'durable-oversize',
    source: 'programmatic',
    context: null,
    args: { payload: 'x'.repeat(DURABLE_REGISTRATION_BYTE_CEILING) },
  });
  assert.deepEqual(
    await ledger.registerDurable(oversize),
    { refused: { code: 'SNAPBACK_QUERY_REGISTRATION_BYTES_LIMIT' } },
  );
  assert.equal(ledger.registrations().length, DURABLE_REGISTRATION_RECORD_CEILING - 1);
});

test('S1 merge lattice, final-release two-axis pin, and durable-to-volatile transition are exact', async (t) => {
  const { store, ledger } = await memoryLedger();
  t.after(() => store.close());
  const address = qmk(1);
  const pinned = registration({
    id: 'pinned', address, retentionRequest: 'durable', idleTtlClass: 'pinned',
  });
  const volatile = registration({
    id: 'volatile', address, retentionRequest: 'none', idleTtlClass: 'default',
  });
  ledger.applyContextDemands({
    contextId: 'context-1', authorityPartitionDigest: PARTITION, revision: 1,
    demands: [pinned, volatile],
  });
  assert.deepEqual(ledger.effectivePolicy(address), {
    retentionRequest: 'durable', idleTtlClass: 'pinned', demandState: 'demanded-active',
  });
  ledger.applyContextDemands({
    contextId: 'context-1', authorityPartitionDigest: PARTITION, revision: 2,
    demands: [volatile],
  });
  assert.deepEqual(ledger.effectivePolicy(address), {
    retentionRequest: 'none', idleTtlClass: 'default', demandState: 'demanded-active',
  });
  assert.equal(ledger.retentionTransition(address), 'pending-payload-reclaim');
  ledger.applyContextDemands({
    contextId: 'context-1', authorityPartitionDigest: PARTITION, revision: 3,
    demands: [],
  });
  assert.deepEqual(ledger.effectivePolicy(address), {
    retentionRequest: 'none', idleTtlClass: 'default', demandState: 'undemanded',
  }, 'final release pins both axes from the final one-record set');
});

test('S1 scope serialization gives page-set precedence and marks superseded page demands unknown', async (t) => {
  const { store, ledger } = await memoryLedger();
  t.after(() => store.close());
  const address = qmk(2);
  const first = registration({ id: 'page-first', address, scope: page('first') });
  const next = registration({ id: 'page-next', address, scope: page('a') });
  ledger.applyContextDemands({
    contextId: 'context-1', authorityPartitionDigest: PARTITION, revision: 1,
    demands: [first, next],
  });
  assert.deepEqual(ledger.scopeState(address), {
    effectiveScope: page('a'), supersededRegistrationIds: ['page-first'],
  });
  const whole = registration({ id: 'whole', address, scope: PAGE_SET });
  ledger.applyContextDemands({
    contextId: 'context-1', authorityPartitionDigest: PARTITION, revision: 2,
    demands: [first, next, whole],
  });
  assert.deepEqual(ledger.scopeState(address).effectiveScope, PAGE_SET);
  assert.deepEqual(
    ledger.scopeState(address).supersededRegistrationIds,
    ['page-first', 'page-next'],
  );
});

test('S1 hydration calls L2 beginEstablishment with a four-attempt bound', async (t) => {
  let concurrent = 0;
  let maximum = 0;
  const gates = [];
  const materializationStore = {
    observeMaterialization(address, listener) {
      listener({
        present: true,
        generation: { queryInstanceId: Number(address[2].charCodeAt(5)), authorityGeneration: 0, queryGeneration: 0 },
      });
      return () => {};
    },
    async beginEstablishment() {
      concurrent += 1;
      maximum = Math.max(maximum, concurrent);
      await new Promise((resolve) => gates.push(resolve));
      concurrent -= 1;
    },
  };
  const { store, ledger } = await memoryLedger({ materializationStore });
  t.after(() => store.close());
  const demands = Array.from({ length: 6 }, (_, index) => registration({
    id: `hydrate-${index}`, address: qmk(index), retentionRequest: 'none',
  }));
  ledger.applyContextDemands({
    contextId: 'context-1', authorityPartitionDigest: PARTITION, revision: 1, demands,
  });
  await Promise.resolve();
  assert.equal(maximum, 4);
  assert.equal(gates.length, 4);
  assert.equal(
    demands.slice(4).every((entry) => {
      const state = ledger.hydrationState(entry.functionReference.materializationKey);
      return state.state === 'queued' && state.attempt === 'idle';
    }),
    true,
    'queued addresses remain honestly idle until L2 beginEstablishment starts',
  );
  while (gates.length > 0) gates.shift()();
  await Promise.resolve();
  await Promise.resolve();
  while (gates.length > 0) gates.shift()();
  await ledger.awaitHydrationIdle();
  assert.equal(maximum, 4);
  assert.equal(demands.every((entry) => ledger.hydrationState(entry.functionReference.materializationKey).attempt === 'pending'), true);
});
