import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createMaterializationStore,
  decodeMaterializationRecordV1,
  encodeMaterializationRecordV1,
  materializationAddressKey,
} from './materialization-store.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';
import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from './rqs-store-memory.mjs';
import { base64UrlNoPad, sha256 } from './rqs.mjs';
import {
  createStorePolicyController,
  materializationPayloadProjection,
  STORE_POLICY_CONSTANTS,
} from './store-policy.mjs';

const encoder = new TextEncoder();
const digest = (character) => `sha256:${character.repeat(64)}`;
const partition = (character) => digest(character);
const qmk = (label) => `qmk1.${base64UrlNoPad(sha256(encoder.encode(label)))}`;

function authorityState() {
  return {
    query_instance_id: null,
    query_lifecycle: 'active', authority_generation: 1, query_generation: 1,
    authority_instance_id: 'authority',
    expected_boot_issuer: { issuer_id: 'issuer', boot_sequence: 1 },
    expected_authorization: { incarnation: 'inc', epoch: 1, version_stream: 'stream' },
    effective_disposition: 'retain', accepted: null,
    retired_issuer_frontier: { incarnation: 'inc', boot_sequence: 0 },
    retired_scope_frontier: null, pending_by_scope: {}, scope_state: {},
  };
}

const registration = ({ id, source, ttl, retention = 'durable', label = 'secret-label' }) => ({
  format: 'snapback.query-registration.v1', registrationId: id, source,
  ownerContext: source === 'active'
    ? { kind: 'subscription', contextId: `context-${id}` }
    : source === 'preload' ? { kind: 'route', routeId: label } : { kind: 'api', label },
  functionReference: { plan: 'hidden' }, canonicalArgs: { private: 'never-inspect' },
  requestedScope: { kind: 'page', input: { kind: 'first' } },
  retentionRequest: retention, idleTtlClass: ttl,
});

async function setup(t, carrier = 'memory') {
  let handle;
  if (carrier === 'file') {
    const directory = await mkdtemp(join(tmpdir(), 'snapback-policy-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    handle = createFileRqsResumeStore({ directory, clientStoreId: 'policy-store' });
  } else {
    handle = createMemoryRqsResumeStore({ clientStoreId: 'policy-store' });
  }
  await handle.whenLockSettled();
  t.after(() => handle.close());
  const materializations = await createMaterializationStore(handle);
  return { handle, materializations };
}

async function addRecord(handle, materializations, label, part = partition('a'), payloadBytes = 10) {
  const address = ['snapback:client-materialization-address:v1', 'policy-store', qmk(label)];
  let record = await materializations.initialize(address, {
    planHash: digest('1'), activationHash: digest('2'), argsDigest: digest('3'),
    authorityPartitionDigest: part, storageProfile: 'volatile-online-v1',
    authorityState: authorityState(),
  });
  const membership = {
    localRowHandle: `row-${label}-${'x'.repeat(payloadBytes)}`,
    materializationKey: address[2], pageIdentityDigest: digest('4'),
  };
  await handle.materializationTransaction('readwrite', (view) => {
    const key = materializationAddressKey(address);
    record = decodeMaterializationRecordV1(view.materializations.get(key));
    record.memberships.push(membership);
    view.memberships.set(`${label}:membership`, structuredClone(membership));
    view.materializations.set(key, encodeMaterializationRecordV1(record));
  });
  return { address, addressKey: address[2], record };
}

test('canonical materialization projection counts payload only', async (t) => {
  const { handle, materializations } = await setup(t);
  const { address } = await addRecord(handle, materializations, 'bytes', partition('a'), 21);
  const stored = await handle.materializationTransaction('readonly', (view) => (
    view.materializations.get(materializationAddressKey(address))
  ));
  const decoded = decodeMaterializationRecordV1(stored);
  const projected = materializationPayloadProjection(stored);
  assert.equal(projected.fragmentCount, 0);
  assert.equal(projected.logicalBytes, new TextEncoder().encode(JSON.stringify(decoded.memberships[0])).length);
  assert.equal(projected.logicalBytes < new TextEncoder().encode(JSON.stringify(stored)).length, true);
});

test('release grace pins the last snapshot in both release orders and rollback never accelerates GC', async (t) => {
  let time = 1_000;
  const { handle, materializations } = await setup(t);
  const a = await addRecord(handle, materializations, 'grace-a');
  const b = await addRecord(handle, materializations, 'grace-b');
  const policy = createStorePolicyController({
    storeHandle: handle, materializationStore: materializations, now: () => time,
  });
  const pinned = registration({ id: 'A', source: 'programmatic', ttl: 'pinned' });
  const normal = registration({ id: 'B', source: 'programmatic', ttl: 'default' });

  await policy.updateRegistrationSet({ addressKey: a.addressKey, authorityPartitionDigest: partition('a'), registrations: [pinned, normal] });
  await policy.updateRegistrationSet({ addressKey: a.addressKey, authorityPartitionDigest: partition('a'), registrations: [normal] });
  time += 1;
  await policy.updateRegistrationSet({ addressKey: a.addressKey, authorityPartitionDigest: partition('a'), registrations: [] });

  await policy.updateRegistrationSet({ addressKey: b.addressKey, authorityPartitionDigest: partition('a'), registrations: [pinned, normal] });
  await policy.updateRegistrationSet({ addressKey: b.addressKey, authorityPartitionDigest: partition('a'), registrations: [pinned] });
  time += 1;
  await policy.updateRegistrationSet({ addressKey: b.addressKey, authorityPartitionDigest: partition('a'), registrations: [] });
  let inspection = await policy.inspection({ authorityPartitionDigest: partition('a') });
  const byKey = new Map(inspection.addresses.map((entry) => [entry.addressKey, entry]));
  assert.equal(byKey.get(a.addressKey).effectiveTtlClass, 'default');
  assert.equal(byKey.get(b.addressKey).effectiveTtlClass, 'pinned');
  assert.equal(byKey.get(b.addressKey).retainingReason.graceDeadline, null);

  const beforeDeadline = time;
  time -= 500; // persisted wall-clock rollback: raw wall time cannot cross the deadline early.
  await policy.maintenance();
  inspection = await policy.inspection({ authorityPartitionDigest: partition('a') });
  assert.equal(inspection.addresses.find((entry) => entry.addressKey === a.addressKey).compacted, false);
  time = beforeDeadline + STORE_POLICY_CONSTANTS.graceDefaultMs;
  await policy.maintenance();
  inspection = await policy.inspection({ authorityPartitionDigest: partition('a') });
  assert.equal(inspection.addresses.find((entry) => entry.addressKey === a.addressKey).compacted, true);
  assert.equal(inspection.addresses.find((entry) => entry.addressKey === b.addressKey).compacted, false, 'pinned is GC-exempt');
});

// @ref LLP 0166#the-registration-record — release grace pins both axes, but
// a retentionRequest of none retains no payload even when the TTL axis is
// default and would otherwise keep durable custody in grace.
test('none-pinned release compacts at the next pass instead of retaining payload for the TTL window', async (t) => {
  const { handle, materializations } = await setup(t);
  const item = await addRecord(handle, materializations, 'none-release');
  const policy = createStorePolicyController({
    storeHandle: handle,
    materializationStore: materializations,
    now: () => 1_000,
  });
  await policy.updateRegistrationSet({
    addressKey: item.addressKey,
    authorityPartitionDigest: partition('a'),
    registrations: [registration({
      id: 'volatile-active', source: 'active', ttl: 'default', retention: 'none',
    })],
  });
  await policy.updateRegistrationSet({
    addressKey: item.addressKey,
    authorityPartitionDigest: partition('a'),
    registrations: [],
  });
  let inspected = await policy.inspection({ authorityPartitionDigest: partition('a') });
  assert.equal(inspected.addresses[0].effectiveRetentionRequest, 'none');
  assert.equal(inspected.addresses[0].retainingReason.kind, 'release-grace');
  assert.equal(inspected.addresses[0].compacted, false);

  assert.deepEqual((await policy.maintenance()).compacted, [item.addressKey]);
  inspected = await policy.inspection({ authorityPartitionDigest: partition('a') });
  assert.deepEqual(inspected.addresses[0].retainingReason, { kind: 'instance-bookkeeping' });
  assert.equal(inspected.addresses[0].compacted, true);
});

for (const carrier of ['memory', 'file']) {
  test(`budget pressure order and address-byte tie-break are carrier-identical on ${carrier}`, async (t) => {
    let time = 100;
    const { handle, materializations } = await setup(t, carrier);
    const records = {};
    for (const label of ['undemanded-b', 'undemanded-a', 'idle', 'pinned', 'active']) {
      records[label] = await addRecord(handle, materializations, label);
    }
    const policy = createStorePolicyController({
      storeHandle: handle, materializationStore: materializations, now: () => time,
      limits: { materializationByteCeiling: 0, materializationRecordCeiling: 256, materializationFragmentCeiling: 1_024 },
    });
    const set = (label, regs, lastEstablishmentAt = 10) => policy.updateRegistrationSet({
      addressKey: records[label].addressKey, authorityPartitionDigest: partition('a'),
      registrations: regs, lastEstablishmentAt,
    });
    for (const label of ['undemanded-b', 'undemanded-a']) {
      await set(label, [registration({ id: label, source: 'programmatic', ttl: 'default' })]);
    }
    await set('undemanded-b', []);
    await set('undemanded-a', []); // same release clock, tie ends in address bytes
    await set('idle', [registration({ id: 'idle', source: 'programmatic', ttl: 'default' })], 1);
    await set('pinned', [registration({ id: 'pin', source: 'programmatic', ttl: 'pinned' })], 0);
    await set('active', [registration({ id: 'active', source: 'active', ttl: 'none' })], 0);
    const result = await policy.maintenance();
    const undemanded = [records['undemanded-a'].addressKey, records['undemanded-b'].addressKey]
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    assert.deepEqual(result.compacted, [...undemanded, records.idle.addressKey, records.pinned.addressKey]);
    assert.equal(result.refused, true, 'demanded-active payload is never compacted');
    const inspection = await policy.inspection({ authorityPartitionDigest: partition('a') });
    assert.equal(inspection.addresses.find((entry) => entry.addressKey === records.active.addressKey).compacted, false);
  });
}

test('blocker-held custody reports safety blocker then compacts on the next pass', async (t) => {
  let obligation = true;
  const { handle, materializations } = await setup(t);
  const held = await addRecord(handle, materializations, 'held');
  await handle.outboxEnqueue({ id: 'intent-1', function: 'blockedMutation' });
  await handle.materializationTransaction('readwrite', (view) => {
    const key = materializationAddressKey(held.address);
    const record = decodeMaterializationRecordV1(view.materializations.get(key));
    record.outboxEntryIds = ['intent-1'];
    record.settlementIds = ['settlement-1'];
    view.materializations.set(key, encodeMaterializationRecordV1(record));
  });
  const policy = createStorePolicyController({
    storeHandle: handle, materializationStore: materializations,
    getOwnerFacts: () => ({ obligationRequiresPayload: obligation }),
  });
  await policy.updateRegistrationSet({
    addressKey: held.addressKey, authorityPartitionDigest: partition('a'),
    registrations: [registration({ id: 'held', source: 'programmatic', ttl: 'none' })],
  });
  await policy.updateRegistrationSet({
    addressKey: held.addressKey, authorityPartitionDigest: partition('a'), registrations: [],
  });
  await policy.maintenance();
  let entry = (await policy.inspection({ authorityPartitionDigest: partition('a') })).addresses[0];
  assert.deepEqual(entry.retainingReason, {
    kind: 'safety-blocker',
    blockers: ['pending-intent', 'obligation', 'settlement-dependency'],
  });
  assert.equal(entry.compacted, false);
  obligation = false;
  await handle.outboxDiscard('intent-1');
  await handle.materializationTransaction('readwrite', (view) => {
    const key = materializationAddressKey(held.address);
    const record = decodeMaterializationRecordV1(view.materializations.get(key));
    record.outboxEntryIds = [];
    record.settlementIds = [];
    view.materializations.set(key, encodeMaterializationRecordV1(record));
  });
  const result = await policy.maintenance();
  assert.deepEqual(result.compacted, [held.addressKey]);
  entry = (await policy.inspection({ authorityPartitionDigest: partition('a') })).addresses[0];
  assert.deepEqual(entry.retainingReason, { kind: 'instance-bookkeeping' });
  assert.equal(entry.compacted, true);
});

test('handoff suppression anchors release grace at suppression end and suspends maintenance', async (t) => {
  let time = 50;
  const { handle, materializations } = await setup(t);
  const item = await addRecord(handle, materializations, 'suppressed');
  await handle.materializationTransaction('readwrite', (view) => {
    view.storeMeta.brokerRoster = {
      suppression: { active: true, helloAt: time, unreconciledPairs: ['pair'] },
    };
  });
  const policy = createStorePolicyController({ storeHandle: handle, materializationStore: materializations, now: () => time });
  await policy.updateRegistrationSet({
    addressKey: item.addressKey, authorityPartitionDigest: partition('a'),
    registrations: [registration({ id: 'suppressed', source: 'programmatic', ttl: 'default' })],
    suppressionActive: true,
  });
  await policy.updateRegistrationSet({
    addressKey: item.addressKey, authorityPartitionDigest: partition('a'), registrations: [],
    suppressionActive: true,
  });
  time += STORE_POLICY_CONSTANTS.heartbeatExpiryMs;
  assert.equal((await policy.maintenance()).suppressionActive, true);
  await handle.materializationTransaction('readwrite', (view) => {
    view.storeMeta.brokerRoster.suppression = { active: false, helloAt: null, unreconciledPairs: [] };
  });
  await policy.maintenance();
  const entry = (await policy.inspection({ authorityPartitionDigest: partition('a') })).addresses[0];
  assert.equal(entry.retainingReason.graceDeadline, time + STORE_POLICY_CONSTANTS.graceDefaultMs);
});

test('owner quarantine wins over demand-axis compaction policy', async (t) => {
  const { handle, materializations } = await setup(t);
  const item = await addRecord(handle, materializations, 'owner-wins');
  await materializations.applyAuthorizationTransition(item.address, {
    authorityState: {
      ...item.record.authorityState,
      query_generation: item.record.authorityState.query_generation + 1,
      effective_disposition: 'quarantine',
    },
  });
  const policy = createStorePolicyController({
    storeHandle: handle, materializationStore: materializations,
    limits: { materializationByteCeiling: 0 },
  });
  await policy.updateRegistrationSet({
    addressKey: item.addressKey, authorityPartitionDigest: partition('a'),
    registrations: [registration({ id: 'still-demanded', source: 'programmatic', ttl: 'none' })],
  });
  const result = await policy.maintenance();
  assert.deepEqual(result.compacted, []);
  assert.equal(result.refused, true, 'policy refuses pressure rather than weakening owner quarantine');
});

test('legacy envelope never competes with materializations and reports the grandfathered reason', async (t) => {
  const { handle, materializations } = await setup(t);
  const item = await addRecord(handle, materializations, 'materialization-pressure');
  assert.equal((await handle.commit('legacy-key', {
    rows: [{ id: 'legacy-row' }], meta: { saved: true }, token: 'legacy-token',
  })).persisted, true);
  const policy = createStorePolicyController({
    storeHandle: handle, materializationStore: materializations,
    limits: { materializationByteCeiling: 0 },
    listLegacyEntries: async () => [{
      addressKey: 'legacy-key', authorityPartitionDigest: partition('a'),
      bytes: (await handle.load('legacy-key')).bytes,
    }],
  });
  await policy.updateRegistrationSet({
    addressKey: item.addressKey, authorityPartitionDigest: partition('a'),
    registrations: [registration({ id: 'idle', source: 'programmatic', ttl: 'none' })],
  });
  await policy.maintenance();
  assert.notEqual(await handle.load('legacy-key'), null, 'materialization pressure never reclaims legacy');
  const inspection = await policy.inspection({ authorityPartitionDigest: partition('a') });
  assert.deepEqual(
    inspection.addresses.find((entry) => entry.addressKey === 'legacy-key').retainingReason,
    { kind: 'grandfathered-legacy-entry' },
  );
  assert.equal(inspection.budgets.find((entry) => entry.section === 'legacy-entries').logicalBytes > 0, true);
});

test('StorePolicyInspectionV1 exposes enforced ceilings, one reason, and no secret or foreign partition data', async (t) => {
  const { handle, materializations } = await setup(t);
  const local = await addRecord(handle, materializations, 'local', partition('a'));
  await addRecord(handle, materializations, 'foreign', partition('b'));
  const policy = createStorePolicyController({ storeHandle: handle, materializationStore: materializations });
  await policy.updateRegistrationSet({
    addressKey: local.addressKey, authorityPartitionDigest: partition('a'),
    registrations: [registration({ id: 'visible-id', source: 'programmatic', ttl: 'default' })],
  });
  const inspection = await policy.inspection({ authorityPartitionDigest: partition('a') });
  assert.equal(inspection.format, 'snapback.store-policy-inspection.v1');
  assert.equal(inspection.broker.livePairCeiling, STORE_POLICY_CONSTANTS.livePairCeiling);
  assert.equal(inspection.broker.consumedRequestCeiling, STORE_POLICY_CONSTANTS.consumedRequestCeiling);
  assert.equal(inspection.registrations.durableCeiling, STORE_POLICY_CONSTANTS.durableRegistrationCeiling);
  assert.equal(inspection.budgets[0].byteCeiling, STORE_POLICY_CONSTANTS.materializationByteCeiling);
  assert.equal(inspection.addresses.length, 1);
  assert.equal(inspection.addresses[0].retainingReason.kind, 'registrations');
  assert.deepEqual(inspection.addresses[0].retainingReason.entries, [{
    registrationId: 'visible-id', source: 'programmatic', ownerContextKind: 'api',
  }]);
  const serialized = JSON.stringify(inspection);
  assert.equal(serialized.includes('never-inspect'), false);
  assert.equal(serialized.includes('secret-label'), false);
  assert.equal(serialized.includes(partition('b')), false);
});

test('integration regression: synchronizeFacts reads the ledger nested durable-registration layout', async (t) => {
  const { handle, materializations } = await setup(t);
  const item = await addRecord(handle, materializations, 'nested-durable');
  const durable = registration({ id: 'persisted', source: 'programmatic', ttl: 'default' });
  await handle.materializationTransaction('readwrite', (view) => {
    view.storeMeta.durableRegistrations[item.addressKey] = { persisted: durable };
  });
  const policy = createStorePolicyController({
    storeHandle: handle,
    materializationStore: materializations,
    resolveRegistration: () => ({
      addressKey: item.addressKey,
      authorityPartitionDigest: partition('a'),
    }),
  });
  const inspected = await policy.inspection({ authorityPartitionDigest: partition('a') });
  assert.equal(inspected.addresses[0].demandState, 'demanded-idle');
  assert.deepEqual(inspected.addresses[0].retainingReason, {
    kind: 'registrations',
    entries: [{
      registrationId: 'persisted', source: 'programmatic', ownerContextKind: 'api',
    }],
  });
});

test('integration regression: policy inspection stays read-only in a non-writer context', async (t) => {
  const backing = createMemoryRqsStoreBacking({ clientStoreId: 'policy-store' });
  const writerHandle = createMemoryRqsResumeStore({ backing });
  const readerHandle = createMemoryRqsResumeStore({ backing });
  await writerHandle.whenLockSettled();
  t.after(async () => {
    await readerHandle.close();
    await writerHandle.close();
  });
  const writerMaterializations = await createMaterializationStore(writerHandle);
  await addRecord(writerHandle, writerMaterializations, 'reader-inspection');
  const writerPolicy = createStorePolicyController({
    storeHandle: writerHandle,
    materializationStore: writerMaterializations,
  });
  await writerPolicy.inspection({ authorityPartitionDigest: partition('a') });

  const readerMaterializations = await createMaterializationStore(readerHandle);
  const readerPolicy = createStorePolicyController({
    storeHandle: readerHandle,
    materializationStore: readerMaterializations,
  });
  const inspected = await readerPolicy.inspection({ authorityPartitionDigest: partition('a') });
  assert.equal(inspected.format, 'snapback.store-policy-inspection.v1');
  assert.equal(inspected.addresses.length, 1);
});

test('synchronizeFacts prunes record-less registration-less grace-less policy facts', async (t) => {
  const { handle, materializations } = await setup(t);
  const item = await addRecord(handle, materializations, 'pruned-fact');
  const policy = createStorePolicyController({ storeHandle: handle, materializationStore: materializations });
  await policy.updateRegistrationSet({
    addressKey: item.addressKey,
    authorityPartitionDigest: partition('a'),
    registrations: [],
  });
  await handle.materializationTransaction('readwrite', (view) => {
    view.materializations.delete(materializationAddressKey(item.address));
  });
  await policy.synchronizeFacts();
  const facts = await handle.materializationTransaction('readonly', (view) => (
    structuredClone(view.storeMeta.policyBudgetFacts.addresses)
  ));
  assert.equal(Object.hasOwn(facts, item.addressKey), false);
});
