import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';

import { SnapbackClient } from '../../../../../_kit/client.mjs';
import { createFileRqsResumeStore } from '../../../../../../packages/snapback-client/rqs-store-file.mjs';
import { startServer } from '../../../../../_kit/server-process.mjs';
import {
  assert,
  assertEqual,
  createArmSuite,
  eventually,
  loadAcceptance,
} from '../../../../shared/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..', '..');
const repoRoot = resolve(appDir, '..', '..', '..', '..');
const generatedDir = join(appDir, 'snapback', 'generated');
const json = (name) => JSON.parse(readFileSync(join(generatedDir, name), 'utf8'));
const { default: api } = await import(pathToFileURL(join(generatedDir, 'api.mjs')).href);
const manifest = await loadAcceptance('contention-calendar');
const suite = createArmSuite({
  app: 'contention-calendar', provider: 'snapback', manifest,
  evidencePath: join(appDir, 'evidence', 'snapback.v1.json'),
});
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const latencyMs = 1000;
const now = 1_787_000_000_000;
let server;
let alice;
let bob;
let observer;
let stream;
let scratch;
let aliceStore;
let bobStore;
let aliceView;
let bobView;
const samples = [];
const code = (error) => error?.diagnostic?.code ?? error?.code ?? null;

async function reserveWithPrediction(client, args, view) {
  const inputAt = performance.now();
  const pending = client.mutate(api.reserve, { args });
  await eventually(
    () => view.getSnapshot().visibleRows.reservations
      ?.some((row) => row.idempotencyKey === args.idempotencyKey),
    { label: `${args.idempotencyKey} generated-IR paint` },
  );
  const paintedAt = performance.now();
  try {
    const response = await pending;
    const ackAt = performance.now();
    samples.push({ inputToPaintMs: paintedAt - inputAt, acknowledgementMs: ackAt - inputAt });
    return response;
  } catch (error) {
    await eventually(
      () => !view.getSnapshot().visibleRows.reservations
        ?.some((row) => row.idempotencyKey === args.idempotencyKey),
      { label: `${args.idempotencyKey} rejected layer retirement` },
    );
    samples.push({ inputToPaintMs: paintedAt - inputAt, acknowledgementMs: performance.now() - inputAt, rejected: true });
    throw error;
  }
}

async function settleView(view, client, identities) {
  const rows = (await client.query(api.schedule)).rows;
  await view.rebase({
    authoritativeRows: { reservations: rows },
    retiredSettlementIdentities: identities.filter(Boolean),
    connected: true,
    cause: 'zero-bakeoff-authoritative-delivery',
  });
  return rows;
}

try {
  server = await startServer({
    port: 0, db: ':memory:', cwd: repoRoot,
    provenance: { appId: 'contention-calendar', artifactsPath: join(generatedDir, 'artifacts.json') },
  });
  suite.cleanup(() => server.stop());
  scratch = await mkdtemp(join(tmpdir(), 'snapback-contention-calendar-arm-'));
  aliceStore = createFileRqsResumeStore({
    directory: join(scratch, 'alice'), clientStoreId: 'contention-calendar-alice',
  });
  bobStore = createFileRqsResumeStore({
    directory: join(scratch, 'bob'), clientStoreId: 'contention-calendar-bob',
  });
  await Promise.all([aliceStore.whenLockSettled(), bobStore.whenLockSettled()]);
  suite.cleanup(async () => {
    aliceView?.close();
    bobView?.close();
    await Promise.all([aliceStore.close(), bobStore.close()]);
    await rm(scratch, { recursive: true, force: true });
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    if (rawUrl && new URL(rawUrl).pathname === '/mutation/reserve') await sleep(latencyMs);
    return nativeFetch(input, init);
  };
  suite.cleanup(() => { globalThis.fetch = nativeFetch; });
  alice = new SnapbackClient(server.baseUrl, {
    ...server.clientOptions, custody: 'anonymous-public', rqsStore: aliceStore, offlineQueue: true,
  });
  bob = new SnapbackClient(server.baseUrl, {
    ...server.clientOptions, custody: 'anonymous-public', rqsStore: bobStore, offlineQueue: true,
  });
  observer = new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
  await alice.ensureApp({
    schema: json('schema.manifest.json'), functions: json('functions.manifest.json'),
    seed: JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8')),
  });
  const initialSchedule = (await alice.query(api.schedule)).rows;
  aliceView = await alice.createOptimisticMutationView({
    authoritativeRows: { reservations: initialSchedule }, connected: true,
  });
  bobView = await bob.createOptimisticMutationView({
    authoritativeRows: { reservations: initialSchedule }, connected: true,
  });

  await suite.pass('cc.provisional-render', async () => {
    const pending = reserveWithPrediction(alice, {
      idempotencyKey: 'provisional', resourceKey: 'room-19', slotKey: 'slot-p',
      ownerId: 'alice', title: 'Provisional', now,
    }, aliceView);
    await eventually(
      () => aliceView.getSnapshot().visibleRows.reservations
        ?.filter((row) => row.idempotencyKey === 'provisional').length === 1,
      { label: 'one provisional reservation in the generated view' },
    );
    const settlement = await pending;
    await settleView(aliceView, alice, [settlement.clientMutationId]);
    assert(samples.at(-1).inputToPaintMs < 16.7, 'provisional paint missed one frame');
    assert(samples.at(-1).acknowledgementMs >= latencyMs, 'ack omitted injected latency');
    return {
      ...samples.at(-1),
      clientMutationId: settlement.clientMutationId,
      idMap: settlement.receipt.idMap,
    };
  });

  let contention;
  await suite.pass('cc.exactly-one-winner', async () => {
    contention = await Promise.allSettled([
      reserveWithPrediction(alice, {
        idempotencyKey: 'alice-final', resourceKey: 'room-00', slotKey: 'slot-final',
        ownerId: 'alice', title: 'Alice final', now: now + 1,
      }, aliceView),
      reserveWithPrediction(bob, {
        idempotencyKey: 'bob-final', resourceKey: 'room-00', slotKey: 'slot-final',
        ownerId: 'bob', title: 'Bob final', now: now + 2,
      }, bobView),
    ]);
    assertEqual(contention.filter((entry) => entry.status === 'fulfilled').length, 1, 'exactly one transaction commits');
    assertEqual(contention.filter((entry) => entry.status === 'rejected').length, 1, 'exactly one transaction refuses');
    const authoritative = (await alice.query(api.schedule)).rows
      .filter((row) => row.resourceSlotKey === 'room-00|slot-final');
    assertEqual(authoritative.length, 1, 'unique resource-slot invariant');
    const winner = contention.find((entry) => entry.status === 'fulfilled').value;
    await Promise.all([
      settleView(aliceView, alice, [winner.clientMutationId]),
      settleView(bobView, bob, [winner.clientMutationId]),
    ]);
    return { winner: authoritative[0].ownerId, loserCode: code(contention.find((entry) => entry.status === 'rejected').reason) };
  });

  await suite.pass('cc.loser-correction', async () => {
    const rejected = contention.find((entry) => entry.status === 'rejected');
    assert(rejected, 'missing losing attempt');
    assert(['SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION', 'SNAPBACK_HANDLER_FAILED'].includes(code(rejected.reason)),
      `unexpected contention diagnostic ${code(rejected.reason)}`);
    const schedule = (await bob.query(api.schedule)).rows;
    assertEqual(schedule.filter((row) => row.resourceSlotKey === 'room-00|slot-final').length, 1,
      'loser corrected to one canonical booking');
    assertEqual(aliceView.getSnapshot().layers.length, 0, 'Alice has no provisional residue');
    assertEqual(bobView.getSnapshot().layers.length, 0, 'Bob has no provisional residue');
    return { diagnostic: code(rejected.reason), alternative: 'room-01|slot-final' };
  });

  await suite.pass('cc.ambiguous-retry-idempotence', async () => {
    const args = {
      idempotencyKey: 'ambiguous-retry', resourceKey: 'room-02', slotKey: 'slot-r',
      ownerId: 'alice', title: 'Retry safe', now: now + 3,
    };
    const delayedFetch = globalThis.fetch;
    let droppedResponse = null;
    let droppedRequest = null;
    globalThis.fetch = async (input, init) => {
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const response = await delayedFetch(input, init);
      if (
        droppedResponse === null
        && rawUrl
        && new URL(rawUrl).pathname === '/mutation/reserve'
        && body?.args?.idempotencyKey === args.idempotencyKey
      ) {
        droppedRequest = body;
        droppedResponse = await response.clone().json();
        throw new TypeError('simulated response loss after authoritative commit');
      }
      return response;
    };
    let queued;
    try {
      queued = await alice.mutate(api.reserve, { args });
    } finally {
      globalThis.fetch = delayedFetch;
    }
    assertEqual(queued.status, 'queued', 'ambiguous committed response remains replayable');
    assertEqual(droppedRequest.clientMutationId, queued.clientMutationId,
      'queued retry preserves protocol identity');
    const replay = await alice.replayQueuedMutations();
    assertEqual(replay.replayed, 1, 'ambiguous operation replayed once');
    const retained = (await alice.settledMutations())
      .find((entry) => entry.clientMutationId === queued.clientMutationId)?.settlement;
    assert(retained, 'replayed settlement retained for recovery');
    assertEqual(retained.result, droppedResponse.result, 'duplicate delivery republishes the original result');
    assertEqual(JSON.stringify(retained.receipt.idMap), JSON.stringify(droppedResponse.receipt.idMap),
      'duplicate delivery republishes the original canonical id map');
    await settleView(aliceView, alice, [queued.clientMutationId]);
    const rows = (await alice.query(api.schedule)).rows.filter((row) => row.idempotencyKey === args.idempotencyKey);
    assertEqual(rows.length, 1, 'ambiguous retry created no duplicate');
    return {
      clientMutationId: queued.clientMutationId,
      id: retained.result,
      count: rows.length,
      idMap: retained.receipt.idMap,
    };
  });

  await suite.pass('cc.nonoverlap-success', async () => {
    const results = await Promise.all([
      alice.mutate(api.reserve, { args: {
        idempotencyKey: 'nonoverlap-a', resourceKey: 'room-03', slotKey: 'slot-n',
        ownerId: 'alice', title: 'A', now: now + 4,
      } }),
      bob.mutate(api.reserve, { args: {
        idempotencyKey: 'nonoverlap-b', resourceKey: 'room-04', slotKey: 'slot-n',
        ownerId: 'bob', title: 'B', now: now + 5,
      } }),
    ]);
    assertEqual(results.length, 2, 'both nonoverlapping transactions commit');
    await Promise.all([
      settleView(aliceView, alice, [results[0].clientMutationId]),
      settleView(bobView, bob, [results[1].clientMutationId]),
    ]);
    return { ids: results.map((result) => result.result) };
  });

  await suite.pass('cc.observer-convergence', async () => {
    stream = observer.openLiveStream('cc-observer');
    const ownedStream = stream;
    await ownedStream.ready;
    suite.cleanup(() => ownedStream.close());
    await observer.subscribeLive(api.schedule, { connectionId: 'cc-observer' });
    const started = performance.now();
    const settlement = await alice.mutate(api.reserve, { args: {
      idempotencyKey: 'observer', resourceKey: 'room-05', slotKey: 'slot-o',
      ownerId: 'alice', title: 'Observer proof', now: now + 6,
    } });
    const update = await stream.nextUpdate();
    const row = update.rows.find((entry) => entry.idempotencyKey === 'observer');
    assert(row, 'independent observer missed authoritative booking');
    await settleView(aliceView, alice, [settlement.clientMutationId]);
    const convergenceMs = performance.now() - started;
    return { transport: update.kind, convergenceMs, authoritativeId: row._id };
  });

  await suite.pass('cc.cleanup', async () => {
    stream?.close();
    stream = null;
    assert(server.exit === null, 'server alive before owned teardown');
    return { owned: ['websocket', 'snapback server'], database: ':memory:' };
  });
} catch (error) {
  for (const id of manifest.checks) {
    await suite.gap(id, 'Snapback runtime unavailable before check execution', {
      code: code(error) ?? 'SNAPBACK_RUNTIME_GAP', message: String(error?.message ?? error),
    });
  }
}

const receipt = await suite.finish({
  providerIdentity: { product: 'Snapback', target: 'local Ibex/SQLite', source: 'repository' },
  server: { identity: server?.identity ?? null },
  fixture: manifest.fixture,
  latency: { authoritativeMutationMs: latencyMs, samples },
  conflictPolicy: { client: 'optimistic projection', server: 'unique index on resourceSlotKey' },
});
console.log(JSON.stringify(receipt));
if (!receipt.ok || receipt.counts.gap > 0) process.exitCode = 1;
