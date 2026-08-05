#!/usr/bin/env node

// Triage half of LLP 0157's Move-1 workload exit. Fleet is deliberately not
// represented here because LLP 0135 OQ5 remains its blocker.
//
// @ref LLP 0157#move-1-workload-exit-llp-0155-normative-transcription — one
// retained receipt covers the eight Triage exit gates verbatim.
// @ref LLP 0155#open-questions — the first controlled run freezes custody and
// hydration budgets (OQ9) and records a fresh successor manifest (OQ13).
// @ref LLP 0166#executable-acceptance — retained evidence distinguishes an
// actual server run from an honest sandbox socket block.

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

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const RUN_DATE = '2026-08-04';
const WORKLOAD_DATE = '2026-08-03';
const DEMO = join(ROOT, 'demos/triage-graph');
const BACKEND = join(DEMO, 'snapback');
const GENERATED = join(BACKEND, 'generated');
const FIXTURE_DIR = join(ROOT, 'tests/acceptance/fixtures/triage-graph');
const latestRetainedDate = () => {
  const dates = readdirSync(FIXTURE_DIR)
    .map((name) => name.match(/^move1-exit\.(\d{4}-\d{2}-\d{2})\.v1\.json$/u)?.[1])
    .filter(Boolean)
    .sort();
  assert.ok(dates.length > 0, `no dated Triage Move-1 receipt in ${FIXTURE_DIR}`);
  return dates.at(-1);
};
const DATE = process.argv.includes('--check') ? latestRetainedDate() : RUN_DATE;
const RECEIPT_PATH = join(FIXTURE_DIR, `move1-exit.${DATE}.v1.json`);
const BUDGET_PATH = join(FIXTURE_DIR, `budget-freeze.${DATE}.v1.json`);
const EVIDENCE_PATH = join(ROOT, 'tests/acceptance/triage-graph-move1-v1-evidence.md');
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
const countDurableRegistrations = (slot) => Object.values(slot ?? {}).reduce(
  (sum, byId) => sum + Object.keys(byId ?? {}).length,
  0,
);

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
  const graph = byName.get('triageGraph');
  const inbox = byName.get('retainedInbox');
  const appSource = readFileSync(join(DEMO, 'src/App.tsx'), 'utf8');
  const workload = JSON.parse(readFileSync(
    join(DEMO, `workload-manifest.${WORKLOAD_DATE}.v1.json`),
    'utf8',
  ));
  assert.equal(graph.runtime.HostPlan.SnapshotBatch.profile, 'snapshot-batch.v1');
  assert.deepEqual(graph.runtime.HostPlan.SnapshotBatch.nodes.map((node) => node.take), [50, 20]);
  assert.equal(
    graph.runtime.HostPlan.SnapshotBatch.normalizedCompositePlan.classification.retention,
    'none',
  );
  assert.equal(inbox.retainable, true);
  assert.equal(inbox.runtime.HostPlan.RelationalQuery.take, 100);
  assert.equal(appSource.includes('.filter('), false);
  assert.equal(appSource.includes('.reduce('), false);
  assert.equal(workload.reuseDecision, 'refreeze-fresh-successor-manifest');
  assert.equal(workload.predecessorTransformsCopied, false);
  assert.equal(workload.fleetIncluded, false);
  return {
    graphProfile: 'snapshot-batch.v1',
    graphNodeTakes: [50, 20],
    graphRetention: 'none',
    retainedProfile: 'relational-query.v1',
    retainedTake: 100,
    predecessorTransformsCopied: false,
    manifestDecision: workload.reuseDecision,
  };
}

function controlledStoreRuntime(label) {
  let sequence = 0;
  const scheduled = new Map();
  const intervals = new Map();
  return {
    contextId: `triage-graph-${label}-context`,
    now: () => Date.UTC(2026, 7, 4, 12, 0, 0),
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
    identity: `triage-${label}`,
    clientStoreId: `triage-graph-${label}-store`,
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
  const requested = await client.authRequestCode(`${label}@triage-graph.test`);
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

async function createBoard(client, api, name) {
  const created = await client.mutate(api.createBoard, {
    args: { name, projectKey: 'P3', projectName: 'Triage successor' },
    queue: false,
  });
  return created.result;
}

async function writeControlledFixture(client, api, boardId) {
  let written = 0;
  for (let start = 0; start < 249000; start += 1000) {
    const events = Array.from({ length: 1000 }, (_, offset) => ({
      issueKey: `BASE-${String(start + offset).padStart(6, '0')}`,
      sequence: start + offset,
    }));
    const result = await client.mutate(api.appendBaselineEvents, {
      args: { boardId, events },
      queue: false,
    });
    written += result.result;
    if ((start / 1000 + 1) % 25 === 0) {
      console.log(`triage fixture: ${written}/250000 events committed`);
    }
  }
  for (let start = 249000; start < 250000; start += 100) {
    const updates = Array.from({ length: 100 }, (_, offset) => {
      const sequence = start + offset;
      const rank = sequence - 249000;
      return {
        issueKey: `P3-${String(rank).padStart(4, '0')}`,
        sequence,
        ...(rank < 100 ? { activeRank: rank } : {}),
        title: rank < 100 ? `Active successor issue ${rank}` : `Inactive successor issue ${rank}`,
      };
    });
    const result = await client.mutate(api.applyUpdateBurst, {
      args: { boardId, updates },
      queue: false,
    });
    written += result.result;
  }
  assert.equal(written, 250000);
  console.log('triage fixture: 250000/250000 events committed');
  return { baselineEvents: 249000, updateBurst: 1000, totalEvents: written };
}

async function collectGraph(client, api, boardId) {
  const issues = [];
  const transitions = [];
  let cursor = null;
  let pages = 0;
  do {
    const response = await client.query(api.triageGraph, {
      args: { boardId, ...(cursor === null ? {} : { cursor }) },
    });
    assert.equal(response.rows.length, 1);
    assert.equal(response.rows[0].kind, 'visible');
    issues.push(...response.rows[0].nodes[0].children);
    transitions.push(...response.rows[0].nodes[1].children);
    cursor = response.rows[0].continuation;
    pages += 1;
    assert.ok(pages <= 4, 'bounded fixture should terminate within four composite pages');
  } while (cursor !== null);
  return { issues, transitions, pages };
}

async function installDurableRegistration(client, api) {
  const prepared = await client.__prepareGeneratedMaterializationBridge(
    api.retainedInbox,
    {},
    null,
    true,
  );
  assert.ok(prepared, 'generated activation must prepare a qmk1 bridge');
  const result = await client.registerQuery(api.retainedInbox, {
    registrationId: 'triage-graph-retained-inbox-v1',
    args: {},
    label: 'triage-graph-retained-inbox',
    requestedScope: { kind: 'page', input: { kind: 'first' } },
    retentionRequest: 'durable',
    idleTtlClass: 'default',
  });
  assert.equal(result.format, 'snapback.register-outcome.v1');
  assert.deepEqual(result.outcome, { kind: 'committed' });
  const registration = await client.rqsStore.materializationTransaction('readonly', (view) => (
    Object.values(view.storeMeta.durableRegistrations)
      .map((byId) => byId['triage-graph-retained-inbox-v1'])
      .find(Boolean)
  ));
  assert.ok(registration, 'the public API must commit the durable registration');
  return { prepared, registration };
}

async function inspectCustody({
  store,
  registration,
  retainedBridge,
  releasedAddressKeys,
  policyInspection,
}) {
  const state = await store.materializationTransaction('readonly', (view) => {
    const decoded = [...view.materializations.values()]
      .map(decodeMaterializationRecordV1)
      .filter(Boolean);
    const registrations = Object.values(view.storeMeta.durableRegistrations)
      .flatMap((byId) => Object.values(byId));
    return {
      rawRecords: [...view.materializations.values()],
      records: decoded,
      registrations,
      leases: structuredClone(view.storeMeta.materializationLeaseCustody),
      pageSets: view.pageSets.size,
      memberships: view.memberships.size,
      meta: structuredClone(view.storeMeta),
    };
  });
  const payloadRecords = state.records.filter((record) => record.fragments.length > 0);
  const retainedAddressKey = retainedBridge.address[2];
  const expectedAddressKeys = [retainedAddressKey, ...releasedAddressKeys].sort();
  const retainedRecord = state.records.find((record) => record.address[2] === retainedAddressKey);
  const retainedRawRecord = state.rawRecords.find((record) => (
    decodeMaterializationRecordV1(record)?.address[2] === retainedAddressKey
  ));
  assert.deepEqual(
    state.records.map((record) => record.address[2]).sort(),
    expectedAddressKeys,
    'S1 custody is exactly registrations + release grace + blockers + bookkeeping stubs',
  );
  assert.deepEqual(
    policyInspection.addresses.map((entry) => entry.addressKey),
    expectedAddressKeys,
    'StorePolicyInspectionV1 explains every stored qmk1 address',
  );
  assert.deepEqual(
    payloadRecords.map((record) => record.address[2]),
    [retainedAddressKey],
    'only the durable programmatic registration retains payload after maintenance',
  );
  assert.ok(retainedRecord);
  assert.ok(retainedRawRecord);
  assert.equal(state.registrations.length, 1);
  assert.deepEqual(state.registrations[0], registration);
  assert.equal(retainedRecord.fragments.length, 1);
  const inspectionByAddress = new Map(
    policyInspection.addresses.map((entry) => [entry.addressKey, entry]),
  );
  const custodyProjection = ({ lastEstablishmentAt: _measured, ...entry }) => entry;
  assert.deepEqual(custodyProjection(inspectionByAddress.get(retainedAddressKey)), {
    addressKey: retainedAddressKey,
    demandState: 'demanded-idle',
    effectiveRetentionRequest: 'durable',
    retainingReason: {
      kind: 'registrations',
      entries: [{
        registrationId: 'triage-graph-retained-inbox-v1',
        source: 'programmatic',
        ownerContextKind: 'api',
      }],
    },
    effectiveTtlClass: 'default',
    compacted: false,
  });
  for (const addressKey of releasedAddressKeys) {
    assert.deepEqual(custodyProjection(inspectionByAddress.get(addressKey)), {
      addressKey,
      demandState: 'undemanded',
      effectiveRetentionRequest: 'none',
      retainingReason: { kind: 'instance-bookkeeping' },
      effectiveTtlClass: 'default',
      compacted: true,
    });
  }
  const retainingSets = {
    registrations: policyInspection.addresses
      .filter((entry) => entry.retainingReason.kind === 'registrations')
      .map((entry) => entry.addressKey),
    releaseGrace: policyInspection.addresses
      .filter((entry) => entry.retainingReason.kind === 'release-grace')
      .map((entry) => entry.addressKey),
    safetyBlockers: policyInspection.addresses
      .filter((entry) => entry.retainingReason.kind === 'safety-blocker')
      .map((entry) => entry.addressKey),
    instanceBookkeepingStubs: policyInspection.addresses
      .filter((entry) => entry.retainingReason.kind === 'instance-bookkeeping')
      .map((entry) => entry.addressKey),
  };
  assert.deepEqual(retainingSets, {
    registrations: [retainedAddressKey],
    releaseGrace: [],
    safetyBlockers: [],
    instanceBookkeepingStubs: [...releasedAddressKeys].sort(),
  });
  const fragment = retainedRecord.fragments[0];
  const rows = JSON.parse(decoder.decode(fragment.bytes));
  assert.equal(rows.length, 100);
  const fragmentRows = payloadRecords.flatMap((record) => record.fragments.map((candidate) => ({
    addressKey: record.address[2],
    rows: JSON.parse(decoder.decode(candidate.bytes)),
    bytes: candidate.bytes.length,
    proofBytes: encoder.encode(JSON.stringify(candidate.proof)).length,
  })));
  const projections = state.rawRecords.map(materializationPayloadProjection);
  const projection = {
    logicalBytes: projections.reduce((sum, item) => sum + item.logicalBytes, 0),
    fragmentCount: projections.reduce((sum, item) => sum + item.fragmentCount, 0),
  };
  const storedResultRows = fragmentRows.reduce((sum, item) => sum + item.rows.length, 0);
  assert.equal(storedResultRows, 100);
  return {
    state,
    retainedRecord,
    payloadRecords,
    rows,
    fragmentRows,
    storedResultRows,
    projection,
    resultBytes: fragmentRows.reduce((sum, item) => sum + item.bytes, 0),
    proofBytes: fragmentRows.reduce((sum, item) => sum + item.proofBytes, 0),
    retainedResultBytes: fragment.bytes.length,
    expectedAddressKeys,
    retainingSets,
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

async function runRealExit() {
  if (!existsSync(SERVER_BINARY)) {
    throw new Error(`SNAPBACK_TRIAGE_SERVER_BINARY_MISSING: ${SERVER_BINARY}`);
  }
  const scratch = await mkdtemp(join(tmpdir(), 'snapback-triage-graph-'));
  const databasePath = join(scratch, 'triage.sqlite3');
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  const configuredStoreDirectory = process.env.SNAPBACK_CLIENT_RQS_DIR
    ? resolve(process.env.SNAPBACK_CLIENT_RQS_DIR)
    : join(scratch, 'client-owner');
  await mkdir(configuredStoreDirectory, { recursive: true });
  let server = null;
  let owner = null;
  let mallory = null;
  let relaunchedStore = null;
  let relaunchedClient = null;
  try {
    // A trusted activation binds the exact source-derived inputsHash. Remove
    // any predecessor controlled-run source before the untrusted generation,
    // then prepare and publish a successor bound to this run's exact inputs.
    await rm(join(BACKEND, 'trusted-composition-activation.json'), { force: true });
    let generation = await generate(BACKEND);
    assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
    const activationRaw = JSON.parse(execFileSync(
      SERVER_BINARY,
      [
        'composition-activation-prepare',
        '--db', databasePath,
        '--generated', GENERATED,
        '--deployment-id', 'triage-graph-p3-controlled-run',
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
      startupTimeoutMs: 120000,
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

    const boardId = await createBoard(owner.client, generated.api, 'P3 controlled graph');
    const fixture = await writeControlledFixture(owner.client, generated.api, boardId);

    const graph = await collectGraph(owner.client, generated.api, boardId);
    assert.equal(graph.pages, 2);
    assert.equal(graph.issues.length, 100);
    assert.equal(new Set(graph.issues.map((row) => row.issueKey)).size, 100);
    assert.deepEqual(
      graph.issues.map((row) => row.rank),
      Array.from({ length: 100 }, (_, index) => index),
    );
    assert.equal(graph.transitions.length, 20);

    const switchBoards = [];
    for (let ordinal = 0; ordinal < 20; ordinal += 1) {
      const switchBoardId = await createBoard(owner.client, generated.api, `Switch ${ordinal}`);
      await owner.client.mutate(generated.api.seedSwitchIssue, {
        args: { boardId: switchBoardId, ordinal },
        queue: false,
      });
      switchBoards.push({ switchBoardId, ordinal });
    }
    const queryChangeRows = [];
    const releasedAddressKeys = [];
    for (const { switchBoardId, ordinal } of switchBoards) {
      const preparedSwitch = await owner.client.__prepareGeneratedMaterializationBridge(
        generated.api.triageGraph,
        { boardId: switchBoardId },
        null,
        false,
      );
      assert.ok(preparedSwitch, 'each query-change leg must prepare a qmk1 bridge');
      releasedAddressKeys.push(preparedSwitch.bridge.address[2]);
      const live = await owner.client.liveQuery(generated.api.triageGraph, {
        args: { boardId: switchBoardId },
        connectionId: 'triage-graph-query-change',
        persistResume: false,
      });
      const rows = live.rows[0].nodes[0].children;
      assert.deepEqual(rows.map((row) => row.issueKey), [`SWITCH-${ordinal}`]);
      queryChangeRows.push(rows[0].issueKey);
      await live.dispose();
    }
    let implicitPrefixRefusal = null;
    try {
      await owner.client.query(generated.api.implicitPrefixProbe, { args: { boardId } });
    } catch (error) {
      implicitPrefixRefusal = diagnosticCode(error);
    }
    assert.equal(implicitPrefixRefusal, 'SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED');

    const malloryGraph = await mallory.client.query(generated.api.triageGraph, {
      args: { boardId },
    });
    assert.deepEqual(malloryGraph.rows, [{ kind: 'absent', nodes: null, continuation: null }]);
    const malloryInbox = await mallory.client.query(generated.api.retainedInbox, { args: {} });
    assert.deepEqual(malloryInbox.rows, []);

    const hydrationStarted = performance.now();
    const liveInbox = await owner.client.liveQuery(generated.api.retainedInbox, {
      connectionId: 'triage-graph-retained-live',
      persistResume: true,
    });
    const hydrationMs = Number((performance.now() - hydrationStarted).toFixed(3));
    assert.equal(liveInbox.rows.length, 100);
    assert.equal(liveInbox.answerClass, 'authoritative');
    assert.equal(liveInbox.freshness, 'current');
    assert.equal(liveInbox.retention.retainable, true);
    const hydrationRowsInstalled = liveInbox.rows.length;
    const { prepared, registration } = await installDurableRegistration(
      owner.client,
      generated.api,
    );
    await liveInbox.dispose();

    // The production runtime queues this pass. The acceptance harness owns the
    // clock and scheduler so the custody point is deterministic and never
    // depends on wall time or an idle callback winning a race.
    await owner.client.__runStoreMaintenance();
    const policyInspection = await owner.client.storePolicyInspection({
      authorityPartitionDigest: prepared.bridge.authorityPartitionDigest,
    });

    const custody = await inspectCustody({
      store: owner.store,
      registration,
      retainedBridge: prepared.bridge,
      releasedAddressKeys,
      policyInspection,
    });
    const physicalBytes = await physicalStoreBytes(configuredStoreDirectory);
    const registrationBytes = encoder.encode(JSON.stringify(registration)).length;
    assert.equal(custody.state.pageSets, 0);
    assert.equal(custody.state.memberships, 0);
    assert.equal(countDurableRegistrations(custody.state.meta.durableRegistrations), 1);
    assert.equal(Object.keys(custody.state.leases).length, 1);

    const liveOrigin = server.baseUrl;
    await server.stop();
    server = null;
    await owner.store.close();
    owner.store = null;

    relaunchedStore = createFileRqsResumeStore({
      directory: configuredStoreDirectory,
      identity: 'triage-owner',
    });
    await relaunchedStore.whenLockSettled();
    const relaunchedMeta = await relaunchedStore.readStoreMeta();
    assert.equal(countDurableRegistrations(relaunchedMeta.durableRegistrations), 1);
    relaunchedClient = new SnapbackClient(liveOrigin, {
      authCoordinator: owner.coordinator,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
      rqsStore: relaunchedStore,
      offlineQueue: false,
    });
    const relaunchUpdates = [];
    const relaunched = await relaunchedClient.liveQuery(generated.api.retainedInbox, {
      connectionId: 'triage-graph-retained-relaunch',
      persistResume: true,
      onUpdate: (_rows, detail) => relaunchUpdates.push(detail),
    });
    assert.equal(relaunched.rows.length, 100);
    assert.equal(relaunched.answerClass, 'authoritative');
    assert.equal(relaunched.freshness, 'retained');
    await relaunched.dispose();

    const frozenDurationMs = Math.max(1000, Math.ceil(hydrationMs / 100) * 100);
    const budgets = {
      schemaVersion: 'snapback.triage-graph.budget-freeze.v1',
      date: DATE,
      authority: 'LLP 0155 OQ9',
      feedsMeasuredRevision: 'LLP 0166 OQ4',
      custodySemantics: 'store-policy-reasons-v1',
      optimizationPerformedBeforeFreeze: false,
      controlledWorkload: fixture,
      measured: {
        custody: {
          materializationRecords: custody.state.records.length,
          payloadBearingRecords: custody.payloadRecords.length,
          releasedVolatilePayloadRecords: 0,
          instanceBookkeepingStubs: custody.retainingSets.instanceBookkeepingStubs.length,
          releaseGraceRecords: custody.retainingSets.releaseGrace.length,
          safetyBlockerRecords: custody.retainingSets.safetyBlockers.length,
          fragments: custody.projection.fragmentCount,
          storedResultRows: custody.storedResultRows,
          authoritativeRetainedRows: custody.rows.length,
          logicalBytes: custody.projection.logicalBytes,
          resultBytes: custody.resultBytes,
          proofBytes: custody.proofBytes,
          durableRegistrations: 1,
          registrationBytes,
          leaseRecords: 1,
          physicalCarrierBytes: physicalBytes,
        },
        hydration: {
          attempts: 1,
          rowsInstalled: hydrationRowsInstalled,
          payloadBytes: custody.retainedResultBytes,
          elapsedMs: hydrationMs,
        },
      },
      frozenCeilings: {
        custody: {
          materializationRecords: custody.expectedAddressKeys.length,
          payloadBearingRecords: custody.retainingSets.registrations.length,
          releasedVolatilePayloadRecords: 0,
          instanceBookkeepingStubs: custody.retainingSets.instanceBookkeepingStubs.length,
          releaseGraceRecords: custody.retainingSets.releaseGrace.length,
          safetyBlockerRecords: custody.retainingSets.safetyBlockers.length,
          fragments: custody.projection.fragmentCount,
          storedResultRows: custody.storedResultRows,
          authoritativeRetainedRows: 100,
          logicalBytes: custody.projection.logicalBytes,
          durableRegistrations: 1,
          registrationBytes,
          leaseRecords: 1,
        },
        hydration: {
          attempts: 1,
          rowsInstalled: 100,
          payloadBytes: custody.retainedResultBytes,
          elapsedMs: frozenDurationMs,
        },
      },
    };

    return {
      activation: {
        format: activationRaw.format,
        activationHash: activationRaw.activationHash,
        deploymentId: 'triage-graph-p3-controlled-run',
      },
      fixture,
      budgetFreeze: budgets,
      gateEvidence: {
        pagination: {
          pages: graph.pages,
          rows: graph.issues.length,
          uniqueIssueKeys: new Set(graph.issues.map((row) => row.issueKey)).size,
          ranks: [graph.issues[0].rank, graph.issues.at(-1).rank],
          transitionRows: graph.transitions.length,
        },
        queryChanges: {
          changes: queryChangeRows.length,
          rows: queryChangeRows,
          retainedVolatilePayloadEnvelopes: 0,
          compactedInstanceBookkeepingStubs: releasedAddressKeys.length,
          offlineRenderability: 'unknown-render-nothing',
        },
        convergence: { ...fixture, activeMatches: graph.issues.length },
        implicitPrefixRefusal,
        mallory: {
          protectedGraphRows: malloryGraph.rows[0].kind === 'absent' ? 0 : null,
          protectedRetainedRows: malloryInbox.rows.length,
        },
        custody: {
          materializationRecords: custody.state.records.length,
          payloadBearingRecords: custody.payloadRecords.length,
          releasedVolatilePayloadRecords: 0,
          retainingSets: custody.retainingSets,
          fragments: custody.projection.fragmentCount,
          storedResultRowsExplained: custody.storedResultRows,
          authoritativeRetainedRowsExplained: custody.rows.length,
          durableRegistrations: 1,
          leaseRecords: 1,
          addressKey: prepared.bridge.address[2],
          currentTransition: { answerClass: 'authoritative', freshness: 'current' },
          relaunchTransition: {
            answerClass: relaunched.answerClass,
            freshness: relaunched.freshness,
            updateKind: relaunchUpdates[0]?.kind ?? null,
            updateCallbackObserved: relaunchUpdates.length > 0,
          },
        },
      },
      runtime: {
        serverBinary: relative(ROOT, SERVER_BINARY),
        serverBinarySha256: sha256Hex(readFileSync(SERVER_BINARY)),
        launchRung: fixtureServer.launch?.rung ?? null,
        backendStoppedBeforeRelaunch: true,
      },
    };
  } finally {
    try { await server?.stop(); } catch {}
    try { await owner?.store?.close(); } catch {}
    try { await mallory?.store?.close(); } catch {}
    try { await relaunchedStore?.close(); } catch {}
    try { await owner?.client?.closeAuth(); } catch {}
    try { await mallory?.client?.closeAuth(); } catch {}
    try { await relaunchedClient?.closeAuth(); } catch {}
    await rm(scratch, { recursive: true, force: true });
  }
}

function sourceProvenance() {
  const paths = [
    'tests/acceptance/triage-graph-move1-v1.mjs',
    'demos/triage-graph/snapback/schema.mjs',
    'demos/triage-graph/snapback/functions.mjs',
    'demos/triage-graph/snapback/trusted-composition-activation.json',
    'demos/triage-graph/snapback/generated/artifacts.json',
    'demos/triage-graph/demo.snapback.json',
    'demos/triage-graph/src/App.tsx',
    'demos/triage-graph/src/retained-registration.ts',
    'packages/snapback-client/index.mjs',
    'packages/snapback-client/materialization-store.mjs',
    'packages/snapback-client/materialization-store-runtime.mjs',
    'packages/snapback-client/rqs-preload-core.mjs',
    'packages/snapback-client/store-policy.mjs',
    'packages/snapback-client/store-runtime.mjs',
    `demos/triage-graph/workload-manifest.${WORKLOAD_DATE}.v1.json`,
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
  const budget = receipt.budgetFreeze?.frozenCeilings;
  return `# Triage Graph Move-1 exit evidence

**Run date:** ${DATE}
**Source revision:** \`${receipt.source.revision}\` (dirty lane worktree)
**Controlled run:** ${receipt.controlledRun.status}

This is the Triage-only successor-app receipt. Fleet is excluded and remains
blocked on LLP 0135 OQ5. A BLOCKED row means the local sandbox denied a
loopback socket; it is never interpreted as a pass.

| # | Status | LLP 0157 Triage gate | Evidence |
| -: | --- | --- | --- |
${rows}

## Frozen budgets

${budget ? `Custody freezes at ${budget.custody.materializationRecords} materializations,
${budget.custody.fragments} fragments, ${budget.custody.storedResultRows} stored result rows
(${budget.custody.authoritativeRetainedRows} authoritative-retained), and
${budget.custody.logicalBytes} logical bytes. Hydration freezes at
${budget.hydration.attempts} attempt, ${budget.hydration.rowsInstalled} rows,
${budget.hydration.payloadBytes} payload bytes, and ${budget.hydration.elapsedMs} ms.`
    : 'No numbers were frozen because the controlled server run was blocked by the sandbox.'}

The budget fixture is
\`tests/acceptance/fixtures/triage-graph/budget-freeze.${DATE}.v1.json\` and is
the reason-based input to LLP 0166 OQ4's measured revision. This evidence alone
never publishes a capability.
`;
}

async function verifyRetainedArtifacts() {
  const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  assert.equal(receipt.schemaVersion, 'snapback.triage-graph.move1-exit.v1');
  assert.equal(receipt.date, DATE);
  assert.equal(receipt.gates.length, 8);
  assert.deepEqual(receipt.gates.map((gate) => gate.gate), GATES);
  for (const gate of receipt.gates) {
    assert.ok(['PASS', 'BLOCKED'].includes(gate.status));
    assert.equal(typeof gate.evidence, 'object');
    if (gate.status === 'BLOCKED') assert.match(gate.reason, /^SNAPBACK_TRIAGE_SANDBOX_SOCKET_BLOCKED:/u);
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
    assert.equal(budget.date, DATE);
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
    assert.equal(receipt.summary.pass, 8);
    assert.equal(receipt.summary.blocked, 0);
  }
  if (process.argv.includes('--require-qualified')) {
    assert.equal(receipt.controlledRun.status, 'PASS', 'publication requires a controlled PASS');
    // The summary may carry additional advisory booleans (capability-claim
    // and fleet-inclusion markers); qualification pins the counts exactly.
    assert.equal(receipt.summary.pass, 8);
    assert.equal(receipt.summary.blocked, 0);
    assert.equal(receipt.summary.total, 8);
  }
  assert.equal(existsSync(EVIDENCE_PATH), true);
  console.log(
    `PASS Triage Graph retained receipt: ${receipt.summary.pass}/8 PASS, ${receipt.summary.blocked} BLOCKED`,
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
    block = `SNAPBACK_TRIAGE_SANDBOX_SOCKET_BLOCKED: ${String(error?.message ?? error)}`;
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
      pass(GATES[7], real.gateEvidence.custody),
    ] : GATES.slice(1).map(blocked)),
  ];
  const receipt = {
    schemaVersion: 'snapback.triage-graph.move1-exit.v1',
    date: DATE,
    authority: [
      'LLP 0157#move-1-workload-exit-llp-0155-normative-transcription',
      'LLP 0155 OQ9',
      'LLP 0155 OQ13',
      'LLP 0166#d4--completeness-honest-local-answers',
    ],
    source: sourceProvenance(),
    controlledRun: real ? { status: 'PASS', runtime: real.runtime, activation: real.activation }
      : { status: 'BLOCKED', reason: block },
    manifestDecision: staticEvidence.manifestDecision,
    budgetFreeze: real?.budgetFreeze ?? null,
    summary: {
      pass: gates.filter((gate) => gate.status === 'PASS').length,
      blocked: gates.filter((gate) => gate.status === 'BLOCKED').length,
      total: gates.length,
      capabilityClaimsChanged: false,
      fleetIncluded: false,
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
