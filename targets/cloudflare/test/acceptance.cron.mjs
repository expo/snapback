// LLP 0049 Phase 3 Miniflare acceptance: demand-gated warm polling on the
// hardened Durable Object alarm runner.
//
// Exit evidence: with an active live subscription a scheduled warm poll
// fetches (mock 511), commits, records the ledger, and pushes a live update;
// with no active subscription no alarm is armed and no external fetch
// happens; a duplicate wakeup for an already-claimed slot does not
// double-fetch or double-commit; eviction/rehydration preserves activation,
// armed-alarm state, and the cron ledger; and the implementation uses no
// interval timer (the alarm is the only wakeup source — asserted by the
// no-demand fetch counter staying flat).
//
// Run: node targets/cloudflare/test/acceptance.cron.mjs
import http from 'node:http';
import fs from 'node:fs';
import { startProof, ADMIN_TOKEN, proxyOutboundTo } from './harness.mjs';
import { SnapbackClient } from '../../../demos/_kit/client.mjs';
import { bindingNameFor } from '../config-set.mjs';
import { cloudflareClientOptions } from '../client-options.mjs';

const FEED_KEY = 'test-511-key-cron';
const WARM_POLL_MS = 1200;
const seed = JSON.parse(fs.readFileSync(new URL('../../../demos/all-aboard/snapback/seed.json', import.meta.url), 'utf8'));

const EXPECTED_CHECKS = 13;
let checks = 0;
function check(label, condition, detail) {
  checks += 1;
  if (!condition) {
    throw new Error(`ACCEPTANCE FAILED [${label}]${detail ? ` — ${detail}` : ''}`);
  }
  console.log(`ok ${checks} - ${label}`);
}

function siriBody() {
  const base = Date.now() + 10 * 60 * 1000;
  return {
    ServiceDelivery: {
      StopMonitoringDelivery: {
        MonitoredStopVisit: [
          {
            MonitoredVehicleJourney: {
              LineRef: 'Local',
              DestinationName: 'San Francisco',
              MonitoredCall: {
                StopPointName: 'Palo Alto Caltrain',
                AimedDepartureTime: new Date(base).toISOString(),
                ExpectedDepartureTime: new Date(base + 3 * 60 * 1000).toISOString(),
              },
            },
          },
        ],
      },
    },
  };
}

function startMock511() {
  const seen = { fetches: 0 };
  const server = http.createServer((req, res) => {
    seen.fetches += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(siriBody()));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}`, seen });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const mock = await startMock511();
  const proof = await startProof({
    app: 'all-aboard',
    port: 0,
    bindings: {
      [bindingNameFor('all-aboard', 'caltrainFeed')]: JSON.stringify([FEED_KEY]),
      SNAPBACK_CONFIG_GENERATION: '1',
      SNAPBACK_CRON_INTERVAL_OVERRIDE_MS: String(WARM_POLL_MS),
      // Route the warm poll's 511 fetch at the mock (the handler honors a
      // loopback feedUrl arg only from callers; cron runs use the real URL —
      // so the test points the real URL override at the mock instead).
      SNAPBACK_TEST_FEED_URL: 'https://upstream.example/transit/StopMonitoring',
    },
    outboundService: proxyOutboundTo(mock.origin),
  });
  const base = await proof.url();
  const client = new SnapbackClient(base, cloudflareClientOptions({ adminToken: ADMIN_TOKEN }));
  const cronStatus = async () => (await (await fetch(`${base}/_snapback/api/cron/status`)).json()).jobs[0];
  try {
    await client.ensureApp({ seed });

    // --- idle: no subscribers => no alarm, no fetch ------------------------
    const idle = await cronStatus();
    check(
      'with no live subscription the job is inactive:no-demand with no next run',
      idle.activation.state === 'inactive:no-demand' && idle.nextRun === null && idle.wakeup === 'durable-object-alarm'
    );
    await sleep(WARM_POLL_MS * 2.5);
    check('an idle deployment takes zero warm-poll wakeups (no external fetch)', mock.seen.fetches === 0);

    // --- manual run trigger is admin-gated ---------------------------------
    const ungated = await fetch(`${base}/_snapback/api/cron/run`, { method: 'POST', body: JSON.stringify({ job: 'warmPoll' }) });
    check('the manual run trigger is admin-gated (no public run-now route)', ungated.status === 403);
    const manual = await (
      await fetch(`${base}/_snapback/api/cron/run`, {
        method: 'POST',
        headers: { 'x-snapback-admin-token': ADMIN_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ job: 'warmPoll' }),
      })
    ).json();
    const afterManual = await cronStatus();
    const manualRecoveryState = await (
      await fetch(`${base}/_snapback/test/cron-claims`, { method: 'POST' })
    ).json();
    check(
      'an admin manual run executes without allocating recoverable claim/replay rows',
      manual.ok === true &&
        manual.outcome === 'ok' &&
        afterManual.lastRun.trigger === 'manual' &&
        afterManual.lastRun.outcome === 'ok' &&
        afterManual.lastRun.durationMs >= 0 &&
        mock.seen.fetches === 1 &&
        manualRecoveryState.claims.length === 0 &&
        manualRecoveryState.mutationResults === 0
    );

    // --- subscribe arms the alarm; scheduled runs fetch+commit+push -------
    const connectionId = 'cron-conn';
    const live = await client.liveQuery('liveTrainStatus', { connectionId, transport: 'stream' });
    const armed = await cronStatus();
    check('subscribing to liveTrainStatus arms the durable alarm', armed.activation.state === 'armed' && armed.nextRun !== null);

    const liveVersionBefore = live.version;
    const fetchesBefore = mock.seen.fetches;
    const scheduledDeadline = Date.now() + WARM_POLL_MS * 6;
    while (Date.now() < scheduledDeadline) {
      const status = await cronStatus();
      if (status.lastRun && status.lastRun.trigger === 'scheduled' && status.lastRun.outcome === 'ok') break;
      await sleep(120);
    }
    const scheduled = await cronStatus();
    check(
      'a scheduled warm-poll run fetches and records the ledger (trigger scheduled, outcome ok)',
      scheduled.lastRun.trigger === 'scheduled' && scheduled.lastRun.outcome === 'ok' && mock.seen.fetches > fetchesBefore
    );
    const pushDeadline = Date.now() + 4000;
    while (live.version <= liveVersionBefore && Date.now() < pushDeadline) {
      await sleep(50);
    }
    const feedState = await client.query('feedState', {});
    const departures = await client.query('liveDepartures', {});
    check(
      'the scheduled run commits the live snapshot and pushes to the subscriber',
      live.version > liveVersionBefore &&
        feedState.rows[0].lastSource === '511-siri-stop-monitoring' &&
        departures.rows.length === 1 &&
        departures.rows[0].stationId === 'palo-alto'
    );

    // --- duplicate wakeup / alarm retry for a claimed slot ----------------
    const claimedSlotFetches = mock.seen.fetches;
    // Fire the dispatcher directly twice in a row: the second firing sees
    // the slot already claimed (or nothing due) and must not double-fetch.
    await fetch(`${base}/_snapback/test/alarm`, { method: 'POST' });
    const afterFirst = mock.seen.fetches;
    await fetch(`${base}/_snapback/test/alarm`, { method: 'POST' });
    const afterSecond = mock.seen.fetches;
    check(
      'a duplicate wakeup for an already-claimed slot does not double-fetch or double-commit',
      afterSecond - afterFirst === 0 || afterFirst - claimedSlotFetches === 0
    );

    // --- eviction/rehydration preserves activation + ledger + alarm -------
    await proof.evict();
    const rehydrated = await cronStatus();
    check(
      'eviction/rehydration preserves activation, armed-alarm state, and the cron ledger',
      rehydrated.activation.state === 'armed' && rehydrated.nextRun !== null && rehydrated.lastRun !== null
    );
    const fetchesBeforePostEvict = mock.seen.fetches;
    const versionBeforePostEvict = live.version;
    const postEvictDeadline = Date.now() + WARM_POLL_MS * 6;
    while (mock.seen.fetches <= fetchesBeforePostEvict && Date.now() < postEvictDeadline) {
      await sleep(120);
    }
    check('scheduled warm polling continues after eviction (alarm survives in storage)', mock.seen.fetches > fetchesBeforePostEvict);

    // --- last-unsubscribe cancels; idle again takes zero wakeups ----------
    live.dispose();
    client.liveStreamManager(connectionId).close();
    const disarmDeadline = Date.now() + 4000;
    for (;;) {
      const status = await cronStatus();
      if (status.activation.state === 'inactive:no-demand') break;
      if (Date.now() > disarmDeadline) throw new Error('job never disarmed after last unsubscribe');
      await sleep(100);
    }
    check('losing the last subscriber cancels the alarm (inactive:no-demand)', true);
    const idleFetches = mock.seen.fetches;
    await sleep(WARM_POLL_MS * 2.5);
    check('the idle deployment takes zero warm-poll wakeups after disarm', mock.seen.fetches === idleFetches);

    // --- startup refusal skips a due alarm but preserves its wakeup --------
    // Install demand without running activation reconciliation, so Miniflare
    // cannot launch a platform alarm concurrently with this direct probe.
    await proof.raw('/_snapback/test/schema-hardening', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'insert-legacy-subscription',
        subscriptionId: 'startup-refusal-demand',
        connectionId: 'startup-refusal-demand',
        functionName: 'liveTrainStatus',
        argsJson: '{}',
      }),
    });
    const fetchesBeforeRefusal = mock.seen.fetches;
    const corrupt = await proof.corruptMeta({
      schemaHash: 'stale-all-aboard-app-v0',
      forceAlarmDue: true,
      fireAlarm: true,
    });
    check(
      'startup refusal skips due alarm work and re-arms the platform wakeup',
      corrupt.body.startupError?.code === 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH' &&
        corrupt.status === 200 &&
        mock.seen.fetches === fetchesBeforeRefusal &&
        Number(corrupt.body.alarmAtMs) > Date.now(),
      JSON.stringify({ corrupt, fetchesBeforeRefusal, fetchesAfter: mock.seen.fetches })
    );
    await proof.reset();

    if (checks !== EXPECTED_CHECKS) {
      throw new Error(`expected ${EXPECTED_CHECKS} checks, ran ${checks}`);
    }
    console.log(`\ncloudflare cron acceptance: ${checks}/${EXPECTED_CHECKS} checks passed`);
  } finally {
    await proof.dispose();
    mock.server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
