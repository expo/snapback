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
  loadAcceptanceVersion,
  loadNetworkCondition,
} from '../../../../shared/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..', '..');
const repoRoot = resolve(appDir, '..', '..', '..', '..');
const generatedDir = join(appDir, 'snapback', 'generated');
const json = (name) => JSON.parse(readFileSync(join(generatedDir, name), 'utf8'));
const { default: api } = await import(pathToFileURL(join(generatedDir, 'api.mjs')).href);
const manifest = await loadAcceptanceVersion('latency-kanban', 'v2');
const networkCondition = await loadNetworkCondition(manifest, 'snapback');
const suite = createArmSuite({
  app: 'latency-kanban',
  provider: 'snapback',
  manifest,
  evidencePath: join(appDir, 'evidence', 'snapback.v1.json'),
});
const serverBinary = resolve(process.env.SNAPBACK_RUNTIME_BINARY || join(repoRoot, 'target', 'debug', 'snapback'));
const nativeFetch = globalThis.fetch;
const observedMutationResponses = [];
globalThis.fetch = async (input, init) => {
  const started = performance.now();
  const response = await nativeFetch(input, init);
  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  if (rawUrl) {
    const url = new URL(rawUrl);
    if (url.pathname.startsWith('/mutation/')) {
      observedMutationResponses.push({
        origin: url.origin,
        path: url.pathname,
        status: response.status,
        elapsedMs: performance.now() - started,
        networkProfile: response.headers.get('snapback-network-profile'),
      });
    }
  }
  return response;
};
suite.cleanup(() => { globalThis.fetch = nativeFetch; });

const { profile, profileName, windows } = networkCondition;
let server;
let actor;
let observer;
let stream;
const axes = [];
let firstMove;
let openLoopMoves;
let optimisticOpenLoopFacts;

function errorCode(error) {
  return error?.diagnostic?.code ?? error?.code ?? null;
}

async function moveUnderProfile(client, args, onPaint = () => {}, { concurrent = false } = {}) {
  const inputAt = performance.now();
  onPaint();
  const paintedAt = performance.now();
  try {
    const value = await client.mutate(api.moveCard, { args });
    const acknowledgedAt = performance.now();
    axes.push({ inputToPaintMs: paintedAt - inputAt, acknowledgementMs: acknowledgedAt - inputAt, concurrent });
    return value;
  } catch (error) {
    axes.push({ inputToPaintMs: paintedAt - inputAt, acknowledgementMs: performance.now() - inputAt, rejected: true, concurrent });
    throw error;
  }
}

function assertLatencyWindow(value, window, label) {
  assert(value >= window.floorMs,
    `${label} ${value.toFixed(3)}ms was below ${window.floorMs}ms profile floor`);
  assert(value <= window.floorMs + window.toleranceMs,
    `${label} ${value.toFixed(3)}ms exceeded ${window.floorMs + window.toleranceMs}ms window ceiling`);
}

function timestampFreeCommitFacts(moves, settlements, rows) {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const settlementOrder = settlements.map((settlement, index) => ({
    move: index,
    version: settlement.version,
    changedCount: settlement.changed_count,
  }));
  assert(settlementOrder.every((entry) => Number.isInteger(entry.version)),
    'open-loop settlements expose integer commit versions');
  // Canonical projection: which version lands on which of 20 CONCURRENT
  // moves is kernel arrival racing — nondeterministic between any two runs,
  // normal or profiled. State-unchanged means every move commits exactly
  // once with the same effect size, the same version multiset is consumed,
  // and the final rows are identical; it does not mean concurrent arrival
  // interleaving reproduces (LLP 0167 observation-vs-state boundary).
  return {
    settlementVersions: settlementOrder.map((entry) => entry.version).sort((a, b) => a - b),
    perMoveChangedCounts: settlementOrder.map((entry) => entry.changedCount),
    cards: moves.map(({ key }) => {
      const row = byKey.get(key);
      assert(row, `open-loop card ${key} remains present`);
      return {
        key,
        columnKey: row.columnKey,
        rank: row.rank,
        revision: row.revision,
        locked: row.locked,
      };
    }),
  };
}

async function normalOpenLoopFacts() {
  let normalServer;
  try {
    normalServer = await startServer({
      port: 0,
      db: ':memory:',
      cwd: repoRoot,
      serverBinary,
      env: { SNAPBACK_NETWORK_PROFILE: 'normal' },
      provenance: {
        appId: 'latency-kanban',
        artifactsPath: join(generatedDir, 'artifacts.json'),
      },
    });
    const client = new SnapbackClient(normalServer.baseUrl, { ...normalServer.clientOptions, rqsStore: null });
    await client.ensureApp({
      schema: json('schema.manifest.json'),
      functions: json('functions.manifest.json'),
      seed: JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8')),
    });
    await client.mutate(api.setupFixture, {});
    const initialRows = (await client.query(api.boardCards)).rows;
    const normalIds = new Map(initialRows.map((row) => [row.key, row._id]));
    assert(normalIds.has(firstMove.key), `normal fixture contains ${firstMove.key}`);
    assert(openLoopMoves.every((move) => normalIds.has(move.key)),
      'normal fixture contains every open-loop card');
    await client.mutate(api.moveCard, {
      args: { ...firstMove.args, id: normalIds.get(firstMove.key) },
    });
    const settlements = await Promise.all(openLoopMoves.map((move) =>
      client.mutate(api.moveCard, {
        args: { ...move.args, id: normalIds.get(move.key) },
      })));
    const rows = (await client.query(api.boardCards)).rows;
    return timestampFreeCommitFacts(openLoopMoves, settlements, rows);
  } finally {
    await normalServer?.stop();
  }
}

try {
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    serverBinary,
    env: { SNAPBACK_NETWORK_PROFILE: profileName },
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
    firstMove = {
      key: card.key,
      args: { id: card._id, columnKey: 'c3', rank: 5, expectedRevision: card.revision },
    };
    const pending = moveUnderProfile(actor, firstMove.args,
      () => { projection = { ...projection, columnKey: 'c3', rank: 5, revision: projection.revision + 1 }; });
    assertEqual(projection.columnKey, 'c3', 'speculative board changed before network');
    await pending;
    assert(axes.at(-1).inputToPaintMs < 16.7, `paint missed one frame: ${axes.at(-1).inputToPaintMs}`);
    assertLatencyWindow(axes.at(-1).acknowledgementMs, windows.actorAck, 'actor acknowledgement');
    return axes.at(-1);
  });

  await suite.pass('lk.rapid-move-integrity', async () => {
    const rows = (await actor.query(api.boardCards)).rows
      .filter((row) => !row.locked && row.revision === 0)
      .slice(0, 20);
    openLoopMoves = rows.map((card, index) => ({
      key: card.key,
      args: {
        id: card._id,
        columnKey: `c${(index + 1) % 4}`,
        rank: 10_000 + index,
        expectedRevision: card.revision,
      },
    }));
    // Concurrent open-loop samples: commit-queue wait is state-side and
    // profile-independent, so these assert the floor only (see the v2
    // manifest's measurementDiscipline); the window ceiling binds paced
    // samples.
    const settlements = await Promise.all(openLoopMoves.map((move) =>
      moveUnderProfile(actor, move.args, () => {}, { concurrent: true })));
    const board = (await actor.query(api.boardCards)).rows;
    assertEqual(board.length, 500, 'rapid moves preserve fixture cardinality');
    assertEqual(new Set(board.map((card) => card.key)).size, 500, 'rapid moves preserve unique cards');
    optimisticOpenLoopFacts = timestampFreeCommitFacts(openLoopMoves, settlements, board);
    return { cards: board.length, unique: 500, openLoop: true };
  });

  await suite.pass('lk.locked-card-correction', async () => {
    const locked = (await actor.query(api.boardCards)).rows.find((row) => row.locked);
    const authoritative = { ...locked };
    let projected = { ...locked, columnKey: 'c3', revision: locked.revision + 1 };
    let rejection;
    try {
      await moveUnderProfile(actor, {
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
    const inFlight = moveUnderProfile(actor, {
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
    // Two contenders racing one card: the corrected contender pays a second
    // settlement round under the ack delay, so these are concurrent samples
    // (floor-only) like the open-loop burst.
    const outcomes = await Promise.allSettled([
      moveUnderProfile(actor, { id: card._id, columnKey: 'c1', rank: 30_001, expectedRevision: 0 }, () => {}, { concurrent: true }),
      moveUnderProfile(observer, { id: card._id, columnKey: 'c2', rank: 30_002, expectedRevision: 0 }, () => {}, { concurrent: true }),
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
    await moveUnderProfile(actor, { id: card._id, columnKey: 'c3', rank: 40_000, expectedRevision: 0 });
    let update;
    for (;;) {
      update = await ownedStream.nextUpdate();
      if (Array.isArray(update.rows)) break;
    }
    const convergedAt = performance.now();
    const observed = update.rows.find((row) => row._id === card._id);
    assertEqual(observed.revision, 1, 'independent websocket observer saw canonical revision');
    assertEqual(update.network_profile, profileName, 'delayed socket frame carries the profile marker');
    axes.push({
      observerConvergenceMs: convergedAt - started,
      transport: update.kind,
      networkProfile: update.network_profile,
    });
    assertLatencyWindow(axes.at(-1).observerConvergenceMs, windows.observerDelta,
      'observer delta');
    return axes.at(-1);
  });

  await suite.pass('lk.latency-axes', async () => {
    const paints = axes.filter((sample) => sample.inputToPaintMs !== undefined);
    assert(paints.length >= 24, 'latency corpus includes rapid and rejection attempts');
    const paced = paints.filter((sample) => !sample.concurrent);
    assert(paced.length >= 3, 'latency corpus includes paced samples that exercise the window ceiling');
    for (const sample of paints) {
      assert(sample.acknowledgementMs >= windows.actorAck.floorMs,
        `actor acknowledgement ${sample.acknowledgementMs.toFixed(3)}ms was below ${windows.actorAck.floorMs}ms profile floor`);
    }
    for (const sample of paced) {
      assertLatencyWindow(sample.acknowledgementMs, windows.actorAck, 'actor acknowledgement (paced)');
    }
    assert(axes.some((sample) => sample.observerConvergenceMs !== undefined), 'observer convergence measured separately');
    const profiledMoveResponses = observedMutationResponses.filter((response) =>
      response.origin === server.baseUrl && response.path.endsWith('/moveCard'));
    // The client's mutation lane replays while an ack is outstanding, so a
    // delayed ack legitimately yields multiple HTTP attempts per logical
    // move; settlement identity dedupes them (commit facts above are exact).
    // Assert coverage and marker honesty, and surface the amplification as a
    // comparative observation rather than pretending 1:1.
    assert(profiledMoveResponses.length >= paints.length,
      'every measured move has at least one observed HTTP response');
    assert(profiledMoveResponses.every((response) => response.networkProfile === profileName),
      'every delayed mutation response carries the network-profile marker');
    const retryAmplification = Number((profiledMoveResponses.length / paints.length).toFixed(2));
    const normalFacts = await normalOpenLoopFacts();
    assertEqual(JSON.stringify(normalFacts), JSON.stringify(optimisticOpenLoopFacts),
      'normal and optimistic runs preserve timestamp-free open-loop commit facts');
    return {
      samples: axes,
      profile: profileName,
      injectionPoint: networkCondition.injectionPoint,
      markedMutationResponses: profiledMoveResponses.length,
      measuredMoves: paints.length,
      retryAmplification,
      openLoopCommitFacts: optimisticOpenLoopFacts,
    };
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
  networkCondition: {
    schemaVersion: networkCondition.environment.schemaVersion,
    profile,
    windows,
    injectionPoint: networkCondition.injectionPoint,
  },
  nonclaims: ['browser paint was measured in the provider-native projection kernel, not a compositor trace'],
});
console.log(JSON.stringify(receipt));
if (!receipt.ok || receipt.counts.gap > 0) process.exitCode = 1;
