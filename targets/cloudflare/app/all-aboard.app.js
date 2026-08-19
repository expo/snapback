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

import schemaManifest from '../../../demos/all-aboard/snapback/generated/schema.manifest.json';
import functionsManifest from '../../../demos/all-aboard/snapback/generated/functions.manifest.json';
import seedData from '../../../demos/all-aboard/snapback/seed.json';
import capabilityManifest from '../generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json';
import deploymentIdentityArtifact from '../generated/deployment-identity.all-aboard.json';

export const appMeta = {
  name: 'all-aboard',
  // The gateway's fixed logical object name for the single-app proof
  // (LLP 0014 one-way door 6: names, not idFromName puns).
  objectName: 'all-aboard-proof',
};

export { capabilityManifest };
export const deploymentIdentity = deploymentIdentityArtifact;

// @ref LLP 0058#capability-maturity — this acknowledgment predates the
// stream capability's promotion to stable (LLP 0076 Accepted 2026-07-25) and
// is deliberately retained as the survival witness: acknowledging a stable id
// is a harmless no-op, so pre-promotion bundles keep deploying unchanged.
export const acknowledgedExperimentalCapabilities = ['bounded_response_stream_v1'];

export const schema = {
  schemaHash: schemaManifest.schemaHash,
  // The Cloudflare loader consumes this manifest option explicitly so the
  // target-admission refusal cannot be bypassed by the deploy-time adapter.
  strictDeclarations: schemaManifest.strictDeclarations === true,
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
      name: 'liveDepartures',
      syncable: true,
      fields: [
        { name: 'departureId', type: 'string', optional: false },
        { name: 'stationId', type: 'string', optional: false },
        { name: 'stopName', type: 'string', optional: false },
        { name: 'direction', type: 'string', optional: false },
        { name: 'service', type: 'string', optional: false },
        { name: 'patternId', type: 'string', optional: false },
        { name: 'trainNumber', type: 'string', optional: false },
        { name: 'headsign', type: 'string', optional: false },
        { name: 'scheduledDepartureMs', type: 'integer', optional: false },
        { name: 'predictedDepartureMs', type: 'integer', optional: false },
        { name: 'delaySeconds', type: 'integer', optional: false },
        { name: 'status', type: 'string', optional: false },
        { name: 'observedAt', type: 'integer', optional: false },
        { name: 'source', type: 'string', optional: false },
      ],
      indexes: [{ name: 'by_time', fields: ['predictedDepartureMs'] }],
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
        { name: 'lastUpstreamPollAt', type: 'integer', optional: true },
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
// 180000 (ENG-23642: one upstream 511 poll per 3 minutes, enforced
// transactionally by claimFeedPoll), action refreshFeed, activation
// WhileLive(liveTrainStatus),
// targetWakeup DynamicAlarm with the hardened durable runner. The
// coordinator arms its Durable Object alarm only while the activation
// policy is satisfied.
export const cron = functionsManifest.cronJobs || [];

// Deterministic seed rows with explicit ids (the demo's generated seed.json):
// the coordinator inserts them host-side — patch-shaped mutations like
// applyFeedTick address rows by these stable ids.
export const seed = seedData;

export const functions = [
  // Public board UI reads are side-effect-free and disclose only the public
  // timetable/feed display. Every mutation and action below remains gated;
  // in particular, no secret-spending or destructive export is anonymous.
  { name: 'stationsQuery', kind: 'Query', export: 'stationsQuery', tables: ['stations'], authRequirement: 'public' },
  { name: 'tripsQuery', kind: 'Query', export: 'tripsQuery', tables: ['trips'], authRequirement: 'public' },
  { name: 'stopTimesByStation', kind: 'Query', export: 'stopTimesByStation', tables: ['stopTimes'], authRequirement: 'public' },
  { name: 'liveTrainStatus', kind: 'LiveQuery', export: 'liveTrainStatus', tables: ['trainStatus'], authRequirement: 'public' },
  { name: 'liveDepartures', kind: 'LiveQuery', export: 'liveDepartures', tables: ['liveDepartures'], authRequirement: 'public' },
  { name: 'feedState', kind: 'LiveQuery', export: 'feedState', tables: ['feedRefreshState'], authRequirement: 'public' },
  // Regression witness for conservative Cloudflare fan-out: the handler
  // intentionally reads feedRefreshState despite declaring only trainStatus.
  // A feedRefreshState-only commit must still wake this subscription.
  { name: 'underdeclaredFeedState', kind: 'LiveQuery', export: 'feedState', tables: ['trainStatus'], testingOnly: true },
  { name: 'applyFeedTick', kind: 'Mutation', export: 'applyFeedTick', tables: ['trainStatus', 'liveDepartures', 'feedRefreshState', 'feedTicks'] },
  {
    name: 'applyLiveFeedSnapshot',
    kind: 'Mutation',
    export: 'applyLiveFeedSnapshot',
    tables: ['trainStatus', 'liveDepartures', 'feedRefreshState'],
  },
  { name: 'claimFeedPoll', kind: 'Mutation', export: 'claimFeedPoll', tables: ['feedRefreshState'] },
  { name: 'resetFeed', kind: 'Mutation', export: 'resetFeed', tables: ['trainStatus', 'liveDepartures', 'feedRefreshState'] },
  // The ambient-power denial probe, identical in role to the notes fixture's
  // (LLP 0040 §Acceptance): the V8 denial tests must keep passing against the
  // All Aboard bundle, not only the notes regression surface.
  { name: 'probeAmbient', kind: 'Query', export: 'probeAmbient' },
  // The real All Aboard actions (LLP 0049): declared with their action-only
  // config grants. Phase 1 wires descriptor grants; Phase 2 adds the host
  // fetch capability, the gateway action route, and the handler migration.
  { name: 'refreshFeed', kind: 'Action', export: 'refreshFeed', uses: ['caltrainFeed'], tables: ['trainStatus', 'liveDepartures', 'feedRefreshState'] },
  { name: 'routeEstimate', kind: 'Action', export: 'routeEstimate', uses: ['directions'], tables: [] },
  // Secret-grant probes for the LLP 0049 Phase 1 acceptance: the action
  // observes redacted descriptor handles (and their fail-closed expose());
  // the query and mutation prove ctx.secrets does not exist outside actions.
  { name: 'probeSecrets', kind: 'Action', export: 'probeSecrets', uses: ['caltrainFeed', 'directions'], tables: [], testingOnly: true },
  { name: 'probeSecretsQuery', kind: 'Query', export: 'probeSecretsQuery', testingOnly: true },
  { name: 'probeSecretsMutation', kind: 'Mutation', export: 'probeSecretsMutation', tables: ['trainStatus'], testingOnly: true },
  // Concurrency probe for the LLP 0049 Phase 2 acceptance: a deliberately
  // slow host fetch that must not block queries, mutations, or live pushes
  // on the same coordinator (the off-mutex execution contract).
  { name: 'probeSlowFetch', kind: 'Action', export: 'probeSlowFetch', tables: [], testingOnly: true },
  // Cross-target witness for LLP 0076: this is intentionally an ordinary
  // authored action using the shared ctx.fetchStream surface, not a direct
  // coordinator test.
  { name: 'probeResponseStream', kind: 'Action', export: 'probeResponseStream', requiredCapabilities: ['bounded_response_stream_v1'], tables: [], testingOnly: true },
  { name: 'probeStreamAttemptToken', kind: 'Action', export: 'probeStreamAttemptToken', requiredCapabilities: ['bounded_response_stream_v1'], tables: [], testingOnly: true },
  { name: 'probeStreamSecret', kind: 'Action', export: 'probeStreamSecret', requiredCapabilities: ['bounded_response_stream_v1'], uses: ['directions'], tables: [], testingOnly: true },
  { name: 'probeStreamRateFence', kind: 'Action', export: 'probeStreamRateFence', requiredCapabilities: ['bounded_response_stream_v1'], tables: ['trainStatus'], testingOnly: true },
  { name: 'probeStreamCursorCap', kind: 'Action', export: 'probeStreamCursorCap', requiredCapabilities: ['bounded_response_stream_v1'], tables: [], testingOnly: true },
  // Negative admission witness: auth.sessions.v1 is a known registry id this
  // target's served manifest does not support, so resolution must refuse
  // before the handler can run.
  { name: 'probeUnsupportedRequirement', kind: 'Action', export: 'probeUnsupportedRequirement', requiredCapabilities: ['auth.sessions.v1'], tables: [], testingOnly: true },
  { name: 'probeSecretForgery', kind: 'Action', export: 'probeSecretForgery', uses: ['directions'], tables: [], testingOnly: true },
  { name: 'probeSecretForgeryNoGrant', kind: 'Action', export: 'probeSecretForgery', tables: [], testingOnly: true },
  { name: 'probeSecretEcho', kind: 'Action', export: 'probeSecretEcho', uses: ['directions'], tables: [], testingOnly: true },
  { name: 'probeLateMutation', kind: 'Action', export: 'probeLateMutation', tables: [], testingOnly: true },
  { name: 'probeNestedTimeout', kind: 'Action', export: 'probeNestedTimeout', tables: [], testingOnly: true },
  { name: 'probeWrongNestedKind', kind: 'Action', export: 'probeWrongNestedKind', tables: [], testingOnly: true },
];

const PATTERN_IDS = ['sb-local', 'sb-limited', 'sb-bullet', 'nb-local', 'nb-limited', 'nb-bullet'];

// Upstream 511 poll budget (ENG-23642): one poll per 180s, with 5s of alarm
// scheduling-skew tolerance so a hair-early DO alarm doesn't silently halve
// the cadence to 360s. Mirrors demos/all-aboard/snapback/handlers.mjs.
const UPSTREAM_POLL_INTERVAL_MS = 180_000;
const UPSTREAM_POLL_GUARD_MS = UPSTREAM_POLL_INTERVAL_MS - 5_000;
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const METERS_PER_MILE = 1609.344;
const DEPARTED_GRACE_MS = 60 * 1000;
const STATION_NAME_ALIASES = [
  ['san-francisco', ['san francisco 4th king', 'san francisco', '4th king', 'sf caltrain']],
  ['twenty-second-st', ['22nd street', 'twenty second street', '22nd st']],
  ['bayshore', ['bayshore']],
  ['south-sf', ['south san francisco', 'south sf']],
  ['san-bruno', ['san bruno']],
  ['millbrae', ['millbrae']],
  ['burlingame', ['burlingame']],
  ['san-mateo', ['san mateo']],
  ['hayward-park', ['hayward park']],
  ['hillsdale', ['hillsdale']],
  ['belmont', ['belmont']],
  ['san-carlos', ['san carlos']],
  ['redwood-city', ['redwood city']],
  ['menlo-park', ['menlo park']],
  ['palo-alto', ['palo alto']],
  ['california-ave', ['california avenue', 'california ave']],
  ['mountain-view', ['mountain view']],
  ['sunnyvale', ['sunnyvale']],
  ['lawrence', ['lawrence']],
  ['santa-clara', ['santa clara']],
  ['san-jose', ['san jose diridon', 'san jose', 'diridon']],
];

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

function codeFromError(error) {
  const match = errorMessage(error).match(/SNAPBACK_[A-Z0-9_]+/);
  return match ? match[0] : errorMessage(error);
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
    return 'live 511 fetch unavailable: no 511.org key is set — configure caltrainFeed via targets/cloudflare/config-set.mjs';
  }
  if (/HTTP 401\b/.test(raw)) {
    return `live 511 fetch failed: 511 rejected the API key (mistyped, or not yet activated) — update caltrainFeed via targets/cloudflare/config-set.mjs (${raw})`;
  }
  if (/HTTP 429\b/.test(raw)) {
    return `live 511 fetch failed: 511 rate limit hit — add another caltrainFeed key via targets/cloudflare/config-set.mjs (keys rotate) or wait for the next window (${raw})`;
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

function normalizeStationText(value) {
  return textOf(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bcaltrain\b/g, ' ')
    .replace(/\bstation\b/g, ' ')
    .replace(/\bstop\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function stationIdFromCall(call) {
  const text = normalizeStationText([
    textOf(call.StopPointName),
    textOf(call.StopPointRef),
  ].join(' '));
  if (!text) return null;
  const matches = [];
  for (const [stationId, aliases] of STATION_NAME_ALIASES) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeStationText(alias);
      if (text === normalizedAlias || text.includes(normalizedAlias)) {
        matches.push({ stationId, length: normalizedAlias.length });
      }
    }
  }
  matches.sort((a, b) => b.length - a.length);
  return matches[0]?.stationId ?? null;
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
  ].join(' ').toLowerCase();

  if (/\b(nb|north|northbound)\b/.test(text)) return 'north';
  if (/\b(sb|south|southbound)\b/.test(text)) return 'south';
  if (/san francisco|4th|king|sf caltrain|sf$/.test(text)) return 'north';
  if (/san jose|diridon|tamien|gilroy/.test(text)) return 'south';
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

function serviceLabel(service) {
  if (service === 'bullet') return 'Baby Bullet';
  if (service === 'limited') return 'Limited';
  return 'Local';
}

function trainNumberFromJourney(mvj, service) {
  const text = [
    textOf(mvj.PublishedLineName),
    textOf(mvj.LineRef),
    textOf(mvj.VehicleRef),
    textOf(mvj.FramedVehicleJourneyRef && mvj.FramedVehicleJourneyRef.DatedVehicleJourneyRef),
  ].join(' ');
  const match = text.match(/\b([135]\d{2,3})\b/);
  if (match) return match[1];
  return service === 'bullet' ? '5xx' : service === 'limited' ? '3xx' : '1xx';
}

function headsignFromJourney(direction, mvj, call) {
  const explicit = textOf(mvj.DestinationName) || textOf(call.DestinationDisplay);
  if (explicit) return explicit;
  return direction === 'north' ? 'San Francisco' : 'San Jose Diridon';
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

function liveDepartureFromVisit(visit, observedAt) {
  const mvj = visit && visit.MonitoredVehicleJourney ? scalar(visit.MonitoredVehicleJourney) : null;
  const call = mvj && mvj.MonitoredCall ? scalar(mvj.MonitoredCall) : {};
  if (!mvj || !call) return null;

  const stationId = stationIdFromCall(call);
  const direction = classifyDirection(mvj, call);
  if (!stationId || !direction) return null;

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
  const predictedDepartureMs = expected ?? aimed;
  if (predictedDepartureMs == null || predictedDepartureMs < observedAt - DEPARTED_GRACE_MS) return null;

  const delaySeconds = Number.isFinite(expected) && Number.isFinite(aimed)
    ? Math.round((expected - aimed) / 1000)
    : (delaySecondsFromVisit(visit) ?? 0);
  const service = classifyService(mvj);
  const patternId = `${direction === 'south' ? 'sb' : 'nb'}-${service}`;
  const trainNumber = trainNumberFromJourney(mvj, service);
  const departureId =
    textOf(mvj.FramedVehicleJourneyRef && mvj.FramedVehicleJourneyRef.DatedVehicleJourneyRef) ||
    `${patternId}:${stationId}:${predictedDepartureMs}:${trainNumber}`;

  return {
    departureId,
    stationId,
    stopName: textOf(call.StopPointName) || stationId,
    direction,
    service: serviceLabel(service),
    patternId,
    trainNumber,
    headsign: headsignFromJourney(direction, mvj, call),
    scheduledDepartureMs: aimed ?? predictedDepartureMs,
    predictedDepartureMs,
    delaySeconds: Math.max(-300, Math.min(3600, Math.round(delaySeconds || 0))),
    status: delaySeconds >= 120 ? 'delayed' : 'on-time',
    observedAt,
    source: '511-siri-stop-monitoring',
  };
}

function aggregateCaltrainSnapshot(json, observedAt) {
  const buckets = {};
  const departures = [];
  let visited = 0;
  for (const visit of flattenVisits(json)) {
    const mvj = visit && visit.MonitoredVehicleJourney ? scalar(visit.MonitoredVehicleJourney) : null;
    const call = mvj && mvj.MonitoredCall ? scalar(mvj.MonitoredCall) : {};
    if (!mvj || !call) continue;
    visited += 1;

    const departure = liveDepartureFromVisit(visit, observedAt);
    if (departure) departures.push(departure);

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
  departures.sort((a, b) => a.predictedDepartureMs - b.predictedDepartureMs || a.departureId.localeCompare(b.departureId));
  return { delays, departures, visitCount: visited };
}

function testOverrideUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/^https?:\/\//.test(value) && value.length <= 4096) return value;
  return null;
}

// The URL the handler builds carries NO key: the api_key query parameter is
// a coordinator-side placement slot.
function caltrainFeedUrl(args) {
  const override = testOverrideUrl(args && args.feedUrl);
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

async function fetchCaltrainSnapshot(ctx, args) {
  const handle = ctx.secrets.rotating('caltrainFeed');
  const url = caltrainFeedUrl(args);
  const response = await ctx.fetch({
    url,
    headers: { Accept: 'application/json' },
    timeoutMs: 15_000,
    secretSlots: [{ placement: 'query-param', name: 'api_key', handle }],
  });
  return aggregateCaltrainSnapshot(parseHostFetchJson(response, response.url || url), await nowMs(ctx));
}

function routeModeLabel(mode) {
  return mode === 'bike' ? 'bike' : 'walk';
}

function routeProfile(mode) {
  return mode === 'bike' ? 'cycling-regular' : 'foot-walking';
}

function routeBaseUrls(args) {
  const override = testOverrideUrl(args && args.baseUrl);
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
  async liveDepartures(ctx) {
    return await ctx.db.query('liveDepartures').order('predictedDepartureMs', 'asc').collect();
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
    for (const row of await ctx.db.query('liveDepartures').collect()) {
      await ctx.db.delete('liveDepartures', row._id);
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
    const departures = Array.isArray(args && args.departures) ? args.departures : [];
    const touched = [];

    for (const patternId of PATTERN_IDS) {
      if (!Object.prototype.hasOwnProperty.call(delays, patternId)) continue;
      const delaySeconds = Math.max(-300, Math.min(3600, Math.round(Number(delays[patternId]) || 0)));
      const status = delaySeconds >= 120 ? 'delayed' : 'on-time';
      await ctx.db.patch('trainStatus', patternId, { delaySeconds, status, observedAt });
      touched.push(patternId);
    }
    for (const row of await ctx.db.query('liveDepartures').collect()) {
      await ctx.db.delete('liveDepartures', row._id);
    }
    for (const departure of departures) {
      await ctx.db.insert('liveDepartures', {
        departureId: String(departure.departureId || `${departure.patternId || 'train'}:${departure.stationId || 'station'}:${departure.predictedDepartureMs || observedAt}`),
        stationId: String(departure.stationId || ''),
        stopName: String(departure.stopName || departure.stationId || ''),
        direction: departure.direction === 'north' ? 'north' : 'south',
        service: String(departure.service || 'Local'),
        patternId: String(departure.patternId || ''),
        trainNumber: String(departure.trainNumber || ''),
        headsign: String(departure.headsign || ''),
        scheduledDepartureMs: Math.round(Number(departure.scheduledDepartureMs) || Number(departure.predictedDepartureMs) || observedAt),
        predictedDepartureMs: Math.round(Number(departure.predictedDepartureMs) || observedAt),
        delaySeconds: Math.max(-300, Math.min(3600, Math.round(Number(departure.delaySeconds) || 0))),
        status: String(departure.status || 'on-time'),
        observedAt,
        source: '511-siri-stop-monitoring',
      });
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

  // Grants (or denies) permission to poll 511 upstream. Stamping
  // lastUpstreamPollAt inside this mutation makes the budget transactional:
  // the DO serializes mutations, so a cron tick and a manual Refresh racing
  // each other can never both be granted within one window (ENG-23642).
  async claimFeedPoll(ctx, args) {
    const observedAt = await nowMs(ctx);
    const trigger = (args && args.trigger) || 'manual';
    // minIntervalMs can only LOWER the window (testing rigs with short synthetic
    // cadences); the 180s production budget is the ceiling, never raisable.
    const requested = Number(args && args.minIntervalMs);
    const guardMs = Number.isFinite(requested) && requested >= 0
      ? Math.min(requested, UPSTREAM_POLL_GUARD_MS)
      : UPSTREAM_POLL_GUARD_MS;
    const state = await ctx.db.get('feedRefreshState', 'caltrain');
    const lastPollAt = state && Number(state.lastUpstreamPollAt) > 0 ? Number(state.lastUpstreamPollAt) : 0;
    const elapsed = observedAt - lastPollAt;
    if (lastPollAt > 0 && elapsed >= 0 && elapsed < guardMs) {
      return {
        allowed: false,
        trigger,
        retryInMs: guardMs - elapsed,
        lastUpstreamPollAt: lastPollAt,
      };
    }
    await ctx.db.patch('feedRefreshState', 'caltrain', { lastUpstreamPollAt: observedAt });
    return { allowed: true, trigger, retryInMs: 0, lastUpstreamPollAt: observedAt };
  },

  async resetFeed(ctx) {
    const observedAt = await nowMs(ctx);
    for (const patternId of PATTERN_IDS) {
      await ctx.db.patch('trainStatus', patternId, { delaySeconds: 0, status: 'on-time', observedAt });
    }
    for (const row of await ctx.db.query('liveDepartures').collect()) {
      await ctx.db.delete('liveDepartures', row._id);
    }
    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: observedAt,
      tickIndex: 0,
      lastSource: 'reset',
      lastRunTrigger: 'reset',
      lastError: '',
      lastUpstreamPollAt: 0,
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
    // Budget gate before any egress (ENG-23642): at most one upstream 511 poll
    // per window, shared by cron and manual Refresh. A denied claim answers
    // from the already-committed rows — no fetch, no writes, board unchanged.
    const budgetOverride = Number(args && args.pollBudgetMs);
    const claim = await ctx.runMutation('claimFeedPoll', {
      trigger,
      ...(Number.isFinite(budgetOverride) && budgetOverride >= 0 ? { minIntervalMs: budgetOverride } : {}),
    });
    if (!claim || claim.allowed !== true) {
      return {
        skipped: 'updated-recently',
        trigger,
        retryInMs: claim && Number(claim.retryInMs) > 0 ? Number(claim.retryInMs) : 0,
      };
    }
    try {
      const snapshot = await fetchCaltrainSnapshot(ctx, args || {});
      return await ctx.runMutation('applyLiveFeedSnapshot', {
        trigger,
        source: '511-siri-stop-monitoring',
        delays: snapshot.delays,
        departures: snapshot.departures,
        note: `mapped ${snapshot.departures.length} departures from ${snapshot.visitCount} 511 visits`,
        lastError: snapshot.departures.length === 0 && snapshot.visitCount > 0
          ? `511 StopMonitoring returned ${snapshot.visitCount} visits but no station-mappable departures; showing no live departures instead of demo trains`
          : '',
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
          // ORS answers GET directions with application/geo+json; a strict
          // application/json Accept gets a 406 from the real service (found
          // in the LLP 0049 Phase 4 remote run — the local mocks never
          // exercised content negotiation).
          headers: { Accept: 'application/json, application/geo+json;q=0.9, */*;q=0.1' },
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
  async probeResponseStream(ctx, args) {
    const response = await ctx.fetchStream({
      url: args.url,
      method: args.method || 'GET',
      idempotencyKey: args.idempotencyKey || null,
    });
    const reader = response.body.getReader();
    let reads = 0;
    let totalBytes = 0;
    let maxChunkBytes = 0;
    let checksum = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      reads += 1;
      totalBytes += chunk.value.byteLength;
      maxChunkBytes = Math.max(maxChunkBytes, chunk.value.byteLength);
      for (let index = 0; index < chunk.value.byteLength; index += 1) {
        checksum = (checksum + chunk.value[index]) % 65536;
      }
      if (args.cancelAfterReads && reads >= args.cancelAfterReads) {
        await reader.cancel();
        await reader.cancel();
        const afterCancel = await reader.read();
        return {
          status: response.status,
          reads,
          totalBytes,
          maxChunkBytes,
          checksum,
          cancelled: true,
          doneAfterCancel: afterCancel.done,
        };
      }
    }
    return {
      status: response.status,
      reads,
      totalBytes,
      maxChunkBytes,
      checksum,
      cancelled: false,
    };
  },
  async probeUnsupportedRequirement() {
    return { unreachable: true };
  },
  // The StreamAttemptV1 control plane does not exist on this target: a
  // presented token must be refused fail-closed, never silently unfenced.
  async probeStreamAttemptToken(ctx, args) {
    try {
      await ctx.fetchStream({ url: args.url, attemptToken: 'attempt-token-1' });
      return { refused: false };
    } catch (error) {
      return { refused: true, code: String((error && error.message) || error) };
    }
  },
  // LLP 0036 hosted placement seam: the descriptor unwraps only at the
  // coordinator's stream-open boundary; the isolate never sees the value.
  async probeStreamSecret(ctx, args) {
    const handle = ctx.secrets.get('directions');
    const response = await ctx.fetchStream({
      url: args.url,
      secretSlots: [{ placement: 'header', name: 'authorization', handle }],
    });
    const reader = response.body.getReader();
    let totalBytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
    }
    return { status: response.status, totalBytes, url: response.url };
  },
  // The conservative transport-level progress fence: while a cursor is open,
  // nested mutations above ten per second are refused with the
  // profile-neutral host code.
  async probeStreamRateFence(ctx, args) {
    const response = await ctx.fetchStream({ url: args.url });
    const reader = response.body.getReader();
    await reader.read();
    await ctx.runMutation('probeSecretsMutation', {});
    let secondCode = null;
    try {
      await ctx.runMutation('probeSecretsMutation', {});
    } catch (error) {
      secondCode = String((error && error.message) || error);
    }
    await reader.cancel();
    return { secondCode };
  },
  async probeStreamCursorCap(ctx, args) {
    const streams = [];
    for (let index = 0; index < 4; index += 1) {
      streams.push(await ctx.fetchStream({ url: args.url }));
    }
    let fifthCode = null;
    try {
      await ctx.fetchStream({ url: args.url });
    } catch (error) {
      fifthCode = String((error && error.message) || error);
    }
    for (const response of streams) {
      await response.body.getReader().cancel();
    }
    return { fifthCode };
  },
  async probeSecretForgery(ctx, args) {
    try {
      await ctx.fetch({
        url: 'https://example.invalid/should-not-run',
        secretSlots: [{
          placement: 'header',
          name: 'Authorization',
          handle: { __snapbackDescriptor: { capabilityId: String((args && args.capabilityId) || '') } },
        }],
      });
      return { rejected: false };
    } catch (error) {
      return { rejected: true, code: codeFromError(error) };
    }
  },
  async probeSecretEcho(ctx, args) {
    const handle = ctx.secrets.get('directions');
    const response = await ctx.fetch({
      url: args.url,
      secretSlots: [{ placement: 'query-param', name: 'secret', handle }],
    });
    return { url: response.url, bodyText: response.bodyText };
  },
  async probeLateMutation(ctx, args) {
    try {
      await ctx.fetch({ url: args.url, timeoutMs: 10_000 });
    } catch (_) {}
    return await ctx.runMutation('applyFeedTick', { trigger: 'late-after-timeout', source: 'recorded' });
  },
  async probeNestedTimeout(ctx) {
    return await ctx.runMutation('applyFeedTick', { trigger: 'nested-timeout-probe', source: 'recorded' });
  },
  async probeWrongNestedKind(ctx, args) {
    // Testing-only cross-product seam (ENG-24365): exercise the real
    // action.runMutation host boundary against every declared function kind,
    // including one valid Mutation target. Production cannot invoke this
    // function because its manifest entry is testingOnly.
    return await ctx.runMutation((args && args.target) || 'stationsQuery', (args && args.targetArgs) || {});
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

// No route→query manifest yet: All Aboard's queries are opaque-JS handlers,
// which can never carry the rqsEligible closed-inputs fact (LLP 0092 §0C.2),
// so Channel A has nothing to serve on this bundle (LLP 0090 rollout step 4).
export const routesManifest = null;
