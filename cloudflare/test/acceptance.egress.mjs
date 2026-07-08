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
import { startProof, ADMIN_TOKEN } from './harness.mjs';
import { SnapbackClient } from '../../demos/_kit/client.mjs';
import { bindingNameFor } from '../config-set.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../../demos/all-aboard/snapback/seed.json', import.meta.url), 'utf8'));

const FEED_KEY = 'test-511-key-alpha';
const DIRECTIONS_KEY = 'test-ors-key-omega';
const SECRET_BINDINGS = {
  [bindingNameFor('all-aboard', 'caltrainFeed')]: JSON.stringify([FEED_KEY]),
  [bindingNameFor('all-aboard', 'directions')]: JSON.stringify([DIRECTIONS_KEY]),
  SNAPBACK_CONFIG_GENERATION: '1',
};

const EXPECTED_CHECKS = 15;
let checks = 0;
function check(label, condition) {
  checks += 1;
  if (!condition) {
    throw new Error(`ACCEPTANCE FAILED [${label}]`);
  }
  console.log(`ok ${checks} - ${label}`);
}

function siriBody() {
  const visit = (line, destination, delay) => ({
    MonitoredVehicleJourney: {
      LineRef: line,
      DestinationName: destination,
      MonitoredCall: { AimedDepartureTime: '2026-07-07T10:00:00Z', ExpectedDepartureTime: `2026-07-07T10:0${delay}:00Z` },
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
  const seen = { feedKeys: [], directionAuths: [] };
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
  const proof = await startProof({ app: 'all-aboard', port: 0, bindings: SECRET_BINDINGS });
  const base = await proof.url();
  const client = new SnapbackClient(base, { adminToken: ADMIN_TOKEN });
  try {
    await client.ensureApp({ seed });

    // --- live 511 path through coordinator query-param substitution -------
    const feedUrl = `${mock.origin}/transit/StopMonitoring`;
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
    check(
      'durable feed state is labeled live (not recorded/fallback)',
      feedState.rows[0].lastSource === '511-siri-stop-monitoring' && feedState.rows[0].lastError === ''
    );

    // --- directions path through coordinator header substitution ----------
    const versionBeforeRoute = (await client.query('feedState', {})).version;
    const route = await client.action('routeEstimate', {
      args: { fromLat: 37.77, fromLng: -122.39, toLat: 37.44, toLng: -122.16, mode: 'walk', baseUrl: `${mock.origin}/` },
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
    const slow = client.action('probeSlowFetch', { args: { url: `${mock.origin}/slow` } });
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

    // --- query/mutation ambient fetch remains denied -----------------------
    const probe = await client.query('probeAmbient', {});
    check(
      'query/mutation ambient fetch remains denied',
      probe.rows.find((entry) => entry.name === 'fetch').reachable === false
    );

    // --- forced failures: actionable, key-redacted diagnostics ------------
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
    const run429 = await client.action('refreshFeed', { args: { trigger: 'manual', feedUrl: `${feedUrl}?mode=429` } });
    const state429 = await client.query('feedState', {});
    check(
      'a forced 429 is actionable (rate-limit guidance) and key-free',
      run429.ok === true &&
        /rate limit/.test(state429.rows[0].lastError) &&
        !JSON.stringify(state429.rows[0]).includes(FEED_KEY)
    );
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
    const status = await (await fetch(`${base}/config/status`)).json();
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
