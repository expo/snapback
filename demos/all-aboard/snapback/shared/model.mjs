// All Aboard — shared Caltrain transit model (pure, dependency-free JS).
//
// The only import is the generated station-photo asset map (base64 Wikimedia
// Commons photos); the rest of this file is pure geometry/schedule/prediction math.
//
// This is the single source of truth for the corridor geometry, the clock-face
// schedule, and the prediction/haversine/formatting math. It is imported by BOTH
// the Contract surface's data helpers (demos/all-aboard/surfaces/contract/data.ts)
// and the headless acceptance tests, so the numbers a rider sees on screen are the
// exact numbers the tests assert.
//
// Design (see LLP 0027):
//   - Stations are laid out on ONE north->south axis. `orderIndex` (0 = the
//     northern terminus, San Francisco) is the spine the whole app navigates and
//     the basis for assumed-direction and the position indicator.
//   - Every station carries `minutesFromSf`: the local-train travel time from San
//     Francisco. A trip's time at a served station is derived from this single
//     axis (scaled by the service class's speed factor), so express/limited/local
//     all share one consistent time base. This is what makes "position along the
//     line" a clean linear projection.
//   - Delays are SERVER-AUTHORITATIVE. The schedule is static; the live feed only
//     supplies a per-service-pattern delay (seconds), which the refresh mutation
//     writes into `trainStatus`. `delayByPattern` is threaded into every
//     prediction so a delta on one row shifts exactly the trains it should.
//
// @ref LLP 0027#backend-design — durable schedule + refresh-written delays;
//   predictions computed at query/render time from stopTimes + trainStatus + now.

import { STATION_PHOTOS } from './station-photos.gen.mjs';

// ---------------------------------------------------------------------------
// Corridor geometry — north (0) to south. minutesFromSf = local travel time
// from San Francisco. Each station carries a real Wikimedia Commons photo,
// inlined by station-photos.gen.mjs; see the manifest's temporaryPolicy note.
// ---------------------------------------------------------------------------

export const STATIONS = [
  { id: 'san-francisco',    name: 'San Francisco',       shortName: '4th & King',    orderIndex: 0,  minutesFromSf: 0,  zone: 1, lat: 37.77639, lng: -122.39472 },
  { id: 'twenty-second-st', name: '22nd Street',         shortName: '22nd Street',   orderIndex: 1,  minutesFromSf: 4,  zone: 1, lat: 37.75726, lng: -122.39215 },
  { id: 'bayshore',         name: 'Bayshore',            shortName: 'Bayshore',      orderIndex: 2,  minutesFromSf: 8,  zone: 1, lat: 37.70946, lng: -122.40163 },
  { id: 'south-sf',         name: 'South San Francisco', shortName: 'South SF',      orderIndex: 3,  minutesFromSf: 14, zone: 2, lat: 37.65585, lng: -122.40515 },
  { id: 'san-bruno',        name: 'San Bruno',           shortName: 'San Bruno',     orderIndex: 4,  minutesFromSf: 18, zone: 2, lat: 37.63099, lng: -122.41158 },
  { id: 'millbrae',         name: 'Millbrae',            shortName: 'Millbrae',      orderIndex: 5,  minutesFromSf: 22, zone: 2, lat: 37.59972, lng: -122.38686 },
  { id: 'burlingame',       name: 'Burlingame',          shortName: 'Burlingame',    orderIndex: 6,  minutesFromSf: 27, zone: 2, lat: 37.57998, lng: -122.34537 },
  { id: 'san-mateo',        name: 'San Mateo',           shortName: 'San Mateo',     orderIndex: 7,  minutesFromSf: 30, zone: 2, lat: 37.56813, lng: -122.32388 },
  { id: 'hayward-park',     name: 'Hayward Park',        shortName: 'Hayward Park',  orderIndex: 8,  minutesFromSf: 33, zone: 2, lat: 37.55258, lng: -122.30926 },
  { id: 'hillsdale',        name: 'Hillsdale',           shortName: 'Hillsdale',     orderIndex: 9,  minutesFromSf: 36, zone: 2, lat: 37.53797, lng: -122.29777 },
  { id: 'belmont',          name: 'Belmont',             shortName: 'Belmont',       orderIndex: 10, minutesFromSf: 39, zone: 3, lat: 37.52089, lng: -122.27588 },
  { id: 'san-carlos',       name: 'San Carlos',          shortName: 'San Carlos',    orderIndex: 11, minutesFromSf: 42, zone: 3, lat: 37.50742, lng: -122.26013 },
  { id: 'redwood-city',     name: 'Redwood City',        shortName: 'Redwood City',  orderIndex: 12, minutesFromSf: 46, zone: 3, lat: 37.48558, lng: -122.23192 },
  { id: 'menlo-park',       name: 'Menlo Park',          shortName: 'Menlo Park',    orderIndex: 13, minutesFromSf: 51, zone: 3, lat: 37.45503, lng: -122.18242 },
  { id: 'palo-alto',        name: 'Palo Alto',           shortName: 'Palo Alto',     orderIndex: 14, minutesFromSf: 54, zone: 3, lat: 37.44329, lng: -122.16462 },
  { id: 'california-ave',   name: 'California Avenue',    shortName: 'California Ave',orderIndex: 15, minutesFromSf: 57, zone: 3, lat: 37.42920, lng: -122.14193 },
  { id: 'mountain-view',    name: 'Mountain View',       shortName: 'Mountain View', orderIndex: 16, minutesFromSf: 63, zone: 3, lat: 37.39460, lng: -122.07607 },
  { id: 'sunnyvale',        name: 'Sunnyvale',           shortName: 'Sunnyvale',     orderIndex: 17, minutesFromSf: 69, zone: 4, lat: 37.37853, lng: -122.03116 },
  { id: 'lawrence',         name: 'Lawrence',            shortName: 'Lawrence',      orderIndex: 18, minutesFromSf: 73, zone: 4, lat: 37.37036, lng: -121.99676 },
  { id: 'santa-clara',      name: 'Santa Clara',         shortName: 'Santa Clara',   orderIndex: 19, minutesFromSf: 80, zone: 4, lat: 37.35306, lng: -121.93669 },
  { id: 'san-jose',         name: 'San Jose Diridon',    shortName: 'Diridon',       orderIndex: 20, minutesFromSf: 87, zone: 4, lat: 37.32975, lng: -121.90248 },
];

// The assumed-direction boundary (LLP 0027#assumed-direction): the nearest station
// at or north of South San Francisco assumes a southbound rider.
export const SOUTH_SAN_FRANCISCO_ORDER = 3;

const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
const STATION_BY_ORDER = new Map(STATIONS.map((s) => [s.orderIndex, s]));

// Station imagery. LLP 0027 wants a real "photo (or drawing)" from the Wikipedia
// List of Caltrain stations. Each station now carries its actual Wikimedia Commons
// photo (station-photos.gen.mjs), inlined as a base64 JPEG *inside* the SVG the
// Contract `image svgSource=` attribute expects. That keeps zero egress, full
// determinism, and native/web parity (the DOM mirror blocks data: URIs on `src=`,
// so a raw <img src="data:..."> would not render), while showing real photography.
const ZONE_TINTS = ['#2f5fe0', '#0a6cbf', '#0e7c86', '#b4460f', '#7a3ea8'];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Service patterns (trips). minuteSlots are clock-face departures from the
// ORIGIN (SF for southbound, San Jose for northbound). speedFactor scales the
// corridor travel time so faster classes visibly beat the local.
// ---------------------------------------------------------------------------

const ALL_NORTH_TO_SOUTH = STATIONS.map((s) => s.id);

export const PATTERNS = [
  {
    id: 'sb-local', direction: 'south', service: 'Local', trainNumberBase: 100,
    minuteSlots: [7, 37], speedFactor: 1.0, stopIds: ALL_NORTH_TO_SOUTH,
  },
  {
    id: 'sb-limited', direction: 'south', service: 'Limited', trainNumberBase: 300,
    minuteSlots: [22, 52], speedFactor: 0.82,
    stopIds: ['san-francisco', 'twenty-second-st', 'south-sf', 'millbrae', 'san-mateo', 'hillsdale', 'redwood-city', 'menlo-park', 'palo-alto', 'mountain-view', 'sunnyvale', 'santa-clara', 'san-jose'],
  },
  {
    id: 'sb-bullet', direction: 'south', service: 'Baby Bullet', trainNumberBase: 500,
    minuteSlots: [45], speedFactor: 0.66,
    stopIds: ['san-francisco', 'millbrae', 'hillsdale', 'redwood-city', 'palo-alto', 'mountain-view', 'sunnyvale', 'san-jose'],
  },
  {
    id: 'nb-local', direction: 'north', service: 'Local', trainNumberBase: 101,
    minuteSlots: [3, 33], speedFactor: 1.0, stopIds: [...ALL_NORTH_TO_SOUTH].reverse(),
  },
  {
    id: 'nb-limited', direction: 'north', service: 'Limited', trainNumberBase: 301,
    minuteSlots: [18, 48], speedFactor: 0.82,
    stopIds: ['san-jose', 'santa-clara', 'sunnyvale', 'mountain-view', 'palo-alto', 'menlo-park', 'redwood-city', 'hillsdale', 'san-mateo', 'millbrae', 'south-sf', 'twenty-second-st', 'san-francisco'],
  },
  {
    id: 'nb-bullet', direction: 'north', service: 'Baby Bullet', trainNumberBase: 501,
    minuteSlots: [12], speedFactor: 0.66,
    stopIds: ['san-jose', 'sunnyvale', 'mountain-view', 'palo-alto', 'redwood-city', 'hillsdale', 'millbrae', 'san-francisco'],
  },
];

const PATTERN_BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));

// How far ahead the board looks, and the countdown grace window.
const HOURS_AHEAD = 6;
const DEPARTED_GRACE_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Station helpers
// ---------------------------------------------------------------------------

export function getStations() {
  return STATIONS;
}

export function getStationById(stationId) {
  return STATION_BY_ID.get(stationId) ?? null;
}

// The real station photo for the card, returned as inline SVG markup for the
// Contract `image svgSource=` attribute (the DOM mirror blocks data: URIs on
// `src=`). The Wikimedia JPEG is embedded as a base64 <image>, slice-scaled to
// cover the banner, under a bottom scrim that keeps the station name legible over
// any photo. No network, fully deterministic, renders on web and native. Falls
// back to the zone-tinted gradient if a photo is somehow missing.
export function stationPhoto(stationId) {
  const station = STATION_BY_ID.get(stationId);
  if (!station) return '';
  const tint = ZONE_TINTS[(station.zone - 1) % ZONE_TINTS.length];
  const photo = STATION_PHOTOS[stationId];
  const backdrop = photo
    ? `<image href='${photo.dataUri}' x='0' y='0' width='560' height='150' preserveAspectRatio='xMidYMid slice'/>`
    : `<rect width='560' height='150' fill='url(#g)'/>`;
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 560 150' width='560' height='150'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${tint}'/><stop offset='1' stop-color='#10152b'/></linearGradient>` +
    `<linearGradient id='scrim' x1='0' y1='0' x2='0' y2='1'>` +
    `<stop offset='0' stop-color='#0a0f1e' stop-opacity='0'/><stop offset='1' stop-color='#0a0f1e' stop-opacity='0.72'/></linearGradient></defs>` +
    backdrop +
    `<rect y='70' width='560' height='80' fill='url(#scrim)'/>` +
    `<text x='28' y='120' font-family='system-ui,sans-serif' font-size='32' font-weight='800' fill='#ffffff'>${escapeXml(station.name)}</text>` +
    `<text x='28' y='140' font-family='system-ui,sans-serif' font-size='13' fill='#dbe3f4'>Caltrain · Zone ${station.zone}</text>` +
    `</svg>`
  );
}

// The photo credit line for the station card. CC BY / CC BY-SA license the
// photos on the condition that the author is named, so this must be shown.
export function stationPhotoCredit(stationId) {
  const photo = STATION_PHOTOS[stationId];
  if (!photo) return '';
  return `Photo: ${photo.attribution} · Wikimedia Commons`;
}

export function toRadians(value) {
  return (value * Math.PI) / 180;
}

// Great-circle miles between a location and a station (haversine).
export function estimateDistanceMiles(from, station) {
  if (!from || !station) return 0;
  const earthRadiusMiles = 3958.8;
  const lat1 = toRadians(from.lat ?? from.latitude);
  const lon1 = toRadians(from.lng ?? from.longitude);
  const lat2 = toRadians(station.lat);
  const lon2 = toRadians(station.lng);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(a));
}

// Walk ~3 mph, bike ~9 mph (LLP 0027: haversine v0, zero egress, deterministic).
export function estimateWalkMinutes(from, station) {
  return Math.max(1, Math.round((estimateDistanceMiles(from, station) / 3) * 60));
}

export function estimateBikeMinutes(from, station) {
  return Math.max(1, Math.round((estimateDistanceMiles(from, station) / 9) * 60));
}

export function getNearestStations(from, count = 3) {
  return [...STATIONS]
    .map((station) => ({ station, miles: estimateDistanceMiles(from, station) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, count)
    .map((entry) => entry.station);
}

export function getNearestStation(from) {
  return getNearestStations(from, 1)[0] ?? STATION_BY_ORDER.get(0);
}

export function searchStations(query, from) {
  const normalized = (query ?? '').trim().toLowerCase();
  const base = normalized
    ? STATIONS.filter((s) => s.name.toLowerCase().includes(normalized) || s.shortName.toLowerCase().includes(normalized))
    : [...STATIONS];
  if (!from) return base;
  return base.sort((a, b) => estimateDistanceMiles(from, a) - estimateDistanceMiles(from, b));
}

export function getSelectedStation(explicitStationId, from) {
  return getStationById(explicitStationId) ?? (from ? getNearestStation(from) : STATION_BY_ORDER.get(0));
}

export function getAdjacentStation(stationId, delta) {
  const station = getStationById(stationId);
  if (!station) return null;
  return STATION_BY_ORDER.get(station.orderIndex + delta) ?? station;
}

// LLP 0027#assumed-direction: nearest station at or north of South SF => south.
export function assumedDirection(station) {
  if (!station) return 'south';
  return station.orderIndex <= SOUTH_SAN_FRANCISCO_ORDER ? 'south' : 'north';
}

// ---------------------------------------------------------------------------
// Static schedule seed (durable stations / trips / stopTimes rows)
// ---------------------------------------------------------------------------

// Per-station scheduled offset (minutes) from a pattern's origin departure.
function servedOffsetMinutes(pattern, stationId) {
  const station = getStationById(stationId);
  const origin = getStationById(pattern.stopIds[0]);
  if (!station || !origin) return null;
  return Math.round(Math.abs(station.minutesFromSf - origin.minutesFromSf) * pattern.speedFactor);
}

export function getStaticScheduleSeed() {
  const stations = STATIONS.map((s) => ({
    _id: s.id,
    stationId: s.id,
    name: s.name,
    shortName: s.shortName,
    orderIndex: s.orderIndex,
    minutesFromSf: s.minutesFromSf,
    zone: s.zone,
    lat: s.lat,
    lng: s.lng,
    // The surface renders the real photo via stationPhoto() (base64-inlined from
    // Wikimedia Commons); the durable row keeps the credit so the seed stays small.
    photoUrl: '',
    photoAttribution:
      (STATION_PHOTOS[s.id]?.attribution ?? 'Wikimedia Commons') + ' (via Wikipedia, List of Caltrain stations)',
  }));

  const trips = PATTERNS.map((p) => ({
    _id: p.id,
    patternId: p.id,
    direction: p.direction,
    service: p.service,
    trainNumberBase: p.trainNumberBase,
    minuteSlots: p.minuteSlots,
    speedFactor: p.speedFactor,
    originStationId: p.stopIds[0],
    destinationStationId: p.stopIds[p.stopIds.length - 1],
  }));

  const stopTimes = PATTERNS.flatMap((p) =>
    p.stopIds.map((stationId, sequence) => ({
      _id: `${p.id}:${stationId}`,
      patternId: p.id,
      stationId,
      sequence,
      offsetMinutes: servedOffsetMinutes(p, stationId),
    })),
  );

  return { stations, trips, stopTimes };
}

// ---------------------------------------------------------------------------
// Predictions — computed from the static schedule + server-authored delays + now
// ---------------------------------------------------------------------------

function normalizeDelays(delayByPattern) {
  return delayByPattern && typeof delayByPattern === 'object' ? delayByPattern : {};
}

function patternDelaySeconds(delays, patternId) {
  const value = Number(delays[patternId]);
  return Number.isFinite(value) ? value : 0;
}

function runId(patternId, scheduledOriginMs) {
  return `${patternId}|${scheduledOriginMs}`;
}

export function parseRunId(id) {
  const [patternId, scheduledOriginMs] = String(id).split('|');
  const ms = Number(scheduledOriginMs);
  if (!PATTERN_BY_ID.has(patternId) || !Number.isFinite(ms)) return null;
  return { patternId, scheduledOriginMs: ms };
}

function trainNumberFor(pattern, scheduledOriginMs) {
  const date = new Date(scheduledOriginMs);
  const ordinal = date.getHours() * pattern.minuteSlots.length +
    pattern.minuteSlots.indexOf(date.getMinutes());
  return String(pattern.trainNumberBase + Math.max(0, ordinal) * 2);
}

// Build a single departure of `pattern` from `station` for a scheduled origin time.
function buildDeparture(pattern, station, scheduledOriginMs, delaySeconds) {
  const offset = servedOffsetMinutes(pattern, station.id);
  if (offset == null) return null;
  const scheduledDepartureMs = scheduledOriginMs + offset * 60 * 1000;
  const predictedDepartureMs = scheduledDepartureMs + delaySeconds * 1000;
  const destination = getStationById(pattern.stopIds[pattern.stopIds.length - 1]);
  return {
    id: runId(pattern.id, scheduledOriginMs),
    patternId: pattern.id,
    direction: pattern.direction,
    service: pattern.service,
    trainNumber: trainNumberFor(pattern, scheduledOriginMs),
    headsign: destination ? destination.name : '',
    stationId: station.id,
    scheduledDepartureMs,
    predictedDepartureMs,
    delaySeconds,
  };
}

function collectCandidateDepartures(stationId, direction, nowMs, delays) {
  const station = getStationById(stationId);
  if (!station) return [];
  const patterns = PATTERNS.filter(
    (p) => p.direction === direction && p.stopIds.includes(station.id),
  );
  const startOfHour = new Date(nowMs);
  startOfHour.setMinutes(0, 0, 0);
  const out = [];
  for (let hourOffset = -1; hourOffset <= HOURS_AHEAD; hourOffset += 1) {
    const hourStart = startOfHour.getTime() + hourOffset * 60 * 60 * 1000;
    for (const pattern of patterns) {
      const delaySeconds = patternDelaySeconds(delays, pattern.id);
      for (const minute of pattern.minuteSlots) {
        const scheduledOriginMs = hourStart + minute * 60 * 1000;
        const departure = buildDeparture(pattern, station, scheduledOriginMs, delaySeconds);
        if (departure) out.push(departure);
      }
    }
  }
  return out.sort((a, b) => a.predictedDepartureMs - b.predictedDepartureMs);
}

export function getUpcomingDepartures(stationId, direction, nowMs, delayByPattern, limit = 4) {
  const delays = normalizeDelays(delayByPattern);
  return collectCandidateDepartures(stationId, direction, nowMs, delays)
    .filter((d) => d.predictedDepartureMs > nowMs - DEPARTED_GRACE_MS)
    .slice(0, limit);
}

export function getDirectionBoard(stationId, direction, nowMs, delayByPattern, limit = 4) {
  const station = getSelectedStation(stationId);
  const departures = getUpcomingDepartures(station.id, direction, nowMs, delayByPattern, limit);
  return {
    direction,
    stationId: station.id,
    primary: departures[0] ?? null,
    secondary: departures.slice(1),
  };
}

// Ordered stops + times + linear position for a tapped train (detail view).
export function getTrainRun(runIdString, nowMs, delayByPattern) {
  const parsed = parseRunId(runIdString);
  if (!parsed) return null;
  const pattern = PATTERN_BY_ID.get(parsed.patternId);
  if (!pattern) return null;
  const delaySeconds = patternDelaySeconds(normalizeDelays(delayByPattern), pattern.id);
  const predictedOriginMs = parsed.scheduledOriginMs + delaySeconds * 1000;

  const stops = pattern.stopIds.map((stationId, sequence) => {
    const station = getStationById(stationId);
    const offset = servedOffsetMinutes(pattern, stationId) ?? 0;
    return {
      station,
      sequence,
      scheduledTimeMs: parsed.scheduledOriginMs + offset * 60 * 1000,
      predictedTimeMs: predictedOriginMs + offset * 60 * 1000,
    };
  });

  const origin = getStationById(pattern.stopIds[0]);
  const destination = getStationById(pattern.stopIds[pattern.stopIds.length - 1]);
  return {
    id: runIdString,
    patternId: pattern.id,
    direction: pattern.direction,
    service: pattern.service,
    trainNumber: trainNumberFor(pattern, parsed.scheduledOriginMs),
    delaySeconds,
    origin,
    destination,
    headsign: destination ? destination.name : '',
    stopCount: stops.length,
    durationMinutes: Math.round((stops[stops.length - 1].scheduledTimeMs - stops[0].scheduledTimeMs) / 60000),
    stops,
    position: computePosition(stops, nowMs),
  };
}

// Linear position of the train along its own run: which segment it's in and how
// far through it (0..1), plus a corridor fraction for the north-south indicator.
export function computePosition(stops, nowMs) {
  if (!stops.length) return null;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (nowMs <= first.predictedTimeMs) {
    return { state: 'before', prevStationId: null, nextStationId: first.station.id, segmentProgress: 0, corridorFraction: corridorFraction(first.station) };
  }
  if (nowMs >= last.predictedTimeMs) {
    return { state: 'after', prevStationId: last.station.id, nextStationId: null, segmentProgress: 1, corridorFraction: corridorFraction(last.station) };
  }
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (nowMs >= a.predictedTimeMs && nowMs < b.predictedTimeMs) {
      const span = Math.max(1, b.predictedTimeMs - a.predictedTimeMs);
      const segmentProgress = (nowMs - a.predictedTimeMs) / span;
      const fromFrac = corridorFraction(a.station);
      const toFrac = corridorFraction(b.station);
      return {
        state: 'enroute',
        prevStationId: a.station.id,
        nextStationId: b.station.id,
        segmentProgress,
        corridorFraction: fromFrac + (toFrac - fromFrac) * segmentProgress,
      };
    }
  }
  return { state: 'enroute', prevStationId: first.station.id, nextStationId: last.station.id, segmentProgress: 0.5, corridorFraction: 0.5 };
}

function corridorFraction(station) {
  const maxOrder = STATIONS.length - 1;
  return maxOrder === 0 ? 0 : station.orderIndex / maxOrder;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatClockTime(timestampMs) {
  const date = new Date(timestampMs);
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const normalizedHours = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = hours >= 12 ? 'p' : 'a';
  return `${normalizedHours}:${minutes}${suffix}`;
}

export function formatCountdownMinutes(targetMs, nowMs) {
  return Math.max(0, Math.ceil((targetMs - nowMs) / 60000));
}

export function serviceColor(service) {
  switch (service) {
    case 'Baby Bullet': return '#e11d48';
    case 'Express': return '#f97316';
    case 'Limited': return '#0ea5e9';
    default: return '#10b981';
  }
}

export function directionTitle(direction) {
  return direction === 'north' ? 'Northbound' : 'Southbound';
}
