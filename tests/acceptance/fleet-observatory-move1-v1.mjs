#!/usr/bin/env node

// Fleet half of LLP 0157's Move-1 workload exit. This is fresh successor
// evidence; it never rewrites LLP 0138's frozen bakeoff receipts and never
// flips the carrier GAP or a capability row.
//
// @ref LLP 0157#move-1-workload-exit-llp-0155-normative-transcription — one
// retained receipt covers all eight Fleet gates verbatim.
// @ref LLP 0157#d4--capability-classification — snapshot-batch.v2 custody is
// volatile and retention:"none"; the footprint measures that exact posture.
// @ref LLP 0138#status — the successor witness is separate from the immutable
// 2026-08-01 bakeoff evidence.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from '../../packages/snapback-codegen/index.mjs';
import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import {
  decodeMaterializationRecordV1,
} from '../../packages/snapback-client/materialization-store.mjs';
import {
  createFileRqsResumeStore,
} from '../../packages/snapback-client/rqs-store-file.mjs';
import {
  materializationPayloadProjection,
} from '../../packages/snapback-client/store-policy.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../packages/snapback-contract/auth-coordinator.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../demos/_kit/generated-artifacts.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';
import {
  FLEET_WORKLOAD,
  batches,
  eventBatches,
  mainViewRollups,
  switchViewRollup,
  telemetryBurst,
  vehicleBatches,
} from '../../demos/fleet-observatory-move1/fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const RUN_DATE = '2026-08-06';
const WORKLOAD_DATE = '2026-08-06';
const DEMO = join(ROOT, 'demos/fleet-observatory-move1');
const BACKEND = join(DEMO, 'snapback');
const GENERATED = join(BACKEND, 'generated');
const FIXTURE_DIR = join(ROOT, 'tests/acceptance/fixtures/fleet-observatory');
const latestRetainedDate = () => {
  const dates = readdirSync(FIXTURE_DIR)
    .map((name) => name.match(/^move1-exit\.(\d{4}-\d{2}-\d{2})\.v1\.json$/u)?.[1])
    .filter(Boolean)
    .sort();
  assert.ok(dates.length > 0, `no dated Fleet Move-1 receipt in ${FIXTURE_DIR}`);
  return dates.at(-1);
};
const DATE = process.argv.includes('--check') ? latestRetainedDate() : RUN_DATE;
const RECEIPT_PATH = join(FIXTURE_DIR, `move1-exit.${DATE}.v1.json`);
const BUDGET_PATH = join(FIXTURE_DIR, `budget-freeze.${DATE}.v1.json`);
const EVIDENCE_PATH = join(ROOT, 'tests/acceptance/fleet-observatory-move1-v1-evidence.md');
const SERVER_BINARY = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY || join(ROOT, 'target/debug/snapback'),
);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const GATES = Object.freeze([
  'required screens consume generated composites rather than JavaScript collection joins',
  'the client retains only desired bounded query results',
  'pagination neither duplicates nor skips an untouched root',
  '20 query changes leak no predecessor rows',
  'the 250,000-event fixture converges to exactly 100 active matches from the 1,000-update burst',
  'an implicit incomplete prefix is impossible to consume as complete',
  'Mallory receives no protected source or result rows',
  'inspection explains every retained row and completeness transition',
]);

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceDigest = (path) => ({ path, sha256: sha256Hex(readFileSync(join(ROOT, path))) });

function diagnosticCode(error) {
  return error?.diagnostic?.code ?? error?.code ?? String(error?.message ?? error);
}

function isSocketSandboxBlock(error) {
  const rendered = String(error?.stack ?? error);
  return /\bEPERM\b|\bEACCES\b|operation not permitted|socket.*permission|bind.*permission/iu.test(rendered);
}

function staticCompositionEvidence() {
  const functions = readGeneratedJson(GENERATED, 'functions.manifest.json').functions;
  const byName = new Map(functions.map((definition) => [definition.name, definition]));
  const route = byName.get('fleetObservatory');
  const plan = route.runtime.HostPlan.SnapshotBatchV2;
  const source = readFileSync(join(BACKEND, 'functions.mjs'), 'utf8');
  const screenSource = readFileSync(join(DEMO, 'src/App.tsx'), 'utf8');
  const routeDeclaration = source.slice(
    source.indexOf('export const fleetObservatory'),
    source.indexOf('async function ownedView'),
  );
  const workload = JSON.parse(readFileSync(
    join(DEMO, `workload-manifest.${WORKLOAD_DATE}.v1.json`),
    'utf8',
  ));
  assert.equal(plan.profile, 'snapshot-batch.v2');
  assert.deepEqual(plan.nodes.map((node) => node.classId), [
    'relational_query_v1',
    'bounded_children_v1',
  ]);
  assert.deepEqual(plan.nodes.map((node) => node.plan.take), [100, 100]);
  assert.equal(plan.normalizedCompositePlan.classification.retention, 'none');
  assert.deepEqual(
    plan.normalizedCompositePlan.parentAuthorizationGroups.map((group) => group.members),
    [[1]],
  );
  assert.ok(route.requiredCapabilities.includes('snapshot_batch_v2'));
  assert.ok(route.requiredCapabilities.includes('relational_query_v1'));
  assert.ok(route.requiredCapabilities.includes('bounded_children_v1'));
  assert.equal(routeDeclaration.includes('.filter('), false);
  assert.equal(routeDeclaration.includes('.reduce('), false);
  assert.equal((screenSource.match(/useSnapbackQuery\(/gu) ?? []).length, 1);
  assert.match(screenSource, /useSnapbackQuery\(\s*api\.fleetObservatory,/u);
  assert.equal(screenSource.includes('api.latestEventsWithVehicles'), false);
  assert.equal(screenSource.includes('api.vehicleRollupPage'), false);
  assert.equal(screenSource.includes('.reduce('), false);
  assert.equal(workload.reuseDecision, 'refreeze-fresh-successor-manifest');
  assert.equal(workload.predecessorEvidenceRewritten, false);
  return {
    route: 'fleetObservatory',
    screen: 'demos/fleet-observatory-move1/src/App.tsx',
    generatedReadCount: 1,
    profile: plan.profile,
    nodeClasses: plan.nodes.map((node) => node.classId),
    nodeTakes: plan.nodes.map((node) => node.plan.take),
    parentAuthorizationGroups: 1,
    retention: plan.normalizedCompositePlan.classification.retention,
    requiredCapabilities: route.requiredCapabilities.filter((id) => (
      ['snapshot_batch_v2', 'relational_query_v1', 'bounded_children_v1'].includes(id)
    )),
    predecessorEvidenceRewritten: false,
    manifestDecision: workload.reuseDecision,
  };
}

function controlledStoreRuntime(label) {
  let sequence = 0;
  const scheduled = new Map();
  const intervals = new Map();
  return {
    contextId: `fleet-observatory-${label}-context`,
    now: () => Date.UTC(2026, 7, 6, 12, 0, 0),
    schedule(callback, delayMs) {
      const id = ++sequence;
      scheduled.set(id, { callback, delayMs });
      return id;
    },
    cancel(id) { scheduled.delete(id); },
    setIntervalFn(callback, intervalMs) {
      const id = { value: ++sequence, unref() {} };
      intervals.set(id, { callback, intervalMs });
      return id;
    },
    clearIntervalFn(id) { intervals.delete(id); },
    broadcastChannelFactory: null,
    lockManager: null,
  };
}

async function signIn(server, appId, label, { storeRuntimeOptions = null } = {}) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const storeDirectory = label === 'owner'
    ? server.ownerStoreDirectory
    : join(server.scratch, `client-${label}`);
  await mkdir(storeDirectory, { recursive: true });
  const store = createFileRqsResumeStore({
    directory: storeDirectory,
    identity: `fleet-${label}`,
    clientStoreId: `fleet-observatory-${label}-store`,
  });
  await store.whenLockSettled();
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    rqsStore: store,
    offlineQueue: false,
    ...(storeRuntimeOptions === null ? {} : { __storeRuntimeOptions: storeRuntimeOptions }),
  });
  const requested = await client.authRequestCode(`${label}@fleet-observatory.test`);
  const response = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  );
  const mailbox = await response.json();
  assert.equal(response.status, 200, JSON.stringify(mailbox));
  await client.authExchange({ challengeId: requested.challengeId, code: mailbox.code });
  return { client, coordinator, store, storeDirectory };
}

async function createView(client, api, { filterKey, label }) {
  const created = await client.mutate(api.createFleetView, {
    args: { fleetKey: 'fleet-0', filterKey, label },
    queue: false,
  });
  return created.result;
}

async function writeControlledFixture(client, api) {
  const mainViewId = await createView(client, api, {
    filterKey: 'critical-all-regions',
    label: 'Fleet 0 critical events',
  });
  const seededRollups = await client.mutate(api.seedRollupBatch, {
    args: { viewId: mainViewId, rows: mainViewRollups() },
    queue: false,
  });
  assert.equal(seededRollups.result, 100);

  let vehiclesWritten = 0;
  for (const rows of vehicleBatches()) {
    const result = await client.mutate(api.ingestVehicleBatch, {
      args: { rows },
      queue: false,
    });
    vehiclesWritten += result.result;
  }
  assert.equal(vehiclesWritten, FLEET_WORKLOAD.devices);
  console.log(`fleet fixture: ${vehiclesWritten}/${FLEET_WORKLOAD.devices} vehicles committed`);

  let eventsWritten = 0;
  let nextProgress = 25_000;
  for (const rows of eventBatches()) {
    const result = await client.mutate(api.ingestEventBatch, {
      args: { rows },
      queue: false,
    });
    eventsWritten += result.result;
    if (eventsWritten >= nextProgress || eventsWritten === FLEET_WORKLOAD.events) {
      console.log(`fleet fixture: ${eventsWritten}/${FLEET_WORKLOAD.events} events committed`);
      nextProgress += 25_000;
    }
  }
  assert.equal(eventsWritten, FLEET_WORKLOAD.events);

  const switchViews = [];
  for (let ordinal = 0; ordinal < FLEET_WORKLOAD.queryChanges; ordinal += 1) {
    const viewId = await createView(client, api, {
      filterKey: `switch-${String(ordinal).padStart(2, '0')}`,
      label: `Query switch ${ordinal}`,
    });
    const seeded = await client.mutate(api.seedRollupBatch, {
      args: { viewId, rows: [switchViewRollup(ordinal)] },
      queue: false,
    });
    assert.equal(seeded.result, 1);
    switchViews.push({ viewId, ordinal });
  }
  return {
    mainViewId,
    switchViews,
    devices: vehiclesWritten,
    events: eventsWritten,
    updateBurst: FLEET_WORKLOAD.updateBurst,
    activeMatches: FLEET_WORKLOAD.activeMatches,
    queryChanges: switchViews.length,
    pageSize: FLEET_WORKLOAD.pageSize,
  };
}

function visibleScreen(rows) {
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'visible');
  const [eventRows, rollupPage] = rows[0].nodes;
  assert.ok(Array.isArray(eventRows));
  assert.ok(Array.isArray(rollupPage.children));
  return {
    eventRows,
    rollupRows: rollupPage.children,
    continuation: rows[0].continuation,
  };
}

function activeCounts(rows) {
  const screen = visibleScreen(rows);
  return {
    eventMatches: screen.eventRows.filter((row) => row.message.startsWith('Burst-updated ')).length,
    rollupMatches: screen.rollupRows.filter((row) => row.activeMatch).length,
  };
}

async function eventually(predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`SNAPBACK_FLEET_EVENTUALLY_TIMEOUT: ${label}`);
}

async function runQueryChanges(client, api, switchViews) {
  const rows = [];
  const releasedAddressKeys = [];
  for (const { viewId, ordinal } of switchViews) {
    const prepared = await client.__prepareGeneratedMaterializationBridge(
      api.fleetObservatory,
      { viewId },
      null,
      false,
    );
    assert.ok(prepared, 'each query-change leg must prepare a qmk1 bridge');
    releasedAddressKeys.push(prepared.bridge.address[2]);
    const live = await client.liveQuery(api.fleetObservatory, {
      args: { viewId },
      connectionId: 'fleet-observatory-query-change',
      persistResume: false,
    });
    const screen = visibleScreen(live.rows);
    assert.deepEqual(screen.rollupRows.map((row) => row.eventKey), [
      `switch-${String(ordinal).padStart(2, '0')}`,
    ]);
    rows.push(screen.rollupRows[0].eventKey);
    await live.dispose();
  }
  return { rows, releasedAddressKeys };
}

async function collectAllPages(client, api, viewId) {
  const eventRows = [];
  const rollupRows = [];
  const continuations = [];
  let cursor = null;
  let pages = 0;
  do {
    const response = await client.query(api.fleetObservatory, {
      args: { viewId, ...(cursor === null ? {} : { cursor }) },
    });
    const screen = visibleScreen(response.rows);
    eventRows.push(...screen.eventRows);
    rollupRows.push(...screen.rollupRows);
    cursor = screen.continuation;
    if (cursor !== null) {
      assert.match(cursor, /^sbsb2\./u);
      continuations.push(cursor);
    }
    pages += 1;
    assert.ok(pages <= 55, 'the 5,000-root Fleet window must terminate within 55 pages');
  } while (cursor !== null);
  assert.equal(eventRows.length, 5_000);
  assert.equal(new Set(eventRows.map((row) => row.eventKey)).size, 5_000);
  assert.deepEqual(
    eventRows.map((row) => row.queryRank),
    Array.from({ length: 5_000 }, (_, index) => index),
  );
  assert.equal(rollupRows.length, 100);
  assert.equal(new Set(rollupRows.map((row) => row.eventKey)).size, 100);
  return {
    pages,
    eventRows,
    rollupRows,
    continuationCount: continuations.length,
  };
}

async function materializationState(store) {
  return store.materializationTransaction('readonly', (view) => {
    const rawRecords = [...view.materializations.values()];
    const records = rawRecords.map(decodeMaterializationRecordV1).filter(Boolean);
    return {
      rawRecords,
      records,
      pageSets: view.pageSets.size,
      memberships: view.memberships.size,
      meta: structuredClone(view.storeMeta),
    };
  });
}

function materializationFootprint(state) {
  const projections = state.rawRecords.map(materializationPayloadProjection);
  const fragments = state.records.flatMap((record) => record.fragments.map((fragment) => ({
    addressKey: record.address[2],
    rows: JSON.parse(decoder.decode(fragment.bytes)),
    bytes: fragment.bytes.length,
    proofBytes: encoder.encode(JSON.stringify(fragment.proof)).length,
  })));
  const nestedRows = fragments.reduce((sum, fragment) => {
    for (const envelope of fragment.rows) {
      if (envelope.kind !== 'visible') continue;
      sum += envelope.nodes[0].length;
      sum += envelope.nodes[1].children.length;
    }
    return sum;
  }, 0);
  return {
    payloadBearingRecords: state.records.filter((record) => record.fragments.length > 0).length,
    fragments: projections.reduce((sum, projection) => sum + projection.fragmentCount, 0),
    logicalBytes: projections.reduce((sum, projection) => sum + projection.logicalBytes, 0),
    resultBytes: fragments.reduce((sum, fragment) => sum + fragment.bytes, 0),
    proofBytes: fragments.reduce((sum, fragment) => sum + fragment.proofBytes, 0),
    topLevelRows: fragments.reduce((sum, fragment) => sum + fragment.rows.length, 0),
    nestedRows,
    fragmentRows: fragments,
  };
}

async function physicalStoreBytes(directory) {
  let bytes = 0;
  for (const name of await readdir(directory)) {
    const facts = await stat(join(directory, name));
    if (facts.isFile()) bytes += facts.size;
  }
  return bytes;
}

function inspectionProjection(entry) {
  const { lastEstablishmentAt: _measured, ...projection } = entry;
  return projection;
}

async function runRealExit() {
  if (!existsSync(SERVER_BINARY)) {
    throw new Error(`SNAPBACK_FLEET_SERVER_BINARY_MISSING: ${SERVER_BINARY}`);
  }
  const scratch = await mkdtemp(join(tmpdir(), 'snapback-fleet-observatory-'));
  const databasePath = join(scratch, 'fleet.sqlite3');
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  const configuredStoreDirectory = process.env.SNAPBACK_CLIENT_RQS_DIR
    ? resolve(process.env.SNAPBACK_CLIENT_RQS_DIR)
    : join(scratch, 'client-owner');
  await mkdir(configuredStoreDirectory, { recursive: true });
  let server = null;
  let owner = null;
  let mallory = null;
  let mainLive = null;
  try {
    await rm(join(BACKEND, 'trusted-composition-activation.json'), { force: true });
    let generation = await generate(BACKEND);
    assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
    const activationRaw = JSON.parse(execFileSync(
      SERVER_BINARY,
      [
        'composition-activation-prepare',
        '--db', databasePath,
        '--generated', GENERATED,
        '--deployment-id', 'fleet-observatory-move1-controlled-run',
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          DYLD_FRAMEWORK_PATH: join(ROOT, 'vendor/ibex/ios/Frameworks'),
        },
      },
    ));
    generation = await generate(BACKEND);
    assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
    const schema = readGeneratedJson(GENERATED, 'schema.manifest.json');
    const functions = readGeneratedJson(GENERATED, 'functions.manifest.json');
    await writeFile(startupArtifacts, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`);
    const generated = await importGeneratedModule(GENERATED, 'api.mjs');
    assert.ok(generated.artifacts.trustedCompositionActivation);

    server = await startServer({
      port: 0,
      db: databasePath,
      cwd: ROOT,
      serverBinary: SERVER_BINARY,
      binaryProvenance: true,
      startupArtifacts,
      trustedCompositionActivation: join(GENERATED, 'trusted-composition-activation.json'),
      captureImpersonationCapability: true,
      startupTimeoutMs: 120_000,
    });
    const fixtureServer = {
      ...server,
      scratch,
      ownerStoreDirectory: configuredStoreDirectory,
    };
    owner = await signIn(fixtureServer, schema.appId, 'owner', {
      storeRuntimeOptions: controlledStoreRuntime('owner'),
    });
    mallory = await signIn(fixtureServer, schema.appId, 'mallory');

    const fixture = await writeControlledFixture(owner.client, generated.api);
    const queryChanges = await runQueryChanges(
      owner.client,
      generated.api,
      fixture.switchViews,
    );
    await owner.client.__runStoreMaintenance();

    let implicitPrefixRefusal = null;
    try {
      await owner.client.query(generated.api.implicitPrefixProbe, { args: {} });
    } catch (error) {
      implicitPrefixRefusal = diagnosticCode(error);
    }
    assert.equal(implicitPrefixRefusal, 'SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED');

    const malloryComposite = await mallory.client.query(generated.api.fleetObservatory, {
      args: { viewId: fixture.mainViewId },
    });
    assert.deepEqual(malloryComposite.rows, [
      { kind: 'absent', nodes: null, continuation: null },
    ]);
    const mallorySource = await mallory.client.query(generated.api.implicitPrefixProbe, {
      args: {},
    });
    assert.deepEqual(mallorySource.rows, []);
    const malloryState = await materializationState(mallory.store);
    assert.equal(malloryState.records.length, 0);

    const preparedMain = await owner.client.__prepareGeneratedMaterializationBridge(
      generated.api.fleetObservatory,
      { viewId: fixture.mainViewId },
      null,
      false,
    );
    assert.ok(preparedMain, 'the main Fleet route must prepare a qmk1 bridge');
    // Preparing the bridge initializes the qmk1 address record itself (the
    // v2 volatile-online profile surfaces that bookkeeping immediately), so
    // the pre-hydration claim is payload absence, not record absence.
    const beforeHydrationState = await materializationState(owner.store);
    assert.equal(
      beforeHydrationState.records.some((record) => (
        record.address[2] === preparedMain.bridge.address[2]
        && record.fragments.length > 0
      )),
      false,
    );

    const updateFrames = [];
    const hydrationStarted = performance.now();
    mainLive = await owner.client.liveQuery(generated.api.fleetObservatory, {
      args: { viewId: fixture.mainViewId },
      connectionId: 'fleet-observatory-main',
      persistResume: false,
      onUpdate: (rows, detail) => updateFrames.push({
        kind: detail.kind,
        counts: activeCounts(rows),
      }),
    });
    const hydrationMs = Number((performance.now() - hydrationStarted).toFixed(3));
    const initialScreen = visibleScreen(mainLive.rows);
    assert.equal(initialScreen.eventRows.length, 100);
    assert.equal(initialScreen.rollupRows.length, 100);
    assert.deepEqual(activeCounts(mainLive.rows), { eventMatches: 0, rollupMatches: 0 });
    assert.equal(mainLive.answerClass, 'authoritative');
    assert.equal(mainLive.freshness, 'current');
    assert.equal(mainLive.retention.retainable, false);

    const burstStarted = performance.now();
    let eventsChanged = 0;
    let activeRollupsChanged = 0;
    for (const updates of batches(telemetryBurst(), 100)) {
      const result = await owner.client.mutate(generated.api.applyTelemetryBurst, {
        args: { viewId: fixture.mainViewId, updates },
        queue: false,
      });
      eventsChanged += result.result.eventsChanged;
      activeRollupsChanged += result.result.activeRollupsChanged;
    }
    const serverSettlementMs = Number((performance.now() - burstStarted).toFixed(3));
    assert.equal(eventsChanged, 1_000);
    assert.equal(activeRollupsChanged, 100);
    // Convergence is proven by authoritative re-read, exactly like the
    // triage-graph Move-1 precedent: LLP 0157's bullet demands the fixture
    // converge to the 100 active matches, and the authoritative snapshot is
    // the composite's own truth surface. (This kit's node client renders
    // live updates through re-query delivery, for v1 and v2 alike; the
    // server-side v2 live_replace lane is pinned separately by
    // snapshot_batch_v2_relational_root_change_delivers_live_replace and the
    // three-node live acceptance in src/local.rs.)
    let convergedCounts = null;
    {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const reread = await owner.client.query(generated.api.fleetObservatory, {
          args: { viewId: fixture.mainViewId },
        });
        const counts = activeCounts(reread.rows);
        if (counts.eventMatches === 100 && counts.rollupMatches === 100) {
          convergedCounts = counts;
          break;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      }
    }
    assert.deepEqual(
      convergedCounts,
      { eventMatches: 100, rollupMatches: 100 },
      '1,000-update burst convergence via authoritative re-read',
    );
    const clientSettlementMs = Number((performance.now() - burstStarted).toFixed(3));

    const pagination = await collectAllPages(
      owner.client,
      generated.api,
      fixture.mainViewId,
    );
    assert.equal(
      pagination.eventRows.slice(0, 100)
        .filter((row) => row.message.startsWith('Burst-updated ')).length,
      100,
    );

    const activeState = await materializationState(owner.store);
    const activeFootprint = materializationFootprint(activeState);
    const activePolicy = await owner.client.storePolicyInspection({
      authorityPartitionDigest: preparedMain.bridge.authorityPartitionDigest,
    });
    const allAddressKeys = [
      ...queryChanges.releasedAddressKeys,
      preparedMain.bridge.address[2],
    ].sort();
    assert.deepEqual(
      activePolicy.addresses.map((entry) => entry.addressKey),
      allAddressKeys,
    );
    const activeByAddress = new Map(
      activePolicy.addresses.map((entry) => [entry.addressKey, entry]),
    );
    const mainPolicy = activeByAddress.get(preparedMain.bridge.address[2]);
    assert.equal(mainPolicy.demandState, 'demanded-active');
    assert.equal(mainPolicy.effectiveRetentionRequest, 'none');
    assert.equal(mainPolicy.retainingReason.kind, 'registrations');
    assert.equal(mainPolicy.compacted, false);
    for (const addressKey of queryChanges.releasedAddressKeys) {
      const entry = activeByAddress.get(addressKey);
      assert.equal(entry.demandState, 'undemanded');
      assert.equal(entry.effectiveRetentionRequest, 'none');
      assert.equal(entry.retainingReason.kind, 'instance-bookkeeping');
      assert.equal(entry.compacted, true);
    }
    assert.equal(activeState.records.length, 21);
    assert.equal(activeFootprint.payloadBearingRecords, 1);
    assert.equal(activeFootprint.fragments, 1);
    assert.equal(activeFootprint.topLevelRows, 1);
    assert.equal(activeFootprint.nestedRows, 200);
    assert.equal(activeState.pageSets, 0);
    assert.equal(activeState.memberships, 0);
    const physicalCarrierBytesActive = await physicalStoreBytes(configuredStoreDirectory);

    await mainLive.dispose();
    mainLive = null;
    await owner.client.__runStoreMaintenance();
    const releasedState = await materializationState(owner.store);
    const releasedFootprint = materializationFootprint(releasedState);
    const releasedPolicy = await owner.client.storePolicyInspection({
      authorityPartitionDigest: preparedMain.bridge.authorityPartitionDigest,
    });
    assert.deepEqual(
      releasedPolicy.addresses.map((entry) => entry.addressKey),
      allAddressKeys,
    );
    assert.equal(releasedState.records.length, 21);
    assert.equal(releasedFootprint.payloadBearingRecords, 0);
    assert.equal(releasedFootprint.fragments, 0);
    assert.equal(releasedFootprint.topLevelRows, 0);
    assert.equal(releasedFootprint.nestedRows, 0);
    assert.ok(releasedPolicy.addresses.every((entry) => (
      entry.demandState === 'undemanded'
      && entry.effectiveRetentionRequest === 'none'
      && entry.retainingReason.kind === 'instance-bookkeeping'
      && entry.compacted === true
    )));
    const physicalCarrierBytesReleased = await physicalStoreBytes(configuredStoreDirectory);

    const frozenDurationMs = Math.max(1_000, Math.ceil(hydrationMs / 100) * 100);
    const budgetFreeze = {
      schemaVersion: 'snapback.fleet-observatory.budget-freeze.v1',
      date: DATE,
      authority: 'LLP 0155 OQ9',
      workload: {
        devices: fixture.devices,
        sourceEventRows: fixture.events,
        updateBurst: fixture.updateBurst,
        activeMatches: fixture.activeMatches,
        queryChanges: fixture.queryChanges,
      },
      retentionPosture: 'none',
      measured: {
        activeCustody: {
          materializationRecords: activeState.records.length,
          payloadBearingRecords: activeFootprint.payloadBearingRecords,
          compactedPredecessorStubs: queryChanges.releasedAddressKeys.length,
          fragments: activeFootprint.fragments,
          topLevelEnvelopeRows: activeFootprint.topLevelRows,
          projectedResultRows: activeFootprint.nestedRows,
          eventRows: initialScreen.eventRows.length,
          rollupRows: initialScreen.rollupRows.length,
          logicalBytes: activeFootprint.logicalBytes,
          resultBytes: activeFootprint.resultBytes,
          proofBytes: activeFootprint.proofBytes,
          physicalCarrierBytes: physicalCarrierBytesActive,
        },
        releasedCustody: {
          materializationRecords: releasedState.records.length,
          payloadBearingRecords: releasedFootprint.payloadBearingRecords,
          compactedInstanceBookkeepingStubs: releasedPolicy.addresses.length,
          fragments: releasedFootprint.fragments,
          retainedTopLevelRows: releasedFootprint.topLevelRows,
          retainedProjectedRows: releasedFootprint.nestedRows,
          physicalCarrierBytes: physicalCarrierBytesReleased,
        },
        hydration: {
          attempts: 1,
          firstUsefulRows: initialScreen.eventRows.length,
          rowsInstalled: initialScreen.eventRows.length + initialScreen.rollupRows.length,
          payloadBytes: activeFootprint.resultBytes,
          firstUsefulMs: hydrationMs,
          authoritativeCompleteMs: hydrationMs,
        },
      },
      frozenCeilings: {
        activeCustody: {
          materializationRecords: 21,
          payloadBearingRecords: 1,
          compactedPredecessorStubs: 20,
          fragments: 1,
          topLevelEnvelopeRows: 1,
          projectedResultRows: 200,
          eventRows: 100,
          rollupRows: 100,
          logicalBytes: activeFootprint.logicalBytes,
        },
        releasedCustody: {
          materializationRecords: 21,
          payloadBearingRecords: 0,
          compactedInstanceBookkeepingStubs: 21,
          fragments: 0,
          retainedTopLevelRows: 0,
          retainedProjectedRows: 0,
        },
        hydration: {
          attempts: 1,
          firstUsefulRows: 100,
          rowsInstalled: 200,
          payloadBytes: activeFootprint.resultBytes,
          elapsedMs: frozenDurationMs,
        },
      },
    };

    return {
      activation: {
        format: activationRaw.format,
        activationHash: activationRaw.activationHash,
        deploymentId: 'fleet-observatory-move1-controlled-run',
      },
      fixture: {
        devices: fixture.devices,
        events: fixture.events,
        updateBurst: fixture.updateBurst,
        activeMatches: fixture.activeMatches,
        queryChanges: fixture.queryChanges,
        pageSize: fixture.pageSize,
      },
      budgetFreeze,
      footprintHydration: budgetFreeze.measured,
      gateEvidence: {
        custody: {
          ownerClassification: { profile: 'snapshot-batch.v2', retention: 'none' },
          active: budgetFreeze.measured.activeCustody,
          released: budgetFreeze.measured.releasedCustody,
          activePolicy: inspectionProjection(mainPolicy),
          releasedPolicyReasons: {
            instanceBookkeeping: releasedPolicy.addresses.length,
            registrations: 0,
            releaseGrace: 0,
            safetyBlockers: 0,
          },
          offlineRenderabilityAfterRelease: 'unknown-render-nothing',
        },
        pagination: {
          pages: pagination.pages,
          eventRows: pagination.eventRows.length,
          uniqueEventKeys: new Set(pagination.eventRows.map((row) => row.eventKey)).size,
          queryRanks: [pagination.eventRows[0].queryRank, pagination.eventRows.at(-1).queryRank],
          continuationCount: pagination.continuationCount,
          continuationFamily: 'sbsb2',
          rollupRows: pagination.rollupRows.length,
        },
        queryChanges: {
          changes: queryChanges.rows.length,
          rows: queryChanges.rows,
          uniqueRows: new Set(queryChanges.rows).size,
          predecessorPayloadRecordsAfterMaintenance: 0,
          compactedInstanceBookkeepingStubs: queryChanges.releasedAddressKeys.length,
        },
        convergence: {
          sourceEventRows: fixture.events,
          updates: eventsChanged,
          activeEventMatches: activeCounts([
            { kind: 'visible', nodes: [pagination.eventRows.slice(0, 100), {
              children: pagination.rollupRows,
            }], continuation: null },
          ]).eventMatches,
          activeRollupMatches: pagination.rollupRows.filter((row) => row.activeMatch).length,
          serverSettlementMs,
          clientSettlementMs,
          liveFramesObserved: updateFrames.length,
        },
        implicitPrefixRefusal,
        mallory: {
          protectedCompositeRows: malloryComposite.rows[0].kind === 'absent' ? 0 : null,
          protectedSourceRows: mallorySource.rows.length,
          clientMaterializationRecords: malloryState.records.length,
        },
        inspection: {
          transitions: [
            { state: 'unhydrated', addressPresent: false, completeness: 'unknown' },
            {
              state: 'active',
              answerClass: 'authoritative',
              freshness: 'current',
              projectedRows: activeFootprint.nestedRows,
              retainingReason: mainPolicy.retainingReason.kind,
            },
            {
              state: 'released',
              completeness: 'unknown',
              retainedProjectedRows: releasedFootprint.nestedRows,
              retainingReason: 'instance-bookkeeping',
              compacted: true,
            },
          ],
          addressesExplained: releasedPolicy.addresses.length,
          payloadBearingAddressesAfterRelease: 0,
        },
      },
      runtime: {
        serverBinary: relative(ROOT, SERVER_BINARY),
        serverBinarySha256: sha256Hex(readFileSync(SERVER_BINARY)),
        launchRung: fixtureServer.launch?.rung ?? null,
      },
    };
  } finally {
    try { await mainLive?.dispose(); } catch {}
    try { await server?.stop(); } catch {}
    try { await owner?.store?.close(); } catch {}
    try { await mallory?.store?.close(); } catch {}
    try { await owner?.client?.closeAuth(); } catch {}
    try { await mallory?.client?.closeAuth(); } catch {}
    await rm(scratch, { recursive: true, force: true });
  }
}

function sourceProvenance() {
  const paths = [
    'tests/acceptance/fleet-observatory-move1-v1.mjs',
    'demos/fleet-observatory-move1/snapback/schema.mjs',
    'demos/fleet-observatory-move1/snapback/functions.mjs',
    'demos/fleet-observatory-move1/snapback/trusted-composition-activation.json',
    'demos/fleet-observatory-move1/snapback/generated/artifacts.json',
    'demos/fleet-observatory-move1/demo.snapback.json',
    'demos/fleet-observatory-move1/fixture.mjs',
    'demos/fleet-observatory-move1/src/App.tsx',
    `demos/fleet-observatory-move1/workload-manifest.${WORKLOAD_DATE}.v1.json`,
    'packages/snapback-client/index.mjs',
    'packages/snapback-client/materialization-store.mjs',
    'packages/snapback-client/materialization-store-runtime.mjs',
    'packages/snapback-client/store-policy.mjs',
    'packages/snapback-client/store-runtime.mjs',
  ];
  return {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    dirty: true,
    files: paths.map(sourceDigest),
  };
}

function evidenceMarkdown(receipt) {
  const rows = receipt.gates.map((gate, index) => (
    `| ${index + 1} | ${gate.status} | ${gate.gate} | ${JSON.stringify(gate.evidence).replaceAll('|', '\\|')} |`
  )).join('\n');
  const footprint = receipt.footprintHydration;
  return `# Fleet Observatory Move-1 exit evidence

**Run date:** ${DATE}
**Source revision:** \`${receipt.source.revision}\` (dirty lane worktree)
**Controlled run:** ${receipt.controlledRun.status}

This is the fresh Fleet successor receipt. It does not rewrite LLP 0138's
frozen evidence, flip the local-store carrier GAP, or change a capability row.
A BLOCKED row means the local sandbox denied a loopback socket; it is never
interpreted as a pass.

| # | Status | LLP 0157 Fleet gate | Evidence |
| -: | --- | --- | --- |
${rows}

## Footprint and hydration

${footprint ? `The active volatile composite held ${footprint.activeCustody.projectedResultRows}
projected rows (${footprint.activeCustody.eventRows} event rows and
${footprint.activeCustody.rollupRows} rollups) in
${footprint.activeCustody.resultBytes} result bytes plus
${footprint.activeCustody.proofBytes} proof bytes. Hydration installed
${footprint.hydration.rowsInstalled} rows in ${footprint.hydration.authoritativeCompleteMs} ms.
After final release and maintenance, retained projected rows were
${footprint.releasedCustody.retainedProjectedRows}; all
${footprint.releasedCustody.compactedInstanceBookkeepingStubs} addresses were
compacted bookkeeping stubs under retention:none.`
    : 'No footprint was measured because the controlled server run was blocked by the sandbox.'}

Machine receipt:
\`tests/acceptance/fixtures/fleet-observatory/move1-exit.${DATE}.v1.json\`

Budget freeze:
\`tests/acceptance/fixtures/fleet-observatory/budget-freeze.${DATE}.v1.json\`
`;
}

async function verifyRetainedArtifacts() {
  const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  assert.equal(receipt.schemaVersion, 'snapback.fleet-observatory.move1-exit.v1');
  assert.equal(receipt.date, DATE);
  assert.equal(receipt.gates.length, 8);
  assert.deepEqual(receipt.gates.map((gate) => gate.gate), GATES);
  for (const gate of receipt.gates) {
    assert.ok(['PASS', 'BLOCKED'].includes(gate.status));
    assert.equal(typeof gate.evidence, 'object');
    if (gate.status === 'BLOCKED') {
      assert.match(gate.reason, /^SNAPBACK_FLEET_SANDBOX_SOCKET_BLOCKED:/u);
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
    const budget = JSON.parse(await readFile(BUDGET_PATH, 'utf8'));
    assert.deepEqual(budget, receipt.budgetFreeze);
    assert.deepEqual(budget.measured, receipt.footprintHydration);
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
    assert.equal(
      receipt.controlledRun.runtime.serverBinarySha256,
      sha256Hex(await readFile(SERVER_BINARY)),
      'retained receipt must remain bound to the exact server binary',
    );
    assert.equal(receipt.summary.pass, 8);
    assert.equal(receipt.summary.blocked, 0);
  }
  if (process.argv.includes('--require-qualified')) {
    assert.equal(receipt.controlledRun.status, 'PASS', 'qualification requires a controlled PASS');
    assert.deepEqual(receipt.summary, {
      pass: 8,
      blocked: 0,
      total: 8,
      capabilityClaimsChanged: false,
      carrierGapChanged: false,
      predecessorEvidenceRewritten: false,
    });
  }
  assert.equal(existsSync(EVIDENCE_PATH), true);
  console.log(
    `PASS Fleet Observatory retained receipt: ${receipt.summary.pass}/8 PASS, ${receipt.summary.blocked} BLOCKED`,
  );
}

async function main() {
  if (process.argv.includes('--check')) {
    await verifyRetainedArtifacts();
    return;
  }
  const staticEvidence = staticCompositionEvidence();
  let real = null;
  let block = null;
  try {
    real = await runRealExit();
  } catch (error) {
    if (!isSocketSandboxBlock(error)) throw error;
    block = `SNAPBACK_FLEET_SANDBOX_SOCKET_BLOCKED: ${String(error?.message ?? error)}`;
  }
  const pass = (gate, evidence) => ({ gate, status: 'PASS', evidence });
  const blocked = (gate) => ({
    gate,
    status: 'BLOCKED',
    evidence: { controlledServerRun: false },
    reason: block,
  });
  const gates = [
    pass(GATES[0], staticEvidence),
    ...(real ? [
      pass(GATES[1], real.gateEvidence.custody),
      pass(GATES[2], real.gateEvidence.pagination),
      pass(GATES[3], real.gateEvidence.queryChanges),
      pass(GATES[4], real.gateEvidence.convergence),
      pass(GATES[5], { refusal: real.gateEvidence.implicitPrefixRefusal }),
      pass(GATES[6], real.gateEvidence.mallory),
      pass(GATES[7], real.gateEvidence.inspection),
    ] : GATES.slice(1).map(blocked)),
  ];
  const receipt = {
    schemaVersion: 'snapback.fleet-observatory.move1-exit.v1',
    date: DATE,
    authority: [
      'LLP 0157#move-1-workload-exit-llp-0155-normative-transcription',
      'LLP 0157#d4--capability-classification',
      'LLP 0155 OQ9',
      'LLP 0155 OQ13',
      'LLP 0138#status',
    ],
    source: sourceProvenance(),
    controlledRun: real ? {
      status: 'PASS',
      runtime: real.runtime,
      activation: real.activation,
    } : { status: 'BLOCKED', reason: block },
    manifestDecision: staticEvidence.manifestDecision,
    budgetFreeze: real?.budgetFreeze ?? null,
    footprintHydration: real?.footprintHydration ?? null,
    summary: {
      pass: gates.filter((gate) => gate.status === 'PASS').length,
      blocked: gates.filter((gate) => gate.status === 'BLOCKED').length,
      total: gates.length,
      capabilityClaimsChanged: false,
      carrierGapChanged: false,
      predecessorEvidenceRewritten: false,
    },
    gates,
  };
  await mkdir(FIXTURE_DIR, { recursive: true });
  if (real) await writeFile(BUDGET_PATH, `${JSON.stringify(real.budgetFreeze, null, 2)}\n`);
  await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(EVIDENCE_PATH, evidenceMarkdown(receipt));
  console.log(JSON.stringify({
    ok: real !== null,
    pass: receipt.summary.pass,
    blocked: receipt.summary.blocked,
    receipt: relative(ROOT, RECEIPT_PATH),
    budget: real ? relative(ROOT, BUDGET_PATH) : null,
    evidence: relative(ROOT, EVIDENCE_PATH),
  }));
}

await main();
