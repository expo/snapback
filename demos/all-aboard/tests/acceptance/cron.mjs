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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const VALID_LIMITED_DELAYS = new Set([0, 60, 180, 240]);

const suite = createSuite('all-aboard cron (Phase 2)');
let server = null;
let db = null;

const forceTick = () => fetch(`${server.baseUrl}/_snapback/api/cron/tick`, { method: 'POST' }).then((r) => r.json());
const inspectJob = async () => {
  const state = await (await fetch(`${server.baseUrl}/inspect`)).json();
  return (state.cron?.jobs ?? []).find((j) => j.name === 'warmPoll') ?? null;
};
const activation = (job) => String(job?.activationState ?? '').toLowerCase();

// runAcceptance (ENG-22486) surfaces a setup throw and exits nonzero on a
// zero-check run — previously a pre-check failure here exited "PASS — 0/0".
await runAcceptance(suite, async () => {
  server = await startServer({ port: 4409, db: ':memory:', cwd: repoRoot });
  db = new SnapbackClient(server.baseUrl);

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
    assertEqual(state.lastSource, 'recorded', 'source is the recorded feed');
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
}, { cleanups: [() => server?.stop()] });
