// All Aboard — Phase 2 cron acceptance (LLP 0027 / LLP 0028).
//
// Proves the scheduled/demand refresh on the local in-process scheduler:
//   - the warm-poll job is armed only while a client is subscribed to the live
//     query it declares (demand activation), and goes inactive again on disconnect;
//   - a scheduler tick, once armed, runs the refresh ACTION, which commits through
//     the refresh MUTATION and pushes a live-query delta (durable write -> realtime);
//   - the run is recorded in the observable cron ledger.
//
// Run: TZ=America/Los_Angeles node demos/all-aboard/tests/acceptance/cron.mjs
//
// A forced tick (/_snapback/api/cron/tick) recomputes activation deterministically
// and, because an everyMs job is immediately due, fires it exactly once while armed
// (subsequent ticks are not yet due). This keeps the check independent of the 1s
// background scheduler's timing.

process.env.TZ = 'America/Los_Angeles';

import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { AdminClient } from '../../../../packages/snapback-admin-client/index.mjs';
import { generate } from '../../../../packages/snapback-codegen/index.mjs';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const expiryFixtureSource = join(repoRoot, 'tests', 'fixtures', 'guide-scheduled-expiry');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const expirySeed = JSON.parse(readFileSync(join(expiryFixtureSource, 'seed.json'), 'utf8'));
const VALID_LIMITED_DELAYS = new Set([0, 60, 180, 240]);

const suite = createSuite('cron actions and scheduled expiry');
let server = null;
let db = null;
let admin = null;
let expiryServer = null;
let expiryLive = null;
let expiryFixtureDir = null;
const cleanups = [
  () => {
    if (expiryFixtureDir) rmSync(expiryFixtureDir, { recursive: true, force: true });
  },
  () => server?.stop(),
  () => expiryServer?.stop(),
  () => expiryLive?.dispose(),
];

function streamRecorder() {
  const updates = [];
  const waiters = new Set();
  const onUpdate = (rows, detail) => {
    updates.push({ rows, kind: detail?.kind ?? null });
    for (const waiter of waiters) {
      if (!waiter.predicate(rows, detail)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve();
    }
  };
  const waitFor = (predicate, label, timeoutMs = 5_000) => {
    const prior = updates.find(({ rows, kind }) => predicate(rows, { kind }));
    if (prior) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(`timed out waiting for ${label}`));
      }, timeoutMs);
      waiters.add(waiter);
    });
  };
  return { onUpdate, updates, waitFor };
}

// Authenticated tick via the kit client: /_snapback/api/cron/tick is an
// AdminWrite, and the raw unauthenticated fetch this used to be swallowed a
// 401 SNAPBACK_ADMIN_TOKEN_REQUIRED — the scheduler never saw the tick and
// the suite failed 3 checks downstream with no hint (ENG-23706).
const forceTick = () => db.cronTick();
const inspectJob = async () => {
  const state = await admin.inspect();
  return (state.cron?.jobs ?? []).find((j) => j.name === 'warmPoll') ?? null;
};
const activation = (job) => String(job?.activationState ?? '').toLowerCase();

// runAcceptance (ENG-22486) surfaces a setup throw and exits nonzero on a
// zero-check run — previously a pre-check failure here exited "PASS — 0/0".
await runAcceptance(suite, async () => {
  server = await startServer({
    port: 4409,
    db: ':memory:',
    cwd: repoRoot,
    serverBinary: process.env.SNAPBACK_RUNTIME_BINARY ?? null,
    cronDisabled: true,
    provenance: { appId: 'all-aboard', artifactsPath: join(repoRoot, 'demos', 'all-aboard', 'snapback', 'generated', 'artifacts.json') },
  });
  db = new SnapbackClient(server.baseUrl, server.clientOptions);
  admin = new AdminClient(`${server.baseUrl}/_snapback/api`, { token: server.adminToken });

  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(seed);

  await suite.check('warm-poll job is registered from the manifest', async () => {
    const job = await inspectJob();
    assert(job, 'warmPoll present in cron inspect state');
    assertEqual(job.action ?? job.actionName ?? 'refreshFeed', 'refreshFeed', 'targets the refresh action');
    return { name: job.name };
  });

  await suite.check('demand activation: inactive with no subscribers', async () => {
    await forceTick();
    const job = await inspectJob();
    assert(activation(job).includes('inactive') || activation(job).includes('no'), `expected inactive-no-demand, got "${activation(job)}"`);
  });

  // Subscribing to the declared live query arms the job (whileLive activation).
  const live = await db.liveQuery('liveTrainStatus', { connectionId: 'cron-rider' });
  const versionBefore = live.version;

  await suite.check('demand activation: armed while a rider is subscribed', async () => {
    await forceTick(); // armed + immediately due => fires exactly once
    const job = await inspectJob();
    assertEqual(activation(job), 'armed', 'job armed while subscribed');
  });

  await suite.check('scheduler run: action -> mutation -> live delta', async () => {
    const rows = await live.poll();
    assert(live.version > versionBefore, `durable version advanced (${versionBefore} -> ${live.version})`);
    const limited = rows.find((r) => r.patternId === 'sb-limited');
    assert(VALID_LIMITED_DELAYS.has(limited.delaySeconds), `delivered a valid recorded profile (${limited.delaySeconds}s)`);
    return { version: `${versionBefore} -> ${live.version}` };
  });

  await suite.check('refresh committed through the mutation (feed marker + trigger)', async () => {
    const state = (await db.query('feedState', {})).rows[0];
    assert(state.tickIndex >= 1, 'feedRefreshState advanced');
    assertEqual(state.lastRunTrigger, 'cron', 'written by the cron action');
    assertEqual(state.lastSource, 'recorded-fallback', 'no configured feed falls back to recorded data');
    assert(/caltrainFeed|fetch|config/i.test(state.lastError ?? ''), `fallback records the reason, got ${state.lastError}`);
  });

  await suite.check('run is recorded in the cron ledger', async () => {
    const job = await inspectJob();
    const runs = job.recentRuns ?? [];
    assert(runs.length >= 1, 'at least one run recorded');
    const succeeded = runs.filter((r) => String(r.outcome).toLowerCase() === 'succeeded');
    assert(succeeded.length >= 1, 'a run succeeded');
    return { runs: runs.length, succeeded: succeeded.length };
  });

  await suite.check('demand activation: inactive again after the rider disconnects', async () => {
    await db.disconnect('cron-rider');
    await forceTick(); // recompute activation without a subscriber => no fire
    const job = await inspectJob();
    assert(activation(job).includes('inactive') || activation(job).includes('no'), `expected inactive after disconnect, got "${activation(job)}"`);
  });

  await server.stop();
  server = null;

  expiryFixtureDir = mkdtempSync(join(repoRoot, 'guide-expiry-test-'));
  for (const file of ['schema.mjs', 'functions.mjs']) {
    cpSync(join(expiryFixtureSource, file), join(expiryFixtureDir, file));
  }
  const generated = await generate(expiryFixtureDir);
  assert(generated.ok, `scheduled-expiry fixture codegen failed: ${JSON.stringify(generated.diagnostics)}`);
  const expiryGen = (file) => JSON.parse(readFileSync(
    join(expiryFixtureDir, 'generated', file),
    'utf8',
  ));
  const expiryFunctions = expiryGen('functions.manifest.json');
  const expirySchema = expiryGen('schema.manifest.json');

  await suite.check('expiry recipe declares system-compatible authority and bounded policies', async () => {
    const action = expiryFunctions.functions.find(({ name }) => name === 'runExpirySweep');
    const job = expiryFunctions.cronJobs.find(({ name }) => name === 'expireLinks');
    const links = expirySchema.tables.find(({ name }) => name === 'links');
    assertEqual(action.authRequirement, 'public', 'cron action does not require a user principal');
    assertEqual(job.action, 'runExpirySweep', 'cron targets the action, not the mutation');
    assertEqual(job.overlapPolicy, 'NoOverlap', 'overlapping claims are skipped');
    assertEqual(job.retryPolicy, { mode: 'NextTick' }, 'failure retries at the next slot');
    assert(links.indexes.some(({ name }) => name === 'by_status_and_expires_at'), 'bounded due-row index is declared');
  });

  expiryServer = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    serverBinary: process.env.SNAPBACK_RUNTIME_BINARY ?? null,
    cronDisabled: true,
    provenance: {
      appId: expiryFunctions.appId,
      artifactsPath: join(expiryFixtureDir, 'generated', 'artifacts.json'),
    },
  });
  const expiryDb = new SnapbackClient(expiryServer.baseUrl, expiryServer.clientOptions);
  const expiryAdmin = new AdminClient(`${expiryServer.baseUrl}/_snapback/api`, {
    token: expiryServer.adminToken,
  });
  await expiryDb.loadSchema(expirySchema);
  await expiryDb.loadFunctions(expiryFunctions);
  await expiryDb.reset(expirySeed);

  const recorder = streamRecorder();
  expiryLive = await expiryDb.liveQuery('linksByExpiry', {
    connectionId: 'guide-expiry-observer',
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate: recorder.onUpdate,
  });

  let firstRun = null;
  await suite.check('manual test tick uses nominal time and enforces the scan ceiling', async () => {
    const runs = await expiryAdmin.tickCron();
    firstRun = runs.find(({ jobName }) => jobName === 'expireLinks');
    assert(firstRun, 'manual tick claimed expireLinks');
    assertEqual(firstRun.outcome, 'Succeeded', 'scheduled action succeeded');
    assertEqual(firstRun.trigger, 'Scheduled', 'test tick used the scheduled path');
    assertEqual(firstRun.result.changed, 3, 'one mutation changed at most the three-row ceiling');
    assertEqual(firstRun.result.examined, 4, 'one look-ahead row proves more bounded work remains');
    assertEqual(firstRun.result.hasMore, true, 'the action reports another bounded batch');
    assert(
      firstRun.result.nowMs >= firstRun.dueAtMs
        && firstRun.result.nowMs - firstRun.dueAtMs < 60_000,
      'handler sampled one runtime clock within the claimed one-minute slot',
    );
  });

  await suite.check('the scheduled commit is delivered to the live subscription', async () => {
    await recorder.waitFor(
      (rows) => rows.filter(({ status }) => status === 'expired').length === 4,
      'live expiry status update',
    );
    assertEqual(
      expiryLive.rows.filter(({ status }) => status === 'expired').length,
      4,
      'three newly expired rows join the pre-expired row',
    );
    assert(
      recorder.updates.some(({ kind, rows }) => (
        kind !== null && rows.filter(({ status }) => status === 'expired').length === 4
      )),
      'the subscribed stream delivered the changed projection',
    );
  });

  await suite.check('run-now simulates the next scheduled bounded batch', async () => {
    const retry = await expiryAdmin.runCronJob('expireLinks');
    assertEqual(retry.outcome, 'Succeeded', 'manual continuation succeeds');
    assertEqual(retry.result.changed, 1, 'continuation changes only the remaining due row');
    assertEqual(retry.result.hasMore, false, 'continuation catches the projection up');
  });

  await suite.check('repeating a caught-up sweep is idempotent', async () => {
    const before = await expiryDb.query('linksByExpiry', {});
    const repeated = await expiryAdmin.runCronJob('expireLinks');
    const after = await expiryDb.query('linksByExpiry', {});
    assertEqual(repeated.outcome, 'Succeeded', 'repeat succeeds');
    assertEqual(repeated.result.changed, 0, 'repeat changes no rows');
    assertEqual(repeated.result.hasMore, false, 'repeat finds no queued batch');
    assertEqual(after.rows, before.rows, 'stored projection is unchanged');
  });
}, { cleanups });
