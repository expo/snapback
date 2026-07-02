// All Aboard demo functions.
//
// @ref LLP 0027#realtime-model — the surface holds live queries over the durable
//   trainStatus + feedRefreshState rows; a refresh write produces the delta that
//   updates minutes-away without a manual refresh.
// @ref LLP 0027#feed-refresh-and-cron — the refresh is an ACTION (the thing cron
//   runs) that commits through a MUTATION, so it reuses the existing realtime
//   fan-out and never does I/O on the transactional path.

import {
  arg,
  asc,
  defineAction,
  defineConfig,
  defineCron,
  defineLiveQuery,
  defineJsMutation,
  defineQuery,
  eq,
  v,
} from '../../_kit/define.mjs';

// --- Config -------------------------------------------------------------------

// @ref LLP 0036#declared-configuration-in-the-manifest — the demo declares the
// key pool the live feed will need. Optional while the demo runs the recorded
// feed (G5's live half is not built); the declaration is what the setup wizard
// and `config.status` render, and refreshFeed already carries the grant.
export const appConfig = defineConfig({
  caltrainFeed: {
    description: '511.org Open Data API key',
    purpose: 'Fetches the Caltrain GTFS-Realtime feed for live departures',
    required: false,
    pool: true,
    howToGet:
      'Request a free key at https://511.org/open-data/token — it arrives by email, ' +
      'typically within a day. Add more than one key to spread rate limits.',
    acquisition: {
      url: 'https://511.org/open-data/token',
      kind: 'email-delay',
      inputs: ['name', 'email', 'intended use'],
      cost: 'free',
      humanCommitment: ['terms'],
    },
  },
});

// --- Static schedule reads (callable; the committed durable schedule) ---------

export const stationsQuery = defineQuery({
  table: 'stations',
  args: {},
  order: [asc('orderIndex')],
  index: 'by_order',
});

export const tripsQuery = defineQuery({
  table: 'trips',
  args: {},
  order: [asc('patternId')],
});

export const stopTimesByStation = defineQuery({
  table: 'stopTimes',
  args: { stationId: v.string() },
  filter: [eq('stationId', arg('stationId'))],
  index: 'by_station',
});

// --- Live reads (syncable-live; what the product surface subscribes to) -------

// The delays the world adds on top of the static schedule. A refresh write here
// is the live delta that shifts every affected countdown.
export const liveTrainStatus = defineLiveQuery({
  table: 'trainStatus',
  args: {},
  order: [asc('patternId')],
  index: 'by_pattern',
});

// The read-through freshness marker ("updated N seconds ago").
export const feedState = defineLiveQuery({
  table: 'feedRefreshState',
  args: {},
});

// --- Refresh path (mutation + action) -----------------------------------------

// Advances the recorded feed by one tick and writes trainStatus + feedRefreshState.
// This is the only write path; it fires the realtime fan-out for free.
export const applyFeedTick = defineJsMutation({
  args: { trigger: v.optional(v.string()) },
  source: 'handlers.mjs',
  exportName: 'applyFeedTick',
  reads: ['feedRefreshState', 'feedTicks', 'trainStatus'],
  writes: ['trainStatus', 'feedRefreshState'],
});

// Reset the feed to tick 0 / all on-time (resettable for tests).
export const resetFeed = defineJsMutation({
  args: {},
  source: 'handlers.mjs',
  exportName: 'resetFeed',
  reads: ['feedRefreshState', 'trainStatus'],
  writes: ['trainStatus', 'feedRefreshState'],
});

// The thing cron runs. In v0 it advances the recorded feed through applyFeedTick;
// Phase 3 would fetch the real Caltrain feed here (egress) before the mutation.
// @ref LLP 0027#external-data-and-action-egress — egress stays out of the
//   transactional path: the action fetches, then calls a mutation to write.
export const refreshFeed = defineAction({
  args: { trigger: v.optional(v.string()) },
  js: { source: 'handlers.mjs', exportName: 'refreshFeed' },
  // @ref LLP 0036#declared-configuration-in-the-manifest — D8: the grant that
  // hands Phase 3's live fetch its rotating key via ctx.secrets.
  uses: ['caltrainFeed'],
  writes: ['trainStatus', 'feedRefreshState'],
});

// --- Cron ---------------------------------------------------------------------

// Minute warm-poll, armed only while a client is watching trainStatus. 60s cadence
// keeps the hosted Cloudflare profile on a minute Cron Trigger (LLP 0027 / 0028).
export const caltrainCron = defineCron({
  warmPoll: {
    // jitter:false so the hosted target stays on a minute cadence rather than a
    // sub-minute re-armed alarm (LLP 0027 non-goals / LLP 0028 target seam).
    schedule: { everyMs: 60_000, jitter: false },
    action: 'refreshFeed',
    activation: { kind: 'WhileLive', whileLive: ['liveTrainStatus'] },
  },
});
