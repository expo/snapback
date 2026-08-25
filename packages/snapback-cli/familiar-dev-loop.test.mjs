import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  createFileRqsResumeStore,
  inspectionPseudonymV1,
  joinPendingDeliveryInspectionV1,
  SnapbackClient,
} from '@expo/snapback-client';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  useSnapbackAssetUrl,
} from '@expo/snapback-react';
import {
  generateApp,
  runDev,
  spawnManagedRuntime,
  waitForReady,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const eventually = async (condition, label, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.fail(`timed out waiting for ${label}`);
};

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
assert.ok(
  existsSync(runtimeBinary),
  `native snapback binary missing at ${runtimeBinary}; run scripts/bootstrap-ibex-runtime or set SNAPBACK_RUNTIME_BINARY`,
);

const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-familiar-dev-loop-')));
const backendRoot = join(projectRoot, 'snapback');
const stateRoot = join(projectRoot, '.snapback');
const readyFile = join(stateRoot, 'dev.ready.json');
const database = join(stateRoot, 'dev.sqlite3');
const serveReadyFile = join(stateRoot, 'serve.ready.json');
const serveDatabase = join(stateRoot, 'serve.sqlite3');
let dev = null;
let receiptClient = null;
let receiptStore = null;
const receiptLives = [];
let assetProvider = null;
let assetRenderer = null;
let serveChild = null;
let unsubscribeMutation = null;
const nativeFetch = globalThis.fetch;
try {
  cpSync(join(repoRoot, 'tests', 'fixtures', 'familiar-todo'), backendRoot, { recursive: true });
  rmSync(join(backendRoot, 'generated'), { recursive: true, force: true });

  const generated = await generateApp(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.equal(generated.outDir, join(backendRoot, 'generated'));
  assert.equal(existsSync(join(backendRoot, '_generated')), false);

  dev = await runDev({
    backendDirectory: backendRoot,
    projectRoot,
    readyFile,
    database,
    runtimeBinary,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  assert.equal(dev.ok, true, JSON.stringify(dev.diagnostics));
  assert.equal(dev.state, 'generated-and-loaded');
  assert.equal((await fetch(`${dev.serverUrl}/health`)).ok, true);
  assert.equal(
    JSON.parse(readFileSync(join(backendRoot, 'generated', 'app.descriptor.json'), 'utf8'))
      .authoringProfile,
    'snapback-familiar-ts-v1',
  );

  // LLP 0267 §7.7 integration receipt: every fact below enters through a real
  // producer (durable enqueue/replay, liveQuery, React asset hook, or Ibex/JS
  // query) before the client and authenticated host inspections are joined.
  const applicationValue = `runtime-cost-receipt-secret-${process.pid}`;
  const rawMutationIds = [
    `cm-receipt-other-${process.pid}`,
    `cm-receipt-target-a-${process.pid}`,
    `cm-receipt-target-b-${process.pid}`,
  ];
  const rawOwnerLabels = [
    `receipt-other-owner-${process.pid}@example.test`,
    `receipt-target-owner-a-${process.pid}@example.test`,
    `receipt-target-owner-b-${process.pid}@example.test`,
  ];
  const rawConnectionId = `runtime-cost-connection-secret-${process.pid}`;
  receiptStore = createFileRqsResumeStore({
    directory: join(stateRoot, 'runtime-cost-rqs'),
    clientStoreId: `runtime-cost-receipt-${process.pid}`,
  });
  await receiptStore.whenLockSettled();
  assert.equal(receiptStore.isWriter(), true);
  receiptClient = new SnapbackClient(dev.serverUrl, {
    offlineQueue: true,
    rqsStore: receiptStore,
    outboxDrain: 'manual',
    devDiagnosticsReporter: false,
    __runtimeCostDiagnosticsOptions: {
      enabled: true,
      keyCapacity: 1,
      equivalentEnqueueWarningThreshold: 2,
      duplicateSubscriptionWarningThreshold: 2,
      assetIssuanceWarningThreshold: 2,
    },
  });

  let mutationTransportOnline = false;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? input : input.url;
    if (
      !mutationTransportOnline
      && new URL(url).pathname === '/mutation/todos.create'
    ) {
      throw new TypeError('runtime cost receipt delayed transport');
    }
    return nativeFetch(input, init);
  };
  const queued = [];
  queued.push(await receiptClient.mutate('todos.create', {
    args: { title: `${applicationValue}-other` },
    clientMutationId: rawMutationIds[0],
    queue: true,
  }));
  queued.push(await receiptClient.mutate('todos.create', {
    args: { title: applicationValue },
    clientMutationId: rawMutationIds[1],
    queue: true,
  }));
  queued.push(await receiptClient.mutate('todos.create', {
    args: { title: applicationValue },
    clientMutationId: rawMutationIds[2],
    queue: true,
  }));
  assert.deepEqual(queued.map(({ status }) => status), ['queued', 'queued', 'queued']);

  const mutationStatuses = [];
  unsubscribeMutation = receiptClient.subscribeMutation(
    rawMutationIds[1],
    (disposition) => mutationStatuses.push(disposition.status),
  );
  await eventually(
    () => mutationStatuses.includes('pending'),
    'the selected delayed mutation pending observation',
  );
  assert.deepEqual(mutationStatuses, ['pending']);
  const offlineReplay = await receiptClient.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: offlineReplay.replayed,
      failed: offlineReplay.failed,
      remaining: offlineReplay.remaining,
      stopped: offlineReplay.stopped,
    },
    { replayed: 0, failed: 0, remaining: 3, stopped: true },
  );
  const pendingStatus = await receiptClient.outboxStatus();
  assert.equal(pendingStatus.pending, 3);
  assert.equal(pendingStatus.blockedReason, 'replay-transient:connectivity');

  // Keep the transport gate closed across at least one clock tick so the
  // settled cost record must attribute the deliberately induced delay to the
  // queue phase rather than merely carrying four syntactically valid zeros.
  await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  mutationTransportOnline = true;
  const settledReplay = await receiptClient.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: settledReplay.replayed,
      failed: settledReplay.failed,
      remaining: settledReplay.remaining,
    },
    { replayed: 3, failed: 0, remaining: 0 },
  );
  await eventually(
    () => mutationStatuses.includes('settled'),
    'the selected delayed mutation to settle',
  );
  assert.deepEqual(mutationStatuses, ['pending', 'settled']);
  assert.equal((await receiptClient.outboxStatus()).pending, 0);

  receiptLives.push(await receiptClient.liveQuery('todos.list', {
    args: { completed: true },
    connectionId: rawConnectionId,
    ownerLabel: rawOwnerLabels[0],
    persistResume: false,
  }));
  receiptLives.push(await receiptClient.liveQuery('todos.list', {
    args: { completed: false },
    connectionId: rawConnectionId,
    ownerLabel: rawOwnerLabels[1],
    persistResume: false,
  }));
  receiptLives.push(await receiptClient.liveQuery('todos.list', {
    args: { completed: false },
    connectionId: rawConnectionId,
    ownerLabel: rawOwnerLabels[2],
    persistResume: false,
  }));
  assert.deepEqual(receiptLives.map(({ rows }) => rows.length), [0, 3, 3]);

  const generatedManifest = JSON.parse(readFileSync(
    join(backendRoot, 'generated', 'functions.manifest.json'),
    'utf8',
  ));
  const reactBinding = await receiptClient.prepareReactBinding({ generatedManifest });
  assetProvider = createSnapbackReactProvider(reactBinding, {
    connectionId: 'runtime-cost-asset-receipt',
  });
  function AssetProbe({ assetId }) {
    useSnapbackAssetUrl(assetId);
    return null;
  }
  await act(async () => {
    assetRenderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider: assetProvider },
      React.createElement(React.Fragment, null,
        React.createElement(AssetProbe, { assetId: 'asset_receipt_other' }),
        React.createElement(AssetProbe, { assetId: 'asset_receipt_target' }),
        React.createElement(AssetProbe, { assetId: 'asset_receipt_target' }),
      ),
    ));
    await flush();
  });
  await act(async () => { assetRenderer.unmount(); });
  assetRenderer = null;

  const clientSnapshot = receiptClient.localResourceInspection();
  assert.equal(clientSnapshot.runtimeCostDiagnostics.enabled, true);
  assert.equal(clientSnapshot.runtimeCostDiagnostics.keyCapacity, 1);
  const equivalent = clientSnapshot.runtimeCostDiagnostics.equivalentEnqueues;
  assert.deepEqual(
    equivalent.facts.map(({ functionId, enqueueCount, equivalentEnqueueCount }) => ({
      functionId,
      enqueueCount,
      equivalentEnqueueCount,
    })),
    [{ functionId: 'todos.create', enqueueCount: 2, equivalentEnqueueCount: 1 }],
  );
  assert.deepEqual(equivalent.otherKeys, { enqueueCount: 1, equivalentEnqueueCount: 0 });
  assert.equal(equivalent.evictedKeys, 1);

  const duplicates = clientSnapshot.runtimeCostDiagnostics.duplicateSubscriptions;
  assert.equal(duplicates.facts.length, 1);
  assert.equal(duplicates.facts[0].functionId, 'todos.list');
  assert.equal(duplicates.facts[0].count, 2);
  assert.deepEqual(
    duplicates.facts[0].ownerLabels,
    rawOwnerLabels.slice(1).map(inspectionPseudonymV1).sort(),
  );
  assert.deepEqual(duplicates.otherKeys, { registrationCount: 1 });
  assert.equal(duplicates.evictedKeys, 1);

  const assets = clientSnapshot.runtimeCostDiagnostics.assetIssuanceMultiplicity;
  assert.deepEqual(
    assets.facts.map(({ assetIdentity, issuanceCount }) => ({ assetIdentity, issuanceCount })),
    [{ assetIdentity: 'asset_receipt_target', issuanceCount: 2 }],
  );
  assert.deepEqual(assets.otherKeys, { issuanceCount: 1 });
  assert.equal(assets.evictedKeys, 1);

  const warningCodes = new Set(
    receiptClient.diagnosticsChannel().snapshot().events.map(({ code }) => code),
  );
  for (const code of [
    'SNAPBACK_EQUIVALENT_MUTATION_ENQUEUE_MULTIPLICITY',
    'SNAPBACK_LIVE_DUPLICATE_SUBSCRIPTION_MULTIPLICITY',
    'SNAPBACK_ASSET_ISSUANCE_MULTIPLICITY',
  ]) {
    assert.equal(warningCodes.has(code), true, `missing integrated warning ${code}`);
  }

  const settledMutation = clientSnapshot.mutationPhaseCosts.records.find(
    ({ clientMutationId }) => clientMutationId === inspectionPseudonymV1(rawMutationIds[1]),
  );
  assert.ok(settledMutation, 'the delayed mutation has one retained settled attribution');
  assert.equal(settledMutation.functionId, 'todos.create');
  assert.equal(settledMutation.disposition, 'settled');
  assert.equal(
    settledMutation.queueWaitMs > 0,
    true,
    'the connectivity-refused interval is attributed to queue wait',
  );
  for (const phase of ['queueWaitMs', 'authWaitMs', 'executionMs', 'commitMs']) {
    assert.equal(Number.isFinite(settledMutation[phase]), true, `${phase} is measured`);
    assert.equal(settledMutation[phase] >= 0, true, `${phase} is non-negative`);
  }

  const serializedClientInspection = JSON.stringify(clientSnapshot);
  assert.doesNotMatch(serializedClientInspection, new RegExp(applicationValue, 'u'));
  for (const raw of [...rawMutationIds, ...rawOwnerLabels, rawConnectionId]) {
    assert.doesNotMatch(serializedClientInspection, new RegExp(raw, 'u'));
  }
  assert.equal(serializedClientInspection.includes(dev.serverUrl), false);

  const hostInspect = spawnSync(
    runtimeBinary,
    ['inspect', '--ready-file', readyFile],
    { encoding: 'utf8' },
  );
  assert.equal(hostInspect.status, 0, hostInspect.stderr);
  const serializedHostOperation = hostInspect.stdout;
  assert.doesNotMatch(
    serializedHostOperation,
    new RegExp(applicationValue, 'u'),
    'the authenticated host envelope used for the live join contains no application row value',
  );
  assert.doesNotMatch(serializedHostOperation, /fixtureIdentity/u);
  const hostOperation = JSON.parse(serializedHostOperation);
  assert.equal(hostOperation.operation, 'app.inspect');
  assert.equal(hostOperation.ok, true);
  const runtimeState = hostOperation.data.runtimeState;
  assert.equal(runtimeState.runtimeCost.enabled, true);
  assert.equal(JSON.stringify(runtimeState.runtimeCost).includes(rawConnectionId), false);

  const incomplete = runtimeState.runtimeCost.queryObservations.records.find(
    (record) => record.executionKind === 'liveEstablishment'
      && record.resultRows === 3
      && record.complete === false,
  );
  assert.ok(incomplete, 'the JS query observation is retained as incomplete');
  assert.equal(incomplete.scannedRows, 0);
  assert.equal(incomplete.indexRangeCount, 0);
  assert.equal(incomplete.totalConsultations, 0);
  assert.deepEqual(incomplete.consultationSample, []);
  assert.equal(
    incomplete.resultRows > 0 && incomplete.complete === false,
    true,
    'physical zeros are explicitly unmeasured, not a zero-work proof',
  );

  const joined = joinPendingDeliveryInspectionV1(clientSnapshot, runtimeState);
  assert.equal(joined.subscriptions.length, 3);
  assert.equal(
    new Set(clientSnapshot.subscriptions.map(({ subscriptionId }) => subscriptionId)).size,
    3,
  );
  assert.equal(
    new Set(clientSnapshot.subscriptions.map(({ snapshotVersion }) => snapshotVersion)).size,
    1,
    'same-version subscriptions remain uniquely joinable by subscription id',
  );
  assert.deepEqual(
    joined.subscriptions.map(({ subscriptionId }) => subscriptionId).sort(),
    clientSnapshot.subscriptions.map(({ subscriptionId }) => subscriptionId).sort(),
  );
  const joinedWaveSequences = joined.subscriptions.map(({ serverRegistry, wave }) => {
    assert.ok(serverRegistry, 'each client subscription resolves to its server registry row');
    assert.ok(wave, 'each server registry row resolves to its delivered wave');
    assert.equal(
      wave.waveSeq,
      serverRegistry.lastDeliveredWaveSeq,
      'the joined wave is the exact wave named by this subscription registry row',
    );
    return wave.waveSeq;
  });
  assert.equal(
    new Set(joinedWaveSequences).size,
    joined.subscriptions.length,
    'same-function/same-version subscriptions resolve to distinct delivered waves',
  );
  assert.equal(
    joined.subscriptions.every(({ wave }) => (
      Number.isSafeInteger(wave.waveSeq)
      && wave.rerunCause === 'reconnect-reestablish'
    )),
    true,
  );

  const publicInspect = await receiptClient.inspect();
  const serializedPublicInspect = JSON.stringify(publicInspect);
  assert.doesNotMatch(serializedPublicInspect, /runtimeCost/u);
  assert.doesNotMatch(serializedPublicInspect, /equivalentEnqueues/u);
  assert.doesNotMatch(serializedPublicInspect, new RegExp(applicationValue, 'u'));
  assert.equal(serializedPublicInspect.includes(rawConnectionId), false);

  const observationCapacity = runtimeState.runtimeCost.queryObservations.recordCapacity;
  const observationByteCapacity = runtimeState.runtimeCost.queryObservations.byteCapacity;
  for (let offset = 0; offset < observationCapacity + 1; offset += 32) {
    await Promise.all(Array.from(
      { length: Math.min(32, observationCapacity + 1 - offset) },
      () => receiptClient.query('todos.list', { args: { completed: false } }),
    ));
  }
  const boundedHostInspect = spawnSync(
    runtimeBinary,
    ['inspect', '--ready-file', readyFile],
    { encoding: 'utf8' },
  );
  assert.equal(boundedHostInspect.status, 0, boundedHostInspect.stderr);
  const boundedSerialized = boundedHostInspect.stdout;
  assert.doesNotMatch(boundedSerialized, new RegExp(applicationValue, 'u'));
  const boundedRuntimeCost = JSON.parse(boundedSerialized).data.runtimeState.runtimeCost;
  assert.equal(JSON.stringify(boundedRuntimeCost).includes(rawConnectionId), false);
  const boundedQueries = boundedRuntimeCost.queryObservations;
  assert.equal(boundedQueries.recordCapacity, observationCapacity);
  assert.equal(boundedQueries.byteCapacity, observationByteCapacity);
  assert.equal(boundedQueries.records.length <= observationCapacity, true);
  assert.equal(boundedQueries.droppedRecords > 0, true);
  assert.equal(boundedQueries.retainedBytes <= boundedQueries.byteCapacity, true);
  assert.equal(boundedRuntimeCost.totalByteCapacity >= boundedQueries.retainedBytes, true);

  await assetProvider.dispose();
  assetProvider = null;
  for (const handle of receiptLives.splice(0)) {
    handle.dispose();
    await handle.settled();
  }
  unsubscribeMutation();
  unsubscribeMutation = null;
  await receiptClient.close();
  receiptClient = null;
  await receiptStore.close();
  receiptStore = null;

  await dev.close();
  dev = null;

  const serveEnvironment = { ...process.env };
  delete serveEnvironment.SNAPBACK_RUNTIME_COST_RECORDER;
  serveChild = spawnManagedRuntime(
    runtimeBinary,
    ['start', '--ready-file', serveReadyFile, '--db', serveDatabase],
    {
      cwd: projectRoot,
      env: serveEnvironment,
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  await waitForReady(serveReadyFile, serveChild);
  const serveInspect = spawnSync(
    runtimeBinary,
    ['inspect', '--ready-file', serveReadyFile],
    { encoding: 'utf8', env: serveEnvironment },
  );
  assert.equal(serveInspect.status, 0, serveInspect.stderr);
  assert.equal(
    JSON.parse(serveInspect.stdout).data.runtimeState.runtimeCost.enabled,
    false,
    'direct serving is recorder-off without the explicit operator flag',
  );
  const serveExit = new Promise((resolveExit) => serveChild.once('exit', resolveExit));
  const stoppedServe = spawnSync(
    runtimeBinary,
    ['stop', '--ready-file', serveReadyFile],
    { encoding: 'utf8', env: serveEnvironment },
  );
  assert.equal(stoppedServe.status, 0, stoppedServe.stderr);
  await serveExit;
  serveChild = null;

  symlinkSync('generated', join(backendRoot, '_generated'), 'dir');
  const refusedAlias = await generateApp(backendRoot);
  assert.equal(refusedAlias.ok, false);
  assert.equal(
    refusedAlias.diagnostics.some(({ code }) => (
      code === 'SNAPBACK_CODEGEN_LEGACY_GENERATED_DIRECTORY'
    )),
    true,
    JSON.stringify(refusedAlias.diagnostics),
  );
} finally {
  globalThis.fetch = nativeFetch;
  unsubscribeMutation?.();
  if (assetRenderer !== null) {
    await act(async () => { assetRenderer.unmount(); });
  }
  await assetProvider?.dispose?.();
  for (const handle of receiptLives.splice(0)) {
    handle.dispose?.();
    await handle.settled?.();
  }
  await receiptClient?.close?.();
  await receiptStore?.close?.();
  await dev?.close?.();
  if (serveChild?.exitCode === null) {
    const stopped = spawnSync(
      runtimeBinary,
      ['stop', '--ready-file', serveReadyFile],
      { encoding: 'utf8' },
    );
    if (stopped.status !== 0) serveChild.kill('SIGKILL');
  }
  rmSync(projectRoot, { recursive: true, force: true });
}

console.log('familiar W5 runtime-cost integration receipt: 3 queued/replayed mutations, 3 live subscriptions, 3 asset hook issuances, and 513 bounded queries: ok');
