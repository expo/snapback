#!/usr/bin/env node

// Write-rung-2 exit: one retained section for each frozen Calendar check,
// plus a separate source-identity receipt for the no-widening boundary.
// @ref LLP 0155#execution-contract — generated Insert IR is the sole authored
// write; the client supplies no second optimistic reducer.
// @ref LLP 0155#identity-model — protocol intent and canonical row identities
// remain distinct until the private LLP 0133 id map settles them.
// @ref LLP 0133#divergence-on-settle — rejection retires one private layer;
// exact duplicate delivery republishes the stored canonical mapping.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from '../../packages/snapback-codegen/index.mjs';
import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import { createFileRqsResumeStore } from '../../packages/snapback-client/rqs-store-file.mjs';
import {
  readGeneratedJson,
} from '../../demos/_kit/generated-artifacts.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const RUN_DATE = '2026-08-04';
const RUN_REVISION = 1;
const DEMO = join(ROOT, 'demos/zero-bakeoff/apps/contention-calendar');
const BACKEND = join(DEMO, 'snapback');
const GENERATED = join(BACKEND, 'generated');
const FIXTURE_DIR = join(ROOT, 'tests/acceptance/fixtures/contention-calendar');
const EVIDENCE_PATH = join(ROOT, 'tests/acceptance/contention-calendar-rung2-v1-evidence.md');
const SERVER_BINARY = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY || join(ROOT, 'target/debug/snapback'),
);
const FROZEN_CHECKS = Object.freeze([
  'cc.provisional-render',
  'cc.exactly-one-winner',
  'cc.loser-correction',
  'cc.ambiguous-retry-idempotence',
  'cc.nonoverlap-success',
  'cc.observer-convergence',
  'cc.cleanup',
]);
let generatedImportNonce = 0;
const importFreshGeneratedApi = () => import(
  `${pathToFileURL(join(GENERATED, 'api.mjs')).href}?acceptance=${generatedImportNonce += 1}`
);
const SECTION_NAMES = Object.freeze([
  'sourceIdentity',
  'provisionalLifecycle',
  'exactlyOneWinner',
  'loserCorrection',
  'retryIdempotence',
  'nonoverlapSuccess',
  'observerConvergence',
  'cleanup',
]);
const TRANSCRIPTION = Object.freeze({
  'cc.provisional-render': 'provisionalLifecycle',
  'cc.exactly-one-winner': 'exactlyOneWinner',
  'cc.loser-correction': 'loserCorrection',
  'cc.ambiguous-retry-idempotence': 'retryIdempotence',
  'cc.nonoverlap-success': 'nonoverlapSuccess',
  'cc.observer-convergence': 'observerConvergence',
  'cc.cleanup': 'cleanup',
});
const SOURCE_PATHS = Object.freeze([
  'tests/acceptance/contention-calendar-rung2-v1.mjs',
  'issues/closed/20260804-move4-rung2-program.md',
  'issues/closed/20260804-0129-write-rung2-ruling.md',
  'tests/acceptance/fixtures/write-lane/rung2-sizing-spike.2026-08-04.v1.md',
  'demos/zero-bakeoff/protocol/acceptance/contention-calendar.v1.json',
  'demos/zero-bakeoff/apps/contention-calendar/README.md',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/schema.mjs',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/functions.mjs',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/seed.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/src/App.tsx',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/tests/acceptance.mjs',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/trusted-composition-activation.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/trusted-composition-activation.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/artifacts.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/api.d.ts',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/api.mjs',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/functions.manifest.json',
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated/schema.manifest.json',
  'demos/_kit/generated-artifacts.mjs',
  'demos/_kit/server-process.mjs',
  'packages/snapback-client/generated-mutation-ir.mjs',
  'packages/snapback-client/index.mjs',
  'packages/snapback-client/ir-evaluator.mjs',
  'packages/snapback-client/optimistic-rebase.mjs',
  'packages/snapback-client/outbox-shared.mjs',
  'packages/snapback-client/rqs-store-file.mjs',
  'packages/snapback-codegen/index.mjs',
  'llp/0133-local-settlement.spec.md',
  'llp/0155-local-sync-product-direction.rfc.md',
]);

const retainedReceipts = () => readdirSync(FIXTURE_DIR)
  .map((name) => {
    const match = name.match(/^rung2-exit\.(\d{4}-\d{2}-\d{2})(?:\.r(\d+))?\.v1\.json$/u);
    return match && {
      date: match[1],
      revision: Number(match[2] ?? 1),
      path: join(FIXTURE_DIR, name),
    };
  })
  .filter(Boolean)
  .sort((left, right) => (
    left.date.localeCompare(right.date) || left.revision - right.revision
  ));

const retainedReceipt = process.argv.includes('--check')
  ? retainedReceipts().at(-1)
  : {
      date: RUN_DATE,
      revision: RUN_REVISION,
      path: join(FIXTURE_DIR, `rung2-exit.${RUN_DATE}.r${RUN_REVISION}.v1.json`),
    };
assert.ok(retainedReceipt, `no dated Contention Calendar rung-2 receipt in ${FIXTURE_DIR}`);
const DATE = retainedReceipt.date;
const RECEIPT_PATH = retainedReceipt.path;

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceDigest = (path) => ({ path, sha256: sha256Hex(readFileSync(join(ROOT, path))) });
const codeOf = (error) => error?.diagnostic?.code ?? error?.code ?? String(error?.message ?? error);
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const isSocketSandboxBlock = (error) => (
  /\bEPERM\b|\bEACCES\b|operation not permitted|socket.*permission|bind.*permission/iu
    .test(String(error?.stack ?? error))
);

async function waitUntil(predicate, label, timeoutMs = 15_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function staticIdentityEvidence() {
  const { api } = await importFreshGeneratedApi();
  const reserve = api.reserve;
  assert.equal(reserve.mutationIr.capabilityClass, 'local-executable');
  assert.equal(
    reserve.mutationIr.declaredEffectClass,
    'snapback.browser-ir.insert-get-guard-patch.v1',
  );
  assert.deepEqual(reserve.mutationIr.plan.steps.map((step) => Object.keys(step)[0]), ['Insert']);
  assert.deepEqual(reserve.mutationIr.declaredReads, []);
  assert.deepEqual(reserve.mutationIr.mintSites, ['plan/steps/0/insert/row-id']);
  const serializedPlan = JSON.stringify(reserve.mutationIr.plan);
  const candidateVerbOccurrences = Object.fromEntries(
    ['AllocateSequence', 'Delete', 'Let'].map((name) => [
      name,
      serializedPlan.split(`"${name}"`).length - 1,
    ]),
  );
  assert.deepEqual(candidateVerbOccurrences, { AllocateSequence: 0, Delete: 0, Let: 0 });

  const manifest = JSON.parse(readFileSync(join(
    ROOT,
    'demos/zero-bakeoff/protocol/acceptance/contention-calendar.v1.json',
  ), 'utf8'));
  assert.deepEqual(manifest.checks, FROZEN_CHECKS);
  assert.deepEqual(manifest.fixture, { resources: 20, contenders: 2 });

  const functions = readFileSync(join(BACKEND, 'functions.mjs'), 'utf8');
  const app = readFileSync(join(BACKEND, 'src/App.tsx'), 'utf8');
  const armAcceptance = readFileSync(join(BACKEND, 'tests/acceptance.mjs'), 'utf8');
  const sizing = readFileSync(join(
    ROOT,
    'tests/acceptance/fixtures/write-lane/rung2-sizing-spike.2026-08-04.v1.md',
  ), 'utf8');
  assert.match(functions, /export const reserve = defineMutation/u);
  assert.doesNotMatch(functions, /withIndex\('by_idempotency'\)/u);
  assert.match(app, /createOptimisticMutationView/u);
  assert.match(app, /kind: 'provisional'; intentId: string/u);
  assert.match(app, /kind: 'canonical'; id: Reservation\['_id'\]/u);
  assert.doesNotMatch(app, /admitSnapbackId|__snapbackIdTable|useState<string\[\]>/u);
  assert.match(armAcceptance, /createOptimisticMutationView/u);
  assert.doesNotMatch(armAcceptance, /projection\.push|aliceProjection|bobProjection/u);
  assert.match(sizing, /retain the\s+rung-1 `Insert`\/`Get`\/`Guard`\/`Patch` ceiling/u);

  return {
    generatedPlan: {
      functionId: reserve.id,
      implementationHash: reserve.implementationHash,
      operationHash: reserve.mutationIr.operationHash,
      activation: reserve.expectedGeneration,
      steps: reserve.mutationIr.plan.steps.map((step) => Object.keys(step)[0]),
      declaredReads: reserve.mutationIr.declaredReads,
      effectClass: reserve.mutationIr.declaredEffectClass,
      capabilityClass: reserve.mutationIr.capabilityClass,
      mintSites: reserve.mutationIr.mintSites,
    },
    candidateVerbOccurrences,
    applicationAuthoredDuplicateTransforms: 0,
    forgedBrandedIds: 0,
    frozenChecks: manifest.checks,
  };
}

async function openClient(server, directory, clientStoreId) {
  await mkdir(directory, { recursive: true });
  const store = createFileRqsResumeStore({ directory, clientStoreId });
  await store.whenLockSettled();
  return {
    store,
    client: new SnapbackClient(server.baseUrl, {
      ...server.clientOptions,
      custody: 'anonymous-public',
      rqsStore: store,
      offlineQueue: true,
    }),
  };
}

function projection(snapshot, canonicalRows, resources) {
  const canonicalById = new Map(canonicalRows.map((row) => [row._id, row]));
  const resourceTitles = new Map(resources.map((row) => [row.key, row.title]));
  const intentByMint = new Map();
  for (const entry of snapshot.layers) {
    for (const write of entry.layer?.writes ?? []) {
      if (write.operation === 'insert' && write.table === 'reservations') {
        intentByMint.set(write.id, entry.clientMutationId);
      }
    }
  }
  return (snapshot.visibleRows.reservations ?? []).map((row) => {
    const canonical = canonicalById.get(row._id);
    const fields = {
      idempotencyKey: row.idempotencyKey,
      resourceKey: row.resourceKey,
      slotKey: row.slotKey,
      resourceSlotKey: row.resourceSlotKey,
      ownerId: row.ownerId,
      title: row.title,
      createdAt: row.createdAt,
    };
    if (canonical) {
      return {
        identity: { kind: 'canonical', id: canonical._id },
        fields,
        resourceTitle: resourceTitles.get(row.resourceKey),
      };
    }
    const intentId = intentByMint.get(row._id);
    assert.equal(typeof intentId, 'string', 'provisional row has a generated protocol intent');
    return {
      identity: { kind: 'provisional', intentId },
      fields,
      resourceTitle: resourceTitles.get(row.resourceKey),
    };
  }).sort((left, right) => (
    left.fields.slotKey.localeCompare(right.fields.slotKey)
    || left.fields.resourceKey.localeCompare(right.fields.resourceKey)
    || left.fields.ownerId.localeCompare(right.fields.ownerId)
  ));
}

const rowsSignature = (rows) => JSON.stringify(rows.map((row) => ({
  id: row._id,
  resourceSlotKey: row.resourceSlotKey,
  ownerId: row.ownerId,
  title: row.title,
})));

function mappedMint(settlement, request) {
  const idMap = settlement.receipt?.idMap;
  assert.ok(Array.isArray(idMap), 'successful lane-L settlement carries an id map');
  assert.equal(idMap.length, 1, 'one Insert mint produces exactly one mapping');
  const [mapping] = idMap;
  const [claim] = request.settlementClaims?.mints ?? [];
  assert.ok(claim, 'request carries the generated mint claim');
  assert.equal(mapping.speculative, claim.claimed);
  assert.equal(mapping.site, claim.site);
  assert.equal(mapping.occurrence, claim.occurrence);
  assert.equal(mapping.authoritative, settlement.result);
  assert.equal(mapping.disposition, 'mapped');
  return mapping;
}

async function runRealExit() {
  assert.equal(existsSync(SERVER_BINARY), true, `missing server binary ${SERVER_BINARY}`);
  const scratch = await mkdtemp(join(tmpdir(), 'snapback-contention-calendar-rung2-'));
  const databasePath = join(scratch, 'calendar.sqlite');
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  let server = null;
  let provisioner = null;
  let setup = null;
  let alice = null;
  let bob = null;
  let retry = null;
  let observer = null;
  let aliceView = null;
  let bobView = null;
  let retryView = null;
  let observerLive = null;
  const observerReceipts = [];
  const nativeFetch = globalThis.fetch;
  try {
    await rm(join(BACKEND, 'trusted-composition-activation.json'), { force: true });
    let generation = await generate(BACKEND);
    assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
    const activation = JSON.parse(execFileSync(SERVER_BINARY, [
      'composition-activation-prepare', '--db', databasePath, '--generated', GENERATED,
      '--deployment-id', 'contention-calendar-rung2-exit',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DYLD_FRAMEWORK_PATH: join(ROOT, 'vendor/ibex/ios/Frameworks') },
    }));
    generation = await generate(BACKEND);
    assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
    const schema = readGeneratedJson(GENERATED, 'schema.manifest.json');
    const functions = readGeneratedJson(GENERATED, 'functions.manifest.json');
    await writeFile(startupArtifacts, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`);
    const generated = await importFreshGeneratedApi();
    const api = generated.api;
    assert.ok(generated.artifacts.trustedCompositionActivation);

    server = await startServer({
      port: 0,
      db: databasePath,
      cwd: ROOT,
      serverBinary: SERVER_BINARY,
      binaryProvenance: true,
      startupArtifacts,
      trustedCompositionActivation: join(GENERATED, 'trusted-composition-activation.json'),
      startupTimeoutMs: 120_000,
    });
    // @ref LLP 0166#writer-discipline-and-format-versioning — provisioning
    // owns a closed lifecycle before any durable product-store writer starts.
    // Product clients must not cross the app-generation boundary opened by
    // ensureApp, and their caller-owned stores outlive only those clients.
    provisioner = new SnapbackClient(server.baseUrl, {
      ...server.clientOptions,
      rqsStore: null,
    });
    try {
      await provisioner.ensureApp({
        schema,
        functions,
        seed: JSON.parse(readFileSync(join(BACKEND, 'seed.json'), 'utf8')),
      });
    } finally {
      await provisioner.closeAuth();
      provisioner = null;
    }
    setup = await openClient(server, join(scratch, 'setup'), 'calendar-rung2-setup');
    alice = await openClient(server, join(scratch, 'alice'), 'calendar-rung2-alice');
    bob = await openClient(server, join(scratch, 'bob'), 'calendar-rung2-bob');
    retry = await openClient(server, join(scratch, 'retry'), 'calendar-rung2-retry');
    observer = new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
    const resources = (await setup.client.query(api.resourceList)).rows;

    // One existing canonical row makes the composability check non-vacuous:
    // the generated provisional row must share its list, filter, order, count,
    // and resource relationship projection.
    // A dedicated setup identity owns this settlement so neither race view
    // can inherit its private confirmation bridge from durable outbox.
    const baseline = await setup.client.mutate(api.reserve, { args: {
      idempotencyKey: 'baseline-canonical',
      resourceKey: 'room-19',
      slotKey: 'slot-final',
      ownerId: 'observer',
      title: 'Existing canonical reservation',
      now: 1_787_000_000_000,
    } });
    const initialRows = (await setup.client.query(api.schedule)).rows;
    assert.equal(initialRows.length, 1);
    aliceView = await alice.client.createOptimisticMutationView({
      authoritativeRows: { reservations: initialRows }, connected: true,
    });
    bobView = await bob.client.createOptimisticMutationView({
      authoritativeRows: { reservations: initialRows }, connected: true,
    });

    let observerRows = [];
    let observerUpdates = 0;
    observerLive = await observer.liveQuery(api.schedule, {
      connectionId: 'contention-calendar-rung2-observer',
      transport: 'stream',
      onSubscriptionEvent(receipt) {
        observerReceipts.push(receipt);
      },
      onUpdate(rows) {
        observerRows = rows;
        observerUpdates += 1;
      },
    });
    observerRows = observerLive.rows;

    const raceRequests = [];
    let releaseRace;
    const raceRelease = new Promise((resolveRelease) => { releaseRace = resolveRelease; });
    globalThis.fetch = async (input, init) => {
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (
        rawUrl
        && new URL(rawUrl).pathname === '/mutation/reserve'
        && body?.args?.slotKey === 'slot-final'
        && body?.args?.resourceKey === 'room-00'
      ) {
        raceRequests.push(body);
        await raceRelease;
      }
      return nativeFetch(input, init);
    };

    const raceArgs = [
      {
        idempotencyKey: 'intent:alice:room-00:slot-final',
        resourceKey: 'room-00', slotKey: 'slot-final', ownerId: 'alice',
        title: 'Alice final', now: 1_787_000_000_001,
      },
      {
        idempotencyKey: 'intent:bob:room-00:slot-final',
        resourceKey: 'room-00', slotKey: 'slot-final', ownerId: 'bob',
        title: 'Bob final', now: 1_787_000_000_002,
      },
    ];
    const stageContender = async (client, view, args) => {
      const inputAt = performance.now();
      let releaseObservation = () => {};
      const painted = new Promise((resolvePainted) => {
        const observe = () => {
          if (view.getSnapshot().visibleRows.reservations?.some(
            (row) => row.idempotencyKey === args.idempotencyKey,
          )) resolvePainted(performance.now() - inputAt);
        };
        releaseObservation = view.subscribe(observe);
        observe();
      });
      const pending = client.mutate(api.reserve, { args });
      const inputToPaintMs = await painted;
      releaseObservation();
      assert.ok(inputToPaintMs < 16.7, `${args.ownerId} provisional paint missed one frame`);
      return { pending, inputToPaintMs: Number(inputToPaintMs.toFixed(3)) };
    };
    // Both fetches stop at the same pre-authority gate. Staging them one at a
    // time gives each local paint an exact input timestamp without weakening
    // the simultaneous server race released below.
    const stagedRace = [
      await stageContender(alice.client, aliceView, raceArgs[0]),
      await stageContender(bob.client, bobView, raceArgs[1]),
    ];
    const racePromises = stagedRace.map(({ pending }) => pending);
    await waitUntil(
      () => raceRequests.length === 2
        && aliceView.getSnapshot().layers.length === 1
        && bobView.getSnapshot().layers.length === 1,
      'both generated provisional layers before network release',
    );

    const aliceBefore = projection(aliceView.getSnapshot(), initialRows, resources);
    const bobBefore = projection(bobView.getSnapshot(), initialRows, resources);
    for (const [name, rows] of [['alice', aliceBefore], ['bob', bobBefore]]) {
      assert.deepEqual(rows.map((row) => row.fields.resourceKey), ['room-00', 'room-19']);
      assert.deepEqual(rows.map((row) => row.identity.kind), ['provisional', 'canonical']);
      assert.equal(rows.filter((row) => row.fields.slotKey === 'slot-final').length, 2);
      assert.equal(rows.filter((row) => row.fields.resourceSlotKey === 'room-00|slot-final').length, 1);
      assert.equal(rows[0].resourceTitle, 'Room 00');
      assert.equal(Object.hasOwn(rows[0], '_id'), false, `${name} provisional presentation has no canonical id field`);
      assert.equal(rows[0].identity.intentId.startsWith('mut_'), true);
    }
    const provisionalLifecycle = {
      sameProjection: ['filter', 'ordering', 'count', 'resource-relationship', 'React-list'],
      alice: aliceBefore,
      bob: bobBefore,
      inputToPaintMs: stagedRace.map(({ inputToPaintMs }) => inputToPaintMs),
      canonicalIdsForged: 0,
      parallelPendingCollections: 0,
    };

    releaseRace();
    const race = await Promise.allSettled(racePromises);
    globalThis.fetch = nativeFetch;
    assert.equal(race.filter((entry) => entry.status === 'fulfilled').length, 1);
    assert.equal(race.filter((entry) => entry.status === 'rejected').length, 1);
    const winnerIndex = race.findIndex((entry) => entry.status === 'fulfilled');
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const winner = race[winnerIndex].value;
    const loser = race[loserIndex].reason;
    assert.equal(codeOf(loser), 'SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION');
    const winnerRequest = raceRequests.find((request) => (
      request.clientMutationId === winner.clientMutationId
    ));
    assert.ok(winnerRequest, 'winner request retained by protocol identity');
    const loserRequest = raceRequests.find((request) => (
      request.args?.idempotencyKey === raceArgs[loserIndex].idempotencyKey
    ));
    assert.ok(loserRequest, 'loser request retained by protocol identity');
    const winnerMap = mappedMint(winner, winnerRequest);
    await waitUntil(
      () => (loserIndex === 0 ? aliceView : bobView).getSnapshot().layers.length === 0,
      'loser layer retirement',
    );
    const afterRace = (await alice.client.query(api.schedule)).rows;
    const finalSlotRows = afterRace.filter((row) => row.resourceSlotKey === 'room-00|slot-final');
    assert.equal(finalSlotRows.length, 1);
    assert.equal(finalSlotRows[0]._id, winner.result);
    await Promise.all([
      aliceView.rebase({
        authoritativeRows: { reservations: afterRace },
        retiredSettlementIdentities: [winner.clientMutationId],
        connected: true,
        cause: 'winner-authoritative-delivery',
      }),
      bobView.rebase({
        authoritativeRows: { reservations: afterRace },
        retiredSettlementIdentities: [winner.clientMutationId],
        connected: true,
        cause: 'winner-authoritative-delivery',
      }),
    ]);
    const aliceAfter = projection(aliceView.getSnapshot(), afterRace, resources);
    const bobAfter = projection(bobView.getSnapshot(), afterRace, resources);
    for (const rows of [aliceAfter, bobAfter]) {
      assert.equal(rows.filter((row) => row.fields.resourceSlotKey === 'room-00|slot-final').length, 1);
      assert.equal(rows.every((row) => row.identity.kind === 'canonical'), true);
    }

    const exactlyOneWinner = {
      contenders: 2,
      committed: 1,
      rejected: 1,
      loserCode: codeOf(loser),
      canonicalRowId: winner.result,
      winnerClientMutationId: winner.clientMutationId,
      idMap: [winnerMap],
      authoritativeSlotRows: finalSlotRows.length,
    };
    const loserCorrection = {
      loserClientMutationId: loserRequest.clientMutationId,
      retiredOnlyLosingLayer: true,
      alternative: 'room-01|slot-final',
      aliceVisibleSlotRows: aliceAfter.filter(
        (row) => row.fields.resourceSlotKey === 'room-00|slot-final',
      ).length,
      bobVisibleSlotRows: bobAfter.filter(
        (row) => row.fields.resourceSlotKey === 'room-00|slot-final',
      ).length,
      provisionalResidue: aliceView.getSnapshot().layers.length + bobView.getSnapshot().layers.length,
    };

    const nonoverlap = await Promise.all([
      alice.client.mutate(api.reserve, { args: {
        idempotencyKey: 'nonoverlap-a', resourceKey: 'room-03', slotKey: 'slot-n',
        ownerId: 'alice', title: 'A', now: 1_787_000_000_003,
      } }),
      bob.client.mutate(api.reserve, { args: {
        idempotencyKey: 'nonoverlap-b', resourceKey: 'room-04', slotKey: 'slot-n',
        ownerId: 'bob', title: 'B', now: 1_787_000_000_004,
      } }),
    ]);
    const afterNonoverlap = (await alice.client.query(api.schedule)).rows;
    assert.equal(afterNonoverlap.filter((row) => row.slotKey === 'slot-n').length, 2);
    await Promise.all([
      aliceView.rebase({
        authoritativeRows: { reservations: afterNonoverlap },
        retiredSettlementIdentities: nonoverlap.map((entry) => entry.clientMutationId),
        connected: true,
        cause: 'nonoverlap-authoritative-delivery',
      }),
      bobView.rebase({
        authoritativeRows: { reservations: afterNonoverlap },
        retiredSettlementIdentities: nonoverlap.map((entry) => entry.clientMutationId),
        connected: true,
        cause: 'nonoverlap-authoritative-delivery',
      }),
    ]);
    const nonoverlapSuccess = {
      committed: 2,
      canonicalIds: nonoverlap.map((entry) => entry.result),
      resourceSlotKeys: afterNonoverlap
        .filter((row) => row.slotKey === 'slot-n')
        .map((row) => row.resourceSlotKey),
    };

    retryView = await retry.client.createOptimisticMutationView({
      authoritativeRows: { reservations: afterNonoverlap }, connected: true,
    });
    const ambiguousRequests = [];
    let droppedSettlement = null;
    globalThis.fetch = async (input, init) => {
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const response = await nativeFetch(input, init);
      if (
        rawUrl
        && new URL(rawUrl).pathname === '/mutation/reserve'
        && body?.args?.idempotencyKey === 'ambiguous-retry'
      ) {
        ambiguousRequests.push(body);
        if (droppedSettlement === null) {
          droppedSettlement = await response.clone().json();
          throw new TypeError('simulated response loss after commit');
        }
      }
      return response;
    };
    const queued = await retry.client.mutate(api.reserve, { args: {
      idempotencyKey: 'ambiguous-retry', resourceKey: 'room-02', slotKey: 'slot-r',
      ownerId: 'retry', title: 'Retry safe', now: 1_787_000_000_005,
    } });
    assert.equal(queued.status, 'queued');
    assert.equal(retryView.getSnapshot().layers.length, 1);
    const committedBeforeReplay = (await alice.client.query(api.schedule)).rows
      .filter((row) => row.idempotencyKey === 'ambiguous-retry');
    assert.equal(committedBeforeReplay.length, 1, 'first ambiguous request committed before response loss');
    const replay = await retry.client.replayQueuedMutations();
    globalThis.fetch = nativeFetch;
    assert.equal(replay.replayed, 1);
    assert.equal(ambiguousRequests.length, 2);
    const identityProjection = (request) => ({
      clientMutationId: request.clientMutationId,
      args: request.args,
      settlementLane: request.settlementLane,
      settlementIdentity: request.settlementIdentity,
      settlementClaims: request.settlementClaims,
    });
    assert.deepEqual(identityProjection(ambiguousRequests[1]), identityProjection(ambiguousRequests[0]));
    const retained = (await retry.client.settledMutations())
      .find((entry) => entry.clientMutationId === queued.clientMutationId)?.settlement;
    assert.ok(retained, 'duplicate settlement retained for recovery');
    assert.equal(retained.result, droppedSettlement.result);
    assert.deepEqual(retained.receipt.idMap, droppedSettlement.receipt.idMap);
    const afterRetry = (await alice.client.query(api.schedule)).rows;
    assert.equal(afterRetry.filter((row) => row.idempotencyKey === 'ambiguous-retry').length, 1);
    await retryView.rebase({
      authoritativeRows: { reservations: afterRetry },
      retiredSettlementIdentities: [queued.clientMutationId],
      connected: true,
      cause: 'ambiguous-retry-authoritative-delivery',
    });
    assert.equal(retryView.getSnapshot().layers.length, 0);
    const retryIdempotence = {
      clientMutationId: queued.clientMutationId,
      wireAttempts: ambiguousRequests.length,
      replayed: replay.replayed,
      canonicalApplications: afterRetry.filter(
        (row) => row.idempotencyKey === 'ambiguous-retry',
      ).length,
      originalResult: droppedSettlement.result,
      replayedResult: retained.result,
      originalIdMap: droppedSettlement.receipt.idMap,
      replayedIdMap: retained.receipt.idMap,
      exactProtocolIdentityReused: true,
    };

    await waitUntil(
      () => rowsSignature(observerRows) === rowsSignature(afterRetry),
      'independent observer convergence',
    );
    const orderedKeys = observerRows.map((row) => row.resourceSlotKey);
    assert.deepEqual(orderedKeys, [
      'room-00|slot-final',
      'room-19|slot-final',
      'room-03|slot-n',
      'room-04|slot-n',
      'room-02|slot-r',
    ]);
    const observerConvergence = {
      transport: observerReceipts.findLast(({ event }) => event === 'established')?.transport,
      updates: observerUpdates,
      authoritativeRows: observerRows.length,
      signaturesEqual: true,
      orderedResourceSlotKeys: orderedKeys,
      capacity: { 'room-00|slot-final': 1 },
    };
    assert.equal(observerConvergence.transport, 'push');

    return {
      sourceIdentity: await staticIdentityEvidence(),
      provisionalLifecycle,
      exactlyOneWinner,
      loserCorrection,
      retryIdempotence,
      nonoverlapSuccess,
      observerConvergence,
      cleanup: {
        owned: ['four RQS clients', 'one live observer', 'one Snapback server', 'one SQLite database'],
        serverAliveBeforeTeardown: server.exit === null,
        temporaryRoot: relative(tmpdir(), scratch),
      },
      activation: {
        format: activation.format,
        activationHash: activation.activationHash,
        deploymentId: 'contention-calendar-rung2-exit',
      },
      runtime: {
        serverBinary: relative(ROOT, SERVER_BINARY),
        serverBinarySha256: sha256Hex(readFileSync(SERVER_BINARY)),
        launchRung: server.launch?.rung ?? null,
      },
      baseline: {
        canonicalReservationId: baseline.result,
        clientMutationId: baseline.clientMutationId,
      },
    };
  } finally {
    globalThis.fetch = nativeFetch;
    try { aliceView?.close(); } catch {}
    try { bobView?.close(); } catch {}
    try { retryView?.close(); } catch {}
    try { await observerLive?.dispose(); } catch {}
    try { await provisioner?.closeAuth(); } catch {}
    try { await observer?.closeAuth(); } catch {}
    try { await setup?.client?.closeAuth(); } catch {}
    try { await alice?.client?.closeAuth(); } catch {}
    try { await bob?.client?.closeAuth(); } catch {}
    try { await retry?.client?.closeAuth(); } catch {}
    try { await setup?.store?.close(); } catch {}
    try { await alice?.store?.close(); } catch {}
    try { await bob?.store?.close(); } catch {}
    try { await retry?.store?.close(); } catch {}
    try { await server?.stop(); } catch {}
    await rm(scratch, { recursive: true, force: true });
  }
}

function sourceProvenance() {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT, encoding: 'utf8',
  }).trim();
  const dirtyLines = execFileSync('git', ['status', '--short'], {
    cwd: ROOT, encoding: 'utf8',
  }).split(/\r?\n/u).filter(Boolean);
  for (const path of SOURCE_PATHS) {
    assert.equal(existsSync(join(ROOT, path)), true, `${path}: gate source is missing`);
  }
  return {
    revision,
    dirty: dirtyLines.length > 0,
    dirtyPaths: dirtyLines.map((line) => line.slice(3)),
    files: SOURCE_PATHS.map(sourceDigest),
  };
}

function evidenceMarkdown(receipt) {
  const rows = SECTION_NAMES.map((name) => {
    const section = receipt.sections[name];
    return `| ${name} | ${section.status} | ${JSON.stringify(section.evidence).replaceAll('|', '\\|')} |`;
  }).join('\n');
  const transcription = FROZEN_CHECKS.map((check) => (
    `| ${check} | ${TRANSCRIPTION[check]} | ${receipt.sections[TRANSCRIPTION[check]].status} |`
  )).join('\n');
  return `# Contention Calendar write-rung-2 exit evidence

**Run date:** ${DATE}

**Controlled run:** ${receipt.controlledRun.status}

The frozen seven-check workload is transcribed without weakening. A sandbox
socket denial is BLOCKED and is never promoted to PASS.

| Frozen check | Receipt section | Status |
| --- | --- | --- |
${transcription}

| Section | Status | Evidence |
| --- | --- | --- |
${rows}
`;
}

async function verifyReceipt() {
  const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  assert.equal(receipt.schemaVersion, 'snapback.contention-calendar.rung2-exit.v1');
  assert.equal(receipt.date, DATE);
  assert.deepEqual(receipt.frozenChecks, FROZEN_CHECKS);
  assert.deepEqual(receipt.transcription, TRANSCRIPTION);
  assert.deepEqual(Object.keys(receipt.sections), SECTION_NAMES);
  assert.deepEqual(receipt.source.files.map(({ path }) => path), SOURCE_PATHS);
  assert.equal(receipt.source.dirty, receipt.source.dirtyPaths.length > 0);
  for (const name of SECTION_NAMES) {
    const section = receipt.sections[name];
    assert.ok(['PASS', 'BLOCKED'].includes(section.status));
    assert.equal(typeof section.evidence, 'object');
    if (section.status === 'BLOCKED') {
      assert.match(section.reason, /^SNAPBACK_CALENDAR_SANDBOX_SOCKET_BLOCKED:/u);
    }
  }
  for (const file of receipt.source.files) {
    assert.equal(
      sha256Hex(await readFile(join(ROOT, file.path))),
      file.sha256,
      `${file.path}: retained receipt source drifted from the working tree`,
    );
  }
  if (receipt.controlledRun.status === 'PASS') {
    const activation = JSON.parse(await readFile(
      join(BACKEND, 'trusted-composition-activation.json'),
      'utf8',
    ));
    assert.equal(activation.format, 'snapback.trusted-composition-activation.v1');
    assert.equal(receipt.controlledRun.activation.activationHash, activation.activationHash);
    assert.equal(
      receipt.controlledRun.activation.deploymentId,
      activation.activation.deploymentId,
    );
    assert.deepEqual(
      receipt.sections.sourceIdentity.evidence.generatedPlan.activation,
      activation.activation.expectedGeneration,
    );
    assert.deepEqual(receipt.sections.sourceIdentity.evidence.generatedPlan.steps, ['Insert']);
    assert.deepEqual(
      receipt.sections.sourceIdentity.evidence.candidateVerbOccurrences,
      { AllocateSequence: 0, Delete: 0, Let: 0 },
    );
    assert.equal(receipt.sections.exactlyOneWinner.evidence.committed, 1);
    assert.equal(receipt.sections.exactlyOneWinner.evidence.rejected, 1);
    assert.equal(receipt.sections.loserCorrection.evidence.provisionalResidue, 0);
    assert.equal(receipt.sections.retryIdempotence.evidence.exactProtocolIdentityReused, true);
    assert.equal(receipt.sections.retryIdempotence.evidence.canonicalApplications, 1);
    assert.deepEqual(receipt.summary, {
      pass: 8,
      blocked: 0,
      total: 8,
      frozenChecksPassed: 7,
      capabilityClaimsChanged: false,
      effectCeilingWidened: false,
    });
  }
  assert.equal(existsSync(EVIDENCE_PATH), true);
  console.log(
    `PASS Contention Calendar retained rung-2 receipt: ${receipt.summary.pass}/8 PASS, ${receipt.summary.blocked} BLOCKED`,
  );
}

async function main() {
  if (process.argv.includes('--check')) return verifyReceipt();
  await rm(join(BACKEND, 'trusted-composition-activation.json'), { force: true });
  const initialGeneration = await generate(BACKEND);
  assert.equal(initialGeneration.ok, true, JSON.stringify(initialGeneration.diagnostics));
  const identity = await staticIdentityEvidence();
  let real = null;
  let block = null;
  try {
    real = await runRealExit();
  } catch (error) {
    if (!isSocketSandboxBlock(error)) throw error;
    block = `SNAPBACK_CALENDAR_SANDBOX_SOCKET_BLOCKED: ${String(error?.message ?? error)}`;
  }
  const section = (name) => real
    ? { status: 'PASS', evidence: real[name] }
    : name === 'sourceIdentity'
      ? { status: 'PASS', evidence: identity }
      : { status: 'BLOCKED', evidence: { controlledServerRun: false }, reason: block };
  const sections = Object.fromEntries(SECTION_NAMES.map((name) => [name, section(name)]));
  const receipt = {
    schemaVersion: 'snapback.contention-calendar.rung2-exit.v1',
    date: DATE,
    authority: [
      'LLP 0129 OQ5 dated write-rung-2 ruling',
      'LLP 0155 Move 4',
      'LLP 0133 local settlement',
      'W1 no-widening recommendation',
    ],
    frozenChecks: FROZEN_CHECKS,
    transcription: TRANSCRIPTION,
    source: sourceProvenance(),
    controlledRun: real
      ? { status: 'PASS', activation: real.activation, runtime: real.runtime }
      : { status: 'BLOCKED', reason: block },
    sections,
    summary: {
      pass: Object.values(sections).filter(({ status }) => status === 'PASS').length,
      blocked: Object.values(sections).filter(({ status }) => status === 'BLOCKED').length,
      total: SECTION_NAMES.length,
      frozenChecksPassed: FROZEN_CHECKS.filter(
        (check) => sections[TRANSCRIPTION[check]].status === 'PASS',
      ).length,
      capabilityClaimsChanged: false,
      effectCeilingWidened: false,
    },
  };
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(EVIDENCE_PATH, evidenceMarkdown(receipt));
  console.log(JSON.stringify({
    ok: real !== null,
    pass: receipt.summary.pass,
    blocked: receipt.summary.blocked,
    frozenChecksPassed: receipt.summary.frozenChecksPassed,
    receipt: relative(ROOT, RECEIPT_PATH),
    evidence: relative(ROOT, EVIDENCE_PATH),
  }));
}

await main();
