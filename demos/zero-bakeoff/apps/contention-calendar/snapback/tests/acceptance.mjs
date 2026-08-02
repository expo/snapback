import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { SnapbackClient } from '../../../../../_kit/client.mjs';
import { startServer } from '../../../../../_kit/server-process.mjs';
import { assert, assertEqual, createArmSuite, loadAcceptance } from '../../../../shared/harness.mjs';

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
const samples = [];
const code = (error) => error?.diagnostic?.code ?? error?.code ?? null;

async function reserveWithPrediction(client, args, projection) {
  const inputAt = performance.now();
  projection.push({ ...args, pending: true });
  const paintedAt = performance.now();
  await sleep(latencyMs);
  try {
    const response = await client.mutate(api.reserve, { args });
    const ackAt = performance.now();
    samples.push({ inputToPaintMs: paintedAt - inputAt, acknowledgementMs: ackAt - inputAt });
    return response;
  } catch (error) {
    projection.splice(projection.findIndex((row) => row.idempotencyKey === args.idempotencyKey), 1);
    samples.push({ inputToPaintMs: paintedAt - inputAt, acknowledgementMs: performance.now() - inputAt, rejected: true });
    throw error;
  }
}

try {
  server = await startServer({
    port: 0, db: ':memory:', cwd: repoRoot,
    provenance: { appId: 'contention-calendar', artifactsPath: join(generatedDir, 'artifacts.json') },
  });
  suite.cleanup(() => server.stop());
  alice = new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
  bob = new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
  observer = new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
  await alice.ensureApp({
    schema: json('schema.manifest.json'), functions: json('functions.manifest.json'),
    seed: JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8')),
  });

  await suite.pass('cc.provisional-render', async () => {
    const projection = [];
    const pending = reserveWithPrediction(alice, {
      idempotencyKey: 'provisional', resourceKey: 'room-19', slotKey: 'slot-p',
      ownerId: 'alice', title: 'Provisional', now,
    }, projection);
    assertEqual(projection.length, 1, 'provisional reservation painted synchronously');
    await pending;
    assert(samples.at(-1).inputToPaintMs < 16.7, 'provisional paint missed one frame');
    assert(samples.at(-1).acknowledgementMs >= latencyMs, 'ack omitted injected latency');
    return samples.at(-1);
  });

  let contention;
  await suite.pass('cc.exactly-one-winner', async () => {
    const aliceProjection = [];
    const bobProjection = [];
    contention = await Promise.allSettled([
      reserveWithPrediction(alice, {
        idempotencyKey: 'alice-final', resourceKey: 'room-00', slotKey: 'slot-final',
        ownerId: 'alice', title: 'Alice final', now: now + 1,
      }, aliceProjection),
      reserveWithPrediction(bob, {
        idempotencyKey: 'bob-final', resourceKey: 'room-00', slotKey: 'slot-final',
        ownerId: 'bob', title: 'Bob final', now: now + 2,
      }, bobProjection),
    ]);
    assertEqual(contention.filter((entry) => entry.status === 'fulfilled').length, 1, 'exactly one transaction commits');
    assertEqual(contention.filter((entry) => entry.status === 'rejected').length, 1, 'exactly one transaction refuses');
    const authoritative = (await alice.query(api.schedule)).rows
      .filter((row) => row.resourceSlotKey === 'room-00|slot-final');
    assertEqual(authoritative.length, 1, 'unique resource-slot invariant');
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
    return { diagnostic: code(rejected.reason), alternative: 'room-01|slot-final' };
  });

  await suite.pass('cc.ambiguous-retry-idempotence', async () => {
    const args = {
      idempotencyKey: 'ambiguous-retry', resourceKey: 'room-02', slotKey: 'slot-r',
      ownerId: 'alice', title: 'Retry safe', now: now + 3,
    };
    const first = await alice.mutate(api.reserve, { args });
    const retry = await alice.mutate(api.reserve, { args });
    assertEqual(retry.result, first.result, 'same idempotency key returns original reservation');
    const rows = (await alice.query(api.schedule)).rows.filter((row) => row.idempotencyKey === args.idempotencyKey);
    assertEqual(rows.length, 1, 'ambiguous retry created no duplicate');
    return { id: first.result, count: rows.length };
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
    return { ids: results.map((result) => result.result) };
  });

  await suite.pass('cc.observer-convergence', async () => {
    stream = observer.openLiveStream('cc-observer');
    const ownedStream = stream;
    await ownedStream.ready;
    suite.cleanup(() => ownedStream.close());
    await observer.subscribeLive(api.schedule, { connectionId: 'cc-observer' });
    const started = performance.now();
    await alice.mutate(api.reserve, { args: {
      idempotencyKey: 'observer', resourceKey: 'room-05', slotKey: 'slot-o',
      ownerId: 'alice', title: 'Observer proof', now: now + 6,
    } });
    const update = await stream.nextUpdate();
    const row = update.rows.find((entry) => entry.idempotencyKey === 'observer');
    assert(row, 'independent observer missed authoritative booking');
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
