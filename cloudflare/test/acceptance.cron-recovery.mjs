// ENG-24348: recover a scheduled slot after interruption at all three
// durability boundaries, including commit-before-claim-finish, without a
// second durable commit.
import http from 'node:http';
import fs from 'node:fs';
import { startProof, ADMIN_TOKEN } from './harness.mjs';
import { SnapbackClient } from '../../demos/_kit/client.mjs';
import { bindingNameFor } from '../config-set.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../../demos/all-aboard/snapback/seed.json', import.meta.url), 'utf8'));
let fetches = 0;
const server = http.createServer((_request, response) => {
  fetches += 1;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ServiceDelivery: { StopMonitoringDelivery: { MonitoredStopVisit: [] } } }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const proof = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: {
    [bindingNameFor('all-aboard', 'caltrainFeed')]: JSON.stringify(['cron-recovery-key']),
    SNAPBACK_CONFIG_GENERATION: '1',
    SNAPBACK_CRON_INTERVAL_OVERRIDE_MS: '60000',
    SNAPBACK_CRON_CLAIM_LEASE_MS: '60000',
    SNAPBACK_TEST_FEED_URL: `${origin}/transit/StopMonitoring`,
    SNAPBACK_TEST_CRON_STOP_AFTER_CLAIM: '1',
    SNAPBACK_TEST_CRON_INTERRUPT_DURING_ACTION: '1',
    SNAPBACK_TEST_CRON_STOP_BEFORE_FINISH: '1',
  },
});

try {
  const base = await proof.url();
  const client = new SnapbackClient(base, { adminToken: ADMIN_TOKEN });
  const post = async (path) => {
    const response = await fetch(`${base}${path}`, { method: 'POST' });
    return response.json();
  };
  const claims = () => post('/__test/cron-claims');
  const retry = async () => {
    await post('/__test/expire-cron-claims');
    await post('/__test/alarm');
    return claims();
  };

  await client.ensureApp({ seed });
  const before = await client.query('feedState', {});
  const live = await client.liveQuery('liveTrainStatus', { connectionId: 'cron-recovery', transport: 'stream' });

  // The initial due alarm claims and stops before action execution.
  let state = await claims();
  if (state.claims.length === 0) {
    await post('/__test/alarm');
    state = await claims();
  }
  if (Number(state.claims[0]?.attempt) !== 1 || fetches !== 0) {
    throw new Error(`after-claim fault did not preserve a recoverable claim: ${JSON.stringify(state)}`);
  }

  // Retention is terminal-only. Even after its ownership lease expires and
  // the simulated pruning clock crosses the full retention window, a claimed
  // slot is recoverable work and must survive for the next attempt.
  await post('/__test/expire-cron-claims');
  await post('/__test/prune-cron-claims');
  state = await claims();
  if (
    state.claims.length !== 1 ||
    state.claims[0]?.state !== 'claimed' ||
    Number(state.claims[0]?.lease_expires_at_ms) !== 0 ||
    Number(state.claims[0]?.attempt) !== 1
  ) {
    throw new Error(`retention pruned an expired recoverable claim: ${JSON.stringify(state)}`);
  }

  // Retry 2 enters the action and is interrupted at its first nested
  // mutation, before fetch or commit.
  state = await retry();
  const afterDuring = await client.query('feedState', {});
  if (Number(state.claims[0]?.attempt) !== 2 || fetches !== 0 || afterDuring.version !== before.version) {
    throw new Error(`during-action interruption changed state: ${JSON.stringify({ state, fetches, before, afterDuring })}`);
  }

  // Retry 3 completes both nested mutations, then stops before the scheduler
  // marks the claim terminal. The action-mutation ledger is atomically
  // coupled to those commits.
  state = await retry();
  const committed = await client.query('feedState', {});
  if (Number(state.claims[0]?.attempt) !== 3 || state.claims[0]?.state !== 'claimed' || committed.version <= before.version) {
    throw new Error(`pre-finish fault did not leave a committed/recoverable attempt: ${JSON.stringify({ state, committed })}`);
  }
  const committedVersion = committed.version;
  if (state.mutationResults < 2) throw new Error('nested mutation results were not durably recorded with their commits');
  const activeMutationResults = state.mutationResults;

  // The replay rows are part of the active claim's recoverable authority, not
  // terminal history. Crossing the retention horizon after commit but before
  // claim finish must preserve both the claim and every recorded nested result.
  await post('/__test/prune-cron-claims');
  state = await claims();
  if (
    state.claims.length !== 1 ||
    state.claims[0]?.state !== 'claimed' ||
    Number(state.claims[0]?.attempt) !== 3 ||
    state.mutationResults !== activeMutationResults
  ) {
    throw new Error(`retention pruned active claim replay authority: ${JSON.stringify(state)}`);
  }

  // Retry 4 replays those recorded mutation results and finishes the claim;
  // it may repeat at-least-once egress, but must never commit app state twice.
  state = await retry();
  const finished = await client.query('feedState', {});
  if (state.claims[0]?.state !== 'done' || Number(state.claims[0]?.attempt) !== 4) {
    throw new Error(`recovered claim did not become terminal: ${JSON.stringify(state)}`);
  }
  if (finished.version !== committedVersion || JSON.stringify(finished.rows) !== JSON.stringify(committed.rows)) {
    throw new Error(`post-commit recovery double-committed: ${JSON.stringify({ committed, finished })}`);
  }

  // Once the same slot is terminal, crossing the retention window removes
  // both the claim and its commit-coupled nested-mutation replay rows.
  await post('/__test/prune-cron-claims');
  state = await claims();
  if (state.claims.length !== 0 || state.mutationResults !== 0) {
    throw new Error(`terminal claim retention did not prune claim and replay rows together: ${JSON.stringify(state)}`);
  }

  live.dispose();
  client.liveStreamManager('cron-recovery').close();
  console.log('cloudflare cron-recovery acceptance: faults recover without double commit and retention preserves active work only');
} finally {
  await proof.dispose();
  server.close();
}

// A scheduler attempt finishing after app.reset must not recreate the claim,
// last-run summary, or nominal state that reset just erased. Exercise both the
// recoverable scheduled path and ordinary manual run-now while host fetch is
// held across the reset linearization point.
let heldArrivals = 0;
const arrivalWaiters = [];
const heldServer = http.createServer((_request, _response) => {
  heldArrivals += 1;
  while (arrivalWaiters.length > 0 && arrivalWaiters[0].target <= heldArrivals) {
    arrivalWaiters.shift().resolve();
  }
});
await new Promise((resolve) => heldServer.listen(0, '127.0.0.1', resolve));
const waitForArrival = (target) => {
  if (heldArrivals >= target) return Promise.resolve();
  return new Promise((resolve) => arrivalWaiters.push({ target, resolve }));
};
const resetRace = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: {
    [bindingNameFor('all-aboard', 'caltrainFeed')]: JSON.stringify(['cron-reset-key']),
    SNAPBACK_CONFIG_GENERATION: '1',
    SNAPBACK_TEST_FEED_URL: `http://127.0.0.1:${heldServer.address().port}/held`,
    SNAPBACK_ACTION_TIMEOUT_MS: '5000',
  },
});
try {
  const base = await resetRace.url();
  const client = new SnapbackClient(base, { adminToken: ADMIN_TOKEN });
  await client.ensureApp({ seed });
  const postJson = async (path, body = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  };
  for (const [index, trigger] of ['scheduled', 'manual'].entries()) {
    const run = postJson('/__test/run-cron', { job: 'warmPoll', trigger });
    await waitForArrival(index + 1);
    const reset = await resetRace.reset();
    const outcome = await run;
    if (!reset.reset || outcome.resetAbandoned !== true || outcome.outcome !== 'reset') {
      throw new Error(`${trigger} cron/reset race did not abandon cleanly: ${JSON.stringify({ reset, outcome })}`);
    }
    const status = (await (await fetch(`${base}/cron/status`)).json()).jobs[0];
    const recovery = await postJson('/__test/cron-claims');
    if (
      status.lastRun !== null ||
      status.nextRun !== null ||
      status.activation.state !== 'inactive:no-demand' ||
      recovery.claims.length !== 0 ||
      recovery.mutationResults !== 0
    ) {
      throw new Error(`${trigger} cron completion contaminated post-reset scheduler state: ${JSON.stringify({ status, recovery })}`);
    }
  }
  console.log('cloudflare cron-reset acceptance: held scheduled and manual runs cannot recreate state after reset');
} finally {
  await resetRace.dispose();
  heldServer.close();
}
