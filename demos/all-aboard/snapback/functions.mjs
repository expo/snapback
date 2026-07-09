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
// key pools its egress actions use. Optional means the app can still boot on
// recorded feed + haversine fallback, while the setup wizard renders exactly
// what real Caltrain/routing data needs.
export const appConfig = defineConfig({
  caltrainFeed: {
    description: '511.org Open Data API key',
    purpose: 'Fetches Caltrain StopMonitoring predictions for live departure boards',
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
  directions: {
    description: 'OpenRouteService / HeiGIT Directions API key',
    purpose: 'Computes walking and biking ETAs from the rider location to a station',
    required: false,
    pool: true,
    howToGet:
      'Create a free OpenRouteService token at https://openrouteservice.org/dev/ ' +
      'or use a compatible HeiGIT openrouteservice key.',
    acquisition: {
      url: 'https://openrouteservice.org/dev/',
      kind: 'self-serve',
      inputs: ['email'],
      cost: 'free tier available',
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

// The real 511 departure board. trainStatus remains a coarse delay overlay for
// the recorded fallback and legacy tests; liveDepartures owns actual predicted
// departure times when the feed source is live.
export const liveDepartures = defineLiveQuery({
  table: 'liveDepartures',
  args: {},
  order: [asc('predictedDepartureMs')],
  index: 'by_time',
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
  args: {
    trigger: v.optional(v.string()),
    source: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  source: 'handlers.mjs',
  exportName: 'applyFeedTick',
  reads: ['feedRefreshState', 'feedTicks', 'trainStatus'],
  writes: ['trainStatus', 'liveDepartures', 'feedRefreshState'],
});

// Applies a real feed snapshot already fetched by the action. The handler maps
// external predictions onto the six committed service-pattern ids, then this
// mutation is the durable write that fans out over liveQuery.
//
// Data-tier profile's honest negative exemplar (LLP 0051 D2, Increment 3
// gate c): it patches only the patterns present in the args object and
// accumulates a data-dependent result — conditional writes, permanently
// JS-tier. Its DeleteWhere/InsertEach/clamp cores live on as corpus
// fragments; the mutation itself stays here.
export const applyLiveFeedSnapshot = defineJsMutation({
  args: {
    trigger: v.optional(v.string()),
    source: v.optional(v.string()),
    delays: v.json(),
    departures: v.optional(v.json()),
    note: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  source: 'handlers.mjs',
  exportName: 'applyLiveFeedSnapshot',
  reads: ['feedRefreshState', 'trainStatus', 'liveDepartures'],
  writes: ['trainStatus', 'liveDepartures', 'feedRefreshState'],
  outgrewIr: 'conditional-writes',
});

// Transactional upstream-poll budget claim (ENG-23642). refreshFeed calls this
// BEFORE touching 511: it grants at most one claim per budget window by
// stamping feedRefreshState.lastUpstreamPollAt inside the mutation, so
// concurrent cron + manual refreshes serialize on the DO write path and only
// one of them may poll upstream per window. Denied claims report retryInMs so
// the caller can answer "updated recently" from the cached rows.
export const claimFeedPoll = defineJsMutation({
  args: {
    trigger: v.optional(v.string()),
    // Testing knob (mirrors SNAPBACK_TEST_FEED_URL): callers may LOWER the
    // budget window, never raise it — the handler clamps to the 180s default.
    minIntervalMs: v.optional(v.integer()),
  },
  source: 'handlers.mjs',
  exportName: 'claimFeedPoll',
  reads: ['feedRefreshState'],
  writes: ['feedRefreshState'],
});

// Reset the feed to tick 0 / all on-time (resettable for tests).
export const resetFeed = defineJsMutation({
  args: {},
  source: 'handlers.mjs',
  exportName: 'resetFeed',
  reads: ['feedRefreshState', 'trainStatus', 'liveDepartures'],
  writes: ['trainStatus', 'liveDepartures', 'feedRefreshState'],
});

// The thing cron runs. With a 511 key it fetches the real Caltrain feed and
// commits a live snapshot; without one it advances the recorded fallback feed.
// @ref LLP 0027#external-data-and-action-egress — egress stays out of the
//   transactional path: the action fetches, then calls a mutation to write.
export const refreshFeed = defineAction({
  args: {
    trigger: v.optional(v.string()),
    source: v.optional(v.string()),
    feedUrl: v.optional(v.string()),
    // Testing knob (short-cadence acceptance rigs): lowers the upstream-poll
    // budget window; clamped so it can never RAISE the 180s production budget.
    pollBudgetMs: v.optional(v.integer()),
  },
  js: { source: 'handlers.mjs', exportName: 'refreshFeed' },
  // @ref LLP 0036#declared-configuration-in-the-manifest — D8: the grant that
  // hands the live fetch its rotating key via ctx.secrets.
  uses: ['caltrainFeed'],
  writes: ['trainStatus', 'liveDepartures', 'feedRefreshState'],
});

// Per-request walking/biking directions. The browser passes only coordinates;
// the API key stays server-side on the action grant, and the handler falls back
// to deterministic haversine if egress/config is unavailable.
// @ref LLP 0028#open-questions — action generality covers All Aboard's
//   user-triggered routing egress, not only cron.
export const routeEstimate = defineAction({
  args: {
    fromLat: v.real(),
    fromLng: v.real(),
    toLat: v.real(),
    toLng: v.real(),
    mode: v.string(),
    baseUrl: v.optional(v.string()),
  },
  js: { source: 'handlers.mjs', exportName: 'routeEstimate' },
  uses: ['directions'],
  writes: [],
});

// --- Cron ---------------------------------------------------------------------

// Three-minute warm-poll, armed only while a client is watching trainStatus.
// On the hosted Cloudflare profile this rides a demand-armed Durable Object
// alarm — subscribe arms it, last-unsubscribe cancels it — so an idle
// deployment takes zero warm-poll wakeups (LLP 0049 §Warm Polling, superseding
// the minute Cron Trigger default LLP 0028 previously carried; the minute
// trigger with a declared idle invocation rate is the named fallback).
// 180s (not 60s) so the deployed app stays inside the 511 key's rate budget
// (ENG-23642); claimFeedPoll enforces the same budget transactionally, so a
// manual Refresh cannot stack extra upstream polls on top of the cadence.
export const caltrainCron = defineCron({
  warmPoll: {
    // jitter:false because the 180s cadence is a fixed product interval for a
    // single demand-gated app; no thundering-herd concern (LLP 0028 §Jitter).
    schedule: { everyMs: 180_000, jitter: false },
    action: 'refreshFeed',
    activation: { kind: 'WhileLive', whileLive: ['liveTrainStatus'] },
  },
});
