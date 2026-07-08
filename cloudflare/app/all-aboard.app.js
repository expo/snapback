// The All Aboard app bundle for the LLP 0049 Cloudflare proof (Phase 0:
// recorded-data — no live egress, no cron yet; those arrive with LLP 0049
// Phases 2-3).
//
// Deploy-time compiled into the handler Worker exactly like the notes fixture
// (LLP 0040 §App subset): the Workers runtime forbids dynamic code evaluation,
// so an app-code change is a redeploy. The schema shape and handler contract
// mirror demos/all-aboard/snapback/{schema.mjs,handlers.mjs}; the hashes are
// imported from that demo's generated manifests so the kit client's
// inspect-first /app/ensure attests 'matched' against the same artifacts the
// Contract surface ships with.
//
// @ref LLP 0049#phase-0-recorded-data-all-aboard-on-the-cloudflare-proof —
//   query/mutation/live subset only; recorded/fallback data stays labeled
//   (lastSource is 'seed' / 'recorded' / 'recorded-fallback', never the live
//   '511-siri-stop-monitoring' stamp, which only applyLiveFeedSnapshot writes).

import schemaManifest from '../../demos/all-aboard/snapback/generated/schema.manifest.json';
import functionsManifest from '../../demos/all-aboard/snapback/generated/functions.manifest.json';
import seedData from '../../demos/all-aboard/snapback/seed.json';
import capabilityManifest from '../generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json';

export const appMeta = {
  name: 'all-aboard',
  // The gateway's fixed logical object name for the single-app proof
  // (LLP 0014 one-way door 6: names, not idFromName puns).
  objectName: 'all-aboard-proof',
};

export { capabilityManifest };

export const schema = {
  schemaHash: schemaManifest.schemaHash,
  tables: [
    {
      name: 'stations',
      syncable: false,
      fields: [
        { name: 'stationId', type: 'string', optional: false },
        { name: 'name', type: 'string', optional: false },
        { name: 'shortName', type: 'string', optional: false },
        { name: 'orderIndex', type: 'integer', optional: false },
        { name: 'minutesFromSf', type: 'integer', optional: false },
        { name: 'zone', type: 'integer', optional: false },
        { name: 'lat', type: 'real', optional: false },
        { name: 'lng', type: 'real', optional: false },
        { name: 'photoUrl', type: 'string', optional: false },
        { name: 'photoAttribution', type: 'string', optional: false },
      ],
      indexes: [{ name: 'by_order', fields: ['orderIndex'] }],
    },
    {
      name: 'trips',
      syncable: false,
      fields: [
        { name: 'patternId', type: 'string', optional: false },
        { name: 'direction', type: 'string', optional: false },
        { name: 'service', type: 'string', optional: false },
        { name: 'trainNumberBase', type: 'integer', optional: false },
        { name: 'minuteSlots', type: 'json', optional: false },
        { name: 'speedFactor', type: 'real', optional: false },
        { name: 'originStationId', type: 'string', optional: false },
        { name: 'destinationStationId', type: 'string', optional: false },
      ],
      indexes: [{ name: 'by_direction', fields: ['direction'] }],
    },
    {
      name: 'stopTimes',
      syncable: false,
      fields: [
        { name: 'patternId', type: 'string', optional: false },
        { name: 'stationId', type: 'string', optional: false },
        { name: 'sequence', type: 'integer', optional: false },
        { name: 'offsetMinutes', type: 'integer', optional: false },
      ],
      indexes: [{ name: 'by_station', fields: ['stationId'] }],
    },
    {
      name: 'trainStatus',
      syncable: true,
      fields: [
        { name: 'patternId', type: 'string', optional: false },
        { name: 'delaySeconds', type: 'integer', optional: false },
        { name: 'status', type: 'string', optional: false },
        { name: 'observedAt', type: 'integer', optional: false },
      ],
      indexes: [{ name: 'by_pattern', fields: ['patternId'] }],
    },
    {
      name: 'feedRefreshState',
      syncable: true,
      fields: [
        { name: 'fetchedAt', type: 'integer', optional: false },
        { name: 'staleAfterMs', type: 'integer', optional: false },
        { name: 'tickIndex', type: 'integer', optional: false },
        { name: 'tickCount', type: 'integer', optional: false },
        { name: 'lastSource', type: 'string', optional: false },
        { name: 'lastError', type: 'string', optional: true },
        { name: 'lastRunTrigger', type: 'string', optional: true },
      ],
      indexes: [],
    },
    {
      name: 'feedTicks',
      syncable: false,
      fields: [
        { name: 'tickIndex', type: 'integer', optional: false },
        { name: 'delays', type: 'json', optional: false },
        { name: 'note', type: 'string', optional: false },
      ],
      indexes: [{ name: 'by_index', fields: ['tickIndex'] }],
    },
  ],
};

export const bundleHash = functionsManifest.bundleHash;

// Declared configuration (LLP 0036 / LLP 0049 Phase 1): the demo's generated
// manifest is the source of truth — names, pool flags, required flags, and
// acquisition metadata. The coordinator maps each declared entry to its
// mechanical, app-scoped Worker secret binding name and builds action-only
// redacted grant descriptors from these declarations plus each action's
// `uses` — never values.
export const config = functionsManifest.config || [];

// Declared cron jobs (LLP 0028 / LLP 0049 Phase 3): warmPoll — everyMs
// 60000, action refreshFeed, activation WhileLive(liveTrainStatus),
// targetWakeup DynamicAlarm with the hardened durable runner. The
// coordinator arms its Durable Object alarm only while the activation
// policy is satisfied.
export const cron = functionsManifest.cronJobs || [];

// Deterministic seed rows with explicit ids (the demo's generated seed.json):
// the coordinator inserts them host-side — patch-shaped mutations like
// applyFeedTick address rows by these stable ids.
export const seed = seedData;

export const functions = [
  { name: 'stationsQuery', kind: 'Query', export: 'stationsQuery', tables: ['stations'] },
  { name: 'tripsQuery', kind: 'Query', export: 'tripsQuery', tables: ['trips'] },
  { name: 'stopTimesByStation', kind: 'Query', export: 'stopTimesByStation', tables: ['stopTimes'] },
  { name: 'liveTrainStatus', kind: 'LiveQuery', export: 'liveTrainStatus', tables: ['trainStatus'] },
  { name: 'feedState', kind: 'LiveQuery', export: 'feedState', tables: ['feedRefreshState'] },
  { name: 'applyFeedTick', kind: 'Mutation', export: 'applyFeedTick', tables: ['trainStatus', 'feedRefreshState', 'feedTicks'] },
  {
    name: 'applyLiveFeedSnapshot',
    kind: 'Mutation',
    export: 'applyLiveFeedSnapshot',
    tables: ['trainStatus', 'feedRefreshState'],
  },
  { name: 'resetFeed', kind: 'Mutation', export: 'resetFeed', tables: ['trainStatus', 'feedRefreshState'] },
  // The ambient-power denial probe, identical in role to the notes fixture's
  // (LLP 0040 §Acceptance): the V8 denial tests must keep passing against the
  // All Aboard bundle, not only the notes regression surface.
  { name: 'probeAmbient', kind: 'Query', export: 'probeAmbient' },
  // The real All Aboard actions (LLP 0049): declared with their action-only
  // config grants. Phase 1 wires descriptor grants; Phase 2 adds the host
  // fetch capability, the gateway action route, and the handler migration.
  { name: 'refreshFeed', kind: 'Action', export: 'refreshFeed', uses: ['caltrainFeed'], tables: ['trainStatus', 'feedRefreshState'] },
  { name: 'routeEstimate', kind: 'Action', export: 'routeEstimate', uses: ['directions'], tables: [] },
  // Secret-grant probes for the LLP 0049 Phase 1 acceptance: the action
  // observes redacted descriptor handles (and their fail-closed expose());
  // the query and mutation prove ctx.secrets does not exist outside actions.
  { name: 'probeSecrets', kind: 'Action', export: 'probeSecrets', uses: ['caltrainFeed', 'directions'], tables: [] },
  { name: 'probeSecretsQuery', kind: 'Query', export: 'probeSecretsQuery' },
  { name: 'probeSecretsMutation', kind: 'Mutation', export: 'probeSecretsMutation', tables: ['trainStatus'] },
  // Concurrency probe for the LLP 0049 Phase 2 acceptance: a deliberately
  // slow host fetch that must not block queries, mutations, or live pushes
  // on the same coordinator (the off-mutex execution contract).
  { name: 'probeSlowFetch', kind: 'Action', export: 'probeSlowFetch', tables: [] },
];

const PATTERN_IDS = ['sb-local', 'sb-limited', 'sb-bullet', 'nb-local', 'nb-limited', 'nb-bullet'];
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const METERS_PER_MILE = 1609.344;

function nowMs(ctx) {
  return ctx.runtime && ctx.runtime.now ? ctx.runtime.now() : 0;
}

// --- action helpers, migrated from demos/all-aboard/snapback/handlers.mjs ---
// (LLP 0049 §Action Egress): the Cloudflare handlers use the action-only
// host fetch capability with secret placement slots instead of `.expose()` +
// ambient `fetch`. The key never appears in the URL these handlers build —
// the coordinator substitutes it into the api_key query parameter (511) or
// the Authorization header (directions) at its own fetch boundary, and every
// error envelope re-enters this isolate already redacted. The handler-side
// scrub below stays as defense in depth, not the line.

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function redactSecrets(text) {
  return String(text).replace(/api_key=[^&\s"']+/gi, 'api_key=[redacted]');
}

function liveFeedFailureMessage(error) {
  const raw = redactSecrets(errorMessage(error));
  if (/SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED/.test(raw)) {
    return 'live 511 fetch unavailable: outbound actions are not enabled on this deployment';
  }
  if (/SNAPBACK_CONFIG_MISSING/.test(raw)) {
    return 'live 511 fetch unavailable: no 511.org key is set — configure caltrainFeed via cloudflare/config-set.mjs';
  }
  if (/HTTP 401\b/.test(raw)) {
    return `live 511 fetch failed: 511 rejected the API key (mistyped, or not yet activated) — update caltrainFeed via cloudflare/config-set.mjs (${raw})`;
  }
  if (/HTTP 429\b/.test(raw)) {
    return `live 511 fetch failed: 511 rate limit hit — add another caltrainFeed key via cloudflare/config-set.mjs (keys rotate) or wait for the next window (${raw})`;
  }
  return `live 511 fetch failed: ${raw}`;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function scalar(value) {
  if (Array.isArray(value)) return scalar(value[0]);
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'value')) return scalar(value.value);
    if (Object.prototype.hasOwnProperty.call(value, '#text')) return scalar(value['#text']);
    if (Object.prototype.hasOwnProperty.call(value, '_text')) return scalar(value._text);
    if (Object.prototype.hasOwnProperty.call(value, '0')) return scalar(value[0]);
  }
  return value;
}

function textOf(value) {
  const out = scalar(value);
  return out == null ? '' : String(out);
}

function dateMs(value) {
  const text = textOf(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSiriDurationSeconds(value) {
  const text = textOf(value).trim();
  if (!text) return null;
  const match = text.match(/^(-)?P(?:T)?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!match) return null;
  const sign = match[1] ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  return sign * Math.round(hours * 3600 + minutes * 60 + seconds);
}

function findValues(root, key, out) {
  if (root == null) return;
  if (Array.isArray(root)) {
    for (const item of root) findValues(item, key, out);
    return;
  }
  if (typeof root !== 'object') return;
  for (const [k, value] of Object.entries(root)) {
    if (k === key) out.push(value);
    findValues(value, key, out);
  }
}

function flattenVisits(json) {
  const values = [];
  findValues(json, 'MonitoredStopVisit', values);
  return values.flatMap((value) => asArray(value));
}

function classifyDirection(mvj, call) {
  const text = [
    textOf(mvj.DirectionName),
    textOf(mvj.DirectionRef),
    textOf(mvj.DestinationName),
    textOf(mvj.DestinationRef),
    textOf(call.DestinationDisplay),
    textOf(call.StopPointName),
  ].join(' ').toLowerCase();

  if (/san francisco|4th|king|sf caltrain|sf$/.test(text)) return 'north';
  if (/san jose|diridon|tamien|gilroy/.test(text)) return 'south';
  if (/\b(nb|north|northbound)\b/.test(text)) return 'north';
  if (/\b(sb|south|southbound)\b/.test(text)) return 'south';
  return null;
}

function classifyService(mvj) {
  const text = [
    textOf(mvj.LineRef),
    textOf(mvj.PublishedLineName),
    textOf(mvj.JourneyPatternRef),
    textOf(mvj.VehicleRef),
    textOf(mvj.FramedVehicleJourneyRef && mvj.FramedVehicleJourneyRef.DatedVehicleJourneyRef),
  ].join(' ').toLowerCase();

  if (/bullet|baby\s*bullet|\b5\d\d\b/.test(text)) return 'bullet';
  if (/limited|express|\b3\d\d\b/.test(text)) return 'limited';
  return 'local';
}

function delaySecondsFromVisit(visit) {
  const mvj = visit && visit.MonitoredVehicleJourney ? scalar(visit.MonitoredVehicleJourney) : null;
  const call = mvj && mvj.MonitoredCall ? scalar(mvj.MonitoredCall) : {};
  if (!mvj || !call) return null;

  const expected =
    dateMs(call.ExpectedDepartureTime) ??
    dateMs(call.ExpectedArrivalTime) ??
    dateMs(call.ExpectedAimedDepartureTime) ??
    dateMs(call.ExpectedAimedArrivalTime);
  const aimed =
    dateMs(call.AimedDepartureTime) ??
    dateMs(call.AimedArrivalTime) ??
    dateMs(mvj.OriginAimedDepartureTime) ??
    dateMs(mvj.DestinationAimedArrivalTime);
  if (expected != null && aimed != null) return Math.round((expected - aimed) / 1000);

  return parseSiriDurationSeconds(mvj.Delay) ?? parseSiriDurationSeconds(call.Delay);
}

function aggregateCaltrainDelays(json) {
  const buckets = {};
  let visited = 0;
  for (const visit of flattenVisits(json)) {
    const mvj = visit && visit.MonitoredVehicleJourney ? scalar(visit.MonitoredVehicleJourney) : null;
    const call = mvj && mvj.MonitoredCall ? scalar(mvj.MonitoredCall) : {};
    if (!mvj || !call) continue;
    visited += 1;

    const direction = classifyDirection(mvj, call);
    if (!direction) continue;
    const service = classifyService(mvj);
    const patternId = `${direction === 'south' ? 'sb' : 'nb'}-${service}`;
    if (!PATTERN_IDS.includes(patternId)) continue;

    const delay = delaySecondsFromVisit(visit);
    if (!Number.isFinite(delay)) continue;
    (buckets[patternId] ||= []).push(Math.max(-300, Math.min(3600, Math.round(delay))));
  }

  const delays = {};
  for (const [patternId, values] of Object.entries(buckets)) {
    const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    delays[patternId] = Math.round(average);
  }
  if (Object.keys(delays).length === 0) {
    throw new Error(`511 StopMonitoring returned ${visited} visits but no mappable Caltrain delays`);
  }
  return { delays, visitCount: visited };
}

function loopbackUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//.test(value)) return value;
  return null;
}

// The URL the handler builds carries NO key: the api_key query parameter is
// a coordinator-side placement slot.
function caltrainFeedUrl(args) {
  const override = loopbackUrl(args && args.feedUrl);
  const base = override || 'https://api.511.org/transit/StopMonitoring';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}agency=CT&format=json`;
}

function parseHostFetchJson(response, url) {
  let json = null;
  try {
    json = response.bodyText ? JSON.parse(response.bodyText) : null;
  } catch (_) {
    throw new Error(`HTTP ${response.status} from ${url} returned non-JSON: ${String(response.bodyText).slice(0, 120)}`);
  }
  if (!response.ok) {
    const detail = json && (json.error || json.message || json.Message || json.Error);
    throw new Error(`HTTP ${response.status} from ${url}${detail ? `: ${detail}` : ''}`);
  }
  return json;
}

async function fetchCaltrainDelays(ctx, args) {
  const handle = ctx.secrets.rotating('caltrainFeed');
  const url = caltrainFeedUrl(args);
  const response = await ctx.fetch({
    url,
    headers: { Accept: 'application/json' },
    timeoutMs: 15_000,
    secretSlots: [{ placement: 'query-param', name: 'api_key', handle }],
  });
  return aggregateCaltrainDelays(parseHostFetchJson(response, response.url || url));
}

function routeModeLabel(mode) {
  return mode === 'bike' ? 'bike' : 'walk';
}

function routeProfile(mode) {
  return mode === 'bike' ? 'cycling-regular' : 'foot-walking';
}

function routeBaseUrls(args) {
  const override = loopbackUrl(args && args.baseUrl);
  if (override) return [override.replace(/\/$/, '')];
  return [
    'https://api.heigit.org/openrouteservice',
    'https://api.openrouteservice.org',
  ];
}

function routeSummary(json) {
  const geoSummary = json && json.features && json.features[0] && json.features[0].properties && json.features[0].properties.summary;
  const routeSummaryValue = json && json.routes && json.routes[0] && json.routes[0].summary;
  const summary = geoSummary || routeSummaryValue;
  if (!summary) throw new Error('directions response did not include a route summary');
  const distanceMeters = finiteNumber(summary.distance);
  const durationSeconds = finiteNumber(summary.duration);
  if (distanceMeters == null || durationSeconds == null) {
    throw new Error('directions response summary did not include distance and duration');
  }
  return { distanceMeters, durationSeconds };
}

function haversineMiles(from, to) {
  const earthMiles = 3958.8;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const lat1 = rad(from.lat);
  const lat2 = rad(to.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fallbackRouteEstimate(args, source, error) {
  const mode = routeModeLabel(args && args.mode);
  const from = { lat: Number(args && args.fromLat), lng: Number(args && args.fromLng) };
  const to = { lat: Number(args && args.toLat), lng: Number(args && args.toLng) };
  const miles = haversineMiles(from, to);
  const mph = mode === 'bike' ? 9 : 3;
  return {
    mode,
    minutes: Math.max(1, Math.round((miles / mph) * 60)),
    distanceMiles: miles,
    source,
    cacheTtlMs: ROUTE_CACHE_TTL_MS,
    error: error || '',
  };
}

function validateRouteArgs(args) {
  const fromLat = finiteNumber(args && args.fromLat);
  const fromLng = finiteNumber(args && args.fromLng);
  const toLat = finiteNumber(args && args.toLat);
  const toLng = finiteNumber(args && args.toLng);
  if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
    throw new Error('routeEstimate requires finite from/to coordinates');
  }
  return {
    fromLat,
    fromLng,
    toLat,
    toLng,
    mode: routeModeLabel(args.mode),
    baseUrl: args.baseUrl,
  };
}

// Every db touch is awaited: the ctx host boundary is async and RPC-shaped on
// this target (LLP 0014 one-way door 3), including runtime.now.
globalThis.__snapbackHandlers = {
  async stationsQuery(ctx) {
    return await ctx.db.query('stations').order('orderIndex', 'asc').collect();
  },
  async tripsQuery(ctx) {
    return await ctx.db.query('trips').order('patternId', 'asc').collect();
  },
  async stopTimesByStation(ctx, args) {
    return await ctx.db.query('stopTimes').eq('stationId', args.stationId).order('sequence', 'asc').collect();
  },
  async liveTrainStatus(ctx) {
    return await ctx.db.query('trainStatus').order('patternId', 'asc').collect();
  },
  async feedState(ctx) {
    return await ctx.db.query('feedRefreshState').collect();
  },

  // Ported point-for-point from demos/all-aboard/snapback/handlers.mjs —
  // the recorded-feed advance, the live-snapshot commit, and the reset.
  async applyFeedTick(ctx, args) {
    const observedAt = await nowMs(ctx);
    const trigger = (args && args.trigger) || 'manual';
    const source = (args && args.source) || 'recorded';

    const state = await ctx.db.get('feedRefreshState', 'caltrain');
    const tickCount = state && state.tickCount ? state.tickCount : 1;
    const currentIndex = state && Number.isInteger(state.tickIndex) ? state.tickIndex : 0;
    const nextIndex = (currentIndex + 1) % Math.max(1, tickCount);

    const tick = await ctx.db.get('feedTicks', `tick-${nextIndex}`);
    const delays = (tick && tick.delays) || {};

    for (const patternId of PATTERN_IDS) {
      const delaySeconds = Number(delays[patternId]) || 0;
      const status = delaySeconds >= 120 ? 'delayed' : 'on-time';
      await ctx.db.patch('trainStatus', patternId, { delaySeconds, status, observedAt });
    }

    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: observedAt,
      tickIndex: nextIndex,
      lastSource: source,
      lastRunTrigger: trigger,
      lastError: (args && args.lastError) || '',
    });

    return { tickIndex: nextIndex, note: (tick && tick.note) || '' };
  },

  async applyLiveFeedSnapshot(ctx, args) {
    const observedAt = await nowMs(ctx);
    const trigger = (args && args.trigger) || 'manual';
    const delays = (args && args.delays) || {};
    const touched = [];

    for (const patternId of PATTERN_IDS) {
      if (!Object.prototype.hasOwnProperty.call(delays, patternId)) continue;
      const delaySeconds = Math.max(-300, Math.min(3600, Math.round(Number(delays[patternId]) || 0)));
      const status = delaySeconds >= 120 ? 'delayed' : 'on-time';
      await ctx.db.patch('trainStatus', patternId, { delaySeconds, status, observedAt });
      touched.push(patternId);
    }

    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: observedAt,
      lastSource: (args && args.source) || '511-siri-stop-monitoring',
      lastRunTrigger: trigger,
      lastError: (args && args.lastError) || '',
    });

    return {
      source: (args && args.source) || '511-siri-stop-monitoring',
      patterns: touched,
      note: (args && args.note) || '',
    };
  },

  async resetFeed(ctx) {
    const observedAt = await nowMs(ctx);
    for (const patternId of PATTERN_IDS) {
      await ctx.db.patch('trainStatus', patternId, { delaySeconds: 0, status: 'on-time', observedAt });
    }
    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: observedAt,
      tickIndex: 0,
      lastSource: 'reset',
      lastRunTrigger: 'reset',
      lastError: '',
    });
    return { tickIndex: 0 };
  },

  // The cron-invoked action (LLP 0049 Phase 2, migrated onto host-mediated
  // fetch): with a configured key it fetches 511 StopMonitoring through the
  // coordinator's query-param placement slot and commits through
  // applyLiveFeedSnapshot (the ONLY path that stamps
  // lastSource '511-siri-stop-monitoring'); without one, or on failure, it
  // advances the recorded feed and records why it fell back.
  async refreshFeed(ctx, args) {
    const trigger = (args && args.trigger) || 'cron';
    if (args && args.source === 'recorded') {
      return await ctx.runMutation('applyFeedTick', { trigger, source: 'recorded' });
    }
    try {
      const snapshot = await fetchCaltrainDelays(ctx, args || {});
      return await ctx.runMutation('applyLiveFeedSnapshot', {
        trigger,
        source: '511-siri-stop-monitoring',
        delays: snapshot.delays,
        note: `mapped ${snapshot.visitCount} 511 visits`,
        lastError: '',
      });
    } catch (error) {
      return await ctx.runMutation('applyFeedTick', {
        trigger,
        source: 'recorded-fallback',
        lastError: liveFeedFailureMessage(error),
      });
    }
  },

  async routeEstimate(ctx, args) {
    let input;
    try {
      input = validateRouteArgs(args || {});
    } catch (error) {
      return fallbackRouteEstimate(args || {}, 'haversine-fallback', errorMessage(error));
    }

    let handle;
    try {
      handle = ctx.secrets.rotating('directions');
    } catch (error) {
      return fallbackRouteEstimate(input, 'haversine-fallback', errorMessage(error));
    }

    const profile = routeProfile(input.mode);
    const start = `${input.fromLng},${input.fromLat}`;
    const end = `${input.toLng},${input.toLat}`;
    let lastError = '';
    for (const base of routeBaseUrls(input)) {
      const url = `${base}/v2/directions/${profile}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      try {
        const response = await ctx.fetch({
          url,
          headers: { Accept: 'application/json' },
          timeoutMs: 15_000,
          secretSlots: [{ placement: 'header', name: 'Authorization', handle }],
        });
        const summary = routeSummary(parseHostFetchJson(response, response.url || url));
        return {
          mode: input.mode,
          minutes: Math.max(1, Math.round(summary.durationSeconds / 60)),
          distanceMiles: summary.distanceMeters / METERS_PER_MILE,
          source: 'openrouteservice',
          profile,
          cacheTtlMs: ROUTE_CACHE_TTL_MS,
        };
      } catch (error) {
        lastError = errorMessage(error);
      }
    }
    return fallbackRouteEstimate(input, 'haversine-fallback', lastError);
  },

  // LLP 0049 Phase 1 secret-grant probes. probeSecrets runs as an ACTION with
  // uses: ['caltrainFeed', 'directions'] and reports only redaction-safe
  // facts: the marker string every materialization path yields, the coded
  // error expose()/asBearer() fail closed with, and the coded errors for
  // missing/undeclared entries. It never returns a value because it can
  // never see one.
  async probeSecrets(ctx) {
    function codeOf(error) {
      const message = String((error && error.message) || error);
      const match = message.match(/SNAPBACK_[A-Z0-9_]+/);
      return match ? match[0] : message;
    }
    function probeEntry(name) {
      try {
        const handle = ctx.secrets.rotating(name);
        let exposeError = null;
        let bearerError = null;
        try {
          handle.expose();
        } catch (error) {
          exposeError = codeOf(error);
        }
        try {
          handle.asBearer();
        } catch (error) {
          bearerError = codeOf(error);
        }
        return {
          granted: true,
          marker: String(handle),
          json: JSON.stringify(handle),
          template: `${handle}`,
          exposeError,
          bearerError,
          descriptor: handle.__snapbackDescriptor || null,
        };
      } catch (error) {
        return { granted: false, error: codeOf(error) };
      }
    }
    return {
      secretsType: typeof ctx.secrets,
      caltrainFeed: probeEntry('caltrainFeed'),
      directions: probeEntry('directions'),
      undeclared: probeEntry('notDeclaredAnywhere'),
    };
  },
  async probeSecretsQuery(ctx) {
    return { secretsType: typeof ctx.secrets };
  },
  async probeSlowFetch(ctx, args) {
    const response = await ctx.fetch({
      url: (args && args.url) || 'http://127.0.0.1:1/never',
      timeoutMs: (args && args.timeoutMs) || 10_000,
    });
    return { status: response.status, ok: response.ok };
  },
  async probeSecretsMutation(ctx) {
    return { secretsType: typeof ctx.secrets };
  },

  // Probe both denial directions (LLP 0040 §App subset), same as the notes
  // fixture: ambient globals and host reach-through must be unreachable.
  async probeAmbient(ctx) {
    function reach(name) {
      let value;
      try {
        value = globalThis[name];
      } catch (_) {
        return { name: name, reachable: false };
      }
      if (value === undefined || value === null) return { name: name, reachable: false };
      if (typeof value === 'function') {
        try {
          value();
          return { name: name, reachable: true };
        } catch (error) {
          const message = String((error && error.message) || error);
          return {
            name: name,
            reachable: message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') !== 0,
          };
        }
      }
      return { name: name, reachable: true };
    }
    return [
      reach('fetch'),
      reach('WebSocket'),
      reach('caches'),
      reach('crypto'),
      reach('DurableObjectStorage'),
      reach('env'),
      reach('COORDINATOR'),
      reach('HANDLER'),
      reach('HOST'),
    ];
  },
};
