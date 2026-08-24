import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createClientDiagnosticsChannel } from './client-diagnostics.mjs';
import { SnapbackClient } from './index.mjs';
import { createRuntimeCostDiagnostics } from './runtime-cost-diagnostics.mjs';
import { argsHash } from './rqs.mjs';

function fixture(options = {}) {
  let nowMs = 1_000;
  const channel = createClientDiagnosticsChannel({
    cooldownMs: 0,
    now: () => nowMs,
  });
  const recorder = createRuntimeCostDiagnostics({
    enabled: true,
    diagnosticsChannel: channel,
    now: () => nowMs,
    equivalentEnqueueWarningThreshold: 3,
    assetIssuanceWarningThreshold: 3,
    ...options,
  });
  return {
    channel,
    recorder,
    advance(milliseconds) { nowMs += milliseconds; },
  };
}

test('equivalent enqueue facts require the same function and canonical arguments', () => {
  const { recorder, channel, advance } = fixture();
  recorder.recordEquivalentEnqueue({ functionId: 'fn:save', args: { title: 'RAW_A' } });
  recorder.recordEquivalentEnqueue({ functionId: 'fn:save', args: { title: 'RAW_B' } });
  recorder.recordEquivalentEnqueue({ functionId: 'fn:save', args: { title: 'RAW_A' } });
  recorder.recordEquivalentEnqueue({ functionId: 'fn:save', args: { title: 'RAW_A' } });

  let facts = recorder.snapshot().equivalentEnqueues.facts;
  assert.equal(facts.length, 2, 'differing arguments retain distinct equivalence identities');
  const repeated = facts.find((fact) => fact.enqueueCount === 3);
  const differing = facts.find((fact) => fact.enqueueCount === 1);
  assert.equal(repeated.equivalentEnqueueCount, 2);
  assert.equal(differing.equivalentEnqueueCount, 0);
  assert.notEqual(repeated.canonicalInputHash, differing.canonicalInputHash);

  const warning = channel.snapshot().events[0];
  assert.equal(warning.code, 'SNAPBACK_EQUIVALENT_MUTATION_ENQUEUE_MULTIPLICITY');
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.details.functionId, 'fn:save');
  assert.equal(warning.details.equivalentEnqueueCount, 2);
  assert.equal(JSON.stringify(warning).includes('RAW_A'), false, 'arguments never enter diagnostics');

  advance(2_000);
  recorder.recordEquivalentEnqueue({ functionId: 'fn:save', args: { title: 'RAW_A' } });
  facts = recorder.snapshot().equivalentEnqueues.facts;
  assert.equal(facts.find((fact) => fact.enqueueCount === 4).equivalentEnqueueCount, 2);
  assert.equal(channel.snapshot().events.length, 1, 'a new window starts with a baseline, not a claim');
});

test('housekeeping supersession counters and LRU overflow remain exact and bounded', () => {
  const { recorder } = fixture({ keyCapacity: 2 });
  recorder.recordHousekeepingSupersessions([
    { functionId: 'fn:a', count: 2 },
    { functionId: 'fn:b', count: 3 },
  ]);
  recorder.recordHousekeepingSupersessions([{ functionId: 'fn:c', count: 4 }]);
  const facts = recorder.snapshot().housekeepingSupersessions;
  assert.deepEqual(facts.facts.map((fact) => fact.functionId), ['fn:b', 'fn:c']);
  assert.deepEqual(facts.otherKeys, { supersededCount: 2 });
  assert.equal(facts.evictedKeys, 1);
  assert.equal(
    facts.facts.reduce((sum, fact) => sum + fact.supersededCount, facts.otherKeys.supersededCount),
    9,
  );
});

test('duplicate subscription identity excludes owner label and includes canonical arguments', () => {
  const { recorder, channel } = fixture();
  const tuple = {
    canonicalAppId: 'app',
    storagePartition: 'store',
    serverOrigin: 'http://local',
    settledAuthority: { authorityKey: `sha256:${'a'.repeat(64)}` },
  };
  const successorTuple = {
    ...tuple,
    settledAuthority: { authorityKey: `sha256:${'b'.repeat(64)}` },
  };
  const first = {};
  const second = {};
  const differing = {};
  const successor = {};
  recorder.registerSubscription({
    token: first,
    functionId: 'fn:list',
    args: { room: 1 },
    ownershipTuple: tuple,
    ownerLabel: 'provider:one',
  });
  recorder.registerSubscription({
    token: second,
    functionId: 'fn:list',
    args: { room: 1 },
    ownershipTuple: tuple,
    ownerLabel: 'provider:two',
  });
  recorder.registerSubscription({
    token: differing,
    functionId: 'fn:list',
    args: { room: 2 },
    ownershipTuple: tuple,
    ownerLabel: 'provider:three',
  });
  recorder.registerSubscription({
    token: successor,
    functionId: 'fn:list',
    args: { room: 1 },
    ownershipTuple: successorTuple,
    ownerLabel: 'provider:successor',
  });

  const facts = recorder.snapshot().duplicateSubscriptions.facts;
  assert.equal(
    facts.length,
    1,
    'differing arguments and distinct settled principals do not become duplicate facts',
  );
  assert.equal(facts[0].count, 2);
  assert.deepEqual(facts[0].ownerLabels, ['provider:one', 'provider:two']);
  const warning = channel.snapshot().events[0];
  assert.equal(warning.code, 'SNAPBACK_LIVE_DUPLICATE_SUBSCRIPTION_MULTIPLICITY');
  assert.equal(warning.severity, 'warning');
  assert.deepEqual(warning.details.ownerLabels, ['provider:one', 'provider:two']);

  recorder.unregisterSubscription(first);
  assert.deepEqual(recorder.snapshot().duplicateSubscriptions.facts, []);
});

test('duplicate subscription teardown preserves exact lifetime registration overflow', () => {
  const { recorder } = fixture({ keyCapacity: 1 });
  const tokens = [{}, {}, {}];
  for (const [index, token] of tokens.entries()) {
    recorder.registerSubscription({
      token,
      functionId: `fn:${index}`,
      args: {},
      ownershipTuple: { settledAuthority: { authorityKey: `authority:${index}` } },
      ownerLabel: `provider:${index}`,
    });
  }
  for (const token of tokens) recorder.unregisterSubscription(token);

  const snapshot = recorder.snapshot().duplicateSubscriptions;
  assert.deepEqual(snapshot.facts, []);
  assert.deepEqual(snapshot.otherKeys, { registrationCount: 3 });
  assert.equal(snapshot.evictedKeys, 2);
});

test('public liveQuery owner labels are pseudonymized in inspection and warnings', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let subscriptionSequence = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') {
      return Response.json({
        connectionId: 'runtime-owner-label',
        connectionToken: 'runtime-owner-label-token',
        wireVersion: 'snapback.v1',
        authorizationInvalidation: null,
      });
    }
    if (path === '/live/listTodos/subscribe') {
      subscriptionSequence += 1;
      return Response.json({
        subscription_id: `runtime-owner-subscription-${subscriptionSequence}`,
        snapshot: { version: 1, rows: [] },
        permission_epochs: {},
      });
    }
    if (path === '/live/listTodos/unsubscribe') {
      return Response.json({
        subscription_id: JSON.parse(init.body).subscription_id,
        disposed: true,
      });
    }
    throw new Error(`unexpected runtime owner-label request: ${path}`);
  };

  const client = new SnapbackClient('http://runtime-owner-label.test', {
    rqsStore: null,
    offlineQueue: false,
    devDiagnosticsReporter: false,
    __runtimeCostDiagnosticsOptions: { enabled: true },
  });
  const owners = [
    { ownerLabel: 'caller:user-raw-value', userId: 'user-a' },
    { ownerLabel: 'caller:second-raw-value', userId: 'user-a' },
    { ownerLabel: 'caller:successor-raw-value', userId: 'user-b' },
  ];
  const handles = [];
  try {
    for (const { ownerLabel, userId } of owners) {
      handles.push(await client.liveQuery('listTodos', {
        connectionId: 'runtime-owner-label',
        ownerLabel,
        persistResume: false,
        userId,
      }));
    }

    const inspection = client.localResourceInspection();
    const expectedInspectionLabels = owners.map(({ ownerLabel }) => argsHash(ownerLabel)).sort();
    const expectedDuplicateLabels = owners
      .filter(({ userId }) => userId === 'user-a')
      .map(({ ownerLabel }) => argsHash(ownerLabel))
      .sort();
    assert.deepEqual(
      inspection.subscriptions.map(({ owner }) => owner).sort(),
      expectedInspectionLabels,
    );
    assert.deepEqual(
      inspection.runtimeCostDiagnostics.duplicateSubscriptions.facts[0].ownerLabels,
      expectedDuplicateLabels,
    );
    const warning = client.diagnosticsChannel().snapshot().events.find(
      ({ code }) => code === 'SNAPBACK_LIVE_DUPLICATE_SUBSCRIPTION_MULTIPLICITY',
    );
    assert.deepEqual(warning.details.ownerLabels, expectedDuplicateLabels);
    assert.equal(
      owners.some(({ ownerLabel }) => (
        JSON.stringify({ inspection, warning }).includes(ownerLabel)
      )),
      false,
      'caller-influenced labels never survive a gated snapshot or warning boundary',
    );
  } finally {
    for (const handle of handles) await handle.dispose();
  }
});

test('asset issuance facts are per opaque asset and owner with bounded overflow', () => {
  const { recorder, channel } = fixture({ keyCapacity: 2 });
  for (let index = 0; index < 3; index += 1) {
    recorder.recordAssetIssuance({
      assetIdentity: 'asset_opaque_1',
      ownerLabel: 'provider:one/hook:useSnapbackAssetUrl',
    });
  }
  recorder.recordAssetIssuance({
    assetIdentity: 'asset_opaque_1',
    ownerLabel: 'provider:two/hook:useSnapbackAssetUrl',
  });
  recorder.recordAssetIssuance({
    assetIdentity: 'asset_opaque_2',
    ownerLabel: 'provider:one/hook:useSnapbackAssetUrl',
  });

  const facts = recorder.snapshot().assetIssuanceMultiplicity;
  assert.equal(facts.facts.length, 2);
  assert.deepEqual(facts.otherKeys, { issuanceCount: 3 });
  assert.equal(facts.evictedKeys, 1);
  assert.equal(
    facts.facts.reduce((sum, fact) => sum + fact.issuanceCount, facts.otherKeys.issuanceCount),
    5,
  );
  const warning = channel.snapshot().events[0];
  assert.equal(warning.code, 'SNAPBACK_ASSET_ISSUANCE_MULTIPLICITY');
  assert.equal(warning.severity, 'warning');
  assert.deepEqual(warning.details.ownerLabels, ['provider:one/hook:useSnapbackAssetUrl']);
  assert.equal(Object.hasOwn(warning.details, 'url'), false);
});

test('disabled recorder takes the no-buffer branch and emits no facts', () => {
  const channel = createClientDiagnosticsChannel({ cooldownMs: 0 });
  const recorder = createRuntimeCostDiagnostics({
    enabled: false,
    diagnosticsChannel: channel,
    keyCapacity: 2,
  });
  recorder.recordEquivalentEnqueue({ functionId: 'fn:save', args: Symbol('not-canonical') });
  recorder.recordHousekeepingSupersessions([{ functionId: 'fn:save', count: 1 }]);
  recorder.registerSubscription({ token: {}, args: Symbol('not-canonical') });
  recorder.recordAssetIssuance({ assetIdentity: 'asset_1', ownerLabel: 'provider:one' });
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.keyCapacity, 2);
  assert.deepEqual(snapshot.equivalentEnqueues.facts, []);
  assert.deepEqual(snapshot.housekeepingSupersessions.facts, []);
  assert.deepEqual(snapshot.duplicateSubscriptions.facts, []);
  assert.deepEqual(snapshot.assetIssuanceMultiplicity.facts, []);
  assert.deepEqual(channel.snapshot().events, []);
});
