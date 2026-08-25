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

import {
  joinPendingDeliveryInspectionV1,
  SnapbackClient,
} from '@expo/snapback-client';
import { generateApp, runDev } from './index.mjs';

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
let dev = null;
let receiptClient = null;
let receiptLive = null;
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

  // LLP 0267 §7.7 integration receipt: a real client subscription and an
  // authenticated app.inspect host operation meet only after the host payload
  // has crossed its JSON serialization boundary. The familiar handler is an
  // Ibex/JS query, so its retained record also proves incomplete physical work
  // is not dropped or misread as measured zero.
  const applicationValue = `runtime-cost-receipt-secret-${process.pid}`;
  receiptClient = new SnapbackClient(dev.serverUrl, {
    offlineQueue: false,
    rqsStore: null,
  });
  await receiptClient.mutate('todos.create', {
    args: { title: applicationValue },
    queue: false,
  });
  receiptLive = await receiptClient.liveQuery('todos.list', {
    args: { completed: false },
    connectionId: 'runtime-cost-host-operation-receipt',
    persistResume: false,
  });
  assert.equal(receiptLive.rows.length, 1);
  const clientSnapshot = receiptClient.localResourceInspection();

  const hostInspect = spawnSync(
    runtimeBinary,
    ['inspect', '--ready-file', readyFile],
    { encoding: 'utf8' },
  );
  assert.equal(hostInspect.status, 0, hostInspect.stderr);
  const serializedHostOperation = hostInspect.stdout;
  assert.doesNotMatch(serializedHostOperation, new RegExp(applicationValue, 'u'));
  assert.doesNotMatch(serializedHostOperation, /fixtureIdentity/u);
  const hostOperation = JSON.parse(serializedHostOperation);
  assert.equal(hostOperation.operation, 'app.inspect');
  assert.equal(hostOperation.ok, true);
  const runtimeState = hostOperation.data.runtimeState;
  assert.equal(runtimeState.runtimeCost.enabled, true);

  const incomplete = runtimeState.runtimeCost.queryObservations.records.find(
    (record) => record.executionKind === 'liveEstablishment'
      && record.resultRows === 1
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
  assert.equal(joined.subscriptions.length, 1);
  assert.equal(
    joined.subscriptions[0].subscriptionId,
    clientSnapshot.subscriptions[0].subscriptionId,
  );
  assert.equal(Number.isSafeInteger(joined.subscriptions[0].wave.waveSeq), true);
  assert.equal(joined.subscriptions[0].wave.rerunCause, 'reconnect-reestablish');

  receiptLive.dispose();
  await receiptLive.settled();
  receiptLive = null;
  await receiptClient.close();
  receiptClient = null;

  await dev.close();
  dev = null;

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
  receiptLive?.dispose?.();
  await receiptLive?.settled?.();
  await receiptClient?.close?.();
  await dev?.close?.();
  rmSync(projectRoot, { recursive: true, force: true });
}

console.log('familiar codegen -> canonical generated -> snapback dev: ok');
