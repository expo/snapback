// All Aboard — real-data action path acceptance.
//
// Proves the product actions against local HTTP mocks, not the real services:
//   - /action/{name} runs actions as app-data and rejects non-actions;
//   - refreshFeed fetches 511 SIRI StopMonitoring JSON, maps Caltrain visits
//     onto liveDepartures plus coarse trainStatus rows, and commits through
//     applyLiveFeedSnapshot;
//   - routeEstimate calls the server-side directions action and returns a real
//     routed distance/duration shape.
//
// Run: TZ=America/Los_Angeles node demos/all-aboard/tests/acceptance/real-data.mjs

process.env.TZ = 'America/Los_Angeles';

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const ACTION_SECRETS = JSON.stringify({
  caltrainFeed: ['test-511-key'],
  directions: ['test-ors-key'],
});

const suite = createSuite('all-aboard real data actions');
let server = null;
let mock = null;
let db = null;
const oldEnv = {
  SNAPBACK_OUTBOUND_ACTIONS: process.env.SNAPBACK_OUTBOUND_ACTIONS,
  SNAPBACK_ACTION_SECRETS: process.env.SNAPBACK_ACTION_SECRETS,
};

function restoreEnv() {
  if (oldEnv.SNAPBACK_OUTBOUND_ACTIONS === undefined) delete process.env.SNAPBACK_OUTBOUND_ACTIONS;
  else process.env.SNAPBACK_OUTBOUND_ACTIONS = oldEnv.SNAPBACK_OUTBOUND_ACTIONS;
  if (oldEnv.SNAPBACK_ACTION_SECRETS === undefined) delete process.env.SNAPBACK_ACTION_SECRETS;
  else process.env.SNAPBACK_ACTION_SECRETS = oldEnv.SNAPBACK_ACTION_SECRETS;
}

async function startMockApi() {
  const requests = [];
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push({ method: req.method, path: url.pathname, search: url.search });
    if (url.pathname === '/transit/StopMonitoring') {
      // Serve the shape the real api.511.org sends, not an idealized one: a
      // UTF-8 BOM before the JSON and a gzip content-encoding (ENG-22751).
      const body = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(JSON.stringify(stopMonitoringPayload())),
      ]);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-encoding': 'gzip',
      });
      res.end(gzipSync(body));
      return;
    }
    if (url.pathname === '/unauthorized/transit/StopMonitoring') {
      // The real 511 response for a wrong/unactivated key: plain-text 401.
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('This API key provided is invalid.');
      return;
    }
    if (url.pathname === '/ratelimited/transit/StopMonitoring') {
      // 511 keys share a per-key rate window; the exact 429 body is not
      // pinned to the real wire shape (verifying it needs a live key) — this
      // check covers OUR mapping of any HTTP 429 to an actionable lastError.
      res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Rate limit exceeded.');
      return;
    }
    if (url.pathname === '/openrouteservice/v2/directions/foot-walking') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(routePayload(1609.344, 600)));
      return;
    }
    if (url.pathname === '/openrouteservice/v2/directions/cycling-regular') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(routePayload(1609.344, 240)));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `no mock for ${url.pathname}` }));
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    stop: () => new Promise((resolve) => http.close(resolve)),
  };
}

function stopMonitoringPayload() {
  const base = Date.now() + 10 * 60 * 1000;
  return {
    Siri: {
      ServiceDelivery: {
        StopMonitoringDelivery: [{
          MonitoredStopVisit: [
            monitoredVisit({
              line: 'Limited 312',
              direction: 'Southbound',
              destination: 'San Jose Diridon',
              aimed: new Date(base).toISOString(),
              expected: new Date(base + 3 * 60 * 1000).toISOString(),
            }),
            monitoredVisit({
              line: 'Local 101',
              direction: 'Northbound',
              destination: 'San Francisco 4th & King',
              aimed: new Date(base + 10 * 60 * 1000).toISOString(),
              expected: new Date(base + 11 * 60 * 1000).toISOString(),
            }),
          ],
        }],
      },
    },
  };
}

function monitoredVisit({ line, direction, destination, aimed, expected }) {
  return {
    MonitoredVehicleJourney: {
      LineRef: line,
      PublishedLineName: line,
      DirectionName: direction,
      DestinationName: destination,
      MonitoredCall: {
        StopPointName: 'Palo Alto Caltrain',
        AimedDepartureTime: aimed,
        ExpectedDepartureTime: expected,
      },
    },
  };
}

function routePayload(distance, duration) {
  return {
    features: [{
      properties: {
        summary: { distance, duration },
      },
    }],
  };
}

const rowsById = (rows) => Object.fromEntries(rows.map((row) => [row.patternId, row]));

await runAcceptance(suite, async () => {
  process.env.SNAPBACK_OUTBOUND_ACTIONS = '1';
  process.env.SNAPBACK_ACTION_SECRETS = ACTION_SECRETS;
  mock = await startMockApi();

  server = await startServer({ port: 4410, db: ':memory:', cwd: repoRoot,
    provenance: { appId: 'all-aboard', artifactsPath: join(repoRoot, 'demos', 'all-aboard', 'snapback', 'generated', 'artifacts.json') } });
  db = new SnapbackClient(server.baseUrl);
  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(seed);

  await suite.check('/action rejects non-actions without executing them', async () => {
    const result = await db.action('stationsQuery', {});
    assertEqual(result.ok, false, 'query must not run through the action endpoint');
    assertEqual(result.diagnostic.code, 'SNAPBACK_FUNCTION_KIND_MISMATCH', 'kind mismatch code');
  });

  await suite.check('routeEstimate uses the directions API and returns routed walking time', async () => {
    const result = await db.action('routeEstimate', {
      args: {
        fromLat: 37.4443,
        fromLng: -122.1649,
        toLat: 37.4433,
        toLng: -122.1647,
        mode: 'walk',
        baseUrl: `${mock.baseUrl}/openrouteservice`,
      },
    });
    assert(result.ok, `routeEstimate failed: ${JSON.stringify(result.diagnostic)}`);
    assertEqual(result.result.source, 'openrouteservice', 'source');
    assertEqual(result.result.minutes, 10, 'duration minutes');
    assertEqual(Math.round(result.result.distanceMiles * 10) / 10, 1.0, 'distance miles');
    assert(mock.requests.some((r) => r.path.includes('/directions/foot-walking')), 'mock saw foot-walking request');
  });

  await suite.check('refreshFeed maps 511 StopMonitoring visits into live departure rows', async () => {
    const result = await db.action('refreshFeed', {
      args: {
        trigger: 'test',
        feedUrl: `${mock.baseUrl}/transit/StopMonitoring`,
      },
    });
    assert(result.ok, `refreshFeed failed: ${JSON.stringify(result.diagnostic)}`);
    const feedState = (await db.query('feedState', {})).rows[0];
    assertEqual(feedState.lastError ?? '', '', 'live fetch diagnostic');
    assertEqual(result.result.source, '511-siri-stop-monitoring', 'snapshot source');
    assert(result.result.patterns.includes('sb-limited'), 'southbound limited updated');
    assert(result.result.patterns.includes('nb-local'), 'northbound local updated');

    const statusRows = rowsById((await db.query('liveTrainStatus', {})).rows);
    assertEqual(statusRows['sb-limited'].delaySeconds, 180, 'southbound limited delay');
    assertEqual(statusRows['sb-limited'].status, 'delayed', 'southbound limited status');
    assertEqual(statusRows['nb-local'].delaySeconds, 60, 'northbound local delay');
    assertEqual(feedState.lastSource, '511-siri-stop-monitoring', 'feed source marker');
    assertEqual(feedState.lastError ?? '', '', 'no feed error');
    const departures = (await db.query('liveDepartures', {})).rows;
    assertEqual(departures.length, 2, 'live departure rows');
    assert(departures.every((row) => row.stationId === 'palo-alto'), 'departures mapped to Palo Alto');
    assert(departures.every((row) => row.predictedDepartureMs > Date.now()), 'departures are real future times');
  });

  await suite.check('a second refresh inside the 3-minute budget answers from cache, not upstream (ENG-23642)', async () => {
    const before = mock.requests.length;
    const departuresBefore = (await db.query('liveDepartures', {})).rows;
    const result = await db.action('refreshFeed', {
      args: { trigger: 'manual', feedUrl: `${mock.baseUrl}/transit/StopMonitoring` },
    });
    assert(result.ok, `refreshFeed failed: ${JSON.stringify(result.diagnostic)}`);
    assertEqual(result.result.skipped, 'updated-recently', 'denied claim reports updated-recently');
    assert(Number(result.result.retryInMs) > 0, `denied claim reports retryInMs: ${JSON.stringify(result.result)}`);
    assertEqual(mock.requests.length, before, 'no upstream 511 request was made');
    const departuresAfter = (await db.query('liveDepartures', {})).rows;
    assertEqual(departuresAfter.length, departuresBefore.length, 'committed live rows are untouched');
    const feedState = (await db.query('feedState', {})).rows[0];
    assertEqual(feedState.lastSource, '511-siri-stop-monitoring', 'feed marker still the live snapshot');
  });

  await suite.check('a refresh past the budget window polls 511 upstream again (ENG-23730)', async () => {
    // pollBudgetMs can only LOWER the window (claimFeedPoll clamps to the
    // 180s production ceiling); a ~1s synthetic window proves expiry without
    // waiting out the real budget. The sleep guarantees the last granted
    // claim (two checks up) is older than the lowered window.
    const upstream = () => mock.requests.filter((r) => r.path === '/transit/StopMonitoring').length;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const before = upstream();
    const result = await db.action('refreshFeed', {
      args: { trigger: 'test-expiry', feedUrl: `${mock.baseUrl}/transit/StopMonitoring`, pollBudgetMs: 1000 },
    });
    assert(result.ok, `refreshFeed failed: ${JSON.stringify(result.diagnostic)}`);
    assert(result.result.skipped === undefined, `an expired window must poll, not skip: ${JSON.stringify(result.result)}`);
    assertEqual(result.result.source, '511-siri-stop-monitoring', 'snapshot source');
    assertEqual(upstream(), before + 1, 'exactly one new upstream 511 request after the window expired');
  });

  await suite.check('a key set through the admin config API reaches the live fetch (the setup-page path)', async () => {
    // Clear the ENG-23642 upstream-poll budget so this check exercises the
    // fetch path rather than the updated-recently guard.
    await db.mutate('resetFeed', {});
    // The user path is /_snapback/admin/setup -> /_snapback/api/config/set,
    // not the deprecated SNAPBACK_ACTION_SECRETS env blob the boot imported.
    const set = await fetch(`${server.baseUrl}/_snapback/api/config/set`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-snapback-admin-token': server.adminToken },
      body: JSON.stringify({ entry: 'caltrainFeed', value: 'config-set-key', source: 'acceptance' }),
    });
    assert(set.ok, `config/set failed: ${set.status}`);
    const before = mock.requests.length;
    const result = await db.action('refreshFeed', {
      args: { trigger: 'test', feedUrl: `${mock.baseUrl}/transit/StopMonitoring` },
    });
    assert(result.ok, `refreshFeed failed: ${JSON.stringify(result.diagnostic)}`);
    assertEqual(result.result.source, '511-siri-stop-monitoring', 'snapshot source');
    const request = mock.requests.slice(before).find((r) => r.path === '/transit/StopMonitoring');
    assert(request, 'mock saw the refresh fetch');
    assert(request.search.includes('api_key=config-set-key'), `fetch used the admin-set key: ${request.search}`);
  });

  await suite.check('a failing live fetch records an actionable, redacted lastError and falls back', async () => {
    await db.mutate('resetFeed', {}); // clear the upstream-poll budget (ENG-23642)
    const result = await db.action('refreshFeed', {
      args: { trigger: 'test', feedUrl: `${mock.baseUrl}/unauthorized/transit/StopMonitoring` },
    });
    assert(result.ok, `refreshFeed action errored: ${JSON.stringify(result.diagnostic)}`);
    const feedState = (await db.query('feedState', {})).rows[0];
    assertEqual(feedState.lastSource, 'recorded-fallback', 'fell back to the recorded feed');
    const lastError = feedState.lastError ?? '';
    assert(lastError.startsWith('live 511 fetch failed:'), `actionable prefix: ${lastError}`);
    assert(lastError.includes('HTTP 401'), `carries the HTTP status: ${lastError}`);
    // A rejected key must say where to fix it — and the instruction must sit
    // BEFORE the diagnostic detail so the surface's tail-first truncation
    // (feedProblem, 180 chars) can never eat it.
    const instructionAt = lastError.indexOf('update caltrainFeed at /_snapback/admin/setup');
    assert(instructionAt >= 0, `names the fix location: ${lastError}`);
    assert(instructionAt < 180 && instructionAt < lastError.indexOf('HTTP 401'), `instruction precedes the diagnostic: ${lastError}`);
    // lastError is client-visible state (feedState live query + the surface's
    // feed-problem line): the API key must never appear in it.
    assert(!lastError.includes('config-set-key'), `api key leaked into lastError: ${lastError}`);
    assert(lastError.includes('api_key=[redacted]'), `key is redacted, not dropped silently: ${lastError}`);
  });

  await suite.check('a rate-limited live fetch tells the rider about key pooling and falls back', async () => {
    await db.mutate('resetFeed', {}); // clear the upstream-poll budget (ENG-23642)
    const result = await db.action('refreshFeed', {
      args: { trigger: 'test', feedUrl: `${mock.baseUrl}/ratelimited/transit/StopMonitoring` },
    });
    assert(result.ok, `refreshFeed action errored: ${JSON.stringify(result.diagnostic)}`);
    const feedState = (await db.query('feedState', {})).rows[0];
    assertEqual(feedState.lastSource, 'recorded-fallback', 'fell back to the recorded feed');
    const lastError = feedState.lastError ?? '';
    assert(lastError.includes('rate limit'), `names the cause: ${lastError}`);
    assert(lastError.includes('add another caltrainFeed key at /_snapback/admin/setup'), `names the fix: ${lastError}`);
    assert(lastError.includes('HTTP 429'), `carries the HTTP status: ${lastError}`);
    assert(lastError.includes('api_key=[redacted]'), `key is redacted: ${lastError}`);
  });
}, {
  cleanups: [
    restoreEnv,
    () => server?.stop(),
    () => mock?.stop(),
  ],
});
