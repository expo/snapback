// LLP 0049 Phase 2 Miniflare acceptance: Cloudflare action egress via
// host-mediated fetch, and the generated client.action transport.
//
// Exit evidence: a configured caltrainFeed key reaches a mocked
// 511-compatible endpoint through COORDINATOR query-param substitution and
// commits through applyLiveFeedSnapshot with
// lastSource '511-siri-stop-monitoring' (an applyFeedTick fallback does not
// satisfy this); a configured directions key reaches a mocked directions
// endpoint through COORDINATOR header substitution; generated client.action
// reaches the gateway action route for both actions; a deliberately slow
// action fetch blocks no concurrent query/mutation/live push; query/mutation
// ambient fetch stays denied; and forced 401/429/network failures are
// actionable and key-redacted in handler-visible errors, the durable
// feedRefreshState.lastError row, and status surfaces.
//
// Run: node cloudflare/test/acceptance.egress.mjs
import http from 'node:http';
import fs from 'node:fs';
import { startProof, ADMIN_TOKEN, proxyOutboundTo } from './harness.mjs';
import { SnapbackClient } from '../../demos/_kit/client.mjs';
import { bindingNameFor } from '../config-set.mjs';
import { cloudflareClientOptions } from '../client-options.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../../demos/all-aboard/snapback/seed.json', import.meta.url), 'utf8'));

const FEED_KEY = 'test-511-key-alpha';
const DIRECTIONS_KEY = 'test-ors-key-omega';
const AUTHORED_ORIGIN = 'https://upstream.example';
const SECRET_BINDINGS = {
  [bindingNameFor('all-aboard', 'caltrainFeed')]: JSON.stringify([FEED_KEY]),
  [bindingNameFor('all-aboard', 'directions')]: JSON.stringify([DIRECTIONS_KEY]),
  SNAPBACK_CONFIG_GENERATION: '1',
};

const EXPECTED_CHECKS = 31;
let checks = 0;
function check(label, condition) {
  checks += 1;
  if (!condition) {
    throw new Error(`ACCEPTANCE FAILED [${label}]`);
  }
  console.log(`ok ${checks} - ${label}`);
}

function siriBody() {
  const base = Date.now() + 10 * 60 * 1000;
  const visit = (line, destination, delay, stopName = 'Palo Alto Caltrain') => ({
    MonitoredVehicleJourney: {
      LineRef: line,
      DestinationName: destination,
      MonitoredCall: {
        StopPointName: stopName,
        AimedDepartureTime: new Date(base).toISOString(),
        ExpectedDepartureTime: new Date(base + delay * 60 * 1000).toISOString(),
      },
    },
  });
  return {
    ServiceDelivery: {
      StopMonitoringDelivery: {
        MonitoredStopVisit: [
          visit('Local', 'San Francisco', 2),
          visit('Limited 300', 'San Jose Diridon', 1),
          visit('Baby Bullet 500', 'San Francisco', 3),
        ],
      },
    },
  };
}

// The mock upstream: asserts WHERE the key arrived (query param vs header —
// the coordinator's placement slots), and can force 401/429/slow modes. The
// 401 body deliberately echoes the presented key so redaction is tested
// against an upstream that leaks it back.
function startMockUpstream() {
  const seen = { feedKeys: [], directionAuths: [], streamRequests: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/transit/StopMonitoring') {
      const key = url.searchParams.get('api_key');
      seen.feedKeys.push(key);
      const mode = url.searchParams.get('mode');
      if (mode === '401') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `invalid api_key ${key}` }));
        return;
      }
      if (mode === '429') {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(siriBody()));
      return;
    }
    if (url.pathname.startsWith('/v2/directions/')) {
      seen.directionAuths.push(req.headers.authorization || null);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ features: [{ properties: { summary: { distance: 3218.7, duration: 2400 } } }] })
      );
      return;
    }
    if (url.pathname === '/slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ slept: true }));
      }, 2000);
      return;
    }
    if (url.pathname === '/stream-redirect') {
      res.writeHead(302, { location: '/stream' });
      res.end();
      return;
    }
    if (url.pathname === '/stream') {
      seen.streamRequests += 1;
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      let index = 0;
      const emit = () => {
        if (index === 8) {
          res.end();
          return;
        }
        res.write(Buffer.alloc(4096, index + 1));
        index += 1;
        setTimeout(emit, 25);
      };
      emit();
      return;
    }
    if (url.pathname === '/stream-large') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      for (let index = 0; index < 17; index += 1) res.write(Buffer.alloc(64 * 1024, index));
      res.end();
      return;
    }
    if (url.pathname === '/stream-stall') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.write(Buffer.alloc(1024, 7));
      const stall = setTimeout(() => res.end(), 8000);
      res.on('close', () => clearTimeout(stall));
      return;
    }
    if (url.pathname === '/stream-auth') {
      if (req.headers.authorization !== DIRECTIONS_KEY) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{"error":"missing or wrong authorization"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      for (let index = 0; index < 3; index += 1) res.write(Buffer.alloc(1024, index + 1));
      res.end();
      return;
    }
    if (url.pathname === '/stream-long') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      let index = 0;
      const interval = setInterval(() => {
        if (res.destroyed || index === 100) {
          clearInterval(interval);
          if (!res.destroyed) res.end();
          return;
        }
        res.write(Buffer.alloc(1024, index % 251));
        index += 1;
      }, 25);
      res.on('close', () => clearInterval(interval));
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}`, seen });
    });
  });
}

async function main() {
  const mock = await startMockUpstream();
  const proof = await startProof({
    app: 'all-aboard',
    port: 0,
    bindings: SECRET_BINDINGS,
    outboundService: proxyOutboundTo(mock.origin),
  });
  const base = await proof.url();
  const client = new SnapbackClient(base, cloudflareClientOptions({ adminToken: ADMIN_TOKEN }));
  try {
    await client.ensureApp({ seed });

    // --- live 511 path through coordinator query-param substitution -------
    const feedUrl = `${AUTHORED_ORIGIN}/transit/StopMonitoring`;
    const refresh = await client.action('refreshFeed', { args: { trigger: 'manual', feedUrl } });
    check('client.action reaches the gateway action route for refreshFeed', refresh.ok === true && refresh.kind === 'Action');
    check(
      'the configured caltrainFeed key arrived as the api_key query parameter (coordinator placement)',
      mock.seen.feedKeys.length === 1 && mock.seen.feedKeys[0] === FEED_KEY
    );
    check(
      'the live snapshot committed through applyLiveFeedSnapshot with the live source stamp',
      refresh.result.source === '511-siri-stop-monitoring' && refresh.result.patterns.length > 0
    );
    const feedState = await client.query('feedState', {});
    const departures = await client.query('liveDepartures', {});
    check(
      'durable feed state is labeled live (not recorded/fallback)',
      feedState.rows[0].lastSource === '511-siri-stop-monitoring' &&
        feedState.rows[0].lastError === '' &&
        departures.rows.length === 3 &&
        departures.rows.every((row) => row.stationId === 'palo-alto' && row.predictedDepartureMs > Date.now())
    );

    // --- upstream-poll budget on the deployed engine (ENG-23730) ----------
    // The scheduled-run path bypasses the budget under SNAPBACK_TESTING
    // (the coordinator injects pollBudgetMs = 0 so the cron suite can use
    // synthetic cadences), so this is the miniflare-side proof that the
    // ENG-23642 claimFeedPoll budget actually gates the action route.
    const refreshAgain = await client.action('refreshFeed', { args: { trigger: 'manual', feedUrl } });
    check(
      'a second refresh inside the 180s budget answers updated-recently with no second upstream request',
      refreshAgain.ok === true &&
        refreshAgain.result.skipped === 'updated-recently' &&
        Number(refreshAgain.result.retryInMs) > 0 &&
        mock.seen.feedKeys.length === 1
    );
    // pollBudgetMs can only LOWER the window (claimFeedPoll clamps to the
    // production ceiling); a ~1s synthetic window proves expiry-then-refetch
    // without waiting out the real 180s budget.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const refreshExpired = await client.action('refreshFeed', {
      args: { trigger: 'manual', feedUrl, pollBudgetMs: 1200 },
    });
    check(
      'a refresh past the (test-lowered) budget window polls upstream again',
      refreshExpired.ok === true &&
        refreshExpired.result.skipped === undefined &&
        refreshExpired.result.source === '511-siri-stop-monitoring' &&
        mock.seen.feedKeys.length === 2
    );

    // --- directions path through coordinator header substitution ----------
    const versionBeforeRoute = (await client.query('feedState', {})).version;
    const route = await client.action('routeEstimate', {
      args: { fromLat: 37.77, fromLng: -122.39, toLat: 37.44, toLng: -122.16, mode: 'walk', baseUrl: `${AUTHORED_ORIGIN}/` },
    });
    check('client.action reaches the gateway action route for routeEstimate', route.ok === true);
    check(
      'the configured directions key arrived as the Authorization header (coordinator placement)',
      mock.seen.directionAuths.length === 1 && mock.seen.directionAuths[0] === DIRECTIONS_KEY
    );
    check(
      'routeEstimate returns the upstream estimate and commits nothing (writes: [])',
      route.result.source === 'openrouteservice' &&
        route.result.minutes === 40 &&
        (await client.query('feedState', {})).version === versionBeforeRoute
    );

    // --- a slow action fetch blocks nothing on the same coordinator -------
    const connectionId = 'egress-conn';
    const live = await client.liveQuery('liveTrainStatus', { connectionId, transport: 'stream' });
    const liveVersionBefore = live.version;
    const slow = client.action('probeSlowFetch', { args: { url: `${AUTHORED_ORIGIN}/slow` } });
    await new Promise((resolve) => setTimeout(resolve, 150)); // the slow fetch is in flight
    const t0 = Date.now();
    const during = await client.query('stationsQuery', {});
    const mutate = await client.mutate('applyFeedTick', { args: { trigger: 'during-slow', source: 'recorded' } });
    const concurrentMs = Date.now() - t0;
    const pushDeadline = Date.now() + 4000;
    while (live.version <= liveVersionBefore && Date.now() < pushDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    check(
      'a deliberately slow action fetch does not block a concurrent query, mutation, or live push',
      during.rows.length === 21 && mutate.changed_count > 0 && live.version > liveVersionBefore && concurrentMs < 1500
    );
    const slowOutcome = await slow;
    check('the slow action itself completes after the concurrent work', slowOutcome.ok === true && slowOutcome.result.status === 200);

    // --- bounded response stream uses the same authored action surface ----
    const streamed = await client.action('probeResponseStream', {
      args: { url: `${AUTHORED_ORIGIN}/stream` },
    });
    check(
      'the Workerd action isolate pulls the complete response through ctx.fetchStream',
      streamed.ok === true && streamed.result.totalBytes === 8 * 4096 && streamed.result.reads >= 2
    );
    const refusedStreamDestination = await client.action('probeResponseStream', {
      args: { url: 'http://169.254.169.254/latest/meta-data' },
    });
    check(
      'ctx.fetchStream refuses a metadata IP literal before outbound fetch',
      refusedStreamDestination.ok === false &&
        refusedStreamDestination.diagnostic?.code === 'SNAPBACK_ACTION_STREAM_INVALID'
    );
    const streamRequestsBeforeRedirect = mock.seen.streamRequests;
    const refusedStreamRedirect = await client.action('probeResponseStream', {
      args: { url: `${AUTHORED_ORIGIN}/stream-redirect` },
    });
    check(
      'ctx.fetchStream uses manual redirects and does not fetch the Location target',
      refusedStreamRedirect.ok === false &&
        refusedStreamRedirect.diagnostic?.code === 'SNAPBACK_ACTION_STREAM_INVALID' &&
        mock.seen.streamRequests === streamRequestsBeforeRedirect
    );
    check(
      'every action-visible response chunk respects the 16 KiB v1 ceiling',
      streamed.result.maxChunkBytes > 0 && streamed.result.maxChunkBytes <= 16 * 1024
    );
    const tooLarge = await client.action('probeResponseStream', {
      args: { url: `${AUTHORED_ORIGIN}/stream-large` },
    });
    check(
      'the Cloudflare adapter refuses an upstream response beyond the 1 MiB v1 total',
      tooLarge.ok === false && tooLarge.diagnostic?.code === 'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED'
    );
    const cancelledStream = await client.action('probeResponseStream', {
      args: { url: `${AUTHORED_ORIGIN}/stream-long`, cancelAfterReads: 1 },
    });
    check(
      'response-stream cancellation is idempotent and makes the reader terminal',
      cancelledStream.ok === true &&
        cancelledStream.result.cancelled === true &&
        cancelledStream.result.reads === 1 &&
        cancelledStream.result.doneAfterCancel === true
    );
    const attemptToken = await client.action('probeStreamAttemptToken', {
      args: { url: `${AUTHORED_ORIGIN}/stream` },
    });
    check(
      'a stream attempt token is refused fail-closed on a target without the control plane',
      attemptToken.ok === true &&
        attemptToken.result.refused === true &&
        String(attemptToken.result.code).includes('SNAPBACK_ACTION_STREAM_INVALID')
    );
    const secretStream = await client.action('probeStreamSecret', {
      args: { url: `${AUTHORED_ORIGIN}/stream-auth` },
    });
    const secretStreamText = JSON.stringify(secretStream);
    check(
      'a stream secret slot resolves at the coordinator boundary and authenticates the upstream',
      secretStream.ok === true &&
        secretStream.result.status === 200 &&
        secretStream.result.totalBytes === 3 * 1024 &&
        secretStream.result.url === `${AUTHORED_ORIGIN}/stream-auth`
    );
    check(
      'the resolved stream secret never re-enters the isolate or the action result',
      !secretStreamText.includes(DIRECTIONS_KEY)
    );
    const rateFence = await client.action('probeStreamRateFence', {
      args: { url: `${AUTHORED_ORIGIN}/stream-long` },
    });
    check(
      'nested mutations above ten per second are refused while a cursor is open',
      rateFence.ok === true &&
        String(rateFence.result.secondCode).includes('SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED')
    );
    const cursorCap = await client.action('probeStreamCursorCap', {
      args: { url: `${AUTHORED_ORIGIN}/stream-long` },
    });
    check(
      'a fifth concurrent cursor is refused at the 4-cursor v1 cap',
      cursorCap.ok === true &&
        String(cursorCap.result.fifthCode).includes('SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED')
    );
    const idleStream = await client.action('probeResponseStream', {
      args: { url: `${AUTHORED_ORIGIN}/stream-stall` },
    });
    check(
      'a stalled upstream settles the exact idle-timeout code',
      idleStream.ok === false &&
        idleStream.diagnostic?.code === 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT'
    );
    // The stream probes above all DECLARE bounded_response_stream_v1 and ran,
    // which is the positive admission witness against the served manifest;
    // this is the negative twin: a known registry id the manifest does not
    // support refuses at function resolution, before the handler runs.
    let unsupported = null;
    try {
      await client.action('probeUnsupportedRequirement', { args: {} });
    } catch (error) {
      unsupported = error;
    }
    check(
      'a declared requirement the served manifest does not support is refused before the handler runs',
      unsupported !== null &&
        unsupported.status === 503 &&
        unsupported.diagnostic?.code === 'SNAPBACK_CAPABILITY_UNSUPPORTED'
    );
    // @ref LLP 0058#capability-maturity — since LLP 0076's acceptance
    // (2026-07-25) the stream capability is stable: the served manifest
    // claims plain support and must NOT annotate the id in the maturity map
    // (an entry there would re-demand acknowledgment the contract no longer
    // requires).
    const servedManifest = await (await fetch(`${base}/capability`)).json();
    check(
      'the served manifest claims plain stable support for bounded_response_stream_v1',
      servedManifest.supportedCapabilities?.includes('bounded_response_stream_v1') === true &&
        servedManifest.capabilityMaturity?.bounded_response_stream_v1 === undefined
    );

    // --- query/mutation ambient fetch remains denied -----------------------
    const probe = await client.query('probeAmbient', {});
    check(
      'query/mutation ambient fetch remains denied',
      probe.rows.find((entry) => entry.name === 'fetch').reachable === false
    );

    // --- forced failures: actionable, key-redacted diagnostics ------------
    // Each forced-failure leg clears the ENG-23642 one-poll-per-180s upstream
    // budget first (resetFeed zeroes lastUpstreamPollAt) so the leg exercises
    // the fetch path rather than the updated-recently guard.
    await client.mutate('resetFeed', {});
    const run401 = await client.action('refreshFeed', { args: { trigger: 'manual', feedUrl: `${feedUrl}?mode=401` } });
    const state401 = await client.query('feedState', {});
    const text401 = JSON.stringify([run401, state401.rows[0]]);
    check(
      'a forced 401 falls back to the recorded feed with an actionable, key-redacted lastError',
      run401.ok === true &&
        state401.rows[0].lastSource === 'recorded-fallback' &&
        /511 rejected the API key/.test(state401.rows[0].lastError) &&
        text401.includes('[redacted]') &&
        !text401.includes(FEED_KEY)
    );
    await client.mutate('resetFeed', {}); // clear the upstream-poll budget (ENG-23642)
    const run429 = await client.action('refreshFeed', { args: { trigger: 'manual', feedUrl: `${feedUrl}?mode=429` } });
    const state429 = await client.query('feedState', {});
    check(
      'a forced 429 is actionable (rate-limit guidance) and key-free',
      run429.ok === true &&
        /rate limit/.test(state429.rows[0].lastError) &&
        !JSON.stringify(state429.rows[0]).includes(FEED_KEY)
    );
    await client.mutate('resetFeed', {}); // clear the upstream-poll budget (ENG-23642)
    const runNetwork = await client.action('refreshFeed', {
      args: { trigger: 'manual', feedUrl: 'http://127.0.0.1:9/refused' },
    });
    const stateNetwork = await client.query('feedState', {});
    check(
      'a network failure is a structured fallback, never an unhandled crash',
      runNetwork.ok === true &&
        stateNetwork.rows[0].lastSource === 'recorded-fallback' &&
        stateNetwork.rows[0].lastError.length > 0 &&
        !JSON.stringify(stateNetwork.rows[0]).includes(FEED_KEY)
    );
    check(
      'fallback commits stay honestly labeled (recorded-fallback, not the live stamp)',
      stateNetwork.rows[0].lastSource !== '511-siri-stop-monitoring'
    );

    // --- config status still carries no key material after egress ---------
    const status = await (await fetch(`${base}/_snapback/api/config/status`, {
      headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
    })).json();
    check(
      'status JSON stays key-free after live egress',
      !JSON.stringify(status).includes(FEED_KEY) && !JSON.stringify(status).includes(DIRECTIONS_KEY)
    );

    live.dispose();
    client.liveStreamManager(connectionId).close();

    if (checks !== EXPECTED_CHECKS) {
      throw new Error(`expected ${EXPECTED_CHECKS} checks, ran ${checks}`);
    }
    console.log(`\ncloudflare egress acceptance: ${checks}/${EXPECTED_CHECKS} checks passed`);
  } finally {
    await proof.dispose();
    mock.server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
