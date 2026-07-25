// All Aboard — Phase 0 headless acceptance (LLP 0027).
//
// Proves the backend contract on recorded data with a frozen clock, no UI:
//   - the committed static schedule is durable and queryable;
//   - assumed-direction inference and nearest-station selection match the spec;
//   - next-north/next-south predictions are exact, deterministic minutes-away;
//   - applying a recorded feed tick (the refresh mutation) pushes a live-query
//     delta that shifts minutes-away, and advances the durable storage version;
//   - the read-through freshness marker (feedRefreshState) tracks the refresh;
//   - resetFeed is seed-true: the post-reset feed tables are byte-equivalent
//     to the committed seed.json fixture (no admin reseed needed between cases).
//
// Run: TZ=America/Los_Angeles node demos/all-aboard/tests/acceptance/headless.mjs
//
// Determinism note: the warm-poll cron job is armed only by a *subscription* to
// liveTrainStatus, and an everyMs job is immediately due — so a subscription lets
// the 1s background scheduler advance the feed. Every exact-value assertion below
// therefore reads snapshots with one-shot queries (which do NOT arm the job); the
// single subscription is created last, for the realtime-delta check, which asserts
// only race-robust facts. TZ is pinned so the clock-face schedule reads in Pacific.

process.env.TZ = 'America/Los_Angeles';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import {
  assumedDirection,
  estimateDistanceMiles,
  estimateWalkMinutes,
  formatCountdownMinutes,
  getDirectionBoard,
  getNearestStation,
  getSelectedStation,
  getStationById,
  searchStations,
} from '../../snapback/shared/model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));

// A frozen clock at exactly 9:00:00am Pacific, so the clock-face schedule lands on
// hand-verifiable minutes (sb-local departs :07, sb-limited :22, sb-bullet :45).
const NOW_MS = Date.UTC(2026, 5, 30, 16, 0, 0); // 2026-06-30 09:00 PDT (UTC-7)
const VALID_LIMITED_DELAYS = new Set([0, 60, 180, 240]); // the recorded feed's profiles

const delaysFrom = (rows) => Object.fromEntries(rows.map((r) => [r.patternId, r.delaySeconds]));
// One-shot snapshot of the delays — does NOT create a subscription, so it never
// arms the warm-poll cron job.
const snapshotDelays = async () => delaysFrom((await db.query('liveTrainStatus', {})).rows);

const suite = createSuite('all-aboard headless (Phase 0)');
let server = null;
let db = null;

// runAcceptance (ENG-22486) surfaces a setup throw and exits nonzero on a
// zero-check run — previously a pre-check failure here exited "PASS — 0/0".
await runAcceptance(suite, async () => {
  server = await startServer({ port: 4408, db: ':memory:', cwd: repoRoot,
    provenance: { appId: 'all-aboard', artifactsPath: join(repoRoot, 'demos', 'all-aboard', 'snapback', 'generated', 'artifacts.json') } });
  db = new SnapbackClient(server.baseUrl, server.clientOptions);

  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(seed);

  await suite.check('frozen clock is 9:00am Pacific (TZ guard)', () => {
    assertEqual(new Date(NOW_MS).getHours(), 9, 'expected 9am local');
    assertEqual(new Date(NOW_MS).getMinutes(), 0, 'expected :00 local');
  });

  await suite.check('durable static schedule: 21 stations ordered north->south', async () => {
    const { rows } = await db.query('stationsQuery', {});
    assertEqual(rows.length, 21, 'station count');
    assertEqual(rows[0].stationId, 'san-francisco', 'northern terminus first');
    assertEqual(rows[20].stationId, 'san-jose', 'southern terminus last');
    return { count: rows.length };
  });

  await suite.check('durable trips + stopTimes are queryable', async () => {
    const trips = (await db.query('tripsQuery', {})).rows;
    assertEqual(trips.length, 6, 'six service patterns');
    const millbrae = (await db.query('stopTimesByStation', { args: { stationId: 'millbrae' } })).rows;
    assertEqual(millbrae.length, 6, 'every pattern stops at Millbrae');
    return { trips: trips.length, millbraeStops: millbrae.length };
  });

  await suite.check('assumed-direction inference (SF/22nd/Bayshore/South SF => south)', () => {
    assertEqual(assumedDirection(getStationById('san-francisco')), 'south', 'SF');
    assertEqual(assumedDirection(getStationById('south-sf')), 'south', 'South SF');
    assertEqual(assumedDirection(getStationById('san-bruno')), 'north', 'San Bruno');
    assertEqual(assumedDirection(getStationById('san-jose')), 'north', 'San Jose');
  });

  await suite.check('nearest-station selection from lat/lng', () => {
    assertEqual(getNearestStation({ lat: 37.4443, lng: -122.1649 }).id, 'palo-alto', 'near Palo Alto');
    assertEqual(getNearestStation({ lat: 37.7765, lng: -122.3947 }).id, 'san-francisco', 'near SF');
    assertEqual(getNearestStation({ lat: 37.3300, lng: -121.9020 }).id, 'san-jose', 'near Diridon');
  });

  await suite.check('domain edges: invalid locations fall back without NaN ETAs', () => {
    const invalid = { lat: 'not-a-number', lng: undefined };
    assertEqual(getNearestStation(invalid).id, 'san-francisco', 'invalid nearest falls back to first station');
    assertEqual(getSelectedStation('missing-station', invalid).id, 'san-francisco', 'invalid selected station fallback');
    assertEqual(searchStations('', invalid)[0].id, 'san-francisco', 'invalid search origin preserves corridor order');
    const paloAlto = getStationById('palo-alto');
    const miles = estimateDistanceMiles(invalid, paloAlto);
    const walk = estimateWalkMinutes(invalid, paloAlto);
    assert(Number.isFinite(miles), `distance should be finite, got ${miles}`);
    assert(Number.isFinite(walk), `walk minutes should be finite, got ${walk}`);
    return { fallback: 'san-francisco', miles, walk };
  });

  await suite.check('exact next-south prediction at 9:00am from San Francisco', async () => {
    const delays = await snapshotDelays();
    assertEqual(delays['sb-limited'], 0, 'seed delay is zero');
    const board = getDirectionBoard('san-francisco', 'south', NOW_MS, delays);
    assertEqual(board.primary.service, 'Local', 'first southbound is the :07 local');
    assertEqual(formatCountdownMinutes(board.primary.predictedDepartureMs, NOW_MS), 7, 'primary minutes-away');
    const limited = board.secondary.find((d) => d.service === 'Limited');
    assertEqual(formatCountdownMinutes(limited.predictedDepartureMs, NOW_MS), 22, 'limited minutes-away');
    return { primary: '7 min local', limited: '22 min limited' };
  });

  await suite.check('exact next-north prediction is present and future', async () => {
    const board = getDirectionBoard('san-francisco', 'north', NOW_MS, await snapshotDelays());
    assert(board.primary, 'a northbound train exists');
    assert(board.primary.predictedDepartureMs > NOW_MS, 'northbound primary is in the future');
  });

  await suite.check('applying a recorded feed tick shifts the exact prediction (0 -> 180s)', async () => {
    // No subscription exists yet, so this direct mutation is the only advance.
    await db.mutate('applyFeedTick', { args: { trigger: 'test' } });
    const delays = await snapshotDelays();
    assertEqual(delays['sb-limited'], 180, 'sb-limited advanced to 180s');
    const board = getDirectionBoard('san-francisco', 'south', NOW_MS, delays);
    const limited = board.secondary.find((d) => d.service === 'Limited');
    assertEqual(formatCountdownMinutes(limited.predictedDepartureMs, NOW_MS), 25, 'limited slipped 22 -> 25 min');
    return { limited: '25 min' };
  });

  await suite.check('read-through freshness marker tracks the refresh', async () => {
    const state = (await db.query('feedState', {})).rows[0];
    assertEqual(state.tickIndex, 1, 'feedRefreshState advanced to tick 1');
    assertEqual(state.lastSource, 'recorded', 'source is the recorded feed');
    assert(state.fetchedAt > 0, 'fetchedAt stamped');
    return { tickIndex: state.tickIndex };
  });

  await suite.check('resetFeed restores the literal seed state (byte-equivalent to seed.json)', async () => {
    // Dirty every handler-mutable feed field first: the tick above moved
    // tickIndex/lastSource/fetchedAt, and a claimFeedPoll stamps the optional
    // lastUpstreamPollAt (the ENG-23642 budget) that a seed-true reset must
    // clear back to "absent".
    await db.mutate('claimFeedPoll', { args: { trigger: 'test' } });
    await db.mutate('resetFeed', {});
    assertEqual((await snapshotDelays())['sb-limited'], 0, 'delays cleared');

    // Byte-equivalence against the seed fixture. No subscription exists yet,
    // so the warm-poll cron is unarmed and nothing can commit a tick between
    // the reset and these one-shot snapshots. Excluded fields, with cause:
    //   - underscore-prefixed system columns other than the seeded _id
    //     (_createdAt/_updatedAt/_version) are Snapback-managed bookkeeping
    //     stamped on every commit — runtime-only, not seeded app state;
    //   - a null column is the storage representation of an optional field the
    //     fixture omits (lastUpstreamPollAt on a fresh seed).
    const fixtureView = (row) => Object.fromEntries(
      Object.entries(row).filter(([key, value]) => (!key.startsWith('_') || key === '_id') && value !== null),
    );
    const canonical = (value) => (Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
        : value);
    const sortById = (rows) => [...rows].sort((a, b) => String(a._id).localeCompare(String(b._id)));
    const bytes = (rows) => JSON.stringify(canonical(sortById(rows)));

    const trainStatus = (await db.query('liveTrainStatus', {})).rows.map(fixtureView);
    const feedState = (await db.query('feedState', {})).rows.map(fixtureView);
    const departures = (await db.query('liveDepartures', {})).rows;
    assertEqual(bytes(trainStatus), bytes(seed.tables.trainStatus),
      'trainStatus rows byte-equivalent to the seed fixture (all on-time, observedAt 0)');
    assertEqual(bytes(feedState), bytes(seed.tables.feedRefreshState),
      'feedRefreshState byte-equivalent to the seed fixture (lastSource seed, tickIndex 0, no poll claim)');
    assertEqual(departures.length, 0, 'liveDepartures empty, as seeded');
    return { lastSource: feedState[0]?.lastSource, tickIndex: feedState[0]?.tickIndex };
  });

  // Realtime delta — the one subscription. Arming the warm-poll job means the
  // background scheduler may also advance the feed, so assert only race-robust
  // facts: a delta arrives, the durable version advances, and the delivered rows
  // are always a valid recorded profile.
  await suite.check('refresh pushes a live-query delta to a subscribed client', async () => {
    const live = await db.liveQuery('liveTrainStatus', { connectionId: 'headless' });
    const versionBefore = live.version;
    await db.mutate('applyFeedTick', { args: { trigger: 'test' } });
    const rows = await live.poll();
    assert(live.version > versionBefore, `durable version advanced (${versionBefore} -> ${live.version})`);
    const limited = rows.find((r) => r.patternId === 'sb-limited');
    assert(VALID_LIMITED_DELAYS.has(limited.delaySeconds), `delivered a valid recorded profile (${limited.delaySeconds}s)`);
    return { version: `${versionBefore} -> ${live.version}` };
  });
}, { cleanups: [() => server?.stop()] });
