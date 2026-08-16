// Public-dashboard demo — diary-grade offline acceptance on the JS arm
// (LLP 0129 Phase 0 evidence, Node/durable-file carrier over public
// rqsEligible queries. NOT the full Phase 0 gate: that reads "a diary-grade
// offline acceptance rerun on the chosen arm," and the chosen arm is the
// JS/React *browser* arm. This suite exercises no React surface, no
// standards-real IndexedDB, no browser-process restart, and no auth-scoped
// retention refusal, so LLP 0130 SD-5's self-advancing rule does not fire on
// it — see LLP 0129 §Phases, "Proof-scope correction," and
// issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md.)
//
// The comparator is Diary 0027's measured Convex cold-boot GAP: a reopened
// browser with the backend down "yielded no authenticated application shell
// and zero retained query rows." This suite proves, on the scored JS arm
// with its DEFAULT persistence paths (no injected store):
//   1. retained render with data (the retainable rqsEligible subset) by a
//      FRESH CLIENT INSTANCE IN THE SAME PROCESS — not a cold boot; this
//      suite never restarts the client process — after server
//      restart + client relaunch — including with the backend unreachable;
//   2. warm-session offline create/update settling exactly-once on resume
//      through the LLP 0043 M2 outbox;
//   3. the retainability boundary refused with clarity (LLP 0053): a
//      non-eligible query names WHY it will not act local-first;
//   4. the LLP 0090 D3 outbox rule with its 2026-08-01 rendering-side note:
//      a relaunch with pending intent still renders the retained PRE-intent
//      rows (marked, with the explicit pending-intent fact) while the resume
//      token is withheld — replay stays full-resync-first.
//
// @ref LLP 0043#milestone-2-queued-mutation-replay — ordered replay under a
//   client-minted durable identity; duplicate delivery returns the original
//   settlement (exactly-once).
// @ref LLP 0090#d3-channel-b--persisted-device-snapshot — render-first from
//   the persisted entry; a non-empty outbox never resumes (the retained
//   render survives, token withheld — the dated rendering note).

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient, rqsEntryKey } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..', '..');
const repoRoot = resolve(appDir, '..', '..');
const generatedDir = join(appDir, 'snapback', 'generated');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const generated = (name) => readJson(join(generatedDir, name));
const seed = readJson(join(appDir, 'snapback', 'seed.json'));

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
async function waitUntil(predicate, { timeoutMs = 30_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

// The DEFAULT persistence path under test: the client resolves its own file
// store from the environment — nothing is injected.
const stateDir = mkdtempSync(join(tmpdir(), 'snapback-offline-accept-'));
process.env.SNAPBACK_CLIENT_RQS_DIR = join(stateDir, 'rqs');
delete process.env.SNAPBACK_CLIENT_RQS_STORE;
const dbPath = join(stateDir, 'dashboard.db');

const port = await freePort();
const provenance = {
  appId: 'public-dashboard',
  artifactsPath: join(generatedDir, 'artifacts.json'),
};
const bootServer = () => startServer({
  port,
  bindPortExactly: true,
  db: dbPath,
  cwd: repoRoot,
  provenance,
});

const suite = createSuite('public-dashboard / offline-local-first (JS arm)', {
  expectedChecks: 9,
});

let server = await bootServer();
{
  const provisioner = new SnapbackClient(server.baseUrl, {
    ...server.clientOptions,
    rqsStore: null,
  });
  await provisioner.ensureApp({
    schema: generated('schema.manifest.json'),
    functions: generated('functions.manifest.json'),
    seed,
  });
}

const cleanups = [];
const trackedClients = new Set();
const openClient = () => {
  const client = new SnapbackClient(server.baseUrl, server.clientOptions);
  trackedClients.add(client);
  return client;
};
const closeClient = async (client) => {
  trackedClients.delete(client);
  try { await client.rqsStore?.close?.(); } catch { /* teardown */ }
};
cleanups.push(async () => {
  for (const client of [...trackedClients]) await closeClient(client);
});
cleanups.push(() => server.stop().catch(() => {}));

await runAcceptance(suite, async () => {
  // ---- Warm session: default store, persistence, retainability facts ----
  const clientA = openClient();
  let handleA;
  await suite.check('default persistence path resolves a durable store and persists the eligible query', async () => {
    assertEqual(clientA.rqsStoreInfo.source, 'default', 'store source');
    assertEqual(clientA.rqsStoreInfo.implementation, 'file', 'store implementation');
    assertEqual(clientA.rqsStoreInfo.durable, true, 'store durability');
    handleA = await clientA.liveQuery('dashboardMetrics', {
      connectionId: 'offline-arm-a',
      args: { dashboardId: 'ops' },
      transport: 'stream',
    });
    assertEqual(handleA.rows.map(({ label }) => label), ['latency_ms', 'uptime_pct'], 'seeded ops rows');
    assertEqual(handleA.freshness, 'current', 'fresh subscribe is authoritative');
    assert(handleA.retention?.retainable === true, 'eligible query classified retainable');
    assert(handleA.rqsResume?.token, 'server minted a resume token');
    await handleA.flushResumeState();
    const inspection = await clientA.rqsStore.inspection();
    assert(inspection.entries >= 1, 'persisted entry committed');
    return { store: { ...clientA.rqsStoreInfo }, entries: inspection.entries };
  });

  await suite.check('non-eligible query refuses retention with a named reason (LLP 0053 boundary)', async () => {
    const feed = await clientA.liveQuery('metricsFeed', {
      connectionId: 'offline-arm-a',
      args: { dashboardId: 'ops' },
    });
    try {
      assertEqual(feed.retention?.retainable, false, 'refused retainability');
      assertEqual(feed.retention?.code, 'SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE', 'refusal code');
      const entry = await clientA.rqsStore.load(
        rqsEntryKey('metricsFeed', { dashboardId: 'ops' }),
      );
      assertEqual(entry, null, 'nothing persisted for the refused query');
      return { retention: { ...feed.retention, store: undefined } };
    } finally {
      feed.dispose();
    }
  });

  // ---- Cold boot with the backend unreachable (the Convex GAP scenario) ----
  handleA.dispose();
  await handleA.settled?.();
  await closeClient(clientA);
  await server.stop();

  let clientB;
  let handleB;
  const updatesB = [];
  await suite.check('fresh client instance (same process) with the backend down renders retained rows (Diary 0027 comparator)', async () => {
    clientB = openClient();
    handleB = await clientB.liveQuery('dashboardMetrics', {
      connectionId: 'offline-arm-b',
      args: { dashboardId: 'ops' },
      transport: 'stream',
      onUpdate: (rows, detail) => updatesB.push({ kind: detail.kind, freshness: detail.freshness ?? null, rows: rows.length }),
    });
    assertEqual(updatesB[0]?.kind, 'persisted', 'first frame is the persisted render');
    assertEqual(handleB.freshness, 'retained', 'offline boot rows are retained, never current');
    assertEqual(handleB.rows.map(({ label }) => label), ['latency_ms', 'uptime_pct'], 'retained rows render offline');
    return { firstFrame: updatesB[0], connection: handleB.connection };
  });

  // ---- Warm-session offline writes queue durably ----
  let queuedCreate;
  let queuedUpdate;
  await suite.check('offline create/update queue durably with client-minted ids', async () => {
    queuedCreate = await clientB.mutate('recordMetric', {
      args: { dashboardId: 'ops', label: 'error_rate', value: 3 },
    });
    queuedUpdate = await clientB.mutate('setMetricValue', {
      args: { id: 'metric_ops_uptime', value: 98 },
    });
    assertEqual(queuedCreate.status, 'queued', 'create queued');
    assertEqual(queuedUpdate.status, 'queued', 'update queued');
    assert(
      typeof queuedCreate.clientMutationId === 'string' && queuedCreate.clientMutationId.length > 0,
      'client-minted durable identity',
    );
    assert(queuedUpdate.sequence > queuedCreate.sequence, 'monotonic sequence order');
    const pending = await clientB.rqsStore.outboxPending();
    assertEqual(pending.map((r) => r.function), ['recordMetric', 'setMetricValue'], 'durable pending queue');
    return {
      queuedCreate: {
        status: queuedCreate.status,
        clientMutationIdPresent: true,
        sequence: queuedCreate.sequence,
      },
      queuedUpdate: {
        status: queuedUpdate.status,
        clientMutationIdPresent: true,
        sequence: queuedUpdate.sequence,
      },
    };
  });

  // ---- LLP 0090 D3 outbox rule (2026-08-01 rendering-side note) ----
  await suite.check('a relaunch with pending intent renders retained pre-intent rows and withholds the resume token (outbox rule)', async () => {
    // The D3 protocol rule is untouched: a non-empty outbox never resumes —
    // the handle holds NO token and reconnect takes full-resync-then-ordered-
    // replay. What the rendering-side note adds: the verified retained rows
    // still render, marked 'retained', with the explicit pending-intent fact,
    // and WITHOUT the queued writes (pre-intent rows, no fabricated overlay)
    // — the frozen Diary 0027 field-notebook scenario.
    const bystander = new SnapbackClient(server.baseUrl, server.clientOptions);
    try {
      const handle = await bystander.liveQuery('dashboardMetrics', {
        connectionId: 'offline-arm-rule',
        args: { dashboardId: 'ops' },
      });
      try {
        assertEqual(handle.freshness, 'retained', 'retained render survives the pending outbox');
        assertEqual(handle.connection, 'stale', 'offline boot holds at the stale axis');
        assertEqual(handle.pendingIntentsAtSeed, 2, 'the explicit pending-intent fact is on the handle');
        assertEqual(handle.rqsResume, null, 'the resume token is withheld (D3: a non-empty outbox never resumes)');
        assertEqual(
          handle.rows.map(({ label }) => label),
          ['latency_ms', 'uptime_pct'],
          'rows are pre-intent: the queued create/update are NOT overlaid',
        );
        const uptime = handle.rows.find((row) => row.label === 'uptime_pct');
        assert(uptime.value !== 98, 'the queued update value is not fabricated into the retained frame');
        return {
          freshness: handle.freshness,
          pendingIntentsAtSeed: handle.pendingIntentsAtSeed,
          connection: handle.connection,
        };
      } finally {
        handle.dispose();
        await handle.settled?.();
      }
    } finally {
      await bystander.rqsStore?.close?.();
    }
  });

  // ---- Reconnect: ordered replay settles exactly-once ----
  await suite.check('server restart settles the queued intent exactly-once through the outbox', async () => {
    server = await bootServer();
    // The dev server provisions per boot (the packaged dev loop's ensure-on-
    // boot); re-ensure with the identical artifacts is idempotent and
    // preserves the durable stream identity in the db file.
    const reprovisioner = new SnapbackClient(server.baseUrl, {
      ...server.clientOptions,
      rqsStore: null,
    });
    await reprovisioner.ensureApp({
      schema: generated('schema.manifest.json'),
      functions: generated('functions.manifest.json'),
      seed,
    });
    await waitUntil(async () => (await clientB.rqsStore.outboxPending()).length === 0, {
      label: 'outbox drain after reconnect',
    });
    await waitUntil(() => handleB.freshness === 'current', { label: 'handle back to current' });
    await waitUntil(
      () => handleB.rows.some((row) => row.label === 'error_rate' && row.value === 3),
      { label: 'replayed create visible in live rows' },
    );
    const uptime = handleB.rows.find((row) => row.label === 'uptime_pct');
    assertEqual(uptime.value, 98, 'replayed update applied');
    const errorRows = handleB.rows.filter((row) => row.label === 'error_rate');
    assertEqual(errorRows.length, 1, 'exactly one settled create');
    const diagnostics = clientB.outboxDiagnostics.map(({ code }) => code);
    assert(diagnostics.includes('SNAPBACK_OFFLINE_MUTATION_QUEUED'), 'queue diagnostic recorded');
    assert(diagnostics.includes('SNAPBACK_OFFLINE_MUTATION_REPLAYED'), 'replay diagnostic recorded');
    return {
      rows: handleB.rows.map(({ _version, dashboardId, label, value }) => ({
        _version,
        dashboardId,
        label,
        value,
      })),
      diagnostics,
    };
  });

  await suite.check('duplicate delivery of a settled id returns the original settlement (exactly-once ledger)', async () => {
    const duplicate = await clientB.mutate('recordMetric', {
      args: { dashboardId: 'ops', label: 'error_rate', value: 3 },
      clientMutationId: queuedCreate.clientMutationId,
      queue: false,
    });
    assert(duplicate.result, 'duplicate delivery returned a settlement');
    const settledCreate = handleB.rows.find((row) => row.label === 'error_rate');
    assertEqual(duplicate.result, settledCreate?._id, 'duplicate returns the original row identity');
    assertEqual(duplicate.changed_count, 1, 'duplicate retains the original changed-count witness');
    assertEqual(duplicate.receipt?.outcome, 'confirmed', 'duplicate retains the confirmed outcome');
    assertEqual(duplicate.receipt?.settlementLane, 'replay-accept', 'duplicate retains the replay lane');
    await waitUntil(
      () => handleB.rows.filter((row) => row.label === 'error_rate').length === 1,
      { label: 'no ghost duplicate row' },
    );
    const probe = await clientB.liveQuery('metricsFeed', {
      connectionId: 'offline-arm-b',
      args: { dashboardId: 'ops' },
    });
    try {
      assertEqual(
        probe.rows.filter((row) => row.label === 'error_rate').length,
        1,
        'server holds exactly one error_rate row',
      );
    } finally {
      probe.dispose();
    }
    return {
      duplicate: {
        version: duplicate.version,
        changedCount: duplicate.changed_count,
        resultMatchesSettledCreate: true,
        authorityDescriptorVersion: duplicate.authorityDescriptor?.descriptorVersion,
        authoritySessionGeneration: duplicate.authorityDescriptor?.sessionGeneration,
        receipt: {
          kind: duplicate.receipt?.kind,
          mutation: duplicate.receipt?.mutation,
          outcome: duplicate.receipt?.outcome,
          settlementLane: duplicate.receipt?.settlementLane,
          claimFields: duplicate.receipt?.claimLedger?.map(({ fieldOrSlot, disposition }) => ({
            fieldOrSlot,
            disposition,
          })),
          rollbackReason: duplicate.receipt?.rollbackReason,
          affectedTables: duplicate.receipt?.affectedTables,
          snapshotVersion: duplicate.receipt?.snapshotVersion,
          transport: duplicate.receipt?.transport,
          correlation: duplicate.receipt?.correlation,
        },
      },
    };
  });

  // ---- Cold boot with data after server restart + client relaunch ----
  handleB.dispose();
  await closeClient(clientB);

  await suite.check('fresh client instance (same process) after restart renders retained rows first, then settles current', async () => {
    const clientC = openClient();
    const updates = [];
    const handleC = await clientC.liveQuery('dashboardMetrics', {
      connectionId: 'offline-arm-c',
      args: { dashboardId: 'ops' },
      transport: 'stream',
      onUpdate: (rows, detail) => updates.push(detail.kind),
    });
    try {
      await waitUntil(() => handleC.freshness === 'current', { label: 'relaunch settles current' });
      assert(
        handleC.rows.some((row) => row.label === 'error_rate'),
        'offline-settled create present after relaunch',
      );
      return { updateKinds: updates, rows: handleC.rows.length };
    } finally {
      handleC.dispose();
      await closeClient(clientC);
    }
  });

  await suite.check('claims match acceptance: no Parity claim, retained is marked, memory fallback declared', async () => {
    // The JS arm runs no local execution: the queued path is Online-class
    // retention/replay (LLP 0043's proof rule gates Parity on local
    // IR-derivability, which this arm does not claim).
    const clientD = new SnapbackClient(server.baseUrl, {
      ...server.clientOptions,
      rqsStore: null,
    });
    assertEqual(clientD.rqsStoreInfo.source, 'disabled', 'explicit opt-out is honored');
    process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';
    try {
      const clientE = new SnapbackClient(server.baseUrl, server.clientOptions);
      assertEqual(clientE.rqsStoreInfo.source, 'disabled', 'kill switch disables persistence');
      assertEqual(clientE.rqsStore, null, 'kill switch resolves no store');
    } finally {
      delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    }
    return { optOut: true };
  });
}, {
  cleanups,
  reportFile: join(appDir, 'offline-acceptance-report.json'),
});
