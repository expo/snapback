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

  live.dispose();
  client.liveStreamManager('cron-recovery').close();
  console.log('cloudflare cron-recovery acceptance: after-claim, during-action, and pre-finish faults recover without double commit');
} finally {
  await proof.dispose();
  server.close();
}
