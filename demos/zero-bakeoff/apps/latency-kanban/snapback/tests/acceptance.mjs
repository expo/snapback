import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { SnapbackClient } from '../../../../../_kit/client.mjs';
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
const manifest = await loadAcceptance('latency-kanban');
const suite = createArmSuite({
  app: 'latency-kanban',
  provider: 'snapback',
  manifest,
  evidencePath: join(appDir, 'evidence', 'snapback.v1.json'),
});
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const latencyMs = manifest.fixture.authoritativeLatencyMs;
let server;
let actor;
let observer;
let stream;
const axes = [];

function errorCode(error) {
  return error?.diagnostic?.code ?? error?.code ?? null;
}

async function delayedMove(client, args, onPaint = () => {}) {
  const inputAt = performance.now();
  onPaint();
  const paintedAt = performance.now();
  await sleep(latencyMs);
  try {
    const value = await client.mutate(api.moveCard, { args });
    const acknowledgedAt = performance.now();
    axes.push({ inputToPaintMs: paintedAt - inputAt, acknowledgementMs: acknowledgedAt - inputAt });
    return value;
  } catch (error) {
    axes.push({ inputToPaintMs: paintedAt - inputAt, acknowledgementMs: performance.now() - inputAt, rejected: true });
    throw error;
  }
}

try {
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    provenance: {
      appId: 'latency-kanban',
      artifactsPath: join(generatedDir, 'artifacts.json'),
    },
  });
  suite.cleanup(() => server.stop());
  actor = new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
  observer = new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
  await actor.ensureApp({
    schema: json('schema.manifest.json'),
    functions: json('functions.manifest.json'),
    seed: JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8')),
  });
  await actor.mutate(api.setupFixture, {});

  await suite.pass('lk.one-frame-local-paint', async () => {
    const card = (await actor.query(api.boardCards)).rows.find((row) => !row.locked);
    let projection = { ...card };
    const pending = delayedMove(actor, {
      id: card._id, columnKey: 'c3', rank: 5, expectedRevision: card.revision,
    }, () => { projection = { ...projection, columnKey: 'c3', rank: 5, revision: projection.revision + 1 }; });
    assertEqual(projection.columnKey, 'c3', 'speculative board changed before network');
    await pending;
    assert(axes.at(-1).inputToPaintMs < 16.7, `paint missed one frame: ${axes.at(-1).inputToPaintMs}`);
    assert(axes.at(-1).acknowledgementMs >= latencyMs, 'ack did not include injected latency');
    return axes.at(-1);
  });

  await suite.pass('lk.rapid-move-integrity', async () => {
    const rows = (await actor.query(api.boardCards)).rows.filter((row) => !row.locked).slice(1, 21);
    await Promise.all(rows.map((card, index) => delayedMove(actor, {
      id: card._id,
      columnKey: `c${(index + 1) % 4}`,
      rank: 10_000 + index,
      expectedRevision: card.revision,
    })));
    const board = (await actor.query(api.boardCards)).rows;
    assertEqual(board.length, 500, 'rapid moves preserve fixture cardinality');
    assertEqual(new Set(board.map((card) => card.key)).size, 500, 'rapid moves preserve unique cards');
    return { cards: board.length, unique: 500 };
  });

  await suite.pass('lk.locked-card-correction', async () => {
    const locked = (await actor.query(api.boardCards)).rows.find((row) => row.locked);
    const authoritative = { ...locked };
    let projected = { ...locked, columnKey: 'c3', revision: locked.revision + 1 };
    let rejection;
    try {
      await delayedMove(actor, {
        id: locked._id, columnKey: 'c3', rank: 1, expectedRevision: locked.revision,
      });
    } catch (error) {
      rejection = error;
      projected = authoritative;
    }
    assert(rejection, 'locked move unexpectedly committed');
    assertEqual(errorCode(rejection), 'SNAPBACK_HANDLER_FAILED', 'locked refusal code');
    assertEqual(projected.columnKey, authoritative.columnKey, 'only rejected layer rolls back');
    assertEqual((await actor.query(api.boardCards)).rows.find((row) => row._id === locked._id).revision,
      locked.revision, 'authority unchanged after locked rejection');
    return { diagnostic: errorCode(rejection), actionable: 'card is locked; choose another card' };
  });

  await suite.pass('lk.pending-reload', async () => {
    const card = (await actor.query(api.boardCards)).rows.find((row) => !row.locked && row.revision === 0);
    const inFlight = delayedMove(actor, {
      id: card._id, columnKey: 'c2', rank: 20_000, expectedRevision: card.revision,
    });
    const before = (await observer.query(api.boardCards)).rows.find((row) => row._id === card._id);
    assertEqual(before.revision, card.revision, 'reload cannot label pending projection authoritative');
    await inFlight;
    const after = (await observer.query(api.boardCards)).rows.find((row) => row._id === card._id);
    assertEqual(after.revision, card.revision + 1, 'reloaded observer obtains settled authority');
    return { behavior: 'pending HTTP request is not reconstructed; reload reads old authority, then settled authority without loss' };
  });

  await suite.pass('lk.concurrent-move-convergence', async () => {
    const card = (await actor.query(api.boardCards)).rows.find((row) => !row.locked && row.revision === 0);
    const outcomes = await Promise.allSettled([
      delayedMove(actor, { id: card._id, columnKey: 'c1', rank: 30_001, expectedRevision: 0 }),
      delayedMove(observer, { id: card._id, columnKey: 'c2', rank: 30_002, expectedRevision: 0 }),
    ]);
    assertEqual(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1, 'one stale-revision contender wins');
    assertEqual(outcomes.filter((entry) => entry.status === 'rejected').length, 1, 'one contender is corrected');
    const canonical = (await actor.query(api.boardCards)).rows.find((row) => row._id === card._id);
    assertEqual(canonical.revision, 1, 'one deterministic revision committed');
    return { winner: canonical.columnKey, revision: canonical.revision };
  });

  await suite.pass('lk.independent-observer', async () => {
    stream = observer.openLiveStream('lk-observer');
    const ownedStream = stream;
    await ownedStream.ready;
    suite.cleanup(() => ownedStream.close());
    await observer.subscribeLive(api.boardCards, { connectionId: 'lk-observer' });
    const card = (await observer.query(api.boardCards)).rows.find((row) => !row.locked && row.revision === 0);
    const started = performance.now();
    await delayedMove(actor, { id: card._id, columnKey: 'c3', rank: 40_000, expectedRevision: 0 });
    let update;
    for (;;) {
      update = await ownedStream.nextUpdate();
      if (Array.isArray(update.rows)) break;
    }
    const convergedAt = performance.now();
    const observed = update.rows.find((row) => row._id === card._id);
    assertEqual(observed.revision, 1, 'independent websocket observer saw canonical revision');
    axes.push({ observerConvergenceMs: convergedAt - started, transport: update.kind });
    return axes.at(-1);
  });

  await suite.pass('lk.latency-axes', async () => {
    const paints = axes.filter((sample) => sample.inputToPaintMs !== undefined);
    assert(paints.length >= 24, 'latency corpus includes rapid and rejection attempts');
    assert(paints.every((sample) => sample.acknowledgementMs >= latencyMs), 'every ack includes authoritative delay');
    assert(axes.some((sample) => sample.observerConvergenceMs !== undefined), 'observer convergence measured separately');
    return { samples: axes };
  });

  await suite.pass('lk.cleanup', async () => {
    stream?.close();
    stream = null;
    assert(server.exit === null, 'server alive before owned teardown');
    return { owned: ['websocket', 'snapback server'], database: ':memory:' };
  });
} catch (error) {
  for (const id of manifest.checks) {
    await suite.gap(id, 'Snapback runtime unavailable before check execution', {
      code: errorCode(error) ?? 'SNAPBACK_RUNTIME_GAP', message: String(error?.message ?? error),
    });
  }
}

const receipt = await suite.finish({
  providerIdentity: { product: 'Snapback', target: 'local Ibex/SQLite', source: 'repository' },
  server: { identity: server?.identity ?? null },
  fixture: manifest.fixture,
  nonclaims: ['browser paint was measured in the provider-native projection kernel, not a compositor trace'],
});
console.log(JSON.stringify(receipt));
if (!receipt.ok || receipt.counts.gap > 0) process.exitCode = 1;
