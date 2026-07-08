// Deterministic seed generator for the All Aboard demo.
//
// Emits demos/all-aboard/snapback/seed.json from the shared transit model plus a
// committed cycle of recorded "feed ticks" (delay profiles). Re-run after editing
// the model:  node demos/all-aboard/snapback/seed.gen.mjs
//
// @ref LLP 0027#deterministic-data — a committed static schedule plus a committed
//   sequence of recorded feed ticks a harness applies one at a time under a frozen
//   clock, standing in for the live feed until Phase 3 egress exists.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PATTERNS, getStaticScheduleSeed } from './shared/model.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const { stations, trips, stopTimes } = getStaticScheduleSeed();

// Recorded feed: a short cycle of delay profiles (seconds) keyed by pattern. The
// refresh advances one tick per run, so subscribers watch delays ebb and recover.
const FEED_TICKS = [
  { note: 'All on time', delays: {} },
  { note: 'Southbound limited slipping', delays: { 'sb-limited': 180, 'nb-local': 60 } },
  { note: 'Limited + bullet running late', delays: { 'sb-limited': 240, 'nb-local': 120, 'sb-bullet': 90 } },
  { note: 'Northbound recovery underway', delays: { 'sb-local': 180, 'nb-limited': 150 } },
  { note: 'Bullet held at Millbrae', delays: { 'nb-bullet': 120, 'sb-limited': 60 } },
  { note: 'Back on schedule', delays: {} },
];

const feedTicks = FEED_TICKS.map((tick, tickIndex) => ({
  _id: `tick-${tickIndex}`,
  tickIndex,
  delays: tick.delays,
  note: tick.note,
}));

// Initial trainStatus: every pattern on time (tick 0). _id = patternId so the
// refresh mutation can upsert by a stable id.
const trainStatus = PATTERNS.map((pattern) => ({
  _id: pattern.id,
  patternId: pattern.id,
  delaySeconds: 0,
  status: 'on-time',
  observedAt: 0,
}));

const feedRefreshState = [
  {
    _id: 'caltrain',
    fetchedAt: 0,
    // Freshness window for the LIVE badge: two 180s warm-poll cycles + 30s
    // grace, so one missed/skipped poll doesn't flap the badge but a feed that
    // stops refreshing goes visibly stale (ENG-23642).
    staleAfterMs: 390_000,
    tickIndex: 0,
    tickCount: feedTicks.length,
    lastSource: 'seed',
    lastError: '',
    lastRunTrigger: 'seed',
  },
];

const seed = {
  tables: {
    stations,
    trips,
    stopTimes,
    trainStatus,
    feedRefreshState,
    feedTicks,
  },
};

writeFileSync(join(here, 'seed.json'), `${JSON.stringify(seed, null, 2)}\n`);
console.log(
  `Wrote seed.json: ${stations.length} stations, ${trips.length} trips, ` +
    `${stopTimes.length} stopTimes, ${trainStatus.length} trainStatus, ${feedTicks.length} feedTicks.`,
);
