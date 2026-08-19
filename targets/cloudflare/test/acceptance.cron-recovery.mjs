// ENG-24348 / ENG-24500: recover a scheduled slot after interruption at all
// four durability boundaries, including commit-before-claim-finish and the
// statement immediately after terminal claim update, without a second
// durable commit or a missing run summary.
import http from 'node:http';
import fs from 'node:fs';
import { startProof, ADMIN_TOKEN, proxyOutboundTo } from './harness.mjs';
import { SnapbackClient } from '../../../demos/_kit/client.mjs';
import { bindingNameFor } from '../config-set.mjs';
import { cloudflareClientOptions } from '../client-options.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../../../demos/all-aboard/snapback/seed.json', import.meta.url), 'utf8'));
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
    SNAPBACK_TEST_FEED_URL: 'https://upstream.example/transit/StopMonitoring',
    SNAPBACK_TEST_CRON_STOP_AFTER_CLAIM: '1',
    SNAPBACK_TEST_CRON_INTERRUPT_DURING_ACTION: '1',
    SNAPBACK_TEST_CRON_STOP_BEFORE_FINISH: '1',
    SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE: '1',
  },
  outboundService: proxyOutboundTo(origin),
});

try {
  const base = await proof.url();
  const client = new SnapbackClient(base, cloudflareClientOptions({ adminToken: ADMIN_TOKEN }));
  const post = async (path) => {
    const response = await fetch(`${base}${path}`, { method: 'POST' });
    return response.json();
  };
  const claims = () => post('/_snapback/test/cron-claims');
  const retry = async () => {
    await post('/_snapback/test/expire-cron-claims');
    await post('/_snapback/test/alarm');
    return claims();
  };

  await client.ensureApp({ seed });
  const before = await client.query('feedState', {});
  const live = await client.liveQuery('liveTrainStatus', { connectionId: 'cron-recovery', transport: 'stream' });

  // The initial due alarm claims and stops before action execution.
  let state = await claims();
  if (state.claims.length === 0) {
    await post('/_snapback/test/alarm');
    state = await claims();
  }
  if (Number(state.claims[0]?.attempt) !== 1 || fetches !== 0) {
    throw new Error(`after-claim fault did not preserve a recoverable claim: ${JSON.stringify(state)}`);
  }

  // Retention is terminal-only. Even after its ownership lease expires and
  // the simulated pruning clock crosses the full retention window, a claimed
  // slot is recoverable work and must survive for the next attempt.
  await post('/_snapback/test/expire-cron-claims');
  await post('/_snapback/test/prune-cron-claims');
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
  await post('/_snapback/test/prune-cron-claims');
  state = await claims();
  if (
    state.claims.length !== 1 ||
    state.claims[0]?.state !== 'claimed' ||
    Number(state.claims[0]?.attempt) !== 3 ||
    state.mutationResults !== activeMutationResults
  ) {
    throw new Error(`retention pruned active claim replay authority: ${JSON.stringify(state)}`);
  }

  // Retry 4 replays those recorded mutation results and reaches terminal
  // claim update, then faults at the exact old split-write boundary. The
  // enclosing transaction must roll the terminal state back together with
  // the absent run summary and nominal advance.
  state = await retry();
  const afterTerminalFault = await client.query('feedState', {});
  const statusAfterTerminalFault = (await (await fetch(`${base}/_snapback/api/cron/status`)).json()).jobs[0];
  if (
    state.claims[0]?.state !== 'claimed' ||
    Number(state.claims[0]?.attempt) !== 4 ||
    statusAfterTerminalFault.lastRun !== null
  ) {
    throw new Error(
      `post-terminal fault did not roll back claim + run summary atomically: ${JSON.stringify({ state, statusAfterTerminalFault })}`,
    );
  }
  if (
    afterTerminalFault.version !== committedVersion ||
    JSON.stringify(afterTerminalFault.rows) !== JSON.stringify(committed.rows)
  ) {
    throw new Error(`post-terminal fault double-committed: ${JSON.stringify({ committed, afterTerminalFault })}`);
  }

  // Retry 5 finishes all scheduler bookkeeping in one transaction. It may
  // repeat at-least-once egress, but the app state is unchanged and exactly
  // one observable last-run summary exists for the one terminal claim.
  state = await retry();
  const finished = await client.query('feedState', {});
  const finishedStatus = (await (await fetch(`${base}/_snapback/api/cron/status`, {
    headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
  })).json()).jobs[0];
  if (state.claims[0]?.state !== 'done' || Number(state.claims[0]?.attempt) !== 5) {
    throw new Error(`recovered claim did not become terminal: ${JSON.stringify(state)}`);
  }
  if (
    !finishedStatus.lastRun ||
    finishedStatus.lastRun.runId !== String(state.claims[0].run_id) ||
    finishedStatus.lastRun.outcome !== 'ok'
  ) {
    throw new Error(`terminal claim does not have exactly one matching run summary: ${JSON.stringify({ state, finishedStatus })}`);
  }
  if (finished.version !== committedVersion || JSON.stringify(finished.rows) !== JSON.stringify(committed.rows)) {
    throw new Error(`post-commit recovery double-committed: ${JSON.stringify({ committed, finished })}`);
  }

  // Once the same slot is terminal, crossing the retention window removes
  // both the claim and its commit-coupled nested-mutation replay rows.
  await post('/_snapback/test/prune-cron-claims');
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

// Focused ENG-24500 proof: one action mutation commits exactly once, the
// injected post-terminal fault leaves no partial run summary/nominal, and the
// retry publishes one terminal claim + one matching summary atomically.
const atomicFinish = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: { SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE: '1' },
});
try {
  const base = await atomicFinish.url();
  const client = new SnapbackClient(base, cloudflareClientOptions({ adminToken: ADMIN_TOKEN }));
  const postJson = async (path, body = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  };
  await client.ensureApp({ seed });
  const before = await client.query('feedState', {});
  const scheduledAtMs = Date.now();
  const first = await postJson('/_snapback/test/run-cron', {
    job: 'warmPoll',
    trigger: 'scheduled',
    scheduledAtMs,
    actionOverride: 'probeNestedTimeout',
  });
  const afterFirst = await client.query('feedState', {});
  let recovery = await postJson('/_snapback/test/cron-claims');
  const statusAfterFault = (await (await fetch(`${base}/_snapback/api/cron/status`)).json()).jobs[0];
  if (
    first.interruptedAfterTerminalUpdate !== true ||
    afterFirst.version !== before.version + 1 ||
    recovery.claims.length !== 1 ||
    recovery.claims[0].state !== 'claimed' ||
    recovery.mutationResults !== 1 ||
    recovery.cronState.length !== 0 ||
    statusAfterFault.lastRun !== null
  ) {
    throw new Error(
      `post-terminal transaction fault leaked partial completion: ${JSON.stringify({ before, first, afterFirst, recovery, statusAfterFault })}`,
    );
  }

  await postJson('/_snapback/test/expire-cron-claims');
  const second = await postJson('/_snapback/test/run-cron', {
    job: 'warmPoll',
    trigger: 'scheduled',
    scheduledAtMs,
    actionOverride: 'probeNestedTimeout',
  });
  const afterRetry = await client.query('feedState', {});
  recovery = await postJson('/_snapback/test/cron-claims');
  const statusAfterRetry = (await (await fetch(`${base}/_snapback/api/cron/status`, {
    headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
  })).json()).jobs[0];
  const stored = recovery.cronState[0];
  if (
    second.outcome !== 'ok' ||
    afterRetry.version !== afterFirst.version ||
    recovery.claims.length !== 1 ||
    recovery.claims[0].state !== 'done' ||
    Number(recovery.claims[0].attempt) !== 2 ||
    recovery.mutationResults !== 1 ||
    recovery.cronState.length !== 1 ||
    String(stored.last_run_id) !== second.runId ||
    Number(stored.next_nominal_at_ms) <= scheduledAtMs ||
    statusAfterRetry.lastRun?.runId !== second.runId
  ) {
    throw new Error(
      `atomic retry did not preserve one commit + one run record: ${JSON.stringify({ second, afterFirst, afterRetry, recovery, statusAfterRetry })}`,
    );
  }
  console.log('cloudflare cron atomic-finish acceptance: one app commit and one run record survive post-terminal fault');
} finally {
  await atomicFinish.dispose();
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
    SNAPBACK_TEST_FEED_URL: 'https://upstream.example/held',
    SNAPBACK_ACTION_TIMEOUT_MS: '5000',
  },
  outboundService: proxyOutboundTo(`http://127.0.0.1:${heldServer.address().port}`),
});
try {
  const base = await resetRace.url();
  const client = new SnapbackClient(base, cloudflareClientOptions({ adminToken: ADMIN_TOKEN }));
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
    const run = postJson('/_snapback/test/run-cron', { job: 'warmPoll', trigger });
    await waitForArrival(index + 1);
    const reset = await resetRace.reset();
    const outcome = await run;
    if (!reset.reset || outcome.resetAbandoned !== true || outcome.outcome !== 'reset') {
      throw new Error(`${trigger} cron/reset race did not abandon cleanly: ${JSON.stringify({ reset, outcome })}`);
    }
    const status = (await (await fetch(`${base}/_snapback/api/cron/status`)).json()).jobs[0];
    const recovery = await postJson('/_snapback/test/cron-claims');
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
  // The fixture intentionally never answers its held requests. Close the
  // listening server and destroy those sockets so the outbound-service proxy
  // cannot leave the canonical Node test process alive after assertions pass.
  await new Promise((resolve) => {
    heldServer.close(resolve);
    heldServer.closeAllConnections();
  });
}
